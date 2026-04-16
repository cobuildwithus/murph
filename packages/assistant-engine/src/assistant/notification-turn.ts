import * as z from 'zod'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { resolveAssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import { normalizeAssistantExecutionContext } from './execution-context.js'
import { resolveAssistantExecutionDefaultTarget } from './execution-context.js'
import { resolveAssistantSessionForMessage } from './session-resolution.js'
import { resolveAssistantTurnSharedPlan } from './turn-plan.js'
import {
  executeProviderTurnWithRecovery,
  type AssistantProviderTurnExecutionProfile,
} from './provider-turn-runner.js'
import { persistPendingAssistantUsageEvent } from './service-usage.js'
import { persistAssistantTurnAndSession } from './turn-finalizer.js'
import { resolveAssistantTurnRoutes } from './service-turn-routes.js'
import { prioritizeAssistantRoutesForRichUserMessageContent } from './rich-content-routing.js'
import { createAssistantTurnId } from './turns.js'
import { sanitizeAssistantOutboundReply } from './reply-sanitizer.js'
import { withAssistantTurnLock } from './turn-lock.js'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from './service-contracts.js'
import { normalizeRequiredText } from './shared.js'

const assistantNotificationSkipDecisionSchema = z
  .object({
    kind: z.literal('skip'),
    privateSummary: z.string().min(1),
  })
  .strict()

const assistantNotificationSendDecisionSchema = z
  .object({
    kind: z.literal('send_message'),
    text: z.string().min(1),
    privateSummary: z.string().min(1),
  })
  .strict()

const assistantNotificationDecisionSchema = z.discriminatedUnion('kind', [
  assistantNotificationSkipDecisionSchema,
  assistantNotificationSendDecisionSchema,
])

const ASSISTANT_NOTIFICATION_TURN_PROFILE: Required<AssistantProviderTurnExecutionProfile> = {
  nativeResumePolicy: 'disabled',
  promptProfile: 'notification-decision',
  toolProfile: 'notification-turn',
}

export type AssistantNotificationDecision = z.infer<
  typeof assistantNotificationDecisionSchema
>

export interface AssistantNotificationInput
  extends AssistantSessionResolutionFields,
    Pick<
      AssistantMessageInput,
      | 'abortSignal'
      | 'codexCommand'
      | 'deliveryDispatchMode'
      | 'deliveryReplyToMessageId'
      | 'deliveryTarget'
      | 'executionContext'
      | 'failoverRoutes'
      | 'onProviderEvent'
      | 'onTraceEvent'
      | 'operatorAuthority'
      | 'showThinkingTraces'
      | 'turnTrigger'
      | 'workingDirectory'
    > {
  deliveryDedupeToken?: string | null
  instructions: string
}

export interface AssistantNotificationResult {
  decision: AssistantNotificationDecision
  response: string | null
  session: AssistantSession
}

export async function sendAssistantNotificationLocal(
  input: AssistantNotificationInput,
): Promise<AssistantNotificationResult> {
  const executionContext = normalizeAssistantExecutionContext(input.executionContext)
  const boundaryDefaultTarget = resolveAssistantExecutionDefaultTarget({
    executionContext,
    fallbackTarget: createDefaultLocalAssistantModelTarget(),
  })
  const defaults = await resolveAssistantOperatorDefaults()

  return withAssistantTurnLock({
    abortSignal: input.abortSignal,
    vault: input.vault,
    run: async () => {
      const messageInput = buildAssistantNotificationMessageInput(input)
      const resolved = await resolveAssistantSessionForMessage({
        boundaryDefaultTarget,
        defaults,
        message: messageInput,
      })
      const sharedPlan = await resolveAssistantTurnSharedPlan(messageInput, resolved)
      const routes = prioritizeAssistantRoutesForRichUserMessageContent({
        routes: resolveAssistantTurnRoutes(messageInput, defaults, resolved),
        userMessageContent: null,
      })
      const turnId = createAssistantTurnId()
      const turnCreatedAt = new Date().toISOString()
      const providerOutcome = await executeProviderTurnWithRecovery({
        input: messageInput,
        plan: sharedPlan,
        profile: ASSISTANT_NOTIFICATION_TURN_PROFILE,
        resolvedSession: resolved.session,
        routes,
        turnCreatedAt,
        turnId,
      })
      if (providerOutcome.kind === 'failed_terminal') {
        throw providerOutcome.error
      }

      const providerResult = providerOutcome.providerTurn
      await persistPendingAssistantUsageEvent({
        executionContext,
        providerResult,
        turnId,
        vault: input.vault,
      })
      const decision = parseAssistantNotificationDecision(providerResult.response)

      if (decision.kind === 'skip') {
        return {
          decision,
          response: null,
          session: providerResult.session,
        }
      }

      const sanitizedResponse = normalizeRequiredText(
        sanitizeAssistantOutboundReply(
          decision.text,
          providerResult.session.binding.channel ?? input.channel ?? null,
        ),
        'notification response',
      )
      const savedSession = await persistAssistantTurnAndSession({
        assistantTranscriptText: sanitizedResponse,
        input: messageInput,
        plan: sharedPlan,
        persistUserPromptToTranscript: false,
        providerResult,
        resumeStatePolicy: 'clear',
        session: providerResult.session,
        turnCreatedAt,
        turnId,
      })
      await deliverAssistantNotificationMessage({
        dedupeToken: input.deliveryDedupeToken ?? null,
        input: messageInput,
        message: sanitizedResponse,
        session: savedSession,
        sharedPlan,
        turnId,
      })

      return {
        decision: {
          ...decision,
          text: sanitizedResponse,
        },
        response: sanitizedResponse,
        session: savedSession,
      }
    },
  })
}

function buildAssistantNotificationMessageInput(
  input: AssistantNotificationInput,
): AssistantMessageInput {
  const { instructions: _instructions, ...sessionInput } = input

  return {
    ...sessionInput,
    abortSignal: input.abortSignal,
    codexCommand: input.codexCommand,
    deliverResponse: true,
    deliveryDispatchMode: input.deliveryDispatchMode,
    deliveryReplyToMessageId: input.deliveryReplyToMessageId ?? null,
    deliveryTarget: input.deliveryTarget ?? null,
    executionContext: input.executionContext,
    failoverRoutes: input.failoverRoutes,
    includeFirstTurnCheckIn: false,
    onProviderEvent: input.onProviderEvent ?? null,
    onTraceEvent: input.onTraceEvent,
    operatorAuthority: input.operatorAuthority,
    persistUserPromptOnFailure: false,
    prompt: normalizeRequiredText(input.instructions, 'instructions'),
    showThinkingTraces: input.showThinkingTraces,
    turnTrigger: input.turnTrigger ?? 'automation-cron',
    userMessageContent: null,
    workingDirectory: input.workingDirectory ?? input.vault,
  }
}

async function deliverAssistantNotificationMessage(input: {
  dedupeToken: string | null
  input: AssistantMessageInput
  message: string
  session: AssistantSession
  sharedPlan: Awaited<ReturnType<typeof resolveAssistantTurnSharedPlan>>
  turnId: string
}): Promise<void> {
  const state = createAssistantRuntimeStateService(input.input.vault)
  const audience = input.sharedPlan.conversationPolicy.audience
  const outcome = await state.outbox.deliverMessage({
    turnId: input.turnId,
    sessionId: input.session.sessionId,
    message: input.message,
    dedupeToken: input.dedupeToken,
    channel: audience.channel ?? input.session.binding.channel,
    identityId: audience.identityId ?? input.session.binding.identityId,
    actorId: audience.actorId ?? input.session.binding.actorId,
    threadId: audience.threadId ?? input.session.binding.threadId,
    threadIsDirect: audience.threadIsDirect ?? input.session.binding.threadIsDirect,
    bindingDelivery: audience.bindingDelivery ?? input.session.binding.delivery,
    explicitTarget: audience.explicitTarget ?? input.input.deliveryTarget ?? null,
    replyToMessageId:
      audience.replyToMessageId ?? input.input.deliveryReplyToMessageId ?? null,
    dispatchMode: input.input.deliveryDispatchMode,
  })

  switch (outcome.kind) {
    case 'sent':
    case 'queued':
      return
    case 'failed':
      throw outcome.deliveryError
    default:
      throw new VaultCliError(
        'ASSISTANT_DELIVERY_FAILED',
        'Assistant outbound delivery did not complete successfully.',
      )
  }
}

export function parseAssistantNotificationDecision(
  value: string,
): AssistantNotificationDecision {
  const normalized = normalizeAssistantNotificationDecisionJson(value)

  try {
    return assistantNotificationDecisionSchema.parse(
      JSON.parse(normalized) as unknown,
    )
  } catch (error) {
    const extracted = tryExtractAssistantNotificationDecisionObject(normalized)
    if (!extracted) {
      throw new VaultCliError(
        'ASSISTANT_NOTIFICATION_INVALID_RESPONSE',
        'Assistant notification turn must return a single valid JSON decision object.',
      )
    }

    try {
      return assistantNotificationDecisionSchema.parse(
        JSON.parse(extracted) as unknown,
      )
    } catch {
      throw new VaultCliError(
        'ASSISTANT_NOTIFICATION_INVALID_RESPONSE',
        'Assistant notification turn returned an invalid decision object.',
      )
    }
  }
}

function normalizeAssistantNotificationDecisionJson(value: string): string {
  const trimmed = value.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)
  return fenced?.[1]?.trim() ?? trimmed
}

function tryExtractAssistantNotificationDecisionObject(
  value: string,
): string | null {
  const firstBrace = value.indexOf('{')
  const lastBrace = value.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return null
  }

  return value.slice(firstBrace, lastBrace + 1).trim()
}

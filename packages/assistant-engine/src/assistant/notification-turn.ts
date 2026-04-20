import * as z from 'zod'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { resolveAssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import { normalizeAssistantExecutionContext } from './execution-context.js'
import { resolveAssistantExecutionDefaultTarget } from './execution-context.js'
import { resolveAssistantExecutionOperatorDefaults } from './execution-context.js'
import { resolveAssistantSessionForMessage } from './session-resolution.js'
import { resolveAssistantTurnSharedPlan } from './turn-plan.js'
import {
  executeProviderTurnWithRecovery,
  type AssistantProviderTurnExecutionProfile,
} from './provider-turn-runner.js'
import { resolveAssistantDiagnosticsPolicy } from './issue-reporting.js'
import { persistPendingAssistantUsageEvent } from './service-usage.js'
import { persistAssistantTurnAndSession } from './turn-finalizer.js'
import { resolveAssistantTurnRoutes } from './service-turn-routes.js'
import { prioritizeAssistantRoutesForRichUserMessageContent } from './rich-content-routing.js'
import { createAssistantTurnId } from './turns.js'
import { sanitizeAssistantProviderResponseForVisibility } from './reply-sanitizer.js'
import {
  normalizeAssistantDeliverySubject,
} from './channel-adapters.js'
import { withAssistantTurnLock } from './turn-lock.js'
import type {
  AssistantDeliveryOutcome,
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from './service-contracts.js'
import { finalizeAssistantTurnFromDeliveryOutcome } from './delivery-service.js'
import {
  hasAssistantSeenFirstContact,
  markAssistantFirstContactSeen,
  resolveAssistantFirstContactStateDocIds,
} from './first-contact.js'
import { normalizeAssistantDeliveryError } from './outbox.js'
import { normalizeNullableString, normalizeRequiredText } from './shared.js'

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
    subject: z.string().trim().min(1).nullable().optional(),
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

export type AssistantNotificationResponsePolicy =
  | { kind: 'allow_send_or_skip' }
  | { kind: 'require_send' }
  | { kind: 'require_send_exact_text'; text: string }

export interface AssistantNotificationFirstContactPolicy {
  markSeenOnDeliveryAccepted: boolean
}

export interface AssistantNotificationInput
  extends AssistantSessionResolutionFields,
    Pick<
      AssistantMessageInput,
      | 'abortSignal'
      | 'codexCommand'
      | 'deliveryDispatchMode'
      | 'deliveryIdempotencyKey'
      | 'deliveryReplyToMessageId'
      | 'deliverySource'
      | 'deliverySubject'
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
  firstContactPolicy?: AssistantNotificationFirstContactPolicy | null
  instructions: string
  responsePolicy?: AssistantNotificationResponsePolicy | null
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
  const defaults = resolveAssistantExecutionOperatorDefaults({
    defaults: await resolveAssistantOperatorDefaults(),
    executionContext,
  })

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
      const firstContactDocIds = resolveAssistantNotificationFirstContactDocIds({
        input: messageInput,
        session: resolved.session,
        sharedPlan,
      })

      if (
        input.firstContactPolicy?.markSeenOnDeliveryAccepted === true &&
        firstContactDocIds.length > 0 &&
        await hasAssistantSeenFirstContact({
          docIds: firstContactDocIds,
          vault: input.vault,
        })
      ) {
        return {
          decision: {
            kind: 'skip',
            privateSummary: 'First-contact notification already accepted for this route.',
          },
          response: null,
          session: resolved.session,
        }
      }

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
      const responsePolicy: AssistantNotificationResponsePolicy =
        input.responsePolicy ?? { kind: 'allow_send_or_skip' }
      const decision = parseAssistantNotificationDecision(providerResult.response)

      if (decision.kind === 'skip') {
        assertAssistantNotificationSkipAllowed(responsePolicy)
        return {
          decision,
          response: null,
          session: providerResult.session,
        }
      }

      const responseChannel = providerResult.session.binding.channel ?? input.channel ?? null
      const diagnosticsPolicy = resolveAssistantDiagnosticsPolicy({
        channel: responseChannel,
        executionContext,
      })
      const sanitizedResponse = normalizeRequiredText(
        sanitizeAssistantProviderResponseForVisibility({
          channel: responseChannel,
          diagnosticsPolicy,
          response: decision.text,
        }).text,
        'notification response',
      )
      assertAssistantNotificationSendAllowed({
        policy: responsePolicy,
        text: sanitizedResponse,
      })

      const primaryRoute = routes[0] ?? null
      const state = createAssistantRuntimeStateService(input.vault)
      await state.turns.createReceipt({
        sessionId: providerResult.session.sessionId,
        provider: primaryRoute?.provider ?? providerResult.session.provider,
        providerModel:
          primaryRoute?.providerOptions.model
          ?? providerResult.session.providerOptions.model
          ?? null,
        prompt: messageInput.prompt,
        deliveryRequested: true,
        turnId,
      })

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
      const deliveryOutcome = await deliverAssistantNotificationMessage({
        dedupeToken: input.deliveryDedupeToken ?? null,
        decisionSubject: decision.subject ?? null,
        input: messageInput,
        message: sanitizedResponse,
        session: savedSession,
        sharedPlan,
        turnId,
      })
      await finalizeAssistantTurnFromDeliveryOutcome({
        outcome: deliveryOutcome,
        response: sanitizedResponse,
        turnId,
        vault: input.vault,
      })
      if (
        input.firstContactPolicy?.markSeenOnDeliveryAccepted === true &&
        (deliveryOutcome.kind === 'sent' || deliveryOutcome.kind === 'queued')
      ) {
        await markAssistantFirstContactSeen({
          docIds: resolveAssistantNotificationFirstContactDocIds({
            input: messageInput,
            session: deliveryOutcome.session,
            sharedPlan,
          }),
          seenAt: new Date().toISOString(),
          vault: input.vault,
        })
      }
      await state.status.refreshSnapshot()

      if (deliveryOutcome.kind === 'failed') {
        throw deliveryOutcome.error
      }

      return {
        decision: {
          ...decision,
          text: sanitizedResponse,
        },
        response: sanitizedResponse,
        session: deliveryOutcome.session,
      }
    },
  })
}

function buildAssistantNotificationMessageInput(
  input: AssistantNotificationInput,
): AssistantMessageInput {
  const {
    deliveryDedupeToken: _deliveryDedupeToken,
    firstContactPolicy: _firstContactPolicy,
    instructions: _instructions,
    responsePolicy: _responsePolicy,
    ...sessionInput
  } = input

  return {
    ...sessionInput,
    abortSignal: input.abortSignal,
    codexCommand: input.codexCommand,
    deliverResponse: true,
    deliveryDispatchMode: input.deliveryDispatchMode,
    deliveryIdempotencyKey: input.deliveryIdempotencyKey ?? null,
    deliveryReplyToMessageId: input.deliveryReplyToMessageId ?? null,
    deliverySource: input.deliverySource ?? null,
    deliverySubject: input.deliverySubject ?? null,
    deliveryTarget: input.deliveryTarget ?? null,
    executionContext: input.executionContext,
    failoverRoutes: input.failoverRoutes,
    includeFirstTurnCheckIn: false,
    onProviderEvent: input.onProviderEvent ?? null,
    onTraceEvent: input.onTraceEvent,
    operatorAuthority: input.operatorAuthority,
    persistUserPromptOnFailure: false,
    prompt: normalizeRequiredText(input.instructions, 'instructions'),
    receiptMetadata: null,
    showThinkingTraces: input.showThinkingTraces,
    turnTrigger: input.turnTrigger ?? 'automation-cron',
    userMessageContent: null,
    workingDirectory: input.workingDirectory ?? input.vault,
  }
}

async function deliverAssistantNotificationMessage(input: {
  dedupeToken: string | null
  decisionSubject: string | null
  input: AssistantMessageInput
  message: string
  session: AssistantSession
  sharedPlan: Awaited<ReturnType<typeof resolveAssistantTurnSharedPlan>>
  turnId: string
}): Promise<AssistantDeliveryOutcome> {
  const state = createAssistantRuntimeStateService(input.input.vault)
  const audience = input.sharedPlan.conversationPolicy.audience
  const explicitTarget = audience.explicitTarget ?? input.input.deliveryTarget ?? null
  const subject = resolveAssistantNotificationDeliverySubject({
    bindingDelivery: audience.bindingDelivery ?? input.session.binding.delivery,
    channel: audience.channel ?? input.session.binding.channel,
    decisionSubject: input.decisionSubject,
    explicitTarget,
    inputDeliverySubject: input.input.deliverySubject ?? null,
  })
  const outcome = await state.outbox.deliverMessage({
    turnId: input.turnId,
    sessionId: input.session.sessionId,
    message: input.message,
    dedupeToken: input.dedupeToken,
    deliveryIdempotencyKey: input.input.deliveryIdempotencyKey ?? null,
    deliverySource: input.input.deliverySource ?? null,
    channel: audience.channel ?? input.session.binding.channel,
    identityId: audience.identityId ?? input.session.binding.identityId,
    actorId: audience.actorId ?? input.session.binding.actorId,
    threadId: audience.threadId ?? input.session.binding.threadId,
    threadIsDirect: audience.threadIsDirect ?? input.session.binding.threadIsDirect,
    bindingDelivery: audience.bindingDelivery ?? input.session.binding.delivery,
    explicitTarget,
    replyToMessageId:
      audience.replyToMessageId ?? input.input.deliveryReplyToMessageId ?? null,
    subject,
    dispatchMode: input.input.deliveryDispatchMode,
  })

  switch (outcome.kind) {
    case 'sent':
      return {
        kind: 'sent',
        delivery: outcome.delivery,
        intentId: outcome.intent.intentId,
        session: outcome.session ?? input.session,
      }
    case 'queued':
      return {
        kind: 'queued',
        error: outcome.deliveryError,
        intentId: outcome.intent.intentId,
        session: outcome.session ?? input.session,
      }
    case 'failed':
      return {
        kind: 'failed',
        error: outcome.deliveryError,
        intentId: outcome.intent.intentId,
        session: outcome.session ?? input.session,
      }
    default:
      return {
        kind: 'failed',
        error: normalizeAssistantDeliveryError(
          new VaultCliError(
            'ASSISTANT_DELIVERY_FAILED',
            'Assistant outbound delivery did not complete successfully.',
          ),
        ),
        intentId: null,
        session: input.session,
      }
  }
}

function resolveAssistantNotificationFirstContactDocIds(input: {
  input: AssistantMessageInput
  session: AssistantSession
  sharedPlan: Awaited<ReturnType<typeof resolveAssistantTurnSharedPlan>>
}): string[] {
  const audience = input.sharedPlan.conversationPolicy.audience
  return resolveAssistantFirstContactStateDocIds({
    actorId: audience.actorId ?? input.session.binding.actorId,
    channel: audience.channel ?? input.session.binding.channel ?? input.input.channel ?? null,
    identityId: audience.identityId ?? input.session.binding.identityId ?? input.input.identityId ?? null,
    threadId: audience.threadId ?? input.session.binding.threadId ?? input.input.threadId ?? null,
    threadIsDirect:
      audience.threadIsDirect ?? input.session.binding.threadIsDirect ?? input.input.threadIsDirect ?? null,
  })
}

function assertAssistantNotificationSkipAllowed(
  policy: AssistantNotificationResponsePolicy,
): void {
  if (policy.kind === 'allow_send_or_skip') {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_NOTIFICATION_RESPONSE_REQUIRED',
    'Assistant notification turn skipped despite a required send policy.',
  )
}

function assertAssistantNotificationSendAllowed(input: {
  policy: AssistantNotificationResponsePolicy
  text: string
}): void {
  switch (input.policy.kind) {
    case 'allow_send_or_skip':
    case 'require_send':
      return
    case 'require_send_exact_text': {
      if (input.text === input.policy.text) {
        return
      }

      throw new VaultCliError(
        'ASSISTANT_NOTIFICATION_EXACT_TEXT_MISMATCH',
        'Assistant notification turn did not produce the required exact response text.',
      )
    }
  }
}

export function resolveAssistantNotificationDeliverySubject(input: {
  bindingDelivery: AssistantSession['binding']['delivery']
  channel: string | null | undefined
  decisionSubject: string | null | undefined
  explicitTarget: string | null | undefined
  inputDeliverySubject: string | null | undefined
}): string | null {
  const configuredSubject = normalizeNullableString(input.inputDeliverySubject)
  const generatedSubject = normalizeNullableString(input.decisionSubject)
  return normalizeAssistantDeliverySubject({
    bindingDelivery: input.bindingDelivery ?? null,
    channel: input.channel ?? null,
    explicitTarget: input.explicitTarget ?? null,
    subject:
      configuredSubject ??
      (normalizeNullableString(input.channel) === 'email' ? generatedSubject : null),
  })
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

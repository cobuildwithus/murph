import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { resolveAssistantOperatorDefaults } from '@murphai/operator-config/operator-config'

import {
  clearAssistantSessionCodexResumeState,
  persistAssistantTurnAndSession,
} from './turn-finalizer.js'
import {
  executeCodexTurnWithRecovery,
  type AssistantCodexTurnThreadScopeProfile,
} from './codex-turn-runner.js'
import {
  normalizeAssistantExecutionContext,
  resolveAssistantExecutionDefaultTarget,
  resolveAssistantExecutionOperatorDefaults,
} from './execution-context.js'
import {
  deliverAssistantReply,
  finalizeAssistantTurnFromDeliveryOutcome,
} from './delivery-service.js'
import {
  markAssistantOutboxIntentMirrorTerminalById,
} from './outbox.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import {
  resolveAssistantSessionForMessage,
} from './session-resolution.js'
import {
  recordAdditionalAssistantUsageEvents,
  recordAssistantUsageEvent,
} from './service-usage.js'
import { resolveAssistantTurnRoute } from './service-turn-routes.js'
import type {
  AssistantDeliveryOutcome,
  AssistantMessageInput,
} from './service-contracts.js'
import {
  isAssistantSessionNotFoundError,
  getAssistantSessionLocal,
} from './store.js'
import {
  normalizeNullableString,
  normalizeRequiredText,
  warnAssistantBestEffortFailure,
} from './shared.js'
import { resolveAssistantTurnSharedPlan } from './turn-plan.js'
import { createAssistantTurnId } from './turns.js'
import { withAssistantTurnLock } from './turn-lock.js'
import {
  resolveAssistantConversationScope,
  type AssistantConversationScope,
} from './conversation-policy.js'

const ASSISTANT_ASK_CONTINUATION_RECEIPT_PROMPT =
  'assistant.ask.completed continuation'
export const ASSISTANT_ASK_CONTINUATION_CODEX_CONFIG_OVERRIDES = [
  'memories.use_memories=false',
  'memories.generate_memories=false',
  'features.shell_tool=false',
  'web_search="disabled"',
  'features.web_search_request=false',
  'features.standalone_web_search=false',
  'features.apps=false',
  'features.enable_mcp_apps=false',
  'features.browser_use=false',
  'features.plugins=false',
  'features.multi_agent=false',
  'features.multi_agent_v2=false',
  'features.tool_suggest=false',
] as const

export const ASSISTANT_ASK_CONTINUATION_TURN_PROFILE: Required<
  AssistantCodexTurnThreadScopeProfile
> = {
  nativeResumePolicy: 'disabled',
  promptProfile: 'assistant-ask-continuation',
  threadScope: 'isolated-thread',
  toolProfile: 'output-only-turn',
}

export interface AssistantAskContinuationInput
  extends Pick<
    AssistantMessageInput,
    | 'abortSignal'
    | 'answeredMailboxItemIds'
    | 'actorId'
    | 'bindingDeliveryTarget'
    | 'channel'
    | 'conversation'
    | 'deliveryIdempotencyKey'
    | 'deliveryReplyToMessageId'
    | 'deliveryTarget'
    | 'executionContext'
    | 'identityId'
    | 'onProviderEvent'
    | 'onProviderRequestStarted'
    | 'onTraceEvent'
    | 'operatorAuthority'
    | 'outboxExternalThreadRouteAuthority'
    | 'participantId'
    | 'reviewedAssistantAskCompletionExpiresAt'
    | 'serviceTier'
    | 'showThinkingTraces'
    | 'threadId'
    | 'threadIsDirect'
    | 'turnEnvironment'
    | 'vault'
    | 'workingDirectory'
  > {
  canCommit?: (() => boolean | Promise<boolean>) | null
  expectedConversationScope?: Extract<AssistantConversationScope, 'direct' | 'group'>
  instructions: string
  originAssistantInputId: string
  requestId: string
  sessionId: string
}

export type AssistantAskContinuationResult =
  | {
      deliveryOutcome: AssistantDeliveryOutcome
      response: string
      session: AssistantSession
      status: 'completed'
    }
  | {
      session: AssistantSession | null
      status: 'expired' | 'origin_session_unavailable'
    }

export async function readAssistantAskOriginSession(input: {
  sessionId: string
  vault: string
}): Promise<AssistantSession | null> {
  const sessionId = normalizeNullableString(input.sessionId)
  if (!sessionId) {
    return null
  }

  try {
    return await getAssistantSessionLocal(input.vault, sessionId)
  } catch (error) {
    if (isAssistantSessionNotFoundError(error)) {
      return null
    }
    throw error
  }
}

export function buildAssistantAskContinuationMessageInput(
  input: AssistantAskContinuationInput,
): AssistantMessageInput {
  return {
    abortSignal: input.abortSignal,
    ...(input.answeredMailboxItemIds
      ? { answeredMailboxItemIds: input.answeredMailboxItemIds }
      : {}),
    actorId: input.actorId,
    approvalPolicy: 'never',
    bindingDeliveryTarget: input.bindingDeliveryTarget,
    channel: input.channel,
    codexConfigOverrides: ASSISTANT_ASK_CONTINUATION_CODEX_CONFIG_OVERRIDES,
    conversation: input.conversation,
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    deliveryReplyToMessageId: input.deliveryReplyToMessageId ?? null,
    deliverySource: null,
    deliverySubject: null,
    deliveryTarget: input.deliveryTarget,
    executionContext: input.executionContext,
    hostedDeliveryIdempotency: null,
    identityId: input.identityId,
    includeEarlySessionOnboarding: false,
    onProviderEvent: input.onProviderEvent ?? null,
    onProviderRequestStarted: input.onProviderRequestStarted ?? null,
    onTraceEvent: input.onTraceEvent,
    operatorAuthority: input.operatorAuthority,
    ...(input.outboxExternalThreadRouteAuthority
      ? {
          outboxExternalThreadRouteAuthority:
            input.outboxExternalThreadRouteAuthority,
        }
      : {}),
    participantId: input.participantId,
    persistUserPromptOnFailure: false,
    prompt: normalizeRequiredText(input.instructions, 'assistant ask continuation instructions'),
    receiptMetadata: null,
    ...(input.reviewedAssistantAskCompletionExpiresAt
      ? { reviewedAssistantAskCompletionExpiresAt: input.reviewedAssistantAskCompletionExpiresAt }
      : {}),
    sandbox: 'read-only',
    serviceTier: input.serviceTier ?? null,
    sessionId: input.sessionId,
    showThinkingTraces: input.showThinkingTraces,
    suppressProviderFailureTranscriptAudit: true,
    threadId: input.threadId,
    threadIsDirect: input.threadIsDirect,
    turnEnvironment: input.turnEnvironment ?? null,
    turnTrigger: 'automation-auto-reply',
    userMessageContent: null,
    vault: input.vault,
    workingDirectory: input.workingDirectory,
  }
}

export async function sendAssistantAskContinuationLocal(
  input: AssistantAskContinuationInput,
): Promise<AssistantAskContinuationResult> {
  const executionContext = normalizeAssistantExecutionContext(input.executionContext)
  const boundaryDefaultTarget = resolveAssistantExecutionDefaultTarget({
    executionContext,
    fallbackTarget: createDefaultLocalAssistantModelTarget(),
  })
  const defaults = resolveAssistantExecutionOperatorDefaults({
    defaults: await resolveAssistantOperatorDefaults(),
    executionContext,
  })

  return await withAssistantTurnLock({
    abortSignal: input.abortSignal,
    vault: input.vault,
    run: async () => {
      if (!await assistantAskContinuationCanCommit(input)) {
        return {
          session: null,
          status: 'expired',
        }
      }

      const messageInput = buildAssistantAskContinuationMessageInput(input)
      let resolved: Awaited<ReturnType<typeof resolveAssistantSessionForMessage>>
      try {
        resolved = await resolveAssistantSessionForMessage({
          boundaryDefaultTarget,
          defaults,
          message: messageInput,
        })
      } catch (error) {
        if (isAssistantSessionNotFoundError(error)) {
          return {
            session: null,
            status: 'origin_session_unavailable',
          }
        }
        throw error
      }

      const sharedPlan = await resolveAssistantTurnSharedPlan(messageInput, resolved)
      const expectedConversationScope =
        input.expectedConversationScope ?? 'direct'
      if (
        resolveAssistantConversationScope(
          sharedPlan.conversationPolicy.audience,
        ) !== expectedConversationScope
      ) {
        return {
          session: resolved.session,
          status: 'origin_session_unavailable',
        }
      }
      if (!await assistantAskContinuationCanCommit(input)) {
        return {
          session: resolved.session,
          status: 'expired',
        }
      }

      const route = resolveAssistantTurnRoute(messageInput, defaults, resolved)
      const turnId = createAssistantTurnId()
      const turnCreatedAt = new Date().toISOString()
      const providerRequestStarted = messageInput.onProviderRequestStarted ?? null
      const providerOutcome = await executeCodexTurnWithRecovery({
        acceptedInputItems: [],
        allowFinishWithoutReply: false,
        hostedToolContext: null,
        input: messageInput,
        onProviderRequestStarted: providerRequestStarted
          ? (event) => providerRequestStarted({
              acceptedInputIds: [],
              providerRequestOrdinal: event.providerRequestOrdinal ?? 0,
              startedAt: event.startedAt,
            })
          : undefined,
        plan: sharedPlan,
        profile: ASSISTANT_ASK_CONTINUATION_TURN_PROFILE,
        progressDelivery: null,
        resolvedSession: resolved.session,
        route,
        turnCreatedAt,
        turnId,
      })

      if (providerOutcome.kind === 'failed_terminal') {
        const failedProviderResult = {
          attemptCount: providerOutcome.attemptCount,
          provider: providerOutcome.route.provider,
          providerOptions: providerOutcome.route.providerOptions,
          route: providerOutcome.route,
          session: providerOutcome.session,
          usage: providerOutcome.usage,
          usageAttribution: providerOutcome.usageAttribution,
        }
        await recordAssistantUsageEvent({
          executionContext,
          providerRequestOutcome: providerOutcome.providerRequestOutcome,
          providerResult: failedProviderResult,
          turnId,
        })
        await recordAdditionalAssistantUsageEvents({
          additionalUsages: providerOutcome.additionalUsages,
          effectiveEnv: messageInput.turnEnvironment?.env ?? process.env,
          executionContext,
          providerResult: failedProviderResult,
          turnId,
        })
        throw providerOutcome.error
      }

      const providerResult = providerOutcome.providerTurn
      await recordAssistantUsageEvent({
        executionContext,
        providerResult,
        turnId,
      })
      await recordAdditionalAssistantUsageEvents({
        additionalUsages: providerResult.additionalUsages,
        effectiveEnv: messageInput.turnEnvironment?.env ?? process.env,
        executionContext,
        providerResult,
        turnId,
      })
      const response = normalizeRequiredText(
        providerResult.response,
        'assistant ask continuation response',
      )

      if (!await assistantAskContinuationCanCommit(input)) {
        return {
          session: resolved.session,
          status: 'expired',
        }
      }

      const deliveryOutcome = await deliverAssistantReply({
        dedupeToken: input.deliveryIdempotencyKey,
        input: messageInput,
        media: [],
        response,
        session: providerResult.session,
        sharedPlan,
        turnId,
      })
      if (!await guardAssistantAskContinuationDeliveryCommit({
        canCommit: () => assistantAskContinuationCanCommit(input),
        deliveryOutcome,
        vault: input.vault,
      })) {
        return {
          session: resolved.session,
          status: 'expired',
        }
      }
      if (deliveryOutcome.kind === 'failed') {
        throw deliveryOutcome.error
      }

      const state = createAssistantRuntimeStateService(input.vault)
      let committedDeliveryOutcome: AssistantDeliveryOutcome
      try {
        await state.turns.createReceipt({
          deliveryRequested: true,
          metadata: {
            assistantAskOriginInputId: input.originAssistantInputId,
            assistantAskRequestId: input.requestId,
          },
          prompt: ASSISTANT_ASK_CONTINUATION_RECEIPT_PROMPT,
          provider: providerResult.route.provider,
          providerModel:
            providerResult.route.providerOptions.model
            ?? providerResult.session.providerOptions.model
            ?? null,
          sessionId: providerResult.session.sessionId,
          startedAt: turnCreatedAt,
          turnId,
        })
        const savedSession = await persistAssistantTurnAndSession({
          assistantTranscriptText: response,
          input: messageInput,
          persistUserPromptToTranscript: false,
          plan: sharedPlan,
          providerResult,
          providerResumeStateAction: 'preserve-existing',
          session: deliveryOutcome.session,
          turnCreatedAt,
          turnId,
        })
        const continuityResetSession =
          await clearAssistantSessionCodexResumeState({
            session: savedSession,
            vault: input.vault,
          })
        committedDeliveryOutcome = {
          ...deliveryOutcome,
          session: continuityResetSession,
        }
        await finalizeAssistantTurnFromDeliveryOutcome({
          outcome: committedDeliveryOutcome,
          response,
          turnId,
          vault: input.vault,
        })
      } catch (error) {
        await abandonAssistantAskContinuationDelivery({
          deliveryOutcome,
          error,
          vault: input.vault,
        })
        throw error
      }

      await state.status.refreshSnapshot().catch((error) => {
        warnAssistantBestEffortFailure({
          error,
          operation: 'status snapshot refresh',
        })
      })

      return {
        deliveryOutcome: committedDeliveryOutcome,
        response,
        session: committedDeliveryOutcome.session,
        status: 'completed',
      }
    },
  })
}

async function assistantAskContinuationCanCommit(
  input: AssistantAskContinuationInput,
): Promise<boolean> {
  input.abortSignal?.throwIfAborted()
  const canCommit = await input.canCommit?.()
  input.abortSignal?.throwIfAborted()
  return canCommit !== false
}

export async function guardAssistantAskContinuationDeliveryCommit(input: {
  canCommit: () => boolean | Promise<boolean>
  deliveryOutcome: AssistantDeliveryOutcome
  vault: string
}): Promise<boolean> {
  let canCommit: boolean
  try {
    canCommit = await input.canCommit()
  } catch (error) {
    await abandonAssistantAskContinuationDelivery({
      deliveryOutcome: input.deliveryOutcome,
      error,
      vault: input.vault,
    })
    throw error
  }
  if (canCommit) {
    return true
  }
  await abandonAssistantAskContinuationDelivery({
    deliveryOutcome: input.deliveryOutcome,
    error: new Error('Assistant ask continuation expired before commit.'),
    vault: input.vault,
  })
  return false
}

async function abandonAssistantAskContinuationDelivery(input: {
  deliveryOutcome: AssistantDeliveryOutcome
  error: unknown
  vault: string
}): Promise<void> {
  if (input.deliveryOutcome.kind !== 'queued') {
    return
  }

  await markAssistantOutboxIntentMirrorTerminalById({
    error: input.error,
    intentId: input.deliveryOutcome.intentId,
    onlyCurrentStatuses: ['pending', 'retryable', 'awaiting_approval'],
    status: 'abandoned',
    vault: input.vault,
  })
}

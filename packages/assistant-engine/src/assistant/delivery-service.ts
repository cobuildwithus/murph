import type {
  AssistantSession,
} from '../assistant-cli-contracts.js'
import { markAssistantFirstContactSeen } from './first-contact.js'
import { normalizeAssistantDeliveryError } from './outbox.js'
import { sanitizeAssistantOutboundReply } from './reply-sanitizer.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import type {
  AssistantDeliveryOutcome,
  AssistantMessageInput,
  AssistantTurnDeliveryFinalizationPlan,
  AssistantTurnSharedPlan,
} from './service-contracts.js'

export async function deliverAssistantReply(input: {
  input: AssistantMessageInput
  response: string
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}): Promise<AssistantDeliveryOutcome> {
  if (!input.input.deliverResponse) {
    return {
      kind: 'not-requested',
      session: input.session,
    }
  }

  const state = createAssistantRuntimeStateService(input.input.vault)
  const audience = input.sharedPlan.conversationPolicy.audience
  const outcome = await state.outbox.deliverMessage({
    turnId: input.turnId,
    sessionId: input.session.sessionId,
    message: sanitizeAssistantOutboundReply(
      input.response,
      input.session.binding.channel,
    ),
    channel: audience?.channel ?? input.session.binding.channel,
    identityId: audience?.identityId ?? input.session.binding.identityId,
    actorId: audience?.actorId ?? input.session.binding.actorId,
    threadId: audience?.threadId ?? input.session.binding.threadId,
    threadIsDirect: audience?.threadIsDirect ?? input.session.binding.threadIsDirect,
    bindingDelivery: audience?.bindingDelivery ?? input.session.binding.delivery,
    explicitTarget: audience?.explicitTarget ?? input.input.deliveryTarget ?? null,
    replyToMessageId:
      audience?.replyToMessageId ?? input.input.deliveryReplyToMessageId ?? null,
    dependencies: undefined,
    dispatchMode: input.input.deliveryDispatchMode,
  })
  const session = outcome.session ?? input.session

  switch (outcome.kind) {
    case 'sent':
      return {
        kind: 'sent',
        delivery: outcome.delivery!,
        intentId: outcome.intent.intentId,
        session,
      }
    case 'queued':
      return {
        kind: 'queued',
        error: outcome.deliveryError,
        intentId: outcome.intent.intentId,
        session,
      }
    case 'failed':
      return {
        kind: 'failed',
        error: outcome.deliveryError,
        intentId: outcome.intent.intentId,
        session,
      }
    default:
      return {
        kind: 'failed',
        error: normalizeAssistantDeliveryError(
          new Error('Assistant outbound delivery failed.'),
        ),
        intentId: 'unknown',
        session,
      }
  }
}

export async function finalizeAssistantTurnFromDeliveryOutcome(input: {
  firstTurnCheckInInjected?: boolean
  firstTurnCheckInStateDocIds?: readonly string[]
  outcome: AssistantDeliveryOutcome
  response: string
  turnId: string
  vault: string
}): Promise<void> {
  const completedAt = new Date().toISOString()
  const plan = buildAssistantTurnDeliveryFinalizationPlan({
    completedAt,
    outcome: input.outcome,
    response: input.response,
    turnId: input.turnId,
  })
  const state = createAssistantRuntimeStateService(input.vault)
  await state.turns.finalizeReceipt(plan.receipt)
  await state.diagnostics.recordEvent(plan.diagnostic)
  if (input.firstTurnCheckInInjected === true && input.outcome.kind === 'sent') {
    await markAssistantFirstContactSeen({
      docIds: input.firstTurnCheckInStateDocIds ?? [],
      seenAt: completedAt,
      vault: input.vault,
    })
  }
}

export function buildAssistantTurnDeliveryFinalizationPlan(input: {
  completedAt: string
  outcome: AssistantDeliveryOutcome
  response: string
  turnId: string
}): AssistantTurnDeliveryFinalizationPlan {
  switch (input.outcome.kind) {
    case 'not-requested':
      return {
        receipt: {
          turnId: input.turnId,
          status: 'completed',
          deliveryDisposition: 'not-requested',
          response: input.response,
          completedAt: input.completedAt,
        },
        diagnostic: {
          component: 'assistant',
          kind: 'turn.completed',
          message: 'Assistant turn completed without outbound delivery.',
          sessionId: input.outcome.session.sessionId,
          turnId: input.turnId,
          counterDeltas: {
            turnsCompleted: 1,
          },
          at: input.completedAt,
        },
      }
    case 'sent':
      return {
        receipt: {
          turnId: input.turnId,
          status: 'completed',
          deliveryDisposition: 'sent',
          deliveryIntentId: input.outcome.intentId,
          response: input.response,
          completedAt: input.completedAt,
        },
        diagnostic: {
          component: 'assistant',
          kind: 'turn.completed',
          message: 'Assistant turn completed and delivered successfully.',
          sessionId: input.outcome.session.sessionId,
          turnId: input.turnId,
          intentId: input.outcome.intentId,
          counterDeltas: {
            turnsCompleted: 1,
          },
          at: input.completedAt,
        },
      }
    case 'queued':
      return {
        receipt: {
          turnId: input.turnId,
          status: 'deferred',
          deliveryDisposition: input.outcome.error ? 'retryable' : 'queued',
          deliveryIntentId: input.outcome.intentId,
          error: input.outcome.error,
          response: input.response,
          completedAt: input.completedAt,
        },
        diagnostic: {
          component: 'assistant',
          kind: 'turn.deferred',
          level: input.outcome.error ? 'warn' : 'info',
          message:
            input.outcome.error?.message ??
            'Assistant turn deferred with a queued outbound delivery.',
          code: input.outcome.error?.code ?? null,
          sessionId: input.outcome.session.sessionId,
          turnId: input.turnId,
          intentId: input.outcome.intentId,
          counterDeltas: {
            turnsDeferred: 1,
          },
          at: input.completedAt,
        },
      }
    case 'failed':
      return {
        receipt: {
          turnId: input.turnId,
          status: 'failed',
          deliveryDisposition: 'failed',
          deliveryIntentId: input.outcome.intentId,
          error: input.outcome.error,
          response: input.response,
          completedAt: input.completedAt,
        },
        diagnostic: {
          component: 'assistant',
          kind: 'turn.failed',
          level: 'error',
          message: input.outcome.error.message,
          code: input.outcome.error.code,
          sessionId: input.outcome.session.sessionId,
          turnId: input.turnId,
          intentId: input.outcome.intentId,
          counterDeltas: {
            turnsFailed: 1,
          },
          at: input.completedAt,
        },
      }
  }
}

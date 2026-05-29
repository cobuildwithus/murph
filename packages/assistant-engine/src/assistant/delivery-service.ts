import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { markAssistantFirstContactSeen } from './first-contact.js'
import { ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE } from './first-contact-welcome.js'
import { createHostedDeliveryId } from './hosted-delivery-id.js'
import {
  type AssistantOutboxDispatchPayload,
  normalizeAssistantDeliveryError,
  sendAssistantOutboxPayload,
} from './outbox.js'
import type { AssistantChannelDependencies } from './channel-adapters.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import type {
  AssistantDeliveryOutcome,
  AssistantMessageInput,
  AssistantTurnDeliveryFinalizationPlan,
  AssistantTurnSharedPlan,
} from './service-contracts.js'
import { normalizeNullableString } from './shared.js'

export function resolveHostedAssistantDeliveryTransportIdempotentOverride(input: {
  channel?: string | null
  deliveryIdempotencyKey?: string | null
  executionContext?: AssistantMessageInput['executionContext']
}): boolean | undefined {
  if (!input.executionContext?.hosted) {
    return undefined
  }
  if (!input.deliveryIdempotencyKey?.trim()) {
    return false
  }

  const channel = input.channel?.trim().toLowerCase()
  return channel === 'linq'
}

export function resolveAssistantHostedDeliveryIdempotency(input: {
  audience: AssistantTurnSharedPlan['conversationPolicy']['audience']
  channel?: string | null
  input: AssistantMessageInput
  session: AssistantSession
}): {
  deliveryIdempotencyKey: string | null
  deliveryTransportIdempotent: boolean | undefined
} {
  const explicitKey = normalizeNullableString(input.input.deliveryIdempotencyKey)
  const hosted = input.input.executionContext?.hosted ?? null
  const channel = normalizeNullableString(input.channel)?.toLowerCase() ?? null

  if (!hosted) {
    return {
      deliveryIdempotencyKey: explicitKey,
      deliveryTransportIdempotent: undefined,
    }
  }

  const deliveryIdempotencyKey =
    explicitKey ??
    createHostedDeliveryIdempotencyKeyFromContext({
      audience: input.audience,
      channel,
      input: input.input,
      memberId: hosted.memberId,
      session: input.session,
    })

  if (!deliveryIdempotencyKey && hostedDeliveryChannelRequiresIdempotencyKey(channel)) {
    throw new VaultCliError(
      'ASSISTANT_HOSTED_DELIVERY_IDEMPOTENCY_KEY_REQUIRED',
      'Hosted outbound delivery requires a deterministic idempotency key.',
    )
  }

  return {
    deliveryIdempotencyKey,
    deliveryTransportIdempotent:
      resolveHostedAssistantDeliveryTransportIdempotentOverride({
        channel,
        deliveryIdempotencyKey,
        executionContext: input.input.executionContext,
      }),
  }
}

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

  const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
    input: input.input,
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  const hostedDelivery = resolveAssistantHostedDeliveryIdempotency({
    audience: input.sharedPlan.conversationPolicy.audience,
    channel: deliveryFields.channel,
    input: input.input,
    session: input.session,
  })

  return await deliverAssistantCurrentAudienceMessage({
    deliveryIdempotencyKey: hostedDelivery.deliveryIdempotencyKey,
    deliveryTransportIdempotent: hostedDelivery.deliveryTransportIdempotent,
    input: input.input,
    message: input.response,
    session: input.session,
    sharedPlan: input.sharedPlan,
    turnId: input.turnId,
  })
}

export async function deliverAssistantProgressUpdate(input: {
  dependencies?: AssistantChannelDependencies
  input: AssistantMessageInput
  ordinal: number
  session: AssistantSession
  signal?: AbortSignal
  sharedPlan: AssistantTurnSharedPlan
  text: string
  turnId: string
}): Promise<void> {
  // Progress updates are ephemeral current-audience sends, not final-reply
  // delivery or commit-aware outbox decisions.
  if (!input.input.deliverResponse) {
    return
  }

  const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
    input: input.input,
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  const deliveryIdempotencyKey = buildAssistantProgressDeliveryIdempotencyKey({
    deliveryIdempotencyKey: resolveAssistantHostedDeliveryIdempotency({
      audience: input.sharedPlan.conversationPolicy.audience,
      channel: deliveryFields.channel,
      input: input.input,
      session: input.session,
    }).deliveryIdempotencyKey,
    ordinal: input.ordinal,
    turnId: input.turnId,
  })

  await sendAssistantOutboxPayload({
    ...(input.dependencies ? { dependencies: input.dependencies } : {}),
    payload: {
      ...deliveryFields,
      deliveryIdempotencyKey,
      message: input.text,
      turnId: input.turnId,
    },
    vault: input.input.vault,
    signal: input.signal,
  })
}

export function buildAssistantProgressDeliveryIdempotencyKey(input: {
  deliveryIdempotencyKey?: string | null
  ordinal: number
  turnId: string
}): string {
  const explicitKey = normalizeNullableString(input.deliveryIdempotencyKey)
  if (explicitKey) {
    return `${explicitKey}:progress:${input.ordinal}`
  }

  return `assistant-progress:${input.turnId}:${input.ordinal}`
}

type AssistantCurrentAudienceDeliveryFields = Pick<
  AssistantOutboxDispatchPayload,
  | 'actorId'
  | 'bindingDelivery'
  | 'channel'
  | 'deliverySource'
  | 'explicitTarget'
  | 'identityId'
  | 'replyToMessageId'
  | 'sessionId'
  | 'subject'
  | 'threadId'
  | 'threadIsDirect'
>

function resolveAssistantCurrentAudienceDeliveryFields(input: {
  input: AssistantMessageInput
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): AssistantCurrentAudienceDeliveryFields {
  const audience = input.sharedPlan.conversationPolicy.audience
  return {
    actorId: audience?.actorId ?? input.session.binding.actorId,
    bindingDelivery: audience?.bindingDelivery ?? input.session.binding.delivery,
    channel: audience?.channel ?? input.session.binding.channel,
    deliverySource: input.input.deliverySource ?? null,
    explicitTarget: audience?.explicitTarget ?? input.input.deliveryTarget ?? null,
    identityId: audience?.identityId ?? input.session.binding.identityId,
    replyToMessageId:
      input.input.deliveryReplyToMessageId ?? audience?.replyToMessageId ?? null,
    sessionId: input.session.sessionId,
    subject: input.input.deliverySubject ?? null,
    threadId: audience?.threadId ?? input.session.binding.threadId,
    threadIsDirect: audience?.threadIsDirect ?? input.session.binding.threadIsDirect,
  }
}

async function deliverAssistantCurrentAudienceMessage(input: {
  deliveryIdempotencyKey: string | null
  deliveryTransportIdempotent: boolean | undefined
  input: AssistantMessageInput
  message: string
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
  const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
    input: input.input,
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  const outcome = await state.outbox.deliverMessage({
    ...deliveryFields,
    message: input.message,
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    deliveryTransportIdempotent: input.deliveryTransportIdempotent,
    turnId: input.turnId,
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

function createHostedDeliveryIdempotencyKeyFromContext(input: {
  audience: AssistantTurnSharedPlan['conversationPolicy']['audience']
  channel: string | null
  input: AssistantMessageInput
  memberId: string
  session: AssistantSession
}): string | null {
  const context = input.input.hostedDeliveryIdempotency
  const channel = normalizeNullableString(input.channel)
  const memberId = normalizeNullableString(input.memberId)
  const inboundMailboxItemIds =
    context?.inboundMailboxItemIds
      ?.map((itemId) => normalizeNullableString(itemId))
      .filter((itemId): itemId is string => itemId !== null) ?? []
  const assistantTurnOrdinal =
    typeof context?.assistantTurnOrdinal === 'number' ||
    typeof context?.assistantTurnOrdinal === 'string'
      ? context.assistantTurnOrdinal
      : null

  if (!channel || !memberId || inboundMailboxItemIds.length === 0 || assistantTurnOrdinal === null) {
    return null
  }

  return createHostedDeliveryId({
    assistantTurnOrdinal,
    channel,
    conversationId:
      normalizeNullableString(context?.conversationId) ??
      stringifyHostedDeliveryIdempotencyKeyParts([
        channel,
        input.audience?.identityId ?? input.session.binding.identityId,
        input.audience?.actorId ?? input.session.binding.actorId,
        input.audience?.threadId ?? input.session.binding.threadId,
        input.audience?.threadIsDirect ?? input.session.binding.threadIsDirect,
      ]),
    inboundMailboxItemIds,
    recipientKey:
      normalizeNullableString(context?.recipientKey) ??
      stringifyHostedDeliveryIdempotencyKeyParts([
        channel,
        input.audience?.explicitTarget ?? input.input.deliveryTarget ?? null,
        input.audience?.bindingDelivery?.target ?? input.session.binding.delivery?.target,
        input.audience?.identityId ?? input.session.binding.identityId,
        input.audience?.actorId ?? input.session.binding.actorId,
        input.audience?.threadId ?? input.session.binding.threadId,
      ]),
    userId: memberId,
  })
}

function hostedDeliveryChannelRequiresIdempotencyKey(channel: string | null): boolean {
  return channel === 'linq' || channel === 'email'
}

function stringifyHostedDeliveryIdempotencyKeyParts(
  parts: readonly (boolean | null | string | undefined)[],
): string {
  return JSON.stringify(parts.map((part) => part ?? null))
}

export async function finalizeAssistantTurnFromDeliveryOutcome(input: {
  firstContactGuidanceInjected?: boolean
  firstContactStateDocIds?: readonly string[]
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
  const firstContactAcceptedForDelivery =
    input.firstContactGuidanceInjected === true &&
    input.response === ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE &&
    isAssistantFirstContactAcceptedForDelivery(input.outcome)
  if (firstContactAcceptedForDelivery) {
    await markAssistantFirstContactSeen({
      docIds: input.firstContactStateDocIds ?? [],
      seenAt: completedAt,
      vault: input.vault,
    })
  }
}

function isAssistantFirstContactAcceptedForDelivery(
  outcome: AssistantDeliveryOutcome,
): boolean {
  return (
    outcome.kind === 'sent' ||
    outcome.kind === 'queued' ||
    outcome.kind === 'not-requested'
  )
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

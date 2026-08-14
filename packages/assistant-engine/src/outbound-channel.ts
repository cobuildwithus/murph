import {
  assistantDeliverResultSchema,
  type AssistantChannelDelivery,
  type AssistantDeliverResult,
  type AssistantDeliverySource,
  type AssistantResponseMedia,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  getAssistantChannelAdapter,
  normalizeAssistantDeliverySubject,
  resolveDeliveryCandidates,
  sendLinqMessage,
  sendLinqVoiceMemoMessage,
  sendTelegramMessage,
  sendTelegramVoiceMemoMessage,
  type AssistantChannelDependencies,
} from './assistant/channel-adapters.js'
import {
  createAssistantBinding,
  mergeAssistantBinding,
} from './assistant/bindings.js'
import type { ConversationRef } from './assistant/conversation-ref.js'
import {
  deliverAssistantOutboxMessage,
  normalizeAssistantDeliveryError,
} from './assistant/outbox.js'
import {
  createAssistantTurnReceipt,
} from './assistant/turns.js'
import {
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
} from './assistant/store.js'
import { redactAssistantSessionForDisplay } from './assistant/redaction.js'
import {
  normalizeNullableString,
  normalizeRequiredText,
  warnAssistantBestEffortFailure,
} from './assistant/shared.js'
import type {
  AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export {
  sendLinqMessage,
  sendLinqVoiceMemoMessage,
  sendTelegramMessage,
  sendTelegramVoiceMemoMessage,
}

export interface DeliverAssistantMessageInput {
  actorId?: string | null
  alias?: string | null
  channel?: string | null
  card?: AssistantResponseCard | null
  conversation?: ConversationRef | null
  identityId?: string | null
  media?: readonly AssistantResponseMedia[] | null
  message: string
  nativeReplyRequested?: true
  participantId?: string | null
  replyToMessageId?: string | null
  sessionId?: string | null
  target?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
}

export interface DeliverAssistantMessageOverBindingResult {
  delivery: AssistantChannelDelivery
  deliveryDeduplicated: boolean
  deliveryTransportIdempotent?: boolean
  outboxIntentId: string | null
  session?: AssistantSession
}

export async function deliverAssistantMessage(
  input: DeliverAssistantMessageInput,
  dependencies: AssistantChannelDependencies = {},
): Promise<AssistantDeliverResult> {
  const normalizedMessage = normalizeRequiredText(input.message, 'message')
  const explicitTarget = input.target?.trim() ? input.target.trim() : null
  const resolved = await resolveAssistantSession(
    buildDeliverAssistantSessionInput(input),
  )
  const receipt = await createAssistantTurnReceipt({
    vault: input.vault,
    sessionId: resolved.session.sessionId,
    provider: resolved.session.provider,
    providerModel: resolved.session.providerOptions.model ?? null,
    prompt: normalizedMessage,
    deliveryRequested: true,
  })
  let deliveryIntentId: string | null = null
  try {
    const outcome = await deliverAssistantOutboxMessage({
      vault: input.vault,
      turnId: receipt.turnId,
      sessionId: resolved.session.sessionId,
      card: input.card ?? null,
      media: input.media ?? [],
      message: normalizedMessage,
      ...(input.nativeReplyRequested === true ? { nativeReplyRequested: true } : {}),
      channel: resolved.session.binding.channel,
      identityId: resolved.session.binding.identityId,
      actorId: resolved.session.binding.actorId,
      threadId: resolved.session.binding.threadId,
      threadIsDirect: resolved.session.binding.threadIsDirect,
      replyToMessageId: input.replyToMessageId ?? null,
      bindingDelivery: resolved.session.binding.delivery ?? undefined,
      explicitTarget: explicitTarget ?? null,
      dependencies,
    })
    deliveryIntentId = outcome.intent.intentId

    if (outcome.kind !== 'sent' || !outcome.delivery) {
      throw attachAssistantOutboxIntentId(
        outcome.deliveryError ??
          new VaultCliError(
            'ASSISTANT_DELIVERY_FAILED',
            'Assistant outbound delivery did not complete successfully.',
          ),
        outcome.intent.intentId,
      )
    }

    const delivery = outcome.delivery
    const updatedSession =
      outcome.session ??
      (await saveAssistantSession(input.vault, {
        ...resolved.session,
        binding: resolvePersistedBinding(
          resolved.session.binding,
          delivery,
          explicitTarget,
        ),
        updatedAt: delivery.sentAt,
        lastTurnAt: delivery.sentAt,
      }))

    return assistantDeliverResultSchema.parse({
      vault: redactAssistantDisplayPath(input.vault),
      message: normalizedMessage,
      session: redactAssistantSessionForDisplay(updatedSession),
      media: outcome.intent.media ?? [],
      delivery,
    })
  } catch (error) {
    const deliveryError = normalizeAssistantDeliveryError(error)
    await dispatchAssistantFallbackReceiptFailure({
      vault: input.vault,
      turnId: receipt.turnId,
      error: deliveryError,
      outboxIntentId: deliveryIntentId,
    })
    throw error
  }
}

function buildDeliverAssistantSessionInput(
  input: DeliverAssistantMessageInput,
): Parameters<typeof resolveAssistantSession>[0] {
  const sessionInput = {
    vault: input.vault,
  } as Parameters<typeof resolveAssistantSession>[0]

  if ('sessionId' in input) {
    sessionInput.sessionId = input.sessionId
  }
  if ('alias' in input) {
    sessionInput.alias = input.alias
  }
  if ('channel' in input) {
    sessionInput.channel = input.channel
  }
  if ('identityId' in input) {
    sessionInput.identityId = input.identityId
  }
  if ('actorId' in input) {
    sessionInput.actorId = input.actorId
  }
  if ('participantId' in input) {
    sessionInput.participantId = input.participantId
  }
  if ('threadId' in input) {
    sessionInput.threadId = input.threadId
  }
  if ('threadIsDirect' in input) {
    sessionInput.threadIsDirect = input.threadIsDirect
  }
  if ('conversation' in input) {
    sessionInput.conversation = input.conversation
  }

  return sessionInput
}

function resolvePersistedBinding(
  binding: AssistantSession['binding'],
  delivery: AssistantChannelDelivery,
  explicitTarget: string | null,
): AssistantSession['binding'] {
  if (explicitTarget) {
    return mergeAssistantBinding(binding, {
      channel: delivery.channel,
    })
  }

  if (
    binding.delivery === null &&
    (delivery.targetKind === 'thread' || delivery.targetKind === 'participant')
  ) {
    const promoteThreadToAssistantIdentity =
      delivery.targetKind === 'thread' &&
      shouldRetargetThreadDeliveryAsAssistantIdentity({
        currentDeliveryTarget: delivery.target,
        currentThreadId: binding.threadId,
      })
    return mergeAssistantBinding(binding, {
      channel: delivery.channel,
      deliveryKind: delivery.targetKind,
      deliveryTarget: delivery.target,
      ...(promoteThreadToAssistantIdentity ? { threadId: delivery.target } : {}),
    })
  }

  if (
    binding.delivery?.kind === 'thread' &&
    delivery.targetKind === 'thread' &&
    (binding.threadId !== delivery.target || binding.delivery.target !== delivery.target)
  ) {
    const promoteThreadToAssistantIdentity =
      shouldRetargetThreadDeliveryAsAssistantIdentity({
        currentDeliveryTarget: binding.delivery.target,
        currentThreadId: binding.threadId,
      })
    return mergeAssistantBinding(binding, {
      channel: delivery.channel,
      deliveryKind: 'thread',
      deliveryTarget: delivery.target,
      ...(promoteThreadToAssistantIdentity ? { threadId: delivery.target } : {}),
    })
  }

  if (
    binding.delivery?.kind === 'participant' &&
    delivery.targetKind === 'thread'
  ) {
    const promoteThreadToAssistantIdentity =
      shouldPromoteMaterializedThreadToAssistantIdentity({
        bindingDeliveryTarget: binding.delivery.target,
        currentActorId: binding.actorId,
      })
    return mergeAssistantBinding(binding, {
      channel: delivery.channel,
      deliveryKind: 'thread',
      deliveryTarget: delivery.target,
      ...(promoteThreadToAssistantIdentity ? { threadId: delivery.target } : {}),
      threadIsDirect: binding.threadIsDirect ?? true,
    })
  }

  if (
    binding.delivery?.kind === 'participant' &&
    delivery.targetKind === 'participant' &&
    binding.delivery.target !== delivery.target
  ) {
    return mergeAssistantBinding(binding, {
      channel: delivery.channel,
      deliveryKind: 'participant',
      deliveryTarget: delivery.target,
    })
  }

  return mergeAssistantBinding(binding, {
    channel: delivery.channel,
  })
}

function shouldPromoteMaterializedThreadToAssistantIdentity(input: {
  bindingDeliveryTarget: string | null | undefined
  currentActorId: string | null | undefined
}): boolean {
  const actorId = normalizeNullableString(input.currentActorId)
  const deliveryTarget = normalizeNullableString(input.bindingDeliveryTarget)
  return actorId !== null && actorId === deliveryTarget
}

function shouldRetargetThreadDeliveryAsAssistantIdentity(input: {
  currentDeliveryTarget: string | null | undefined
  currentThreadId: string | null | undefined
}): boolean {
  const threadId = normalizeNullableString(input.currentThreadId)
  const deliveryTarget = normalizeNullableString(input.currentDeliveryTarget)
  return threadId !== null && threadId === deliveryTarget
}

export async function deliverAssistantMessageOverBinding(
  input: {
    actorId?: string | null
    answeredMailboxItemIds?: readonly string[] | null
    channel?: string | null
    card?: AssistantResponseCard | null
    deliverySource?: AssistantDeliverySource | null
    idempotencyKey?: string | null
    identityId?: string | null
    media?: readonly AssistantResponseMedia[] | null
    message: string
    nativeReplyRequested?: true
    replyToMessageId?: string | null
    subject?: string | null
    sessionId?: string | null
    session?: Pick<AssistantSession, 'binding'>
    target?: string | null
    threadId?: string | null
    threadIsDirect?: boolean | null
    vault?: string
  },
  dependencies: AssistantChannelDependencies = {},
): Promise<DeliverAssistantMessageOverBindingResult> {
  const binding =
    input.session?.binding ??
    createAssistantBinding({
      actorId: input.actorId,
      channel: input.channel,
      identityId: input.identityId,
      threadId: input.threadId,
      threadIsDirect: input.threadIsDirect,
    })
  const channel = binding.channel?.trim() || null
  if (!channel) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_REQUIRED',
      'Outbound delivery requires a mapped channel. Pass --channel or resume a session with channel metadata.',
    )
  }

  const adapter = getAssistantChannelAdapter(channel)
  if (!adapter) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_UNSUPPORTED',
      `Outbound delivery for channel "${channel}" is not supported in this build.`,
    )
  }

  const explicitTarget = input.target?.trim() ? input.target.trim() : null
  const subject = normalizeAssistantDeliverySubject({
    bindingDelivery: binding.delivery,
    channel,
    explicitTarget,
    subject: input.subject ?? null,
  })

  resolveDeliveryCandidates({
    bindingDelivery: binding.delivery,
    explicitTarget,
  })[0]

  const delivery = await adapter.send(
    {
      actorId: binding.actorId,
      answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
      bindingDelivery: binding.delivery,
      card: input.card ?? null,
      deliverySource: input.deliverySource ?? null,
      explicitTarget,
      idempotencyKey: input.idempotencyKey ?? null,
      identityId: binding.identityId,
      media: input.media ?? [],
      message: input.message,
      ...(input.nativeReplyRequested === true ? { nativeReplyRequested: true } : {}),
      replyToMessageId: input.replyToMessageId ?? null,
      subject,
      threadIsDirect: binding.threadIsDirect,
    },
    dependencies,
  )

  return {
    delivery,
    deliveryDeduplicated: false,
    deliveryTransportIdempotent:
      adapter.resolveDeliveryTransportIdempotent?.({
        media: input.media ?? [],
        message: input.message,
      }) ?? adapter.supportsIdempotencyKey,
    outboxIntentId: null,
  }
}

async function dispatchAssistantFallbackReceiptFailure(input: {
  error: ReturnType<typeof normalizeAssistantDeliveryError>
  outboxIntentId?: string | null
  turnId: string
  vault: string
}): Promise<void> {
  const {
    appendAssistantTurnReceiptEvent,
    updateAssistantTurnReceipt,
  } = await import(
    './assistant/turns.js'
  )
  if (input.outboxIntentId) {
    const { readAssistantOutboxIntent } = await import('./assistant/outbox.js')
    const intent = await readAssistantOutboxIntent(
      input.vault,
      input.outboxIntentId,
    ).catch(() => null)
    if (intent && intent.status !== 'failed') {
      return
    }
  }

  const failedAt = new Date().toISOString()
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'delivery.failed',
    detail: input.error.message,
    metadata: {},
    at: failedAt,
  }).catch((error) => {
    warnAssistantBestEffortFailure({
      error,
      operation: 'delivery failure receipt append',
    })
  })
  await updateAssistantTurnReceipt({
    vault: input.vault,
    turnId: input.turnId,
    mutate(receipt) {
      return {
        ...receipt,
        updatedAt: failedAt,
        completedAt: failedAt,
        status: 'failed',
        deliveryDisposition: 'failed',
        lastError: input.error,
      }
    },
  }).catch((error) => {
    warnAssistantBestEffortFailure({
      error,
      operation: 'delivery failure receipt update',
    })
  })
}

function attachAssistantOutboxIntentId(error: unknown, outboxIntentId: string | null) {
  if (
    outboxIntentId === null ||
    typeof error !== 'object' ||
    error === null
  ) {
    return error
  }

  try {
    Object.defineProperty(error, 'outboxIntentId', {
      configurable: true,
      enumerable: false,
      value: outboxIntentId,
      writable: true,
    })
  } catch (defineError) {
    warnAssistantBestEffortFailure({
      error: defineError,
      operation: 'delivery error outbox-intent decoration',
    })
  }

  return error
}

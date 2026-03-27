import {
  assistantDeliverResultSchema,
  type AssistantChannelDelivery,
  type AssistantDeliverResult,
  type AssistantSession,
} from './assistant-cli-contracts.js'
import {
  getAssistantChannelAdapter,
  resolveDeliveryCandidates,
  resolveImessageDeliveryCandidates,
  sendEmailMessage,
  sendImessageMessage,
  sendLinqMessage,
  sendTelegramMessage,
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
import { normalizeRequiredText } from './assistant/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

export {
  sendEmailMessage,
  resolveImessageDeliveryCandidates,
  sendImessageMessage,
  sendLinqMessage,
  sendTelegramMessage,
}

export interface DeliverAssistantMessageInput {
  actorId?: string | null
  alias?: string | null
  channel?: string | null
  conversation?: ConversationRef | null
  identityId?: string | null
  message: string
  participantId?: string | null
  sessionId?: string | null
  sourceThreadId?: string | null
  target?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
}

export interface DeliverAssistantMessageOverBindingResult {
  delivery: AssistantChannelDelivery
  deliveryDeduplicated: boolean
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
      message: normalizedMessage,
      channel: resolved.session.binding.channel,
      identityId: resolved.session.binding.identityId,
      actorId: resolved.session.binding.actorId,
      threadId: resolved.session.binding.threadId,
      threadIsDirect: resolved.session.binding.threadIsDirect,
      bindingDelivery: resolved.session.binding.delivery,
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
      session: updatedSession,
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
  if ('sourceThreadId' in input) {
    sessionInput.sourceThreadId = input.sourceThreadId
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
    binding.delivery?.kind === 'thread' &&
    delivery.targetKind === 'thread' &&
    (binding.threadId !== delivery.target || binding.delivery.target !== delivery.target)
  ) {
    return mergeAssistantBinding(binding, {
      channel: delivery.channel,
      threadId: delivery.target,
      deliveryKind: 'thread',
      deliveryTarget: delivery.target,
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

export async function deliverAssistantMessageOverBinding(
  input: {
    actorId?: string | null
    channel?: string | null
    identityId?: string | null
    message: string
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
  resolveDeliveryCandidates({
    bindingDelivery: binding.delivery,
    explicitTarget,
  })[0]

  const delivery = await adapter.send(
    {
      bindingDelivery: binding.delivery,
      explicitTarget,
      identityId: binding.identityId,
      message: input.message,
    },
    dependencies,
  )

  return {
    delivery,
    deliveryDeduplicated: false,
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
  }).catch(() => undefined)
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
  }).catch(() => undefined)
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
  } catch {}

  return error
}

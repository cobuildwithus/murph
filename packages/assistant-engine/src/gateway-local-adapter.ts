import {
  deliverAssistantOutboxMessage,
  listAssistantOutboxIntents,
} from './assistant/outbox.js'
import { listAssistantSessions } from './assistant/store.js'
import type {
  GatewayLocalMessageSender,
  GatewayLocalProjectionSourceReader,
} from '@murphai/gateway-core'

export const assistantGatewayLocalProjectionSourceReader: GatewayLocalProjectionSourceReader = {
  async listOutboxSources(vault) {
    return listAssistantOutboxIntents(vault)
  },
  async listSessionSources(vault) {
    return listAssistantSessions(vault)
  },
}

export const assistantGatewayLocalMessageSender: GatewayLocalMessageSender = {
  async deliver(input) {
    const delivered = await deliverAssistantOutboxMessage({
      actorId: input.actorId,
      bindingDelivery: input.bindingDelivery,
      channel: input.channel,
      dedupeToken: input.dedupeToken,
      deliveryIdempotencyKey: input.deliveryIdempotencyKey,
      dispatchMode: input.dispatchMode,
      identityId: input.identityId,
      message: input.message,
      replyToMessageId: input.replyToMessageId,
      sessionId: input.sessionId,
      threadId: input.threadId,
      threadIsDirect: input.threadIsDirect,
      turnId: input.turnId,
      vault: input.vault,
    })

    return {
      delivery: delivered.delivery
        ? {
            channel: delivered.delivery.channel,
            idempotencyKey: delivered.delivery.idempotencyKey ?? null,
            messageLength: delivered.delivery.messageLength,
            sentAt: delivered.delivery.sentAt,
            target: delivered.delivery.target,
            targetKind: delivered.delivery.targetKind,
          }
        : null,
      deliveryErrorMessage: delivered.deliveryError?.message ?? null,
      intentId: delivered.intent.intentId,
      kind: delivered.kind,
    }
  },
}

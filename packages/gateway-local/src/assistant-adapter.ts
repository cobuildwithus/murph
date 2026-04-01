/**
 * Explicit assistant-core adapter seam for gateway-local. This keeps the local
 * projection store and send path focused on gateway behavior instead of pulling
 * assistant-core types and delivery calls directly into those modules.
 */

import {
  deliverAssistantOutboxMessage,
  listAssistantOutboxIntents,
  listAssistantSessions,
  type AssistantOutboxDispatchMode,
  type AssistantOutboxIntent,
  type AssistantSession,
} from '@murph/assistant-core'
import type { GatewayReplyRouteKind } from '@murph/gateway-core'

export type GatewayLocalDispatchMode = AssistantOutboxDispatchMode

export type GatewayLocalSessionSource = Pick<
  AssistantSession,
  'alias' | 'binding' | 'sessionId' | 'updatedAt'
>

export type GatewayLocalOutboxSource = Pick<
  AssistantOutboxIntent,
  | 'actorId'
  | 'bindingDelivery'
  | 'channel'
  | 'createdAt'
  | 'delivery'
  | 'identityId'
  | 'intentId'
  | 'message'
  | 'replyToMessageId'
  | 'sentAt'
  | 'status'
  | 'threadId'
  | 'threadIsDirect'
  | 'updatedAt'
>

export interface GatewayLocalProjectionSourceReader {
  listOutboxSources(vault: string): Promise<GatewayLocalOutboxSource[]>
  listSessionSources(vault: string): Promise<GatewayLocalSessionSource[]>
}

export interface GatewayLocalDeliveredMessage {
  channel: string
  idempotencyKey: string | null
  messageLength: number
  sentAt: string
  target: string
  targetKind: 'explicit' | 'participant' | 'thread'
}

export interface GatewayLocalMessageSendRequest {
  actorId?: string | null
  bindingDelivery: {
    kind: GatewayReplyRouteKind
    target: string
  }
  channel?: string | null
  dedupeToken?: string | null
  deliveryIdempotencyKey?: string | null
  dispatchMode?: GatewayLocalDispatchMode
  identityId?: string | null
  message: string
  replyToMessageId?: string | null
  sessionId: string
  threadId?: string | null
  threadIsDirect?: boolean | null
  turnId: string
  vault: string
}

export interface GatewayLocalMessageSendResult {
  delivery: GatewayLocalDeliveredMessage | null
  deliveryErrorMessage: string | null
  intentId: string
  kind: 'failed' | 'queued' | 'sent'
}

export interface GatewayLocalMessageSender {
  deliver(input: GatewayLocalMessageSendRequest): Promise<GatewayLocalMessageSendResult>
}

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

import type {
  GatewayDeliveryTargetKind,
  GatewayReplyRouteKind,
} from './contracts.js'

export type GatewayLocalDispatchMode = 'immediate' | 'queue-only'
export type GatewayLocalOutboxStatus =
  | 'pending'
  | 'sending'
  | 'retryable'
  | 'sent'
  | 'failed'
  | 'abandoned'

export interface GatewayLocalSessionSource {
  alias: string | null
  binding: {
    conversationKey: string | null
    channel: string | null
    identityId: string | null
    actorId: string | null
    threadId: string | null
    threadIsDirect: boolean | null
    delivery: {
      kind: GatewayReplyRouteKind
      target: string
    } | null
  }
  sessionId: string
  updatedAt: string
}

export interface GatewayLocalOutboxSource {
  actorId: string | null
  bindingDelivery: {
    kind: GatewayReplyRouteKind
    target: string
  } | null
  channel: string | null
  createdAt: string
  delivery: {
    channel: string
    idempotencyKey: string | null
    messageLength: number
    providerMessageId: string | null
    providerThreadId: string | null
    sentAt: string
    target: string
    targetKind: GatewayDeliveryTargetKind
  } | null
  identityId: string | null
  intentId: string
  message: string
  replyToMessageId: string | null
  sentAt: string | null
  status: GatewayLocalOutboxStatus
  threadId: string | null
  threadIsDirect: boolean | null
  updatedAt: string
}

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
  targetKind: GatewayDeliveryTargetKind
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

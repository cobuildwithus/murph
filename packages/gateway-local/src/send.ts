import { randomUUID } from 'node:crypto'

import {
  createGatewayInvalidRuntimeIdError,
  createGatewayOutboxMessageId,
  createGatewaySessionNotFoundError,
  createGatewayUnsupportedOperationError,
  gatewayBindingDeliveryFromRoute,
  gatewayChannelSupportsReplyToMessage,
  gatewaySendMessageInputSchema,
  gatewaySendMessageResultSchema,
  getGatewayConversationFromSnapshot,
  readGatewayConversationSessionToken,
  readGatewayMessageRouteToken,
  type GatewaySendMessageInput,
  type GatewaySendMessageResult,
} from '@murphai/gateway-core'
import {
  assistantGatewayLocalMessageSender,
  type GatewayLocalDispatchMode,
  type GatewayLocalMessageSender,
  type GatewayLocalProjectionSourceReader,
} from './assistant-adapter.js'
import { LocalGatewayProjectionStore } from './store.js'

export async function sendGatewayMessageLocal(input: {
  dispatchMode?: GatewayLocalDispatchMode
  messageSender?: GatewayLocalMessageSender
  sourceReader?: GatewayLocalProjectionSourceReader
  vault: string
} & GatewaySendMessageInput): Promise<GatewaySendMessageResult> {
  const {
    dispatchMode,
    messageSender = assistantGatewayLocalMessageSender,
    sourceReader,
    vault,
    ...gatewayInput
  } = input
  const parsed = gatewaySendMessageInputSchema.parse(gatewayInput)
  const routeToken = readGatewayConversationSessionTokenOrThrow(parsed.sessionKey)
  const store = new LocalGatewayProjectionStore(vault, {
    sourceReader,
  })

  try {
    const snapshot = await store.syncAndReadSnapshot()

    const conversation = getGatewayConversationFromSnapshot(snapshot, {
      sessionKey: parsed.sessionKey,
    })

    if (!conversation) {
      throw createGatewaySessionNotFoundError(
        `Gateway session ${parsed.sessionKey} was not found.`,
      )
    }
    if (!conversation.canSend) {
      throw createGatewayUnsupportedOperationError(
        `Gateway session ${parsed.sessionKey} does not have a routable reply target.`,
      )
    }

    const deliveryReplyToMessageId = await resolveGatewayReplyToMessageIdLocal({
      channel: conversation.route.channel,
      replyToMessageId: parsed.replyToMessageId,
      routeToken,
      store,
    })

    const bindingDelivery = gatewayBindingDeliveryFromRoute(conversation.route)
    if (!bindingDelivery) {
      throw createGatewayUnsupportedOperationError(
        `Gateway session ${parsed.sessionKey} is missing a delivery target.`,
      )
    }

    const clientRequestToken = buildGatewayClientRequestToken(
      routeToken,
      parsed.clientRequestId,
    )
    const delivered = await messageSender.deliver({
      actorId: conversation.route.participantId,
      bindingDelivery,
      channel: conversation.route.channel,
      dedupeToken: clientRequestToken,
      deliveryIdempotencyKey: clientRequestToken,
      dispatchMode: dispatchMode ?? 'immediate',
      identityId: conversation.route.identityId,
      message: parsed.text,
      replyToMessageId: deliveryReplyToMessageId,
      sessionId: resolveGatewayDeliverySessionId(parsed.sessionKey),
      threadId: conversation.route.threadId,
      threadIsDirect: threadIsDirectFromRoute(conversation.route.directness),
      turnId: createGatewaySendTurnId(),
      vault,
    })

    if (delivered.kind === 'failed') {
      throw createGatewayUnsupportedOperationError(
        delivered.deliveryErrorMessage ?? 'Gateway delivery failed.',
      )
    }

    await store.sync().catch(() => undefined)

    return gatewaySendMessageResultSchema.parse({
      sessionKey: parsed.sessionKey,
      messageId: createGatewayOutboxMessageId(routeToken, delivered.intentId),
      queued: delivered.kind !== 'sent',
      delivery: delivered.delivery,
    })
  } finally {
    store.close()
  }
}

async function resolveGatewayReplyToMessageIdLocal(input: {
  channel: string | null
  replyToMessageId: string | null
  routeToken: string
  store: LocalGatewayProjectionStore
}): Promise<string | null> {
  if (!input.replyToMessageId) {
    return null
  }

  if (!gatewayChannelSupportsReplyToMessage(input.channel)) {
    throw createGatewayUnsupportedOperationError(
      `Gateway reply-to is not supported for ${input.channel ?? 'this channel'}.`,
    )
  }

  assertGatewayMessageBelongsToRoute(input.replyToMessageId, input.routeToken)
  const replyTarget = input.store.readMessageProviderReplyTarget(input.replyToMessageId)
  if (!replyTarget) {
    throw createGatewayUnsupportedOperationError(
      'Gateway reply-to requires a channel message with a stable provider message id.',
    )
  }

  return replyTarget
}

function createGatewaySendTurnId(): string {
  return `turn_${randomUUID().replace(/-/gu, '')}`
}

function resolveGatewayDeliverySessionId(sessionKey: string): string {
  return `gwds_${sessionKey}`
}

function buildGatewayClientRequestToken(
  routeToken: string,
  clientRequestId: string | null,
): string | null {
  const normalized = clientRequestId?.trim() ?? ''
  if (normalized.length === 0) {
    return null
  }

  return `gateway-send:${routeToken}:${normalized}`
}

function threadIsDirectFromRoute(
  directness: 'direct' | 'group' | 'unknown' | null,
): boolean | null {
  switch (directness) {
    case 'direct':
      return true
    case 'group':
      return false
    default:
      return null
  }
}

function readGatewayConversationSessionTokenOrThrow(sessionKey: string): string {
  try {
    return readGatewayConversationSessionToken(sessionKey)
  } catch (error) {
    throw createGatewayInvalidRuntimeIdError(
      error instanceof Error ? error.message : 'Gateway session key is invalid.',
    )
  }
}

function assertGatewayMessageBelongsToRoute(messageId: string, routeToken: string): void {
  const messageRouteToken = readGatewayMessageRouteTokenOrThrow(messageId)
  if (messageRouteToken !== routeToken) {
    throw createGatewayInvalidRuntimeIdError(
      'Gateway message id did not belong to the requested session key.',
    )
  }
}

function readGatewayMessageRouteTokenOrThrow(messageId: string): string {
  try {
    return readGatewayMessageRouteToken(messageId)
  } catch (error) {
    throw createGatewayInvalidRuntimeIdError(
      error instanceof Error ? error.message : 'Gateway message id is invalid.',
    )
  }
}

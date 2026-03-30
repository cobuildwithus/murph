import { inferAssistantBindingDelivery } from '../assistant/channel-adapters.js'
import type { AssistantOutboxDispatchMode } from '../assistant/outbox.js'
import { deliverAssistantOutboxMessage } from '../assistant/outbox.js'
import { openAssistantConversationLocal } from '../assistant/service.js'
import { createAssistantTurnId } from '../assistant/turns.js'
import {
  gatewaySendMessageInputSchema,
  gatewaySendMessageResultSchema,
  type GatewayConversationRoute,
  type GatewayProjectionSnapshot,
  type GatewaySendMessageInput,
  type GatewaySendMessageResult,
} from './contracts.js'
import {
  createGatewayOutboxMessageId,
  readGatewayConversationSessionKey,
  readGatewayMessageRouteKey,
} from './opaque-ids.js'
import {
  createGatewayInvalidRuntimeIdError,
  createGatewaySessionNotFoundError,
  createGatewayUnsupportedOperationError,
} from './errors.js'
import {
  exportGatewayProjectionSnapshotLocal,
  getGatewayConversationFromSnapshot,
} from './projection.js'

export async function sendGatewayMessageLocal(input: {
  dispatchMode?: AssistantOutboxDispatchMode
  snapshot?: GatewayProjectionSnapshot | null
  vault: string
} & GatewaySendMessageInput): Promise<GatewaySendMessageResult> {
  const { dispatchMode, snapshot: providedSnapshot, vault, ...gatewayInput } = input
  const parsed = gatewaySendMessageInputSchema.parse(gatewayInput)
  const routeKey = readGatewayConversationSessionKeyOrThrow(parsed.sessionKey)
  if (parsed.replyToMessageId) {
    assertGatewayMessageBelongsToRoute(parsed.replyToMessageId, routeKey)
  }

  const snapshot =
    providedSnapshot ?? (await exportGatewayProjectionSnapshotLocal(vault))
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

  const session = (
    await openAssistantConversationLocal({
      channel: conversation.route.channel,
      identityId: conversation.route.identityId,
      maxSessionAgeMs: null,
      participantId: conversation.route.participantId,
      threadId: conversation.route.threadId,
      threadIsDirect: threadIsDirectFromRoute(conversation.route),
      vault,
    })
  ).session

  const bindingDelivery =
    session.binding.delivery ??
    inferAssistantBindingDelivery({
      channel: conversation.route.channel,
      conversation: {
        channel: conversation.route.channel,
        identityId: conversation.route.identityId,
        participantId: conversation.route.participantId,
        threadId: conversation.route.threadId,
        directness: conversation.route.directness,
      },
      deliveryKind: conversation.route.reply.kind,
      deliveryTarget: conversation.route.reply.target,
    })
  if (!bindingDelivery) {
    throw createGatewayUnsupportedOperationError(
      `Gateway session ${parsed.sessionKey} is missing a delivery target.`,
    )
  }

  const delivered = await deliverAssistantOutboxMessage({
    actorId: session.binding.actorId,
    bindingDelivery,
    channel: session.binding.channel,
    dispatchMode: dispatchMode ?? 'immediate',
    identityId: session.binding.identityId,
    message: parsed.text,
    replyToMessageId: null,
    sessionId: session.sessionId,
    threadId: session.binding.threadId,
    threadIsDirect: session.binding.threadIsDirect,
    turnId: createAssistantTurnId(),
    vault,
  })

  if (delivered.kind === 'failed') {
    const detail = delivered.deliveryError?.message ?? 'Gateway delivery failed.'
    throw createGatewayUnsupportedOperationError(detail)
  }

  return gatewaySendMessageResultSchema.parse({
    sessionKey: parsed.sessionKey,
    messageId: createGatewayOutboxMessageId(routeKey, delivered.intent.intentId),
    queued: delivered.kind !== 'sent',
    delivery: delivered.delivery
      ? {
          channel: delivered.delivery.channel,
          idempotencyKey: delivered.delivery.idempotencyKey ?? null,
          target: delivered.delivery.target,
          targetKind: delivered.delivery.targetKind,
          sentAt: delivered.delivery.sentAt,
          messageLength: delivered.delivery.messageLength,
        }
      : null,
  })
}

function threadIsDirectFromRoute(route: GatewayConversationRoute): boolean | null {
  switch (route.directness) {
    case 'direct':
      return true
    case 'group':
      return false
    default:
      return null
  }
}

function readGatewayConversationSessionKeyOrThrow(sessionKey: string): string {
  try {
    return readGatewayConversationSessionKey(sessionKey)
  } catch (error) {
    throw createGatewayInvalidRuntimeIdError(
      error instanceof Error ? error.message : 'Gateway session key is invalid.',
    )
  }
}

function assertGatewayMessageBelongsToRoute(
  messageId: string,
  routeKey: string,
): void {
  const messageRouteKey = readGatewayMessageRouteKeyOrThrow(messageId)
  if (messageRouteKey !== routeKey) {
    throw createGatewayInvalidRuntimeIdError(
      'Gateway message id did not belong to the requested session key.',
    )
  }
}

function readGatewayMessageRouteKeyOrThrow(messageId: string): string {
  try {
    return readGatewayMessageRouteKey(messageId)
  } catch (error) {
    throw createGatewayInvalidRuntimeIdError(
      error instanceof Error ? error.message : 'Gateway message id is invalid.',
    )
  }
}

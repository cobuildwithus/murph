import { inferAssistantBindingDelivery } from '../assistant/channel-adapters.js'
import { recordAssistantDiagnosticEvent } from '../assistant/diagnostics.js'
import type { AssistantOutboxDispatchMode } from '../assistant/outbox.js'
import { deliverAssistantOutboxMessage } from '../assistant/outbox.js'
import { createAssistantTurnId } from '../assistant/turns.js'
import {
  gatewaySendMessageInputSchema,
  gatewaySendMessageResultSchema,
  type GatewayConversationRoute,
  type GatewaySendMessageInput,
  type GatewaySendMessageResult,
} from './contracts.js'
import {
  createGatewayOutboxMessageId,
  readGatewayConversationSessionToken,
  readGatewayMessageRouteToken,
} from './opaque-ids.js'
import {
  createGatewayInvalidRuntimeIdError,
  createGatewaySessionNotFoundError,
  createGatewayUnsupportedOperationError,
} from './errors.js'
import { getGatewayConversationFromSnapshot } from './snapshot.js'
import { LocalGatewayProjectionStore } from './store.js'
import { gatewayChannelSupportsReplyToMessage } from './routes.js'

export async function sendGatewayMessageLocal(input: {
  dispatchMode?: AssistantOutboxDispatchMode
  vault: string
} & GatewaySendMessageInput): Promise<GatewaySendMessageResult> {
  const { dispatchMode, vault, ...gatewayInput } = input
  const parsed = gatewaySendMessageInputSchema.parse(gatewayInput)
  const routeToken = readGatewayConversationSessionTokenOrThrow(parsed.sessionKey)
  const store = new LocalGatewayProjectionStore(vault)

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

    const bindingDelivery = inferAssistantBindingDelivery({
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

    const clientRequestToken = buildGatewayClientRequestToken(
      routeToken,
      parsed.clientRequestId,
    )
    const delivered = await deliverAssistantOutboxMessage({
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
      threadIsDirect: threadIsDirectFromRoute(conversation.route),
      turnId: createAssistantTurnId(),
      vault,
    })

    if (delivered.kind === 'failed') {
      const detail = delivered.deliveryError?.message ?? 'Gateway delivery failed.'
      throw createGatewayUnsupportedOperationError(detail)
    }

    await store.sync().catch(async (error) => {
      await recordAssistantDiagnosticEvent({
        code: 'GATEWAY_PROJECTION_REFRESH_FAILED',
        component: 'delivery',
        data: {
          error:
            error instanceof Error ? error.message : 'Unknown gateway refresh failure.',
          sessionKey: parsed.sessionKey,
        },
        kind: 'gateway.projection.refresh_failed',
        level: 'warn',
        message:
          'Gateway projection refresh failed after a successful send; the send result was preserved.',
        sessionId: resolveGatewayDeliverySessionId(parsed.sessionKey),
        vault,
      }).catch(() => undefined)
    })

    return gatewaySendMessageResultSchema.parse({
      sessionKey: parsed.sessionKey,
      messageId: createGatewayOutboxMessageId(routeToken, delivered.intent.intentId),
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

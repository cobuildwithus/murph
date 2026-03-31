import { openInboxRuntime } from '@murph/inboxd'

import { inferAssistantBindingDelivery } from '../assistant/channel-adapters.js'
import type { AssistantOutboxDispatchMode } from '../assistant/outbox.js'
import { deliverAssistantOutboxMessage } from '../assistant/outbox.js'
import { createAssistantTurnId } from '../assistant/turns.js'
import {
  gatewaySendMessageInputSchema,
  gatewaySendMessageResultSchema,
  type GatewayConversation,
  type GatewayConversationRoute,
  type GatewayProjectionSnapshot,
  type GatewaySendMessageInput,
  type GatewaySendMessageResult,
} from './contracts.js'
import {
  createGatewayCaptureMessageId,
  createGatewayOutboxMessageId,
  readGatewayConversationSessionToken,
} from './opaque-ids.js'
import {
  createGatewayInvalidRuntimeIdError,
  createGatewaySessionNotFoundError,
  createGatewayUnsupportedOperationError,
} from './errors.js'
import { getGatewayConversationFromSnapshot } from './snapshot.js'
import { LocalGatewayProjectionStore } from './store.js'
import {
  gatewayChannelSupportsReplyToMessage,
  gatewayConversationRouteFromCapture,
  resolveGatewayConversationRouteKey,
} from './routes.js'

const CAPTURE_SCAN_PAGE_SIZE = 500

export async function sendGatewayMessageLocal(input: {
  dispatchMode?: AssistantOutboxDispatchMode
  snapshot?: GatewayProjectionSnapshot | null
  vault: string
} & GatewaySendMessageInput): Promise<GatewaySendMessageResult> {
  const { dispatchMode, snapshot: providedSnapshot, vault, ...gatewayInput } = input
  const parsed = gatewaySendMessageInputSchema.parse(gatewayInput)
  const routeToken = readGatewayConversationSessionTokenOrThrow(parsed.sessionKey)
  const store = new LocalGatewayProjectionStore(vault)

  try {
    const snapshot = providedSnapshot ?? (await store.syncAndReadSnapshot())
    if (providedSnapshot) {
      await store.sync()
    }

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
      conversation,
      replyToMessageId: parsed.replyToMessageId,
      vault,
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

    const delivered = await deliverAssistantOutboxMessage({
      actorId: conversation.route.participantId,
      bindingDelivery,
      channel: conversation.route.channel,
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
  conversation: GatewayConversation
  replyToMessageId: string | null
  vault: string
}): Promise<string | null> {
  if (!input.replyToMessageId) {
    return null
  }

  if (!gatewayChannelSupportsReplyToMessage(input.conversation.route.channel)) {
    throw createGatewayUnsupportedOperationError(
      `Gateway reply-to is not supported for ${input.conversation.route.channel ?? 'this channel'}.`,
    )
  }

  const replyTarget = await findGatewayCaptureReplyTargetLocal(
    input.vault,
    input.replyToMessageId,
    input.conversation.route.channel,
  )
  if (!replyTarget) {
    throw createGatewayUnsupportedOperationError(
      'Gateway reply-to requires a channel message with a stable provider message id.',
    )
  }

  return replyTarget
}

async function findGatewayCaptureReplyTargetLocal(
  vault: string,
  messageId: string,
  channel: string | null,
): Promise<string | null> {
  const runtime = await openInboxRuntime({ vaultRoot: vault })
  try {
    let afterCaptureId: string | null = null
    let afterOccurredAt: string | null = null

    while (true) {
      const page = runtime.listCaptures({
        afterCaptureId,
        afterOccurredAt,
        limit: CAPTURE_SCAN_PAGE_SIZE,
        oldestFirst: true,
      })
      if (page.length === 0) {
        return null
      }

      for (const capture of page) {
        const route = gatewayConversationRouteFromCapture(capture)
        const routeKey = resolveGatewayConversationRouteKey(route)
        if (!routeKey) {
          continue
        }
        if (createGatewayCaptureMessageId(routeKey, capture.captureId) !== messageId) {
          continue
        }
        return extractGatewayProviderReplyTarget(capture.externalId, channel)
      }

      const last = page[page.length - 1]
      afterCaptureId = last?.captureId ?? null
      afterOccurredAt = last?.occurredAt ?? null
      if (page.length < CAPTURE_SCAN_PAGE_SIZE) {
        return null
      }
    }
  } finally {
    runtime.close()
  }
}

function extractGatewayProviderReplyTarget(
  externalId: string,
  channel: string | null,
): string | null {
  if (channel !== 'linq') {
    return null
  }
  return externalId.startsWith('linq:') && externalId.length > 'linq:'.length
    ? externalId.slice('linq:'.length)
    : null
}

function resolveGatewayDeliverySessionId(sessionKey: string): string {
  return `gwds_${sessionKey}`
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

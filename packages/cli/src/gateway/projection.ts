import {
  openInboxRuntime,
  type InboxCaptureRecord,
  type IndexedAttachment,
} from '@murph/inboxd'

import {
  type AssistantOutboxIntent,
  type AssistantSession,
} from '../assistant-cli-contracts.js'
import { listAssistantOutboxIntentsLocal } from '../assistant/outbox.js'
import { normalizeNullableString } from '../assistant/shared.js'
import { listAssistantSessionsLocal } from '../assistant/store.js'
import {
  gatewayConversationSchema,
  gatewayMessageSchema,
  gatewayProjectionSnapshotSchema,
  type GatewayAttachment,
  type GatewayConversation,
  type GatewayConversationRoute,
  type GatewayMessage,
  type GatewayProjectionSnapshot,
} from './contracts.js'
import {
  createGatewayAttachmentId,
  createGatewayCaptureMessageId,
  createGatewayConversationSessionKey,
  createGatewayOutboxMessageId,
} from './opaque-ids.js'
import {
  gatewayConversationRouteCanSend,
  gatewayConversationRouteFromBinding,
  gatewayConversationRouteFromCapture,
  gatewayConversationRouteFromOutboxIntent,
  mergeGatewayConversationRoutes,
  resolveGatewayConversationRouteKey,
} from './routes.js'
import {
  compareGatewayConversationsDescending,
  compareGatewayMessagesAscending,
  deriveLastMessagePreview,
} from './snapshot.js'

export {
  diffGatewayProjectionSnapshots,
  fetchGatewayAttachmentsFromSnapshot,
  getGatewayConversationFromSnapshot,
  listGatewayConversationsFromSnapshot,
  listGatewayOpenPermissionsFromSnapshot,
  readGatewayMessagesFromSnapshot,
  type GatewayEventEmission,
} from './snapshot.js'

const INBOX_CAPTURE_PAGE_SIZE = 500

interface GatewayConversationAccumulator {
  alias: string | null
  latestParticipantDisplayName: string | null
  latestParticipantDisplayNameAt: string | null
  latestThreadTitle: string | null
  latestThreadTitleAt: string | null
  messages: GatewayMessage[]
  route: GatewayConversationRoute
  routeKey: string
  sessionUpdatedAt: string | null
}

interface GatewayProjectionAccumulator {
  conversations: Map<string, GatewayConversationAccumulator>
}

export async function exportGatewayProjectionSnapshotLocal(
  vault: string,
): Promise<GatewayProjectionSnapshot> {
  const projection = await buildLocalGatewayProjection(vault)
  const conversations = Array.from(projection.conversations.values())
    .map((conversation) =>
      materializeGatewayConversation(conversation, {
        includeDerivedTitles: true,
        includeLastMessage: true,
      }),
    )
    .sort(compareGatewayConversationsDescending)
  const messages = Array.from(projection.conversations.values())
    .flatMap((conversation) => conversation.messages)
    .sort(compareGatewayMessagesAscending)

  return gatewayProjectionSnapshotSchema.parse({
    schema: 'murph.gateway-projection-snapshot.v1',
    generatedAt: new Date().toISOString(),
    conversations,
    messages,
    permissions: [],
  })
}

async function buildLocalGatewayProjection(
  vault: string,
): Promise<GatewayProjectionAccumulator> {
  const projection: GatewayProjectionAccumulator = {
    conversations: new Map(),
  }
  const [captures, sessions, outboxIntents] = await Promise.all([
    listAllInboxCaptures(vault),
    listAssistantSessionsLocal(vault),
    listAssistantOutboxIntentsLocal(vault),
  ])

  for (const session of sessions) {
    integrateAssistantSession(projection, session)
  }

  for (const intent of outboxIntents) {
    integrateOutboxIntent(projection, intent)
  }

  for (const capture of captures) {
    integrateInboxCapture(projection, capture)
  }

  for (const conversation of projection.conversations.values()) {
    conversation.messages.sort(compareGatewayMessagesAscending)
  }

  return projection
}

async function listAllInboxCaptures(vault: string): Promise<InboxCaptureRecord[]> {
  const runtime = await openInboxRuntime({ vaultRoot: vault })
  try {
    const captures: InboxCaptureRecord[] = []
    let afterCaptureId: string | null = null
    let afterOccurredAt: string | null = null

    while (true) {
      const page = runtime.listCaptures({
        afterCaptureId,
        afterOccurredAt,
        limit: INBOX_CAPTURE_PAGE_SIZE,
        oldestFirst: true,
      })
      if (page.length === 0) {
        break
      }

      captures.push(...page)
      const last = page[page.length - 1]
      afterCaptureId = last?.captureId ?? null
      afterOccurredAt = last?.occurredAt ?? null

      if (page.length < INBOX_CAPTURE_PAGE_SIZE) {
        break
      }
    }

    return captures
  } finally {
    runtime.close()
  }
}

function integrateAssistantSession(
  projection: GatewayProjectionAccumulator,
  session: AssistantSession,
): void {
  const route = gatewayConversationRouteFromBinding(session.binding)
  const routeKey = resolveGatewayConversationRouteKey(route)
  if (!routeKey) {
    return
  }

  const conversation = ensureGatewayConversationAccumulator(projection, routeKey)
  conversation.route = mergeGatewayConversationRoutes(conversation.route, route)

  if (
    conversation.sessionUpdatedAt === null ||
    session.updatedAt >= conversation.sessionUpdatedAt
  ) {
    conversation.sessionUpdatedAt = session.updatedAt
    if (normalizeNullableString(session.alias)) {
      conversation.alias = session.alias
    }
  } else if (conversation.alias === null && normalizeNullableString(session.alias)) {
    conversation.alias = session.alias
  }
}

function integrateOutboxIntent(
  projection: GatewayProjectionAccumulator,
  intent: AssistantOutboxIntent,
): void {
  const route = gatewayConversationRouteFromOutboxIntent(intent)
  const routeKey = resolveGatewayConversationRouteKey(route)
  if (!routeKey) {
    return
  }

  const conversation = ensureGatewayConversationAccumulator(projection, routeKey)
  conversation.route = mergeGatewayConversationRoutes(conversation.route, route)

  if (intent.status !== 'sent') {
    return
  }

  conversation.messages.push(
    gatewayMessageSchema.parse({
      schema: 'murph.gateway-message.v1',
      messageId: createGatewayOutboxMessageId(routeKey, intent.intentId),
      sessionKey: createGatewayConversationSessionKey(routeKey),
      direction: 'outbound',
      createdAt: intent.sentAt ?? intent.updatedAt,
      actorDisplayName: null,
      text: intent.message,
      attachments: [],
    }),
  )
}

function integrateInboxCapture(
  projection: GatewayProjectionAccumulator,
  capture: InboxCaptureRecord,
): void {
  const route = gatewayConversationRouteFromCapture(capture)
  const routeKey = resolveGatewayConversationRouteKey(route)
  if (!routeKey) {
    return
  }

  const conversation = ensureGatewayConversationAccumulator(projection, routeKey)
  conversation.route = mergeGatewayConversationRoutes(conversation.route, route)

  if (
    capture.thread.title &&
    (conversation.latestThreadTitleAt === null ||
      capture.occurredAt >= conversation.latestThreadTitleAt)
  ) {
    conversation.latestThreadTitle = capture.thread.title
    conversation.latestThreadTitleAt = capture.occurredAt
  }

  if (
    capture.actor.displayName &&
    (conversation.latestParticipantDisplayNameAt === null ||
      capture.occurredAt >= conversation.latestParticipantDisplayNameAt)
  ) {
    conversation.latestParticipantDisplayName = capture.actor.displayName
    conversation.latestParticipantDisplayNameAt = capture.occurredAt
  }

  conversation.messages.push(materializeGatewayCaptureMessage(routeKey, capture))
}

function ensureGatewayConversationAccumulator(
  projection: GatewayProjectionAccumulator,
  routeKey: string,
): GatewayConversationAccumulator {
  const existing = projection.conversations.get(routeKey)
  if (existing) {
    return existing
  }

  const created: GatewayConversationAccumulator = {
    alias: null,
    latestParticipantDisplayName: null,
    latestParticipantDisplayNameAt: null,
    latestThreadTitle: null,
    latestThreadTitleAt: null,
    messages: [],
    route: {
      channel: null,
      directness: null,
      identityId: null,
      participantId: null,
      reply: {
        kind: null,
        target: null,
      },
      threadId: null,
    },
    routeKey,
    sessionUpdatedAt: null,
  }
  projection.conversations.set(routeKey, created)
  return created
}

function materializeGatewayCaptureMessage(
  routeKey: string,
  capture: InboxCaptureRecord,
): GatewayMessage {
  const messageId = createGatewayCaptureMessageId(routeKey, capture.captureId)
  const sessionKey = createGatewayConversationSessionKey(routeKey)

  return gatewayMessageSchema.parse({
    schema: 'murph.gateway-message.v1',
    messageId,
    sessionKey,
    direction: capture.actor.isSelf ? 'outbound' : 'inbound',
    createdAt: capture.occurredAt,
    actorDisplayName: normalizeNullableString(capture.actor.displayName),
    text: capture.text,
    attachments: capture.attachments.map((attachment) =>
      materializeGatewayAttachment(routeKey, capture.captureId, messageId, attachment),
    ),
  })
}

function materializeGatewayAttachment(
  routeKey: string,
  captureId: string,
  messageId: string,
  attachment: IndexedAttachment,
): GatewayAttachment {
  return {
    schema: 'murph.gateway-attachment.v1',
    attachmentId: createGatewayAttachmentId(routeKey, captureId, attachment.attachmentId),
    messageId,
    kind: attachment.kind,
    mime: attachment.mime ?? null,
    fileName: attachment.fileName ?? null,
    byteSize: attachment.byteSize ?? null,
    parseState: normalizeNullableString(attachment.parseState),
    extractedText: attachment.extractedText ?? null,
    transcriptText: attachment.transcriptText ?? null,
  }
}

function materializeGatewayConversation(
  conversation: GatewayConversationAccumulator,
  input: {
    includeDerivedTitles: boolean
    includeLastMessage: boolean
  },
): GatewayConversation {
  const lastMessage = conversation.messages[conversation.messages.length - 1] ?? null
  const title = deriveGatewayConversationTitle(
    conversation,
    input.includeDerivedTitles,
  )

  return gatewayConversationSchema.parse({
    schema: 'murph.gateway-conversation.v1',
    sessionKey: createGatewayConversationSessionKey(conversation.routeKey),
    title,
    lastMessagePreview: input.includeLastMessage ? deriveLastMessagePreview(lastMessage) : null,
    lastActivityAt: lastMessage?.createdAt ?? conversation.sessionUpdatedAt ?? null,
    messageCount: conversation.messages.length,
    canSend: gatewayConversationRouteCanSend(conversation.route),
    route: conversation.route,
  })
}

function deriveGatewayConversationTitle(
  conversation: GatewayConversationAccumulator,
  includeDerivedTitles: boolean,
): string | null {
  const explicit =
    normalizeNullableString(conversation.alias) ??
    normalizeNullableString(conversation.latestThreadTitle)
  if (explicit) {
    return explicit
  }
  if (!includeDerivedTitles) {
    return null
  }

  return (
    normalizeNullableString(conversation.latestParticipantDisplayName) ??
    normalizeNullableString(conversation.route.participantId) ??
    normalizeNullableString(conversation.route.threadId) ??
    normalizeNullableString(conversation.route.channel)
  )
}

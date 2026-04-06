import type { DatabaseSync } from 'node:sqlite'

import {
  DEFAULT_GATEWAY_EVENT_RETENTION,
  applyGatewayProjectionSnapshotToEventLog,
} from '@murphai/gateway-core'
import {
  gatewayConversationSchema,
  gatewayMessageSchema,
  gatewayPermissionRequestSchema,
  gatewayProjectionSnapshotSchema,
  type GatewayAttachment,
  type GatewayConversation,
  type GatewayConversationRoute,
  type GatewayConversationTitleSource,
  type GatewayEvent,
  type GatewayProjectionSnapshot,
} from '@murphai/gateway-core'
import {
  gatewayConversationRouteCanSend,
  mergeGatewayConversationRoutes,
} from '@murphai/gateway-core'
import {
  compareGatewayConversationsDescending,
  compareGatewayMessagesAscending,
  deriveLastMessagePreview,
} from '@murphai/gateway-core'
import { normalizeNullableString } from '../shared.js'
import { readPermissionRows } from './permissions.js'
import {
  readMeta,
  SNAPSHOT_GENERATED_AT_META_KEY,
  writeMeta,
} from './schema.js'
import {
  type CaptureAttachmentRow,
  type CaptureSourceRow,
  type OutboxSourceRow,
  type SessionSourceRow,
  readCaptureAttachmentRows,
  readCaptureSourceRows,
  readOutboxSourceRows,
  readSessionSourceRows,
} from './source-sync.js'

interface GatewayProjectionMessageAccumulator {
  actorDisplayName: string | null
  attachments: GatewayAttachment[]
  createdAt: string
  direction: 'inbound' | 'outbound' | 'system'
  messageId: string
  providerMessageId: string | null
  providerThreadId: string | null
  sessionKey: string
  text: string | null
}

interface GatewayConversationAccumulator {
  alias: string | null
  latestParticipantDisplayName: string | null
  latestParticipantDisplayNameAt: string | null
  latestThreadTitle: string | null
  latestThreadTitleAt: string | null
  messages: GatewayProjectionMessageAccumulator[]
  route: GatewayConversationRoute
  sessionKey: string
  sessionUpdatedAt: string | null
}

export interface GatewaySnapshotState {
  events: GatewayEvent[]
  nextCursor: number
  snapshot: GatewayProjectionSnapshot | null
}

export function rebuildSnapshotStateFrom(
  database: DatabaseSync,
  previousState: GatewaySnapshotState,
): void {
  const nextSnapshot = buildSnapshotFromDatabase(database, new Date().toISOString())
  const nextState = applyGatewayProjectionSnapshotToEventLog(
    previousState,
    nextSnapshot,
    DEFAULT_GATEWAY_EVENT_RETENTION,
  )
  writeSnapshotState(database, nextState)
}

export function readSnapshotState(database: DatabaseSync): GatewaySnapshotState {
  return {
    events: readStoredEvents(database),
    nextCursor: readNextCursor(database),
    snapshot: readStoredSnapshot(database),
  }
}

export function writeSnapshotState(database: DatabaseSync, state: GatewaySnapshotState): void {
  database.prepare('DELETE FROM gateway_events').run()
  const insert = database.prepare(`
    INSERT INTO gateway_events (
      cursor,
      kind,
      created_at,
      session_key,
      message_id,
      permission_request_id,
      summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const event of state.events) {
    insert.run(
      event.cursor,
      event.kind,
      event.createdAt,
      event.sessionKey,
      event.messageId,
      event.permissionRequestId,
      event.summary,
    )
  }

  if (state.snapshot) {
    writeMeta(database, SNAPSHOT_GENERATED_AT_META_KEY, state.snapshot.generatedAt)
  } else {
    writeMeta(database, SNAPSHOT_GENERATED_AT_META_KEY, null)
  }
}

export function readSnapshotOrEmpty(database: DatabaseSync): GatewayProjectionSnapshot {
  return readStoredSnapshot(database) ?? gatewayProjectionSnapshotSchema.parse({
    schema: 'murph.gateway-projection-snapshot.v1',
    generatedAt: new Date().toISOString(),
    conversations: [],
    messages: [],
    permissions: [],
  })
}

export function hasGatewaySnapshotState(database: DatabaseSync): boolean {
  return readMeta(database, SNAPSHOT_GENERATED_AT_META_KEY) !== null
}

export function readGatewayTableCount(database: DatabaseSync, tableName: string): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    .get() as { count: number | null }
  return row.count ?? 0
}

function buildSnapshotFromDatabase(
  database: DatabaseSync,
  generatedAt: string = new Date().toISOString(),
): GatewayProjectionSnapshot {
  const projection = new Map<string, GatewayConversationAccumulator>()
  const sentOutboxByProviderKey = new Map<string, GatewayProjectionMessageAccumulator>()

  for (const row of readSessionSourceRows(database)) {
    const conversation = ensureConversationAccumulator(projection, row.routeKey, row.sessionKey)
    conversation.route = mergeGatewayConversationRoutes(conversation.route, {
      channel: row.source,
      identityId: row.identityId,
      participantId: row.participantId,
      threadId: row.threadId,
      directness: row.directness,
      reply: {
        kind: row.replyKind,
        target: row.replyTarget,
      },
    })

    if (conversation.sessionUpdatedAt === null || row.updatedAt >= conversation.sessionUpdatedAt) {
      conversation.sessionUpdatedAt = row.updatedAt
      if (row.alias) {
        conversation.alias = row.alias
      }
    } else if (conversation.alias === null && row.alias) {
      conversation.alias = row.alias
    }
  }

  for (const row of readOutboxSourceRows(database)) {
    const conversation = ensureConversationAccumulator(projection, row.routeKey, row.sessionKey)
    conversation.route = mergeGatewayConversationRoutes(conversation.route, {
      channel: row.source,
      identityId: row.identityId,
      participantId: row.actorId,
      threadId: row.threadId,
      directness: row.directness,
      reply: {
        kind: row.replyKind,
        target: row.replyTarget,
      },
    })

    if (row.status !== 'sent') {
      continue
    }

    const message: GatewayProjectionMessageAccumulator = {
      actorDisplayName: null,
      attachments: [],
      createdAt: row.sentAt ?? row.updatedAt,
      direction: 'outbound',
      messageId: row.messageId,
      providerMessageId: row.providerMessageId,
      providerThreadId: row.providerThreadId,
      sessionKey: row.sessionKey,
      text: row.message,
    }
    conversation.messages.push(message)
    if (row.providerMessageId) {
      sentOutboxByProviderKey.set(`${row.routeKey}\u0000${row.providerMessageId}`, message)
    }
  }

  const attachmentsByCaptureId = readCaptureAttachmentRows(database).reduce(
    (map, row) => {
      const rows = map.get(row.captureId) ?? []
      rows.push(row)
      map.set(row.captureId, rows)
      return map
    },
    new Map<string, CaptureAttachmentRow[]>(),
  )

  for (const row of readCaptureSourceRows(database)) {
    const conversation = ensureConversationAccumulator(projection, row.routeKey, row.sessionKey)
    conversation.route = mergeGatewayConversationRoutes(conversation.route, {
      channel: row.source,
      identityId: row.identityId,
      participantId: row.actorId,
      threadId: row.threadId,
      directness: row.directness,
    })

    if (row.threadTitle && (conversation.latestThreadTitleAt === null || row.occurredAt >= conversation.latestThreadTitleAt)) {
      conversation.latestThreadTitle = row.threadTitle
      conversation.latestThreadTitleAt = row.occurredAt
    }

    if (row.actorDisplayName && (conversation.latestParticipantDisplayNameAt === null || row.occurredAt >= conversation.latestParticipantDisplayNameAt)) {
      conversation.latestParticipantDisplayName = row.actorDisplayName
      conversation.latestParticipantDisplayNameAt = row.occurredAt
    }

    const attachments = (attachmentsByCaptureId.get(row.sourceRecordId) ?? [])
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((attachment) => materializeGatewayAttachmentFromRow(row.messageId, attachment))

    if (row.actorIsSelf === 1 && row.providerMessageId) {
      const merged = sentOutboxByProviderKey.get(`${row.routeKey}\u0000${row.providerMessageId}`)
      if (merged) {
        if (!merged.actorDisplayName) {
          merged.actorDisplayName = row.actorDisplayName
        }
        if (!merged.providerThreadId) {
          merged.providerThreadId = row.threadId
        }
        if ((merged.text === null || merged.text.length === 0) && row.text) {
          merged.text = row.text
        }
        if (attachments.length > 0) {
          const deduped = new Map(merged.attachments.map((attachment) => [attachment.attachmentId, attachment]))
          for (const attachment of attachments) {
            deduped.set(attachment.attachmentId, attachment)
          }
          merged.attachments = Array.from(deduped.values())
        }
        continue
      }
    }

    conversation.messages.push({
      actorDisplayName: row.actorDisplayName,
      attachments,
      createdAt: row.occurredAt,
      direction: row.actorIsSelf === 1 ? 'outbound' : 'inbound',
      messageId: row.messageId,
      providerMessageId: row.providerMessageId,
      providerThreadId: row.threadId,
      sessionKey: row.sessionKey,
      text: row.text,
    })
  }

  for (const conversation of projection.values()) {
    conversation.messages.sort(compareProjectionMessagesAscending)
  }

  const conversations = Array.from(projection.values())
    .map(materializeGatewayConversation)
    .sort(compareGatewayConversationsDescending)
  const messages = Array.from(projection.values())
    .flatMap((conversation) => conversation.messages.map(materializeGatewayMessage))
    .sort(compareGatewayMessagesAscending)
  const permissions = readPermissionRows(database).map((row) =>
    gatewayPermissionRequestSchema.parse({
      schema: 'murph.gateway-permission-request.v1',
      requestId: row.requestId,
      sessionKey: row.sessionKey,
      action: row.action,
      description: row.description,
      status: row.status,
      requestedAt: row.requestedAt,
      resolvedAt: row.resolvedAt,
      note: row.note,
    }),
  )

  return gatewayProjectionSnapshotSchema.parse({
    schema: 'murph.gateway-projection-snapshot.v1',
    generatedAt,
    conversations,
    messages,
    permissions,
  })
}

function ensureConversationAccumulator(
  projection: Map<string, GatewayConversationAccumulator>,
  routeKey: string,
  sessionKey: string,
): GatewayConversationAccumulator {
  const existing = projection.get(routeKey)
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
    sessionKey,
    sessionUpdatedAt: null,
  }
  projection.set(routeKey, created)
  return created
}

function materializeGatewayMessage(message: GatewayProjectionMessageAccumulator) {
  return gatewayMessageSchema.parse({
    schema: 'murph.gateway-message.v1',
    messageId: message.messageId,
    sessionKey: message.sessionKey,
    direction: message.direction,
    createdAt: message.createdAt,
    actorDisplayName: message.actorDisplayName,
    text: message.text,
    attachments: message.attachments,
  })
}

function materializeGatewayAttachmentFromRow(
  messageId: string,
  attachment: CaptureAttachmentRow,
): GatewayAttachment {
  return {
    schema: 'murph.gateway-attachment.v1',
    attachmentId: attachment.attachmentId,
    messageId,
    kind: attachment.kind,
    mime: attachment.mime,
    fileName: attachment.fileName,
    byteSize: attachment.byteSize,
    parseState: attachment.parseState,
    extractedText: attachment.extractedText,
    transcriptText: attachment.transcriptText,
  }
}

function materializeGatewayConversation(
  conversation: GatewayConversationAccumulator,
): GatewayConversation {
  const lastMessage = conversation.messages[conversation.messages.length - 1] ?? null
  const title = deriveGatewayConversationTitle(conversation)

  return gatewayConversationSchema.parse({
    schema: 'murph.gateway-conversation.v1',
    sessionKey: conversation.sessionKey,
    title: title.value,
    titleSource: title.source,
    lastMessagePreview: deriveLastMessagePreview(lastMessage ? materializeGatewayMessage(lastMessage) : null),
    lastActivityAt: lastMessage?.createdAt ?? conversation.sessionUpdatedAt ?? null,
    messageCount: conversation.messages.length,
    canSend: gatewayConversationRouteCanSend(conversation.route),
    route: conversation.route,
  })
}

function deriveGatewayConversationTitle(conversation: GatewayConversationAccumulator): {
  source: GatewayConversationTitleSource | null
  value: string | null
} {
  const alias = normalizeNullableString(conversation.alias)
  if (alias) {
    return { source: 'alias', value: alias }
  }

  const threadTitle = normalizeNullableString(conversation.latestThreadTitle)
  if (threadTitle) {
    return { source: 'thread-title', value: threadTitle }
  }

  const participantDisplayName = normalizeNullableString(conversation.latestParticipantDisplayName)
  if (participantDisplayName) {
    return { source: 'participant-display-name', value: participantDisplayName }
  }

  const participantId = normalizeNullableString(conversation.route.participantId)
  if (participantId) {
    return { source: 'participant-id', value: participantId }
  }

  const threadId = normalizeNullableString(conversation.route.threadId)
  if (threadId) {
    return { source: 'thread-id', value: threadId }
  }

  const channel = normalizeNullableString(conversation.route.channel)
  if (channel) {
    return { source: 'channel', value: channel }
  }

  return { source: null, value: null }
}

function compareProjectionMessagesAscending(
  left: GatewayProjectionMessageAccumulator,
  right: GatewayProjectionMessageAccumulator,
): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.messageId.localeCompare(right.messageId)
  )
}

function readStoredSnapshot(database: DatabaseSync): GatewayProjectionSnapshot | null {
  const generatedAt = readMeta(database, SNAPSHOT_GENERATED_AT_META_KEY)
  if (generatedAt === null) {
    return null
  }

  return buildSnapshotFromDatabase(database, generatedAt)
}

function readStoredEvents(database: DatabaseSync): GatewayEvent[] {
  return database.prepare(`
    SELECT
      cursor,
      kind,
      created_at AS createdAt,
      session_key AS sessionKey,
      message_id AS messageId,
      permission_request_id AS permissionRequestId,
      summary
    FROM gateway_events
    ORDER BY cursor ASC
  `).all().map((row) => ({
    schema: 'murph.gateway-event.v1',
    ...(row as Omit<GatewayEvent, 'schema'>),
  })) as GatewayEvent[]
}

function readNextCursor(database: DatabaseSync): number {
  const row = database
    .prepare('SELECT MAX(cursor) AS cursor FROM gateway_events')
    .get() as { cursor: number | null }
  return row.cursor ?? 0
}

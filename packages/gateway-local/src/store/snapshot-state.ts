import type { DatabaseSync } from 'node:sqlite'

import {
  DEFAULT_GATEWAY_EVENT_RETENTION,
  applyGatewayProjectionSnapshotToEventLog,
} from '@murphai/gateway-core'
import {
  gatewayAttachmentSchema,
  gatewayConversationSchema,
  gatewayMessageSchema,
  gatewayPermissionRequestSchema,
  gatewayProjectionSnapshotSchema,
  type GatewayAttachment,
  type GatewayConversation,
  type GatewayConversationRoute,
  type GatewayConversationTitleSource,
  type GatewayEvent,
  type GatewayPermissionRequest,
  type GatewayProjectionSnapshot,
} from '@murphai/gateway-core'
import {
  gatewayConversationRouteCanSend,
  mergeGatewayConversationRoutes,
  resolveGatewayConversationRouteKey,
} from '@murphai/gateway-core'
import {
  compareGatewayConversationsDescending,
  compareGatewayMessagesAscending,
  deriveLastMessagePreview,
} from '@murphai/gateway-core'
import { normalizeNullableString } from '../shared.js'
import { readPermissionRows } from './permissions.js'
import { readMeta, writeMeta } from './schema.js'
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

const SNAPSHOT_EMPTY_META_KEY = 'snapshot.empty'
const SNAPSHOT_GENERATED_AT_META_KEY = 'snapshot.generatedAt'
const SNAPSHOT_INITIALIZED_META_KEY = 'snapshot.initialized'

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

export function rebuildSnapshotState(database: DatabaseSync): void {
  rebuildSnapshotStateFrom(database, readSnapshotState(database))
}

export function rebuildSnapshotStateFrom(
  database: DatabaseSync,
  previousState: GatewaySnapshotState,
): void {
  const nextSnapshot = buildSnapshotFromDatabase(database)
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
  replaceServingSnapshot(database, state.snapshot)
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
    writeMeta(database, SNAPSHOT_INITIALIZED_META_KEY, '1')
    writeMeta(database, SNAPSHOT_GENERATED_AT_META_KEY, state.snapshot.generatedAt)
    writeMeta(
      database,
      SNAPSHOT_EMPTY_META_KEY,
      state.snapshot.conversations.length === 0 &&
        state.snapshot.messages.length === 0 &&
        state.snapshot.permissions.length === 0
        ? '1'
        : '0',
    )
  } else {
    writeMeta(database, SNAPSHOT_INITIALIZED_META_KEY, null)
    writeMeta(database, SNAPSHOT_GENERATED_AT_META_KEY, null)
    writeMeta(database, SNAPSHOT_EMPTY_META_KEY, null)
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

export function hasGatewayServingSnapshot(database: DatabaseSync): boolean {
  if (readMeta(database, SNAPSHOT_INITIALIZED_META_KEY) !== '1') {
    return false
  }

  if (readMeta(database, SNAPSHOT_EMPTY_META_KEY) === '1') {
    return true
  }

  return readGatewayTableCount(database, 'gateway_conversations') > 0 ||
    readGatewayTableCount(database, 'gateway_messages') > 0 ||
    readGatewayTableCount(database, 'gateway_permissions') > 0
}

export function readGatewayTableCount(database: DatabaseSync, tableName: string): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    .get() as { count: number | null }
  return row.count ?? 0
}

function replaceServingSnapshot(
  database: DatabaseSync,
  snapshot: GatewayProjectionSnapshot | null,
): void {
  database.prepare('DELETE FROM gateway_attachments').run()
  database.prepare('DELETE FROM gateway_messages').run()
  database.prepare('DELETE FROM gateway_conversations').run()

  if (!snapshot) {
    return
  }

  const insertConversation = database.prepare(`
    INSERT INTO gateway_conversations (
      session_key,
      route_key,
      channel,
      identity_id,
      participant_id,
      thread_id,
      directness,
      reply_kind,
      reply_target,
      title,
      title_source,
      last_message_preview,
      last_activity_at,
      message_count,
      can_send
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertMessage = database.prepare(`
    INSERT INTO gateway_messages (
      message_id,
      session_key,
      created_at,
      direction,
      actor_display_name,
      text
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insertAttachment = database.prepare(`
    INSERT INTO gateway_attachments (
      attachment_id,
      session_key,
      message_id,
      ordinal,
      kind,
      mime,
      file_name,
      byte_size,
      parse_state,
      extracted_text,
      transcript_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const conversation of snapshot.conversations) {
    insertConversation.run(
      conversation.sessionKey,
      resolveGatewayConversationRouteKey(conversation.route) ?? conversation.sessionKey,
      conversation.route.channel,
      conversation.route.identityId,
      conversation.route.participantId,
      conversation.route.threadId,
      conversation.route.directness,
      conversation.route.reply.kind,
      conversation.route.reply.target,
      conversation.title,
      conversation.titleSource,
      conversation.lastMessagePreview,
      conversation.lastActivityAt,
      conversation.messageCount,
      conversation.canSend ? 1 : 0,
    )
  }

  for (const message of snapshot.messages) {
    insertMessage.run(
      message.messageId,
      message.sessionKey,
      message.createdAt,
      message.direction,
      message.actorDisplayName,
      message.text,
    )
    for (const [attachmentIndex, attachment] of message.attachments.entries()) {
      insertAttachment.run(
        attachment.attachmentId,
        message.sessionKey,
        message.messageId,
        attachmentIndex,
        attachment.kind,
        attachment.mime,
        attachment.fileName,
        attachment.byteSize,
        attachment.parseState,
        attachment.extractedText,
        attachment.transcriptText,
      )
    }
  }
}

function buildSnapshotFromDatabase(database: DatabaseSync): GatewayProjectionSnapshot {
  const projection = new Map<string, GatewayConversationAccumulator>()
  const sentOutboxByProviderKey = new Map<string, GatewayProjectionMessageAccumulator>()

  for (const row of readSessionSourceRows(database)) {
    const conversation = ensureConversationAccumulator(projection, row.routeKey, row.sessionKey)
    conversation.route = mergeGatewayConversationRoutes(conversation.route, {
      channel: row.channel,
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
      channel: row.channel,
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
      identityId: row.source === 'email' || row.source === 'linq' ? row.accountId : null,
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

    const attachments = (attachmentsByCaptureId.get(row.captureId) ?? [])
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
    generatedAt: new Date().toISOString(),
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
  if (!hasGatewayServingSnapshot(database)) {
    return null
  }

  const generatedAt = readMeta(database, SNAPSHOT_GENERATED_AT_META_KEY) ?? new Date().toISOString()

  const conversations = database
    .prepare(`
      SELECT
        session_key AS sessionKey,
        channel,
        identity_id AS identityId,
        participant_id AS participantId,
        thread_id AS threadId,
        directness,
        reply_kind AS replyKind,
        reply_target AS replyTarget,
        title,
        title_source AS titleSource,
        last_message_preview AS lastMessagePreview,
        last_activity_at AS lastActivityAt,
        message_count AS messageCount,
        can_send AS canSend
      FROM gateway_conversations
      ORDER BY coalesce(last_activity_at, '') DESC, session_key ASC
    `)
    .all()
    .map((row) => gatewayConversationSchema.parse({
      schema: 'murph.gateway-conversation.v1',
      sessionKey: (row as { sessionKey: string }).sessionKey,
      title: (row as { title: string | null }).title,
      titleSource: (row as { titleSource: GatewayConversationTitleSource | null }).titleSource,
      lastMessagePreview: (row as { lastMessagePreview: string | null }).lastMessagePreview,
      lastActivityAt: (row as { lastActivityAt: string | null }).lastActivityAt,
      messageCount: (row as { messageCount: number | null }).messageCount,
      canSend: ((row as { canSend: number }).canSend ?? 0) === 1,
      route: {
        channel: (row as { channel: string | null }).channel,
        identityId: (row as { identityId: string | null }).identityId,
        participantId: (row as { participantId: string | null }).participantId,
        threadId: (row as { threadId: string | null }).threadId,
        directness: (row as { directness: GatewayConversationRoute['directness'] }).directness,
        reply: {
          kind: (row as { replyKind: GatewayConversationRoute['reply']['kind'] }).replyKind,
          target: (row as { replyTarget: string | null }).replyTarget,
        },
      },
    })) as GatewayConversation[]

  const attachmentsByMessageId = database
    .prepare(`
      SELECT
        attachment_id AS attachmentId,
        message_id AS messageId,
        kind,
        mime,
        file_name AS fileName,
        byte_size AS byteSize,
        parse_state AS parseState,
        extracted_text AS extractedText,
        transcript_text AS transcriptText
      FROM gateway_attachments
      ORDER BY message_id ASC, ordinal ASC, attachment_id ASC
    `)
    .all()
    .reduce((map, row) => {
      const attachment = gatewayAttachmentSchema.parse({
        schema: 'murph.gateway-attachment.v1',
        attachmentId: (row as { attachmentId: string }).attachmentId,
        messageId: (row as { messageId: string }).messageId,
        kind: (row as { kind: GatewayAttachment['kind'] }).kind,
        mime: (row as { mime: string | null }).mime,
        fileName: (row as { fileName: string | null }).fileName,
        byteSize: (row as { byteSize: number | null }).byteSize,
        parseState: (row as { parseState: string | null }).parseState,
        extractedText: (row as { extractedText: string | null }).extractedText,
        transcriptText: (row as { transcriptText: string | null }).transcriptText,
      })
      const attachments = map.get(attachment.messageId) ?? []
      attachments.push(attachment)
      map.set(attachment.messageId, attachments)
      return map
    }, new Map<string, GatewayAttachment[]>())

  const messages = database
    .prepare(`
      SELECT
        message_id AS messageId,
        session_key AS sessionKey,
        created_at AS createdAt,
        direction,
        actor_display_name AS actorDisplayName,
        text
      FROM gateway_messages
      ORDER BY created_at ASC, message_id ASC
    `)
    .all()
    .map((row) => {
      const messageId = (row as { messageId: string }).messageId
      return gatewayMessageSchema.parse({
        schema: 'murph.gateway-message.v1',
        messageId,
        sessionKey: (row as { sessionKey: string }).sessionKey,
        createdAt: (row as { createdAt: string }).createdAt,
        direction: (row as { direction: 'inbound' | 'outbound' | 'system' }).direction,
        actorDisplayName: (row as { actorDisplayName: string | null }).actorDisplayName,
        text: (row as { text: string | null }).text,
        attachments: attachmentsByMessageId.get(messageId) ?? [],
      })
    })

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

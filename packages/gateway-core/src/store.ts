import type { DatabaseSync } from 'node:sqlite'

import {
  listInboxCaptureMutations,
  openInboxRuntime,
  readInboxCaptureMutationHead,
  type InboxCaptureRecord,
  type IndexedAttachment,
} from '@murph/inboxd'
import {
  openSqliteRuntimeDatabase,
  resolveGatewayRuntimePaths,
  resolveInboxRuntimePaths,
} from '@murph/runtime-state'

import {
  type AssistantOutboxIntent,
  type AssistantSession,
  listAssistantOutboxIntents,
  listAssistantSessions,
} from '@murph/assistant-core'
import { normalizeNullableString } from './shared.js'
import {
  DEFAULT_GATEWAY_EVENT_POLL_INTERVAL_MS,
  DEFAULT_GATEWAY_EVENT_RETENTION,
  applyGatewayProjectionSnapshotToEventLog,
  pollGatewayEventLogState,
  waitForGatewayEventsByPolling,
} from './event-log.js'
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
  type GatewayListOpenPermissionsInput,
  type GatewayPermissionRequest,
  type GatewayPollEventsInput,
  type GatewayPollEventsResult,
  type GatewayProjectionSnapshot,
  type GatewayRespondToPermissionInput,
  type GatewayWaitForEventsInput,
} from './contracts.js'
import {
  createGatewayAttachmentId,
  createGatewayCaptureMessageId,
  createGatewayConversationSessionKey,
  createGatewayOutboxMessageId,
  sameGatewayConversationSession,
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

const CAPTURE_CURSOR_META_KEY = 'captures.cursor'
const SESSION_SIGNATURE_META_KEY = 'sessions.signature'
const OUTBOX_SIGNATURE_META_KEY = 'outbox.signature'
const CAPTURE_SYNC_BATCH_SIZE = 500

interface CaptureSourceRow {
  accountId: string | null
  actorDisplayName: string | null
  actorId: string | null
  actorIsSelf: number
  captureId: string
  directness: GatewayConversationRoute['directness']
  messageId: string
  occurredAt: string
  providerMessageId: string | null
  routeKey: string
  sessionKey: string
  source: string
  text: string | null
  threadId: string | null
  threadTitle: string | null
}

interface CaptureAttachmentRow {
  attachmentId: string
  byteSize: number | null
  captureId: string
  extractedText: string | null
  fileName: string | null
  kind: GatewayAttachment['kind']
  mime: string | null
  ordinal: number
  parseState: string | null
  transcriptText: string | null
}

interface SessionSourceRow {
  alias: string | null
  channel: string | null
  directness: GatewayConversationRoute['directness']
  identityId: string | null
  participantId: string | null
  replyKind: GatewayConversationRoute['reply']['kind']
  replyTarget: string | null
  routeKey: string
  sessionId: string
  sessionKey: string
  threadId: string | null
  updatedAt: string
}

interface OutboxSourceRow {
  actorId: string | null
  channel: string | null
  createdAt: string
  directness: GatewayConversationRoute['directness']
  identityId: string | null
  intentId: string
  message: string
  messageId: string
  providerMessageId: string | null
  providerThreadId: string | null
  replyKind: GatewayConversationRoute['reply']['kind']
  replyTarget: string | null
  routeKey: string
  sentAt: string | null
  sessionKey: string
  status: AssistantOutboxIntent['status']
  threadId: string | null
  updatedAt: string
}

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
  routeKey: string
  sessionKey: string
  sessionUpdatedAt: string | null
}

interface GatewaySnapshotState {
  events: GatewayEvent[]
  nextCursor: number
  snapshot: GatewayProjectionSnapshot | null
}

type CaptureSyncState =
  | { kind: 'noop'; headCursor: number }
  | { kind: 'rebuild'; headCursor: number; captures: InboxCaptureRecord[] }
  | {
    kind: 'incremental'
    changedCaptureIds: string[]
    captures: InboxCaptureRecord[]
    headCursor: number
  }

export async function exportGatewayProjectionSnapshotLocal(
  vault: string,
): Promise<GatewayProjectionSnapshot> {
  const store = new LocalGatewayProjectionStore(vault)
  try {
    return await store.syncAndReadSnapshot()
  } finally {
    store.close()
  }
}

export async function listGatewayOpenPermissionsLocal(
  vault: string,
  input?: GatewayListOpenPermissionsInput,
): Promise<GatewayPermissionRequest[]> {
  const store = new LocalGatewayProjectionStore(vault)
  try {
    await store.sync()
    return store.listOpenPermissions(input)
  } finally {
    store.close()
  }
}

export async function respondToGatewayPermissionLocal(
  vault: string,
  input: GatewayRespondToPermissionInput,
): Promise<GatewayPermissionRequest | null> {
  const store = new LocalGatewayProjectionStore(vault)
  try {
    await store.sync()
    return store.respondToPermission(input)
  } finally {
    store.close()
  }
}

export async function pollGatewayEventsLocal(
  vault: string,
  input?: GatewayPollEventsInput,
): Promise<GatewayPollEventsResult> {
  const store = new LocalGatewayProjectionStore(vault)
  try {
    await store.sync()
    return store.pollEvents(input)
  } finally {
    store.close()
  }
}

export async function waitForGatewayEventsLocal(
  vault: string,
  input?: GatewayWaitForEventsInput,
): Promise<GatewayPollEventsResult> {
  const store = new LocalGatewayProjectionStore(vault)
  try {
    return await waitForGatewayEventsByPolling(async (pollInput) => {
      await store.sync()
      return store.pollEvents(pollInput)
    }, input, {
      intervalMs: DEFAULT_GATEWAY_EVENT_POLL_INTERVAL_MS,
    })
  } finally {
    store.close()
  }
}

export class LocalGatewayProjectionStore {
  private readonly database: DatabaseSync

  constructor(private readonly vault: string) {
    this.database = openSqliteRuntimeDatabase(resolveGatewayRuntimePaths(vault).gatewayDbPath)
    ensureGatewayStoreSchema(this.database)
  }

  close(): void {
    this.database.close()
  }

  async sync(): Promise<void> {
    const captureSyncState = await loadCaptureSyncState(
      this.vault,
      readGatewayTableCount(this.database, 'gateway_capture_sources') > 0
        ? readNumericMeta(this.database, CAPTURE_CURSOR_META_KEY)
        : null,
    )
    const [sessions, outboxIntents] = await Promise.all([
      listAssistantSessions(this.vault),
      listAssistantOutboxIntents(this.vault),
    ])
    const sessionSignature = computeSessionSyncSignature(sessions)
    const outboxSignature = computeOutboxSyncSignature(outboxIntents)

    await withGatewayImmediateTransaction(this.database, async () => {
      let changed = false

      if (captureSyncState.kind === 'rebuild') {
        clearCaptureSources(this.database)
        upsertCaptureSources(this.database, captureSyncState.captures)
        writeMeta(this.database, CAPTURE_CURSOR_META_KEY, String(captureSyncState.headCursor))
        changed = true
      } else if (captureSyncState.kind === 'incremental') {
        replaceCaptureSourcesForCaptureIds(
          this.database,
          captureSyncState.changedCaptureIds,
          captureSyncState.captures,
        )
        writeMeta(this.database, CAPTURE_CURSOR_META_KEY, String(captureSyncState.headCursor))
        changed = true
      }

      if (readMeta(this.database, SESSION_SIGNATURE_META_KEY) !== sessionSignature) {
        replaceSessionSources(this.database, sessions)
        writeMeta(this.database, SESSION_SIGNATURE_META_KEY, sessionSignature)
        changed = true
      }

      if (readMeta(this.database, OUTBOX_SIGNATURE_META_KEY) !== outboxSignature) {
        replaceOutboxSources(this.database, outboxIntents)
        writeMeta(this.database, OUTBOX_SIGNATURE_META_KEY, outboxSignature)
        changed = true
      }

      if (changed || !hasGatewayServingSnapshot(this.database)) {
        rebuildSnapshotState(this.database)
      }
    })
  }

  async syncAndReadSnapshot(): Promise<GatewayProjectionSnapshot> {
    await this.sync()
    return readSnapshotOrEmpty(this.database)
  }

  listOpenPermissions(input?: GatewayListOpenPermissionsInput): GatewayPermissionRequest[] {
    return listOpenPermissionsFromDatabase(this.database, input?.sessionKey ?? null)
  }

  respondToPermission(input: GatewayRespondToPermissionInput): GatewayPermissionRequest | null {
    return respondToPermissionInDatabase(this.database, input)
  }

  pollEvents(input?: GatewayPollEventsInput): GatewayPollEventsResult {
    return pollGatewayEventLogState(readSnapshotState(this.database), input)
  }

  readMessageProviderReplyTarget(messageId: string): string | null {
    const row = this.database
      .prepare(
        `SELECT provider_message_id AS providerMessageId
           FROM gateway_outbox_sources
          WHERE message_id = ?
          UNION ALL
         SELECT provider_message_id AS providerMessageId
           FROM gateway_capture_sources
          WHERE message_id = ?
          LIMIT 1`,
      )
      .get(messageId, messageId) as { providerMessageId: string | null } | undefined

    return normalizeNullableString(row?.providerMessageId)
  }
}

async function listAllInboxCapturesByCreatedOrder(
  vault: string,
): Promise<InboxCaptureRecord[]> {
  const runtime = await openInboxRuntime({ vaultRoot: vault })
  const database = openSqliteRuntimeDatabase(resolveInboxRuntimePaths(vault).inboxDbPath)
  try {
    const rows = database
      .prepare(
        `SELECT capture_id AS captureId, created_at AS createdAt
           FROM capture
          ORDER BY created_at ASC, capture_id ASC
        `,
      )
      .all() as Array<{ captureId: string; createdAt: string }>

    const captures: InboxCaptureRecord[] = []
    for (const row of rows) {
      const capture = runtime.getCapture(row.captureId)
      if (capture) {
        captures.push(capture)
      }
    }

    return captures
  } finally {
    database.close()
    runtime.close()
  }
}


async function loadCaptureSyncState(
  vault: string,
  currentCursor: number | null,
): Promise<CaptureSyncState> {
  const headCursor = await readInboxCaptureMutationHead(vault)
  if (currentCursor === null || headCursor < currentCursor) {
    return {
      kind: 'rebuild',
      headCursor,
      captures: await listAllInboxCapturesByCreatedOrder(vault),
    }
  }

  if (headCursor === currentCursor) {
    return {
      kind: 'noop',
      headCursor,
    }
  }

  const changedCaptureIds = new Map<string, number>()
  let afterCursor = currentCursor

  while (afterCursor < headCursor) {
    const batch = await listInboxCaptureMutations({
      afterCursor,
      limit: CAPTURE_SYNC_BATCH_SIZE,
      vaultRoot: vault,
    })
    if (batch.length === 0) {
      break
    }

    for (const mutation of batch) {
      changedCaptureIds.set(mutation.captureId, mutation.cursor)
    }
    afterCursor = batch[batch.length - 1]!.cursor
  }

  return {
    kind: 'incremental',
    changedCaptureIds: [...changedCaptureIds.entries()]
      .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
      .map(([captureId]) => captureId),
    captures: await readInboxCapturesById(vault, [...changedCaptureIds.keys()]),
    headCursor,
  }
}

async function readInboxCapturesById(
  vault: string,
  captureIds: readonly string[],
): Promise<InboxCaptureRecord[]> {
  const runtime = await openInboxRuntime({ vaultRoot: vault })
  try {
    const captures: InboxCaptureRecord[] = []
    for (const captureId of captureIds) {
      const capture = runtime.getCapture(captureId)
      if (capture) {
        captures.push(capture)
      }
    }
    return captures
  } finally {
    runtime.close()
  }
}

async function withGatewayImmediateTransaction<T>(
  database: DatabaseSync,
  callback: () => Promise<T>,
): Promise<T> {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = await callback()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function ensureGatewayStoreSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS gateway_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gateway_capture_sources (
      capture_id TEXT PRIMARY KEY,
      route_key TEXT NOT NULL,
      session_key TEXT NOT NULL,
      source TEXT NOT NULL,
      account_id TEXT,
      external_id TEXT NOT NULL,
      provider_message_id TEXT,
      actor_id TEXT,
      actor_display_name TEXT,
      actor_is_self INTEGER NOT NULL,
      directness TEXT,
      occurred_at TEXT NOT NULL,
      text TEXT,
      thread_id TEXT,
      thread_title TEXT,
      message_id TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS gateway_capture_attachments (
      capture_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      source_attachment_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      mime TEXT,
      file_name TEXT,
      byte_size INTEGER,
      parse_state TEXT,
      extracted_text TEXT,
      transcript_text TEXT,
      PRIMARY KEY (capture_id, ordinal)
    );

    CREATE TABLE IF NOT EXISTS gateway_session_sources (
      session_id TEXT PRIMARY KEY,
      route_key TEXT NOT NULL,
      session_key TEXT NOT NULL,
      alias TEXT,
      channel TEXT,
      identity_id TEXT,
      participant_id TEXT,
      thread_id TEXT,
      directness TEXT,
      reply_kind TEXT,
      reply_target TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gateway_outbox_sources (
      intent_id TEXT PRIMARY KEY,
      route_key TEXT NOT NULL,
      session_key TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT,
      message TEXT NOT NULL,
      channel TEXT,
      identity_id TEXT,
      actor_id TEXT,
      thread_id TEXT,
      directness TEXT,
      reply_kind TEXT,
      reply_target TEXT,
      provider_message_id TEXT,
      provider_thread_id TEXT,
      reply_to_message_id TEXT,
      message_id TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS gateway_permissions (
      request_id TEXT PRIMARY KEY,
      session_key TEXT,
      action TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      resolved_at TEXT,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS gateway_conversations (
      session_key TEXT PRIMARY KEY,
      route_key TEXT NOT NULL,
      last_activity_at TEXT,
      message_count INTEGER,
      can_send INTEGER NOT NULL,
      conversation_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gateway_messages (
      message_id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      direction TEXT NOT NULL,
      provider_message_id TEXT,
      provider_thread_id TEXT,
      message_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gateway_attachments (
      attachment_id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      message_id TEXT NOT NULL,
      attachment_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gateway_events (
      cursor INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      session_key TEXT,
      message_id TEXT,
      permission_request_id TEXT,
      summary TEXT
    );

    CREATE INDEX IF NOT EXISTS gateway_capture_sources_route_provider_idx
      ON gateway_capture_sources(route_key, provider_message_id, actor_is_self);
    CREATE INDEX IF NOT EXISTS gateway_outbox_sources_route_provider_idx
      ON gateway_outbox_sources(route_key, provider_message_id);
    CREATE INDEX IF NOT EXISTS gateway_conversations_activity_idx
      ON gateway_conversations(last_activity_at DESC, session_key ASC);
    CREATE INDEX IF NOT EXISTS gateway_messages_session_created_idx
      ON gateway_messages(session_key, created_at ASC, message_id ASC);
    CREATE INDEX IF NOT EXISTS gateway_attachments_message_idx
      ON gateway_attachments(message_id);
    CREATE INDEX IF NOT EXISTS gateway_attachments_session_idx
      ON gateway_attachments(session_key);
  `)
}

function clearCaptureSources(database: DatabaseSync): void {
  database.prepare('DELETE FROM gateway_capture_attachments').run()
  database.prepare('DELETE FROM gateway_capture_sources').run()
}

function replaceCaptureSourcesForCaptureIds(
  database: DatabaseSync,
  captureIds: readonly string[],
  captures: readonly InboxCaptureRecord[],
): void {
  const deleteAttachments = database.prepare(
    'DELETE FROM gateway_capture_attachments WHERE capture_id = ?',
  )
  const deleteCapture = database.prepare('DELETE FROM gateway_capture_sources WHERE capture_id = ?')

  for (const captureId of new Set(captureIds)) {
    deleteAttachments.run(captureId)
    deleteCapture.run(captureId)
  }

  upsertCaptureSources(database, captures)
}

function upsertCaptureSources(database: DatabaseSync, captures: readonly InboxCaptureRecord[]): void {
  const upsertCapture = database.prepare(`
    INSERT INTO gateway_capture_sources (
      capture_id,
      route_key,
      session_key,
      source,
      account_id,
      external_id,
      provider_message_id,
      actor_id,
      actor_display_name,
      actor_is_self,
      directness,
      occurred_at,
      text,
      thread_id,
      thread_title,
      message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(capture_id) DO UPDATE SET
      route_key = excluded.route_key,
      session_key = excluded.session_key,
      source = excluded.source,
      account_id = excluded.account_id,
      external_id = excluded.external_id,
      provider_message_id = excluded.provider_message_id,
      actor_id = excluded.actor_id,
      actor_display_name = excluded.actor_display_name,
      actor_is_self = excluded.actor_is_self,
      directness = excluded.directness,
      occurred_at = excluded.occurred_at,
      text = excluded.text,
      thread_id = excluded.thread_id,
      thread_title = excluded.thread_title,
      message_id = excluded.message_id
  `)
  const insertAttachment = database.prepare(`
    INSERT INTO gateway_capture_attachments (
      capture_id,
      ordinal,
      source_attachment_id,
      attachment_id,
      kind,
      mime,
      file_name,
      byte_size,
      parse_state,
      extracted_text,
      transcript_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const deleteAttachments = database.prepare(
    'DELETE FROM gateway_capture_attachments WHERE capture_id = ?',
  )

  for (const capture of captures) {
    const route = gatewayConversationRouteFromCapture(capture)
    const routeKey = resolveGatewayConversationRouteKey(route)
    if (!routeKey) {
      continue
    }

    const sessionKey = createGatewayConversationSessionKey(routeKey)
    const messageId = createGatewayCaptureMessageId(routeKey, capture.captureId)
    upsertCapture.run(
      capture.captureId,
      routeKey,
      sessionKey,
      capture.source,
      normalizeNullableString(capture.accountId ?? null),
      capture.externalId,
      resolveCaptureProviderMessageId(capture),
      normalizeNullableString(capture.actor.id ?? null),
      normalizeNullableString(capture.actor.displayName ?? null),
      capture.actor.isSelf ? 1 : 0,
      route.directness,
      capture.occurredAt,
      capture.text,
      normalizeNullableString(capture.thread.id),
      normalizeNullableString(capture.thread.title ?? null),
      messageId,
    )

    deleteAttachments.run(capture.captureId)
    for (const attachment of capture.attachments) {
      const sourceAttachmentId = normalizeAttachmentSourceId(attachment)
      insertAttachment.run(
        capture.captureId,
        attachment.ordinal,
        sourceAttachmentId,
        createGatewayAttachmentId(routeKey, capture.captureId, sourceAttachmentId),
        attachment.kind,
        attachment.mime ?? null,
        attachment.fileName ?? null,
        attachment.byteSize ?? null,
        normalizeNullableString(attachment.parseState ?? null),
        attachment.extractedText ?? null,
        attachment.transcriptText ?? null,
      )
    }
  }
}

function replaceSessionSources(database: DatabaseSync, sessions: readonly AssistantSession[]): void {
  database.prepare('DELETE FROM gateway_session_sources').run()
  const insert = database.prepare(`
    INSERT INTO gateway_session_sources (
      session_id,
      route_key,
      session_key,
      alias,
      channel,
      identity_id,
      participant_id,
      thread_id,
      directness,
      reply_kind,
      reply_target,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const session of sessions) {
    const route = gatewayConversationRouteFromBinding(session.binding)
    const routeKey = resolveGatewayConversationRouteKey(route)
    if (!routeKey) {
      continue
    }

    insert.run(
      session.sessionId,
      routeKey,
      createGatewayConversationSessionKey(routeKey),
      normalizeNullableString(session.alias),
      route.channel,
      route.identityId,
      route.participantId,
      route.threadId,
      route.directness,
      route.reply.kind,
      route.reply.target,
      session.updatedAt,
    )
  }
}

function replaceOutboxSources(database: DatabaseSync, intents: readonly AssistantOutboxIntent[]): void {
  database.prepare('DELETE FROM gateway_outbox_sources').run()
  const insert = database.prepare(`
    INSERT INTO gateway_outbox_sources (
      intent_id,
      route_key,
      session_key,
      status,
      created_at,
      updated_at,
      sent_at,
      message,
      channel,
      identity_id,
      actor_id,
      thread_id,
      directness,
      reply_kind,
      reply_target,
      provider_message_id,
      provider_thread_id,
      reply_to_message_id,
      message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const intent of intents) {
    const route = gatewayConversationRouteFromOutboxIntent(intent)
    const routeKey = resolveGatewayConversationRouteKey(route)
    if (!routeKey) {
      continue
    }

    insert.run(
      intent.intentId,
      routeKey,
      createGatewayConversationSessionKey(routeKey),
      intent.status,
      intent.createdAt,
      intent.updatedAt,
      intent.sentAt,
      intent.message,
      route.channel,
      route.identityId,
      route.participantId,
      route.threadId,
      route.directness,
      route.reply.kind,
      route.reply.target,
      intent.delivery?.providerMessageId ?? null,
      intent.delivery?.providerThreadId ?? null,
      normalizeNullableString(intent.replyToMessageId),
      createGatewayOutboxMessageId(routeKey, intent.intentId),
    )
  }
}

function rebuildSnapshotState(database: DatabaseSync): void {
  const nextSnapshot = buildSnapshotFromDatabase(database)
  const nextState = applyGatewayProjectionSnapshotToEventLog(
    readSnapshotState(database),
    nextSnapshot,
    DEFAULT_GATEWAY_EVENT_RETENTION,
  )
  writeSnapshotState(database, nextState)
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
      last_activity_at,
      message_count,
      can_send,
      conversation_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insertMessage = database.prepare(`
    INSERT INTO gateway_messages (
      message_id,
      session_key,
      created_at,
      direction,
      provider_message_id,
      provider_thread_id,
      message_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertAttachment = database.prepare(`
    INSERT INTO gateway_attachments (
      attachment_id,
      session_key,
      message_id,
      attachment_json
    ) VALUES (?, ?, ?, ?)
  `)

  for (const conversation of snapshot.conversations) {
    insertConversation.run(
      conversation.sessionKey,
      resolveGatewayConversationRouteKey(conversation.route) ?? conversation.sessionKey,
      conversation.lastActivityAt,
      conversation.messageCount,
      conversation.canSend ? 1 : 0,
      JSON.stringify(conversation),
    )
  }

  for (const message of snapshot.messages) {
    insertMessage.run(
      message.messageId,
      message.sessionKey,
      message.createdAt,
      message.direction,
      null,
      null,
      JSON.stringify(message),
    )
    for (const attachment of message.attachments) {
      insertAttachment.run(
        attachment.attachmentId,
        message.sessionKey,
        message.messageId,
        JSON.stringify(attachment),
      )
    }
  }
}

function hasGatewayServingSnapshot(database: DatabaseSync): boolean {
  return readGatewayTableCount(database, 'gateway_conversations') > 0 ||
    readGatewayTableCount(database, 'gateway_messages') > 0 ||
    readGatewayTableCount(database, 'gateway_permissions') > 0
}

function readGatewayTableCount(database: DatabaseSync, tableName: string): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    .get() as { count: number | null }
  return row.count ?? 0
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
    routeKey,
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

function resolveCaptureProviderMessageId(capture: InboxCaptureRecord): string | null {
  switch (capture.source) {
    case 'email':
      return stripKnownProviderPrefix(capture.externalId, 'email:')
    case 'linq':
      return stripKnownProviderPrefix(capture.externalId, 'linq:')
    case 'telegram': {
      const telegramMessageId =
        extractNestedNumber(capture.raw, ['message', 'message_id']) ??
        extractNestedNumber(capture.raw, ['edited_message', 'message_id']) ??
        extractNestedNumber(capture.raw, ['channel_post', 'message_id'])
      return telegramMessageId !== null ? String(telegramMessageId) : null
    }
    default:
      return normalizeNullableString(capture.externalId)
  }
}

function normalizeAttachmentSourceId(attachment: IndexedAttachment): string {
  return normalizeNullableString(attachment.externalId ?? null) ?? attachment.attachmentId
}

function stripKnownProviderPrefix(value: string | null | undefined, prefix: string): string | null {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return null
  }
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized
}

function extractNestedNumber(value: unknown, path: readonly string[]): number | null {
  let cursor: unknown = value
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
      return null
    }
    cursor = (cursor as Record<string, unknown>)[key]
  }

  return typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : null
}

function readSessionSourceRows(database: DatabaseSync): SessionSourceRow[] {
  return database.prepare(`
    SELECT
      session_id AS sessionId,
      route_key AS routeKey,
      session_key AS sessionKey,
      alias,
      channel,
      identity_id AS identityId,
      participant_id AS participantId,
      thread_id AS threadId,
      directness,
      reply_kind AS replyKind,
      reply_target AS replyTarget,
      updated_at AS updatedAt
    FROM gateway_session_sources
  `).all() as unknown as SessionSourceRow[]
}

function readOutboxSourceRows(database: DatabaseSync): OutboxSourceRow[] {
  return database.prepare(`
    SELECT
      intent_id AS intentId,
      route_key AS routeKey,
      session_key AS sessionKey,
      status,
      created_at AS createdAt,
      updated_at AS updatedAt,
      sent_at AS sentAt,
      message,
      channel,
      identity_id AS identityId,
      actor_id AS actorId,
      thread_id AS threadId,
      directness,
      reply_kind AS replyKind,
      reply_target AS replyTarget,
      provider_message_id AS providerMessageId,
      provider_thread_id AS providerThreadId,
      message_id AS messageId
    FROM gateway_outbox_sources
  `).all() as unknown as OutboxSourceRow[]
}

function readCaptureSourceRows(database: DatabaseSync): CaptureSourceRow[] {
  return database.prepare(`
    SELECT
      capture_id AS captureId,
      route_key AS routeKey,
      session_key AS sessionKey,
      source,
      account_id AS accountId,
      provider_message_id AS providerMessageId,
      actor_id AS actorId,
      actor_display_name AS actorDisplayName,
      actor_is_self AS actorIsSelf,
      directness,
      occurred_at AS occurredAt,
      text,
      thread_id AS threadId,
      thread_title AS threadTitle,
      message_id AS messageId
    FROM gateway_capture_sources
    ORDER BY occurred_at ASC, capture_id ASC
  `).all() as unknown as CaptureSourceRow[]
}

function readCaptureAttachmentRows(database: DatabaseSync): CaptureAttachmentRow[] {
  return database.prepare(`
    SELECT
      capture_id AS captureId,
      ordinal,
      attachment_id AS attachmentId,
      kind,
      mime,
      file_name AS fileName,
      byte_size AS byteSize,
      parse_state AS parseState,
      extracted_text AS extractedText,
      transcript_text AS transcriptText
    FROM gateway_capture_attachments
  `).all() as unknown as CaptureAttachmentRow[]
}

function readPermissionRows(database: DatabaseSync): Array<{
  action: string
  description: string | null
  note: string | null
  requestId: string
  requestedAt: string
  resolvedAt: string | null
  sessionKey: string | null
  status: GatewayPermissionRequest['status']
}> {
  return database.prepare(`
    SELECT
      request_id AS requestId,
      session_key AS sessionKey,
      action,
      description,
      status,
      requested_at AS requestedAt,
      resolved_at AS resolvedAt,
      note
    FROM gateway_permissions
    ORDER BY requested_at ASC, request_id ASC
  `).all() as Array<{
    action: string
    description: string | null
    note: string | null
    requestId: string
    requestedAt: string
    resolvedAt: string | null
    sessionKey: string | null
    status: GatewayPermissionRequest['status']
  }>
}

function readSnapshotState(database: DatabaseSync): GatewaySnapshotState {
  return {
    events: readStoredEvents(database),
    nextCursor: readNextCursor(database),
    snapshot: readStoredSnapshot(database),
  }
}

function writeSnapshotState(database: DatabaseSync, state: GatewaySnapshotState): void {
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
}

function readStoredSnapshot(database: DatabaseSync): GatewayProjectionSnapshot | null {
  if (!hasGatewayServingSnapshot(database)) {
    return null
  }

  const conversations = database
    .prepare(`
      SELECT conversation_json AS conversationJson
      FROM gateway_conversations
      ORDER BY coalesce(last_activity_at, '') DESC, session_key ASC
    `)
    .all()
    .map((row) =>
      gatewayConversationSchema.parse(
        JSON.parse((row as { conversationJson: string }).conversationJson),
      ),
    ) as GatewayConversation[]

  const messages = database
    .prepare(`
      SELECT message_json AS messageJson
      FROM gateway_messages
      ORDER BY created_at ASC, message_id ASC
    `)
    .all()
    .map((row) =>
      gatewayMessageSchema.parse(
        JSON.parse((row as { messageJson: string }).messageJson),
      ),
    )

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

function readSnapshotOrEmpty(database: DatabaseSync): GatewayProjectionSnapshot {
  return readStoredSnapshot(database) ?? gatewayProjectionSnapshotSchema.parse({
    schema: 'murph.gateway-projection-snapshot.v1',
    generatedAt: new Date().toISOString(),
    conversations: [],
    messages: [],
    permissions: [],
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

function listOpenPermissionsFromDatabase(
  database: DatabaseSync,
  sessionKey: string | null,
): GatewayPermissionRequest[] {
  return readPermissionRows(database)
    .map((row) =>
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
    .filter((permission) => permission.status === 'open')
    .filter(
      (permission) =>
        !sessionKey ||
        (permission.sessionKey !== null &&
          sameGatewayConversationSession(permission.sessionKey, sessionKey)),
    )
}

function respondToPermissionInDatabase(
  database: DatabaseSync,
  input: GatewayRespondToPermissionInput,
): GatewayPermissionRequest | null {
  const existing = database
    .prepare(`
      SELECT
        request_id AS requestId,
        session_key AS sessionKey,
        action,
        description,
        status,
        requested_at AS requestedAt,
        resolved_at AS resolvedAt,
        note
      FROM gateway_permissions
      WHERE request_id = ?
    `)
    .get(input.requestId) as {
      action: string
      description: string | null
      note: string | null
      requestId: string
      requestedAt: string
      resolvedAt: string | null
      sessionKey: string | null
      status: GatewayPermissionRequest['status']
    } | undefined

  if (!existing) {
    return null
  }

  const resolvedAt = new Date().toISOString()
  const status = input.decision === 'approve' ? 'approved' : 'denied'
  database.prepare(`
    UPDATE gateway_permissions
       SET status = ?,
           resolved_at = ?,
           note = ?
     WHERE request_id = ?
  `).run(status, resolvedAt, normalizeNullableString(input.note), input.requestId)

  rebuildSnapshotState(database)

  return gatewayPermissionRequestSchema.parse({
    schema: 'murph.gateway-permission-request.v1',
    requestId: existing.requestId,
    sessionKey: existing.sessionKey,
    action: existing.action,
    description: existing.description,
    status,
    requestedAt: existing.requestedAt,
    resolvedAt,
    note: normalizeNullableString(input.note),
  })
}

function computeSessionSyncSignature(sessions: readonly AssistantSession[]): string {
  return JSON.stringify(
    [...sessions]
      .map((session) => ({
        alias: normalizeNullableString(session.alias),
        binding: session.binding,
        sessionId: session.sessionId,
        updatedAt: session.updatedAt,
      }))
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
  )
}

function computeOutboxSyncSignature(intents: readonly AssistantOutboxIntent[]): string {
  return JSON.stringify(
    [...intents]
      .map((intent) => ({
        bindingDelivery: intent.bindingDelivery,
        delivery: intent.delivery,
        intentId: intent.intentId,
        replyToMessageId: normalizeNullableString(intent.replyToMessageId),
        sentAt: intent.sentAt,
        status: intent.status,
        updatedAt: intent.updatedAt,
      }))
      .sort((left, right) => left.intentId.localeCompare(right.intentId)),
  )
}

function readMeta(database: DatabaseSync, key: string): string | null {
  const row = database
    .prepare('SELECT value FROM gateway_meta WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

function readNumericMeta(database: DatabaseSync, key: string): number | null {
  const value = readMeta(database, key)
  if (value === null) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function writeMeta(database: DatabaseSync, key: string, value: string | null): void {
  if (value === null) {
    database.prepare('DELETE FROM gateway_meta WHERE key = ?').run(key)
    return
  }

  database
    .prepare(`
      INSERT INTO gateway_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    .run(key, value)
}

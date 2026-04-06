import type { DatabaseSync } from 'node:sqlite'

import {
  listInboxCaptureMutations,
  openInboxRuntime,
  readInboxCaptureMutationHead,
  type InboxCaptureRecord,
  type IndexedAttachment,
} from '@murphai/inboxd/runtime'
import {
  openSqliteRuntimeDatabase,
  resolveInboxRuntimePaths,
} from '@murphai/runtime-state/node'

import type { GatewayAttachment, GatewayConversationRoute } from '@murphai/gateway-core'
import type {
  GatewayLocalOutboxSource,
  GatewayLocalSessionSource,
} from '@murphai/gateway-core'
import {
  createGatewayAttachmentId,
  createGatewayCaptureMessageId,
  createGatewayConversationSessionKey,
  createGatewayOutboxMessageId,
} from '@murphai/gateway-core'
import {
  gatewayConversationRouteFromBinding,
  gatewayConversationRouteFromCapture,
  gatewayConversationRouteFromOutboxIntent,
  resolveGatewayConversationRouteKey,
} from '@murphai/gateway-core'
import { normalizeNullableString } from '../shared.js'

const CAPTURE_SYNC_BATCH_SIZE = 500

type GatewaySourceEventKind = 'capture' | 'outbox' | 'session'

interface GatewaySourceEventRow {
  actorDisplayName: string | null
  actorId: string | null
  actorIsSelf: number
  alias: string | null
  directness: GatewayConversationRoute['directness']
  identityId: string | null
  messageId: string | null
  occurredAt: string
  providerMessageId: string | null
  providerThreadId: string | null
  replyKind: GatewayConversationRoute['reply']['kind']
  replyTarget: string | null
  routeKey: string
  sessionKey: string
  source: string | null
  sourceEventId: string
  sourceEventKind: GatewaySourceEventKind
  sourceRecordId: string
  status: GatewayLocalOutboxSource['status'] | null
  text: string | null
  threadId: string | null
  threadTitle: string | null
}

export interface CaptureSourceRow {
  actorDisplayName: string | null
  actorId: string | null
  actorIsSelf: number
  directness: GatewayConversationRoute['directness']
  identityId: string | null
  messageId: string
  occurredAt: string
  providerMessageId: string | null
  routeKey: string
  sessionKey: string
  source: string
  sourceRecordId: string
  text: string | null
  threadId: string | null
  threadTitle: string | null
}

export interface CaptureAttachmentRow {
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

export interface SessionSourceRow {
  alias: string | null
  directness: GatewayConversationRoute['directness']
  identityId: string | null
  participantId: string | null
  replyKind: GatewayConversationRoute['reply']['kind']
  replyTarget: string | null
  routeKey: string
  sessionKey: string
  source: string | null
  sourceRecordId: string
  threadId: string | null
  updatedAt: string
}

export interface OutboxSourceRow {
  actorId: string | null
  createdAt: string
  directness: GatewayConversationRoute['directness']
  identityId: string | null
  message: string
  messageId: string
  providerMessageId: string | null
  providerThreadId: string | null
  replyKind: GatewayConversationRoute['reply']['kind']
  replyTarget: string | null
  routeKey: string
  sentAt: string | null
  sessionKey: string
  source: string | null
  sourceRecordId: string
  status: GatewayLocalOutboxSource['status']
  threadId: string | null
  updatedAt: string
}

export type CaptureSyncState =
  | { kind: 'noop'; headCursor: number }
  | { kind: 'rebuild'; headCursor: number; captures: InboxCaptureRecord[] }
  | {
    kind: 'incremental'
    changedCaptureIds: string[]
    captures: InboxCaptureRecord[]
    headCursor: number
  }

export async function listAllInboxCapturesByCreatedOrder(
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

export function clearCaptureSources(database: DatabaseSync): void {
  database.prepare('DELETE FROM gateway_capture_attachments').run()
  database
    .prepare("DELETE FROM gateway_source_events WHERE source_event_kind = 'capture'")
    .run()
}

export function replaceCaptureSourcesForCaptureIds(
  database: DatabaseSync,
  captureIds: readonly string[],
  captures: readonly InboxCaptureRecord[],
): void {
  const deleteAttachments = database.prepare(
    'DELETE FROM gateway_capture_attachments WHERE capture_id = ?',
  )
  const deleteCapture = database.prepare(`
    DELETE FROM gateway_source_events
    WHERE source_event_kind = 'capture' AND source_record_id = ?
  `)

  for (const captureId of new Set(captureIds)) {
    deleteAttachments.run(captureId)
    deleteCapture.run(captureId)
  }

  upsertCaptureSources(database, captures)
}

export function upsertCaptureSources(database: DatabaseSync, captures: readonly InboxCaptureRecord[]): void {
  const upsertCapture = database.prepare(`
    INSERT INTO gateway_source_events (
      source_event_id,
      source_event_kind,
      source_record_id,
      route_key,
      session_key,
      source,
      identity_id,
      actor_id,
      actor_display_name,
      actor_is_self,
      alias,
      directness,
      occurred_at,
      text,
      thread_id,
      thread_title,
      reply_kind,
      reply_target,
      status,
      sent_at,
      provider_message_id,
      provider_thread_id,
      message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_event_id) DO UPDATE SET
      route_key = excluded.route_key,
      session_key = excluded.session_key,
      source = excluded.source,
      identity_id = excluded.identity_id,
      actor_id = excluded.actor_id,
      actor_display_name = excluded.actor_display_name,
      actor_is_self = excluded.actor_is_self,
      directness = excluded.directness,
      occurred_at = excluded.occurred_at,
      text = excluded.text,
      thread_id = excluded.thread_id,
      thread_title = excluded.thread_title,
      provider_message_id = excluded.provider_message_id,
      provider_thread_id = excluded.provider_thread_id,
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
      `capture:${capture.captureId}`,
      'capture',
      capture.captureId,
      routeKey,
      sessionKey,
      capture.source,
      resolveCaptureIdentityId(capture),
      normalizeNullableString(capture.actor.id ?? null),
      normalizeNullableString(capture.actor.displayName ?? null),
      capture.actor.isSelf ? 1 : 0,
      null,
      route.directness,
      capture.occurredAt,
      capture.text,
      normalizeNullableString(capture.thread.id),
      normalizeNullableString(capture.thread.title ?? null),
      null,
      null,
      null,
      null,
      resolveCaptureProviderMessageId(capture),
      normalizeNullableString(capture.thread.id),
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

export function replaceSessionSources(database: DatabaseSync, sessions: readonly GatewayLocalSessionSource[]): void {
  database
    .prepare("DELETE FROM gateway_source_events WHERE source_event_kind = 'session'")
    .run()
  const insert = database.prepare(`
    INSERT INTO gateway_source_events (
      source_event_id,
      source_event_kind,
      source_record_id,
      route_key,
      session_key,
      source,
      identity_id,
      actor_id,
      actor_display_name,
      actor_is_self,
      alias,
      directness,
      occurred_at,
      text,
      thread_id,
      thread_title,
      reply_kind,
      reply_target,
      status,
      sent_at,
      provider_message_id,
      provider_thread_id,
      message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const session of sessions) {
    const route = gatewayConversationRouteFromBinding(session.binding)
    const routeKey = resolveGatewayConversationRouteKey(route)
    if (!routeKey) {
      continue
    }

    insert.run(
      `session:${session.sessionId}`,
      'session',
      session.sessionId,
      routeKey,
      createGatewayConversationSessionKey(routeKey),
      route.channel,
      route.identityId,
      route.participantId,
      null,
      0,
      normalizeNullableString(session.alias),
      route.directness,
      session.updatedAt,
      null,
      route.threadId,
      null,
      route.reply.kind,
      route.reply.target,
      null,
      null,
      null,
      null,
      null,
    )
  }
}

export function replaceOutboxSources(database: DatabaseSync, intents: readonly GatewayLocalOutboxSource[]): void {
  database
    .prepare("DELETE FROM gateway_source_events WHERE source_event_kind = 'outbox'")
    .run()
  const insert = database.prepare(`
    INSERT INTO gateway_source_events (
      source_event_id,
      source_event_kind,
      source_record_id,
      route_key,
      session_key,
      source,
      identity_id,
      actor_id,
      actor_display_name,
      actor_is_self,
      alias,
      directness,
      occurred_at,
      text,
      thread_id,
      thread_title,
      reply_kind,
      reply_target,
      status,
      sent_at,
      provider_message_id,
      provider_thread_id,
      message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const intent of intents) {
    const route = gatewayConversationRouteFromOutboxIntent(intent)
    const routeKey = resolveGatewayConversationRouteKey(route)
    if (!routeKey) {
      continue
    }

    insert.run(
      `outbox:${intent.intentId}`,
      'outbox',
      intent.intentId,
      routeKey,
      createGatewayConversationSessionKey(routeKey),
      route.channel,
      route.identityId,
      route.participantId,
      null,
      1,
      null,
      route.directness,
      intent.sentAt ?? intent.updatedAt,
      intent.message,
      route.threadId,
      null,
      route.reply.kind,
      route.reply.target,
      intent.status,
      intent.sentAt,
      intent.delivery?.providerMessageId ?? null,
      intent.delivery?.providerThreadId ?? null,
      createGatewayOutboxMessageId(routeKey, intent.intentId),
    )
  }
}

export function computeSessionSyncSignature(sessions: readonly GatewayLocalSessionSource[]): string {
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

export function computeOutboxSyncSignature(intents: readonly GatewayLocalOutboxSource[]): string {
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

export function readSessionSourceRows(database: DatabaseSync): SessionSourceRow[] {
  return database.prepare(`
    SELECT
      source_record_id AS sourceRecordId,
      route_key AS routeKey,
      session_key AS sessionKey,
      alias,
      source,
      identity_id AS identityId,
      actor_id AS participantId,
      thread_id AS threadId,
      directness,
      reply_kind AS replyKind,
      reply_target AS replyTarget,
      occurred_at AS updatedAt
    FROM gateway_source_events
    WHERE source_event_kind = 'session'
  `).all() as unknown as SessionSourceRow[]
}

export function readOutboxSourceRows(database: DatabaseSync): OutboxSourceRow[] {
  return database.prepare(`
    SELECT
      source_record_id AS sourceRecordId,
      route_key AS routeKey,
      session_key AS sessionKey,
      status,
      occurred_at AS createdAt,
      occurred_at AS updatedAt,
      sent_at AS sentAt,
      text AS message,
      source,
      identity_id AS identityId,
      actor_id AS actorId,
      thread_id AS threadId,
      directness,
      reply_kind AS replyKind,
      reply_target AS replyTarget,
      provider_message_id AS providerMessageId,
      provider_thread_id AS providerThreadId,
      message_id AS messageId
    FROM gateway_source_events
    WHERE source_event_kind = 'outbox'
  `).all() as unknown as OutboxSourceRow[]
}

export function readCaptureSourceRows(database: DatabaseSync): CaptureSourceRow[] {
  return database.prepare(`
    SELECT
      source_record_id AS sourceRecordId,
      route_key AS routeKey,
      session_key AS sessionKey,
      source,
      identity_id AS identityId,
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
    FROM gateway_source_events
    WHERE source_event_kind = 'capture'
    ORDER BY occurred_at ASC, source_record_id ASC
  `).all() as unknown as CaptureSourceRow[]
}

export function readCaptureAttachmentRows(database: DatabaseSync): CaptureAttachmentRow[] {
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

export function readGatewaySourceEventCount(
  database: DatabaseSync,
  sourceEventKind: GatewaySourceEventKind,
): number {
  const row = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM gateway_source_events
      WHERE source_event_kind = ?
    `)
    .get(sourceEventKind) as { count: number | null }
  return row.count ?? 0
}

export async function loadCaptureSyncState(
  vault: string,
  currentCursor: number | null,
): Promise<CaptureSyncState> {
  const headCursor = await readInboxCaptureMutationHead(vault)

  async function rebuildState(): Promise<CaptureSyncState> {
    return {
      kind: 'rebuild',
      headCursor,
      captures: await listAllInboxCapturesByCreatedOrder(vault),
    }
  }

  if (currentCursor === null || headCursor < currentCursor) {
    return rebuildState()
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
      return rebuildState()
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

function resolveCaptureIdentityId(capture: InboxCaptureRecord): string | null {
  switch (capture.source) {
    case 'email':
    case 'linq':
      return normalizeNullableString(capture.accountId ?? null)
    default:
      return null
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

import type { DatabaseSync } from 'node:sqlite'

import {
  listInboxCaptureMutations,
  openInboxRuntime,
  readInboxCaptureMutationHead,
  type InboxCaptureRecord,
  type IndexedAttachment,
} from '@murphai/inboxd'
import {
  openSqliteRuntimeDatabase,
  resolveInboxRuntimePaths,
} from '@murphai/runtime-state/node'

import type { GatewayAttachment, GatewayConversationRoute } from '@murphai/gateway-core'
import type {
  GatewayLocalOutboxSource,
  GatewayLocalSessionSource,
} from '../assistant-adapter.js'
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

export interface CaptureSourceRow {
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

export interface OutboxSourceRow {
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
  database.prepare('DELETE FROM gateway_capture_sources').run()
}

export function replaceCaptureSourcesForCaptureIds(
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

export function upsertCaptureSources(database: DatabaseSync, captures: readonly InboxCaptureRecord[]): void {
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

export function replaceSessionSources(database: DatabaseSync, sessions: readonly GatewayLocalSessionSource[]): void {
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

export function replaceOutboxSources(database: DatabaseSync, intents: readonly GatewayLocalOutboxSource[]): void {
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

export function readOutboxSourceRows(database: DatabaseSync): OutboxSourceRow[] {
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

export function readCaptureSourceRows(database: DatabaseSync): CaptureSourceRow[] {
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

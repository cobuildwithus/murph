import type { DatabaseSync } from 'node:sqlite'

export const GATEWAY_STORE_SQLITE_SCHEMA_VERSION = 1

export const SNAPSHOT_GENERATED_AT_META_KEY = 'snapshot.generatedAt'

export async function withGatewayImmediateTransaction<T>(
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

export function ensureGatewayStoreBaseSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS gateway_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gateway_source_events (
      source_event_id TEXT PRIMARY KEY,
      source_event_kind TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      route_key TEXT NOT NULL,
      session_key TEXT NOT NULL,
      source TEXT,
      identity_id TEXT,
      actor_id TEXT,
      actor_display_name TEXT,
      actor_is_self INTEGER NOT NULL,
      alias TEXT,
      directness TEXT,
      occurred_at TEXT NOT NULL,
      text TEXT,
      thread_id TEXT,
      thread_title TEXT,
      reply_kind TEXT,
      reply_target TEXT,
      status TEXT,
      sent_at TEXT,
      provider_message_id TEXT,
      provider_thread_id TEXT,
      message_id TEXT
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

    CREATE TABLE IF NOT EXISTS gateway_events (
      cursor INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      session_key TEXT,
      message_id TEXT,
      permission_request_id TEXT,
      summary TEXT
    );

    CREATE INDEX IF NOT EXISTS gateway_source_events_kind_record_idx
      ON gateway_source_events(source_event_kind, source_record_id);
    CREATE INDEX IF NOT EXISTS gateway_source_events_kind_route_provider_idx
      ON gateway_source_events(source_event_kind, route_key, provider_message_id, actor_is_self);
    CREATE INDEX IF NOT EXISTS gateway_source_events_kind_session_occurred_idx
      ON gateway_source_events(source_event_kind, session_key, occurred_at);
    CREATE UNIQUE INDEX IF NOT EXISTS gateway_source_events_message_idx
      ON gateway_source_events(message_id)
      WHERE message_id IS NOT NULL;
  `)
}

export function readMeta(database: DatabaseSync, key: string): string | null {
  const row = database
    .prepare('SELECT value FROM gateway_meta WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function readNumericMeta(database: DatabaseSync, key: string): number | null {
  const value = readMeta(database, key)
  if (value === null) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function writeMeta(database: DatabaseSync, key: string, value: string | null): void {
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

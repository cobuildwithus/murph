/**
 * Owns hosted runner Durable Object schema setup so the queue store can stay
 * focused on queue transitions rather than Durable Object DDL details.
 */

import { type DurableObjectSqlStorageLike } from "./types.js";
import { type DurableObjectSqlValue } from "./types.js";

export function ensureRunnerQueueSchema(sql: DurableObjectSqlStorageLike): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS runner_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      user_id TEXT NOT NULL,
      activated INTEGER NOT NULL DEFAULT 0,
      in_flight INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_error_at TEXT,
      last_error_code TEXT,
      last_event_id TEXT,
      last_run_at TEXT,
      next_wake_at TEXT,
      retrying_event_id TEXT,
      backpressured_event_ids_json TEXT NOT NULL DEFAULT '[]',
      agent_state_bundle_ref_json TEXT,
      vault_bundle_ref_json TEXT,
      run_json TEXT,
      timeline_json TEXT NOT NULL DEFAULT '[]',
      agent_state_bundle_version INTEGER NOT NULL DEFAULT 0,
      vault_bundle_version INTEGER NOT NULL DEFAULT 0
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS pending_events (
      event_id TEXT PRIMARY KEY,
      dispatch_json TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      available_at TEXT NOT NULL,
      enqueued_at TEXT NOT NULL,
      last_error TEXT
    )
  `);
  sql.exec(`
    CREATE INDEX IF NOT EXISTS pending_events_available_at_idx
    ON pending_events (available_at, enqueued_at, event_id)
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS consumed_events (
      event_id TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    )
  `);
  sql.exec(`
    CREATE INDEX IF NOT EXISTS consumed_events_expires_at_idx
    ON consumed_events (expires_at)
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS poisoned_events (
      event_id TEXT PRIMARY KEY,
      poisoned_at TEXT NOT NULL,
      last_error TEXT NOT NULL
    )
  `);
  sql.exec(`
    CREATE INDEX IF NOT EXISTS poisoned_events_poisoned_at_idx
    ON poisoned_events (poisoned_at, event_id)
  `);
  ensureRunnerMetaColumn(sql, "last_error_at", "TEXT");
  ensureRunnerMetaColumn(sql, "last_error_code", "TEXT");
  ensureRunnerMetaColumn(sql, "run_json", "TEXT");
  ensureRunnerMetaColumn(sql, "timeline_json", "TEXT NOT NULL DEFAULT '[]'");
  sql.exec("DROP TABLE IF EXISTS consumed_event_replay_filter");
}

function ensureRunnerMetaColumn(
  sql: DurableObjectSqlStorageLike,
  columnName: string,
  columnDefinition: string,
): void {
  const hasColumn = sql.exec<{ name: DurableObjectSqlValue }>(
    "PRAGMA table_info(runner_meta)",
  ).toArray().some((row) => row.name === columnName);

  if (!hasColumn) {
    sql.exec(`ALTER TABLE runner_meta ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

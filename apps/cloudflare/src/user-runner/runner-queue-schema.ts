/**
 * Owns hosted runner Durable Object schema setup so the queue store can stay
 * focused on queue transitions rather than Durable Object DDL details.
 */

import { type DurableObjectSqlStorageLike, type DurableObjectSqlValue } from "./types.js";

export function ensureRunnerQueueSchema(sql: DurableObjectSqlStorageLike): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS runner_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      user_id TEXT NOT NULL,
      runtime_bootstrapped INTEGER NOT NULL DEFAULT 0,
      in_flight INTEGER NOT NULL DEFAULT 0,
      last_error_at TEXT,
      last_error_code TEXT,
      last_run_at TEXT,
      next_wake_at TEXT
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS runner_bundle_slots (
      slot TEXT PRIMARY KEY,
      bundle_ref_json TEXT,
      bundle_version INTEGER NOT NULL DEFAULT 0
    )
  `);
  ensurePendingEventsTable(sql);
  sql.exec(`
    CREATE INDEX IF NOT EXISTS pending_events_available_at_idx
    ON pending_events (available_at, enqueued_at, event_id)
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS consumed_events (
      event_id TEXT PRIMARY KEY,
      recorded_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);
  sql.exec(`
    CREATE INDEX IF NOT EXISTS consumed_events_expires_at_idx
    ON consumed_events (expires_at)
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS backpressured_events (
      event_id TEXT PRIMARY KEY,
      rejected_at TEXT NOT NULL
    )
  `);
  sql.exec(`
    CREATE INDEX IF NOT EXISTS backpressured_events_rejected_at_idx
    ON backpressured_events (rejected_at, event_id)
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS poisoned_events (
      event_id TEXT PRIMARY KEY,
      poisoned_at TEXT NOT NULL,
      last_error_code TEXT NOT NULL
    )
  `);
  sql.exec(`
    CREATE INDEX IF NOT EXISTS poisoned_events_poisoned_at_idx
    ON poisoned_events (poisoned_at, event_id)
  `);
  migrateLegacyRunnerMetaActivatedColumn(sql);
  assertRunnerQueueTableColumns(sql, "runner_meta", {
    requiredColumns: [
      "singleton",
      "user_id",
      "runtime_bootstrapped",
      "in_flight",
      "last_error_at",
      "last_error_code",
      "last_run_at",
      "next_wake_at",
    ],
  });
  assertRunnerQueueTableColumns(sql, "runner_bundle_slots", {
    requiredColumns: [
      "slot",
      "bundle_ref_json",
      "bundle_version",
    ],
  });
  assertRunnerQueueTableColumns(sql, "pending_events", {
    forbiddenColumns: [
      "dispatch_json",
      "last_error",
    ],
    requiredColumns: [
      "event_id",
      "payload_key",
      "attempts",
      "available_at",
      "enqueued_at",
      "last_error_code",
    ],
  });
  assertRunnerQueueTableColumns(sql, "consumed_events", {
    requiredColumns: [
      "event_id",
      "recorded_at",
      "expires_at",
    ],
  });
  assertRunnerQueueTableColumns(sql, "backpressured_events", {
    requiredColumns: [
      "event_id",
      "rejected_at",
    ],
  });
  assertRunnerQueueTableColumns(sql, "poisoned_events", {
    requiredColumns: [
      "event_id",
      "poisoned_at",
      "last_error_code",
    ],
  });
}

function migrateLegacyRunnerMetaActivatedColumn(sql: DurableObjectSqlStorageLike): void {
  const columns = readRunnerQueueTableColumns(sql, "runner_meta");
  if (columns.length === 0 || !columns.includes("activated") || columns.includes("runtime_bootstrapped")) {
    return;
  }

  sql.exec(`ALTER TABLE runner_meta RENAME TO runner_meta_legacy`);
  sql.exec(`
    CREATE TABLE runner_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      user_id TEXT NOT NULL,
      runtime_bootstrapped INTEGER NOT NULL DEFAULT 0,
      in_flight INTEGER NOT NULL DEFAULT 0,
      last_error_at TEXT,
      last_error_code TEXT,
      last_run_at TEXT,
      next_wake_at TEXT
    )
  `);
  sql.exec(`
    INSERT INTO runner_meta (
      singleton,
      user_id,
      runtime_bootstrapped,
      in_flight,
      last_error_at,
      last_error_code,
      last_run_at,
      next_wake_at
    )
    SELECT
      singleton,
      user_id,
      activated,
      in_flight,
      last_error_at,
      last_error_code,
      last_run_at,
      next_wake_at
    FROM runner_meta_legacy
  `);
  sql.exec(`DROP TABLE runner_meta_legacy`);
}

function ensurePendingEventsTable(sql: DurableObjectSqlStorageLike): void {
  if (readRunnerQueueTableColumns(sql, "pending_events").length > 0) {
    return;
  }

  sql.exec(`
    CREATE TABLE IF NOT EXISTS pending_events (
      event_id TEXT PRIMARY KEY,
      payload_key TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      available_at TEXT NOT NULL,
      enqueued_at TEXT NOT NULL,
      last_error_code TEXT
    )
  `);
}

function readRunnerQueueTableColumns(
  sql: DurableObjectSqlStorageLike,
  tableName: string,
): string[] {
  return sql.exec<{ name: DurableObjectSqlValue }>(
    `PRAGMA table_info(${tableName})`,
  ).toArray().map((row) => row.name).filter((name): name is string => typeof name === "string");
}

function assertRunnerQueueTableColumns(
  sql: DurableObjectSqlStorageLike,
  tableName: string,
  input: {
    forbiddenColumns?: readonly string[];
    requiredColumns: readonly string[];
  },
): void {
  const actualColumns = readRunnerQueueTableColumns(sql, tableName);
  const forbiddenColumns = (input.forbiddenColumns ?? [])
    .filter((columnName) => actualColumns.includes(columnName));
  const missingColumns = input.requiredColumns
    .filter((columnName) => !actualColumns.includes(columnName));

  if (missingColumns.length === 0 && forbiddenColumns.length === 0) {
    return;
  }

  const details = [
    missingColumns.length > 0 ? `missing ${missingColumns.join(", ")}` : null,
    forbiddenColumns.length > 0 ? `forbidden ${forbiddenColumns.join(", ")}` : null,
  ].filter((value): value is string => value !== null);

  throw new Error(
    `Hosted runner Durable Object ${tableName} schema is unsupported; ${details.join("; ")}.`,
  );
}

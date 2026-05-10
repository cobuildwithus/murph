/**
 * Owns hosted runner Durable Object schema setup so the runner state store can
 * stay focused on thin lease/runtime transitions rather than Durable Object
 * DDL details.
 */

import { type DurableObjectSqlStorageLike, type DurableObjectSqlValue } from "./types.js";

const RUNNER_STATE_SCHEMA_VERSION = 4;

export function ensureRunnerStateSchema(sql: DurableObjectSqlStorageLike): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS runner_schema_meta (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS runner_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      user_id TEXT NOT NULL,
      active_invocation_id TEXT,
      active_invocation_last_heartbeat_at TEXT,
      active_invocation_reason TEXT,
      active_invocation_started_at TEXT,
      active_invocation_worker_version_id TEXT,
      active_invocation_expires_at TEXT,
      active_invocation_container_stopped_at TEXT,
      active_invocation_orphan_observed_at TEXT,
      active_workspace_version TEXT,
      alarm_kind TEXT,
      alarm_due_at TEXT,
      alarm_workspace_version TEXT,
      alarm_checkpoint_next_wake_at TEXT,
      lease_generation INTEGER NOT NULL DEFAULT 0,
      in_flight INTEGER NOT NULL DEFAULT 0,
      last_error_at TEXT,
      last_error_code TEXT,
      last_invocation_at TEXT,
      deferred_checkpoint_required INTEGER NOT NULL DEFAULT 0,
      idle_shutdown_checkpoint_due_at TEXT,
      idle_shutdown_checkpoint_workspace_version TEXT,
      next_wake_at TEXT,
      pending_nudge INTEGER NOT NULL DEFAULT 0,
      pending_work INTEGER NOT NULL DEFAULT 0,
      retry_failure_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  assertRunnerStateSchemaVersionSupported(sql);
  ensureRunnerStateTableColumn(sql, "runner_meta", "active_invocation_id", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "active_invocation_last_heartbeat_at", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "active_invocation_reason", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "active_invocation_started_at", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "active_invocation_worker_version_id", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "active_invocation_expires_at", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "active_invocation_container_stopped_at", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "active_invocation_orphan_observed_at", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "active_workspace_version", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "alarm_kind", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "alarm_due_at", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "alarm_workspace_version", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "alarm_checkpoint_next_wake_at", "TEXT");
  ensureRunnerStateTableColumn(
    sql,
    "runner_meta",
    "lease_generation",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureRunnerStateTableColumn(
    sql,
    "runner_meta",
    "pending_nudge",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureRunnerStateTableColumn(
    sql,
    "runner_meta",
    "pending_work",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureRunnerStateTableColumn(
    sql,
    "runner_meta",
    "retry_failure_count",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureRunnerStateTableColumn(
    sql,
    "runner_meta",
    "deferred_checkpoint_required",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureRunnerStateTableColumn(
    sql,
    "runner_meta",
    "idle_shutdown_checkpoint_due_at",
    "TEXT",
  );
  ensureRunnerStateTableColumn(
    sql,
    "runner_meta",
    "idle_shutdown_checkpoint_workspace_version",
    "TEXT",
  );
  markRunnerStateSchemaVersion(sql);
  migrateRunnerStateV1AlarmMirrors(sql);
  assertRunnerStateTableAbsent(sql, "runner_bundle_slots");
  assertRunnerStateTableColumns(sql, "runner_meta", {
    requiredColumns: [
      "singleton",
      "user_id",
      "active_invocation_id",
      "active_invocation_last_heartbeat_at",
      "active_invocation_reason",
      "active_invocation_started_at",
      "active_invocation_worker_version_id",
      "active_invocation_expires_at",
      "active_invocation_container_stopped_at",
      "active_invocation_orphan_observed_at",
      "active_workspace_version",
      "alarm_kind",
      "alarm_due_at",
      "alarm_workspace_version",
      "alarm_checkpoint_next_wake_at",
      "lease_generation",
      "in_flight",
      "last_error_at",
      "last_error_code",
      "last_invocation_at",
      "deferred_checkpoint_required",
      "idle_shutdown_checkpoint_due_at",
      "idle_shutdown_checkpoint_workspace_version",
      "next_wake_at",
      "pending_nudge",
      "pending_work",
      "retry_failure_count",
    ],
  });
}

function assertRunnerStateSchemaVersionSupported(sql: DurableObjectSqlStorageLike): void {
  const version = readRunnerStateSchemaVersion(sql);
  if (version > RUNNER_STATE_SCHEMA_VERSION) {
    throw new Error(
      `Hosted runner Durable Object schema version ${version} is newer than supported version ${RUNNER_STATE_SCHEMA_VERSION}.`,
    );
  }
}

function markRunnerStateSchemaVersion(sql: DurableObjectSqlStorageLike): void {
  const version = readRunnerStateSchemaVersion(sql);
  if (version >= RUNNER_STATE_SCHEMA_VERSION) {
    return;
  }

  sql.exec(
    `INSERT INTO runner_schema_meta (key, value)
     VALUES ('runner_state_schema_version', ${RUNNER_STATE_SCHEMA_VERSION})
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
}

function readRunnerStateSchemaVersion(sql: DurableObjectSqlStorageLike): number {
  const row = sql.exec<{ value: DurableObjectSqlValue }>(
    "SELECT value FROM runner_schema_meta WHERE key = 'runner_state_schema_version'",
  ).toArray()[0];
  const value = row?.value;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function migrateRunnerStateV1AlarmMirrors(sql: DurableObjectSqlStorageLike): void {
  sql.exec(`
    UPDATE runner_meta
    SET pending_work = CASE WHEN pending_nudge = 1 THEN 1 ELSE pending_work END
    WHERE singleton = 1
  `);
  sql.exec(`
    UPDATE runner_meta
    SET
      alarm_kind = 'idle_checkpoint',
      alarm_due_at = idle_shutdown_checkpoint_due_at,
      alarm_workspace_version = idle_shutdown_checkpoint_workspace_version,
      alarm_checkpoint_next_wake_at = next_wake_at
    WHERE singleton = 1
      AND alarm_kind IS NULL
      AND idle_shutdown_checkpoint_due_at IS NOT NULL
  `);
  sql.exec(`
    UPDATE runner_meta
    SET
      alarm_kind = 'work',
      alarm_due_at = next_wake_at,
      alarm_workspace_version = NULL,
      alarm_checkpoint_next_wake_at = NULL
    WHERE singleton = 1
      AND alarm_kind IS NULL
      AND idle_shutdown_checkpoint_due_at IS NULL
      AND next_wake_at IS NOT NULL
  `);
}

function assertRunnerStateTableAbsent(
  sql: DurableObjectSqlStorageLike,
  tableName: string,
): void {
  const rows = sql.exec<{ name: DurableObjectSqlValue }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`,
  ).toArray();
  if (rows.length > 0) {
    throw new Error(`runner_meta schema is unsupported; legacy ${tableName} table remains.`);
  }
}

function ensureRunnerStateTableColumn(
  sql: DurableObjectSqlStorageLike,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const actualColumns = readRunnerStateTableColumns(sql, tableName);
  if (actualColumns.includes(columnName)) {
    return;
  }

  sql.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function readRunnerStateTableColumns(
  sql: DurableObjectSqlStorageLike,
  tableName: string,
): string[] {
  return sql.exec<{ name: DurableObjectSqlValue }>(
    `PRAGMA table_info(${tableName})`,
  ).toArray().map((row) => row.name).filter((name): name is string => typeof name === "string");
}

function assertRunnerStateTableColumns(
  sql: DurableObjectSqlStorageLike,
  tableName: string,
  input: {
    requiredColumns: readonly string[];
  },
): void {
  const actualColumns = readRunnerStateTableColumns(sql, tableName);
  const missingColumns = input.requiredColumns
    .filter((columnName) => !actualColumns.includes(columnName));

  if (missingColumns.length === 0) {
    return;
  }

  throw new Error(
    `Hosted runner Durable Object ${tableName} schema is unsupported; missing ${missingColumns.join(", ")}.`,
  );
}

import { type DurableObjectSqlStorageLike, type DurableObjectSqlValue } from "./types.js";

const RUNNER_STATE_SCHEMA_VERSION = 13;

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
      wake_at TEXT,
      active_attempt_id TEXT,
      active_generation INTEGER NOT NULL DEFAULT 0,
      active_kind TEXT,
      active_provider_egress_token_hash TEXT,
      active_runner_container_name TEXT,
      active_reason TEXT,
      active_started_at TEXT,
      active_expires_at TEXT,
      active_workspace_version TEXT,
      backoff_until TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_error_at TEXT,
      last_error_code TEXT,
      last_invocation_at TEXT
    )
  `);

  assertRunnerStateSchemaVersionSupported(sql);
  for (const [columnName, definition] of Object.entries({
    wake_at: "TEXT",
    active_attempt_id: "TEXT",
    active_generation: "INTEGER NOT NULL DEFAULT 0",
    active_kind: "TEXT",
    active_provider_egress_token_hash: "TEXT",
    active_runner_container_name: "TEXT",
    active_reason: "TEXT",
    active_started_at: "TEXT",
    active_expires_at: "TEXT",
    active_workspace_version: "TEXT",
    backoff_until: "TEXT",
    failure_count: "INTEGER NOT NULL DEFAULT 0",
    last_error_at: "TEXT",
    last_error_code: "TEXT",
    last_invocation_at: "TEXT",
  })) {
    ensureRunnerStateTableColumn(sql, "runner_meta", columnName, definition);
  }

  migrateLegacyRunnerState(sql);
  markRunnerStateSchemaVersion(sql);
  assertRunnerStateTableAbsent(sql, "runner_bundle_slots");
  assertRunnerStateTableColumns(sql, "runner_meta", {
    requiredColumns: [
      "singleton",
      "user_id",
      "wake_at",
      "active_attempt_id",
      "active_generation",
      "active_kind",
      "active_provider_egress_token_hash",
      "active_runner_container_name",
      "active_reason",
      "active_started_at",
      "active_expires_at",
      "active_workspace_version",
      "backoff_until",
      "failure_count",
      "last_error_at",
      "last_error_code",
      "last_invocation_at",
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

function migrateLegacyRunnerState(sql: DurableObjectSqlStorageLike): void {
  const columns = readRunnerStateTableColumns(sql, "runner_meta");
  if (
    columns.includes("wake_pending")
    || columns.includes("next_wake_at")
    || columns.includes("pending_work")
    || columns.includes("pending_nudge")
  ) {
    const wakeSources: string[] = [];
    if (columns.includes("wake_pending")) {
      wakeSources.push("wake_pending = 1");
    }
    if (columns.includes("pending_work")) {
      wakeSources.push("pending_work = 1");
    }
    if (columns.includes("pending_nudge")) {
      wakeSources.push("pending_nudge = 1");
    }
    const wakeExists = wakeSources.length > 0 ? wakeSources.join(" OR ") : "0";
    const nextWakeAt = columns.includes("next_wake_at") ? "next_wake_at" : "NULL";
    sql.exec(`
      UPDATE runner_meta
      SET wake_at = COALESCE(
        wake_at,
        CASE
          WHEN ${wakeExists} THEN COALESCE(${nextWakeAt}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ELSE ${nextWakeAt}
        END
      )
      WHERE singleton = 1
    `);
  }
  if (columns.includes("active_invocation_id")) {
    const activeInvocationStartedAt = columns.includes("active_invocation_started_at")
      ? "active_invocation_started_at"
      : "NULL";
    const activeInvocationReason = columns.includes("active_invocation_reason")
      ? "active_invocation_reason"
      : "NULL";
    // Legacy active/inFlight projections kept for deploy skew only.
    // Delete after 2026-05-25; live state uses the write fence columns.
    sql.exec(`
      UPDATE runner_meta
      SET
        active_attempt_id = COALESCE(active_attempt_id, active_invocation_id),
        active_kind = CASE
          WHEN active_kind = 'idle_checkpoint' THEN 'runtime'
          WHEN active_kind IS NOT NULL THEN active_kind
          WHEN active_invocation_id IS NOT NULL THEN 'runtime'
          ELSE NULL
        END,
        active_reason = COALESCE(active_reason, ${activeInvocationReason}),
        active_started_at = COALESCE(active_started_at, ${activeInvocationStartedAt})
      WHERE singleton = 1
    `);
  }
  sql.exec(`
    UPDATE runner_meta
    SET active_expires_at = NULL
    WHERE active_expires_at IS NOT NULL
  `);
  if (columns.includes("lease_generation")) {
    sql.exec(`
      UPDATE runner_meta
      SET active_generation = CASE
        WHEN active_generation > 0 THEN active_generation
        ELSE lease_generation
      END
      WHERE singleton = 1
    `);
  }
  if (columns.includes("retry_at")) {
    sql.exec(`
      UPDATE runner_meta
      SET backoff_until = COALESCE(backoff_until, retry_at)
      WHERE singleton = 1
    `);
  }
  if (columns.includes("retry_failure_count")) {
    sql.exec(`
      UPDATE runner_meta
      SET failure_count = CASE
        WHEN failure_count > 0 THEN failure_count
        ELSE retry_failure_count
      END
      WHERE singleton = 1
    `);
  }
  if (columns.includes("retry_count")) {
    sql.exec(`
      UPDATE runner_meta
      SET failure_count = CASE
        WHEN failure_count > 0 THEN failure_count
        ELSE retry_count
      END
      WHERE singleton = 1
    `);
  }
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
  input: { requiredColumns: readonly string[] },
): void {
  const actualColumns = new Set(readRunnerStateTableColumns(sql, tableName));
  const missing = input.requiredColumns.filter((column) => !actualColumns.has(column));
  if (missing.length > 0) {
    throw new Error(`runner_meta schema is missing columns: ${missing.join(", ")}`);
  }
}

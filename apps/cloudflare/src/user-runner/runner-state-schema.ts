import { type DurableObjectSqlStorageLike, type DurableObjectSqlValue } from "./types.js";

// Version 16 is also a semantic rollback floor: its runner can persist the
// physical media-owner fact inside strict provider-message effects.
export const RUNNER_STATE_SCHEMA_VERSION = 16;

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
      active_attempt_id TEXT,
      active_generation INTEGER NOT NULL DEFAULT 0,
      active_kind TEXT,
      active_provider_egress_token_hash TEXT,
      active_custom_inference_envelope TEXT,
      active_platform_ai_allowed INTEGER,
      active_runner_container_name TEXT,
      active_reason TEXT,
      active_started_at TEXT,
      active_workspace_version TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_error_at TEXT,
      last_error_code TEXT,
      last_invocation_at TEXT
    )
  `);

  assertStoredRunnerStateSchemaVersionSupported(sql);
  for (const [columnName, definition] of Object.entries({
    active_attempt_id: "TEXT",
    active_generation: "INTEGER NOT NULL DEFAULT 0",
    active_kind: "TEXT",
    active_provider_egress_token_hash: "TEXT",
    active_custom_inference_envelope: "TEXT",
    active_platform_ai_allowed: "INTEGER",
    active_runner_container_name: "TEXT",
    active_reason: "TEXT",
    active_started_at: "TEXT",
    active_workspace_version: "TEXT",
    failure_count: "INTEGER NOT NULL DEFAULT 0",
    last_error_at: "TEXT",
    last_error_code: "TEXT",
    last_invocation_at: "TEXT",
  })) {
    ensureRunnerStateTableColumn(sql, "runner_meta", columnName, definition);
  }

  migrateLegacyRunnerState(sql);
  dropRetiredRunnerStateTable(sql, "runner_bundle_slots");
  markRunnerStateSchemaVersion(sql);
  assertRunnerStateTableColumns(sql, "runner_meta", {
    requiredColumns: [
      "singleton",
      "user_id",
      "active_attempt_id",
      "active_generation",
      "active_kind",
      "active_provider_egress_token_hash",
      "active_custom_inference_envelope",
      "active_platform_ai_allowed",
      "active_runner_container_name",
      "active_reason",
      "active_started_at",
      "active_workspace_version",
      "failure_count",
      "last_error_at",
      "last_error_code",
      "last_invocation_at",
    ],
  });
}

function assertStoredRunnerStateSchemaVersionSupported(
  sql: DurableObjectSqlStorageLike,
): void {
  assertRunnerStateSchemaVersionSupported({
    observedVersion: readRunnerStateSchemaVersion(sql),
    supportedVersion: RUNNER_STATE_SCHEMA_VERSION,
  });
}

export function assertRunnerStateSchemaVersionSupported(input: {
  observedVersion: number;
  supportedVersion: number;
}): void {
  if (input.observedVersion > input.supportedVersion) {
    throw new Error(
      `Hosted runner Durable Object schema version ${input.observedVersion} is newer than supported version ${input.supportedVersion}.`,
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
  if (columns.includes("active_invocation_id")) {
    const activeInvocationStartedAt = columns.includes("active_invocation_started_at")
      ? "active_invocation_started_at"
      : "NULL";
    const activeInvocationReason = columns.includes("active_invocation_reason")
      ? "active_invocation_reason"
      : "NULL";
    // Dormant objects can still hold the pre-write-fence row shape. Preserve
    // its active identity when the object is activated after the hard cut.
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

function dropRetiredRunnerStateTable(
  sql: DurableObjectSqlStorageLike,
  tableName: string,
): void {
  sql.exec(`DROP TABLE IF EXISTS ${tableName}`);
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

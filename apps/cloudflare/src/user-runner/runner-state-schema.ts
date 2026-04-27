/**
 * Owns hosted runner Durable Object schema setup so the runner state store can
 * stay focused on thin lease/runtime transitions rather than Durable Object
 * DDL details.
 */

import { type DurableObjectSqlStorageLike, type DurableObjectSqlValue } from "./types.js";

export function ensureRunnerStateSchema(sql: DurableObjectSqlStorageLike): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS runner_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      user_id TEXT NOT NULL,
      active_invocation_id TEXT,
      active_invocation_reason TEXT,
      active_invocation_started_at TEXT,
      active_workspace_version TEXT,
      lease_generation INTEGER NOT NULL DEFAULT 0,
      in_flight INTEGER NOT NULL DEFAULT 0,
      last_error_at TEXT,
      last_error_code TEXT,
      last_run_at TEXT,
      next_wake_at TEXT,
      pending_nudge INTEGER NOT NULL DEFAULT 0
    )
  `);
  ensureRunnerStateTableColumn(sql, "runner_meta", "active_invocation_id", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "active_invocation_reason", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "active_invocation_started_at", "TEXT");
  ensureRunnerStateTableColumn(sql, "runner_meta", "active_workspace_version", "TEXT");
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
  assertRunnerStateTableAbsent(sql, "runner_bundle_slots");
  assertRunnerStateTableColumns(sql, "runner_meta", {
    requiredColumns: [
      "singleton",
      "user_id",
      "active_invocation_id",
      "active_invocation_reason",
      "active_invocation_started_at",
      "active_workspace_version",
      "lease_generation",
      "in_flight",
      "last_error_at",
      "last_error_code",
      "last_run_at",
      "next_wake_at",
      "pending_nudge",
    ],
  });
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

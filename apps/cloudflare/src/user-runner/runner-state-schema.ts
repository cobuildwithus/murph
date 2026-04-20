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
      active_run_event_id TEXT,
      active_run_id TEXT,
      active_run_attempt INTEGER,
      active_run_started_at TEXT,
      runtime_bootstrapped INTEGER NOT NULL DEFAULT 0,
      in_flight INTEGER NOT NULL DEFAULT 0,
      last_error_at TEXT,
      last_error_code TEXT,
      last_event_id TEXT,
      last_run_at TEXT,
      next_wake_at TEXT
    )
  `);
  assertRunnerStateTableColumns(sql, "runner_meta", {
    requiredColumns: [
      "singleton",
      "user_id",
      "active_run_event_id",
      "active_run_id",
      "active_run_attempt",
      "active_run_started_at",
      "runtime_bootstrapped",
      "in_flight",
      "last_error_at",
      "last_error_code",
      "last_event_id",
      "last_run_at",
      "next_wake_at",
    ],
  });
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

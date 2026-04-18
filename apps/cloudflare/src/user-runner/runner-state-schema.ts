/**
 * Owns hosted runner Durable Object schema setup so the runner state store can
 * stay focused on thin lease/runtime transitions rather than Durable Object
 * DDL details.
 */

import { type DurableObjectSqlStorageLike, type DurableObjectSqlValue } from "./types.js";

export function ensureRunnerStateSchema(sql: DurableObjectSqlStorageLike): void {
  // Hard cut: web owns wake lifecycle truth, so the runner drops the old local
  // queue lifecycle tables instead of migrating them forward.
  sql.exec("DROP TABLE IF EXISTS pending_events");
  sql.exec("DROP TABLE IF EXISTS consumed_events");
  sql.exec("DROP TABLE IF EXISTS backpressured_events");
  sql.exec("DROP TABLE IF EXISTS poisoned_events");
  sql.exec(`
    CREATE TABLE IF NOT EXISTS runner_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      user_id TEXT NOT NULL,
      bundle_ref_json TEXT,
      bundle_version INTEGER NOT NULL DEFAULT 0,
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
      next_wake_at TEXT,
      pending_commit_json TEXT
    )
  `);
  // Greenfield hard cut: the runner only persists one vault bundle pointer now,
  // so the old slot table is deleted instead of being carried as compatibility
  // state for dead multi-slot paths.
  sql.exec("DROP TABLE IF EXISTS runner_bundle_slots");
  ensureRunnerMetaColumns(sql);
  assertRunnerStateTableColumns(sql, "runner_meta", {
    forbiddenColumns: [
      "activated",
    ],
    requiredColumns: [
      "singleton",
      "user_id",
      "bundle_ref_json",
      "bundle_version",
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
      "pending_commit_json",
    ],
  });
}

function ensureRunnerMetaColumns(sql: DurableObjectSqlStorageLike): void {
  const columns = new Set(readRunnerStateTableColumns(sql, "runner_meta"));
  const additions = [
    {
      columnName: "bundle_ref_json",
      ddl: "ALTER TABLE runner_meta ADD COLUMN bundle_ref_json TEXT",
    },
    {
      columnName: "bundle_version",
      ddl: "ALTER TABLE runner_meta ADD COLUMN bundle_version INTEGER NOT NULL DEFAULT 0",
    },
    {
      columnName: "active_run_event_id",
      ddl: "ALTER TABLE runner_meta ADD COLUMN active_run_event_id TEXT",
    },
    {
      columnName: "active_run_id",
      ddl: "ALTER TABLE runner_meta ADD COLUMN active_run_id TEXT",
    },
    {
      columnName: "active_run_attempt",
      ddl: "ALTER TABLE runner_meta ADD COLUMN active_run_attempt INTEGER",
    },
    {
      columnName: "active_run_started_at",
      ddl: "ALTER TABLE runner_meta ADD COLUMN active_run_started_at TEXT",
    },
    {
      columnName: "last_event_id",
      ddl: "ALTER TABLE runner_meta ADD COLUMN last_event_id TEXT",
    },
    {
      columnName: "pending_commit_json",
      ddl: "ALTER TABLE runner_meta ADD COLUMN pending_commit_json TEXT",
    },
  ] as const;

  for (const addition of additions) {
    if (columns.has(addition.columnName)) {
      continue;
    }

    sql.exec(addition.ddl);
  }
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
    forbiddenColumns?: readonly string[];
    requiredColumns: readonly string[];
  },
): void {
  const actualColumns = readRunnerStateTableColumns(sql, tableName);
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

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_SQLITE_TIMEOUT_MS = 5_000;

export interface OpenSqliteRuntimeDatabaseOptions {
  create?: boolean;
  readOnly?: boolean;
  timeoutMs?: number;
  foreignKeys?: boolean;
  journalMode?: "DELETE" | "TRUNCATE" | "PERSIST" | "MEMORY" | "WAL" | "OFF";
  synchronous?: "OFF" | "NORMAL" | "FULL" | "EXTRA";
}

export function openSqliteRuntimeDatabase(
  databasePath: string,
  options: OpenSqliteRuntimeDatabaseOptions = {},
): DatabaseSync {
  const readOnly = options.readOnly ?? false;

  if (!readOnly && (options.create ?? true)) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath, {
    readOnly,
    timeout: options.timeoutMs ?? DEFAULT_SQLITE_TIMEOUT_MS,
  });

  if (options.foreignKeys ?? true) {
    database.exec("PRAGMA foreign_keys = ON;");
  }

  if (!readOnly) {
    database.exec(
      `PRAGMA journal_mode = ${options.journalMode ?? "WAL"}; PRAGMA synchronous = ${
        options.synchronous ?? "NORMAL"
      };`,
    );
  }

  return database;
}

export function tableExists(database: DatabaseSync, name: string): boolean {
  const row = database
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type IN ('table', 'view') AND name = ?
    `)
    .get(name) as { name: string } | undefined;

  return row?.name === name;
}

export function withImmediateTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE TRANSACTION");

  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

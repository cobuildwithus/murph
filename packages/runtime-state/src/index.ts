import path from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const RUNTIME_ROOT_RELATIVE_PATH = ".runtime";
export const SEARCH_DB_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/search.sqlite`;
export const INBOX_DB_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/inboxd.sqlite`;
export const INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/inboxd`;
export const INBOX_CONFIG_RELATIVE_PATH = `${INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH}/config.json`;
export const INBOX_STATE_RELATIVE_PATH = `${INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH}/state.json`;
export const INBOX_PROMOTIONS_RELATIVE_PATH =
  `${INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH}/promotions.json`;
export const DEFAULT_SQLITE_TIMEOUT_MS = 5_000;

export interface RuntimePaths {
  absoluteVaultRoot: string;
  runtimeRoot: string;
  searchDbPath: string;
  inboxDbPath: string;
  inboxRuntimeRoot: string;
  inboxConfigPath: string;
  inboxStatePath: string;
  inboxPromotionsPath: string;
}

export interface OpenSqliteRuntimeDatabaseOptions {
  create?: boolean;
  readOnly?: boolean;
  timeoutMs?: number;
  foreignKeys?: boolean;
  journalMode?: "DELETE" | "TRUNCATE" | "PERSIST" | "MEMORY" | "WAL" | "OFF";
  synchronous?: "OFF" | "NORMAL" | "FULL" | "EXTRA";
}

export function resolveRuntimePaths(vaultRoot: string): RuntimePaths {
  const absoluteVaultRoot = path.resolve(vaultRoot);
  const runtimeRoot = path.join(absoluteVaultRoot, RUNTIME_ROOT_RELATIVE_PATH);
  const inboxRuntimeRoot = path.join(absoluteVaultRoot, INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH);

  return {
    absoluteVaultRoot,
    runtimeRoot,
    searchDbPath: path.join(absoluteVaultRoot, SEARCH_DB_RELATIVE_PATH),
    inboxDbPath: path.join(absoluteVaultRoot, INBOX_DB_RELATIVE_PATH),
    inboxRuntimeRoot,
    inboxConfigPath: path.join(absoluteVaultRoot, INBOX_CONFIG_RELATIVE_PATH),
    inboxStatePath: path.join(absoluteVaultRoot, INBOX_STATE_RELATIVE_PATH),
    inboxPromotionsPath: path.join(absoluteVaultRoot, INBOX_PROMOTIONS_RELATIVE_PATH),
  };
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

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

export interface SqliteRuntimeMigration {
  migrate(database: DatabaseSync): void;
  version: number;
}

export interface ApplySqliteRuntimeMigrationsInput {
  migrations: readonly SqliteRuntimeMigration[];
  schemaVersion: number;
  storeName: string;
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

export function readSqliteRuntimeUserVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version;").get() as { user_version?: number } | undefined;
  const version = row?.user_version;
  return typeof version === "number" && Number.isInteger(version) && version >= 0 ? version : 0;
}

export function writeSqliteRuntimeUserVersion(database: DatabaseSync, version: number): void {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`SQLite runtime user_version must be a non-negative integer. Received ${String(version)}.`);
  }

  database.exec(`PRAGMA user_version = ${version};`);
}

export function applySqliteRuntimeMigrations(
  database: DatabaseSync,
  input: ApplySqliteRuntimeMigrationsInput,
): number {
  assertSqliteRuntimeSchemaVersion(input.schemaVersion, `${input.storeName} schemaVersion`);

  const migrations = [...input.migrations].sort((left, right) => left.version - right.version);
  assertSqliteRuntimeMigrationPlan(migrations, input);

  const currentVersion = readSqliteRuntimeUserVersion(database);

  if (currentVersion > input.schemaVersion) {
    throw new Error(
      `${input.storeName} database schema version ${currentVersion} is newer than supported version ${input.schemaVersion}.`,
    );
  }

  let appliedVersion = currentVersion;
  for (const migration of migrations) {
    if (migration.version <= appliedVersion) {
      continue;
    }

    if (migration.version > input.schemaVersion) {
      break;
    }

    withImmediateTransaction(database, () => {
      migration.migrate(database);
      writeSqliteRuntimeUserVersion(database, migration.version);
    });
    appliedVersion = migration.version;
  }

  if (appliedVersion !== input.schemaVersion) {
    throw new Error(
      `${input.storeName} database schema stopped at version ${appliedVersion}; expected ${input.schemaVersion}.`,
    );
  }

  return appliedVersion;
}

function assertSqliteRuntimeMigrationPlan(
  migrations: readonly SqliteRuntimeMigration[],
  input: ApplySqliteRuntimeMigrationsInput,
): void {
  let previousVersion = 0;

  for (const migration of migrations) {
    assertSqliteRuntimeSchemaVersion(migration.version, `${input.storeName} migration version`);

    if (migration.version <= previousVersion) {
      throw new Error(
        `${input.storeName} migrations must be strictly increasing. Duplicate or out-of-order version ${migration.version}.`,
      );
    }

    previousVersion = migration.version;
  }

  if (input.schemaVersion === 0) {
    if (migrations.length > 0) {
      throw new Error(`${input.storeName} schemaVersion 0 cannot declare migrations.`);
    }
    return;
  }

  if (migrations.length === 0) {
    throw new Error(
      `${input.storeName} requires migrations covering schema version ${input.schemaVersion}, but none were provided.`,
    );
  }

  const lastVersion = migrations[migrations.length - 1]?.version ?? 0;
  if (lastVersion !== input.schemaVersion) {
    throw new Error(
      `${input.storeName} migrations stop at version ${lastVersion}; expected ${input.schemaVersion}.`,
    );
  }
}

function assertSqliteRuntimeSchemaVersion(version: number, label: string): void {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`${label} must be a non-negative integer. Received ${String(version)}.`);
  }
}

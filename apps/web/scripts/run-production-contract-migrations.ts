import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import {
  resolveHostedWebMigrationDatabaseUrl,
  type HostedWebMigrationEnvironment,
} from "./run-prisma-migrate-deploy";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_DIR = APP_ROOT;
const DEFAULT_CONTRACT_MIGRATIONS_DIR = path.join(
  APP_ROOT,
  "prisma",
  "contract-migrations",
);
const CONTRACT_MIGRATION_TABLE = '"_hosted_web_contract_migration"';
const CONTRACT_MIGRATION_LOCK_NAME = "hosted_web_contract_migrations";
const CONTRACT_MIGRATION_LOCK_TIMEOUT = "5s";
const CONTRACT_MIGRATION_STATEMENT_TIMEOUT = "30s";

export interface HostedWebContractMigration {
  checksum: string;
  id: string;
  sql: string;
  sqlPath: string;
}

export interface HostedWebContractMigrationResult {
  applied: number;
  skipped: number;
}

export interface HostedWebContractMigrationOptions {
  migrationsDir?: string;
}

export interface HostedWebContractMigrationDatabase {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type HostedWebContractMigrationEnvironment =
  HostedWebMigrationEnvironment;

export function shouldRunHostedWebProductionContractMigrations(
  environment: HostedWebContractMigrationEnvironment,
): boolean {
  return environment.MURPH_RUN_HOSTED_WEB_CONTRACT_MIGRATIONS === "1";
}

export async function runHostedWebProductionContractMigrationsIfNeeded(
  environment: HostedWebContractMigrationEnvironment = process.env,
  options: HostedWebContractMigrationOptions = {},
): Promise<"ran" | "skipped"> {
  if (!shouldRunHostedWebProductionContractMigrations(environment)) {
    console.log("Skipping hosted web contract migrations without explicit opt-in.");
    return "skipped";
  }

  const migrations = await listHostedWebContractMigrations(options.migrationsDir);
  if (migrations.length === 0) {
    console.log("No hosted web contract migrations to apply.");
    return "ran";
  }

  const migrationDatabaseUrl = resolveHostedWebMigrationDatabaseUrl({
    ...environment,
    MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS: "1",
  });
  const client = new Client({ connectionString: migrationDatabaseUrl.url });
  console.log(`Applying hosted web contract migrations with ${migrationDatabaseUrl.source}.`);

  await client.connect();
  try {
    const result = await applyHostedWebContractMigrations(client, migrations);
    console.log(
      `Hosted web contract migrations complete: ${result.applied} applied, ${result.skipped} skipped.`,
    );
  } finally {
    await client.end();
  }

  return "ran";
}

export async function listHostedWebContractMigrations(
  migrationsDir = DEFAULT_CONTRACT_MIGRATIONS_DIR,
): Promise<HostedWebContractMigration[]> {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrationDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const migrations: HostedWebContractMigration[] = [];

  for (const migrationId of migrationDirs) {
    const sqlPath = path.join(migrationsDir, migrationId, "migration.sql");
    const sql = await readFile(sqlPath, "utf8");

    migrations.push({
      checksum: createHash("sha256").update(sql).digest("hex"),
      id: migrationId,
      sql,
      sqlPath,
    });
  }

  return migrations;
}

export async function applyHostedWebContractMigrations(
  database: HostedWebContractMigrationDatabase,
  migrations: readonly HostedWebContractMigration[],
): Promise<HostedWebContractMigrationResult> {
  let applied = 0;
  let skipped = 0;

  for (const migration of migrations) {
    await database.query("BEGIN");
    try {
      const lock = await database.query(
        "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired",
        [CONTRACT_MIGRATION_LOCK_NAME],
      );
      if (!readAdvisoryLockAcquired(lock.rows[0])) {
        throw new Error(
          "Hosted web contract migration lock is already held; refusing to wait past the current-production proof.",
        );
      }

      await database.query(
        `SET LOCAL lock_timeout = '${CONTRACT_MIGRATION_LOCK_TIMEOUT}'`,
      );
      await database.query(
        `SET LOCAL statement_timeout = '${CONTRACT_MIGRATION_STATEMENT_TIMEOUT}'`,
      );
      await database.query(`
        CREATE TABLE IF NOT EXISTS ${CONTRACT_MIGRATION_TABLE} (
          migration_id TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const existing = await database.query(
        `SELECT checksum FROM ${CONTRACT_MIGRATION_TABLE} WHERE migration_id = $1`,
        [migration.id],
      );
      const existingChecksum = readChecksum(existing.rows[0]);

      if (existingChecksum === migration.checksum) {
        skipped += 1;
        await database.query("COMMIT");
        continue;
      }

      if (existingChecksum !== undefined) {
        throw new Error(
          `Hosted web contract migration ${migration.id} was already applied with a different checksum.`,
        );
      }

      await database.query(migration.sql);
      await database.query(
        `INSERT INTO ${CONTRACT_MIGRATION_TABLE} (migration_id, checksum) VALUES ($1, $2)`,
        [migration.id, migration.checksum],
      );
      applied += 1;
      await database.query("COMMIT");
    } catch (error) {
      await rollbackAfterContractMigrationFailure(database);
      throw error;
    }
  }

  return { applied, skipped };
}

async function main(): Promise<void> {
  loadHostedWebEnvFiles();
  await runHostedWebProductionContractMigrationsIfNeeded();
}

function loadHostedWebEnvFiles(): void {
  for (const envPath of [".env.local", ".env"]) {
    const absoluteEnvPath = path.join(CONFIG_DIR, envPath);

    if (existsSync(absoluteEnvPath)) {
      process.loadEnvFile(absoluteEnvPath);
    }
  }
}

async function rollbackAfterContractMigrationFailure(
  database: HostedWebContractMigrationDatabase,
): Promise<void> {
  try {
    await database.query("ROLLBACK");
  } catch (rollbackError) {
    console.error(
      rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
    );
  }
}

function readChecksum(row: Record<string, unknown> | undefined): string | undefined {
  return typeof row?.checksum === "string" ? row.checksum : undefined;
}

function readAdvisoryLockAcquired(
  row: Record<string, unknown> | undefined,
): boolean {
  return row?.acquired === true;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

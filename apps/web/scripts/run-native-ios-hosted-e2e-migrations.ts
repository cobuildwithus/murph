import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import { withHostedWebMigrationOwner } from "./hosted-web-migration-owner";
import {
  resolveHostedWebMigrationDatabaseUrl,
  runHostedWebPrismaMigrateDeploy,
  type HostedWebMigrationEnvironment,
} from "./run-prisma-migrate-deploy";

export const nativeIosHostedE2eVercelTargetEnvironment = "native-ios-e2e";

const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRISMA_MIGRATIONS_DIR = path.join(CONFIG_DIR, "prisma", "migrations");

export type NativeIosHostedE2eMigrationRunner = (
  environment: HostedWebMigrationEnvironment,
) => Promise<void>;

export type NativeIosHostedE2eMigrationHistoryVerifier = (
  environment: HostedWebMigrationEnvironment,
) => Promise<void>;

export interface NativeIosHostedE2eAppliedMigration {
  checksum: string;
  migrationName: string;
}

export function findNativeIosHostedE2eDivergentAppliedMigrations(
  localMigrationChecksums: ReadonlyMap<string, string>,
  appliedMigrations: readonly NativeIosHostedE2eAppliedMigration[],
): string[] {
  return appliedMigrations
    .filter(
      ({ checksum, migrationName }) =>
        localMigrationChecksums.get(migrationName) !== checksum,
    )
    .map(({ migrationName }) => migrationName);
}

/**
 * A shared hosted E2E database must never silently retain a migration from an
 * abandoned PR. That would make a later deployment look healthy while testing
 * a schema that the exact source cannot produce. The dedicated environment may
 * be reprovisioned by infrastructure, but product code gets no database-reset
 * route or test bypass.
 */
export async function assertNativeIosHostedE2eMigrationHistoryMatchesSource(
  environment: HostedWebMigrationEnvironment,
  migrationsDir = PRISMA_MIGRATIONS_DIR,
): Promise<void> {
  const migrationDatabaseUrl = resolveHostedWebMigrationDatabaseUrl(environment);
  const ownerDatabaseUrl = withHostedWebMigrationOwner(migrationDatabaseUrl.url);
  const migrationEntries = await readdir(migrationsDir, { withFileTypes: true });
  const localMigrationDirectories = migrationEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const localMigrationChecksums = new Map(
    await Promise.all(
      localMigrationDirectories.map(async (migrationName) => {
        const migrationSql = await readFile(
          path.join(migrationsDir, migrationName, "migration.sql"),
        );
        return [
          migrationName,
          createHash("sha256").update(migrationSql).digest("hex"),
        ] as const;
      }),
    ),
  );
  const client = new Client({ connectionString: ownerDatabaseUrl });

  await client.connect();
  try {
    const ledger = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists`,
    );
    if (ledger.rows[0]?.exists !== true) {
      return;
    }

    const applied = await client.query<{ checksum: string; migration_name: string }>(
      `
        SELECT migration_name, checksum
        FROM public._prisma_migrations
        WHERE finished_at IS NOT NULL
          AND rolled_back_at IS NULL
        ORDER BY migration_name ASC
      `,
    );
    const divergentMigrations = findNativeIosHostedE2eDivergentAppliedMigrations(
      localMigrationChecksums,
      applied.rows.map((row) => ({
        checksum: row.checksum,
        migrationName: row.migration_name,
      })),
    );
    if (divergentMigrations.length > 0) {
      throw new Error(
        "Native iOS hosted E2E database contains applied migration history that does not match the exact Web source. Reprovision the isolated E2E database from protected main history before retrying.",
      );
    }
  } finally {
    await client.end();
  }
}

/**
 * The native iOS E2E lane is a real Vercel Custom Environment, not a local or
 * fixture transport. Its Web build needs the same Prisma migration owner as
 * production so the exact PR can exercise its real database contract. The
 * custom target is the only admission signal: canonical production and normal
 * preview builds remain unchanged.
 */
export async function runNativeIosHostedE2eMigrationsIfNeeded(
  environment: HostedWebMigrationEnvironment = process.env,
  runMigrations: NativeIosHostedE2eMigrationRunner = (childEnvironment) =>
    runHostedWebPrismaMigrateDeploy(childEnvironment),
  verifyHistory: NativeIosHostedE2eMigrationHistoryVerifier = (childEnvironment) =>
    assertNativeIosHostedE2eMigrationHistoryMatchesSource(childEnvironment),
): Promise<"ran" | "skipped"> {
  const targetEnvironment = environment.VERCEL_TARGET_ENV?.trim();
  if (targetEnvironment !== nativeIosHostedE2eVercelTargetEnvironment) {
    return "skipped";
  }

  if (environment.VERCEL !== "1") {
    throw new Error(
      "The native iOS hosted E2E migration target is valid only inside Vercel.",
    );
  }
  if (environment.VERCEL_ENV === "production") {
    throw new Error(
      "The native iOS hosted E2E migration target must never be canonical production.",
    );
  }

  const gitSha = environment.VERCEL_GIT_COMMIT_SHA?.trim();
  if (!gitSha || !/^[0-9a-f]{40}$/u.test(gitSha)) {
    throw new Error(
      "The native iOS hosted E2E migration target requires an exact Vercel Git SHA.",
    );
  }

  const migrationEnvironment = {
    ...environment,
    // Preview database migrations must never silently fall back to a pooled
    // runtime URL. This reuses the existing migration-owner safety contract.
    MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS: "1",
  };
  await verifyHistory(migrationEnvironment);
  await runMigrations(migrationEnvironment);
  return "ran";
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  runNativeIosHostedE2eMigrationsIfNeeded().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg, { type Client, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteHostedRuntimeLogDataForUsers,
  hostedRuntimeLogSubjectKey,
  recordHostedRuntimeLogs,
  type HostedRuntimeLogSqlClient,
  type HostedRuntimeLogSqlDatabase,
  type HostedRuntimeLogSqlResult,
} from "@/src/lib/hosted-runtime-log/store";

const { Client: PgClient, Pool: PgPool } = pg;
const primaryDatabaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_RUNTIME_LOG_POSTGRES === "1";
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const runtimeLogMigrationPath = path.resolve(
  testDirectory,
  "../prisma/runtime-logs/migrations/20260729000000_init/migration.sql",
);
const accountCleanupMigrationPath = path.resolve(
  testDirectory,
  "../prisma/migrations/20260729010000_hosted_account_cleanup_runtime_logs/migration.sql",
);

if (
  runPostgresProof
  && (!primaryDatabaseUrl || !isClearlyLocalPostgresUrl(primaryDatabaseUrl))
) {
  throw new Error(
    "The runtime-log concurrency proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)("isolated runtime-log deletion fence", () => {
  let admin: Client | null = null;
  let pool: Pool | null = null;
  let database: HostedRuntimeLogSqlDatabase | null = null;
  const subjectKeys = new Set<string>();
  const testDatabaseName = `murph_runtime_log_test_${randomToken()}`;

  beforeAll(async () => {
    admin = new PgClient({
      connectionString: postgresDatabaseUrl(primaryDatabaseUrl, "postgres"),
    });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${testDatabaseName}"`);

    pool = new PgPool({
      connectionString: postgresDatabaseUrl(primaryDatabaseUrl, testDatabaseName),
      max: 8,
    });
    const [runtimeLogMigration, accountCleanupMigration] = await Promise.all([
      readFile(runtimeLogMigrationPath, "utf8"),
      readFile(accountCleanupMigrationPath, "utf8"),
    ]);
    await pool.query(runtimeLogMigration);
    await pool.query(`
      CREATE TABLE hosted_account_deletion_cleanup (
        id text PRIMARY KEY
      )
    `);
    await pool.query(accountCleanupMigration);
    database = poolDatabase(pool);
  }, 30_000);

  afterAll(async () => {
    if (pool && subjectKeys.size > 0) {
      await pool.query(
        "DELETE FROM hosted_runtime_log WHERE subject_key = ANY($1::text[])",
        [[...subjectKeys]],
      );
    }
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
    await admin?.end();
  }, 30_000);

  it("keeps pre-change cleanup receipts until isolated deletion is complete", async () => {
    const postgres = requirePool(pool);
    const cleanupId = `cleanup_${randomToken()}`;
    await postgres.query(
      "INSERT INTO hosted_account_deletion_cleanup (id) VALUES ($1)",
      [cleanupId],
    );

    await expect(postgres.query(
      "DELETE FROM hosted_account_deletion_cleanup WHERE id = $1",
      [cleanupId],
    )).rejects.toMatchObject({ code: "23514" });
    await expect(postgres.query<{ runtimeLogsCompletedAt: Date | null }>(
      `
        SELECT runtime_logs_completed_at AS "runtimeLogsCompletedAt"
        FROM hosted_account_deletion_cleanup
        WHERE id = $1
      `,
      [cleanupId],
    )).resolves.toMatchObject({
      rows: [{ runtimeLogsCompletedAt: null }],
    });

    await postgres.query(
      `
        UPDATE hosted_account_deletion_cleanup
        SET runtime_logs_completed_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [cleanupId],
    );
    await expect(postgres.query(
      "DELETE FROM hosted_account_deletion_cleanup WHERE id = $1",
      [cleanupId],
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  it("deletes a row when append owns the subject lock first", async () => {
    const sql = requireDatabase(database);
    const userId = `member_runtime_log_append_first_${randomToken()}`;
    const subjectKey = rememberSubject(subjectKeys, userId);
    const authorityEntered = deferred();
    const releaseAuthority = deferred();

    const append = recordHostedRuntimeLogs({
      database: sql,
      entries: [runtimeEntry()],
      isUserActive: async () => {
        authorityEntered.resolve();
        await releaseAuthority.promise;
        return true;
      },
      userId,
    });
    await authorityEntered.promise;

    const deletion = deleteHostedRuntimeLogDataForUsers({
      database: sql,
      timeoutMs: 5_000,
      userIds: [userId],
    });
    await nextTurn();
    releaseAuthority.resolve();

    await expect(append).resolves.toBe(1);
    await expect(deletion).resolves.toBe(1);
    await expect(countRows(requirePool(pool), subjectKey)).resolves.toBe(0);
  });

  it("makes a delayed append recheck primary authority when deletion locks first", async () => {
    const sql = requireDatabase(database);
    const userId = `member_runtime_log_delete_first_${randomToken()}`;
    const subjectKey = rememberSubject(subjectKeys, userId);
    const deletionLocked = deferred();
    const releaseDeletion = deferred();
    let authorityChecks = 0;

    const deletion = deleteHostedRuntimeLogDataForUsers({
      database: afterQuery(sql, async (text) => {
        if (!text.includes("pg_advisory_xact_lock")) {
          return;
        }
        deletionLocked.resolve();
        await releaseDeletion.promise;
      }),
      timeoutMs: 5_000,
      userIds: [userId],
    });
    await deletionLocked.promise;

    // This models the canonical primary suspension fence that commits before
    // the receipt-owned isolated cleanup starts.
    const append = recordHostedRuntimeLogs({
      database: sql,
      entries: [runtimeEntry()],
      isUserActive: async () => {
        authorityChecks += 1;
        return false;
      },
      userId,
    });
    await nextTurn();
    expect(authorityChecks).toBe(0);

    releaseDeletion.resolve();
    await expect(deletion).resolves.toBe(0);
    await expect(append).resolves.toBe(0);
    expect(authorityChecks).toBe(1);
    await expect(countRows(requirePool(pool), subjectKey)).resolves.toBe(0);

    await expect(recordHostedRuntimeLogs({
      database: sql,
      entries: [runtimeEntry()],
      isUserActive: async () => false,
      userId,
    })).resolves.toBe(0);
    await expect(countRows(requirePool(pool), subjectKey)).resolves.toBe(0);
  });

  it("sorts overlapping multi-subject cleanup locks and avoids deadlock", async () => {
    const sql = requireDatabase(database);
    const userIds = [
      `member_runtime_log_multi_${randomToken()}`,
      `member_runtime_log_multi_${randomToken()}`,
    ];
    for (const userId of userIds) {
      rememberSubject(subjectKeys, userId);
    }

    await Promise.all([
      deleteHostedRuntimeLogDataForUsers({
        database: sql,
        timeoutMs: 5_000,
        userIds,
      }),
      deleteHostedRuntimeLogDataForUsers({
        database: sql,
        timeoutMs: 5_000,
        userIds: [...userIds].reverse(),
      }),
    ]);
  });
});

function runtimeEntry() {
  return {
    at: new Date().toISOString(),
    component: "mailbox" as const,
    eventCode: "mailbox.imported" as const,
    level: "info" as const,
    phase: "import" as const,
  };
}

function afterQuery(
  database: HostedRuntimeLogSqlDatabase,
  hook: (text: string, values: readonly unknown[]) => Promise<void>,
): HostedRuntimeLogSqlDatabase {
  return {
    async connect() {
      const client = await database.connect();
      return hookClient(client, hook);
    },
    async query<Row extends Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<HostedRuntimeLogSqlResult<Row>> {
      const result = await database.query<Row>(text, values);
      await hook(text, values ?? []);
      return result;
    },
  };
}

function hookClient(
  client: HostedRuntimeLogSqlClient,
  hook: (text: string, values: readonly unknown[]) => Promise<void>,
): HostedRuntimeLogSqlClient {
  return {
    async query<Row extends Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<HostedRuntimeLogSqlResult<Row>> {
      const result = await client.query<Row>(text, values);
      await hook(text, values ?? []);
      return result;
    },
    release() {
      client.release();
    },
  };
}

function poolDatabase(pool: Pool): HostedRuntimeLogSqlDatabase {
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query<Row extends Record<string, unknown>>(
          text: string,
          values?: readonly unknown[],
        ): Promise<HostedRuntimeLogSqlResult<Row>> {
          const result = await client.query<Row>(
            text,
            values === undefined ? undefined : [...values],
          );
          return { rowCount: result.rowCount, rows: result.rows };
        },
        release() {
          client.release();
        },
      };
    },
    async query<Row extends Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<HostedRuntimeLogSqlResult<Row>> {
      const result = await pool.query<Row>(
        text,
        values === undefined ? undefined : [...values],
      );
      return { rowCount: result.rowCount, rows: result.rows };
    },
  };
}

async function countRows(pool: Pool, subjectKey: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM hosted_runtime_log WHERE subject_key = $1",
    [subjectKey],
  );
  return Number(result.rows[0]?.count ?? "0");
}

function rememberSubject(subjectKeys: Set<string>, userId: string): string {
  const subjectKey = hostedRuntimeLogSubjectKey(userId);
  subjectKeys.add(subjectKey);
  return subjectKey;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function randomToken(): string {
  return randomUUID().replaceAll("-", "");
}

function requireDatabase(
  value: HostedRuntimeLogSqlDatabase | null,
): HostedRuntimeLogSqlDatabase {
  if (!value) {
    throw new Error("Runtime-log test database is unavailable.");
  }
  return value;
}

function requirePool(value: Pool | null): Pool {
  if (!value) {
    throw new Error("Runtime-log test pool is unavailable.");
  }
  return value;
}

function postgresDatabaseUrl(baseUrl: string, databaseName: string): string {
  if (!/^[a-z0-9_]+$/u.test(databaseName)) {
    throw new TypeError("Runtime-log test database name is invalid.");
  }
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres")
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

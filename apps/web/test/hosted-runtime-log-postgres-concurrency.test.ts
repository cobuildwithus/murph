import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg, { type Client, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  verifyHostedRuntimeLogDatabaseEndpoints,
} from "../scripts/run-runtime-log-migrate-deploy";
import {
  deleteExpiredHostedRuntimeLogs,
  deleteHostedRuntimeLogDataForUsers,
  hostedRuntimeLogSubjectKey,
  listHostedRuntimeLogs,
  listHostedRuntimeTurnTimingLogs,
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
const temporalCleanupMigrationPath = path.resolve(
  testDirectory,
  "../prisma/migrations/20260830170000_hosted_account_cleanup_temporal/migration.sql",
);
const temporalCleanupContractMigrationPath = path.resolve(
  testDirectory,
  "../prisma/contract-migrations/20260831060000_require_hosted_account_cleanup_temporal_cursor/migration.sql",
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
    await setTestDatabaseStatementTimeout(admin, testDatabaseName, "10s");

    pool = new PgPool({
      connectionString: postgresDatabaseUrl(primaryDatabaseUrl, testDatabaseName),
      max: 8,
    });
    const [
      runtimeLogMigration,
      accountCleanupMigration,
      temporalCleanupMigration,
      temporalCleanupContractMigration,
    ] = await Promise.all([
      readFile(runtimeLogMigrationPath, "utf8"),
      readFile(accountCleanupMigrationPath, "utf8"),
      readFile(temporalCleanupMigrationPath, "utf8"),
      readFile(temporalCleanupContractMigrationPath, "utf8"),
    ]);
    await pool.query(runtimeLogMigration);
    await pool.query(`
      CREATE TABLE hosted_account_deletion_cleanup (
        id text PRIMARY KEY
      )
    `);
    await pool.query(accountCleanupMigration);
    const preExpandReceiptId = `cleanup_pre_expand_${randomToken()}`;
    await pool.query(
      "INSERT INTO hosted_account_deletion_cleanup (id) VALUES ($1)",
      [preExpandReceiptId],
    );
    await pool.query(temporalCleanupMigration);

    const oldWebReceiptId = `cleanup_old_web_${randomToken()}`;
    await pool.query(
      "INSERT INTO hosted_account_deletion_cleanup (id) VALUES ($1)",
      [oldWebReceiptId],
    );
    await expect(pool.query<{
      columnDefault: string | null;
      isNullable: string;
    }>(
      `
        SELECT
          column_default AS "columnDefault",
          is_nullable AS "isNullable"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'hosted_account_deletion_cleanup'
          AND column_name = 'temporal_next_runtime_index'
      `,
    )).resolves.toMatchObject({
      rows: [{ columnDefault: expect.stringContaining("0"), isNullable: "YES" }],
    });
    await expect(pool.query<{
      id: string;
      temporalNextRuntimeIndex: number;
    }>(
      `
        SELECT
          id,
          temporal_next_runtime_index AS "temporalNextRuntimeIndex"
        FROM hosted_account_deletion_cleanup
        WHERE id = ANY($1::text[])
        ORDER BY id
      `,
      [[oldWebReceiptId, preExpandReceiptId]],
    )).resolves.toMatchObject({
      rows: [oldWebReceiptId, preExpandReceiptId]
        .sort((left, right) => left.localeCompare(right))
        .map((id) => ({ id, temporalNextRuntimeIndex: 0 })),
    });

    await pool.query(
      `
        UPDATE hosted_account_deletion_cleanup
        SET temporal_next_runtime_index = NULL
        WHERE id = $1
      `,
      [oldWebReceiptId],
    );
    await expect(pool.query(temporalCleanupContractMigration)).rejects.toMatchObject({
      code: "23514",
    });
    await pool.query(
      `
        UPDATE hosted_account_deletion_cleanup
        SET temporal_next_runtime_index = 0
        WHERE id = $1
      `,
      [oldWebReceiptId],
    );
    await pool.query(temporalCleanupContractMigration);
    await expect(pool.query<{ isNullable: string }>(
      `
        SELECT is_nullable AS "isNullable"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'hosted_account_deletion_cleanup'
          AND column_name = 'temporal_next_runtime_index'
      `,
    )).resolves.toMatchObject({ rows: [{ isNullable: "NO" }] });
    await expect(pool.query(
      `
        UPDATE hosted_account_deletion_cleanup
        SET temporal_next_runtime_index = NULL
        WHERE id = $1
      `,
      [preExpandReceiptId],
    )).rejects.toMatchObject({ code: "23502" });
    await pool.query(
      `
        UPDATE hosted_account_deletion_cleanup
        SET
          runtime_logs_completed_at = CURRENT_TIMESTAMP,
          temporal_completed_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1::text[])
      `,
      [[oldWebReceiptId, preExpandReceiptId]],
    );
    await pool.query(
      "DELETE FROM hosted_account_deletion_cleanup WHERE id = ANY($1::text[])",
      [[oldWebReceiptId, preExpandReceiptId]],
    );
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

  it("rejects a second logical database on the primary physical cluster", async () => {
    const runtimeDatabaseUrl = postgresDatabaseUrl(
      primaryDatabaseUrl,
      testDatabaseName,
    );

    await expect(verifyHostedRuntimeLogDatabaseEndpoints({
      directDatabaseUrl: runtimeDatabaseUrl,
      primaryDirectDatabaseUrl: primaryDatabaseUrl,
      runtimeDatabaseUrl,
    })).rejects.toThrow(
      /same PostgreSQL cluster as DIRECT_DATABASE_URL/u,
    );
  });

  it("rejects disabled and over-budget statement timeouts with PostgreSQL", async () => {
    const postgresAdmin = requireClient(admin);
    const runtimeDatabaseUrl = postgresDatabaseUrl(
      primaryDatabaseUrl,
      testDatabaseName,
    );

    try {
      for (const timeout of ["0", "10001ms"] as const) {
        await setTestDatabaseStatementTimeout(
          postgresAdmin,
          testDatabaseName,
          timeout,
        );
        await expect(verifyHostedRuntimeLogDatabaseEndpoints({
          directDatabaseUrl: runtimeDatabaseUrl,
          primaryDirectDatabaseUrl: primaryDatabaseUrl,
          runtimeDatabaseUrl,
        })).rejects.toThrow(
          /statement_timeout set to a positive value no greater than 10 seconds/u,
        );
      }
    } finally {
      await setTestDatabaseStatementTimeout(
        postgresAdmin,
        testDatabaseName,
        "10s",
      );
    }
  });

  it("keeps pre-change receipts until isolated and Temporal cleanup complete", async () => {
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
    await expect(postgres.query<{
      runtimeLogsCompletedAt: Date | null;
      temporalCompletedAt: Date | null;
      temporalNextRuntimeIndex: number;
    }>(
      `
        SELECT
          runtime_logs_completed_at AS "runtimeLogsCompletedAt",
          temporal_completed_at AS "temporalCompletedAt",
          temporal_next_runtime_index AS "temporalNextRuntimeIndex"
        FROM hosted_account_deletion_cleanup
        WHERE id = $1
      `,
      [cleanupId],
    )).resolves.toMatchObject({
      rows: [{
        runtimeLogsCompletedAt: null,
        temporalCompletedAt: null,
        temporalNextRuntimeIndex: 0,
      }],
    });

    await postgres.query(
      `
        UPDATE hosted_account_deletion_cleanup
        SET temporal_completed_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [cleanupId],
    );
    await expect(postgres.query(
      "DELETE FROM hosted_account_deletion_cleanup WHERE id = $1",
      [cleanupId],
    )).rejects.toMatchObject({ code: "23514" });
    await postgres.query(
      `
        UPDATE hosted_account_deletion_cleanup
        SET
          runtime_logs_completed_at = CURRENT_TIMESTAMP,
          temporal_completed_at = NULL
        WHERE id = $1
      `,
      [cleanupId],
    );
    await expect(postgres.query(
      "DELETE FROM hosted_account_deletion_cleanup WHERE id = $1",
      [cleanupId],
    )).rejects.toMatchObject({ code: "23514" });
    await postgres.query(
      `
        UPDATE hosted_account_deletion_cleanup
        SET temporal_completed_at = CURRENT_TIMESTAMP
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

  it("executes dedicated recent and timing reads against the migrated schema", async () => {
    const sql = requireDatabase(database);
    const userId = `member_runtime_log_reads_${randomToken()}`;
    rememberSubject(subjectKeys, userId);
    const attemptId = `attempt_${randomToken()}`;

    await expect(recordHostedRuntimeLogs({
      database: sql,
      entries: [
        runtimeEntry(),
        timingEntry({
          attemptId,
          stage: "reply-dispatched",
        }),
        timingEntry({
          attemptId,
          stage: "provider-result",
        }),
      ],
      isUserActive: async () => true,
      userId,
    })).resolves.toBe(3);

    const recent = await listHostedRuntimeLogs({
      database: sql,
      limit: 10,
      userId,
    });
    expect(recent).toHaveLength(3);
    expect(recent.every((row) => row.userId === userId)).toBe(true);
    expect(recent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        component: "mailbox",
        eventCode: "mailbox.imported",
      }),
      expect.objectContaining({
        attemptId,
        eventCode: "assistant.automation_detail",
      }),
    ]));

    const timing = await listHostedRuntimeTurnTimingLogs({
      attemptIds: [attemptId],
      database: sql,
      from: new Date("2026-07-29T00:00:00.000Z"),
      limit: 10,
      to: new Date("2026-07-30T00:00:00.000Z"),
    });
    expect(timing).toEqual([
      expect.objectContaining({
        attemptId,
        redactedJson: expect.objectContaining({
          turnTimingStage: "reply-dispatched",
        }),
      }),
    ]);
  });

  it("executes one-row retention batches with separate verbose and hard cutoffs", async () => {
    const postgres = requirePool(pool);
    const userId = `member_runtime_log_retention_${randomToken()}`;
    const subjectKey = rememberSubject(subjectKeys, userId);
    const rowPrefix = `retention_${randomToken()}`;
    const rows = [
      [`${rowPrefix}_old_info`, "2026-07-20T00:00:00.000Z", "info"],
      [`${rowPrefix}_recent_info`, "2026-07-23T00:00:00.000Z", "info"],
      [`${rowPrefix}_old_warn`, "2026-07-14T00:00:00.000Z", "warn"],
      [`${rowPrefix}_recent_warn`, "2026-07-19T00:00:00.000Z", "warn"],
    ] as const;
    for (const [id, at, level] of rows) {
      await postgres.query(
        `
          INSERT INTO hosted_runtime_log (
            id,
            subject_key,
            at,
            level,
            component,
            phase,
            event_code
          )
          VALUES ($1, $2, $3, $4, 'mailbox', 'import', 'mailbox.imported')
        `,
        [id, subjectKey, at, level],
      );
    }

    await expect(deleteExpiredHostedRuntimeLogs({
      batchSize: 1,
      database: requireDatabase(database),
      maxBatches: 4,
      retentionCutoff: new Date("2026-07-15T00:00:00.000Z"),
      verboseCutoff: new Date("2026-07-22T00:00:00.000Z"),
    })).resolves.toBe(2);

    await expect(postgres.query<{ id: string }>(
      `
        SELECT id
        FROM hosted_runtime_log
        WHERE subject_key = $1
        ORDER BY id
      `,
      [subjectKey],
    )).resolves.toMatchObject({
      rows: [
        { id: `${rowPrefix}_recent_info` },
        { id: `${rowPrefix}_recent_warn` },
      ],
    });
  });
});

function runtimeEntry() {
  return {
    at: "2026-07-29T12:00:00.000Z",
    component: "mailbox" as const,
    eventCode: "mailbox.imported" as const,
    level: "info" as const,
    phase: "import" as const,
  };
}

function timingEntry(input: {
  attemptId: string;
  stage: string;
}) {
  return {
    at: input.stage === "reply-dispatched"
      ? "2026-07-29T12:00:02.000Z"
      : "2026-07-29T12:00:01.000Z",
    attemptId: input.attemptId,
    component: "assistant" as const,
    eventCode: "assistant.automation_detail" as const,
    level: "info" as const,
    phase: "active_turn_input" as const,
    redactedJson: {
      schema: "murph.assistant-turn-timing.v1",
      turnTimingStage: input.stage,
      type: "assistant.turn.timing",
    },
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

function requireClient(value: Client | null): Client {
  if (!value) {
    throw new Error("Runtime-log test client is unavailable.");
  }
  return value;
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

async function setTestDatabaseStatementTimeout(
  client: Client,
  databaseName: string,
  timeout: "0" | "10s" | "10001ms",
): Promise<void> {
  if (!/^[a-z0-9_]+$/u.test(databaseName)) {
    throw new TypeError("Runtime-log test database name is invalid.");
  }
  await client.query(
    `ALTER DATABASE "${databaseName}" SET statement_timeout = '${timeout}'`,
  );
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

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

import { summarizeDeviceImportHealth } from "@/src/lib/hosted-runtime-progress/device-import-health";
import { readDeviceImportObservations } from "@/src/lib/hosted-runtime-progress/device-import-observation";
import { findHostedUsageLimitedPersonalPatternsOccurrences } from "@/src/lib/hosted-runtime-log/usage-gate";

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

  it("projects bounded device import metadata without exposing payloads", async () => {
    const db = requireDatabase(database);
    const now = new Date("2026-08-10T16:00:00Z");
    const subject = hostedRuntimeLogSubjectKey("synthetic-import-runtime");
    const entries = [
      { event: "device-sync.pass_finished", details: { outcome: "yielded", processedJobs: 7, deviceSyncConnectionKey: "c".repeat(64),
        incomingRetainedProgressFingerprint: "a".repeat(64), outgoingRetainedProgressFingerprint: "b".repeat(64),
        outgoingRetainedJobCount: 10, pendingJobCountAfter: 10, queueSnapshotAfterPresent: true,
        yieldReason: "outer_signal", privateCanary: "must-not-be-selected" } },
      { event: "checkpoint.snapshot_finished", details: { webCheckpointAccepted: true } },
      { event: "runner.processing_finished", details: { runtimeProcessingOutcome: "runtime_processing_accepted", runtimeProcessingAction: "woken" } },
      { event: "runner.processing_finished", details: { runtimeProcessingOutcome: "runtime_processing_accepted", runtimeProcessingAction: "started" } },
      { event: "device-sync.pass_finished", details: { processedJobs: "malformed", deviceSyncConnectionKey: "not-a-connection-key", pendingJobCountAfter: "malformed", queueSnapshotAfterPresent: true } },
      { event: "device-sync.pass_finished", details: { outcome: "completed", processedJobs: 0, pendingJobCountAfter: 0, outgoingRetainedJobCount: 0, queueSnapshotAfterPresent: true } },
      { event: "device-sync.pass_finished", details: { processedJobs: 4, deviceSyncImportAppliedCount: 4,
        incomingRetainedProgressFingerprint: "a".repeat(64), outgoingRetainedProgressFingerprint: "a".repeat(64) } },
      { event: "device-sync.pass_finished", details: { processedJobs: 4, deviceSyncImportNoopCount: 4,
        incomingRetainedProgressFingerprint: "a".repeat(64), outgoingRetainedProgressFingerprint: "a".repeat(64) } },
    ];
    for (const [index, entry] of entries.entries()) {
      await db.query(`INSERT INTO hosted_runtime_log (id, subject_key, at, level, component, phase, event_code, attempt_id, redacted_json)
        VALUES ($1, $2, $3, 'info', 'runtime', 'invoke', $4, 'synthetic-attempt', $5::jsonb)`,
        [randomUUID(), subject, new Date(+now - (entries.length - index) * 1000), entry.event, JSON.stringify(entry.details)]);
    }
    const observations = await readDeviceImportObservations({ database: db, now, subjects: [subject] });
    expect(observations).toHaveLength(8);
    expect(observations[0]).toMatchObject({ pending: true, progressed: true, cancelled: true, connectionKey: "c".repeat(64) });
    expect(observations[1]).toMatchObject({ checkpointAccepted: true, connectionKey: null });
    expect(observations[2]).toMatchObject({ restarted: false });
    expect(observations[3]).toMatchObject({ restarted: true });
    expect(observations[4]).toMatchObject({ pending: null, progressed: false, connectionKey: null });
    expect(observations[5]).toMatchObject({ pending: false, connectionKey: null });
    expect(observations[6]).toMatchObject({ progressed: true });
    expect(observations[7]).toMatchObject({ progressed: false });
    expect(JSON.stringify(observations)).not.toContain("must-not-be-selected");
    expect(await readDeviceImportObservations({ database: db, now, subjects: ["unrelated-subject"] })).toEqual([]);
  });

  it("distinguishes scheduled work through the actual SQL reader and checkpointed evaluator", async () => {
    const db = requireDatabase(database);
    const now = new Date("2026-08-10T16:00:00Z");
    const scheduled = { outcome: "completed", deviceSyncConnectionKey: "d".repeat(64),
      outgoingRetainedJobCount: 2, incomingRetainedJobCount: 2, pendingJobCountAfter: 2,
      queueSnapshotAfterPresent: true, pendingJobCountAfterTruncated: false,
      pendingRunnableJobCountAfter: 0, outgoingRetainedRunnableJobCount: 0 };
    const cases = [
      { name: "scheduled", patch: {}, runnable: false, backlog: false },
      { name: "queue-due", patch: { pendingRunnableJobCountAfter: 1 }, runnable: true, backlog: true },
      { name: "continuation-due", patch: { outgoingRetainedRunnableJobCount: 1 }, runnable: true, backlog: true },
      { name: "failed", patch: { outcome: "failed" }, runnable: null, backlog: true },
      { name: "truncated", patch: { pendingJobCountAfterTruncated: true }, runnable: null, backlog: true },
      { name: "unobserved", patch: { queueSnapshotAfterPresent: false }, runnable: null, backlog: true },
      { name: "legacy", patch: { pendingRunnableJobCountAfter: undefined,
        outgoingRetainedRunnableJobCount: undefined }, runnable: null, backlog: true },
      { name: "malformed", patch: { outgoingRetainedRunnableJobCount: "invalid" }, runnable: null, backlog: true },
    ];
    for (const scenario of cases) {
      const subject = hostedRuntimeLogSubjectKey(`synthetic-availability-${scenario.name}`);
      subjectKeys.add(subject);
      for (let age = 70; age >= 0; age -= 5) {
        for (const [event, offset, details] of [
          ["device-sync.pass_finished", 1000, { ...scheduled, ...scenario.patch }],
          ["checkpoint.snapshot_finished", 0, { webCheckpointAccepted: true }],
        ] as const) {
          await db.query(`INSERT INTO hosted_runtime_log (id, subject_key, at, level, component, phase, event_code, attempt_id, redacted_json)
            VALUES ($1, $2, $3, 'info', 'runtime', 'invoke', $4, $5, $6::jsonb)`,
          [randomUUID(), subject, new Date(+now - age * 60_000 - offset), event,
            `synthetic-attempt-${age}`, JSON.stringify(details)]);
        }
      }
      const observations = await readDeviceImportObservations({ database: db, now, subjects: [subject] });
      expect(observations[0], scenario.name).toMatchObject({ pending: true, runnable: scenario.runnable });
      const healthyWake = summarizeDeviceImportHealth({ now, observations, dueSubjects: new Set() });
      expect(healthyWake.backlog.anomalous, scenario.name).toBe(scenario.backlog);
      expect(healthyWake.stalled.anomalous, scenario.name).toBe(false);
      expect(summarizeDeviceImportHealth({ now, observations, dueSubjects: new Set([subject]) })
        .stalled.anomalous, scenario.name).toBe(true);
    }
  });

  it.each([0, 1])("keeps failed retained work pending through retry checkpoints with %i local jobs", async (pendingJobCount) => {
    // The runtime producer asserts this same metadata on a late reconciliation failure.
    const failedPass = JSON.parse(await readFile(new URL(
      "../../../packages/assistant-runtime/test/fixtures/device-import-failed-pass.json", import.meta.url,
    ), "utf8"));
    const db = requireDatabase(database);
    const now = new Date("2026-08-10T16:00:00Z");
    const subject = hostedRuntimeLogSubjectKey(`synthetic-failed-import-${pendingJobCount}`);
    const insert = async (minutesAgo: number, event: string, details: Record<string, unknown>) => {
      await db.query(`INSERT INTO hosted_runtime_log (id, subject_key, at, level, component, phase, event_code, attempt_id, redacted_json)
        VALUES ($1, $2, $3, 'info', 'runtime', 'invoke', $4, 'synthetic-retry-attempt', $5::jsonb)`,
      [randomUUID(), subject, new Date(+now - minutesAgo * 60_000), event, JSON.stringify(details)]);
    };
    for (const age of [20, 15, 10, 5]) {
      await insert(age, "device-sync.pass_finished", { ...failedPass, pendingJobCountAfter: pendingJobCount });
      await insert(age - 0.1, "checkpoint.snapshot_finished", { webCheckpointAccepted: true });
      await insert(age - 0.2, "runner.processing_finished", {
        runtimeProcessingOutcome: "runtime_processing_accepted", runtimeProcessingAction: "started",
      });
    }
    const observations = await readDeviceImportObservations({ database: db, now, subjects: [subject] });
    for (const pass of observations.filter(row => row.eventCode === "device-sync.pass_finished")) {
      expect(pass).toMatchObject({ pending: true, progressed: false });
    }
    const health = () => summarizeDeviceImportHealth({ now, observations, dueSubjects: new Set([subject]) });
    expect(health().stalled).toMatchObject({ anomalous: true, savedProgressPassCount: 0 });
    expect(health().cycling).toMatchObject({ anomalous: true, savedProgressPassCount: 0 });
    // Applied canonical imports can still be saved by a retry checkpoint.
    await insert(3, "device-sync.pass_finished", { ...failedPass, pendingJobCountAfter: 0, deviceSyncImportAppliedCount: 1 });
    await insert(2.9, "checkpoint.snapshot_finished", { webCheckpointAccepted: true });
    const applied = await readDeviceImportObservations({ database: db, now, subjects: [subject] });
    expect(applied.find(row => row.at.getTime() === +now - 3 * 60_000)).toMatchObject({ pending: true, progressed: true });
    expect(summarizeDeviceImportHealth({ now, observations: applied, dueSubjects: new Set([subject]) }).cycling)
      .toMatchObject({ anomalous: true, savedProgressPassCount: 1 });
    // Only a successfully returned drain and its checkpoint resolve the retry obligation.
    await insert(1, "device-sync.pass_finished", { ...failedPass, outcome: "completed", pendingJobCountAfter: 0 });
    const beforeCheckpoint = await readDeviceImportObservations({ database: db, now, subjects: [subject] });
    expect(summarizeDeviceImportHealth({ now, observations: beforeCheckpoint, dueSubjects: new Set([subject]) }).cycling.anomalous).toBe(true);
    await insert(0.5, "checkpoint.snapshot_finished", { webCheckpointAccepted: true });
    const recovered = await readDeviceImportObservations({ database: db, now, subjects: [subject] });
    const result = summarizeDeviceImportHealth({ now, observations: recovered, dueSubjects: new Set([subject]) });
    expect(result.stalled.anomalous).toBe(false);
    expect(result.cycling.anomalous).toBe(false);
  });

  afterAll(async () => {
    if (pool && subjectKeys.size > 0) {
      await pool.query(
        "DELETE FROM hosted_runtime_log WHERE subject_key = ANY($1::text[])",
        [[...subjectKeys]],
      );
    }
    await pool?.end();
    // pg-pool can resolve end() before its clients finish disconnecting.
    await admin?.query(`DROP DATABASE IF EXISTS "${testDatabaseName}"`);
    await admin?.end();
  }, 30_000);

  it("classifies usage-pause expirations across recovery with tenant isolation", async () => {
    const userId = `usage_gate_${randomToken()}`;
    const otherUserId = `usage_gate_other_${randomToken()}`;
    const db = requireDatabase(database);
    for (const member of [userId, otherUserId]) subjectKeys.add(hostedRuntimeLogSubjectKey(member));
    const recordGate = (member: string, hour: number, usageLimited: boolean) => recordHostedRuntimeLogs({
      database: db, isUserActive: async () => true, userId: member,
      entries: [{ at: `2026-08-01T${String(hour).padStart(2, "0")}:00:00.000Z`,
        component: "runtime", eventCode: "assistant.automation_detail", level: "info", phase: "invoke",
        redactedJson: { type: "runtime.ai_usage_gate", usageLimited } }],
    });
    await recordGate(userId, 8, true);
    await recordGate(userId, 12, false);
    await recordGate(userId, 15, true);
    await recordGate(userId, 17, false);
    await recordGate(otherUserId, 13, true);
    // Same-millisecond contradictory evidence stays conservative, irrespective
    // of insertion order. A provider quota retry is evidence for its exact run.
    await recordGate(userId, 21, false);
    await recordGate(userId, 21, true);
    await recordHostedRuntimeLogs({
      database: db, isUserActive: async () => true, userId,
      entries: [{ at: "2026-08-01T05:15:00.000Z", component: "assistant",
        eventCode: "assistant.automation_detail", level: "info", phase: "invoke",
        redactedJson: { type: "cron.job.completed", failureAutomationSlug: "personal-patterns-update",
          failureRunOutcome: "failed", failureRetryScheduled: true,
          failureOccurrenceAt: "2026-08-01T05:00:00.000Z", failureErrorCode: "ASSISTANT_CODEX_USAGE_LIMIT" } }],
    });
    const at = (hour: number) => `2026-08-01T${String(hour).padStart(2, "0")}:00:00.000Z`;
    await expect(findHostedUsageLimitedPersonalPatternsOccurrences({ database: db, userId, occurrences: [
      { occurrenceAt: at(9), observedAt: at(13) }, // paused at occurrence, since reset
      { occurrenceAt: at(13), observedAt: at(14) }, // allowed; other member denied
      { occurrenceAt: at(14), observedAt: at(18) }, // denial during the wait
      { occurrenceAt: at(18), observedAt: at(20) }, // recovery before occurrence
      { occurrenceAt: at(6), observedAt: at(7) }, // unrelated occurrence, no evidence
      { occurrenceAt: at(5), observedAt: at(7) }, // provider quota before expiry
      { occurrenceAt: at(21), observedAt: at(22) }, // contradictory boundary observations
    ] })).resolves.toEqual(new Set([at(5), at(9), at(14)]));
    await expect(findHostedUsageLimitedPersonalPatternsOccurrences({ database: db, userId,
      occurrences: Array.from({ length: 50 }, () => ({ occurrenceAt: at(9), observedAt: at(13) })),
    })).resolves.toEqual(new Set([at(9)]));
    await expect(findHostedUsageLimitedPersonalPatternsOccurrences({ database: db, userId,
      occurrences: Array.from({ length: 51 }, () => ({ occurrenceAt: at(9), observedAt: at(13) })),
    })).rejects.toThrow("Too many alert occurrences.");
    await expect(findHostedUsageLimitedPersonalPatternsOccurrences({
      database: db, userId: `unknown_${randomToken()}`,
      occurrences: [{ occurrenceAt: at(9), observedAt: at(20) }],
    })).resolves.toEqual(new Set());
  });

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

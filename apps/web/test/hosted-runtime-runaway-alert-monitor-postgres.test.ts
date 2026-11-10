import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  HOSTED_RUNTIME_RUNAWAY_INVOCATION_THRESHOLD as THRESHOLD,
  HOSTED_RUNTIME_RUNAWAY_PROCESSING_ATTEMPT_THRESHOLD as ATTEMPTS,
  HOSTED_RUNTIME_RUNAWAY_PROCESSING_RETRY_THRESHOLD as RETRIES,
  HOSTED_RUNTIME_RUNAWAY_SNAPSHOT_THRESHOLD as SNAPSHOTS,
  readHostedRuntimeRunawayHealth,
} from "@/src/lib/hosted-runtime-log/runaway-alert-monitor";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Runaway aggregate proof requires a local DATABASE_URL.");
}

describe.skipIf(!enabled)("runtime runaway PostgreSQL aggregate", () => {
  const now = new Date("2026-10-04T16:00:00Z");
  const client = new pg.Client({ connectionString: databaseUrl });
  const database = { async query<Row extends Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
    return client.query<Row>(sql, values ? [...values] : undefined);
  } };
  const subject = "abcdef01" + "0".repeat(56);
  beforeAll(async () => {
    await client.connect();
    // Connection-local synthetic table shadows any real table, with no durable writes.
    await client.query(`CREATE TEMP TABLE hosted_runtime_log (
      subject_key text, at timestamptz, event_code text, redacted_json jsonb
    )`);
  });
  afterAll(async () => { await client.end(); });
  beforeEach(async () => { await client.query("TRUNCATE pg_temp.hosted_runtime_log"); });

  async function seed(count: number, input: {
    key?: string; at?: Date; event?: string; metadata?: Record<string, unknown>;
  } = {}) {
    await client.query(`INSERT INTO pg_temp.hosted_runtime_log
      SELECT $1, $2, $3, $4::jsonb FROM generate_series(1, $5::int)`, [
      input.key ?? subject, input.at ?? now, input.event ?? "runtime.invocation_finished",
      JSON.stringify(input.metadata ?? { processingMode: "system_mailbox", nextWakeReason: "device-sync.reconcile" }), count,
    ]);
  }

  const claimLoop = { runtimeProcessingRequestedMode: "system_mailbox",
    runtimeProcessingOutcome: "retry_later", runtimeProcessingRetryReason: "claim_blocked" };
  const acceptedStart = { runtimeProcessingRequestedMode: "system_mailbox",
    runtimeProcessingOutcome: "runtime_processing_accepted", runtimeProcessingAction: "started" };
  async function seedAttempts(count: number, input: Parameters<typeof seed>[1] = {}) {
    await seed(count, { event: "runner.processing_finished", metadata: claimLoop, ...input });
  }
  async function seedAccepted(count: number, input: Parameters<typeof seed>[1] = {}) {
    await seedAttempts(count, { metadata: acceptedStart, ...input });
  }
  async function seedSnapshots(count: number, input: Parameters<typeof seed>[1] = {}) {
    await seed(count, { event: "checkpoint.snapshot_finished",
      metadata: { checkpointReason: "idle_shutdown", snapshotElapsedMs: 5_500 }, ...input });
  }

  it.each([SNAPSHOTS - 1, SNAPSHOTS, SNAPSHOTS + 1])("alerts on snapshots alone at %s", async count => {
    await seedSnapshots(count);
    expect(await readHostedRuntimeRunawayHealth({ now, database })).toEqual({
      anomalous: count >= SNAPSHOTS, runawaySubjectCount: count >= SNAPSHOTS ? 1 : 0,
      worstInvocationCount: 0,
      subjects: count >= SNAPSHOTS ? [{ subjectPrefix: "abcdef01", invocationCount: 0,
        processingAttemptCount: 0, processingRetryCount: 0, snapshotCount: count,
        snapshotSeconds: Math.round(count * 5.5), checkpointReason: "idle_shutdown",
        processingMode: "none", nextWakeReason: "none", processingOutcome: "none" }] : [],
    });
  });

  it("aggregates only snapshot numeric durations and dominant allowlisted reasons", async () => {
    await seedSnapshots(SNAPSHOTS);
    for (const snapshotElapsedMs of ["5500", "private@example.test", null, true, {}, []]) {
      await seedSnapshots(1, { metadata: { checkpointReason: "import", snapshotElapsedMs } });
    }
    await seedSnapshots(1, { metadata: { checkpointReason: "import", snapshotElapsedMs: 500.5 } });
    await seed(1, { metadata: { processingMode: "default", checkpointReason: "import", snapshotElapsedMs: 999_999 } });
    const health = await readHostedRuntimeRunawayHealth({ now, database });
    expect(health.subjects[0]).toMatchObject({ snapshotCount: SNAPSHOTS + 7,
      snapshotSeconds: 166, checkpointReason: "idle_shutdown", processingMode: "default" });
  });

  it.each(["private@example.test", null, { private: "value" }])("redacts unknown checkpoint reason %j", async checkpointReason => {
    await seedSnapshots(SNAPSHOTS, { metadata: { checkpointReason } });
    const health = await readHostedRuntimeRunawayHealth({ now, database });
    expect(health.subjects[0]).toMatchObject({ checkpointReason: "unknown", snapshotSeconds: 0 });
    expect(JSON.stringify(health)).not.toMatch(/private|@/);
  });

  it.each([THRESHOLD - 1, THRESHOLD, THRESHOLD + 1])("evaluates the actual SQL threshold at %s events", async count => {
    await seed(count);
    expect(await readHostedRuntimeRunawayHealth({ now, database })).toMatchObject({
      anomalous: count >= THRESHOLD, runawaySubjectCount: count >= THRESHOLD ? 1 : 0,
    });
  });

  it("requires four populated baseline days and catches distributed fleet growth", async () => {
    const dayMs = 24 * 60 * 60_000;
    for (let day = 1; day <= 3; day += 1) {
      await seed(10, { at: new Date(+now - day * dayMs) });
    }
    for (let member = 0; member < 6; member += 1) {
      await seed(20, { key: member.toString(16).padStart(64, "0") });
    }
    expect(await readHostedRuntimeRunawayHealth({ now, database })).toEqual({
      anomalous: false, runawaySubjectCount: 0, worstInvocationCount: 0, subjects: [],
    });
    await seed(10, { at: new Date(+now - 4 * dayMs) });
    expect(await readHostedRuntimeRunawayHealth({ now, database })).toEqual({
      anomalous: true, runawaySubjectCount: 0, worstInvocationCount: 0, subjects: [],
      fleet: { invocationCount: 120, baselineMedian: 10 },
    });
  });

  it("requires both the threefold and 100-invocation fleet increases", async () => {
    const dayMs = 24 * 60 * 60_000;
    for (let day = 1; day <= 4; day += 1) {
      await seed(50, { at: new Date(+now - day * dayMs) });
    }
    for (let member = 0; member < 7; member += 1) {
      await seed(20, { key: member.toString(16).padStart(64, "0") });
    }
    expect((await readHostedRuntimeRunawayHealth({ now, database })).anomalous).toBe(false);
    await seed(10, { key: "f".repeat(64) });
    expect((await readHostedRuntimeRunawayHealth({ now, database })).fleet)
      .toEqual({ invocationCount: 150, baselineMedian: 50 });
    expect((await readHostedRuntimeRunawayHealth({ now, database })).anomalous).toBe(true);
  });

  it("excludes old, future and unrelated events, includes the exact window boundary", async () => {
    await seed(THRESHOLD - 1);
    await seed(50, { at: new Date(+now - 60 * 60_000 - 1) });
    await seed(50, { at: new Date(+now + 1) });
    await seed(50, { event: "runtime.invocation_started" });
    await seedAccepted(ATTEMPTS - RETRIES);
    await seedAttempts(RETRIES - 1);
    await seedSnapshots(SNAPSHOTS - 1);
    await seedSnapshots(50, { at: new Date(+now - 60 * 60_000 - 1) });
    await seedSnapshots(50, { at: new Date(+now + 1) });
    expect((await readHostedRuntimeRunawayHealth({ now, database })).anomalous).toBe(false);
    await seed(1, { at: new Date(+now - 60 * 60_000) });
    await seedSnapshots(1, { at: new Date(+now - 60 * 60_000) });
    expect((await readHostedRuntimeRunawayHealth({ now, database })).subjects[0]?.invocationCount).toBe(THRESHOLD);
    expect((await readHostedRuntimeRunawayHealth({ now, database })).subjects[0]?.snapshotCount).toBe(SNAPSHOTS);
  });

  it("caps top subjects while preserving the total and dominant redacted labels", async () => {
    for (let index = 0; index < 12; index += 1) {
      await seed(40 + index, { key: index.toString(16).padStart(64, "0") });
    }
    await seed(100);
    await seed(1, { metadata: { processingMode: "default", nextWakeReason: "assistant" } });
    const health = await readHostedRuntimeRunawayHealth({ now, database });
    expect(health.runawaySubjectCount).toBe(13);
    expect(health.subjects).toHaveLength(10);
    expect(health.subjects[0]).toEqual({ subjectPrefix: "abcdef01", invocationCount: 101,
      processingAttemptCount: 0, processingRetryCount: 0, processingMode: "system_mailbox",
      nextWakeReason: "device-sync.reconcile", processingOutcome: "none",
      snapshotCount: 0, snapshotSeconds: 0, checkpointReason: "none" });
    expect(health.subjects[1]?.invocationCount).toBe(51);
    expect(JSON.stringify(health)).not.toContain(subject);
  });

  it("keeps the largest invocation count when other signals fill the subject limit", async () => {
    for (let member = 0; member < 10; member += 1) {
      await seedSnapshots(90, { key: member.toString(16).padStart(64, "0") });
    }
    await seed(25);
    const health = await readHostedRuntimeRunawayHealth({ now, database });
    expect(health.subjects).toHaveLength(10);
    expect(health.subjects.every(row => row.invocationCount === 0)).toBe(true);
    expect(health.worstInvocationCount).toBe(25);
  });

  it("labels the known inbox media retention wake reason", async () => {
    await seed(40, { metadata: { processingMode: "default", nextWakeReason: "inbox_media_retention" } });
    const health = await readHostedRuntimeRunawayHealth({ now, database });
    expect(health.subjects).toEqual([{ subjectPrefix: "abcdef01", invocationCount: 40,
      processingAttemptCount: 0, processingRetryCount: 0, processingMode: "default",
      nextWakeReason: "inbox_media_retention", processingOutcome: "none",
      snapshotCount: 0, snapshotSeconds: 0, checkpointReason: "none" }]);
  });

  it("does not return private or malformed diagnostic values", async () => {
    await seed(40, { key: "synthetic-member-id", metadata: {
      processingMode: "private@example.test", nextWakeReason: "+15555550123",
      content: "synthetic private content",
    } });
    await seedAttempts(10, { key: "synthetic-member-id", metadata: {
      runtimeProcessingRequestedMode: "private@example.test", runtimeProcessingOutcome: "retry_later",
      runtimeProcessingRetryReason: "+15555550123",
    } });
    const health = await readHostedRuntimeRunawayHealth({ now, database });
    expect(health.subjects).toEqual([{ subjectPrefix: "unknown", invocationCount: 40,
      processingAttemptCount: 10, processingRetryCount: 10, processingMode: "unknown",
      // An unlisted reason keeps only the fixed outcome label.
      nextWakeReason: "unknown", processingOutcome: "retry_later",
      snapshotCount: 0, snapshotSeconds: 0, checkpointReason: "none" }]);
    expect(JSON.stringify(health)).not.toMatch(/synthetic|@|15555550123/);
  });

  it.each([ATTEMPTS - 1, ATTEMPTS, ATTEMPTS + 1])("alerts on accepted processing attempts alone at %s", async count => {
    await seedAccepted(count);
    expect(await readHostedRuntimeRunawayHealth({ now, database })).toEqual({
      anomalous: count >= ATTEMPTS, runawaySubjectCount: count >= ATTEMPTS ? 1 : 0,
      worstInvocationCount: 0,
      subjects: count >= ATTEMPTS ? [{ subjectPrefix: "abcdef01", invocationCount: 0,
        processingAttemptCount: count, processingRetryCount: 0, processingMode: "system_mailbox",
        nextWakeReason: "none", processingOutcome: "runtime_processing_accepted",
        snapshotCount: 0, snapshotSeconds: 0, checkpointReason: "none" }] : [],
    });
  });

  it.each([RETRIES - 1, RETRIES, RETRIES + 1])("alerts on retry_later attempts alone at %s", async count => {
    // A busy member's accepted starts stay below the total threshold.
    await seedAccepted(ATTEMPTS - RETRIES - 2);
    await seedAttempts(count);
    expect(await readHostedRuntimeRunawayHealth({ now, database })).toEqual({
      anomalous: count >= RETRIES, runawaySubjectCount: count >= RETRIES ? 1 : 0,
      worstInvocationCount: 0,
      subjects: count >= RETRIES ? [{ subjectPrefix: "abcdef01", invocationCount: 0,
        processingAttemptCount: ATTEMPTS - RETRIES - 2 + count, processingRetryCount: count,
        processingMode: "system_mailbox", nextWakeReason: "none",
        processingOutcome: "runtime_processing_accepted",
        snapshotCount: 0, snapshotSeconds: 0, checkpointReason: "none" }] : [],
    });
  });

  it("does not alert on a busy member whose attempts are accepted", async () => {
    await seedAccepted(35);
    await seedAttempts(1);
    expect((await readHostedRuntimeRunawayHealth({ now, database })).anomalous).toBe(false);
  });

  it("ranks subjects by their worst ratio to any threshold and labels accepted attempts", async () => {
    const invocations = "1".repeat(64);
    const retryStorm = "2".repeat(64);
    const snapshotLoop = "3".repeat(64);
    await seedSnapshots(SNAPSHOTS * 3, { key: snapshotLoop });
    await seed(THRESHOLD + 5, { key: invocations });
    await seedAttempts(ATTEMPTS * 2, { metadata: { runtimeProcessingRequestedMode: "default",
      runtimeProcessingOutcome: "runtime_processing_accepted", runtimeProcessingAction: "started" } });
    // 2.5x the retry threshold outranks 2x the attempt threshold.
    await seedAttempts(RETRIES * 2.5, { key: retryStorm });
    const health = await readHostedRuntimeRunawayHealth({ now, database });
    expect(health.subjects.map(({ subjectPrefix, processingOutcome }) => [subjectPrefix, processingOutcome]))
      .toEqual([["33333333", "none"], ["22222222", "retry_later:claim_blocked"], ["abcdef01", "runtime_processing_accepted"],
        ["11111111", "none"]]);
  });
});

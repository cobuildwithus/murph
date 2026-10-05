import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  HOSTED_RUNTIME_RUNAWAY_INVOCATION_THRESHOLD as THRESHOLD,
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

  it.each([THRESHOLD - 1, THRESHOLD, THRESHOLD + 1])("evaluates the actual SQL threshold at %s events", async count => {
    await seed(count);
    expect(await readHostedRuntimeRunawayHealth({ now, database })).toMatchObject({
      anomalous: count >= THRESHOLD, runawaySubjectCount: count >= THRESHOLD ? 1 : 0,
    });
  });

  it("excludes old, future and unrelated events, includes the exact window boundary", async () => {
    await seed(THRESHOLD - 1);
    await seed(50, { at: new Date(+now - 60 * 60_000 - 1) });
    await seed(50, { at: new Date(+now + 1) });
    await seed(50, { event: "runner.processing_finished" });
    expect((await readHostedRuntimeRunawayHealth({ now, database })).anomalous).toBe(false);
    await seed(1, { at: new Date(+now - 60 * 60_000) });
    expect((await readHostedRuntimeRunawayHealth({ now, database })).subjects[0]?.invocationCount).toBe(THRESHOLD);
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
      processingMode: "system_mailbox", nextWakeReason: "device-sync.reconcile" });
    expect(health.subjects[1]?.invocationCount).toBe(51);
    expect(JSON.stringify(health)).not.toContain(subject);
  });

  it("labels the known inbox media retention wake reason", async () => {
    await seed(40, { metadata: { processingMode: "default", nextWakeReason: "inbox_media_retention" } });
    const health = await readHostedRuntimeRunawayHealth({ now, database });
    expect(health.subjects).toEqual([{ subjectPrefix: "abcdef01", invocationCount: 40,
      processingMode: "default", nextWakeReason: "inbox_media_retention" }]);
  });

  it("does not return private or malformed diagnostic values", async () => {
    await seed(40, { key: "synthetic-member-id", metadata: {
      processingMode: "private@example.test", nextWakeReason: "+15555550123",
      content: "synthetic private content",
    } });
    const health = await readHostedRuntimeRunawayHealth({ now, database });
    expect(health.subjects).toEqual([{ subjectPrefix: "unknown", invocationCount: 40,
      processingMode: "unknown", nextWakeReason: "unknown" }]);
    expect(JSON.stringify(health)).not.toMatch(/synthetic|@|15555550123/);
  });
});

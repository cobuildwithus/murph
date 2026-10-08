import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  HOSTED_AUTOMATION_LOSS_RUNTIME_THRESHOLD as THRESHOLD,
  HOSTED_AUTOMATION_LOSS_WINDOW_MS as WINDOW,
  readHostedAutomationLossHealth,
} from "@/src/lib/hosted-runtime-log/automation-loss-alert-monitor";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Automation loss aggregate proof requires a local DATABASE_URL.");
}

describe.skipIf(!enabled)("scheduled automation loss PostgreSQL aggregate", () => {
  const now = new Date("2026-10-07T16:00:00Z");
  const client = new pg.Client({ connectionString: databaseUrl });
  const database = { async query<Row extends Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
    return client.query<Row>(sql, values ? [...values] : undefined);
  } };
  beforeAll(async () => {
    await client.connect();
    // Connection-local synthetic table shadows any real table, with no durable writes.
    await client.query(`CREATE TEMP TABLE hosted_runtime_log (
      subject_key text, at timestamptz, event_code text, error_code text, redacted_json jsonb
    )`);
  });
  afterAll(async () => { await client.end(); });
  beforeEach(async () => { await client.query("TRUNCATE pg_temp.hosted_runtime_log"); });

  const key = (index: number) => index.toString(16).padStart(64, "0");
  async function insert(subject: number, details: Record<string, unknown>, input: {
    at?: Date; event?: string; errorCode?: string;
  } = {}) {
    await client.query("INSERT INTO pg_temp.hosted_runtime_log VALUES ($1, $2, $3, $4, $5::jsonb)", [
      key(subject), input.at ?? now, input.event ?? "assistant.automation_detail", input.errorCode ?? null,
      JSON.stringify({ failureOccurrenceAt: "2026-10-07T13:00:00.000Z", ...details }),
    ]);
  }
  const expired = (slug = "weekly-health-digest", priorFailures: unknown = 5) =>
    ({ type: "cron.occurrence.expired", failureAutomationSlug: slug, failurePriorFailureCount: priorFailures });
  const failed = (retry: boolean, errorCode = "ASSISTANT_CODEX_FAILED", slug = "weekly-health-digest") =>
    ({ type: "cron.job.completed", failureAutomationSlug: slug, failureRunOutcome: "failed",
      failureRetryScheduled: retry, failureErrorCode: errorCode });
  async function expireRuntimes(count: number, details = expired()) {
    for (let subject = 0; subject < count; subject += 1) await insert(subject, details);
  }

  it.each([THRESHOLD - 1, THRESHOLD, THRESHOLD + 1])("evaluates the actual SQL threshold at %s runtimes", async count => {
    await expireRuntimes(count);
    expect(await readHostedAutomationLossHealth({ now, database })).toMatchObject({
      anomalous: count >= THRESHOLD, runtimeCount: count, lostRunCount: count,
    });
  });

  it("counts terminal failures and excludes retries, usage limits, gated expiry and Personal Patterns", async () => {
    await insert(2, failed(true));
    await insert(3, failed(false, "ASSISTANT_CODEX_USAGE_LIMIT"));
    await insert(4, expired("weekly-health-insight", 0));
    await insert(5, expired("weekly-health-insight", "5"));
    await insert(6, expired("personal-patterns-update"));
    await insert(7, { type: "cron.job.completed", failureAutomationSlug: "weekly-health-digest",
      failureRunOutcome: "failed", failureRetryScheduled: "false" });
    await insert(8, { ...failed(false), failureErrorCode: undefined }, { errorCode: "ASSISTANT_CODEX_USAGE_LIMIT" });
    expect(await readHostedAutomationLossHealth({ now, database })).toMatchObject({
      anomalous: false, runtimeCount: 0, lostRunCount: 0,
    });
    await insert(0, failed(false));
    await insert(1, failed(false, "ASSISTANT_CODEX_CONNECTION_LOST"));
    await insert(9, expired("journal-connected-context-morning", 1));
    const health = await readHostedAutomationLossHealth({ now, database });
    expect(health).toMatchObject({ anomalous: true, runtimeCount: 3, lostRunCount: 3 });
    // Every failed attempt explains the incident, including retried ones.
    expect(health.failedAttempts).toEqual([
      { errorCode: "ASSISTANT_CODEX_FAILED", failedAttemptCount: 2 },
      { errorCode: "ASSISTANT_CODEX_USAGE_LIMIT", failedAttemptCount: 2 },
      { errorCode: "ASSISTANT_CODEX_CONNECTION_LOST", failedAttemptCount: 1 },
      { errorCode: "other", failedAttemptCount: 1 },
    ]);
  });

  it("excludes old, future and unrelated events and includes the exact window boundary", async () => {
    await expireRuntimes(THRESHOLD - 1);
    await insert(10, expired(), { at: new Date(+now - WINDOW - 1) });
    await insert(11, expired(), { at: new Date(+now + 1) });
    await insert(12, expired(), { event: "assistant.pass_finished" });
    expect((await readHostedAutomationLossHealth({ now, database })).anomalous).toBe(false);
    await insert(13, expired(), { at: new Date(+now - WINDOW) });
    expect((await readHostedAutomationLossHealth({ now, database })).runtimeCount).toBe(THRESHOLD);
  });

  it("counts one runtime once across repeated rows and several automations", async () => {
    await insert(0, expired());
    await insert(0, expired());
    await insert(0, expired("journal-connected-context-morning"));
    await insert(1, expired());
    expect(await readHostedAutomationLossHealth({ now, database })).toEqual({
      anomalous: true, runtimeCount: 2, lostRunCount: 3, failedAttempts: [],
      automations: [
        { automation: "weekly-health-digest", lostRunCount: 2, runtimeCount: 2 },
        { automation: "journal-connected-context-morning", lostRunCount: 1, runtimeCount: 1 },
      ],
    });
  });

  it("does not return private or malformed diagnostic values", async () => {
    await insert(0, expired("call-synthetic-person-at-5"));
    await insert(1, expired("+15555550123"));
    await insert(2, failed(false, "private@example.test", "synthetic private routine"));
    const health = await readHostedAutomationLossHealth({ now, database });
    expect(health.automations).toEqual([
      { automation: "member_automation", lostRunCount: 3, runtimeCount: 3 },
    ]);
    expect(health.failedAttempts).toEqual([{ errorCode: "other", failedAttemptCount: 1 }]);
    expect(JSON.stringify(health)).not.toMatch(/synthetic|@|15555550123|0{60}/);
  });
});

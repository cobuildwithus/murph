import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  HOSTED_PROVIDER_REJECTION_REPLY_THRESHOLD as THRESHOLD,
  HOSTED_PROVIDER_REJECTION_WINDOW_MS as WINDOW,
  readHostedProviderRejectionHealth,
} from "@/src/lib/hosted-runtime-log/provider-rejection-alert-monitor";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Provider rejection aggregate proof requires a local DATABASE_URL.");
}

describe.skipIf(!enabled)("provider request rejection PostgreSQL aggregate", () => {
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
    // Failure times must read as UTC whatever the session zone is.
    await client.query("SET TIME ZONE 'Pacific/Auckland'");
  });
  afterAll(async () => { await client.end(); });
  beforeEach(async () => { await client.query("TRUNCATE pg_temp.hosted_runtime_log"); });

  const key = (index: number) => index.toString(16).padStart(64, "0");
  async function insert(subject: number, details: Record<string, unknown>, input: {
    at?: Date; event?: string; errorCode?: string | null;
  } = {}) {
    await client.query("INSERT INTO pg_temp.hosted_runtime_log VALUES ($1, $2, $3, $4, $5::jsonb)", [
      key(subject), input.at ?? now, input.event ?? "assistant.automation_detail",
      input.errorCode === undefined ? "ASSISTANT_CODEX_FAILED" : input.errorCode,
      JSON.stringify(details),
    ]);
  }
  const rejected = (overrides: Record<string, unknown> = {}) => ({
    type: "input.reply-failed", errorCode: "ASSISTANT_CODEX_FAILED", failureCodexFailureStage: "turn_failed",
    failureRetryable: false, failureProviderActionCount: 0, failureCodexErrorInfo: "unrecognized",
    safeErrorMessage: "synthetic provider text", ...overrides,
  });
  const healthy = { anomalous: false, failedReplyCount: 0, memberCount: 0,
    firstFailureAt: null, lastFailureAt: null, failures: [] };

  it.each([THRESHOLD - 1, THRESHOLD, THRESHOLD + 1])("evaluates the actual SQL threshold at %s rejected replies", async count => {
    for (let reply = 0; reply < count; reply += 1) await insert(0, rejected());
    expect(await readHostedProviderRejectionHealth({ now, database })).toMatchObject({
      anomalous: count >= THRESHOLD, failedReplyCount: count, memberCount: Math.min(count, 1),
    });
  });

  it("reports one rejected reply with its aggregate counts and UTC times", async () => {
    await insert(0, rejected(), { at: new Date("2026-10-07T15:48:20.500Z") });
    expect(await readHostedProviderRejectionHealth({ now, database })).toEqual({
      anomalous: true, failedReplyCount: 1, memberCount: 1,
      firstFailureAt: "2026-10-07T15:48:20.500Z", lastFailureAt: "2026-10-07T15:48:20.500Z",
      failures: [{ errorInfo: "unrecognized", httpStatus: "none", failedReplyCount: 1 }],
    });
  });

  it("excludes every other failure shape", async () => {
    await insert(0, rejected({ failureRetryable: true }));
    await insert(1, rejected({ failureRetryable: "false" }));
    await insert(2, rejected({ failureRetryable: undefined }));
    await insert(3, rejected({ failureCodexFailureStage: "process_exit" }));
    await insert(4, rejected({ failureProviderActionCount: 1 }));
    await insert(5, rejected({ failureProviderActionCount: "0" }));
    await insert(6, rejected({ failureProviderActionCount: undefined }));
    await insert(7, rejected({ type: "cron.job.completed" }));
    await insert(8, rejected({ type: "input.replied" }));
    await insert(9, rejected({ errorCode: "ASSISTANT_CODEX_CONNECTION_LOST" }));
    await insert(10, rejected({ errorCode: undefined }), { errorCode: "ASSISTANT_CODEX_CONNECTION_LOST" });
    await insert(11, rejected({ errorCode: undefined }), { errorCode: null });
    await insert(12, rejected(), { event: "assistant.pass_finished" });
    expect(await readHostedProviderRejectionHealth({ now, database })).toEqual(healthy);
  });

  it("reads the error code from the column or the JSON key", async () => {
    await insert(0, rejected({ errorCode: undefined }));
    await insert(1, rejected(), { errorCode: null });
    expect(await readHostedProviderRejectionHealth({ now, database })).toMatchObject({
      anomalous: true, failedReplyCount: 2, memberCount: 2,
    });
  });

  it("excludes old and future rows and includes the exact window boundary", async () => {
    await insert(0, rejected(), { at: new Date(+now - WINDOW - 1) });
    await insert(1, rejected(), { at: new Date(+now + 1) });
    expect(await readHostedProviderRejectionHealth({ now, database })).toEqual(healthy);
    await insert(2, rejected(), { at: new Date(+now - WINDOW) });
    expect(await readHostedProviderRejectionHealth({ now, database })).toMatchObject({
      anomalous: true, failedReplyCount: 1, firstFailureAt: "2026-10-07T15:30:00.000Z",
    });
  });

  it("counts many rejected replies from two members as one fleet aggregate", async () => {
    for (let reply = 0; reply < 7; reply += 1) {
      await insert(0, rejected(), { at: new Date(+now - (20 - reply) * 60_000) });
    }
    for (let reply = 0; reply < 4; reply += 1) {
      await insert(1, rejected({ failureCodexErrorInfo: "httpConnectionFailed", failureCodexErrorHttpStatusCode: 400 }),
        { at: new Date(+now - (10 - reply) * 60_000) });
    }
    expect(await readHostedProviderRejectionHealth({ now, database })).toEqual({
      anomalous: true, failedReplyCount: 11, memberCount: 2,
      firstFailureAt: "2026-10-07T15:40:00.000Z", lastFailureAt: "2026-10-07T15:53:00.000Z",
      failures: [
        { errorInfo: "unrecognized", httpStatus: "none", failedReplyCount: 7 },
        { errorInfo: "httpConnectionFailed", httpStatus: "400", failedReplyCount: 4 },
      ],
    });
  });

  it("does not return private or malformed diagnostic values", async () => {
    await insert(0, rejected({ failureCodexErrorInfo: "private@example.test" }));
    await insert(1, rejected({ failureCodexErrorInfo: undefined, failureCodexErrorHttpStatusCode: "synthetic status" }));
    await insert(2, rejected({ failureCodexErrorInfo: 7, failureCodexErrorHttpStatusCode: 400.5 }));
    await insert(3, rejected({ failureCodexErrorInfo: "modelNotFound", failureCodexErrorHttpStatusCode: 999 }));
    const health = await readHostedProviderRejectionHealth({ now, database });
    expect(health.failures).toEqual([
      { errorInfo: "modelNotFound", httpStatus: "other", failedReplyCount: 1 },
      { errorInfo: "none", httpStatus: "other", failedReplyCount: 1 },
      { errorInfo: "other", httpStatus: "none", failedReplyCount: 1 },
      { errorInfo: "other", httpStatus: "other", failedReplyCount: 1 },
    ]);
    expect(JSON.stringify(health)).not.toMatch(/synthetic|@|0{60}/);
  });
});

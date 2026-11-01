import type { Prisma } from "@prisma/client";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseAssistantRuntimeIssueRecord } from "@murphai/runtime-state/node";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ $queryRaw: mocks.query }) }));
import { getPrisma } from "@/src/lib/prisma";
import { readToolFailureHealth, TOOL_FAILURE_SAMPLE_LIMIT } from "@/src/lib/hosted-operational-alert/tool-failure-health";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Tool alert SQL proof requires a local DATABASE_URL.");
}
const now = new Date("2026-08-10T01:00:00Z");

describe.skipIf(!enabled)("tool failure indexed SQL", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  beforeAll(async () => {
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE hosted_assistant_runtime_issue (operation text, details_json jsonb,
        release_sha text, occurred_at timestamp, component text, error_code text, issue_kind text);
      CREATE INDEX ON hosted_assistant_runtime_issue (issue_kind, occurred_at);
      CREATE TEMP TABLE hosted_phone_call (member_id text, status text, provider_call_id text, updated_at timestamp);
      CREATE INDEX ON hosted_phone_call (status, updated_at);
      CREATE TEMP TABLE hosted_thread_container (member_id text PRIMARY KEY);
    `);
    mocks.query.mockImplementation(async (query: Prisma.Sql) => (await client.query(query.text, query.values)).rows);
  });
  afterAll(async () => { await client.end(); });
  beforeEach(async () => {
    mocks.query.mockClear();
    await client.query("TRUNCATE hosted_assistant_runtime_issue, hosted_phone_call, hosted_thread_container");
  });
  const read = () => readToolFailureHealth({ now, prisma: getPrisma() });
  async function seed(count: number, input: { operation?: string; reason?: string; stage?: string;
    category?: string; release?: string; at?: Date; kind?: string } = {}) {
    await client.query(`INSERT INTO hosted_assistant_runtime_issue
      SELECT $1, $2::jsonb, $3, $4, 'assistant.codex-dynamic-tool', 'ASSISTANT_DYNAMIC_TOOL_FAILED', $5
      FROM generate_series(1, $6::int)`, [input.operation ?? "automation", JSON.stringify({
      failureReason: input.reason ?? "handler_exception", failureStage: input.stage ?? "execution",
      errorCategory: input.category ?? "unavailable", content: "synthetic private text",
    }), input.release ?? "a".repeat(40), (input.at ?? now).toISOString(), input.kind ?? "tool_error", count]);
  }

  it.each([3, 4, 5])("uses per-operation threshold with %s failures", async count => {
    await seed(count);
    await seed(1, { operation: "game" });
    expect((await read()).backend.anomalous).toBe(count >= 4);
    expect(mocks.query).toHaveBeenCalledOnce();
  });

  it("excludes validation, expected not-found/conflict, old and future rows", async () => {
    await seed(20, { reason: "invalid_input", stage: "validation" });
    await seed(20, { reason: "handler_exception", stage: "validation" });
    await seed(20, { kind: "schema_rejection" });
    await seed(20, { reason: "not_found" });
    await seed(20, { reason: "conflict" });
    await seed(20, { at: new Date(+now - 3_600_000) });
    await seed(20, { at: new Date(+now + 1) });
    expect((await read()).backend).toMatchObject({ anomalous: false, count: 0 });
    await seed(4, { at: new Date(+now - 3_600_000 + 1) });
    expect((await read()).backend.anomalous).toBe(true);
  });

  it.each(["handler_exception", "unavailable", "authority_rejected", "result_serialization_failed"])("counts %s backend failures", async reason => {
    await seed(4, { reason });
    expect((await read()).backend.anomalous).toBe(true);
  });

  it.each(["unavailable", "timeout", "rate_limited", "authority_rejected"])("counts reported backend category %s", async category => {
    await seed(4, { reason: "reported_failure", category });
    expect((await read()).backend).toMatchObject({ anomalous: true, count: 4 });
  });

  it.each(["invalid_input", "not_found", "conflict", "unknown", "invalid_result", "private-category"])("excludes purely reported category %s", async category => {
    await seed(20, { reason: "reported_failure", category });
    await seed(20, { reason: "reported_failure", category: "unavailable", stage: "validation" });
    expect((await read()).backend).toMatchObject({ anomalous: false, count: 0 });
  });

  it.each([403, 500])("alerts on a pre-row phone HTTP %s after eight earlier tool failures", async status => {
    // Run the engine at its own package boundary; Next's environment typing
    // must not become part of the hosted runtime producer's compilation.
    const { stdout } = await promisify(execFile)("pnpm", ["exec", "tsx", "--tsconfig", "tsconfig.base.json",
      "packages/assistant-engine/test/support/phone-failure-producer.ts", String(status)]);
    const records = (JSON.parse(stdout) as unknown[]).map(parseAssistantRuntimeIssueRecord);
    expect(records.some(record => record.operation === "create-phone-call")).toBe(true);
    for (const record of records) {
      await client.query(`INSERT INTO hosted_assistant_runtime_issue VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7)`, [
        record.operation, JSON.stringify(record.details), record.releaseSha, record.occurredAt,
        record.component, record.errorCode, record.issueKind,
      ]);
    }
    // No phone row exists: the real persisted producer issue is the only signal.
    const health = await readToolFailureHealth({ now: new Date(), prisma: getPrisma() });
    expect(health.phone).toMatchObject({ anomalous: true, count: 1 });
    expect(health.phone.groups[0]).toMatchObject({ source: "dynamic_tool", reason: "handler_exception",
      category: status === 403 ? "authority_rejected" : "unavailable" });
  });

  it("one phone failure alerts, while schema rejection does not", async () => {
    await seed(1, { operation: "create-phone-call", kind: "schema_rejection" });
    expect((await read()).phone.anomalous).toBe(false);
    await seed(1, { operation: "create-phone-call" });
    expect((await read()).phone).toMatchObject({ anomalous: true, count: 1 });
  });

  it("includes only direct failed starts without a provider id, using the status transition time", async () => {
    await client.query("INSERT INTO hosted_thread_container VALUES ('synthetic-group')");
    await client.query(`INSERT INTO hosted_phone_call VALUES
      ('synthetic-group', 'failed', NULL, $1), ('synthetic-direct', 'failed', 'provider-call', $1),
      ('synthetic-direct', 'starting', NULL, $1), ('synthetic-direct', 'failed', NULL, $2)`,
    [now.toISOString(), new Date(+now - 3_600_000).toISOString()]);
    expect((await read()).phone.anomalous).toBe(false);
    await client.query("INSERT INTO hosted_phone_call VALUES ('synthetic-direct', 'failed', NULL, $1)", [now.toISOString()]);
    expect((await read()).phone.groups).toEqual([{
      source: "phone_start", operation: "create-phone-call", count: 1, reason: "start_failed", category: "unknown",
      releaseSha: null, firstAt: now.toISOString(), lastAt: now.toISOString(),
    }]);
  });

  it("keeps phone evidence when backend samples saturate, with one bounded database call", async () => {
    await seed(TOOL_FAILURE_SAMPLE_LIMIT + 100);
    await seed(1, { operation: "create-phone-call" });
    const health = await read();
    expect(health.backend).toMatchObject({ count: TOOL_FAILURE_SAMPLE_LIMIT, sampleCapped: true, anomalous: true });
    expect(health.phone).toMatchObject({ count: 1, anomalous: true });
    expect(mocks.query).toHaveBeenCalledOnce();
  });

  it("redacts arbitrary labels, release values and private payloads in SQL", async () => {
    await seed(4, { operation: "synthetic-private-operation", category: "synthetic-private-category", release: "private-release" });
    const health = await read();
    expect(health.backend.groups).toMatchObject([{ operation: "other_tool", category: "unknown", releaseSha: null }]);
    expect(JSON.stringify(health)).not.toMatch(/synthetic-private|private-release|content|member_id/);
  });
});

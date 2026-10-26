import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createAccount, createConnectionSource, createJob, createJobFromInput,
  createJunctionJobContext, createJunctionProvider, executeJunctionJob,
} from "./junction-provider.harness.ts";
import { createJsonResponse, readUrl, requireValue } from "./helpers.ts";
import type { DeviceSyncJobInput } from "../src/types.ts";

const START = "2026-04-01T00:00:00.000Z";
const END = "2026-04-02T00:00:00.000Z";

function fixture(resource: string, overflowHours = false, overflowDay = "2026-04-01") {
  const requests: string[] = [];
  const imported: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [{
        id: "provider-garmin-1", name: "Garmin", slug: "garmin", status: "connected",
        resource_availability: { [resource]: true },
      }] });
    }
    assert.equal(url.pathname, `/v2/timeseries/junction-user-1/${resource}/grouped`);
    const start = requireValue(url.searchParams.get("start_date"), "query start");
    requests.push(start);
    const timestamp = start.length === 10 ? `${start}T00:00:00.000Z` : start;
    return createJsonResponse({ groups: { garmin: [{
      data: Array.from({ length: start === overflowDay || overflowHours ? 25_001 : 1 }, () => ({
        timestamp, unit: resource === "heartrate" ? "bpm" : "count", value: 72,
      })),
      source: { provider: "garmin", type: "watch" },
    }] } });
  }, { summaryResources: [], timeseriesResources: [resource] });
  const context = createJunctionJobContext({
    account: createAccount({ sources: [{ ...createConnectionSource({
      firstSeenAt: "2025-01-01T00:00:00.000Z", resourceAvailabilitySummary: { [resource]: true },
    }), resourceCount: 1 }] }),
    now: "2026-04-04T12:00:00.000Z",
    connectionSourceAdmissionMode: "listed_only",
    importSnapshot: async (snapshot) => {
      const rows = (snapshot as { timeseries: Record<string, { timestamp: string }[]> }).timeseries[resource];
      imported.push(...rows.map((row) => row.timestamp));
      return { canonicalEventCount: rows.length, durableDeliveryAccepted: true };
    },
  });
  const job = createJob("resource", {
    eventType: `historical.data.${resource}.created`, resource, resourceCategory: "timeseries",
    sourceProviderSlug: "garmin", windowStart: START, windowEnd: END,
  });
  return { provider, context, job, requests, imported };
}

test("resource record overflow resumes complete hours through the existing bounded owner", async () => {
  const f = fixture("heartrate");
  let result = await executeJunctionJob(f.provider, f.context, f.job);
  assert.deepEqual(f.imported, [], "an overflowing day must not partially import");
  assert.deepEqual(f.requests, ["2026-04-01"]);
  let continuation = requireValue(result.scheduledJobs?.[0], "hourly continuation");
  assert.equal(continuation.kind, "resource");
  assert.equal(continuation.payload?.timeseriesWindowHours, 1);
  assert.equal(continuation.payload?.windowStart, START);
  assert.equal(continuation.payload?.windowEnd, END);
  assert.equal(continuation.payload?.sourceProviderSlug, "garmin");
  for (let pass = 0; pass < 24; pass += 1) {
    const before = f.requests.length;
    const restored = JSON.parse(JSON.stringify(continuation)) as DeviceSyncJobInput;
    result = await executeJunctionJob(f.provider, f.context, createJobFromInput(restored));
    assert.ok(f.requests.length - before <= 1, "each durable suffix owns at most one complete hour");
    if (!result.scheduledJobs?.length) break;
    continuation = requireValue(result.scheduledJobs[0], "bounded suffix");
    assert.equal(continuation.payload?.timeseriesWindowHours, 1);
  }
  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  const hours = Array.from({ length: 24 }, (_, i) => new Date(Date.parse(START) + i * 3_600_000).toISOString());
  assert.deepEqual(f.requests.slice(1).map((value) => new Date(value).toISOString()), hours);
  assert.deepEqual(f.imported.map((value) => new Date(value).toISOString()), hours);
});

test("resource hourly overflow stays terminal to that attempt without partial imports", async () => {
  const f = fixture("heartrate", true);
  f.job.payload.timeseriesWindowHours = 1;
  await assert.rejects(executeJunctionJob(f.provider, f.context, f.job), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { code?: string }).code ?? (error.cause as { code?: string })?.code, "JUNCTION_API_RECORD_LIMIT");
    return true;
  });
  assert.equal(f.requests.length, 1);
  assert.notEqual(f.requests[0]?.length, 10, "retry must not widen back to the day");
  assert.deepEqual(f.imported, []);
});

test("daily aggregate resource overflow cannot opt into hourly partial authority", async () => {
  const f = fixture("steps");
  f.job.payload.timeseriesWindowHours = 1;
  await assert.rejects(executeJunctionJob(f.provider, f.context, f.job));
  assert.deepEqual(f.requests, ["2026-04-01"]);
  assert.deepEqual(f.imported, []);
});

test("resource overflow preserves committed days before switching to hourly suffixes", async () => {
  const f = fixture("heartrate", false, "2026-04-02");
  f.job.payload.windowEnd = "2026-04-03T00:00:00.000Z";
  const result = await executeJunctionJob(f.provider, f.context, f.job);
  assert.deepEqual(f.imported, [START]);
  const next = requireValue(result.scheduledJobs?.[0], "failed day continuation");
  assert.equal(next.payload?.windowStart, END);
  assert.equal(next.payload?.timeseriesWindowHours, 1);
  assert.equal(result.continuationProgress, true);
  await executeJunctionJob(f.provider, f.context, createJobFromInput(next));
  assert.equal(f.requests.filter((start) => start === "2026-04-01").length, 1);
  assert.deepEqual(f.imported, [START, END]);
});

test("hourly resource continuation yields without reading or acknowledging the hour", async () => {
  const f = fixture("heartrate");
  f.job.payload.timeseriesWindowHours = 1;
  f.context.shouldYield = () => true;
  const result = await executeJunctionJob(f.provider, f.context, f.job);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.imported, []);
  assert.equal(result.scheduledJobs?.[0]?.payload?.windowStart, START);
  assert.equal(result.scheduledJobs?.[0]?.payload?.timeseriesWindowHours, 1);
  assert.equal(result.continuationProgress, undefined);
});

test("hourly resource imports keep the post-fetch source admission check", async () => {
  const f = fixture("heartrate");
  f.job.payload.timeseriesWindowHours = 1;
  f.context.listConnectionSources = async () => f.requests.length === 0
    ? f.context.account.sources ?? []
    : [];
  await executeJunctionJob(f.provider, f.context, f.job);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.imported, []);
});

test("hourly resource continuation rejects a partial-hour coordinate before collection", async () => {
  const f = fixture("heartrate");
  f.job.payload.timeseriesWindowHours = 1;
  f.job.payload.windowStart = "2026-04-01T00:30:00.000Z";
  await assert.rejects(executeJunctionJob(f.provider, f.context, f.job), {
    code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID", retryable: false,
  });
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.imported, []);
});

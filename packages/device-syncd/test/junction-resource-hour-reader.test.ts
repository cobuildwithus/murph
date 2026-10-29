import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { test } from "vitest";
import {
  createAccount, createConnectionSource, createJob, createJobFromInput,
  createJunctionJobContext, createJunctionProvider, executeJunctionJob,
} from "./junction-provider.harness.ts";
import { createJsonResponse, makeTempDirectory, readUrl, requireValue } from "./helpers.ts";
import type { DeviceSyncJobInput } from "../src/types.ts";
import { createDeviceSyncService, SqliteDeviceSyncStore } from "../src/service.ts";
import { normalizeConfiguredDeviceSyncJobInput } from "../src/provider-job-definitions.ts";
import { shapeHostedDeviceSyncJobHintPayload } from "../src/hosted-hints.ts";
import { parseHostedExecutionDeviceSyncWakeHint } from "../src/hosted-runtime.ts";

const START = "2026-04-01T00:00:00.000Z";
const END = "2026-04-02T00:00:00.000Z";

function fixture(resource: string, overflowHours = false, overflowDay = "2026-04-01") {
  const requests: string[] = [];
  const requestEnds: string[] = [];
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
    requestEnds.push(requireValue(url.searchParams.get("end_date"), "query end"));
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
  return { provider, context, job, requests, requestEnds, imported };
}

test("reader preserves a supplied hourly suffix through every complete hour", async () => {
  const f = fixture("heartrate");
  let pending: DeviceSyncJobInput = { kind: "resource", payload: { ...f.job.payload, timeseriesWindowHours: 1 } };
  for (let hour = 0; hour < 24; hour += 1) {
    const restored = JSON.parse(JSON.stringify(pending)) as DeviceSyncJobInput;
    const before = f.requests.length;
    const result = await executeJunctionJob(f.provider, f.context, createJobFromInput(restored));
    assert.equal(f.requests.length - before, 1);
    if (hour === 23) {
      assert.equal(result.scheduledJobs?.length ?? 0, 0);
    } else {
      pending = requireValue(result.scheduledJobs?.[0], "retained hourly suffix");
      assert.equal(pending.payload?.timeseriesWindowHours, 1);
      assert.equal(pending.payload?.sourceProviderSlug, "garmin");
    }
  }
  const hours = Array.from({ length: 24 }, (_, i) => new Date(Date.parse(START) + i * 3_600_000).toISOString());
  assert.deepEqual(f.requests.map((v) => new Date(v).toISOString()), hours);
  assert.deepEqual(f.requestEnds.map((v) => new Date(v).toISOString()),
    hours.map((v) => new Date(Date.parse(v) + 3_600_000).toISOString()));
  assert.deepEqual(f.imported.map((v) => new Date(v).toISOString()), hours);
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


test("resource hourly reader rejects unsupported window markers before collection", async () => {
  for (const marker of [0, 2, 24]) {
    const f = fixture("heartrate");
    f.job.payload.timeseriesWindowHours = marker;
    await assert.rejects(executeJunctionJob(f.provider, f.context, f.job), {
      code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID", retryable: false,
    });
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.imported, []);
  }
});

test("reader accepts a supplied hourly job through service enqueue, cold restore and hosted hints", async () => {
  const f = fixture("heartrate");
  const vaultRoot = await makeTempDirectory("murph-resource-hourly-recovery");
  const stateDatabasePath = path.join(vaultRoot, "device-sync.sqlite");
  let now = "2026-04-04T12:00:00.000Z";
  const open = () => {
    const store = new SqliteDeviceSyncStore(stateDatabasePath);
    const service = createDeviceSyncService({
      secret: "synthetic-device-sync-secret",
      config: { vaultRoot, stateDatabasePath, publicBaseUrl: "https://sync.example.test",
        log: { warn() {}, error() {} } },
      store, providers: [f.provider], clock: { now: () => new Date(now) },
      importer: { async importDeviceProviderSnapshot(input) {
        await f.context.importSnapshot(input.snapshot);
        return { applied: true, events: [] };
      } },
    });
    return { store, service, close() { service.close(); store.close(); } };
  };
  let runtime = open();
  try {
    const account = runtime.store.upsertAccount({
      provider: "junction", externalAccountId: "junction-user-1", scopes: [],
      credential: { kind: "provider_config", providerConfigKey: "junction", credentialMetadata: {} },
      connectedAt: now, nextReconcileAt: null,
    });
    runtime.store.upsertConnectionSource({
      connectionId: account.id, sourceInstanceKey: "synthetic-garmin-source",
      sourceProviderSlug: "garmin", status: "connected",
      firstSeenAt: "2025-01-01T00:00:00.000Z", lastSeenAt: now,
      resourceAvailabilitySummary: { heartrate: true },
    });
    const parent = runtime.store.enqueueJob({
      accountId: account.id, provider: "junction", kind: "resource",
      availableAt: now, priority: 30, dedupeKey: "synthetic-hourly-history",
      payload: { ...f.job.payload, timeseriesWindowHours: 1 },
    });
    await runtime.service.runWorkerOnce(account.id);
    const completed = requireValue(runtime.store.getJobById(parent.id), "completed parent");
    assert.equal(completed.status, "succeeded", completed.lastErrorCode ?? "parent must complete");
    assert.deepEqual(f.imported.map((v) => new Date(v).toISOString()), [START]);
    const [suffix] = runtime.store.listPendingJobsForAccount(account.id, 2);
    assert.ok(suffix);
    assert.equal(suffix.payload.timeseriesWindowHours, 1);
    const hint = parseHostedExecutionDeviceSyncWakeHint(JSON.parse(JSON.stringify({ jobs: [{
      kind: suffix.kind, payload: shapeHostedDeviceSyncJobHintPayload("junction", suffix),
    }] })));
    const hintJob = requireValue(hint?.jobs?.[0], "restored hourly hint");
    const restored = normalizeConfiguredDeviceSyncJobInput("junction",
      { kind: hintJob.kind, payload: hintJob.payload }, "synthetic hosted restore");
    assert.deepEqual(restored.payload, suffix.payload);
    assert.equal(restored.payload?.timeseriesWindowHours, 1);
    assert.equal(restored.payload?.windowStart, "2026-04-01T01:00:00.000Z");
    assert.equal(restored.payload?.windowEnd, END);
    runtime.close();
    now = suffix.availableAt;
    runtime = open();
    await runtime.service.runWorkerOnce(account.id);
    const executed = requireValue(runtime.store.getJobById(suffix.id), "executed hourly suffix");
    assert.equal(executed.status, "succeeded", JSON.stringify({
      code: executed.lastErrorCode, attempts: executed.attempts, availableAt: executed.availableAt, now,
    }));
    assert.deepEqual(f.requests.map((value) => new Date(value).toISOString()), [START, "2026-04-01T01:00:00.000Z"]);
    assert.deepEqual(f.imported.map((value) => new Date(value).toISOString()), [START, "2026-04-01T01:00:00.000Z"]);
    const [next] = runtime.store.listPendingJobsForAccount(account.id, 2);
    assert.equal(next?.payload.windowStart, "2026-04-01T02:00:00.000Z");
    assert.equal(next?.payload.timeseriesWindowHours, 1);
  } finally {
    runtime.close();
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

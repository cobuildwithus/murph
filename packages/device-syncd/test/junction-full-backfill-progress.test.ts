import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { test, vi } from "vitest";
import {
  createJob,
  createJobFromInput,
  createJunctionJobContext,
  createJunctionProvider,
  executeJunctionJob,
} from "./junction-provider.harness.ts";
import { createJsonResponse, makeTempDirectory, readUrl } from "./helpers.ts";
import { createDeviceSyncService, SqliteDeviceSyncStore } from "../src/service.ts";
import { initializeVault, readJsonlRecords } from "@murphai/core";
import { importDeviceProviderSnapshot } from "@murphai/importers";

test.each(["backfill", "reconcile"])("Junction cheap %s drains complete days without one durable job per day", async (kind) => {
  const windows: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    assert.match(url.pathname, /\/timeseries\/junction-user-1\/hrv\/grouped$/u);
    windows.push(url.searchParams.get("start_date")!);
    return createJsonResponse({ groups: {} });
  }, { summaryResources: [], timeseriesResources: ["hrv"] });
  const context = createJunctionJobContext();
  let job = createJob(kind, {
    windowStart: "2026-03-20T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
    timeseriesCursor: "2026-03-20T00:00:00.000Z",
    timeseriesResourceCursor: "hrv",
  });
  let jobs = 0;
  for (; jobs < 20;) {
    const result = await executeJunctionJob(provider, context, job);
    jobs += 1;
    const next = result.scheduledJobs?.[0];
    if (!next) break;
    job = createJobFromInput(next, jobs);
  }
  assert.equal(windows.length, 14);
  assert.equal(new Set(windows).size, 14, "completed days must not replay");
  assert.equal(jobs, 1, "cheap complete days should share a bounded provider job");
});

test("Junction full history caps cheap work and resumes the same scalar suffix after restart", async () => {
  const windows: string[] = [];
  const openProvider = () => createJunctionProvider(async (input) => {
    windows.push(new URL(readUrl(input)).searchParams.get("start_date")!);
    return createJsonResponse({ groups: {} });
  }, { summaryResources: [], timeseriesResources: ["hrv"] });
  const context = createJunctionJobContext();
  const first = await executeJunctionJob(openProvider(), context, createJob("reconcile", {
    windowStart: "2026-03-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
    timeseriesCursor: "2026-03-02T00:00:00.000Z",
    timeseriesResourceCursor: "hrv",
  }));
  assert.equal(windows.length, 16);
  const suffix = first.scheduledJobs?.[0];
  assert.ok(suffix);
  assert.equal(suffix.payload?.timeseriesCursor, "2026-03-18T00:00:00.000Z");
  const second = await executeJunctionJob(
    openProvider(), context, createJobFromInput(JSON.parse(JSON.stringify(suffix))),
  );
  assert.equal(second.scheduledJobs, undefined);
  assert.equal(windows.length, 32);
  assert.equal(new Set(windows).size, 32);
});

test.each(["foreground", "elapsed"])("Junction full history stops between complete days for %s", async (stop) => {
  let requests = 0;
  let elapsed = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => elapsed);
  try {
    const provider = createJunctionProvider(async () => {
      requests += 1;
      elapsed += 2_500;
      return createJsonResponse({ groups: {} });
    }, { summaryResources: [], timeseriesResources: ["hrv"] });
    const result = await executeJunctionJob(provider, createJunctionJobContext({
      shouldYield: () => stop === "foreground" && requests >= 1,
    }), createJob("reconcile", {
      windowStart: "2026-03-20T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
      timeseriesCursor: "2026-03-20T00:00:00.000Z",
      timeseriesResourceCursor: "hrv",
    }));
    assert.equal(requests, stop === "foreground" ? 1 : 2);
    assert.equal(result.scheduledJobs?.[0]?.payload?.timeseriesCursor,
      stop === "foreground" ? "2026-03-21T00:00:00.000Z" : "2026-03-22T00:00:00.000Z");
  } finally {
    clock.mockRestore();
  }
});

test("Junction full history preserves a future empty-history retry", async () => {
  const provider = createJunctionProvider(async () => createJsonResponse({ groups: {} }),
    { summaryResources: [], timeseriesResources: ["hrv"] });
  const result = await executeJunctionJob(provider, createJunctionJobContext(), createJob("backfill", {
    windowStart: "2026-03-20T00:00:00.000Z",
    windowEnd: "2026-03-22T00:00:00.000Z",
    timeseriesCursor: "2026-03-20T00:00:00.000Z",
    timeseriesResourceCursor: "hrv",
    emptyBackfillAttempts: 1,
  }));
  assert.equal(result.scheduledJobs?.length, 1);
  assert.equal(result.scheduledJobs[0]?.availableAt, "2026-04-03T00:15:00.000Z");
  assert.equal(result.scheduledJobs[0]?.payload?.timeseriesCursor, undefined);
});

test("Junction batched history survives durable restart and provider retry before marking sync complete", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-batched-history");
  const stateDatabasePath = path.join(vaultRoot, "device-sync.sqlite");
  const requestedDays: string[] = [];
  let now = new Date("2026-04-03T12:00:00.000Z");
  let failRequest = false;
  const open = () => {
    const store = new SqliteDeviceSyncStore(stateDatabasePath);
    const service = createDeviceSyncService({
      secret: "synthetic-device-sync-secret",
      config: { vaultRoot, stateDatabasePath, publicBaseUrl: "https://sync.example.test" },
      store,
      clock: { now: () => now },
      providers: [createJunctionProvider(async (input) => {
        const url = new URL(readUrl(input));
        assert.match(url.pathname, /\/timeseries\/junction-user-1\/hrv\/grouped$/u);
        if (failRequest) return createJsonResponse({ detail: "Temporarily unavailable" }, 503);
        requestedDays.push(url.searchParams.get("start_date")!);
        return createJsonResponse({ groups: {} });
      }, { summaryResources: [], timeseriesResources: ["hrv"], timeseriesBackfillDays: 32 })],
    });
    return { store, service, close: () => { service.close(); store.close(); } };
  };
  let fixture = open();
  try {
    const account = fixture.store.upsertAccount({
      provider: "junction", externalAccountId: "junction-user-1",
      displayName: "Junction", scopes: [], status: "active",
      credential: { kind: "provider_config", providerConfigKey: "junction", credentialMetadata: {} },
      connectedAt: "2026-04-03T00:00:00.000Z", nextReconcileAt: null,
    });
    const parent = fixture.store.enqueueJob({
      accountId: account.id, provider: "junction", kind: "backfill",
      availableAt: now.toISOString(), priority: 30, dedupeKey: "synthetic-history",
      payload: {
        windowStart: "2026-03-02T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
        timeseriesCursor: "2026-03-02T00:00:00.000Z",
        timeseriesResourceCursor: "hrv",
      },
    });
    await fixture.service.runWorkerOnce(account.id);
    assert.equal(fixture.store.getJobById(parent.id)?.status, "succeeded");
    assert.equal(requestedDays.length, 16);
    assert.equal(fixture.store.getAccountById(account.id)?.lastSyncCompletedAt, null);
    const [suffix] = fixture.store.listPendingJobsForAccount(account.id, 2);
    assert.ok(suffix);
    assert.equal(suffix.payload.timeseriesCursor, "2026-03-18T00:00:00.000Z");

    fixture.close();
    fixture = open();
    failRequest = true;
    await fixture.service.runWorkerOnce(account.id);
    const retry = fixture.store.getJobById(suffix.id);
    assert.ok(retry);
    assert.equal(retry.status, "queued");
    assert.equal(retry.attempts, 1);
    assert.deepEqual(retry.payload, suffix.payload);
    assert.ok(Date.parse(retry.availableAt) > now.getTime());
    assert.equal(fixture.store.getAccountById(account.id)?.lastSyncCompletedAt, null);
    assert.equal(await fixture.service.runWorkerOnce(account.id), null);

    failRequest = false;
    now = new Date(retry.availableAt);
    assert.equal(await fixture.service.drainWorker(100, account.id), 1);
    assert.equal(requestedDays.length, 32);
    assert.equal(new Set(requestedDays).size, 32);
    assert.equal(fixture.store.listPendingJobsForAccount(account.id, 1).length, 0);
    assert.equal(fixture.store.getAccountById(account.id)?.lastSyncCompletedAt, now.toISOString());
    assert.equal(await fixture.service.runWorkerOnce(account.id), null);
  } finally {
    fixture.close();
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction retry after a failed batch suffix preserves canonical data without duplicate writes", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-batch-canonical-replay");
  const coreRuntime = await import("@murphai/core");
  await initializeVault({ vaultRoot });
  let failDay: string | null = "2026-03-31";
  const provider = createJunctionProvider(async (input) => {
    const day = new URL(readUrl(input)).searchParams.get("start_date");
    if (day === failDay) return createJsonResponse({ detail: "Temporarily unavailable" }, 503);
    return createJsonResponse({ groups: { garmin: [{
      source: { provider: "garmin", type: "watch" },
      data: [{ timestamp: `${day}T12:00:00.000Z`, unit: "ms", value: 42 }],
    }] } });
  }, { summaryResources: [], timeseriesResources: ["hrv"] });
  const context = createJunctionJobContext({
    importSnapshot: (snapshot) => importDeviceProviderSnapshot({
      vaultRoot, provider: "junction", snapshot,
    }, { corePort: coreRuntime }),
  });
  const job = createJob("reconcile", {
    windowStart: "2026-03-30T00:00:00.000Z",
    windowEnd: "2026-04-02T00:00:00.000Z",
    timeseriesCursor: "2026-03-30T00:00:00.000Z",
    timeseriesResourceCursor: "hrv",
  });
  try {
    await assert.rejects(executeJunctionJob(provider, context, job), {
      code: "JUNCTION_API_REQUEST_FAILED",
      retryable: true,
    });
    const readMarch = () => readJsonlRecords({
      vaultRoot, relativePath: "ledger/events/2026/2026-03.jsonl",
    });
    const prefix = await readMarch();
    assert.ok(prefix.length > 0, "the complete first day must reach canonical storage");
    failDay = null;
    const result = await executeJunctionJob(provider, context, job);
    assert.equal(result.scheduledJobs, undefined);
    const march = await readMarch();
    const april = await readJsonlRecords({
      vaultRoot, relativePath: "ledger/events/2026/2026-04.jsonl",
    });
    assert.deepEqual(march.slice(0, prefix.length), prefix);
    assert.equal(march.length, prefix.length * 2, "replaying the first day must be an exact no-op");
    assert.equal(april.length, prefix.length);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

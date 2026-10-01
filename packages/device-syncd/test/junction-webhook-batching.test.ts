import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { test } from "vitest";
import { deviceSyncError } from "../src/errors.ts";
import { createDeviceSyncService, SqliteDeviceSyncStore } from "../src/service.ts";
import { createJunctionProvider, createJunctionSvixWebhook, requireJunctionWebhookHandler } from "./junction-provider.harness.ts";
import { createJsonResponse, makeTempDirectory, readUrl } from "./helpers.ts";

const NOW = "2026-04-05T12:00:00.000Z";

async function createBurstFixture(batching = true) {
  const vaultRoot = await makeTempDirectory("murph-junction-burst");
  const store = new SqliteDeviceSyncStore(path.join(vaultRoot, "device-sync.sqlite"));
  const counts = { fetches: 0, sources: 0, imports: 0, noops: 0 };
  const seen = new Set<string>();
  const controls = { now: NOW, yield: false, disconnected: false, onFetch: () => {}, onImport: () => {} };
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [{
        slug: "garmin", status: "connected", resource_availability: { steps: true },
      }] });
    }
    assert.equal(url.pathname, "/v2/timeseries/junction-user-1/steps/grouped");
    counts.fetches += 1;
    controls.onFetch();
    return createJsonResponse({ groups: { garmin: [{ data: [{
      timestamp: `${url.searchParams.get("start_date")}T12:00:00.000Z`,
      value: 100, unit: "count",
    }], source: { provider: "garmin", type: "watch" } }] } });
  }, { summaryResources: [], timeseriesResources: ["steps"],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==" });
  assert.ok(provider.jobExecutor);
  if (!batching) {
    provider.jobExecutor.batch = undefined;
    const createPassExecutor = provider.jobExecutor.createPassExecutor;
    assert.ok(createPassExecutor);
    provider.jobExecutor.createPassExecutor = () => {
      const pass = createPassExecutor();
      pass.batch = undefined;
      return pass;
    };
  }
  const account = store.upsertAccount({
    provider: "junction", externalAccountId: "junction-user-1", scopes: [],
    credential: { kind: "provider_config", providerConfigKey: "junction", credentialMetadata: {} },
    connectedAt: NOW, nextReconcileAt: null,
  });
  const source = store.upsertConnectionSource({
    connectionId: account.id, sourceInstanceKey: "synthetic-garmin-source",
    sourceProviderSlug: "garmin", status: "connected", firstSeenAt: NOW, lastSeenAt: NOW,
    resourceAvailabilitySummary: { steps: true },
  });
  const service = createDeviceSyncService({
    secret: "synthetic-device-secret",
    config: { vaultRoot, publicBaseUrl: "https://sync.example.test", log: { warn() {}, error() {} },
      shouldYieldJobExecution: () => controls.yield },
    clock: { now: () => new Date(controls.now) }, store, providers: [provider],
    listConnectionSourcesForJob: async () => {
      counts.sources += 1;
      return [{ ...source, status: controls.disconnected ? "disconnected" : "connected" }];
    },
    importer: { async importDeviceProviderSnapshot(input) {
      counts.imports += 1;
      assert.ok(input.snapshot && typeof input.snapshot === "object" && "timeseries" in input.snapshot);
      const key = JSON.stringify(input.snapshot.timeseries);
      const applied = !seen.has(key);
      if (!applied) counts.noops += 1;
      seen.add(key);
      controls.onImport();
      return { applied, events: [] };
    } },
  });
  function enqueue(index: number, endDay = "03") {
    return store.enqueueJob({
      accountId: account.id, provider: "junction", kind: "resource", priority: 65,
      availableAt: NOW, dedupeKey: `synthetic-burst-${index}`,
      payload: {
        eventType: "daily.data.steps.updated", resource: "steps", resourceCategory: "timeseries",
        sourceProviderSlug: "garmin", occurredAt: NOW, objectId: "",
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: `2026-04-${endDay}T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
      },
    });
  }
  return { account, controls, counts, enqueue, provider, service, store,
    async close() { service.close(); store.close(); await rm(vaultRoot, { recursive: true, force: true }); },
  };
}

test("queued dense webhook burst scans shared days once", async () => {
  const f = await createBurstFixture();
  try {
    const jobs = Array.from({ length: 8 }, (_, index) => f.enqueue(index));
    assert.equal(await f.service.drainWorker(8, f.account.id), 8);
    assert.equal(f.counts.fetches, 2);
    assert.equal(f.counts.imports, 2);
    assert.equal(f.counts.noops, 0);
    assert.equal(f.counts.sources, 3, "one projection read and one fresh authority read per fetched day");
    assert.ok(jobs.every((job) => f.store.getJobById(job.id)?.status === "succeeded"));
  } finally { await f.close(); }
});

test("an update arriving after a batch is claimed gets a fresh provider scan", async () => {
  const f = await createBurstFixture();
  try {
    f.enqueue(0); f.enqueue(1);
    let added = false;
    f.controls.onFetch = () => { if (!added) { added = true; f.enqueue(2); } };
    assert.equal(await f.service.drainWorker(3, f.account.id), 3);
    assert.equal(f.counts.fetches, 4, "two days for the batch and two for the later update");
    assert.equal(f.counts.imports, 4);
  } finally { await f.close(); }
});

test("batched dense imports retain live revocation checks after provider reads", async () => {
  const f = await createBurstFixture();
  try {
    f.enqueue(0); f.enqueue(1);
    f.controls.onFetch = () => { f.controls.disconnected = true; };
    assert.equal(await f.service.drainWorker(2, f.account.id), 2);
    assert.equal(f.counts.imports, 0);
    assert.equal(f.counts.sources, 3);
  } finally { await f.close(); }
});

test("dense webhook batching respects the caller's durable row budget", async () => {
  const f = await createBurstFixture();
  try {
    const jobs = Array.from({ length: 8 }, (_, index) => f.enqueue(index));
    assert.equal(await f.service.drainWorker(3, f.account.id), 3);
    assert.equal(jobs.filter((job) => f.store.getJobById(job.id)?.status === "succeeded").length, 3);
    assert.equal(jobs.filter((job) => f.store.getJobById(job.id)?.status === "queued").length, 5);
    assert.equal(f.counts.fetches, 2);
  } finally { await f.close(); }
});

test("different closed-day ranges keep their own scans", async () => {
  const f = await createBurstFixture();
  try {
    f.enqueue(0); f.enqueue(1, "04");
    assert.equal(await f.service.drainWorker(2, f.account.id), 2);
    assert.equal(f.counts.fetches, 5);
    assert.equal(f.counts.imports - f.counts.noops, 3, "the additional day is imported");
  } finally { await f.close(); }
});

test("dense webhook batches are bounded even when the drain budget is larger", async () => {
  const f = await createBurstFixture();
  try {
    Array.from({ length: 17 }, (_, index) => f.enqueue(index));
    assert.equal(await f.service.drainWorker(17, f.account.id), 17);
    assert.equal(f.counts.fetches, 4, "sixteen notifications share a scan; the seventeenth scans again");
  } finally { await f.close(); }
});

test("partial batch failure retains every job and eventually imports all days", async () => {
  const f = await createBurstFixture();
  try {
    const jobs = [f.enqueue(0), f.enqueue(1)];
    f.controls.onFetch = () => {
      if (f.counts.fetches >= 2) throw deviceSyncError({
        code: "SYNTHETIC_RETRY", message: "Temporary fetch failure", httpStatus: 503, retryable: true,
      });
    };
    assert.equal(await f.service.drainWorker(2, f.account.id), 2);
    assert.equal(f.counts.imports, 1);
    assert.ok(jobs.every((job) => f.store.getJobById(job.id)?.status === "queued"));
    f.controls.onFetch = () => {};
    f.controls.now = "2026-04-05T13:00:00.000Z";
    assert.equal(await f.service.drainWorker(2, f.account.id), 2);
    assert.ok(jobs.every((job) => f.store.getJobById(job.id)?.status === "succeeded"));
    assert.equal(f.counts.imports - f.counts.noops, 2);
  } finally { await f.close(); }
});

test("yielded batches durably retain and resume the unfinished daily range", async () => {
  const f = await createBurstFixture();
  try {
    f.enqueue(0); f.enqueue(1);
    f.controls.onImport = () => { f.controls.yield = true; };
    assert.equal(await f.service.drainWorker(2, f.account.id), 2);
    assert.equal(f.counts.imports, 1);
    const pending = f.store.listPendingJobsForAccount(f.account.id, 10);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.payload.windowStart, "2026-04-02T00:00:00.000Z");
    f.controls.yield = false;
    f.controls.now = pending[0]!.availableAt;
    f.controls.onImport = () => {};
    await f.service.drainWorker(8, f.account.id);
    assert.equal(f.counts.imports - f.counts.noops, 2);
    assert.equal(f.counts.fetches, 2, "resume imports only the unfinished day");
  } finally { await f.close(); }
});

test("batch admission separates sources and excludes payload-specific work", async () => {
  const f = await createBurstFixture();
  try {
    const job = f.enqueue(0);
    const batch = f.provider.jobExecutor?.batch;
    assert.ok(batch);
    const key = batch.describe(job)?.key;
    assert.ok(key);
    assert.notEqual(batch.describe({ ...job, payload: { ...job.payload, sourceProviderSlug: "fitbit" } })?.key, key);
    for (const patch of [
      { webhookDataJson: "{}" }, { historicalBackfillVersion: 1 },
      { eventType: "historical.data.steps.created" }, { resource: "stress" },
      { windowStart: "invalid" }, { windowEnd: job.payload.windowStart },
    ]) {
      assert.equal(batch.describe({ ...job, payload: { ...job.payload, ...patch } }), null);
    }
    assert.equal(batch.describe({ ...job, kind: "reconcile" }), null);
  } finally { await f.close(); }
});

test("the same burst without batching repeats fetches and canonical no-op imports", async () => {
  const f = await createBurstFixture(false);
  try {
    Array.from({ length: 8 }, (_, index) => f.enqueue(index));
    assert.equal(await f.service.drainWorker(8, f.account.id), 8);
    assert.deepEqual(f.counts, { fetches: 16, sources: 17, imports: 16, noops: 14 });
  } finally { await f.close(); }
});

test("signed dense notifications with distinct sub-day windows share their closed-day scan", async () => {
  const f = await createBurstFixture();
  try {
    const ids = new Set<string>();
    for (let index = 0; index < 8; index += 1) {
      const webhook = createJunctionSvixWebhook({
        body: {
          event_type: "daily.data.steps.updated", user_id: "junction-user-1",
          data: {
            start_date: "2026-04-01T00:00:00.000Z",
            end_date: `2026-04-03T00:00:0${index}.000Z`,
            source: { provider: "garmin", type: "watch" },
          },
        },
        messageId: `synthetic-signed-burst-${index}`,
        timestamp: String(Date.parse(NOW) / 1000),
      });
      const parsed = await requireJunctionWebhookHandler(f.provider).verifyAndParseWebhook({
        ...webhook, now: NOW,
      });
      assert.equal(parsed.jobs.length, 1);
      const input = parsed.jobs[0]!;
      const job = f.store.enqueueJob({ ...input, accountId: f.account.id, provider: "junction", availableAt: NOW });
      ids.add(job.id);
    }
    assert.equal(ids.size, 8, "the existing ingress dedupe retains distinct notifications");
    assert.equal(await f.service.drainWorker(8, f.account.id), 8);
    assert.deepEqual(f.counts, { fetches: 2, sources: 3, imports: 2, noops: 0 });
  } finally { await f.close(); }
});

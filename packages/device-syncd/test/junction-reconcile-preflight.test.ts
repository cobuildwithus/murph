import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { JUNCTION_RECONCILE_PROOF_METADATA_KEY } from "../src/metadata.ts";
import { encodeJunctionHistoricalBackfillStatus } from "../src/junction-historical-backfill-progress.ts";
import { encodeJunctionReconcileProof, readJunctionReconcileProof } from "../src/junction-reconcile-proof.ts";
import {
  createAccount, createStoredAccount, createConnectionSource, createJunctionProvider,
  createJunctionJobContext, createJob, createJobFromInput, executeJunctionJob,
} from "./junction-provider.harness.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";

const NOW = "2026-04-03T14:00:00.000Z";
const LATER = "2026-04-03T15:00:00.000Z";

function harness(options: { bounded?: boolean; timeseries?: boolean; timeseriesResources?: string[]; emptyTimeseries?: boolean; unavailableTimeseries?: boolean; resources?: string[]; sdkEnvelope?: boolean; weightHistory?: boolean; unavailableSummary?: string } = {}) {
  let providers = [{ id: "provider-garmin-1", slug: "garmin", status: "connected", resource_availability: { activity: true, ...(options.weightHistory ? { weight: true } : {}) } }];
  let rows: unknown[] = [{ id: "activity-1", date: "2026-04-02", steps: 1234, source: { provider: "garmin" } }];
  let timeseriesValue = 99;
  let malformed = false;
  let failImport = false;
  let calls = 0;
  let imports = 0;
  const provider = createJunctionProvider(async (input) => {
    calls += 1;
    const url = new URL(readUrl(input));
    if (url.pathname.includes("/user/providers/")) return createJsonResponse({ providers });
    if (url.pathname.includes("/summary/")) {
      if (options.unavailableSummary && url.pathname.includes(`/summary/${options.unavailableSummary}/`)) {
        return createJsonResponse({ code: "resource_unavailable" }, 404);
      }
      return createJsonResponse(malformed ? null
        : options.sdkEnvelope ? { [url.pathname.split("/summary/")[1]!.split("/")[0]!]: rows } : { data: rows });
    }
    if (url.pathname.includes("/timeseries/") && options.unavailableTimeseries) return createJsonResponse({ code: "resource_unavailable" }, 404);
    if (url.pathname.includes("/timeseries/") && options.emptyTimeseries) return createJsonResponse({ groups: {} });
    if (url.pathname.includes("/timeseries/")) return createJsonResponse({ groups: { garmin: [{
      source: { provider: "garmin", type: "watch" }, data: [{ timestamp: "2026-04-02T12:00:00.000Z", value: timeseriesValue, unit: "mg/dL" }],
    }] } });
    throw new Error("Unexpected provider endpoint");
  }, {
    summaryResources: options.resources ?? ["activity"],
    timeseriesResources: options.timeseriesResources ?? (options.weightHistory ? ["weight"] : options.timeseries ? ["glucose"] : []),
    pushSourceRecoveryEnabled: false,
  });
  const source = { ...createConnectionSource(), resourceCount: 1, lifecycleEpoch: options.weightHistory ? 1 : 0, resourceAvailabilitySummary: { activity: true, ...(options.weightHistory ? { weight: true } : {}) } };
  const account = createAccount({
    sources: [source], lastSyncCompletedAt: NOW,
    metadata: {
      junctionHistoricalBackfillStatus: encodeJunctionHistoricalBackfillStatus("complete"),
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    },
  });
  const context = createJunctionJobContext({
    account, now: NOW, ...(options.bounded ? { shouldYield: () => false } : {}),
    importSnapshot: async () => {
      imports += 1;
      if (failImport) throw new Error("Synthetic import failure");
      return { durableDeliveryAccepted: true, canonicalEventCount: 1 };
    },
  });
  const executor = provider.jobExecutor!;
  const stored = () => createStoredAccount({ ...account, credential: {
    kind: "provider_config", providerConfigKey: "junction", credentialMetadata: {},
  } });
  return {
    account, context, provider,
    setProviders: (value: typeof providers) => { providers = value; },
    setRows: (value: unknown[]) => { rows = value; },
    setMalformed: () => { malformed = true; },
    setTimeseriesValue: (value: number) => { timeseriesValue = value; },
    failImport: () => { failImport = true; },
    calls: () => calls, imports: () => imports,
    probe: (now = LATER) => executor.probeScheduledReconcile!(stored(), now),
    async importBaseline(beforeJob: (job: ReturnType<typeof createJob>) => void = () => {}) {
      const windowEnd = `${context.now.slice(0, 10)}T00:00:00.000Z`;
      let job = createJob("reconcile", {
        windowStart: new Date(Date.parse(windowEnd) - 7 * 86_400_000).toISOString(), windowEnd,
      });
      const previousProof = account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY];
      for (let index = 0; index < 20; index += 1) {
        beforeJob(job);
        const result = await executeJunctionJob(provider, context, job);
        Object.assign(account.metadata, result.metadataPatch);
        const next = result.scheduledJobs?.find((candidate) => candidate.kind === "reconcile");
        if (!next) return result;
        assert.equal(account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY], previousProof, "partial imports cannot publish a baseline");
        job = createJobFromInput(next);
      }
      throw new Error("Unexpected reconcile loop");
    },
  };
}

for (const { timeZone, start, expiry, outcomes } of [
  { timeZone: "UTC", start: "2026-04-03T20:00:00.000Z", expiry: "2026-04-04T00:00:00.000Z",
    outcomes: ["baseline_expired", "content_unchanged", "baseline_expired", "content_unchanged"] },
  { timeZone: "America/New_York", start: "2026-04-04T00:00:00.000Z", expiry: "2026-04-04T04:00:00.000Z",
    outcomes: ["baseline_expired", "baseline_expired", "content_unchanged", "baseline_expired"] },
  { timeZone: "Asia/Tokyo", start: "2026-04-03T11:00:00.000Z", expiry: "2026-04-03T12:00:00.000Z",
    outcomes: ["baseline_expired", "content_unchanged", "baseline_expired", "content_unchanged"] },
]) {
  test(`six-hour proof lifecycle from 20:00 in ${timeZone}`, async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(start));
      const h = harness({ bounded: true, timeseries: true });
      h.context.vaultTimeZone = timeZone;
      h.context.now = new Date().toISOString();
      h.account.lastSyncCompletedAt = h.context.now;
      await h.importBaseline();
      assert.equal(readJunctionReconcileProof(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY])?.validUntil, expiry);
      const actual: string[] = [];
      for (let index = 1; index <= 4; index += 1) {
        vi.setSystemTime(new Date(Date.parse(start) + index * 6 * 3_600_000));
        h.context.now = new Date().toISOString();
        const probe = await h.probe(h.context.now);
        actual.push(probe.reason);
        if (probe.outcome !== "unchanged") {
          await h.importBaseline();
          h.account.lastSyncCompletedAt = h.context.now;
        }
      }
      assert.deepEqual(actual, outcomes);
    } finally { vi.useRealTimers(); }
  });
}

for (const bounded of [false, true]) {
  test(`Junction ${bounded ? "continued" : "single-job"} completed content avoids unchanged pull wake`, async () => {
    const h = harness({ bounded });
    await h.importBaseline();
    assert.ok(readJunctionReconcileProof(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY]));
    const imports = h.imports();
    const probe = await h.probe();
    assert.equal(probe.outcome, "unchanged");
    assert.equal(probe.nextReconcileAt, "2026-04-03T21:00:00.000Z");
    assert.equal(probe.requestCount, 2);
    assert.ok(probe.responseBytes > 0);
    assert.equal(h.imports(), imports, "preflight has no canonical write capability");
  });
}

test("completed daily repair renews yesterday's proof without another full reconcile", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const h = harness({ bounded: true, timeseries: true });
    vi.setSystemTime(new Date("2026-04-03T20:00:00.000Z"));
    h.context.now = new Date().toISOString();
    await h.importBaseline();
    const previousProof = h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY];
    vi.setSystemTime(new Date("2026-04-04T02:00:00.000Z"));
    h.context.now = new Date().toISOString();
    assert.equal((await h.probe(h.context.now)).reason, "baseline_expired");
    await h.importBaseline();
    h.account.lastSyncCompletedAt = h.context.now;
    assert.notEqual(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY], previousProof);
    assert.equal((await h.probe(h.context.now)).reason, "content_unchanged");
    assert.equal((await h.probe("2026-04-04T08:00:00.000Z")).reason, "content_unchanged");
    h.setTimeseriesValue(101);
    assert.equal((await h.probe("2026-04-04T08:00:00.000Z")).reason, "content_changed");
  } finally { vi.useRealTimers(); }
});

for (const bounded of [false, true]) {
  test(`profile and empty daily repair publish complete proof (${bounded ? "continued" : "single summary job"})`, async () => {
    const h = harness({ bounded, resources: ["profile", "activity"], timeseriesResources: ["glucose", "blood_pressure"], emptyTimeseries: true });
    h.setRows([]);
    h.account.lastSyncCompletedAt = "2026-04-02T20:00:00.000Z";
    await h.importBaseline();
    h.account.lastSyncCompletedAt = NOW;
    assert.equal((await h.probe()).reason, "content_unchanged");
  });
}

test("temporal repair keeps a completed content proof without bypassing its queue owner", async () => {
  const h = harness({ timeseriesResources: ["blood_oxygen"], emptyTimeseries: true });
  h.setRows([]);
  const result = await h.importBaseline();
  assert.ok(result.scheduledJobs?.some((job) => job.payload?.temporalAuthorityTimeZone === "UTC"));
  assert.ok(readJunctionReconcileProof(result.metadataPatch?.[JUNCTION_RECONCILE_PROOF_METADATA_KEY]));
  // Web's pending-mailbox tests own admission while these jobs remain queued.
});

test("unavailable daily repair cannot mint a complete proof", async () => {
  const h = harness({ bounded: true, timeseries: true, unavailableTimeseries: true });
  h.account.lastSyncCompletedAt = "2026-04-02T20:00:00.000Z";
  await h.importBaseline();
  assert.equal(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY], undefined);
});

test("failed daily import cannot publish its carried proof", async () => {
  const h = harness({ bounded: true, timeseries: true });
  h.account.lastSyncCompletedAt = "2026-04-02T20:00:00.000Z";
  await assert.rejects(h.importBaseline((job) => {
    if (job.payload.timeseriesCursor) h.failImport();
  }), /Synthetic import failure/);
  assert.equal(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY], undefined);
});

for (const [now, zone, boundary] of [
  ["2026-04-03T23:30:00.000Z", "UTC", "2026-04-04T00:00:00.000Z"],
  ["2026-04-03T10:00:00.000Z", "UTC", "2026-04-03T12:00:00.000Z"],
  ["2026-04-03T14:00:00.000Z", "Asia/Tokyo", "2026-04-03T15:00:00.000Z"],
  ["2026-03-09T00:30:00.000Z", "America/New_York", "2026-03-09T04:00:00.000Z"],
  ["2026-11-02T00:30:00.000Z", "America/New_York", "2026-11-02T04:00:00.000Z"],
] as const) {
  test(`daily repair drops proof when crossing ${boundary} in ${zone}`, async () => {
    const h = harness({ bounded: true, timeseries: true, emptyTimeseries: true });
    h.context.now = now;
    h.context.vaultTimeZone = zone;
    h.account.lastSyncCompletedAt = new Date(Date.parse(now) - 86_400_000).toISOString();
    await h.importBaseline((job) => {
      if (!job.payload.timeseriesCursor) return;
      const carried = readJunctionReconcileProof(job.payload.reconcileProof);
      assert.ok(carried);
      assert.equal(carried.validUntil, boundary);
      h.context.now = boundary;
    });
    assert.equal(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY], undefined);
  });
}

test("an old runner dropping the optional carried proof preserves repair without certifying a partial baseline", async () => {
  const h = harness({ bounded: true, timeseries: true });
  h.account.lastSyncCompletedAt = "2026-04-02T20:00:00.000Z";
  await h.importBaseline((job) => {
    if (job.payload.timeseriesCursor) delete job.payload.reconcileProof;
  });
  h.account.lastSyncCompletedAt = NOW;
  assert.equal((await h.probe()).reason, "baseline_missing");
  await h.importBaseline();
  assert.equal((await h.probe()).reason, "content_unchanged");
});

test("pre-change checkpoint proof remains readable by the new probe", async () => {
  const h = harness({ bounded: true, timeseries: true });
  // Captured from this synthetic fixture before the lifecycle change. The
  // encoding and content binding do not change in either deploy order.
  h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY] = '["2026-03-27T20:00:00.000Z","2026-04-04T00:00:00.000Z","082f0766090f553a66fb08c9c4cc0fadf75f204c6ee6a6f77315230c5e87a9c2","7ef761d3e84962202a47f79b870ed450eb3d8c40fb10f07b79c79af0821783c1","UTC"]';
  assert.equal((await h.probe("2026-04-03T21:00:00.000Z")).reason, "content_unchanged");
  assert.equal((await h.probe("2026-04-04T00:00:00.000Z")).reason, "baseline_expired");
});

test("empty repair source-read failure cannot checkpoint a proof", async () => {
  const h = harness({ bounded: true, timeseriesResources: ["glucose", "heart_rate_alert"], emptyTimeseries: true });
  h.account.lastSyncCompletedAt = "2026-04-02T20:00:00.000Z";
  await assert.rejects(h.importBaseline((job) => {
    if (job.payload.timeseriesCursor) h.context.listConnectionSources = async () => {
      throw new Error("Synthetic source read failure");
    };
  }), /Synthetic source read failure/);
  assert.equal(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY], undefined);
});

test("Junction detects a correction with unchanged count, id and date", async () => {
  const h = harness({ bounded: true });
  await h.importBaseline();
  h.setRows([{ id: "activity-1", date: "2026-04-02", steps: 4321, source: { provider: "garmin" } }]);
  assert.equal((await h.probe()).outcome, "changed");
});

test("SDK-decoded timestamp corrections invalidate the imported content proof", async () => {
  const h = harness({ sdkEnvelope: true });
  const row = {
    id: "activity-sdk-1", user_id: "synthetic-junction-user",
    date: "2026-04-02T00:00:00.000Z", calendar_date: "2026-04-02",
    steps: 1234, source: { provider: "garmin" },
    created_at: "2026-04-02T12:00:00.000Z", updated_at: "2026-04-03T13:00:00.000Z",
  };
  h.setRows([row]);
  await h.importBaseline();
  assert.equal((await h.probe()).outcome, "unchanged");
  h.setRows([{ ...row, updated_at: "2026-04-03T14:30:00.000Z" }]);
  assert.equal((await h.probe()).outcome, "changed");
});

test("SDK summary collections complete an unchanged preflight", async () => {
  const h = harness({ sdkEnvelope: true, resources: ["activity", "sleep", "sleep_cycle", "workouts", "body", "meal", "menstrual_cycle", "electrocardiogram"] });
  h.setRows([]);
  await h.importBaseline();
  assert.ok(readJunctionReconcileProof(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY]));
  const imports = h.imports();
  const probe = await h.probe();
  assert.equal(probe.outcome, "unchanged");
  assert.equal(probe.requestCount, 9);
  assert.equal(h.imports(), imports);
});

test("failed import does not publish unchanged evidence", async () => {
  const h = harness();
  h.failImport();
  await assert.rejects(h.importBaseline(), /Synthetic import failure/);
  assert.equal(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY], undefined);
  assert.equal((await h.probe()).reason, "baseline_missing");
});

test("a skipped summary unit cannot publish a complete content proof", async () => {
  const h = harness({ bounded: true, resources: ["activity", "body"], unavailableSummary: "body" });
  await h.importBaseline();
  assert.equal(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY], undefined);
  assert.equal((await h.probe()).reason, "baseline_missing");
});

test("malformed successful provider response cannot certify unchanged", async () => {
  const h = harness();
  await h.importBaseline();
  h.setMalformed();
  assert.notEqual((await h.probe()).outcome, "unchanged");
});

test("source reconnect invalidates prior content proof", async () => {
  const h = harness();
  await h.importBaseline();
  h.account.sources![0]!.lifecycleEpoch = 1;
  assert.equal((await h.probe()).reason, "authority_or_inventory_changed");
});

test("pending history keeps ordinary scheduler work", async () => {
  const h = harness();
  await h.importBaseline();
  delete h.account.metadata.junctionHistoricalBackfillStatus;
  const calls = h.calls();
  assert.equal((await h.probe()).reason, "history_or_recovery_due");
  assert.equal(h.calls(), calls);
});

test("expired daily proof requires repair without provider preflight", async () => {
  const h = harness();
  await h.importBaseline();
  const result = await h.provider.jobExecutor!.probeScheduledReconcile!(createStoredAccount({
    ...h.account, credential: { kind: "provider_config", providerConfigKey: "junction", credentialMetadata: {} },
  }), "2026-04-04T00:00:00.000Z");
  assert.equal(result.reason, "baseline_expired");
  assert.equal(result.requestCount, 0);
});

test("closed-day measurement correction wakes even with unchanged summaries", async () => {
  const h = harness({ bounded: true, timeseries: true });
  await h.importBaseline();
  assert.equal((await h.probe()).outcome, "unchanged");
  h.setTimeseriesValue(101);
  assert.equal((await h.probe()).outcome, "changed");
});

test("provider collection order and object key order do not create a change", async () => {
  const h = harness({ bounded: true });
  h.setRows([
    { id: "first", date: "2026-04-02", steps: 1, source: { provider: "garmin" } },
    { id: "second", date: "2026-04-02", steps: 2, source: { provider: "garmin" } },
  ]);
  await h.importBaseline();
  h.setRows([
    { source: { provider: "garmin" }, steps: 2, date: "2026-04-02", id: "second" },
    { source: { provider: "garmin" }, steps: 1, date: "2026-04-02", id: "first" },
  ]);
  assert.equal((await h.probe()).outcome, "unchanged");
});

test("coupled sleep summaries preserve comparison order through continuations", async () => {
  const h = harness({ bounded: true, resources: ["sleep_cycle", "activity", "sleep"] });
  await h.importBaseline();
  assert.equal((await h.probe()).outcome, "unchanged");
});

test("old retained continuation without proof must finish imports before new baseline", async () => {
  const h = harness({ bounded: true });
  const result = await executeJunctionJob(h.provider, h.context, createJob("reconcile", {
    summaryPhaseComplete: true, windowStart: "2026-03-27T00:00:00.000Z", windowEnd: "2026-04-03T00:00:00.000Z",
  }));
  assert.equal(result.metadataPatch?.[JUNCTION_RECONCILE_PROOF_METADATA_KEY], undefined);
});

test("provider-day closure and local midnight expire proof before the next repair boundary", async () => {
  for (const [now, zone, expiry] of [
    ["2026-04-03T10:00:00.000Z", "UTC", "2026-04-03T12:00:00.000Z"],
    [NOW, "Asia/Tokyo", LATER],
  ]) {
    const h = harness();
    h.context.now = now!;
    h.context.vaultTimeZone = zone!;
    await h.importBaseline();
    assert.equal(readJunctionReconcileProof(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY])?.validUntil, expiry);
  }
});

test("a restored container's local disconnect counter does not invalidate shared proof", async () => {
  const h = harness();
  h.account.disconnectGeneration = 4;
  await h.importBaseline();
  h.account.disconnectGeneration = 0;
  assert.equal((await h.probe()).outcome, "unchanged");
});

test("fall-back timezone closure cannot extend proof past newly eligible temporal repair", async () => {
  const h = harness();
  h.context.now = "2026-11-02T00:30:00.000Z";
  h.context.vaultTimeZone = "America/New_York";
  h.account.lastSyncCompletedAt = h.context.now;
  await h.importBaseline();
  // The October 31 day ended at 04:00Z before the offset transition. Its fixed
  // 24-hour authority lag ends before the next local midnight at 05:00Z.
  assert.equal(readJunctionReconcileProof(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY])?.validUntil,
    "2026-11-02T04:00:00.000Z");
});

test("comparison binds the original window and expiry instead of accepting edited scope", async () => {
  const h = harness();
  await h.importBaseline();
  const proof = readJunctionReconcileProof(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY]);
  assert.ok(proof);
  h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY] = encodeJunctionReconcileProof({
    ...proof, validUntil: "2026-04-04T12:00:00.000Z",
  });
  assert.equal((await h.probe()).outcome, "changed");
});


test("incompatible content bindings fall back and cannot finish a partial proof", async () => {
  const h = harness({ bounded: true });
  await h.importBaseline();
  const proof = readJunctionReconcileProof(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY]);
  assert.ok(proof);
  const incompatibleProof = encodeJunctionReconcileProof({ ...proof, binding: "f".repeat(64) });
  h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY] = incompatibleProof;
  const probe = await h.probe();
  assert.equal(probe.reason, "authority_or_inventory_changed");
  assert.equal(probe.requestCount, 1);
  const result = await executeJunctionJob(h.provider, h.context, createJob("reconcile", {
    summaryPhaseComplete: true, reconcileProof: incompatibleProof,
    windowStart: "2026-03-27T00:00:00.000Z", windowEnd: "2026-04-03T00:00:00.000Z",
  }));
  assert.equal(result.metadataPatch?.[JUNCTION_RECONCILE_PROOF_METADATA_KEY], undefined);
});

test("an explicitly empty admitted inventory can reuse completed content proof", async () => {
  const h = harness();
  h.account.sources = [];
  h.setRows([]);
  await h.importBaseline();
  assert.ok(readJunctionReconcileProof(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY]));
  assert.equal((await h.probe()).outcome, "unchanged");
  h.account.sources = [{ ...createConnectionSource(), resourceCount: 1 }];
  assert.equal((await h.probe()).reason, "authority_or_inventory_changed");
});

test("empty live inventory remains comparable until a provider connects", async () => {
  const h = harness();
  h.account.sources = [];
  h.setProviders([]);
  h.setRows([]);
  await h.importBaseline();
  assert.equal((await h.probe()).outcome, "unchanged");
  h.setProviders([{ id: "provider-new", slug: "garmin", status: "connected", resource_availability: { activity: true } }]);
  assert.equal((await h.probe()).reason, "authority_or_inventory_changed");
});

test("missing admitted source authority still requires runtime reconciliation", async () => {
  const h = harness();
  await h.importBaseline();
  h.account.sources = undefined;
  assert.equal((await h.probe()).reason, "sources_missing");
});

test("checkpoint-owned future history permits content preflight only until its deadline", async () => {
  const h = harness({ weightHistory: true });
  await h.importBaseline();
  assert.equal((await h.probe()).reason, "history_or_recovery_due");
  const baseline = readJunctionReconcileProof(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY]);
  assert.ok(baseline);
  const deferred = { ...baseline, historyDeferredUntil: Date.parse("2026-04-03T16:00:00.000Z") };
  h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY] = encodeJunctionReconcileProof(deferred);
  assert.equal((await h.probe()).outcome, "unchanged");
  h.account.sources![0]!.lifecycleEpoch = 2;
  assert.equal((await h.probe()).reason, "authority_or_inventory_changed", "deferral cannot hide a reconnect");
  h.account.sources![0]!.lifecycleEpoch = 1;
  h.setRows([{ id: "activity-1", date: "2026-04-02", steps: 4321, source: { provider: "garmin" } }]);
  assert.equal((await h.probe()).outcome, "changed", "retained history cannot hide fresh data");
  h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY] = encodeJunctionReconcileProof({ ...deferred, historyDeferredUntil: Date.parse(LATER) });
  assert.equal((await h.probe()).reason, "history_or_recovery_due");
});

test("future history proof stays inside the legacy metadata bound and rejects unsafe deadlines", () => {
  const baseline = { windowStart: "2026-04-01T00:00:00.000Z", validUntil: "2026-04-04T00:00:00.000Z",
    binding: "a".repeat(64), digest: "b".repeat(64), timeZone: "America/Argentina/Buenos_Aires" };
  assert.deepEqual(readJunctionReconcileProof(encodeJunctionReconcileProof(baseline)), baseline);
  const proof = { ...baseline, historyDeferredUntil: Date.parse(baseline.validUntil) };
  assert.ok(encodeJunctionReconcileProof(proof).length <= 256);
  assert.deepEqual(readJunctionReconcileProof(encodeJunctionReconcileProof(proof)), proof);
  for (const deadline of [0, Date.parse(baseline.validUntil) + 1, 1.5, NaN]) {
    assert.equal(readJunctionReconcileProof(encodeJunctionReconcileProof({ ...baseline, historyDeferredUntil: deadline })), null);
  }
});

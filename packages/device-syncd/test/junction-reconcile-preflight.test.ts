import assert from "node:assert/strict";
import { test } from "vitest";
import { JUNCTION_RECONCILE_PROOF_METADATA_KEY } from "../src/metadata.ts";
import { encodeJunctionHistoricalBackfillStatus } from "../src/junction-historical-backfill-progress.ts";
import { readJunctionReconcileProof } from "../src/junction-reconcile-proof.ts";
import {
  createAccount, createStoredAccount, createConnectionSource, createJunctionProvider,
  createJunctionJobContext, createJob, createJobFromInput, executeJunctionJob,
} from "./junction-provider.harness.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";

const NOW = "2026-04-03T14:00:00.000Z";
const LATER = "2026-04-03T15:00:00.000Z";

function harness(options: { bounded?: boolean; timeseries?: boolean; resources?: string[] } = {}) {
  let rows: unknown[] = [{ id: "activity-1", date: "2026-04-02", steps: 1234, source: { provider: "garmin" } }];
  let timeseriesValue = 99;
  let malformed = false;
  let failImport = false;
  let calls = 0;
  let imports = 0;
  const provider = createJunctionProvider(async (input) => {
    calls += 1;
    const url = new URL(readUrl(input));
    if (url.pathname.includes("/user/providers/")) return createJsonResponse({ providers: [{
      id: "provider-garmin-1", slug: "garmin", status: "connected", resource_availability: { activity: true },
    }] });
    if (url.pathname.includes("/summary/")) return createJsonResponse(malformed ? null : { data: rows });
    if (url.pathname.includes("/timeseries/")) return createJsonResponse({ groups: { garmin: [{
      source: { provider: "garmin", type: "watch" }, data: [{ timestamp: "2026-04-02T12:00:00.000Z", value: timeseriesValue, unit: "mg/dL" }],
    }] } });
    throw new Error("Unexpected provider endpoint");
  }, {
    summaryResources: options.resources ?? ["activity"],
    timeseriesResources: options.timeseries ? ["glucose"] : [],
    pushSourceRecoveryEnabled: false,
  });
  const source = { ...createConnectionSource(), resourceCount: 1, lifecycleEpoch: 0 };
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
    setRows: (value: unknown[]) => { rows = value; },
    setMalformed: () => { malformed = true; },
    setTimeseriesValue: (value: number) => { timeseriesValue = value; },
    failImport: () => { failImport = true; },
    calls: () => calls, imports: () => imports,
    probe: () => executor.probeScheduledReconcile!(stored(), LATER),
    async importBaseline() {
      let job = createJob("reconcile", { windowStart: "2026-03-27T00:00:00.000Z", windowEnd: "2026-04-03T00:00:00.000Z" });
      for (let index = 0; index < 20; index += 1) {
        const result = await executeJunctionJob(provider, context, job);
        Object.assign(account.metadata, result.metadataPatch);
        const next = result.scheduledJobs?.find((candidate) => candidate.kind === "reconcile");
        if (!next) return result;
        assert.equal(account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY], undefined, "partial imports cannot publish a baseline");
        job = createJobFromInput(next);
      }
      throw new Error("Unexpected reconcile loop");
    },
  };
}

for (const bounded of [false, true]) {
  test(`Junction ${bounded ? "continued" : "single-job"} completed content avoids unchanged pull wake`, async () => {
    const h = harness({ bounded });
    await h.importBaseline();
    assert.ok(readJunctionReconcileProof(h.account.metadata[JUNCTION_RECONCILE_PROOF_METADATA_KEY]));
    const imports = h.imports();
    const probe = await h.probe();
    assert.equal(probe.outcome, "unchanged");
    assert.equal(probe.nextReconcileAt, "2026-04-03T16:00:00.000Z");
    assert.equal(probe.requestCount, 2);
    assert.ok(probe.responseBytes > 0);
    assert.equal(h.imports(), imports, "preflight has no canonical write capability");
  });
}

test("Junction detects a correction with unchanged count, id and date", async () => {
  const h = harness({ bounded: true });
  await h.importBaseline();
  h.setRows([{ id: "activity-1", date: "2026-04-02", steps: 4321, source: { provider: "garmin" } }]);
  assert.equal((await h.probe()).outcome, "changed");
});

test("failed import does not publish unchanged evidence", async () => {
  const h = harness();
  h.failImport();
  await assert.rejects(h.importBaseline(), /Synthetic import failure/);
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

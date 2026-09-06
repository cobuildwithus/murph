import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createAccount,
  createConnectionSource,
  createJob,
  createJunctionJobContext,
  createJunctionProvider,
  executeJunctionJob,
} from "./junction-provider.harness.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";
import type { ProviderJobContext } from "../src/types.ts";

test.each([
  "connected", "disconnected", "unavailable", "empty", "fenced-empty", "skipped", "unscoped", "local",
] as const)("Junction timeseries source reuse preserves %s behavior", async (scenario) => {
  const events: string[] = [];
  const resource = scenario === "fenced-empty" ? "heart_rate_alert" : "blood_oxygen";
  const sample = { timestamp: "2026-04-02T14:00:00.000Z", unit: "%", value: 97 };
  const originalSource = createConnectionSource();
  let liveSource = originalSource;
  const snapshots: Parameters<ProviderJobContext["importSnapshot"]>[0][] = [];
  const readFailure = new Error("Synthetic source read unavailable");
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [{
        slug: "garmin", name: "Garmin", status: "connected",
        resource_availability: { blood_oxygen: true },
      }] });
    }
    assert.equal(url.pathname, `/v2/timeseries/junction-user-1/${resource}/grouped`);
    events.push("provider");
    if (scenario === "skipped") return createJsonResponse({ error: "Not found" }, 404);
    // The admission read must observe changes made during the provider fetch,
    // rather than the account's earlier hydration snapshot.
    if (scenario === "disconnected") {
      liveSource = createConnectionSource({ status: "disconnected" });
    }
    return createJsonResponse({ groups: scenario === "empty" || scenario === "fenced-empty" ? {} : {
      garmin: [{ data: [sample], source: { provider: "garmin", type: "watch" } }],
    } });
  }, { summaryResources: [], timeseriesResources: [resource] });
  const context = createJunctionJobContext({
    now: "2026-04-04T12:00:00.000Z",
    account: createAccount({ sources: [{ ...originalSource, resourceCount: 1 }] }),
    connectionSourceAdmissionMode: "listed_only",
    listConnectionSources: scenario === "local" ? undefined : async (input) => {
      events.push("sources");
      if (scenario === "unavailable") throw readFailure;
      assert.equal(input?.status, undefined);
      assert.equal(input?.sourceProviderSlug, undefined);
      return [liveSource];
    },
    importSnapshot: async (snapshot) => {
      events.push("import");
      snapshots.push(snapshot);
      return { imported: true };
    },
  });
  const job = createJob("reconcile", {
    ...(scenario === "unscoped" ? {} : { sourceProviderSlug: "garmin" }),
    timeseriesCursor: "2026-04-02T00:00:00.000Z",
    timeseriesResourceCursor: resource,
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-02T00:00:00.000Z",
  });
  if (scenario === "unavailable") {
    await assert.rejects(executeJunctionJob(provider, context, job), (error) => error === readFailure);
    assert.deepEqual(events, ["provider", "sources"]);
    assert.equal(snapshots.length, 0);
    return;
  }
  const result = await executeJunctionJob(provider, context, job);
  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  if (["empty", "fenced-empty", "skipped", "disconnected"].includes(scenario)) {
    assert.deepEqual(events, scenario === "empty" || scenario === "skipped"
      ? ["provider"] : ["provider", "sources"]);
    assert.equal(snapshots.length, 0);
    return;
  }
  const expectedEvents = scenario === "local"
    ? ["provider", "import"]
    : ["provider", "sources", "import"];
  assert.deepEqual(events, expectedEvents);
  assert.equal(snapshots.length, 1);
  assert.ok(JSON.stringify(snapshots[0]).includes(sample.timestamp));
  assert.ok(JSON.stringify(snapshots[0]).includes('"value":97'));
  // A later execution must read again; the result is not cached across jobs.
  await executeJunctionJob(provider, context, job);
  assert.deepEqual(events, [...expectedEvents, ...expectedEvents]);
  assert.deepEqual(snapshots[1], snapshots[0]);
});


test("Junction resource pass shares inventory but reads live import authority for every job", async () => {
  let inventoryReads = 0;
  let sourceReads = 0;
  let imports = 0;
  let liveSource = createConnectionSource();
  let disconnectDuringFetch = false;
  let sourceReadFailure = false;
  const sourceFailure = new Error("Synthetic live source read failed");
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      inventoryReads += 1;
      return createJsonResponse({ providers: [{
        slug: "garmin", name: "Garmin", status: "connected",
        resource_availability: { blood_oxygen: true },
      }] });
    }
    assert.equal(url.pathname, "/v2/timeseries/junction-user-1/blood_oxygen/grouped");
    if (disconnectDuringFetch) {
      liveSource = createConnectionSource({ status: "disconnected" });
    }
    return createJsonResponse({ groups: { garmin: [{
      data: [{ timestamp: "2026-04-02T14:00:00.000Z", unit: "%", value: 97 }],
      source: { provider: "garmin", type: "watch" },
    }] } });
  }, { summaryResources: [], timeseriesResources: ["blood_oxygen"] });
  const context = createJunctionJobContext({
    now: "2026-04-04T12:00:00.000Z",
    account: createAccount({ sources: [{ ...liveSource, resourceCount: 1 }] }),
    connectionSourceAdmissionMode: "listed_only",
    listConnectionSources: async () => {
      sourceReads += 1;
      if (sourceReadFailure) throw sourceFailure;
      return [liveSource];
    },
    importSnapshot: async () => { imports += 1; return { imported: true }; },
  });
  const job = createJob("resource", {
    resource: "blood_oxygen", resourceCategory: "timeseries", sourceProviderSlug: "garmin",
    windowEnd: "2026-04-03T00:00:00.000Z", windowStart: "2026-04-02T00:00:00.000Z",
  });
  assert.ok(provider.jobExecutor);
  await provider.jobExecutor.executeJob(context, job);
  await provider.jobExecutor.executeJob(context, job);
  assert.equal(inventoryReads, 2);
  assert.equal(sourceReads, 4);
  assert.equal(imports, 2);
  inventoryReads = 0;
  sourceReads = 0;
  imports = 0;

  const pass = provider.jobExecutor.createPassExecutor?.() ?? provider.jobExecutor;
  await pass.executeJob(context, job);
  await pass.executeJob(context, job);
  assert.equal(inventoryReads, 1);
  assert.equal(sourceReads, 3); // one projection plus two live import reads
  assert.equal(imports, 2);

  disconnectDuringFetch = true;
  await pass.executeJob(context, job);
  assert.equal(inventoryReads, 1);
  assert.equal(sourceReads, 4);
  assert.equal(imports, 2);

  disconnectDuringFetch = false;
  liveSource = createConnectionSource({ firstSeenAt: "2026-04-04T00:00:00.000Z", lifecycleEpoch: 2 });
  context.account.sources = [{ ...liveSource, resourceCount: 1 }];
  await pass.executeJob(context, job);
  assert.equal(inventoryReads, 2);
  assert.equal(sourceReads, 6);
  assert.equal(imports, 3);

  const nextPass = provider.jobExecutor.createPassExecutor?.() ?? provider.jobExecutor;
  await nextPass.executeJob(context, job);
  assert.equal(inventoryReads, 3);
  assert.equal(sourceReads, 8);
  assert.equal(imports, 4);

  sourceReadFailure = true;
  await assert.rejects(nextPass.executeJob(context, job), (error) => error === sourceFailure);
  assert.equal(imports, 4);
  sourceReadFailure = false;
  await nextPass.executeJob(context, job);
  assert.equal(inventoryReads, 4);
  assert.equal(sourceReads, 11);
  assert.equal(imports, 5);

  context.account.disconnectGeneration += 1;
  await nextPass.executeJob(context, job);
  assert.equal(inventoryReads, 5);
  assert.equal(imports, 6);

  const historicalJob = { ...job, payload: { ...job.payload, historicalBackfill: true } };
  await nextPass.executeJob(context, historicalJob);
  await nextPass.executeJob(context, historicalJob);
  assert.equal(inventoryReads, 7);
  assert.equal(imports, 8);
  await nextPass.executeJob(context, job);
  assert.equal(inventoryReads, 8);
  assert.equal(imports, 9);
});

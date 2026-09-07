import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createAccount,
  createConnectionSource,
  createJob,
  createJobFromInput,
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


test.each(["resource", "reconcile"] as const)("Junction %s pass shares inventory but reads live import authority for every job", async (kind) => {
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
    assert.equal(url.pathname, kind === "resource"
      ? "/v2/timeseries/junction-user-1/blood_oxygen/grouped"
      : "/v2/summary/activity/junction-user-1");
    if (disconnectDuringFetch) {
      liveSource = createConnectionSource({ status: "disconnected" });
    }
    if (kind === "reconcile") {
      return createJsonResponse({ data: [{
        id: "activity-1", source: { provider: "garmin", type: "watch" },
        calendar_date: "2026-04-02", steps: 5000,
      }] });
    }
    return createJsonResponse({ groups: { garmin: [{
      data: [{ timestamp: "2026-04-02T14:00:00.000Z", unit: "%", value: 97 }],
      source: { provider: "garmin", type: "watch" },
    }] } });
  }, { summaryResources: ["activity"], timeseriesResources: ["blood_oxygen"] });
  const context = createJunctionJobContext({
    now: "2026-04-04T12:00:00.000Z",
    account: createAccount({ sources: [{ ...liveSource, resourceCount: 1 }] }),
    connectionSourceAdmissionMode: "listed_only",
    listConnectionSources: async () => {
      sourceReads += 1;
      if (sourceReadFailure) throw sourceFailure;
      return [liveSource];
    },
    importSnapshot: async (snapshot) => {
      // Summary jobs still submit an empty, fenced snapshot after disconnect.
      if (kind === "resource" || JSON.stringify(snapshot).includes('"steps":5000')) {
        imports += 1;
      }
      return { imported: true };
    },
  });
  if (kind === "reconcile") context.shouldYield = () => false;
  const job = createJob(kind, {
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


test("Junction summary continuations preserve imports and progress with one inventory per pass", async () => {
  let inventoryReads = 0;
  let sourceReads = 0;
  const imported: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const pathname = new URL(readUrl(input)).pathname;
    if (pathname === "/v2/user/providers/junction-user-1") {
      inventoryReads += 1;
      return createJsonResponse({ providers: [{
        id: "provider-garmin-1", slug: "garmin", status: "connected",
        resource_availability: { activity: true, sleep: true, sleep_cycle: true, body: true },
      }] });
    }
    const resource = pathname.match(/^\/v2\/summary\/([^/]+)\/junction-user-1$/u)?.[1];
    assert.ok(resource);
    return createJsonResponse({ data: [{
      id: `${resource}-1`, connectionId: "provider-garmin-1",
      calendar_date: "2026-04-02", steps: 5000,
    }] });
  }, { summaryResources: ["activity", "sleep", "sleep_cycle", "body"], timeseriesResources: [] });
  const source = createConnectionSource();
  const context = createJunctionJobContext({
    account: createAccount({ sources: [{ ...source, resourceCount: 1 }] }),
    connectionSourceAdmissionMode: "listed_only",
    listConnectionSources: async () => { sourceReads += 1; return [source]; },
    importSnapshot: async (snapshot) => { imported.push(snapshot); return { imported: true }; },
    shouldYield: () => false,
  });
  const jobExecutor = provider.jobExecutor;
  assert.ok(jobExecutor?.createPassExecutor);
  const pass = jobExecutor.createPassExecutor();
  const run = async (shareInventory: boolean) => {
    const executor = shareInventory ? pass : jobExecutor;
    let job = createJob("reconcile", {
      windowStart: "2026-03-27T00:00:00.000Z", windowEnd: "2026-04-03T00:00:00.000Z",
    });
    const results = [];
    for (let index = 0; index < 4; index += 1) {
      const result = await executor.executeJob(context, job);
      results.push(result);
      const continuation = result.scheduledJobs?.[0];
      if (!continuation) {
        assert.equal(index, 3);
        break;
      }
      job = createJobFromInput(continuation, index);
    }
    return results;
  };
  const baselineResults = await run(false);
  const baselineImports = [...imported];
  assert.equal(inventoryReads, 4);
  assert.equal(sourceReads, 8);
  assert.equal(imported.length, 4);
  assert.ok(JSON.stringify(imported).includes('"steps":5000'));
  imported.length = 0;
  inventoryReads = 0;
  sourceReads = 0;
  assert.deepEqual(await run(true), baselineResults);
  assert.deepEqual(imported, baselineImports);
  assert.equal(inventoryReads, 1);
  assert.equal(sourceReads, 5);
});


test("Junction pass keeps bounded inventory separate and refreshes after history or full work", async () => {
  let inventoryReads = 0;
  const provider = createJunctionProvider(async (input) => {
    const pathname = new URL(readUrl(input)).pathname;
    if (pathname === "/v2/user/providers/junction-user-1") {
      inventoryReads += 1;
      return createJsonResponse({ providers: [{
        slug: "garmin", status: "connected", resource_availability: { blood_oxygen: true },
      }] });
    }
    if (pathname === "/v2/summary/activity/junction-user-1") return createJsonResponse({ data: [] });
    assert.equal(pathname, "/v2/timeseries/junction-user-1/blood_oxygen/grouped");
    return createJsonResponse({ groups: {} });
  }, { summaryResources: ["activity"], timeseriesResources: ["blood_oxygen"] });
  const context = createJunctionJobContext({
    account: createAccount({ sources: [{ ...createConnectionSource(), resourceCount: 1 }] }),
    shouldYield: () => false,
  });
  assert.ok(provider.jobExecutor?.createPassExecutor);
  const pass = provider.jobExecutor.createPassExecutor();
  const window = { windowStart: "2026-04-02T00:00:00.000Z", windowEnd: "2026-04-03T00:00:00.000Z" };
  const resource = createJob("resource", {
    ...window, resource: "blood_oxygen", resourceCategory: "timeseries", sourceProviderSlug: "garmin",
  });
  const reconcile = createJob("reconcile", window);
  await pass.executeJob(context, resource);
  assert.equal(inventoryReads, 1);
  await pass.executeJob(context, reconcile);
  assert.equal(inventoryReads, 2); // Ordinary inventory cannot bypass bounded collection.
  await pass.executeJob(context, reconcile);
  await pass.executeJob(context, resource);
  assert.equal(inventoryReads, 2);
  await pass.executeJob({ ...context, shouldYield: undefined }, reconcile);
  assert.equal(inventoryReads, 3);
  await pass.executeJob(context, reconcile);
  assert.equal(inventoryReads, 4);
  await pass.executeJob(context, createJob("backfill", window));
  await pass.executeJob(context, createJob("backfill", window));
  assert.equal(inventoryReads, 6);
  await pass.executeJob(context, reconcile);
  assert.equal(inventoryReads, 7);
  await pass.executeJob(context, createJob("reconcile", {
    ...window, timeseriesCursor: window.windowStart, timeseriesResourceCursor: "blood_oxygen",
  }));
  await pass.executeJob(context, reconcile);
  assert.equal(inventoryReads, 8);
});

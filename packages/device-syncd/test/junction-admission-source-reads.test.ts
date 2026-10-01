import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createDeviceSyncService, SqliteDeviceSyncStore } from "../src/service.ts";
import { test } from "vitest";
import {
  createAccount,
  createConnectionSource,
  createJob,
  createJunctionJobContext,
  createJunctionProvider,
  createJunctionWorkoutStreamJobContext,
  createJunctionWorkoutStreamResourceJob,
  createJunctionWorkoutStreamSource,
  createJunctionWorkoutStreamTestProvider,
  executeJunctionJob,
} from "./junction-provider.harness.ts";
import { createJsonResponse, makeTempDirectory, readUrl } from "./helpers.ts";

test.each(["connected", "disconnected", "unavailable", "local"] as const)(
  "summary evidence and import share post-provider sources (%s)", async (scenario) => {
    const source = createConnectionSource();
    let liveSource = source;
    let profileFetched = false;
    const events: string[] = [];
    const imported: string[] = [];
    const failure = new Error("Synthetic source read failure");
    const provider = createJunctionProvider(async (input) => {
      const pathname = new URL(readUrl(input)).pathname;
      if (pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers: [{
          id: "provider-garmin-1", slug: "garmin", status: "connected",
          resource_availability: { activity: true },
        }] });
      }
      if (pathname === "/v2/summary/activity/junction-user-1") {
        events.push("summary");
        return createJsonResponse({ data: [{
          id: "activity-read-reuse", connectionId: "provider-garmin-1", steps: 4321,
        }] });
      }
      assert.equal(pathname, "/v2/summary/profile/junction-user-1");
      events.push("profile");
      profileFetched = true;
      if (scenario === "disconnected") {
        liveSource = createConnectionSource({ status: "disconnected" });
      }
      return createJsonResponse({ data: [] });
    }, { summaryResources: ["activity", "profile"], timeseriesResources: [] });
    const context = createJunctionJobContext({
      account: createAccount({ sources: [{ ...source, resourceCount: 1 }] }),
      connectionSourceAdmissionMode: "listed_only",
      listConnectionSources: scenario === "local" ? undefined : async () => {
        if (events.length > 0) events.push("sources");
        if (profileFetched && scenario === "unavailable") throw failure;
        return [liveSource];
      },
      importSnapshot: async (snapshot) => {
        events.push("import");
        imported.push(JSON.stringify(snapshot));
        return { imported: true };
      },
    });
    const run = () => executeJunctionJob(provider, context, createJob("backfill", {
      sourceProviderSlug: "garmin",
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }));
    if (scenario === "unavailable") {
      await assert.rejects(run, (error) => error === failure);
      assert.deepEqual(events, ["summary", "profile", "sources"]);
      assert.equal(imported.length, 0);
      return;
    }
    await run();
    assert.deepEqual(events.slice(0, events.indexOf("import") + 1), scenario === "local"
      ? ["summary", "profile", "import"]
      : ["summary", "profile", "sources", "import"]);
    assert.equal(imported.some((snapshot) => snapshot.includes('"steps":4321')),
      scenario !== "disconnected");
  },
);

test.each([false, true])("workout admission reuses each fresh stream read (disconnect: %s)", async (disconnect) => {
  const events: string[] = [];
  let streamCount = 0;
  const source = createJunctionWorkoutStreamSource();
  let liveSource = source;
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-first", "workout-second"],
    streamResponse: () => {
      events.push("stream");
      streamCount += 1;
      if (disconnect && streamCount === 2) {
        liveSource = { ...source, status: "disconnected" };
      }
      return createJsonResponse({
        time: [1_775_131_200, 1_775_133_000],
        heartrate: [100, 160], distance: [0, 5_000],
      });
    },
  });
  await executeJunctionJob(harness.provider, createJunctionWorkoutStreamJobContext({
    listConnectionSources: async () => {
      if (streamCount > 0) events.push("sources");
      return [liveSource];
    },
    importSnapshot: async () => {
      events.push("import");
      return { imported: true };
    },
  }), createJunctionWorkoutStreamResourceJob({ sourceProviderSlug: "garmin" }));

  assert.deepEqual(events, [
    "stream", "sources", "import", "stream", "sources", ...(disconnect ? [] : ["import"]),
  ]);
});

test.each(["connected", "disconnected", "unavailable", "new_epoch", "without_reader"] as const)(
  "summary resources share projection admission without caching it (%s)", async (scenario) => {
    let inventoryReads = 0;
    let sourceReads = 0;
    let fetches = 0;
    const source = createConnectionSource();
    let liveSource = source;
    const failure = new Error("Synthetic current source unavailable");
    const imported: string[] = [];
    const provider = createJunctionProvider(async (input) => {
      const pathname = new URL(readUrl(input)).pathname;
      if (pathname === "/v2/user/providers/junction-user-1") {
        inventoryReads += 1;
        return createJsonResponse({ providers: [{
          id: "synthetic-garmin", slug: "garmin", status: "connected",
          resource_availability: { activity: true },
        }, {
          id: "synthetic-fitbit", slug: "fitbit", status: "connected",
          resource_availability: { activity: true },
        }] });
      }
      assert.equal(pathname, "/v2/summary/activity/junction-user-1");
      fetches += 1;
      if (fetches === 2 && scenario === "disconnected") {
        liveSource = createConnectionSource({ status: "disconnected" });
      }
      if (fetches === 2 && scenario === "new_epoch") {
        liveSource = createConnectionSource({ lifecycleEpoch: 2, status: "disconnected" });
      }
      return createJsonResponse({ data: [{
        id: "synthetic-admitted", connectionId: "synthetic-garmin", steps: 321,
      }, {
        id: "synthetic-alias-admitted", source: { provider_slug: "garmin" }, steps: 123,
      }, {
        id: "synthetic-alias-disconnected", connectionId: "synthetic-garmin",
        source: { provider_slug: "fitbit" }, steps: 456,
      }, {
        id: "synthetic-unknown-disconnected", connectionId: "synthetic-unknown", steps: 789,
      }, {
        id: "synthetic-disconnected", connectionId: "synthetic-fitbit", steps: 654,
      }] });
    }, { summaryResources: ["activity"], timeseriesResources: [] });
    const context = createJunctionJobContext({
      account: createAccount({ sources: [{ ...source, resourceCount: 1 }] }),
      connectionSourceAdmissionMode: "listed_only",
      listConnectionSources: scenario === "without_reader" ? undefined : async () => {
        sourceReads += 1;
        if (fetches === 2 && scenario === "unavailable") throw failure;
        return [liveSource, createConnectionSource({
          sourceInstanceKey: "synthetic-fitbit-source", sourceProviderSlug: "fitbit",
          status: "disconnected",
        })];
      },
      importSnapshot: async (snapshot) => {
        imported.push(JSON.stringify(snapshot));
        return { imported: true };
      },
    });
    const job = createJob("resource", {
      resource: "activity", resourceCategory: "summary",
      windowStart: "2026-04-02T00:00:00.000Z", windowEnd: "2026-04-03T00:00:00.000Z",
    });
    assert.ok(provider.jobExecutor);
    const pass = provider.jobExecutor.createPassExecutor?.() ?? provider.jobExecutor;
    await pass.executeJob(context, job);
    assert.equal(sourceReads, scenario === "without_reader" ? 0 : 1, "fresh projection and import use one current source read");
    assert.ok(imported[0]?.includes("synthetic-admitted"));
    assert.ok(imported[0]?.includes("synthetic-alias-admitted"));
    assert.ok(!imported[0]?.includes("synthetic-alias-disconnected"));
    assert.equal(imported[0]?.includes("synthetic-unknown-disconnected"), scenario === "without_reader");
    assert.ok(!imported[0]?.includes("synthetic-disconnected"));
    if (scenario === "unavailable") {
      await assert.rejects(pass.executeJob(context, job), (error) => error === failure);
      assert.equal(imported.length, 1);
    } else {
      await pass.executeJob(context, job);
      assert.equal(imported[1]?.includes("synthetic-admitted"), scenario === "connected" || scenario === "without_reader");
      assert.ok(!imported[1]?.includes("synthetic-disconnected"));
      assert.equal(imported[1]?.includes("synthetic-alias-admitted"), scenario === "connected" || scenario === "without_reader");
      assert.ok(!imported[1]?.includes("synthetic-alias-disconnected"));
      assert.equal(imported[1]?.includes("synthetic-unknown-disconnected"), scenario === "without_reader");
    }
    assert.equal(inventoryReads, 1, "provider inventory can be reused across the pass");
    assert.equal(sourceReads, scenario === "without_reader" ? 0 : 2, "source authority is read again after the next provider fetch");
  },
);

test("local summary import observes a disconnect projected by fresh inventory", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-source-admission");
  const stateDatabasePath = path.join(vaultRoot, "device-sync.sqlite");
  const store = new SqliteDeviceSyncStore(stateDatabasePath);
  const now = "2026-04-03T12:00:00.000Z";
  const requests: string[] = [];
  const imported: string[] = [];
  const service = createDeviceSyncService({
    secret: "synthetic-device-sync-secret",
    config: { vaultRoot, stateDatabasePath, publicBaseUrl: "https://sync.example.test" },
    clock: { now: () => new Date(now) },
    store,
    providers: [createJunctionProvider(async (input) => {
      const pathname = new URL(readUrl(input)).pathname;
      requests.push(pathname);
      if (pathname === "/v2/summary/activity/junction-user-1") {
        return createJsonResponse({ data: [
          { id: "synthetic-revoked-record", source: { provider: "garmin" }, steps: 321 },
          { id: "synthetic-connected-record", source: { provider: "whoop_v2" }, steps: 654 },
        ] });
      }
      assert.equal(pathname, "/v2/user/providers/junction-user-1");
      return createJsonResponse({ providers: [
        { id: "synthetic-garmin", slug: "garmin", status: "revoked" },
        { id: "synthetic-whoop", slug: "whoop_v2", status: "connected" },
      ] });
    }, { summaryResources: ["activity"], timeseriesResources: [] })],
    importer: {
      async importDeviceProviderSnapshot(input) {
        imported.push(JSON.stringify(input.snapshot));
        return { ok: true };
      },
    },
  });
  try {
    const account = store.upsertAccount({
      provider: "junction", externalAccountId: "junction-user-1", scopes: [],
      credential: { kind: "provider_config", providerConfigKey: "junction", credentialMetadata: {} },
      connectedAt: now, nextReconcileAt: null,
    });
    for (const slug of ["garmin", "whoop_v2"]) {
      store.upsertConnectionSource({
        connectionId: account.id, sourceInstanceKey: `synthetic-${slug}`,
        sourceProviderSlug: slug, status: "connected", firstSeenAt: now, lastSeenAt: now,
      });
    }
    const job = store.enqueueJob({
      accountId: account.id, provider: "junction", kind: "resource",
      availableAt: now, priority: 30, dedupeKey: "synthetic-summary-source-revocation",
      payload: {
        resource: "activity", resourceCategory: "summary",
        windowStart: "2026-04-02T00:00:00.000Z", windowEnd: "2026-04-03T00:00:00.000Z",
      },
    });
    await service.runWorkerOnce(account.id);
    assert.equal(store.getJobById(job.id)?.status, "succeeded");
    assert.deepEqual(requests, [
      "/v2/summary/activity/junction-user-1", "/v2/user/providers/junction-user-1",
    ]);
    const sources = store.listConnectionSources({ connectionId: account.id });
    assert.equal(sources.find((source) => source.sourceProviderSlug === "garmin")?.status, "disconnected");
    assert.equal(sources.find((source) => source.sourceProviderSlug === "whoop_v2")?.status, "connected");
    assert.equal(imported.length, 1);
    assert.ok(imported[0]?.includes("synthetic-connected-record"));
    assert.ok(!imported[0]?.includes("synthetic-revoked-record"));
  } finally {
    service.close();
    store.close();
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

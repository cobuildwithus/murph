import assert from "node:assert/strict";
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
import { createJsonResponse, readUrl } from "./helpers.ts";

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

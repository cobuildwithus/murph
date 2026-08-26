import {
  assertConnectBackfillRetryWake,
  assertJunctionWindowQuery,
  buildExpectedJunctionDedupeKey,
  createAccount,
  createConnectionSource,
  createEmptyJunctionBackfillProvider,
  createHistoricalActivityProvider,
  createHistoricalPullFetch,
  createJob,
  createJobFromInput,
  createJunctionJobContext,
  createJunctionProvider,
  createJunctionWorkoutStreamJobContext,
  createJunctionWorkoutStreamTestProvider,
  createStoredAccount,
  executeFullJobTimeseriesContinuations,
  executeJunctionFullJob,
  executeJunctionJob,
  resolveJunctionTarget,
} from "./junction-provider.harness.ts";

import assert from "node:assert/strict";
import {
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_KNOWN_TIMESERIES_RESOURCES,
} from "@murphai/importers/device-providers/junction-resources";
import {
  buildJunctionDailyTimeseriesAggregateResourceId,
  deriveJunctionCanonicalCoverageEvidence,
  normalizeJunctionSnapshot,
  type JunctionSnapshotInput,
} from "@murphai/importers/device-providers/junction";
import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_RESOURCE,
  COMPANION_HRV_RMSSD_SCHEMA,
  normalizeJunctionResourceName,
  resolveJunctionTimeseriesResourcePolicy,
  serializeCompanionHrvRmssdObservation,
} from "@murphai/contracts";
import { test, vi } from "vitest";
import {
  buildJunctionClientUserId,
  createJunctionDeviceSyncProvider,
} from "../src/providers/junction.ts";
import {
  buildJunctionProviderSourceInstanceKey,
  JUNCTION_CONNECT_SOURCE_TARGETS,
  JUNCTION_DEFAULT_PROVIDER_FILTER,
  JUNCTION_LINK_PROVIDER_SLUGS,
  normalizeJunctionProviderFilter,
  resolveJunctionConnectSourceLabel,
  resolveJunctionConnectTargetForSourceId,
} from "../src/config/junction-connect-sources.ts";
import {
  areJunctionDeviceConnectProviderSlugsEquivalent,
  resolveDeviceConnectSourceIdForJunctionProviderSlug,
} from "../src/config/connect-routes.ts";
import {
  isAllowedJunctionLinkHost,
  JUNCTION_DEFAULT_ALLOWED_LINK_HOSTS,
  JUNCTION_MAX_USER_PROVIDERS,
  JUNCTION_WORKOUT_STREAM_MAX_RESPONSE_BYTES,
  JunctionClient,
  parseJunctionHistoricalPullSnapshot,
} from "../src/providers/junction-client.ts";
import { createJsonResponse, makeTempDirectory, readUrl, requireValue } from "./helpers.ts";
import type {
  DeviceConnectionSourceRecord,
  DeviceSyncAccount,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  ProviderJobContext,
  StoredDeviceSyncAccount,
} from "../src/types.ts";

test("Junction provider keeps hourly fidelity catch-up narrow and daily correction broad", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: Object.fromEntries([
                ...JUNCTION_DEFAULT_SUMMARY_RESOURCES,
              ].map((resource) => [resource, true])),
            },
          ],
        });
      }

      const summaryResource = new URL(url).pathname.match(/^\/v2\/summary\/([^/]+)\//u)?.[1];
      if (summaryResource) {
        assert.ok(
          (JUNCTION_DEFAULT_SUMMARY_RESOURCES as readonly string[]).includes(summaryResource),
          `Unexpected default summary resource: ${summaryResource}`,
        );
        return createJsonResponse({
          data: summaryResource === "activity"
            ? [{ id: "activity-1", observedAt: "2026-04-02T12:00:00.000Z", steps: 1200 }]
            : [],
        });
      }

      const timeseriesResource = normalizeJunctionResourceName(
        new URL(url).pathname.match(
          /^\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u,
        )?.[1],
      );
      if (timeseriesResource) {
        assert.ok(
          (JUNCTION_DEFAULT_TIMESERIES_RESOURCES as readonly string[]).includes(timeseriesResource),
          `Unexpected default timeseries resource: ${timeseriesResource}`,
        );
        return createJsonResponse({ groups: {} });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        lastSyncCompletedAt: "2026-04-03T12:00:00.000Z",
      }),
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-03-27T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const summaryResources = requests
    .map((url) => new URL(url).pathname.match(/^\/v2\/summary\/([^/]+)\//u)?.[1])
    .filter((resource): resource is string => Boolean(resource));
  const timeseriesResources = requests
    .map((url) => normalizeJunctionResourceName(
      new URL(url).pathname.match(
        /^\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u,
      )?.[1],
    ))
    .filter((resource): resource is string => Boolean(resource));
  const profileRequest = requireValue(
    requests.find((url) => new URL(url).pathname.includes("/v2/summary/profile/")),
    "Junction default summary sync should fetch the profile current-state summary once.",
  );
  const profileSearchParams = new URL(profileRequest).searchParams;

  assert.equal(summaryResources.includes("profile"), true);
  assert.equal(summaryResources.includes("menstrual_cycle"), true);
  assert.equal(summaryResources.includes("electrocardiogram"), true);
  assert.equal(summaryResources.length, JUNCTION_DEFAULT_SUMMARY_RESOURCES.length);
  assert.deepEqual(new Set(summaryResources), new Set([...JUNCTION_DEFAULT_SUMMARY_RESOURCES]));
  assert.deepEqual(
    new Set(timeseriesResources),
    new Set([
      "blood_oxygen",
      "caffeine",
      "glucose",
      "mindfulness_minutes",
      "stress_level",
      "water",
    ]),
  );
  const narrowTimeseriesWindows = requests
    .filter((url) => url.includes("/v2/timeseries/"))
    .map((url) => {
      const parsed = new URL(url);
      return [parsed.searchParams.get("start_date"), parsed.searchParams.get("end_date")];
    });
  assert.equal(
    narrowTimeseriesWindows
      .filter(([start, end]) => start === end)
      .every(([start]) => start === "2026-04-02"),
    true,
  );
  assert.deepEqual(
    narrowTimeseriesWindows.filter(([start, end]) => start !== end),
    [
      ["2026-04-01T00:00:00.000Z", "2026-04-02T00:00:00.000Z"],
      ["2026-04-01T00:00:00.000Z", "2026-04-02T00:00:00.000Z"],
    ],
  );
  assert.equal(profileSearchParams.has("start_date"), false);
  assert.equal(profileSearchParams.has("end_date"), false);
  assert.equal(importedSnapshots.length, 3);

  requests.length = 0;
  importedSnapshots.length = 0;
  await executeJunctionFullJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        lastSyncCompletedAt: "2026-04-02T23:59:00.000Z",
      }),
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-03-27T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );
  const correctionSweepRequests = requests.filter((url) => url.includes("/v2/timeseries/"));
  assert.equal(
    correctionSweepRequests.length,
    JUNCTION_DEFAULT_TIMESERIES_RESOURCES.length * 7 + 14,
  );
  assert.deepEqual(
    new Set(correctionSweepRequests.map((url) =>
      normalizeJunctionResourceName(new URL(url).pathname.match(
        /^\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u,
      )?.[1])
    )),
    new Set(JUNCTION_DEFAULT_TIMESERIES_RESOURCES),
  );
  assert.equal(
    requests.filter((url) => url.includes("/v2/summary/workouts/")).length,
    1,
  );
});

test("Junction omitted timeseries config uses the code-owned defaults", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: Object.fromEntries([
                "activity",
                ...JUNCTION_KNOWN_TIMESERIES_RESOURCES,
                "heartrate",
                "steps",
                "distance",
                "calories_active",
                "weight",
              ].map((resource) => [resource, true])),
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
        return createJsonResponse({ data: [] });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/workouts/junction-user-1")) {
        return createJsonResponse({ data: [] });
      }

      const timeseriesResource = normalizeJunctionResourceName(
        new URL(url).pathname.match(/^\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u)?.[1],
      );
      if (timeseriesResource) {
        assert.ok(
          (JUNCTION_DEFAULT_TIMESERIES_RESOURCES as readonly string[]).includes(timeseriesResource),
          `Unexpected default timeseries resource: ${timeseriesResource}`,
        );
        return createJsonResponse({ groups: {} });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const context = createJunctionJobContext({
    account: createAccount({
      lastSyncCompletedAt: "2026-04-03T12:00:00.000Z",
    }),
    now: "2026-04-03T12:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });
  const initialResult = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );
  await executeFullJobTimeseriesContinuations({ context, initialResult, provider });

  const requestedTimeseriesResources = requests
    .map((url) => normalizeJunctionResourceName(
      new URL(url).pathname.match(/^\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u)?.[1],
    ))
    .filter((resource): resource is string => Boolean(resource));
  if (requests.some((url) =>
    new URL(url).pathname === "/v2/summary/workouts/junction-user-1"
  )) {
    requestedTimeseriesResources.push("workout_stream");
  }

  assert.deepEqual(
    [...new Set(requestedTimeseriesResources)].sort(),
    [...JUNCTION_DEFAULT_TIMESERIES_RESOURCES].sort(),
  );
  assert.equal(importedSnapshots.length, 2);
});

test("Junction programmatic timeseries overrides fetch exactly the requested resources", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    timeseriesResources: ["steps", "heart_rate"],
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              steps: true,
              heartrate: true,
            },
          }],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
        return createJsonResponse({ data: [] });
      }

      const timeseriesResource = new URL(url).pathname.match(
        /^\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u,
      )?.[1];
      if (timeseriesResource === "steps" || timeseriesResource === "heartrate") {
        return createJsonResponse({
          groups: {
            garmin: [{
              data: [{
                timestamp: "2026-04-02T12:00:00.000Z",
                unit: timeseriesResource === "steps" ? "count" : "bpm",
                value: timeseriesResource === "steps" ? 24 : 72,
              }],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const context = createJunctionJobContext({
    account: createAccount({
      lastSyncCompletedAt: "2026-04-03T12:00:00.000Z",
    }),
    now: "2026-04-03T12:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });
  let result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );
  while (result.scheduledJobs?.[0]) {
    const continuation = result.scheduledJobs[0];
    result = await executeJunctionJob(
      provider,
      context,
      createJob(continuation.kind, continuation.payload ?? {}),
    );
  }

  const requestedTimeseriesResources = requests
    .map((url) => new URL(url).pathname.match(
      /^\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u,
    )?.[1])
    .filter((resource): resource is string => Boolean(resource));

  assert.deepEqual([...new Set(requestedTimeseriesResources)].sort(), ["heartrate", "steps"]);
  const importedTimeseriesResources = importedSnapshots.flatMap((snapshot) =>
    Object.keys((snapshot as { timeseries?: Record<string, unknown[]> }).timeseries ?? {})
  );
  assert.equal(
    importedSnapshots.every((snapshot) =>
      Object.keys((snapshot as { timeseries?: Record<string, unknown[]> }).timeseries ?? {}).length === 1
    ),
    true,
  );
  assert.deepEqual([...new Set(importedTimeseriesResources)].sort(), ["heartrate", "steps"]);
});

test("Junction page-heavy timeseries adapt to a smaller complete window before the parent budget", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity", "profile"],
    timeseriesResources: ["heartrate"],
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);
      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-garmin-1",
            slug: "garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              heartrate: true,
              profile: true,
            },
          }],
        });
      }
      if (url.includes("/v2/summary/activity/") || url.includes("/v2/summary/profile/")) {
        return createJsonResponse({ data: [] });
      }
      if (url.includes("/v2/introspect/historical_pull")) {
        return createHistoricalPullFetch({
          garmin: {
            not_pulled: [],
            pulled: {
              activity: { days_with_data: 1, status: "success" },
            },
          },
        })(input);
      }
      if (url.includes("/v2/timeseries/junction-user-1/heartrate/grouped")) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        const searchParams = new URL(url).searchParams;
        const windowStart = searchParams.get("start_date");
        if (windowStart === "2026-04-02") {
          return createJsonResponse({
            groups: {},
            next_cursor: searchParams.get("next_cursor") === "page-3"
              ? "page-4"
              : searchParams.get("next_cursor") === "page-2"
                ? "page-3"
              : "page-2",
          });
        }
        const cursor = searchParams.get("next_cursor");
        if (cursor !== "hour-page-3") {
          return createJsonResponse({
            groups: {},
            next_cursor: cursor === "hour-page-2" ? "hour-page-3" : "hour-page-2",
          });
        }
        return createJsonResponse({
          groups: {
            garmin: [{
              data: [{
                timestamp: new Date(
                  Date.parse(windowStart ?? "") + 30 * 60_000,
                ).toISOString(),
                unit: "bpm",
                value: 72,
              }],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const context = createJunctionJobContext({
    account: createAccount({ connectedAt: "2026-04-03T00:00:00.000Z" }),
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });
  const initialResult = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );
  const dayContinuation = requireValue(
    initialResult.scheduledJobs?.[0],
    "The summary phase should schedule a timeseries continuation.",
  );

  requests.length = 0;
  const parent = new AbortController();
  const parentBudget = setTimeout(() => parent.abort(new Error("parent budget")), 2_000);
  const adaptiveResult = await executeJunctionJob(
    provider,
    { ...context, signal: parent.signal },
    createJobFromInput(dayContinuation),
  );
  clearTimeout(parentBudget);

  assert.equal(parent.signal.aborted, false);
  assert.equal(requests.length, 3);
  assert.equal(requests.every((url) => url.includes("/v2/timeseries/")), true);
  assert.equal(importedSnapshots.length, 0);
  const hourlyContinuation = requireValue(
    adaptiveResult.scheduledJobs?.[0],
    "A page-heavy feature day should retry as a complete hour.",
  );
  assert.deepEqual(hourlyContinuation.payload, {
    emptyBackfillAttempts: 1,
    timeseriesCursor: "2026-04-02T00:00:00.000Z",
    timeseriesResourceCursor: "heartrate",
    timeseriesWindowHours: 1,
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-02T00:00:00.000Z",
  });

  requests.length = 0;
  const hourlyResult = await executeJunctionJob(
    provider,
    context,
    createJobFromInput(hourlyContinuation),
  );
  assert.equal(requests.length, 6);
  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    (importedSnapshots[0] as { windowEnd?: unknown }).windowEnd,
    "2026-04-02T02:00:00.000Z",
  );
  assert.equal(
    (importedSnapshots[0] as { timeseries?: { heartrate?: unknown[] } })
      .timeseries?.heartrate?.length,
    2,
  );
  assert.deepEqual(hourlyResult.scheduledJobs?.[0]?.payload, {
    emptyBackfillAttempts: 1,
    timeseriesCursor: "2026-04-02T02:00:00.000Z",
    timeseriesResourceCursor: "heartrate",
    timeseriesWindowHours: 1,
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-02T00:00:00.000Z",
  });
});

test("Junction hourly coalescing does not import after hosted execution yields", async () => {
  const requestedWindows: Array<{ end: string | null; start: string | null }> = [];
  const importedSnapshots: unknown[] = [];
  const yielded = new Error("Synthetic hosted execution yield.");
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    const start = url.searchParams.get("start_date");
    const end = url.searchParams.get("end_date");
    requestedWindows.push({ end, start });
    return createJsonResponse({
      groups: {
        garmin: [{
          data: [{
            timestamp: new Date(Date.parse(start ?? "") + 30 * 60_000).toISOString(),
            unit: "bpm",
            value: 72,
          }],
          source: { provider: "garmin", type: "watch" },
        }],
      },
    });
  }, {
    summaryResources: [],
    timeseriesResources: ["heartrate"],
  });
  const context = createJunctionJobContext({
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    shouldYield: () => requestedWindows.length >= 1,
    throwIfAborted: () => {
      if (requestedWindows.length >= 1) {
        throw yielded;
      }
    },
  });

  await assert.rejects(
    executeJunctionJob(
      provider,
      context,
      createJob("reconcile", {
        timeseriesCursor: "2026-04-02T00:00:00.000Z",
        timeseriesResourceCursor: "heartrate",
        timeseriesWindowHours: 1,
        windowEnd: "2026-04-03T00:00:00.000Z",
        windowStart: "2026-04-02T00:00:00.000Z",
      }),
    ),
    (error: unknown) => error === yielded,
  );

  assert.deepEqual(requestedWindows, [{
    end: "2026-04-02T01:00:00.000Z",
    start: "2026-04-02T00:00:00.000Z",
  }]);
  assert.equal(importedSnapshots.length, 0);
});

test("Junction hourly coalescing retains a fetched prefix when the next hour fails", async () => {
  const requestedWindows: Array<{ end: string | null; start: string | null }> = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    const start = url.searchParams.get("start_date");
    const end = url.searchParams.get("end_date");
    requestedWindows.push({ end, start });
    if (start === "2026-04-02T01:00:00.000Z") {
      return createJsonResponse({ message: "Synthetic transient failure." }, 503);
    }
    return createJsonResponse({
      groups: {
        garmin: [{
          data: [{
            timestamp: new Date(Date.parse(start ?? "") + 30 * 60_000).toISOString(),
            unit: "bpm",
            value: 72,
          }],
          source: { provider: "garmin", type: "watch" },
        }],
      },
    });
  }, {
    summaryResources: [],
    timeseriesResources: ["heartrate"],
  });
  const context = createJunctionJobContext({
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      timeseriesCursor: "2026-04-02T00:00:00.000Z",
      timeseriesResourceCursor: "heartrate",
      timeseriesWindowHours: 1,
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requestedWindows[0], {
    end: "2026-04-02T01:00:00.000Z",
    start: "2026-04-02T00:00:00.000Z",
  });
  assert.ok(requestedWindows.length > 1);
  assert.equal(
    requestedWindows.slice(1).every(({ end, start }) =>
      start === "2026-04-02T01:00:00.000Z"
      && end === "2026-04-02T02:00:00.000Z"
    ),
    true,
  );
  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    (importedSnapshots[0] as { windowEnd?: unknown }).windowEnd,
    "2026-04-02T01:00:00.000Z",
  );
  assert.equal(
    result.scheduledJobs?.[0]?.payload?.timeseriesCursor,
    "2026-04-02T01:00:00.000Z",
  );
});

test("Junction hourly coalescing imports a completed prefix before consuming an optional next hour", async () => {
  const requestedWindows: Array<{ end: string | null; start: string | null }> = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    const start = url.searchParams.get("start_date");
    const end = url.searchParams.get("end_date");
    requestedWindows.push({ end, start });
    if (start === "2026-04-02T01:00:00.000Z") {
      return createJsonResponse({ error: "unsupported_resource" }, 422);
    }
    return createJsonResponse({
      groups: {
        garmin: [{
          data: [{
            timestamp: "2026-04-02T00:30:00.000Z",
            unit: "bpm",
            value: 72,
          }],
          source: { provider: "garmin", type: "watch" },
        }],
      },
    });
  }, {
    summaryResources: [],
    timeseriesResources: ["heartrate"],
  });
  const context = createJunctionJobContext({
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      timeseriesCursor: "2026-04-02T00:00:00.000Z",
      timeseriesResourceCursor: "heartrate",
      timeseriesWindowHours: 1,
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requestedWindows, [
    {
      end: "2026-04-02T01:00:00.000Z",
      start: "2026-04-02T00:00:00.000Z",
    },
    {
      end: "2026-04-02T02:00:00.000Z",
      start: "2026-04-02T01:00:00.000Z",
    },
  ]);
  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    (importedSnapshots[0] as { windowEnd?: unknown }).windowEnd,
    "2026-04-02T01:00:00.000Z",
  );
  assert.equal(
    result.scheduledJobs?.[0]?.payload?.timeseriesCursor,
    "2026-04-02T02:00:00.000Z",
  );
  assert.equal(
    result.metadataPatch?.junctionSkippedResourceLast,
    "timeseries.heartrate.422.unsupported",
  );
});

test("Junction hourly coalescing consumes only the optional first hour", async () => {
  const requestedWindows: Array<{ end: string | null; start: string | null }> = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    const start = url.searchParams.get("start_date");
    const end = url.searchParams.get("end_date");
    requestedWindows.push({ end, start });
    if (start === "2026-04-02T00:00:00.000Z") {
      return createJsonResponse({ error: "unsupported_resource" }, 422);
    }
    return createJsonResponse({
      groups: {
        garmin: [{
          data: [{
            timestamp: new Date(
              Date.parse(start ?? "") + 30 * 60_000,
            ).toISOString(),
            unit: "bpm",
            value: 72,
          }],
          source: { provider: "garmin", type: "watch" },
        }],
      },
    });
  }, {
    summaryResources: [],
    timeseriesResources: ["heartrate"],
  });
  const context = createJunctionJobContext({
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      timeseriesCursor: "2026-04-02T00:00:00.000Z",
      timeseriesResourceCursor: "heartrate",
      timeseriesWindowHours: 1,
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requestedWindows, [{
    end: "2026-04-02T01:00:00.000Z",
    start: "2026-04-02T00:00:00.000Z",
  }]);
  assert.equal(importedSnapshots.length, 0);
  assert.equal(
    result.scheduledJobs?.[0]?.payload?.timeseriesCursor,
    "2026-04-02T01:00:00.000Z",
  );

  const successor = result.scheduledJobs?.[0];
  assert.ok(successor);
  await executeJunctionJob(provider, context, createJobFromInput(successor));
  assert.equal(requestedWindows[1]?.start, "2026-04-02T01:00:00.000Z");
});

test("Junction deployed full-job progress resumes once and emits only scalar successors", async () => {
  const requestedResources: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    const resource = url.pathname.match(
      /^\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u,
    )?.[1];
    if (!resource) {
      throw new Error(`Unexpected request: ${url.toString()}`);
    }
    requestedResources.push(decodeURIComponent(resource));
    return createJsonResponse({ groups: {} });
  }, {
    summaryResources: [],
    timeseriesResources: ["steps", "heartrate", "workout_stream"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext(),
    createJob("reconcile", {
      timeseriesCursor: "2026-04-02T00:00:00.000Z",
      timeseriesResourceCursor: JSON.stringify({
        v: 1,
        a: "steps",
        // The deployed envelope validated completed resources against the
        // global registry, even if the current config later became narrower.
        i: ["distance"],
      }),
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requestedResources, ["steps"]);
  assert.equal(result.scheduledJobs?.[0]?.payload?.timeseriesResourceCursor, "heartrate");
});

test("Junction direct workout_stream unit completes a three-page workout index", async () => {
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => [],
    listResponse: (page) => createJsonResponse({
      data: [],
      ...(page < 3 ? { next_cursor: `page-${page + 1}` } : {}),
    }),
  });

  const result = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext(),
    createJob("reconcile", {
      timeseriesCursor: "2026-04-02T00:00:00.000Z",
      timeseriesResourceCursor: "workout_stream",
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );

  assert.equal(
    harness.requestUrls.filter((url) => url.includes("/v2/summary/workouts/")).length,
    3,
  );
  assert.equal(result.scheduledJobs?.length ?? 0, 0);
});

test("Junction cancellation retains the deterministic timeseries continuation", async () => {
  const requests: string[] = [];
  let cancelNextTimeseriesRequest = true;
  const provider = createJunctionProvider(async (input, init) => {
    const url = readUrl(input);
    requests.push(url);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          slug: "garmin",
          status: "connected",
          resource_availability: { activity: true, hrv: true },
        }],
      });
    }
    if (url.includes("/v2/summary/activity/")) {
      return createJsonResponse({ data: [] });
    }
    if (url.includes("/v2/timeseries/junction-user-1/hrv/grouped")) {
      if (cancelNextTimeseriesRequest) {
        cancelNextTimeseriesRequest = false;
        const signal = init?.signal;
        if (!signal) {
          throw new Error("Expected the parent cancellation signal.");
        }
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      return createJsonResponse({ groups: {} });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["hrv"],
  });
  const context = createJunctionJobContext();
  const initialResult = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );
  const continuation = requireValue(
    initialResult.scheduledJobs?.[0],
    "The setup phase should persist a deterministic timeseries continuation.",
  );

  const parent = new AbortController();
  const parentBudget = setTimeout(() => parent.abort(new Error("parent budget")), 10);
  await assert.rejects(
    executeJunctionJob(
      provider,
      { ...context, signal: parent.signal },
      createJobFromInput(continuation),
    ),
  );
  clearTimeout(parentBudget);

  const retryResult = await executeJunctionJob(
    provider,
    context,
    createJobFromInput(continuation, 1),
  );
  assert.deepEqual(retryResult.scheduledJobs?.[0]?.payload, {
    timeseriesCursor: "2026-04-02T00:00:00.000Z",
    timeseriesResourceCursor: "hrv",
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-01T00:00:00.000Z",
  });
  assert.equal(
    requests.filter((url) => url.includes("/v2/user/providers/")).length,
    1,
  );
  assert.equal(requests.filter((url) => url.includes("/v2/summary/")).length, 1);
});

test("Junction dense resource jobs import only complete closed UTC days", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    timeseriesResources: ["heartrate"],
    fetchImpl: async (input) => {
      const url = readUrl(input);
      requests.push(url);
      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers: [] });
      }
      if (url.includes("/v2/timeseries/junction-user-1/heartrate/grouped")) {
        const day = new URL(url).searchParams.get("start_date");
        return createJsonResponse({
          groups: {
            garmin: [{
              data: [{
                sessionEnd: "2026-04-23T01:00:00.000Z",
                sessionId: "cross-midnight-workout",
                sessionStart: "2026-04-22T23:00:00.000Z",
                timestamp: `${day}T00:30:00.000Z`,
                unit: "bpm",
                value: day === "2026-04-22" ? 90 : 110,
              }],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-24T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      resource: "heartrate",
      resourceCategory: "timeseries",
      windowStart: "2026-04-22T12:00:00.000Z",
      windowEnd: "2026-04-24T00:00:00.000Z",
    }),
  );

  assert.deepEqual(
    importedSnapshots.map((snapshot) => {
      const entry = snapshot as { windowEnd?: string; windowStart?: string };
      return [entry.windowStart, entry.windowEnd];
    }),
    [
      ["2026-04-22T00:00:00.000Z", "2026-04-23T00:00:00.000Z"],
      ["2026-04-23T00:00:00.000Z", "2026-04-24T00:00:00.000Z"],
    ],
  );
  assert.deepEqual(
    requests
      .filter((url) => url.includes("/v2/timeseries/"))
      .map((url) => {
        const search = new URL(url).searchParams;
        return [search.get("start_date"), search.get("end_date")];
      }),
    [["2026-04-22", "2026-04-22"], ["2026-04-23", "2026-04-23"]],
  );
  assert.equal(result.scheduledJobs?.length ?? 0, 0);
});

test("Junction daily opt-ins preserve floating days through fetch and import off UTC", async () => {
  const originalTimeZone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";

  try {
    assert.equal(
      new Date("2026-04-22T18:30:00").toISOString(),
      "2026-04-23T01:30:00.000Z",
    );
    const windows = {
      "2026-04-22": "2026-04-23",
      "2026-04-23": "2026-04-24",
    } as const;
    const providerRows = {
      steps: [
        { day: "2026-04-22", unit: "count", value: 10 },
        { timestamp: "2026-04-22T18:30:00", unit: "count", value: 20 },
        { timestamp: "2026-04-22T22:00:00Z", unit: "count", value: 30 },
        { timestamp: "2026-04-22T23:30:00-02:00", unit: "count", value: 40 },
        { day: "2026-04-23", unit: "count", value: 50 },
        { timestamp: "2026-04-23T18:30:00", unit: "count", value: 60 },
        { timestamp: "2026-04-23T22:00:00Z", unit: "count", value: 70 },
      ],
      distance: [
        { day: "2026-04-22", unit: "m", value: 1_000 },
        { timestamp: "2026-04-22T18:30:00", unit: "m", value: 2_000 },
        { timestamp: "2026-04-22T22:00:00Z", unit: "m", value: 3_000 },
        { timestamp: "2026-04-22T23:30:00-02:00", unit: "m", value: 4_000 },
        { day: "2026-04-23", unit: "m", value: 5_000 },
        { timestamp: "2026-04-23T18:30:00", unit: "m", value: 6_000 },
        { timestamp: "2026-04-23T22:00:00Z", unit: "m", value: 7_000 },
      ],
    } as const;

    const runInOrder = async (days: readonly (keyof typeof windows)[]) => {
      const requests: string[] = [];
      const normalizedEvents: NonNullable<ReturnType<typeof normalizeJunctionSnapshot>["events"]> = [];
      const provider = createJunctionDeviceSyncProvider({
        apiKey: "sk_us_test_123",
        clientUserIdSecret: "junction-client-user-id-secret",
        environment: "sandbox",
        region: "us",
        summaryResources: [],
        timeseriesResources: ["steps", "distance"],
        fetchImpl: async (input) => {
          const url = readUrl(input);
          requests.push(url);
          if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
            return createJsonResponse({
              providers: [{
                id: "provider-oura-1",
                slug: "oura",
                name: "Oura",
                status: "connected",
                resource_availability: { distance: true, steps: true },
              }],
            });
          }

          const resource = new URL(url).pathname.match(
            /^\/v2\/timeseries\/junction-user-1\/(steps|distance)\/grouped$/u,
          )?.[1] as keyof typeof providerRows | undefined;
          if (resource) {
            return createJsonResponse({
              groups: {
                oura: [{
                  data: providerRows[resource],
                  source: { provider: "oura", type: "ring" },
                }],
              },
            });
          }

          throw new Error(`Unexpected request: ${url}`);
        },
      });
      const context = createJunctionJobContext({
        now: "2026-04-24T12:00:00.000Z",
        importSnapshot: async (snapshot) => {
          const normalized = normalizeJunctionSnapshot(snapshot as JunctionSnapshotInput);
          normalizedEvents.push(...(normalized.events ?? []).filter((event) =>
            event.fields?.metric === "daily-steps"
            || event.fields?.metric === "distance-km"
          ));
          return { imported: true };
        },
      });

      for (const day of days) {
        for (const resource of ["steps", "distance"] as const) {
          await executeJunctionJob(
            provider,
            context,
            createJob("resource", {
              resource,
              resourceCategory: "timeseries",
              windowStart: `${day}T00:00:00.000Z`,
              windowEnd: `${windows[day]}T00:00:00.000Z`,
            }),
          );
        }
      }

      assert.deepEqual(
        requests
          .filter((url) => url.includes("/v2/timeseries/"))
          .map((url) => {
            const parsed = new URL(url);
            return [
              parsed.pathname.split("/").at(-2),
              parsed.searchParams.get("start_date"),
              parsed.searchParams.get("end_date"),
            ];
          }),
        days.flatMap((day) => [
          ["steps", day, day],
          ["distance", day, day],
        ]),
      );
      return normalizedEvents;
    };

    const forward = await runInOrder(["2026-04-22", "2026-04-23"]);
    const reverse = await runInOrder(["2026-04-23", "2026-04-22"]);
    const eventShape = (event: (typeof forward)[number]) => ({
      dayKey: event.dayKey,
      externalRef: event.externalRef,
      metric: event.fields?.metric,
      occurredAt: event.occurredAt,
      value: event.fields?.value,
    });
    const sortEvents = (events: typeof forward) => events
      .map(eventShape)
      .sort((left, right) => JSON.stringify(left.externalRef).localeCompare(JSON.stringify(right.externalRef)));
    const forwardEvents = sortEvents(forward);

    assert.deepEqual(forwardEvents, sortEvents(reverse));
    assert.equal(
      new Set(forwardEvents.map((event) => JSON.stringify(event.externalRef))).size,
      4,
    );
    assert.deepEqual(
      forwardEvents
        .map(({ dayKey, metric, occurredAt, value }) => ({ dayKey, metric, occurredAt, value }))
        .sort((left, right) => `${left.dayKey}:${left.metric}`.localeCompare(`${right.dayKey}:${right.metric}`)),
      [
        {
          dayKey: "2026-04-22",
          metric: "daily-steps",
          occurredAt: "2026-04-22T23:59:59.999Z",
          value: 60,
        },
        {
          dayKey: "2026-04-22",
          metric: "distance-km",
          occurredAt: "2026-04-22T23:59:59.999Z",
          value: 6,
        },
        {
          dayKey: "2026-04-23",
          metric: "daily-steps",
          occurredAt: "2026-04-23T23:59:59.999Z",
          value: 220,
        },
        {
          dayKey: "2026-04-23",
          metric: "distance-km",
          occurredAt: "2026-04-23T23:59:59.999Z",
          value: 22,
        },
      ],
    );
  } finally {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  }
});

test("Junction client_user_id is deterministic, bounded, and owner-blinded", () => {
  const clientUserId = buildJunctionClientUserId(
    "junction-client-user-id-secret",
    "owner-internal-id-123",
  );

  assert.equal(clientUserId.length, 32);
  assert.ok(clientUserId.startsWith("murph_"));
  assert.equal(clientUserId, "murph_jnqpm4zu2il556kgyffrxngz26");
  assert.doesNotMatch(clientUserId, /owner|internal|123/u);
  assert.equal(
    clientUserId,
    buildJunctionClientUserId("junction-client-user-id-secret", "owner-internal-id-123"),
  );

  const namespacedClientUserId = buildJunctionClientUserId(
    "junction-client-user-id-secret",
    "owner-internal-id-123",
    "e2e",
  );
  assert.equal(namespacedClientUserId.length, 32);
  assert.ok(namespacedClientUserId.startsWith("murph_e2e_"));
  assert.equal(namespacedClientUserId, "murph_e2e_jnqpm4zu2il556kgyffrxn");
  assert.doesNotMatch(namespacedClientUserId, /owner|internal|123/u);
  assert.notEqual(namespacedClientUserId, clientUserId);
  assert.throws(
    () => buildJunctionClientUserId(
      "junction-client-user-id-secret",
      "owner-internal-id-123",
      "Native-iOS",
    ),
    /JUNCTION_CLIENT_USER_ID_NAMESPACE/u,
  );
});

test("Junction provider exposes primitive handlers without OAuth compatibility methods", () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  assert.ok(provider.connectionHandler);
  assert.ok(provider.webhookHandler);
  assert.ok(provider.jobExecutor);
  assert.equal("buildConnectUrl" in provider, false);
  assert.equal("exchangeAuthorizationCode" in provider, false);
  assert.equal("refreshTokens" in provider, false);
});

test("Junction default provider filter covers hosted Link connect routes", () => {
  assert.deepEqual(
    JUNCTION_LINK_PROVIDER_SLUGS,
    JUNCTION_CONNECT_SOURCE_TARGETS
      .filter((target) => target.connectMode === "junction_link")
      .map((target) => target.providerSlug),
  );
  assert.deepEqual(JUNCTION_DEFAULT_PROVIDER_FILTER, normalizeJunctionProviderFilter(undefined));
  assert.deepEqual(normalizeJunctionProviderFilter(undefined), JUNCTION_DEFAULT_PROVIDER_FILTER);
  assert.equal(JUNCTION_DEFAULT_PROVIDER_FILTER.includes("map_my_fitness"), true);
  assert.equal(JUNCTION_DEFAULT_PROVIDER_FILTER.includes("dexcom_v3"), true);
  for (const providerSlug of [
    "samsung_health",
    "freestyle_libre_ble",
    "accuchek_ble",
    "contour_ble",
    "onetouch_ble",
    "apple_health_kit",
  ]) {
    assert.equal(JUNCTION_DEFAULT_PROVIDER_FILTER.includes(providerSlug), false);
  }

  assert.equal(resolveJunctionTarget("samsung_health")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("freestyle_libre_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("accuchek_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("contour_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("onetouch_ble")?.connectMode, "junction_sdk");
  assert.equal(resolveJunctionTarget("apple_health_kit")?.connectMode, "junction_sdk");

  assert.equal(resolveJunctionConnectTargetForSourceId("dexcom-g6-and-older"), "dexcom");
  assert.equal(resolveJunctionConnectTargetForSourceId("dexcom"), "dexcom_v3");
  assert.equal(resolveJunctionConnectTargetForSourceId("mapmyfitness"), "map_my_fitness");
  assert.equal(resolveJunctionConnectTargetForSourceId("accuchek"), "accuchek_ble");
  assert.equal(resolveJunctionConnectTargetForSourceId("onetouch"), "onetouch_ble");
  assert.equal(resolveJunctionConnectTargetForSourceId("apple-health"), "apple_health_kit");
  assert.equal(resolveJunctionConnectSourceLabel("accuchek_ble"), "Accu-Chek");
  for (const providerSlug of ["apple_health_kit", "apple_health", "apple-healthkit"]) {
    assert.equal(resolveDeviceConnectSourceIdForJunctionProviderSlug(providerSlug), "apple-health");
    assert.equal(resolveJunctionConnectSourceLabel(providerSlug), "Apple Health");
  }
  assert.equal(
    areJunctionDeviceConnectProviderSlugsEquivalent("apple-healthkit", "apple_health"),
    true,
  );
  assert.equal(
    areJunctionDeviceConnectProviderSlugsEquivalent("apple_health", "fitbit"),
    false,
  );
});

test("Junction empty historical backfill records progress and stores the retry wake in metadata", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createEmptyJunctionBackfillProvider();
  const context = createJunctionJobContext({
    now: "2026-04-04T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });

  const initialResult = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );
  const result = await executeFullJobTimeseriesContinuations({
    context,
    initialResult,
    provider,
  });

  assert.equal(importedSnapshots.length, 0);
  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");

  // Retry metadata owns the connect-window wake; the scheduler materializes the
  // exact-window job only when that wake is due.
  const executor = requireValue(provider.jobExecutor, "Junction provider should expose a job executor.");
  const retryingAccount = createStoredAccount({
    metadata: result.metadataPatch as Record<string, unknown>,
  });
  const beforeDue = executor.createScheduledJobs?.(retryingAccount, "2026-04-04T00:10:00.000Z");
  const delayedRetryJob = beforeDue?.jobs.find((job) => job.kind === "backfill");
  assert.equal(delayedRetryJob, undefined);
  assert.equal(beforeDue?.nextReconcileAt, "2026-04-04T00:15:00.000Z");

  const due = executor.createScheduledJobs?.(retryingAccount, "2026-04-04T00:15:00.000Z");
  const retryJob = due?.jobs.find((job) => job.kind === "backfill");
  assert.equal(retryJob?.availableAt, "2026-04-04T00:15:00.000Z");
  assert.equal(retryJob?.priority, 50);
  assert.deepEqual(retryJob?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(
    retryJob?.dedupeKey,
    buildExpectedJunctionDedupeKey(
      "backfill",
      "2026-04-01T00:00:00.000Z",
      "2026-04-03T00:00:00.000Z",
    ),
  );
  assert.equal(due?.nextReconcileAt, "2026-04-04T01:15:00.000Z");
});

test("Junction due historical backfill retry does not make ordinary reconcile own the retry wake", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                activity: true,
              },
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
        return createJsonResponse({ data: [] });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
    {
      reconcileIntervalMs: 60 * 60_000,
    },
  );
  const context = createJunctionJobContext({
    now: "2026-04-04T00:15:00.000Z",
    account: createAccount({
      connectedAt: "2026-04-03T00:00:00.000Z",
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
      nextReconcileAt: "2026-04-04T00:15:00.000Z",
    }),
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-04-02T00:15:00.000Z",
      windowEnd: "2026-04-04T00:15:00.000Z",
    }),
  );

  assert.equal(result.nextReconcileAt, "2026-04-04T01:15:00.000Z");
});

test("Junction materialized due historical backfill retry advances normal reconcile after completion", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                activity: true,
              },
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
        return createJsonResponse({
          data: [{ id: "activity-1", connectionId: "provider-garmin-1", steps: 1234 }],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
    {
      reconcileIntervalMs: 60 * 60_000,
    },
  );
  const context = createJunctionJobContext({
    now: "2026-04-04T00:15:00.000Z",
    account: createAccount({
      connectedAt: "2026-04-03T00:00:00.000Z",
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
      nextReconcileAt: "2026-04-04T00:15:00.000Z",
    }),
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_complete");
  assert.equal(result.nextReconcileAt, "2026-04-04T01:15:00.000Z");
});

test("Junction exact-window backfill preserves a pending metadata retry before it is due", async () => {
  const provider = createEmptyJunctionBackfillProvider({
    reconcileIntervalMs: 60 * 60_000,
  });
  const metadata = {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  };
  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:05:00.000Z",
      account: createAccount({
        connectedAt: "2026-04-03T00:00:00.000Z",
        metadata,
        nextReconcileAt: "2026-04-04T00:15:00.000Z",
      }),
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch, undefined);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
});

test("Junction retrying historical backfill without attempts uses the first retry delay", () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const executor = requireValue(provider.jobExecutor, "Junction provider should expose a job executor.");
  const retryingAccount = createStoredAccount({
    metadata: {
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    },
  });

  const beforeDue = executor.createScheduledJobs?.(retryingAccount, "2026-04-04T00:05:00.000Z");
  const delayedRetryJob = beforeDue?.jobs.find((job) => job.kind === "backfill");
  assert.equal(delayedRetryJob, undefined);
  assert.equal(beforeDue?.nextReconcileAt, "2026-04-04T00:15:00.000Z");

  const due = executor.createScheduledJobs?.(retryingAccount, "2026-04-04T00:16:00.000Z");
  const retryJob = due?.jobs.find((job) => job.kind === "backfill");
  assert.equal(retryJob?.availableAt, "2026-04-04T00:16:00.000Z");
  assert.deepEqual(retryJob?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(
    retryJob?.dedupeKey,
    buildExpectedJunctionDedupeKey(
      "backfill",
      "2026-04-01T00:00:00.000Z",
      "2026-04-03T00:00:00.000Z",
    ),
  );
  assert.equal(due?.nextReconcileAt, "2026-04-04T01:16:00.000Z");
});

test("Junction yieldable reconcile checkpoints one bounded normalization-safe summary unit per continuation", async () => {
  const requestsByPass: string[][] = [];
  const importedSnapshots: unknown[] = [];
  let activePass = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    (requestsByPass[activePass] ??= []).push(url);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: {
            activity: true,
            body: true,
            sleep: true,
            sleep_cycle: true,
          },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    const summaryResource = new URL(url).pathname.match(
      /^\/v2\/summary\/([^/]+)\//u,
    )?.[1];
    if (summaryResource) {
      return createJsonResponse({
        data: [{
          connectionId: "provider-garmin-1",
          id: `${summaryResource}-1`,
          observedAt: "2026-04-02T12:00:00.000Z",
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "sleep", "sleep_cycle", "body"],
    timeseriesResources: [],
  });
  const context = createJunctionJobContext({
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    shouldYield: () => false,
  });
  let job = createJob("reconcile", {
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-03-27T00:00:00.000Z",
  });
  const continuationPayloads: Array<Record<string, unknown>> = [];

  for (let pass = 0; pass < 4; pass += 1) {
    activePass = pass;
    const result = await executeJunctionJob(provider, context, job);
    const continuation = result.scheduledJobs?.find((candidate) =>
      candidate.kind === "reconcile"
      && (
        candidate.payload?.summaryResourceCursor !== undefined
        || candidate.payload?.summaryPhaseComplete === true
      )
    );
    if (!continuation) {
      assert.equal(pass, 3);
      break;
    }
    continuationPayloads.push(continuation.payload ?? {});
    job = createJobFromInput(continuation, pass);
  }

  assert.deepEqual(
    requestsByPass.map((requests) => requests
      .map((url) => new URL(url).pathname.match(/^\/v2\/summary\/([^/]+)\//u)?.[1])
      .filter((resource): resource is string => Boolean(resource))),
    [["activity"], ["sleep", "sleep_cycle"], ["body"], []],
  );
  assert.deepEqual(
    continuationPayloads.map((payload) => ({
      summaryPhaseComplete: payload.summaryPhaseComplete,
      summaryResourceCursor: payload.summaryResourceCursor,
    })),
    [
      { summaryPhaseComplete: undefined, summaryResourceCursor: "sleep" },
      { summaryPhaseComplete: undefined, summaryResourceCursor: "body" },
      { summaryPhaseComplete: true, summaryResourceCursor: undefined },
    ],
  );
  assert.equal(importedSnapshots.length, 4);
  assert.deepEqual(
    Object.keys((importedSnapshots[1] as { summaries: Record<string, unknown> }).summaries),
    ["sleep", "sleep_cycle"],
  );
});

test("Junction yieldable summary continuation fails within its inner provider-attempt bound", async () => {
  let summaryAttempts = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: { activity: true },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/")) {
      summaryAttempts += 1;
      return createJsonResponse({ error: "temporarily unavailable" }, 503);
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });
  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({ shouldYield: () => false }),
      createJob("reconcile", {
        windowEnd: "2026-04-03T00:00:00.000Z",
        windowStart: "2026-03-27T00:00:00.000Z",
      }),
    ),
    { code: "JUNCTION_API_REQUEST_FAILED" },
  );

  assert.equal(summaryAttempts, 1);
});

test("Junction yieldable reconcile times out provider inventory once before the hosted deadline", async () => {
  vi.useFakeTimers();
  let inventoryAttempts = 0;
  let summaryAttempts = 0;
  try {
    const provider = createJunctionProvider(async (input, init) => {
      const url = readUrl(input);
      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        inventoryAttempts += 1;
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("Expected the bounded inventory request to carry an abort signal."));
            return;
          }
          const rejectAborted = () => reject(signal.reason);
          if (signal.aborted) {
            rejectAborted();
            return;
          }
          signal.addEventListener("abort", rejectAborted, { once: true });
        });
      }
      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/")) {
        summaryAttempts += 1;
        return createJsonResponse({ data: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const execution = executeJunctionJob(
      provider,
      createJunctionJobContext({ shouldYield: () => false }),
      createJob("reconcile", {
        windowEnd: "2026-04-03T00:00:00.000Z",
        windowStart: "2026-03-27T00:00:00.000Z",
      }),
    );

    await vi.advanceTimersByTimeAsync(8_000);
    await assert.rejects(execution, { code: "JUNCTION_API_REQUEST_FAILED" });
    assert.equal(inventoryAttempts, 1);
    assert.equal(summaryAttempts, 0);
  } finally {
    vi.useRealTimers();
  }
});

test("Junction yieldable reconcile bounds maximum provider projection to fixed source reads", async () => {
  const providers = Array.from({ length: JUNCTION_MAX_USER_PROVIDERS + 1 }, (_, index) => ({
    id: `provider-${index}`,
    name: `Provider ${index}`,
    resource_availability: { activity: true },
    slug: `provider-${index % JUNCTION_MAX_USER_PROVIDERS}`,
    status: "connected",
  }));
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const baseContext = createJunctionJobContext({ shouldYield: () => false });
  let sourceReads = 0;
  let sourceUpserts = 0;
  const result = await executeJunctionJob(
    provider,
    {
      ...baseContext,
      async listConnectionSources() {
        sourceReads += 1;
        return [];
      },
      async upsertConnectionSource(input) {
        sourceUpserts += 1;
        return baseContext.upsertConnectionSource!(input);
      },
    },
    createJob("reconcile", {
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-03-27T00:00:00.000Z",
    }),
  );

  // One read projects the inventory and one fixed read admits the imported
  // summary; neither count grows with provider cardinality.
  assert.equal(sourceReads, 2);
  assert.equal(sourceUpserts, JUNCTION_MAX_USER_PROVIDERS);
  assert.equal(result.scheduledJobs?.[0]?.payload?.summaryPhaseComplete, true);
});

test("Junction rejects provider inventory above the projection bound before local source work", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: Array.from({ length: JUNCTION_MAX_USER_PROVIDERS + 1 }, (_, index) => ({
          id: `provider-${index}`,
          name: `Provider ${index}`,
          slug: `provider-${index}`,
          status: "connected",
        })),
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  let sourceReads = 0;
  let sourceUpserts = 0;

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({
        async listConnectionSources() {
          sourceReads += 1;
          return [];
        },
        async upsertConnectionSource(input) {
          sourceUpserts += 1;
          return createJunctionJobContext().upsertConnectionSource!(input);
        },
        shouldYield: () => false,
      }),
      createJob("reconcile", {
        windowEnd: "2026-04-03T00:00:00.000Z",
        windowStart: "2026-03-27T00:00:00.000Z",
      }),
    ),
    { code: "JUNCTION_USER_PROVIDER_LIMIT" },
  );
  assert.equal(sourceReads, 0);
  assert.equal(sourceUpserts, 0);
});

test("Junction non-connect backfill window uses bounded job retry without historical metadata", async () => {
  let activityRecords: unknown[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: Array.from({ length: JUNCTION_MAX_USER_PROVIDERS + 1 }, (_, index) => ({
          id: `provider-garmin-${index}`,
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          resource_availability: {
            activity: true,
            sleep: true,
          },
        })),
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: activityRecords });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "sleep"],
  });
  const context = createJunctionJobContext({
    now: "2026-04-04T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2025-01-01T12:34:56.000Z",
      windowEnd: "2026-04-05T08:09:10.000Z",
    }),
  );

  assert.equal(result.metadataPatch, undefined);
  assert.equal(result.nextReconcileAt, "2026-04-04T01:00:00.000Z");
  const retryJob = requireValue(
    result.scheduledJobs?.[0],
    "Empty non-connect Junction backfill should schedule a delayed exact-window retry.",
  );
  assert.equal(result.scheduledJobs?.length, 1);
  assert.equal(retryJob.availableAt, "2026-04-04T00:15:00.000Z");
  assert.equal(retryJob.kind, "backfill");
  assert.deepEqual(retryJob.payload, {
    windowStart: "2025-01-01T12:34:56.000Z",
    windowEnd: "2026-04-05T08:09:10.000Z",
    emptyBackfillAttempts: 1,
  });
  assert.equal(
    retryJob.dedupeKey,
    buildExpectedJunctionDedupeKey(
      "backfill",
      "2025-01-01T12:34:56.000Z",
      "2026-04-05T08:09:10.000Z",
    ),
  );
  assert.equal(importedSnapshots.length, 0);

  activityRecords = [{ id: "activity-event-retry-1", connectionId: "provider-garmin-1", steps: 1234 }];
  const retryResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:15:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob(retryJob.kind, retryJob.payload ?? {}),
  );

  assert.equal(retryResult.metadataPatch, undefined);
  assert.equal(retryResult.scheduledJobs, undefined);
  assert.equal(importedSnapshots.length, 1);
});

test("Junction useful daily history completes when an available sparse body resource is empty", async () => {
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              body: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", connectionId: "provider-garmin-1", steps: 1234 }] });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/body/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "body"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
  assert.equal(importedSnapshots.length, 1);
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/activity/")),
    "Junction historical backfill should fetch summary completion data.",
  );
  assertJunctionWindowQuery(
    summaryRequest,
    "2026-04-01T00:00:00.000Z",
    "2026-04-03T00:00:00.000Z",
  );
});

test("Junction connected sources with only sparse resources have no completion obligations", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              body: true,
              workouts: true,
            },
          },
        ],
      });
    }

    if (
      url.startsWith("https://api.sandbox.us.junction.com/v2/summary/body/junction-user-1")
      || url.startsWith("https://api.sandbox.us.junction.com/v2/summary/workouts/junction-user-1")
    ) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["body", "workouts"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext(),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
});

test("Junction partial activity history does not complete advertised sleep history", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              sleep: { status: "available" },
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ id: "activity-1", connectionId: "provider-garmin-1", steps: 1234 }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "sleep"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
});

test("Junction historical coverage does not let one source satisfy another source", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              body: { status: "unavailable" },
              sleep: { status: "available" },
            },
          },
          {
            id: "provider-fitbit-1",
            slug: "fitbit",
            name: "Fitbit",
            status: "connected",
            resource_availability: {
              sleep: "available",
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ id: "activity-1", connectionId: "provider-garmin-1", steps: 1234 }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")) {
      return createJsonResponse({
        data: [{ id: "sleep-fitbit-1", connectionId: "provider-fitbit-1", duration: 28_800 }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/body/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "sleep", "body"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_retrying");
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 1);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
});

test("Junction Apple Health success completes a 180-day Murph window even with zero days and a short provider range", async () => {
  const provider = createHistoricalActivityProvider(
    "apple_health",
    createHistoricalPullFetch({
      "apple-healthkit": {
        not_pulled: [],
        pulled: {
          activity: {
            days_with_data: 0,
            range_end: "2026-04-03T00:00:00.000Z",
            range_start: "2026-03-04T00:00:00.000Z",
            status: "success",
          },
        },
      },
    }),
    { summaryBackfillDays: 180 },
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext(),
    createJob("backfill", {
      windowStart: "2025-10-05T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2025-10-05T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
});

test("Junction Apple Health not_pulled resources create no historical obligation", async () => {
  const provider = createHistoricalActivityProvider(
    "apple_health_kit",
    createHistoricalPullFetch({
      apple_health_kit: {
        not_pulled: ["activity"],
        pulled: {},
      },
    }),
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext(),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_complete");
});

for (const testCase of [
  { label: "scheduled", notPulled: [] as string[], status: "scheduled" },
  { label: "in progress", notPulled: [] as string[], status: "in_progress" },
  {
    label: "retrying even when malformed not_pulled contradicts it",
    notPulled: ["activity"],
    status: "retrying",
  },
  { label: "unknown future", notPulled: [] as string[], status: "paused_by_provider" },
] as const) {
  test(`Junction Garmin ${testCase.label} historical status stays on the saturated retry without a reset marker`, async () => {
    const provider = createHistoricalActivityProvider(
      "garmin",
      createHistoricalPullFetch({
        garmin: {
          not_pulled: testCase.notPulled,
          pulled: {
            activity: {
              days_with_data: 0,
              status: testCase.status,
            },
          },
        },
      }),
    );
    const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({
          metadata: {
            junctionHistoricalBackfillStatus: "coverage_v3_retrying",
            junctionHistoricalBackfillEmptyAttempts: 4,
            junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
            junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
            junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
          },
        }),
        upsertConnectionSource: (input) => {
          upserts.push(input);
          return createConnectionSource(input);
        },
      }),
      createJob("backfill", {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_retrying");
    assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 4);
    assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
    assert.equal(
      upserts.some((source) => source.lastErrorCode === "HISTORICAL_DATA_RECONNECT_REQUIRED"),
      false,
    );
  });
}

test("Junction Oura historical failure stays retrying and never asks for a shared reset", async () => {
  const provider = createHistoricalActivityProvider(
    "oura",
    createHistoricalPullFetch({
      oura: {
        not_pulled: [],
        pulled: {
          activity: {
            days_with_data: 0,
            error_details: "Historical pull failed.",
            status: "failure",
          },
        },
      },
    }),
  );
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_retrying",
          junctionHistoricalBackfillEmptyAttempts: 4,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_retrying");
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 4);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
  assert.equal(
    upserts.some((source) => source.lastErrorCode === "HISTORICAL_DATA_RECONNECT_REQUIRED"),
    false,
  );
});

test("Junction introspection failure falls back to canonical summaries without failing import", async () => {
  const importedSnapshots: unknown[] = [];
  const warnings: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-oura-1",
          name: "Oura",
          resource_availability: { activity: true },
          slug: "oura",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{
          connectionId: "provider-oura-1",
          date: "2026-04-02",
          id: "oura-activity-1",
          steps: 4321,
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {}, async () => createJsonResponse({ error: "unavailable" }, 400));

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {
        warn: (message) => warnings.push(message),
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_complete");
  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(warnings, [
    "Junction historical-pull introspection was unavailable; using canonical import evidence.",
  ]);
});

test("Junction backfill diagnostic reports redacted provider call counts", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: Array.from({ length: JUNCTION_MAX_USER_PROVIDERS + 1 }, (_, index) => ({
          id: `provider-garmin-${index}`,
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          resource_availability: {
            activity: true,
            heartrate: true,
            sleep: { status: "unavailable" },
          },
        })),
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{
          id: "summary-activity-1",
          provider_connection_id: "provider-garmin-1",
          sourceProviderSlug: "garmin",
          steps: 1234,
          date: "2026-04-02",
        }],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              timestamp: "2026-04-02T12:00:00.000Z",
              value: 97,
            }],
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  assert.ok(provider.diagnostics?.diagnoseBackfill);

  const result = await provider.diagnostics.diagnoseBackfill({
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    timeseriesProbeDays: 2,
    windowStart: "2026-04-02T10:15:30.000Z",
    windowEnd: "2026-04-03T11:45:00.000Z",
  });
  const diagnostic = result.result;
  const summary = diagnostic.summary as {
    hasUsefulHistoricalRecords?: boolean;
    resources?: Array<{ recordCount?: number; resource?: string }>;
  };
  const timeseriesProbe = diagnostic.timeseriesProbe as {
    resources?: Array<{ recordCount?: number; resource?: string }>;
  };
  const sourceProviders = diagnostic.sourceProviders as {
    sources?: Array<{ resourceCount?: number; resources?: string[]; sourceKey?: string }>;
  };

  assert.equal(summary.hasUsefulHistoricalRecords, true);
  assert.deepEqual(summary.resources?.map((entry) => [entry.resource, entry.recordCount]), [
    ["activity", 1],
  ]);
  assert.deepEqual(timeseriesProbe.resources?.map((entry) => [entry.resource, entry.recordCount]), [
    ["blood_oxygen", 1],
  ]);
  assert.deepEqual(sourceProviders.sources, [{
    resourceCount: 2,
    resources: ["activity", "heartrate"],
    sourceKey: "source_1",
  }]);
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/activity/")),
    "Junction backfill diagnostic should inspect summary data.",
  );
  assertJunctionWindowQuery(
    summaryRequest,
    "2026-04-02T10:15:30.000Z",
    "2026-04-03T11:45:00.000Z",
  );
  const timeseriesRequest = requireValue(
    requests.find((url) => url.includes("/v2/timeseries/")),
    "Junction backfill diagnostic should inspect timeseries probe data.",
  );
  assertJunctionWindowQuery(
    timeseriesRequest,
    "2026-04-02T10:15:30.000Z",
    "2026-04-03T11:45:00.000Z",
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /junction-user-1|provider-garmin-1|summary-activity-1|garmin|Garmin/u,
  );
});

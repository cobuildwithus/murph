import {
  createAccount,
  createJob,
  createJobFromInput,
  createJunctionJobContext,
  createJunctionProvider,
  createJunctionSvixWebhook,
  createJunctionWorkoutStreamJobContext,
  createJunctionWorkoutStreamProviderConnection,
  createJunctionWorkoutStreamResourceJob,
  createJunctionWorkoutStreamSource,
  createJunctionWorkoutStreamTestProvider,
  createJunctionWorkoutSummary,
  executeJunctionJob,
  junctionWorkoutCandidateIdentity,
  readJunctionWorkoutProgressIdentities,
  readScheduledWorkoutStreamContinuation,
  requireJunctionWebhookHandler,
} from "./junction-provider.harness.ts";

import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import {
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_KNOWN_TIMESERIES_RESOURCES,
} from "@murphai/importers/device-providers/junction-resources";
import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_RESOURCE,
  COMPANION_HRV_RMSSD_SCHEMA,
  normalizeJunctionResourceName,
  resolveJunctionTimeseriesResourcePolicy,
  serializeCompanionHrvRmssdObservation,
} from "@murphai/contracts";
import { test, vi } from "vitest";
import { JUNCTION_PRODUCTION_TIMESERIES_RESOURCES } from "../src/config/junction-config.ts";
import { DeviceSyncError } from "../src/errors.ts";
import { JunctionTimeseriesProgressError } from "../src/junction-timeseries-progress.ts";
import {
  DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
} from "../src/public-account.ts";
import { createJsonResponse, makeTempDirectory, readUrl, requireValue } from "./helpers.ts";

test("Junction workout_stream diagnostics use one bounded index read and serial dedicated stream reads", async () => {
  const requests: string[] = [];
  let activeStreams = 0;
  let maximumActiveStreams = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    const parsed = new URL(url);

    if (parsed.pathname === "/v2/summary/workouts/junction-user-1") {
      return createJsonResponse({
        data: Array.from({ length: 32 }, (_, index) => ({
          id: `workout-${index}`,
          source: { provider: "garmin", type: "watch", device_id: "watch-1" },
          start: `2026-04-02T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
          end: `2026-04-02T${String(index % 24).padStart(2, "0")}:30:00.000Z`,
          sport: "run",
        })),
      });
    }
    if (/^\/v2\/timeseries\/workouts\/workout-\d+\/stream$/u.test(parsed.pathname)) {
      activeStreams += 1;
      maximumActiveStreams = Math.max(maximumActiveStreams, activeStreams);
      await Promise.resolve();
      activeStreams -= 1;
      return createJsonResponse({
        time: [1_775_131_200, 1_775_133_000],
        heartrate: [100, 160],
        distance: [0, 5_000],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: [],
    timeseriesResources: ["workout_stream"],
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "timeseries",
    now: "2026-04-03T12:00:00.000Z",
    resource: "workout_stream",
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  const diagnostic = result.result as {
    request?: { endpointKind?: string };
    response?: { ok?: boolean; recordCount?: number };
  };

  assert.equal(diagnostic.request?.endpointKind, "junction_workout_stream");
  assert.equal(diagnostic.response?.ok, true);
  assert.equal(diagnostic.response?.recordCount, 32);
  assert.equal(requests.filter((url) => url.includes("/v2/summary/workouts/")).length, 1);
  assert.equal(requests.filter((url) => url.includes("/v2/timeseries/workouts/")).length, 32);
  assert.equal(requests.some((url) => url.includes("/workout_stream/grouped")), false);
  assert.equal(maximumActiveStreams, 1);
});

test("Junction workout_stream completes without workout egress when no connected source is live capable", async () => {
  const harness = createJunctionWorkoutStreamTestProvider({
    listProviders: () => [
      createJunctionWorkoutStreamProviderConnection("garmin", false),
      createJunctionWorkoutStreamProviderConnection("polar", true),
    ],
    listWorkoutIds: () => ["unsupported-workout"],
  });

  const result = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({
      listConnectionSources: async () => [
        createJunctionWorkoutStreamSource("garmin", true),
        {
          ...createJunctionWorkoutStreamSource("polar", true),
          status: "disconnected",
        },
      ],
    }),
    createJunctionWorkoutStreamResourceJob(),
  );

  assert.equal(
    harness.requestUrls.some((url) => url.includes("/v2/summary/workouts/")),
    false,
  );
  assert.deepEqual(harness.streamRequests, []);
  assert.equal(result.scheduledJobs?.some((job) => job.kind === "resource") ?? false, false);
});

test("Junction workout_stream makes no workout egress when live provider inventory is disconnected", async () => {
  const harness = createJunctionWorkoutStreamTestProvider({
    listProviders: () => [{
      ...createJunctionWorkoutStreamProviderConnection("garmin", true),
      status: "disconnected",
    }],
    listWorkoutIds: () => ["disconnected-live-provider-workout"],
  });

  await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({
      listConnectionSources: async () => [createJunctionWorkoutStreamSource("garmin", true)],
    }),
    createJunctionWorkoutStreamResourceJob(),
  );

  assert.equal(
    harness.requestUrls.some((url) => url.includes("/v2/summary/workouts/")),
    false,
  );
  assert.deepEqual(harness.streamRequests, []);
});

test("Junction workout_stream makes no workout egress through a disconnect fence", async () => {
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["fenced-workout"],
  });

  await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({
      listConnectionSources: async () => [{
        ...createJunctionWorkoutStreamSource("garmin", true),
        lastErrorCode: DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      }],
    }),
    createJunctionWorkoutStreamResourceJob(),
  );

  assert.equal(
    harness.requestUrls.some((url) => url.includes("/v2/summary/workouts/")),
    false,
  );
  assert.deepEqual(harness.streamRequests, []);
});

test.each([
  { label: "incapable", sourceProviderSlug: "polar" },
  { label: "unknown", sourceProviderSlug: "unknown-source" },
])("Junction workout_stream makes no provider egress for an $label source scope", async ({
  sourceProviderSlug,
}) => {
  const harness = createJunctionWorkoutStreamTestProvider({
    listProviders: () => [
      createJunctionWorkoutStreamProviderConnection("garmin", true),
      createJunctionWorkoutStreamProviderConnection("polar", false),
    ],
    listWorkoutIds: () => ["scoped-workout"],
  });
  const sources = [
    createJunctionWorkoutStreamSource("garmin", true),
    createJunctionWorkoutStreamSource("polar", true),
  ];

  await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({
      listConnectionSources: async () => sources,
    }),
    createJunctionWorkoutStreamResourceJob({ sourceProviderSlug }),
  );

  assert.equal(
    harness.requestUrls.some((url) => url.includes("/v2/summary/workouts/")),
    false,
  );
  assert.deepEqual(harness.streamRequests, []);
});

test("Junction workout_stream filters mixed-source candidates before stream progress", async () => {
  const importedWorkoutIds: string[] = [];
  const harness = createJunctionWorkoutStreamTestProvider({
    listProviders: () => [
      createJunctionWorkoutStreamProviderConnection("garmin", true),
      createJunctionWorkoutStreamProviderConnection("polar", false),
    ],
    listWorkoutIds: () => [],
    listWorkoutSummaries: () => [
      createJunctionWorkoutSummary("garmin-workout", undefined, "garmin"),
      createJunctionWorkoutSummary("polar-workout", undefined, "polar"),
      {
        ...createJunctionWorkoutSummary("unknown-source-workout"),
        sourceProviderSlug: undefined,
      },
    ],
  });

  await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({
      importSnapshot: async (snapshot: { timeseries?: Record<string, unknown[]> }) => {
        const feature = snapshot.timeseries?.workout_stream?.[0] as
          | Record<string, unknown>
          | undefined;
        importedWorkoutIds.push(String(feature?.workoutId));
        return { imported: true };
      },
      listConnectionSources: async () => [
        createJunctionWorkoutStreamSource("garmin", true),
        createJunctionWorkoutStreamSource("polar", true),
      ],
    }),
    createJunctionWorkoutStreamResourceJob(),
  );

  assert.deepEqual(harness.streamRequests, ["garmin-workout"]);
  assert.deepEqual(importedWorkoutIds, ["garmin-workout"]);
});

test("Junction workout_stream applies the workout cap after source eligibility", async () => {
  const importedWorkoutIds: string[] = [];
  const eligibleWorkoutId = "eligible-after-ineligible-index";
  const harness = createJunctionWorkoutStreamTestProvider({
    listProviders: () => [
      createJunctionWorkoutStreamProviderConnection("garmin", true),
      createJunctionWorkoutStreamProviderConnection("polar", false),
    ],
    listWorkoutIds: () => [],
    listWorkoutSummaries: () => [
      ...Array.from({ length: 33 }, (_, index) =>
        createJunctionWorkoutSummary(`ineligible-${index}`, undefined, "polar")
      ),
      createJunctionWorkoutSummary(eligibleWorkoutId, undefined, "garmin"),
    ],
  });
  const context = createJunctionWorkoutStreamJobContext({
    importSnapshot: async (snapshot: { timeseries?: Record<string, unknown[]> }) => {
      const feature = snapshot.timeseries?.workout_stream?.[0] as
        | Record<string, unknown>
        | undefined;
      if (feature) {
        importedWorkoutIds.push(String(feature.workoutId));
      }
      return { imported: true };
    },
    listConnectionSources: async () => [
      createJunctionWorkoutStreamSource("garmin", true),
      createJunctionWorkoutStreamSource("polar", true),
    ],
  });

  const initial = await executeJunctionJob(
    harness.provider,
    context,
    createJob("reconcile", {
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );
  const continuation = requireValue(
    initial.scheduledJobs?.[0],
    "The setup pass should schedule workout_stream directly.",
  );

  await executeJunctionJob(
    harness.provider,
    context,
    createJobFromInput(continuation),
  );

  assert.equal(
    harness.requestUrls.filter((url) =>
      new URL(url).pathname === "/v2/summary/workouts/junction-user-1"
    ).length,
    2,
  );
  assert.deepEqual(harness.streamRequests, [eligibleWorkoutId]);
  assert.deepEqual(importedWorkoutIds, [eligibleWorkoutId]);
});

test.each([{
  label: "uses live capability before Web projection catches up",
  source: {
    ...createJunctionWorkoutStreamSource("garmin", false),
    resourceAvailabilitySummary: {},
  },
  workoutId: "current-capability-workout",
}, {
  label: "keeps current detail active during historical reconnect recovery",
  source: {
    ...createJunctionWorkoutStreamSource("garmin", true),
    status: "error" as const,
    lastErrorCode: DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
    lastErrorMessage: "Historical export requires a member-confirmed reset.",
  },
  workoutId: "historical-reconnect-current-workout",
}])("Junction full-job workout_stream $label", async ({ source, workoutId }) => {
  const harness = createJunctionWorkoutStreamTestProvider({
    listProviders: () => [
      createJunctionWorkoutStreamProviderConnection("garmin", true),
    ],
    listWorkoutIds: () => [workoutId],
  });
  const context = createJunctionWorkoutStreamJobContext({
    listConnectionSources: async () => [source],
  });

  const initial = await executeJunctionJob(
    harness.provider,
    context,
    createJob("reconcile", {
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );
  const continuation = requireValue(
    initial.scheduledJobs?.[0],
    "The setup pass should schedule workout_stream directly.",
  );
  assert.equal(continuation.payload?.timeseriesResourceCursor, "workout_stream");

  await executeJunctionJob(
    harness.provider,
    context,
    createJobFromInput(continuation),
  );

  assert.equal(
    harness.requestUrls.filter((url) =>
      new URL(url).pathname === "/v2/user/providers/junction-user-1"
    ).length,
    2,
  );
  assert.deepEqual(harness.streamRequests, [workoutId]);
});

test("Junction full-job workout_stream bounds provider inventory", async () => {
  let inventoryRequests = 0;
  const continuationRequestUrls: string[] = [];
  const provider = createJunctionProvider(async (request) => {
    const url = new URL(readUrl(request));
    continuationRequestUrls.push(url.toString());
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      inventoryRequests += 1;
      return new Response(JSON.stringify({ code: "unavailable" }), {
        status: 503,
        headers: {
          "content-type": "application/json",
          "retry-after": "0",
        },
      });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    if (url.pathname === "/v2/summary/workouts/junction-user-1") {
      return createJsonResponse({
        data: [createJunctionWorkoutSummary("workout-after-inventory-retry")],
      });
    }
    if (url.pathname.startsWith("/v2/summary/")) {
      return createJsonResponse({ data: [] });
    }
    if (url.pathname.startsWith("/v2/timeseries/workouts/")) {
      return createJsonResponse({
        time: [1_775_131_200],
        heartrate: [120],
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: [],
    timeseriesResources: ["workout_stream"],
  });
  const context = createJunctionWorkoutStreamJobContext({
    shouldYield: () => false,
  });

  await assert.rejects(
    () => executeJunctionJob(
      provider,
      context,
      createJob("reconcile", {
        timeseriesCursor: "2026-04-02T00:00:00.000Z",
        timeseriesResourceCursor: "workout_stream",
        windowEnd: "2026-04-03T00:00:00.000Z",
        windowStart: "2026-04-02T00:00:00.000Z",
      }),
    ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.equal(error.retryable, true);
      return true;
    },
  );

  assert.equal(inventoryRequests, 1);
  assert.equal(
    continuationRequestUrls.some((url) => url.includes("/v2/summary/workouts/")),
    false,
  );
  assert.equal(
    continuationRequestUrls.some((url) => url.includes("/v2/timeseries/workouts/")),
    false,
  );
});

test("Junction workout_stream fails closed without a source-capability projection", async () => {
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["unattributed-workout"],
  });

  await executeJunctionJob(
    harness.provider,
    createJunctionJobContext({ listConnectionSources: undefined }),
    createJunctionWorkoutStreamResourceJob(),
  );

  assert.equal(
    harness.requestUrls.some((url) => url.includes("/v2/summary/workouts/")),
    false,
  );
  assert.deepEqual(harness.streamRequests, []);
});

test("Junction workout_stream skips only an exact clear-unsupported HTTP 400 candidate", async () => {
  const importedWorkoutIds: string[] = [];
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["unsupported-workout", "supported-workout"],
    streamResponse: (workoutId) => workoutId === "unsupported-workout"
      ? createJsonResponse({ error: "unsupported_resource" }, 400)
      : createJsonResponse({
          time: [1_775_131_200],
          heartrate: [120],
        }),
  });

  const result = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({
      importSnapshot: async (snapshot: { timeseries?: Record<string, unknown[]> }) => {
        const feature = snapshot.timeseries?.workout_stream?.[0] as
          | Record<string, unknown>
          | undefined;
        importedWorkoutIds.push(String(feature?.workoutId));
        return { imported: true };
      },
    }),
    createJunctionWorkoutStreamResourceJob(),
  );

  assert.deepEqual([...harness.streamRequests].sort(), [
    "supported-workout",
    "unsupported-workout",
  ]);
  assert.deepEqual(importedWorkoutIds, ["supported-workout"]);
  assert.equal(result.metadataPatch?.junctionSkippedTimeseriesTotal, 1);
});

test.each([
  {
    body: { error: "invalid_request" },
    label: "unknown",
  },
  {
    body: {
      error: "unsupported_resource",
      message: "Invalid request parameters.",
    },
    label: "request-shape",
  },
])("Junction workout_stream keeps a $label HTTP 400 terminal", async ({ body }) => {
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["failed-workout"],
    streamResponse: () => createJsonResponse(body, 400),
  });

  await assert.rejects(
    () => executeJunctionJob(
      harness.provider,
      createJunctionWorkoutStreamJobContext(),
      createJunctionWorkoutStreamResourceJob(),
    ),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.equal(error.retryable, false);
      assert.equal(error.details?.status, 400);
      return true;
    },
  );
  assert.deepEqual(harness.streamRequests, ["failed-workout"]);
});

test("Junction workout_stream skips empty or malformed streams without blocking valid workouts", async () => {
  const importedSnapshots: unknown[] = [];
  const warningCodes: string[] = [];
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-1", "workout-2", "workout-3"],
    streamResponse: (workoutId) => createJsonResponse(
      workoutId === "workout-1"
        ? {
            time: [],
          }
        : workoutId === "workout-2"
          ? {
              time: [1_775_131_200, 1_775_133_000],
              heartrate: [105],
              distance: [0, 5_100],
            }
          : {
              time: [1_775_131_200, 1_775_133_000],
              heartrate: [105, 165],
              distance: [0, 5_100],
            },
    ),
  });

  const initial = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {
        warn: (_message, metadata) => {
          if (typeof metadata?.errorCode === "string") warningCodes.push(metadata.errorCode);
        },
      },
    }),
    createJunctionWorkoutStreamResourceJob(),
  );
  assert.equal(
    initial.scheduledJobs?.filter((job) =>
      job.payload?.workoutStreamEmptyReplay === true
    ).length,
    1,
  );

  assert.deepEqual(harness.streamRequests, ["workout-1", "workout-2", "workout-3"]);
  const workoutIds = importedSnapshots.flatMap((snapshot) => {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
    const timeseries = Reflect.get(snapshot, "timeseries");
    if (!timeseries || typeof timeseries !== "object" || Array.isArray(timeseries)) return [];
    const features = Reflect.get(timeseries, "workout_stream");
    if (!Array.isArray(features)) return [];
    return features.map((feature) => {
      assert.ok(feature && typeof feature === "object" && !Array.isArray(feature));
      const workoutId = Reflect.get(feature, "workoutId");
      assert.equal(typeof workoutId, "string");
      return workoutId;
    });
  });
  assert.deepEqual(workoutIds, ["workout-3"]);
  assert.deepEqual(warningCodes, [
    "JUNCTION_WORKOUT_STREAM_EMPTY",
    "JUNCTION_WORKOUT_STREAM_CARDINALITY_MISMATCH",
  ]);
});

test.each([
  {
    jobKind: "backfill" as const,
    label: "ten-day-old backfill day",
    timeseriesCursor: "2026-04-05T00:00:00.000Z",
    windowStart: "2026-04-01T00:00:00.000Z",
  },
  {
    jobKind: "reconcile" as const,
    label: "oldest rolling reconcile day",
    timeseriesCursor: "2026-04-08T00:00:00.000Z",
    windowStart: "2026-04-08T00:00:00.000Z",
  },
])("Junction workout_stream replays an empty $label after it leaves the normal horizon", async ({
  jobKind,
  timeseriesCursor,
  windowStart,
}) => {
  const importedSnapshots: unknown[] = [];
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-1"],
    streamResponse: (_workoutId, streamRequest) => createJsonResponse(
      streamRequest === 1
        ? { time: [] }
        : {
            time: [1_775_131_200, 1_775_133_000],
            heartrate: [100, 160],
            distance: [0, 5_000],
          },
    ),
  });
  const importSnapshot = async (snapshot: unknown) => {
    importedSnapshots.push(snapshot);
    return { imported: true };
  };
  const context = createJunctionWorkoutStreamJobContext({
    now: "2026-04-15T12:00:00.000Z",
    importSnapshot,
  });

  const initial = await executeJunctionJob(
    harness.provider,
    context,
    createJob(jobKind, {
      timeseriesCursor,
      timeseriesResourceCursor: "workout_stream",
      windowEnd: "2026-04-15T00:00:00.000Z",
      windowStart,
    }),
  );
  assert.equal(importedSnapshots.length, 0);
  const replay = requireValue(
    initial.scheduledJobs?.find((job) => job.payload?.workoutStreamEmptyReplay === true),
    "empty workout should schedule one bounded exact-day replay",
  );
  assert.equal(replay.kind, "resource");
  assert.equal(replay.availableAt, "2026-04-16T12:00:00.000Z");
  assert.equal(replay.payload?.windowStart, timeseriesCursor);
  assert.equal(
    replay.payload?.windowEnd,
    new Date(Date.parse(timeseriesCursor) + 24 * 60 * 60_000).toISOString(),
  );

  const replayResult = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({
      now: "2026-04-16T12:00:00.000Z",
      importSnapshot,
    }),
    createJobFromInput(replay),
  );

  assert.deepEqual(harness.streamRequests, ["workout-1", "workout-1"]);
  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    replayResult.scheduledJobs?.some((job) =>
      job.payload?.workoutStreamEmptyReplay === true
    ) ?? false,
    false,
  );
});

test("Junction workout_stream empty replay cannot schedule another delayed replay", async () => {
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-1", "workout-2"],
    streamResponse: () => createJsonResponse({ time: [] }),
  });
  const context = createJunctionWorkoutStreamJobContext({ now: "2026-04-16T12:00:00.000Z" });
  const initial = await executeJunctionJob(
    harness.provider,
    context,
    createJunctionWorkoutStreamResourceJob(),
  );
  const replay = requireValue(
    initial.scheduledJobs?.find((job) => job.payload?.workoutStreamEmptyReplay === true),
    "initial empty stream should schedule its bounded replay",
  );

  const replayResult = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({ now: "2026-04-17T12:00:00.000Z" }),
    createJobFromInput(replay),
  );

  assert.equal(replayResult.scheduledJobs?.length ?? 0, 0);
  assert.deepEqual(harness.streamRequests, [
    "workout-1",
    "workout-2",
    "workout-1",
    "workout-2",
  ]);
});

test("Junction workout_stream retains empty-day replay ownership across a retryable candidate", async () => {
  const importedWorkoutIds: string[] = [];
  let allowImport = false;
  let progressCursor: string | null = null;
  const failure = new DeviceSyncError({
    code: "TEST_WORKOUT_STREAM_RETRYABLE",
    message: "retry the populated candidate",
    retryable: true,
  });
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-1", "workout-2"],
    streamResponse: (workoutId) => createJsonResponse(
      workoutId === "workout-1"
        ? { time: [] }
        : {
            time: [1_775_131_200],
            heartrate: [120],
          },
    ),
  });
  const importSnapshot = async (snapshot: { timeseries?: Record<string, unknown[]> }) => {
    const feature = snapshot.timeseries?.workout_stream?.[0] as
      | Record<string, unknown>
      | undefined;
    const workoutId = String(feature?.workoutId);
    if (!allowImport) throw failure;
    importedWorkoutIds.push(workoutId);
    return { imported: true };
  };

  await assert.rejects(
    () => executeJunctionJob(
      harness.provider,
      createJunctionWorkoutStreamJobContext({ importSnapshot }),
      createJunctionWorkoutStreamResourceJob(),
    ),
    (error) => {
      assert.ok(error instanceof JunctionTimeseriesProgressError);
      assert.equal(error.failure, failure);
      assert.equal(error.workoutStreamEmptySeen, true);
      progressCursor = error.workoutStreamCursor;
      return true;
    },
  );
  allowImport = true;

  const result = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({ importSnapshot }),
    createJunctionWorkoutStreamResourceJob({
      workoutStreamCursor: requireValue(progressCursor),
      workoutStreamEmptySeen: true,
    }),
  );

  assert.deepEqual(importedWorkoutIds, ["workout-2"]);
  assert.equal(
    result.scheduledJobs?.filter((job) =>
      job.payload?.workoutStreamEmptyReplay === true
    ).length,
    1,
  );
});

test("Junction workout_stream hard call bound is 100 index pages plus 32 serial streams", async () => {
  let indexPages = 0;
  let streamCalls = 0;
  const provider = createJunctionProvider(async (input) => {
    const parsed = new URL(readUrl(input));
    if (parsed.pathname === "/v2/summary/workouts/junction-user-1") {
      indexPages += 1;
      if (indexPages < 100) {
        return createJsonResponse({ data: [], next_cursor: `page-${indexPages + 1}` });
      }
      return createJsonResponse({
        data: Array.from({ length: 32 }, (_, index) => ({
          id: `workout-${index}`,
          sourceProviderSlug: "garmin",
          startAt: "2026-04-02T12:00:00.000Z",
          endAt: "2026-04-02T12:30:00.000Z",
        })),
      });
    }
    if (/^\/v2\/timeseries\/workouts\/workout-\d+\/stream$/u.test(parsed.pathname)) {
      streamCalls += 1;
      return createJsonResponse({
        time: [1_775_131_200],
        heartrate: [120],
        distance: [5_000],
      });
    }
    throw new Error(`Unexpected request: ${parsed.toString()}`);
  }, {
    summaryResources: [],
    timeseriesResources: ["workout_stream"],
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "timeseries",
    now: "2026-04-03T12:00:00.000Z",
    resource: "workout_stream",
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  const diagnostic = result.result as { response?: { ok?: boolean; recordCount?: number } };

  assert.equal(diagnostic.response?.ok, true);
  assert.equal(diagnostic.response?.recordCount, 32);
  assert.equal(indexPages, 100);
  assert.equal(streamCalls, 32);
  assert.equal(indexPages + streamCalls, 132);
});

test("Junction production timeseries resources and direct provider bound match documentation", async () => {
  const productionResources = [...JUNCTION_PRODUCTION_TIMESERIES_RESOURCES];
  const wideResources = productionResources.filter(
    (resource) => (resolveJunctionTimeseriesResourcePolicy(resource)?.fetchChunkDays ?? 1) > 1,
  );
  const oneDayResources = productionResources.filter(
    (resource) => (resolveJunctionTimeseriesResourcePolicy(resource)?.fetchChunkDays ?? 1) === 1,
  );
  const ordinaryOneDayResources = oneDayResources.filter(
    (resource) => resource !== "workout_stream",
  );
  assert.deepEqual(
    [productionResources.length, wideResources.length, oneDayResources.length, ordinaryOneDayResources.length],
    [48, 6, 42, 41],
  );

  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const compatibilityMatrix = await readFile(
    new URL("../../../docs/device-provider-compatibility-matrix.md", import.meta.url),
    "utf8",
  );
  for (const documentation of [readme, compatibilityMatrix]) {
    assert.match(documentation, /48 production timeseries resources/u);
    assert.match(documentation, /6 wide and 42 one-day/u);
    assert.match(documentation, /three\s+sequential\s+pages/u);
    assert.match(documentation, /one attempt/u);
    assert.match(documentation, /24 seconds/u);
    assert.match(documentation, /one resource/u);
    assert.match(documentation, /one closed UTC day/u);
  }
});

test("Junction workout_stream rejects an over-cap index before fetching any stream", async () => {
  let streamCalls = 0;
  const provider = createJunctionProvider(async (input) => {
    const parsed = new URL(readUrl(input));
    if (parsed.pathname === "/v2/summary/workouts/junction-user-1") {
      return createJsonResponse({
        data: Array.from({ length: 33 }, (_, index) => ({
          id: `workout-${index}`,
          sourceProviderSlug: "garmin",
          startAt: `2026-04-02T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
          endAt: `2026-04-02T${String(index % 24).padStart(2, "0")}:30:00.000Z`,
        })),
      });
    }
    if (parsed.pathname.includes("/v2/timeseries/workouts/")) {
      streamCalls += 1;
      return createJsonResponse({});
    }
    throw new Error(`Unexpected request: ${parsed.toString()}`);
  }, {
    summaryResources: [],
    timeseriesResources: ["workout_stream"],
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "timeseries",
    now: "2026-04-03T12:00:00.000Z",
    resource: "workout_stream",
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  const diagnostic = result.result as { response?: { ok?: boolean; error?: Record<string, unknown> } };

  assert.equal(diagnostic.response?.ok, false);
  assert.equal(streamCalls, 0);
});

test("Junction workout_stream resource jobs reuse precise continuation windows", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    const parsed = new URL(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [createJunctionWorkoutStreamProviderConnection("garmin", true)],
      });
    }
    if (parsed.pathname === "/v2/summary/workouts/junction-user-1") {
      const start = parsed.searchParams.get("start_date") ?? "2026-04-01T06:00:00.000Z";
      const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
      return createJsonResponse({
        data: [{
          id: `workout-${start}`,
          source: { provider: "garmin", type: "watch", device_id: "watch-1" },
          start,
          end,
          sport: "run",
        }],
      });
    }
    if (parsed.pathname.startsWith("/v2/timeseries/workouts/")) {
      return createJsonResponse({
        time: [1_775_131_200, 1_775_133_000],
        heartrate: [100, 160],
        distance: [0, 5_000],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: [],
    timeseriesResources: ["workout_stream"],
  });
  const job = createJob("resource", {
    resource: "workout_stream",
    resourceCategory: "timeseries",
    windowStart: "2026-04-01T06:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionWorkoutStreamJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      shouldYield: () => requests.some((url) => url.includes("/v2/timeseries/workouts/")),
    }),
    job,
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    timeseries?: { workout_stream?: Array<Record<string, unknown>> };
    windowEnd?: string;
    windowStart?: string;
  };
  assert.deepEqual([snapshot.windowStart, snapshot.windowEnd], [
    "2026-04-01T00:00:00.000Z",
    "2026-04-02T00:00:00.000Z",
  ]);
  assert.equal(snapshot.timeseries?.workout_stream?.length, 1);
  assert.equal(Array.isArray(snapshot.timeseries?.workout_stream?.[0]?.stream), false);
  const continuation = requireValue(
    result.scheduledJobs?.find((scheduled) => scheduled.kind === "resource"),
    "workout stream yield should schedule the remaining precise window",
  );
  assert.equal(continuation.payload?.windowStart, "2026-04-02T00:00:00.000Z");
  assert.equal(continuation.payload?.windowEnd, "2026-04-03T00:00:00.000Z");
});

test("Junction known opt-in continuation restarts a narrowed default-only window", async () => {
  const requests: URL[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    requests.push(url);
    if (url.pathname.startsWith("/v2/timeseries/junction-user-1/")) {
      return createJsonResponse({ groups: {} });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: [],
    timeseriesResources: [...JUNCTION_DEFAULT_TIMESERIES_RESOURCES],
  });
  const context = createJunctionJobContext({ now: "2026-04-05T00:00:00.000Z" });
  let result = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      timeseriesCursor: "2026-04-03T00:00:00.000Z",
      timeseriesResourceCursor: "fat",
      windowEnd: "2026-04-04T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );
  let continuationCount = 0;
  while (result.scheduledJobs?.[0]) {
    continuationCount += 1;
    assert.ok(continuationCount < 100, "Narrowed continuation should terminate.");
    result = await executeJunctionJob(
      provider,
      context,
      createJobFromInput(result.scheduledJobs[0]),
    );
  }

  const groupedRequests = requests.filter((url) => url.pathname.includes("/v2/timeseries/"));
  assert.equal(
    groupedRequests[0]?.searchParams.get("start_date"),
    "2026-04-02",
  );
  assert.deepEqual(
    new Set(groupedRequests.map((url) =>
      normalizeJunctionResourceName(
        url.pathname.match(/^\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u)?.[1],
      )
    )),
    new Set(JUNCTION_DEFAULT_TIMESERIES_RESOURCES),
  );
  assert.equal(
    groupedRequests.length,
    JUNCTION_DEFAULT_TIMESERIES_RESOURCES.length * 2,
  );
  assert.equal(result.scheduledJobs?.length ?? 0, 0);
});

test("Junction scalar timeseries resource continuation fails closed before provider egress", async () => {
  const requestUrls: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    requestUrls.push(readUrl(input));
    throw new Error("resource continuation validation must precede provider egress");
  }, {
    summaryResources: [],
    timeseriesResources: ["steps", "distance"],
  });
  const invalidPayloads = [
    { timeseriesResourceCursor: "" },
    { timeseriesResourceCursor: "removed_resource" },
    { timeseriesResourceCursor: JSON.stringify({ v: 1, i: ["steps"] }) },
    { timeseriesResourceCursor: JSON.stringify({ v: 2, a: "steps", i: [] }) },
    { timeseriesResourceCursor: JSON.stringify({ v: 1, a: "steps", i: ["steps"] }) },
    { timeseriesResourceCursor: JSON.stringify({ v: 1, a: "steps", i: ["distance", "distance"] }) },
    { timeseriesResourceCursor: JSON.stringify({ v: 1, a: "steps", i: ["removed_resource"] }) },
    { timeseriesResourceCursor: JSON.stringify({ v: 1, a: "steps", i: [], extra: true }) },
    {
      timeseriesResourceCursor: "steps",
      workoutStreamCursor: JSON.stringify({
        v: 1,
        i: [JSON.stringify(["garmin", "watch", "watch-1", "workout-1"])],
      }),
    },
  ];

  for (const payload of invalidPayloads) {
    await assert.rejects(
      () => executeJunctionJob(
        provider,
        createJunctionWorkoutStreamJobContext(),
        createJob("reconcile", {
          windowEnd: "2026-04-03T00:00:00.000Z",
          windowStart: "2026-04-02T00:00:00.000Z",
          ...payload,
        }),
      ),
      (error) => {
        assert.ok(error instanceof DeviceSyncError);
        assert.equal(error.code, "DEVICE_SYNC_JOB_PAYLOAD_INVALID");
        assert.equal(error.retryable, false);
        return true;
      },
    );
  }
  assert.deepEqual(requestUrls, []);
});

test("Junction full-job workout_stream retains exact progress in its direct continuation", async () => {
  const importedWorkoutIds: string[] = [];
  let allowSecondWorkout = false;
  const retryableFailure = new DeviceSyncError({
    code: "TEST_WORKOUT_STREAM_RETRYABLE",
    message: "retry the remaining workout",
    retryable: true,
  });
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-1", "workout-2"],
  });
  const importSnapshot = async (snapshot: { timeseries?: Record<string, unknown[]> }) => {
    const feature = snapshot.timeseries?.workout_stream?.[0] as
      | Record<string, unknown>
      | undefined;
    if (!feature) {
      return { imported: true };
    }
    const workoutId = String(feature?.workoutId);
    if (workoutId === "workout-2" && !allowSecondWorkout) {
      throw retryableFailure;
    }
    importedWorkoutIds.push(workoutId);
    return { imported: true };
  };
  const context = createJunctionWorkoutStreamJobContext({ importSnapshot });
  const initial = await executeJunctionJob(
    harness.provider,
    context,
    createJob("reconcile", {
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );
  const direct = requireValue(
    initial.scheduledJobs?.[0],
    "The setup pass should schedule workout_stream directly.",
  );
  assert.equal(direct.payload?.timeseriesResourceCursor, "workout_stream");
  assert.equal(direct.payload?.timeseriesCursor, "2026-04-02T00:00:00.000Z");

  const partial = await executeJunctionJob(
    harness.provider,
    context,
    createJobFromInput(direct),
  );
  const continuation = requireValue(
    partial.scheduledJobs?.[0],
    "Exact workout progress should remain on the full-job continuation.",
  );
  assert.equal(continuation.kind, "reconcile");
  assert.equal(continuation.payload?.timeseriesCursor, "2026-04-02T00:00:00.000Z");
  assert.equal(continuation.payload?.timeseriesResourceCursor, "workout_stream");
  assert.deepEqual(readJunctionWorkoutProgressIdentities(continuation.payload), [
    junctionWorkoutCandidateIdentity("workout-1"),
  ]);

  await assert.rejects(
    () => executeJunctionJob(
      harness.provider,
      createJunctionWorkoutStreamJobContext({ importSnapshot }),
      createJobFromInput(continuation, 1),
    ),
    (error) => error === retryableFailure,
  );
  allowSecondWorkout = true;

  const completed = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({ importSnapshot }),
    createJobFromInput(continuation, 2),
  );
  assert.deepEqual(importedWorkoutIds, ["workout-1", "workout-2"]);
  assert.equal(completed.scheduledJobs?.length ?? 0, 0);
});

test("Junction workout_stream continuation metadata fails closed before provider egress", async () => {
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-1"],
  });

  const sortedIdentities = [
    junctionWorkoutCandidateIdentity("workout-1"),
    junctionWorkoutCandidateIdentity("workout-2"),
  ].sort();
  const invalidProgressValues = [
    "garmin:workout-1",
    JSON.stringify({ v: 1, i: [] }),
    JSON.stringify({ v: 1, i: [...sortedIdentities].reverse() }),
    JSON.stringify({
      v: 1,
      i: Array.from({ length: 33 }, (_, index) =>
        junctionWorkoutCandidateIdentity(`workout-${index}`)
      ).sort(),
    }),
  ];

  for (const workoutStreamCursor of invalidProgressValues) {
    await assert.rejects(
      () => executeJunctionJob(
        harness.provider,
        createJunctionWorkoutStreamJobContext(),
        createJunctionWorkoutStreamResourceJob({ workoutStreamCursor }),
      ),
      (error) => {
        assert.ok(error instanceof DeviceSyncError);
        assert.equal(error.code, "DEVICE_SYNC_JOB_PAYLOAD_INVALID");
        assert.equal(error.retryable, false);
        return true;
      },
    );
  }
  assert.deepEqual(harness.requestUrls, []);
  assert.deepEqual(harness.streamRequests, []);
});

test("Junction workout_stream exact progress survives comparator-adversarial insertion and reordering", async () => {
  const importedWorkoutIds: string[] = [];
  let interrupted = false;
  const failure = new DeviceSyncError({
    code: "TEST_RETRYABLE_IMPORT_FAILURE",
    message: "retry this candidate",
    retryable: true,
  });
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: (indexRequest) =>
      indexRequest === 1 ? ["workout-2", "workout-3"] : ["workout-3", "workout-10", "workout-2"],
  });
  const importSnapshot = async (snapshot: {
    timeseries?: Record<string, unknown[]>;
  }) => {
    const feature = snapshot.timeseries?.workout_stream?.[0] as
      | Record<string, unknown>
      | undefined;
    const workoutId = String(feature?.workoutId);
    if (workoutId === "workout-3" && !interrupted) {
      interrupted = true;
      throw failure;
    }
    importedWorkoutIds.push(workoutId);
    return { imported: true };
  };

  let progressCursor: string | null = null;
  await assert.rejects(
    () => executeJunctionJob(
      harness.provider,
      createJunctionWorkoutStreamJobContext({ importSnapshot }),
      createJunctionWorkoutStreamResourceJob(),
    ),
    (error) => {
      assert.ok(error instanceof JunctionTimeseriesProgressError);
      assert.equal(error.failure, failure);
      assert.equal(error.windowStart, "2026-04-02T00:00:00.000Z");
      progressCursor = error.workoutStreamCursor;
      return true;
    },
  );
  const progressPayload = {
    workoutStreamCursor: requireValue(
      progressCursor,
      "retryable workout stream progress should carry the exact cursor",
    ),
  };
  assert.deepEqual(readJunctionWorkoutProgressIdentities(progressPayload), [
    junctionWorkoutCandidateIdentity("workout-2"),
  ]);
  assert.doesNotMatch(
    progressPayload.workoutStreamCursor,
    /(?:samples|stream|timestamps|heartrate|startAt|endAt)/u,
  );

  const second = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({ importSnapshot }),
    createJunctionWorkoutStreamResourceJob(progressPayload),
  );

  assert.deepEqual(importedWorkoutIds, ["workout-2", "workout-10", "workout-3"]);
  assert.deepEqual(harness.streamRequests, [
    "workout-2",
    "workout-3",
    "workout-10",
    "workout-3",
  ]);
  assert.equal(second.scheduledJobs?.some((job) => job.kind === "resource") ?? false, false);
});

test("Junction workout_stream retryable index failure carries the owning day without a cursor", async () => {
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => [],
    listResponse: () => new Response(JSON.stringify({ error: "temporary" }), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "0",
      },
    }),
  });

  await assert.rejects(
    () => executeJunctionJob(
      harness.provider,
      createJunctionWorkoutStreamJobContext(),
      createJunctionWorkoutStreamResourceJob(),
    ),
    (error) => {
      assert.ok(error instanceof JunctionTimeseriesProgressError);
      assert.ok(error.failure instanceof DeviceSyncError);
      assert.equal(error.failure.code, "JUNCTION_API_REQUEST_FAILED");
      assert.equal(error.failure.retryable, true);
      assert.equal(error.windowStart, "2026-04-02T00:00:00.000Z");
      assert.equal(error.workoutStreamCursor, null);
      return true;
    },
  );

  assert.equal(
    harness.requestUrls.filter((url) => url.includes("/v2/summary/workouts/")).length,
    3,
  );
  assert.deepEqual(harness.streamRequests, []);
});

test("Junction workout_stream retires first and middle optional 404/422 candidates only", async () => {
  const importedWorkoutIds: string[] = [];
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-1", "workout-2", "workout-3"],
    streamResponse: (workoutId) => {
      if (workoutId === "workout-1") {
        return createJsonResponse({ error: "not found" }, 404);
      }
      if (workoutId === "workout-2") {
        return createJsonResponse({ error: "not ready" }, 422);
      }
      return createJsonResponse({
        time: [1_775_131_200, 1_775_133_000],
        heartrate: [100, 160],
        distance: [0, 5_000],
      });
    },
  });

  const result = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({
      importSnapshot: async (snapshot: { timeseries?: Record<string, unknown[]> }) => {
        const feature = snapshot.timeseries?.workout_stream?.[0] as
          | Record<string, unknown>
          | undefined;
        importedWorkoutIds.push(String(feature?.workoutId));
        return { imported: true };
      },
    }),
    createJunctionWorkoutStreamResourceJob(),
  );

  assert.deepEqual(harness.streamRequests, ["workout-1", "workout-2", "workout-3"]);
  assert.deepEqual(importedWorkoutIds, ["workout-3"]);
  assert.equal(result.scheduledJobs?.some((job) => job.kind === "resource") ?? false, false);
  assert.equal(result.metadataPatch?.junctionSkippedTimeseriesTotal, 2);
});

test("Junction workout_stream only creates a cooperative successor after exact progress", async () => {
  const beforeImported: string[] = [];
  const beforeHarness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-1", "workout-2"],
  });
  const beforeAbort = new Error("cooperative yield before progress");
  await assert.rejects(
    () => executeJunctionJob(
      beforeHarness.provider,
      createJunctionWorkoutStreamJobContext({
        importSnapshot: async (snapshot: { timeseries?: Record<string, unknown[]> }) => {
          const feature = snapshot.timeseries?.workout_stream?.[0] as
            | Record<string, unknown>
            | undefined;
          beforeImported.push(String(feature?.workoutId));
          return { imported: true };
        },
        shouldYield: () => true,
        throwIfAborted: () => {
          throw beforeAbort;
        },
      }),
      {
        ...createJunctionWorkoutStreamResourceJob(),
        attempts: 2,
        maxAttempts: 5,
      },
    ),
    (error) => {
      assert.equal(error, beforeAbort);
      return true;
    },
  );
  assert.deepEqual(beforeHarness.streamRequests, []);
  assert.deepEqual(beforeImported, []);

  const afterImported: string[] = [];
  const afterHarness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-1", "workout-2"],
  });
  const importAfter = async (snapshot: { timeseries?: Record<string, unknown[]> }) => {
    const feature = snapshot.timeseries?.workout_stream?.[0] as
      | Record<string, unknown>
      | undefined;
    afterImported.push(String(feature?.workoutId));
    return { imported: true };
  };
  const afterYield = await executeJunctionJob(
    afterHarness.provider,
    createJunctionWorkoutStreamJobContext({
      importSnapshot: importAfter,
      shouldYield: () => afterImported.length === 1,
    }),
    createJunctionWorkoutStreamResourceJob(),
  );
  const afterContinuation = readScheduledWorkoutStreamContinuation(afterYield.scheduledJobs);
  assert.deepEqual(readJunctionWorkoutProgressIdentities(afterContinuation.payload), [
    junctionWorkoutCandidateIdentity("workout-1"),
  ]);
  assert.deepEqual(afterHarness.streamRequests, ["workout-1"]);

  const completed = await executeJunctionJob(
    afterHarness.provider,
    createJunctionWorkoutStreamJobContext({ importSnapshot: importAfter }),
    createJunctionWorkoutStreamResourceJob(afterContinuation.payload ?? {}),
  );
  assert.deepEqual(afterImported, ["workout-1", "workout-2"]);
  assert.equal(completed.scheduledJobs?.some((job) => job.kind === "resource") ?? false, false);
});

test("Junction workout_stream carries the owning day when retryable failure precedes progress", async () => {
  const failure = new DeviceSyncError({
    code: "TEST_RETRYABLE_IMPORT_FAILURE",
    message: "retry the first candidate",
    retryable: true,
  });
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-1", "workout-2"],
  });

  await assert.rejects(
    () => executeJunctionJob(
      harness.provider,
      createJunctionWorkoutStreamJobContext({
        importSnapshot: async () => {
          throw failure;
        },
      }),
      createJunctionWorkoutStreamResourceJob(),
    ),
    (error) => {
      assert.ok(error instanceof JunctionTimeseriesProgressError);
      assert.equal(error.failure, failure);
      assert.equal(error.windowStart, "2026-04-02T00:00:00.000Z");
      assert.equal(error.workoutStreamCursor, null);
      return true;
    },
  );
  assert.deepEqual(harness.streamRequests, ["workout-1"]);
});

test("Junction workout_stream carries exact progress and bounded context with its retryable provider failure", async () => {
  const importedWorkoutIds: string[] = [];
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-1", "workout-2"],
    streamResponse: (workoutId) => workoutId === "workout-2"
      ? new Response(JSON.stringify({
          error: "temporary provider failure",
          privatePayloadMarker: "raw-workout-payload-must-not-escape",
          workoutId,
        }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "0",
          },
        })
      : createJsonResponse({
          time: [1_775_131_200, 1_775_133_000],
          heartrate: [100, 160],
          distance: [0, 5_000],
        }),
  });

  await assert.rejects(
    () => executeJunctionJob(
      harness.provider,
      createJunctionWorkoutStreamJobContext({
        importSnapshot: async (snapshot: { timeseries?: Record<string, unknown[]> }) => {
          const feature = snapshot.timeseries?.workout_stream?.[0] as
            | Record<string, unknown>
            | undefined;
          importedWorkoutIds.push(String(feature?.workoutId));
          return { imported: true };
        },
      }),
      createJunctionWorkoutStreamResourceJob(),
    ),
    (error) => {
      assert.ok(error instanceof JunctionTimeseriesProgressError);
      assert.ok(error.failure instanceof DeviceSyncError);
      assert.equal(error.failure.retryable, true);
      assert.equal(error.failure.details?.status, 500);
      assert.equal(error.failure.details?.requestCandidateAliasSource, "id");
      assert.equal(error.failure.details?.requestCandidateCount, 2);
      assert.equal(error.failure.details?.requestCandidateOrdinal, 2);
      const serializedDetails = JSON.stringify(error.failure.details);
      assert.equal(serializedDetails.includes("workout-2"), false);
      assert.equal(serializedDetails.includes("raw-workout-payload-must-not-escape"), false);
      assert.deepEqual(readJunctionWorkoutProgressIdentities({
        workoutStreamCursor: error.workoutStreamCursor,
      }), [junctionWorkoutCandidateIdentity("workout-1")]);
      return true;
    },
  );

  assert.deepEqual(importedWorkoutIds, ["workout-1"]);
  assert.deepEqual(harness.streamRequests, [
    "workout-1",
    "workout-2",
    "workout-2",
    "workout-2",
  ]);
});

test("Junction workout_stream carries terminal progress across cancellation", async () => {
  const importedWorkoutIds: string[] = [];
  const abortController = new AbortController();
  const cancellation = new Error("cancel workout sync");
  let cancelled = false;
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-1", "workout-2", "workout-3"],
  });
  const importSnapshot = async (snapshot: { timeseries?: Record<string, unknown[]> }) => {
    const feature = snapshot.timeseries?.workout_stream?.[0] as
      | Record<string, unknown>
      | undefined;
    const workoutId = String(feature?.workoutId);
    if (workoutId === "workout-2" && !cancelled) {
      cancelled = true;
      abortController.abort(cancellation);
      throw cancellation;
    }
    importedWorkoutIds.push(workoutId);
    return { imported: true };
  };

  const first = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({
      importSnapshot,
      signal: abortController.signal,
    }),
    {
      ...createJunctionWorkoutStreamResourceJob(),
      attempts: 2,
      maxAttempts: 3,
    },
  );
  const continuation = readScheduledWorkoutStreamContinuation(first.scheduledJobs);
  assert.deepEqual(readJunctionWorkoutProgressIdentities(continuation.payload), [
    junctionWorkoutCandidateIdentity("workout-1"),
  ]);
  assert.equal(continuation.availableAt, undefined);
  assert.equal(continuation.maxAttempts, 2);

  const second = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({ importSnapshot }),
    createJunctionWorkoutStreamResourceJob(continuation.payload ?? {}),
  );
  assert.deepEqual(importedWorkoutIds, ["workout-1", "workout-2", "workout-3"]);
  assert.equal(second.scheduledJobs?.some((job) => job.kind === "resource") ?? false, false);
});

test("Junction workout_stream carries completed-day progress across source-authority cancellation", async () => {
  const importedWorkoutIds: string[] = [];
  const abortController = new AbortController();
  const cancellation = new Error("cancel workout source authority");
  let cancelled = false;
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: (requestCount) => [requestCount === 1 ? "day-one-workout" : "day-two-workout"],
  });
  const listConnectionSources = async () => {
    if (importedWorkoutIds.includes("day-one-workout") && !cancelled) {
      cancelled = true;
      abortController.abort(cancellation);
      throw cancellation;
    }
    return [createJunctionWorkoutStreamSource("garmin", true)];
  };
  const importSnapshot = async (snapshot: { timeseries?: Record<string, unknown[]> }) => {
    const feature = snapshot.timeseries?.workout_stream?.[0] as
      | Record<string, unknown>
      | undefined;
    importedWorkoutIds.push(String(feature?.workoutId));
    return { imported: true };
  };

  const first = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({
      importSnapshot,
      listConnectionSources,
      signal: abortController.signal,
    }),
    createJunctionWorkoutStreamResourceJob({
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-01T00:00:00.000Z",
    }),
  );
  const continuation = readScheduledWorkoutStreamContinuation(first.scheduledJobs);
  assert.equal(continuation.payload?.windowStart, "2026-04-02T00:00:00.000Z");
  assert.equal(continuation.payload?.windowEnd, "2026-04-03T00:00:00.000Z");
  assert.deepEqual(importedWorkoutIds, ["day-one-workout"]);

  const second = await executeJunctionJob(
    harness.provider,
    createJunctionWorkoutStreamJobContext({ importSnapshot }),
    createJunctionWorkoutStreamResourceJob(continuation.payload ?? {}),
  );
  assert.deepEqual(importedWorkoutIds, ["day-one-workout", "day-two-workout"]);
  assert.deepEqual(harness.streamRequests, ["day-one-workout", "day-two-workout"]);
  assert.equal(second.scheduledJobs?.some((job) => job.kind === "resource") ?? false, false);
});

test("Junction webhook jobs use complete migration provenance and retry mixed sources", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const parseWebhook = async (input: {
    data: Record<string, unknown>;
    eventType?: string;
    messageId: string;
  }) => {
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: input.eventType ?? "daily.data.activity.created",
        user_id: "junction-user-fitbit-migration",
        data: input.data,
      },
      messageId: input.messageId,
      timestamp: "1775174400",
    });
    return requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });
  };

  const cases = [
    {
      data: {
        id: "activity-direct-google-health",
        sourceProviderSlug: "google_health",
      },
      eventType: "daily.data.activity.created",
      expected: "google_health",
      name: "direct",
    },
    {
      data: {
        id: "activity-nested-google-health",
        provider: "fitbit",
        results: [{
          date: "2026-04-02",
          sourceProviderSlug: "google_health",
          steps: 4321,
        }],
      },
      eventType: "daily.data.activity.created",
      expected: "google_health",
      name: "nested",
    },
    {
      data: {
        groups: {
          fitbit: [{
            data: [{
              sourceProviderSlug: "google_health",
              timestamp: "2026-04-02T12:00:00.000Z",
              value: 1234,
            }],
          }],
        },
        provider: "fitbit",
      },
      eventType: "daily.data.steps.created",
      expected: "google_health",
      name: "grouped",
    },
  ] as const;

  for (const value of cases) {
    const parsed = await parseWebhook({
      data: value.data,
      eventType: value.eventType,
      messageId: `msg_migration_${value.name}`,
    });
    assert.equal(parsed.dataSourceProviderSlug, value.expected, value.name);
    assert.equal(parsed.jobs[0]?.payload?.sourceProviderSlug, value.expected, value.name);
  }

  for (const value of [
    {
      data: {
        groups: {
          fitbit: [{ data: [{ date: "2026-04-02", steps: 4321 }] }],
          google_health: [{ data: [{ date: "2026-04-02", steps: 1234 }] }],
        },
        id: "activity-mixed-migration-sources",
      },
      messageId: "msg_activity_mixed_migration_sources",
    },
    {
      data: {
        id: "activity-known-and-unknown-migration-sources",
        records: [
          { date: "2026-04-02", sourceProviderSlug: "google_health", steps: 1234 },
          { date: "2026-04-02", steps: 4321 },
        ],
      },
      messageId: "msg_activity_known_and_unknown_migration_sources",
    },
  ]) {
    await assert.rejects(
      parseWebhook(value),
      (error: unknown) => error instanceof DeviceSyncError
        && error.code === "WEBHOOK_SOURCE_NOT_READY"
        && error.httpStatus === 503
        && error.retryable === true,
    );
  }
});

test("Junction migration cleanup requires the active successor and revokes only Fitbit", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const request = {
      method: String(init?.method ?? "GET"),
      url: readUrl(input),
    };
    requests.push(request);
    if (request.url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        data: [
          { slug: "garmin", status: "connected" },
          { slug: "fitbit", status: "connected" },
          { slug: "google_health", status: "connected" },
        ],
      });
    }
    if (request.method === "DELETE") {
      return createJsonResponse({ success: true });
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const revokeSourceAccess = requireValue(
    provider.connectionHandler?.revokeSourceAccess,
  );

  await revokeSourceAccess(createAccount(), "fitbit", {
    requiredActiveSourceProviderSlug: "google_health",
  });

  assert.deepEqual(requests, [
    {
      method: "GET",
      url: "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1",
    },
    {
      method: "DELETE",
      url: "https://api.sandbox.us.junction.com/v2/user/junction-user-1/fitbit",
    },
  ]);
});

test("Junction migration cleanup leaves Fitbit active without an active successor", async () => {
  let deletes = 0;
  const provider = createJunctionProvider(async (input, init) => {
    const url = readUrl(input);
    if (String(init?.method ?? "GET") === "DELETE") {
      deletes += 1;
      return createJsonResponse({ success: true });
    }
    assert.equal(
      url,
      "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1",
    );
    return createJsonResponse({
      data: [
        { slug: "fitbit", status: "connected" },
        { slug: "google_health", status: "error" },
      ],
    });
  });
  const revokeSourceAccess = requireValue(
    provider.connectionHandler?.revokeSourceAccess,
  );

  await assert.rejects(
    () => revokeSourceAccess(createAccount(), "fitbit", {
      requiredActiveSourceProviderSlug: "google_health",
    }),
    (error: unknown) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_REQUIRED_SOURCE_NOT_ACTIVE"
      && error.retryable === true,
  );
  assert.equal(deletes, 0);
});

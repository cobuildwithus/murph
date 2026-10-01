import {
  assertConnectBackfillRetryWake,
  buildExpectedJunctionDedupeKey,
  createAccount,
  createConnectionSource,
  createEmptyJunctionBackfillProvider,
  createHistoricalActivityProvider,
  createHistoricalPullFetch,
  createJob,
  createJunctionJobContext,
  createJunctionProvider,
  createJunctionSvixWebhook,
  createMixedGarminOuraActivityProvider,
  createStoredAccount,
  executeFullJobTimeseriesContinuations,
  executeJunctionJob,
  requireJunctionWebhookHandler,
} from "./junction-provider.harness.ts";

import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { DeviceSyncError } from "../src/errors.ts";
import {
  hasJunctionExtendedTimeseriesHistoryBackfillCoverage,
  resolveJunctionExtendedTimeseriesHistoryBackfillVersion,
} from "../src/junction-historical-backfill-progress.ts";
import { mergeStoredDeviceSyncMetadataPatch } from "../src/metadata.ts";
import {
  DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
} from "../src/public-account.ts";
import {
  buildJunctionProviderSourceInstanceKey,
  JUNCTION_CONNECT_SOURCE_TARGETS,
  JUNCTION_DEFAULT_PROVIDER_FILTER,
  JUNCTION_LINK_PROVIDER_SLUGS,
  normalizeJunctionProviderFilter,
  resolveJunctionConnectSourceLabel,
  resolveJunctionConnectTargetForSourceId,
} from "../src/config/junction-connect-sources.ts";
import { canonicalizeJunctionProviderSlug } from "../src/connect-config.ts";
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

test("Junction account jobs keep a concurrently fenced connected source out of projection and import", async () => {
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
            resource_availability: { activity: true },
          },
          {
            id: "provider-fitbit-1",
            slug: "fitbit",
            name: "Fitbit",
            status: "connected",
            resource_availability: { activity: true },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [
          {
            id: "garmin-activity-1",
            connectionId: "provider-garmin-1",
            steps: 4321,
          },
          {
            id: "fitbit-activity-1",
            connectionId: "provider-fitbit-1",
            steps: 1234,
          },
          {
            id: "fitbit-activity-direct-1",
            sourceProviderSlug: "fitbit",
            steps: 567,
          },
          {
            id: "unresolved-source-activity-1",
            connectionId: "provider-not-listed-1",
            steps: 890,
          },
          {
            id: "legacy-unattributed-activity-1",
            steps: 321,
          },
          {
            id: "legacy-rowless-activity-1",
            sourceProviderSlug: "polar",
            steps: 654,
          },
        ],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      const bloodOxygenStartDate = new URL(url).searchParams.get("start_date");
      if (
        bloodOxygenStartDate !== "2026-04-02"
        && bloodOxygenStartDate !== "2026-04-02T00:00:00.000Z"
      ) {
        return createJsonResponse({ groups: {} });
      }
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              id: "garmin-blood-oxygen-1",
              timestamp: "2026-04-02T14:00:00.000Z",
              unit: "%",
              value: 97,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
          fitbit: [{
            data: [{
              id: "fitbit-blood-oxygen-1",
              timestamp: "2026-04-02T14:00:00.000Z",
              unit: "%",
              value: 91,
            }],
            source: { provider: "fitbit", type: "watch" },
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  const garminSource = createConnectionSource();
  const fitbitSource = createConnectionSource({
    id: "src-fitbit",
    sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "fitbit",
    }), "Fitbit source key should be available."),
    sourceProviderSlug: "fitbit",
    status: "connected",
    lastErrorCode: DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
    lastErrorMessage: "Source disconnect is in progress.",
  });
  let liveSources = [garminSource, fitbitSource];
  const importedSnapshots: Array<{
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, Array<Record<string, unknown>>>;
  }> = [];
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  const context = createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      // Simulate a worker that loaded the established account before the target
      // start committed its disconnected source row.
      account: createAccount({
        sources: [{
          sourceProviderSlug: garminSource.sourceProviderSlug,
          displayName: garminSource.displayName,
          status: garminSource.status,
          resourceCount: Object.keys(garminSource.resourceAvailabilitySummary).length,
          lastErrorCode: garminSource.lastErrorCode,
          lastErrorMessage: garminSource.lastErrorMessage,
          firstSeenAt: garminSource.firstSeenAt,
          lastSeenAt: garminSource.lastSeenAt,
          lastDataAt: garminSource.lastDataAt,
        }],
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot as (typeof importedSnapshots)[number]);
        return { imported: true };
      },
      listConnectionSources: () => liveSources,
      upsertConnectionSource: (input) => {
        upserts.push(input);
        const existing = liveSources.find((source) =>
          source.sourceInstanceKey === input.sourceInstanceKey
        );
        const stored = createConnectionSource({
          ...existing,
          ...input,
          id: existing?.id ?? `src-${input.sourceProviderSlug ?? "unknown"}`,
          firstSeenAt: existing?.firstSeenAt ?? input.lastSeenAt,
        });
        liveSources = [
          ...liveSources.filter((source) => source.sourceInstanceKey !== stored.sourceInstanceKey),
          stored,
        ];
        return stored;
      },
  });
  const initialResult = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {}),
  );
  await executeFullJobTimeseriesContinuations({
    context,
    initialResult,
    provider,
  });

  assert.equal(
    upserts.some((source) =>
      source.sourceProviderSlug === "fitbit" && source.status === "connected"
    ),
    false,
  );
  assert.equal(
    liveSources.find((source) => source.sourceProviderSlug === "fitbit")?.status,
    "connected",
  );
  assert.deepEqual(
    importedSnapshots.flatMap((snapshot) => snapshot.summaries?.activity ?? [])
      .map((record) => record.id),
    [
      "garmin-activity-1",
      "legacy-unattributed-activity-1",
      "legacy-rowless-activity-1",
    ],
  );
  // The ordinary calendar-day pull and the temporal-authority window may each
  // import the connected record; canonical import converges the duplicate.
  // The fenced source must never appear.
  assert.deepEqual(
    [...new Set(
      importedSnapshots.flatMap((snapshot) => snapshot.timeseries?.blood_oxygen ?? [])
        .map((record) => record.id),
    )],
    ["garmin-blood-oxygen-1"],
  );
});

test("Junction non-connected source stays retrying without inventing a historical reset", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "error",
            resource_availability: {},
            error_details: {
              error_type: "provider_temporarily_unavailable",
              error_message: "Temporary provider failure.",
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
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
      listConnectionSources: () => [],
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
  assert.equal(result.scheduledJobs, undefined);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
  assert.equal(upserts.at(-1)?.sourceProviderSlug, "garmin");
  assert.equal(upserts.at(-1)?.status, "error");
  assert.equal(upserts.at(-1)?.lastErrorCode, "provider_temporarily_unavailable");
  assert.equal(
    upserts.some((source) => source.lastErrorCode === "HISTORICAL_DATA_RECONNECT_REQUIRED"),
    false,
  );
});

test("Junction empty provider list keeps retrying without marking an existing source", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const existingSource = createConnectionSource({
    sourceInstanceKey: "hosted-source-garmin",
  });
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
      listConnectionSources: () => [existingSource],
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
  assert.equal(result.scheduledJobs, undefined);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
  assert.equal(upserts.length, 0);
});

test("Junction explicit Garmin failure marks only Garmin when another source succeeds", async () => {
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
              sleep: true,
            },
          },
          {
            id: "provider-fitbit-1",
            slug: "fitbit",
            name: "Fitbit",
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
        data: [
          { id: "garmin-activity-1", connectionId: "provider-garmin-1", steps: 4321 },
          { id: "fitbit-activity-1", connectionId: "provider-fitbit-1", steps: 1234 },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "sleep"],
  }, createHistoricalPullFetch({
    fitbit: {
      not_pulled: [],
      pulled: {
        activity: { days_with_data: 1, status: "success" },
      },
    },
    garmin: {
      not_pulled: [],
      pulled: {
        activity: { days_with_data: 1, status: "success" },
        sleep: {
          days_with_data: 0,
          error_details: "Historical pull failed.",
          status: "failure",
        },
      },
    },
  }));
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
      listConnectionSources: () => [],
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

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_exhausted");
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 5);
  const erroredSources = upserts.filter((source) => source.status === "error");
  assert.equal(erroredSources.length, 1);
  assert.equal(erroredSources[0]?.sourceProviderSlug, "garmin");
  assert.equal(erroredSources[0]?.lastErrorCode, "HISTORICAL_DATA_RECONNECT_REQUIRED");
  assert.equal(
    upserts.some((source) => source.sourceProviderSlug === "fitbit" && source.status === "error"),
    false,
  );
});

test("Junction saturated mixed failures mark only Garmin while retrying the other source", async () => {
  const provider = createMixedGarminOuraActivityProvider("failure");
  const importedSnapshots: unknown[] = [];
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
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      listConnectionSources: () => [],
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

  assert.equal(importedSnapshots.length, 1);
  const importedSnapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
  };
  assert.deepEqual(
    importedSnapshot.summaries?.activity?.map((record) => record.sourceProviderSlug).sort(),
    ["garmin", "oura"],
  );
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_retrying");
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 4);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
  const resetSources = upserts.filter((source) =>
    source.lastErrorCode === "HISTORICAL_DATA_RECONNECT_REQUIRED"
  );
  assert.deepEqual(resetSources.map((source) => source.sourceProviderSlug), ["garmin"]);
});

test("Junction saturated mixed failures wait for the due observation before marking Garmin", async () => {
  const provider = createMixedGarminOuraActivityProvider("failure");
  const importedSnapshots: unknown[] = [];
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_retrying",
          junctionHistoricalBackfillEmptyAttempts: 4,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-02T12:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      listConnectionSources: () => [],
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

  assert.equal(importedSnapshots.length, 1);
  assert.equal(result.metadataPatch, undefined);
  assertConnectBackfillRetryWake(result, "2026-04-03T12:00:00.000Z");
  assert.equal(
    upserts.some((source) =>
      source.lastErrorCode === "HISTORICAL_DATA_RECONNECT_REQUIRED"
    ),
    false,
  );
});

test("Junction clears Garmin recovery after success while Oura remains retrying", async () => {
  const provider = createMixedGarminOuraActivityProvider("success");
  const importedSnapshots: unknown[] = [];
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  let sources = [createConnectionSource({
    status: "error",
    lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
    lastErrorMessage: "Historical data remained incomplete.",
  })];

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
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      listConnectionSources: () => sources,
      upsertConnectionSource: (input) => {
        upserts.push(input);
        const stored = createConnectionSource(input);
        sources = [
          ...sources.filter((source) => source.sourceInstanceKey !== stored.sourceInstanceKey),
          stored,
        ];
        return stored;
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_retrying");
  assert.equal(result.metadataPatch?.junctionHistoricalBackfillEmptyAttempts, 4);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
  const garminUpdates = upserts.filter((source) => source.sourceProviderSlug === "garmin");
  assert.equal(garminUpdates[0]?.lastErrorCode, "HISTORICAL_DATA_RECONNECT_REQUIRED");
  assert.equal(garminUpdates.at(-1)?.status, "connected");
  const garminSource = sources.find((source) => source.sourceProviderSlug === "garmin");
  const ouraSource = sources.find((source) => source.sourceProviderSlug === "oura");
  assert.equal(garminSource?.status, "connected");
  assert.equal(garminSource?.lastErrorCode, null);
  assert.equal(ouraSource?.status, "connected");
  assert.equal(ouraSource?.lastErrorCode, null);
});

test("Junction exhausted historical backfill preserves reconnect-required source health", async () => {
  const provider = createEmptyJunctionBackfillProvider();
  const historicalError = createConnectionSource({
    status: "error",
    lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
    lastErrorMessage: "Historical data remained incomplete.",
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    account: createAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
        junctionHistoricalBackfillEmptyAttempts: 5,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    listConnectionSources: () => [historicalError],
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return createConnectionSource(input);
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch, undefined);
  assert.equal(result.scheduledJobs, undefined);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.status, "error");
  assert.equal(upserts[0]?.lastErrorCode, "HISTORICAL_DATA_RECONNECT_REQUIRED");
});

test("Junction exhausted historical backfill reasserts a missing reconnect marker", async () => {
  const provider = createEmptyJunctionBackfillProvider({}, createHistoricalPullFetch({
    garmin: {
      not_pulled: [],
      pulled: {
        activity: {
          days_with_data: 0,
          error_details: "Historical pull failed.",
          status: "failure",
        },
      },
    },
  }));
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    account: createAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
        junctionHistoricalBackfillEmptyAttempts: 5,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    listConnectionSources: () => [createConnectionSource({
      status: "error",
      lastErrorCode: "TOKEN_REFRESH_FAILED",
      lastErrorMessage: "Transient provider error.",
    })],
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return createConnectionSource(input);
    },
  });

  await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(upserts.at(-1)?.status, "error");
  assert.equal(upserts.at(-1)?.lastErrorCode, "HISTORICAL_DATA_RECONNECT_REQUIRED");
});

test("Junction exhausted history marker survives a transient upstream provider error", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "error",
            error_details: {
              error_type: "provider_temporarily_unavailable",
              error_message: "Temporary provider failure.",
              errored_at: "2026-04-03T00:00:00.000Z",
            },
            resource_availability: { activity: true },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
          junctionHistoricalBackfillEmptyAttempts: 5,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      listConnectionSources: () => [createConnectionSource({
        status: "error",
        lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
        lastErrorMessage: "Historical data remained incomplete.",
      })],
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(upserts[0]?.status, "error");
  assert.equal(upserts[0]?.lastErrorCode, "HISTORICAL_DATA_RECONNECT_REQUIRED");
  assert.equal(upserts[0]?.lastErrorMessage, "Historical data remained incomplete.");
});

test("Junction source projection clears historical reconnect health after connection metadata resets", async () => {
  const provider = createEmptyJunctionBackfillProvider();
  const existingSource = createConnectionSource({
    sourceInstanceKey: "hosted-source-garmin",
    status: "error",
    lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
    lastErrorMessage: "Historical data remained incomplete.",
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ metadata: {} }),
      listConnectionSources: () => [existingSource],
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

  assert.equal(upserts[0]?.sourceInstanceKey, existingSource.sourceInstanceKey);
  assert.equal(upserts[0]?.status, "connected");
  assert.equal(Object.hasOwn(upserts[0] ?? {}, "lastErrorCode"), false);
  assert.equal(Object.hasOwn(upserts[0] ?? {}, "lastErrorMessage"), false);
});

test("Junction current coverage clears a stale Oura reset marker", async () => {
  const provider = createHistoricalActivityProvider(
    "oura",
    createHistoricalPullFetch({
      oura: {
        not_pulled: [],
        pulled: {
          activity: { days_with_data: 1, status: "success" },
        },
      },
    }),
  );
  const existingSource = createConnectionSource({
    sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "oura",
    })),
    sourceProviderSlug: "oura",
    status: "error",
    lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
    lastErrorMessage: "Historical data remained incomplete.",
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
          junctionHistoricalBackfillEmptyAttempts: 5,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      listConnectionSources: () => [existingSource],
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

  assert.equal(upserts.at(-1)?.sourceProviderSlug, "oura");
  assert.equal(upserts.at(-1)?.status, "connected");
  assert.equal(Object.hasOwn(upserts.at(-1) ?? {}, "lastErrorCode"), false);
});

for (const sourceProviderSlug of ["oura", "apple_health_kit"] as const) {
  test(`Junction retrying coverage clears a stale ${sourceProviderSlug} reset marker`, async () => {
    const provider = createHistoricalActivityProvider(
      sourceProviderSlug,
      createHistoricalPullFetch({
        [sourceProviderSlug]: {
          not_pulled: [],
          pulled: {
            activity: { days_with_data: 1, status: "success" },
          },
        },
      }),
    );
    const sourceInstanceKey = requireValue(buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug,
    }));
    const existingSource = createConnectionSource({
      sourceInstanceKey,
      sourceProviderSlug,
      status: "error",
      lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
      lastErrorMessage: "Historical data remained incomplete.",
    });
    const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

    await executeJunctionJob(
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
        listConnectionSources: () => [existingSource],
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

    const sourceUpdates = upserts.filter((source) =>
      source.sourceProviderSlug === sourceProviderSlug
    );
    assert.ok(sourceUpdates.length > 0);
    for (const source of sourceUpdates) {
      assert.equal(source.status, "connected");
      assert.equal(Object.hasOwn(source, "lastErrorCode"), false);
      assert.equal(Object.hasOwn(source, "lastErrorMessage"), false);
    }
  });
}

test("Junction queued jobs preserve an Oura reset marker owned by opaque future coverage", async () => {
  const provider = createHistoricalActivityProvider(
    "oura",
    createHistoricalPullFetch({
      oura: {
        not_pulled: [],
        pulled: {
          activity: { days_with_data: 1, status: "success" },
        },
      },
    }),
  );
  const existingSource = createConnectionSource({
    sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "oura",
    })),
    sourceProviderSlug: "oura",
    status: "error",
    lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
    lastErrorMessage: "Future coverage owns this state.",
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v4_exhausted",
        },
      }),
      listConnectionSources: () => [existingSource],
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

  assert.equal(result.metadataPatch, undefined);
  assert.equal(upserts.at(-1)?.sourceProviderSlug, "oura");
  assert.equal(upserts.at(-1)?.status, "error");
  assert.equal(upserts.at(-1)?.lastErrorCode, "HISTORICAL_DATA_RECONNECT_REQUIRED");
});

test("Junction late historical data queues one connect-window verification after exhaustion", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const account = createAccount({
    metadata: {
      junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
      junctionHistoricalBackfillEmptyAttempts: 5,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    },
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      now: "2026-04-05T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.activity.created",
      objectId: "late-activity",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "late-activity",
        sourceProviderSlug: "garmin",
        steps: 4321,
      }),
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    result.metadataPatch?.junctionHistoricalBackfillEvidence,
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:1",
  );
  assert.equal(result.scheduledJobs?.length, 1);
  assert.equal(result.scheduledJobs?.[0]?.kind, "backfill");
  assert.equal(result.scheduledJobs?.[0]?.availableAt, "2026-04-05T00:00:00.000Z");
  assert.equal(
    result.scheduledJobs?.[0]?.dedupeKey,
    buildExpectedJunctionDedupeKey(
      "backfill",
      "2026-04-01T00:00:00.000Z",
      "2026-04-03T00:00:00.000Z",
    ),
  );
  assert.deepEqual(result.scheduledJobs?.[0]?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  const currentResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      now: "2026-04-05T00:00:00.000Z",
      importSnapshot: async () => ({ canonicalEventCount: 1, durableDeliveryAccepted: true }),
    }),
    createJob("resource", {
      eventType: "daily.data.activity.created",
      objectId: "current-activity",
      occurredAt: "2026-04-04T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-04",
        id: "current-activity",
        sourceProviderSlug: "garmin",
        steps: 1234,
      }),
      windowStart: "2026-04-04T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );
  assert.equal(currentResult.scheduledJobs, undefined);
  assert.equal(currentResult.metadataPatch, undefined);
});

test("Junction direct Apple Health canonical delivery records history despite the Link provider filter", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const account = createAccount({
    metadata: {
      junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
      junctionHistoricalBackfillEmptyAttempts: 5,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    },
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      importSnapshot: async () => ({ canonicalEventCount: 1, durableDeliveryAccepted: true }),
    }),
    createJob("resource", {
      eventType: "daily.data.activity.created",
      objectId: "apple-health-activity",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "apple_health_kit",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "apple-health-activity",
        sourceProviderSlug: "apple_health_kit",
        steps: 4321,
      }),
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(
    result.metadataPatch?.junctionHistoricalBackfillEvidence,
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|apple_health_kit:1",
  );
  assert.deepEqual(result.scheduledJobs?.map((job) => job.kind), ["backfill"]);
});

test("Junction data webhooks name the delivering source and lifecycle events do not", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    requests.push(url.toString());
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          resource_availability: { blood_pressure: true },
        }],
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/blood_pressure/grouped") {
      const timestamp = url.searchParams.get("start_date")
        ?? "2026-03-18T00:00:00.000Z";
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              id: `bp-${timestamp}`,
              timestamp,
              systolic: 120,
              diastolic: 80,
            }],
            source: { provider: "garmin", type: "cuff" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    providerFilter: ["garmin"],
    timeseriesResources: ["blood_pressure"],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const parseWebhook = async (input: {
    body: Record<string, unknown>;
    messageId: string;
  }) => {
    const webhook = createJunctionSvixWebhook({
      body: input.body,
      messageId: input.messageId,
      timestamp: "1775174400",
    });

    return requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });
  };

  // The arrival stamp is only as good as the real parser naming the source, so
  // assert it on signed payloads rather than through a fake provider.
  for (const sourceProviderSlug of ["garmin", "oura"]) {
    const parsed = await parseWebhook({
      body: {
        event_type: "daily.data.activity.created",
        user_id: "junction-user-1",
        data: {
          date: "2026-04-03",
          id: `activity-${sourceProviderSlug}`,
          source: {
            provider: sourceProviderSlug,
            type: "watch",
          },
          steps: 1234,
        },
      },
      messageId: `msg_arrival_${sourceProviderSlug}`,
    });

    assert.equal(parsed.dataSourceProviderSlug, sourceProviderSlug);
  }

  // A historical-pull completion is a data-less notification. Accepting its
  // follow-up fetch job proves nothing arrived, and treating it as delivery
  // would refresh the arrival signal and mask a genuinely dead carrier.
  const completionOnly = await parseWebhook({
    body: {
      event_type: "historical.data.sleep.created",
      user_id: "junction-user-1",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        source_provider_slug: "garmin",
      },
    },
    messageId: "msg_arrival_historical_completion",
  });

  assert.equal(completionOnly.dataSourceProviderSlug, null);

  // A connection lifecycle event proves nothing about the data carrier.
  const lifecycle = await parseWebhook({
    body: {
      event_type: "provider.connection.created",
      user_id: "junction-user-1",
      data: {
        created_at: "2026-03-20T14:30:00.000Z",
        provider: "garmin",
      },
    },
    messageId: "msg_arrival_lifecycle",
  });

  assert.equal(lifecycle.dataSourceProviderSlug, null);
  assert.equal(lifecycle.sourceProviderSlug, "garmin");
  assert.equal(lifecycle.occurredAt, "2026-03-20T14:30:00.000Z");
  assert.deepEqual(lifecycle.jobs.map((job) => job.kind), ["backfill", "reconcile"]);
  const garminSource = {
    displayName: "Garmin",
    firstSeenAt: "2026-03-20T14:30:00.000Z",
    lastDataAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-04-03T00:00:00.000Z",
    resourceCount: 1,
    resourceAvailabilitySummary: { blood_pressure: true },
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  };
  const bloodPressureHistoryVersion = requireValue(
    resolveJunctionExtendedTimeseriesHistoryBackfillVersion("blood_pressure"),
  );
  const schedulerAccount = createStoredAccount({
    metadata: {
      junctionBloodPressureHistoryBackfillCoverage: `v${bloodPressureHistoryVersion}|omron`,
    },
    nextReconcileAt: "2026-04-03T00:00:00.000Z",
    sources: [garminSource],
  });
  const executor = requireValue(provider.jobExecutor);
  const findScheduledHistoryJob = (now: string) => requireValue(
    executor.createScheduledJobs?.(
      schedulerAccount,
      now,
    ).jobs.find((job) =>
      job.kind === "resource"
      && job.payload?.resource === "blood_pressure"
      && job.payload?.sourceProviderSlug === "garmin"
    ),
  );
  const schedulerJob = findScheduledHistoryJob("2026-04-03T00:00:00.000Z");
  assert.deepEqual(schedulerJob.payload, {
    historicalBackfill: true,
    historicalBackfillVersion: bloodPressureHistoryVersion,
    historicalWindowStart: "2025-09-21T00:00:00.000Z",
    resource: "blood_pressure",
    resourceCategory: "timeseries",
    sourceLifecycleEpoch: 1,
    sourceProviderSlug: "garmin",
    windowEnd: "2026-03-20T00:00:00.000Z",
    windowStart: "2025-09-21T00:00:00.000Z",
  });
  assert.equal(
    findScheduledHistoryJob("2026-04-04T00:00:00.000Z").dedupeKey,
    schedulerJob.dedupeKey,
  );
  // Keep this webhook/lifecycle execution proof intentionally small; the raw
  // scheduler payload above independently proves the fixed 180-day horizon.
  const twoDayExecutionJob = {
    ...schedulerJob,
    payload: {
      ...schedulerJob.payload,
      historicalWindowStart: "2026-03-18T00:00:00.000Z",
      windowStart: "2026-03-18T00:00:00.000Z",
    },
  };

  const updateCases = [
    {
      data: {
        provider: "garmin",
        updated_at: "2026-04-03T00:00:00.000Z",
      },
      expectedOccurredAt: "2026-04-03T00:00:00.000Z",
      messageId: "msg_lifecycle_update_timestamp",
    },
    {
      data: { provider: "garmin" },
      expectedOccurredAt: undefined,
      messageId: "msg_lifecycle_update_now_fallback",
    },
  ] as const;

  for (const updateCase of updateCases) {
    const update = await parseWebhook({
      body: {
        event_type: "provider.connection.updated",
        user_id: "junction-user-1",
        data: updateCase.data,
      },
      messageId: updateCase.messageId,
    });
    assert.equal(update.occurredAt, updateCase.expectedOccurredAt);
    assert.deepEqual(update.jobs.map((job) => job.kind), ["backfill", "reconcile"]);
  }

  requests.length = 0;
  let scheduledResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionBloodPressureHistoryBackfillCoverage: `v${bloodPressureHistoryVersion}|omron`,
        },
        sources: [garminSource],
      }),
      importSnapshot: async () => ({
        canonicalEventCount: 2,
        durableDeliveryAccepted: true,
      }),
    }),
    {
      ...createJob("resource", twoDayExecutionJob.payload ?? {}),
      dedupeKey: twoDayExecutionJob.dedupeKey ?? null,
    },
  );
  const scheduledFollowUp = scheduledResult.scheduledJobs?.find((job) =>
    job.kind === "resource" && job.payload?.resource === "blood_pressure"
  );
  if (scheduledFollowUp) {
    scheduledResult = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({
          metadata: {
            junctionBloodPressureHistoryBackfillCoverage: `v${bloodPressureHistoryVersion}|omron`,
          },
          sources: [garminSource],
        }),
        importSnapshot: async () => ({
          canonicalEventCount: 2,
          durableDeliveryAccepted: true,
        }),
      }),
      {
        ...createJob(scheduledFollowUp.kind, scheduledFollowUp.payload ?? {}),
        dedupeKey: scheduledFollowUp.dedupeKey ?? null,
      },
    );
  }

  assert.equal(
    requests.some((request) =>
      new URL(request).searchParams.get("start_date") === "2026-03-18T00:00:00.000Z"
    ),
    true,
  );
  assert.equal(
    hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      scheduledResult.metadataPatch ?? {},
      "garmin",
      "blood_pressure",
      bloodPressureHistoryVersion,
    ),
    true,
  );
  assert.equal(
    hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      scheduledResult.metadataPatch ?? {},
      "omron",
      "blood_pressure",
      bloodPressureHistoryVersion,
    ),
    true,
  );
});

test("Junction connection-day direct pushes do not prove older historical coverage", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    providerFilter: ["garmin"],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.activity.created",
      user_id: "junction-user-1",
      data: {
        date: "2026-04-03",
        id: "connection-day-activity",
        source: {
          provider: "garmin",
          type: "watch",
        },
        steps: 1234,
      },
    },
    messageId: "msg_connection_day_activity_1",
    timestamp: "1775174400",
  });
  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.jobs.length, 1);

  let importCount = 0;
  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
          junctionHistoricalBackfillEmptyAttempts: 5,
          junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
        },
      }),
      importSnapshot: async () => {
        importCount += 1;
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
    }),
    createJob("resource", parsed.jobs[0]?.payload ?? {}),
  );

  assert.equal(importCount, 1);
  assert.equal(result.metadataPatch, undefined);
  assert.equal(result.scheduledJobs, undefined);
});

test("Junction connection-day sleep records do not prove older historical coverage", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    providerFilter: ["garmin"],
    summaryResources: ["sleep", "sleep_cycle"],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const cases = [
    {
      eventType: "daily.data.sleep.created",
      messageId: "msg_connection_day_sleep_1",
      data: {
        bedtime_start: "2026-04-03T01:00:00.000Z",
        bedtime_stop: "2026-04-03T08:00:00.000Z",
        date: "2026-04-03",
        id: "connection-day-sleep",
        score: 88,
        sourceProviderSlug: "garmin",
      },
    },
    {
      eventType: "daily.data.sleep_cycle.created",
      messageId: "msg_connection_day_sleep_cycle_1",
      data: {
        id: "connection-day-sleep-cycle",
        sessionEnd: "2026-04-03T08:00:00.000Z",
        sessionStart: "2026-04-02T23:00:00.000Z",
        sourceProviderSlug: "garmin",
        stages: [{
          endAt: "2026-04-03T08:00:00.000Z",
          stage: "light",
          startAt: "2026-04-02T23:00:00.000Z",
        }],
      },
    },
  ] as const;
  let importCount = 0;

  for (const fixture of cases) {
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: fixture.eventType,
        user_id: "junction-user-1",
        data: fixture.data,
      },
      messageId: fixture.messageId,
      timestamp: "1775217600",
    });
    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T12:00:00.000Z",
    });
    assert.equal(parsed.jobs.length, 1);

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({
          metadata: {
            junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
            junctionHistoricalBackfillEmptyAttempts: 5,
            junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
            junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
            junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
          },
        }),
        now: "2026-04-03T12:00:00.000Z",
        importSnapshot: async () => {
          importCount += 1;
          return { canonicalEventCount: 1, durableDeliveryAccepted: true };
        },
      }),
      createJob("resource", parsed.jobs[0]?.payload ?? {}),
    );

    assert.equal(result.metadataPatch, undefined);
    assert.equal(result.scheduledJobs, undefined);
  }

  assert.equal(importCount, cases.length);
});

test("Junction direct pushes without canonical events or from another source do not become history evidence", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    providerFilter: ["garmin"],
  });
  const basePayload = {
    eventType: "daily.data.activity.created",
    occurredAt: "2026-04-02T00:00:00.000Z",
    resource: "activity",
    resourceCategory: "summary",
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  };

  const emptyImportResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async () => ({ canonicalEventCount: 0 }),
    }),
    createJob("resource", {
      ...basePayload,
      objectId: "empty-activity",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        id: "empty-activity",
        sourceProviderSlug: "garmin",
      }),
    }),
  );
  assert.equal(emptyImportResult.metadataPatch, undefined);

  const acceptedIdOnlyImportResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async () => ({
        canonicalEventCount: 0,
        durableDeliveryAccepted: true,
      }),
    }),
    createJob("resource", {
      ...basePayload,
      objectId: "accepted-id-only-activity",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        id: "accepted-id-only-activity",
        sourceProviderSlug: "garmin",
      }),
    }),
  );
  assert.equal(acceptedIdOnlyImportResult.metadataPatch, undefined);

  const otherSourceResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async () => ({ canonicalEventCount: 1, durableDeliveryAccepted: true }),
    }),
    createJob("resource", {
      ...basePayload,
      objectId: "other-source-activity",
      sourceProviderSlug: "oura",
      webhookDataJson: JSON.stringify({
        id: "other-source-activity",
        sourceProviderSlug: "oura",
        steps: 1000,
      }),
    }),
  );
  assert.equal(otherSourceResult.metadataPatch, undefined);
});

test("Junction meaningful raw-only direct delivery proves history after durable acceptance", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    providerFilter: ["garmin"],
    summaryResources: ["sleep_cycle"],
  });
  const account = createAccount({
    metadata: {
      junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
      junctionHistoricalBackfillEmptyAttempts: 5,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    },
  });
  const job = createJob("resource", {
    eventType: "daily.data.sleep_cycle.created",
    objectId: "accepted-raw-sleep-cycle",
    occurredAt: "2026-04-02T08:00:00.000Z",
    resource: "sleep_cycle",
    resourceCategory: "summary",
    sourceProviderSlug: "garmin",
    webhookDataJson: JSON.stringify({
      end: "2026-04-02T08:00:00.000Z",
      id: "accepted-raw-sleep-cycle",
      sourceProviderSlug: "garmin",
      start: "2026-04-02T00:00:00.000Z",
      stages: [{
        endAt: "2026-04-02T08:00:00.000Z",
        stage: "light",
        startAt: "2026-04-02T00:00:00.000Z",
      }],
    }),
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-02T00:00:00.000Z",
  });

  const unaccepted = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      importSnapshot: async () => ({
        canonicalEventCount: 0,
        durableDeliveryAccepted: false,
      }),
      now: "2026-04-05T00:00:00.000Z",
    }),
    job,
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      importSnapshot: async () => ({
        canonicalEventCount: 0,
        durableDeliveryAccepted: true,
      }),
      now: "2026-04-05T00:00:00.000Z",
    }),
    job,
  );

  assert.equal(unaccepted.metadataPatch, undefined);
  assert.equal(
    result.metadataPatch?.junctionHistoricalBackfillEvidence,
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:4",
  );
});

test("Junction direct pushes preserve opaque future historical evidence after import", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    providerFilter: ["garmin"],
  });
  const futureStatus = "coverage_v4_exhausted";
  const futureEvidence = "e3|opaque-future-evidence";
  const account = createAccount({
    metadata: {
      junctionHistoricalBackfillEvidence: futureEvidence,
      junctionHistoricalBackfillStatus: futureStatus,
    },
  });
  let importCount = 0;

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account,
      importSnapshot: async () => {
        importCount += 1;
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.activity.created",
      objectId: "future-evidence-activity",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "future-evidence-activity",
        sourceProviderSlug: "garmin",
        steps: 4321,
      }),
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );
  const metadata = mergeStoredDeviceSyncMetadataPatch(account.metadata, result.metadataPatch);

  assert.equal(importCount, 1);
  assert.equal(metadata.junctionHistoricalBackfillStatus, futureStatus);
  assert.equal(metadata.junctionHistoricalBackfillEvidence, futureEvidence);
});

test("Junction exhausted historical backfill completes when the same window later has data", async () => {
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
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
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", connectionId: "provider-garmin-1", steps: 4321 }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const context = createJunctionJobContext({
    account: createAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
        junctionHistoricalBackfillEmptyAttempts: 5,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    listConnectionSources: () => [createConnectionSource({
      status: "error",
      lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
      lastErrorMessage: "Historical data remained incomplete.",
    })],
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return createConnectionSource(input);
    },
  });

  const result = await executeJunctionJob(
    provider,
    context,
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
  assert.equal(upserts.length, 2);
  assert.equal(upserts[0]?.status, "error");
  assert.equal(upserts[1]?.status, "connected");
  assert.equal(Object.hasOwn(upserts[1] ?? {}, "lastErrorCode"), false);

  const futureVersionUpserts: Array<
    Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]
  > = [];
  const futureVersionResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillStatus: "coverage_v4_exhausted",
        },
      }),
      listConnectionSources: () => [createConnectionSource({
        status: "error",
        lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
        lastErrorMessage: "Future coverage owns this state.",
      })],
      upsertConnectionSource: (input) => {
        futureVersionUpserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );
  assert.equal(futureVersionResult.metadataPatch, undefined);
  assert.equal(futureVersionUpserts.length, 1);
  assert.equal(futureVersionUpserts[0]?.status, "error");
  assert.equal(
    futureVersionUpserts[0]?.lastErrorCode,
    "HISTORICAL_DATA_RECONNECT_REQUIRED",
  );
});

test("Junction connect-window coverage unions fresh REST rows with matching imported push evidence", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          resource_availability: { activity: true, sleep: true },
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ connectionId: "provider-garmin-1", id: "activity-rest-1", steps: 4321 }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    providerFilter: ["garmin"],
    summaryResources: ["activity", "sleep"],
  });
  const job = createJob("backfill", {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  const matchingResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionHistoricalBackfillEvidence:
            "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:2",
        },
      }),
    }),
    job,
  );
  assert.equal(
    matchingResult.metadataPatch?.junctionHistoricalBackfillStatus,
    "coverage_v3_complete",
  );

  for (const evidence of [
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|oura:2",
    "e2|2026-03-31T00:00:00.000Z|2026-04-02T00:00:00.000Z|garmin:2",
  ]) {
    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({ metadata: { junctionHistoricalBackfillEvidence: evidence } }),
      }),
      job,
    );
    assert.equal(
      result.metadataPatch?.junctionHistoricalBackfillStatus,
      "coverage_v3_retrying",
      evidence,
    );
  }
});

test("Junction authenticated late sleep pushes recover an exhausted historical window", async () => {
  const windowStart = "2026-04-01T00:00:00.000Z";
  const windowEnd = "2026-04-03T00:00:00.000Z";
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
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
            sleep: true,
            sleep_cycle: true,
          },
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ connectionId: "provider-garmin-1", id: "activity-rest-1", steps: 4321 }],
      });
    }
    if (
      url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")
      || url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")
    ) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    providerFilter: ["garmin"],
    summaryResources: ["activity", "sleep", "sleep_cycle"],
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  let metadata: Record<string, unknown> = {
    junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
    junctionHistoricalBackfillEmptyAttempts: 5,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: windowStart,
    junctionHistoricalBackfillWindowEnd: windowEnd,
  };
  let verificationJob: DeviceSyncJobInput | undefined;
  const importedPushResources: string[] = [];

  for (const testCase of [
    {
      data: {
        date: "2026-04-02",
        end_time: "2026-04-02T11:15:00.000Z",
        id: "late-garmin-sleep-1",
        resource: "sleep",
        source: { provider: "garmin" },
        start_time: "2026-04-02T03:30:00.000Z",
        total_sleep_minutes: 420,
      },
      eventType: "historical.data.sleep.created",
      expectedEvidence:
        "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:2",
      expectedResource: "sleep",
      messageId: "msg_late_garmin_sleep_1",
    },
    {
      data: {
        date: "2026-04-02",
        end: "2026-04-02T04:25:00.000Z",
        id: "late-garmin-hypnogram-1",
        resource: "hypnogram",
        source: { provider: "garmin" },
        start: "2026-04-02T04:00:00.000Z",
        stages: [{
          endAt: "2026-04-02T04:25:00.000Z",
          stage: "deep",
          startAt: "2026-04-02T04:00:00.000Z",
        }],
      },
      eventType: "historical.data.hypnogram.created",
      expectedEvidence:
        "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:6",
      expectedResource: "sleep_cycle",
      messageId: "msg_late_garmin_hypnogram_1",
    },
  ] as const) {
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: testCase.eventType,
        user_id: "junction-user-1",
        data: testCase.data,
      },
      messageId: testCase.messageId,
      timestamp: "1775174400",
    });
    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });
    const parsedJob = parsed.jobs[0];
    assert.ok(parsedJob);
    assert.equal(parsed.acceptanceMode, "durable_webhook_work");
    assert.equal(parsedJob.kind, "resource");
    assert.equal(parsedJob.payload?.resource, testCase.expectedResource);

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({ metadata }),
        importSnapshot: async (snapshot) => {
          const summaries = (snapshot as { summaries?: Record<string, unknown[]> }).summaries ?? {};
          importedPushResources.push(...Object.keys(summaries));
          return { canonicalEventCount: 1, durableDeliveryAccepted: true };
        },
        now: "2026-04-03T00:00:00.000Z",
      }),
      createJob(parsedJob.kind, parsedJob.payload ?? {}),
    );

    assert.equal(
      result.metadataPatch?.junctionHistoricalBackfillEvidence,
      testCase.expectedEvidence,
    );
    verificationJob = result.scheduledJobs?.find((job) => job.kind === "backfill");
    assert.deepEqual(verificationJob?.payload, { windowEnd, windowStart });
    metadata = mergeStoredDeviceSyncMetadataPatch(metadata, result.metadataPatch);
  }

  assert.deepEqual(importedPushResources, ["sleep", "sleep_cycle"]);
  assert.equal(
    metadata.junctionHistoricalBackfillEvidence,
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:6",
  );
  assert.ok(verificationJob);

  const existingSource = createConnectionSource({
    status: "error",
    lastErrorCode: "HISTORICAL_DATA_RECONNECT_REQUIRED",
    lastErrorMessage: "Historical data remained incomplete.",
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  let verificationSnapshot: unknown = null;
  const verificationResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ metadata }),
      importSnapshot: async (snapshot) => {
        verificationSnapshot = snapshot;
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
      listConnectionSources: () => [existingSource],
      now: "2026-04-03T00:01:00.000Z",
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob(verificationJob.kind, verificationJob.payload ?? {}),
  );

  const verificationSummaries = (verificationSnapshot as {
    summaries?: Record<string, unknown[]>;
  }).summaries;
  assert.equal(verificationSummaries?.activity?.length, 1);
  assert.deepEqual(verificationSummaries?.sleep, []);
  assert.deepEqual(verificationSummaries?.sleep_cycle, []);
  assert.equal(
    verificationResult.metadataPatch?.junctionHistoricalBackfillStatus,
    "coverage_v3_complete",
  );
  const completedMetadata = mergeStoredDeviceSyncMetadataPatch(
    metadata,
    verificationResult.metadataPatch,
  );
  assert.equal(completedMetadata.junctionHistoricalBackfillStatus, "coverage_v3_complete");
  assert.equal(
    completedMetadata.junctionHistoricalBackfillEvidence,
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:6",
  );
  assert.ok(requests.some((url) => url.includes("/v2/summary/activity/")));
  assert.ok(requests.some((url) => url.includes("/v2/summary/sleep/")));
  assert.ok(requests.some((url) => url.includes("/v2/summary/sleep_cycle/")));
  assert.equal(upserts.at(-1)?.status, "connected");
  assert.equal(Object.hasOwn(upserts.at(-1) ?? {}, "lastErrorCode"), false);
  assert.equal(Object.hasOwn(upserts.at(-1) ?? {}, "lastErrorMessage"), false);
});

test("Junction coverage ignores errored sources outside the normalized provider filter", async () => {
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
            resource_availability: { activity: true },
          },
          {
            id: "provider-other-1",
            slug: "fitbit",
            name: "Other source",
            status: "error",
            resource_availability: { activity: true },
          },
        ],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ connectionId: "provider-garmin-1", id: "activity-rest-1", steps: 4321 }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    providerFilter: [" GARMIN ", "garmin"],
  });

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

test("Junction reconcile data does not complete pending historical backfill", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", steps: 1234 }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const context = createJunctionJobContext({
    account: createAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-01-03T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
  });

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch, undefined);
  assert.equal(result.scheduledJobs, undefined);
});

test("Junction provider source keys are stable provider-level opaque ids", () => {
  const garminKey = buildJunctionProviderSourceInstanceKey({
    connectionId: "acct-junction-1",
    sourceProviderSlug: "Garmin",
  });
  const garminKeyAgain = buildJunctionProviderSourceInstanceKey({
    connectionId: "acct-junction-1",
    sourceProviderSlug: "garmin",
  });
  const pelotonKey = buildJunctionProviderSourceInstanceKey({
    connectionId: "acct-junction-1",
    sourceProviderSlug: "peloton",
  });
  const appleHealthKeys = ["apple_health_kit", "apple_health", "apple-healthkit"].map(
    (sourceProviderSlug) => buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug,
    }),
  );

  assert.equal(garminKey, garminKeyAgain);
  assert.notEqual(garminKey, pelotonKey);
  assert.equal(new Set(appleHealthKeys).size, 1);
  assert.equal(canonicalizeJunctionProviderSlug(" Apple Health "), "apple_health_kit");
  assert.equal(canonicalizeJunctionProviderSlug("unknown-source"), "unknown_source");
  assert.equal(canonicalizeJunctionProviderSlug(null), null);
  assert.match(garminKey ?? "", /^jxn_src_[a-f0-9]{32}$/u);
  assert.doesNotMatch(garminKey ?? "", /acct|junction|garmin/u);
});

test("Junction provider revokes remote provider slugs unless Junction already reports them disconnected", async () => {
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
          ...Array.from({ length: JUNCTION_MAX_USER_PROVIDERS + 1 }, (_, index) => ({
            id: `garmin-${index}`,
            slug: index % 2 === 0 ? "garmin" : "Garmin",
            status: index % 2 === 0 ? "connected" : "active",
          })),
          { slug: "apple_health_kit", status: "error" },
          { slug: "fitbit", status: "revoked" },
          { provider: "Oura", status: "unknown" },
        ],
      });
    }

    if (request.method === "DELETE") {
      return createJsonResponse({ success: true });
    }

    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const revokeAccess = requireValue(provider.connectionHandler?.revokeAccess);

  await revokeAccess(createAccount());

  assert.deepEqual(requests, [
    {
      method: "GET",
      url: "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1",
    },
    {
      method: "DELETE",
      url: "https://api.sandbox.us.junction.com/v2/user/junction-user-1/garmin",
    },
    {
      method: "DELETE",
      url: "https://api.sandbox.us.junction.com/v2/user/junction-user-1/apple_health_kit",
    },
    {
      method: "DELETE",
      url: "https://api.sandbox.us.junction.com/v2/user/junction-user-1/oura",
    },
  ]);
});

test("Junction provider cleanup deregisters only the requested source", async () => {
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
          ...Array.from({ length: JUNCTION_MAX_USER_PROVIDERS + 1 }, (_, index) => ({
            id: `garmin-${index}`,
            slug: "garmin",
            status: "disconnected",
          })),
          { slug: "fitbit", status: "connected" },
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
  const isSourceAccessActive = requireValue(
    provider.connectionHandler?.isSourceAccessActive,
  );

  assert.equal(await isSourceAccessActive(createAccount(), "fitbit"), true);
  assert.equal(await isSourceAccessActive(createAccount(), "oura"), false);
  await revokeSourceAccess(createAccount(), "fitbit");

  assert.deepEqual(requests, [
    {
      method: "GET",
      url: "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1",
    },
    {
      method: "GET",
      url: "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1",
    },
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

test("Junction provider proves source access only from an unambiguous explicit connected status", async () => {
  const provider = createJunctionProvider(async (input) => {
    assert.equal(
      readUrl(input),
      "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1",
    );
    return createJsonResponse({
      data: [
        { slug: "source_connected", status: "connected" },
        { slug: "source_connected", status: "CONNECTED" },
        { slug: "source_active", status: "active" },
        { slug: "source_available", status: "available" },
        { slug: "source_ok", status: "ok" },
        { slug: "source_unknown", status: "unknown" },
        { slug: "source_missing" },
        { slug: "source_unrecognized", status: "settling" },
        { slug: "source_error", status: "error" },
        { slug: "source_failed", status: "failed" },
        { slug: "source_disconnected", status: "disconnected" },
        { slug: "source_revoked", status: "revoked" },
        { slug: "source_inactive", status: "inactive" },
        { slug: "source_mixed", status: "connected" },
        { slug: "source_mixed", status: "error" },
      ],
    });
  });
  const isSourceAccessActive = requireValue(
    provider.connectionHandler?.isSourceAccessActive,
  );

  assert.equal(await isSourceAccessActive(createAccount(), "source_connected"), true);
  for (const slug of [
    "source_active",
    "source_available",
    "source_ok",
    "source_unknown",
    "source_missing",
    "source_unrecognized",
    "source_error",
    "source_failed",
    "source_disconnected",
    "source_revoked",
    "source_inactive",
    "source_mixed",
  ]) {
    assert.equal(await isSourceAccessActive(createAccount(), slug), false);
  }
  for (const slug of [
    "source_active",
    "source_available",
    "source_ok",
    "source_unknown",
    "source_missing",
    "source_unrecognized",
    "source_error",
    "source_failed",
    "source_mixed",
  ]) {
    await assert.rejects(
      () => isSourceAccessActive(createAccount(), slug, { requireDefinitive: true }),
      (error: unknown) => error instanceof DeviceSyncError
        && error.code === "JUNCTION_SOURCE_STATUS_AMBIGUOUS"
        && error.retryable === true,
    );
  }
});

test("Junction provider requires definitive absence for cutover recovery", async () => {
  const provider = createJunctionProvider(async (input) => {
    assert.equal(
      readUrl(input),
      "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1",
    );
    return createJsonResponse({
      data: [
        { slug: "fitbit", status: "error" },
        { slug: "fitbit", status: "revoked" },
        { slug: "oura", status: "revoked" },
        { slug: "garmin", status: "connected" },
        { slug: "mixed", status: "connected" },
        { slug: "mixed", status: "error" },
      ],
    });
  });
  const isSourceAccessActive = requireValue(
    provider.connectionHandler?.isSourceAccessActive,
  );

  assert.equal(
    await isSourceAccessActive(createAccount(), "garmin", { requireDefinitive: true }),
    true,
  );
  assert.equal(
    await isSourceAccessActive(createAccount(), "oura", { requireDefinitive: true }),
    false,
  );
  await assert.rejects(
    () => isSourceAccessActive(createAccount(), "fitbit", { requireDefinitive: true }),
    (error: unknown) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_SOURCE_STATUS_AMBIGUOUS"
      && error.retryable === true,
  );
  await assert.rejects(
    () => isSourceAccessActive(createAccount(), "mixed", { requireDefinitive: true }),
    (error: unknown) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_SOURCE_STATUS_AMBIGUOUS"
      && error.retryable === true,
  );
});

test("Junction provider rejects non-Link routes from hosted web Link", () => {
  assert.deepEqual(normalizeJunctionProviderFilter(["oura", "withings"]), ["oura", "withings"]);

  assert.throws(
    () => normalizeJunctionProviderFilter([
      "oura",
      "apple_health_kit",
      "apple_healthkit",
      "health_connect",
      "samsung_health",
      "accuchek_ble",
      "withings",
    ]),
    /unsupported Junction Link provider slugs: apple_health_kit, apple_healthkit, health_connect, samsung_health, accuchek_ble/u,
  );
});

test("Junction provider rejects explicit filters with no hosted Link providers", () => {
  assert.throws(
    () => createJunctionProvider(async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    }, {
      providerFilter: ["accuchek_ble", "health_connect"],
    }),
    /unsupported Junction Link provider slugs: accuchek_ble, health_connect/u,
  );
});

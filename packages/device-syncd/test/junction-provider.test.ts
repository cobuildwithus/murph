import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { JunctionError } from "@junction-api/sdk";
import { HistoricalPullCompleted as JunctionHistoricalPullCompletedSchema } from "@junction-api/sdk/serialization";
import {
  importDeviceProviderSnapshot,
  prepareDeviceProviderSnapshotImport,
} from "@murphai/importers";
import {
  buildJunctionBoundedFeatureIdentity,
} from "@murphai/importers/device-providers/junction";
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
import { resolveJunctionOrigin } from "@murphai/importers/device-providers/junction-origin";
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
import { normalizeConfiguredDeviceSyncJobInput } from "../src/provider-job-definitions.ts";

import { DeviceSyncError } from "../src/errors.ts";
import { isGoogleHealthFitbitMigrationCutoverReady } from "../src/fitbit-migration.ts";
import { JunctionTimeseriesProgressError } from "../src/junction-timeseries-progress.ts";
import { hasJunctionExtendedTimeseriesHistoryBackfillCoverage } from "../src/junction-historical-backfill-progress.ts";
import { HOSTED_EXECUTION_DEVICE_SYNC_PASS_JOB_LIMIT } from "../src/hosted-runtime.ts";
import { mergeStoredDeviceSyncMetadataPatch } from "../src/metadata.ts";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
} from "../src/public-account.ts";
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
  JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS,
  JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
  JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
} from "../src/junction-resources.ts";
import {
  isAllowedJunctionLinkHost,
  JUNCTION_DEFAULT_ALLOWED_LINK_HOSTS,
  JUNCTION_MAX_USER_PROVIDERS,
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

// A payload comfortably larger than the old 64KB inline cap. The cap was
// removed in P3; large inline payloads now import inline instead of dropping
// to a REST fallback or being chunked into durable jobs.
const DIRECT_WEBHOOK_JOB_LARGE_BYTES_FOR_TEST = 64_001;

function createAccount(overrides: Partial<Omit<DeviceSyncAccount, "credential">> & {
  credential?: DeviceSyncAccount["credential"];
} = {}): DeviceSyncAccount {
  return {
    id: "acct-junction-1",
    provider: "junction",
    externalAccountId: "junction-user-1",
    disconnectGeneration: 0,
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
      credentialMetadata: {},
    },
    displayName: "Junction",
    status: "active",
    scopes: [],
    accessTokenExpiresAt: null,
    metadata: {},
    connectedAt: "2026-04-03T00:00:00.000Z",
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function createStoredAccount(
  overrides: Partial<StoredDeviceSyncAccount> = {},
): StoredDeviceSyncAccount {
  const account = createAccount();

  return {
    ...account,
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
      credentialMetadata: {},
    },
    hostedObservedConnectionRevision: 0,
    hostedObservedTokenRevision: 0,
    hostedObservedTokenVersion: null,
    hostedObservedUpdatedAt: null,
    localConnectionRevision: 0,
    localTokenRevision: 0,
    ...overrides,
  };
}

function createJob(kind: string, payload: Record<string, unknown>): DeviceSyncJobRecord {
  return {
    id: `job-${kind}`,
    provider: "junction",
    accountId: "acct-junction-1",
    kind,
    payload,
    priority: 50,
    availableAt: "2026-04-03T00:00:00.000Z",
    attempts: 0,
    maxAttempts: 5,
    dedupeKey: null,
    status: "queued",
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
  };
}

function createJobFromInput(
  input: DeviceSyncJobInput,
  index = 0,
): DeviceSyncJobRecord {
  return {
    ...createJob(input.kind, input.payload ?? {}),
    id: `job-${input.kind}-${index}`,
    availableAt: input.availableAt ?? "2026-04-03T00:00:00.000Z",
    dedupeKey: input.dedupeKey ?? null,
    maxAttempts: input.maxAttempts ?? 5,
    priority: input.priority ?? 50,
  };
}

async function executeFullJobTimeseriesContinuations(input: {
  context: ProviderJobContext;
  initialResult: Awaited<ReturnType<typeof executeJunctionJob>>;
  provider: ReturnType<typeof createJunctionProvider>;
}): Promise<Awaited<ReturnType<typeof executeJunctionJob>>> {
  let result = input.initialResult;
  let metadataPatch = { ...(result.metadataPatch ?? {}) };
  let context = {
    ...input.context,
    account: {
      ...input.context.account,
      metadata: {
        ...input.context.account.metadata,
        ...(result.metadataPatch ?? {}),
      },
      nextReconcileAt: result.nextReconcileAt === undefined
        ? input.context.account.nextReconcileAt
        : result.nextReconcileAt,
    },
  };
  for (let index = 0; index < 2_000; index += 1) {
    const continuation = result.scheduledJobs?.find((job) =>
      job.payload?.timeseriesResourceCursor !== undefined
      || job.payload?.summaryResourceCursor !== undefined
      || job.payload?.summaryPhaseComplete === true
    );
    if (!continuation) {
      return {
        ...result,
        ...(Object.keys(metadataPatch).length > 0 ? { metadataPatch } : {}),
      };
    }
    result = await executeJunctionJob(
      input.provider,
      context,
      createJobFromInput(continuation, index),
    );
    metadataPatch = { ...metadataPatch, ...(result.metadataPatch ?? {}) };
    context = {
      ...context,
      account: {
        ...context.account,
        metadata: {
          ...context.account.metadata,
          ...(result.metadataPatch ?? {}),
        },
        nextReconcileAt: result.nextReconcileAt === undefined
          ? context.account.nextReconcileAt
          : result.nextReconcileAt,
      },
    };
  }
  throw new Error("Junction full-job timeseries continuation did not terminate.");
}

async function executeJunctionFullJob(
  provider: ReturnType<typeof createJunctionProvider>,
  context: ProviderJobContext,
  job: DeviceSyncJobRecord,
): Promise<Awaited<ReturnType<typeof executeJunctionJob>>> {
  const initialResult = await executeJunctionJob(provider, context, job);
  const terminalResult = await executeFullJobTimeseriesContinuations({
    context,
    initialResult,
    provider,
  });
  return {
    ...terminalResult,
    ...(
      initialResult.metadataPatch || terminalResult.metadataPatch
        ? {
            metadataPatch: {
              ...(initialResult.metadataPatch ?? {}),
              ...(terminalResult.metadataPatch ?? {}),
            },
          }
        : {}
    ),
  };
}

function assertConnectBackfillRetryWake(
  result: {
    nextReconcileAt?: string | null;
    scheduledJobs?: readonly DeviceSyncJobInput[];
  },
  retryAt: string,
): void {
  assert.equal(result.nextReconcileAt, retryAt);
  assert.equal((result.scheduledJobs ?? []).some((job) => job.kind === "backfill"), false);
}

function createJunctionProvider(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createJunctionDeviceSyncProvider>[0]> = {},
  historicalPullFetchImpl: typeof fetch | null = async () => createJsonResponse({ data: [] }),
) {
  return createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    pushSourceRecoveryEnabled: true,
    summaryResources: ["activity"],
    summaryBackfillDays: 2,
    timeseriesResources: [],
    fetchImpl: async (input, init) => {
      if (
        historicalPullFetchImpl
        && new URL(readUrl(input)).pathname === "/v2/introspect/historical_pull"
      ) {
        return historicalPullFetchImpl(input, init);
      }

      return fetchImpl(input, init);
    },
    ...overrides,
  });
}

function createHistoricalPullFetch(
  providers: Record<string, unknown>,
): typeof fetch {
  return async () => createJsonResponse({
    data: [{
      provider: providers,
      user_id: "junction-user-1",
    }],
  });
}

function createMixedGarminOuraActivityProvider(
  garminHistoricalStatus: "failure" | "success",
) {
  return createJunctionProvider(async (input) => {
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
            id: "provider-oura-1",
            slug: "oura",
            name: "Oura",
            status: "connected",
            resource_availability: { activity: true },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [
          { id: "garmin-activity-1", connectionId: "provider-garmin-1", steps: 4321 },
          { id: "oura-activity-1", connectionId: "provider-oura-1", steps: 1234 },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
  }, createHistoricalPullFetch({
    garmin: {
      not_pulled: [],
      pulled: {
        activity: {
          days_with_data: garminHistoricalStatus === "success" ? 1 : 0,
          ...(garminHistoricalStatus === "failure"
            ? { error_details: "Historical pull failed." }
            : {}),
          status: garminHistoricalStatus,
        },
      },
    },
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
  }));
}

function executeJunctionJob(
  provider: ReturnType<typeof createJunctionProvider>,
  context: ProviderJobContext,
  job: DeviceSyncJobRecord,
) {
  const executor = provider.jobExecutor;
  assert.ok(executor, "Junction provider should expose a job executor.");
  return executor.executeJob(context, job);
}

function createJunctionJobContext(overrides: Partial<ProviderJobContext> = {}): ProviderJobContext {
  const account = overrides.account ?? createAccount();

  return {
    account,
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async () => ({ imported: true }),
    upsertConnectionSource: (input) => ({
      id: "src-1",
      connectionId: account.id,
      ...input,
      displayName: input.displayName ?? null,
      resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
      lastErrorCode: input.lastErrorCode ?? null,
      lastErrorMessage: input.lastErrorMessage ?? null,
      firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
      lastDataAt: input.lastDataAt ?? null,
      createdAt: input.lastSeenAt,
      updatedAt: input.lastSeenAt,
    }),
    listConnectionSources: async (input = {}) => (account.sources ?? []).filter((source) =>
      (!input.sourceProviderSlug || source.sourceProviderSlug === input.sourceProviderSlug)
      && (!input.status || source.status === input.status)
    ),
    refreshAccountTokens: async () => account,
    logger: {},
    ...overrides,
  };
}

function createJunctionWorkoutSummary(
  workoutId: string,
  startAt = "2026-04-02T10:00:00.000Z",
): Record<string, unknown> {
  return {
    id: workoutId,
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    sourceInstanceId: "watch-1",
    startAt,
    endAt: new Date(Date.parse(startAt) + 30 * 60_000).toISOString(),
  };
}

function junctionWorkoutCandidateIdentity(workoutId: string): string {
  return buildJunctionBoundedFeatureIdentity(
    "workout_stream",
    createJunctionWorkoutSummary(workoutId),
  );
}

function readJunctionWorkoutProgressIdentities(
  payload: Record<string, unknown> | undefined,
): string[] {
  const encoded = payload?.workoutStreamCursor;
  if (typeof encoded !== "string") {
    assert.fail("expected encoded workout stream progress");
  }
  const parsed = JSON.parse(encoded) as { i?: unknown; v?: unknown };
  assert.equal(parsed.v, 1);
  const identities = parsed.i;
  if (!Array.isArray(identities)) {
    assert.fail("expected workout stream progress identities");
  }
  assert.equal(JSON.stringify(parsed), encoded);
  for (const identity of identities) {
    if (typeof identity !== "string") {
      assert.fail("expected a serialized workout stream identity");
    }
    const identityParts = JSON.parse(identity) as unknown;
    assert.equal(Array.isArray(identityParts), true);
    assert.equal((identityParts as unknown[]).length, 4);
  }
  return identities as string[];
}

function createJunctionWorkoutStreamTestProvider(input: {
  listWorkoutIds(indexRequest: number): readonly string[];
  listResponse?: (indexRequest: number) => Promise<Response> | Response;
  streamResponse?: (workoutId: string, streamRequest: number) => Promise<Response> | Response;
}) {
  let indexRequests = 0;
  let streamRequestCount = 0;
  const requestUrls: string[] = [];
  const streamRequests: string[] = [];
  const provider = createJunctionProvider(async (request) => {
    const parsed = new URL(readUrl(request));
    requestUrls.push(parsed.toString());
    if (parsed.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (parsed.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    if (parsed.pathname === "/v2/summary/workouts/junction-user-1") {
      indexRequests += 1;
      if (input.listResponse) {
        return input.listResponse(indexRequests);
      }
      return createJsonResponse({
        data: input.listWorkoutIds(indexRequests).map((workoutId) =>
          createJunctionWorkoutSummary(workoutId)
        ),
      });
    }
    if (parsed.pathname.startsWith("/v2/summary/")) {
      return createJsonResponse({ data: [] });
    }
    if (parsed.pathname.startsWith("/v2/timeseries/workouts/")) {
      const workoutId = decodeURIComponent(parsed.pathname.split("/")[4] ?? "");
      streamRequests.push(workoutId);
      streamRequestCount += 1;
      return input.streamResponse
        ? input.streamResponse(workoutId, streamRequestCount)
        : createJsonResponse({
            time: [1_775_131_200, 1_775_133_000],
            heartrate: [100, 160],
            distance: [0, 5_000],
          });
    }
    throw new Error(`Unexpected request: ${parsed.toString()}`);
  }, {
    summaryResources: [],
    timeseriesResources: ["workout_stream"],
  });

  return {
    provider,
    requestUrls,
    streamRequests,
  };
}

function createJunctionWorkoutStreamResourceJob(
  payload: Record<string, unknown> = {},
): DeviceSyncJobRecord {
  return createJob("resource", {
    resource: "workout_stream",
    resourceCategory: "timeseries",
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
    ...payload,
  });
}

function readScheduledWorkoutStreamContinuation(
  scheduledJobs: readonly DeviceSyncJobInput[] | undefined,
): DeviceSyncJobInput {
  return requireValue(
    scheduledJobs?.find((scheduled) => scheduled.kind === "resource"),
    "expected a workout stream continuation",
  );
}

function createConnectionSource(
  overrides: Omit<Partial<DeviceConnectionSourceRecord>, "firstSeenAt"> & {
    firstSeenAt?: string | null;
  } = {},
): DeviceConnectionSourceRecord {
  const { firstSeenAt, ...sourceOverrides } = overrides;
  return {
    id: "src-garmin",
    connectionId: "acct-junction-1",
    sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "garmin",
    }), "Garmin source key should be available."),
    sourceProviderSlug: "garmin",
    displayName: null,
    status: "connected",
    resourceAvailabilitySummary: { activity: true },
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-04-03T00:00:00.000Z",
    lastDataAt: null,
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    ...sourceOverrides,
    firstSeenAt: firstSeenAt ?? "2026-04-03T00:00:00.000Z",
  };
}

function createEmptyJunctionBackfillProvider(
  overrides: Partial<Parameters<typeof createJunctionDeviceSyncProvider>[0]> = {},
  historicalPullFetchImpl?: typeof fetch,
) {
  return createJunctionProvider(async (input) => {
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
              blood_oxygen: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, overrides, historicalPullFetchImpl);
}

function createHistoricalActivityProvider(
  sourceProviderSlug: string,
  historicalPullFetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createJunctionDeviceSyncProvider>[0]> = {},
) {
  return createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-source-1",
          name: "Historical source",
          resource_availability: { activity: true },
          slug: sourceProviderSlug,
          status: "connected",
        }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, overrides, historicalPullFetchImpl);
}

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
  assert.equal(
    requests
      .filter((url) => url.includes("/v2/timeseries/"))
      .every((url) => new URL(url).searchParams.get("start_date") === "2026-04-02"),
    true,
  );
  assert.equal(profileSearchParams.has("start_date"), false);
  assert.equal(profileSearchParams.has("end_date"), false);
  assert.equal(importedSnapshots.length, 1);

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
    JUNCTION_DEFAULT_TIMESERIES_RESOURCES.length * 7,
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
  assert.equal(importedSnapshots.length, 0);
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
        if (searchParams.get("start_date") === "2026-04-02") {
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
                timestamp: "2026-04-02T00:30:00.000Z",
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
  assert.equal(requests.length, 3);
  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(hourlyResult.scheduledJobs?.[0]?.payload, {
    emptyBackfillAttempts: 1,
    timeseriesCursor: "2026-04-02T01:00:00.000Z",
    timeseriesResourceCursor: "heartrate",
    timeseriesWindowHours: 1,
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-02T00:00:00.000Z",
  });
});

test.each([
  "glucose",
  "electrocardiogram_voltage",
] as const)("Junction direct %s units complete three-page grouped responses", async (resource) => {
  let pages = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname !== `/v2/timeseries/junction-user-1/${resource}/grouped`) {
      throw new Error(`Unexpected request: ${url.toString()}`);
    }
    pages += 1;
    return createJsonResponse({
      groups: {},
      ...(pages < 3 ? { next_cursor: `page-${pages + 1}` } : {}),
    });
  }, {
    summaryResources: [],
    timeseriesResources: [resource],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({ now: "2026-04-03T12:00:00.000Z" }),
    createJob("reconcile", {
      timeseriesCursor: "2026-04-02T00:00:00.000Z",
      timeseriesResourceCursor: resource,
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );

  assert.equal(pages, 3);
  assert.equal(result.scheduledJobs?.length ?? 0, 0);
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
    createJunctionJobContext(),
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
          resource_availability: { activity: true, blood_oxygen: true },
        }],
      });
    }
    if (url.includes("/v2/summary/activity/")) {
      return createJsonResponse({ data: [] });
    }
    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
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
    timeseriesResources: ["blood_oxygen"],
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
    timeseriesResourceCursor: "blood_oxygen",
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

function buildExpectedJunctionDedupeKey(
  kind: "backfill" | "reconcile",
  windowStart: string,
  windowEnd: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify(["junction", kind, windowStart, windowEnd]))
    .digest("hex");
}

function sha256ForTest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertJunctionWindowQuery(
  url: string,
  expectedStartDate: string,
  expectedEndDate: string,
): void {
  const searchParams = new URL(url).searchParams;
  assert.equal(searchParams.get("start_date"), expectedStartDate);
  assert.equal(searchParams.get("end_date"), expectedEndDate);
}

function requireJunctionConnectionHandler(provider: ReturnType<typeof createJunctionProvider>) {
  return requireValue(provider.connectionHandler, "Junction provider should expose a connection handler.");
}

function requireJunctionWebhookHandler(provider: ReturnType<typeof createJunctionProvider>) {
  return requireValue(provider.webhookHandler, "Junction provider should expose a webhook handler.");
}

function createJunctionSvixWebhook(input: {
  body: Record<string, unknown>;
  messageId?: string;
  secret?: string;
  signatureHeader?: (signature: string) => string;
  timestamp?: string;
}): { headers: Headers; rawBody: Buffer } {
  const messageId = input.messageId ?? "msg_test_123";
  const timestamp = input.timestamp ?? "1775155200";
  const secret = input.secret ?? "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==";
  const rawBody = Buffer.from(JSON.stringify(input.body));
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(Buffer.concat([Buffer.from(`${messageId}.${timestamp}.`), rawBody]))
    .digest("base64");

  return {
    headers: new Headers({
      "svix-id": messageId,
      "svix-timestamp": timestamp,
      "svix-signature": input.signatureHeader?.(signature) ?? `v1,${signature}`,
    }),
    rawBody,
  };
}

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

test("Junction REST diagnostic probes a compact resource without returning raw records", async () => {
  const seenUrls: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              timestamp: "2026-04-02T12:00:00.000Z",
              value: 97,
            }],
            provider_connection_id: "provider-garmin-1",
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "timeseries",
    now: "2026-04-03T12:00:00.000Z",
    resource: "blood_oxygen",
    sourceProviderSlug: "garmin",
    windowStart: "2026-04-02T10:15:30.000Z",
    windowEnd: "2026-04-03T11:45:00.000Z",
  });
  const probe = result.result as {
    request?: {
      endpoint?: string;
      queryParameterNames?: string[];
      resource?: string;
      sourceFiltered?: boolean;
      window?: Record<string, unknown>;
    };
    response?: { ok?: boolean; recordCount?: number; shape?: Record<string, unknown> };
  };

  assert.equal(result.provider, "junction");
  assert.equal(probe.request?.endpoint, "timeseries");
  assert.equal(probe.request?.resource, "blood_oxygen");
  assert.equal(probe.request?.sourceFiltered, true);
  assert.deepEqual(probe.request?.queryParameterNames, ["end_date", "provider", "start_date"]);
  assert.deepEqual(probe.request?.window, {
    windowStart: "2026-04-02T10:15:30.000Z",
    windowEnd: "2026-04-03T11:45:00.000Z",
  });
  assert.equal(probe.response?.ok, true);
  assert.equal(probe.response?.recordCount, 1);
  assert.equal(probe.response?.shape?.kind, "object");
  assert.equal(seenUrls.length, 1);
  const seenUrl = requireValue(seenUrls[0], "Junction diagnostic should issue one read request.");
  assert.equal(new URL(seenUrl).pathname, "/v2/timeseries/junction-user-1/blood_oxygen/grouped");
  assert.equal(new URL(seenUrl).searchParams.get("provider"), "garmin");
  assertJunctionWindowQuery(
    seenUrl,
    "2026-04-02T10:15:30.000Z",
    "2026-04-03T11:45:00.000Z",
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /junction-user-1|provider-garmin-1|97|garmin/u,
  );
});

test("Junction REST diagnostics dispatch a scoped historical pull trigger", async () => {
  const requests: { body: unknown; method: string; url: string }[] = [];
  const runTrigger = async (respond: () => Response) => {
    const provider = createJunctionProvider(async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: String(init?.method ?? "GET"),
        url: readUrl(input),
      });
      return respond();
    });
    const probeRest = provider.diagnostics?.probeRest;
    assert.ok(probeRest);

    return probeRest({
      account: createAccount(),
      endpoint: "trigger_historical_pull",
      now: "2026-07-24T12:00:00.000Z",
      resource: null,
      sourceProviderSlug: "Garmin",
    });
  };
  const readResponse = (result: Awaited<ReturnType<typeof runTrigger>>) =>
    (result.result as { response?: Record<string, unknown> }).response ?? {};

  const accepted = await runTrigger(() => createJsonResponse({ success: true }, 202));
  assert.equal(readResponse(accepted).ok, true);
  assert.equal(readResponse(accepted).accepted, true);
  assert.equal(readResponse(accepted).endpointUnavailable, false);
  assert.deepEqual(requests, [
    {
      body: { provider: "garmin", user_ids: ["junction-user-1"] },
      method: "POST",
      url: "https://api.sandbox.us.junction.com/v2/link/bulk_trigger_historical_pull",
    },
  ]);
  // The operator response must never carry the raw Junction user id.
  assert.doesNotMatch(JSON.stringify(accepted), /junction-user-1/u);

  requests.length = 0;
  const gated = await runTrigger(() => createJsonResponse({ detail: "not enabled" }, 403));
  assert.equal(readResponse(gated).ok, true);
  assert.equal(readResponse(gated).accepted, false);
  assert.equal(readResponse(gated).endpointUnavailable, true);

  requests.length = 0;
  const failed = await runTrigger(() => createJsonResponse({ detail: "boom" }, 500));
  assert.equal(readResponse(failed).ok, false);
  assert.equal(readResponse(failed).responseStatus, 500);
});

test("Junction REST diagnostics use date params for date-only summary resources", async () => {
  const seenUrls: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/menstrual_cycle/junction-user-1")) {
      return createJsonResponse({ menstrual_cycle: [] });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/electrocardiogram/junction-user-1")) {
      return createJsonResponse({ electrocardiogram: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["menstrual_cycle", "electrocardiogram"],
    timeseriesResources: [],
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  for (const resource of ["menstrual_cycle", "electrocardiogram"]) {
    await probeRest({
      account: createAccount(),
      endpoint: "summary",
      now: "2026-04-03T12:00:00.000Z",
      resource,
      windowStart: "2026-04-02T10:15:30.000Z",
      windowEnd: "2026-04-03T11:45:00.000Z",
    });
  }

  assert.equal(seenUrls.length, 2);
  for (const url of seenUrls) {
    assertJunctionWindowQuery(
      requireValue(url, "Junction summary diagnostic should issue one read request per resource."),
      "2026-04-02",
      "2026-04-03",
    );
  }
});

test("Junction maps the weight timeseries resource to the documented body_weight endpoint", async () => {
  const seenUrls: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url.includes("/v2/timeseries/junction-user-1/body_weight/grouped")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: [],
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  await probeRest({
    account: createAccount(),
    endpoint: "timeseries",
    now: "2026-04-03T12:00:00.000Z",
    resource: "weight",
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(seenUrls.length, 1);
  const seenUrl = requireValue(seenUrls[0], "Junction diagnostic should issue one read request.");
  assert.equal(new URL(seenUrl).pathname, "/v2/timeseries/junction-user-1/body_weight/grouped");
  assertJunctionWindowQuery(
    seenUrl,
    "2026-04-02T00:00:00.000Z",
    "2026-04-03T00:00:00.000Z",
  );
});

test("Junction REST diagnostic can force a bounded user data refresh", async () => {
  const seenRequests: Array<{ method: string; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const url = readUrl(input);
    seenRequests.push({
      method: init?.method ?? "GET",
      url,
    });

    if (url === "https://api.sandbox.us.junction.com/v2/user/refresh/junction-user-1?timeout=45") {
      return createJsonResponse({
        success: true,
        refreshed_sources: ["garmin.steps", "oura.activity"],
        in_progress_sources: ["garmin.sleep"],
        failed_sources: [
          { provider: "garmin", resource: "weight" },
          { provider: "oura", resource: "hrv" },
        ],
        user_id: "junction-user-1",
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "refresh",
    now: "2026-04-03T12:00:00.000Z",
    timeoutSeconds: 45,
  });
  const probe = result.result as {
    request?: {
      endpoint?: string;
      endpointKind?: string;
      method?: string;
      queryParameterNames?: string[];
      timeoutSeconds?: number | null;
    };
    response?: {
      failedSourceCount?: number;
      failedSources?: string[];
      inProgressSourceCount?: number;
      inProgressSources?: string[];
      ok?: boolean;
      refreshedSourceCount?: number;
      refreshedSources?: string[];
      success?: boolean | null;
    };
  };

  assert.equal(probe.request?.endpoint, "refresh");
  assert.equal(probe.request?.endpointKind, "junction_user_refresh");
  assert.equal(probe.request?.method, "POST");
  assert.deepEqual(probe.request?.queryParameterNames, ["timeout"]);
  assert.equal(probe.request?.timeoutSeconds, 45);
  assert.equal(probe.response?.ok, true);
  assert.equal(probe.response?.success, true);
  assert.equal(probe.response?.refreshedSourceCount, 2);
  assert.deepEqual(probe.response?.refreshedSources, ["source_1.steps", "source_2.activity"]);
  assert.equal(probe.response?.inProgressSourceCount, 1);
  assert.deepEqual(probe.response?.inProgressSources, ["source_1.sleep"]);
  assert.equal(probe.response?.failedSourceCount, 2);
  assert.deepEqual(probe.response?.failedSources, ["source_1.weight", "source_2.hrv"]);
  assert.deepEqual(seenRequests, [{
    method: "POST",
    url: "https://api.sandbox.us.junction.com/v2/user/refresh/junction-user-1?timeout=45",
  }]);
  assert.doesNotMatch(JSON.stringify(result), /junction-user-1|garmin|oura/u);
});

test("Junction REST diagnostic reports refresh failure details safely", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/refresh/junction-user-1?timeout=45") {
      return createJsonResponse({
        error: "invalid_request",
        message: "Refresh requires a connected source.",
        user_id: "junction-user-1",
      }, 400);
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "refresh",
    now: "2026-04-03T12:00:00.000Z",
    timeoutSeconds: 45,
  });
  const probe = result.result as {
    response?: {
      diagnostics?: Record<string, unknown>;
      errorCode?: string;
      ok?: boolean;
      responseStatus?: number | null;
      retryable?: boolean;
    };
  };

  assert.equal(probe.response?.ok, false);
  assert.equal(probe.response?.errorCode, "JUNCTION_API_REQUEST_FAILED");
  assert.equal(probe.response?.responseStatus, 400);
  assert.equal(probe.response?.retryable, false);
  assert.equal(probe.response?.diagnostics?.responseErrorCode, "invalid_request");
  assert.equal(probe.response?.diagnostics?.responseErrorDescription, "Refresh requires a connected source.");
  assert.equal(probe.response?.diagnostics?.requestEndpointKind, "junction_user_refresh");
  assert.deepEqual(Object.keys(probe.response?.diagnostics ?? {}).sort().includes("user_id"), false);
  assert.doesNotMatch(JSON.stringify(result), /junction-user-1|sk_us_test_123/u);
});

test("Junction REST diagnostic matrix compares metadata, introspection, and data reads safely", async () => {
  const seenUrls: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    seenUrls.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          source: {
            device_id: "source-device-1",
          },
          resource_availability: {
            steps: true,
          },
        }],
      });
    }

    if (url === "https://api.sandbox.us.junction.com/v2/user/junction-user-1/device") {
      return createJsonResponse([{
        id: "device-row-1",
        user_id: "junction-user-1",
        provider: "garmin",
        source_type: "watch",
        device_id: "source-device-1",
        device_manufacturer: "Garmin",
        device_model: "Fenix",
      }]);
    }

    const introspectionUrl = new URL(url);
    if (
      introspectionUrl.pathname === "/v2/introspect/resources"
      && introspectionUrl.searchParams.get("user_id") === "junction-user-1"
      && introspectionUrl.searchParams.get("user_limit") === "1"
      && [null, "garmin"].includes(introspectionUrl.searchParams.get("provider"))
    ) {
      return createJsonResponse({
        data: [{
          user_id: "junction-user-1",
          provider: {
            garmin: {
              steps: {
                sent_count: 1,
                oldest_data: "2026-04-02T00:00:00+00:00",
                newest_data: "2026-04-02T23:59:59+00:00",
                last_attempt: {
                  status: "success",
                  timestamp: "2026-04-03T00:00:00+00:00",
                },
              },
            },
          },
        }],
      });
    }

    if (
      introspectionUrl.pathname === "/v2/introspect/historical_pull"
      && introspectionUrl.searchParams.get("user_id") === "junction-user-1"
      && introspectionUrl.searchParams.get("user_limit") === "1"
      && [null, "garmin"].includes(introspectionUrl.searchParams.get("provider"))
    ) {
      return createJsonResponse({
        data: [{
          user_id: "junction-user-1",
          provider: {
            garmin: {
              not_pulled: [],
              pulled: {
                steps: {
                  days_with_data: 1,
                  range_start: "2026-04-02T00:00:00+00:00",
                  range_end: "2026-04-02T23:59:59+00:00",
                  status: "success",
                  timeline: {
                    scheduled_at: "2026-04-03T00:00:00+00:00",
                    started_at: "2026-04-03T00:00:01+00:00",
                    ended_at: "2026-04-03T00:00:02+00:00",
                  },
                },
              },
            },
          },
        }],
      });
    }

    const parsedUrl = new URL(url);
    if (
      parsedUrl.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped"
      && parsedUrl.searchParams.get("start_date") === "2026-04-02T00:00:00.000Z"
      && parsedUrl.searchParams.get("end_date") === "2026-04-03T00:00:00.000Z"
      && (
        parsedUrl.searchParams.get("provider") === null
        || parsedUrl.searchParams.get("provider") === "garmin"
      )
    ) {
      return createJsonResponse({
        groups: {
          garmin: [{
            source: {
              provider: "garmin",
              type: "watch",
            },
            data: [{
              end: "2026-04-02T12:05:00+00:00",
              start: "2026-04-02T12:00:00+00:00",
              unit: "%",
              value: 97,
            }],
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  }, null);
  const probeRest = provider.diagnostics?.probeRest;
  assert.ok(probeRest);

  const result = await probeRest({
    account: createAccount(),
    endpoint: "matrix",
    now: "2026-04-03T12:00:00.000Z",
    resource: "blood_oxygen",
    sourceProviderSlug: "garmin",
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  const matrix = result.result as {
    devices?: { response?: { deviceCount?: number; devices?: Array<Record<string, unknown>> } };
    historicalPull?: Array<{ response?: { pulledCount?: number; pulled?: Array<Record<string, unknown>> } }>;
    introspection?: Array<{ response?: { resourceCount?: number; resources?: Array<Record<string, unknown>> } }>;
    providers?: { response?: { sourceCount?: number } };
    reads?: Array<{
      request?: { sourceFiltered?: boolean };
      response?: { recordCount?: number };
    }>;
    request?: { resourceCount?: number; resources?: Array<Record<string, unknown>> };
  };

  assert.equal(matrix.request?.resourceCount, 1);
  assert.deepEqual(matrix.request?.resources, [{
    configuredResource: true,
    resource: "blood_oxygen",
    resourceCategory: "timeseries",
  }]);
  assert.equal(matrix.providers?.response?.sourceCount, 1);
  assert.equal(matrix.devices?.response?.deviceCount, 1);
  assert.equal(matrix.devices?.response?.devices?.[0]?.sourceKey, "source_1");
  assert.equal(matrix.devices?.response?.devices?.[0]?.sourceType, "watch");
  assert.equal(matrix.devices?.response?.devices?.[0]?.deviceIdPresent, true);
  assert.equal(matrix.devices?.response?.devices?.[0]?.manufacturerPresent, true);
  assert.equal(matrix.introspection?.[0]?.response?.resourceCount, 1);
  assert.equal(matrix.introspection?.[1]?.response?.resources?.[0]?.sentCount, 1);
  assert.equal(matrix.historicalPull?.[0]?.response?.pulledCount, 1);
  assert.equal(matrix.historicalPull?.[1]?.response?.pulled?.[0]?.daysWithData, 1);
  assert.deepEqual(matrix.reads?.map((entry) => [
    entry.request?.sourceFiltered,
    entry.response?.recordCount,
  ]), [
    [false, 1],
    [true, 1],
  ]);
  const parsedSeenUrls = seenUrls.map((url) => new URL(url));
  assert.deepEqual(parsedSeenUrls.map((url) => url.pathname).sort(), [
    "/v2/introspect/historical_pull",
    "/v2/introspect/historical_pull",
    "/v2/introspect/resources",
    "/v2/introspect/resources",
    "/v2/timeseries/junction-user-1/blood_oxygen/grouped",
    "/v2/timeseries/junction-user-1/blood_oxygen/grouped",
    "/v2/user/junction-user-1/device",
    "/v2/user/providers/junction-user-1",
  ].sort());
  const readUrls = parsedSeenUrls.filter((url) => url.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped");
  assert.equal(readUrls.length, 2);
  const unfilteredReadUrl = requireValue(
    readUrls.find((url) => !url.searchParams.has("provider")),
    "Junction matrix diagnostic should read the unfiltered resource.",
  );
  assertJunctionWindowQuery(
    unfilteredReadUrl.toString(),
    "2026-04-02T00:00:00.000Z",
    "2026-04-03T00:00:00.000Z",
  );
  const providerReadUrl = requireValue(
    readUrls.find((url) => url.searchParams.get("provider") === "garmin"),
    "Junction matrix diagnostic should read the provider-filtered resource.",
  );
  assertJunctionWindowQuery(
    providerReadUrl.toString(),
    "2026-04-02T00:00:00.000Z",
    "2026-04-03T00:00:00.000Z",
  );
  const introspectionProviders = parsedSeenUrls
    .filter((url) => url.pathname.startsWith("/v2/introspect/"))
    .map((url) => url.searchParams.get("provider") ?? "")
    .sort();
  assert.deepEqual(introspectionProviders, ["", "", "garmin", "garmin"]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /junction-user-1|provider-garmin-1|source-device-1|device-row-1|garmin|Garmin|Fenix|97/u,
  );
});

test("Junction backfill diagnostic rejects malformed requested windows without provider calls", async () => {
  const provider = createJunctionProvider(async () => {
    throw new Error("Junction diagnostic should reject malformed windows before provider calls");
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });
  const diagnoseBackfill = provider.diagnostics?.diagnoseBackfill;
  assert.ok(diagnoseBackfill);

  await assert.rejects(
    () => diagnoseBackfill({
      account: createAccount(),
      now: "2026-04-03T00:00:00.000Z",
      windowStart: "not-a-date",
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_DIAGNOSTIC_WINDOW_INVALID");
      return true;
    },
  );
});

test("Junction sparse calendar refresh threads strict completeness before canonical import", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: { water: true },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              calendarDate: "2026-04-02",
              end: "2026-04-02T08:01:00.000Z",
              id: "water-valid",
              start: "2026-04-02T08:00:00.000Z",
              value: 250,
            }, {
              calendarDate: "2026-04-02",
              end: "2026-04-02T09:01:00.000Z",
              id: "water-malformed",
              value: 125,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });
  let canonicalImportCalls = 0;

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-03T12:00:00.000Z",
        importSnapshot: async (snapshot) => {
          canonicalImportCalls += 1;
          normalizeJunctionSnapshot(snapshot as Parameters<typeof normalizeJunctionSnapshot>[0]);
          return { durableDeliveryAccepted: true };
        },
      }),
      createJob("resource", {
        calendarRefreshDay: "2026-04-02",
        resource: "water",
        resourceCategory: "timeseries",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
      }),
    ),
    (error: unknown) =>
      error instanceof Error
      && error.name === "JunctionSparseCalendarRepairNormalizationError",
  );
  assert.equal(canonicalImportCalls, 1);
});

test("Junction sparse calendar refresh rejects lossy collection parsing before canonical import", async () => {
  const validRow = {
    calendarDate: "2026-04-02",
    end: "2026-04-02T08:01:00.000Z",
    id: "water-valid",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    start: "2026-04-02T08:00:00.000Z",
    value: 250,
  };
  const cases: Array<{ label: string; payload: unknown }> = [{
    label: "grouped mixed valid and non-object samples",
    payload: {
      groups: {
        garmin: [{
          data: [validRow, null],
          source: { provider: "garmin", type: "watch" },
        }],
      },
    },
  }, {
    label: "grouped non-object group",
    payload: {
      groups: {
        garmin: [null],
      },
    },
  }, {
    label: "grouped nonempty collection with only invalid samples",
    payload: {
      groups: {
        garmin: [{
          data: [null],
          source: { provider: "garmin", type: "watch" },
        }],
      },
    },
  }, {
    label: "ungrouped mixed valid and non-object records",
    payload: [validRow, null],
  }];

  for (const testCase of cases) {
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);
      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-garmin-1",
            name: "Garmin",
            resource_availability: { water: true },
            slug: "garmin",
            status: "connected",
          }],
        });
      }
      if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
        return createJsonResponse(testCase.payload);
      }
      throw new Error(`Unexpected request: ${url}`);
    }, { timeseriesResources: ["water"] });
    let canonicalImportCalls = 0;

    await assert.rejects(
      executeJunctionJob(
        provider,
        createJunctionJobContext({
          now: "2026-04-03T12:00:00.000Z",
          importSnapshot: async () => {
            canonicalImportCalls += 1;
            return { durableDeliveryAccepted: true };
          },
        }),
        createJob("resource", {
          calendarRefreshDay: "2026-04-02",
          resource: "water",
          resourceCategory: "timeseries",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
        }),
      ),
      (error: unknown) =>
        error instanceof DeviceSyncError
        && error.code === "JUNCTION_CALENDAR_REFRESH_INCOMPLETE_NORMALIZATION"
        && error.retryable,
      testCase.label,
    );
    assert.equal(canonicalImportCalls, 0, testCase.label);
  }
});

test("Junction sparse calendar refresh admits the Apple Health alias cross-product", async () => {
  const appleHealthSlugs = ["apple_health_kit", "apple_health", "apple-healthkit"];
  for (const jobSourceProviderSlug of appleHealthSlugs) {
    for (const listedSourceProviderSlug of appleHealthSlugs) {
      for (const groupedSourceSlug of appleHealthSlugs) {
    const requests: string[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);
      requests.push(url);
      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-apple-health-1",
            name: "Apple Health",
            resource_availability: { water: true },
            slug: listedSourceProviderSlug,
            status: "connected",
          }],
        });
      }
      if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
        return createJsonResponse({
          groups: {
            fitbit: [{
              data: [{
                calendarDate: "2026-04-02",
                end: "2026-04-02T07:01:00.000Z",
                id: "unrelated-water",
                start: "2026-04-02T07:00:00.000Z",
                value: 999,
              }],
              source: { provider: "fitbit", type: "watch" },
            }],
            [groupedSourceSlug]: [{
              data: [{
                calendarDate: "2026-04-02",
                end: "2026-04-02T08:01:00.000Z",
                id: "apple-health-water",
                start: "2026-04-02T08:00:00.000Z",
                value: 250,
              }],
              source: { provider: groupedSourceSlug, type: "phone" },
            }],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, { timeseriesResources: ["water"] });
    const importedSnapshots: unknown[] = [];
    const establishedSource = createConnectionSource({
      sourceInstanceKey: `jxn_src_${listedSourceProviderSlug.replaceAll("-", "_")}`,
      sourceProviderSlug: listedSourceProviderSlug,
    });

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({
          sources: [{
            sourceProviderSlug: listedSourceProviderSlug,
            displayName: "Apple Health",
            status: "connected",
            resourceCount: 1,
            lastErrorCode: null,
            lastErrorMessage: null,
            firstSeenAt: "2026-04-01T00:00:00.000Z",
            lastSeenAt: "2026-04-03T00:00:00.000Z",
            lastDataAt: null,
          }],
        }),
        connectionSourceAdmissionMode: "listed_only",
        listConnectionSources: () => [establishedSource],
        now: "2026-04-03T12:00:00.000Z",
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          const normalized = normalizeJunctionSnapshot(
            snapshot as Parameters<typeof normalizeJunctionSnapshot>[0],
          );
          return {
            canonicalEventExternalRefResourceIds: (normalized.events ?? []).flatMap(
              (event) => event.externalRef ? [event.externalRef.resourceId] : [],
            ),
            durableDeliveryAccepted: true,
          };
        },
      }),
      createJob("resource", {
        calendarRefreshDay: "2026-04-02",
        resource: "water",
        resourceCategory: "timeseries",
        sourceProviderSlug: jobSourceProviderSlug,
        sourceType: "phone",
      }),
    );

    const records = (importedSnapshots[0] as {
      timeseries?: { water?: Array<Record<string, unknown>> };
    }).timeseries?.water;
    const label = `${jobSourceProviderSlug}/${listedSourceProviderSlug}/${groupedSourceSlug}`;
    assert.equal(records?.length, 1, label);
    assert.equal(records?.[0]?.value, 250, label);
    assert.equal(records?.[0]?.authoritativeEmptyCalendarSet, undefined);
    assert.equal(records?.[0]?.sourceProviderSlug, listedSourceProviderSlug.replaceAll("-", "_"));
    assert.equal(
      records?.[0]?.sourceInstanceId,
      resolveJunctionOrigin({
        sourceInstanceId: establishedSource.sourceInstanceKey,
        sourceProviderSlug: establishedSource.sourceProviderSlug,
      }).sourceInstanceId,
      label,
    );
    const timeseriesRequest = requests.find((url) => url.includes("/v2/timeseries/"));
    assert.equal(
      timeseriesRequest ? new URL(timeseriesRequest).searchParams.get("provider") : null,
      "apple_health_kit",
      label,
    );
      }
    }
  }
});

test("Junction precise sparse aliases project onto the established account source", async () => {
  const requests: string[] = [];
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const importedSnapshots: unknown[] = [];
  const establishedSource = createConnectionSource({
    sourceInstanceKey: "jxn_src_established_apple_health",
    sourceProviderSlug: "apple_health",
    resourceAvailabilitySummary: { water: true },
  });
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          name: "Apple Health",
          resource_availability: { water: true },
          slug: "apple-healthkit",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({
        groups: {
          apple_health_kit: [{
            data: [{
              calendarDate: "2026-04-02",
              end: "2026-04-02T08:01:00.000Z",
              id: "water-alias-revision",
              start: "2026-04-02T08:00:00.000Z",
              updatedAt: "2026-04-03T08:00:00.000Z",
              value: 250,
            }],
            source: { provider: "apple_health_kit", type: "phone" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        sources: [{
          sourceProviderSlug: establishedSource.sourceProviderSlug,
          displayName: "Apple Health",
          status: "connected",
          resourceCount: 1,
          lastErrorCode: null,
          lastErrorMessage: null,
          firstSeenAt: establishedSource.firstSeenAt,
          lastSeenAt: establishedSource.lastSeenAt,
          lastDataAt: null,
        }],
      }),
      connectionSourceAdmissionMode: "listed_only",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        const normalized = normalizeJunctionSnapshot(
          snapshot as Parameters<typeof normalizeJunctionSnapshot>[0],
        );
        return {
          canonicalEventCount: normalized.events?.length ?? 0,
          canonicalEventDayKeys: ["2026-04-02"],
          canonicalSparseCalendarTargets: (normalized.events ?? []).flatMap((event) =>
            event.dataOrigin?.sourceProviderSlug
              ? [{
                  dayKey: "2026-04-02",
                  sourceInstanceId: event.dataOrigin.sourceInstanceId,
                  sourceProviderSlug: event.dataOrigin.sourceProviderSlug,
                  sourceType: event.dataOrigin.sourceType,
                }]
              : []
          ),
          durableDeliveryAccepted: true,
        };
      },
      listConnectionSources: () => [establishedSource],
      now: "2026-04-03T12:00:00.000Z",
      upsertConnectionSource: (input) => {
        upserts.push(input);
        return createConnectionSource(input);
      },
    }),
    createJob("resource", {
      resource: "water",
      resourceCategory: "timeseries",
      sourceProviderSlug: "apple-healthkit",
      windowStart: "2026-04-02T08:00:00.000Z",
      windowEnd: "2026-04-02T09:00:00.000Z",
    }),
  );

  assert.equal(upserts[0]?.sourceInstanceKey, establishedSource.sourceInstanceKey);
  assert.equal(upserts[0]?.sourceProviderSlug, "apple_health");
  const preciseRecord = (importedSnapshots[0] as {
    timeseries?: { water?: Array<Record<string, unknown>> };
  }).timeseries?.water?.[0];
  assert.equal(preciseRecord?.sourceProviderSlug, "apple_health");
  const establishedSourceInstanceId = resolveJunctionOrigin({
    sourceInstanceId: establishedSource.sourceInstanceKey,
    sourceProviderSlug: establishedSource.sourceProviderSlug,
  }).sourceInstanceId;
  assert.equal(preciseRecord?.sourceInstanceId, establishedSourceInstanceId);
  assert.equal(result.scheduledJobs?.[0]?.payload?.sourceProviderSlug, "apple_health");
  assert.equal(result.scheduledJobs?.[0]?.payload?.sourceInstanceId, establishedSourceInstanceId);
  const timeseriesRequest = requireValue(
    requests.find((url) => url.includes("/v2/timeseries/")),
  );
  assert.equal(new URL(timeseriesRequest).searchParams.get("provider"), "apple_health_kit");
});

test("Junction route-equivalent persisted sources choose the earliest keyed authority", async () => {
  const importedSnapshots: unknown[] = [];
  const earliestSource = createConnectionSource({
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    sourceInstanceKey: "jxn_src_earliest_apple_health",
    sourceProviderSlug: "apple_health",
  });
  const laterSource = createConnectionSource({
    firstSeenAt: "2026-04-02T00:00:00.000Z",
    id: "src-apple-health-kit",
    sourceInstanceKey: "jxn_src_later_apple_health",
    sourceProviderSlug: "apple_health_kit",
  });
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          name: "Apple Health",
          resource_availability: { water: true },
          slug: "apple_health_kit",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({
        groups: {
          "apple-healthkit": [{
            data: [{
              end: "2026-04-02T08:01:00.000Z",
              id: "water-duplicate-source-authority",
              start: "2026-04-02T08:00:00.000Z",
              value: 250,
            }],
            source: { provider: "apple-healthkit", type: "phone" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      connectionSourceAdmissionMode: "listed_only",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
      listConnectionSources: () => [laterSource, earliestSource],
    }),
    createJob("resource", {
      resource: "water",
      resourceCategory: "timeseries",
      sourceProviderSlug: "apple-healthkit",
      windowStart: "2026-04-02T08:00:00.000Z",
      windowEnd: "2026-04-02T09:00:00.000Z",
    }),
  );
  const record = (importedSnapshots[0] as {
    timeseries?: { water?: Array<Record<string, unknown>> };
  }).timeseries?.water?.[0];
  assert.equal(record?.sourceProviderSlug, earliestSource.sourceProviderSlug);
  assert.equal(
    record?.sourceInstanceId,
    resolveJunctionOrigin({
      sourceInstanceId: earliestSource.sourceInstanceKey,
      sourceProviderSlug: earliestSource.sourceProviderSlug,
    }).sourceInstanceId,
  );
});

test.each([
  { label: "newest alias first", reverse: false },
  { label: "oldest identity first", reverse: true },
])("Junction retained calendar work obeys the newest alias lifecycle ($label)", async ({ reverse }) => {
  const establishedSource = createConnectionSource({
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    lastErrorCode: DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
    lastErrorMessage: "Disconnected",
    lastSeenAt: "2026-04-03T12:00:00.000Z",
    sourceInstanceKey: "jxn_src_established_apple_health",
    sourceProviderSlug: "apple_health",
    status: "disconnected",
  });
  const staleAlias = createConnectionSource({
    firstSeenAt: "2026-04-02T00:00:00.000Z",
    id: "src-stale-apple-health-kit",
    lastSeenAt: "2026-04-03T11:00:00.000Z",
    sourceInstanceKey: "jxn_src_stale_apple_health_kit",
    sourceProviderSlug: "apple_health_kit",
    status: "connected",
  });
  const orderSources = (
    identity: DeviceConnectionSourceRecord,
    alias: DeviceConnectionSourceRecord,
  ) => reverse ? [alias, identity] : [identity, alias];
  let sources = orderSources(establishedSource, staleAlias);
  let responseKind: "blocked" | "empty" | "nonempty" = "blocked";
  let providerCalls = 0;
  const importedSnapshots: unknown[] = [];
  const projectedSources: DeviceConnectionSourceRecord[] = [];
  const provider = createJunctionProvider(async (input) => {
    providerCalls += 1;
    if (responseKind === "blocked") {
      throw new Error("Disconnected retained work must not call Junction.");
    }
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          name: "Apple Health",
          resource_availability: { water: true },
          slug: "apple_health_kit",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse(responseKind === "empty"
        ? { groups: {} }
        : {
            groups: {
              apple_health_kit: [{
                data: [{
                  calendarDate: "2026-04-02",
                  end: "2026-04-02T08:01:00.000Z",
                  id: "water-after-reconnect",
                  start: "2026-04-02T08:00:00.000Z",
                  value: 250,
                }],
                source: { provider: "apple_health_kit", type: "phone" },
              }],
            },
          });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });
  const establishedSourceInstanceId = resolveJunctionOrigin({
    sourceInstanceId: establishedSource.sourceInstanceKey,
    sourceProviderSlug: establishedSource.sourceProviderSlug,
  }).sourceInstanceId;
  const context = createJunctionJobContext({
    connectionSourceAdmissionMode: "listed_only",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return {
        canonicalEventExternalRefResourceIds: [buildJunctionDailyTimeseriesAggregateResourceId({
          dayKey: "2026-04-02",
          resource: "water",
          sourceInstanceId: establishedSourceInstanceId,
          sourceProviderSlug: establishedSource.sourceProviderSlug,
          sourceType: "phone",
        })],
        durableDeliveryAccepted: true,
      };
    },
    listConnectionSources: () => sources,
    now: "2026-04-03T14:00:00.000Z",
    upsertConnectionSource: (input) => {
      const projected = createConnectionSource(input);
      projectedSources.push(projected);
      return projected;
    },
  });
  const job = createJob("resource", {
    calendarRefreshDay: "2026-04-02",
    resource: "water",
    resourceCategory: "timeseries",
    sourceInstanceId: establishedSourceInstanceId,
    sourceProviderSlug: "apple_health_kit",
    sourceType: "phone",
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-02T00:00:00.000Z",
  });

  await assert.rejects(
    executeJunctionJob(
      provider,
      context,
      job,
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_CALENDAR_REFRESH_SOURCE_AUTHORITY_UNAVAILABLE"
      && error.retryable,
  );
  assert.equal(providerCalls, 0);
  assert.equal(importedSnapshots.length, 0);

  const reconnectedAlias = createConnectionSource({
    ...staleAlias,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-04-03T13:00:00.000Z",
    status: "connected",
  });
  sources = orderSources(establishedSource, reconnectedAlias);
  responseKind = "empty";
  await executeJunctionJob(provider, context, job);
  responseKind = "nonempty";
  await executeJunctionJob(provider, context, job);

  assert.equal(providerCalls, 4);
  assert.equal(importedSnapshots.length, 2);
  assert.equal(projectedSources.length, 2);
  assert.ok(projectedSources.every((source) =>
    source.sourceInstanceKey === establishedSource.sourceInstanceKey
    && source.sourceProviderSlug === establishedSource.sourceProviderSlug
  ));
  const normalizedImports = importedSnapshots.map((snapshot) =>
    normalizeJunctionSnapshot(snapshot as Parameters<typeof normalizeJunctionSnapshot>[0])
  );
  assert.ok(normalizedImports.every((entry) =>
    entry.events?.every((event) => {
      const origin = event.dataOrigin;
      return origin !== undefined
        && origin.sourceInstanceId === establishedSourceInstanceId
        && origin.sourceProviderSlug === "apple-health";
    })
  ));
  assert.deepEqual(importedSnapshots.map((snapshot) =>
    (snapshot as { timeseries?: { water?: Array<{ value?: number }> } })
      .timeseries?.water?.map((record) => record.value)
  ), [[0], [250]]);
});

test("Junction routine, precise, and retained calendar writers share persisted source identity", async () => {
  const persistedSource = createConnectionSource({
    connectionId: "local-reminted-account",
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    sourceInstanceKey: "jxn_src_hosted_connection_apple_health",
    sourceProviderSlug: "apple_health",
    resourceAvailabilitySummary: { water: true },
  });
  const laterDuplicate = createConnectionSource({
    connectionId: "local-reminted-account",
    firstSeenAt: "2026-04-02T00:00:00.000Z",
    sourceInstanceKey: "jxn_src_later_duplicate_apple_health",
    sourceProviderSlug: "apple_healthkit",
    resourceAvailabilitySummary: { water: true },
  });
  const persistedSourceInstanceId = resolveJunctionOrigin({
    sourceInstanceId: persistedSource.sourceInstanceKey,
    sourceProviderSlug: persistedSource.sourceProviderSlug,
  }).sourceInstanceId;
  let phase: "routine" | "precise" | "repair" = "routine";
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          name: "Apple Health",
          resource_availability: { water: true },
          slug: phase === "routine"
            ? "apple-healthkit"
            : phase === "precise"
            ? "apple_health_kit"
            : "apple_health",
          status: "connected",
        }],
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/water/grouped") {
      const requestedDay = url.searchParams.get("start_date")?.slice(0, 10);
      const dayKey = phase === "routine" ? "2026-04-01" : "2026-04-02";
      const records = phase === "repair" && requestedDay === "2026-04-01"
        ? []
        : [{
            calendarDate: dayKey,
            end: `${dayKey}T08:01:00.000Z`,
            id: "water-shared-source-spine",
            start: `${dayKey}T08:00:00.000Z`,
            updatedAt: phase === "routine"
              ? "2026-04-02T08:00:00.000Z"
              : "2026-04-03T08:00:00.000Z",
            value: phase === "routine" ? 250 : 300,
          }];
      const groupSlug = phase === "routine"
        ? "apple_health_kit"
        : phase === "precise"
        ? "apple-healthkit"
        : "apple_health";
      return createJsonResponse({
        groups: {
          [groupSlug]: [{
            data: records,
            source: { provider: groupSlug, type: "phone" },
          }],
        },
      });
    }
    if (url.pathname.startsWith("/v2/summary/")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, { summaryResources: [], timeseriesResources: ["water"] });
  const context = createJunctionJobContext({
    account: createAccount({
      id: "local-reminted-account",
      sources: [{
        displayName: "Apple Health",
        firstSeenAt: persistedSource.firstSeenAt,
        lastDataAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: persistedSource.lastSeenAt,
        resourceCount: 1,
        sourceProviderSlug: persistedSource.sourceProviderSlug,
        status: "connected",
      }],
    }),
    connectionSourceAdmissionMode: "listed_only",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      const normalized = normalizeJunctionSnapshot(
        snapshot as Parameters<typeof normalizeJunctionSnapshot>[0],
      );
      const dayKeys = [...new Set((normalized.events ?? []).flatMap((event) =>
        event.dayKey ? [event.dayKey] : []
      ))];
      const source = normalized.events?.[0]?.dataOrigin;
      const precise = (snapshot as { timeseriesWindowKind?: string }).timeseriesWindowKind
        === "precise";
      return {
        canonicalEventCount: normalized.events?.length ?? 0,
        canonicalEventDayKeys: precise ? ["2026-04-01", "2026-04-02"] : dayKeys,
        canonicalEventExternalRefResourceIds: (normalized.events ?? []).flatMap((event) =>
          event.externalRef ? [event.externalRef.resourceId] : []
        ),
        canonicalSparseCalendarTargets: precise && source?.sourceProviderSlug
          ? ["2026-04-01", "2026-04-02"].map((dayKey) => ({
              dayKey,
              sourceInstanceId: source.sourceInstanceId,
              sourceProviderSlug: source.sourceProviderSlug,
              sourceType: source.sourceType,
            }))
          : undefined,
        durableDeliveryAccepted: true,
      };
    },
    listConnectionSources: () => [laterDuplicate, persistedSource],
    now: "2026-04-03T12:00:00.000Z",
    upsertConnectionSource: (input) => createConnectionSource({
      ...input,
      connectionId: "local-reminted-account",
    }),
  });

  await executeJunctionFullJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-02T00:00:00.000Z",
    }),
  );
  phase = "precise";
  const preciseResult = await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      resource: "water",
      resourceCategory: "timeseries",
      sourceProviderSlug: "apple-healthkit",
      windowStart: "2026-04-02T08:00:00.000Z",
      windowEnd: "2026-04-02T09:00:00.000Z",
    }),
  );
  phase = "repair";
  for (const [index, scheduledJob] of (preciseResult.scheduledJobs ?? []).entries()) {
    await executeJunctionJob(
      provider,
      context,
      createJob(scheduledJob.kind, {
        ...scheduledJob.payload,
        id: `job-retained-calendar-${index}`,
      }),
    );
  }

  const normalizedImports = importedSnapshots
    .filter((snapshot) =>
      (snapshot as { timeseries?: Record<string, unknown[]> }).timeseries?.water
    )
    .map((snapshot) => normalizeJunctionSnapshot(
      snapshot as Parameters<typeof normalizeJunctionSnapshot>[0],
    ));
  assert.equal(normalizedImports.length, 4);
  assert.deepEqual(
    [...new Set(normalizedImports.flatMap((entry) =>
      (entry.events ?? []).map((event) => event.dataOrigin?.sourceInstanceId)
    ))],
    [persistedSourceInstanceId],
  );
  assert.deepEqual(
    [...new Set(normalizedImports.flatMap((entry) =>
      (entry.events ?? []).map((event) => event.dataOrigin?.sourceProviderSlug)
    ))],
    ["apple-health"],
  );
  const initialDailyId = normalizedImports[0]?.events?.find(
    (event) => event.kind === "observation" && event.fields?.metric === "water",
  )?.externalRef?.resourceId;
  const repairedDailyId = normalizedImports[2]?.events?.find(
    (event) =>
      event.kind === "observation"
      && event.fields?.metric === "water"
      && event.dayKey === "2026-04-01",
  )?.externalRef?.resourceId;
  assert.ok(initialDailyId);
  assert.ok(repairedDailyId);
  assert.equal(repairedDailyId, initialDailyId);
  assert.deepEqual(
    (preciseResult.scheduledJobs ?? []).map((job) => job.payload?.sourceInstanceId),
    [persistedSourceInstanceId, persistedSourceInstanceId],
  );
});

const usefulHistoricalSummaryRecordByResource = {
  sleep: {
    id: "sleep-1",
    connectionId: "provider-garmin-1",
    startAt: "2026-04-02T01:00:00.000Z",
    endAt: "2026-04-02T08:00:00.000Z",
  },
  workouts: {
    id: "workouts-1",
    connectionId: "provider-garmin-1",
    startAt: "2026-04-02T12:00:00.000Z",
    durationMinutes: 45,
  },
  body: {
    id: "body-1",
    connectionId: "provider-garmin-1",
    weightKg: 72,
  },
} satisfies Record<"sleep" | "workouts" | "body", Record<string, unknown>>;

const usefulHistoricalSummaryCompletionCases = [
  {
    label: "activity floors",
    resource: "activity",
    record: {
      id: "activity-floors-1",
      connectionId: "provider-garmin-1",
      floorsClimbed: 8,
    },
  },
  {
    label: "body lean mass",
    resource: "body",
    record: {
      id: "body-lean-1",
      connectionId: "provider-garmin-1",
      leanBodyMassKg: 58.2,
    },
  },
  {
    label: "body waist circumference",
    resource: "body",
    record: {
      id: "body-waist-1",
      connectionId: "provider-garmin-1",
      waistCircumferenceCm: 82,
    },
  },
  {
    label: "meal raw-only",
    resource: "meal",
    record: {
      id: "meal-1",
      sourceProviderSlug: "garmin",
      mealType: "breakfast",
    },
  },
  {
    label: "menstrual cycle raw-only",
    resource: "menstrual_cycle",
    record: {
      id: "cycle-1",
      sourceProviderSlug: "garmin",
      cycleDay: 3,
    },
  },
] as const;

for (const testCase of usefulHistoricalSummaryCompletionCases) {
  test(`Junction ${testCase.label} summary historical backfill marks the historical window complete`, async () => {
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
                [testCase.resource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${testCase.resource}/junction-user-1`)) {
        return createJsonResponse({ data: [testCase.record] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [testCase.resource],
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
  });
}

test("Junction summary reads extract the documented top-level meals envelope", async () => {
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
              meal: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/meal/junction-user-1")) {
      return createJsonResponse({
        meals: [{
          id: "meal-doc-envelope-1",
          mealType: "breakfast",
          sourceProviderSlug: "garmin",
        }],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["meal"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
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

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
  };
  const mealRecord = snapshot.summaries?.meal?.[0];
  assert.equal(mealRecord?.id, "meal-doc-envelope-1");
  assert.equal(Object.hasOwn(mealRecord ?? {}, "meals"), false);
});

for (const testCase of [
  {
    label: "meal identity/debug-only",
    resource: "meal",
    record: {
      id: "meal-provenance-only",
      clientId: "provider-client-1",
      debug: true,
      fullName: "Raw Member Name",
      patientName: "Raw Patient Name",
      sourceProviderSlug: "garmin",
      status: "synced",
      items: [
        {
          subjectId: "raw-meal-subject-id",
          subject: {
            id: "raw-meal-nested-subject-id",
          },
        },
      ],
    },
  },
  {
    label: "menstrual cycle identity/contact-only",
    resource: "menstrual_cycle",
    record: {
      addressLine1: "123 Private Street",
      birthDate: "1980-01-01",
      dateOfBirth: "1980-01-01",
      dob: "1980-01-01",
      id: "cycle-identity-only",
      memberName: "Raw Member Name",
      provider_connection_id: "provider-garmin-1",
      sourceProviderSlug: "garmin",
      user: {
        id: "raw-cycle-user-id",
      },
      profile: {
        patient_id: "raw-cycle-patient-id",
      },
      symptoms: [
        {
          subjectId: "raw-cycle-subject-id",
          subjects: [
            {
              id: "raw-cycle-subjects-container-id",
            },
          ],
        },
      ],
    },
  },
] as const) {
  test(`Junction ${testCase.label} raw-only summary does not create a historical obligation`, async () => {
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
                [testCase.resource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${testCase.resource}/junction-user-1`)) {
        return createJsonResponse({ data: [testCase.record] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [testCase.resource],
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
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillEmptyAttempts: 0,
      junctionHistoricalBackfillLastEmptyAt: null,
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    });
    assert.equal(result.scheduledJobs, undefined);
    assert.equal(importedSnapshots.length, 1);
  });
}

for (const summaryResource of ["sleep", "workouts", "body"] as const) {
  test(`Junction ${summaryResource} summary historical backfill marks the historical window complete`, async () => {
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
                [summaryResource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${summaryResource}/junction-user-1`)) {
        return createJsonResponse({ data: [usefulHistoricalSummaryRecordByResource[summaryResource]] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [summaryResource],
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
  });
}

test("Junction sleep_cycle stage-count-only history stays pending without canonical evidence", async () => {
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
              heartrate: true,
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        data: [{
          id: "sleep-cycle-stage-count-only",
          provider_connection_id: "provider-garmin-1",
          stageCount: 4,
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
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
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertConnectBackfillRetryWake(result, "2026-04-03T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/sleep_cycle/")),
    "Junction sleep-cycle backfill should fetch REST summary data.",
  );
  assertJunctionWindowQuery(summaryRequest, "2026-04-01", "2026-04-02");
});

for (const summaryResource of ["activity", "sleep"] as const) {
  test(`Junction ${summaryResource} id-only historical backfill keeps the summary window retrying`, async () => {
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
                [summaryResource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${summaryResource}/junction-user-1`)) {
        return createJsonResponse({ data: [{ id: `${summaryResource}-1`, connectionId: "provider-garmin-1" }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [summaryResource],
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
}

const floatingSessionOnlySummaryRecordByResource = {
  sleep: {
    id: "sleep-1",
    connectionId: "provider-garmin-1",
    startAt: "2026-04-02T01:00:00",
    endAt: "2026-04-02T08:00:00",
  },
} satisfies Record<"sleep", Record<string, unknown>>;

for (const summaryResource of ["sleep"] as const) {
  test(`Junction ${summaryResource} floating session-only historical backfill keeps the summary window retrying`, async () => {
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
                [summaryResource]: true,
                heartrate: true,
              },
            },
          ],
        });
      }

      if (url.startsWith(`https://api.sandbox.us.junction.com/v2/summary/${summaryResource}/junction-user-1`)) {
        return createJsonResponse({ data: [floatingSessionOnlySummaryRecordByResource[summaryResource]] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: [summaryResource],
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
}

test("Junction useful summary without source linkage keeps the historical window retrying", async () => {
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
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", steps: 4321 }] });
    }
    throw new Error(`Unexpected request: ${url}`);
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

test("Junction floating-provider metric-only summary keeps the historical window retrying", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "freestyle_libre",
            name: "Freestyle Libre",
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
      return createJsonResponse({
        data: [{ id: "activity-1", sourceProviderSlug: "freestyle_libre", steps: 4321 }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
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

test("Junction source envelope summary historical backfill marks the historical window complete", async () => {
  const importedSnapshots: unknown[] = [];
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
      return createJsonResponse({
        data: [{
          sourceProviderSlug: "garmin",
          data: [{ id: "activity-1", steps: 4321 }],
        }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
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
});

test("Junction compact timeseries-only historical backfill keeps the summary window retrying", async () => {
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
              blood_oxygen: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      if (new URL(url).searchParams.get("start_date") !== "2026-04-02") {
        return createJsonResponse({ groups: {} });
      }
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              start: "2026-04-02T12:00:00.000Z",
              value: 97,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });

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

  assert.deepEqual(initialResult.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-04T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(initialResult.nextReconcileAt, "2026-04-04T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 0);
  const result = await executeFullJobTimeseriesContinuations({
    context,
    initialResult,
    provider,
  });
  assertConnectBackfillRetryWake(result, "2026-04-04T00:15:00.000Z");
  assert.equal(importedSnapshots.length, 1);
  const timeseriesSnapshot = importedSnapshots[0] as { summaries?: Record<string, unknown[]>; timeseries?: Record<string, unknown[]> };
  assert.deepEqual(timeseriesSnapshot.summaries, {});
  assert.equal(timeseriesSnapshot.timeseries?.blood_oxygen?.length, 1);
});

test("Junction connect-window timeseries continuation bypasses completed setup work", async () => {
  const ownerWindowStart = "2026-04-01T00:00:00.000Z";
  const ownerWindowEnd = "2026-04-03T00:00:00.000Z";
  const createProviderForRequests = (requests: string[]) =>
    createJunctionProvider(async (input) => {
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
                blood_oxygen: true,
              },
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
        return createJsonResponse({
          data: [{ id: "activity-1", sourceProviderSlug: "garmin", steps: 4321 }],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
        return createJsonResponse({
          groups: {
            garmin: [{
              data: [{
                start: new URL(url).searchParams.get("start_date"),
                value: 97,
              }],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    }, {
      timeseriesResources: ["blood_oxygen"],
    });

  const firstRequests: string[] = [];
  const firstImportedSnapshots: unknown[] = [];
  const initialJob = createJob("backfill", {
    windowStart: ownerWindowStart,
    windowEnd: ownerWindowEnd,
  });
  const firstResult = await executeJunctionJob(
    createProviderForRequests(firstRequests),
    createJunctionJobContext({
      now: "2026-04-04T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        firstImportedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    initialJob,
  );

  const continuation = requireValue(
    firstResult.scheduledJobs?.[0],
    "Yielded Junction backfill should schedule a continuation.",
  );
  assert.deepEqual(firstResult.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: ownerWindowStart,
    junctionHistoricalBackfillWindowEnd: ownerWindowEnd,
  });
  assert.deepEqual(continuation.payload, {
    windowStart: ownerWindowStart,
    windowEnd: ownerWindowEnd,
    timeseriesCursor: ownerWindowStart,
    timeseriesResourceCursor: "blood_oxygen",
  });
  assert.equal(
    continuation.dedupeKey,
    buildExpectedJunctionDedupeKey("backfill", ownerWindowStart, ownerWindowEnd),
  );
  assert.deepEqual(
    firstRequests
      .filter((url) => url.includes("/v2/timeseries/"))
      .map((url) => {
        const searchParams = new URL(url).searchParams;
        return [searchParams.get("start_date"), searchParams.get("end_date")];
      }),
    [],
  );

  const secondRequests: string[] = [];
  const secondImportedSnapshots: unknown[] = [];
  const provider = createProviderForRequests(secondRequests);
  const context = createJunctionJobContext({
    now: "2026-04-04T00:05:00.000Z",
    importSnapshot: async (snapshot) => {
      secondImportedSnapshots.push(snapshot);
      return { imported: true };
    },
  });
  const secondResult = await executeJunctionJob(
    provider,
    context,
    createJobFromInput(continuation),
  );

  assert.deepEqual(
    secondRequests
      .filter((url) => url.includes("/v2/timeseries/"))
      .map((url) => {
        const searchParams = new URL(url).searchParams;
        return [searchParams.get("start_date"), searchParams.get("end_date")];
      }),
    [["2026-04-01", "2026-04-01"]],
  );
  assert.equal(
    secondRequests.some((url) =>
      url.includes("/v2/user/providers/") || url.includes("/v2/summary/")
    ),
    false,
  );
  assert.equal(secondResult.metadataPatch, undefined);
  assert.deepEqual(secondResult.scheduledJobs?.[0]?.payload, {
    windowStart: ownerWindowStart,
    windowEnd: ownerWindowEnd,
    timeseriesCursor: "2026-04-02T00:00:00.000Z",
    timeseriesResourceCursor: "blood_oxygen",
  });
  assert.equal(secondImportedSnapshots.length, 1);

  const terminalResult = await executeFullJobTimeseriesContinuations({
    context,
    initialResult: secondResult,
    provider,
  });
  assert.equal(terminalResult.metadataPatch, undefined);
  assert.equal(terminalResult.scheduledJobs, undefined);
  assert.equal(secondImportedSnapshots.length, 2);
  assert.deepEqual(
    secondRequests
      .filter((url) => url.includes("/v2/timeseries/"))
      .map((url) => new URL(url).searchParams.get("start_date")),
    ["2026-04-01", "2026-04-02"],
  );

  const scheduledAfterCompletion = provider.jobExecutor?.createScheduledJobs?.(
    createStoredAccount({
      metadata: firstResult.metadataPatch ?? {},
    }),
    "2026-04-04T00:10:00.000Z",
  );
  assert.equal(
    scheduledAfterCompletion?.jobs.some((job) => job.kind === "backfill"),
    false,
  );
});

test("Junction profile-only historical backfill has no historical completion obligation", async () => {
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              profile: true,
              heartrate: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "profile-1", email: "person@example.test" }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
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
    junctionProfileSummaryCheckedAt: "2026-04-04T00:00:00.000Z",
    junctionProfileSummaryNormalizationRevision: 1,
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    requests.filter((url) => new URL(url).pathname.includes("/v2/summary/profile/")).length,
    1,
  );
  const profileRequest = requireValue(
    requests.find((url) => new URL(url).pathname.includes("/v2/summary/profile/")),
    "Junction profile-only backfill should fetch the profile current-state summary.",
  );
  const profileSearchParams = new URL(profileRequest).searchParams;
  assert.equal(profileSearchParams.has("start_date"), false);
  assert.equal(profileSearchParams.has("end_date"), false);
});

test("Junction reconcile refreshes a legacy profile marker once", async () => {
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          slug: "oura",
          name: "Oura Ring",
          status: "connected",
          resource_availability: { profile: true },
        }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({
        data: [{
          gender: "other",
          height: 181,
          updated_at: "2026-04-01T09:00:00Z",
          source: { provider: "oura", type: "ring" },
        }],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });
  const legacyAccount = createAccount({
    metadata: {
      junctionProfileSummaryCheckedAt: "2026-04-02T00:00:00.000Z",
    },
  });
  const job = createJob("reconcile", {
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  const firstResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: legacyAccount,
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    job,
  );

  assert.deepEqual(firstResult.metadataPatch, {
    junctionProfileSummaryCheckedAt: "2026-04-03T00:00:00.000Z",
    junctionProfileSummaryNormalizationRevision: 1,
  });
  const firstSnapshot = importedSnapshots[0] as {
    summaries?: Record<string, unknown[]>;
  };
  assert.deepEqual(firstSnapshot.summaries?.profile, [{
    gender: "other",
    height: 181,
    sourceProviderSlug: "oura",
    sourceType: "ring",
    updated_at: "2026-04-01T09:00:00Z",
  }]);

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          ...legacyAccount.metadata,
          ...firstResult.metadataPatch,
        },
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    job,
  );

  assert.equal(
    requests.filter((url) => new URL(url).pathname.includes("/v2/summary/profile/")).length,
    1,
  );
});

test("Junction scheduled polling skips profile after the current normalization marker", async () => {
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionProfileSummaryCheckedAt: "2026-04-02T00:00:00.000Z",
          junctionProfileSummaryNormalizationRevision: 1,
        },
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(requests.some((url) => new URL(url).pathname.includes("/v2/summary/profile/")), false);
  assert.equal(importedSnapshots.length, 1);
  assert.equal(result.metadataPatch, undefined);
});

test("Junction unproven historical coverage saturates at a daily retry without a reset marker", async () => {
  const provider = createEmptyJunctionBackfillProvider();
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
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
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 4,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(result.scheduledJobs, undefined);
  assertConnectBackfillRetryWake(result, "2026-04-04T00:00:00.000Z");
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.status, "connected");
  assert.equal(
    upserts.some((source) => source.lastErrorCode === "HISTORICAL_DATA_RECONNECT_REQUIRED"),
    false,
  );
});

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
      if (new URL(url).searchParams.get("start_date") !== "2026-04-02") {
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
      now: "2026-04-03T12:00:00.000Z",
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
  assert.deepEqual(
    importedSnapshots.flatMap((snapshot) => snapshot.timeseries?.blood_oxygen ?? [])
      .map((record) => record.id),
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
  const schedulerAccount = createStoredAccount({
    metadata: {
      junctionBloodPressureHistoryBackfillCoverage: "v1|omron",
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
    historicalWindowStart: "2026-03-18T00:00:00.000Z",
    resource: "blood_pressure",
    resourceCategory: "timeseries",
    sourceProviderSlug: "garmin",
    windowEnd: "2026-03-20T00:00:00.000Z",
    windowStart: "2026-03-18T00:00:00.000Z",
  });
  assert.equal(
    findScheduledHistoryJob("2026-04-04T00:00:00.000Z").dedupeKey,
    schedulerJob.dedupeKey,
  );

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
          junctionBloodPressureHistoryBackfillCoverage: "v1|omron",
        },
        sources: [garminSource],
      }),
      importSnapshot: async () => ({
        canonicalEventCount: 2,
        durableDeliveryAccepted: true,
      }),
    }),
    {
      ...createJob("resource", schedulerJob.payload ?? {}),
      dedupeKey: schedulerJob.dedupeKey ?? null,
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
            junctionBloodPressureHistoryBackfillCoverage: "v1|omron",
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
      1,
    ),
    true,
  );
  assert.equal(
    hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      scheduledResult.metadataPatch ?? {},
      "omron",
      "blood_pressure",
      1,
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

  assert.equal(garminKey, garminKeyAgain);
  assert.notEqual(garminKey, pelotonKey);
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

test("Junction provider proves source access only from explicit active statuses", async () => {
  const provider = createJunctionProvider(async (input) => {
    assert.equal(
      readUrl(input),
      "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1",
    );
    return createJsonResponse({
      data: [
        { slug: "source_connected", status: "connected" },
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
      ],
    });
  });
  const isSourceAccessActive = requireValue(
    provider.connectionHandler?.isSourceAccessActive,
  );

  for (const slug of [
    "source_connected",
    "source_active",
    "source_available",
    "source_ok",
  ]) {
    assert.equal(await isSourceAccessActive(createAccount(), slug), true);
  }
  for (const slug of [
    "source_unknown",
    "source_missing",
    "source_unrecognized",
    "source_error",
    "source_failed",
    "source_disconnected",
    "source_revoked",
    "source_inactive",
  ]) {
    assert.equal(await isSourceAccessActive(createAccount(), slug), false);
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
        { slug: "garmin", status: "error" },
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

function resolveJunctionTarget(providerSlug: string) {
  return JUNCTION_CONNECT_SOURCE_TARGETS.find((target) => target.providerSlug === providerSlug);
}

test("Junction createLinkToken accepts documented Link web URL hosts", async () => {
  const linkWebUrl = "https://link.tryvital.io/?token=link-token-1&env=sandbox&region=us";
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      assert.equal(readUrl(input), "https://api.sandbox.us.junction.com/v2/link/token");
      assert.equal(new Headers(init?.headers).get("x-vital-api-key"), "sk_us_test_123");
      return createJsonResponse({ link_web_url: linkWebUrl });
    },
  });

  const token = await client.createLinkToken({
    userId: "junction-user-1",
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
  });

  assert.equal(token.linkWebUrl, linkWebUrl);
  assert.equal(
    isAllowedJunctionLinkHost(new URL(token.linkWebUrl).hostname, JUNCTION_DEFAULT_ALLOWED_LINK_HOSTS),
    true,
  );
});

test("Junction historical-pull introspection matches the exact user without SDK release metadata and preserves future states", () => {
  const snapshot = parseJunctionHistoricalPullSnapshot({
    data: [
      {
        user_id: "junction-user-other",
        provider: {
          garmin: {
            not_pulled: [],
            pulled: {
              activity: {
                days_with_data: 10,
                status: "failure",
              },
            },
          },
        },
      },
      {
        user_id: "junction-user-1",
        provider: {
          oura: {
            not_pulled: ["sleep", "sleep"],
            pulled: {
              activity: {
                days_with_data: 0,
                range_end: "2026-04-03T00:00:00+00:00",
                range_start: "2026-04-03T00:00:00+00:00",
                status: "success",
              },
              sleep_cycle: {
                daysWithData: 3,
                errorDetails: "Provider is preparing this resource.",
                rangeEnd: "2026-04-03T00:00:00+00:00",
                rangeStart: "2026-04-01T00:00:00+00:00",
                status: "paused_by_provider",
              },
            },
          },
        },
      },
    ],
  }, "junction-user-1");

  assert.deepEqual(snapshot, {
    matchedUser: true,
    sources: [{
      notPulledResources: ["sleep"],
      pulledResources: [
        {
          daysWithData: 0,
          errorDetails: null,
          rangeEnd: "2026-04-03T00:00:00+00:00",
          rangeStart: "2026-04-03T00:00:00+00:00",
          resource: "activity",
          status: "success",
        },
        {
          daysWithData: 3,
          errorDetails: "Provider is preparing this resource.",
          rangeEnd: "2026-04-03T00:00:00+00:00",
          rangeStart: "2026-04-01T00:00:00+00:00",
          resource: "sleep_cycle",
          status: "paused_by_provider",
        },
      ],
      sourceProviderSlug: "oura",
    }],
  });

  assert.deepEqual(
    parseJunctionHistoricalPullSnapshot({
      data: [{ user_id: "junction-user-other", provider: {} }],
    }, "junction-user-1"),
    { matchedUser: false, sources: [] },
  );
});

test("Junction historical-pull introspection applies the optional provider filter at both request and parse boundaries", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input) => {
      const url = new URL(readUrl(input));
      assert.equal(url.origin, "https://api.sandbox.us.junction.com");
      assert.equal(url.pathname, "/v2/introspect/historical_pull");
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        provider: "garmin",
        user_id: "junction-user-1",
        user_limit: "2",
      });
      return createJsonResponse({
        data: [{
          user_id: "junction-user-1",
          provider: {
            garmin: {
              not_pulled: ["sleep"],
              pulled: {
                activity: {
                  days_with_data: 0,
                  status: "success",
                },
              },
            },
            oura: {
              not_pulled: [],
              pulled: {
                activity: {
                  days_with_data: 1,
                  status: "success",
                },
              },
            },
          },
        }],
      });
    },
  });

  const snapshot = await client.introspectHistoricalPull({
    sourceProviderSlug: "Garmin",
    userId: "junction-user-1",
    userLimit: 2,
  });

  assert.deepEqual(snapshot, {
    matchedUser: true,
    sources: [{
      notPulledResources: ["sleep"],
      pulledResources: [{
        daysWithData: 0,
        errorDetails: null,
        rangeEnd: null,
        rangeStart: null,
        resource: "activity",
        status: "success",
      }],
      sourceProviderSlug: "garmin",
    }],
  });
});

test("Junction historical-pull introspection rejects malformed envelopes as retryable", () => {
  assert.throws(
    () => parseJunctionHistoricalPullSnapshot({ data: {} }, "junction-user-1"),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_HISTORICAL_PULL_RESPONSE_INVALID");
      assert.equal(error.httpStatus, 502);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test("Junction createLinkToken sends selected OAuth provider for direct Link dispatch", async () => {
  const requests: unknown[] = [];
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      assert.equal(readUrl(input), "https://api.sandbox.us.junction.com/v2/link/token");
      requests.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
      return createJsonResponse({
        link_web_url: "https://link.junction.com/session/link-token-1",
      });
    },
  });

  await client.createLinkToken({
    userId: "junction-user-1",
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    provider: "Map-My-Fitness",
    providerFilter: ["garmin", "fitbit"],
  });

  const body = requests[0];
  assert.equal(
    typeof body === "object" && body !== null && "provider" in body
      ? body.provider
      : null,
    "map_my_fitness",
  );
  assert.equal(
    typeof body === "object" && body !== null && "filter_on_providers" in body,
    false,
  );
});

test("Junction client includes safe provider diagnostics for failed API requests", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      assert.equal(readUrl(input), "https://api.sandbox.us.junction.com/v2/link/token");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-vital-api-key"), "sk_us_test_123");
      assert.equal(headers.get("x-fern-sdk-name"), "@junction-api/sdk");
      assert.equal(headers.get("x-fern-sdk-version"), "1.2.0");
      return createJsonResponse({
        code: "invalid_request",
        message: "The link token request is missing a provider selection.",
      }, 400);
    },
  });

  await assert.rejects(
    () => client.createLinkToken({
      userId: "junction-user-sensitive",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback?code=secret",
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.equal(error.httpStatus, 502);
      assert.equal(error.message, "Junction API request failed for junction_link_token_create.");
      assert.deepEqual(error.details, {
        accountStatus: null,
        requestAuthKind: "provider_config_api_key_header",
        requestAuthPlacement: "headers",
        requestBodyFieldCount: 2,
        requestBodyFieldNames: "redirect_url.user_id",
        requestBodyKind: "json_object",
        requestContentType: "application_json",
        requestCredentialPresent: true,
        requestEndpointKind: "junction_link_token_create",
        requestMethod: "POST",
        requestQueryParameterCount: 0,
        requestQueryParameterNames: null,
        responseErrorCode: "invalid_request",
        responseErrorDescription: "The link token request is missing a provider selection.",
        responseErrorDescriptionFieldPresent: true,
        responseErrorFieldPresent: true,
        responseShapeKind: "json_object",
        retryable: false,
        status: 400,
      });
      const serialized = JSON.stringify(error);
      assert.equal(serialized.includes("sk_us_test_123"), false);
      assert.equal(serialized.includes("junction-user-sensitive"), false);
      assert.equal(serialized.includes("code=secret"), false);
      return true;
    },
  );
});

test("Junction client treats request timeouts as terminal aborts", async () => {
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    requestTimeoutMs: 1,
    fetchImpl: async (_input, init) => {
      requests += 1;
      const signal = init?.signal;
      assert.ok(signal);
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1"),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.equal(error.cause instanceof DOMException, true);
      assert.equal((error.cause as DOMException).name, "TimeoutError");
      return true;
    },
  );
  assert.equal(requests, 1);
});

test("Junction client wraps generic abort errors caused by request timeouts", async () => {
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    requestTimeoutMs: 1,
    fetchImpl: async (_input, init) => {
      requests += 1;
      const signal = init?.signal;
      assert.ok(signal);
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1"),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.equal(error.cause instanceof DOMException, true);
      assert.equal((error.cause as DOMException).name, "AbortError");
      return true;
    },
  );
  assert.equal(requests, 1);
});

test("Junction client rethrows caller aborts instead of wrapping them as provider failures", async () => {
  const abortController = new AbortController();
  const abortError = new Error("foreground yield");
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (_input, init) => {
      requests += 1;
      abortController.abort(abortError);
      const signal = init?.signal;
      assert.ok(signal);

      if (signal.aborted) {
        throw signal.reason;
      }

      throw new Error("request should have been aborted");
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1", {
      signal: abortController.signal,
    }),
    (error) => error === abortError,
  );
  assert.equal(requests, 1);
});

test("Junction client preserves caller abort reasons when fetch reports a generic AbortError", async () => {
  const abortController = new AbortController();
  const abortError = new Error("foreground yield");
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (_input, init) => {
      requests += 1;
      const signal = init?.signal;
      assert.ok(signal);

      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
        abortController.abort(abortError);
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1", {
      signal: abortController.signal,
    }),
    (error) => error === abortError,
  );
  assert.equal(requests, 1);
});

test("Junction client does not misclassify request timeouts as late caller aborts", async () => {
  const abortController = new AbortController();
  const abortError = new Error("foreground yield");
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    requestTimeoutMs: 1,
    fetchImpl: async (_input, init) => {
      requests += 1;
      const signal = init?.signal;
      assert.ok(signal);

      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            abortController.abort(abortError);
            reject(new DOMException("The operation was aborted.", "AbortError"));
          },
          { once: true },
        );
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1", {
      signal: abortController.signal,
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_API_REQUEST_FAILED");
      assert.notEqual(error.cause, abortError);
      assert.equal(error.cause instanceof DOMException, true);
      assert.equal((error.cause as DOMException).name, "AbortError");
      return true;
    },
  );
  assert.equal(requests, 1);
});

test("Junction client keeps GET retries in Murph and never retries writes", async () => {
  let getRequests = 0;
  const getClient = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      getRequests += 1;
      return new Response(JSON.stringify({ code: "unavailable" }), {
        status: 503,
        headers: {
          "content-type": "application/json",
          "retry-after": "0",
        },
      });
    },
  });

  await assert.rejects(
    () => getClient.listUserProviders("junction-user-1"),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_REQUEST_FAILED"
      && error.retryable,
  );
  assert.equal(getRequests, 3);

  let postRequests = 0;
  const postClient = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      postRequests += 1;
      return new Response(JSON.stringify({ code: "unavailable" }), {
        status: 503,
        headers: {
          "content-type": "application/json",
          "retry-after": "0",
        },
      });
    },
  });

  await assert.rejects(
    () => postClient.createLinkToken({
      userId: "junction-user-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    }),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_REQUEST_FAILED"
      && !error.retryable,
  );
  assert.equal(postRequests, 1);
});

test("Junction client uses the SDK typed result for an official connected-provider response", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => createJsonResponse({
      garmin: [{
        created_on: "2026-04-03T12:00:00+00:00",
        error_details: {
          error_message: "Provider token expired.",
          error_type: "token_refresh_failed",
          errored_at: "2026-04-03T12:00:00+00:00",
        },
        logo: "https://cdn.example.test/garmin.svg",
        name: "Garmin",
        resource_availability: {
          activity: { status: "available" },
        },
        slug: "garmin",
        status: "error",
      }],
    }),
  });

  const providers = await client.listUserProviders("junction-user-1");
  assert.equal(providers.length, 1);
  assert.deepEqual(providers[0]?.errorDetails, {
    errorMessage: "Provider token expired.",
    errorType: "token_refresh_failed",
    erroredAt: "2026-04-03T12:00:00.000Z",
  });
  assert.deepEqual(providers[0]?.resourceAvailability, {
    activity: { status: "available" },
  });
});

test("Junction client falls back to a bounded raw success only for a legacy sparse response", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => createJsonResponse({
      providers: [{
        name: "Garmin",
        resource_availability: { activity: true },
        slug: "garmin",
        status: "connected",
      }],
    }),
  });

  const providers = await client.listUserProviders("junction-user-1");
  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.slug, "garmin");
  assert.deepEqual(providers[0]?.resourceAvailability, { activity: true });
});

test("Junction client retries generic GET fetch failures but never retries generic write failures", async () => {
  let getRequests = 0;
  const getClient = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      getRequests += 1;
      throw new Error("temporary network failure");
    },
  });

  await assert.rejects(
    () => getClient.listUserProviders("junction-user-1"),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_REQUEST_FAILED"
      && error.retryable,
  );
  assert.equal(getRequests, 3);

  let postRequests = 0;
  const postClient = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      postRequests += 1;
      throw new Error("write network failure");
    },
  });

  await assert.rejects(
    () => postClient.createLinkToken({
      userId: "junction-user-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    }),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_REQUEST_FAILED"
      && !error.retryable,
  );
  assert.equal(postRequests, 1);
});

test("Junction client rejects malformed successful JSON without treating it as an empty response", async () => {
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      requests += 1;
      return new Response("{", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await assert.rejects(
    () => client.createLinkToken({
      userId: "junction-user-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    }),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_INVALID_JSON"
      && !error.retryable,
  );
  assert.equal(requests, 1);
});

test("Junction client rejects a declared response above the transport byte limit before reading it", async () => {
  let bodyCancelled = false;
  let requests = 0;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      requests += 1;
      return new Response(new ReadableStream<Uint8Array>({
        cancel() {
          bodyCancelled = true;
        },
      }), {
        status: 200,
        headers: {
          "content-length": String(32 * 1_024 * 1_024 + 1),
          "content-type": "application/json",
        },
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1"),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_RESPONSE_TOO_LARGE"
      && !error.retryable,
  );
  assert.equal(requests, 1);
  assert.equal(bodyCancelled, true);
});

test("Junction client errors and cancels a chunked response that crosses the transport byte limit", async () => {
  let bodyCancelled = false;
  let requests = 0;
  let chunkIndex = 0;
  const chunks = [
    new Uint8Array(32 * 1_024 * 1_024),
    new Uint8Array([0x20]),
  ];
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      requests += 1;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[chunkIndex];
          chunkIndex += 1;
          if (chunk) {
            controller.enqueue(chunk);
          }
        },
        cancel() {
          bodyCancelled = true;
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await assert.rejects(
    () => client.listUserProviders("junction-user-1"),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_API_RESPONSE_TOO_LARGE"
      && !error.retryable,
  );
  assert.equal(requests, 1);
  assert.equal(bodyCancelled, true);
});

test("Junction optional user lookup cancels unread 404 response bodies", async () => {
  let bodyCancelled = false;
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("provider detail that Murph must not read"));
      },
      cancel() {
        bodyCancelled = true;
      },
    }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  });

  assert.equal(await client.resolveUser("missing-client-user"), null);
  assert.equal(bodyCancelled, true);
});

test("Junction first-time SDK connection survives minified SDK error names", async () => {
  const originalName = Object.getOwnPropertyDescriptor(JunctionError, "name");
  const requests: Array<{ method: string; pathname: string }> = [];
  Object.defineProperty(JunctionError, "name", {
    configurable: true,
    value: "r",
  });

  try {
    const provider = createJunctionProvider(async (input, init) => {
      const pathname = new URL(readUrl(input)).pathname;
      requests.push({
        method: String(init?.method ?? "GET"),
        pathname: pathname.startsWith("/v2/user/resolve/")
          ? "/v2/user/resolve/:clientUserId"
          : pathname,
      });

      if (pathname.startsWith("/v2/user/resolve/")) {
        return new Response(null, { status: 404 });
      }
      if (pathname === "/v2/user") {
        return createJsonResponse({ user_id: "junction-user-1" });
      }
      if (pathname === "/v2/user/junction-user-1/sign_in_token") {
        return createJsonResponse({ sign_in_token: "junction-sign-in-token" });
      }
      throw new Error(`Unexpected request: ${pathname}`);
    });
    const handler = requireValue(
      provider.sdkConnectionHandler,
      "Junction provider should expose an SDK connection handler.",
    );

    const connection = await handler.ensureConnection({
      ownerId: "owner-internal-id-123",
      now: "2026-08-14T00:00:00.000Z",
    });
    const token = await handler.createSignInToken({
      externalAccountId: connection.externalAccountId,
    });

    assert.equal(connection.externalAccountId, "junction-user-1");
    assert.equal(token.signInToken, "junction-sign-in-token");
    assert.equal(token.environment, "sandbox");
    assert.deepEqual(requests, [
      { method: "GET", pathname: "/v2/user/resolve/:clientUserId" },
      { method: "POST", pathname: "/v2/user" },
      { method: "POST", pathname: "/v2/user/junction-user-1/sign_in_token" },
    ]);
  } finally {
    if (originalName) {
      Object.defineProperty(JunctionError, "name", originalName);
    }
  }
});

test("Junction optional user lookup keeps caller cancellation ahead of a minified 404", async () => {
  const originalName = Object.getOwnPropertyDescriptor(JunctionError, "name");
  const abortController = new AbortController();
  const abortReason = new Error("foreground yield");
  let bodyCancelled = false;
  let requests = 0;
  Object.defineProperty(JunctionError, "name", {
    configurable: true,
    value: "r",
  });

  try {
    const client = new JunctionClient({
      apiKey: "sk_us_test_123",
      environment: "sandbox",
      region: "us",
      fetchImpl: async () => {
        requests += 1;
        return new Response(new ReadableStream<Uint8Array>({
          cancel() {
            bodyCancelled = true;
            abortController.abort(abortReason);
          },
        }), { status: 404 });
      },
    });

    await assert.rejects(
      () => client.resolveUser("missing-client-user", {
        signal: abortController.signal,
      }),
      (error) => error === abortReason,
    );
    assert.equal(requests, 1);
    assert.equal(bodyCancelled, true);
  } finally {
    if (originalName) {
      Object.defineProperty(JunctionError, "name", originalName);
    }
  }
});

test("Junction client deregisters provider connections by normalized provider slug", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      requests.push({
        method: String(init?.method ?? "GET"),
        url: readUrl(input),
      });
      assert.equal(new Headers(init?.headers).get("x-vital-api-key"), "sk_us_test_123");
      return createJsonResponse({ success: true });
    },
  });

  await client.deregisterProvider({
    providerSlug: "Apple Health",
    userId: "junction-user-1",
  });

  assert.deepEqual(requests, [
    {
      method: "DELETE",
      url: "https://api.sandbox.us.junction.com/v2/user/junction-user-1/apple_health_kit",
    },
  ]);
});

test("Junction client rejects provider deregistration without a Junction user id", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      throw new Error("deregisterProvider should not send a request without a user id");
    },
  });

  await assert.rejects(
    () => client.deregisterProvider({
      providerSlug: "garmin",
      userId: "  ",
    }),
    /requires a Junction user id/u,
  );
});

test("automatic recovery stays inert until it is explicitly enabled", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`No request should be made while recovery is disabled: ${readUrl(input)}`);
  }, {
    // The vendor enables the trigger endpoint per team, so shipping the code and
    // switching it on are separate steps. Default-off is what lets this merge
    // before that request lands.
    pushSourceRecoveryEnabled: false,
  });
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );
  const stalledAccount = createStoredAccount({
    sources: [{
      displayName: "Garmin",
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastDataAt: "2026-07-18T00:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-07-20T00:00:00.000Z",
      resourceCount: 20,
      sourceProviderSlug: "garmin",
      status: "connected",
    }],
  });

  assert.equal(
    executor.createScheduledJobs?.(stalledAccount, "2026-07-20T00:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );
});

test("a stalled Garmin source automatically triggers a bounded historical pull", async () => {
  const requests: { body: unknown; url: string }[] = [];
  const provider = createJunctionProvider(async (input, init) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      url: readUrl(input),
    });
    return createJsonResponse({ success: true }, 202);
  });
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );
  const stalledAccount = createStoredAccount({
    sources: [
      {
        displayName: "Garmin",
        firstSeenAt: "2026-07-01T00:00:00.000Z",
        // Junction still lists the source and every resource as available; only
        // the arrival gap shows the carrier is dead.
        lastDataAt: "2026-07-18T00:00:00.000Z",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: "2026-07-20T00:00:00.000Z",
        resourceCount: 20,
        sourceProviderSlug: "garmin",
        status: "connected",
      },
    ],
  });

  // Detection alone restores nothing, so the scheduled pass must derive the
  // recovery attempt without any operator action.
  const scheduled = executor.createScheduledJobs?.(stalledAccount, "2026-07-20T00:00:00.000Z");
  const recoveryJob = scheduled?.jobs.find((job) => job.kind === "push_source_recovery");
  assert.ok(recoveryJob, "a stalled push-primary source must schedule its own recovery");
  assert.deepEqual(recoveryJob.payload, {
    silentSinceAt: "2026-07-18T00:00:00.000Z",
    sourceProviderSlug: "garmin",
  });

  // Every scheduled job crosses the configured-manifest enqueue boundary before
  // it is queued. An undeclared kind or payload field throws there, which would
  // discard the whole scheduled pass before any recovery ran.
  assert.deepEqual(
    normalizeConfiguredDeviceSyncJobInput("junction", {
      kind: recoveryJob.kind,
      payload: recoveryJob.payload ?? {},
    }, "scheduler"),
    {
      kind: "push_source_recovery",
      payload: {
        silentSinceAt: "2026-07-18T00:00:00.000Z",
        sourceProviderSlug: "garmin",
      },
    },
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: stalledAccount.sources }),
      now: "2026-07-20T00:00:00.000Z",
    }),
    createJob("push_source_recovery", recoveryJob.payload ?? {}),
  );

  assert.deepEqual(requests, [
    {
      body: { provider: "garmin", user_ids: ["junction-user-1"] },
      url: "https://api.sandbox.us.junction.com/v2/link/bulk_trigger_historical_pull",
    },
  ]);
  assert.deepEqual(result.metadataPatch, {
    junctionPushSourceRecoveryAttempts: 1,
    junctionPushSourceRecoveryLastAttemptAt: "2026-07-20T00:00:00.000Z",
    junctionPushSourceRecoveryLastFailureCode: null,
    junctionPushSourceRecoverySilentSinceAt: "2026-07-18T00:00:00.000Z",
    junctionPushSourceRecoverySourceProviderSlug: "garmin",
    junctionPushSourceRecoveryStatus: "triggered",
  });

  // A healthy source schedules nothing, and the recorded attempt keeps the
  // ladder from re-firing on the very next hourly pass.
  const healthyAccount = createStoredAccount({
    sources: [{
      displayName: "Garmin",
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastDataAt: "2026-07-19T23:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-07-20T00:00:00.000Z",
      resourceCount: 20,
      sourceProviderSlug: "garmin",
      status: "connected",
    }],
  });
  assert.equal(
    executor.createScheduledJobs?.(healthyAccount, "2026-07-20T00:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );

  const afterAttempt = createStoredAccount({
    metadata: result.metadataPatch as Record<string, unknown>,
    sources: stalledAccount.sources,
  });
  assert.equal(
    executor.createScheduledJobs?.(afterAttempt, "2026-07-20T01:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );
});

test("the executor carries prior attempts through to exhaustion", async () => {
  let triggerCalls = 0;
  const provider = createJunctionProvider(async () => {
    triggerCalls += 1;
    return createJsonResponse({ success: true }, 202);
  });
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );
  const staleSources = [{
    displayName: "Garmin",
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastDataAt: "2026-07-18T00:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-07-22T00:00:00.000Z",
    resourceCount: 20,
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }];
  // Three attempts already spent on this episode.
  const priorMetadata = {
    junctionPushSourceRecoveryAttempts: 3,
    junctionPushSourceRecoveryLastAttemptAt: "2026-07-20T16:00:00.000Z",
    junctionPushSourceRecoverySilentSinceAt: "2026-07-18T00:00:00.000Z",
    junctionPushSourceRecoverySourceProviderSlug: "garmin",
    junctionPushSourceRecoveryStatus: "triggered",
  };

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ metadata: priorMetadata, sources: staleSources }),
      now: "2026-07-22T16:00:00.000Z",
    }),
    createJob("push_source_recovery", {
      silentSinceAt: "2026-07-18T00:00:00.000Z",
      sourceProviderSlug: "garmin",
    }),
  );

  // Losing the prior count would leave every mutation at "attempt 1", so a
  // persistently silent source would trigger provider work forever.
  assert.equal(triggerCalls, 1);
  assert.equal(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryAttempts,
    4,
  );
  assert.equal(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryStatus,
    "exhausted",
  );

  const exhausted = createStoredAccount({
    metadata: { ...priorMetadata, ...(result.metadataPatch as Record<string, unknown>) },
    sources: staleSources,
  });
  assert.equal(
    executor.createScheduledJobs?.(exhausted, "2026-07-30T00:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );
});

test("a failed recovery trigger still burns its attempt instead of retrying forever", async () => {
  const staleGarminSources = [{
    displayName: "Garmin",
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastDataAt: "2026-07-18T00:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-07-20T00:00:00.000Z",
    resourceCount: 20,
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }];
  let triggerCalls = 0;
  const provider = createJunctionProvider(async () => {
    triggerCalls += 1;
    return createJsonResponse({ detail: "boom" }, 500);
  });
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: staleGarminSources }),
      now: "2026-07-20T00:00:00.000Z",
    }),
    createJob("push_source_recovery", {
      silentSinceAt: "2026-07-18T00:00:00.000Z",
      sourceProviderSlug: "garmin",
    }),
  );

  // Letting the failure escape would leave the episode at zero attempts, so the
  // next scheduled pass would derive the identical attempt again, forever.
  assert.equal(triggerCalls, 1);
  assert.equal(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryAttempts,
    1,
  );
  assert.equal(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryStatus,
    "triggered",
  );
  // The burned attempt stays diagnosable.
  assert.ok(
    (result.metadataPatch as Record<string, unknown>).junctionPushSourceRecoveryLastFailureCode,
  );

  const afterFailure = createStoredAccount({
    metadata: result.metadataPatch as Record<string, unknown>,
    sources: [{
      displayName: "Garmin",
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastDataAt: "2026-07-18T00:00:00.000Z",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-07-20T00:00:00.000Z",
      resourceCount: 20,
      sourceProviderSlug: "garmin",
      status: "connected",
    }],
  });

  // The next hourly pass must respect the ladder delay, not re-fire.
  assert.equal(
    executor.createScheduledJobs?.(afterFailure, "2026-07-20T01:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );
  assert.ok(
    executor.createScheduledJobs?.(afterFailure, "2026-07-20T06:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
  );
});

test("a recovery job whose episode already ended makes no provider call", async () => {
  let triggerCalls = 0;
  const provider = createJunctionProvider(async () => {
    triggerCalls += 1;
    return createJsonResponse({ success: true }, 202);
  });
  const recoveredSources = [{
    displayName: "Garmin",
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    // A webhook landed between scheduling and execution.
    lastDataAt: "2026-07-20T00:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-07-20T00:00:00.000Z",
    resourceCount: 20,
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: recoveredSources }),
      now: "2026-07-20T00:00:00.000Z",
    }),
    createJob("push_source_recovery", {
      silentSinceAt: "2026-07-18T00:00:00.000Z",
      sourceProviderSlug: "garmin",
    }),
  );

  // Triggering for an ended episode is an avoidable provider mutation, and
  // recording it would let the scheduler immediately fire again for the newer
  // episode.
  assert.equal(triggerCalls, 0);
  assert.deepEqual(result, {});
});

test("a gated recovery trigger pauses the episode and resumes after enablement", async () => {
  const provider = createJunctionProvider(async () =>
    createJsonResponse({ detail: "not enabled" }, 403)
  );
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );
  const staleSources = [{
    displayName: "Garmin",
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastDataAt: "2026-07-18T00:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-07-20T00:00:00.000Z",
    resourceCount: 20,
    sourceProviderSlug: "garmin",
    status: "connected" as const,
  }];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ sources: staleSources }),
      now: "2026-07-20T00:00:00.000Z",
    }),
    createJob("push_source_recovery", {
      silentSinceAt: "2026-07-18T00:00:00.000Z",
      sourceProviderSlug: "garmin",
    }),
  );

  // A gated call never reached the recovery mechanism, so it spends no attempt.
  assert.deepEqual(result.metadataPatch, {
    junctionPushSourceRecoveryAttempts: 0,
    junctionPushSourceRecoveryLastAttemptAt: "2026-07-20T00:00:00.000Z",
    junctionPushSourceRecoveryLastFailureCode: null,
    junctionPushSourceRecoverySilentSinceAt: "2026-07-18T00:00:00.000Z",
    junctionPushSourceRecoverySourceProviderSlug: "garmin",
    junctionPushSourceRecoveryStatus: "unavailable",
  });

  const gatedAccount = createStoredAccount({
    metadata: result.metadataPatch as Record<string, unknown>,
    sources: staleSources,
  });

  // Not re-probed immediately...
  assert.equal(
    executor.createScheduledJobs?.(gatedAccount, "2026-07-20T06:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
    undefined,
  );

  // ...but enablement is a vendor-side change we cannot observe, so a stall
  // seen before enablement must not be abandoned for the rest of its episode.
  assert.ok(
    executor.createScheduledJobs?.(gatedAccount, "2026-07-21T00:00:00.000Z")
      ?.jobs.find((job) => job.kind === "push_source_recovery"),
  );
});

test("Junction client triggers a historical pull for one source", async () => {
  const requests: { body: unknown; method: string; url: string }[] = [];
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: String(init?.method ?? "GET"),
        url: readUrl(input),
      });
      return createJsonResponse({ success: true }, 202);
    },
  });

  const result = await client.bulkTriggerHistoricalPull({
    sourceProviderSlug: "Garmin",
    userIds: ["junction-user-1", "junction-user-1", "  "],
  });

  assert.deepEqual(result, { accepted: true, endpointUnavailable: false });
  assert.deepEqual(requests, [
    {
      body: { provider: "garmin", user_ids: ["junction-user-1"] },
      method: "POST",
      url: "https://api.sandbox.us.junction.com/v2/link/bulk_trigger_historical_pull",
    },
  ]);
});

test("Junction client reports a gated historical pull trigger as unavailable rather than failing", async () => {
  for (const status of [403, 404]) {
    const client = new JunctionClient({
      apiKey: "sk_us_test_123",
      environment: "sandbox",
      region: "us",
      fetchImpl: async () => createJsonResponse({ detail: "not enabled" }, status),
    });

    // Link Migration endpoints are disabled per team by default. That is a
    // "ask support to enable it" answer, not a transport failure to retry.
    assert.deepEqual(
      await client.bulkTriggerHistoricalPull({
        sourceProviderSlug: "garmin",
        userIds: ["junction-user-1"],
      }),
      { accepted: false, endpointUnavailable: true },
    );
  }
});

test("Junction client surfaces real historical pull trigger failures", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => createJsonResponse({ detail: "boom" }, 500),
  });

  await assert.rejects(() => client.bulkTriggerHistoricalPull({
    sourceProviderSlug: "garmin",
    userIds: ["junction-user-1"],
  }));
});

test("Junction client rejects historical pull triggers without a source or user", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    fetchImpl: async () => {
      throw new Error("bulkTriggerHistoricalPull should not send an invalid request");
    },
  });

  await assert.rejects(
    () => client.bulkTriggerHistoricalPull({ sourceProviderSlug: " ", userIds: ["u"] }),
    /require a provider slug/u,
  );
  await assert.rejects(
    () => client.bulkTriggerHistoricalPull({ sourceProviderSlug: "garmin", userIds: ["  "] }),
    /require at least one user id/u,
  );
});

test("Junction client derives the API host from environment and region", async () => {
  const requests: string[] = [];
  const client = new JunctionClient({
    apiKey: "pk_eu_test_123",
    environment: "production",
    region: "eu",
    fetchImpl: async (input) => {
      requests.push(readUrl(input));
      return createJsonResponse({ user_id: "junction-user-1" });
    },
  });

  const user = await client.createUser("murph_test_client_user");

  assert.equal(user.userId, "junction-user-1");
  assert.deepEqual(requests, ["https://api.eu.junction.com/v2/user"]);
});

test("Junction createLinkToken rejects unexpected Link web URL hosts", async () => {
  assert.equal(isAllowedJunctionLinkHost("link.tryvital.io"), true);
  assert.equal(isAllowedJunctionLinkHost("tryvital.io"), true);
  assert.equal(isAllowedJunctionLinkHost(".tryvital.io"), false);
  assert.equal(isAllowedJunctionLinkHost("link.tryvital.io.example.test"), false);

  for (const linkWebUrl of [
    "https://link.example.test/session/link-token-1",
    "https://.tryvital.io/session/link-token-1",
    "https://link.tryvital.io.example.test/session/link-token-1",
    "http://link.tryvital.io/session/link-token-1",
  ]) {
    const client = new JunctionClient({
      apiKey: "sk_us_test_123",
      environment: "sandbox",
      region: "us",
      fetchImpl: async () => createJsonResponse({ link_web_url: linkWebUrl }),
    });

    await assert.rejects(
      () => client.createLinkToken({
        userId: "junction-user-1",
        callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      }),
      (error) => error instanceof DeviceSyncError
        && error.code === "JUNCTION_LINK_TOKEN_INVALID",
    );
  }
});

test("Junction createLinkToken honors configured allowed Link hosts", async () => {
  const createClient = (allowedLinkHosts: readonly string[]) => new JunctionClient({
    apiKey: "sk_us_test_123",
    environment: "sandbox",
    region: "us",
    allowedLinkHosts,
    fetchImpl: async () => createJsonResponse({
      link_web_url: "https://link.tryvital.io/?token=link-token-1&env=sandbox&region=us",
    }),
  });

  await assert.doesNotReject(() =>
    createClient(["tryvital.io"]).createLinkToken({
      userId: "junction-user-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    }));

  await assert.rejects(
    () => createClient(["junction.com"]).createLinkToken({
      userId: "junction-user-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    }),
    (error) => error instanceof DeviceSyncError
      && error.code === "JUNCTION_LINK_TOKEN_INVALID",
  );

  assert.throws(
    () => createClient([]),
    /Junction allowedLinkHosts must include at least one host/u,
  );
});

test("Junction beginConnection resolves or creates a namespaced user, returns Link URL, and seeds provider-config credentials", async () => {
  const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const url = readUrl(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null;
    requests.push({ body, headers, url });

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/user/resolve/")) {
      return createJsonResponse({ message: "missing" }, 404);
    }

    if (url === "https://api.sandbox.us.junction.com/v2/user") {
      return createJsonResponse({ user_id: "junction-user-1" });
    }

    if (url === "https://api.sandbox.us.junction.com/v2/link/token") {
      return createJsonResponse({ link_web_url: "https://link.junction.com/session/link-token-1" });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, { clientUserIdNamespace: "e2e" });

  const started = await requireJunctionConnectionHandler(provider).beginConnection({
    state: "state-1",
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    publicBaseUrl: "https://sync.example.test/device-sync",
    now: "2026-04-03T00:00:00.000Z",
    scopes: [],
    ownerId: "owner-internal-id-123",
  });

  assert.equal(started.authorizationUrl, "https://link.junction.com/session/link-token-1");
  assert.equal(started.connectionSeed?.externalAccountId, "junction-user-1");
  assert.equal(started.connectionSeed?.credential.kind, "provider_config");
  assert.equal(
    started.connectionSeed?.credential.kind === "provider_config"
      ? started.connectionSeed.credential.providerConfigKey
      : null,
    "junction",
  );
  assert.equal(started.connectionSeed?.setupPhase, "pending_link");
  assert.equal(started.connectionSeed?.setupExpiresAt, "2026-04-03T00:30:00.000Z");
  assert.deepEqual(started.connectionSeed?.metadata, undefined);
  assert.deepEqual(started.stateMetadata, undefined);

  const createUserBody = requests.find((request) => request.url.endsWith("/v2/user"))?.body;
  assert.deepEqual(createUserBody, {
    client_user_id: "murph_e2e_jnqpm4zu2il556kgyffrxn",
  });
  assert.doesNotMatch(JSON.stringify(createUserBody), /owner-internal-id-123/u);

  const linkBody = requests.find((request) => request.url.endsWith("/v2/link/token"))?.body;
  assert.equal(
    typeof linkBody === "object" && linkBody !== null && "redirect_url" in linkBody
      ? linkBody.redirect_url
      : null,
    "https://sync.example.test/device-sync/connect/junction/callback?murph_state=state-1",
  );
  assert.deepEqual(
    typeof linkBody === "object" && linkBody !== null && "filter_on_providers" in linkBody
      ? linkBody.filter_on_providers
      : null,
    JUNCTION_DEFAULT_PROVIDER_FILTER,
  );
  assert.doesNotMatch(JSON.stringify(linkBody), /apple|health_connect/u);
  assert.equal(requests.every((request) => request.headers.get("x-vital-api-key") === "sk_us_test_123"), true);
});

test("Junction maps legacy Fitbit and Google Health status identities to one visible source", () => {
  assert.equal(resolveDeviceConnectSourceIdForJunctionProviderSlug("fitbit"), "fitbit");
  assert.equal(resolveDeviceConnectSourceIdForJunctionProviderSlug("google_health"), "fitbit");
});

test("Junction beginConnection dispatches Fitbit through Google Health", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = [];
  const provider = createJunctionProvider(async (input, init) => {
    const url = readUrl(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null;
    requests.push({ body, method: init?.method ?? "GET", url });

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/user/resolve/")) {
      return createJsonResponse({ id: "junction-user-1" });
    }

    if (url === "https://api.sandbox.us.junction.com/v2/link/token") {
      return createJsonResponse({ link_web_url: "https://link.junction.com/session/link-token-1" });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  await requireJunctionConnectionHandler(provider).beginConnection({
    state: "state-1",
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    publicBaseUrl: "https://sync.example.test/device-sync",
    now: "2026-04-03T00:00:00.000Z",
    scopes: [],
    ownerId: "owner-internal-id-123",
    sourceProviderSlug: "google_health",
  });

  const linkBody = requests.find((request) => request.url.endsWith("/v2/link/token"))?.body;
  assert.equal(
    typeof linkBody === "object" && linkBody !== null && "provider" in linkBody
      ? linkBody.provider
      : null,
    "google_health",
  );
  assert.equal(
    typeof linkBody === "object" && linkBody !== null && "filter_on_providers" in linkBody,
    false,
  );
  assert.deepEqual(
    requests.map((request) => {
      const pathname = new URL(request.url).pathname;
      return [
        request.method,
        pathname.startsWith("/v2/user/resolve/") ? "/v2/user/resolve/:clientUserId" : pathname,
      ];
    }),
    [
      ["GET", "/v2/user/resolve/:clientUserId"],
      ["POST", "/v2/link/token"],
    ],
  );
});

test("Junction beginConnection rejects disabled source providers before external calls", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  await assert.rejects(
    () => requireJunctionConnectionHandler(provider).beginConnection({
      state: "state-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      publicBaseUrl: "https://sync.example.test/device-sync",
      now: "2026-04-03T00:00:00.000Z",
      scopes: [],
      ownerId: "owner-internal-id-123",
      sourceProviderSlug: "apple_health_kit",
    }),
    /Junction source provider is not enabled/u,
  );
});

test("Junction beginConnection rejects SDK-only source providers before external calls", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  await assert.rejects(
    () => requireJunctionConnectionHandler(provider).beginConnection({
      state: "state-1",
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      publicBaseUrl: "https://sync.example.test/device-sync",
      now: "2026-04-03T00:00:00.000Z",
      scopes: [],
      ownerId: "owner-internal-id-123",
      sourceProviderSlug: "accuchek_ble",
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_SOURCE_PROVIDER_NOT_CONFIGURED",
  );
});

test("Junction completeConnection treats Link callback as weak and enqueues scalar polling windows", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  const connection = await requireJunctionConnectionHandler(provider).completeConnection({
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    state: "state-1",
    seededExternalAccountId: "junction-user-1",
    query: new URLSearchParams({
      murph_state: "state-1",
      state: "success",
    }),
    now: "2026-04-03T00:00:00.000Z",
    grantedScopes: [],
  });

  assert.equal(connection.externalAccountId, "junction-user-1");
  assert.equal(connection.setupPhase, "link_returned");
  assert.deepEqual(connection.initialJobs?.map((job) => job.kind), ["backfill", "reconcile"]);
  assert.deepEqual(connection.initialJobs?.[0]?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  const payload = connection.initialJobs?.[0]?.payload as Record<string, unknown> | undefined;
  assert.equal(Array.isArray(payload?.resources), false);

  const sourceConnection = await requireJunctionConnectionHandler(provider).completeConnection({
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    state: "state-2",
    seededExternalAccountId: "junction-user-1",
    sourceProviderSlug: "fitbit",
    query: new URLSearchParams({
      murph_state: "state-2",
      state: "success",
    }),
    now: "2026-04-03T00:00:00.000Z",
    grantedScopes: [],
  });
  assert.deepEqual(sourceConnection.initialJobs?.[0]?.payload, {
    historicalProofFirstSeenAt: "2026-04-03T00:00:00.000Z",
    historicalProofSourceProviderSlug: "fitbit",
    sourceProviderSlug: "fitbit",
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.notEqual(
    sourceConnection.initialJobs?.[0]?.dedupeKey,
    connection.initialJobs?.[0]?.dedupeKey,
  );
  const sourceRecoveryWork = requireJunctionConnectionHandler(provider)
    .buildSourceConnectionWork?.({
      historicalProofAuthorization: {
        firstSeenAt: "2026-04-03T00:00:00.000Z",
        sourceProviderSlug: "fitbit",
      },
      now: "2026-04-03T00:00:00.000Z",
      sourceProviderSlug: "fitbit",
    });
  assert.deepEqual(sourceRecoveryWork, {
    initialJobs: sourceConnection.initialJobs,
    nextReconcileAt: sourceConnection.nextReconcileAt,
  });

  // Every initial job crosses the configured-manifest boundary inside the OAuth
  // callback handler before the connection is persisted. An undeclared payload
  // field throws there, failing the whole Link completion, so the source-scoped
  // payload must round-trip unchanged.
  for (const job of sourceConnection.initialJobs ?? []) {
    assert.deepEqual(
      normalizeConfiguredDeviceSyncJobInput("junction", {
        kind: job.kind,
        payload: job.payload ?? {},
      }, "oauth callback").payload,
      job.payload,
    );
  }
});

test("Junction source history identity follows the authorizing source epoch", () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const handler = requireJunctionConnectionHandler(provider);
  const buildWork = (firstSeenAt: string) => requireValue(
    handler.buildSourceConnectionWork?.({
      historicalProofAuthorization: {
        firstSeenAt,
        sourceProviderSlug: "google_health",
      },
      now: firstSeenAt,
      sourceProviderSlug: "fitbit",
    }),
    "Junction source connection work should be available.",
  );
  const sameDayFirst = buildWork("2026-04-03T01:00:00.000Z");
  const sameDaySecond = buildWork("2026-04-03T02:00:00.000Z");
  const crossDay = buildWork("2026-04-04T01:00:00.000Z");
  const backfills = [sameDayFirst, sameDaySecond, crossDay].map((work) =>
    requireValue(
      work.initialJobs?.find((job) => job.kind === "backfill"),
      "Source work should include one exact backfill.",
    )
  );

  assert.deepEqual(backfills.map((job) => job.payload), [
    {
      historicalProofFirstSeenAt: "2026-04-03T01:00:00.000Z",
      historicalProofSourceProviderSlug: "google_health",
      sourceProviderSlug: "fitbit",
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-01T00:00:00.000Z",
    },
    {
      historicalProofFirstSeenAt: "2026-04-03T02:00:00.000Z",
      historicalProofSourceProviderSlug: "google_health",
      sourceProviderSlug: "fitbit",
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-01T00:00:00.000Z",
    },
    {
      historicalProofFirstSeenAt: "2026-04-04T01:00:00.000Z",
      historicalProofSourceProviderSlug: "google_health",
      sourceProviderSlug: "fitbit",
      windowEnd: "2026-04-04T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    },
  ]);
  assert.equal(new Set(backfills.map((job) => job.dedupeKey)).size, 3);
});

test("Junction supersedes every stale authorization-bound history job shape", async () => {
  let importCount = 0;
  let providerRequestCount = 0;
  let sourceWriteCount = 0;
  const provider = createJunctionProvider(async (input) => {
    providerRequestCount += 1;
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const currentGoogleEpoch = "2026-04-03T02:00:00.000Z";
  const staleGoogleEpoch = "2026-04-03T01:00:00.000Z";
  const sources = [
    createConnectionSource({
      firstSeenAt: currentGoogleEpoch,
      id: "source-google-health",
      sourceProviderSlug: "google_health",
    }),
    createConnectionSource({
      firstSeenAt: "2025-01-01T00:00:00.000Z",
      id: "source-fitbit",
      sourceProviderSlug: "fitbit",
    }),
  ];
  const context = createJunctionJobContext({
    account: createAccount({
      sources: sources.map((source) => ({
        ...source,
        resourceCount: Object.keys(source.resourceAvailabilitySummary ?? {}).length,
      })),
    }),
    importSnapshot: async () => {
      importCount += 1;
      return { canonicalEventCount: 1, durableDeliveryAccepted: true };
    },
    listConnectionSources: async () => sources,
    upsertConnectionSource: (input) => {
      sourceWriteCount += 1;
      return createConnectionSource(input);
    },
  });
  const basePayload = {
    historicalProofFirstSeenAt: staleGoogleEpoch,
    historicalProofSourceProviderSlug: "google_health",
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-01T00:00:00.000Z",
  };
  const jobs = [
    createJob("backfill", {
      ...basePayload,
      sourceProviderSlug: "google_health",
    }),
    {
      ...createJob("backfill", {
        ...basePayload,
        sourceProviderSlug: "fitbit",
      }),
      leaseExpiresAt: "2026-04-03T02:05:00.000Z",
      leaseOwner: "worker-1",
      status: "running" as const,
    },
    createJob("backfill", {
      ...basePayload,
      emptyBackfillAttempts: 1,
      historicalProviderRecordsSeen: true,
      historicalRecordsSeen: true,
      sourceProviderSlug: "google_health",
    }),
    createJob("backfill", {
      ...basePayload,
      historicalProviderRecordsSeen: true,
      historicalRecordsSeen: true,
      sourceProviderSlug: "fitbit",
      timeseriesCursor: "2026-04-01T00:00:00.000Z",
      timeseriesResourceCursor: "steps",
    }),
    createJob("backfill", {
      ...basePayload,
      historicalProviderRecordsSeen: true,
      historicalRecordsSeen: true,
      sourceProviderSlug: "google_health",
      timeseriesCursor: "2026-04-01T00:00:00.000Z",
      timeseriesResourceCursor: "workout_stream",
      workoutStreamCursor: JSON.stringify({ i: ["workout-1"], v: 1 }),
    }),
  ];

  for (const job of jobs) {
    const result = await executeJunctionJob(provider, context, job);
    assert.equal(result.scheduledJobs?.length ?? 0, 0);
  }
  assert.equal(importCount, 0);
  assert.equal(providerRequestCount, 0);
  assert.equal(sourceWriteCount, 0);
});

test("Junction repeated authorization accepts only the current exact history proof", async () => {
  const firstEpoch = "2026-04-03T01:00:00.000Z";
  const currentEpoch = "2026-04-03T02:00:00.000Z";
  const completedAtKey = "historicalBackfillCompletedAt";
  let reauthorizeOnProviderRead = true;
  let liveSources = [
    createConnectionSource({
      firstSeenAt: firstEpoch,
      id: "source-google-health",
      lastDataAt: null,
      sourceProviderSlug: "google_health",
    }),
    createConnectionSource({
      firstSeenAt: "2025-01-01T00:00:00.000Z",
      id: "source-fitbit",
      sourceProviderSlug: "fitbit",
    }),
  ];
  const providers = [{
    id: "provider-google-health-1",
    name: "Google Health",
    resource_availability: { activity: true },
    slug: "google_health",
    status: "connected",
  }, {
    id: "provider-fitbit-1",
    name: "Fitbit",
    resource_availability: { activity: true },
    slug: "fitbit",
    status: "connected",
  }];
  const provider = createJunctionProvider(async (request) => {
    const url = new URL(readUrl(request));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      if (reauthorizeOnProviderRead) {
        reauthorizeOnProviderRead = false;
        liveSources = liveSources.map((source) =>
          source.sourceProviderSlug === "google_health"
            ? createConnectionSource({
                ...source,
                firstSeenAt: currentEpoch,
                lastDataAt: "2026-04-03T02:05:00.000Z",
                resourceAvailabilitySummary: { activity: true },
              })
            : source
        );
      }
      return createJsonResponse({ providers });
    }
    if (url.pathname.startsWith("/v2/summary/")) {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: [],
    timeseriesResources: [],
  });
  let completionWrites = 0;
  const context = createJunctionJobContext({
    account: createAccount({
      sources: liveSources.map((source) => ({
        ...source,
        resourceCount: Object.keys(source.resourceAvailabilitySummary ?? {}).length,
      })),
    }),
    connectionSourceAdmissionMode: "listed_only",
    listConnectionSources: async () => liveSources,
    now: "2026-04-03T03:00:00.000Z",
    upsertConnectionSource: async (update) => {
      const existingIndex = liveSources.findIndex((source) =>
        source.sourceProviderSlug === update.sourceProviderSlug
      );
      const existing = liveSources[existingIndex];
      const next = createConnectionSource({
        ...(existing ?? {}),
        ...update,
        firstSeenAt: update.firstSeenAt ?? existing?.firstSeenAt ?? update.lastSeenAt,
        id: existing?.id ?? `source-${update.sourceProviderSlug}`,
        lastDataAt: update.lastDataAt === undefined
          ? existing?.lastDataAt ?? null
          : update.lastDataAt,
        resourceAvailabilitySummary: update.resourceAvailabilitySummary
          ?? existing?.resourceAvailabilitySummary
          ?? {},
      });
      if (
        typeof existing?.resourceAvailabilitySummary?.[completedAtKey] !== "string"
        && typeof next.resourceAvailabilitySummary?.[completedAtKey] === "string"
      ) {
        completionWrites += 1;
      }
      liveSources = existingIndex < 0
        ? [...liveSources, next]
        : liveSources.map((source, index) => index === existingIndex ? next : source);
      return next;
    },
  });
  const job = (
    sourceProviderSlug: "fitbit" | "google_health",
    historicalProofFirstSeenAt?: string,
  ) => createJob("backfill", {
    ...(historicalProofFirstSeenAt
      ? {
          historicalProofFirstSeenAt,
          historicalProofSourceProviderSlug: "google_health",
        }
      : {}),
    sourceProviderSlug,
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-01T00:00:00.000Z",
  });

  await executeJunctionJob(provider, context, job("google_health", firstEpoch));
  await executeJunctionJob(provider, context, job("fitbit", firstEpoch));
  await executeJunctionJob(provider, context, job("google_health"));
  assert.equal(completionWrites, 0);
  assert.equal(isGoogleHealthFitbitMigrationCutoverReady({ sources: liveSources }), false);

  await executeJunctionJob(provider, context, job("google_health", currentEpoch));
  assert.equal(isGoogleHealthFitbitMigrationCutoverReady({ sources: liveSources }), false);
  await executeJunctionJob(provider, context, job("fitbit", currentEpoch));
  assert.equal(completionWrites, 2);
  assert.equal(isGoogleHealthFitbitMigrationCutoverReady({ sources: liveSources }), true);
});

test("Junction source-scoped history completes only after terminal admitted work", async () => {
  const completedAtKey = "historicalBackfillCompletedAt";

  const runScenario = async (input: {
    days: number;
    failFirstTimeseriesPass?: boolean;
    jobSourceProviderSlug?: "fitbit" | "google_health";
    now?: string;
    summaryRecordOnlyFirstAttempt?: boolean;
    summaryRecordSource?: "fitbit" | "google_health" | null;
    timeseriesRecordSource?: "fitbit" | "google_health" | null;
    timeseriesResources: readonly string[];
  }) => {
    const requests: Array<{ method: string; url: URL }> = [];
    let failTimeseries = input.failFirstTimeseriesPass === true;
    let summaryRequestCount = 0;
    const providers = [
      {
        id: "provider-fitbit-1",
        slug: "fitbit",
        name: "Fitbit",
        status: "connected",
        resource_availability: {
          activity: true,
          blood_oxygen: true,
          blood_pressure: true,
        },
      },
      {
        id: "provider-google-health-1",
        slug: "google_health",
        name: "Google Health",
        status: "connected",
        resource_availability: {
          activity: true,
          heartrate: true,
          steps: true,
        },
      },
    ];
    const provider = createJunctionProvider(async (request, init) => {
      const url = new URL(readUrl(request));
      requests.push({ method: String(init?.method ?? "GET"), url });
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers });
      }
      if (url.pathname === "/v2/summary/activity/junction-user-1") {
        summaryRequestCount += 1;
        const includeRecord = Boolean(input.summaryRecordSource)
          && (!input.summaryRecordOnlyFirstAttempt || summaryRequestCount === 1);
        return createJsonResponse({
          data: includeRecord
            ? [{
                connectionId: input.summaryRecordSource === "fitbit"
                  ? "provider-fitbit-1"
                  : "provider-google-health-1",
                date: "2026-04-02",
                id: `activity-${input.summaryRecordSource}`,
                sourceProviderSlug: input.summaryRecordSource,
                steps: 4321,
              }]
            : [],
        });
      }
      if (url.pathname === "/v2/summary/sleep/junction-user-1") {
        return createJsonResponse({ data: [] });
      }
      if (url.pathname === "/v2/summary/workouts/junction-user-1") {
        return createJsonResponse({ data: [] });
      }
      if (url.pathname.startsWith("/v2/timeseries/")) {
        if (failTimeseries) {
          return new Response(JSON.stringify({ error: "temporary failure" }), {
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "0",
            },
            status: 500,
          });
        }
        if (
          input.timeseriesRecordSource
          && url.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped"
        ) {
          return createJsonResponse({
            groups: {
              [input.timeseriesRecordSource]: [{
                data: [{
                  end: "2026-04-02T12:05:00.000Z",
                  start: "2026-04-02T12:00:00.000Z",
                  unit: "%",
                  value: 97,
                }],
                source: {
                  provider: input.timeseriesRecordSource,
                  type: "watch",
                },
              }],
            },
          });
        }
        if (
          input.timeseriesRecordSource
          && url.pathname === "/v2/timeseries/junction-user-1/blood_pressure/grouped"
        ) {
          return createJsonResponse({
            groups: {
              [input.timeseriesRecordSource]: [{
                data: [{
                  diastolic: 80,
                  systolic: 120,
                  timestamp: "2026-04-02T12:00:00.000Z",
                }],
                source: {
                  provider: input.timeseriesRecordSource,
                  type: "cuff",
                },
              }],
            },
          });
        }
        return createJsonResponse({ data: [] });
      }
      throw new Error(`Unexpected request: ${url.toString()}`);
    }, {
      summaryBackfillDays: input.days,
      summaryResources: ["activity", "sleep"],
      timeseriesBackfillDays: input.days,
      timeseriesResources: [...input.timeseriesResources],
    });

    let liveSources = [
      createConnectionSource({
        id: "source-fitbit",
        sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
          connectionId: "acct-junction-1",
          sourceProviderSlug: "fitbit",
        }), "Fitbit source key should be available."),
        sourceProviderSlug: "fitbit",
      }),
      createConnectionSource({
        id: "source-google-health",
        sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
          connectionId: "acct-junction-1",
          sourceProviderSlug: "google_health",
        }), "Google Health source key should be available."),
        sourceProviderSlug: "google_health",
      }),
    ];
    const importedSnapshots: unknown[] = [];
    let completionWrites = 0;
    const makeContext = (): ProviderJobContext => createJunctionJobContext({
      account: createAccount({
        sources: liveSources.map((source) => ({
          ...source,
          resourceCount: Object.keys(source.resourceAvailabilitySummary ?? {}).length,
        })),
      }),
      connectionSourceAdmissionMode: "listed_only",
      importSnapshot: async (snapshot) => {
        const junctionSnapshot = snapshot as Parameters<typeof normalizeJunctionSnapshot>[0];
        const normalized = normalizeJunctionSnapshot(junctionSnapshot, {
          defaultTimeZone: "UTC",
        });
        const events = normalized.events ?? [];
        if (events.length > 0) {
          importedSnapshots.push(snapshot);
        }
        return {
          canonicalEventCount: events.length,
          durableDeliveryAccepted: events.length > 0,
          junctionCanonicalCoverage: deriveJunctionCanonicalCoverageEvidence(events, {
            providerPulledAt: junctionSnapshot.canonicalCoverageProviderPulledAt,
          }),
        };
      },
      listConnectionSources: async (filter = {}) => liveSources.filter((source) =>
        (!filter.sourceProviderSlug
          || source.sourceProviderSlug === filter.sourceProviderSlug)
        && (!filter.status || source.status === filter.status)
      ),
      ...(input.now ? { now: input.now } : {}),
      upsertConnectionSource: async (update) => {
        const existingIndex = liveSources.findIndex((source) =>
          source.sourceProviderSlug === update.sourceProviderSlug
        );
        const existing = liveSources[existingIndex];
        const next = createConnectionSource({
          ...(existing ?? {}),
          ...update,
          id: existing?.id ?? `source-${update.sourceProviderSlug}`,
          connectionId: "acct-junction-1",
          displayName: update.displayName ?? existing?.displayName ?? null,
          firstSeenAt: update.firstSeenAt ?? existing?.firstSeenAt ?? update.lastSeenAt,
          lastDataAt: update.lastDataAt === undefined
            ? existing?.lastDataAt ?? null
            : update.lastDataAt,
          resourceAvailabilitySummary: update.resourceAvailabilitySummary
            ?? existing?.resourceAvailabilitySummary
            ?? {},
        });
        const wasComplete = existing?.resourceAvailabilitySummary?.[completedAtKey];
        const isComplete = next.resourceAvailabilitySummary?.[completedAtKey];
        if (!wasComplete && typeof isComplete === "string") {
          completionWrites += 1;
        }
        if (existingIndex < 0) {
          liveSources = [...liveSources, next];
        } else {
          liveSources = liveSources.map((source, index) =>
            index === existingIndex ? next : source
          );
        }
        return next;
      },
    });

    const windowEnd = "2026-04-03T00:00:00.000Z";
    const windowStart = new Date(
      Date.parse(windowEnd) - input.days * 24 * 60 * 60_000,
    ).toISOString();
    const jobSourceProviderSlug = input.jobSourceProviderSlug ?? "google_health";
    let job = createJob("backfill", {
      historicalProofFirstSeenAt: "2026-04-03T00:00:00.000Z",
      historicalProofSourceProviderSlug: "google_health",
      sourceProviderSlug: jobSourceProviderSlug,
      windowEnd,
      windowStart,
    });
    let processedJobs = 0;
    let failedExecutions = 0;
    let markerBeforePassBoundary = false;
    let terminalJob = job;

    for (let index = 0; index < 2_000; index += 1) {
      assert.equal(job.payload.sourceProviderSlug, jobSourceProviderSlug);
      let result: Awaited<ReturnType<typeof executeJunctionJob>>;
      try {
        result = await executeJunctionJob(provider, makeContext(), job);
      } catch (error) {
        if (!failTimeseries) {
          throw error;
        }
        failedExecutions += 1;
        failTimeseries = false;
        assert.equal(
          liveSources.find((source) => source.sourceProviderSlug === "google_health")
            ?.resourceAvailabilitySummary?.[completedAtKey],
          undefined,
        );
        // A fresh context models process restart before retrying the same durable job.
        continue;
      }
      processedJobs += 1;
      terminalJob = job;
      if (processedJobs === HOSTED_EXECUTION_DEVICE_SYNC_PASS_JOB_LIMIT) {
        markerBeforePassBoundary = liveSources.some((source) =>
          typeof source.resourceAvailabilitySummary?.[completedAtKey] === "string"
        );
      }
      const next = result.scheduledJobs?.[0];
      if (!next) {
        return {
          completionWrites,
          failedExecutions,
          importedSnapshots,
          liveSources,
          markerBeforePassBoundary,
          processedJobs,
          providerRequests: requests.filter(({ url }) =>
            url.pathname.includes("/summary/") || url.pathname.includes("/timeseries/")
          ),
          replayTerminal: async () =>
            executeJunctionJob(provider, makeContext(), terminalJob),
          requests,
        };
      }
      assert.equal(
        next.payload?.historicalProofFirstSeenAt,
        "2026-04-03T00:00:00.000Z",
      );
      assert.equal(
        next.payload?.historicalProofSourceProviderSlug,
        "google_health",
      );
      job = createJobFromInput(next, index);
    }
    throw new Error("Source-scoped Junction backfill did not terminate.");
  };

  const rejected = await runScenario({
    days: 2,
    summaryRecordOnlyFirstAttempt: true,
    summaryRecordSource: "fitbit",
    timeseriesResources: [],
  });
  const rejectedGoogle = rejected.liveSources.find((source) =>
    source.sourceProviderSlug === "google_health"
  );
  assert.equal(
    rejectedGoogle?.resourceAvailabilitySummary?.[completedAtKey],
    undefined,
  );
  assert.equal(
    rejected.liveSources.find((source) => source.sourceProviderSlug === "fitbit")
      ?.status,
    "connected",
  );
  assert.equal(rejected.importedSnapshots.length, 0);
  assert.equal(rejected.completionWrites, 0);

  const empty = await runScenario({
    days: 2,
    summaryRecordSource: null,
    timeseriesResources: [],
  });
  assert.equal(
    typeof empty.liveSources.find((source) =>
      source.sourceProviderSlug === "google_health"
    )?.resourceAvailabilitySummary?.[completedAtKey],
    "string",
  );
  assert.equal(empty.importedSnapshots.length, 0);
  assert.equal(empty.completionWrites, 1);

  const rebuiltLegacy = await runScenario({
    days: 2,
    jobSourceProviderSlug: "fitbit",
    summaryRecordSource: "fitbit",
    timeseriesResources: [],
  });
  const rebuiltLegacySummary = rebuiltLegacy.liveSources.find((source) =>
    source.sourceProviderSlug === "fitbit"
  )?.resourceAvailabilitySummary;
  assert.equal(typeof rebuiltLegacySummary?.[completedAtKey], "string");
  assert.equal(
    rebuiltLegacySummary?.canonicalCoverageBoundary_activity,
    "2026-04-02",
  );
  assert.equal(
    rebuiltLegacySummary?.canonicalCoverageFinalizedAt_activity,
    null,
  );

  const rebuiltLegacyClosed = await runScenario({
    days: 2,
    jobSourceProviderSlug: "fitbit",
    now: "2026-04-03T12:00:00.000Z",
    summaryRecordSource: "fitbit",
    timeseriesResources: [],
  });
  const rebuiltLegacyClosedSummary = rebuiltLegacyClosed.liveSources.find((source) =>
    source.sourceProviderSlug === "fitbit"
  )?.resourceAvailabilitySummary;
  assert.equal(
    rebuiltLegacyClosedSummary?.canonicalCoverageFinalizedAt_activity,
    "2026-04-03T12:00:00.000Z",
  );

  const rebuiltLegacyTimeseries = await runScenario({
    days: 2,
    jobSourceProviderSlug: "fitbit",
    now: "2026-04-03T12:00:00.000Z",
    summaryRecordSource: null,
    timeseriesRecordSource: "fitbit",
    timeseriesResources: ["blood_oxygen"],
  });
  const rebuiltLegacyTimeseriesSummary = rebuiltLegacyTimeseries.liveSources.find(
    (source) => source.sourceProviderSlug === "fitbit",
  )?.resourceAvailabilitySummary;
  assert.equal(typeof rebuiltLegacyTimeseriesSummary?.[completedAtKey], "string");
  assert.equal(
    rebuiltLegacyTimeseriesSummary?.canonicalCoverageBoundary_blood_oxygen,
    "2026-04-02",
  );
  assert.equal(
    rebuiltLegacyTimeseriesSummary?.canonicalCoverageFinalizedAt_blood_oxygen,
    "2026-04-03T12:00:00.000Z",
  );

  const rebuiltLegacyInterval = await runScenario({
    days: 2,
    jobSourceProviderSlug: "fitbit",
    summaryRecordSource: null,
    timeseriesRecordSource: "fitbit",
    timeseriesResources: ["blood_pressure"],
  });
  const rebuiltLegacyIntervalSummary = rebuiltLegacyInterval.liveSources.find(
    (source) => source.sourceProviderSlug === "fitbit",
  )?.resourceAvailabilitySummary;
  assert.equal(typeof rebuiltLegacyIntervalSummary?.[completedAtKey], "string");
  assert.equal(
    rebuiltLegacyIntervalSummary?.canonicalCoverageBoundary_blood_pressure,
    "2026-04-02T12:00:00.000Z",
  );

  const long = await runScenario({
    days: 60,
    failFirstTimeseriesPass: true,
    summaryRecordSource: "google_health",
    timeseriesResources: ["steps", "heartrate"],
  });
  assert.ok(
    long.processedJobs > HOSTED_EXECUTION_DEVICE_SYNC_PASS_JOB_LIMIT,
  );
  assert.equal(long.markerBeforePassBoundary, false);
  assert.equal(long.failedExecutions, 1);
  assert.equal(long.completionWrites, 1);
  assert.equal(long.importedSnapshots.length, 0);
  assert.equal(
    long.liveSources.find((source) => source.sourceProviderSlug === "fitbit")
      ?.status,
    "connected",
  );
  assert.ok(
    long.providerRequests.length > HOSTED_EXECUTION_DEVICE_SYNC_PASS_JOB_LIMIT,
  );
  for (const { url } of long.providerRequests) {
    assert.equal(url.searchParams.get("provider"), "google_health");
  }
  assert.equal(long.requests.some(({ method }) => method === "DELETE"), false);
  const stableKeys = long.liveSources.map((source) => source.sourceInstanceKey);
  await long.replayTerminal();
  assert.deepEqual(
    long.liveSources.map((source) => source.sourceInstanceKey),
    stableKeys,
  );
  assert.equal(long.importedSnapshots.length, 0);
});

test("Junction hosted bounded summaries finalize accepted Fitbit daily coverage", async () => {
  const now = "2026-04-03T12:00:00.000Z";
  const provider = createJunctionProvider(async (request) => {
    const url = new URL(readUrl(request));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-fitbit-1",
          slug: "fitbit",
          name: "Fitbit",
          status: "connected",
          resource_availability: { activity: true },
        }, {
          id: "provider-google-health-1",
          slug: "google_health",
          name: "Google Health",
          status: "connected",
          resource_availability: { activity: true },
        }],
      });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({
        data: [{
          connectionId: "provider-fitbit-1",
          date: "2026-04-02",
          id: "activity-fitbit-closed-day",
          sourceProviderSlug: "fitbit",
          steps: 4_321,
        }],
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });

  let liveSources = [
    createConnectionSource({
      id: "source-fitbit",
      resourceAvailabilitySummary: {
        activity: true,
        canonicalCoverageBoundary_activity: "2026-04-02",
      },
      sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
        connectionId: "acct-junction-1",
        sourceProviderSlug: "fitbit",
      }), "Fitbit source key should be available."),
      sourceProviderSlug: "fitbit",
    }),
    createConnectionSource({
      id: "source-google-health",
      sourceInstanceKey: requireValue(buildJunctionProviderSourceInstanceKey({
        connectionId: "acct-junction-1",
        sourceProviderSlug: "google_health",
      }), "Google Health source key should be available."),
      sourceProviderSlug: "google_health",
    }),
  ];
  const context = createJunctionJobContext({
    account: createAccount({
      sources: liveSources.map((source) => ({
        ...source,
        resourceCount: Object.keys(source.resourceAvailabilitySummary ?? {}).length,
      })),
    }),
    connectionSourceAdmissionMode: "listed_only",
    importSnapshot: async (snapshot) => {
      const junctionSnapshot = snapshot as Parameters<typeof normalizeJunctionSnapshot>[0];
      const events = normalizeJunctionSnapshot(junctionSnapshot, {
        defaultTimeZone: "UTC",
      }).events ?? [];
      return {
        canonicalEventCount: events.length,
        durableDeliveryAccepted: events.length > 0,
        junctionCanonicalCoverage: deriveJunctionCanonicalCoverageEvidence(events, {
          providerPulledAt: junctionSnapshot.canonicalCoverageProviderPulledAt,
        }),
      };
    },
    listConnectionSources: async (filter = {}) => liveSources.filter((source) =>
      (!filter.sourceProviderSlug || source.sourceProviderSlug === filter.sourceProviderSlug)
      && (!filter.status || source.status === filter.status)
    ),
    now,
    shouldYield: () => false,
    upsertConnectionSource: async (update) => {
      const existingIndex = liveSources.findIndex((source) =>
        source.sourceProviderSlug === update.sourceProviderSlug
      );
      const existing = liveSources[existingIndex];
      const next = createConnectionSource({
        ...(existing ?? {}),
        ...update,
        id: existing?.id ?? `source-${update.sourceProviderSlug}`,
        connectionId: "acct-junction-1",
        displayName: update.displayName ?? existing?.displayName ?? null,
        firstSeenAt: update.firstSeenAt ?? existing?.firstSeenAt ?? update.lastSeenAt,
        resourceAvailabilitySummary: update.resourceAvailabilitySummary
          ?? existing?.resourceAvailabilitySummary
          ?? {},
      });
      liveSources = existingIndex < 0
        ? [...liveSources, next]
        : liveSources.map((source, index) => index === existingIndex ? next : source);
      return next;
    },
  });

  await executeJunctionJob(provider, context, createJob("reconcile", {
    sourceProviderSlug: "fitbit",
    windowEnd: "2026-04-03T00:00:00.000Z",
    windowStart: "2026-04-02T00:00:00.000Z",
  }));

  const legacySummary = liveSources.find((source) =>
    source.sourceProviderSlug === "fitbit"
  )?.resourceAvailabilitySummary;
  assert.equal(legacySummary?.canonicalCoverageBoundary_activity, "2026-04-02");
  assert.equal(legacySummary?.canonicalCoverageFinalizedAt_activity, now);
});

test("Junction hosted bounded summaries enforce terminal Fitbit coverage on Google", async () => {
  const now = "2026-04-03T12:00:00.000Z";
  const provider = createJunctionProvider(async (request) => {
    const url = new URL(readUrl(request));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-google-health-1",
          slug: "google_health",
          name: "Google Health",
          status: "connected",
          resource_availability: { activity: true },
        }],
      });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({
        data: [{
          connectionId: "provider-google-health-1",
          date: "2026-04-02",
          id: "activity-google-overlap",
          sourceProviderSlug: "google_health",
          steps: 4_321,
        }],
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });
  const sources = [
    createConnectionSource({
      id: "source-fitbit",
      lastErrorCode: null,
      resourceAvailabilitySummary: {
        activity: true,
        canonicalCoverageBoundary_activity: "2026-04-02",
      },
      sourceProviderSlug: "fitbit",
      status: "disconnected",
    }),
    createConnectionSource({
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      id: "source-google-health",
      lastDataAt: "2026-04-03T01:00:00.000Z",
      resourceAvailabilitySummary: {
        activity: true,
        historicalBackfillCompletedAt: "2026-04-03T00:30:00.000Z",
      },
      sourceProviderSlug: "google_health",
    }),
  ];
  const importedSnapshots: JunctionSnapshotInput[] = [];
  let canonicalEventCount = -1;
  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        sources: sources.map((source) => ({
          ...source,
          resourceCount: Object.keys(source.resourceAvailabilitySummary ?? {}).length,
        })),
      }),
      connectionSourceAdmissionMode: "listed_only",
      importSnapshot: async (snapshot) => {
        const importedSnapshot = snapshot as Parameters<typeof normalizeJunctionSnapshot>[0];
        importedSnapshots.push(importedSnapshot);
        canonicalEventCount = normalizeJunctionSnapshot(importedSnapshot, {
          defaultTimeZone: "UTC",
        }).events?.length ?? 0;
        return {
          canonicalEventCount,
          durableDeliveryAccepted: canonicalEventCount > 0,
        };
      },
      listConnectionSources: async (filter = {}) => sources.filter((source) =>
        (!filter.sourceProviderSlug || source.sourceProviderSlug === filter.sourceProviderSlug)
        && (!filter.status || source.status === filter.status)
      ),
      now,
      shouldYield: () => false,
    }),
    createJob("reconcile", {
      sourceProviderSlug: "google_health",
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );

  const importedSnapshot = requireValue(
    importedSnapshots[0],
    "Bounded Google summary should reach the canonical importer.",
  );
  assert.deepEqual(importedSnapshot.canonicalCoverageFence, {
    coverageBoundaryByResource: { activity: "2026-04-02" },
    sourceProviderSlug: "google_health",
  });
  assert.equal(importedSnapshot.canonicalCoverageProviderPulledAt, now);
  assert.equal(canonicalEventCount, 0);
});

test("Junction scheduled polling uses stable closed-day windows", () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const executor = requireValue(provider.jobExecutor, "Junction provider should expose a job executor.");

  const first = executor.createScheduledJobs?.(
    createStoredAccount(),
    "2026-04-03T12:34:56.000Z",
  );
  const second = executor.createScheduledJobs?.(
    createStoredAccount(),
    "2026-04-03T23:45:00.000Z",
  );

  assert.equal(first?.jobs.length, 2);
  assert.deepEqual(first?.jobs[0]?.payload, {
    windowStart: "2026-03-27T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(first?.jobs[0]?.dedupeKey, second?.jobs[0]?.dedupeKey);
  // With no recorded historical-backfill outcome, the scheduled pass also
  // re-derives the connect-window backfill until a terminal status lands.
  const derivedBackfill = first?.jobs[1];
  assert.equal(derivedBackfill?.kind, "backfill");
  assert.deepEqual(derivedBackfill?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
  assert.equal(derivedBackfill?.dedupeKey, second?.jobs[1]?.dedupeKey);
});

test("Junction reconcile cadence cannot schedule faster than once per minute", () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    { reconcileIntervalMs: 1 },
  );
  const executor = requireValue(
    provider.jobExecutor,
    "Junction provider should expose a job executor.",
  );

  const scheduled = executor.createScheduledJobs?.(
    createStoredAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v4_complete",
      },
    }),
    "2026-04-03T12:34:56.000Z",
  );

  assert.equal(scheduled?.nextReconcileAt, "2026-04-03T12:35:56.000Z");
});

test("Junction scheduled pass repairs legacy coverage and honors current or future terminal status", () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const executor = requireValue(provider.jobExecutor, "Junction provider should expose a job executor.");

  const legacyComplete = executor.createScheduledJobs?.(
    createStoredAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "complete",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    "2026-04-03T12:34:56.000Z",
  );
  const legacyRepairJobs = legacyComplete?.jobs.filter((job) => job.kind === "backfill") ?? [];
  assert.equal(legacyRepairJobs.length, 1);
  assert.deepEqual(legacyRepairJobs[0]?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  const priorCoverageVersion = executor.createScheduledJobs?.(
    createStoredAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v1_complete",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    "2026-04-03T12:34:56.000Z",
  );
  assert.equal(
    priorCoverageVersion?.jobs.filter((job) => job.kind === "backfill").length,
    1,
  );

  const priorCoverageVersionV2 = executor.createScheduledJobs?.(
    createStoredAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v2_complete",
        junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
      },
    }),
    "2026-04-03T12:34:56.000Z",
  );
  assert.equal(
    priorCoverageVersionV2?.jobs.filter((job) => job.kind === "backfill").length,
    1,
  );

  for (const metadata of [
    {
      junctionHistoricalBackfillStatus: "coverage_v3_complete",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    },
    {
      junctionHistoricalBackfillStatus: "coverage_v3_exhausted",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    },
    {
      junctionHistoricalBackfillStatus: "coverage_v4_complete",
    },
    {
      junctionHistoricalBackfillStatus: "coverage_v4_deferred",
    },
  ] as const) {
    const scheduled = executor.createScheduledJobs?.(
      createStoredAccount({
        metadata,
      }),
      "2026-04-03T12:34:56.000Z",
    );
    assert.equal(
      scheduled?.jobs.some((job) => job.kind === "backfill"),
      false,
      metadata.junctionHistoricalBackfillStatus,
    );
  }

  const completeOtherWindow = executor.createScheduledJobs?.(
    createStoredAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_complete",
        junctionHistoricalBackfillWindowStart: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-04T00:00:00.000Z",
      },
    }),
    "2026-04-03T12:34:56.000Z",
  );
  assert.deepEqual(
    completeOtherWindow?.jobs.find((job) => job.kind === "backfill")?.payload,
    {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    },
  );

  const retryingOtherWindow = executor.createScheduledJobs?.(
    createStoredAccount({
      metadata: {
        junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        junctionHistoricalBackfillEmptyAttempts: 1,
        junctionHistoricalBackfillLastEmptyAt: "2026-04-03T12:30:00.000Z",
        junctionHistoricalBackfillWindowStart: "2026-04-02T00:00:00.000Z",
        junctionHistoricalBackfillWindowEnd: "2026-04-04T00:00:00.000Z",
      },
    }),
    "2026-04-03T12:34:56.000Z",
  );
  const retryingBackfill = retryingOtherWindow?.jobs.find((job) => job.kind === "backfill");
  assert.deepEqual(retryingBackfill?.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
});

test("Junction scheduled pass reopens progress overwritten by a legacy runner", () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });
  const executor = requireValue(provider.jobExecutor, "Junction provider should expose a job executor.");
  const currentProgress = {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 2,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-03T12:30:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  };
  const overwrittenByLegacyRunner = mergeStoredDeviceSyncMetadataPatch(currentProgress, {
    junctionHistoricalBackfillStatus: "complete",
  });

  const scheduled = executor.createScheduledJobs?.(
    createStoredAccount({ metadata: overwrittenByLegacyRunner }),
    "2026-04-03T12:34:56.000Z",
  );

  assert.equal(overwrittenByLegacyRunner.junctionHistoricalBackfillStatus, "complete");
  assert.equal(scheduled?.jobs.filter((job) => job.kind === "backfill").length, 1);
});

test("Junction reconcile keeps summaries current while compact timeseries stays on closed days", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  const importedSnapshots: unknown[] = [];

  const context = createJunctionJobContext({
    account: createAccount(),
    now: "2026-04-03T12:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });
  await executeJunctionFullJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-03-27T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const summarySnapshot = importedSnapshots[0] as { windowEnd?: string };
  assert.equal(summarySnapshot.windowEnd, "2026-04-03T12:00:00.000Z");
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/activity/")),
    "Junction reconcile should fetch current summary data.",
  );
  assertJunctionWindowQuery(
    summaryRequest,
    "2026-03-27T12:00:00.000Z",
    "2026-04-03T12:00:00.000Z",
  );
  assert.deepEqual(
    requests
      .filter((url) => url.includes("/v2/timeseries/"))
      .map((url) => {
        const searchParams = new URL(url).searchParams;
        return [searchParams.get("start_date"), searchParams.get("end_date")];
      }),
    [
      ["2026-03-27", "2026-03-27"],
      ["2026-03-28", "2026-03-28"],
      ["2026-03-29", "2026-03-29"],
      ["2026-03-30", "2026-03-30"],
      ["2026-03-31", "2026-03-31"],
      ["2026-04-01", "2026-04-01"],
      ["2026-04-02", "2026-04-02"],
    ],
  );
});

test("Junction dense jobs retain complete offset days in either transport order", async () => {
  for (const versioned of [false, true]) {
    for (const order of [["resource", "reconcile"], ["reconcile", "resource"]] as const) {
      const requests: URL[] = [];
      const provider = createJunctionProvider(async (input) => {
        const url = new URL(readUrl(input));
        requests.push(url);
        if (url.pathname === "/v2/user/providers/junction-user-1") {
          return createJsonResponse({ providers: [] });
        }
        if (url.pathname === "/v2/summary/activity/junction-user-1") {
          return createJsonResponse({ data: [] });
        }
        if (url.pathname === "/v2/timeseries/junction-user-1/glucose/grouped") {
          const requestedDate = url.searchParams.get("start_date");
          const revision = versioned ? { updatedAt: "2026-04-03T10:00:00.000Z" } : {};
          const records = [
            { providerDay: "2026-04-01", record: { id: "day-1-early", timestamp: "2026-04-01T04:30:00.000Z", timezone_offset: -14_400, unit: "mmol/L", value: 5, ...revision } },
            { providerDay: "2026-04-01", record: { id: "day-1-late", timestamp: "2026-04-02T03:30:00.000Z", timezone_offset: -14_400, unit: "mmol/L", value: 6, ...revision } },
            { providerDay: "2026-04-02", record: { id: "day-2-early", timestamp: "2026-04-02T04:30:00.000Z", timezone_offset: -14_400, unit: "mmol/L", value: 7, ...revision } },
            { providerDay: "2026-04-02", record: { id: "day-2-late", timestamp: "2026-04-03T03:30:00.000Z", timezone_offset: -14_400, unit: "mmol/L", value: 8, ...revision } },
          ];
          return createJsonResponse({
            groups: {
              dexcom: [{
                data: records
                  .filter((record) => record.providerDay === requestedDate)
                  .map((record) => record.record),
                source: { provider: "dexcom", type: "cgm" },
              }],
            },
          });
        }
        throw new Error(`Unexpected request: ${url.toString()}`);
      }, {
        summaryResources: ["activity"],
        timeseriesResources: ["glucose"],
      });
      const importedSnapshots: unknown[] = [];
      const context = createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
        now: "2026-04-03T12:00:00.000Z",
      });
      const jobs = {
        reconcile: createJob("reconcile", {
          windowStart: "2026-04-01T00:00:00.000Z",
          windowEnd: "2026-04-03T00:00:00.000Z",
        }),
        resource: createJob("resource", {
          resource: "glucose",
          resourceCategory: "timeseries",
          windowStart: "2026-04-01T12:00:00.000Z",
          windowEnd: "2026-04-03T12:00:00.000Z",
        }),
      };

      for (const kind of order) {
        if (kind === "reconcile") {
          await executeJunctionFullJob(provider, context, jobs[kind]);
        } else {
          await executeJunctionJob(provider, context, jobs[kind]);
        }
      }

      const glucoseSnapshots = importedSnapshots.flatMap((snapshot) => {
        const entry = snapshot as {
          timeseries?: Record<string, unknown[]>;
          timeseriesWindowKind?: string;
          windowEnd?: string;
          windowStart?: string;
        };
        const records = entry.timeseries?.glucose;
        return records
          ? [{
            records,
            snapshot,
            timeseriesWindowKind: entry.timeseriesWindowKind,
            windowEnd: entry.windowEnd,
            windowStart: entry.windowStart,
            }]
          : [];
      });
      assert.deepEqual(
        glucoseSnapshots.map(({ records, timeseriesWindowKind, windowEnd, windowStart }) => ({
          dates: records.map((record) => (record as { timestamp?: string }).timestamp?.slice(0, 10)),
          timeseriesWindowKind,
          windowEnd,
          windowStart,
        })),
        [
          {
            dates: ["2026-04-01", "2026-04-02"],
            timeseriesWindowKind: "calendar_day",
            windowEnd: "2026-04-02T00:00:00.000Z",
            windowStart: "2026-04-01T00:00:00.000Z",
          },
          {
            dates: ["2026-04-02", "2026-04-03"],
            timeseriesWindowKind: "calendar_day",
            windowEnd: "2026-04-03T00:00:00.000Z",
            windowStart: "2026-04-02T00:00:00.000Z",
          },
          {
            dates: ["2026-04-01", "2026-04-02"],
            timeseriesWindowKind: "calendar_day",
            windowEnd: "2026-04-02T00:00:00.000Z",
            windowStart: "2026-04-01T00:00:00.000Z",
          },
          {
            dates: ["2026-04-02", "2026-04-03"],
            timeseriesWindowKind: "calendar_day",
            windowEnd: "2026-04-03T00:00:00.000Z",
            windowStart: "2026-04-02T00:00:00.000Z",
          },
        ],
      );
      assert.deepEqual(
        glucoseSnapshots.map(({ snapshot }) => {
          const normalized = normalizeJunctionSnapshot(snapshot as JunctionSnapshotInput);
          const daily = normalized.events?.find((event) => event.fields?.metric === "glucose");
          const feature = normalized.evidenceParts?.find((part) =>
            part.role.startsWith("junction-timeseries-features-glucose:")
          )?.content as { sampleCount?: number } | undefined;
          return {
            dayKey: daily?.dayKey,
            sampleCount: feature?.sampleCount,
            value: daily?.fields?.value,
          };
        }),
        [
          { dayKey: "2026-04-01", sampleCount: 2, value: 99.1001 },
          { dayKey: "2026-04-02", sampleCount: 2, value: 135.1365 },
          { dayKey: "2026-04-01", sampleCount: 2, value: 99.1001 },
          { dayKey: "2026-04-02", sampleCount: 2, value: 135.1365 },
        ],
      );
      assert.equal(
        requests
          .filter((url) => url.pathname.includes("/v2/timeseries/"))
          .every((url) => !url.searchParams.get("start_date")?.includes("T")),
        true,
      );
    }
  }
  assert.equal(Date.parse("2026-04-02T03:30:00Z") >= Date.parse("2026-04-02T00:00:00Z"), true);
});

test("Junction dense jobs wait for global provider-day closure in either transport order", async () => {
  for (const versioned of [false, true]) {
    for (const order of [["resource", "reconcile"], ["reconcile", "resource"]] as const) {
      const requests: URL[] = [];
      const provider = createJunctionProvider(async (input) => {
        const url = new URL(readUrl(input));
        requests.push(url);
        if (url.pathname === "/v2/user/providers/junction-user-1") {
          return createJsonResponse({ providers: [] });
        }
        if (url.pathname === "/v2/summary/activity/junction-user-1") {
          return createJsonResponse({ data: [] });
        }
        if (url.pathname === "/v2/timeseries/junction-user-1/glucose/grouped") {
          const revision = versioned ? { updatedAt: "2026-04-02T11:00:00.000Z" } : {};
          return createJsonResponse({
            groups: {
              dexcom: [{
                data: [
                  {
                    id: "provider-day-early",
                    timestamp: "2026-04-01T00:30:00-07:00",
                    value: 5,
                    ...revision,
                  },
                  {
                    id: "provider-day-late",
                    timestamp: "2026-04-01T23:30:00-07:00",
                    value: 6,
                    ...revision,
                  },
                ],
                source: { provider: "dexcom", type: "cgm" },
              }],
            },
          });
        }
        throw new Error(`Unexpected request: ${url.toString()}`);
      }, {
        summaryResources: ["activity"],
        timeseriesResources: ["glucose"],
      });
      const importedSnapshots: unknown[] = [];
      const jobs = {
        reconcile: createJob("reconcile", {
          windowStart: "2026-04-01T00:00:00.000Z",
          windowEnd: "2026-04-02T00:00:00.000Z",
        }),
        resource: createJob("resource", {
          resource: "glucose",
          resourceCategory: "timeseries",
          windowStart: "2026-04-01T00:00:00.000Z",
          windowEnd: "2026-04-02T00:00:00.000Z",
        }),
      };
      const importSnapshot = async (snapshot: unknown) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      };
      const execute = (
        kind: keyof typeof jobs,
        context: ProviderJobContext,
      ) => kind === "reconcile"
        ? executeJunctionFullJob(provider, context, jobs[kind])
        : executeJunctionJob(provider, context, jobs[kind]);

      for (const kind of order) {
        await execute(
          kind,
          createJunctionJobContext({
            importSnapshot,
            now: "2026-04-02T00:05:00.000Z",
          }),
        );
      }
      assert.equal(
        requests.some((url) => url.pathname.includes("/v2/timeseries/")),
        false,
      );
      assert.equal(
        importedSnapshots.some((snapshot) =>
          Boolean((snapshot as { timeseries?: { glucose?: unknown[] } }).timeseries?.glucose)
        ),
        false,
      );

      for (const kind of order) {
        await execute(
          kind,
          createJunctionJobContext({
            account: createAccount({ lastSyncCompletedAt: "2026-04-02T00:05:00.000Z" }),
            importSnapshot,
            now: "2026-04-02T12:00:00.000Z",
          }),
        );
      }
      const glucoseSnapshots = importedSnapshots.flatMap((snapshot) => {
        const entry = snapshot as {
          timeseries?: { glucose?: Array<{ timestamp?: string }> };
          timeseriesWindowKind?: string;
        };
        return entry.timeseries?.glucose
          ? [{ records: entry.timeseries.glucose, windowKind: entry.timeseriesWindowKind }]
          : [];
      });
      assert.equal(glucoseSnapshots.length, 2);
      assert.deepEqual(
        glucoseSnapshots.map(({ records, windowKind }) => ({
          dates: records.map((record) => record.timestamp?.slice(0, 10)),
          windowKind,
        })),
        [
          { dates: ["2026-04-01", "2026-04-01"], windowKind: "calendar_day" },
          { dates: ["2026-04-01", "2026-04-01"], windowKind: "calendar_day" },
        ],
      );
      assert.equal(
        requests
          .filter((url) => url.pathname.includes("/v2/timeseries/"))
          .every((url) => url.searchParams.get("start_date") === "2026-04-01"),
        true,
      );
    }
  }
});

test("Junction reconcile keeps same-time Oura notes with different tags", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-oura-1",
          slug: "oura",
          name: "Oura",
          status: "connected",
          resource_availability: { note: true },
        }],
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/note/grouped") {
      const first = {
        recordId: "shared-note-record",
        start: "2026-04-02T18:05:00.000Z",
        end: "2026-04-02T18:10:00.000Z",
        tags: ["sauna"],
        value: "SENSITIVE_VALUE_SENTINEL",
      };
      return createJsonResponse({
        groups: {
          oura: [{
            data: [first, { ...first }, { ...first, tags: ["late meal"] }],
            source: { provider: "oura", type: "ring" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    providerFilter: ["oura"],
    summaryResources: ["activity"],
    timeseriesResources: ["note"],
  });
  const importedSnapshots: unknown[] = [];

  const context = createJunctionJobContext({
    now: "2026-04-03T12:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });
  await executeJunctionFullJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const noteRecords = importedSnapshots.flatMap((snapshot) => {
    const timeseries = (snapshot as { timeseries?: Record<string, unknown[]> }).timeseries;
    return timeseries?.note ?? [];
  });
  assert.equal(noteRecords.length, 2);
  assert.deepEqual(
    noteRecords.map((record) => (record as { tags?: string[] }).tags).sort(),
    [["late meal"], ["sauna"]],
  );
});

test("Junction keeps same-time blood-pressure values when a fidelity-only id alias is shared", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/blood_pressure/grouped") {
      return createJsonResponse({
        groups: {
          omron: [{
            data: [
              {
                recordId: "shared-blood-pressure-record",
                timestamp: "2026-04-02T18:05:00.000Z",
                systolic: 120,
                diastolic: 80,
              },
              {
                recordId: "shared-blood-pressure-record",
                timestamp: "2026-04-02T18:05:00.000Z",
                systolic: 130,
                diastolic: 85,
              },
            ],
            source: { provider: "omron", type: "cuff" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: ["blood_pressure"],
  });
  const importedSnapshots: unknown[] = [];

  await executeJunctionFullJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      now: "2026-04-03T12:00:00.000Z",
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const readings = importedSnapshots.flatMap((snapshot) =>
    (snapshot as { timeseries?: Record<string, unknown[]> }).timeseries?.blood_pressure ?? []
  ) as Array<{ diastolic?: number; systolic?: number }>;
  assert.deepEqual(readings.map((reading) => [reading.systolic, reading.diastolic]), [
    [120, 80],
    [130, 85],
  ]);
});

test("Junction reconcile keeps distinct same-time fidelity records while deduplicating exact repeats", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          slug: "garmin",
          name: "Garmin",
          status: "connected",
          resource_availability: {
            blood_oxygen: true,
            glucose: true,
            mindfulness_minutes: true,
            stress_level: true,
            water: true,
          },
        }],
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/glucose/grouped") {
      const first = {
        id: "glucose-record-1",
        timestamp: "2026-04-02T08:05:00.000Z",
        unit: "mmol/L",
        value: 5,
      };
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [first, { ...first }, { ...first, value: 7 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/water/grouped") {
      const first = {
        id: "water-record-1",
        start: "2026-04-02T09:00:00.000Z",
        end: "2026-04-02T09:05:00.000Z",
        unit: "mL",
        value: 250,
      };
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [
              first,
              { ...first },
              { ...first, start: "2026-04-02T09:02:00.000Z", value: 125 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped") {
      const first = {
        recordId: "oxygen-record-1",
        timestamp: "2026-04-02T10:00:00.000Z",
        oxygenSaturation: 0.91,
      };
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [
              first,
              { ...first },
              { ...first, recordId: "oxygen-record-2" },
              { ...first, oxygenSaturation: 0.97 },
            ],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/stress_level/grouped") {
      const first = {
        providerId: "stress-record-1",
        timestamp: "2026-04-02T11:00:00.000Z",
        averageStressLevel: 50,
      };
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [first, { ...first }, { ...first, averageStressLevel: 80 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/mindfulness_minutes/grouped") {
      const first = {
        sampleId: "mindfulness-record-1",
        start: "2026-04-02T12:00:00.000Z",
        end: "2026-04-02T12:05:00.000Z",
        mindfulnessMinutes: 5,
      };
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [first, { ...first }, { ...first, mindfulnessMinutes: 10 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    if (url.pathname === "/v2/summary/activity/junction-user-1") {
      return createJsonResponse({ data: [] });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    providerFilter: ["garmin"],
    summaryResources: ["activity"],
    timeseriesResources: [
      "blood_oxygen",
      "glucose",
      "mindfulness_minutes",
      "stress_level",
      "water",
    ],
  });
  const importedSnapshots: unknown[] = [];

  await executeJunctionFullJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const recordsFor = (
    resource: "blood_oxygen" | "glucose" | "mindfulness_minutes" | "stress_level" | "water",
  ) => importedSnapshots.flatMap((snapshot) => {
    const timeseries = (snapshot as { timeseries?: Record<string, unknown[]> }).timeseries;
    return timeseries?.[resource] ?? [];
  });
  const glucoseRecords = recordsFor("glucose") as Array<{ value?: number }>;
  const waterRecords = recordsFor("water") as Array<{ start?: string; value?: number }>;

  assert.deepEqual(glucoseRecords.map((record) => record.value).sort((left, right) =>
    Number(left) - Number(right)
  ), [5, 7]);
  assert.deepEqual(waterRecords.map((record) => [record.start, record.value]).sort(), [
    ["2026-04-02T09:00:00.000Z", 250],
    ["2026-04-02T09:02:00.000Z", 125],
  ]);
  assert.deepEqual(
    (recordsFor("blood_oxygen") as Array<{ oxygenSaturation?: number }>).map((record) =>
      record.oxygenSaturation
    ).sort(),
    [0.91, 0.91, 0.97],
  );
  assert.deepEqual(
    (recordsFor("stress_level") as Array<{ averageStressLevel?: number }>).map((record) =>
      record.averageStressLevel
    ).sort((left, right) => Number(left) - Number(right)),
    [50, 80],
  );
  assert.deepEqual(
    (recordsFor("mindfulness_minutes") as Array<{ mindfulnessMinutes?: number }>).map((record) =>
      record.mindfulnessMinutes
    ).sort((left, right) => Number(left) - Number(right)),
    [5, 10],
  );
});

test("Junction transport preserves provider-day conflicts for importer rejection", async () => {
  const first = {
    id: "water-provider-day-conflict",
    start: "2026-04-02T09:00:00.000Z",
    end: "2026-04-02T09:05:00.000Z",
    updatedAt: "2026-04-03T08:00:00.000Z",
    unit: "mL",
    value: 250,
  };
  const conflicts = [
    [
      { ...first, calendarDate: "2026-04-02" },
      { ...first, calendarDate: "2026-04-03" },
    ],
    [
      { ...first, timestampSemantics: "utc" },
      { ...first, timestampSemantics: "floating" },
    ],
  ];

  for (const conflict of conflicts) {
    for (const records of [conflict, [...conflict].reverse()]) {
      const provider = createJunctionProvider(async (input) => {
        const url = new URL(readUrl(input));
        if (url.pathname === "/v2/user/providers/junction-user-1") {
          return createJsonResponse({ providers: [] });
        }
        if (url.pathname === "/v2/timeseries/junction-user-1/water/grouped") {
          return createJsonResponse({
            groups: {
              garmin: [{
                data: records,
                source: { provider: "garmin", type: "watch" },
              }],
            },
          });
        }
        if (url.pathname === "/v2/summary/activity/junction-user-1") {
          return createJsonResponse({ data: [] });
        }
        throw new Error(`Unexpected request: ${url.toString()}`);
      }, {
        summaryResources: ["activity"],
        timeseriesResources: ["water"],
      });

      await assert.rejects(
        executeJunctionFullJob(
          provider,
          createJunctionJobContext({
            now: "2026-04-03T12:00:00.000Z",
            importSnapshot: async (snapshot) => {
              normalizeJunctionSnapshot(snapshot as Parameters<typeof normalizeJunctionSnapshot>[0]);
              return { durableDeliveryAccepted: true, canonicalEventCount: 0 };
            },
          }),
          createJob("reconcile", {
            windowStart: "2026-04-02T00:00:00.000Z",
            windowEnd: "2026-04-03T00:00:00.000Z",
          }),
        ),
        /Junction water stable-id records with different bodies require distinct explicit provider revisions/u,
      );
    }
  }

  const newerBody = {
    ...first,
    calendarDate: "2026-04-03",
    updatedAt: "2026-04-03T09:00:00.000Z",
  };
  for (const records of [
    [{ ...first, calendarDate: "2026-04-02" }, newerBody],
    [newerBody, { ...first, calendarDate: "2026-04-02" }],
  ]) {
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({ providers: [] });
      }
      if (url.pathname === "/v2/timeseries/junction-user-1/water/grouped") {
        return createJsonResponse({
          groups: {
            garmin: [{
              data: records,
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }
      throw new Error(`Unexpected request: ${url.toString()}`);
    }, {
      summaryResources: ["activity"],
      timeseriesResources: ["water"],
    });
    const intervalDayKeys: string[] = [];

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-04T12:00:00.000Z",
        importSnapshot: async (snapshot) => {
          const normalized = normalizeJunctionSnapshot(
            snapshot as Parameters<typeof normalizeJunctionSnapshot>[0],
          );
          intervalDayKeys.push(...(normalized.events ?? []).flatMap((event) =>
            event.kind === "measurement"
                && event.externalRef?.facet === "interval"
                && typeof event.dayKey === "string"
              ? [event.dayKey]
              : []
          ));
          return {
            canonicalEventCount: normalized.events?.length ?? 0,
            canonicalEventDayKeys: intervalDayKeys,
            durableDeliveryAccepted: true,
          };
        },
      }),
      createJob("resource", {
        resource: "water",
        resourceCategory: "timeseries",
        windowStart: "2026-04-02T08:00:00.000Z",
        windowEnd: "2026-04-02T10:00:00.000Z",
      }),
    );

    assert.deepEqual([...new Set(intervalDayKeys)], ["2026-04-03"]);
  }
});

test("Junction historical reconcile jobs preserve their summary window", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  const importedSnapshots: unknown[] = [];

  await executeJunctionJob(
    provider,
    {
      account: createAccount(),
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {},
      refreshAccountTokens: async () => createAccount(),
    },
    createJob("reconcile", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-02T00:00:00.000Z",
    }),
  );

  const summarySnapshot = importedSnapshots[0] as { windowEnd?: string };
  assert.equal(summarySnapshot.windowEnd, "2026-04-02T00:00:00.000Z");
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/activity/")),
    "Junction full-day reconcile should fetch summary data.",
  );
  assertJunctionWindowQuery(summaryRequest, "2026-04-01", "2026-04-01");
});

test("Junction skips same closed-day timeseries after a completed reconcile", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const importedSnapshots: unknown[] = [];

  await executeJunctionJob(
    provider,
    {
      account: createAccount({ lastSyncCompletedAt: "2026-04-03T12:00:00.000Z" }),
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {},
      refreshAccountTokens: async () => createAccount(),
    },
    createJob("reconcile", {
      windowStart: "2026-03-27T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.equal(requests.some((url) => url.includes("/v2/timeseries/")), false);
});

test("Junction direct dense resource jobs reuse closed calendar-day ownership", async () => {
  const requests: string[] = [];
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
        return createJsonResponse({ providers: [] });
      }
      if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
        return createJsonResponse({
          groups: {
            garmin: [{
              data: [{
                start: "2026-04-02T14:30:00.000Z",
                value: 97,
              }],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const importedSnapshots: unknown[] = [];

  await executeJunctionJob(
    provider,
    {
      account: createAccount(),
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {},
      refreshAccountTokens: async () => createAccount(),
    },
    createJob("resource", {
      resource: "blood_oxygen",
      resourceCategory: "timeseries",
      windowStart: "2026-04-02T12:00:00.000Z",
      windowEnd: "2026-04-03T12:00:00.000Z",
    }),
  );

  assert.deepEqual(
    importedSnapshots.map((snapshot) => {
      const entry = snapshot as {
        timeseriesWindowKind?: string;
        windowEnd?: string;
        windowStart?: string;
      };
      return [entry.windowStart, entry.windowEnd, entry.timeseriesWindowKind];
    }),
    [["2026-04-02T00:00:00.000Z", "2026-04-03T00:00:00.000Z", "calendar_day"]],
  );
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, unknown[]>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.deepEqual(snapshot.summaries, {});
  assert.equal(snapshot.timeseries?.blood_oxygen?.length, 1);
  const timeseriesRequest = requireValue(
    requests.find((url) => url.includes("/v2/timeseries/")),
    "Junction resource job should fetch the hinted timeseries resource.",
  );
  assertJunctionWindowQuery(
    timeseriesRequest,
    "2026-04-02",
    "2026-04-02",
  );
});

test("Junction yielded sparse history retains every accepted day as calendar work", async () => {
  const requests: URL[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    requests.push(url);
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: { caffeine: true },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    if (url.pathname === "/v2/timeseries/junction-user-1/caffeine/grouped") {
      const requestedDay = requireValue(
        url.searchParams.get("start_date"),
        "Junction sparse history request date",
      );
      assert.equal(requestedDay, url.searchParams.get("end_date"));
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              end: `${requestedDay}T08:05:00.000Z`,
              id: `caffeine-${requestedDay}`,
              start: `${requestedDay}T08:00:00.000Z`,
              unit: "g",
              value: 0.1,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryBackfillDays: 2,
    timeseriesBackfillDays: 2,
    timeseriesResources: ["caffeine"],
  });
  const sourceRecord = createConnectionSource({
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    resourceAvailabilitySummary: { caffeine: true },
  });
  const source = {
    displayName: sourceRecord.displayName,
    firstSeenAt: sourceRecord.firstSeenAt,
    lastDataAt: sourceRecord.lastDataAt,
    lastErrorCode: sourceRecord.lastErrorCode,
    lastErrorMessage: sourceRecord.lastErrorMessage,
    lastSeenAt: sourceRecord.lastSeenAt,
    resourceAvailabilitySummary: sourceRecord.resourceAvailabilitySummary,
    resourceCount: Object.keys(sourceRecord.resourceAvailabilitySummary).length,
    sourceProviderSlug: sourceRecord.sourceProviderSlug,
    status: sourceRecord.status,
  };
  const now = "2026-04-03T12:00:00.000Z";
  const scheduler = requireValue(
    provider.jobExecutor?.createScheduledJobs,
    "Junction provider should expose scheduled jobs.",
  );
  const initialJob = requireValue(
    scheduler(createStoredAccount({ sources: [source] }), now).jobs.find((job) =>
      job.kind === "resource"
      && job.payload?.historicalBackfill === true
      && job.payload?.resource === "caffeine"
    ),
    "Junction should schedule extended caffeine history.",
  );
  const acceptedDays: string[] = [];
  const context = createJunctionJobContext({
    account: createAccount({ sources: [source] }),
    connectionSourceAdmissionMode: "listed_only",
    importSnapshot: async (snapshot) => {
      const records = (snapshot as {
        timeseries?: { caffeine?: Array<{ start?: string }> };
      }).timeseries?.caffeine ?? [];
      const dayKey = requireValue(records[0]?.start, "accepted caffeine timestamp").slice(0, 10);
      acceptedDays.push(dayKey);
      return {
        canonicalEventCount: records.length,
        canonicalEventDayKeys: [dayKey],
        canonicalSparseCalendarTargets: [{
          dayKey,
          sourceProviderSlug: "garmin",
          sourceType: "watch",
        }],
        durableDeliveryAccepted: true,
      };
    },
    now,
  });

  const firstResult = await executeJunctionJob(
    provider,
    context,
    createJobFromInput(initialJob),
  );
  const preciseContinuation = requireValue(
    firstResult.scheduledJobs?.find((job) =>
      job.payload?.historicalBackfill === true
      && job.payload?.calendarRefreshDay === undefined
    ),
    "Yielded sparse history should retain its precise continuation.",
  );
  const firstCalendarJob = requireValue(
    firstResult.scheduledJobs?.find((job) => job.payload?.calendarRefreshDay === "2026-04-01"),
    "Yielded sparse history should retain its first accepted calendar day.",
  );
  assert.equal(firstCalendarJob.payload?.resource, "caffeine");
  assert.equal(firstCalendarJob.payload?.sourceProviderSlug, "garmin");

  const finalResult = await executeJunctionJob(
    provider,
    context,
    createJobFromInput(preciseContinuation, 1),
  );
  const finalCalendarJob = requireValue(
    finalResult.scheduledJobs?.find((job) => job.payload?.calendarRefreshDay === "2026-04-02"),
    "Terminal sparse history should retain its final accepted calendar day.",
  );

  assert.deepEqual(acceptedDays, ["2026-04-01", "2026-04-02"]);
  assert.equal(finalCalendarJob.payload?.resource, "caffeine");
  assert.equal(finalResult.scheduledJobs?.some((job) =>
    job.payload?.historicalBackfill === true
    && job.payload?.calendarRefreshDay === undefined
  ), false);
  assert.deepEqual(
    requests
      .filter((url) => url.pathname.includes("/v2/timeseries/"))
      .map((url) => url.searchParams.get("start_date")),
    ["2026-04-01", "2026-04-02"],
  );
  assert.notEqual(firstCalendarJob.dedupeKey, finalCalendarJob.dedupeKey);
});

test("Junction sparse sub-day corrections refresh the provider-owned calendar date", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-kit-1",
          name: "Apple Health",
          resource_availability: { caffeine: true },
          slug: "apple_health_kit",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/caffeine/grouped")) {
      const precise = new URL(url).searchParams.get("start_date")?.includes("T") === true;
      return createJsonResponse({
        groups: {
          apple_health_kit: [{
            data: [{
              id: "caffeine-reading-1",
              start: "2026-04-02T23:30:00-04:00",
              end: "2026-04-02T23:35:00-04:00",
              unit: "g",
              value: precise ? 0.095 : 0.105,
            }, {
              id: "caffeine-reading-2",
              start: "2026-04-02T23:40:00-04:00",
              end: "2026-04-02T23:45:00-04:00",
              unit: "g",
              value: precise ? 0.025 : 0.035,
            }],
            source: { provider: "apple_health_kit", type: "phone" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["caffeine"] });
  const importedSnapshots: unknown[] = [];
  const importSnapshot = async (snapshot: unknown) => {
    importedSnapshots.push(snapshot);
    const normalized = normalizeJunctionSnapshot(snapshot as Parameters<
      typeof normalizeJunctionSnapshot
    >[0], { defaultTimeZone: "America/New_York" });
    assert.ok((normalized.events?.length ?? 0) > 0);
    const canonicalSparseCalendarTargets = [...new Map((normalized.events ?? []).flatMap((event) =>
      typeof event.dayKey === "string" && event.dataOrigin?.sourceProviderSlug
        ? [[JSON.stringify([
            event.dayKey,
            event.dataOrigin.sourceProviderSlug,
            event.dataOrigin.sourceType ?? null,
            event.dataOrigin.sourceInstanceId ?? null,
          ]), {
            dayKey: event.dayKey,
            sourceProviderSlug: event.dataOrigin.sourceProviderSlug,
            ...(event.dataOrigin.sourceInstanceId === undefined
              ? {}
              : { sourceInstanceId: event.dataOrigin.sourceInstanceId }),
            ...(event.dataOrigin.sourceType
              ? { sourceType: event.dataOrigin.sourceType }
              : {}),
          }] as const]
        : []
    )).values()];
    return {
      canonicalEventCount: normalized.events?.length ?? 0,
      canonicalEventDayKeys: [...new Set((normalized.events ?? []).flatMap((event) =>
        typeof event.dayKey === "string" ? [event.dayKey] : []
      ))],
      canonicalEventExternalRefResourceIds: (normalized.events ?? []).flatMap((event) =>
        event.externalRef?.resourceId ? [event.externalRef.resourceId] : []
      ),
      canonicalSparseCalendarTargets,
      durableDeliveryAccepted: true,
    };
  };
  const job = createJob("resource", {
    resource: "caffeine",
    resourceCategory: "timeseries",
    windowStart: "2026-04-03T03:25:00.000Z",
    windowEnd: "2026-04-03T03:50:00.000Z",
  });

  const preClosureResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T11:59:59.999Z",
      importSnapshot,
    }),
    job,
  );

  assert.equal(
    requests.filter((url) => url.includes("/v2/timeseries/")).length,
    1,
    "The provider-local April 2 day must remain unpublished before its UTC-12 close boundary.",
  );
  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(preClosureResult.scheduledJobs, undefined);
  requests.length = 0;
  importedSnapshots.length = 0;

  const preciseResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot,
    }),
    job,
  );

  const calendarJob = requireValue(
    preciseResult.scheduledJobs?.[0],
    "Junction sparse correction should persist its calendar refresh as a continuation.",
  );
  assert.deepEqual(preciseResult.scheduledJobs, [{
    kind: "resource",
    payload: {
      calendarRefreshDay: "2026-04-02",
      resource: "caffeine",
      resourceCategory: "timeseries",
      sourceProviderSlug: "apple_health_kit",
      sourceType: "phone",
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    },
    priority: job.priority,
    dedupeKey: sha256ForTest(JSON.stringify([
      "junction",
      "sparse-calendar-refresh",
      "apple_health_kit",
      "phone",
      null,
      "caffeine",
      "2026-04-02",
    ])),
  }]);
  assert.equal(importedSnapshots.length, 1, "Precise completion must not refresh a day transiently.");

  const calendarJobRecord = {
    ...createJob("resource", calendarJob.payload ?? {}),
    dedupeKey: calendarJob.dedupeKey ?? null,
    priority: calendarJob.priority ?? 0,
  };
  const yielded = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot,
      shouldYield: () => true,
    }),
    calendarJobRecord,
  );
  assert.deepEqual(yielded.scheduledJobs, preciseResult.scheduledJobs);
  assert.equal(importedSnapshots.length, 1, "A yielded calendar job must not repeat the precise import.");

  const calendarResult = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot,
    }),
    calendarJobRecord,
  );
  assert.deepEqual(calendarResult.scheduledJobs, undefined);

  assert.deepEqual(importedSnapshots.map((snapshot) => {
    const entry = snapshot as {
      timeseriesWindowKind?: string;
      windowEnd?: string;
      windowStart?: string;
    };
    return [entry.windowStart, entry.windowEnd, entry.timeseriesWindowKind];
  }), [
    ["2026-04-03T03:25:00.000Z", "2026-04-03T03:50:00.000Z", "precise"],
    ["2026-04-02T00:00:00.000Z", "2026-04-03T00:00:00.000Z", "calendar_day"],
  ]);
  assert.deepEqual(importedSnapshots.map((snapshot) =>
    (snapshot as { timeseries?: { caffeine?: Array<{ value?: number }> } })
      .timeseries?.caffeine?.map((record) => record.value)
  ), [[0.095, 0.025], [0.105, 0.035]]);
  const [preciseRequest, dailyRequest] = requests.filter((url) => url.includes("/v2/timeseries/"));
  const request = requireValue(preciseRequest, "Junction sparse resource job should issue a precise request.");
  assertJunctionWindowQuery(
    request,
    "2026-04-03T03:25:00.000Z",
    "2026-04-03T03:50:00.000Z",
  );
  assertJunctionWindowQuery(
    requireValue(dailyRequest, "Junction sparse resource job should refresh its closed daily total."),
    "2026-04-02",
    "2026-04-02",
  );
});

test("Junction sparse calendar refresh imports an authoritative empty source day", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: { water: true },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({
        groups: {
          fitbit: [{
            data: [{
              end: "2026-04-02T08:01:00.000Z",
              sourceInstanceId: "source-bbbbbbbbbbbbbbbbbbbbbbbb",
              start: "2026-04-02T08:00:00.000Z",
              value: 250,
            }],
            source: { provider: "fitbit", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });
  const importedSnapshots: unknown[] = [];
  const normalizedImports: ReturnType<typeof normalizeJunctionSnapshot>[] = [];

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        normalizedImports.push(normalizeJunctionSnapshot(snapshot as Parameters<
          typeof normalizeJunctionSnapshot
        >[0], { defaultTimeZone: "America/New_York" }));
        return {
          canonicalEventExternalRefResourceIds: [buildJunctionDailyTimeseriesAggregateResourceId({
            dayKey: "2026-04-02",
            resource: "water",
            sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
            sourceProviderSlug: "garmin",
            sourceType: "watch",
          })],
          durableDeliveryAccepted: true,
        };
      },
    }),
    createJob("resource", {
      calendarRefreshDay: "2026-04-02",
      resource: "water",
      resourceCategory: "timeseries",
      sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
      sourceProviderSlug: "garmin",
      sourceType: "watch",
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }),
  );

  assert.deepEqual(result.scheduledJobs, undefined);
  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(
    (importedSnapshots[0] as {
      timeseries?: { water?: Array<Record<string, unknown>> };
    }).timeseries?.water,
    [{
      authoritativeEmptyCalendarSet: true,
      calendarDate: "2026-04-02",
      date: "2026-04-02",
      sourceInstanceId: "source-aaaaaaaaaaaaaaaaaaaaaaaa",
      sourceProviderSlug: "garmin",
      sourceType: "watch",
      value: 0,
    }],
  );
  const zeroEvent = normalizedImports[0]?.events?.find((event) =>
    event.fields && "metric" in event.fields && event.fields.metric === "water"
  );
  assert.equal(zeroEvent?.dayKey, "2026-04-02");
  assert.equal(
    zeroEvent?.fields && "value" in zeroEvent.fields ? zeroEvent.fields.value : undefined,
    0,
  );
  assert.ok(normalizedImports[0]?.evidenceParts?.some((part) => {
    const content = part.content;
    return typeof content === "object"
      && content !== null
      && "status" in content
      && content.status === "authoritative_empty_calendar_set"
      && "sampleCount" in content
      && content.sampleCount === 0;
  }));
  assert.ok(requests.some((url) =>
    url.includes("provider=garmin")
    && url.includes("start_date=2026-04-02")
    && url.includes("end_date=2026-04-02")
  ));
});

test("Junction sparse calendar refresh rejects nonempty rows that apply no owned daily state", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: { water: true },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              date: "2026-04-02",
              sourceProviderSlug: "garmin",
              sourceType: "watch",
              value: "not-a-number",
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-03T12:00:00.000Z",
        importSnapshot: async () => ({
          canonicalEventCount: 0,
          canonicalEventExternalRefResourceIds: [],
          durableDeliveryAccepted: true,
        }),
      }),
      createJob("resource", {
        calendarRefreshDay: "2026-04-02",
        resource: "water",
        resourceCategory: "timeseries",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
      }),
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_CALENDAR_REFRESH_DAILY_STATE_NOT_APPLIED"
      && error.retryable,
  );
});

test("Junction sparse calendar refresh retains an unavailable optional endpoint", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-garmin-1",
          name: "Garmin",
          resource_availability: { water: true },
          slug: "garmin",
          status: "connected",
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({ message: "Resource unavailable." }, 422);
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({ now: "2026-04-03T12:00:00.000Z" }),
      createJob("resource", {
        calendarRefreshDay: "2026-04-02",
        resource: "water",
        resourceCategory: "timeseries",
        sourceProviderSlug: "garmin",
        sourceType: "watch",
        windowEnd: "2026-04-03T00:00:00.000Z",
        windowStart: "2026-04-02T00:00:00.000Z",
      }),
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_CALENDAR_REFRESH_UNAVAILABLE"
      && error.retryable,
  );
});

test("Junction sparse corrections reject excessive calendar-refresh fanout", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/water/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              id: "bounded-water-reading",
              start: "2026-04-02T08:00:00.000Z",
              unit: "mL",
              value: 250,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, { timeseriesResources: ["water"] });
  const affectedDayKeys = Array.from({ length: 65 }, (_, index) =>
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)
  );

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({
        now: "2026-04-03T12:00:00.000Z",
        importSnapshot: async () => ({
          canonicalEventCount: 1,
          canonicalEventDayKeys: affectedDayKeys,
          canonicalSparseCalendarTargets: affectedDayKeys.map((dayKey) => ({
            dayKey,
            sourceProviderSlug: "garmin",
            sourceType: "watch",
          })),
          durableDeliveryAccepted: true,
        }),
      }),
      createJob("resource", {
        resource: "water",
        resourceCategory: "timeseries",
        windowStart: "2026-04-02T08:00:00.000Z",
        windowEnd: "2026-04-02T09:00:00.000Z",
      }),
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_CALENDAR_REFRESH_DAY_LIMIT_EXCEEDED"
      && !error.retryable,
  );
  assert.equal(
    requests.filter((url) => url.includes("/v2/timeseries/")).length,
    1,
    "The bound must fail before any calendar-day provider-call fanout.",
  );
});

test("Junction dense resource jobs yield between closed calendar days", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({ providers: [] });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{
              start: new URL(url).searchParams.get("start_date"),
              value: 97,
            }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  const importedSnapshots: unknown[] = [];
  const job = createJob("resource", {
    resource: "blood_oxygen",
    resourceCategory: "timeseries",
    windowStart: "2026-04-01T06:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      shouldYield: () => requests.some((url) => url.includes("/v2/timeseries/")),
    }),
    job,
  );

  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(
    importedSnapshots.map((snapshot) => {
      const entry = snapshot as { windowEnd?: string; windowStart?: string };
      return [entry.windowStart, entry.windowEnd];
    }),
    [["2026-04-01T00:00:00.000Z", "2026-04-02T00:00:00.000Z"]],
  );
  const timeseriesRequests = requests.filter((url) => url.includes("/v2/timeseries/"));
  assert.equal(timeseriesRequests.length, 1);
  assertJunctionWindowQuery(
    requireValue(timeseriesRequests[0], "Junction resource job should fetch its first closed day."),
    "2026-04-01",
    "2026-04-01",
  );
  assert.deepEqual(result.scheduledJobs, [
    {
      kind: "resource",
      payload: {
        resource: "blood_oxygen",
        resourceCategory: "timeseries",
        windowEnd: "2026-04-03T00:00:00.000Z",
        windowStart: "2026-04-02T00:00:00.000Z",
      },
      priority: job.priority,
      dedupeKey: sha256ForTest(JSON.stringify([
        "junction",
        "yield-follow-up",
        "2026-04-02T00:00:00.000Z",
        "2026-04-03T00:00:00.000Z",
        null,
        null,
        null,
        "blood_oxygen",
        "timeseries",
        null,
      ])),
    },
  ]);
});

test("Junction completeConnection falls back to the callback user_id when no seed is present", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  const connection = await requireJunctionConnectionHandler(provider).completeConnection({
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    state: "state-1",
    query: new URLSearchParams({
      murph_state: "state-1",
      state: "success",
      user_id: "junction-user-ignored",
    }),
    now: "2026-04-03T00:00:00.000Z",
    grantedScopes: [],
  });

  assert.equal(connection.externalAccountId, "junction-user-ignored");
  assert.equal(connection.setupPhase, "link_returned");
});

test("Junction completeConnection rejects a callback user_id that differs from the seeded account", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      seededExternalAccountId: "junction-user-seeded",
      query: new URLSearchParams({
        murph_state: "state-1",
        state: "success",
        user_id: "junction-user-other",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_LINK_USER_MISMATCH",
  );
});

test("Junction completeConnection rejects failed Link callbacks", async () => {
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        state: "failed",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_LINK_FAILED"
      && error.message.includes("state=failed"),
  );
});

test("Junction completeConnection preserves the sanitized Link failure reason", async () => {
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        error: "provider_connection_error",
        error_type: "provider_credential_error",
        error_description: "User denied access",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(error.message.includes("error=provider_connection_error"));
      assert.ok(error.message.includes("error_type=provider_credential_error"));
      assert.ok(error.message.includes("error_description=User denied access"));
      return true;
    },
  );
});

test("Junction completeConnection drops JSON-array Link failure descriptions", async () => {
  // A provider-controlled error_description carrying a structured dump must
  // fail closed out of the reason instead of surfacing its entries.
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        error: "provider_connection_error",
        error_description: '["junction-user-1"]',
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(error.message.includes("error=provider_connection_error"));
      assert.ok(!error.message.includes("junction-user-1"));
      assert.ok(!error.message.includes("error_description="));
      return true;
    },
  );
});

test("Junction completeConnection drops bracketed comma-list Link failure descriptions", async () => {
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        error: "provider_connection_error",
        error_description: "[junction-user-1, Jane Doe]",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(error.message.includes("error=provider_connection_error"));
      assert.ok(!error.message.includes("junction-user-1"));
      assert.ok(!error.message.includes("Jane"));
      assert.ok(!error.message.includes("Doe"));
      assert.ok(!error.message.includes("error_description="));
      return true;
    },
  );
});

test("Junction completeConnection masks secret-bearing Link failure reason values", async () => {
  // sanitizeHostedRuntimeDiagnosticText masks the secret span so the rest of
  // the provider's explanation stays available for debugging.
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        error: "provider_connection_error",
        error_description: "User denied access access_token=secret-value-1",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(error.message.includes("error=provider_connection_error"));
      assert.ok(!error.message.includes("secret-value-1"));
      assert.ok(error.message.includes("error_description=User denied access"));
      assert.ok(!error.message.includes("access_token"));
      return true;
    },
  );
});

test("Junction completeConnection masks colon-form token Link failure reasons", async () => {
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        error: "provider_connection_error",
        error_description: "refresh token: abcdefghijklmnopqrst expired",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(error.message.includes("error=provider_connection_error"));
      assert.ok(error.message.includes("error_description=refresh token: <redacted-token> expired"));
      assert.ok(!error.message.includes("abcdefghijklmnopqrst"));
      return true;
    },
  );
});

test("Junction completeConnection rejects non-truthy success callbacks with the outcome suffix", async () => {
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        success: "false",
        state: "pending",
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(error.message.includes("did not report a successful link outcome"));
      assert.ok(error.message.includes("(state=pending, success=false)"));
      return true;
    },
  );
});

test("Junction completeConnection masks token-shaped Link callback values in failure reasons", async () => {
  // JWT-shaped and long opaque token values are masked in place, so the
  // failure reason keeps its shape without leaking either value.
  const jwtDescription = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLXBhcnQ";
  const opaqueState = "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8";
  const provider = createJunctionProvider(async () => createJsonResponse({ providers: [] }));

  await assert.rejects(
    requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-1",
      query: new URLSearchParams({
        murph_state: "state-1",
        error_description: jwtDescription,
        state: opaqueState,
      }),
      now: "2026-04-03T00:00:00.000Z",
      grantedScopes: [],
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_LINK_FAILED");
      assert.ok(!error.message.includes(jwtDescription));
      assert.ok(!error.message.includes(opaqueState));
      assert.ok(error.message.includes("error_description=[redacted.jwt]"));
      assert.ok(error.message.includes("state=<redacted-token>"));
      return true;
    },
  );
});

test("Junction verifies Svix webhooks and maps data events to scalar resource jobs", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.activity.created",
      user_id: "junction-user-1",
      client_user_id: "murph_blinded",
      data: {
        id: "activity-1",
        date: "2026-04-02",
        resource: "activity",
        source: {
          provider: "oura",
        },
      },
    },
    messageId: "msg_activity_1",
    timestamp: "1775174400",
  });

  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.externalAccountId, "junction-user-1");
  assert.deepEqual(parsed.externalAccountDiagnostic, {
    selectedPath: "$.user_id",
    selectedExternalAccountIdHash: sha256ForTest("junction-user-1"),
    candidates: [
      {
        kind: "external_account_id",
        path: "$.user_id",
        selected: true,
        valueHash: sha256ForTest("junction-user-1"),
      },
      {
        kind: "client_user_id",
        path: "$.client_user_id",
        selected: false,
        valueHash: sha256ForTest("murph_blinded"),
      },
    ],
  });
  assert.equal(JSON.stringify(parsed.externalAccountDiagnostic).includes("junction-user-1"), false);
  assert.equal(JSON.stringify(parsed.externalAccountDiagnostic).includes("murph_blinded"), false);
  assert.equal(parsed.eventType, "daily.data.activity.created");
  assert.equal(parsed.acceptanceMode, "durable_webhook_work");
  assert.equal(parsed.traceId, "msg_activity_1");
  assert.equal(parsed.resourceCategory, "summary");
  assert.equal(parsed.unknownAccountAction, "accept");
  const webhookDataJson = parsed.jobs[0]?.payload?.webhookDataJson;
  assert.equal(typeof webhookDataJson, "string");
  const webhookData = JSON.parse(String(webhookDataJson)) as Record<string, unknown>;
  assert.equal(webhookData.sourceProviderSlug, "oura");
  assert.equal(webhookData.resource, "activity");
  assert.equal(webhookData.date, "2026-04-02");
  assert.equal(JSON.stringify(webhookData).includes("junction-user-1"), false);
  assert.deepEqual(parsed.jobs, [
    {
      kind: "resource",
      payload: {
        eventType: "daily.data.activity.created",
        objectId: "activity-1",
        occurredAt: "2026-04-02T00:00:00.000Z",
        resource: "activity",
        resourceCategory: "summary",
        sourceProviderSlug: "oura",
        webhookDataJson,
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      },
      priority: 65,
      dedupeKey: parsed.jobs[0]?.dedupeKey,
    },
  ]);
  assert.equal(typeof parsed.jobs[0]?.dedupeKey, "string");
});

test("Junction signed wearable webhooks create direct import jobs for Oura sleep and Garmin activity", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      summaryResources: ["activity", "sleep"],
      timeseriesResources: [],
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const context = createJunctionJobContext({
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });

  for (const testCase of [
    {
      data: {
        data: {
          bedtime_start: "2026-04-02T03:00:00.000Z",
          bedtime_stop: "2026-04-02T11:00:00.000Z",
          duration: 28_800,
          total: 25_200,
        },
        id: "oura-sleep-1",
        resource: "sleep",
        source: { provider: "oura" },
      },
      eventType: "daily.data.sleep.created",
      messageId: "msg_oura_sleep_fixture_1",
      provider: "oura",
      resource: "sleep",
    },
    {
      data: {
        date: "2026-04-02",
        id: "garmin-activity-1",
        resource: "activity",
        source: { provider: "garmin" },
        steps: 12_345,
      },
      eventType: "daily.data.activity.created",
      messageId: "msg_garmin_activity_fixture_1",
      provider: "garmin",
      resource: "activity",
    },
  ] as const) {
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: testCase.eventType,
        user_id: "junction-user-1",
        client_user_id: "murph_blinded",
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

    assert.equal(parsed.eventType, testCase.eventType);
    assert.equal(parsed.acceptanceMode, "durable_webhook_work");
    assert.equal(parsed.resourceCategory, "summary");
    assert.equal(parsed.jobs.length, 1);
    const job = parsed.jobs[0];
    assert.equal(job?.kind, "resource");
    assert.equal(job?.payload?.eventType, testCase.eventType);
    assert.equal(job?.payload?.resource, testCase.resource);
    assert.equal(job?.payload?.resourceCategory, "summary");
    assert.equal(job?.payload?.sourceProviderSlug, testCase.provider);
    assert.equal(typeof job?.payload?.webhookDataJson, "string");
    assert.equal(String(job?.payload?.webhookDataJson).includes("junction-user-1"), false);
    assert.equal(String(job?.payload?.webhookDataJson).includes("murph_blinded"), false);

    await executeJunctionJob(
      provider,
      context,
      createJob(job?.kind ?? "resource", job?.payload ?? {}),
    );
  }

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 2);
  const providers = importedSnapshots.flatMap((snapshot) => {
    const summaries = (snapshot as {
      summaries?: Record<string, Array<{ sourceProviderSlug?: string }>>;
    }).summaries ?? {};
    return Object.values(summaries)
      .flat()
      .flatMap((record) => record.sourceProviderSlug ? [record.sourceProviderSlug] : []);
  });
  assert.deepEqual(providers.sort(), ["garmin", "oura"]);
});

test("Junction record-shaped historical Garmin sleep webhooks preserve inline summary payloads", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      summaryResources: ["sleep", "sleep_cycle"],
      timeseriesResources: [],
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );

  for (const testCase of [
    {
      eventType: "historical.data.sleep.created",
      expectedResource: "sleep",
      messageId: "msg_historical_garmin_sleep_1",
      data: {
        id: "garmin-sleep-1",
        date: "2026-04-02",
        resource: "sleep",
        source: { provider: "garmin" },
        start_time: "2026-04-02T03:30:00.000Z",
        end_time: "2026-04-02T11:15:00.000Z",
        total_sleep_minutes: 420,
      },
    },
    {
      eventType: "historical.data.hypnogram.created",
      expectedResource: "sleep_cycle",
      messageId: "msg_historical_garmin_hypnogram_1",
      data: {
        id: "garmin-hypnogram-1",
        date: "2026-04-02",
        resource: "hypnogram",
        source: { provider: "garmin" },
        stages: [
          {
            stage: "deep",
            start_time: "2026-04-02T04:00:00.000Z",
            end_time: "2026-04-02T04:25:00.000Z",
          },
        ],
      },
    },
  ] as const) {
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: testCase.eventType,
        user_id: "junction-user-1",
        client_user_id: "murph_blinded",
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

    assert.equal(parsed.eventType, testCase.eventType);
    assert.equal(parsed.acceptanceMode, "durable_webhook_work");
    assert.equal(parsed.resourceCategory, "summary");
    assert.equal(parsed.jobs.length, 1);
    const job = parsed.jobs[0];
    assert.equal(job?.kind, "resource");
    assert.equal(job?.payload?.resource, testCase.expectedResource);
    assert.equal(job?.payload?.resourceCategory, "summary");
    assert.equal(job?.payload?.sourceProviderSlug, "garmin");
    assert.equal(typeof job?.payload?.webhookDataJson, "string");
    assert.equal(String(job?.payload?.webhookDataJson).includes("junction-user-1"), false);
    assert.equal(String(job?.payload?.webhookDataJson).includes("murph_blinded"), false);
  }
});

test("Junction historical sleep completion webhooks fetch the bounded summary window", async () => {
  for (const testCase of [
    {
      label: "sdk",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        is_final: true,
        provider: "garmin",
      },
    },
    {
      label: "sdk-resource-passthrough",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        is_final: true,
        provider: "garmin",
        resource: "sleep",
      },
    },
    {
      label: "sdk-source-passthrough",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        is_final: true,
        provider: "garmin",
        source_provider_slug: "garmin",
      },
    },
    {
      label: "documented",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        provider: "garmin",
      },
    },
    {
      label: "documented-resource-passthrough",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        provider: "garmin",
        resource: "sleep",
      },
    },
    {
      label: "documented-source-passthrough",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        provider: "garmin",
        source_provider_slug: "garmin",
      },
    },
    {
      label: "documented-source-provider-slug",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        source_provider_slug: "garmin",
      },
    },
    {
      label: "sdk-final-source-provider-slug",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        is_final: true,
        source_provider_slug: "garmin",
      },
    },
    {
      label: "documented-source-provider-camel",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        sourceProvider: "garmin",
      },
    },
    {
      label: "sdk-final-source-provider-camel",
      data: {
        user_id: "junction-user-1",
        start_date: "2026-04-01",
        end_date: "2026-04-02",
        isFinal: true,
        sourceProvider: "garmin",
      },
    },
  ] as const) {
    const requests: string[] = [];
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(
      async (input) => {
        const url = readUrl(input);
        requests.push(url);

        if (url.includes("/v2/user/providers/junction-user-1")) {
          return createJsonResponse({
            providers: [
              {
                slug: "garmin",
                name: "Garmin",
                status: "connected",
                resource_availability: { sleep: true },
              },
            ],
          });
        }

        if (url.includes("/v2/summary/sleep/junction-user-1")) {
          return createJsonResponse({
            data: [
              {
                date: "2026-04-02",
                id: "garmin-sleep-fetched-1",
                source: { provider: "garmin" },
                total_sleep_minutes: 420,
              },
            ],
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
      {
        summaryResources: ["sleep"],
        timeseriesResources: [],
        webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
      },
    );
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: "historical.data.sleep.created",
        user_id: "junction-user-1",
        client_user_id: "murph_blinded",
        data: testCase.data,
      },
      messageId: `msg_historical_garmin_sleep_completion_${testCase.label}`,
      timestamp: "1775260800",
    });

    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-04T00:00:00.000Z",
    });

    assert.equal(parsed.eventType, "historical.data.sleep.created");
    assert.equal(parsed.acceptanceMode, "durable_webhook_work");
    assert.equal(parsed.jobs.length, 1);
    const job = parsed.jobs[0];
    assert.equal(job?.kind, "resource");
    assert.equal(job?.payload?.resource, "sleep");
    assert.equal(job?.payload?.resourceCategory, "summary");
    assert.equal(job?.payload?.sourceProviderSlug, "garmin");
    assert.equal(job?.payload?.windowStart, "2026-04-01T00:00:00.000Z");
    assert.equal(job?.payload?.windowEnd, "2026-04-03T00:00:00.000Z");
    assert.equal("webhookDataJson" in (job?.payload ?? {}), false);

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob(job?.kind ?? "resource", job?.payload ?? {}),
    );

    assert.equal(
      requests.some((url) =>
        url.includes("/v2/summary/sleep/junction-user-1")
        && url.includes("provider=garmin")
        && url.includes("start_date=2026-04-01")
        && url.includes("end_date=2026-04-02")
      ),
      true,
      `historical completion webhook should fetch the provider-scoped window; requests=${JSON.stringify(requests)}`,
    );
    assert.equal(importedSnapshots.length, 1);
    const snapshot = importedSnapshots[0] as {
      summaries?: Record<string, Array<Record<string, unknown>>>;
    };
    assert.equal(snapshot.summaries?.sleep?.[0]?.id, "garmin-sleep-fetched-1");
    assert.equal(JSON.stringify(parsed.jobs).includes("junction-user-1"), false);
    assert.equal(JSON.stringify(importedSnapshots).includes("murph_blinded"), false);
  }
});

test("Junction completion classification matches the pinned SDK serializer", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      summaryResources: ["sleep"],
      timeseriesResources: [],
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );

  const baseData: Record<string, unknown> = {
    user_id: "junction-user-1",
    start_date: "2026-04-01",
    end_date: "2026-04-02",
    is_final: true,
    provider: "garmin",
    resource: "sleep",
    id: "inline-record-if-not-completion",
  };
  const testCases: readonly {
    label: string;
    omit?: readonly string[];
    overrides?: Readonly<Record<string, unknown>>;
  }[] = [
    { label: "calendar-date" },
    {
      label: "week-date",
      overrides: { start_date: "2026-W14-3", end_date: "2026-W14-4" },
    },
    {
      label: "ordinal-date",
      overrides: { start_date: "2026-091", end_date: "2026-092" },
    },
    {
      label: "date-time",
      overrides: {
        start_date: "2026-04-01T12:30:00Z",
        end_date: "2026-04-02T12:30:00+00:00",
      },
    },
    { label: "passthrough-field", overrides: { future_field: "retained" } },
    { label: "malformed-date", overrides: { start_date: "2026-13-40" } },
    { label: "missing-start-date", omit: ["start_date"] },
    { label: "wrong-end-date-type", overrides: { end_date: 17 } },
    { label: "non-final", overrides: { is_final: false } },
    { label: "wrong-final-type", overrides: { is_final: "true" } },
    { label: "missing-provider", omit: ["provider"] },
    { label: "wrong-provider-type", overrides: { provider: 17 } },
    { label: "missing-data-user-id", omit: ["user_id"] },
    { label: "wrong-data-user-id-type", overrides: { user_id: 17 } },
  ];

  for (const testCase of testCases) {
    const data = { ...baseData, ...testCase.overrides };
    for (const field of testCase.omit ?? []) {
      delete data[field];
    }

    const sdkUserId = typeof data.user_id === "string" && data.user_id.trim().length > 0
      ? data.user_id.trim()
      : "junction-user-1";
    const sdkParsed = JunctionHistoricalPullCompletedSchema.parse(
      { ...data, user_id: sdkUserId },
      { unrecognizedObjectKeys: "passthrough" },
    );
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: "historical.data.sleep.created",
        user_id: "junction-user-1",
        client_user_id: "murph_blinded",
        data,
      },
      messageId: `msg_historical_completion_oracle_${testCase.label}`,
      timestamp: "1775260800",
    });

    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-04T00:00:00.000Z",
    });
    const job = parsed.jobs[0];

    assert.equal(parsed.jobs.length, 1, testCase.label);
    assert.equal(job?.kind, "resource", testCase.label);
    assert.equal(
      "webhookDataJson" in (job?.payload ?? {}),
      !sdkParsed.ok,
      `${testCase.label} should match the pinned SDK completion classification`,
    );
  }
});

test("Junction rejects webhooks with only a client_user_id and no Junction user_id", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.activity.created",
      client_user_id: "murph_blinded",
      data: {
        id: "activity-1",
        date: "2026-04-02",
        resource: "activity",
        source: {
          provider: "oura",
        },
      },
    },
    messageId: "msg_client_user_only_1",
    timestamp: "1775174400",
  });

  await assert.rejects(
    () => requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    }),
    (error) => {
      assert.ok(error instanceof DeviceSyncError);
      assert.equal(error.code, "JUNCTION_WEBHOOK_USER_ID_MISSING");
      assert.equal(error.httpStatus, 400);
      assert.equal(JSON.stringify(error.details).includes("murph_blinded"), false);
      assert.deepEqual(error.details, {
        externalAccountCandidates: [
          {
            kind: "client_user_id",
            path: "$.client_user_id",
            selected: false,
            valueHash: sha256ForTest("murph_blinded"),
          },
        ],
      });
      return true;
    },
  );
});

test("Junction webhook jobs dedupe by resource window instead of Svix trace", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const body = {
    event_type: "daily.data.steps.created",
    user_id: "junction-user-1",
    client_user_id: "murph_blinded",
    data: {
      id: "steps-1",
      date: "2026-04-02",
      resource: "steps",
      source: {
        provider: "garmin",
      },
    },
  };

  const firstWebhook = createJunctionSvixWebhook({
    body,
    messageId: "msg_steps_first",
    timestamp: "1775174400",
  });
  const secondWebhook = createJunctionSvixWebhook({
    body,
    messageId: "msg_steps_second",
    timestamp: "1775174400",
  });

  const first = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: firstWebhook.headers,
    rawBody: firstWebhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });
  const second = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: secondWebhook.headers,
    rawBody: secondWebhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.notEqual(first.traceId, second.traceId);
  assert.equal(first.jobs[0]?.kind, "resource");
  assert.equal(first.jobs[0]?.dedupeKey, second.jobs[0]?.dedupeKey);
});

test("Junction webhook source-provider extraction covers documented payload shapes", async () => {
  const cases: Array<{
    label: string;
    eventType: string;
    data: Record<string, unknown>;
    expectedSourceProviderSlug: string;
    expectedResource: string;
  }> = [
    {
      label: "historical data.provider",
      eventType: "historical.data.workouts.created",
      data: {
        id: "workout-zwift-1",
        provider: "zwift",
      },
      expectedSourceProviderSlug: "zwift",
      expectedResource: "workouts",
    },
    {
      label: "daily data.source.provider",
      eventType: "daily.data.workouts.created",
      data: {
        id: "workout-zwift-2",
        source: {
          provider: "zwift",
        },
      },
      expectedSourceProviderSlug: "zwift",
      expectedResource: "workouts",
    },
    {
      label: "daily data.source.slug",
      eventType: "daily.data.steps.created",
      data: {
        id: "steps-fitbit-1",
        source: {
          slug: "fitbit",
        },
      },
      expectedSourceProviderSlug: "fitbit",
      expectedResource: "steps",
    },
    {
      label: "nested provider slug",
      eventType: "daily.data.workouts.created",
      data: {
        id: "workout-zwift-3",
        provider: {
          slug: "zwift",
        },
      },
      expectedSourceProviderSlug: "zwift",
      expectedResource: "workouts",
    },
    {
      label: "nested provider provider",
      eventType: "daily.data.workouts.created",
      data: {
        id: "workout-zwift-4",
        provider: {
          provider: "zwift",
        },
      },
      expectedSourceProviderSlug: "zwift",
      expectedResource: "workouts",
    },
    {
      label: "aggregator provider only",
      eventType: "daily.data.steps.created",
      data: {
        id: "steps-aggregator-1",
        provider: "junction",
      },
      expectedSourceProviderSlug: "",
      expectedResource: "steps",
    },
    {
      label: "nested source beats aggregator provider",
      eventType: "daily.data.steps.created",
      data: {
        id: "steps-fitbit-2",
        provider: "junction",
        source: {
          provider: "fitbit",
        },
      },
      expectedSourceProviderSlug: "fitbit",
      expectedResource: "steps",
    },
  ];

  for (const testCase of cases) {
    const provider = createJunctionProvider(
      async (input) => {
        throw new Error(`Unexpected request: ${readUrl(input)}`);
      },
      {
        webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
      },
    );
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: testCase.eventType,
        user_id: `junction-user-${testCase.label.replace(/[^a-z0-9]+/giu, "-")}`,
        data: testCase.data,
      },
      messageId: `msg_${testCase.label.replace(/[^a-z0-9]+/giu, "_")}`,
      timestamp: "1775174400",
    });

    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });

    const job = parsed.jobs[0];
    assert.ok(job, testCase.label);
    assert.equal(job.kind, "resource", testCase.label);
    const payload = job.payload;
    assert.ok(payload, testCase.label);
    assert.equal(payload.resource, testCase.expectedResource, testCase.label);
    assert.equal(
      payload.sourceProviderSlug,
      testCase.expectedSourceProviderSlug,
      testCase.label,
    );
  }
});

test("Junction accepts nested webhook user ids and comma-delivered Svix signatures", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.blood_oxygen.created",
      data: {
        id: "blood-oxygen-1",
        timestamp: "2026-04-02T12:00:00.000Z",
        sourceProvider: "fitbit",
        user: {
          id: "junction-user-nested",
        },
      },
    },
    messageId: "msg_blood_oxygen_nested",
    signatureHeader: (signature) =>
      `v1,invalid,v1,${signature.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "")}`,
    timestamp: "1775174400",
  });

  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.externalAccountId, "junction-user-nested");
  assert.equal(parsed.resourceCategory, "timeseries");
  assert.equal(parsed.jobs[0]?.kind, "resource");
  assert.deepEqual(parsed.jobs[0]?.payload, {
    eventType: "daily.data.blood_oxygen.created",
    objectId: "blood-oxygen-1",
    occurredAt: "2026-04-02T12:00:00.000Z",
    resource: "blood_oxygen",
    resourceCategory: "timeseries",
    sourceProviderSlug: "fitbit",
    windowStart: "2026-04-01T12:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });
});

test("Junction accepts user ids nested inside webhook envelopes", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const cases: Array<{ body: Record<string, unknown>; expectedUserId: string; messageId: string }> = [
    {
      body: {
        event_type: "provider.connection.created",
        data: {},
        payload: {
          user: {
            id: "junction-user-root-payload",
          },
        },
      },
      expectedUserId: "junction-user-root-payload",
      messageId: "msg_root_payload_user",
    },
    {
      body: {
        event_type: "provider.connection.created",
        data: {
          payload: {
            user: {
              id: "junction-user-data-payload",
            },
          },
        },
      },
      expectedUserId: "junction-user-data-payload",
      messageId: "msg_data_payload_user",
    },
    {
      body: {
        event_type: "provider.connection.created",
        data: {
          event: {
            message: {
              user: {
                id: "junction-user-event-message",
              },
            },
          },
        },
      },
      expectedUserId: "junction-user-event-message",
      messageId: "msg_event_message_user",
    },
  ];

  for (const { body, expectedUserId, messageId } of cases) {
    const webhook = createJunctionSvixWebhook({
      body,
      messageId,
      timestamp: "1775174400",
    });

    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    });

    assert.equal(parsed.externalAccountId, expectedUserId);
    assert.deepEqual(parsed.jobs.map((job) => job.kind), ["backfill", "reconcile"]);
  }
});

test("Junction connection-event backfill completion does not write historical metadata for a non-connect window", async () => {
  const provider = createEmptyJunctionBackfillProvider({
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "provider.connection.created",
      user_id: "junction-user-1",
      data: {},
    },
    messageId: "msg_connection_created_backfill",
    timestamp: "1775174400",
  });

  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });
  const backfillJob = requireValue(
    parsed.jobs.find((job) => job.kind === "backfill"),
    "Junction connection event should derive a backfill job.",
  );
  assert.deepEqual(backfillJob.payload, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ connectedAt: "2026-04-01T00:00:00.000Z" }),
      now: "2026-04-04T00:00:00.000Z",
    }),
    createJob(backfillJob.kind, backfillJob.payload ?? {}),
  );

  assert.equal(
    Object.keys(result.metadataPatch ?? {}).some((key) => key.startsWith("junctionHistoricalBackfill")),
    false,
  );
});

test("Junction rejects webhooks with conflicting signed payload user ids", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "provider.connection.created",
      user_id: "junction-user-top",
      data: {
        event: {
          message: {
            user: {
              id: "junction-user-deep",
            },
          },
        },
      },
    },
    timestamp: "1775174400",
  });

  await assert.rejects(
    requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    }),
    (error) => {
      if (!(error instanceof DeviceSyncError)) {
        return false;
      }

      assert.equal(error.code, "JUNCTION_WEBHOOK_USER_ID_CONFLICT");
      assert.deepEqual(error.details, {
        externalAccountCandidates: [
          {
            kind: "external_account_id",
            path: "$.user_id",
            selected: false,
            valueHash: sha256ForTest("junction-user-top"),
          },
          {
            kind: "external_account_id",
            path: "$.data.event.message.user.id",
            selected: false,
            valueHash: sha256ForTest("junction-user-deep"),
          },
        ],
      });
      assert.equal(JSON.stringify(error.details).includes("junction-user-top"), false);
      assert.equal(JSON.stringify(error.details).includes("junction-user-deep"), false);
      return true;
    },
  );
});

test("Junction rejects malformed whsec webhook secrets", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_not-base64!",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "provider.connection.created",
      user_id: "junction-user-1",
      data: {},
    },
    timestamp: "1775174400",
  });

  await assert.rejects(
    requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-04-03T00:00:00.000Z",
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_WEBHOOK_SECRET_INVALID",
  );
});

test("Junction rejects webhooks with invalid Svix signatures", async () => {
  const provider = createJunctionProvider(
    async (input) => {
      throw new Error(`Unexpected request: ${readUrl(input)}`);
    },
    {
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    },
  );
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "provider.connection.created",
      user_id: "junction-user-1",
      data: {},
    },
    timestamp: "1775174400",
  });

  await assert.rejects(
    requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: Buffer.from(JSON.stringify({
        event_type: "provider.connection.created",
        user_id: "junction-user-2",
        data: {},
      })),
      now: "2026-04-03T00:00:00.000Z",
    }),
    (error) => error instanceof DeviceSyncError && error.code === "JUNCTION_WEBHOOK_SIGNATURE_INVALID",
  );
});

test("Junction polling updates source projection and imports bounded summary/timeseries snapshots", async () => {
  const requests: string[] = [];
  const groupedTimeseriesPayloads: Record<string, unknown> = {
    blood_oxygen: {
      groups: {
        oura: [{
          data: [{
            accountId: "junction-account-timeseries-1",
            account: { id: "nested-account-timeseries-1" },
            app: { id: "nested-app-timeseries-1", name: "Nested Timeseries App" },
            device: { id: "nested-device-timeseries-1", name: "Nested Timeseries Device" },
            timestamp: "2026-04-02T14:30:52+00:00",
            unit: "%",
            user_id: "junction-user-timeseries-1",
            value: 97,
          }],
          source: {
            provider: "oura",
            type: "ring",
            name: "Timeseries Oura Ring",
            device_id: "timeseries-device-oura-ring-1",
            app_id: "timeseries-app-oura-cloud-1",
          },
        }],
      },
    },
    stress_level: {
      groups: {
        oura: [{
          data: [{
            timestamp: "2026-04-02T14:30:52+00:00",
            unit: "score",
            value: 48,
          }],
          source: { provider: "oura", type: "ring" },
        }],
      },
    },
  };
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            id: "provider-connection-oura-ring-1",
            name: "Oura Ring",
            status: "connected",
            source: {
              provider: "oura",
              device_id: "device-oura-ring-1",
              app_id: "app-oura-cloud-1",
            },
            resource_availability: {
              sleep: true,
              connectedSources: ["oura"],
              source: "Oura Ring",
              provider: "oura",
              provider_connection_id: "provider-connection-oura-ring-1",
              provider_name: "Oura Cloud",
              device_id: "device-oura-ring-1",
              deviceName: "Oura Ring",
              app_id: "app-oura-cloud-1",
              app_name: "Oura App",
              user_id: "blocked",
            },
          },
          {
            id: "provider-connection-oura-ring-2",
            slug: "oura",
            name: "Oura Ring 2",
            status: "connected",
            source: {
              device_id: "device-oura-ring-2",
              app_id: "app-oura-cloud-1",
            },
            resource_availability: {
              activity: true,
            },
          },
          {
            id: "provider-connection-fitbit-1",
            slug: "fitbit",
            name: "Fitbit",
            status: "connected",
            source: {
              provider: "fitbit",
            },
            resource_availability: {
              activity: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      const cursor = new URL(url).searchParams.get("next_cursor");
      if (cursor === "page-2") {
        return createJsonResponse({
          activity: [{
            id: "summary-2",
            accountId: "junction-account-raw-2",
            calendar_date: "2026-04-02",
            created_at: "2026-04-02T01:00:00+00:00",
            date: "2026-04-02T00:00:00+00:00",
            providerConnectionId: "provider-connection-oura-ring-2",
            source: { provider: "oura", type: "ring" },
            steps: 2000,
            updated_at: "2026-04-02T02:00:00+00:00",
            user_id: "junction-user-raw-2",
          }],
        });
      }

      return createJsonResponse({
        activity: [{
          id: "summary-1",
          Source: { id: "nested-source-summary-1", name: "Nested Source Summary" },
          account_id: "junction-account-raw-1",
          account: { id: "nested-account-summary-1" },
          app: { id: "nested-app-summary-1", name: "Nested Summary App" },
          calendar_date: "2026-04-02",
          client_user_id: "client-user-raw-1",
          created_at: "2026-04-02T01:00:00+00:00",
          date: "2026-04-02T00:00:00+00:00",
          device: { id: "nested-device-summary-1", name: "Nested Summary Device" },
          provider_connection_id: "provider-connection-oura-ring-1",
          source: { provider: "oura", type: "ring" },
          steps: 1000,
          updated_at: "2026-04-02T02:00:00+00:00",
          user_id: "junction-user-raw-1",
        }],
        next_cursor: "page-2",
      });
    }

    const timeseriesResource = new URL(url).pathname.match(/\/v2\/timeseries\/junction-user-1\/([^/]+)\/grouped$/u)?.[1];
    if (timeseriesResource && timeseriesResource in groupedTimeseriesPayloads) {
      if (new URL(url).searchParams.get("start_date") !== "2026-04-02") {
        return createJsonResponse({ groups: {} });
      }
      return createJsonResponse(groupedTimeseriesPayloads[timeseriesResource]);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen", "stress_level"],
  });
  const sources: DeviceConnectionSourceRecord[] = [];
  const importedSnapshots: unknown[] = [];
  const context: ProviderJobContext = {
    account: createAccount({
      sources: [{
        displayName: "Fitbit",
        firstSeenAt: "2026-04-02T00:00:00.000Z",
        lastDataAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: "2026-04-02T00:00:00.000Z",
        resourceCount: 0,
        sourceProviderSlug: "fitbit",
        status: "disconnected",
      }],
    }),
    now: "2026-04-03T12:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: (input) => {
      const source: DeviceConnectionSourceRecord = {
        id: `src-${sources.length + 1}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        lastDataAt: input.lastDataAt ?? null,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
      sources.push(source);
      return source;
    },
    refreshAccountTokens: async () => createAccount(),
    logger: {},
  };

  const result = await executeJunctionFullJob(
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
  assert.equal(sources.length, 2);
  assert.equal(sources[0]?.sourceProviderSlug, "oura");
  assert.equal(sources[0]?.status, "connected");
  assert.equal(
    sources[0]?.sourceInstanceKey,
    buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "oura",
    }),
  );
  assert.doesNotMatch(sources[0]?.sourceInstanceKey ?? "", /provider|device|oura|ring|app/u);
  assert.equal(sources[0]?.resourceAvailabilitySummary.sourceInstanceKeyFallback, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.sleep, true);
  assert.equal(sources[0]?.resourceAvailabilitySummary.activity, true);
  assert.equal(sources[0]?.resourceAvailabilitySummary.connectedSources, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.source, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.provider, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.provider_connection_id, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.provider_name, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.device_id, undefined);
  assert.equal(sources[1]?.sourceProviderSlug, "fitbit");
  assert.equal(sources[1]?.status, "connected");
  assert.equal(sources[0]?.resourceAvailabilitySummary.deviceName, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.app_id, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.app_name, undefined);
  assert.equal(sources[0]?.resourceAvailabilitySummary.user_id, undefined);
  assert.match(JSON.stringify(importedSnapshots), /"provider":"junction"/u);
  const snapshotJson = JSON.stringify(importedSnapshots);
  assert.doesNotMatch(snapshotJson, /provider-connection-oura-ring|device-oura-ring|app-oura-cloud/u);
  assert.doesNotMatch(snapshotJson, /junction-user-1|junction-account-raw|junction-user-raw|client-user-raw|junction-account-timeseries|junction-user-timeseries/u);
  assert.doesNotMatch(snapshotJson, /nested-(source|account|device|app)-summary|Nested Summary|nested-(account|device|app)-timeseries|Nested Timeseries/u);
  const summarySnapshot = importedSnapshots[0] as {
    accountId?: string;
    connections?: Array<Record<string, unknown>>;
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, Array<Record<string, unknown>>>;
    windowEnd?: string;
  };
  assert.match(summarySnapshot.accountId ?? "", /^jxn_acct_[a-f0-9]{32}$/u);
  assert.equal(summarySnapshot.windowEnd, "2026-04-03T00:00:00.000Z");
  const importedConnection = summarySnapshot.connections?.[0] as
    | {
        provider?: unknown;
        source?: unknown;
        sourceInstanceId?: string;
        sourceProviderSlug?: string;
      }
    | undefined;
  assert.match(
    importedConnection?.sourceInstanceId ?? "",
    /^source-[a-f0-9]{24}$/u,
  );
  assert.deepEqual(Object.keys(importedConnection ?? {}).sort(), [
    "sourceInstanceId",
    "sourceProviderSlug",
  ]);
  assert.equal(importedConnection?.sourceProviderSlug, "oura");
  assert.doesNotMatch(JSON.stringify(importedSnapshots), /fitbit/u);
  assert.equal((importedConnection as { source?: unknown } | undefined)?.source, undefined);
  assert.equal((importedConnection as { provider?: unknown } | undefined)?.provider, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.account_id, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.Source, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.account, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.app, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.client_user_id, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.date, "2026-04-02T00:00:00.000Z");
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.device, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[0]?.provider_connection_id, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[1]?.accountId, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[1]?.providerConnectionId, undefined);
  assert.equal(summarySnapshot.summaries?.activity?.[1]?.userId, undefined);
  assert.deepEqual(summarySnapshot.timeseries, {});
  const normalizedSummary = normalizeJunctionSnapshot(summarySnapshot);
  const activityStepsEvent = requireValue(
    normalizedSummary.events?.find((event) =>
      event.fields?.metric === "daily-steps" && event.fields.value === 1000
    ),
    "Sanitized Junction activity should reach the canonical importer.",
  );
  assert.deepEqual(
    [activityStepsEvent.occurredAt, activityStepsEvent.dayKey],
    ["2026-04-02T00:00:00.000Z", "2026-04-02"],
  );

  const timeseriesSnapshots = importedSnapshots.slice(1) as Array<{
    timeseries?: Record<string, Array<Record<string, unknown>>>;
    windowEnd?: string;
    windowStart?: string;
  }>;
  assert.equal(
    timeseriesSnapshots.every((snapshot) =>
      snapshot.windowStart === "2026-04-02T00:00:00.000Z"
      && snapshot.windowEnd === "2026-04-03T00:00:00.000Z"
      && Object.keys(snapshot.timeseries ?? {}).length === 1
    ),
    true,
  );
  const timeseries = timeseriesSnapshots.reduce<Record<string, Array<Record<string, unknown>>>>(
    (merged, snapshot) => {
      for (const [resource, records] of Object.entries(snapshot.timeseries ?? {})) {
        merged[resource] = [...(merged[resource] ?? []), ...records];
      }
      return merged;
    },
    {},
  );

  assert.deepEqual(Object.keys(timeseries).sort(), ["blood_oxygen", "stress_level"]);
  assert.equal(timeseries.blood_oxygen?.length, 1);
  assert.equal(timeseries.stress_level?.length, 1);
  const bloodOxygenRecord = timeseries.blood_oxygen?.[0];
  assert.equal(bloodOxygenRecord?.accountId, undefined);
  assert.equal(bloodOxygenRecord?.account, undefined);
  assert.equal(bloodOxygenRecord?.app, undefined);
  assert.equal(bloodOxygenRecord?.device, undefined);
  assert.equal(bloodOxygenRecord?.sourceProviderSlug, "oura");
  assert.equal(bloodOxygenRecord?.sourceType, "ring");
  assert.equal(bloodOxygenRecord?.sourceName, undefined);
  assert.equal(bloodOxygenRecord?.sourceDeviceId, undefined);
  assert.equal(bloodOxygenRecord?.sourceAppId, undefined);
  assert.equal(bloodOxygenRecord?.timestamp, "2026-04-02T14:30:52.000Z");
  assert.equal(bloodOxygenRecord?.user_id, undefined);
  assert.equal((bloodOxygenRecord as { source?: unknown } | undefined)?.source, undefined);
  assert.equal((bloodOxygenRecord as { provider?: unknown } | undefined)?.provider, undefined);
  assert.equal(typeof bloodOxygenRecord?.sourceInstanceId, "string");
  assert.match(String(bloodOxygenRecord?.sourceInstanceId), /^source-[a-f0-9]{24}$/u);
  assert.equal(timeseries.stress_level?.[0]?.sourceType, "ring");
  assert.equal(timeseries.stress_level?.[0]?.timestamp, "2026-04-02T14:30:52.000Z");
  assert.equal(timeseries.blood_oxygen?.[0]?.junctionResource, "blood_oxygen");
  assert.equal(timeseries.stress_level?.[0]?.unit, "score");
  const normalizedBloodOxygen = normalizeJunctionSnapshot(requireValue(
    timeseriesSnapshots.find((snapshot) => snapshot.timeseries?.blood_oxygen),
    "Junction polling should produce a sanitized blood-oxygen snapshot.",
  ));
  const normalizedStressLevel = normalizeJunctionSnapshot(requireValue(
    timeseriesSnapshots.find((snapshot) => snapshot.timeseries?.stress_level),
    "Junction polling should produce a sanitized stress-level snapshot.",
  ));
  const bloodOxygenEvent = requireValue(
    normalizedBloodOxygen.events?.find((event) => event.fields?.metric === "spo2"),
    "Sanitized Junction blood oxygen should reach the canonical importer.",
  );
  const stressLevelEvent = requireValue(
    normalizedStressLevel.events?.find((event) => event.fields?.metric === "stress-level"),
    "Sanitized Junction stress level should reach the canonical importer.",
  );
  assert.deepEqual(
    [bloodOxygenEvent.occurredAt, bloodOxygenEvent.dayKey],
    ["2026-04-02T14:30:52.000Z", "2026-04-02"],
  );
  assert.deepEqual(
    [stressLevelEvent.occurredAt, stressLevelEvent.dayKey],
    ["2026-04-02T14:30:52.000Z", "2026-04-02"],
  );
  assert.notEqual(bloodOxygenEvent.externalRef?.resourceId, stressLevelEvent.externalRef?.resourceId);
  assert.doesNotMatch(
    JSON.stringify(timeseries),
    /Timeseries Oura Ring|timeseries-device-oura-ring-1|timeseries-app-oura-cloud-1/u,
  );
  assert.equal(requests.filter((url) => url.includes("/v2/summary/")).length, 2);
  assert.equal(requests.some((url) => url.includes("next_cursor=page-2")), true);
  const timeseriesRequests = requests.filter((url) => url.includes("/v2/timeseries/"));
  assert.equal(timeseriesRequests.length, 4);
  assert.equal(timeseriesRequests.every((url) => url.includes("/grouped?")), true);
  assert.equal(timeseriesRequests.some((url) => url.includes("/heartrate?")), false);
  assert.equal(
    requests.every((url) => !url.includes("steps") && !url.includes("heartrate") && !url.includes("hrv")),
    true,
  );
  assert.equal(requests.every((url) => !url.includes("glucose") && !url.includes("cgm")), true);
});

test("Junction source projection uses provider-level keys for slug-only sources", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "withings",
            name: "Withings",
            status: "connected",
            resource_availability: {
              body: true,
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
  const sources: DeviceConnectionSourceRecord[] = [];
  const context: ProviderJobContext = {
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async () => ({ imported: true }),
    upsertConnectionSource: (input) => {
      const source: DeviceConnectionSourceRecord = {
        id: `src-${sources.length + 1}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        lastDataAt: input.lastDataAt ?? null,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
      sources.push(source);
      return source;
    },
    refreshAccountTokens: async () => createAccount(),
    logger: {},
  };

  const result = await executeJunctionFullJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(sources.length, 1);
  assert.equal(
    sources[0]?.sourceInstanceKey,
    buildJunctionProviderSourceInstanceKey({
      connectionId: "acct-junction-1",
      sourceProviderSlug: "withings",
    }),
  );
  assert.equal(sources[0]?.resourceAvailabilitySummary.body, true);
  assert.equal(sources[0]?.resourceAvailabilitySummary.sourceInstanceKeyFallback, undefined);
});

test("Junction source projection persists provider error details for errored sources", async () => {
  const longErrorMessage = `WHOOP rejected the refresh token. ${"detail ".repeat(60)}`;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "whoop_v2",
            name: "WHOOP",
            status: "error",
            error_details: {
              error_type: "token_refresh_failed",
              error_message: longErrorMessage,
              errored_at: "2026-04-02T21:28:00+00:00",
            },
            resource_availability: {
              sleep: true,
            },
          },
          {
            slug: "oura",
            name: "Oura",
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
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return {
        id: `src-${upserts.length}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        lastDataAt: input.lastDataAt ?? null,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
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

  const erroredUpsert = upserts.find((input) => input.sourceProviderSlug === "whoop_v2");
  assert.ok(erroredUpsert, "Errored WHOOP source should be projected.");
  assert.equal(erroredUpsert.status, "error");
  assert.equal(erroredUpsert.lastErrorCode, "token_refresh_failed");
  assert.equal(erroredUpsert.lastErrorMessage?.length, 240);
  assert.match(erroredUpsert.lastErrorMessage ?? "", /^WHOOP rejected the refresh token\./u);

  const connectedUpsert = upserts.find((input) => input.sourceProviderSlug === "oura");
  assert.ok(connectedUpsert, "Connected Oura source should be projected.");
  assert.equal(connectedUpsert.status, "connected");
  // Omitted keys let the store auto-clear stale error detail on recovery.
  assert.equal(Object.hasOwn(connectedUpsert, "lastErrorCode"), false);
  assert.equal(Object.hasOwn(connectedUpsert, "lastErrorMessage"), false);
});

test("Junction source projection drops error details when a sibling source entry is connected", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "whoop_v2",
            name: "WHOOP",
            status: "error",
            error_details: {
              error_type: "token_refresh_failed",
              error_message: "WHOOP rejected the refresh token.",
            },
            resource_availability: {
              sleep: true,
            },
          },
          {
            slug: "whoop_v2",
            name: "WHOOP",
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
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return {
        id: `src-${upserts.length}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        lastDataAt: input.lastDataAt ?? null,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
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

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.sourceProviderSlug, "whoop_v2");
  assert.equal(upserts[0]?.status, "connected");
  assert.equal(Object.hasOwn(upserts[0] ?? {}, "lastErrorCode"), false);
  assert.equal(Object.hasOwn(upserts[0] ?? {}, "lastErrorMessage"), false);
});

test("Junction source projection tolerates malformed error details and reads camelCase fields", async () => {
  const longErrorType = `token_refresh_failed_${"x".repeat(100)}`;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "whoop_v2",
            name: "WHOOP",
            status: "error",
            error_details: "token refresh failed",
            resource_availability: {
              sleep: true,
            },
          },
          {
            slug: "oura",
            name: "Oura",
            status: "error",
            error_details: {
              error_type: "   ",
              error_message: "",
            },
            resource_availability: {
              activity: true,
            },
          },
          {
            slug: "garmin",
            name: "Garmin",
            status: "error",
            errorDetails: {
              errorType: longErrorType,
              errorMessage: "Garmin revoked access.",
            },
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
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return {
        id: `src-${upserts.length}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        lastDataAt: input.lastDataAt ?? null,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
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

  // Non-object error_details: errored projection keeps the status but omits
  // the error keys so the store can preserve any previously stored detail.
  const malformedUpsert = upserts.find((input) => input.sourceProviderSlug === "whoop_v2");
  assert.ok(malformedUpsert, "Errored WHOOP source should be projected.");
  assert.equal(malformedUpsert.status, "error");
  assert.equal(Object.hasOwn(malformedUpsert, "lastErrorCode"), false);
  assert.equal(Object.hasOwn(malformedUpsert, "lastErrorMessage"), false);

  // All-blank error detail fields collapse to null details and omit the keys.
  const blankUpsert = upserts.find((input) => input.sourceProviderSlug === "oura");
  assert.ok(blankUpsert, "Errored Oura source should be projected.");
  assert.equal(blankUpsert.status, "error");
  assert.equal(Object.hasOwn(blankUpsert, "lastErrorCode"), false);
  assert.equal(Object.hasOwn(blankUpsert, "lastErrorMessage"), false);

  // camelCase errorDetails parse, and the code truncates to the 80-char bound.
  const camelUpsert = upserts.find((input) => input.sourceProviderSlug === "garmin");
  assert.ok(camelUpsert, "Errored Garmin source should be projected.");
  assert.equal(camelUpsert.status, "error");
  assert.equal(camelUpsert.lastErrorCode?.length, 80);
  assert.match(camelUpsert.lastErrorCode ?? "", /^token_refresh_failed_x/u);
  assert.equal(camelUpsert.lastErrorMessage, "Garmin revoked access.");
});

test("Junction source projection fills error details from a later errored sibling entry", async () => {
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "whoop_v2",
            name: "WHOOP",
            status: "error",
            resource_availability: {
              sleep: true,
            },
          },
          {
            slug: "whoop_v2",
            name: "WHOOP",
            status: "error",
            error_details: {
              error_type: "token_refresh_failed",
              error_message: "WHOOP rejected the refresh token.",
            },
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
  });
  const upserts: Array<Parameters<NonNullable<ProviderJobContext["upsertConnectionSource"]>>[0]> = [];
  const context = createJunctionJobContext({
    upsertConnectionSource: (input) => {
      upserts.push(input);
      return {
        id: `src-${upserts.length}`,
        connectionId: "acct-junction-1",
        ...input,
        displayName: input.displayName ?? null,
        resourceAvailabilitySummary: input.resourceAvailabilitySummary ?? {},
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
        firstSeenAt: input.firstSeenAt ?? input.lastSeenAt,
        lastDataAt: input.lastDataAt ?? null,
        createdAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
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

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.sourceProviderSlug, "whoop_v2");
  assert.equal(upserts[0]?.status, "error");
  assert.equal(upserts[0]?.lastErrorCode, "token_refresh_failed");
  assert.equal(upserts[0]?.lastErrorMessage, "WHOOP rejected the refresh token.");
});

test("Junction polling skips optional unavailable resource collections", async () => {
  const warnings: Record<string, unknown>[] = [];
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              activity: true,
              blood_oxygen: true,
              stress_level: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", steps: 1200 }] });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({ message: "Resource not found." }, 404);
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({
        groups: {
          oura: [{
            data: [{ timestamp: "2026-04-02T00:00:00Z", unit: "%", value: 97 }],
            source: { provider: "oura", type: "ring" },
          }],
        },
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/stress_level/grouped")) {
      return createJsonResponse({ error: "unsupported_resource" }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "profile"],
    timeseriesResources: ["blood_oxygen", "stress_level"],
  });
  const context: ProviderJobContext = {
    account: createAccount({
      metadata: {
        junctionSkippedResourceTotal: 10,
        junctionSkippedSummaryTotal: 4,
        junctionSkippedTimeseriesTotal: 6,
      },
    }),
    now: "2026-04-03T12:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: () => ({
      id: "src-1",
      connectionId: "acct-junction-1",
      sourceInstanceKey: "src-key",
      sourceProviderSlug: "oura",
      displayName: "Oura Ring",
      status: "connected",
      resourceAvailabilitySummary: {},
      lastErrorCode: null,
      lastErrorMessage: null,
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      lastDataAt: null,
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    }),
    refreshAccountTokens: async () => createAccount(),
    logger: {
      warn(_message, context) {
        warnings.push(context ?? {});
      },
    },
  };

  const initialResult = await executeJunctionJob(
    provider,
    context,
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );
  const result = await executeFullJobTimeseriesContinuations({
    context,
    initialResult,
    provider,
  });

  const summarySnapshot = importedSnapshots[0] as {
    summaries?: Record<string, unknown[]>;
    timeseries?: Record<string, unknown[]>;
  };
  const timeseriesSnapshots = importedSnapshots.slice(1) as Array<{
    summaries?: Record<string, unknown[]>;
    timeseries?: Record<string, unknown[]>;
  }>;
  assert.equal(summarySnapshot.summaries?.activity?.length, 1);
  assert.equal(summarySnapshot.summaries?.profile, undefined);
  assert.deepEqual(summarySnapshot.timeseries, {});
  assert.equal(
    timeseriesSnapshots.every((snapshot) =>
      Object.keys(snapshot.summaries ?? {}).length === 0
      && Object.keys(snapshot.timeseries ?? {}).length === 1
    ),
    true,
  );
  const timeseries = timeseriesSnapshots.reduce<Record<string, unknown[]>>(
    (merged, snapshot) => {
      for (const [resource, records] of Object.entries(snapshot.timeseries ?? {})) {
        merged[resource] = [...(merged[resource] ?? []), ...records];
      }
      return merged;
    },
    {},
  );
  assert.deepEqual(Object.keys(timeseries), ["blood_oxygen"]);
  assert.equal(timeseries.blood_oxygen?.length, 1);
  assert.equal(timeseries.stress_level, undefined);
  assert.deepEqual(
    warnings.map((warning) => ({
      accountId: warning.accountId,
      reason: warning.reason,
      resource: warning.resource,
      resourceCategory: warning.resourceCategory,
      responseStatus: warning.responseStatus,
    })),
    [
      {
        accountId: undefined,
        reason: "not_found",
        resource: "profile",
        resourceCategory: "summary",
        responseStatus: 404,
      },
      {
        accountId: undefined,
        reason: "unsupported",
        resource: "stress_level",
        resourceCategory: "timeseries",
        responseStatus: 422,
      },
    ],
  );
  assert.deepEqual(result.metadataPatch, {
    junctionProfileSummaryCheckedAt: "2026-04-03T12:00:00.000Z",
    junctionProfileSummaryNormalizationRevision: 1,
    junctionSkippedResourceTotal: 12,
    junctionSkippedSummaryTotal: 5,
    junctionSkippedTimeseriesTotal: 7,
    junctionSkippedResourceJobCount: 1,
    junctionSkippedResourceLastAt: "2026-04-03T12:00:00.000Z",
    junctionSkippedResourceLast: "timeseries.stress_level.422.unsupported",
    junctionSkippedResourceLastDetail: null,
  });
  const profileRequest = requireValue(
    requests.find((url) => new URL(url).pathname.includes("/v2/summary/profile/")),
    "Junction optional profile skip should come from the current-state profile endpoint.",
  );
  const profileSearchParams = new URL(profileRequest).searchParams;
  assert.equal(profileSearchParams.has("start_date"), false);
  assert.equal(profileSearchParams.has("end_date"), false);
});

test("Junction polling skips ambiguous optional resource responses and records the provider detail", async () => {
  const warnings: Record<string, unknown>[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return new Response(JSON.stringify({
        code: "invalid_request",
        message: "The date window is invalid for this request.",
      }), {
        status: 422,
        statusText: "Validation failed at https://api.example.test/users/junction-user-1",
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(warnings, [
    {
      errorCode: "JUNCTION_API_REQUEST_FAILED",
      provider: "junction",
      reason: "ambiguous",
      resource: "profile",
      resourceCategory: "summary",
      responseStatus: 422,
      responseDetail: "invalid_request: The date window is invalid for this request.",
    },
  ]);
  assert.deepEqual(result.metadataPatch, {
    junctionProfileSummaryCheckedAt: "2026-04-03T00:00:00.000Z",
    junctionProfileSummaryNormalizationRevision: 1,
    junctionSkippedResourceTotal: 1,
    junctionSkippedSummaryTotal: 1,
    junctionSkippedTimeseriesTotal: 0,
    junctionSkippedResourceJobCount: 1,
    junctionSkippedResourceLastAt: "2026-04-03T00:00:00.000Z",
    junctionSkippedResourceLast: "summary.profile.422.ambiguous",
    junctionSkippedResourceLastDetail: "invalid_request: The date window is invalid for this request.",
  });
  assert.equal(JSON.stringify(warnings).includes("junction-user-1"), false);
  assert.equal(JSON.stringify(result.metadataPatch).includes("junction-user-1"), false);
});

test("Junction ambiguous sleep_cycle summary failure still imports the other summaries", async () => {
  const warnings: Record<string, unknown>[] = [];
  const importedSnapshots: unknown[] = [];
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
              sleep: true,
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({
        data: [{ id: "activity-1", observedAt: "2026-04-02T12:00:00.000Z", steps: 1200 }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep/junction-user-1")) {
      return createJsonResponse({
        data: [{ id: "sleep-1", calendar_date: "2026-04-02", score: 82, total: 27000 }],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        code: "invalid_request",
        message: "sleep_cycle summaries are not enabled for this team.",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity", "sleep", "sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as { summaries?: Record<string, unknown[]> };
  assert.equal(snapshot.summaries?.activity?.length, 1);
  assert.equal(snapshot.summaries?.sleep?.length, 1);
  assert.deepEqual(snapshot.summaries?.sleep_cycle, []);
  assert.deepEqual(warnings, [
    {
      errorCode: "JUNCTION_API_REQUEST_FAILED",
      provider: "junction",
      reason: "ambiguous",
      resource: "sleep_cycle",
      resourceCategory: "summary",
      responseStatus: 422,
      responseDetail: "invalid_request: sleep_cycle summaries are not enabled for this team.",
    },
  ]);
  assert.deepEqual(result.metadataPatch, {
    junctionSkippedResourceTotal: 1,
    junctionSkippedSummaryTotal: 1,
    junctionSkippedTimeseriesTotal: 0,
    junctionSkippedResourceJobCount: 1,
    junctionSkippedResourceLastAt: "2026-04-03T00:00:00.000Z",
    junctionSkippedResourceLast: "summary.sleep_cycle.422.ambiguous",
    junctionSkippedResourceLastDetail: "invalid_request: sleep_cycle summaries are not enabled for this team.",
  });
});

test("Junction polling treats missing profile summary as a one-shot optional skip", async () => {
  const warnings: Record<string, unknown>[] = [];
  const importedSnapshots: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({
        error: "not_found",
        message: "Not found.",
      }, 404);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({
        metadata: {
          junctionProfileSummaryCheckedAt: "2026-04-01T00:00:00.000Z",
        },
      }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.deepEqual(warnings.map((warning) => ({
    reason: warning.reason,
    resource: warning.resource,
    resourceCategory: warning.resourceCategory,
    responseStatus: warning.responseStatus,
  })), [{
    reason: "not_found",
    resource: "profile",
    resourceCategory: "summary",
    responseStatus: 404,
  }]);
  assert.deepEqual(result.metadataPatch, {
    junctionProfileSummaryCheckedAt: "2026-04-03T00:00:00.000Z",
    junctionProfileSummaryNormalizationRevision: 1,
    junctionSkippedResourceTotal: 1,
    junctionSkippedSummaryTotal: 1,
    junctionSkippedTimeseriesTotal: 0,
    junctionSkippedResourceJobCount: 1,
    junctionSkippedResourceLastAt: "2026-04-03T00:00:00.000Z",
    junctionSkippedResourceLast: "summary.profile.404.not_found",
    junctionSkippedResourceLastDetail: null,
  });
  const profileRequest = requireValue(
    requests.find((url) => new URL(url).pathname.includes("/v2/summary/profile/")),
    "Junction missing profile skip should call the current-state profile endpoint.",
  );
  const profileSearchParams = new URL(profileRequest).searchParams;
  assert.equal(profileSearchParams.has("start_date"), false);
  assert.equal(profileSearchParams.has("end_date"), false);
});

test("Junction polling skips request-shape optional resource failures as ambiguous", async () => {
  const ambiguousCases = [
    {
      code: "not_found",
      message: "Resource parameters missing.",
    },
    {
      code: "not_found",
      message: "Resource not found for startDate.",
    },
    {
      code: "not_found",
      message: "Resource not found for end_date.",
    },
    {
      code: "resource_not_found",
      message: "Resource not found for startDate.",
    },
  ];

  for (const { code, message } of ambiguousCases) {
    const warnings: Record<string, unknown>[] = [];
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
              slug: "oura",
              name: "Oura Ring",
              status: "connected",
              resource_availability: {
                profile: true,
              },
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
        return createJsonResponse({
          error: code,
          message,
        }, 422);
      }

      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: ["profile"],
      timeseriesResources: [],
    });

    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
        logger: {
          warn(_message, context) {
            warnings.push(context ?? {});
          },
        },
      }),
      createJob("reconcile", {
        windowStart: "2026-04-02T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.equal(importedSnapshots.length, 1);
    assert.deepEqual(warnings, [
      {
        errorCode: "JUNCTION_API_REQUEST_FAILED",
        provider: "junction",
        reason: "ambiguous",
        resource: "profile",
        resourceCategory: "summary",
        responseStatus: 422,
        responseDetail: `${code}: ${message}`,
      },
    ]);
    assert.equal(result.metadataPatch?.junctionSkippedResourceLast, "summary.profile.422.ambiguous");
    assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, `${code}: ${message}`);
    assert.equal(JSON.stringify(warnings).includes("junction-user-1"), false);
  }
});

test("Junction ambiguous skip detail redacts the account id from provider error text", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({
        code: "invalid_request",
        message: "User Junction-User-1 cannot access this summary.",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(warnings.length, 1);
  assert.equal(
    warnings[0]?.responseDetail,
    "invalid_request: User <redacted-id> cannot access this summary.",
  );
  assert.equal(
    result.metadataPatch?.junctionSkippedResourceLastDetail,
    "invalid_request: User <redacted-id> cannot access this summary.",
  );
  assert.equal(JSON.stringify(warnings).toLowerCase().includes("junction-user-1"), false);
  assert.equal(JSON.stringify(result.metadataPatch).toLowerCase().includes("junction-user-1"), false);
});

test("Junction ambiguous skip detail truncates unknown assignment tails after user_id prose", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({
        code: "invalid_request",
        message: "request rejected for user_id: hbm_abc123, display_name=Jane Doe upstream",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const expectedDetail = "invalid_request: request rejected for user_id: <redacted-id>";
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, expectedDetail);
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, expectedDetail);

  const serializedWarnings = JSON.stringify(warnings);
  const serializedMetadata = JSON.stringify(result.metadataPatch);
  for (const sensitive of ["display_name", "hbm_abc123", "Jane", "Doe"]) {
    assert.equal(serializedWarnings.includes(sensitive), false);
    assert.equal(serializedMetadata.includes(sensitive), false);
  }
});

test("Junction ambiguous skip detail drops object-shaped display-name diagnostics", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        detail: {
          type: "resource_misconfigured",
          msg: "display_name: Jane Doe cannot access sleep_cycle",
        },
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, "resource_misconfigured");
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, "resource_misconfigured");

  const serializedWarnings = JSON.stringify(warnings);
  const serializedMetadata = JSON.stringify(result.metadataPatch);
  for (const sensitive of ["display_name", "Jane", "Doe"]) {
    assert.equal(serializedWarnings.includes(sensitive), false);
    assert.equal(serializedMetadata.includes(sensitive), false);
  }
});

test("Junction ambiguous skip detail drops object-shaped unlabeled user diagnostics", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        detail: {
          type: "resource_misconfigured",
          msg: "Patient Jane Doe not found",
        },
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const expectedDetail = "resource_misconfigured";
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, expectedDetail);
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, expectedDetail);

  const serializedWarnings = JSON.stringify(warnings);
  const serializedMetadata = JSON.stringify(result.metadataPatch);
  for (const sensitive of ["Jane", "Doe"]) {
    assert.equal(serializedWarnings.includes(sensitive), false);
    assert.equal(serializedMetadata.includes(sensitive), false);
  }
});

test("Junction ambiguous skip detail masks object-shaped credential-label diagnostics", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        detail: {
          type: "resource_misconfigured",
          msg: "api key secretvalue leaked",
        },
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const expectedDetail = "resource_misconfigured: api key <redacted-token> leaked";
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, expectedDetail);
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, expectedDetail);

  const serializedWarnings = JSON.stringify(warnings);
  const serializedMetadata = JSON.stringify(result.metadataPatch);
  assert.equal(serializedWarnings.includes("secretvalue"), false);
  assert.equal(serializedMetadata.includes("secretvalue"), false);
});

test("Junction ambiguous skip detail masks slash-bearing identifier phrases", async () => {
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({
        code: "invalid_request",
        message: "user hbm_abc123/Jane-Doe is blocked upstream",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const expectedDetail = "invalid_request: user <redacted-id> is blocked upstream";
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, expectedDetail);
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, expectedDetail);

  const serializedWarnings = JSON.stringify(warnings);
  const serializedMetadata = JSON.stringify(result.metadataPatch);
  for (const sensitive of ["hbm_abc123", "Jane", "Doe"]) {
    assert.equal(serializedWarnings.includes(sensitive), false);
    assert.equal(serializedMetadata.includes(sensitive), false);
  }
});

test("Junction ambiguous skip detail masks embedded ids from provider prose", async () => {
  const warnings: Record<string, unknown>[] = [];
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
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        detail: "Team 00000000-0000-4000-8000-000000000001 is not configured for sleep_cycle.",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(
    result.metadataPatch?.junctionSkippedResourceLastDetail,
    "Team <redacted-id> is not configured for sleep_cycle.",
  );
  assert.equal(
    warnings[0]?.responseDetail,
    "Team <redacted-id> is not configured for sleep_cycle.",
  );
  assert.equal(
    JSON.stringify(result.metadataPatch).includes("00000000-0000-4000-8000-000000000001"),
    false,
  );
});

test("Junction ambiguous skip detail drops id-shaped provider error codes", async () => {
  const warnings: Record<string, unknown>[] = [];
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
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        code: "00000000-0000-4000-8000-000000000002",
        message: "sleep_cycle disabled",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, "sleep_cycle disabled");
  assert.equal(warnings[0]?.responseDetail, "sleep_cycle disabled");
  assert.equal(
    JSON.stringify(warnings).includes("00000000-0000-4000-8000-000000000002"),
    false,
  );
  assert.equal(
    JSON.stringify(result.metadataPatch).includes("00000000-0000-4000-8000-000000000002"),
    false,
  );
});

test("Junction ambiguous skip detail reads FastAPI-shaped sleep_cycle validation arrays", async () => {
  const warnings: Record<string, unknown>[] = [];
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
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse([
        {
          type: "value_error.date",
          msg: "start_date must be before end_date",
        },
      ], 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const expectedDetail = "value_error.date: start_date must be before end_date";
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, expectedDetail);
  assert.equal(warnings[0]?.responseDetail, expectedDetail);
});

test("Junction ambiguous skip detail keeps safe date validation prose before bracket suffixes", async () => {
  const warnings: Record<string, unknown>[] = [];
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
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        detail: "Datetimes provided to dates should have zero time [type=date_from_datetime_inexact]",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const storedDetail = result.metadataPatch?.junctionSkippedResourceLastDetail;
  const warningDetail = warnings[0]?.responseDetail;

  assert.equal(storedDetail, "Datetimes provided to dates should have zero time");
  assert.equal(warningDetail, "Datetimes provided to dates should have zero time");
  assert.equal(storedDetail?.endsWith("zero time"), true);
  assert.equal(warningDetail?.includes("Datetimes provided to dates should have zero time"), true);

  for (const exposed of [JSON.stringify(warnings), JSON.stringify(result.metadataPatch)]) {
    assert.equal(exposed.includes("date_from_datetime_inexact"), false);
    assert.equal(exposed.includes("type="), false);
  }
});

test("Junction ambiguous skip detail ignores top-level primitive arrays", async () => {
  const warnings: Record<string, unknown>[] = [];
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
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse(["Jane Doe"], 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, undefined);
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, null);

  for (const exposed of [JSON.stringify(warnings), JSON.stringify(result.metadataPatch)]) {
    assert.equal(exposed.includes("Jane"), false);
    assert.equal(exposed.includes("Doe"), false);
  }
});

test("Junction ambiguous skip detail truncates bracketed diagnostics with unknown keys", async () => {
  const warnings: Record<string, unknown>[] = [];
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
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        code: "invalid_request",
        message: "Validation failed [user_id=1234, display_name=Jane Doe]",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, "invalid_request: Validation failed");
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, "invalid_request: Validation failed");

  for (const exposed of [JSON.stringify(warnings), JSON.stringify(result.metadataPatch)]) {
    assert.equal(exposed.includes("Jane"), false);
    assert.equal(exposed.includes("Doe"), false);
    assert.equal(exposed.includes("1234"), false);
  }
});

test("Junction ambiguous skip detail keeps safe prefix before nested bracketed diagnostics", async () => {
  const warnings: Record<string, unknown>[] = [];
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
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        message: "Validation failed [context [field] display_name=Jane]",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.responseDetail, "Validation failed");
  assert.equal(result.metadataPatch?.junctionSkippedResourceLastDetail, "Validation failed");

  for (const exposed of [JSON.stringify(warnings), JSON.stringify(result.metadataPatch)]) {
    assert.equal(exposed.includes("Jane"), false);
    assert.equal(exposed.includes("display_name"), false);
  }
});

test("Junction ambiguous skip detail reads object-shaped provider error bodies", async () => {
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
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        detail: { type: "resource_misconfigured", msg: "user hbm_abc123xyz sleep_cycle summaries are disabled." },
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext(),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(
    result.metadataPatch?.junctionSkippedResourceLastDetail,
    "resource_misconfigured: user <redacted-id> sleep_cycle summaries are disabled.",
  );
});

test("Junction ambiguous skip detail is clamped to the stored-metadata string cap", async () => {
  const longMessage = "sleep cycle summaries are disabled for this integration tier. ".repeat(6).trim();
  assert.ok(longMessage.length > 256 && longMessage.length < 512);
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              profile: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/profile/junction-user-1")) {
      return createJsonResponse({
        code: "invalid_request",
        message: longMessage,
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["profile"],
    timeseriesResources: [],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("reconcile", {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  const detail = result.metadataPatch?.junctionSkippedResourceLastDetail;
  assert.equal(typeof detail, "string");
  assert.ok(typeof detail === "string" && detail.length > 0 && detail.length <= 256);
  assert.ok(typeof detail === "string" && detail.startsWith("invalid_request: sleep cycle summaries are disabled"));
  assert.equal(warnings[0]?.responseDetail, detail);
});

test("Junction companion HRV jobs import the derived observation without Junction HTTP requests", async () => {
  let fetchCalls = 0;
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async () => {
    fetchCalls += 1;
    throw new Error("Companion HRV jobs must not call Junction.");
  });
  const context = createJunctionJobContext({
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });
  const observation = {
    schema: COMPANION_HRV_RMSSD_SCHEMA,
    methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
    nightDate: "2026-04-02",
    rmssdMs: 48.25,
    completedWindowCount: 96,
    acceptedWindowCount: 56,
  } satisfies Parameters<typeof serializeCompanionHrvRmssdObservation>[0];
  const companionObservationJson = serializeCompanionHrvRmssdObservation(observation);
  const companionAdmissionId = createHash("sha256")
    .update(companionObservationJson)
    .digest("hex");

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      companionAdmissionId,
      companionObservationJson,
      resource: COMPANION_HRV_RMSSD_RESOURCE,
      resourceCategory: "derived",
      sourceProviderSlug: "whoop",
    }),
  );

  assert.deepEqual(result, {});
  assert.equal(fetchCalls, 0);
  assert.deepEqual(importedSnapshots, [{
    provider: "junction",
    accountId: `jxn_acct_${createHash("sha256")
      .update(JSON.stringify(["junction-import-account", "junction-user-1"]))
      .digest("hex")
      .slice(0, 32)}`,
    connectionId: "acct-junction-1",
    importedAt: "2026-04-03T00:00:00.000Z",
    companionHrvRmssd: {
      admissionId: companionAdmissionId,
      observation,
    },
  }]);
});

test("Junction companion jobs do not import through a disconnected exact source", async () => {
  let fetchCalls = 0;
  const provider = createJunctionProvider(async () => {
    fetchCalls += 1;
    throw new Error("Fenced companion jobs must not call Junction.");
  });
  const hrvObservation = {
    schema: COMPANION_HRV_RMSSD_SCHEMA,
    methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
    nightDate: "2026-04-02",
    rmssdMs: 48.25,
    completedWindowCount: 96,
    acceptedWindowCount: 56,
  } satisfies Parameters<typeof serializeCompanionHrvRmssdObservation>[0];
  const hrvJson = serializeCompanionHrvRmssdObservation(hrvObservation);
  const jobs = [
    {
      authoritySourceProviderSlug: "whoop_v2",
      payload: {
        companionAdmissionId: createHash("sha256").update(hrvJson).digest("hex"),
        companionObservationJson: hrvJson,
        resource: COMPANION_HRV_RMSSD_RESOURCE,
        resourceCategory: "derived",
        sourceProviderSlug: "whoop",
      },
    },
    {
      authoritySourceProviderSlug: "apple_health_kit",
      payload: {
        eventType: JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
        occurredAt: "2026-04-03T13:00:00.000Z",
        resource: JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
        resourceCategory: "summary",
        sourceProviderSlug: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
        webhookDataJson: JSON.stringify({
          records: [{
            endAt: "2026-04-02T12:00:00-04:00",
            kind: "recovery_score",
            recordId: "a".repeat(64),
            startAt: "2026-04-02T04:00:00-04:00",
            syncVersion: 3,
            value: 72,
          }],
          schemaVersion: 1,
        }),
      },
    },
  ];

  for (const testCase of jobs) {
    const importedSnapshots: unknown[] = [];
    const result = await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({
          sources: [{
            displayName: null,
            firstSeenAt: "2026-04-03T00:00:00.000Z",
            lastDataAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSeenAt: "2026-04-03T00:00:00.000Z",
            resourceCount: 0,
            sourceProviderSlug: testCase.authoritySourceProviderSlug,
            status: "connected",
          }],
        }),
        listConnectionSources: async () => [{
          displayName: null,
          lastDataAt: null,
          lastErrorCode: "SOURCE_USER_DISCONNECTED",
          lastErrorMessage: null,
          lastSeenAt: "2026-04-03T00:00:00.000Z",
          sourceProviderSlug: testCase.authoritySourceProviderSlug,
          status: "disconnected",
        }],
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("resource", testCase.payload),
    );

    assert.deepEqual(result, {});
    assert.deepEqual(importedSnapshots, []);
  }
  assert.equal(fetchCalls, 0);
});

test("Junction companion import rechecks current source authority at the import boundary", async () => {
  const provider = createJunctionProvider(async () => {
    throw new Error("Companion HRV import must not call Junction.");
  });
  const observation = {
    schema: COMPANION_HRV_RMSSD_SCHEMA,
    methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
    nightDate: "2026-04-02",
    rmssdMs: 48.25,
    completedWindowCount: 96,
    acceptedWindowCount: 56,
  } satisfies Parameters<typeof serializeCompanionHrvRmssdObservation>[0];
  const observationJson = serializeCompanionHrvRmssdObservation(observation);
  const job = createJob("resource", {
    companionAdmissionId: createHash("sha256").update(observationJson).digest("hex"),
    companionObservationJson: observationJson,
    resource: COMPANION_HRV_RMSSD_RESOURCE,
    resourceCategory: "derived",
    sourceProviderSlug: "whoop",
  });
  const cachedAccount = createAccount({
    sources: [{
      displayName: null,
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      lastDataAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      resourceCount: 0,
      sourceProviderSlug: "whoop_v2",
      status: "connected",
    }],
  });
  let importedCount = 0;
  const connectedSource = {
    displayName: null,
    lastDataAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-04-03T00:00:00.000Z",
    sourceProviderSlug: "whoop_v2",
    status: "connected" as const,
  };

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: cachedAccount,
        importSnapshot: async () => {
          importedCount += 1;
          return { imported: true };
        },
        listConnectionSources: async () => [{
          ...connectedSource,
          lastErrorCode: "SOURCE_DISCONNECT_IN_PROGRESS",
        }],
      }),
      job,
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_COMPANION_SOURCE_NOT_READY"
      && error.retryable,
  );
  assert.equal(importedCount, 0);

  await assert.rejects(
    executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: cachedAccount,
        importSnapshot: async () => {
          importedCount += 1;
          return { imported: true };
        },
        listConnectionSources: async () => {
          throw new Error("hosted authority unavailable");
        },
      }),
      job,
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_COMPANION_SOURCE_STATE_UNAVAILABLE"
      && error.retryable,
  );
  assert.equal(importedCount, 0);

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: cachedAccount,
      importSnapshot: async () => {
        importedCount += 1;
        return { imported: true };
      },
      listConnectionSources: async () => [connectedSource],
    }),
    job,
  );
  assert.equal(importedCount, 1);
});

test("Junction companion HRV jobs reject malformed derived observations without network access", async () => {
  let fetchCalls = 0;
  const provider = createJunctionProvider(async () => {
    fetchCalls += 1;
    throw new Error("Unexpected Junction request.");
  });

  await assert.rejects(
    () => executeJunctionJob(
      provider,
      createJunctionJobContext(),
      createJob("resource", {
        companionObservationJson: JSON.stringify({ rawBleBytes: [1, 2, 3] }),
        resource: COMPANION_HRV_RMSSD_RESOURCE,
      }),
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_COMPANION_HRV_OBSERVATION_INVALID",
  );
  assert.equal(fetchCalls, 0);
});

test("Junction companion HRV jobs reject mismatched admission identities without network access", async () => {
  let fetchCalls = 0;
  const provider = createJunctionProvider(async () => {
    fetchCalls += 1;
    throw new Error("Unexpected Junction request.");
  });
  const observation = {
    schema: COMPANION_HRV_RMSSD_SCHEMA,
    methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
    nightDate: "2026-04-02",
    rmssdMs: 48.25,
    completedWindowCount: 96,
    acceptedWindowCount: 56,
  };

  await assert.rejects(
    () => executeJunctionJob(
      provider,
      createJunctionJobContext(),
      createJob("resource", {
        companionAdmissionId: "f".repeat(64),
        companionObservationJson: JSON.stringify(observation),
        resource: COMPANION_HRV_RMSSD_RESOURCE,
      }),
    ),
    (error: unknown) =>
      error instanceof DeviceSyncError
      && error.code === "JUNCTION_COMPANION_HRV_OBSERVATION_INVALID",
  );
  assert.equal(fetchCalls, 0);
});

test("Junction resource jobs import direct daily data webhook payloads without Junction HTTP requests", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
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

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
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
    createJob("resource", {
      eventType: "historical.data.activity.created",
      objectId: "activity-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "activity-1",
        memo: "from junction-user-1 payload",
        sourceProviderSlug: "garmin",
        steps: 4321,
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
    windowEnd?: string;
    windowStart?: string;
  };
  assert.equal(snapshot.windowStart, "2026-04-01T00:00:00.000Z");
  assert.equal(snapshot.windowEnd, "2026-04-05T00:00:00.000Z");
  assert.equal(snapshot.summaries?.activity?.[0]?.steps, 4321);
  assert.equal(snapshot.summaries?.activity?.[0]?.memo, "from [redacted] payload");
  assert.equal(snapshot.summaries?.activity?.[0]?.sourceProviderSlug, "garmin");
  assert.deepEqual(snapshot.timeseries, {});
  assert.doesNotMatch(JSON.stringify(snapshot), /junction-user-1/u);
});

test("Junction imports multiple direct daily payloads via per-job execution without Junction HTTP requests", async () => {
  // Batching was removed (P3); multiple direct webhook records now import as N
  // separate resource jobs, each importing its own payload via executeJob. This
  // guards the data-loss equivalence of that per-job fallback.
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });
  const context = createJunctionJobContext({
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
  });
  const firstJob = createJob("resource", {
    eventType: "daily.data.activity.created",
    objectId: "activity-1",
    occurredAt: "2026-04-02T00:00:00.000Z",
    resource: "activity",
    resourceCategory: "summary",
    sourceProviderSlug: "garmin",
    webhookDataJson: JSON.stringify({
      date: "2026-04-02",
      id: "activity-1",
      memo: "first from junction-user-1 payload",
      sourceProviderSlug: "garmin",
      steps: 111,
    }),
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-05T00:00:00.000Z",
  });
  const secondJob = createJob("resource", {
    eventType: "daily.data.activity.created",
    objectId: "activity-2",
    occurredAt: "2026-04-02T00:00:00.000Z",
    resource: "activity",
    resourceCategory: "summary",
    sourceProviderSlug: "garmin",
    webhookDataJson: JSON.stringify({
      date: "2026-04-02",
      id: "activity-2",
      memo: "second from junction-user-1 payload",
      sourceProviderSlug: "garmin",
      steps: 222,
    }),
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-05T00:00:00.000Z",
  });

  await executeJunctionJob(provider, context, firstJob);
  await executeJunctionJob(provider, context, secondJob);

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 2);
  const records = importedSnapshots.flatMap((raw) => {
    const snapshot = raw as {
      summaries?: Record<string, Array<Record<string, unknown>>>;
      timeseries?: Record<string, unknown[]>;
      windowEnd?: string;
      windowStart?: string;
    };
    assert.equal(snapshot.windowStart, "2026-04-01T00:00:00.000Z");
    assert.equal(snapshot.windowEnd, "2026-04-05T00:00:00.000Z");
    assert.deepEqual(snapshot.timeseries, {});
    assert.doesNotMatch(JSON.stringify(snapshot), /junction-user-1/u);
    return snapshot.summaries?.activity ?? [];
  });
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.steps), [111, 222]);
  assert.deepEqual(
    records.map((record) => record.memo),
    ["first from [redacted] payload", "second from [redacted] payload"],
  );
  assert.deepEqual(records.map((record) => record.sourceProviderSlug), ["garmin", "garmin"]);
});

test("Junction resource jobs import direct Garmin sleep webhook payloads without source references", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep: true,
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.sleep.created",
      objectId: "sleep-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "sleep",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        data: [
          {
            average_hrv: 42,
            bedtime_start: "2026-04-02T03:00:00.000Z",
            bedtime_stop: "2026-04-02T11:00:00.000Z",
            deep: 5400,
            duration: 28800,
            efficiency: 0.94,
            hr_average: 54,
            hr_lowest: 43,
            id: "sleep-1",
            light: 12600,
            rem: 7200,
            total: 25200,
          },
        ],
        id: "sleep-webhook-1",
        sourceProviderSlug: "garmin",
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  const sleepRecord = snapshot.summaries?.sleep?.[0];
  const sleepData = sleepRecord?.data as Array<Record<string, unknown>> | undefined;
  assert.equal(sleepRecord?.sourceProviderSlug, "garmin");
  assert.equal(sleepData?.[0]?.duration, 28800);
  assert.equal(sleepData?.[0]?.total, 25200);
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction resource jobs import direct Garmin sleep webhook object data without source references", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep: true,
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.sleep.created",
      objectId: "sleep-object-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "sleep",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        data: {
          average_hrv: 42,
          bedtime_start: "2026-04-02T03:00:00.000Z",
          bedtime_stop: "2026-04-02T11:00:00.000Z",
          deep: 5400,
          duration: 28800,
          efficiency: 0.94,
          hr_average: 54,
          hr_lowest: 43,
          id: "sleep-object-1",
          light: 12600,
          rem: 7200,
          total: 25200,
        },
        id: "sleep-webhook-object-1",
        sourceProviderSlug: "garmin",
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  const sleepRecord = snapshot.summaries?.sleep?.[0];
  const sleepData = sleepRecord?.data as Record<string, unknown> | undefined;
  assert.equal(sleepRecord?.sourceProviderSlug, "garmin");
  assert.equal(sleepData?.duration, 28800);
  assert.equal(sleepData?.total, 25200);
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction resource jobs resolve direct Garmin sleep provider references before import", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
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
            source: {
              device_id: "garmin-watch-1",
            },
            status: "connected",
            resource_availability: {
              sleep: true,
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      upsertConnectionSource: () => {
        throw new Error("Direct sleep imports should not project Junction source state.");
      },
    }),
    createJob("resource", {
      eventType: "daily.data.sleep.created",
      objectId: "sleep-provider-reference-1",
      occurredAt: "2026-04-02T11:00:00.000Z",
      resource: "sleep",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        average_hrv: 42,
        bedtime_start: "2026-04-02T03:00:00.000Z",
        bedtime_stop: "2026-04-02T11:00:00.000Z",
        deep: 5400,
        duration: 28800,
        id: "sleep-provider-reference-1",
        light: 12600,
        provider_connection_id: "provider-garmin-1",
        rem: 7200,
        sourceProviderSlug: "garmin",
        total: 25200,
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    connections?: Array<Record<string, unknown>>;
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  const sleepRecord = snapshot.summaries?.sleep?.[0];
  const sourceInstanceId = snapshot.connections?.[0]?.sourceInstanceId;
  assert.ok(requests.some((url) => url.includes("/v2/user/providers/")));
  assert.equal(requests.some((url) => url.includes("/v2/summary/sleep/")), false);
  assert.equal(typeof sourceInstanceId, "string");
  assert.equal(sleepRecord?.sourceInstanceId, sourceInstanceId);
  assert.equal("provider_connection_id" in (sleepRecord ?? {}), false);
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction resource jobs fetch direct Garmin sleep-cycle stage payloads without parent coverage", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        data: [{
          id: "sleep-cycle-fetched-1",
          provider_connection_id: "provider-garmin-1",
          sourceProviderSlug: "garmin",
          start: "2026-04-02T04:45:00.000Z",
          end: "2026-04-02T05:30:00.000Z",
          stages: [
            {
              endAt: "2026-04-02T05:30:00.000Z",
              stage: "deep",
              startAt: "2026-04-02T04:45:00.000Z",
            },
          ],
        }],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.sleep_cycle.created",
      objectId: "sleep-cycle-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "sleep_cycle",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        data: [
          {
            id: "sleep-cycle-1",
            stages: [
              {
                endAt: "2026-04-02T05:30:00.000Z",
                stage: "deep",
                startAt: "2026-04-02T04:45:00.000Z",
              },
            ],
          },
        ],
        id: "sleep-cycle-webhook-1",
        sourceProviderSlug: "garmin",
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  const sleepCycleRecord = snapshot.summaries?.sleep_cycle?.[0];
  const stages = sleepCycleRecord?.stages as Array<Record<string, unknown>> | undefined;
  assert.ok(requests.some((url) => url.includes("/v2/summary/sleep_cycle/")));
  assert.equal(sleepCycleRecord?.sourceProviderSlug, "garmin");
  assert.equal(sleepCycleRecord?.id, "sleep-cycle-fetched-1");
  assert.equal(stages?.[0]?.stage, "deep");
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction resource jobs import direct Garmin sleep-cycle stage payloads with parent coverage", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
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
            source: {
              device_id: "garmin-watch-1",
            },
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
      return createJsonResponse({
        data: [{
          id: "sleep-cycle-stale-rest-1",
          sourceProviderSlug: "garmin",
          start: "2026-06-29T04:00:00.000Z",
          end: "2026-06-29T05:00:00.000Z",
          stages: [{
            endAt: "2026-06-29T05:00:00.000Z",
            stage: "awake",
            startAt: "2026-06-29T04:00:00.000Z",
          }],
        }],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });

  const directSleepCycleData = {
    end: "2026-06-30T11:00:00.000Z",
    id: "sleep-cycle-cross-midnight-1",
    provider_connection_id: "provider-garmin-1",
    sourceProviderSlug: "garmin",
    stages: [
      {
        endAt: "2026-06-30T06:30:00.000Z",
        stage: "light",
        startAt: "2026-06-30T03:30:00.000Z",
      },
      {
        endAt: "2026-06-30T11:00:00.000Z",
        stage: "deep",
        startAt: "2026-06-30T06:30:00.000Z",
      },
    ],
    start: "2026-06-30T03:30:00.000Z",
    timeZone: "America/New_York",
  };
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.sleep_cycle.created",
      user_id: "junction-user-1",
      client_user_id: "murph_blinded",
      data: directSleepCycleData,
    },
    messageId: "msg_sleep_cycle_cross_midnight_1",
    timestamp: String(Math.floor(Date.parse("2026-06-30T11:30:00.000Z") / 1000)),
  });
  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-06-30T11:31:00.000Z",
  });
  const parsedJob = parsed.jobs[0];
  assert.ok(parsedJob);
  assert.equal(parsedJob.kind, "resource");
  const parsedPayload = parsedJob.payload;
  assert.ok(parsedPayload);
  assert.equal(typeof parsedPayload.webhookDataJson, "string");
  const queuedWebhookData = JSON.parse(String(parsedPayload.webhookDataJson)) as Record<string, unknown>;
  assert.equal(queuedWebhookData.provider_connection_id, "provider-garmin-1");
  assert.equal(JSON.stringify(queuedWebhookData).includes("junction-user-1"), false);
  assert.equal(JSON.stringify(queuedWebhookData).includes("murph_blinded"), false);

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      upsertConnectionSource: () => {
        throw new Error("Direct sleep_cycle imports should not project Junction source state.");
      },
    }),
    createJob(parsedJob.kind, parsedPayload),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    connections?: Array<Record<string, unknown>>;
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  const sleepCycleRecord = snapshot.summaries?.sleep_cycle?.[0];
  const stages = sleepCycleRecord?.stages as Array<Record<string, unknown>> | undefined;
  const sourceInstanceId = snapshot.connections?.[0]?.sourceInstanceId;
  assert.ok(requests.some((url) => url.includes("/v2/user/providers/")));
  assert.equal(requests.some((url) => url.includes("/v2/summary/sleep_cycle/")), false);
  assert.equal(typeof sourceInstanceId, "string");
  assert.equal(typeof sourceInstanceId === "string" && sourceInstanceId.startsWith("source-"), true);
  assert.equal(sleepCycleRecord?.sourceInstanceId, sourceInstanceId);
  assert.equal("provider_connection_id" in (sleepCycleRecord ?? {}), false);
  assert.equal(sleepCycleRecord?.sourceProviderSlug, "garmin");
  assert.equal(sleepCycleRecord?.id, "sleep-cycle-cross-midnight-1");
  assert.equal(stages?.[0]?.stage, "light");
  assert.equal(stages?.[1]?.stage, "deep");
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction direct sleep-cycle payloads without source references import without loading providers", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url.includes("/v2/user/providers/")) {
      throw new Error("Junction provider-list endpoint is unavailable.");
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });

  const directSleepCycleData = {
    end: "2026-06-30T11:00:00.000Z",
    id: "sleep-cycle-no-source-reference-1",
    sourceProviderSlug: "garmin",
    stages: [
      {
        endAt: "2026-06-30T06:30:00.000Z",
        stage: "light",
        startAt: "2026-06-30T03:30:00.000Z",
      },
      {
        endAt: "2026-06-30T11:00:00.000Z",
        stage: "deep",
        startAt: "2026-06-30T06:30:00.000Z",
      },
    ],
    start: "2026-06-30T03:30:00.000Z",
    timeZone: "America/New_York",
  };
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.sleep_cycle.created",
      user_id: "junction-user-1",
      client_user_id: "murph_blinded",
      data: directSleepCycleData,
    },
    messageId: "msg_sleep_cycle_no_source_reference_1",
    timestamp: String(Math.floor(Date.parse("2026-06-30T11:30:00.000Z") / 1000)),
  });
  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-06-30T11:31:00.000Z",
  });
  const parsedJob = parsed.jobs[0];
  assert.ok(parsedJob);
  assert.equal(parsedJob.kind, "resource");
  const parsedPayload = parsedJob.payload;
  assert.ok(parsedPayload);

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      upsertConnectionSource: () => {
        throw new Error("Direct sleep_cycle imports should not project Junction source state.");
      },
    }),
    createJob(parsedJob.kind, parsedPayload),
  );

  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  const sleepCycleRecord = snapshot.summaries?.sleep_cycle?.[0];
  const stages = sleepCycleRecord?.stages as Array<Record<string, unknown>> | undefined;
  assert.equal(requests.some((url) => url.includes("/v2/user/providers/")), false);
  assert.equal(requests.some((url) => url.includes("/v2/summary/sleep_cycle/")), false);
  assert.equal(sleepCycleRecord?.id, "sleep-cycle-no-source-reference-1");
  assert.equal(sleepCycleRecord?.sourceProviderSlug, "garmin");
  assert.equal(stages?.[0]?.stage, "light");
  assert.equal(stages?.[1]?.stage, "deep");
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction signed direct sleep-cycle source reference aliases resolve at execution", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
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
            source: {
              device_id: "garmin-watch-1",
            },
            status: "connected",
            resource_availability: {
              sleep_cycle: true,
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });

  for (const sourceReferenceKey of ["connection_id", "source_id"] as const) {
    const directSleepCycleData: Record<string, unknown> = {
      end: "2026-06-30T11:00:00.000Z",
      id: `sleep-cycle-${sourceReferenceKey}`,
      sourceProviderSlug: "garmin",
      stages: [
        {
          endAt: "2026-06-30T06:30:00.000Z",
          stage: "light",
          startAt: "2026-06-30T03:30:00.000Z",
        },
        {
          endAt: "2026-06-30T11:00:00.000Z",
          stage: "deep",
          startAt: "2026-06-30T06:30:00.000Z",
        },
      ],
      start: "2026-06-30T03:30:00.000Z",
      timeZone: "America/New_York",
      [sourceReferenceKey]: "provider-garmin-1",
    };
    const webhook = createJunctionSvixWebhook({
      body: {
        event_type: "daily.data.sleep_cycle.created",
        user_id: "junction-user-1",
        client_user_id: "murph_blinded",
        data: directSleepCycleData,
      },
      messageId: `msg_sleep_cycle_${sourceReferenceKey}`,
      timestamp: String(Math.floor(Date.parse("2026-06-30T11:30:00.000Z") / 1000)),
    });
    const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
      headers: webhook.headers,
      rawBody: webhook.rawBody,
      now: "2026-06-30T11:31:00.000Z",
    });
    const parsedJob = parsed.jobs[0];
    assert.ok(parsedJob);
    assert.equal(parsedJob.kind, "resource");
    const parsedPayload = parsedJob.payload;
    assert.ok(parsedPayload);
    assert.equal(typeof parsedPayload.webhookDataJson, "string");
    const queuedWebhookData = JSON.parse(String(parsedPayload.webhookDataJson)) as Record<string, unknown>;
    assert.equal(queuedWebhookData[sourceReferenceKey], "provider-garmin-1", sourceReferenceKey);
    assert.equal(queuedWebhookData.sourceInstanceId, undefined, sourceReferenceKey);

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
        upsertConnectionSource: () => {
          throw new Error("Direct sleep_cycle imports should not project Junction source state.");
        },
      }),
      createJob(parsedJob.kind, parsedPayload),
    );

    const snapshot = importedSnapshots[importedSnapshots.length - 1] as {
      connections?: Array<Record<string, unknown>>;
      summaries?: Record<string, Array<Record<string, unknown>>>;
      timeseries?: Record<string, unknown[]>;
    } | undefined;
    const sleepCycleRecord = snapshot?.summaries?.sleep_cycle?.[0];
    const sourceInstanceId = snapshot?.connections?.[0]?.sourceInstanceId;
    assert.equal(typeof sourceInstanceId, "string", sourceReferenceKey);
    assert.equal(sleepCycleRecord?.sourceInstanceId, sourceInstanceId, sourceReferenceKey);
    assert.equal(sourceReferenceKey in (sleepCycleRecord ?? {}), false, sourceReferenceKey);
    assert.deepEqual(snapshot?.timeseries, {}, sourceReferenceKey);
  }

  assert.ok(requests.some((url) => url.includes("/v2/user/providers/")));
  assert.equal(requests.some((url) => url.includes("/v2/summary/sleep_cycle/")), false);
});

test("Junction direct Garmin sleep-cycle payloads without normalizable coverage fall back to fetch", async () => {
  const cases: Array<{ directRecord: Record<string, unknown>; label: string }> = [
    {
      directRecord: {
        data: [
          {
            id: "sleep-cycle-inline-summary-only",
            total: 25200,
          },
        ],
        id: "sleep-cycle-webhook-summary-only",
        sourceProviderSlug: "garmin",
      },
      label: "summary-only",
    },
    {
      directRecord: {
        data: [
          {
            id: "sleep-cycle-inline-stage-count-only",
            stageCount: 4,
          },
        ],
        id: "sleep-cycle-webhook-stage-count-only",
        sourceProviderSlug: "garmin",
      },
      label: "stage-count-only",
    },
    {
      directRecord: {
        data: [
          {
            endAt: "2026-04-02T05:30:00.000Z",
            id: "sleep-cycle-inline-generic-type",
            startAt: "2026-04-02T04:45:00.000Z",
            type: "sleep_cycle",
          },
        ],
        id: "sleep-cycle-webhook-generic-type",
        sourceProviderSlug: "garmin",
      },
      label: "generic-type",
    },
    {
      directRecord: {
        end: "2026-06-30T11:00:00.000Z",
        id: "sleep-cycle-inline-incomplete-parent",
        sourceProviderSlug: "garmin",
        stages: [{
          endAt: "2026-06-30T06:30:00.000Z",
          stage: "light",
          startAt: "2026-06-30T03:30:00.000Z",
        }],
        start: "2026-06-30T03:30:00.000Z",
      },
      label: "incomplete-parent-coverage",
    },
    {
      directRecord: {
        end: "2026-06-30T11:00:00.000Z",
        id: "sleep-cycle-inline-overlapping-parent",
        sourceProviderSlug: "garmin",
        stages: [
          {
            endAt: "2026-06-30T11:00:00.000Z",
            stage: "light",
            startAt: "2026-06-30T03:30:00.000Z",
          },
          {
            endAt: "2026-06-30T07:00:00.000Z",
            stage: "deep",
            startAt: "2026-06-30T06:00:00.000Z",
          },
        ],
        start: "2026-06-30T03:30:00.000Z",
      },
      label: "overlapping-parent-coverage",
    },
    {
      directRecord: {
        data: [
          {
            end: "2026-06-30T11:00:00.000Z",
            id: "sleep-cycle-inline-complete-sibling",
            sourceProviderSlug: "garmin",
            stages: [
              {
                endAt: "2026-06-30T06:30:00.000Z",
                stage: "light",
                startAt: "2026-06-30T03:30:00.000Z",
              },
              {
                endAt: "2026-06-30T11:00:00.000Z",
                stage: "deep",
                startAt: "2026-06-30T06:30:00.000Z",
              },
            ],
            start: "2026-06-30T03:30:00.000Z",
          },
          {
            end: "2026-06-30T11:00:00.000Z",
            id: "sleep-cycle-inline-incomplete-sibling",
            sourceProviderSlug: "garmin",
            stages: [{
              endAt: "2026-06-30T06:30:00.000Z",
              stage: "light",
              startAt: "2026-06-30T03:30:00.000Z",
            }],
            start: "2026-06-30T03:30:00.000Z",
          },
        ],
        id: "sleep-cycle-webhook-mixed-complete-incomplete",
        sourceProviderSlug: "garmin",
      },
      label: "mixed-complete-incomplete-children",
    },
    {
      directRecord: {
        object_id: "sleep-cycle-object-session-only",
        session_end: "2026-06-25T03:00:00.000Z",
        session_start: "2026-06-25T02:00:00.000Z",
        sourceProviderSlug: "garmin",
        stage_end_offset_second: [1800, 3600],
        stage_start_offset_second: [0, 1800],
        stage_type: [2, 1],
      },
      label: "session-offsets-without-normalizer-parent-id",
    },
  ];

  for (const testCase of cases) {
    const requests: string[] = [];
    const importedSnapshots: unknown[] = [];
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
                sleep_cycle: true,
              },
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
        return createJsonResponse({
          data: [{
            id: `sleep-cycle-fetched-${testCase.label}`,
            provider_connection_id: "provider-garmin-1",
            sourceProviderSlug: "garmin",
            start: "2026-04-02T04:45:00.000Z",
            end: "2026-04-02T05:30:00.000Z",
            stages: [{
              endAt: "2026-04-02T05:30:00.000Z",
              stage: "deep",
              startAt: "2026-04-02T04:45:00.000Z",
            }],
          }],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: ["sleep_cycle"],
      timeseriesResources: [],
    });

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("resource", {
        eventType: "daily.data.sleep_cycle.created",
        objectId: `sleep-cycle-${testCase.label}`,
        occurredAt: "2026-04-02T00:00:00.000Z",
        resource: "sleep_cycle",
        resourceCategory: "summary",
        sourceProviderSlug: "garmin",
        webhookDataJson: JSON.stringify(testCase.directRecord),
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-05T00:00:00.000Z",
      }),
    );

    assert.equal(importedSnapshots.length, 1, testCase.label);
    const snapshot = importedSnapshots[0] as {
      summaries?: Record<string, Array<Record<string, unknown>>>;
      timeseries?: Record<string, unknown[]>;
    };
    assert.ok(requests.some((url) => url.includes("/v2/summary/sleep_cycle/")), testCase.label);
    assert.equal(snapshot.summaries?.sleep_cycle?.[0]?.id, `sleep-cycle-fetched-${testCase.label}`, testCase.label);
    assert.equal(snapshot.summaries?.sleep_cycle?.[0]?.sourceProviderSlug, "garmin", testCase.label);
    assert.deepEqual(snapshot.timeseries, {}, testCase.label);
  }
});

test("Junction queued large direct resource payloads import inline without REST fallback", async () => {
  // The 64KB inline-payload size cap was removed (P3). A large direct summary
  // payload now imports inline rather than dropping to a REST summary read; the
  // normalizer downstream decides meaning. No Junction HTTP request is made.
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "historical.data.activity.created",
      objectId: "activity-queued-oversized",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "activity-inline-large",
        memo: "x".repeat(DIRECT_WEBHOOK_JOB_LARGE_BYTES_FOR_TEST),
        sourceProviderSlug: "garmin",
        steps: 9999,
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.equal(snapshot.summaries?.activity?.[0]?.steps, 9999);
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction accepted inline summaries import before runner resource configuration fallback", async () => {
  for (const testCase of [
    {
      eventType: "daily.data.meal.created",
      label: "no configured event fallback",
    },
    {
      eventType: "daily.data.sleep.created",
      label: "different configured event fallback",
    },
  ]) {
    const requests: string[] = [];
    const importedSnapshots: unknown[] = [];
    // Model independent Web/runner configuration authorities: Web already
    // admitted a meal carrier, while this runner enables only sleep.
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);
      requests.push(url);
      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: ["sleep"],
      timeseriesResources: [],
    });

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("resource", {
        eventType: testCase.eventType,
        objectId: `meal-${testCase.label}`,
        occurredAt: "2026-04-02T12:00:00.000Z",
        resource: "meal",
        resourceCategory: "summary",
        sourceProviderSlug: "garmin",
        webhookDataJson: JSON.stringify({
          calories: 640,
          date: "2026-04-02",
          id: `meal-inline-${testCase.label}`,
          sourceProviderSlug: "garmin",
        }),
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );

    assert.deepEqual(requests, [], testCase.label);
    assert.equal(importedSnapshots.length, 1, testCase.label);
    const snapshot = importedSnapshots[0] as {
      summaries?: Record<string, Array<Record<string, unknown>>>;
    };
    assert.equal(
      snapshot.summaries?.meal?.[0]?.id,
      `meal-inline-${testCase.label}`,
      testCase.label,
    );
    assert.equal(snapshot.summaries?.sleep, undefined, testCase.label);
  }
});

test("Junction companion health metadata jobs import one closed unverified HealthKit observation batch", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    requests.push(readUrl(input));
    throw new Error("Companion metadata must not call the Junction API.");
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
      occurredAt: "2026-04-03T13:00:00.000Z",
      resource: JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
      resourceCategory: "summary",
      sourceProviderSlug: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
      webhookDataJson: JSON.stringify({
        schemaVersion: 1,
        records: [
          {
            recordId: "a".repeat(64),
            kind: "recovery_score",
            value: 72,
            startAt: "2026-04-02T04:00:00-04:00",
            endAt: "2026-04-02T12:00:00-04:00",
            syncVersion: 3,
          },
          {
            recordId: "b".repeat(64),
            kind: "workout_strain",
            value: 11.3,
            startAt: "2026-04-02T17:00:00-04:00",
            endAt: "2026-04-02T17:45:00-04:00",
            syncVersion: 4,
          },
        ],
      }),
    }),
  );

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    connectionId?: string;
    importedAt?: string;
    windowStart?: string;
    windowEnd?: string;
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.equal(snapshot.connectionId, undefined);
  assert.equal(snapshot.importedAt, undefined);
  assert.equal(snapshot.windowStart, "2026-04-02T08:00:00.000Z");
  assert.equal(snapshot.windowEnd, "2026-04-02T21:45:00.000Z");
  assert.deepEqual(snapshot.summaries?.sleep, [{
    id: "a".repeat(64),
    date: "2026-04-02T16:00:00.000Z",
    companionStartAt: "2026-04-02T08:00:00.000Z",
    companionEndAt: "2026-04-02T16:00:00.000Z",
    companionSyncVersion: 3,
    recovery_readiness_score: 72,
    sourceProviderSlug: "apple_health_kit",
    sourceType: "companion-whoop-metadata-unverified",
  }]);
  assert.deepEqual(snapshot.summaries?.activity, [{
    id: "b".repeat(64),
    date: "2026-04-02T21:45:00.000Z",
    companionStartAt: "2026-04-02T21:00:00.000Z",
    companionEndAt: "2026-04-02T21:45:00.000Z",
    companionSyncVersion: 4,
    workout_strain: 11.3,
    sourceProviderSlug: "apple_health_kit",
    sourceType: "companion-whoop-metadata-unverified",
  }]);
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction companion health metadata jobs accept exact closed parser boundaries", async () => {
  const importedSnapshots: unknown[] = [];
  const receivedAt = new Date("2026-04-03T13:00:00.000Z");
  const provider = createJunctionProvider(async () => {
    throw new Error("Companion metadata must not call the Junction API.");
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
      occurredAt: receivedAt.toISOString(),
      resource: JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
      resourceCategory: "summary",
      sourceProviderSlug: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
      webhookDataJson: JSON.stringify({
        schemaVersion: 1,
        records: [
          {
            recordId: "c".repeat(64),
            kind: "recovery_score",
            value: 0,
            startAt: new Date(
              receivedAt.getTime() - JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS,
            ).toISOString(),
            endAt: new Date(
              receivedAt.getTime() - JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS + 1,
            ).toISOString(),
            syncVersion: Number.MAX_SAFE_INTEGER,
          },
          {
            recordId: "d".repeat(64),
            kind: "workout_strain",
            value: 21,
            startAt: new Date(
              receivedAt.getTime() + JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS - 1,
            ).toISOString(),
            endAt: new Date(
              receivedAt.getTime() + JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS,
            ).toISOString(),
            syncVersion: 0,
          },
        ],
      }),
    }),
  );

  assert.equal(importedSnapshots.length, 1);
});

test("Junction companion health metadata jobs reject malformed or broadened batches", async () => {
  const record = {
    recordId: "a".repeat(64),
    kind: "recovery_score",
    value: 72,
    startAt: "2026-04-02T08:00:00.000Z",
    endAt: "2026-04-02T16:00:00.000Z",
    syncVersion: 1,
  };
  const cases: Array<{ label: string; payload: Record<string, unknown> }> = [
    {
      label: "wrong event type",
      payload: { eventType: "daily.data.sleep.created" },
    },
    {
      label: "wrong resource category",
      payload: { resourceCategory: "timeseries" },
    },
    {
      label: "wrong transport source",
      payload: { sourceProviderSlug: "whoop" },
    },
    {
      label: "unsupported schema version",
      payload: {
        webhookDataJson: JSON.stringify({ schemaVersion: 2, records: [record] }),
      },
    },
    {
      label: "empty batch",
      payload: {
        webhookDataJson: JSON.stringify({ schemaVersion: 1, records: [] }),
      },
    },
    {
      label: "too many records",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: Array.from(
            { length: JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS + 1 },
            () => record,
          ),
        }),
      },
    },
    {
      label: "malformed record identity",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, recordId: "not-a-hash" }],
        }),
      },
    },
    {
      label: "unknown record kind",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, kind: "sleep_stage" }],
        }),
      },
    },
    {
      label: "out-of-range value",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, value: 101 }],
        }),
      },
    },
    {
      label: "unexpected record field",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, arbitraryMetric: 1 }],
        }),
      },
    },
    {
      label: "unexpected batch field",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [record],
          arbitraryMetric: 1,
        }),
      },
    },
    {
      label: "invalid interval",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, endAt: record.startAt }],
        }),
      },
    },
    {
      label: "non-ISO timestamp",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, startAt: "April 2, 2026 08:00:00 UTC" }],
        }),
      },
    },
    {
      label: "missing receipt timestamp",
      payload: { occurredAt: undefined },
    },
    {
      label: "history older than the server horizon",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{
            ...record,
            startAt: "2025-04-01T08:00:00.000Z",
            endAt: "2025-04-01T16:00:00.000Z",
          }],
        }),
      },
    },
    {
      label: "timestamp beyond the future skew",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{
            ...record,
            startAt: "2026-04-04T12:30:00.000Z",
            endAt: "2026-04-04T13:00:00.001Z",
          }],
        }),
      },
    },
    {
      label: "missing sync version",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, syncVersion: undefined }],
        }),
      },
    },
    {
      label: "invalid sync version",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [{ ...record, syncVersion: -1 }],
        }),
      },
    },
    {
      label: "duplicate record identity",
      payload: {
        webhookDataJson: JSON.stringify({
          schemaVersion: 1,
          records: [record, record],
        }),
      },
    },
    {
      label: "oversized batch",
      payload: {
        webhookDataJson: "x".repeat(JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES + 1),
      },
    },
  ];

  for (const testCase of cases) {
    let imported = false;
    const provider = createJunctionProvider(async () => {
      throw new Error("Invalid companion metadata must not call the Junction API.");
    });
    const payload = {
      eventType: JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
      occurredAt: "2026-04-03T13:00:00.000Z",
      resource: JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
      resourceCategory: "summary",
      sourceProviderSlug: JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
      webhookDataJson: JSON.stringify({ schemaVersion: 1, records: [record] }),
      ...testCase.payload,
    };

    await assert.rejects(
      executeJunctionJob(
        provider,
        createJunctionJobContext({
          importSnapshot: async () => {
            imported = true;
            return { imported: true };
          },
        }),
        createJob("resource", payload),
      ),
      (error: unknown) => error instanceof DeviceSyncError
        && error.code === "DEVICE_SYNC_JOB_PAYLOAD_INVALID"
        && error.retryable === false,
      testCase.label,
    );
    assert.equal(imported, false, testCase.label);
  }
});

test("Junction direct resource jobs import the payload under its own resolved source provenance", async () => {
  // The usefulness gate (which also enforced job-tag/record-source equality)
  // was removed in P3. A self-consistent payload imports inline under its own
  // resolved source provenance, even when the routing job tag differs. The
  // record's source is single and unambiguous; the merge keys on the record's
  // own resourceId, so importing it inline is additive and overlap-free.
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.activity.created",
      objectId: "activity-source-mismatch",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "activity-inline-source-mismatch",
        sourceProviderSlug: "fitbit",
        steps: 9999,
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.equal(snapshot.summaries?.activity?.[0]?.steps, 9999);
  assert.equal(snapshot.summaries?.activity?.[0]?.sourceProviderSlug, "fitbit");
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction direct resource jobs fall back when payload source is missing or ambiguous", async () => {
  const cases: Array<{
    label: string;
    directRecord: Record<string, unknown>;
    restSteps: number;
  }> = [
    {
      label: "missing-source",
      directRecord: {
        date: "2026-04-02",
        id: "activity-inline-missing-source",
        steps: 9999,
      },
      restSteps: 2222,
    },
    {
      label: "ambiguous-source",
      directRecord: {
        data: [
          {
            sourceProviderSlug: "fitbit",
            steps: 9999,
          },
        ],
        date: "2026-04-02",
        id: "activity-inline-ambiguous-source",
        sourceProviderSlug: "garmin",
      },
      restSteps: 3333,
    },
    {
      label: "records-source-mismatch",
      directRecord: {
        date: "2026-04-02",
        id: "activity-inline-records-source-mismatch",
        records: [
          {
            sourceProviderSlug: "fitbit",
            steps: 9999,
          },
        ],
        sourceProviderSlug: "garmin",
      },
      restSteps: 4444,
    },
  ];

  for (const testCase of cases) {
    const requests: string[] = [];
    const importedSnapshots: unknown[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = readUrl(input);
      requests.push(url);

      if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [
            {
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
          data: [
            {
              date: "2026-04-02",
              id: `activity-rest-${testCase.label}`,
              provider_connection_id: "provider-garmin-1",
              steps: testCase.restSteps,
            },
          ],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    }, {
      summaryResources: ["activity"],
      timeseriesResources: [],
    });

    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          return { imported: true };
        },
      }),
      createJob("resource", {
        eventType: "daily.data.activity.created",
        objectId: `activity-${testCase.label}`,
        occurredAt: "2026-04-02T00:00:00.000Z",
        resource: "activity",
        resourceCategory: "summary",
        sourceProviderSlug: "garmin",
        webhookDataJson: JSON.stringify(testCase.directRecord),
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-05T00:00:00.000Z",
      }),
    );

    assert.equal(
      requests.some((url) => url.includes("/v2/summary/activity/")),
      true,
      testCase.label,
    );
    assert.equal(importedSnapshots.length, 1, testCase.label);
    const snapshot = importedSnapshots[0] as {
      summaries?: Record<string, Array<Record<string, unknown>>>;
      timeseries?: Record<string, unknown[]>;
    };
    assert.equal(snapshot.summaries?.activity?.[0]?.steps, testCase.restSteps, testCase.label);
    assert.notEqual(snapshot.summaries?.activity?.[0]?.steps, 9999, testCase.label);
    assert.deepEqual(snapshot.timeseries, {}, testCase.label);
  }
});

test("Junction imports a metric-free direct payload inline once the usefulness gate is removed", async () => {
  // The usefulness gate was removed in P3: a configured summary payload with a
  // single, consistent source provider imports inline even when it carries no
  // recognized metric fields (e.g. an identifier-only record). The downstream
  // normalizer decides meaning, as it already does for fetched records. No REST
  // fallback fires.
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.activity.created",
      objectId: "activity-identifier-only",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        date: "2026-04-02",
        id: "activity-inline-identifier-only",
        resource: "activity",
        sourceProviderSlug: "garmin",
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-05T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.equal(snapshot.summaries?.activity?.[0]?.id, "activity-inline-identifier-only");
  assert.equal(snapshot.summaries?.activity?.[0]?.sourceProviderSlug, "garmin");
  assert.deepEqual(snapshot.timeseries, {});
});

test("Junction large daily summary webhook payloads import inline without REST fallback", async () => {
  // The 64KB inline-payload size cap was removed in P3. A large daily summary
  // webhook now attaches its inline payload to the resource job and imports it
  // inline instead of stripping `webhookDataJson` and falling back to REST.
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);
    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryResources: ["activity"],
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.activity.created",
      user_id: "junction-user-1",
      data: {
        end_date: "2026-04-02",
        date: "2026-04-02",
        id: "activity-inline-large",
        memo: "x".repeat(DIRECT_WEBHOOK_JOB_LARGE_BYTES_FOR_TEST),
        source: {
          provider: "garmin",
          type: "watch",
        },
        start_date: "2026-04-02",
        steps: 9999,
        user_id: "junction-user-1",
      },
    },
    messageId: "msg_large_activity_payload_1",
    timestamp: "1775174400",
  });
  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.jobs.length, 1);
  assert.equal(parsed.acceptanceMode, "durable_webhook_work");
  assert.equal(parsed.jobs[0]?.kind, "resource");
  assert.equal("webhookDataJson" in (parsed.jobs[0]?.payload ?? {}), true);
  assert.equal(parsed.jobs[0]?.payload?.windowStart, "2026-04-02T00:00:00.000Z");
  assert.equal(parsed.jobs[0]?.payload?.windowEnd, "2026-04-03T00:00:00.000Z");

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { canonicalEventCount: 1, durableDeliveryAccepted: true };
      },
    }),
    createJob("resource", parsed.jobs[0]?.payload ?? {}),
  );

  assert.deepEqual(requests, []);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    summaries?: Record<string, Array<Record<string, unknown>>>;
    timeseries?: Record<string, unknown[]>;
  };
  assert.equal(snapshot.summaries?.activity?.[0]?.steps, 9999);
  assert.deepEqual(snapshot.timeseries, {});
  assert.doesNotMatch(JSON.stringify(importedSnapshots), /junction-user-1/u);
  assert.equal(
    result.metadataPatch?.junctionHistoricalBackfillEvidence,
    "e2|2026-04-01T00:00:00.000Z|2026-04-03T00:00:00.000Z|garmin:1",
  );
});

test("Junction nested compact timeseries webhooks use sample timestamps for stable jobs", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    webhookTimestampToleranceMs: 3 * 24 * 60 * 60_000,
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.blood_oxygen.created",
      user_id: "junction-user-1",
      data: {
        data: [
          {
            end: "2026-04-02T14:30:00.000Z",
            start: "2026-04-02T14:00:00.000Z",
            unit: "%",
            value: 97,
          },
        ],
        source: {
          provider: "garmin",
          type: "watch",
        },
      },
    },
    messageId: "msg_blood_oxygen_stable_nested_payload_1",
    timestamp: "1775174400",
  });

  const firstParse = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });
  const secondParse = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-04T00:00:00.000Z",
  });

  assert.equal(firstParse.jobs[0]?.dedupeKey, secondParse.jobs[0]?.dedupeKey);
  assert.equal(firstParse.providerSentAt, "2026-04-03T00:00:00.000Z");
  assert.equal(firstParse.jobs[0]?.payload?.occurredAt, "2026-04-02T14:30:00.000Z");
  assert.equal(firstParse.jobs[0]?.payload?.windowStart, "2026-04-02T00:00:00.000Z");
  assert.equal(firstParse.jobs[0]?.payload?.windowEnd, "2026-04-03T00:00:00.000Z");
  assert.equal("webhookDataJson" in (firstParse.jobs[0]?.payload ?? {}), false);
});

test("Junction signed daily timeseries webhooks omit direct sample payload jobs", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.blood_oxygen.created",
      user_id: "junction-user-1",
      data: {
        data: [
          {
            end: "2026-04-02T14:30:00.000Z",
            start: "2026-04-02T14:00:00.000Z",
            unit: "%",
            value: 97,
          },
        ],
        source: {
          provider: "garmin",
          type: "watch",
        },
        user_id: "junction-user-1",
      },
    },
    messageId: "msg_blood_oxygen_payload_1",
    timestamp: "1775174400",
  });
  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.jobs.length, 1);
  assert.equal(parsed.jobs[0]?.kind, "resource");
  assert.equal("webhookDataJson" in (parsed.jobs[0]?.payload ?? {}), false);
  assert.equal(parsed.jobs[0]?.payload?.resource, "blood_oxygen");
  assert.equal(parsed.jobs[0]?.payload?.resourceCategory, "timeseries");
});

test("Junction legacy direct dense timeseries payload jobs do not import queued samples", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: [],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      importSnapshot: async (snapshot) => {
        assert.deepEqual(requests, []);
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("resource", {
      eventType: "daily.data.steps.created",
      objectId: "steps-1",
      occurredAt: "2026-04-02T14:00:00.000Z",
      resource: "steps",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        data: [
          {
            end: "2026-04-02T14:30:00.000Z",
            start: "2026-04-02T14:00:00.000Z",
            unit: "count",
            value: 321,
          },
        ],
        sourceProviderSlug: "garmin",
      }),
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.deepEqual(requests, []);
  assert.deepEqual(importedSnapshots, []);
  assert.equal(warnings[0]?.resource, "steps");
  assert.equal(warnings[0]?.resourceCategory, "timeseries");
});

test("Junction legacy direct compact timeseries payloads fetch instead of importing queued samples", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              blood_oxygen: true,
            },
          },
        ],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      return createJsonResponse({
        groups: {
          garmin: [{
            data: [{ timestamp: "2026-04-02T14:00:00.000Z", unit: "%", value: 97 }],
            source: { provider: "garmin", type: "watch" },
          }],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });

  await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.blood_oxygen.created",
      objectId: "blood-oxygen-group-source-mismatch",
      occurredAt: "2026-04-02T14:00:00.000Z",
      resource: "blood_oxygen",
      resourceCategory: "timeseries",
      sourceProviderSlug: "garmin",
      webhookDataJson: JSON.stringify({
        groups: {
          fitbit: [{
            data: [{ timestamp: "2026-04-02T14:00:00.000Z", unit: "%", value: 9999 }],
            source: { provider: "fitbit", type: "watch" },
          }],
        },
        sourceProviderSlug: "garmin",
      }),
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(requests.some((url) => url.includes("/v2/timeseries/")), true);
  assert.equal(importedSnapshots.length, 1);
  assert.match(JSON.stringify(importedSnapshots), /97/u);
  assert.doesNotMatch(JSON.stringify(importedSnapshots), /9999/u);
});

test("Junction does not chunk oversized daily timeseries webhook samples into durable jobs", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  }, {
    timeseriesResources: [],
    webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
  });
  const samples = Array.from({ length: 48 }, (_, index) => ({
    end: `2026-04-02T${String(index % 24).padStart(2, "0")}:30:00.000Z`,
    sampleMemo: "x".repeat(2048),
    start: `2026-04-02T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    unit: "%",
    value: 90 + (index % 10),
  }));
  const webhook = createJunctionSvixWebhook({
    body: {
      event_type: "daily.data.blood_oxygen.created",
      user_id: "junction-user-1",
      data: {
        data: samples,
        source: {
          provider: "garmin",
          type: "watch",
        },
        user_id: "junction-user-1",
      },
    },
    messageId: "msg_large_blood_oxygen_payload_1",
    timestamp: "1775174400",
  });

  const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
    headers: webhook.headers,
    rawBody: webhook.rawBody,
    now: "2026-04-03T00:00:00.000Z",
  });

  assert.equal(parsed.acceptanceMode, "durable_webhook_work");
  assert.equal(parsed.jobs.every((job) => job.kind === "resource"), true);
  assert.equal(parsed.jobs.length, 1);
  assert.equal(parsed.jobs[0]?.payload?.resource, "blood_oxygen");
  assert.equal(parsed.jobs[0]?.payload?.resourceCategory, "timeseries");
  assert.equal("webhookDataJson" in (parsed.jobs[0]?.payload ?? {}), false);
  assert.doesNotMatch(JSON.stringify(parsed.jobs), /sampleMemo|junction-user-1/u);
});

test("Junction timeseries optional later chunk preserves earlier chunk records", async () => {
  const warnings: Record<string, unknown>[] = [];
  const importedSnapshots: unknown[] = [];
  let timeseriesRequests = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              blood_oxygen: true,
            },
          },
        ],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      timeseriesRequests += 1;
      if (timeseriesRequests === 1) {
        return createJsonResponse({
          groups: {
            oura: [{
              data: [{ timestamp: "2026-04-01T12:00:00Z", unit: "%", value: 97 }],
              source: { provider: "oura", type: "ring" },
            }],
          },
        });
      }

      return createJsonResponse({ error: "unsupported_resource" }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });
  const context: ProviderJobContext = {
    account: createAccount(),
    now: "2026-04-03T12:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: () => ({
      id: "src-1",
      connectionId: "acct-junction-1",
      sourceInstanceKey: "src-key",
      sourceProviderSlug: "oura",
      displayName: null,
      status: "connected",
      resourceAvailabilitySummary: {},
      lastErrorCode: null,
      lastErrorMessage: null,
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      lastDataAt: null,
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    }),
    refreshAccountTokens: async () => createAccount(),
    logger: {
      warn(_message, context) {
        warnings.push(context ?? {});
      },
    },
  };

  const result = await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      eventType: "daily.data.blood_oxygen.created",
      objectId: "blood-oxygen-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "blood_oxygen",
      sourceProviderSlug: "oura",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(timeseriesRequests, 2);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as {
    timeseries?: Record<string, unknown[]>;
    windowEnd?: string;
    windowStart?: string;
  };
  assert.equal(snapshot.windowStart, "2026-04-01T00:00:00.000Z");
  assert.equal(snapshot.windowEnd, "2026-04-02T00:00:00.000Z");
  assert.equal(snapshot.timeseries?.blood_oxygen?.length, 1);
  assert.deepEqual(warnings.map((warning) => ({
    reason: warning.reason,
    resource: warning.resource,
    resourceCategory: warning.resourceCategory,
    responseStatus: warning.responseStatus,
  })), [
    {
      reason: "unsupported",
      resource: "blood_oxygen",
      resourceCategory: "timeseries",
      responseStatus: 422,
    },
  ]);
  assert.deepEqual(result.metadataPatch, {
    junctionSkippedResourceTotal: 1,
    junctionSkippedSummaryTotal: 0,
    junctionSkippedTimeseriesTotal: 1,
    junctionSkippedResourceJobCount: 1,
    junctionSkippedResourceLastAt: "2026-04-03T12:00:00.000Z",
    junctionSkippedResourceLast: "timeseries.blood_oxygen.422.unsupported",
    junctionSkippedResourceLastDetail: null,
  });
});

test("Junction timeseries ambiguous later chunk preserves fetched data and skips the rest", async () => {
  const warnings: Record<string, unknown>[] = [];
  const importedSnapshots: unknown[] = [];
  let timeseriesRequests = 0;
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              blood_oxygen: true,
            },
          },
        ],
      });
    }

    if (url.includes("/v2/timeseries/junction-user-1/blood_oxygen/grouped")) {
      timeseriesRequests += 1;
      if (timeseriesRequests === 1) {
        return createJsonResponse({
          groups: {
            oura: [{
              data: [{ timestamp: "2026-04-01T12:00:00Z", unit: "%", value: 97 }],
              source: { provider: "oura", type: "ring" },
            }],
          },
        });
      }

      return createJsonResponse({
        code: "invalid_request",
        message: "The date window is invalid for this request.",
      }, 422);
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    timeseriesResources: ["blood_oxygen"],
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      now: "2026-04-03T12:00:00.000Z",
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
      logger: {
        warn(_message, context) {
          warnings.push(context ?? {});
        },
      },
    }),
    createJob("resource", {
      eventType: "daily.data.blood_oxygen.created",
      objectId: "blood-oxygen-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "blood_oxygen",
      sourceProviderSlug: "oura",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(timeseriesRequests, 2);
  assert.equal(importedSnapshots.length, 1);
  const snapshot = importedSnapshots[0] as { timeseries?: Record<string, unknown[]> };
  assert.equal(snapshot.timeseries?.blood_oxygen?.length, 1);
  assert.deepEqual(warnings, [
    {
      errorCode: "JUNCTION_API_REQUEST_FAILED",
      provider: "junction",
      reason: "ambiguous",
      resource: "blood_oxygen",
      resourceCategory: "timeseries",
      responseStatus: 422,
      responseDetail: "invalid_request: The date window is invalid for this request.",
    },
  ]);
  assert.equal(result.metadataPatch?.junctionSkippedResourceLast, "timeseries.blood_oxygen.422.ambiguous");
  assert.equal(
    result.metadataPatch?.junctionSkippedResourceLastDetail,
    "invalid_request: The date window is invalid for this request.",
  );
});

test("Junction resource jobs fetch only the hinted resource window", async () => {
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "oura",
            name: "Oura Ring",
            status: "connected",
            resource_availability: {
              activity: true,
            },
          },
        ],
      });
    }

    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [{ id: "activity-1", steps: 1200 }] });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const importedSnapshots: unknown[] = [];
  const context: ProviderJobContext = {
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: () => ({
      id: "src-1",
      connectionId: "acct-junction-1",
      sourceInstanceKey: "src-key",
      sourceProviderSlug: "oura",
      displayName: "Oura Ring",
      status: "connected",
      resourceAvailabilitySummary: {},
      lastErrorCode: null,
      lastErrorMessage: null,
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      lastDataAt: null,
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    }),
    refreshAccountTokens: async () => createAccount(),
    logger: {},
  };

  await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      eventType: "historical.data.activity.created",
      objectId: "activity-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "activity",
      resourceCategory: "summary",
      sourceProviderSlug: "oura",
      windowStart: "2026-04-01T06:07:08.000Z",
      windowEnd: "2026-04-03T09:10:11.000Z",
    }),
  );

  assert.equal(requests.filter((url) => url.includes("/v2/summary/activity/")).length, 1);
  const summaryRequest = requireValue(
    requests.find((url) => url.includes("/v2/summary/activity/")),
    "Junction resource job should fetch the hinted summary resource.",
  );
  assert.equal(new URL(summaryRequest).searchParams.get("provider"), "oura");
  assertJunctionWindowQuery(
    summaryRequest,
    "2026-04-01T06:07:08.000Z",
    "2026-04-03T09:10:11.000Z",
  );
  assert.equal(requests.some((url) => url.includes("/v2/timeseries/")), false);
  assert.equal(importedSnapshots.length, 1);
  assert.match(JSON.stringify(importedSnapshots[0]), /"activity"/u);
});

test("Junction resource jobs skip unsupported glucose when it is not configured", async () => {
  const requests: string[] = [];
  const warnings: Record<string, unknown>[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [
          {
            slug: "dexcom_v3",
            name: "Dexcom",
            status: "connected",
            resource_availability: {
              glucose: true,
            },
          },
        ],
      });
    }

    if (url.includes("glucose")) {
      throw new Error(`Unexpected glucose request: ${url}`);
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  const importedSnapshots: unknown[] = [];
  const context: ProviderJobContext = {
    account: createAccount(),
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: () => ({
      id: "src-1",
      connectionId: "acct-junction-1",
      sourceInstanceKey: "src-key",
      sourceProviderSlug: "dexcom_v3",
      displayName: null,
      status: "connected",
      resourceAvailabilitySummary: {},
      lastErrorCode: null,
      lastErrorMessage: null,
      firstSeenAt: "2026-04-03T00:00:00.000Z",
      lastSeenAt: "2026-04-03T00:00:00.000Z",
      lastDataAt: null,
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    }),
    refreshAccountTokens: async () => createAccount(),
    logger: {
      warn(_message, context) {
        warnings.push(context ?? {});
      },
    },
  };

  await executeJunctionJob(
    provider,
    context,
    createJob("resource", {
      eventType: "daily.data.glucose.created",
      objectId: "glucose-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "glucose",
      sourceProviderSlug: "dexcom_v3",
      webhookDataJson: JSON.stringify({
        data: [{ timestamp: "2026-04-02T00:00:00.000Z", value: 101 }],
        sourceProviderSlug: "dexcom_v3",
      }),
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(requests.filter((url) => url.includes("glucose")).length, 0);
  assert.deepEqual(importedSnapshots, []);
  assert.doesNotMatch(JSON.stringify(importedSnapshots), /101/u);
  assert.equal(warnings[0]?.resource, "glucose");
  assert.equal(warnings[0]?.resourceCategory, "timeseries");
});

test("Junction provider accepts glucose timeseries configuration", () => {
  assert.doesNotThrow(() => createJunctionProvider(async () => createJsonResponse({}), {
    timeseriesResources: ["glucose"],
  }));
});

test("Junction provider rejects unsupported configured resources", () => {
  assert.doesNotThrow(() => createJunctionProvider(async () => createJsonResponse({}), {
    summaryResources: ["meal", "menstrual_cycle", "electrocardiogram", "profile"],
  }));
  assert.doesNotThrow(() => createJunctionProvider(async () => createJsonResponse({}), {
    timeseriesResources: [
      "calories_basal",
      "daylight_exposure",
      "fall",
      "floors_climbed",
      "handwashing",
      "stand_duration",
      "stand_hour",
      "uv_exposure",
      "wheelchair_push",
      "workout_distance",
      "workout_duration",
      "workout_swimming_stroke",
      "electrocardiogram_voltage",
      "workout_stream",
    ],
  }));
  assert.throws(
    () => createJunctionProvider(async () => createJsonResponse({}), {
      summaryResources: ["clinical_note"],
    }),
    /Junction summary resources include unsupported resource\(s\): clinical_note\./u,
  );
  assert.throws(
    () => createJunctionProvider(async () => createJsonResponse({}), {
      timeseriesResources: ["electrocardiogram_waveform_legacy", "workout_stream_legacy"],
    }),
    /Junction timeseries resources include unsupported resource\(s\): electrocardiogram_waveform_legacy, workout_stream_legacy\./u,
  );
});

test("Junction resource job with a hijacked resource name falls back to the event-type resource fetch", async () => {
  const requests: string[] = [];
  const importedSnapshots: unknown[] = [];
  const provider = createJunctionProvider(
    async (input) => {
      const url = readUrl(input);
      requests.push(url);
      if (url.includes("/v2/summary/sleep/junction-user-1")) {
        return createJsonResponse({
          data: [{ id: "sleep-1", date: "2026-04-02", source: { provider: "whoop_v2" } }],
        });
      }
      if (url.includes("/v2/user/providers/junction-user-1")) {
        return createJsonResponse({ providers: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
    { summaryResources: ["activity", "sleep"], timeseriesResources: [] },
  );

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ nextReconcileAt: "2026-04-03T00:30:00.000Z" }),
      importSnapshot: async (snapshot) => {
        importedSnapshots.push(snapshot);
        return { imported: true };
      },
    }),
    createJob("resource", {
      eventType: "daily.data.sleep.created",
      objectId: "sleep-1",
      occurredAt: "2026-04-02T00:00:00.000Z",
      resource: "sleep_v2",
      resourceCategory: "summary",
      sourceProviderSlug: "whoop_v2",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.ok(
    requests.some((url) => url.includes("/v2/summary/sleep/junction-user-1")),
    `hijacked sleep job should fetch the event-type resource; requests=${JSON.stringify(requests)}`,
  );
  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    result.nextReconcileAt,
    "2026-04-03T00:30:00.000Z",
    "webhook job completion must preserve an earlier scheduled reconcile",
  );
});

test("Junction resource job with an unresolvable resource records an observable skip and preserves the reconcile schedule", async () => {
  const provider = createJunctionProvider(async (input) => {
    throw new Error(`Unexpected request: ${readUrl(input)}`);
  });

  const result = await executeJunctionJob(
    provider,
    createJunctionJobContext({
      account: createAccount({ nextReconcileAt: "2026-04-03T00:30:00.000Z" }),
    }),
    createJob("resource", {
      eventType: "provider.connection.updated",
      resource: "mystery_records",
      resourceCategory: "summary",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  assert.equal(result.nextReconcileAt, "2026-04-03T00:30:00.000Z");
  const metadataPatch = result.metadataPatch ?? {};
  assert.equal(metadataPatch.junctionSkippedResourceLast, "summary.mystery_records.0.unsupported");
  assert.equal(metadataPatch.junctionSkippedResourceJobCount, 1);
});

test("Junction import accountId is stable across local account row re-registration", async () => {
  const importedAccountIds: string[] = [];
  const provider = createEmptyJunctionBackfillProvider();

  const runReconcileWithAccountRowId = async (rowId: string) => {
    await executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({ id: rowId }),
        importSnapshot: async (snapshot) => {
          const accountId = (snapshot as { accountId?: string }).accountId;
          if (accountId) {
            importedAccountIds.push(accountId);
          }
          return { imported: true };
        },
      }),
      createJob("reconcile", {
        windowStart: "2026-04-02T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
      }),
    );
  };

  // Hosted cold starts recreate the machine-local device-sync store, so the
  // same Junction user is re-registered under a fresh local row id. Import
  // identity must follow the stable Junction user, not the local row.
  await runReconcileWithAccountRowId("dsa_cold_start_row_a");
  await runReconcileWithAccountRowId("dsa_cold_start_row_b");

  assert.ok(importedAccountIds.length >= 2, "expected reconcile runs to import snapshots");
  assert.match(importedAccountIds[0] ?? "", /^jxn_acct_[a-f0-9]{32}$/u);
  assert.equal(new Set(importedAccountIds).size, 1);
});

test("Junction sparse fetch dedupe preserves stable importer identities and rejects ambiguous rows in either order", async () => {
  const run = async (records: readonly Record<string, unknown>[]) => {
    const importedSnapshots: unknown[] = [];
    const normalizedPayloads: Awaited<ReturnType<typeof prepareDeviceProviderSnapshotImport>>[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));

      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-withings-1",
            slug: "withings",
            name: "Withings",
            status: "connected",
            resource_availability: { body_fat: true },
          }],
        });
      }
      if (url.pathname === "/v2/timeseries/junction-user-1/body_fat/grouped") {
        return createJsonResponse({
          groups: {
            withings: [{
              data: records,
              source: {
                device_id: "scale-1",
                provider: "withings",
                type: "scale",
              },
            }],
          },
        });
      }
      if (url.pathname.startsWith("/v2/summary/")) {
        return createJsonResponse({ data: [] });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    }, {
      summaryResources: [],
      timeseriesBackfillDays: 1,
      timeseriesResources: ["fat"],
    });

    const context = createJunctionJobContext({
        account: createAccount({
          lastSyncCompletedAt: "2026-06-15T00:00:00.000Z",
        }),
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          const normalized = await prepareDeviceProviderSnapshotImport({
            provider: "junction",
            connectionId: "acct-junction-1",
            deliveryMode: "scheduled_reconcile",
            sourceKind: "poll",
            snapshot,
          });
          normalizedPayloads.push(normalized);
          return {
            canonicalEventCount: normalized.events?.length ?? 0,
            durableDeliveryAccepted: true,
          };
        },
      });
    await executeJunctionFullJob(
      provider,
      context,
      createJob("reconcile", {
        windowStart: "2026-06-15T00:00:00.000Z",
        windowEnd: "2026-06-16T00:00:00.000Z",
      }),
    );

    assert.equal(importedSnapshots.length, normalizedPayloads.length);
    const sparseImportIndex = normalizedPayloads.findIndex((payload) =>
      payload.events?.some((event) => event.fields?.metric === "body-fat-percentage")
    );
    assert.notEqual(sparseImportIndex, -1);
    return {
      normalized: requireValue(
        normalizedPayloads[sparseImportIndex],
        "normalized Junction sparse payload",
      ),
      snapshot: requireValue(
        importedSnapshots[sparseImportIndex],
        "device-sync Junction sparse snapshot",
      ),
    };
  };
  const findFatEvent = (
    payload: Awaited<ReturnType<typeof prepareDeviceProviderSnapshotImport>>,
  ) => payload.events?.find((event) => event.fields?.metric === "body-fat-percentage");

  const original = await run([{
    id: "fat-row-revision",
    timestamp: "2026-06-15T08:00:00.000Z",
    unit: "%",
    value: 18,
  }]);
  const corrected = await run([{
    id: "fat-row-revision",
    timestamp: "2026-06-15T08:05:00.000Z",
    unit: "%",
    value: 19,
  }]);
  const originalEvent = findFatEvent(original.normalized);
  const correctedEvent = findFatEvent(corrected.normalized);

  assert.ok(originalEvent);
  assert.ok(correctedEvent);
  assert.equal(correctedEvent.externalRef?.resourceId, originalEvent.externalRef?.resourceId);
  assert.equal(correctedEvent.externalRef?.facet, "body-fat-percentage");

  const records = [
    { id: "fat-row-exact", timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 18 },
    { id: "fat-row-exact", timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 18 },
    { id: "fat-row-distinct", timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 18 },
    { timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 19 },
    { timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 20 },
    { id: "fat-row-conflict", timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 21 },
    { id: "fat-row-conflict", timestamp: "2026-06-15T09:00:00.000Z", unit: "%", value: 22 },
  ];
  const forward = await run(records);
  const reversed = await run([...records].reverse());
  const summarize = (
    payload: Awaited<ReturnType<typeof prepareDeviceProviderSnapshotImport>>,
  ) => (payload.events ?? [])
    .map((event) => ({
      identity: `${event.externalRef?.resourceId}:${event.externalRef?.facet}`,
      value: event.fields?.value,
    }))
    .sort((left, right) => left.identity.localeCompare(right.identity));
  const forwardSummary = summarize(forward.normalized);

  assert.deepEqual(forwardSummary, summarize(reversed.normalized));
  assert.equal(forwardSummary.length, 4);
  assert.equal(new Set(forwardSummary.map((event) => event.identity)).size, 4);
  assert.deepEqual(forwardSummary.map((event) => event.value).sort((left, right) =>
    Number(left) - Number(right)
  ), [18, 18, 19, 20]);
  assert.doesNotMatch(JSON.stringify(forward.snapshot), /fat-row-conflict/u);
  assert.doesNotMatch(JSON.stringify(reversed.snapshot), /fat-row-conflict/u);
});

test("Junction full backfills keep configured sparse and dense resources in bounded daily units", async () => {
  const sparseResources = [
    "body_mass_index",
    "carbohydrates",
    "fat",
    "forced_expiratory_volume_1",
    "forced_vital_capacity",
    "heart_rate_alert",
    "inhaler_usage",
    "insulin_injection",
    "lean_body_mass",
    "peak_expiratory_flow_rate",
    "sleep_apnea_alert",
    "waist_circumference",
  ];
  const requests: string[] = [];
  const availability = Object.fromEntries([
    "activity",
    "blood_oxygen",
    ...sparseResources,
  ].map((resource) => [resource === "fat" ? "body_fat" : resource, true]));
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-withings-1",
          slug: "withings",
          name: "Withings",
          status: "connected",
          resource_availability: availability,
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    if (url.includes("/v2/timeseries/junction-user-1/")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryBackfillDays: 180,
    timeseriesResources: ["blood_oxygen", ...sparseResources],
  });

  await executeJunctionFullJob(
    provider,
    createJunctionJobContext({ now: "2026-07-01T00:00:00.000Z" }),
    createJob("backfill", {
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-06-30T00:00:00.000Z",
    }),
  );

  const timeseriesRequests = requests
    .filter((url) => url.includes("/v2/timeseries/"))
    .map((url) => new URL(url));
  assert.equal(timeseriesRequests.length, 182);

  for (const resource of sparseResources) {
    const apiResource = resource === "fat" ? "body_fat" : resource;
    const resourceRequests = timeseriesRequests.filter((url) =>
      url.pathname === `/v2/timeseries/junction-user-1/${apiResource}/grouped`
    );
    assert.equal(resourceRequests.length, 14, resource);
    for (const url of resourceRequests) {
      const start = url.searchParams.get("start_date");
      const end = url.searchParams.get("end_date");
      assert.ok(start !== null && start === end, resource);
    }
  }

  const denseRequests = timeseriesRequests.filter((url) =>
    url.pathname === "/v2/timeseries/junction-user-1/blood_oxygen/grouped"
  );
  assert.equal(denseRequests.length, 14);
  assert.ok(denseRequests.every((url) => {
    const start = url.searchParams.get("start_date");
    const end = url.searchParams.get("end_date");
    return start !== null && start === end;
  }));
});

test("Junction direct-Link bounded sparse data stays with the full backfill owner", async () => {
  const connectedAt = "2026-04-03T00:00:00.000Z";
  const now = "2026-07-01T12:00:00.000Z";
  const vaultRoot = await makeTempDirectory("murph-junction-fat-activation");

  try {
    const coreRuntime = await import("@murphai/core");
    await coreRuntime.initializeVault({
      createdAt: connectedAt,
      timezone: "UTC",
      vaultRoot,
    });

    const requests: URL[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));

      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-garmin-1",
            slug: "garmin",
            name: "Garmin",
            status: "connected",
            resource_availability: {
              activity: true,
              body_fat: true,
            },
          }],
        });
      }
      if (url.pathname === "/v2/summary/activity/junction-user-1") {
        return createJsonResponse({
          data: [{
            connectionId: "provider-garmin-1",
            date: "2026-04-02",
            id: "activity-connect-row-1",
            observedAt: "2026-04-02T12:00:00.000Z",
            steps: 1_234,
          }],
        });
      }
      if (url.pathname === "/v2/timeseries/junction-user-1/body_fat/grouped") {
        requests.push(url);
        return createJsonResponse({
          groups: {
            garmin: [{
              data: [],
              source: { provider: "garmin", type: "scale" },
            }],
          },
        });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    }, {
      providerFilter: ["garmin"],
      summaryBackfillDays: 180,
      timeseriesResources: ["fat"],
    });
    const source = createConnectionSource({
      resourceAvailabilitySummary: {
        activity: true,
        body_fat: true,
      },
    });
    const sourceSummary = {
      displayName: source.displayName,
      firstSeenAt: source.firstSeenAt,
      lastDataAt: source.lastDataAt,
      lastErrorCode: source.lastErrorCode,
      lastErrorMessage: source.lastErrorMessage,
      lastSeenAt: source.lastSeenAt,
      resourceAvailabilitySummary: source.resourceAvailabilitySummary,
      resourceCount: Object.keys(source.resourceAvailabilitySummary).length,
      sourceProviderSlug: source.sourceProviderSlug,
      status: source.status,
    };
    const toJobRecord = (
      input: DeviceSyncJobInput,
      fallbackAvailableAt = now,
    ): DeviceSyncJobRecord => ({
      ...createJob(input.kind, input.payload ?? {}),
      availableAt: input.availableAt ?? fallbackAvailableAt,
      dedupeKey: input.dedupeKey ?? null,
      priority: input.priority ?? 50,
    });
    let importedSnapshotCount = 0;
    const importSnapshot: ProviderJobContext["importSnapshot"] = async (snapshot) => {
      const imported = await importDeviceProviderSnapshot<
        Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>
      >({
        provider: "junction",
        snapshot,
        vaultRoot,
      }, { corePort: coreRuntime });
      importedSnapshotCount += 1;
      return {
        canonicalEventCount: imported.events.length,
        durableDeliveryAccepted: true,
      };
    };

    const connection = await requireJunctionConnectionHandler(provider).completeConnection({
      callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
      state: "state-fat-activation",
      seededExternalAccountId: "junction-user-1",
      sourceProviderSlug: "garmin",
      query: new URLSearchParams({
        murph_state: "state-fat-activation",
        state: "success",
      }),
      now: connectedAt,
      grantedScopes: [],
    });
    const connectBackfill = requireValue(
      connection.initialJobs?.find((job) => job.kind === "backfill"),
      "Direct Link should enqueue the global connect backfill.",
    );
    assert.equal(connection.setupPhase, "link_returned");
    assert.equal(connectBackfill.payload?.timeseriesCursor, undefined);
    assert.equal(sourceSummary.status, "connected");
    assert.equal(sourceSummary.sourceProviderSlug, "garmin");
    assert.equal(sourceSummary.resourceAvailabilitySummary.body_fat, true);

    const connectContext = createJunctionJobContext({
        account: createAccount({
          connectedAt,
          sources: [sourceSummary],
        }),
        connectionSourceAdmissionMode: "listed_only",
        importSnapshot,
        now: connectedAt,
      });
    const connectResult = await executeJunctionFullJob(
      provider,
      connectContext,
      toJobRecord(connectBackfill, connectedAt),
    );
    assert.equal(
      connectResult.metadataPatch?.junctionHistoricalBackfillStatus,
      "coverage_v3_complete",
    );
    assert.equal(
      connectResult.metadataPatch?.junctionExtendedTimeseriesHistoryBackfillCoverage,
      undefined,
    );
    assert.equal(connectResult.scheduledJobs?.some((job) => job.kind === "backfill") ?? false, false);
    assert.equal(importedSnapshotCount, 1);
    assert.equal(requests.length, 14);
    assert.equal(new Set(requests.map((url) => [
      url.searchParams.get("start_date"),
      url.searchParams.get("end_date"),
    ].join("|"))).size, 14);
    requests.length = 0;

    const terminalMetadata = requireValue(
      connectResult.metadataPatch,
      "The global connect backfill should return terminal coverage metadata.",
    );
    const executor = requireValue(provider.jobExecutor);
    const nonTerminalJobs = executor.createScheduledJobs?.(
      createStoredAccount({
        metadata: {
          ...terminalMetadata,
          junctionHistoricalBackfillStatus: "coverage_v3_retrying",
        },
        nextReconcileAt: now,
        sources: [sourceSummary],
      }),
      now,
    ).jobs ?? [];
    assert.equal(nonTerminalJobs.some((job) =>
      job.kind === "resource" && job.payload?.resource === "fat"
    ), false);

    const scheduled = requireValue(executor.createScheduledJobs?.(
      createStoredAccount({
        metadata: terminalMetadata,
        nextReconcileAt: now,
        sources: [sourceSummary],
      }),
      now,
    ));
    const activationJobs = scheduled.jobs.filter((job) =>
      job.kind === "resource"
      && job.payload?.resource === "fat"
      && job.payload?.sourceProviderSlug === "garmin"
    );
    assert.deepEqual(activationJobs, []);
    assert.equal(requests.length, 0);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("Junction activity opt-ins keep fall on bounded sparse history while dense aggregates and features stay daily", async () => {
  const denseResources = ["calories_basal", "handwashing", "workout_distance"];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = readUrl(input);
    requests.push(url);

    if (url === "https://api.sandbox.us.junction.com/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          slug: "apple_health_kit",
          name: "Apple Health",
          status: "connected",
          resource_availability: Object.fromEntries([
            "activity",
            "fall",
            ...denseResources,
          ].map((resource) => [resource, true])),
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    if (url.includes("/v2/timeseries/junction-user-1/")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryBackfillDays: 30,
    summaryResources: ["activity"],
    timeseriesResources: ["fall", ...denseResources],
  });

  await executeJunctionFullJob(
    provider,
    createJunctionJobContext({ now: "2026-03-03T00:00:00.000Z" }),
    createJob("backfill", {
      windowStart: "2026-02-01T00:00:00.000Z",
      windowEnd: "2026-03-03T00:00:00.000Z",
    }),
  );

  const timeseriesRequests = requests
    .filter((url) => url.includes("/v2/timeseries/"))
    .map((url) => new URL(url));
  const fallRequests = timeseriesRequests.filter((url) =>
    url.pathname === "/v2/timeseries/junction-user-1/fall/grouped"
  );
  assert.equal(fallRequests.length, 14);
  for (const url of fallRequests) {
    const start = url.searchParams.get("start_date");
    const end = url.searchParams.get("end_date");
    assert.ok(start !== null && start === end);
  }

  for (const resource of denseResources) {
    const resourceRequests = timeseriesRequests.filter((url) =>
      url.pathname === `/v2/timeseries/junction-user-1/${resource}/grouped`
    );
    assert.equal(resourceRequests.length, 14, resource);
    assert.ok(resourceRequests.every((url) => {
      const start = url.searchParams.get("start_date");
      const end = url.searchParams.get("end_date");
      return start !== null && start === end;
    }), resource);
  }
});

test("Junction mixed sparse and dense backfills advance exact resource and day cursors", async () => {
  const ownerWindowStart = "2026-01-01T00:00:00.000Z";
  const ownerWindowEnd = "2026-03-02T00:00:00.000Z";
  const createProviderForRequests = (requests: string[]) => createJunctionProvider(async (input) => {
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
            blood_oxygen: true,
            body_fat: true,
          },
        }],
      });
    }
    if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/activity/junction-user-1")) {
      return createJsonResponse({ data: [] });
    }
    if (url.includes("/v2/timeseries/junction-user-1/")) {
      return createJsonResponse({ groups: {} });
    }

    throw new Error(`Unexpected request: ${url}`);
  }, {
    summaryBackfillDays: 60,
    timeseriesBackfillDays: 60,
    timeseriesResources: ["blood_oxygen", "fat"],
  });

  const firstRequests: string[] = [];
  const provider = createProviderForRequests(firstRequests);
  const context = createJunctionJobContext({ now: "2026-03-03T00:00:00.000Z" });
  const firstResult = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      windowStart: ownerWindowStart,
      windowEnd: ownerWindowEnd,
    }),
  );

  const continuation = requireValue(
    firstResult.scheduledJobs?.find((job) => job.kind === "backfill"),
    "Mixed Junction backfill should schedule its first direct continuation.",
  );
  assert.deepEqual(continuation.payload, {
    emptyBackfillAttempts: 1,
    timeseriesCursor: ownerWindowStart,
    timeseriesResourceCursor: "blood_oxygen",
    windowEnd: ownerWindowEnd,
    windowStart: ownerWindowStart,
  });
  assert.equal(firstRequests.some((url) => url.includes("/v2/timeseries/")), false);

  const secondResult = await executeJunctionJob(
    provider,
    context,
    createJobFromInput(continuation),
  );
  const secondTimeseriesRequests = firstRequests
    .filter((url) => url.includes("/v2/timeseries/"))
    .map((url) => new URL(url));
  assert.equal(secondTimeseriesRequests.length, 1);
  assert.equal(
    secondTimeseriesRequests[0]?.pathname,
    "/v2/timeseries/junction-user-1/blood_oxygen/grouped",
  );
  assertJunctionWindowQuery(
    requireValue(secondTimeseriesRequests[0]?.toString(), "first dense day"),
    "2026-01-01",
    "2026-01-01",
  );
  assert.equal(
    secondResult.scheduledJobs?.[0]?.payload?.timeseriesCursor,
    "2026-01-02T00:00:00.000Z",
  );

  firstRequests.length = 0;
  const resourceBoundaryResult = await executeJunctionJob(
    provider,
    context,
    createJob("backfill", {
      timeseriesCursor: "2026-03-01T00:00:00.000Z",
      timeseriesResourceCursor: "blood_oxygen",
      windowEnd: ownerWindowEnd,
      windowStart: ownerWindowStart,
    }),
  );
  assert.deepEqual(resourceBoundaryResult.scheduledJobs?.[0]?.payload, {
    timeseriesCursor: ownerWindowStart,
    timeseriesResourceCursor: "fat",
    windowEnd: ownerWindowEnd,
    windowStart: ownerWindowStart,
  });
});

test("Junction opt-in dense webhooks wait for a closed UTC day before importing", async () => {
  for (const resource of [
    "calories_basal",
    "handwashing",
    "stand_hour",
    "workout_duration",
  ] as const) {
    const requests: URL[] = [];
    const importedSnapshots: unknown[] = [];
    const preparedImports: Awaited<ReturnType<typeof prepareDeviceProviderSnapshotImport>>[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));
      requests.push(url);
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-garmin-1",
            slug: "garmin",
            status: "connected",
            resource_availability: { [resource]: true },
          }],
        });
      }
      if (url.pathname === `/v2/timeseries/junction-user-1/${resource}/grouped`) {
        const requestedDay = url.searchParams.get("start_date");
        return createJsonResponse({
          groups: {
            garmin: [{
              data: requestedDay === "2026-04-02"
                ? resource === "stand_hour"
                  ? [{
                      end: "2026-04-03T00:00:00.000Z",
                      start: "2026-04-02T23:00:00.000Z",
                      unit: "count",
                      value: 1,
                    }]
                  : resource === "workout_duration"
                    ? [{
                        end: "2026-04-03T00:00:00.000Z",
                        start: "2026-04-02T23:12:00.000Z",
                        unit: "minutes",
                        value: 48,
                      }]
                  : [{
                      timestamp: "2026-04-02T12:00:00.000Z",
                      unit: resource === "calories_basal" ? "kcal" : "count",
                      value: 1,
                    }]
                : [],
              source: { provider: "garmin", type: "watch" },
            }],
          },
        });
      }
      throw new Error(`Unexpected request: ${url.toString()}`);
    }, {
      summaryResources: [],
      timeseriesResources: [resource],
      webhookSecret: "whsec_d2ViaG9vay10ZXN0LXNlY3JldA==",
    });
    const source = createConnectionSource({
      resourceAvailabilitySummary: { [resource]: true },
    });
    const sourceSummary = {
      displayName: source.displayName,
      firstSeenAt: source.firstSeenAt,
      lastDataAt: source.lastDataAt,
      lastErrorCode: source.lastErrorCode,
      lastErrorMessage: source.lastErrorMessage,
      lastSeenAt: source.lastSeenAt,
      resourceAvailabilitySummary: source.resourceAvailabilitySummary,
      resourceCount: Object.keys(source.resourceAvailabilitySummary).length,
      sourceProviderSlug: source.sourceProviderSlug,
      status: source.status,
    };
    const parseWebhookJob = async (now: string, messageId: string) => {
      const webhook = createJunctionSvixWebhook({
        body: {
          event_type: `daily.data.${resource}.created`,
          user_id: "junction-user-1",
          data: {
            date: "2026-04-02",
            resource,
            source: { provider: "garmin" },
          },
        },
        messageId,
        timestamp: String(Math.floor(Date.parse(now) / 1_000)),
      });
      const parsed = await requireJunctionWebhookHandler(provider).verifyAndParseWebhook({
        headers: webhook.headers,
        rawBody: webhook.rawBody,
        now,
      });
      return requireValue(parsed.jobs[0], `${resource} webhook resource job`);
    };
    const execute = (now: string, job: DeviceSyncJobInput) => executeJunctionJob(
      provider,
      createJunctionJobContext({
        account: createAccount({ sources: [sourceSummary] }),
        importSnapshot: async (snapshot) => {
          importedSnapshots.push(snapshot);
          const prepared = await prepareDeviceProviderSnapshotImport({
            provider: "junction",
            snapshot,
          });
          preparedImports.push(prepared);
          return {
            canonicalEventCount: prepared.events?.length ?? 0,
            durableDeliveryAccepted: true,
          };
        },
        now,
      }),
      {
        ...createJob(job.kind, job.payload ?? {}),
        dedupeKey: job.dedupeKey ?? null,
        priority: job.priority ?? 50,
      },
    );

    await execute(
      "2026-04-02T15:00:00.000Z",
      await parseWebhookJob("2026-04-02T15:00:00.000Z", `msg_${resource}_open`),
    );
    const openDayRequests = requests.filter((url) =>
      url.pathname === `/v2/timeseries/junction-user-1/${resource}/grouped`
    );
    assert.deepEqual(
      openDayRequests.map((url) => url.searchParams.get("start_date")),
      ["2026-04-01"],
      resource,
    );
    assert.equal(importedSnapshots.length, 0, resource);

    await execute(
      "2026-04-03T00:05:00.000Z",
      await parseWebhookJob("2026-04-03T00:05:00.000Z", `msg_${resource}_closed`),
    );
    const resourceRequests = requests.filter((url) =>
      url.pathname === `/v2/timeseries/junction-user-1/${resource}/grouped`
    );
    assert.equal(resourceRequests.length, 3, resource);
    assert.equal(resourceRequests[2]?.searchParams.get("start_date"), "2026-04-02", resource);
    assert.equal(resourceRequests[2]?.searchParams.get("end_date"), "2026-04-02", resource);
    assert.equal(importedSnapshots.length, 1, resource);
    assert.equal(preparedImports.length, 1, resource);

    if (resource === "workout_duration") {
      const prepared = requireValue(preparedImports[0], "workout duration compact import");
      const artifacts = prepared.evidenceParts?.filter((part) =>
        part.metadata?.resource === "workout_duration"
        && part.metadata?.resourceCategory === "timeseries_feature_aggregate"
      ) ?? [];
      const events = prepared.events?.filter((candidate) =>
        candidate.fields?.metric === "workout-minutes"
      ) ?? [];
      assert.equal(artifacts.length, 1);
      assert.equal(events.length, 1);
      const artifact = requireValue(artifacts[0], "workout duration compact feature artifact");
      const content = artifact.content as Record<string, unknown>;
      const event = requireValue(events[0], "workout duration canonical observation");

      assert.equal(content.bucketStartAt, "2026-04-02T23:00:00.000Z");
      assert.equal(content.dayKey, "2026-04-02");
      assert.equal(content.firstSampleAt, "2026-04-02T23:12:00.000Z");
      assert.equal(content.lastSampleAt, "2026-04-02T23:12:00.000Z");
      assert.equal(content.sumValue, 48);
      assert.equal(event.occurredAt, "2026-04-02T23:12:00.000Z");
      assert.equal(event.dayKey, "2026-04-02");
      assert.equal(event.fields?.value, 48);
    }
  }
});

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

test("Junction workout_stream skips malformed metric cardinality without blocking valid workouts", async () => {
  const importedSnapshots: unknown[] = [];
  const warningCodes: string[] = [];
  const harness = createJunctionWorkoutStreamTestProvider({
    listWorkoutIds: () => ["workout-1", "workout-2", "workout-3"],
    streamResponse: (workoutId) => createJsonResponse(
      workoutId === "workout-1"
        ? {
            time: [1_775_131_200, 1_775_133_000],
            heartrate: [100, 160],
            distance: [0],
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

  await executeJunctionJob(
    harness.provider,
    createJunctionJobContext({
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
    "JUNCTION_WORKOUT_STREAM_CARDINALITY_MISMATCH",
    "JUNCTION_WORKOUT_STREAM_CARDINALITY_MISMATCH",
  ]);
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
  const denseResources = productionResources.filter(
    (resource) => (resolveJunctionTimeseriesResourcePolicy(resource)?.fetchChunkDays ?? 1) === 1,
  );
  const ordinaryDenseResources = denseResources.filter(
    (resource) => resource !== "workout_stream",
  );
  assert.deepEqual(
    [productionResources.length, wideResources.length, denseResources.length, ordinaryDenseResources.length],
    [48, 13, 35, 34],
  );

  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const compatibilityMatrix = await readFile(
    new URL("../../../docs/device-provider-compatibility-matrix.md", import.meta.url),
    "utf8",
  );
  for (const documentation of [readme, compatibilityMatrix]) {
    assert.match(documentation, /48 production timeseries resources/u);
    assert.match(documentation, /13 wide and 35 dense/u);
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
      return createJsonResponse({ providers: [] });
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
    createJunctionJobContext({
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
        createJunctionJobContext(),
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
  const context = createJunctionJobContext({ importSnapshot });
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
      createJunctionJobContext({ importSnapshot }),
      createJobFromInput(continuation, 1),
    ),
    (error) => error === retryableFailure,
  );
  allowSecondWorkout = true;

  const completed = await executeJunctionJob(
    harness.provider,
    createJunctionJobContext({ importSnapshot }),
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
        createJunctionJobContext(),
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
      createJunctionJobContext({ importSnapshot }),
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
    createJunctionJobContext({ importSnapshot }),
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
      createJunctionJobContext(),
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
    createJunctionJobContext({
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
      createJunctionJobContext({
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
    createJunctionJobContext({
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
    createJunctionJobContext({ importSnapshot: importAfter }),
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
      createJunctionJobContext({
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
      createJunctionJobContext({
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
    createJunctionJobContext({
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
    createJunctionJobContext({ importSnapshot }),
    createJunctionWorkoutStreamResourceJob(continuation.payload ?? {}),
  );
  assert.deepEqual(importedWorkoutIds, ["workout-1", "workout-2", "workout-3"]);
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

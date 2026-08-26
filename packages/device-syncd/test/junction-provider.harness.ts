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
import {
  hasJunctionExtendedTimeseriesHistoryBackfillCoverage,
  resolveJunctionExtendedTimeseriesHistoryBackfillVersion,
} from "../src/junction-historical-backfill-progress.ts";
import { HOSTED_EXECUTION_DEVICE_SYNC_PASS_JOB_LIMIT } from "../src/hosted-runtime.ts";
import { mergeStoredDeviceSyncMetadataPatch } from "../src/metadata.ts";
import {
  DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE,
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
import { canonicalizeJunctionProviderSlug } from "../src/connect-config.ts";
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

async function executeTemporalAuthorityChildren(input: {
  context: ProviderJobContext;
  initialResult: Awaited<ReturnType<typeof executeJunctionJob>>;
  provider: ReturnType<typeof createJunctionProvider>;
}): Promise<void> {
  const temporalChildren = input.initialResult.scheduledJobs?.filter((job) =>
    job.payload?.temporalAuthorityTimeZone !== undefined
  ) ?? [];
  for (const [index, child] of temporalChildren.entries()) {
    await executeJunctionJob(
      input.provider,
      input.context,
      createJobFromInput(child, index),
    );
  }
}

async function executeJunctionFullJob(
  provider: ReturnType<typeof createJunctionProvider>,
  context: ProviderJobContext,
  job: DeviceSyncJobRecord,
): Promise<Awaited<ReturnType<typeof executeJunctionJob>>> {
  const initialResult = await executeJunctionJob(provider, context, job);
  await executeTemporalAuthorityChildren({
    context,
    initialResult,
    provider,
  });
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
    vaultTimeZone: "UTC",
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
  sourceProviderSlug = "garmin",
): Record<string, unknown> {
  return {
    id: workoutId,
    sourceProviderSlug,
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
  listProviders?: () => readonly Record<string, unknown>[];
  listWorkoutIds(indexRequest: number): readonly string[];
  listWorkoutSummaries?: (indexRequest: number) => readonly Record<string, unknown>[];
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
      return createJsonResponse({
        providers: input.listProviders?.() ?? [
          createJunctionWorkoutStreamProviderConnection("garmin", true),
        ],
      });
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
        data: input.listWorkoutSummaries?.(indexRequests)
          ?? input.listWorkoutIds(indexRequests).map((workoutId) =>
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

function createJunctionWorkoutStreamProviderConnection(
  sourceProviderSlug = "garmin",
  workoutStreamAvailable = true,
): Record<string, unknown> {
  return {
    id: `provider-${sourceProviderSlug}`,
    slug: sourceProviderSlug,
    name: sourceProviderSlug,
    status: "connected",
    resource_availability: {
      workouts: true,
      workout_stream: workoutStreamAvailable,
    },
  };
}

function createJunctionWorkoutStreamSource(
  sourceProviderSlug = "garmin",
  workoutStreamAvailable = true,
): DeviceConnectionSourceRecord {
  return createConnectionSource({
    id: `src-${sourceProviderSlug}`,
    resourceAvailabilitySummary: {
      workouts: true,
      workout_stream: workoutStreamAvailable,
    },
    sourceInstanceKey: `source-${sourceProviderSlug}`,
    sourceProviderSlug,
  });
}

function createJunctionWorkoutStreamJobContext(
  overrides: Partial<ProviderJobContext> = {},
): ProviderJobContext {
  const account = overrides.account ?? createAccount();
  const sources = account.sources ?? [createJunctionWorkoutStreamSource()];
  return createJunctionJobContext({
    account,
    listConnectionSources: async (input = {}) => sources.filter((source) =>
      (!input.sourceProviderSlug || source.sourceProviderSlug === input.sourceProviderSlug)
      && (!input.status || source.status === input.status)
    ),
    ...overrides,
  });
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











































function resolveJunctionTarget(providerSlug: string) {
  return JUNCTION_CONNECT_SOURCE_TARGETS.find((target) => target.providerSlug === providerSlug);
}

export {
  DIRECT_WEBHOOK_JOB_LARGE_BYTES_FOR_TEST,
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
  createJunctionSvixWebhook,
  createJunctionWorkoutStreamJobContext,
  createJunctionWorkoutStreamProviderConnection,
  createJunctionWorkoutStreamResourceJob,
  createJunctionWorkoutStreamSource,
  createJunctionWorkoutStreamTestProvider,
  createJunctionWorkoutSummary,
  createMixedGarminOuraActivityProvider,
  createStoredAccount,
  executeFullJobTimeseriesContinuations,
  executeJunctionFullJob,
  executeJunctionJob,
  executeTemporalAuthorityChildren,
  floatingSessionOnlySummaryRecordByResource,
  junctionWorkoutCandidateIdentity,
  readJunctionWorkoutProgressIdentities,
  readScheduledWorkoutStreamContinuation,
  requireJunctionConnectionHandler,
  requireJunctionWebhookHandler,
  resolveJunctionTarget,
  sha256ForTest,
  usefulHistoricalSummaryCompletionCases,
  usefulHistoricalSummaryRecordByResource,
};




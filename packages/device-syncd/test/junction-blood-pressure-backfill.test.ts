import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { junctionProviderAdapter } from "@murphai/importers/device-providers/junction";
import { test } from "vitest";

import { deviceSyncError, isDeviceSyncError } from "../src/errors.ts";
import {
  addJunctionExtendedTimeseriesHistoryBackfillCoverage,
  hasJunctionExtendedTimeseriesHistoryBackfillCoverage,
} from "../src/junction-historical-backfill-progress.ts";
import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
} from "../src/public-account.ts";
import { SqliteDeviceSyncStore } from "../src/store.ts";
import {
  createJsonResponse,
  makeTempDirectory,
  readUrl,
  requireValue,
} from "./helpers.ts";

import type {
  DeviceSyncAccount,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  ProviderJobContext,
  ProviderJobResult,
  StoredDeviceSyncAccount,
} from "../src/types.ts";

const NOW = "2026-06-11T12:00:00.000Z";
const SAME_DAY_LATER = "2026-06-11T18:00:00.000Z";
const BACKFILL_WINDOW_END = "2026-06-11T00:00:00.000Z";
const BP_HISTORY_COVERAGE_KEY = "junctionBloodPressureHistoryBackfillCoverage";
const NOTE_HISTORY_COVERAGE_KEY = "junctionNoteHistoryBackfillCoverage";
const SPARSE_DAILY_HISTORY_RESOURCES = [
  "afib_burden",
  "basal_body_temperature",
  "body_temperature",
  "body_temperature_delta",
  "caffeine",
  "heart_rate_recovery_one_minute",
  "mindfulness_minutes",
  "sleep_breathing_disturbance",
  "vo2_max",
  "water",
] as const;
const SOURCE_DISCONNECT_FENCE_CODES = [
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
] as const;

interface TimeseriesRequest {
  end: string | null;
  resource: string;
  start: string | null;
}

interface MutableProviderState {
  expectedProjectedStatus?: string;
  present?: boolean;
  resourceAvailability: Record<string, unknown>;
  status: string;
}

interface MutableHistoricalPullState {
  notPulled?: boolean;
  providerSlug?: string;
  resource: string;
  status?: string;
}

function isMockRecordInRequestWindow(
  timestamp: string,
  windowStart: string | null,
  windowEnd: string | null,
  timeZoneOffsetSeconds?: unknown,
): boolean {
  if (windowStart?.length === 10 && windowEnd?.length === 10) {
    const timestampMs = Date.parse(timestamp);
    const providerDate =
      typeof timeZoneOffsetSeconds === "number"
      && Number.isFinite(timeZoneOffsetSeconds)
      && Number.isFinite(timestampMs)
        ? new Date(timestampMs + timeZoneOffsetSeconds * 1_000).toISOString().slice(0, 10)
        : timestamp.slice(0, 10);
    return providerDate >= windowStart && providerDate <= windowEnd;
  }
  return (windowStart === null || timestamp >= windowStart)
    && (windowEnd === null || timestamp < windowEnd);
}

function createAccount(input: {
  connectedAt?: string;
  metadata?: Record<string, unknown>;
  now?: string;
  sources?: DeviceSyncAccount["sources"];
} = {}): DeviceSyncAccount {
  const now = input.now ?? NOW;
  return {
    id: "acct-junction-bp-1",
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
    metadata: input.metadata ?? {},
    connectedAt: input.connectedAt ?? NOW,
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    ...(input.sources === undefined ? {} : { sources: input.sources }),
    createdAt: now,
    updatedAt: now,
  };
}

function createStoredAccount(input: {
  connectedAt?: string;
  metadata?: Record<string, unknown>;
  sources?: DeviceSyncAccount["sources"];
} = {}): StoredDeviceSyncAccount {
  return {
    ...createAccount(input),
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
  };
}

function createSourceSummary(
  sourceProviderSlug: string,
  firstSeenAt = NOW,
  status: "connected" | "disconnected" | "error" | "unavailable" = "connected",
  resourceAvailabilitySummary: Record<string, string | number | boolean | null> = {
    blood_pressure: true,
  },
): NonNullable<DeviceSyncAccount["sources"]>[number] {
  return {
    displayName: sourceProviderSlug,
    firstSeenAt,
    lastDataAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: NOW,
    resourceCount: 1,
    resourceAvailabilitySummary,
    sourceProviderSlug,
    status,
  };
}

async function createSourceConnection(
  provider: ReturnType<typeof createProvider>,
  now = NOW,
  sourceProviderSlug = "omron",
) {
  return requireValue(provider.connectionHandler).completeConnection({
    callbackUrl: "https://sync.example.test/device-sync/connect/junction/callback",
    grantedScopes: [],
    now,
    query: new URLSearchParams({ murph_state: "state-1", state: "success" }),
    seededExternalAccountId: "junction-user-1",
    sourceProviderSlug,
    state: "state-1",
  });
}

function createScheduledBloodPressureJob(
  provider: ReturnType<typeof createProvider>,
  input: {
    firstSeenAt?: string;
    metadata?: Record<string, unknown>;
    now?: string;
    sourceProviderSlug?: string;
    status?: "connected" | "disconnected";
  } = {},
): DeviceSyncJobInput {
  const sourceProviderSlug = input.sourceProviderSlug ?? "omron";
  const scheduled = requireValue(provider.jobExecutor).createScheduledJobs?.(
    createStoredAccount({
      metadata: input.metadata,
      sources: [createSourceSummary(
        sourceProviderSlug,
        input.firstSeenAt ?? NOW,
        input.status ?? "connected",
      )],
    }),
    input.now ?? NOW,
  );
  return findBloodPressureJob(requireValue(scheduled).jobs);
}

function toJobRecord(input: DeviceSyncJobInput, index: number): DeviceSyncJobRecord {
  return {
    id: `job-${index}`,
    provider: "junction",
    accountId: "acct-junction-bp-1",
    kind: input.kind,
    payload: input.payload ?? {},
    priority: input.priority ?? 0,
    availableAt: input.availableAt ?? NOW,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 5,
    dedupeKey: input.dedupeKey ?? null,
    status: "queued",
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
    startedAt: null,
    finishedAt: null,
  };
}

function createJobContext(input: {
  account?: DeviceSyncAccount;
  canonicalEventCount?: number;
  connectionSourceAdmissionMode?: ProviderJobContext["connectionSourceAdmissionMode"];
  importSnapshot?: ProviderJobContext["importSnapshot"];
  importedSnapshots?: unknown[];
  listConnectionSources?: NonNullable<ProviderJobContext["listConnectionSources"]>;
  now?: string;
  projectedSources?: Array<{
    resourceAvailabilitySummary: Record<string, string | number | boolean | null>;
    status: string;
  }>;
  shouldYield?: () => boolean;
} = {}): ProviderJobContext {
  const account = input.account ?? createAccount();
  return {
    account,
    now: input.now ?? NOW,
    ...(input.connectionSourceAdmissionMode
      ? { connectionSourceAdmissionMode: input.connectionSourceAdmissionMode }
      : {}),
    importSnapshot: input.importSnapshot ?? (async (snapshot) => {
      input.importedSnapshots?.push(snapshot);
      const parsedSnapshot = requireValue(junctionProviderAdapter.parseSnapshot)(snapshot);
      const normalized = await junctionProviderAdapter.normalizeSnapshot(parsedSnapshot);
      const canonicalEventExternalRefResourceIds = (normalized.events ?? []).flatMap(
        (event) => event.externalRef?.resourceId ? [event.externalRef.resourceId] : [],
      );
      const canonicalSparseCalendarTargets = [...new Map(
        (normalized.events ?? []).flatMap((event) =>
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
        ),
      ).values()];
      const canonicalEventCount = input.canonicalEventCount
        ?? normalized.events?.length
        ?? 0;
      return {
        canonicalEventCount,
        canonicalEventExternalRefResourceIds:
          canonicalEventExternalRefResourceIds.slice(0, canonicalEventCount),
        canonicalSparseCalendarTargets,
        durableDeliveryAccepted: true,
      };
    }),
    upsertConnectionSource: (sourceInput) => {
      input.projectedSources?.push({
        resourceAvailabilitySummary:
          sourceInput.resourceAvailabilitySummary ?? {},
        status: sourceInput.status,
      });
      return {
        id: "src-1",
        connectionId: account.id,
        ...sourceInput,
        displayName: sourceInput.displayName ?? null,
        resourceAvailabilitySummary: sourceInput.resourceAvailabilitySummary ?? {},
        lastErrorCode: sourceInput.lastErrorCode ?? null,
        lastErrorMessage: sourceInput.lastErrorMessage ?? null,
        firstSeenAt: sourceInput.firstSeenAt ?? sourceInput.lastSeenAt,
        lastDataAt: sourceInput.lastDataAt ?? null,
        createdAt: sourceInput.lastSeenAt,
        updatedAt: sourceInput.lastSeenAt,
      };
    },
    refreshAccountTokens: async () => account,
    ...(input.listConnectionSources
      ? { listConnectionSources: input.listConnectionSources }
      : {}),
    ...(input.shouldYield ? { shouldYield: input.shouldYield } : {}),
    logger: {},
  };
}

async function importWithRealJunctionNormalizer(
  snapshot: unknown,
): Promise<{
  canonicalEventCount: number;
  canonicalEventExternalRefResourceIds: string[];
  durableDeliveryAccepted: true;
}> {
  const parsedSnapshot = requireValue(junctionProviderAdapter.parseSnapshot)(snapshot);
  const normalized = await junctionProviderAdapter.normalizeSnapshot(parsedSnapshot);
  return {
    canonicalEventCount: normalized.events?.length ?? 0,
    canonicalEventExternalRefResourceIds: (normalized.events ?? []).flatMap(
      (event) => event.externalRef?.resourceId ? [event.externalRef.resourceId] : [],
    ),
    durableDeliveryAccepted: true,
  };
}

function createProvider(input: {
  additionalProviders?: readonly {
    resourceAvailability?: Record<string, unknown>;
    slug: string;
    status?: string;
  }[];
  bloodPressureFailureRequest?: number;
  bloodPressureGroups?: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  bloodPressureRecords?: readonly Record<string, unknown>[];
  includeNote?: boolean;
  noteRecords?: readonly Record<string, unknown>[];
  timeseriesRecords?: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  bloodPressureRequestFailure?: {
    active: boolean;
    fromRequest: number;
    status: number;
  };
  providerListRequestFailure?: {
    active: boolean;
    status: number;
  };
  historicalPullRequestFailure?: {
    active: boolean;
    status: number;
  };
  providerListRequests?: { count: number };
  providerState?: MutableProviderState;
  historicalPullState?: MutableHistoricalPullState;
  requests: TimeseriesRequest[];
  summaryBackfillDays?: number;
  timeseriesBackfillDays?: number;
  timeseriesResources?: readonly string[];
}) {
  let bloodPressureRequestCount = 0;
  const providerState = input.providerState ?? {
    resourceAvailability: {
      activity: true,
      blood_pressure: true,
      stress_level: true,
    },
    status: "connected",
  };
  return createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    summaryBackfillDays: input.summaryBackfillDays ?? 30,
    timeseriesResources: input.timeseriesResources
      ? [...input.timeseriesResources]
      : input.includeNote
        ? ["blood_pressure", "stress_level", "note"]
        : ["blood_pressure", "stress_level"],
    ...(input.timeseriesBackfillDays === undefined
      ? {}
      : { timeseriesBackfillDays: input.timeseriesBackfillDays }),
    fetchImpl: async (request) => {
      const url = new URL(readUrl(request));

      if (url.pathname.includes("/v2/user/resolve/")) {
        return createJsonResponse({ user_id: "junction-user-1" });
      }
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        if (input.providerListRequests) {
          input.providerListRequests.count += 1;
        }
        if (input.providerListRequestFailure?.active === true) {
          return createJsonResponse(
            { error: "temporary_provider_list_failure" },
            input.providerListRequestFailure.status,
          );
        }
        return createJsonResponse({
          providers: providerState.present === false
            ? []
            : [{
                id: "provider-omron-1",
                slug: "omron",
                name: "Omron",
                status: providerState.status,
                resource_availability: providerState.resourceAvailability,
              }, ...(input.additionalProviders ?? []).map((provider) => ({
                id: `provider-${provider.slug}-1`,
                slug: provider.slug,
                name: provider.slug,
                status: provider.status ?? "connected",
                resource_availability: provider.resourceAvailability ?? {
                  blood_pressure: true,
                },
              }))],
        });
      }
      if (url.pathname === "/v2/summary/activity/junction-user-1") {
        return createJsonResponse({ data: [] });
      }
      if (url.pathname === "/v2/introspect/historical_pull") {
        if (input.historicalPullRequestFailure?.active === true) {
          return createJsonResponse(
            { error: "temporary_historical_pull_failure" },
            input.historicalPullRequestFailure.status,
          );
        }
        const state = input.historicalPullState;
        return createJsonResponse(state
          ? {
              data: [{
                provider: {
                  [state.providerSlug ?? "omron"]: {
                    not_pulled: state.notPulled ? [state.resource] : [],
                    pulled: state.status
                      ? { [state.resource]: { days_with_data: 0, status: state.status } }
                      : {},
                  },
                },
                user_id: "junction-user-1",
              }],
            }
          : { data: [] });
      }
      const timeseriesPrefix = "/v2/timeseries/junction-user-1/";
      if (url.pathname.startsWith(timeseriesPrefix)) {
        const resource = url.pathname
          .slice(timeseriesPrefix.length)
          .replace(/\/grouped$/u, "");
        input.requests.push({
          end: url.searchParams.get("end_date"),
          resource,
          start: url.searchParams.get("start_date"),
        });
        if (resource === "blood_pressure") {
          bloodPressureRequestCount += 1;
          if (
            input.bloodPressureRequestFailure?.active === true
            && bloodPressureRequestCount >= input.bloodPressureRequestFailure.fromRequest
          ) {
            return createJsonResponse(
              { error: "temporary_provider_failure" },
              input.bloodPressureRequestFailure.status,
            );
          }
          if (bloodPressureRequestCount === input.bloodPressureFailureRequest) {
            return createJsonResponse({ error: "unsupported_resource" }, 422);
          }
        }
        const bloodPressureGroups = input.bloodPressureGroups ?? {
          omron: input.bloodPressureRecords ?? [],
        };
        const noteWindowStart = url.searchParams.get("start_date");
        const noteWindowEnd = url.searchParams.get("end_date");
        const noteRecords = (input.noteRecords ?? []).filter((record) => {
          const timestamp = typeof record.start === "string" ? record.start : null;
          return timestamp !== null
            && isMockRecordInRequestWindow(timestamp, noteWindowStart, noteWindowEnd);
        });
        const timeseriesRecords = (input.timeseriesRecords?.[resource] ?? []).filter((record) => {
          const timestamp = typeof record.start === "string"
            ? record.start
            : typeof record.timestamp === "string"
              ? record.timestamp
              : null;
          return timestamp !== null
            && isMockRecordInRequestWindow(
              timestamp,
              noteWindowStart,
              noteWindowEnd,
              record.timezone_offset,
            );
        });
        const resourceGroups = resource === "note"
          ? { oura: noteRecords }
          : resource === "blood_pressure"
            ? bloodPressureGroups
            : { omron: timeseriesRecords };
        const records = resource === "blood_pressure"
          ? Object.values(bloodPressureGroups).flat()
          : resource === "note"
            ? noteRecords
            : timeseriesRecords;
        return createJsonResponse(
          records.length > 0
            ? {
                groups: Object.fromEntries(
                  Object.entries(resourceGroups).map(([source, sourceRecords]) => [
                    source,
                    [{
                      data: [...sourceRecords],
                      source: { provider: source, type: "ring" },
                    }],
                  ]),
                ),
              }
            : { groups: {} },
        );
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    },
  });
}

function findBloodPressureJob(jobs: readonly DeviceSyncJobInput[]): DeviceSyncJobInput {
  return findResourceJob(jobs, "blood_pressure");
}

function findResourceJob(
  jobs: readonly DeviceSyncJobInput[],
  resource: string,
): DeviceSyncJobInput {
  return requireValue(jobs.find((job) =>
    job.kind === "resource"
    && job.payload?.resource === resource
  ));
}

function assertHistoryCoverage(
  metadata: Record<string, unknown> | null | undefined,
  providerSlug: string,
  resource: string,
  expected = true,
  message?: string,
  version = resource === "note" ? 2 : 1,
): void {
  assert.equal(
    hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
      metadata ?? {},
      providerSlug,
      resource,
      version,
    ),
    expected,
    message,
  );
}

function addHistoryCoverage(
  metadata: Record<string, unknown>,
  providerSlug: string,
  resource: string,
): Record<string, unknown> {
  const update = addJunctionExtendedTimeseriesHistoryBackfillCoverage({
    metadata,
    providerSlug,
    resource,
    version: resource === "note" ? 2 : 1,
  });
  assert.ok(update);
  return { ...metadata, [update.metadataKey]: update.value };
}

async function executeImmediateBloodPressureContinuations(input: {
  context: ProviderJobContext;
  job: DeviceSyncJobRecord;
  provider: ReturnType<typeof createProvider>;
  startingIndex?: number;
}): Promise<{
  executionCount: number;
  result: ProviderJobResult;
  results: ProviderJobResult[];
}> {
  return executeImmediateResourceContinuations({
    ...input,
    resource: "blood_pressure",
  });
}

async function executeImmediateResourceContinuations(input: {
  context: ProviderJobContext;
  drainCalendarJobs?: boolean;
  job: DeviceSyncJobRecord;
  provider: ReturnType<typeof createProvider>;
  resource: string;
  startingIndex?: number;
}): Promise<{
  executionCount: number;
  result: ProviderJobResult;
  results: ProviderJobResult[];
}> {
  const executor = requireValue(input.provider.jobExecutor);
  let currentJob = input.job;
  let executionCount = 0;
  let nextIndex = input.startingIndex ?? 10_000;
  const results: ProviderJobResult[] = [];
  const pendingCalendarJobs = new Map<string, DeviceSyncJobInput>();

  const retainCalendarJobs = (result: ProviderJobResult) => {
    for (const scheduledJob of result.scheduledJobs ?? []) {
      if (
        scheduledJob.kind !== "resource"
        || scheduledJob.payload?.resource !== input.resource
        || typeof scheduledJob.payload.calendarRefreshDay !== "string"
      ) {
        continue;
      }
      const identity = scheduledJob.dedupeKey
        ?? JSON.stringify(scheduledJob.payload);
      pendingCalendarJobs.set(identity, scheduledJob);
    }
  };

  while (executionCount < 400) {
    const result = await executor.executeJob(input.context, currentJob);
    results.push(result);
    executionCount += 1;
    retainCalendarJobs(result);
    const continuation = result.scheduledJobs?.find((job) =>
      job.kind === "resource"
      && job.payload?.resource === input.resource
      && job.payload.calendarRefreshDay === undefined
    );
    if (
      !continuation
      || (continuation.availableAt && continuation.availableAt !== input.context.now)
    ) {
      if (input.drainCalendarJobs !== false) {
        for (const calendarJob of pendingCalendarJobs.values()) {
          if (
            calendarJob.availableAt
            && calendarJob.availableAt !== input.context.now
          ) {
            continue;
          }
          const calendarResult = await executor.executeJob(
            input.context,
            toJobRecord(calendarJob, nextIndex),
          );
          results.push(calendarResult);
          executionCount += 1;
          nextIndex += 1;
        }
      }
      const remainingScheduledJobs = input.drainCalendarJobs === false
        ? result.scheduledJobs
        : result.scheduledJobs?.filter((job) =>
            typeof job.payload?.calendarRefreshDay !== "string"
          );
      return {
        executionCount,
        result: result.scheduledJobs
          ? { ...result, scheduledJobs: remainingScheduledJobs }
          : result,
        results,
      };
    }
    currentJob = toJobRecord(continuation, nextIndex);
    nextIndex += 1;
  }

  throw new Error(`${input.resource} history did not reach a delayed or terminal result.`);
}

async function executeImmediateFullTimeseriesContinuations(input: {
  context: ProviderJobContext;
  initialResult: ProviderJobResult;
  provider: ReturnType<typeof createProvider>;
  startingIndex?: number;
}): Promise<{
  executionCount: number;
  result: ProviderJobResult;
  results: ProviderJobResult[];
}> {
  const executor = requireValue(input.provider.jobExecutor);
  let result = input.initialResult;
  let executionCount = 0;
  let nextIndex = input.startingIndex ?? 20_000;
  const results: ProviderJobResult[] = [];

  while (executionCount < 1_000) {
    const continuation = result.scheduledJobs?.find((job) =>
      (job.kind === "backfill" || job.kind === "reconcile")
      && typeof job.payload?.timeseriesResourceCursor === "string"
    );
    if (!continuation) {
      return { executionCount, result, results };
    }
    assert.equal(continuation.availableAt, input.context.now);
    result = await executor.executeJob(
      input.context,
      toJobRecord(continuation, nextIndex),
    );
    results.push(result);
    executionCount += 1;
    nextIndex += 1;
  }

  throw new Error("Full Junction timeseries continuation did not terminate.");
}

test("the persisted-source scheduler gives sparse blood pressure its own full-history resumable job", async () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({ requests });
  const connection = await createSourceConnection(provider);
  const jobs = connection.initialJobs ?? [];
  const backfill = requireValue(jobs.find((job) => job.kind === "backfill"));
  assert.equal(
    jobs.some((job) =>
      job.kind === "resource" && job.payload?.resource === "blood_pressure"
    ),
    false,
  );
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const admittedBloodPressure = toJobRecord(bloodPressure, 2);
  admittedBloodPressure.dedupeKey = `hosted-device-sync:${"a".repeat(64)}`;

  assert.equal(bloodPressure.availableAt, NOW);
  assert.deepEqual(bloodPressure.payload, {
    historicalBackfill: true,
    historicalWindowStart: "2026-05-12T00:00:00.000Z",
    resource: "blood_pressure",
    resourceCategory: "timeseries",
    sourceProviderSlug: "omron",
    windowStart: "2026-05-12T00:00:00.000Z",
    windowEnd: BACKFILL_WINDOW_END,
  });

  const executor = requireValue(provider.jobExecutor);
  const boundedResult = await executor.executeJob(
    createJobContext({
      account: createAccount({
        metadata: { [BP_HISTORY_COVERAGE_KEY]: "v1|omron" },
        sources: [createSourceSummary("omron")],
      }),
    }),
    toJobRecord(backfill, 1),
  );
  const boundedRequests = [...requests];
  assert.equal(boundedRequests.length, 0);
  assert.equal(boundedResult.scheduledJobs?.length, 1);
  assert.equal(
    boundedResult.scheduledJobs?.[0]?.payload?.timeseriesResourceCursor,
    "blood_pressure",
  );
  assert.equal(
    boundedResult.scheduledJobs?.[0]?.payload?.timeseriesCursor,
    "2026-05-28T00:00:00.000Z",
  );
  assert.equal(
    Object.hasOwn(
      boundedResult.metadataPatch ?? {},
      BP_HISTORY_COVERAGE_KEY,
    ),
    false,
  );
  requests.length = 0;

  const { executionCount, result } = await executeImmediateBloodPressureContinuations({
    context: createJobContext(),
    job: admittedBloodPressure,
    provider,
  });
  const bloodPressureRequests = requests.filter(
    (request) => request.resource === "blood_pressure",
  );
  assert.equal(executionCount, 30);
  assert.equal(bloodPressureRequests.length, 30);
  assert.equal(bloodPressureRequests[0]?.start, "2026-05-12T00:00:00.000Z");
  assert.equal(bloodPressureRequests.at(-1)?.end, BACKFILL_WINDOW_END);
  const retry = findBloodPressureJob(result.scheduledJobs ?? []);
  assert.equal(retry.availableAt, "2026-06-11T12:15:00.000Z");
  assert.equal(retry.dedupeKey, admittedBloodPressure.dedupeKey);
  assert.equal(retry.payload?.emptyBackfillAttempts, 1);
  assert.equal(retry.payload?.historicalWindowStart, "2026-05-12T00:00:00.000Z");
  assert.equal(retry.payload?.windowStart, "2026-05-12T00:00:00.000Z");
});

test("covered Link reconnects retain bounded blood-pressure catch-up", async () => {
  for (const timeseriesBackfillDays of [14, 21]) {
    const requests: TimeseriesRequest[] = [];
    const importedSnapshots: unknown[] = [];
    const provider = createProvider({
      bloodPressureRecords: [{
        id: `bp-reconnect-${timeseriesBackfillDays}`,
        timestamp: "2026-06-02T08:30:00.000Z",
        systolic: 122,
        diastolic: 80,
      }],
      requests,
      timeseriesBackfillDays,
    });
    const callbackAt = "2026-06-12T00:05:00.000Z";
    const connection = await createSourceConnection(provider, callbackAt, "omron");
    const backfill = requireValue(
      connection.initialJobs?.find((job) => job.kind === "backfill"),
    );
    const account = createAccount({
      connectedAt: "2026-03-20T23:55:00.000Z",
      metadata: { [BP_HISTORY_COVERAGE_KEY]: "v1|omron" },
      now: callbackAt,
      sources: [createSourceSummary("omron", callbackAt)],
    });

    const context = createJobContext({ account, importedSnapshots, now: callbackAt });
    const result = await requireValue(provider.jobExecutor).executeJob(
      context,
      toJobRecord(backfill, timeseriesBackfillDays),
    );
    await executeImmediateFullTimeseriesContinuations({
      context,
      initialResult: result,
      provider,
    });
    const bloodPressureRequests = requests.filter(
      (request) => request.resource === "blood_pressure",
    );

    assert.equal(bloodPressureRequests.length, timeseriesBackfillDays);
    assert.equal(
      bloodPressureRequests[0]?.start,
      timeseriesBackfillDays === 14
        ? "2026-05-29"
        : "2026-05-22",
    );
    assert.equal(bloodPressureRequests.at(-1)?.end, "2026-06-11");
    assert.equal(
      bloodPressureRequests.some((request) =>
        request.start !== null && request.start < "2026-06-05"
      ),
      true,
    );
    assert.equal(
      JSON.stringify(importedSnapshots).includes(
        `bp-reconnect-${timeseriesBackfillDays}`,
      ),
      true,
    );
    assert.equal(
      Object.hasOwn(result.metadataPatch ?? {}, BP_HISTORY_COVERAGE_KEY),
      false,
    );
    const scheduled = requireValue(provider.jobExecutor).createScheduledJobs?.(
      createStoredAccount({
        connectedAt: account.connectedAt,
        metadata: account.metadata,
        sources: account.sources,
      }),
      callbackAt,
    );
    assert.equal(
      requireValue(scheduled).jobs.some((job) =>
        job.kind === "resource" && job.payload?.resource === "blood_pressure"
      ),
      false,
    );
  }
});

test("empty blood-pressure history retries are bounded and mark source coverage terminal", async () => {
  const provider = createProvider({ requests: [] });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const exhausted = {
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
    },
  };
  const { result } = await executeImmediateBloodPressureContinuations({
    context: createJobContext(),
    job: toJobRecord(exhausted, 1),
    provider,
  });

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(result.metadataPatch, "omron", "blood_pressure");
});

test("SDK setup before a source is known does not fetch unusable full history", async () => {
  const provider = createProvider({ requests: [] });
  const sdk = requireValue(provider.sdkConnectionHandler);
  const connection = await sdk.ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  assert.deepEqual(connection.initialJobs?.map((job) => job.kind), [
    "backfill",
    "reconcile",
  ]);
  assert.equal(
    connection.initialJobs?.some((job) =>
      job.kind === "resource" && job.payload?.resource === "blood_pressure"
    ),
    false,
  );
});

test("a source-scoped terminal pass preserves completed sibling coverage", async () => {
  const provider = createProvider({ requests: [] });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const sourceScoped = {
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
      sourceProviderSlug: "omron",
    },
  };
  const { result } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      account: createAccount({
        metadata: { [BP_HISTORY_COVERAGE_KEY]: "v1|withings" },
      }),
    }),
    job: toJobRecord(sourceScoped, 1),
    provider,
  });

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(result.metadataPatch, "omron", "blood_pressure");
  assertHistoryCoverage(result.metadataPatch, "withings", "blood_pressure");
});

test("a newly confirmed source backfills older blood pressure after sibling coverage", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createProvider({
    bloodPressureRecords: [{
      id: "bp-source-history-1",
      timestamp: "2026-05-20T08:30:00.000Z",
      systolic: 121,
      diastolic: 79,
    }],
    requests: [],
  });
  const bloodPressure = createScheduledBloodPressureJob(provider, {
    metadata: { [BP_HISTORY_COVERAGE_KEY]: "v1|withings" },
  });
  const sourceScoped = {
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      sourceProviderSlug: "omron",
    },
  };

  const { result } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      account: createAccount({
        metadata: { [BP_HISTORY_COVERAGE_KEY]: "v1|withings" },
      }),
      importedSnapshots,
    }),
    job: toJobRecord(sourceScoped, 1),
    provider,
  });

  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    JSON.stringify(importedSnapshots).includes("bp-source-history-1"),
    true,
  );
  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(result.metadataPatch, "omron", "blood_pressure");
  assertHistoryCoverage(result.metadataPatch, "withings", "blood_pressure");
});

test("an existing source receives one migration anchored to its first-seen window", () => {
  const provider = createProvider({ requests: [] });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const connectedAt = "2026-04-20T17:45:00.000Z";
  const sourceFirstSeenAt = "2026-05-20T17:45:00.000Z";
  const sources = [createSourceSummary("omron", sourceFirstSeenAt)];
  const scheduled = createScheduledJobs(
    createStoredAccount({ connectedAt, sources }),
    NOW,
  );
  const bloodPressure = findBloodPressureJob(scheduled.jobs);

  assert.equal(bloodPressure.availableAt, NOW);
  assert.equal(bloodPressure.payload?.historicalWindowStart, "2026-04-20T00:00:00.000Z");
  assert.equal(bloodPressure.payload?.sourceProviderSlug, "omron");
  assert.equal(bloodPressure.payload?.windowStart, "2026-04-20T00:00:00.000Z");
  assert.equal(bloodPressure.payload?.windowEnd, "2026-05-20T00:00:00.000Z");

  const completed = createScheduledJobs(
    createStoredAccount({
      connectedAt,
      metadata: { [BP_HISTORY_COVERAGE_KEY]: "v1|omron" },
      sources,
    }),
    NOW,
  );
  assert.equal(
    completed.jobs.some((job) =>
      job.kind === "resource"
      && job.payload?.resource === "blood_pressure"
    ),
    false,
  );
});

test("v1 Oura note coverage receives one v2 semantic reimport while dense timeseries stay bounded", async () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({
    additionalProviders: [{
      resourceAvailability: { note: true },
      slug: "oura",
    }],
    includeNote: true,
    noteRecords: [{
      id: "note-history-1",
      end: "2026-01-05T20:05:00.000Z",
      sourceProviderSlug: "oura",
      sourceType: "ring",
      start: "2026-01-05T20:00:00.000Z",
      tags: ["sauna"],
    }, {
      end: "2026-02-05T20:05:00.000Z",
      start: "2026-02-05T20:00:00.000Z",
      tags: [],
      value: "SENSITIVE_EMPTY_TAG_NOTE",
    }],
    requests,
    summaryBackfillDays: 180,
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sourceFirstSeenAt = "2026-01-01T12:00:00.000Z";
  const sources = [createSourceSummary(
    "oura",
    sourceFirstSeenAt,
    "connected",
    { blood_pressure: false, note: true, stress_level: true },
  )];
  const scheduled = createScheduledJobs(
    createStoredAccount({
      metadata: { [NOTE_HISTORY_COVERAGE_KEY]: "v1|oura" },
      sources,
    }),
    NOW,
  );
  const note = requireValue(scheduled.jobs.find((job) =>
    job.kind === "resource" && job.payload?.resource === "note"
  ));

  assert.deepEqual(note.payload, {
    historicalBackfill: true,
    historicalBackfillVersion: 2,
    historicalWindowStart: "2025-12-13T00:00:00.000Z",
    resource: "note",
    resourceCategory: "timeseries",
    sourceProviderSlug: "oura",
    windowEnd: BACKFILL_WINDOW_END,
    windowStart: "2025-12-13T00:00:00.000Z",
  });

  const importedSnapshots: unknown[] = [];
  const { executionCount, result } = await executeImmediateResourceContinuations({
    context: createJobContext({
      account: createAccount({
        metadata: { [NOTE_HISTORY_COVERAGE_KEY]: "v1|oura" },
      }),
      importedSnapshots,
    }),
    job: toJobRecord(note, 1),
    provider,
    resource: "note",
  });
  assert.equal(executionCount, 180);
  assert.equal(importedSnapshots.length, 2);
  assertHistoryCoverage(result.metadataPatch, "oura", "note");
  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assert.equal(
    requests.filter((request) => request.resource === "note").length,
    180,
  );

  const nextDayPending = createScheduledJobs(
    createStoredAccount({
      metadata: { [NOTE_HISTORY_COVERAGE_KEY]: "v1|oura" },
      sources,
    }),
    "2026-06-12T12:00:00.000Z",
  );
  const nextDayNote = requireValue(nextDayPending.jobs.find((job) =>
    job.kind === "resource" && job.payload?.resource === "note"
  ));
  assert.equal(nextDayNote.dedupeKey, note.dedupeKey);

  requests.length = 0;
  const bounded = requireValue(scheduled.jobs.find((job) => job.kind === "reconcile"));
  const boundedContext = createJobContext({
      account: createAccount({ metadata: result.metadataPatch }),
    });
  const boundedResult = await requireValue(provider.jobExecutor).executeJob(
    boundedContext,
    toJobRecord(bounded, 2),
  );
  await executeImmediateFullTimeseriesContinuations({
    context: boundedContext,
    initialResult: boundedResult,
    provider,
  });
  assert.equal(
    requests.filter((request) => request.resource === "stress_level").length,
    7,
  );

  const completed = createScheduledJobs(
    createStoredAccount({ metadata: result.metadataPatch, sources }),
    "2026-06-12T12:00:00.000Z",
  );
  assert.equal(
    completed.jobs.some((job) => job.kind === "resource" && job.payload?.resource === "note"),
    false,
  );
});

test("sparse daily resources receive one rollout-anchored summary-history job", () => {
  const resourceAvailabilitySummary = Object.fromEntries([
    ...SPARSE_DAILY_HISTORY_RESOURCES.map((resource) => [resource, true] as const),
    ["stress_level", true],
  ]);
  const provider = createProvider({
    providerState: {
      resourceAvailability: resourceAvailabilitySummary,
      status: "connected",
    },
    requests: [],
    summaryBackfillDays: 180,
    timeseriesResources: ["stress_level", ...SPARSE_DAILY_HISTORY_RESOURCES],
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    resourceAvailabilitySummary,
  )];
  const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);
  const nextDay = createScheduledJobs(
    createStoredAccount({ sources }),
    "2026-06-12T12:00:00.000Z",
  );

  for (const resource of SPARSE_DAILY_HISTORY_RESOURCES) {
    const job = findResourceJob(scheduled.jobs, resource);
    const nextDayJob = findResourceJob(nextDay.jobs, resource);
    assert.equal(job.payload?.historicalWindowStart, "2025-12-13T00:00:00.000Z");
    assert.equal(job.payload?.windowEnd, BACKFILL_WINDOW_END);
    assert.equal(nextDayJob.dedupeKey, job.dedupeKey);
  }
  assert.equal(
    scheduled.jobs.some((job) =>
      job.kind === "resource" && job.payload?.resource === "stress_level"
    ),
    false,
  );
});

test("terminal matrix coverage suppresses every extended-history pair", () => {
  const extendedResources = [
    "blood_pressure",
    "note",
    ...SPARSE_DAILY_HISTORY_RESOURCES,
  ] as const;
  const extendedResourceSet = new Set<string>(extendedResources);
  const resourceAvailabilitySummary = Object.fromEntries(
    extendedResources.map((resource) => [resource, true] as const),
  );
  const provider = createProvider({
    includeNote: true,
    providerState: {
      resourceAvailability: resourceAvailabilitySummary,
      status: "connected",
    },
    requests: [],
    timeseriesResources: extendedResources,
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    resourceAvailabilitySummary,
  )];
  const metadata = extendedResources.reduce(
    (current, resource) => addHistoryCoverage(current, "omron", resource),
    {} as Record<string, unknown>,
  );
  const scheduled = createScheduledJobs(
    createStoredAccount({ metadata, sources }),
    NOW,
  );

  assert.equal(
    scheduled.jobs.some((job) =>
      job.kind === "resource"
      && extendedResourceSet.has(String(job.payload?.resource))
    ),
    false,
  );
});

test("an unrepresentable source is omitted from extended-history scheduling", () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({
    additionalProviders: [{
      resourceAvailability: { caffeine: true },
      slug: "configured_source_outside_connect_catalog",
    }],
    requests,
    timeseriesResources: ["caffeine"],
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "configured_source_outside_connect_catalog",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { caffeine: true },
  )];
  const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);

  assert.equal(
    scheduled.jobs.some((job) =>
      job.kind === "resource" && job.payload?.resource === "caffeine"
    ),
    false,
  );
  assert.equal(requests.length, 0);
});

test("unwritable legacy slots fail before extended-history provider egress", async () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({
    providerState: {
      resourceAvailability: { caffeine: true },
      status: "connected",
    },
    requests,
    timeseriesResources: ["caffeine"],
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { caffeine: true },
  )];
  const job = findResourceJob(
    createScheduledJobs(createStoredAccount({ sources }), NOW).jobs,
    "caffeine",
  );

  await assert.rejects(
    requireValue(provider.jobExecutor).executeJob(
      createJobContext({
        account: createAccount({
          metadata: {
            junctionBloodPressureHistoryBackfillCoverage: "opaque-blood-pressure-state",
            junctionNoteHistoryBackfillCoverage: "opaque-note-state",
          },
          sources,
        }),
      }),
      toJobRecord(job, 1),
    ),
    (error) =>
      isDeviceSyncError(error)
      && error.code === "JUNCTION_EXTENDED_HISTORY_COVERAGE_UNREPRESENTABLE",
  );
  assert.equal(requests.length, 0);
});

test("coverage capacity gates scheduling and reopens when retention becomes possible", () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({
    providerState: {
      resourceAvailability: { caffeine: true },
      status: "connected",
    },
    requests,
    timeseriesResources: ["caffeine"],
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { caffeine: true },
  )];
  const metadata = Object.fromEntries(
    Array.from({ length: 16 }, (_, index) => [`capacityFact${index}`, index]),
  );
  const saturated = createScheduledJobs(
    createStoredAccount({ metadata, sources }),
    NOW,
  );
  assert.equal(
    saturated.jobs.some((job) =>
      job.kind === "resource" && job.payload?.resource === "caffeine"
    ),
    false,
  );
  assert.equal(saturated.jobs.some((job) => job.kind === "reconcile"), true);

  const available = createScheduledJobs(
    createStoredAccount({
      metadata: Object.fromEntries(Object.entries(metadata).slice(0, 15)),
      sources,
    }),
    NOW,
  );
  assert.equal(findResourceJob(available.jobs, "caffeine").kind, "resource");

  const reusableCoverage = addHistoryCoverage(
    Object.fromEntries(Object.entries(metadata).slice(0, 15)),
    "withings",
    "blood_pressure",
  );
  const inPlace = createScheduledJobs(
    createStoredAccount({ metadata: reusableCoverage, sources }),
    NOW,
  );
  assert.equal(findResourceJob(inPlace.jobs, "caffeine").kind, "resource");
  assert.equal(requests.length, 0);
});

test("a stale job leaves newer extended-history coverage untouched without egress", async () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({
    providerState: {
      resourceAvailability: { caffeine: true },
      status: "connected",
    },
    requests,
    timeseriesResources: ["caffeine"],
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { caffeine: true },
  )];
  const job = findResourceJob(
    createScheduledJobs(createStoredAccount({ sources }), NOW).jobs,
    "caffeine",
  );

  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({
      account: createAccount({
        metadata: {
          junctionBloodPressureHistoryBackfillCoverage: `m2|${"0".repeat(192)}`,
        },
        sources,
      }),
    }),
    toJobRecord(job, 1),
  );

  assert.deepEqual(result, {});
  assert.equal(requests.length, 0);
});

test("a sparse daily aggregate completes when several readings reduce to one event", async () => {
  const provider = createProvider({
    providerState: {
      resourceAvailability: { caffeine: true },
      status: "connected",
    },
    requests: [],
    summaryBackfillDays: 2,
    timeseriesRecords: {
      caffeine: [{
        end: "2026-06-10T08:05:00.000Z",
        start: "2026-06-10T08:00:00.000Z",
        unit: "g",
        value: 0.08,
      }, {
        end: "2026-06-10T14:05:00.000Z",
        start: "2026-06-10T14:00:00.000Z",
        unit: "g",
        value: 0.04,
      }],
    },
    timeseriesResources: ["caffeine"],
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const resourceAvailabilitySummary = { caffeine: true };
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    resourceAvailabilitySummary,
  )];
  const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);
  const caffeine = findResourceJob(scheduled.jobs, "caffeine");
  const { result } = await executeImmediateResourceContinuations({
    context: createJobContext(),
    job: toJobRecord(caffeine, 1),
    provider,
    resource: "caffeine",
  });

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(result.metadataPatch, "omron", "caffeine");
});

test("a sparse daily aggregate retries a date with a malformed sibling", async () => {
  const importedSnapshots: unknown[] = [];
  const timeseriesRecords: Record<string, unknown>[] = [{
    end: "2026-06-09T08:05:00.000Z",
    start: "2026-06-09T08:00:00.000Z",
    unit: "g",
  }, {
    end: "2026-06-09T14:05:00.000Z",
    start: "2026-06-09T14:00:00.000Z",
    unit: "g",
    value: 0.08,
  }];
  const provider = createProvider({
    providerState: {
      resourceAvailability: { caffeine: true },
      status: "connected",
    },
    requests: [],
    summaryBackfillDays: 2,
    timeseriesRecords: { caffeine: timeseriesRecords },
    timeseriesResources: ["caffeine"],
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { caffeine: true },
  )];
  const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);
  const caffeine = findResourceJob(scheduled.jobs, "caffeine");
  const firstPass = await executeImmediateResourceContinuations({
    context: createJobContext({ importedSnapshots }),
    drainCalendarJobs: false,
    job: toJobRecord(caffeine, 1),
    provider,
    resource: "caffeine",
  });
  const delayedRetry = findResourceJob(firstPass.result.scheduledJobs ?? [], "caffeine");
  const mixedImportResult = firstPass.results.find((result) =>
    result.scheduledJobs?.some((job) =>
      job.kind === "resource"
      && job.payload?.resource === "caffeine"
      && job.payload.calendarRefreshDay === undefined
      && job.availableAt === "2026-06-11T12:15:00.000Z"
    )
  );
  assert.ok(mixedImportResult);
  const retainedCalendarRepair = mixedImportResult.scheduledJobs?.find((job) =>
    job.kind === "resource"
    && job.payload?.resource === "caffeine"
    && job.payload.calendarRefreshDay === "2026-06-09"
  );

  assertHistoryCoverage(firstPass.result.metadataPatch, "omron", "caffeine", false);
  assert.ok(
    retainedCalendarRepair,
    "The mixed precise import must retain its proven day beside the malformed-row retry.",
  );
  assert.equal(delayedRetry.availableAt, "2026-06-11T12:15:00.000Z");
  assert.equal(delayedRetry.payload?.windowStart, "2026-06-09T00:00:00.000Z");
  assert.equal(delayedRetry.payload?.historicalPullReady, undefined);

  timeseriesRecords[0] = {
    ...timeseriesRecords[0],
    value: 0.04,
  };
  const repaired = await executeImmediateResourceContinuations({
    context: createJobContext({
      importedSnapshots,
      now: "2026-06-11T12:15:00.000Z",
    }),
    job: toJobRecord(delayedRetry, 3),
    provider,
    resource: "caffeine",
  });

  assert.equal(repaired.result.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(repaired.result.metadataPatch, "omron", "caffeine");
  const completed = createScheduledJobs(
    createStoredAccount({ metadata: repaired.result.metadataPatch, sources }),
    "2026-06-12T12:00:00.000Z",
  );
  assert.equal(
    completed.jobs.some((job) =>
      job.kind === "resource" && job.payload?.resource === "caffeine"
    ),
    false,
  );
  const normalized = await Promise.all(importedSnapshots.map(async (snapshot) => {
    const parsed = requireValue(junctionProviderAdapter.parseSnapshot)(snapshot);
    return junctionProviderAdapter.normalizeSnapshot(parsed);
  }));
  assert.deepEqual(
    normalized.flatMap((payload) =>
      payload.events
        ?.filter((event) => event.fields?.metric === "caffeine")
        .map((event) => event.fields?.value) ?? []
    ),
    [120],
  );
});

test("date-mode history and reconcile keep provider days atomic across UTC midnight", async () => {
  const cases = [
    [
      "negative offset",
      [
        { end: "2026-06-09T17:05:00.000Z", start: "2026-06-09T17:00:00.000Z", timezone_offset: -25_200, unit: "g", value: 0.08 },
        { end: "2026-06-10T03:05:00.000Z", start: "2026-06-10T03:00:00.000Z", timezone_offset: -25_200, unit: "g", value: 0.04 },
      ],
    ],
    [
      "positive offset",
      [
        { end: "2026-06-08T17:35:00.000Z", start: "2026-06-08T17:30:00.000Z", timezone_offset: 25_200, unit: "g", value: 0.08 },
        { end: "2026-06-09T13:05:00.000Z", start: "2026-06-09T13:00:00.000Z", timezone_offset: 25_200, unit: "g", value: 0.04 },
      ],
    ],
  ] as const;

  for (const [label, records] of cases) {
    const provider = createProvider({
      providerState: {
        resourceAvailability: { caffeine: true },
        status: "connected",
      },
      requests: [],
      summaryBackfillDays: 2,
      timeseriesRecords: { caffeine: records },
      timeseriesResources: ["caffeine"],
    });
    const executor = requireValue(provider.jobExecutor);
    const createScheduledJobs = requireValue(executor.createScheduledJobs);
    const sources = [createSourceSummary(
      "omron",
      "2026-01-01T12:00:00.000Z",
      "connected",
      { caffeine: true },
    )];
    const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);
    const historicalSnapshots: unknown[] = [];
    const historical = await executeImmediateResourceContinuations({
      context: createJobContext({ importedSnapshots: historicalSnapshots }),
      job: toJobRecord(findResourceJob(scheduled.jobs, "caffeine"), 1),
      provider,
      resource: "caffeine",
    });
    const reconcileSnapshots: unknown[] = [];
    const reconcileContext = createJobContext({ importedSnapshots: reconcileSnapshots });
    const reconcileSetup = await executor.executeJob(
      reconcileContext,
      toJobRecord({
        dedupeKey: `reconcile-${label}`,
        kind: "reconcile",
        payload: {
          windowEnd: "2026-06-10T00:00:00.000Z",
          windowStart: "2026-06-09T00:00:00.000Z",
        },
        priority: 40,
      }, 2),
    );
    await executeImmediateFullTimeseriesContinuations({
      context: reconcileContext,
      initialResult: reconcileSetup,
      provider,
    });

    const externalRefs = [];
    for (const snapshots of [historicalSnapshots, reconcileSnapshots]) {
      const normalized = await Promise.all(snapshots.map(async (snapshot) => {
        const parsed = requireValue(junctionProviderAdapter.parseSnapshot)(snapshot);
        return junctionProviderAdapter.normalizeSnapshot(parsed);
      }));
      const caffeineEvents = normalized.flatMap((payload) =>
        payload.events?.filter((event) => event.fields?.metric === "caffeine") ?? []
      );
      assert.equal(caffeineEvents.length, 1, label);
      assert.equal(caffeineEvents[0]?.dayKey, "2026-06-09", label);
      assert.equal(caffeineEvents[0]?.fields?.value, 120, label);
      externalRefs.push(caffeineEvents[0]?.externalRef);
    }
    assert.deepEqual(externalRefs[0], externalRefs[1], label);
    assert.equal(historical.result.scheduledJobs?.length ?? 0, 0, label);
  }
});

test("sparse history waits for upstream pull success beyond the empty retry ladder", async () => {
  const historicalPullState: MutableHistoricalPullState = {
    resource: "caffeine",
    status: "in_progress",
  };
  const requests: TimeseriesRequest[] = [];
  const timeseriesRecords: Record<string, unknown>[] = [];
  const provider = createProvider({
    historicalPullState,
    providerState: {
      resourceAvailability: { caffeine: true },
      status: "connected",
    },
    requests,
    summaryBackfillDays: 2,
    timeseriesRecords: { caffeine: timeseriesRecords },
    timeseriesResources: ["caffeine"],
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { caffeine: true },
  )];
  const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);
  const exhausted = toJobRecord({
    ...findResourceJob(scheduled.jobs, "caffeine"),
    payload: {
      ...findResourceJob(scheduled.jobs, "caffeine").payload,
      emptyBackfillAttempts: 4,
    },
  }, 1);
  const pending = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    exhausted,
  );
  const retry = findResourceJob(pending.scheduledJobs ?? [], "caffeine");

  assertHistoryCoverage(pending.metadataPatch, "omron", "caffeine", false);
  assert.equal(retry.availableAt, "2026-06-12T12:00:00.000Z");
  assert.equal(requests.length, 0);

  historicalPullState.status = "success";
  timeseriesRecords.push({
    end: "2026-06-09T08:05:00.000Z",
    start: "2026-06-09T08:00:00.000Z",
    unit: "g",
    value: 0.08,
  });
  const completed = await executeImmediateResourceContinuations({
    context: createJobContext({ now: "2026-06-12T12:00:00.000Z" }),
    job: toJobRecord(retry, 2),
    provider,
    resource: "caffeine",
  });

  assertHistoryCoverage(completed.result.metadataPatch, "omron", "caffeine");
  assert.equal(requests.length, 3);
});

test("sparse history completion resolves supported source aliases", async () => {
  const cases = [
    {
      expectedCoverage: false,
      expectedScheduledJobs: 1,
      expectedTimeseriesRequests: 0,
      historicalPullState: {
        notPulled: true,
        resource: "caffeine",
        status: "in_progress",
      },
      label: "in_progress",
    },
    {
      expectedCoverage: true,
      expectedScheduledJobs: 0,
      expectedTimeseriesRequests: 0,
      historicalPullState: { notPulled: true, resource: "caffeine" },
      label: "not_pulled",
    },
    {
      expectedCoverage: false,
      expectedScheduledJobs: 0,
      expectedTimeseriesRequests: 0,
      historicalPullState: {
        notPulled: true,
        resource: "caffeine",
        status: "failure",
      },
      label: "failure",
    },
    {
      expectedCoverage: true,
      expectedScheduledJobs: 0,
      expectedTimeseriesRequests: 3,
      historicalPullState: {
        notPulled: true,
        resource: "caffeine",
        status: "success",
      },
      label: "success",
    },
  ] as const;

  for (const testCase of cases) {
    const requests: TimeseriesRequest[] = [];
    const provider = createProvider({
      additionalProviders: [{
        resourceAvailability: { caffeine: true },
        slug: "apple_health",
      }],
      historicalPullState: {
        ...testCase.historicalPullState,
        providerSlug: "apple-healthkit",
      },
      providerState: {
        resourceAvailability: { activity: true },
        status: "connected",
      },
      requests,
      summaryBackfillDays: 2,
      timeseriesRecords: {
        caffeine: [{
          end: "2026-06-09T08:05:00.000Z",
          start: "2026-06-09T08:00:00.000Z",
          unit: "g",
          value: 0.08,
        }],
      },
      timeseriesResources: ["caffeine"],
    });
    const createScheduledJobs = requireValue(
      requireValue(provider.jobExecutor).createScheduledJobs,
    );
    const sources = [createSourceSummary(
      "apple_health",
      "2026-01-01T12:00:00.000Z",
      "connected",
      { caffeine: true },
    )];
    const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);
    const completed = await executeImmediateResourceContinuations({
      context: createJobContext(),
      job: toJobRecord(findResourceJob(scheduled.jobs, "caffeine"), 1),
      provider,
      resource: "caffeine",
    });

    assertHistoryCoverage(
      completed.result.metadataPatch,
      "apple_health",
      "caffeine",
      testCase.expectedCoverage,
      testCase.label,
    );
    assert.equal(
      completed.result.scheduledJobs?.length ?? 0,
      testCase.expectedScheduledJobs,
      testCase.label,
    );
    assert.equal(
      requests.length,
      testCase.expectedTimeseriesRequests,
      testCase.label,
    );
  }
});

test("successful upstream pull with no sparse rows completes after one scan", async () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({
    historicalPullState: { resource: "caffeine", status: "success" },
    providerState: {
      resourceAvailability: { caffeine: true },
      status: "connected",
    },
    requests,
    summaryBackfillDays: 2,
    timeseriesResources: ["caffeine"],
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { caffeine: true },
  )];
  const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);
  const completed = await executeImmediateResourceContinuations({
    context: createJobContext(),
    job: toJobRecord(findResourceJob(scheduled.jobs, "caffeine"), 1),
    provider,
    resource: "caffeine",
  });

  assert.equal(completed.executionCount, 2);
  assert.equal(requests.length, 2);
  assertHistoryCoverage(completed.result.metadataPatch, "omron", "caffeine");
});

test("unavailable upstream status cannot certify zero-row sparse history", async () => {
  const requests: TimeseriesRequest[] = [];
  const historicalPullRequestFailure = { active: true, status: 503 };
  const provider = createProvider({
    historicalPullRequestFailure,
    providerState: {
      resourceAvailability: { caffeine: true },
      status: "connected",
    },
    requests,
    summaryBackfillDays: 2,
    timeseriesResources: ["caffeine"],
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { caffeine: true },
  )];
  const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);
  const first = await executeImmediateResourceContinuations({
    context: createJobContext(),
    job: toJobRecord(findResourceJob(scheduled.jobs, "caffeine"), 1),
    provider,
    resource: "caffeine",
  });
  const retry = findResourceJob(first.result.scheduledJobs ?? [], "caffeine");

  assert.equal(first.executionCount, 2);
  assert.equal(requests.length, 2);
  assertHistoryCoverage(first.result.metadataPatch, "omron", "caffeine", false);
  assert.equal(retry.availableAt, "2026-06-12T12:00:00.000Z");
  assert.equal(retry.payload?.historicalPullReady, undefined);

  historicalPullRequestFailure.active = false;
  const second = await executeImmediateResourceContinuations({
    context: createJobContext({ now: "2026-06-12T12:00:00.000Z" }),
    job: toJobRecord(retry, 2),
    provider,
    resource: "caffeine",
  });

  assert.equal(requests.length, 4);
  assertHistoryCoverage(second.result.metadataPatch, "omron", "caffeine", false);
  assert.equal(
    findResourceJob(second.result.scheduledJobs ?? [], "caffeine").availableAt,
    "2026-06-13T12:00:00.000Z",
  );
});

test("explicit historical-pull failure stays uncovered without timeseries egress", async () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({
    historicalPullState: { resource: "caffeine", status: "failure" },
    providerState: {
      resourceAvailability: { caffeine: true },
      status: "connected",
    },
    requests,
    summaryBackfillDays: 2,
    timeseriesResources: ["caffeine"],
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { caffeine: true },
  )];
  const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(findResourceJob(scheduled.jobs, "caffeine"), 1),
  );

  assert.equal(requests.length, 0);
  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(result.metadataPatch, "omron", "caffeine", false);
  assert.equal(
    createScheduledJobs(createStoredAccount({ sources }), "2026-06-11T13:00:00.000Z")
      .jobs.some((job) => job.payload?.resource === "caffeine"),
    true,
  );
});

test("explicitly not-pulled sparse history closes without provider egress", async () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({
    historicalPullState: { notPulled: true, resource: "caffeine" },
    providerState: {
      resourceAvailability: { caffeine: true },
      status: "connected",
    },
    requests,
    summaryBackfillDays: 2,
    timeseriesResources: ["caffeine"],
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { caffeine: true },
  )];
  const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(findResourceJob(scheduled.jobs, "caffeine"), 1),
  );

  assert.equal(requests.length, 0);
  assertHistoryCoverage(result.metadataPatch, "omron", "caffeine");
});

test("a persistently malformed sparse day exhausts only its bounded day retry", async () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({
    historicalPullState: { resource: "caffeine", status: "success" },
    providerState: {
      resourceAvailability: { caffeine: true },
      status: "connected",
    },
    requests,
    summaryBackfillDays: 1,
    timeseriesRecords: {
      caffeine: [{
        end: "2026-06-10T08:05:00.000Z",
        start: "2026-06-10T08:00:00.000Z",
        unit: "g",
      }, {
        end: "2026-06-10T14:05:00.000Z",
        start: "2026-06-10T14:00:00.000Z",
        unit: "g",
        value: 0.08,
      }],
    },
    timeseriesResources: ["caffeine"],
  });
  const executor = requireValue(provider.jobExecutor);
  const createScheduledJobs = requireValue(executor.createScheduledJobs);
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { caffeine: true },
  )];
  const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);
  let job = toJobRecord(findResourceJob(scheduled.jobs, "caffeine"), 1);
  let now = NOW;
  let finalResult: ProviderJobResult | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await executor.executeJob(createJobContext({ now }), job);
    const retry = result.scheduledJobs?.find((candidate) =>
      candidate.kind === "resource"
      && candidate.payload?.resource === "caffeine"
      && candidate.payload.calendarRefreshDay === undefined
    );
    if (!retry) {
      finalResult = result;
      break;
    }
    now = requireValue(retry.availableAt);
    job = toJobRecord(retry, attempt + 2);
  }

  assert.equal(requests.length, 5);
  assertHistoryCoverage(
    requireValue(finalResult).metadataPatch,
    "omron",
    "caffeine",
  );
});

test("not_pulled skips frozen history but catches a queued migration up to current reconcile", async () => {
  const tempDir = await makeTempDirectory("murph-junction-sparse-history-catch-up");
  const store = new SqliteDeviceSyncStore(path.join(tempDir, "state.sqlite"));
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({
    historicalPullState: { notPulled: true, resource: "caffeine" },
    providerState: {
      resourceAvailability: { caffeine: true },
      status: "connected",
    },
    requests,
    summaryBackfillDays: 2,
    timeseriesResources: ["caffeine"],
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "omron",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { caffeine: true },
  )];
  const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);
  const delayedNow = "2026-07-11T12:00:00.000Z";

  try {
    const storedAccount = store.upsertAccount({
      connectedAt: NOW,
      credential: {
        credentialMetadata: {},
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      displayName: "Junction",
      externalAccountId: "junction-user-1",
      provider: "junction",
      scopes: [],
      status: "active",
    });
    const originalInput = findResourceJob(scheduled.jobs, "caffeine");
    const original = store.enqueueJob({
      ...originalInput,
      accountId: storedAccount.id,
      provider: "junction",
    });
    const current = createScheduledJobs(createStoredAccount({ sources }), delayedNow);
    const duplicateInput = findResourceJob(current.jobs, "caffeine");
    const duplicate = store.enqueueJob({
      ...duplicateInput,
      accountId: storedAccount.id,
      provider: "junction",
    });
    const reconcileInput = requireValue(current.jobs.find((job) => job.kind === "reconcile"));
    const reconcile = store.enqueueJob({
      ...reconcileInput,
      accountId: storedAccount.id,
      provider: "junction",
    });

    assert.equal(duplicate.id, original.id);
    assert.equal(duplicate.payload.windowEnd, "2026-06-11T00:00:00.000Z");
    assert.equal(reconcile.payload.windowStart, "2026-07-04T00:00:00.000Z");

    const claimedReconcile = requireValue(
      store.claimDueJob("worker-reconcile", delayedNow, 60_000),
    );
    assert.equal(claimedReconcile.id, reconcile.id);
    assert.equal(
      store.completeJobIfOwned(claimedReconcile.id, "worker-reconcile", delayedNow),
      true,
    );
    const claimedMigration = requireValue(
      store.claimDueJob("worker-migration", delayedNow, 60_000),
    );
    assert.equal(claimedMigration.id, original.id);

    const context = createJobContext({
      account: createAccount({ now: delayedNow, sources }),
      now: delayedNow,
    });
    const firstResult = await requireValue(provider.jobExecutor).executeJob(
      context,
      claimedMigration,
    );

    assertHistoryCoverage(firstResult.metadataPatch, "omron", "caffeine", false);
    const catchUp = findResourceJob(
      firstResult.scheduledJobs ?? [],
      "caffeine",
    );
    assert.equal(requests.length, 0);
    assert.equal(catchUp.payload?.windowStart, "2026-06-11T00:00:00.000Z");
    assert.equal(catchUp.payload?.windowEnd, "2026-07-04T00:00:00.000Z");

    const completed = await executeImmediateResourceContinuations({
      context: createJobContext({
        account: createAccount({ now: "2026-07-22T12:00:00.000Z", sources }),
        now: "2026-07-22T12:00:00.000Z",
      }),
      job: toJobRecord(catchUp, 2),
      provider,
      resource: "caffeine",
      startingIndex: 3,
    });

    assert.equal(completed.executionCount, 34);
    assert.equal(requests.length, 34);
    assert.equal(requests[0]?.start, "2026-06-11");
    assert.equal(requests.at(-1)?.end, "2026-07-14");
    assert.equal(
      completed.results.slice(0, -1).some((result) =>
        hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
          result.metadataPatch ?? {},
          "omron",
          "caffeine",
          1,
        )
      ),
      false,
    );
    assertHistoryCoverage(completed.result.metadataPatch, "omron", "caffeine");
  } finally {
    store.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("in-flight unversioned note history cannot certify v2 coverage after upgrade", async () => {
  const provider = createProvider({
    additionalProviders: [{
      resourceAvailability: { note: true },
      slug: "oura",
    }],
    includeNote: true,
    requests: [],
  });
  const executor = requireValue(provider.jobExecutor);
  const legacyJob = toJobRecord({
    kind: "resource",
    payload: {
      historicalBackfill: true,
      historicalWindowStart: "2026-06-09T00:00:00.000Z",
      resource: "note",
      resourceCategory: "timeseries",
      sourceProviderSlug: "oura",
      windowEnd: "2026-06-11T00:00:00.000Z",
      windowStart: "2026-06-09T00:00:00.000Z",
    },
  }, 1);

  const firstResult = await executor.executeJob(createJobContext(), legacyJob);
  const legacyContinuation = requireValue(firstResult.scheduledJobs?.find((job) =>
    job.kind === "resource" && job.payload?.resource === "note"
  ));
  assert.equal(Object.hasOwn(legacyContinuation.payload ?? {}, "historicalBackfillVersion"), false);

  const completedLegacy = await executor.executeJob(
    createJobContext(),
    toJobRecord(legacyContinuation, 2),
  );
  assertHistoryCoverage(completedLegacy.metadataPatch, "oura", "note", false);

  const sources = [createSourceSummary(
    "oura",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { note: true },
  )];
  const scheduledV2 = requireValue(executor.createScheduledJobs)(
    createStoredAccount({ metadata: completedLegacy.metadataPatch, sources }),
    NOW,
  ).jobs.find((job) => job.kind === "resource" && job.payload?.resource === "note");
  assert.equal(scheduledV2?.payload?.historicalBackfillVersion, 2);

  const lateLegacyCompletion = await executor.executeJob(
    createJobContext({
      account: createAccount({ metadata: { [NOTE_HISTORY_COVERAGE_KEY]: "v2|oura" } }),
    }),
    toJobRecord({
      ...legacyContinuation,
      payload: {
        ...legacyContinuation.payload,
        windowStart: "2026-06-10T00:00:00.000Z",
      },
    }, 3),
  );
  assert.equal(
    Object.hasOwn(lateLegacyCompletion.metadataPatch ?? {}, NOTE_HISTORY_COVERAGE_KEY),
    false,
  );

  const futureJob = toJobRecord({
    ...legacyContinuation,
    payload: {
      ...legacyContinuation.payload,
      historicalBackfillVersion: 3,
      windowStart: "2026-06-10T00:00:00.000Z",
    },
  }, 4);
  const futureResult = await executor.executeJob(createJobContext(), futureJob);
  assert.equal(Object.hasOwn(futureResult.metadataPatch ?? {}, NOTE_HISTORY_COVERAGE_KEY), false);
});

test("empty Oura note history reaches terminal source coverage", async () => {
  const provider = createProvider({
    additionalProviders: [{
      resourceAvailability: { note: true },
      slug: "oura",
    }],
    includeNote: true,
    requests: [],
    summaryBackfillDays: 180,
  });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const sources = [createSourceSummary(
    "oura",
    "2026-01-01T12:00:00.000Z",
    "connected",
    { note: true },
  )];
  const scheduled = createScheduledJobs(createStoredAccount({ sources }), NOW);
  const note = requireValue(scheduled.jobs.find((job) =>
    job.kind === "resource" && job.payload?.resource === "note"
  ));

  const { result } = await executeImmediateResourceContinuations({
    context: createJobContext(),
    job: toJobRecord(note, 1),
    provider,
    resource: "note",
  });

  assertHistoryCoverage(result.metadataPatch, "oura", "note");
  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  const completed = createScheduledJobs(
    createStoredAccount({ metadata: result.metadataPatch, sources }),
    "2026-06-12T12:00:00.000Z",
  );
  assert.equal(
    completed.jobs.some((job) => job.kind === "resource" && job.payload?.resource === "note"),
    false,
  );
});

test("a Link reconnect cannot narrow or certify an older persisted-source window", async () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({
    bloodPressureRecords: [{
      id: "bp-before-reconnect",
      timestamp: "2026-03-01T08:30:00.000Z",
      systolic: 122,
      diastolic: 80,
    }],
    requests,
  });
  const callbackAt = "2026-06-12T00:05:00.000Z";
  const persistedFirstSeenAt = "2026-03-20T23:55:00.000Z";
  const connection = await createSourceConnection(provider, callbackAt, "omron");

  assert.deepEqual(connection.initialJobs?.map((job) => job.kind), [
    "backfill",
    "reconcile",
  ]);
  assert.equal(
    connection.initialJobs?.some((job) =>
      job.kind === "resource" && job.payload?.resource === "blood_pressure"
    ),
    false,
  );

  const schedulerJob = createScheduledBloodPressureJob(provider, {
    firstSeenAt: persistedFirstSeenAt,
    now: callbackAt,
  });
  assert.equal(schedulerJob.availableAt, callbackAt);
  assert.deepEqual(schedulerJob.payload, {
    historicalBackfill: true,
    historicalWindowStart: "2026-02-18T00:00:00.000Z",
    resource: "blood_pressure",
    resourceCategory: "timeseries",
    sourceProviderSlug: "omron",
    windowEnd: "2026-03-20T00:00:00.000Z",
    windowStart: "2026-02-18T00:00:00.000Z",
  });
  assert.equal(
    createScheduledBloodPressureJob(provider, {
      firstSeenAt: persistedFirstSeenAt,
      now: "2026-06-13T00:05:00.000Z",
    }).dedupeKey,
    schedulerJob.dedupeKey,
  );

  const { result: completed } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ now: callbackAt }),
    job: toJobRecord(schedulerJob, 1),
    provider,
  });
  assertHistoryCoverage(completed.metadataPatch, "omron", "blood_pressure");
  assert.equal(requests[0]?.start, "2026-02-18T00:00:00.000Z");
  assert.equal(requests.at(-1)?.end, "2026-03-20T00:00:00.000Z");

  const afterCoverage = requireValue(provider.jobExecutor).createScheduledJobs?.(
    createStoredAccount({
      metadata: completed.metadataPatch,
      sources: [createSourceSummary("omron", persistedFirstSeenAt)],
    }),
    "2026-06-13T00:05:00.000Z",
  );
  assert.equal(
    requireValue(afterCoverage).jobs.some((job) =>
      job.kind === "resource" && job.payload?.resource === "blood_pressure"
    ),
    false,
  );
});

test("completed source coverage does not certify a sibling source", () => {
  const provider = createProvider({ requests: [] });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const scheduled = createScheduledJobs(
    createStoredAccount({
      metadata: { [BP_HISTORY_COVERAGE_KEY]: "v1|omron" },
      sources: [
        createSourceSummary("omron", "2026-05-01T10:00:00.000Z"),
        createSourceSummary("withings", "2026-06-01T10:00:00.000Z"),
      ],
    }),
    NOW,
  );
  const bloodPressureJobs = scheduled.jobs.filter((job) =>
    job.kind === "resource" && job.payload?.resource === "blood_pressure"
  );

  assert.equal(bloodPressureJobs.length, 1);
  assert.equal(bloodPressureJobs[0]?.payload?.sourceProviderSlug, "withings");
  assert.equal(bloodPressureJobs[0]?.payload?.historicalWindowStart, "2026-05-02T00:00:00.000Z");
  assert.equal(bloodPressureJobs[0]?.payload?.windowEnd, "2026-06-01T00:00:00.000Z");
});

test("the scheduler waits for persisted blood-pressure capability", () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({ requests });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const firstSeenAt = "2026-03-20T23:55:00.000Z";
  const unavailableSummaries: readonly Record<
    string,
    string | number | boolean | null
  >[] = [
    { activity: true },
    {},
    { blood_pressure: false },
  ];

  for (const resourceAvailabilitySummary of unavailableSummaries) {
    const scheduled = createScheduledJobs(
      createStoredAccount({
        sources: [createSourceSummary(
          "omron",
          firstSeenAt,
          "connected",
          resourceAvailabilitySummary,
        )],
      }),
      NOW,
    );

    assert.equal(
      scheduled.jobs.some((job) =>
        job.kind === "resource" && job.payload?.resource === "blood_pressure"
      ),
      false,
    );
  }
  assert.equal(requests.length, 0);

  const advertised = createScheduledJobs(
    createStoredAccount({
      sources: [createSourceSummary("omron", firstSeenAt)],
    }),
    NOW,
  );
  const bloodPressureJobs = advertised.jobs.filter((job) =>
    job.kind === "resource" && job.payload?.resource === "blood_pressure"
  );

  assert.equal(bloodPressureJobs.length, 1);
  assert.equal(bloodPressureJobs[0]?.payload?.sourceProviderSlug, "omron");
  assert.equal(
    bloodPressureJobs[0]?.payload?.historicalWindowStart,
    "2026-02-18T00:00:00.000Z",
  );
});

test("live blood-pressure capability gates provider egress and terminal coverage", async () => {
  const unavailableStates: readonly MutableProviderState[] = [
    {
      resourceAvailability: { activity: true, blood_pressure: false },
      status: "connected",
    },
    {
      resourceAvailability: { activity: true },
      status: "connected",
    },
    {
      resourceAvailability: { activity: true, blood_pressure: true },
      status: "disconnected",
    },
    {
      resourceAvailability: { activity: true, blood_pressure: true },
      status: "error",
    },
    {
      expectedProjectedStatus: "unavailable",
      resourceAvailability: { activity: true, blood_pressure: true },
      status: "provider_state_added_later",
    },
    {
      present: false,
      resourceAvailability: {},
      status: "connected",
    },
  ];

  for (const providerState of unavailableStates) {
    const requests: TimeseriesRequest[] = [];
    const projectedSources: Array<{
      resourceAvailabilitySummary: Record<string, string | number | boolean | null>;
      status: string;
    }> = [];
    const provider = createProvider({ providerState, requests });
    const admitted = createScheduledBloodPressureJob(provider, {
      firstSeenAt: "2026-03-20T23:55:00.000Z",
    });

    const exhaustedJob = (
      providerState.status === "error"
      || providerState.status === "provider_state_added_later"
    )
      ? {
          ...admitted,
          payload: {
            ...admitted.payload,
            emptyBackfillAttempts: 4,
          },
        }
      : admitted;
    const result = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({ projectedSources }),
      toJobRecord(exhaustedJob, 1),
    );

    assert.deepEqual(
      projectedSources,
      providerState.present === false
        ? []
        : [{
            resourceAvailabilitySummary: providerState.resourceAvailability,
            status: providerState.expectedProjectedStatus ?? providerState.status,
          }],
    );
    assert.equal(
      requests.some((request) => request.resource === "blood_pressure"),
      false,
    );
    assert.equal(result.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
    assert.equal(result.scheduledJobs?.length ?? 0, 0);
  }

  const records: Record<string, unknown>[] = [];
  const recoveredState: MutableProviderState = {
    resourceAvailability: { activity: true, blood_pressure: false },
    status: "connected",
  };
  const recoveredRequests: TimeseriesRequest[] = [];
  const recoveredProvider = createProvider({
    bloodPressureRecords: records,
    providerState: recoveredState,
    requests: recoveredRequests,
  });
  const original = createScheduledBloodPressureJob(recoveredProvider, {
    firstSeenAt: "2026-03-20T23:55:00.000Z",
  });
  const unavailable = await requireValue(recoveredProvider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(original, 1),
  );
  assert.equal(unavailable.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);

  recoveredState.resourceAvailability = {
    activity: true,
    blood_pressure: true,
  };
  records.push({
    id: "bp-after-capability-recovery",
    timestamp: "2026-03-15T08:30:00.000Z",
    systolic: 121,
    diastolic: 79,
  });
  const recreated = createScheduledBloodPressureJob(recoveredProvider, {
    firstSeenAt: "2026-03-20T23:55:00.000Z",
    now: "2026-06-12T12:00:00.000Z",
  });

  assert.equal(recreated.dedupeKey, original.dedupeKey);
  assert.equal(recreated.payload?.windowStart, original.payload?.windowStart);
  const { result: completed } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ now: "2026-06-12T12:00:00.000Z" }),
    job: toJobRecord(recreated, 2),
    provider: recoveredProvider,
  });
  assertHistoryCoverage(completed.metadataPatch, "omron", "blood_pressure");
  assert.equal(
    recoveredRequests.some((request) => request.resource === "blood_pressure"),
    true,
  );
});

test("live capability loss preserves carried history evidence until authority recovers", async () => {
  const unavailableStates: MutableProviderState[] = [
    {
      resourceAvailability: { activity: true, blood_pressure: false },
      status: "connected",
    },
    {
      resourceAvailability: { activity: true },
      status: "connected",
    },
    {
      resourceAvailability: { activity: true, blood_pressure: true },
      status: "disconnected",
    },
    {
      present: false,
      resourceAvailability: {},
      status: "connected",
    },
  ];

  for (const [index, providerState] of unavailableStates.entries()) {
    const records: Record<string, unknown>[] = [];
    const requests: TimeseriesRequest[] = [];
    const projectedSources: Array<{
      resourceAvailabilitySummary: Record<string, string | number | boolean | null>;
      status: string;
    }> = [];
    const provider = createProvider({
      bloodPressureRecords: records,
      providerState,
      requests,
    });
    const original = createScheduledBloodPressureJob(provider, {
      firstSeenAt: "2026-03-20T23:55:00.000Z",
    });
    const evidenceBearing = toJobRecord({
      ...original,
      payload: {
        ...original.payload,
        emptyBackfillAttempts: 4,
        historicalProviderRecordsSeen: true,
      },
    }, index + 1);
    evidenceBearing.dedupeKey = `hosted-device-sync:${String(index + 1).repeat(64)}`;

    const unavailable = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({ projectedSources }),
      evidenceBearing,
    );
    const continuation = findBloodPressureJob(unavailable.scheduledJobs ?? []);

    assert.deepEqual(
      projectedSources,
      providerState.present === false
        ? []
        : [{
            resourceAvailabilitySummary: providerState.resourceAvailability,
            status: providerState.status,
          }],
    );
    assert.equal(requests.length, 0);
    assert.equal(unavailable.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
    assert.equal(continuation.availableAt, "2026-06-12T12:00:00.000Z");
    assert.equal(continuation.dedupeKey, evidenceBearing.dedupeKey);
    assert.equal(continuation.payload?.emptyBackfillAttempts, 4);
    assert.equal(continuation.payload?.historicalProviderRecordsSeen, true);
    assert.equal(
      continuation.payload?.historicalWindowStart,
      original.payload?.historicalWindowStart,
    );
    assert.equal(continuation.payload?.windowStart, original.payload?.windowStart);
    assert.equal(continuation.payload?.windowEnd, original.payload?.windowEnd);

    providerState.present = true;
    providerState.status = "connected";
    providerState.resourceAvailability = {
      activity: true,
      blood_pressure: true,
    };
    const empty = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({ now: "2026-06-12T12:00:00.000Z" }),
      toJobRecord(continuation, index + 10),
    );
    const stillRecoverable = findBloodPressureJob(empty.scheduledJobs ?? []);

    assert.equal(empty.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
    assert.equal(stillRecoverable.dedupeKey, evidenceBearing.dedupeKey);
    assert.equal(stillRecoverable.payload?.historicalProviderRecordsSeen, true);
    assert.equal(stillRecoverable.payload?.windowStart, "2026-02-19T00:00:00.000Z");

    records.push({
      id: `bp-after-live-authority-recovery-${index}`,
      timestamp: "2026-03-15T08:30:00.000Z",
      systolic: 121,
      diastolic: 79,
    });
    const { result: completed } = await executeImmediateBloodPressureContinuations({
      context: createJobContext({ now: "2026-06-13T12:00:00.000Z" }),
      job: toJobRecord(stillRecoverable, index + 20),
      provider,
    });
    assert.equal(completed.scheduledJobs?.length ?? 0, 1);
    assert.equal(completed.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  }

  const canonicalState: MutableProviderState = {
    resourceAvailability: { activity: true, blood_pressure: false },
    status: "connected",
  };
  const canonicalProvider = createProvider({
    providerState: canonicalState,
    requests: [],
  });
  const canonicalOriginal = createScheduledBloodPressureJob(canonicalProvider);
  const canonicalEvidence = toJobRecord({
    ...canonicalOriginal,
    payload: {
      ...canonicalOriginal.payload,
      emptyBackfillAttempts: 4,
      historicalRecordsSeen: true,
    },
  }, 30);
  const canonicalUnavailable = await requireValue(canonicalProvider.jobExecutor).executeJob(
    createJobContext(),
    canonicalEvidence,
  );
  const canonicalContinuation = findBloodPressureJob(
    canonicalUnavailable.scheduledJobs ?? [],
  );

  assert.equal(canonicalUnavailable.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(canonicalContinuation.payload?.historicalRecordsSeen, true);
  assert.equal(
    canonicalContinuation.payload?.historicalWindowStart,
    canonicalOriginal.payload?.historicalWindowStart,
  );
});

test("existing source obligations keep independent windows and queue identities", () => {
  const provider = createProvider({ requests: [] });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const scheduled = createScheduledJobs(
    createStoredAccount({
      sources: [
        createSourceSummary("omron", "2026-05-01T10:00:00.000Z"),
        createSourceSummary("withings", "2026-06-01T10:00:00.000Z"),
      ],
    }),
    NOW,
  );
  const bloodPressureJobs = scheduled.jobs
    .filter((job) => job.kind === "resource" && job.payload?.resource === "blood_pressure")
    .sort((left, right) => String(left.payload?.sourceProviderSlug).localeCompare(
      String(right.payload?.sourceProviderSlug),
    ));

  assert.equal(bloodPressureJobs.length, 2);
  assert.deepEqual(
    bloodPressureJobs.map((job) => [
      job.payload?.sourceProviderSlug,
      job.payload?.historicalWindowStart,
      job.payload?.windowEnd,
    ]),
    [
      ["omron", "2026-04-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z"],
      ["withings", "2026-05-02T00:00:00.000Z", "2026-06-01T00:00:00.000Z"],
    ],
  );
  assert.notEqual(bloodPressureJobs[0]?.dedupeKey, bloodPressureJobs[1]?.dedupeKey);
});

test("an older runtime does not reinterpret newer source-coverage semantics", () => {
  const provider = createProvider({ requests: [] });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const scheduled = createScheduledJobs(
    createStoredAccount({
      metadata: { [BP_HISTORY_COVERAGE_KEY]: "v2|withings" },
      sources: [createSourceSummary("omron")],
    }),
    NOW,
  );

  assert.equal(
    scheduled.jobs.some((job) =>
      job.kind === "resource" && job.payload?.resource === "blood_pressure"
    ),
    false,
  );
});

test("a fetched blood-pressure record completes without an empty retry", async () => {
  const provider = createProvider({
    bloodPressureRecords: [{
      id: "bp-1",
      timestamp: "2026-05-20T08:30:00.000Z",
      systolic: 121,
      diastolic: 79,
    }],
    requests: [],
  });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const { result } = await executeImmediateBloodPressureContinuations({
    context: createJobContext(),
    job: toJobRecord(bloodPressure, 1),
    provider,
  });

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(result.metadataPatch, "omron", "blood_pressure");
});

test("partial optional failure retries the uncompleted segment after importing canonical events", async () => {
  const importedSnapshots: unknown[] = [];
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({
    bloodPressureFailureRequest: 2,
    bloodPressureRecords: [{
      id: "bp-before-partial-failure",
      timestamp: "2026-05-12T08:30:00.000Z",
      systolic: 119,
      diastolic: 77,
    }],
    requests,
  });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const admittedBloodPressure = toJobRecord(bloodPressure, 1);
  admittedBloodPressure.dedupeKey = `hosted-device-sync:${"d".repeat(64)}`;

  const { result: partial } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ importedSnapshots }),
    job: admittedBloodPressure,
    provider,
  });
  const retry = findBloodPressureJob(partial.scheduledJobs ?? []);

  assert.equal(importedSnapshots.length, 1);
  assert.equal(JSON.stringify(importedSnapshots).includes("bp-before-partial-failure"), true);
  assert.equal(partial.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(retry.dedupeKey, admittedBloodPressure.dedupeKey);
  assert.equal(retry.payload?.historicalRecordsSeen, true);
  assert.equal(retry.payload?.historicalWindowStart, "2026-05-12T00:00:00.000Z");
  assert.equal(retry.payload?.windowStart, "2026-05-13T00:00:00.000Z");

  const { result: completed } = await executeImmediateBloodPressureContinuations({
    context: createJobContext(),
    job: toJobRecord(retry, 2),
    provider,
  });
  assert.equal(completed.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(completed.metadataPatch, "omron", "blood_pressure");
  assert.equal(
    requests.filter((request) => request.resource === "blood_pressure").length,
    31,
  );
});

test("retryable provider failure after raw rows preserves evidence through later empty scans", async () => {
  const bloodPressureRecords: Record<string, unknown>[] = [{
    id: "bp-malformed-before-retryable-failure",
    timestamp: "2026-05-12T08:30:00.000Z",
    systolic: 119,
  }];
  const requestFailure = {
    active: true,
    fromRequest: 2,
    status: 500,
  };
  const providerListRequestFailure = {
    active: false,
    status: 500,
  };
  const providerListRequests = { count: 0 };
  const provider = createProvider({
    bloodPressureRecords,
    bloodPressureRequestFailure: requestFailure,
    providerListRequestFailure,
    providerListRequests,
    requests: [],
  });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const exhausted = toJobRecord({
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
    },
  }, 1);
  exhausted.dedupeKey = `hosted-device-sync:${"6".repeat(64)}`;

  const { result: partial } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ canonicalEventCount: 0 }),
    job: exhausted,
    provider,
  });
  const retained = findBloodPressureJob(partial.scheduledJobs ?? []);

  assert.equal(partial.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(retained.availableAt, "2026-06-12T12:00:00.000Z");
  assert.equal(retained.dedupeKey, exhausted.dedupeKey);
  assert.equal(retained.payload?.emptyBackfillAttempts, 4);
  assert.equal(retained.payload?.historicalProviderRecordsSeen, true);
  assert.equal(retained.payload?.historicalRecordsSeen, undefined);

  requestFailure.active = false;
  providerListRequestFailure.active = true;
  const providerListRequestsBeforeOutage = providerListRequests.count;
  let retainedAcrossOutage = retained;
  for (let outageDay = 1; outageDay <= 5; outageDay += 1) {
    const outageNow = new Date(
      Date.parse(NOW) + outageDay * 24 * 60 * 60_000,
    ).toISOString();
    const outage = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({ now: outageNow }),
      toJobRecord(retainedAcrossOutage, outageDay + 1),
    );
    retainedAcrossOutage = findBloodPressureJob(outage.scheduledJobs ?? []);

    assert.equal(outage.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
    assert.equal(retainedAcrossOutage.dedupeKey, exhausted.dedupeKey);
    assert.equal(retainedAcrossOutage.payload?.emptyBackfillAttempts, 4);
    assert.equal(
      retainedAcrossOutage.payload?.historicalProviderRecordsSeen,
      true,
    );
  }

  assert.equal(
    providerListRequests.count - providerListRequestsBeforeOutage,
    15,
  );
  providerListRequestFailure.active = false;
  bloodPressureRecords.length = 0;
  const { result: empty } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ now: "2026-06-17T12:00:00.000Z" }),
    job: toJobRecord(retainedAcrossOutage, 7),
    provider,
  });
  const stillRecoverable = findBloodPressureJob(empty.scheduledJobs ?? []);

  assert.equal(empty.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(stillRecoverable.availableAt, "2026-06-18T12:00:00.000Z");
  assert.equal(stillRecoverable.dedupeKey, exhausted.dedupeKey);
  assert.equal(stillRecoverable.payload?.historicalProviderRecordsSeen, true);

  bloodPressureRecords.push({
    id: "bp-malformed-before-retryable-failure",
    timestamp: "2026-05-12T08:30:00.000Z",
    systolic: 121,
    diastolic: 79,
  });
  const { result: recovered } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ now: "2026-06-18T12:00:00.000Z" }),
    job: toJobRecord(stillRecoverable, 8),
    provider,
  });

  assert.equal(recovered.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(recovered.metadataPatch, "omron", "blood_pressure");
});

test("retryable post-fetch failures preserve raw evidence and replay the anchored window", async () => {
  for (const boundary of ["source-state", "canonical-import"] as const) {
    const records: Record<string, unknown>[] = [{
      id: `bp-before-${boundary}-failure`,
      timestamp: "2026-05-12T08:30:00.000Z",
      systolic: 119,
    }];
    const requests: TimeseriesRequest[] = [];
    const provider = createProvider({
      bloodPressureRecords: records,
      requests,
    });
    const original = createScheduledBloodPressureJob(provider);
    const exhausted = toJobRecord({
      ...original,
      payload: {
        ...original.payload,
        emptyBackfillAttempts: 4,
      },
    }, boundary === "source-state" ? 40 : 41);
    exhausted.dedupeKey = `hosted-device-sync:${boundary === "source-state" ? "4".repeat(64) : "5".repeat(64)}`;
    const failure = deviceSyncError({
      code: boundary === "source-state"
        ? "HOSTED_DEVICE_SYNC_SOURCE_STATE_UNAVAILABLE"
        : "HOSTED_DEVICE_SYNC_ARTIFACT_WRITE_FAILED",
      httpStatus: 503,
      message: `Temporary hosted device-sync ${boundary} failure.`,
      retryable: true,
    });
    let sourceStateReads = 0;
    const failed = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({
        ...(boundary === "source-state"
          ? {
              listConnectionSources: async () => {
                sourceStateReads += 1;
                if (sourceStateReads <= 2) {
                  return [];
                }
                throw failure;
              },
            }
          : {
              importSnapshot: async () => {
                throw failure;
              },
            }),
      }),
      exhausted,
    );
    const retry = findBloodPressureJob(failed.scheduledJobs ?? []);

    assert.equal(
      requests.filter((request) => request.resource === "blood_pressure").length,
      1,
    );
    assert.equal(failed.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
    assert.equal(retry.availableAt, "2026-06-12T12:00:00.000Z");
    assert.equal(retry.dedupeKey, exhausted.dedupeKey);
    assert.equal(retry.payload?.emptyBackfillAttempts, 4);
    assert.equal(retry.payload?.historicalProviderRecordsSeen, true);
    assert.equal(retry.payload?.historicalWindowStart, original.payload?.historicalWindowStart);
    assert.equal(retry.payload?.windowStart, original.payload?.windowStart);
    assert.equal(retry.payload?.windowEnd, original.payload?.windowEnd);

    records.length = 0;
    const { result: empty } = await executeImmediateBloodPressureContinuations({
      context: createJobContext({ now: "2026-06-12T12:00:00.000Z" }),
      job: toJobRecord(retry, 42),
      provider,
    });
    const stillRecoverable = findBloodPressureJob(empty.scheduledJobs ?? []);

    assert.equal(empty.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
    assert.equal(stillRecoverable.dedupeKey, exhausted.dedupeKey);
    assert.equal(stillRecoverable.payload?.historicalProviderRecordsSeen, true);
    assert.equal(stillRecoverable.payload?.windowStart, original.payload?.windowStart);

    records.push({
      id: `bp-before-${boundary}-failure`,
      timestamp: "2026-05-12T08:30:00.000Z",
      systolic: 121,
      diastolic: 79,
    });
    const { result: recovered } = await executeImmediateBloodPressureContinuations({
      context: createJobContext({ now: "2026-06-13T12:00:00.000Z" }),
      job: toJobRecord(stillRecoverable, 43),
      provider,
    });

    assert.equal(recovered.scheduledJobs?.length ?? 0, 0, boundary);
    assertHistoryCoverage(
      recovered.metadataPatch,
      "omron",
      "blood_pressure",
      true,
      boundary,
    );
  }
});

test("an empty successful segment retries when its post-fetch source reread fails", async () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({ bloodPressureRecords: [], requests });
  const original = createScheduledBloodPressureJob(provider);
  const failure = deviceSyncError({
    code: "HOSTED_DEVICE_SYNC_SOURCE_STATE_UNAVAILABLE",
    httpStatus: 503,
    message: "Temporary hosted device-sync source-state failure.",
    retryable: true,
  });
  let sourceStateReads = 0;

  await assert.rejects(
    () => requireValue(provider.jobExecutor).executeJob(
      createJobContext({
        listConnectionSources: async () => {
          sourceStateReads += 1;
          if (sourceStateReads <= 2) {
            return [];
          }
          throw failure;
        },
      }),
      toJobRecord(original, 44),
    ),
    (error: unknown) =>
      isDeviceSyncError(error)
      && error.code === failure.code
      && error.retryable === true,
  );

  assert.equal(sourceStateReads, 3);
  assert.equal(
    requests.filter((request) => request.resource === "blood_pressure").length,
    1,
  );
});

test("nonretryable post-fetch failures keep ordinary failure semantics", async () => {
  for (const boundary of ["source-state", "canonical-import"] as const) {
    const provider = createProvider({
      bloodPressureRecords: [{
        id: `bp-before-nonretryable-${boundary}-failure`,
        timestamp: "2026-05-12T08:30:00.000Z",
        systolic: 121,
        diastolic: 79,
      }],
      requests: [],
    });
    const original = createScheduledBloodPressureJob(provider);
    const failure = deviceSyncError({
      code: boundary === "source-state"
        ? "HOSTED_DEVICE_SYNC_SOURCE_STATE_UNAVAILABLE"
        : "HOSTED_DEVICE_SYNC_ARTIFACT_WRITE_FAILED",
      message: `Permanent hosted device-sync ${boundary} failure.`,
      retryable: false,
    });
    await assert.rejects(
      () => requireValue(provider.jobExecutor).executeJob(
        createJobContext(
          boundary === "source-state"
            ? {
                listConnectionSources: async () => {
                  throw failure;
                },
              }
            : {
                importSnapshot: async () => {
                  throw failure;
                },
              },
        ),
        toJobRecord(original, boundary === "source-state" ? 44 : 45),
      ),
      (error: unknown) =>
        isDeviceSyncError(error)
        && error.code === failure.code
        && error.retryable === false,
    );
  }
});

test("provider failures without prior rows retain their ordinary failure semantics", async () => {
  for (const [boundary, status, retryable] of [
    ["provider-list", 500, true],
    ["provider-list", 401, false],
    ["timeseries", 500, true],
    ["timeseries", 401, false],
  ] as const) {
    const provider = createProvider({
      ...(boundary === "provider-list"
        ? {
            providerListRequestFailure: { active: true, status },
          }
        : {
            bloodPressureRequestFailure: {
              active: true,
              fromRequest: 1,
              status,
            },
          }),
      requests: [],
    });
    const bloodPressure = createScheduledBloodPressureJob(provider);

    await assert.rejects(
      () => requireValue(provider.jobExecutor).executeJob(
        createJobContext(),
        toJobRecord(bloodPressure, status),
      ),
      (error: unknown) =>
        isDeviceSyncError(error)
        && error.code === "JUNCTION_API_REQUEST_FAILED"
        && error.retryable === retryable,
    );
  }
});

test("source history partial failure stays recoverable after the empty retry ladder", async () => {
  const provider = createProvider({
    bloodPressureFailureRequest: 2,
    bloodPressureRecords: [{
      id: "bp-account-before-exhausted-partial-failure",
      timestamp: "2026-05-12T08:30:00.000Z",
      systolic: 116,
      diastolic: 74,
    }],
    requests: [],
  });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const exhausted = toJobRecord({
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
      historicalRecordsSeen: true,
    },
  }, 1);
  exhausted.dedupeKey = `hosted-device-sync:${"f".repeat(64)}`;

  const { result: partial } = await executeImmediateBloodPressureContinuations({
    context: createJobContext(),
    job: exhausted,
    provider,
  });
  const retry = findBloodPressureJob(partial.scheduledJobs ?? []);

  assert.equal(partial.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(retry.availableAt, "2026-06-12T12:00:00.000Z");
  assert.equal(retry.dedupeKey, exhausted.dedupeKey);
  assert.equal(retry.payload?.emptyBackfillAttempts, 4);
  assert.equal(retry.payload?.historicalRecordsSeen, true);
  assert.equal(retry.payload?.windowStart, "2026-05-13T00:00:00.000Z");

  const { result: recovered } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ now: "2026-06-12T12:00:00.000Z" }),
    job: toJobRecord(retry, 2),
    provider,
  });
  assert.equal(recovered.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(recovered.metadataPatch, "omron", "blood_pressure");
});

test("source-scoped partial failure stays recoverable after the empty retry ladder", async () => {
  const provider = createProvider({
    bloodPressureFailureRequest: 2,
    bloodPressureRecords: [{
      id: "bp-source-before-exhausted-partial-failure",
      timestamp: "2026-05-12T08:30:00.000Z",
      systolic: 115,
      diastolic: 73,
    }],
    requests: [],
  });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const exhausted = toJobRecord({
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
      historicalRecordsSeen: true,
      sourceProviderSlug: "omron",
    },
  }, 1);
  exhausted.dedupeKey = `hosted-device-sync:${"9".repeat(64)}`;

  const { result: partial } = await executeImmediateBloodPressureContinuations({
    context: createJobContext(),
    job: exhausted,
    provider,
  });
  const retry = findBloodPressureJob(partial.scheduledJobs ?? []);

  assert.equal(partial.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(retry.availableAt, "2026-06-12T12:00:00.000Z");
  assert.equal(retry.dedupeKey, exhausted.dedupeKey);
  assert.equal(retry.payload?.emptyBackfillAttempts, 4);
  assert.equal(retry.payload?.historicalRecordsSeen, true);
  assert.equal(retry.payload?.sourceProviderSlug, "omron");
  assert.equal(retry.payload?.windowStart, "2026-05-13T00:00:00.000Z");

  const { result: recovered } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ now: "2026-06-12T12:00:00.000Z" }),
    job: toJobRecord(retry, 2),
    provider,
  });
  assert.equal(recovered.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(recovered.metadataPatch, "omron", "blood_pressure");
});

test("raw provider rows without canonical imported events remain on the retry ladder", async () => {
  const provider = createProvider({
    bloodPressureRecords: [{
      id: "bp-not-canonicalized",
      timestamp: "2026-05-20T08:30:00.000Z",
      systolic: 120,
    }],
    requests: [],
  });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const { result } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ canonicalEventCount: 0 }),
    job: toJobRecord(bloodPressure, 1),
    provider,
  });
  const retry = findBloodPressureJob(result.scheduledJobs ?? []);

  assert.equal(result.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(retry.payload?.emptyBackfillAttempts, 1);
  assert.equal(retry.payload?.historicalProviderRecordsSeen, true);
  assert.equal(retry.payload?.historicalRecordsSeen, undefined);
  assert.equal(retry.payload?.historicalWindowStart, "2026-05-12T00:00:00.000Z");
});

test("exhausted malformed provider rows stay recoverable until canonical import succeeds", async () => {
  const bloodPressureRecords: Record<string, unknown>[] = [{
    id: "bp-malformed-at-exhaustion",
    timestamp: "2026-05-20T08:30:00.000Z",
    systolic: 120,
  }];
  const provider = createProvider({ bloodPressureRecords, requests: [] });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const exhausted = toJobRecord({
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
    },
  }, 1);
  exhausted.dedupeKey = `hosted-device-sync:${"7".repeat(64)}`;

  const { result: malformed } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ canonicalEventCount: 0 }),
    job: exhausted,
    provider,
  });
  const retry = findBloodPressureJob(malformed.scheduledJobs ?? []);

  assert.equal(malformed.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(retry.availableAt, "2026-06-12T12:00:00.000Z");
  assert.equal(retry.dedupeKey, exhausted.dedupeKey);
  assert.equal(retry.payload?.emptyBackfillAttempts, 4);
  assert.equal(retry.payload?.historicalProviderRecordsSeen, true);
  assert.equal(retry.payload?.historicalRecordsSeen, undefined);

  bloodPressureRecords[0] = {
    ...bloodPressureRecords[0],
    diastolic: 78,
  };
  const { result: recovered } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ now: "2026-06-12T12:00:00.000Z" }),
    job: toJobRecord(retry, 2),
    provider,
  });

  assert.equal(recovered.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(recovered.metadataPatch, "omron", "blood_pressure");
});

test("mixed canonical and malformed history stays unresolved until a complete repair", async () => {
  const bloodPressureRecords: Record<string, unknown>[] = [
    {
      id: "bp-valid-in-mixed-history",
      timestamp: "2026-05-20T08:30:00.000Z",
      systolic: 121,
      diastolic: 79,
    },
    {
      id: "bp-malformed-in-mixed-history",
      timestamp: "2026-05-21T08:30:00.000Z",
      systolic: 120,
    },
  ];
  const provider = createProvider({ bloodPressureRecords, requests: [] });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const exhausted = toJobRecord({
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
    },
  }, 60);
  exhausted.dedupeKey = `hosted-device-sync:${"a".repeat(64)}`;

  const { result: mixed } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ importSnapshot: importWithRealJunctionNormalizer }),
    job: exhausted,
    provider,
  });
  const mixedContinuation = findBloodPressureJob(mixed.scheduledJobs ?? []);

  assert.equal(mixed.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(mixedContinuation.dedupeKey, exhausted.dedupeKey);
  assert.equal(mixedContinuation.payload?.emptyBackfillAttempts, 4);
  assert.equal(mixedContinuation.payload?.historicalRecordsSeen, true);
  assert.equal(mixedContinuation.payload?.historicalProviderRecordsSeen, true);
  assert.equal(
    mixedContinuation.payload?.historicalUnresolvedProviderRecordCount,
    1,
  );
  assert.equal(
    mixedContinuation.payload?.windowStart,
    "2026-05-12T00:00:00.000Z",
  );

  bloodPressureRecords.length = 0;
  const { result: empty } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      importSnapshot: importWithRealJunctionNormalizer,
      now: "2026-06-12T12:00:00.000Z",
    }),
    job: toJobRecord(mixedContinuation, 61),
    provider,
  });
  const emptyContinuation = findBloodPressureJob(empty.scheduledJobs ?? []);

  assert.equal(empty.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(emptyContinuation.dedupeKey, exhausted.dedupeKey);
  assert.equal(emptyContinuation.payload?.historicalProviderRecordsSeen, true);
  assert.equal(
    emptyContinuation.payload?.historicalUnresolvedProviderRecordCount,
    1,
  );

  bloodPressureRecords.push(
    {
      id: "bp-valid-in-mixed-history",
      timestamp: "2026-05-20T08:30:00.000Z",
      systolic: 121,
      diastolic: 79,
    },
    {
      id: "bp-malformed-in-mixed-history",
      timestamp: "2026-05-21T08:30:00.000Z",
      systolic: 120,
      diastolic: 78,
    },
  );
  const { result: repaired } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      importSnapshot: importWithRealJunctionNormalizer,
      now: "2026-06-13T12:00:00.000Z",
    }),
    job: toJobRecord(emptyContinuation, 62),
    provider,
  });

  assert.equal(repaired.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(repaired.metadataPatch, "omron", "blood_pressure");
});

test("mixed source admission preserves rejected exact identity until authorized replay", async () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({
    additionalProviders: [{ slug: "fitbit" }],
    bloodPressureGroups: {
      fitbit: [{
        id: "bp-fitbit-awaiting-admission",
        timestamp: "2026-05-20T09:00:00.000Z",
        systolic: 119,
        diastolic: 77,
      }],
      omron: [{
        id: "bp-omron-admitted",
        timestamp: "2026-05-20T08:00:00.000Z",
        systolic: 121,
        diastolic: 79,
      }],
    },
    requests,
  });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const exhausted = toJobRecord({
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
    },
  }, 63);
  exhausted.dedupeKey = `hosted-device-sync:${"b".repeat(64)}`;
  const omronSource = createSourceSummary("omron");
  const fitbitSource = createSourceSummary("fitbit", NOW, "disconnected");
  const listConnectionSources = async () => [omronSource, fitbitSource];

  const { result: first } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      account: createAccount({ sources: [omronSource, fitbitSource] }),
      connectionSourceAdmissionMode: "listed_only",
      importSnapshot: importWithRealJunctionNormalizer,
      listConnectionSources,
    }),
    job: exhausted,
    provider,
    startingIndex: 6_300,
  });
  const continuation = findBloodPressureJob(first.scheduledJobs ?? []);
  const unresolvedIdentitiesJson =
    continuation.payload?.historicalUnresolvedProviderRecordIdentitiesJson;
  assert.equal(typeof unresolvedIdentitiesJson, "string");
  if (typeof unresolvedIdentitiesJson !== "string") {
    throw new Error("Expected exact mixed-source unresolved identity evidence.");
  }
  const unresolvedEvidence = JSON.parse(unresolvedIdentitiesJson);
  assert.equal(unresolvedEvidence.i.length, 1);
  assert.equal(unresolvedEvidence.u, undefined);
  assert.equal(
    continuation.payload?.historicalUnresolvedProviderRecordCount,
    1,
  );

  fitbitSource.status = "connected";
  const { result: admittedReplay } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      account: createAccount({ sources: [omronSource, fitbitSource] }),
      connectionSourceAdmissionMode: "listed_only",
      importSnapshot: importWithRealJunctionNormalizer,
      listConnectionSources,
      now: "2026-06-12T12:00:00.000Z",
    }),
    job: toJobRecord(continuation, 64),
    provider,
  });

  assert.equal(admittedReplay.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(admittedReplay.metadataPatch, "omron", "blood_pressure");
});

test("an unrelated canonical reading cannot clear a malformed provider row", async () => {
  const bloodPressureRecords: Record<string, unknown>[] = [
    {
      id: "bp-valid-before-unrelated-repair",
      timestamp: "2026-05-20T08:00:00.000Z",
      systolic: 121,
      diastolic: 79,
    },
    {
      id: "bp-malformed-needing-exact-repair",
      timestamp: "2026-05-20T09:00:00.000Z",
      systolic: 120,
    },
  ];
  const provider = createProvider({ bloodPressureRecords, requests: [] });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const exhausted = toJobRecord({
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
    },
  }, 67);
  exhausted.dedupeKey = `hosted-device-sync:${"d".repeat(64)}`;

  const { result: mixed } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ importSnapshot: importWithRealJunctionNormalizer }),
    job: exhausted,
    provider,
  });
  const unresolved = findBloodPressureJob(mixed.scheduledJobs ?? []);
  const unresolvedIdentities =
    unresolved.payload?.historicalUnresolvedProviderRecordIdentitiesJson;
  assert.equal(typeof unresolvedIdentities, "string");
  assert.equal(unresolved.payload?.historicalUnresolvedProviderRecordCount, 1);

  bloodPressureRecords.splice(0, bloodPressureRecords.length, {
    id: "bp-unrelated-canonical-reading",
    timestamp: "2026-05-20T10:00:00.000Z",
    systolic: 118,
    diastolic: 76,
  });
  const unrelated = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({
      importSnapshot: importWithRealJunctionNormalizer,
      now: "2026-06-12T12:00:00.000Z",
    }),
    toJobRecord(unresolved, 68),
  );
  const stillUnresolved = findBloodPressureJob(unrelated.scheduledJobs ?? []);
  assert.equal(unrelated.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(
    stillUnresolved.payload?.historicalUnresolvedProviderRecordIdentitiesJson,
    unresolvedIdentities,
  );

  bloodPressureRecords.splice(0, bloodPressureRecords.length, {
    id: "bp-malformed-needing-exact-repair",
    timestamp: "2026-05-20T09:00:00.000Z",
    systolic: 120,
    diastolic: 78,
  });
  const { result: repaired } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      importSnapshot: importWithRealJunctionNormalizer,
      now: "2026-06-13T12:00:00.000Z",
    }),
    job: toJobRecord(stillUnresolved, 69),
    provider,
  });
  assert.equal(repaired.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(repaired.metadataPatch, "omron", "blood_pressure");
});

test("every malformed provider identity must be repaired before coverage completes", async () => {
  const bloodPressureRecords: Record<string, unknown>[] = [
    {
      id: "bp-first-malformed-identity",
      timestamp: "2026-05-20T08:00:00.000Z",
      systolic: 121,
    },
    {
      id: "bp-second-malformed-identity",
      timestamp: "2026-05-20T09:00:00.000Z",
      systolic: 119,
    },
  ];
  const provider = createProvider({ bloodPressureRecords, requests: [] });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const { result: malformed } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ importSnapshot: importWithRealJunctionNormalizer }),
    job: toJobRecord({
      ...bloodPressure,
      payload: {
        ...bloodPressure.payload,
        emptyBackfillAttempts: 4,
      },
    }, 70),
    provider,
  });
  const bothUnresolved = findBloodPressureJob(malformed.scheduledJobs ?? []);
  assert.equal(bothUnresolved.payload?.historicalUnresolvedProviderRecordCount, 2);

  bloodPressureRecords[0] = {
    ...bloodPressureRecords[0],
    diastolic: 79,
  };
  const { result: oneRepair } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      importSnapshot: importWithRealJunctionNormalizer,
      now: "2026-06-12T12:00:00.000Z",
    }),
    job: toJobRecord(bothUnresolved, 71),
    provider,
  });
  const oneUnresolved = findBloodPressureJob(oneRepair.scheduledJobs ?? []);
  assert.equal(oneRepair.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(oneUnresolved.payload?.historicalUnresolvedProviderRecordCount, 1);

  bloodPressureRecords[1] = {
    ...bloodPressureRecords[1],
    diastolic: 77,
  };
  const { result: fullyRepaired } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      importSnapshot: importWithRealJunctionNormalizer,
      now: "2026-06-13T12:00:00.000Z",
    }),
    job: toJobRecord(oneUnresolved, 72),
    provider,
  });
  assert.equal(fullyRepaired.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(fullyRepaired.metadataPatch, "omron", "blood_pressure");
});

test("more than 64 stable unresolved identities survive yield and clear exactly after repair", async () => {
  const bloodPressureRecords: Record<string, unknown>[] = Array.from(
    { length: 65 },
    (_, index) => ({
      id: `bp-stable-overflow-${index}`,
      timestamp: new Date(
        Date.parse("2026-05-12T08:00:00.000Z") + index * 1_000,
      ).toISOString(),
      systolic: 110 + (index % 20),
    }),
  );
  const provider = createProvider({ bloodPressureRecords, requests: [] });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const admitted = toJobRecord({
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
    },
  }, 73);
  admitted.dedupeKey = `hosted-device-sync:${"e".repeat(64)}`;
  let yieldChecks = 0;
  const yielded = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({
      importSnapshot: importWithRealJunctionNormalizer,
      shouldYield: () => {
        yieldChecks += 1;
        return yieldChecks > 1;
      },
    }),
    admitted,
  );
  const yieldedContinuation = findBloodPressureJob(yielded.scheduledJobs ?? []);
  const yieldedIdentitiesJson =
    yieldedContinuation.payload?.historicalUnresolvedProviderRecordIdentitiesJson;
  assert.equal(typeof yieldedIdentitiesJson, "string");
  if (typeof yieldedIdentitiesJson !== "string") {
    throw new Error("Expected exact unresolved identity evidence after yield.");
  }
  const yieldedIdentityEvidence = JSON.parse(yieldedIdentitiesJson);
  assert.equal(Array.isArray(yieldedIdentityEvidence.i), true);
  assert.equal(yieldedIdentityEvidence.i.length, 65);
  assert.equal(yieldedIdentityEvidence.u, undefined);
  assert.equal(
    yieldedContinuation.payload?.historicalUnresolvedProviderRecordCount,
    65,
  );

  const { result: reachedWindowEnd } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ importSnapshot: importWithRealJunctionNormalizer }),
    job: toJobRecord(yieldedContinuation, 74),
    provider,
  });
  const anchoredRetry = findBloodPressureJob(reachedWindowEnd.scheduledJobs ?? []);
  assert.equal(anchoredRetry.payload?.historicalUnresolvedProviderRecordCount, 65);
  assert.equal(
    anchoredRetry.payload?.historicalUnresolvedProviderRecordIdentitiesJson,
    yieldedIdentitiesJson,
  );

  for (const record of bloodPressureRecords.slice(0, 64)) {
    record.diastolic = 70;
  }
  const { result: oneStillUnresolved } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      importSnapshot: importWithRealJunctionNormalizer,
      now: "2026-06-12T12:00:00.000Z",
    }),
    job: toJobRecord(anchoredRetry, 75),
    provider,
  });
  const finalRetry = findBloodPressureJob(oneStillUnresolved.scheduledJobs ?? []);
  const finalIdentityJson =
    finalRetry.payload?.historicalUnresolvedProviderRecordIdentitiesJson;
  assert.equal(oneStillUnresolved.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(finalRetry.payload?.historicalUnresolvedProviderRecordCount, 1);
  assert.equal(typeof finalIdentityJson, "string");
  if (typeof finalIdentityJson !== "string") {
    throw new Error("Expected one exact unresolved identity after partial repair.");
  }
  const finalIdentityEvidence = JSON.parse(finalIdentityJson);
  assert.equal(finalIdentityEvidence.i.length, 1);
  assert.equal(finalIdentityEvidence.u, undefined);

  bloodPressureRecords[64] = {
    ...bloodPressureRecords[64],
    diastolic: 70,
  };
  const { result: fullyRepaired } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      importSnapshot: importWithRealJunctionNormalizer,
      now: "2026-06-13T12:00:00.000Z",
    }),
    job: toJobRecord(finalRetry, 76),
    provider,
  });

  assert.equal(fullyRepaired.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(fullyRepaired.metadataPatch, "omron", "blood_pressure");
});

test("legacy and identity-less unresolved evidence cannot be cleared speculatively", async () => {
  const cases = [
    {
      label: "legacy boolean",
      payload: { historicalProviderRecordsSeen: true },
      record: {
        id: "bp-unrelated-to-legacy-evidence",
        timestamp: "2026-05-12T08:30:00.000Z",
        systolic: 121,
        diastolic: 79,
      },
    },
    {
      label: "identity-less row",
      payload: {},
      record: {
        timestamp: "2026-05-12T08:30:00.000Z",
        systolic: 121,
      },
    },
    {
      label: "malformed encoded evidence",
      payload: {
        historicalUnresolvedProviderRecordIdentitiesJson:
          '{"v":1,"i":["not-a-stable-provider-identity"]}',
        historicalUnresolvedProviderRecordCount: 1,
      },
      record: {
        id: "bp-unrelated-to-malformed-evidence",
        timestamp: "2026-05-12T08:30:00.000Z",
        systolic: 121,
        diastolic: 79,
      },
    },
  ] as const;

  for (const [index, testCase] of cases.entries()) {
    const records: Record<string, unknown>[] = [testCase.record];
    const provider = createProvider({ bloodPressureRecords: records, requests: [] });
    const bloodPressure = createScheduledBloodPressureJob(provider);
    const initial = toJobRecord({
      ...bloodPressure,
      payload: {
        ...bloodPressure.payload,
        emptyBackfillAttempts: 4,
        ...testCase.payload,
      },
    }, 73 + index);
    const first = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({ importSnapshot: importWithRealJunctionNormalizer }),
      initial,
    );
    const unresolved = findBloodPressureJob(first.scheduledJobs ?? []);

    if (testCase.label === "identity-less row") {
      records[0] = {
        ...records[0],
        diastolic: 78,
      };
    }
    const second = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({
        importSnapshot: importWithRealJunctionNormalizer,
        now: "2026-06-12T12:00:00.000Z",
      }),
      toJobRecord(unresolved, 75 + index),
    );
    assert.equal(second.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined, testCase.label);
    assert.equal(second.scheduledJobs?.length ?? 0, 1, testCase.label);
  }
});

test("exact provider duplicates do not create false unresolved history", async () => {
  const duplicate = {
    id: "bp-exact-provider-duplicate",
    timestamp: "2026-05-20T08:30:00.000Z",
    systolic: 121,
    diastolic: 79,
  };
  const provider = createProvider({
    bloodPressureRecords: [duplicate, { ...duplicate }],
    requests: [],
  });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const { result } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ importSnapshot: importWithRealJunctionNormalizer }),
    job: toJobRecord(bloodPressure, 63),
    provider,
  });

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(result.metadataPatch, "omron", "blood_pressure");
});

test("a malformed post-yield segment requires one repaired anchored scan", async () => {
  const bloodPressureRecords: Record<string, unknown>[] = [
    {
      id: "bp-valid-before-yield",
      timestamp: "2026-05-12T08:30:00.000Z",
      systolic: 118,
      diastolic: 76,
    },
    {
      id: "bp-malformed-after-yield",
      timestamp: "2026-05-13T08:30:00.000Z",
      systolic: 119,
    },
  ];
  const provider = createProvider({ bloodPressureRecords, requests: [] });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const admitted = toJobRecord(bloodPressure, 64);
  admitted.dedupeKey = `hosted-device-sync:${"b".repeat(64)}`;
  let yieldChecks = 0;
  const yielded = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({
      importSnapshot: importWithRealJunctionNormalizer,
      shouldYield: () => {
        yieldChecks += 1;
        return yieldChecks > 1;
      },
    }),
    admitted,
  );
  const yieldedContinuation = findBloodPressureJob(yielded.scheduledJobs ?? []);

  assert.equal(yieldedContinuation.payload?.historicalRecordsSeen, true);
  assert.equal(
    yieldedContinuation.payload?.historicalUnresolvedProviderRecordCount,
    undefined,
  );
  assert.equal(yieldedContinuation.payload?.windowStart, "2026-05-13T00:00:00.000Z");

  const { result: malformedTail } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({ importSnapshot: importWithRealJunctionNormalizer }),
    job: toJobRecord(yieldedContinuation, 65),
    provider,
  });
  const anchoredRetry = findBloodPressureJob(malformedTail.scheduledJobs ?? []);

  assert.equal(malformedTail.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(anchoredRetry.dedupeKey, admitted.dedupeKey);
  assert.equal(
    anchoredRetry.payload?.historicalUnresolvedProviderRecordCount,
    1,
  );
  assert.equal(
    anchoredRetry.payload?.windowStart,
    "2026-05-12T00:00:00.000Z",
  );

  bloodPressureRecords[1] = {
    ...bloodPressureRecords[1],
    diastolic: 77,
  };
  const { result: repaired } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      importSnapshot: importWithRealJunctionNormalizer,
      now: "2026-06-12T12:00:00.000Z",
    }),
    job: toJobRecord(anchoredRetry, 66),
    provider,
  });

  assert.equal(repaired.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(repaired.metadataPatch, "omron", "blood_pressure");
});

test.each(SOURCE_DISCONNECT_FENCE_CODES)(
  "a connected %s fence that appears after pressure egress blocks durable import",
  async (lastErrorCode) => {
    const importedSnapshots: unknown[] = [];
    const providerListRequests = { count: 0 };
    const requests: TimeseriesRequest[] = [];
    const provider = createProvider({
      bloodPressureRecords: [{
        id: "bp-disconnected-source",
        provider_connection_id: "provider-omron-1",
        sourceProviderSlug: "omron",
        timestamp: "2026-05-20T08:30:00.000Z",
        systolic: 120,
        diastolic: 78,
      }],
      providerListRequests,
      requests,
    });
    const bloodPressure = createScheduledBloodPressureJob(provider);
    const admittedSource = createSourceSummary("omron");
    const fencedSource = createSourceSummary("omron");
    fencedSource.lastErrorCode = lastErrorCode;
    const context = createJobContext({
      account: createAccount({ sources: [admittedSource] }),
      importedSnapshots,
      listConnectionSources: async () => requests.length > 0
        ? [fencedSource]
        : [admittedSource],
    });
    const { result } = await executeImmediateBloodPressureContinuations({
      context,
      provider,
      job: toJobRecord(bloodPressure, 1),
    });

    assert.equal(providerListRequests.count, 1);
    assert.equal(requests.length, 1);
    assert.equal(importedSnapshots.length, 0);
    assert.equal(result.metadataPatch, undefined);
    assert.equal(result.scheduledJobs, undefined);
  },
);

test.each(["error", "unavailable"] as const)(
  "a source becoming %s after pressure egress blocks durable import and preserves exact evidence",
  async (status) => {
    const importedSnapshots: unknown[] = [];
    const requests: TimeseriesRequest[] = [];
    const provider = createProvider({
      bloodPressureRecords: [{
        id: `bp-source-became-${status}`,
        provider_connection_id: "provider-omron-1",
        sourceProviderSlug: "omron",
        timestamp: "2026-05-12T08:30:00.000Z",
        systolic: 120,
        diastolic: 78,
      }],
      requests,
    });
    const bloodPressure = createScheduledBloodPressureJob(provider);
    const admittedSource = createSourceSummary("omron");
    const unavailableSource = createSourceSummary("omron", NOW, status);
    const result = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({
        account: createAccount({ sources: [admittedSource] }),
        importedSnapshots,
        listConnectionSources: async () => requests.length > 0
          ? [unavailableSource]
          : [admittedSource],
      }),
      toJobRecord(bloodPressure, status === "error" ? 84 : 85),
    );
    const continuation = findBloodPressureJob(result.scheduledJobs ?? []);

    assert.equal(requests.length, 1);
    assert.equal(importedSnapshots.length, 0);
    assert.equal(result.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
    assert.equal(continuation.payload?.historicalProviderRecordsSeen, true);
    assert.equal(
      continuation.payload?.historicalUnresolvedProviderRecordCount,
      1,
    );
    assert.equal(
      typeof continuation.payload?.historicalUnresolvedProviderRecordIdentitiesJson,
      "string",
    );
    assert.equal(continuation.payload?.windowStart, "2026-05-12T00:00:00.000Z");
    assert.equal(
      continuation.payload?.historicalWindowStart,
      "2026-05-12T00:00:00.000Z",
    );

    const { result: completedTraversal } = await executeImmediateBloodPressureContinuations({
      context: createJobContext({
        importSnapshot: importWithRealJunctionNormalizer,
        listConnectionSources: async () => [admittedSource],
      }),
      job: toJobRecord(continuation, status === "error" ? 86 : 87),
      provider,
    });
    assert.equal(completedTraversal.scheduledJobs?.length ?? 0, 0);
    assertHistoryCoverage(
      completedTraversal.metadataPatch,
      "omron",
      "blood_pressure",
    );
  },
);

test.each(["error", "unavailable"] as const)(
  "an empty final segment becoming %s after egress preserves the anchored history obligation",
  async (status) => {
    const records: Record<string, unknown>[] = [{
      id: `bp-before-empty-final-${status}`,
      provider_connection_id: "provider-omron-1",
      sourceProviderSlug: "omron",
      timestamp: "2026-05-12T08:30:00.000Z",
      systolic: 120,
      diastolic: 78,
    }];
    const requests: TimeseriesRequest[] = [];
    const provider = createProvider({ bloodPressureRecords: records, requests });
    const executor = requireValue(provider.jobExecutor);
    const scheduled = createScheduledBloodPressureJob(provider);
    const twoDayJob = toJobRecord({
      ...scheduled,
      payload: {
        ...scheduled.payload,
        historicalWindowStart: "2026-05-12T00:00:00.000Z",
        windowEnd: "2026-05-14T00:00:00.000Z",
        windowStart: "2026-05-12T00:00:00.000Z",
      },
    }, status === "error" ? 90 : 91);
    twoDayJob.dedupeKey = `hosted-device-sync:${status === "error" ? "e" : "u"}`;
    const admittedSource = createSourceSummary("omron");

    const firstDay = await executor.executeJob(
      createJobContext({
        importSnapshot: importWithRealJunctionNormalizer,
        listConnectionSources: async () => [admittedSource],
      }),
      twoDayJob,
    );
    const finalDay = findBloodPressureJob(firstDay.scheduledJobs ?? []);
    assert.equal(finalDay.payload?.historicalRecordsSeen, true);
    assert.equal(finalDay.payload?.windowStart, "2026-05-13T00:00:00.000Z");

    records.length = 0;
    const requestsBeforeFinalDay = requests.length;
    const unavailableSource = createSourceSummary("omron", NOW, status);
    const unavailable = await executor.executeJob(
      createJobContext({
        listConnectionSources: async () =>
          requests.length > requestsBeforeFinalDay
            ? [unavailableSource]
            : [admittedSource],
      }),
      toJobRecord(finalDay, status === "error" ? 92 : 93),
    );
    const continuation = findBloodPressureJob(unavailable.scheduledJobs ?? []);

    assert.equal(unavailable.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
    assert.equal(continuation.dedupeKey, twoDayJob.dedupeKey);
    assert.equal(continuation.payload?.historicalRecordsSeen, true);
    assert.equal(
      continuation.payload?.historicalWindowStart,
      "2026-05-12T00:00:00.000Z",
    );
    assert.equal(continuation.payload?.windowStart, "2026-05-13T00:00:00.000Z");

    const repaired = await executor.executeJob(
      createJobContext({
        listConnectionSources: async () => [admittedSource],
        now: "2026-06-12T12:00:00.000Z",
      }),
      toJobRecord(continuation, status === "error" ? 94 : 95),
    );
    assert.equal(repaired.scheduledJobs?.length ?? 0, 0);
    assertHistoryCoverage(repaired.metadataPatch, "omron", "blood_pressure");
  },
);

test.each(SOURCE_DISCONNECT_FENCE_CODES)(
  "an empty final segment observes a post-fetch %s fence without publishing coverage",
  async (lastErrorCode) => {
    const records: Record<string, unknown>[] = [{
      id: `bp-before-empty-final-${lastErrorCode}`,
      provider_connection_id: "provider-omron-1",
      sourceProviderSlug: "omron",
      timestamp: "2026-05-12T08:30:00.000Z",
      systolic: 120,
      diastolic: 78,
    }];
    const requests: TimeseriesRequest[] = [];
    const provider = createProvider({ bloodPressureRecords: records, requests });
    const executor = requireValue(provider.jobExecutor);
    const scheduled = createScheduledBloodPressureJob(provider);
    const twoDayJob = toJobRecord({
      ...scheduled,
      payload: {
        ...scheduled.payload,
        historicalWindowStart: "2026-05-12T00:00:00.000Z",
        windowEnd: "2026-05-14T00:00:00.000Z",
        windowStart: "2026-05-12T00:00:00.000Z",
      },
    }, 96);
    const admittedSource = createSourceSummary("omron");
    const firstDay = await executor.executeJob(
      createJobContext({
        importSnapshot: importWithRealJunctionNormalizer,
        listConnectionSources: async () => [admittedSource],
      }),
      twoDayJob,
    );
    const finalDay = findBloodPressureJob(firstDay.scheduledJobs ?? []);

    records.length = 0;
    const requestsBeforeFinalDay = requests.length;
    const fencedSource = createSourceSummary("omron");
    fencedSource.lastErrorCode = lastErrorCode;
    const fenced = await executor.executeJob(
      createJobContext({
        listConnectionSources: async () =>
          requests.length > requestsBeforeFinalDay
            ? [fencedSource]
            : [admittedSource],
      }),
      toJobRecord(finalDay, 97),
    );

    assert.equal(fenced.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
    assert.equal(fenced.scheduledJobs, undefined);
  },
);

test.each(["error", "unavailable"] as const)(
  "a first empty segment becoming %s after egress leaves coverage for scheduler recreation",
  async (status) => {
    const requests: TimeseriesRequest[] = [];
    const provider = createProvider({ bloodPressureRecords: [], requests });
    const scheduled = createScheduledBloodPressureJob(provider);
    const singleDayJob = toJobRecord({
      ...scheduled,
      payload: {
        ...scheduled.payload,
        historicalWindowStart: "2026-05-12T00:00:00.000Z",
        windowEnd: "2026-05-13T00:00:00.000Z",
        windowStart: "2026-05-12T00:00:00.000Z",
      },
    }, status === "error" ? 98 : 99);
    const admittedSource = createSourceSummary("omron");
    const unavailableSource = createSourceSummary("omron", NOW, status);
    const result = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({
        listConnectionSources: async () =>
          requests.length > 0 ? [unavailableSource] : [admittedSource],
      }),
      singleDayJob,
    );

    assert.equal(requests.length, 1);
    assert.equal(result.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
    assert.equal(result.scheduledJobs, undefined);
    const recreated = createScheduledBloodPressureJob(provider);
    assert.equal(recreated.dedupeKey, scheduled.dedupeKey);
    assert.equal(
      recreated.payload?.historicalWindowStart,
      scheduled.payload?.historicalWindowStart,
    );
  },
);

test("a source absent from listed-only authority cannot trigger pressure egress", async () => {
  const providerListRequests = { count: 0 };
  const projectedSources: Array<{
    resourceAvailabilitySummary: Record<string, string | number | boolean | null>;
    status: string;
  }> = [];
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({ providerListRequests, requests });
  const bloodPressure = createScheduledBloodPressureJob(provider);

  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({
      account: createAccount({ sources: [] }),
      connectionSourceAdmissionMode: "listed_only",
      listConnectionSources: async () => [],
      projectedSources,
    }),
    toJobRecord(bloodPressure, 81),
  );

  assert.equal(providerListRequests.count, 1);
  assert.equal(projectedSources.length, 0);
  assert.equal(requests.length, 0);
  assert.equal(result.scheduledJobs, undefined);
  assert.equal(result.metadataPatch, undefined);
});

test("listed-only authority can project a non-fenced disconnected source without same-attempt pressure egress", async () => {
  const providerListRequests = { count: 0 };
  const projectedSources: Array<{
    resourceAvailabilitySummary: Record<string, string | number | boolean | null>;
    status: string;
  }> = [];
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({ providerListRequests, requests });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const disconnectedSource = createSourceSummary(
    "omron",
    NOW,
    "disconnected",
  );

  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({
      account: createAccount({ sources: [disconnectedSource] }),
      connectionSourceAdmissionMode: "listed_only",
      listConnectionSources: async () => [disconnectedSource],
      projectedSources,
    }),
    toJobRecord(bloodPressure, 82),
  );

  assert.equal(providerListRequests.count, 1);
  assert.deepEqual(projectedSources, [{
    resourceAvailabilitySummary: {
      activity: true,
      blood_pressure: true,
      stress_level: true,
    },
    status: "connected",
  }]);
  assert.equal(requests.length, 0);
  assert.equal(result.metadataPatch, undefined);
});

test.each(SOURCE_DISCONNECT_FENCE_CODES)(
  "a listed-only disconnected %s fence blocks provider recovery projection",
  async (lastErrorCode) => {
    const providerListRequests = { count: 0 };
    const projectedSources: Array<{
      resourceAvailabilitySummary: Record<string, string | number | boolean | null>;
      status: string;
    }> = [];
    const requests: TimeseriesRequest[] = [];
    const provider = createProvider({ providerListRequests, requests });
    const bloodPressure = createScheduledBloodPressureJob(provider);
    const disconnectedSource = createSourceSummary(
      "omron",
      NOW,
      "disconnected",
    );
    disconnectedSource.lastErrorCode = lastErrorCode;

    const result = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({
        account: createAccount({ sources: [disconnectedSource] }),
        connectionSourceAdmissionMode: "listed_only",
        listConnectionSources: async () => [disconnectedSource],
        projectedSources,
      }),
      toJobRecord(bloodPressure, 83),
    );

    assert.equal(providerListRequests.count, 0);
    assert.equal(projectedSources.length, 0);
    assert.equal(requests.length, 0);
    assert.equal(result.scheduledJobs, undefined);
    assert.equal(result.metadataPatch, undefined);
  },
);

test.each(SOURCE_DISCONNECT_FENCE_CODES)(
  "a pre-existing connected %s fence blocks provider discovery and pressure egress",
  async (lastErrorCode) => {
    const providerListRequests = { count: 0 };
    const requests: TimeseriesRequest[] = [];
    const provider = createProvider({ providerListRequests, requests });
    const bloodPressure = createScheduledBloodPressureJob(provider);
    const source = createSourceSummary("omron");
    source.lastErrorCode = lastErrorCode;

    const result = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({ account: createAccount({ sources: [source] }) }),
      toJobRecord(bloodPressure, 80),
    );

    assert.equal(providerListRequests.count, 0);
    assert.equal(requests.length, 0);
    assert.equal(result.scheduledJobs, undefined);
    assert.equal(result.metadataPatch, undefined);
  },
);

test("source-scoped partial failure retries instead of abandoning remaining history", async () => {
  const provider = createProvider({
    bloodPressureFailureRequest: 2,
    bloodPressureRecords: [{
      id: "bp-source-before-partial-failure",
      timestamp: "2026-05-12T08:30:00.000Z",
      systolic: 117,
      diastolic: 75,
    }],
    requests: [],
  });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const sourceScoped = toJobRecord({
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      sourceProviderSlug: "omron",
    },
  }, 1);
  sourceScoped.dedupeKey = `hosted-device-sync:${"e".repeat(64)}`;

  const { result } = await executeImmediateBloodPressureContinuations({
    context: createJobContext(),
    job: sourceScoped,
    provider,
  });
  const retry = findBloodPressureJob(result.scheduledJobs ?? []);

  assert.equal(result.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(retry.dedupeKey, sourceScoped.dedupeKey);
  assert.equal(retry.payload?.sourceProviderSlug, "omron");
  assert.equal(retry.payload?.historicalRecordsSeen, true);
  assert.equal(retry.payload?.windowStart, "2026-05-13T00:00:00.000Z");
});

test("ordinary empty webhook fetches do not enter the historical retry ladder", async () => {
  const provider = createProvider({ requests: [] });
  const webhookJob: DeviceSyncJobInput = {
    kind: "resource",
    payload: {
      eventType: "daily.data.blood_pressure.created",
      objectId: "bp-webhook-1",
      occurredAt: NOW,
      resource: "blood_pressure",
      resourceCategory: "timeseries",
      windowStart: "2026-06-10T00:00:00.000Z",
      windowEnd: BACKFILL_WINDOW_END,
    },
    priority: 65,
  };
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(webhookJob, 1),
  );

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assert.equal(result.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
});

test("yielded blood-pressure history keeps one identity and remembers earlier records", async () => {
  const bloodPressureRecords: Record<string, unknown>[] = [{
    id: "bp-first-day",
    timestamp: "2026-05-12T08:30:00.000Z",
    systolic: 118,
    diastolic: 76,
  }];
  const provider = createProvider({
    bloodPressureRecords,
    requests: [],
  });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const admittedBloodPressure = toJobRecord(bloodPressure, 1);
  admittedBloodPressure.dedupeKey = `hosted-device-sync:${"b".repeat(64)}`;
  let yieldChecks = 0;
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({
      shouldYield: () => {
        yieldChecks += 1;
        return yieldChecks > 1;
      },
    }),
    admittedBloodPressure,
  );
  const followUp = findBloodPressureJob(result.scheduledJobs ?? []);

  assert.equal(followUp.dedupeKey, admittedBloodPressure.dedupeKey);
  assert.equal(followUp.payload?.historicalRecordsSeen, true);
  assert.equal(
    followUp.payload?.historicalWindowStart,
    "2026-05-12T00:00:00.000Z",
  );
  assert.equal(followUp.payload?.windowStart, "2026-05-13T00:00:00.000Z");
  assert.equal(followUp.payload?.windowEnd, BACKFILL_WINDOW_END);

  bloodPressureRecords.length = 0;
  const { result: completed } = await executeImmediateBloodPressureContinuations({
    context: createJobContext(),
    job: toJobRecord(followUp, 2),
    provider,
  });
  assert.equal(completed.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(completed.metadataPatch, "omron", "blood_pressure");
});

test("malformed history cannot starve later valid days or clear without exact repair", async () => {
  const malformedIdentity = "bp-malformed-before-later-history";
  const bloodPressureRecords: Record<string, unknown>[] = [{
    id: malformedIdentity,
    timestamp: "2026-05-12T08:30:00.000Z",
    systolic: 118,
  }];
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({ bloodPressureRecords, requests });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const exhausted = toJobRecord({
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
      historicalWindowStart: "2026-05-12T00:00:00.000Z",
      windowEnd: "2026-05-14T00:00:00.000Z",
      windowStart: "2026-05-12T00:00:00.000Z",
    },
  }, 1);
  exhausted.dedupeKey = `hosted-device-sync:${"8".repeat(64)}`;
  const executor = requireValue(provider.jobExecutor);
  const firstDay = await executor.executeJob(
    createJobContext({ importSnapshot: importWithRealJunctionNormalizer }),
    exhausted,
  );
  const secondDay = findBloodPressureJob(firstDay.scheduledJobs ?? []);
  const unresolvedIdentitiesJson =
    secondDay.payload?.historicalUnresolvedProviderRecordIdentitiesJson;

  assert.equal(firstDay.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(secondDay.availableAt, undefined);
  assert.equal(secondDay.dedupeKey, exhausted.dedupeKey);
  assert.equal(secondDay.payload?.emptyBackfillAttempts, 4);
  assert.equal(secondDay.payload?.historicalProviderRecordsSeen, true);
  assert.equal(secondDay.payload?.historicalRecordsSeen, false);
  assert.equal(secondDay.payload?.historicalUnresolvedProviderRecordCount, 1);
  assert.equal(typeof unresolvedIdentitiesJson, "string");
  assert.equal(
    secondDay.payload?.historicalWindowStart,
    "2026-05-12T00:00:00.000Z",
  );
  assert.equal(secondDay.payload?.sourceProviderSlug, "omron");
  assert.equal(secondDay.payload?.windowStart, "2026-05-13T00:00:00.000Z");
  assert.equal(secondDay.payload?.windowEnd, "2026-05-14T00:00:00.000Z");

  bloodPressureRecords.splice(0, bloodPressureRecords.length, {
    id: "bp-valid-after-malformed-history",
    timestamp: "2026-05-13T08:30:00.000Z",
    systolic: 121,
    diastolic: 79,
  });
  const reachedWindowEnd = await executor.executeJob(
    createJobContext({ importSnapshot: importWithRealJunctionNormalizer }),
    toJobRecord(secondDay, 2),
  );
  const anchoredRetry = findBloodPressureJob(reachedWindowEnd.scheduledJobs ?? []);

  assert.equal(reachedWindowEnd.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(anchoredRetry.availableAt, "2026-06-12T12:00:00.000Z");
  assert.equal(anchoredRetry.dedupeKey, exhausted.dedupeKey);
  assert.equal(anchoredRetry.payload?.emptyBackfillAttempts, 4);
  assert.equal(anchoredRetry.payload?.historicalProviderRecordsSeen, true);
  assert.equal(anchoredRetry.payload?.historicalRecordsSeen, true);
  assert.equal(anchoredRetry.payload?.historicalUnresolvedProviderRecordCount, 1);
  assert.equal(
    anchoredRetry.payload?.historicalUnresolvedProviderRecordIdentitiesJson,
    unresolvedIdentitiesJson,
  );
  assert.equal(
    anchoredRetry.payload?.historicalWindowStart,
    "2026-05-12T00:00:00.000Z",
  );
  assert.equal(anchoredRetry.payload?.windowStart, "2026-05-12T00:00:00.000Z");
  assert.deepEqual(
    requests.filter((request) => request.resource === "blood_pressure").map(
      (request) => request.start,
    ),
    ["2026-05-12T00:00:00.000Z", "2026-05-13T00:00:00.000Z"],
  );

  const { result: unrelated } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      importSnapshot: importWithRealJunctionNormalizer,
      now: "2026-06-12T12:00:00.000Z",
    }),
    job: toJobRecord(anchoredRetry, 3),
    provider,
  });
  const unresolvedRetry = findBloodPressureJob(unrelated.scheduledJobs ?? []);

  assert.equal(unrelated.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(unresolvedRetry.dedupeKey, exhausted.dedupeKey);
  assert.equal(unresolvedRetry.payload?.historicalUnresolvedProviderRecordCount, 1);
  assert.equal(
    unresolvedRetry.payload?.historicalUnresolvedProviderRecordIdentitiesJson,
    unresolvedIdentitiesJson,
  );
  assert.equal(unresolvedRetry.payload?.windowStart, "2026-05-12T00:00:00.000Z");

  bloodPressureRecords.splice(0, bloodPressureRecords.length, {
    id: malformedIdentity,
    timestamp: "2026-05-12T08:30:00.000Z",
    systolic: 118,
    diastolic: 76,
  });
  const { result: repaired } = await executeImmediateBloodPressureContinuations({
    context: createJobContext({
      importSnapshot: importWithRealJunctionNormalizer,
      now: "2026-06-13T12:00:00.000Z",
    }),
    job: toJobRecord(unresolvedRetry, 4),
    provider,
  });

  assert.equal(repaired.scheduledJobs?.length ?? 0, 0);
  assertHistoryCoverage(repaired.metadataPatch, "omron", "blood_pressure");
});

test("an empty yielded scan retries from the original anchored window", async () => {
  const provider = createProvider({ requests: [] });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const admittedBloodPressure = toJobRecord(bloodPressure, 1);
  admittedBloodPressure.dedupeKey = `hosted-device-sync:${"c".repeat(64)}`;
  let yieldChecks = 0;
  const yielded = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({
      shouldYield: () => {
        yieldChecks += 1;
        return yieldChecks > 1;
      },
    }),
    admittedBloodPressure,
  );
  const followUp = findBloodPressureJob(yielded.scheduledJobs ?? []);
  const { result: completedScan } = await executeImmediateBloodPressureContinuations({
    context: createJobContext(),
    job: toJobRecord(followUp, 2),
    provider,
  });
  const retry = findBloodPressureJob(completedScan.scheduledJobs ?? []);

  assert.equal(retry.dedupeKey, admittedBloodPressure.dedupeKey);
  assert.equal(retry.payload?.emptyBackfillAttempts, 1);
  assert.equal(retry.payload?.windowStart, "2026-05-12T00:00:00.000Z");
  assert.equal(retry.payload?.historicalWindowStart, "2026-05-12T00:00:00.000Z");
});

test("repeated SDK setup does not create unscoped blood-pressure history work", async () => {
  const provider = createProvider({ requests: [] });
  const sdk = requireValue(provider.sdkConnectionHandler);
  const first = await sdk.ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const second = await sdk.ensureConnection({
    ownerId: "member-1",
    now: SAME_DAY_LATER,
  });
  for (const connection of [first, second]) {
    assert.deepEqual(connection.initialJobs?.map((job) => job.kind), [
      "backfill",
      "reconcile",
    ]);
    assert.equal(
      connection.initialJobs?.some((job) =>
        job.kind === "resource" && job.payload?.resource === "blood_pressure"
      ),
      false,
    );
  }
});

test("an explicit Junction timeseries backfill window still governs blood pressure", async () => {
  const provider = createProvider({
    requests: [],
    timeseriesBackfillDays: 5,
  });
  const bloodPressure = createScheduledBloodPressureJob(provider);

  assert.equal(bloodPressure.payload?.windowStart, "2026-06-06T00:00:00.000Z");
  assert.equal(bloodPressure.payload?.windowEnd, BACKFILL_WINDOW_END);
});

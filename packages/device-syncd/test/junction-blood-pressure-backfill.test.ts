import assert from "node:assert/strict";
import { test } from "vitest";

import { deviceSyncError, isDeviceSyncError } from "../src/errors.ts";
import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import { createJsonResponse, readUrl, requireValue } from "./helpers.ts";

import type {
  DeviceSyncAccount,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  ProviderJobContext,
  StoredDeviceSyncAccount,
} from "../src/types.ts";

const NOW = "2026-06-11T12:00:00.000Z";
const SAME_DAY_LATER = "2026-06-11T18:00:00.000Z";
const BACKFILL_WINDOW_END = "2026-06-11T00:00:00.000Z";
const BP_HISTORY_COVERAGE_KEY = "junctionBloodPressureHistoryBackfillCoverage";

interface TimeseriesRequest {
  end: string | null;
  resource: string;
  start: string | null;
}

interface MutableProviderState {
  present?: boolean;
  resourceAvailability: Record<string, unknown>;
  status: string;
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
  status: "connected" | "disconnected" = "connected",
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
    importSnapshot: input.importSnapshot ?? (async (snapshot) => {
      input.importedSnapshots?.push(snapshot);
      return {
        canonicalEventCount: input.canonicalEventCount ?? 1,
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

function createProvider(input: {
  bloodPressureFailureRequest?: number;
  bloodPressureRecords?: readonly Record<string, unknown>[];
  bloodPressureRequestFailure?: {
    active: boolean;
    fromRequest: number;
    status: number;
  };
  providerListRequestFailure?: {
    active: boolean;
    status: number;
  };
  providerListRequests?: { count: number };
  providerState?: MutableProviderState;
  requests: TimeseriesRequest[];
  timeseriesBackfillDays?: number;
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
    summaryBackfillDays: 30,
    timeseriesResources: ["blood_pressure", "stress_level"],
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
              }],
        });
      }
      if (url.pathname === "/v2/summary/activity/junction-user-1") {
        return createJsonResponse({ data: [] });
      }
      if (url.pathname === "/v2/introspect/historical_pull") {
        return createJsonResponse({ data: [] });
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
        const records = resource === "blood_pressure"
          ? [...(input.bloodPressureRecords ?? [])]
          : [];
        return createJsonResponse(
          records.length > 0
            ? { groups: { omron: [{ data: records }] } }
            : { groups: {} },
        );
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    },
  });
}

function findBloodPressureJob(jobs: readonly DeviceSyncJobInput[]): DeviceSyncJobInput {
  return requireValue(jobs.find((job) =>
    job.kind === "resource"
    && job.payload?.resource === "blood_pressure"
  ));
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
      }),
    }),
    toJobRecord(backfill, 1),
  );
  const boundedRequests = [...requests];
  assert.equal(boundedRequests.length, 28);
  assert.equal(
    boundedRequests.filter((request) => request.resource === "stress_level").length,
    14,
  );
  assert.equal(
    boundedRequests.filter((request) => request.resource === "blood_pressure").length,
    14,
  );
  assert.equal(
    Object.hasOwn(
      boundedResult.metadataPatch ?? {},
      BP_HISTORY_COVERAGE_KEY,
    ),
    false,
  );
  requests.length = 0;

  const result = await executor.executeJob(
    createJobContext(),
    admittedBloodPressure,
  );
  const bloodPressureRequests = requests.filter(
    (request) => request.resource === "blood_pressure",
  );
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
      sources: [createSourceSummary("omron", "2026-03-20T23:55:00.000Z")],
    });

    const result = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({ account, importedSnapshots, now: callbackAt }),
      toJobRecord(backfill, timeseriesBackfillDays),
    );
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
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(exhausted, 1),
  );

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assert.equal(result.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron");
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
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({
      account: createAccount({
        metadata: { [BP_HISTORY_COVERAGE_KEY]: "v1|withings" },
      }),
    }),
    toJobRecord(sourceScoped, 1),
  );

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assert.equal(result.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron,withings");
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

  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({
      account: createAccount({
        metadata: { [BP_HISTORY_COVERAGE_KEY]: "v1|withings" },
      }),
      importedSnapshots,
    }),
    toJobRecord(sourceScoped, 1),
  );

  assert.equal(importedSnapshots.length, 1);
  assert.equal(
    JSON.stringify(importedSnapshots).includes("bp-source-history-1"),
    true,
  );
  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assert.equal(result.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron,withings");
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

  const completed = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({ now: callbackAt }),
    toJobRecord(schedulerJob, 1),
  );
  assert.equal(completed.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron");
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

    const result = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({ projectedSources }),
      toJobRecord(admitted, 1),
    );

    assert.deepEqual(
      projectedSources,
      providerState.present === false
        ? []
        : [{
            resourceAvailabilitySummary: providerState.resourceAvailability,
            status: providerState.status,
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
  const completed = await requireValue(recoveredProvider.jobExecutor).executeJob(
    createJobContext({ now: "2026-06-12T12:00:00.000Z" }),
    toJobRecord(recreated, 2),
  );
  assert.equal(completed.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron");
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
    assert.equal(stillRecoverable.payload?.windowStart, original.payload?.windowStart);

    records.push({
      id: `bp-after-live-authority-recovery-${index}`,
      timestamp: "2026-03-15T08:30:00.000Z",
      systolic: 121,
      diastolic: 79,
    });
    const completed = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({ now: "2026-06-13T12:00:00.000Z" }),
      toJobRecord(stillRecoverable, index + 20),
    );
    assert.equal(completed.scheduledJobs?.length ?? 0, 0);
    assert.equal(completed.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron");
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
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(bloodPressure, 1),
  );

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assert.equal(result.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron");
});

test("partial optional failure retries from the anchored window after importing canonical events", async () => {
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

  const partial = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({ importedSnapshots }),
    admittedBloodPressure,
  );
  const retry = findBloodPressureJob(partial.scheduledJobs ?? []);

  assert.equal(importedSnapshots.length, 1);
  assert.equal(JSON.stringify(importedSnapshots).includes("bp-before-partial-failure"), true);
  assert.equal(partial.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(retry.dedupeKey, admittedBloodPressure.dedupeKey);
  assert.equal(retry.payload?.historicalRecordsSeen, true);
  assert.equal(retry.payload?.historicalWindowStart, "2026-05-12T00:00:00.000Z");
  assert.equal(retry.payload?.windowStart, "2026-05-12T00:00:00.000Z");

  const completed = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(retry, 2),
  );
  assert.equal(completed.scheduledJobs?.length ?? 0, 0);
  assert.equal(completed.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron");
  assert.equal(
    requests.filter((request) => request.resource === "blood_pressure").length,
    32,
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

  const partial = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({ canonicalEventCount: 0 }),
    exhausted,
  );
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
  const empty = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({ now: "2026-06-17T12:00:00.000Z" }),
    toJobRecord(retainedAcrossOutage, 7),
  );
  const stillRecoverable = findBloodPressureJob(empty.scheduledJobs ?? []);

  assert.equal(empty.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(stillRecoverable.availableAt, "2026-06-18T12:00:00.000Z");
  assert.equal(stillRecoverable.dedupeKey, exhausted.dedupeKey);
  assert.equal(stillRecoverable.payload?.historicalProviderRecordsSeen, true);

  bloodPressureRecords.push({
    id: "bp-recovered-after-retryable-failure",
    timestamp: "2026-05-20T08:30:00.000Z",
    systolic: 121,
    diastolic: 79,
  });
  const recovered = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({ now: "2026-06-18T12:00:00.000Z" }),
    toJobRecord(stillRecoverable, 8),
  );

  assert.equal(recovered.scheduledJobs?.length ?? 0, 0);
  assert.equal(recovered.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron");
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
    let yieldChecks = 0;
    const failed = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({
        ...(boundary === "source-state"
          ? {
              listConnectionSources: async () => {
                sourceStateReads += 1;
                if (sourceStateReads === 1) {
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
        shouldYield: () => {
          yieldChecks += 1;
          return yieldChecks > 1;
        },
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
    const empty = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({ now: "2026-06-12T12:00:00.000Z" }),
      toJobRecord(retry, 42),
    );
    const stillRecoverable = findBloodPressureJob(empty.scheduledJobs ?? []);

    assert.equal(empty.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
    assert.equal(stillRecoverable.dedupeKey, exhausted.dedupeKey);
    assert.equal(stillRecoverable.payload?.historicalProviderRecordsSeen, true);
    assert.equal(stillRecoverable.payload?.windowStart, original.payload?.windowStart);

    records.push({
      id: `bp-after-${boundary}-recovery`,
      timestamp: "2026-05-20T08:30:00.000Z",
      systolic: 121,
      diastolic: 79,
    });
    const recovered = await requireValue(provider.jobExecutor).executeJob(
      createJobContext({ now: "2026-06-13T12:00:00.000Z" }),
      toJobRecord(stillRecoverable, 43),
    );

    assert.equal(recovered.scheduledJobs?.length ?? 0, 0);
    assert.equal(recovered.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron");
  }
});

test("nonretryable post-fetch failures keep ordinary failure semantics", async () => {
  for (const boundary of ["source-state", "canonical-import"] as const) {
    const provider = createProvider({
      bloodPressureRecords: [{
        id: `bp-before-nonretryable-${boundary}-failure`,
        timestamp: "2026-05-20T08:30:00.000Z",
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
    let sourceStateReads = 0;

    await assert.rejects(
      () => requireValue(provider.jobExecutor).executeJob(
        createJobContext(
          boundary === "source-state"
            ? {
                listConnectionSources: async () => {
                  sourceStateReads += 1;
                  if (sourceStateReads === 1) {
                    return [];
                  }
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

  const partial = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    exhausted,
  );
  const retry = findBloodPressureJob(partial.scheduledJobs ?? []);

  assert.equal(partial.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(retry.availableAt, "2026-06-12T12:00:00.000Z");
  assert.equal(retry.dedupeKey, exhausted.dedupeKey);
  assert.equal(retry.payload?.emptyBackfillAttempts, 4);
  assert.equal(retry.payload?.historicalRecordsSeen, true);
  assert.equal(retry.payload?.windowStart, "2026-05-12T00:00:00.000Z");

  const recovered = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({ now: "2026-06-12T12:00:00.000Z" }),
    toJobRecord(retry, 2),
  );
  assert.equal(recovered.scheduledJobs?.length ?? 0, 0);
  assert.equal(recovered.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron");
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

  const partial = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    exhausted,
  );
  const retry = findBloodPressureJob(partial.scheduledJobs ?? []);

  assert.equal(partial.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(retry.availableAt, "2026-06-12T12:00:00.000Z");
  assert.equal(retry.dedupeKey, exhausted.dedupeKey);
  assert.equal(retry.payload?.emptyBackfillAttempts, 4);
  assert.equal(retry.payload?.historicalRecordsSeen, true);
  assert.equal(retry.payload?.sourceProviderSlug, "omron");
  assert.equal(retry.payload?.windowStart, "2026-05-12T00:00:00.000Z");

  const recovered = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({ now: "2026-06-12T12:00:00.000Z" }),
    toJobRecord(retry, 2),
  );
  assert.equal(recovered.scheduledJobs?.length ?? 0, 0);
  assert.equal(recovered.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron");
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
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({ canonicalEventCount: 0 }),
    toJobRecord(bloodPressure, 1),
  );
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

  const malformed = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({ canonicalEventCount: 0 }),
    exhausted,
  );
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
  const recovered = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({ now: "2026-06-12T12:00:00.000Z" }),
    toJobRecord(retry, 2),
  );

  assert.equal(recovered.scheduledJobs?.length ?? 0, 0);
  assert.equal(recovered.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron");
});

test("source admission rejection cannot certify historical coverage", async () => {
  const importedSnapshots: unknown[] = [];
  const provider = createProvider({
    bloodPressureRecords: [{
      id: "bp-disconnected-source",
      provider_connection_id: "provider-omron-1",
      sourceProviderSlug: "omron",
      timestamp: "2026-05-20T08:30:00.000Z",
      systolic: 120,
      diastolic: 78,
    }],
    requests: [],
  });
  const bloodPressure = createScheduledBloodPressureJob(provider);
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({
      account: createAccount({
        sources: [{
          displayName: "Omron",
          firstSeenAt: NOW,
          lastDataAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSeenAt: NOW,
          resourceCount: 1,
          sourceProviderSlug: "omron",
          status: "disconnected",
        }],
      }),
      importedSnapshots,
    }),
    toJobRecord(bloodPressure, 1),
  );

  assert.equal(importedSnapshots.length, 0);
  assert.equal(result.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(result.scheduledJobs?.length ?? 0, 0);
});

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

  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    sourceScoped,
  );
  const retry = findBloodPressureJob(result.scheduledJobs ?? []);

  assert.equal(result.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(retry.dedupeKey, sourceScoped.dedupeKey);
  assert.equal(retry.payload?.sourceProviderSlug, "omron");
  assert.equal(retry.payload?.historicalRecordsSeen, true);
  assert.equal(retry.payload?.windowStart, "2026-05-12T00:00:00.000Z");
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
  const completed = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(followUp, 2),
  );
  assert.equal(completed.scheduledJobs?.length ?? 0, 0);
  assert.equal(completed.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], "v1|omron");
});

test("malformed rows before a yield cannot become terminal empty coverage", async () => {
  const bloodPressureRecords: Record<string, unknown>[] = [{
    id: "bp-malformed-before-yield",
    timestamp: "2026-05-12T08:30:00.000Z",
    systolic: 118,
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
  exhausted.dedupeKey = `hosted-device-sync:${"8".repeat(64)}`;
  let yieldChecks = 0;
  const yielded = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({
      canonicalEventCount: 0,
      shouldYield: () => {
        yieldChecks += 1;
        return yieldChecks > 1;
      },
    }),
    exhausted,
  );
  const continuation = findBloodPressureJob(yielded.scheduledJobs ?? []);

  assert.equal(continuation.dedupeKey, exhausted.dedupeKey);
  assert.equal(continuation.payload?.emptyBackfillAttempts, 4);
  assert.equal(continuation.payload?.historicalProviderRecordsSeen, true);
  assert.equal(continuation.payload?.historicalRecordsSeen, false);
  assert.equal(continuation.payload?.windowStart, "2026-05-13T00:00:00.000Z");

  bloodPressureRecords.length = 0;
  const completedContinuation = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(continuation, 2),
  );
  const retry = findBloodPressureJob(completedContinuation.scheduledJobs ?? []);

  assert.equal(completedContinuation.metadataPatch?.[BP_HISTORY_COVERAGE_KEY], undefined);
  assert.equal(retry.availableAt, "2026-06-12T12:00:00.000Z");
  assert.equal(retry.dedupeKey, exhausted.dedupeKey);
  assert.equal(retry.payload?.emptyBackfillAttempts, 4);
  assert.equal(retry.payload?.historicalProviderRecordsSeen, true);
  assert.equal(retry.payload?.windowStart, "2026-05-12T00:00:00.000Z");
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
  const completedScan = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(followUp, 2),
  );
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

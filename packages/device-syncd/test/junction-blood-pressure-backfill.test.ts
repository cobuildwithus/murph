import assert from "node:assert/strict";
import { test } from "vitest";

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
const BP_HISTORY_VERSION_KEY = "junctionBloodPressureHistoryBackfillVersion";

interface TimeseriesRequest {
  end: string | null;
  resource: string;
  start: string | null;
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
  importedSnapshots?: unknown[];
  now?: string;
  shouldYield?: () => boolean;
} = {}): ProviderJobContext {
  const account = input.account ?? createAccount();
  return {
    account,
    now: input.now ?? NOW,
    importSnapshot: async (snapshot) => {
      input.importedSnapshots?.push(snapshot);
      return {
        canonicalEventCount: input.canonicalEventCount ?? 1,
        durableDeliveryAccepted: true,
      };
    },
    upsertConnectionSource: (sourceInput) => ({
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
    }),
    refreshAccountTokens: async () => account,
    ...(input.shouldYield ? { shouldYield: input.shouldYield } : {}),
    logger: {},
  };
}

function createProvider(input: {
  bloodPressureFailureRequest?: number;
  bloodPressureRecords?: readonly Record<string, unknown>[];
  requests: TimeseriesRequest[];
  timeseriesBackfillDays?: number;
}) {
  let bloodPressureRequestCount = 0;
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
        return createJsonResponse({
          providers: [{
            id: "provider-omron-1",
            slug: "omron",
            name: "Omron",
            status: "connected",
            resource_availability: {
              activity: true,
              blood_pressure: true,
              stress_level: true,
            },
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

test("Junction gives sparse blood pressure its own full-history resumable job", async () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({ requests });
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const jobs = connection.initialJobs ?? [];
  const backfill = requireValue(jobs.find((job) => job.kind === "backfill"));
  const bloodPressure = findBloodPressureJob(jobs);
  const admittedBloodPressure = toJobRecord(bloodPressure, 2);
  admittedBloodPressure.dedupeKey = `hosted-device-sync:${"a".repeat(64)}`;

  assert.equal(bloodPressure.availableAt, NOW);
  assert.deepEqual(bloodPressure.payload, {
    historicalBackfill: true,
    historicalWindowStart: "2026-05-12T00:00:00.000Z",
    resource: "blood_pressure",
    resourceCategory: "timeseries",
    windowStart: "2026-05-12T00:00:00.000Z",
    windowEnd: BACKFILL_WINDOW_END,
  });

  const executor = requireValue(provider.jobExecutor);
  await executor.executeJob(createJobContext(), toJobRecord(backfill, 1));
  const boundedRequests = [...requests];
  assert.equal(boundedRequests.length, 14);
  assert.equal(
    boundedRequests.every((request) => request.resource === "stress_level"),
    true,
  );
  assert.equal(
    boundedRequests.some((request) => request.resource === "blood_pressure"),
    false,
  );

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

test("empty blood-pressure history retries are bounded and mark account-wide coverage terminal", async () => {
  const provider = createProvider({ requests: [] });
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);
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
  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], 1);
});

test("a source-scoped terminal pass does not suppress the account-wide migration", async () => {
  const provider = createProvider({ requests: [] });
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);
  const sourceScoped = {
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
      sourceProviderSlug: "omron",
    },
  };
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(sourceScoped, 1),
  );

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], undefined);
});

test("a newly confirmed source backfills older blood pressure after account migration", async () => {
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
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);
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
        metadata: { [BP_HISTORY_VERSION_KEY]: 1 },
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
  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], undefined);
});

test("an existing account receives one account-wide migration anchored to its connection window", () => {
  const provider = createProvider({ requests: [] });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const connectedAt = "2026-04-20T17:45:00.000Z";
  const scheduled = createScheduledJobs(
    createStoredAccount({ connectedAt }),
    NOW,
  );
  const bloodPressure = findBloodPressureJob(scheduled.jobs);

  assert.equal(bloodPressure.availableAt, NOW);
  assert.equal(bloodPressure.payload?.historicalWindowStart, "2026-03-21T00:00:00.000Z");
  assert.equal(bloodPressure.payload?.windowStart, "2026-03-21T00:00:00.000Z");
  assert.equal(bloodPressure.payload?.windowEnd, "2026-04-20T00:00:00.000Z");

  const completed = createScheduledJobs(
    createStoredAccount({
      connectedAt,
      metadata: { [BP_HISTORY_VERSION_KEY]: 1 },
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
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(findBloodPressureJob(connection.initialJobs ?? []), 1),
  );

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], 1);
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
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);
  const admittedBloodPressure = toJobRecord(bloodPressure, 1);
  admittedBloodPressure.dedupeKey = `hosted-device-sync:${"d".repeat(64)}`;

  const partial = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({ importedSnapshots }),
    admittedBloodPressure,
  );
  const retry = findBloodPressureJob(partial.scheduledJobs ?? []);

  assert.equal(importedSnapshots.length, 1);
  assert.equal(JSON.stringify(importedSnapshots).includes("bp-before-partial-failure"), true);
  assert.equal(partial.metadataPatch?.[BP_HISTORY_VERSION_KEY], undefined);
  assert.equal(retry.dedupeKey, admittedBloodPressure.dedupeKey);
  assert.equal(retry.payload?.historicalRecordsSeen, true);
  assert.equal(retry.payload?.historicalWindowStart, "2026-05-12T00:00:00.000Z");
  assert.equal(retry.payload?.windowStart, "2026-05-12T00:00:00.000Z");

  const completed = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(retry, 2),
  );
  assert.equal(completed.scheduledJobs?.length ?? 0, 0);
  assert.equal(completed.metadataPatch?.[BP_HISTORY_VERSION_KEY], 1);
  assert.equal(
    requests.filter((request) => request.resource === "blood_pressure").length,
    32,
  );
});

test("account-wide partial failure stays recoverable after the empty retry ladder", async () => {
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
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);
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

  assert.equal(partial.metadataPatch?.[BP_HISTORY_VERSION_KEY], undefined);
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
  assert.equal(recovered.metadataPatch?.[BP_HISTORY_VERSION_KEY], 1);
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
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);
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

  assert.equal(partial.metadataPatch?.[BP_HISTORY_VERSION_KEY], undefined);
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
  assert.equal(recovered.metadataPatch?.[BP_HISTORY_VERSION_KEY], undefined);
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
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({ canonicalEventCount: 0 }),
    toJobRecord(findBloodPressureJob(connection.initialJobs ?? []), 1),
  );
  const retry = findBloodPressureJob(result.scheduledJobs ?? []);

  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], undefined);
  assert.equal(retry.payload?.emptyBackfillAttempts, 1);
  assert.equal(retry.payload?.historicalRecordsSeen, undefined);
  assert.equal(retry.payload?.historicalWindowStart, "2026-05-12T00:00:00.000Z");
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
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
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
    toJobRecord(findBloodPressureJob(connection.initialJobs ?? []), 1),
  );
  const retry = findBloodPressureJob(result.scheduledJobs ?? []);

  assert.equal(importedSnapshots.length, 0);
  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], undefined);
  assert.equal(retry.payload?.emptyBackfillAttempts, 1);
  assert.equal(retry.payload?.historicalRecordsSeen, undefined);
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
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);
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

  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], undefined);
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
  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], undefined);
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
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);
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
  assert.equal(completed.metadataPatch?.[BP_HISTORY_VERSION_KEY], 1);
});

test("an empty yielded scan retries from the original anchored window", async () => {
  const provider = createProvider({ requests: [] });
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);
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

test("same-day SDK ensures coalesce to one blood-pressure history identity", async () => {
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
  const firstBloodPressure = findBloodPressureJob(first.initialJobs ?? []);
  const secondBloodPressure = findBloodPressureJob(second.initialJobs ?? []);

  assert.equal(firstBloodPressure.dedupeKey, secondBloodPressure.dedupeKey);
  assert.deepEqual(firstBloodPressure.payload, secondBloodPressure.payload);
  assert.equal(firstBloodPressure.availableAt, NOW);
  assert.equal(secondBloodPressure.availableAt, SAME_DAY_LATER);
});

test("an explicit Junction timeseries backfill window still governs blood pressure", async () => {
  const provider = createProvider({
    requests: [],
    timeseriesBackfillDays: 5,
  });
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);

  assert.equal(bloodPressure.payload?.windowStart, "2026-06-06T00:00:00.000Z");
  assert.equal(bloodPressure.payload?.windowEnd, BACKFILL_WINDOW_END);
});

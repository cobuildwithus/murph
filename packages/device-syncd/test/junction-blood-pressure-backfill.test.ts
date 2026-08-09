import assert from "node:assert/strict";
import { test } from "vitest";

import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import { createJsonResponse, readUrl, requireValue } from "./helpers.ts";

import type {
  DeviceSyncAccount,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  ProviderJobContext,
} from "../src/types.ts";

const NOW = "2026-06-11T12:00:00.000Z";

interface TimeseriesRequest {
  end: string | null;
  resource: string;
  start: string | null;
}

function createAccount(): DeviceSyncAccount {
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
    metadata: {},
    connectedAt: NOW,
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    createdAt: NOW,
    updatedAt: NOW,
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

function createJobContext(): ProviderJobContext {
  const account = createAccount();
  return {
    account,
    now: NOW,
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
    refreshAccountTokens: async () => account,
    logger: {},
  };
}

function createProvider(input: {
  requests: TimeseriesRequest[];
  timeseriesBackfillDays?: number;
}) {
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
        input.requests.push({
end: url.searchParams.get("end_date"),
resource: url.pathname.slice(timeseriesPrefix.length).replace(/\/grouped$/u, ""),
start: url.searchParams.get("start_date"),
        });
        return createJsonResponse({ groups: {} });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    },
  });
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
  const bloodPressure = requireValue(jobs.find((job) =>
    job.kind === "resource"
    && job.payload?.resource === "blood_pressure"
  ));

  assert.deepEqual(bloodPressure.payload, {
    resource: "blood_pressure",
    resourceCategory: "timeseries",
    windowStart: "2026-05-12T12:00:00.000Z",
    windowEnd: NOW,
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

  await executor.executeJob(createJobContext(), toJobRecord(bloodPressure, 2));
  const bloodPressureRequests = requests.filter(
    (request) => request.resource === "blood_pressure",
  );
  assert.equal(bloodPressureRequests.length, 30);
  assert.equal(bloodPressureRequests[0]?.start, "2026-05-12T12:00:00.000Z");
  assert.equal(bloodPressureRequests.at(-1)?.end, NOW);
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
  const bloodPressure = requireValue((connection.initialJobs ?? []).find((job) =>
    job.kind === "resource"
    && job.payload?.resource === "blood_pressure"
  ));

  assert.equal(bloodPressure.payload?.windowStart, "2026-06-06T12:00:00.000Z");
  assert.equal(bloodPressure.payload?.windowEnd, NOW);
});

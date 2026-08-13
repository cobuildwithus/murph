import assert from "node:assert/strict";
import { test } from "vitest";

import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";

import type {
  DeviceSyncAccount,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  ProviderJobContext,
} from "../src/types.ts";

function createAccount(): DeviceSyncAccount {
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
  };
}

function createJob(payload: Record<string, unknown>): DeviceSyncJobRecord {
  return {
    id: "job-backfill",
    provider: "junction",
    accountId: "acct-junction-1",
    kind: "backfill",
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

function assertConnectBackfillRetryWake(
  result: {
    nextReconcileAt?: string | null;
    scheduledJobs?: readonly DeviceSyncJobInput[];
  },
): void {
  assert.equal(result.nextReconcileAt, "2026-04-03T00:15:00.000Z");
  assertFullTimeseriesContinuation(result);
}

function assertFullTimeseriesContinuation(result: {
  scheduledJobs?: readonly DeviceSyncJobInput[];
}): void {
  const scheduledJobs = result.scheduledJobs ?? [];
  assert.equal(scheduledJobs.length, 1);
  const continuation = scheduledJobs[0];
  assert.equal(continuation?.kind, "backfill");
  assert.equal(continuation?.availableAt, "2026-04-03T00:00:00.000Z");
  assert.equal(continuation?.payload?.timeseriesCursor, "2026-04-01T00:00:00.000Z");
  assert.equal(continuation?.payload?.timeseriesResourceCursor, "blood_oxygen");
}

function createJobContext(importedSnapshots: unknown[]): ProviderJobContext {
  const account = createAccount();

  return {
    account,
    now: "2026-04-03T00:00:00.000Z",
    importSnapshot: async (snapshot) => {
      importedSnapshots.push(snapshot);
      return { imported: true };
    },
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

function createProvider(summaryRecord: Record<string, unknown>) {
  return createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["sleep_cycle"],
    timeseriesResources: [],
    summaryBackfillDays: 2,
    fetchImpl: async (input) => {
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
                sleep_cycle: true,
              },
            },
          ],
        });
      }

      if (url.startsWith("https://api.sandbox.us.junction.com/v2/summary/sleep_cycle/junction-user-1")) {
        return createJsonResponse({ data: [summaryRecord] });
      }

      if (
        url
          === "https://api.sandbox.us.junction.com/v2/introspect/historical_pull?user_id=junction-user-1&user_limit=1"
      ) {
        // Keep this focused suite on the canonical-import fallback without
        // triggering the client's retry delays when no snapshot is available.
        return createJsonResponse({ data: [] });
      }

      if (url.includes("/v2/timeseries/junction-user-1/")) {
        return createJsonResponse({ groups: {} });
      }

      throw new Error(`Unexpected request: ${url}`);
    },
  });
}

async function executeBackfill(summaryRecord: Record<string, unknown>) {
  const importedSnapshots: unknown[] = [];
  const provider = createProvider(summaryRecord);
  assert.ok(provider.jobExecutor, "Junction provider should expose a job executor.");

  const result = await provider.jobExecutor.executeJob(
    createJobContext(importedSnapshots),
    createJob({
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    }),
  );

  return { importedSnapshots, result };
}

test("Junction sleep-cycle historical backfill uses canonical importer evidence when introspection is unavailable", async () => {
  const { importedSnapshots, result } = await executeBackfill({
    id: "sleep-cycle-1",
    connectionId: "provider-garmin-1",
    start: "2026-04-02T01:00:00.000Z",
    end: "2026-04-02T02:00:00.000Z",
    stages: [
      {
        stage: "light",
        startAt: "2026-04-02T01:00:00.000Z",
        endAt: "2026-04-02T02:00:00.000Z",
      },
    ],
  });

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_complete",
    junctionHistoricalBackfillEmptyAttempts: 0,
    junctionHistoricalBackfillLastEmptyAt: null,
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertFullTimeseriesContinuation(result);
  assert.equal(importedSnapshots.length, 1);
});

test("Junction sleep-cycle id-only historical backfill keeps retrying", async () => {
  const { importedSnapshots, result } = await executeBackfill({
    id: "sleep-cycle-empty-1",
    connectionId: "provider-garmin-1",
  });

  assert.deepEqual(result.metadataPatch, {
    junctionHistoricalBackfillStatus: "coverage_v3_retrying",
    junctionHistoricalBackfillEmptyAttempts: 1,
    junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
    junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
    junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
  });
  assertConnectBackfillRetryWake(result);
  assert.equal(importedSnapshots.length, 1);
});

test("Junction sleep-cycle stage duration without a canonical interval keeps retrying", async () => {
  const { importedSnapshots, result } = await executeBackfill({
    id: "sleep-cycle-duration-1",
    connectionId: "provider-garmin-1",
    stages: [{ stage: "deep", durationMinutes: 40 }],
  });

  assert.equal(result.metadataPatch?.junctionHistoricalBackfillStatus, "coverage_v3_retrying");
  assertConnectBackfillRetryWake(result);
  assert.equal(importedSnapshots.length, 1);
});

for (const stageCount of [4, 0, -1]) {
  test(`Junction sleep-cycle stageCount ${stageCount} historical backfill keeps retrying`, async () => {
    const { importedSnapshots, result } = await executeBackfill({
      id: `sleep-cycle-stage-count-${stageCount}`,
      connectionId: "provider-garmin-1",
      stageCount,
    });

    assert.deepEqual(result.metadataPatch, {
      junctionHistoricalBackfillStatus: "coverage_v3_retrying",
      junctionHistoricalBackfillEmptyAttempts: 1,
      junctionHistoricalBackfillLastEmptyAt: "2026-04-03T00:00:00.000Z",
      junctionHistoricalBackfillWindowStart: "2026-04-01T00:00:00.000Z",
      junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
    });
    assertConnectBackfillRetryWake(result);
    assert.equal(importedSnapshots.length, 1);
  });
}

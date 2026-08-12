import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eventRevisionFromLifecycle } from "@murphai/contracts";
import * as coreRuntime from "@murphai/core";
import {
  createJunctionDeviceSyncProvider,
  DeviceSyncError,
  type DeviceConnectionSourceRecord,
  type DeviceSyncAccount,
  type DeviceSyncJobRecord,
  type ProviderJobContext,
} from "@murphai/device-syncd";
import { importDeviceProviderSnapshot } from "@murphai/importers";
import { test } from "vitest";

type CanonicalImportResult = Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>;
type StoredJsonlRecord = Awaited<ReturnType<typeof coreRuntime.readJsonlRecords>>[number];

function createAccount(): DeviceSyncAccount {
  return {
    id: "acct-junction-partial-success",
    provider: "junction",
    externalAccountId: "junction-user-partial-success",
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
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createBackfillJob(): DeviceSyncJobRecord {
  return {
    id: "job-junction-partial-success",
    provider: "junction",
    accountId: "acct-junction-partial-success",
    kind: "backfill",
    payload: {
      windowStart: "2026-04-02T00:00:00.000Z",
      windowEnd: "2026-04-03T00:00:00.000Z",
    },
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

function eventHasMetric(record: StoredJsonlRecord, metric: string): boolean {
  if (record.kind === "observation") {
    return record.metric === metric;
  }
  if (record.kind !== "measurement") {
    return false;
  }
  return Array.isArray(record.measurements) && record.measurements.some((measurement) =>
    typeof measurement === "object"
    && measurement !== null
    && !Array.isArray(measurement)
    && Reflect.get(measurement, "metric") === metric
  );
}

test("Junction clinical daily retries stop at the failed resource and replay healthy facts idempotently", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-junction-partial-success-"));
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-01T00:00:00.000Z",
      timezone: "UTC",
    });

    let inhalerEndpointAvailable = false;
    let inhalerRequestCount = 0;
    let sleepApneaRequestCount = 0;
    const provider = createJunctionDeviceSyncProvider({
      apiKey: "sk_us_test_123",
      clientUserIdSecret: "junction-client-user-id-secret",
      environment: "sandbox",
      region: "us",
      summaryResources: ["activity"],
      timeseriesResources: ["fall", "inhaler_usage", "sleep_apnea_alert"],
      timeseriesBackfillDays: 1,
      fetchImpl: async (input) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input : input.url,
        );
        if (url.pathname === "/v2/user/providers/junction-user-partial-success") {
          return Response.json({
            providers: [{
              id: "provider-garmin-1",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: {
                fall: true,
                inhaler_usage: true,
                sleep_apnea_alert: true,
              },
            }],
          });
        }
        if (
          url.pathname.startsWith("/v2/summary/")
          && url.pathname.endsWith("/junction-user-partial-success")
        ) {
          return Response.json({ data: [] });
        }
        if (url.pathname === "/v2/timeseries/junction-user-partial-success/fall/grouped") {
          return Response.json({
            groups: {
              garmin: [{
                data: [{
                  id: "fall-stable",
                  start: "2026-04-02T08:00:00.000Z",
                  end: "2026-04-02T08:00:10.000Z",
                  unit: "count",
                  value: 1,
                }],
                source: { provider: "garmin", type: "watch" },
              }],
            },
          });
        }
        if (url.pathname === "/v2/timeseries/junction-user-partial-success/sleep_apnea_alert/grouped") {
          sleepApneaRequestCount += 1;
          return Response.json({
            groups: {
              garmin: [{
                data: [{
                  id: "sleep-apnea-alert-stable",
                  start: "2026-04-02T10:00:00.000Z",
                  end: "2026-04-02T10:00:10.000Z",
                  unit: "count",
                  value: 1,
                }],
                source: { provider: "garmin", type: "watch" },
              }],
            },
          });
        }
        if (url.pathname === "/v2/timeseries/junction-user-partial-success/inhaler_usage/grouped") {
          inhalerRequestCount += 1;
          if (!inhalerEndpointAvailable) {
            return new Response(JSON.stringify({ error: "temporarily_unavailable" }), {
              status: 503,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": "0",
              },
            });
          }
          return Response.json({
            groups: {
              garmin: [{
                data: [{
                  id: "inhaler-usage-stable",
                  start: "2026-04-02T09:00:00.000Z",
                  end: "2026-04-02T09:00:10.000Z",
                  unit: "count",
                  value: 1,
                }],
                source: { provider: "garmin", type: "watch" },
              }],
            },
          });
        }
        throw new Error(`Unexpected Junction request path: ${url.pathname}`);
      },
    });
    const executor = provider.jobExecutor;
    assert.ok(executor);

    const account = createAccount();
    const importResults: CanonicalImportResult[] = [];
    const projectedSources: DeviceConnectionSourceRecord[] = [];
    const context: ProviderJobContext = {
      account,
      now: "2026-04-03T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        const result = await importDeviceProviderSnapshot<CanonicalImportResult>(
          { provider: "junction", snapshot, vaultRoot },
          { corePort: coreRuntime },
        );
        importResults.push(result);
        return {
          canonicalEventCount: result.events.length,
          canonicalEventExternalRefResourceIds: result.events.flatMap((event) =>
            event.externalRef?.resourceId ? [event.externalRef.resourceId] : []
          ),
          durableDeliveryAccepted: true,
        };
      },
      upsertConnectionSource: (input) => {
        const existing = projectedSources.find((source) =>
          source.sourceInstanceKey === input.sourceInstanceKey
        );
        const next: DeviceConnectionSourceRecord = {
          id: existing?.id ?? "source-garmin",
          connectionId: account.id,
          sourceInstanceKey: input.sourceInstanceKey,
          sourceProviderSlug: input.sourceProviderSlug,
          displayName: input.displayName ?? existing?.displayName ?? null,
          status: input.status,
          resourceAvailabilitySummary:
            input.resourceAvailabilitySummary ?? existing?.resourceAvailabilitySummary ?? {},
          lastErrorCode: input.lastErrorCode ?? null,
          lastErrorMessage: input.lastErrorMessage ?? null,
          firstSeenAt: input.firstSeenAt ?? existing?.firstSeenAt ?? input.lastSeenAt,
          lastSeenAt: input.lastSeenAt,
          lastDataAt: input.lastDataAt ?? existing?.lastDataAt ?? null,
          createdAt: existing?.createdAt ?? input.lastSeenAt,
          updatedAt: input.lastSeenAt,
        };
        if (existing) {
          projectedSources[projectedSources.indexOf(existing)] = next;
        } else {
          projectedSources.push(next);
        }
        return next;
      },
      listConnectionSources: async (input = {}) => projectedSources.filter((source) =>
        (!input.sourceProviderSlug || source.sourceProviderSlug === input.sourceProviderSlug)
        && (!input.status || source.status === input.status)
      ),
      refreshAccountTokens: async () => account,
      logger: {},
    };
    const job = createBackfillJob();

    await assert.rejects(
      () => executor.executeJob(context, job),
      (error: unknown) =>
        error instanceof DeviceSyncError
        && error.code === "JUNCTION_API_REQUEST_FAILED"
        && error.retryable,
    );

    assert.equal(inhalerRequestCount, 3);
    assert.equal(sleepApneaRequestCount, 0);
    assert.equal(importResults.length, 1);
    assert.equal(account.metadata.junctionHistoricalBackfillStatus, undefined);
    const firstImport = importResults[0];
    assert.ok(firstImport?.applied);
    assert.ok(firstImport.ingestId);
    const firstIngest = await coreRuntime.readIntegrationIngestById(vaultRoot, firstImport.ingestId);
    assert.ok(firstIngest);
    assert.equal(
      firstIngest.record.parts.some((part) => part.role.includes("inhaler-usage")),
      false,
    );
    assert.equal(
      firstIngest.record.parts.some((part) => part.role.includes("sleep-apnea-alert")),
      false,
    );
    const firstRecords = (
      await Promise.all(firstImport.eventShardPaths.map((relativePath) =>
        coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
      ))
    ).flat();
    const firstFallRecords = firstRecords.filter((record) => eventHasMetric(record, "fall"));
    assert.equal(firstFallRecords.length, 1);
    assert.equal(firstRecords.some((record) => eventHasMetric(record, "inhaler-usage")), false);
    assert.equal(firstRecords.some((record) => eventHasMetric(record, "sleep-apnea-alert")), false);

    inhalerEndpointAvailable = true;
    await executor.executeJob(context, job);

    assert.equal(inhalerRequestCount, 4);
    assert.equal(sleepApneaRequestCount, 1);
    assert.equal(importResults.length, 4);
    assert.equal(importResults[1]?.applied, false);
    assert.equal(importResults[1]?.events.length, 1);
    assert.equal(importResults[2]?.applied, true);
    assert.equal(importResults[3]?.applied, true);
    const allPaths = [...new Set(importResults.flatMap((result) => result.eventShardPaths))];
    const allRecords = (
      await Promise.all(allPaths.map((relativePath) =>
        coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
      ))
    ).flat();
    for (const firstRecord of firstFallRecords) {
      const retainedRows = allRecords.filter((record) => record.id === firstRecord.id);
      assert.deepEqual(
        retainedRows.map((record) => eventRevisionFromLifecycle(record.lifecycle)),
        [1],
      );
    }
    const inhalerRecords = allRecords.filter((record) => eventHasMetric(record, "inhaler-usage"));
    assert.equal(inhalerRecords.length, 1);
    assert.equal(eventRevisionFromLifecycle(inhalerRecords[0]?.lifecycle), 1);
    const sleepApneaRecords = allRecords.filter((record) =>
      eventHasMetric(record, "sleep-apnea-alert")
    );
    assert.equal(sleepApneaRecords.length, 1);
    assert.equal(eventRevisionFromLifecycle(sleepApneaRecords[0]?.lifecycle), 1);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("Junction clinical daily resource imports share one replay-stable admitted-reading budget", async () => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "murph-junction-clinical-daily-budget-"));
  try {
    await coreRuntime.initializeVault({
      vaultRoot,
      createdAt: "2026-04-01T00:00:00.000Z",
      timezone: "UTC",
    });

    const fallReadings = Array.from({ length: 120 }, (_, index) => {
      const start = new Date(Date.UTC(2026, 3, 2, 0, index)).toISOString();
      return {
        id: `fall-budget-${index}`,
        start,
        end: new Date(Date.parse(start) + 10_000).toISOString(),
        unit: "count",
        value: 1,
      };
    });
    let inhalerRequestCount = 0;
    const provider = createJunctionDeviceSyncProvider({
      apiKey: "sk_us_test_123",
      clientUserIdSecret: "junction-client-user-id-secret",
      environment: "sandbox",
      region: "us",
      summaryResources: [],
      timeseriesResources: ["fall", "inhaler_usage"],
      timeseriesBackfillDays: 1,
      fetchImpl: async (input) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input : input.url,
        );
        if (url.pathname === "/v2/user/providers/junction-user-partial-success") {
          return Response.json({
            providers: [{
              id: "provider-garmin-clinical-budget",
              slug: "garmin",
              name: "Garmin",
              status: "connected",
              resource_availability: { fall: true, inhaler_usage: true },
            }],
          });
        }
        if (
          url.pathname.startsWith("/v2/summary/")
          && url.pathname.endsWith("/junction-user-partial-success")
        ) {
          return Response.json({ data: [] });
        }
        if (url.pathname === "/v2/timeseries/junction-user-partial-success/fall/grouped") {
          return Response.json({
            groups: {
              garmin: [{
                data: fallReadings,
                source: { provider: "garmin", type: "watch" },
              }],
            },
          });
        }
        if (url.pathname === "/v2/timeseries/junction-user-partial-success/inhaler_usage/grouped") {
          inhalerRequestCount += 1;
          return Response.json({
            groups: {
              garmin: [{
                data: [{
                  id: "inhaler-after-daily-budget",
                  start: "2026-04-02T12:00:00.000Z",
                  end: "2026-04-02T12:00:10.000Z",
                  unit: "count",
                  value: 1,
                }],
                source: { provider: "garmin", type: "watch" },
              }],
            },
          });
        }
        throw new Error(`Unexpected Junction request path: ${url.pathname}`);
      },
    });
    const executor = provider.jobExecutor;
    assert.ok(executor);

    const account = createAccount();
    const importResults: CanonicalImportResult[] = [];
    const observedLimits: unknown[] = [];
    const context: ProviderJobContext = {
      account,
      now: "2026-04-03T00:00:00.000Z",
      importSnapshot: async (snapshot) => {
        observedLimits.push(
          (snapshot as { sparseClinicalReadingLimit?: unknown }).sparseClinicalReadingLimit,
        );
        const result = await importDeviceProviderSnapshot<CanonicalImportResult>(
          { provider: "junction", snapshot, vaultRoot },
          { corePort: coreRuntime },
        );
        importResults.push(result);
        return {
          canonicalEventCount: result.events.length,
          canonicalEventExternalRefResourceIds: result.events.flatMap((event) =>
            event.externalRef?.resourceId ? [event.externalRef.resourceId] : []
          ),
          durableDeliveryAccepted: true,
        };
      },
      refreshAccountTokens: async () => account,
      logger: {},
    };
    const job = createBackfillJob();

    await executor.executeJob(context, job);
    await executor.executeJob(context, job);

    assert.deepEqual(observedLimits, [100, 100]);
    assert.equal(inhalerRequestCount, 0);
    assert.equal(importResults.length, 2);
    assert.equal(importResults[0]?.applied, true);
    assert.equal(importResults[0]?.events.length, 100);
    assert.equal(importResults[1]?.applied, false);
    assert.equal(importResults[1]?.events.length, 100);
    const eventPaths = [...new Set(importResults.flatMap((result) => result.eventShardPaths))];
    const records = (
      await Promise.all(eventPaths.map((relativePath) =>
        coreRuntime.readJsonlRecords({ vaultRoot, relativePath })
      ))
    ).flat();
    const fallRecords = records.filter((record) => eventHasMetric(record, "fall"));
    assert.equal(fallRecords.length, 100);
    assert.equal(records.some((record) => eventHasMetric(record, "inhaler-usage")), false);
    assert.ok(fallRecords.every((record) => eventRevisionFromLifecycle(record.lifecycle) === 1));
    const firstIngestId = importResults[0]?.ingestId;
    assert.ok(firstIngestId);
    const firstIngest = await coreRuntime.readIntegrationIngestById(vaultRoot, firstIngestId);
    assert.ok(firstIngest);
    assert.equal(
      firstIngest.record.parts.some((part) =>
        part.role === "junction-timeseries-reading-sparse-clinical:bounded-overflow"
      ),
      true,
    );
    assert.doesNotMatch(JSON.stringify(firstIngest.record), /fall-budget-|sparseClinicalReadingLimit/u);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

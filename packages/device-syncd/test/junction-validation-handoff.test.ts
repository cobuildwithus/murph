import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { test } from "vitest";
import {
  createJob,
  createJobFromInput,
  createJunctionJobContext,
  createJunctionProvider,
  executeJunctionJob,
} from "./junction-provider.harness.ts";
import { createJsonResponse, makeTempDirectory, readUrl } from "./helpers.ts";
import { createDeviceSyncService, SqliteDeviceSyncStore } from "../src/service.ts";
import { JunctionTimeseriesProgressError } from "../src/junction-timeseries-progress.ts";

const ECG_BINDING_CODE = "JUNCTION_ECG_RECORDING_BINDING_INCOMPLETE";

// One recording on 2026-04-01 advertises two samples while the voltage
// endpoint returns one, which is the binding failure the service retains.
// Every other day has no recordings. `voltageStatus` swaps the inconsistent
// response for a provider error to prove the handoff stays narrow.
function createEcgProvider(counts: { summary: number; voltage: number }, options: {
  voltageStatus?: number;
} = {}) {
  return createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    if (url.pathname === "/v2/user/providers/junction-user-1") {
      return createJsonResponse({
        providers: [{
          id: "provider-apple-health-1",
          slug: "apple_health_kit",
          name: "Apple Health",
          status: "connected",
          resource_availability: { electrocardiogram_voltage: true },
        }],
      });
    }
    if (url.pathname.includes("/summary/electrocardiogram/")) {
      counts.summary += 1;
      const startsOnFirstDay = (url.searchParams.get("start_date") ?? "").startsWith("2026-04-01");
      return createJsonResponse({
        electrocardiogram: startsOnFirstDay
          ? [{
              id: "ecg-recording-a",
              session_start: "2026-04-01T12:00:00.000Z",
              session_end: "2026-04-01T12:01:00.000Z",
              voltage_sample_count: 2,
              source_provider: "apple_health_kit",
              source_type: "watch",
              source_device_id: "watch-a",
              source: { provider: "apple_health_kit", type: "watch", device_id: "watch-a" },
            }]
          : [],
      });
    }
    if (url.pathname.includes("/electrocardiogram_voltage/grouped")) {
      counts.voltage += 1;
      if (options.voltageStatus) {
        return createJsonResponse({ detail: "Temporarily unavailable" }, options.voltageStatus);
      }
      return createJsonResponse({
        groups: {
          apple_health_kit: [{
            source: { provider: "apple_health_kit", type: "watch", device_id: "watch-a" },
            data: [{
              timestamp: "2026-04-01T12:00:00.000Z",
              type: "lead_i",
              unit: "mV",
              value: 0.1,
            }],
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url.toString()}`);
  }, {
    summaryResources: [],
    timeseriesResources: ["electrocardiogram_voltage"],
  });
}

function createEcgContinuationJob(kind: "backfill" | "reconcile") {
  return createJob(kind, {
    windowStart: "2026-04-01T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
    timeseriesCursor: "2026-04-01T00:00:00.000Z",
    timeseriesResourceCursor: "electrocardiogram_voltage",
  });
}

test.each(["reconcile", "backfill"] as const)(
  "Junction %s continuation hands an inconsistent ECG day to a retained resource job and continues",
  async (kind) => {
    const counts = { summary: 0, voltage: 0 };
    const provider = createEcgProvider(counts);
    const context = createJunctionJobContext();

    const first = await executeJunctionJob(provider, context, createEcgContinuationJob(kind));

    assert.equal(counts.summary, 1);
    assert.equal(counts.voltage, 1);
    assert.equal(first.scheduledJobs?.length, 2);
    const [continuation, handoff] = first.scheduledJobs ?? [];
    assert.equal(continuation?.kind, kind);
    assert.equal(continuation?.payload?.timeseriesResourceCursor, "electrocardiogram_voltage");
    assert.equal(continuation?.payload?.timeseriesCursor, "2026-04-02T00:00:00.000Z");
    assert.equal(handoff?.kind, "resource");
    assert.deepEqual(handoff?.payload, {
      resource: "electrocardiogram_voltage",
      resourceCategory: "timeseries",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-02T00:00:00.000Z",
    });
    assert.equal(handoff?.availableAt, context.now);
    assert.equal(handoff?.priority, 50);
    assert.equal(typeof handoff?.dedupeKey, "string");
    assert.ok(first.nextReconcileAt, "the full job keeps its reconcile schedule");

    // The same inconsistent day hands off to the same job on a later pass.
    const replay = await executeJunctionJob(provider, context, createEcgContinuationJob(kind));
    assert.equal(replay.scheduledJobs?.[1]?.dedupeKey, handoff?.dedupeKey);

    // The full job finishes the remaining window without touching the failed day.
    const second = await executeJunctionJob(
      provider,
      context,
      createJobFromInput(JSON.parse(JSON.stringify(continuation)), 1),
    );
    assert.equal(second.scheduledJobs, undefined);
    assert.equal(counts.summary, 3);
    assert.equal(counts.voltage, 2);

    // The handoff job replays the exact failing window and surfaces the same
    // retained validation failure to the service.
    await assert.rejects(
      executeJunctionJob(provider, context, createJobFromInput(JSON.parse(JSON.stringify(handoff)), 2)),
      (error) => {
        assert.ok(error instanceof JunctionTimeseriesProgressError);
        assert.equal(error.failure.code, ECG_BINDING_CODE);
        return true;
      },
    );
    assert.equal(counts.summary, 4);
    assert.equal(counts.voltage, 3);
  },
);

test("Junction reconcile continuation keeps failing on provider errors instead of handing them off", async () => {
  const counts = { summary: 0, voltage: 0 };
  const provider = createEcgProvider(counts, { voltageStatus: 503 });

  await assert.rejects(
    executeJunctionJob(provider, createJunctionJobContext(), createEcgContinuationJob("reconcile")),
    { code: "JUNCTION_API_REQUEST_FAILED", retryable: true },
  );
});

test("device sync service completes a Junction reconcile around a retained ECG handoff", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-validation-handoff");
  const stateDatabasePath = path.join(vaultRoot, "device-sync.sqlite");
  const counts = { summary: 0, voltage: 0 };
  const now = new Date("2026-04-03T12:00:00.000Z");
  const store = new SqliteDeviceSyncStore(stateDatabasePath);
  const service = createDeviceSyncService({
    secret: "synthetic-device-sync-secret",
    config: { vaultRoot, stateDatabasePath, publicBaseUrl: "https://sync.example.test" },
    store,
    clock: { now: () => now },
    providers: [createEcgProvider(counts)],
  });
  try {
    const account = store.upsertAccount({
      provider: "junction", externalAccountId: "junction-user-1",
      displayName: "Junction", scopes: [], status: "active",
      credential: { kind: "provider_config", providerConfigKey: "junction", credentialMetadata: {} },
      connectedAt: "2026-04-01T00:00:00.000Z", nextReconcileAt: null,
    });
    // The window ends on the current closed day so a completed reconcile may
    // stamp the sync-complete marker under the existing rule.
    const parent = store.enqueueJob({
      accountId: account.id, provider: "junction", kind: "reconcile",
      availableAt: now.toISOString(), priority: 80, dedupeKey: "synthetic-reconcile",
      payload: {
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-04-03T00:00:00.000Z",
        timeseriesCursor: "2026-04-01T00:00:00.000Z",
        timeseriesResourceCursor: "electrocardiogram_voltage",
      },
    });

    // Day one hands off; the parent completes with the continuation and the
    // handoff both pending, so the marker is still preserved.
    await service.runWorkerOnce(account.id);
    assert.equal(store.getJobById(parent.id)?.status, "succeeded");
    assert.equal(store.getAccountById(account.id)?.lastSyncCompletedAt, null);
    const pending = store.listPendingJobsForAccount(account.id, 3);
    assert.equal(pending.length, 2);
    const continuation = pending.find((job) => job.kind === "reconcile");
    const handoff = pending.find((job) => job.kind === "resource");
    assert.ok(continuation && handoff);
    assert.equal(continuation.payload.timeseriesCursor, "2026-04-02T00:00:00.000Z");
    assert.deepEqual(handoff.payload, {
      resource: "electrocardiogram_voltage",
      resourceCategory: "timeseries",
      windowStart: "2026-04-01T00:00:00.000Z",
      windowEnd: "2026-04-02T00:00:00.000Z",
    });

    // The continuation finishes day two and completes the reconcile; the
    // handoff fails the same way and is retained for a 30-minute recheck.
    await service.runWorkerOnce(account.id);
    await service.runWorkerOnce(account.id);
    assert.equal(store.getJobById(continuation.id)?.status, "succeeded");
    assert.equal(store.getAccountById(account.id)?.lastSyncCompletedAt, now.toISOString());
    const retained = store.getJobById(handoff.id);
    assert.ok(retained);
    assert.equal(retained.status, "queued");
    assert.equal(retained.lastErrorCode, ECG_BINDING_CODE);
    assert.equal(retained.attempts, 1);
    assert.equal(Date.parse(retained.availableAt), now.getTime() + 30 * 60_000);
    assert.deepEqual(retained.payload, handoff.payload);
    assert.equal(store.listPendingJobsForAccount(account.id, 3).length, 1);
    assert.equal(counts.summary, 3);
    assert.equal(counts.voltage, 2);
    assert.equal(await service.runWorkerOnce(account.id), null);
  } finally {
    service.close();
    store.close();
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

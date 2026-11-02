import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliCompressSync } from "node:zlib";
import { test, vi } from "vitest";
import { buildIntegrationIngestRecord, initializeVault, readIntegrationIngestEntries } from "@murphai/core";
import { buildJunctionProviderSourceInstanceKey } from "@murphai/device-syncd/connect-config";
import { SqliteDeviceSyncStore } from "@murphai/device-syncd/service";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import type { HostedRuntimeDeviceSyncPort } from "../src/hosted-runtime-contracts.ts";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { writeHostedMediaReferenceCatalogue, readHostedMediaReferenceCatalogue } from "../src/hosted-runtime/media-references.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import {
  TEST_NOW, TEST_USER_ID, createDeviceSyncResolvedConfig, createMailboxItem,
  createMailboxPort, createPlatform, createResolvedDeviceSyncSystemMailboxItem,
  createSnapshotDeviceSyncPort, createVaultSnapshotBundle, createWorkspacePort,
  createWorkspaceRuntimeJobInput, createWorkspaceState, removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess, writeMailboxImportStateFile,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

test.each(["available", "unavailable"] as const)(
  "system mailbox Junction backfill thaws prior-month history before durable payload ack (%s)",
  async (availability) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "synthetic-cold-mailbox-"));
    const connectionId = "synthetic-junction-connection";
    const windowStart = "2026-03-20T00:00:00.000Z";
    const windowEnd = "2026-03-21T00:00:00.000Z";
    const relativePath = "ledger/integration-ingests/2026/2026-03.jsonl.br";
    const prior = buildIntegrationIngestRecord({ id: "xfm_prior", provider: "synthetic", source: "device",
      importedAt: windowStart, parts: [], eventOutputs: [], eventIdsComplete: true,
      sampleIds: [], sampleIdsComplete: true, eventCount: 0, sampleCount: 0 });
    const bytes = brotliCompressSync(Buffer.from(`${JSON.stringify(prior)}\n`));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const cold = { relativePath, mediaKind: "integration-ingest" as const, expiresAt: null,
      mediaId: sha256, sha256, byteSize: bytes.length,
      mimeType: "application/octet-stream", recordedAt: windowStart };
    const objects = new Map([[sha256, bytes]]);
    const checkpoints: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const acks: Parameters<HostedRuntimeDeviceSyncPort["ackDirtyStateProcessed"]>[0][] = [];
    const failJob = vi.spyOn(SqliteDeviceSyncStore.prototype, "failJobIfOwned");
    const base = createSnapshotDeviceSyncPort({ connectionId, nextReconcileAt: "2099-01-01T00:00:00.000Z" });
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...base,
      async fetchSnapshot(request) {
        const snapshot = await base.fetchSnapshot(request);
        return { ...snapshot, connections: snapshot.connections.map((entry) => ({
          ...entry,
          connection: { ...entry.connection, provider: "junction", externalAccountId: "synthetic-junction",
            metadata: { junctionHistoricalBackfillStatus: "coverage_v3_complete" } },
          sources: [{ displayName: "Garmin", firstSeenAt: "2026-03-01T00:00:00.000Z", lastDataAt: null,
            lastErrorCode: null, lastErrorMessage: null, lastSeenAt: TEST_NOW, resourceCount: 1,
            resourceAvailabilitySummary: { activity: true },
            sourceInstanceKey: buildJunctionProviderSourceInstanceKey({ connectionId, sourceProviderSlug: "garmin" })!,
            sourceProviderSlug: "garmin", status: "connected" as const }],
          credential: { kind: "provider_config" as const, providerConfigKey: "junction", credentialMetadata: {} },
        })) };
      },
      async fetchDirtyStates() {
        return { hasMore: false, nextWakeAt: null, userId: TEST_USER_ID,
          items: acks.some((ack) => ack.processedDirtyPayloadIds?.includes("synthetic-payload")) ? [] : [{
            connectionId, dirtyRevision: "7", processedRevision: "0", eventCount: "1",
            latestDirtyAt: TEST_NOW, provider: "junction", userId: TEST_USER_ID,
            resourceCategoryCounts: { summary: 1 }, sourceProviderCounts: { garmin: 1 }, windowStart, windowEnd,
            dirtyResources: [{ count: 1, dirtyPayloadId: "synthetic-payload", jobKind: "backfill",
              payload: { sourceProviderSlug: "garmin", windowStart, windowEnd },
              resource: "activity", resourceCategory: "summary", sourceProviderSlug: "garmin", windowStart, windowEnd }],
          }] };
      },
      async ackDirtyStateProcessed(request) {
        if (request.processedDirtyPayloadIds?.includes("synthetic-payload")) {
          assert.ok(checkpoints.some((entry) => entry.reason === "idle_shutdown"), "payload ack follows durable snapshot");
          assert.ok((await readIntegrationIngestEntries(vaultRoot)).some((entry) => entry.record.provider === "junction"));
        }
        acks.push(request);
        return { connectionId, dirtyRevision: "7", processedRevision: request.processedRevision,
          recorded: true, stillDirty: false, nextWakeAt: null, userId: TEST_USER_ID };
      },
    };
    const providerFetch: typeof fetch = async (request) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      assert.equal(url.hostname, "api.sandbox.us.junction.com");
      if (url.pathname.startsWith("/v2/user/providers/")) return Response.json({ providers: [{
        id: "synthetic-garmin", slug: "garmin", name: "Garmin", status: "connected",
        resource_availability: { activity: true },
      }] });
      if (url.pathname.startsWith("/v2/timeseries/")) return Response.json({ groups: {} });
      assert.ok(url.pathname.startsWith("/v2/summary/"), url.pathname);
      if (!url.pathname.startsWith("/v2/summary/activity/")) return Response.json({ data: [] });
      return Response.json({ data: [{ id: "synthetic-activity", observedAt: "2026-03-20T12:00:00.000Z", steps: 1200 }] });
    };
    const get = vi.fn(async (entry: { mediaId: string }) => {
      if (availability === "unavailable") throw new Error("Synthetic media outage");
      return objects.get(entry.mediaId) ?? null;
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(TEST_NOW));
    vi.stubGlobal("fetch", providerFetch);
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot, timezone: "UTC" });
      await writeHostedMediaReferenceCatalogue({ vaultRoot,
        catalogue: { schema: "murph.hosted-media-refs.v1", entries: [cold] } });
      const item = createMailboxItem({ id: "synthetic-cold-item", dedupeKey: "device-sync.wake:cold",
        kind: "device-sync.wake", lane: "system", laneSeq: "1" });
      await enqueueHostedSystemMailboxItem({ item: createResolvedDeviceSyncSystemMailboxItem(item), vaultRoot,
        wake: { connectionId, eventId: item.dedupeKey, expectedConnectedAt: TEST_NOW,
          hint: { occurredAt: TEST_NOW, reason: "webhook_dirty_transition" },
          kind: "device-sync.wake", occurredAt: TEST_NOW, provider: "junction",
          reason: "webhook_hint", userId: TEST_USER_ID } });
      const state = createEmptyHostedMailboxImportState();
      state.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, state);
      const initial = await createVaultSnapshotBundle({ vaultRoot });
      const config = createDeviceSyncResolvedConfig();
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({ request: { processingMode: "system_mailbox", workspaceVersion: "0", runnerIdleTtlMs: 1 },
          resolvedConfig: { ...config, deviceSync: { ...config.deviceSync!, providerConfigs: {
            junction: { environment: "sandbox", region: "us", summaryResources: ["activity"] },
          } } },
          platformEnv: { JUNCTION_API_KEY: "sk_us_test_synthetic", JUNCTION_CLIENT_USER_ID_SECRET: "synthetic-secret", JUNCTION_ENV: "sandbox", JUNCTION_REGION: "us" },
        }), {
          vaultRoot,
          platform: { ...createPlatform({ artifactBytesByHash: new Map([[initial.hash, initial.bytes]]), deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({ events, checkpointRequests: checkpoints,
              workspace: createWorkspaceState({ snapshotRef: initial.snapshotRef, version: "0" }) }),
          }), providerFetch, mediaStore: { get, put: async () => {} } },
          async createCheckpointSnapshot() {
            assert.equal(acks.flatMap((ack) => ack.processedDirtyPayloadIds ?? []).length, 0);
            return { snapshotRef: (await createVaultSnapshotBundle({ vaultRoot })).snapshotRef };
          },
          async importItem() { throw new Error("Mailbox item already staged"); },
          async runAssistantPhase() { throw new Error("Device mailbox work must remain model-free"); },
        },
      );
      const failure = failJob.mock.calls.find((call) => call[3] === "HOSTED_COLD_HISTORY_UNAVAILABLE");
      if (failure) {
        assert.equal(failure[6], true, "retryable");
        assert.equal(failure[7], true, "retain accepted work beyond the retry budget");
        const transition = failJob.mock.results[failJob.mock.calls.indexOf(failure)]!;
        assert.equal(transition.type, "return");
        assert.equal(transition.value?.disposition, "queued");
        assert.equal(result.status, "scheduled");
        assert.deepEqual(acks.flatMap((ack) => ack.processedDirtyPayloadIds ?? []), []);
      }
      if (availability === "available") {
        assert.equal(failure, undefined, "available cold history must not fail the backfill");
        assert.ok(get.mock.calls.length > 0, "the invocation must download the cold month");
        const records = await readIntegrationIngestEntries(vaultRoot);
        assert.ok(records.some((entry) => entry.record.id === prior.id));
        assert.ok(records.some((entry) => entry.record.provider === "junction" && entry.record.importedAt.startsWith("2026-03")));
        assert.deepEqual(acks.flatMap((ack) => ack.processedDirtyPayloadIds ?? []), ["synthetic-payload"]);
        assert.deepEqual((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries, []);
      } else {
        assert.ok(get.mock.calls.length > 0, "the media outage must be exercised");
        assert.ok(failure, "media outage must reach the real job owner as a cold-history failure");
        assert.deepEqual((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries, [cold]);
        await assert.rejects(readFile(path.join(vaultRoot, relativePath)), { code: "ENOENT" });
      }
    } finally {
      failJob.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers(); await removeTempRoot(vaultRoot);
    }
  },
);

import {
  TEST_NOW,
  TEST_USER_ID,
  createDeviceSyncResolvedConfig,
  createDeferred,
  createDeviceSyncSystemWakeForMailboxItem,
  createEmptyDeviceSyncPort,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createResolvedDeviceSyncSystemMailboxItem,
  createSnapshotDeviceSyncPort,
  buildJunctionSleepFixtureResponse,
  createVaultSnapshotBundle,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess,
  withRealTimeout,
  writeMailboxImportStateFile,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import { buildHostedExecutionMealPhotoCapturedWake } from "@murphai/hosted-execution";
import type {
  HostedRuntimeLogRequest,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { expect, test, vi } from "vitest";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { createNoopMailboxEffect } from "../src/hosted-runtime/events/mailbox-outcome.ts";
import { executeHostedManualMealPhotoWake } from "../src/hosted-runtime/events/assistant-notification.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
  resolveHostedSystemMailboxProgress,
  resolveHostedSystemMailboxWakeCandidates,
  updateHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import { runHostedWorkspaceAssistantPhase } from "../src/hosted-runtime/workspace-assistant-phase.ts";
import { resolveHostedSystemMailboxFirstPendingDiagnostics } from "../src/hosted-runtime/system-mailbox-diagnostics.ts";
import { createHostedWorkspaceBridgeMailboxImporter } from "../src/hosted-runtime/snapshot-bridge-mailbox.ts";

const preparationObserver = vi.hoisted(() => vi.fn());
vi.mock("../src/hosted-runtime/system-mailbox.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/system-mailbox.ts")>();
  return {
    ...actual,
    prepareHostedSystemMailboxItemForCheckpoint: async (
      input: Parameters<typeof actual.prepareHostedSystemMailboxItemForCheckpoint>[0],
    ) => {
      const result = await actual.prepareHostedSystemMailboxItemForCheckpoint(input);
      if (input.pendingOnly && input.allowedRouteActions?.includes("run-device-sync-wake")) {
        preparationObserver();
      }
      return result;
    },
  };
});

vi.mock("../src/hosted-runtime/events/assistant-notification.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/hosted-runtime/events/assistant-notification.ts")>(),
  executeHostedManualMealPhotoWake: vi.fn(),
}));

test.each((["pending", "dirty-ack", "continuation", "retained-dirty-ack", "retained-due-dirty-ack", "retained-future-dirty-ack"] as const).flatMap(
  (shape) => (["fresh", "restored"] as const).map((arrival) => ({ shape, arrival })),
))(
  "runs a due manual meal with an older due device owner: $shape / $arrival",
  async ({ shape, arrival }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-meal-starvation-"));
    const events: string[] = [];
    const checkpoints: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const retainedAt = shape === "retained-future-dirty-ack"
      ? "2026-04-27T06:00:00.000Z" : "2026-04-27T00:00:30.000Z";
    const jobAvailableAt = shape === "retained-future-dirty-ack"
      ? "2026-04-28T05:00:00.000Z" : retainedAt;
    let now = TEST_NOW;
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:synthetic-meal-overlap",
      id: "device_synthetic_overlap", kind: "device-sync.wake", lane: "system", laneSeq: "1",
    });
    const mealItem = createMailboxItem({
      dedupeKey: "meal-photo:manual:" + "c".repeat(64),
      id: "meal_synthetic_overlap", kind: "meal-photo.captured", lane: "system", laneSeq: "2",
    });
    const photoBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const readMealPhoto = vi.fn(async () => photoBytes);
    const deleteMealPhoto = vi.fn(async () => { events.push("meal.photo-deleted"); });
    const mealWake = buildHostedExecutionMealPhotoCapturedWake({
      byteLength: 4, captureId: "c".repeat(64), capturedAt: TEST_NOW,
      directRoute: { channel: "linq", threadId: "synthetic_meal_chat" },
      eventId: mealItem.dedupeKey, mealPhotoKey: "synthetic_photo_key",
      memberId: TEST_USER_ID, occurredAt: TEST_NOW,
      sha256: createHash("sha256").update(photoBytes).digest("hex"),
    });
    const deviceSyncPort = shape === "retained-due-dirty-ack" ? createSnapshotDeviceSyncPort({
      connectionId: "device_sync_connection_synthetic", nextReconcileAt: "2026-04-27T00:10:00.000Z",
    }) : createEmptyDeviceSyncPort();
    if (shape === "retained-due-dirty-ack") {
      vi.stubGlobal("fetch", vi.fn(async (request: string | URL | Request) => {
        const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
        return new Response(JSON.stringify(buildJunctionSleepFixtureResponse(url.pathname)), {
          headers: { "content-type": "application/json" }, status: 200,
        });
      }));
    }
    deviceSyncPort.ackDirtyStateProcessed = async (request) => {
      events.push("device.dirty-ack");
      return {
        connectionId: request.connectionId, dirtyRevision: request.processedRevision,
        nextWakeAt: null, processedRevision: request.processedRevision,
        recorded: true, stillDirty: false, userId: TEST_USER_ID,
      };
    };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(TEST_NOW));
    vi.mocked(executeHostedManualMealPhotoWake).mockReset().mockImplementation(async () => {
      events.push("meal.notification");
      return createNoopMailboxEffect({ conversationMetrics: null, mailboxLane: "assistant-notification" });
    });
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncSystemMailboxItem(deviceItem), vaultRoot,
        wake: {
          ...createDeviceSyncSystemWakeForMailboxItem(deviceItem),
          kind: "device-sync.wake", reason: "reconcile_due",
          connectionId: "device_sync_connection_synthetic",
        },
      });
      // This is the local item produced by the meal importer after its canonical write.
      if (arrival === "restored") await enqueueHostedSystemMailboxItem({
        item: {
          item: mealItem,
          payload: { payloadCiphertext: "synthetic", payloadSchema: mealItem.payloadSchema,
            requestId: null, source: "inline", status: "resolved" },
          route: { action: "dispatch-assistant-notification", advanceProgress: true,
            itemRef: { id: mealItem.id, kind: mealItem.kind, lane: "system", laneSeq: "2" },
            state: "route" },
        },
        vaultRoot, wake: mealWake,
      });
      if (shape !== "pending") {
        await updateHostedSystemMailboxState(vaultRoot, (state) => ({
          pending: state.pending.map((item) => item.itemId !== deviceItem.id ? item : {
            ...item, attemptCount: 1, lastAttemptAt: TEST_NOW,
            ...(shape.startsWith("retained-") ? { deviceSyncContinuationOwner: true as const } : {}),
            ...(shape === "continuation" ? { deviceSyncContinuationOwner: true } : {
              status: "recording" as const,
              postCheckpointRecord: shape.startsWith("retained-") ? {
                kind: "device-sync.dirty-processed-batch" as const,
                nextWakeAt: jobAvailableAt,
                records: [{ connectionId: "device_sync_connection_synthetic",
                  processedDirtyPayloadIds: ["synthetic_dirty_payload"], processedRevision: "7" }],
                retainMailboxItemUntil: retainedAt,
                retainedWake: { ...createDeviceSyncSystemWakeForMailboxItem(deviceItem),
                  kind: "device-sync.wake" as const, reason: "reconcile_due" as const,
                  connectionId: "device_sync_connection_synthetic",
                  hint: { reason: "manual_reconcile", nextReconcileAt: retainedAt,
                    jobs: [{ kind: "resource", dedupeKey: "synthetic_history",
                    availableAt: jobAvailableAt, maxAttempts: 3,
                    payload: { resource: "sleep", resourceCategory: "summary", sourceProviderSlug: "whoop_v2",
                      windowStart: "2026-04-26T00:00:00.000Z", windowEnd: TEST_NOW } }] } },
              } : { kind: "device-sync.dirty-processed" as const,
                connectionId: "device_sync_connection_synthetic",
                processedDirtyPayloadIds: ["synthetic_dirty_payload"], processedRevision: "7" },
            }),
          }),
        }));
      }
      const imported = createEmptyHostedMailboxImportState();
      imported.watermarks.system = arrival === "fresh" ? "1" : "2";
      await writeMailboxImportStateFile(vaultRoot, imported);
      const candidates = await resolveHostedSystemMailboxWakeCandidates({ vaultRoot, now: () => TEST_NOW });
      if (arrival === "restored") {
        expect((await readHostedSystemMailboxState(vaultRoot)).pending.find(
          (item) => item.itemId === mealItem.id,
        )).toMatchObject({ routeAction: "dispatch-assistant-notification", nextAttemptAt: null });
        expect(candidates.defaultOwned).toMatchObject({ at: TEST_NOW, reason: "assistant" });
        if (shape.startsWith("retained-")) {
          const state = await readHostedSystemMailboxState(vaultRoot);
          const progress = resolveHostedSystemMailboxProgress({ importedSeq: "2", now, state });
          expect(progress).toMatchObject({ firstPendingSeq: "2", deviceSyncContinuationSeqs: ["1"] });
          expect(resolveHostedSystemMailboxFirstPendingDiagnostics({
            continuationSeqs: progress.deviceSyncContinuationSeqs,
            firstPendingSeq: progress.firstPendingSeq, now, state,
          })).toEqual(expect.arrayContaining(["headDue=true", "headDeviceSync=false"]));
        }
      }
      let workspace: HostedWorkspaceState = createWorkspaceState({
        nextWakeAt: TEST_NOW, nextWakeReason: "assistant",
        nextDefaultProcessingWakeAt: TEST_NOW, nextDefaultProcessingWakeReason: "assistant",
        systemMailboxProgressGeneration: "1",
      });
      const notificationsPerInvocation: number[] = [];
      const phases: unknown[] = [];
      for (let invocation = 0; invocation < 3; invocation += 1) {
        if (shape === "retained-due-dirty-ack" && invocation === 1) {
          now = retainedAt;
          vi.setSystemTime(new Date(now));
        }
        const prepared = createDeferred<void>();
        preparationObserver.mockImplementation(() => prepared.resolve());
        const restored = await createVaultSnapshotBundle({ vaultRoot });
        workspace = { ...workspace, snapshotRef: restored.snapshotRef };
        const artifacts = new Map([[restored.hash, restored.bytes]]);
        const platform = createPlatform({
          artifactBytesByHash: artifacts, deviceSyncPort, logRequests,
          mailboxPort: createMailboxPort({ events, items: arrival === "fresh" ? [mealItem] : [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: checkpoints, events, workspace,
            checkpointWorkspace(request) {
              events.push("checkpoint:" + request.reason);
              workspace = createWorkspaceState({
                snapshotRef: request.snapshotRef,
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                nextWakeAt: request.nextWakeAt ?? null, nextWakeReason: request.nextWakeReason ?? null,
                nextDefaultProcessingWakeAt: request.nextDefaultProcessingWakeAt ?? null,
                nextDefaultProcessingWakeReason: request.nextDefaultProcessingWakeReason ?? null,
                systemMailboxProgressGeneration: request.systemMailboxProgressGeneration,
                redactedStatus: request.redactedStatus ?? null,
              });
              return workspace;
            },
          }),
        });
        platform.effectsPort = { ...platform.effectsPort, readMealPhoto, deleteMealPhoto };
        const importItem = createHostedWorkspaceBridgeMailboxImporter({
          decodeMailboxPayload: { decode: async () => ({ status: "decoded", wake: mealWake }) },
          runtime: { commitTimeoutMs: null, forwardedEnv: {}, parserToolchain: { tools: {} },
            platform, platformEnv: {}, resolvedConfig: createDeviceSyncResolvedConfig(), userEnv: {} },
          vaultRoot,
        });
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: { attemptId: "attempt_synthetic_meal_" + invocation,
              processingMode: "default", workspace, workspaceVersion: workspace.version },
            resolvedConfig: createDeviceSyncResolvedConfig(),
          }),
          {
            async createCheckpointSnapshot() {
              const snapshot = await createVaultSnapshotBundle({ vaultRoot });
              artifacts.set(snapshot.hash, snapshot.bytes);
              return { snapshotRef: snapshot.snapshotRef };
            },
            importItem,
            platform,
            runAssistantPhase: async (input) => {
              // Deterministic interleaving: device work finishes while the
              // default owner's context is preparing, before mailbox selection.
              if (shape === "retained-due-dirty-ack" && invocation === 1) {
                await withRealTimeout(prepared.promise, 5_000, () => "Device preparation did not finish.");
              }
              const selected = await resolveHostedSystemMailboxWakeCandidates({ vaultRoot, now: () => now });
              const result = await runHostedWorkspaceAssistantPhase({ ...input, now: () => now });
              phases.push({ invocation, selected, progressed: result.progressed,
                nextWakeReason: result.nextWakeReason, checkpointReason: result.checkpointReason });
              return result;
            },
            vaultRoot,
          },
        );
        notificationsPerInvocation.push(vi.mocked(executeHostedManualMealPhotoWake).mock.calls.length);
      }
      const pending = (await readHostedSystemMailboxState(vaultRoot)).pending;
      const diagnostics = JSON.stringify({
        shape, selected: candidates.next, notificationsPerInvocation, phases,
        dirtyAcks: events.filter((event) => event === "device.dirty-ack").length,
        pending: pending.map((item) => ({ kind: item.wake.kind, status: item.status })),
        nextWakeAt: workspace.nextWakeAt, nextWakeReason: workspace.nextWakeReason,
        nextDefaultProcessingWakeAt: workspace.nextDefaultProcessingWakeAt,
      });
      expect(notificationsPerInvocation, diagnostics).toEqual([1, 1, 1]);
      expect(executeHostedManualMealPhotoWake).toHaveBeenCalledTimes(1);
      expect(executeHostedManualMealPhotoWake).toHaveBeenCalledWith(expect.objectContaining({
        wake: mealWake, sourceMailboxItemId: mealItem.id,
      }));
      expect(events.indexOf("meal.notification")).toBeLessThan(events.indexOf("checkpoint:idle_shutdown"));
      expect(readMealPhoto).toHaveBeenCalledTimes(arrival === "fresh" ? 1 : 0);
      expect(deleteMealPhoto).toHaveBeenCalledTimes(arrival === "fresh" ? 1 : 0);
      expect(pending.some((item) => item.itemId === mealItem.id)).toBe(false);
      if (shape.includes("dirty-ack")) {
        expect(events.filter((event) => event === "device.dirty-ack")).toHaveLength(1);
      }
      if (shape.startsWith("retained-")) {
        expect(logRequests.flatMap((request) => request.entries)).toEqual(expect.arrayContaining([
          expect.objectContaining({ eventCode: "device-sync.checkpoint_recorded", mailboxLane: "system",
            redactedJson: expect.objectContaining({ dirtyAckRecordedCount: 1,
              retainedMailboxOwnerPresent: true, stillDirty: false }) }),
        ]));
        expect(pending.some((item) => item.wake.kind === "device-sync.wake")).toBe(true);
      }
      if (shape === "retained-future-dirty-ack") {
        // Real photo intake also installs the ordinary future meal closeout.
        const closeoutAt = arrival === "fresh" ? "2026-04-27T03:00:00.000Z" : null;
        expect(workspace.nextDefaultProcessingWakeAt).toBe(closeoutAt);
        expect(workspace.nextWakeAt).toBe(closeoutAt ?? retainedAt);
        expect((await resolveHostedSystemMailboxWakeCandidates({ vaultRoot, now: () => now })).next)
          .toMatchObject({ at: retainedAt, executionClass: null });
        expect(pending).toEqual([expect.objectContaining({ status: "pending", attemptCount: 1,
          nextAttemptAt: retainedAt, postCheckpointRecord: null,
          wake: expect.objectContaining({ hint: expect.objectContaining({ jobs: [
            expect.objectContaining({ availableAt: jobAvailableAt }),
          ] }) }),
        })]);
      }
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      await removeTempRoot(vaultRoot);
    }
  },
);

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault, runCanonicalWrite } from "@murphai/core";
import { listCanonicalEntities } from "@murphai/query";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { test, vi } from "vitest";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime.ts";
import type { HostedRuntimeDeviceSyncPort } from "../src/hosted-runtime-contracts.ts";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import {
  TEST_NOW, TEST_USER_ID, createDeferred, createDeviceSyncResolvedConfig,
  createMailboxItem, createMailboxPort, createPlatform,
  createResolvedDeviceSyncSystemMailboxItem, createSnapshotDeviceSyncPort,
  createVaultSnapshotBundle, createWorkspacePort, createWorkspaceRuntimeJobInput,
  createWorkspaceState, listHostedCanonicalWriteReceiptLogArtifacts,
  removeTempRoot, runHostedWorkspaceRuntimeJobInProcess,
  stagePendingLinqAssistantInputForMailboxItem, withRealTimeout,
  writeMailboxImportStateFile, writeSyntheticAssistantAutoReplyTerminalEvidence,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

test.each(["completed", "quiesced", "no-progress"] as const)(
  "snapshot preserves canonical generation after a %s background device pass",
  async (scenario) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-checkpoint-generation-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifacts = new Map<string, Uint8Array>();
    const wake = createCoalescingRuntimeWakeSignal();
    const backgroundCompleted = createDeferred<void>();
    const controlPlaneSyncStarted = createDeferred<void>();
    const abort = new AbortController();
    const inputs = [createMailboxItem({ id: "mailbox_item_progress_first", laneSeq: "1" })];
    const deviceItem = createMailboxItem({
      id: "mailbox_item_progress_device", dedupeKey: "device-sync.wake:progress-generation",
      kind: "device-sync.wake", lane: "system", laneSeq: "1",
    });
    const connectionId = "synthetic-progress-connection";
    const handled = new Set<string>();
    let invocation: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
    let phaseCalls = 0;
    let snapshots = 0;
    let acknowledgments = 0;
    let deviceFetchStarted = false;
    let deviceCanonicalStatusCommitted = false;
    let controlPlaneSyncAborted = false;
    let versionConflicts = 0;
    const expectedGeneration = scenario === "no-progress" ? "7" : "8";
    const notify = wake.notify.bind(wake);
    wake.notify = (notification) => {
      notify(notification);
      // This notification follows workspaceSystemWork.onCompleted's progress
      // and committed-workspace updates; explicit foreground wakes use an input.
      if (notification === undefined && deviceFetchStarted) {
        events.push("system-work.completed");
        backgroundCompleted.resolve();
      }
    };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(TEST_NOW));
    const providerFetch: typeof fetch = async (request) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      assert.equal(url.origin, "https://whoop.example.test");
      const pathname = url.pathname;
      events.push(`provider.fetch:${pathname}`);
      return new Response(JSON.stringify(pathname.endsWith("/synthetic-progress-sleep") ? {
        id: "synthetic-progress-sleep", nap: false,
        start: "2026-04-26T00:30:00.000Z", end: "2026-04-26T07:30:00.000Z",
        updated_at: "2026-04-26T08:00:00.000Z",
      } : { records: [] }), { headers: { "content-type": "application/json" }, status: 200 });
    };
    vi.stubGlobal("fetch", providerFetch);
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncSystemMailboxItem(deviceItem), vaultRoot,
        wake: {
          connectionId, eventId: deviceItem.dedupeKey, expectedConnectedAt: TEST_NOW,
          hint: { occurredAt: TEST_NOW, reason: "webhook_dirty_transition" },
          kind: "device-sync.wake", occurredAt: TEST_NOW, provider: "whoop",
          reason: "webhook_hint", userId: TEST_USER_ID,
        },
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restored = await createVaultSnapshotBundle({ vaultRoot });
      artifacts.set(restored.hash, restored.bytes);
      let canonicalWorkspace = createWorkspaceState({
        snapshotRef: restored.snapshotRef, systemMailboxProgressGeneration: "7", version: "10",
      });
      const workspacePort = createWorkspacePort({
        checkpointRequests, events, workspace: canonicalWorkspace,
        checkpointResponse(request) {
          // Web tests the expected version before diagnosing a transition:
          // stale versions conflict, but current-version regressions throw.
          if (request.expectedWorkspaceVersion !== canonicalWorkspace.version) {
            versionConflicts += 1;
            return { checkpointed: false, workspace: canonicalWorkspace };
          }
          if (request.systemMailboxProgressGeneration !== undefined) {
            const current = BigInt(canonicalWorkspace.systemMailboxProgressGeneration ?? "0");
            const requested = BigInt(request.systemMailboxProgressGeneration);
            if (requested !== current && requested !== current + 1n) {
              throw Object.assign(new TypeError(
                `Current-version ${request.reason} checkpoint requested generation ${requested} after ${current} at workspace version ${canonicalWorkspace.version}.`,
              ), {
                code: requested < current
                  ? "HOSTED_WORKSPACE_PROGRESS_REGRESSED"
                  : "HOSTED_WORKSPACE_PROGRESS_SKIPPED_INCREMENT",
              });
            }
          }
          canonicalWorkspace = createWorkspaceState({
            ...canonicalWorkspace,
            inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
            nextDefaultProcessingWakeAt: request.nextDefaultProcessingWakeAt ?? null,
            nextDefaultProcessingWakeReason: request.nextDefaultProcessingWakeReason ?? null,
            nextWakeAt: request.nextWakeAt ?? null,
            nextWakeReason: request.nextWakeReason ?? null,
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: request.snapshotRef,
            systemMailboxProgressGeneration: request.systemMailboxProgressGeneration
              ?? canonicalWorkspace.systemMailboxProgressGeneration,
            version: String(BigInt(canonicalWorkspace.version) + 1n),
          });
          if (request.reason === "canonical_runtime_commit" && phaseCalls < 2) {
            deviceCanonicalStatusCommitted = true;
            events.push("device.status.committed");
          }
          return { checkpointed: true, workspace: canonicalWorkspace };
        },
      });
      const baseDevicePort = createSnapshotDeviceSyncPort({
        connectionId, nextReconcileAt: "2099-01-01T00:00:00.000Z",
        onFetchSnapshot() { deviceFetchStarted = true; },
      });
      const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
        ...baseDevicePort,
        async fetchDirtyStates() {
          return {
            hasMore: false, nextWakeAt: null, userId: TEST_USER_ID,
            items: scenario === "no-progress" || acknowledgments ? [] : [{
              connectionId, dirtyRevision: "7", processedRevision: "0",
              dirtyResources: [{
                count: 1, dirtyPayloadId: "synthetic-progress-payload", jobKind: "resource",
                payload: { resourceType: "sleep", resourceId: "synthetic-progress-sleep" },
                resource: "sleep", resourceCategory: "summary", sourceProviderSlug: "whoop",
                windowEnd: null, windowStart: null,
              }],
              eventCount: "1", latestDirtyAt: TEST_NOW, provider: "whoop",
              resourceCategoryCounts: { summary: 1 }, sourceProviderCounts: { whoop: 1 },
              userId: TEST_USER_ID, windowEnd: null, windowStart: null,
            }],
          };
        },
        async applyUpdates(request) {
          if (scenario === "quiesced" && deviceCanonicalStatusCommitted && !controlPlaneSyncAborted) {
            const signal = request.signal;
            assert.ok(signal);
            events.push("device.sync.started");
            controlPlaneSyncStarted.resolve();
            await new Promise<void>((_resolve, reject) => {
              const onAbort = () => {
                controlPlaneSyncAborted = true;
                events.push("device.sync.aborted");
                reject(signal.reason);
              };
              if (signal.aborted) onAbort();
              else signal.addEventListener("abort", onAbort, { once: true });
            });
          }
          return await baseDevicePort.applyUpdates(request);
        },
        async ackDirtyStateProcessed(request) {
          assert.ok(checkpointRequests.some((checkpoint) => checkpoint.reason === "idle_shutdown"));
          acknowledgments += 1;
          return {
            connectionId, dirtyRevision: request.processedRevision,
            processedRevision: request.processedRevision, recorded: true,
            stillDirty: false, nextWakeAt: null, userId: TEST_USER_ID,
          };
        },
      };
      invocation = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: { workspaceVersion: "10", runnerIdleTtlMs: 1 },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          vaultRoot, runtimeWakeSignal: wake, signal: abort.signal,
          platform: {
            ...createPlatform({
              artifactBytesByHash: artifacts, deviceSyncPort,
              mailboxPort: createMailboxPort({ events, items: inputs }), workspacePort,
            }),
            providerFetch,
          },
          async createCheckpointSnapshot() {
            snapshots += 1;
            assert.equal(handled.size, 2, "Fresh foreground input must run before the background snapshot boundary.");
            assert.equal(await readFile(path.join(vaultRoot, "audit/progress-generation.md"), "utf8"), "second write\n");
            const rows = await listCanonicalEntities(vaultRoot, { family: "event" });
            assert.equal(rows.some((row) => JSON.stringify(row.attributes).includes("synthetic-progress-sleep")), scenario !== "no-progress");
            const snapshot = await createVaultSnapshotBundle({ vaultRoot });
            artifacts.set(snapshot.hash, snapshot.bytes);
            return { snapshotRef: snapshot.snapshotRef };
          },
          async importItem({ item }) {
            const assistantInputId = await stagePendingLinqAssistantInputForMailboxItem({ item, vaultRoot });
            return { assistantInputId, status: "imported" };
          },
          async runAssistantPhase(input) {
            const freshIds = (input.initialMailboxImport.importResult.assistantInputIds ?? [])
              .filter((id) => !handled.has(id));
            if (freshIds.length === 0) return { progressed: false };
            phaseCalls += 1;
            for (const inputId of freshIds) {
              handled.add(inputId);
              await writeSyntheticAssistantAutoReplyTerminalEvidence({ inputId, vaultRoot });
            }
            if (phaseCalls === 1) {
              await (scenario === "quiesced" ? controlPlaneSyncStarted.promise : backgroundCompleted.promise);
              inputs.push(createMailboxItem({ id: "mailbox_item_progress_second", laneSeq: "2" }));
              wake.notify({ requestedProcessingMode: "default" });
              return { checkpointReason: "assistant_runtime_commit", progressed: true };
            }
            assert.equal(phaseCalls, 2);
            // Both mutations use the real canonical receipt/status owner. A
            // completed device pass's pending increment is consumed only once.
            for (const text of ["first write\n", "second write\n"]) {
              await runCanonicalWrite({
                mutate: async ({ batch }) => batch.stageTextWrite("audit/progress-generation.md", text),
                occurredAt: TEST_NOW, operationType: "hosted_canonical_write_test",
                summary: "Persist synthetic foreground progress", vaultRoot,
              });
            }
            return { checkpointReason: "assistant_runtime_commit", progressed: true };
          },
        },
      );
      const result = await withRealTimeout(invocation, 20_000, () => JSON.stringify({ events, phaseCalls, checkpointRequests }));
      assert.notEqual(result.status, "failed");
      assert.equal(phaseCalls, 2);
      assert.equal(versionConflicts, 0, "The snapshot uses the latest expected version; no CAS retry is involved.");
      assert.equal(controlPlaneSyncAborted, scenario === "quiesced");
      const statusRequests = checkpointRequests.filter((request) => request.reason === "canonical_runtime_commit");
      const foregroundGeneration = scenario === "completed" ? "8" : "7";
      assert.deepEqual(statusRequests.slice(-2).map((request) => request.systemMailboxProgressGeneration), [foregroundGeneration, foregroundGeneration]);
      const snapshotRequests = checkpointRequests.filter((request) => request.reason === "idle_shutdown");
      assert.equal(snapshotRequests.length, snapshots);
      assert.ok(snapshotRequests.length > 0);
      assert.equal(snapshotRequests[0]?.expectedWorkspaceVersion, String(BigInt(statusRequests.at(-1)!.expectedWorkspaceVersion) + 1n));
      assert.ok(snapshotRequests.every((request) => request.systemMailboxProgressGeneration === expectedGeneration));
      assert.equal(snapshotRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      const receiptLog = listHostedCanonicalWriteReceiptLogArtifacts(artifacts).find(
        (log) => log.sha256 === statusRequests.at(-1)?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
      );
      assert.equal(receiptLog?.entries.length, scenario === "no-progress" ? 2 : 3);
      assert.equal(canonicalWorkspace.systemMailboxProgressGeneration, expectedGeneration);
      assert.equal(acknowledgments, scenario === "no-progress" ? 0 : 1);
    } finally {
      abort.abort();
      await invocation?.catch(() => undefined);
      vi.unstubAllGlobals();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  },
);

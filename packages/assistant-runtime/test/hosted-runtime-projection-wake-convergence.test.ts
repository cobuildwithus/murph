import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { test, vi } from "vitest";
import { initializeVault } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import {
  TEST_NOW,
  TEST_USER_ID,
  createBrowserVaultReplicaRef,
  createDeferred,
  withRealTimeout,
  createEmptyDeviceSyncPort,
  createDeviceSyncResolvedConfig,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createVaultSnapshotBundle,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  enqueueDeviceSyncSystemMailboxItemForTest,
  removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess,
  writeMailboxImportStateFile,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import {
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";

const completionStages = ["scopes", "delivery", "browser-write", "browser-publish", "acknowledgment", "checkpoint"] as const;
type CompletionStage = typeof completionStages[number];
const scenarios = [
  { stage: "scopes" as const, wake: "quiet" as const },
  { stage: "before-completion" as const, wake: "empty" as const },
  { stage: "before-completion" as const, wake: "conversation after empty" as const },
  ...completionStages.flatMap((stage) => [
    { stage, wake: "empty" as const },
    { stage, wake: "conversation after empty" as const },
  ]),
];

test.each(scenarios)(
  "checkpointed completion at $stage with $wake wakes",
  async ({ stage, wake }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-projection-convergence-"));
    const controller = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const deviceItem = createMailboxItem({
      id: "mailbox_item_projection_convergence",
      dedupeKey: "device-sync.wake:projection-convergence",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
    const emptyWakeChecked = createDeferred<void>();
    const releaseDelivery = createDeferred<void>();
    const foregroundReached = new Error("Synthetic foreground phase reached.");
    let wakeChecks = 0;
    let injected = false;
    let deliveries = 0;
    let browserWrites = 0;
    let browserPublishes = 0;
    const injectWake = async (at: CompletionStage, signal?: AbortSignal | null) => {
      if (wake === "quiet" || at !== stage || injected) return;
      injected = true;
      // Same-tick duplicate hints must collapse into one bounded mailbox read.
      for (let duplicate = 0; duplicate < 3; duplicate += 1) {
        runtimeWakeSignal.notify({ requestedProcessingMode: "default" });
      }
      await withRealTimeout(emptyWakeChecked.promise, 2_000, () => "Empty wake was not classified.");
      await setImmediate();
      assert.equal(signal?.aborted ?? false, false, "Empty wake canceled useful completion work.");
      if (wake === "empty") return;
      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_projection_foreground", lane: "conversation", laneSeq: "1",
      }));
      runtimeWakeSignal.notify({ requestedProcessingMode: "default" });
      if (at === "delivery") {
        await withRealTimeout(releaseDelivery.promise, 2_000, () => "Foreground waited for projection delivery.");
        return;
      }
      assert.ok(signal, "Interruptible work must receive its owner's cancellation signal.");
      await withRealTimeout(new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      }), 2_000, () => "Real conversation did not preempt completion work.");
      signal.throwIfAborted();
    };
    let acknowledgments = 0;
    let scopeReads = 0;
    let emptyMailboxReads = 0;
    const returnedWakes: (string | null)[] = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(TEST_NOW));
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({ item: deviceItem, vaultRoot });
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: state.pending.map((item) => ({
          ...item,
          status: "recording" as const,
          postCheckpointRecord: {
            kind: "device-sync.dirty-processed" as const,
            connectionId: "device_sync_connection_projection_convergence",
            processedRevision: "4",
            processedDirtyPayloadIds: ["dirty_payload_projection_convergence"],
          },
        })),
      }));
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const initial = await createVaultSnapshotBundle({ vaultRoot });
      artifactBytesByHash.set(initial.hash, initial.bytes);
      let workspace = createWorkspaceState({ snapshotRef: initial.snapshotRef, version: "0" });
      const baseWorkspacePort = createWorkspacePort({ checkpointRequests, events, workspace });
      const baseMailboxPort = createMailboxPort({ events, items: mailboxItems });

      for (let invocation = 0; invocation < 3; invocation += 1) {
        const run = runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: `attempt_projection_convergence_${invocation}`,
              processingMode: "system_mailbox",
              workspaceVersion: workspace.version,
            },
            resolvedConfig: createDeviceSyncResolvedConfig(),
          }),
          {
            vaultRoot,
            runtimeWakeSignal,
            signal: controller.signal,
            async createCheckpointSnapshot(_input, context) {
              if (stage === "before-completion" && !injected) {
                injected = true;
                runtimeWakeSignal.notify({ requestedProcessingMode: "default" });
              }
              if ((await readHostedSystemMailboxState(vaultRoot)).pending.length === 0) {
                await injectWake("checkpoint", context?.signal);
              }
              const snapshot = await createVaultSnapshotBundle({ vaultRoot });
              artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
              return { snapshotRef: snapshot.snapshotRef };
            },
            async importItem() {
              throw new Error("The completion was already imported and checkpointed.");
            },
            async runAssistantPhase() {
              assert.equal(wake, "conversation after empty");
              assert.equal(wakeChecks, 2, "Reuse the prefetched conversation batch for handoff.");
              releaseDelivery.resolve();
              throw foregroundReached;
            },
            platform: createPlatform({
              artifactBytesByHash,
              deviceSyncPort: {
                ...deviceSyncPort,
                async ackDirtyStateProcessed(request) {
                  await injectWake("acknowledgment", request.signal);
                  acknowledgments += 1;
                  assert.equal(request.processedRevision, "4");
                  assert.deepEqual(request.processedDirtyPayloadIds, ["dirty_payload_projection_convergence"]);
                  return {
                    connectionId: request.connectionId,
                    dirtyRevision: request.processedRevision,
                    processedRevision: request.processedRevision,
                    recorded: true,
                    stillDirty: false,
                    nextWakeAt: null,
                    userId: TEST_USER_ID,
                  };
                },
              },
              mailboxPort: {
                ...baseMailboxPort,
                async fetch(request) {
                  emptyMailboxReads += 1;
                  const response = await baseMailboxPort.fetch(request);
                  if (request.requestId.includes(":independent-completion-foreground-check")) {
                    wakeChecks += 1;
                    assert.deepEqual(request.lanes.map((lane) => lane.lane), ["conversation"]);
                    assert.ok(request.limitPerLane > 0 && request.limitPerLane <= 100);
                    if (response.items.length === 0) {
                      emptyWakeChecked.resolve();
                      if (stage === "before-completion" && wake === "conversation after empty") {
                        queueMicrotask(() => {
                          mailboxItems.push(createMailboxItem({
                            id: "mailbox_item_projection_foreground", lane: "conversation", laneSeq: "1",
                          }));
                          runtimeWakeSignal.notify({ requestedProcessingMode: "default" });
                        });
                      }
                    }
                  }
                  return response;
                },
              },
              vaultSharePort: {
                async listActiveProjectionScopes(request) {
                  scopeReads += 1;
                  await injectWake("scopes", request?.signal);
                  return {
                    projectionKinds: ["profile-name.v0"],
                    projectionScopes: [{ projectionKind: "profile-name.v0" }],
                    generationTokensByProjectionScopeKey: { "profile-name.v0": "a".repeat(43) },
                  };
                },
                async deliver() {
                  deliveries += 1;
                  await injectWake("delivery");
                  return { status: "delivered" };
                },
              },
              browserVaultReplicaPort: {
                async write(request) {
                  browserWrites += 1;
                  await injectWake("browser-write", request.signal);
                  return createBrowserVaultReplicaRef(request.replica);
                },
                async publishRef(request) {
                  browserPublishes += 1;
                  await injectWake("browser-publish", request.signal);
                  workspace = { ...workspace, browserVaultReplicaRef: request.replicaRef };
                  return { published: true, workspace };
                },
              },
              workspacePort: {
                ...baseWorkspacePort,
                async read() { return { fetchedAt: TEST_NOW, workspace }; },
                async checkpoint(request) {
                  const response = await baseWorkspacePort.checkpoint(request);
                  workspace = response.workspace;
                  return response;
                },
              },
            }),
          },
        );
        if (wake === "conversation after empty") {
          await assert.rejects(run, (error) => error === foregroundReached);
          assert.equal(injected, true);
          assert.equal(wakeChecks, 2);
          assert.notEqual(workspace.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "1",
            "Preempted completion must not claim a committed handling high-water.");
          return;
        }
        const result = await run;
        returnedWakes.push(result.nextWakeAt ?? null);
        assert.notEqual(result.immediateRecheckRequested, true);
        if (invocation > 0) {
          assert.equal(checkpointRequests.length, 2, "Restores of completed work must not checkpoint again.");
        }
      }

      const pending = await readHostedSystemMailboxState(vaultRoot);
      const evidence = JSON.stringify({
        acknowledgments,
        scopeReads,
        emptyMailboxReads,
        checkpoints: checkpointRequests.length,
        returnedWakes,
        pendingStatuses: pending.pending.map((item) => item.status),
        handledThrough: workspace.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
      });
      assert.equal(injected, wake !== "quiet");
      assert.equal(wakeChecks, wake === "quiet" ? 0 : 1, evidence);
      assert.equal(scopeReads, 1, evidence);
      assert.equal(deliveries, 1, evidence);
      assert.equal(browserWrites, 1, evidence);
      assert.equal(browserPublishes, 1, evidence);
      assert.equal(checkpointRequests.length, 2, evidence);
      assert.equal(acknowledgments, 1, evidence);
      assert.deepEqual(pending.pending, [], evidence);
      assert.equal(workspace.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "1", evidence);
      assert.deepEqual(returnedWakes, [null, null, null], evidence);
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 0, "Restored completion must not repeat provider work.");
    } finally {
      releaseDelivery.resolve();
      controller.abort();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  },
);

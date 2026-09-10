import {
  TEST_NOW,
  createEmptyDeviceSyncPort,
  createDeferred,
  withRealTimeout,
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
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { initializeVault } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";

test.each(["empty", "conversation after empty"] as const)("independent completion converges with %s wakes", async (scenario) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-background-wake-convergence-"));
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const events: string[] = [];
  const artifactBytesByHash = new Map<string, Uint8Array>();
  const deviceSyncPort = createEmptyDeviceSyncPort();
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const deviceItem = createMailboxItem({
    id: "mailbox_item_background_wake_convergence",
    dedupeKey: "device-sync.wake:background-convergence",
    kind: "device-sync.wake", lane: "system", laneSeq: "1",
  });
  const conversationItem = createMailboxItem({ id: "mailbox_item_completion_foreground", lane: "conversation", laneSeq: "1" });
  const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
  const foregroundReached = new Error("Synthetic foreground phase reached.");
  const emptyWakeChecked = createDeferred<void>();
  let wakeChecks = 0;
  let injectedWakes = 0;
  let snapshotOrdinal = 0;
  let interruptedCompletions = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TEST_NOW));
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    await enqueueDeviceSyncSystemMailboxItemForTest({ item: deviceItem, vaultRoot });
    const importState = createEmptyHostedMailboxImportState();
    importState.watermarks.system = "1";
    await writeMailboxImportStateFile(vaultRoot, importState);
    const initial = await createVaultSnapshotBundle({
      vaultRoot,
    });
    artifactBytesByHash.set(initial.hash, initial.bytes);
    let workspace = createWorkspaceState({ snapshotRef: initial.snapshotRef, version: "0" });
    const baseWorkspacePort = createWorkspacePort({ checkpointRequests, events, workspace });
    const baseMailboxPort = createMailboxPort({ events, items: mailboxItems });
    for (let invocation = 0; invocation < 3; invocation += 1) {
      const run = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          attemptId: `attempt_background_convergence_${invocation}`,
          processingMode: "system_mailbox", workspaceVersion: workspace.version,
        },
        resolvedConfig: createDeviceSyncResolvedConfig(),
      }), {
        vaultRoot, runtimeWakeSignal,
        async createCheckpointSnapshot(_input, context) {
          const state = await readHostedSystemMailboxState(vaultRoot);
          if (state.pending.length === 0) {
            injectedWakes += 1;
            runtimeWakeSignal.notify({ requestedProcessingMode: "default" });
            if (scenario === "conversation after empty") {
              await withRealTimeout(emptyWakeChecked.promise, 2_000, () => "Empty wake was not checked.");
              await setImmediate();
              mailboxItems.push(conversationItem);
              runtimeWakeSignal.notify({ requestedProcessingMode: "default" });
              assert.ok(context?.signal);
              await withRealTimeout(new Promise<void>((resolve) => {
                if (context.signal?.aborted) resolve();
                else context.signal?.addEventListener("abort", () => resolve(), { once: true });
              }), 2_000, () => "Conversation input did not interrupt the snapshot.");
            } else {
              await setImmediate();
            }
            if (context?.signal?.aborted) interruptedCompletions += 1;
            context?.signal?.throwIfAborted();
          }
          ++snapshotOrdinal;
          const snapshot = await createVaultSnapshotBundle({
            vaultRoot,
          });
          artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
          return { snapshotRef: snapshot.snapshotRef };
        },
        async importItem() { throw new Error("The initial mailbox was already imported."); },
        async runAssistantPhase() {
          assert.equal(scenario, "conversation after empty");
          assert.equal(interruptedCompletions, 1);
          throw foregroundReached;
        },
        platform: createPlatform({ artifactBytesByHash, deviceSyncPort,
          mailboxPort: {
            ...baseMailboxPort,
            async fetch(request) {
              const response = await baseMailboxPort.fetch(request);
              if (request.requestId.includes(":independent-completion-foreground-check")) {
                wakeChecks += 1;
                if (response.items.length === 0) emptyWakeChecked.resolve();
              }
              return response;
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
      });
      if (scenario === "conversation after empty") {
        await assert.rejects(run, (error) => error === foregroundReached);
        assert.equal(interruptedCompletions, 1);
        assert.equal(wakeChecks, 2);
        assert.equal(workspace.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "0");
        return;
      }
      const result = await run;
      assert.equal(result.nextWakeAt, null);
      assert.notEqual(result.immediateRecheckRequested, true);
    }
    assert.ok(snapshotOrdinal > 0);
    assert.ok(injectedWakes > 0);
    assert.equal(interruptedCompletions, 0);
    assert.equal(wakeChecks, injectedWakes);
    assert.equal(workspace.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "1",
      JSON.stringify({ interruptedCompletions, checkpointCount: checkpointRequests.length, nextWakeAt: workspace.nextWakeAt }));
    assert.equal(workspace.nextWakeAt, null);
    assert.equal(deviceSyncPort.fetchSnapshotCalls, 1);
  } finally {
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});

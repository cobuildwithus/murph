import {
  TEST_NOW, createDeferred, createDeviceSyncResolvedConfig, createMailboxItem,
  createMailboxPort, createPlatform, createSnapshotDeviceSyncPort,
  createSnapshotFixtureRef, createVaultSnapshotBundle, createWorkspacePort,
  createWorkspaceRuntimeJobInput, createWorkspaceState,
  enqueueDeviceSyncSystemMailboxItemForTest, removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess, stagePendingLinqAssistantInputForMailboxItem,
  waitForFakeTimerScheduled, withRealTimeout, writeMailboxImportStateFile,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { initializeVault } from "@murphai/core";
import type { HostedMailboxItem, HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";

// The same foreground contract must hold regardless of how authority arrived.
// Keep the invocation alive beyond its first admission to exercise owner history.
const priorityJourneys = (["default", "device completion", "system checkpoint"] as const)
  .flatMap((owner) => (["quiet window", "snapshot", "provider change", "shutdown"] as const)
    .map((arrival) => ({ owner, arrival })));

test.each(priorityJourneys)(
  "$owner owner preserves foreground priority through $arrival",
  async ({ owner, arrival }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-promoted-priority-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const items: HostedMailboxItem[] = [];
    const wake = createCoalescingRuntimeWakeSignal();
    const abort = new AbortController();
    const shutdown = new AbortController();
    const replies = [createDeferred<void>(), createDeferred<void>(), createDeferred<void>()];
    const imported = new Map<string, string>();
    const handled = new Set<string>();
    const snapshotTimes: number[] = [];
    const quietMs = 180_000;
    let nextInput = 0;
    let effectCalls = 0;
    let snapshotInterrupted = false;
    let providerChanged = false;
    let invocation: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
    const device = createMailboxItem({
      id: "mailbox_item_priority_device", dedupeKey: "device-sync.wake:priority",
      kind: "device-sync.wake", lane: "system", laneSeq: "1",
    });
    const sendInput = () => {
      nextInput += 1;
      items.push(createMailboxItem({
        id: `mailbox_item_priority_conversation_${nextInput}`,
        lane: "conversation", laneSeq: String(nextInput),
        occurredAt: new Date().toISOString(),
      }));
      wake.notify({ requestedProcessingMode: "default" });
    };
    const awaitReply = async (ordinal: number) => {
      assert.ok(invocation);
      await withRealTimeout(Promise.race([
        replies[ordinal - 1]!.promise,
        invocation.then(() => assert.fail("Runtime returned before the next reply.")),
      ]), 10_000, () => events.join(","));
      await Promise.race([
        waitForFakeTimerScheduled(() => events.join(",")),
        invocation.then(() => assert.fail("Runtime returned before the idle wait.")),
      ]);
    };

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(TEST_NOW));
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      if (owner !== "default") {
        await enqueueDeviceSyncSystemMailboxItemForTest({ item: device, vaultRoot });
      }
      const state = createEmptyHostedMailboxImportState();
      state.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, state);
      const restored = await createVaultSnapshotBundle({ vaultRoot });
      const mailbox = createMailboxPort({ events, items });
      if (owner === "default") sendInput();
      invocation = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          processingMode: owner === "default" ? "default" : "system_mailbox",
          workspaceVersion: "0",
          runnerIdleTtlMs: quietMs,
        },
        resolvedConfig: createDeviceSyncResolvedConfig(),
      }), {
        vaultRoot, runtimeWakeSignal: wake, signal: abort.signal,
        shutdownSignal: shutdown.signal,
        async createCheckpointSnapshot(_request, context) {
          if (owner === "system checkpoint" && nextInput === 0) {
            sendInput();
            return { snapshotRef: createSnapshotFixtureRef({ hash: "d".repeat(64), size: 512 }) };
          }
          snapshotTimes.push(Date.now());
          events.push("snapshot");
          if (!providerChanged && !shutdown.signal.aborted) {
            assert.ok(Date.now() >= Date.parse(TEST_NOW) + quietMs,
              "A duplicate default wake must not bypass the foreground quiet window.");
          }
          if (arrival === "snapshot" && nextInput === 1) {
            sendInput();
            assert.ok(context?.signal);
            await withRealTimeout(new Promise<void>((resolve) => {
              if (context.signal?.aborted) resolve();
              else context.signal?.addEventListener("abort", () => resolve(), { once: true });
            }), 5_000, () => "Fresh input did not interrupt snapshot construction.");
            snapshotInterrupted = true;
            context.signal.throwIfAborted();
          }
          return { snapshotRef: createSnapshotFixtureRef({ hash: "d".repeat(64), size: 512 }) };
        },
        async importItem({ item }) {
          assert.equal(item.lane, "conversation");
          assert.ok(!imported.has(item.id), "Conversation input must be imported exactly once.");
          const inputId = await stagePendingLinqAssistantInputForMailboxItem({ item, vaultRoot });
          imported.set(item.id, inputId);
          return { assistantInputId: inputId, status: "imported" };
        },
        async runAssistantPhase(input) {
          const fresh = (input.initialMailboxImport.importResult.assistantInputIds ?? [])
            .filter((id) => !handled.has(id));
          if (fresh.length === 0) return { progressed: false };
          for (const id of fresh) {
            assert.ok([...imported.values()].includes(id));
            handled.add(id);
            events.push(`reply:${handled.size}`);
            replies[handled.size - 1]!.resolve();
          }
          if (handled.size === 1) {
            // Direct ingress and orchestration can both acknowledge one message.
            wake.notify({ requestedProcessingMode: "default" });
          }
          return {
            progressed: true, checkpointReason: "assistant_runtime_commit",
            ...(handled.size === 1 ? {
              afterCheckpoint: async () => ({
                checkpointReason: "assistant_runtime_commit" as const,
                afterDurableCheckpoint: async () => {
                  effectCalls += 1;
                  events.push("durable-effect");
                  return {
                    requiresFollowUpCheckpoint: true,
                    nextWakeAt: new Date(Date.now() + 60_000).toISOString(),
                    nextWakeReason: "device-sync.reconcile",
                  };
                },
              }),
            } : {}),
          };
        },
        platform: createPlatform({
          artifactBytesByHash: new Map([[restored.hash, restored.bytes]]),
          deviceSyncPort: createSnapshotDeviceSyncPort({
            connectionId: "synthetic-priority-connection",
            // Clearing a disconnected account's retained wake is a real delta.
            connectionStatus: "disconnected",
            nextReconcileAt: "2099-01-01T00:00:00.000Z",
            onApplyUpdates() {
              if (owner === "device completion" && nextInput === 0) sendInput();
            },
          }),
          mailboxPort: {
            ...mailbox,
            async fetch(request) {
              const response = await mailbox.fetch(request);
              return { ...response, assistantProvider: providerChanged ? "venice" : response.assistantProvider };
            },
          },
          workspacePort: createWorkspacePort({
            events, checkpointRequests,
            workspace: createWorkspaceState({ version: "0", snapshotRef: restored.snapshotRef }),
          }),
        }),
      });
      void invocation.catch(() => undefined);
      await awaitReply(1);
      assert.deepEqual(snapshotTimes, []);
      const initialIdleCheckpoints = checkpointRequests
        .filter((request) => request.reason === "idle_shutdown").length;
      const foregroundIdleCheckpoints = () => checkpointRequests
        .filter((request) => request.reason === "idle_shutdown").length - initialIdleCheckpoints;

      if (arrival === "provider change" || arrival === "shutdown") {
        if (arrival === "provider change") providerChanged = true;
        else shutdown.abort();
        sendInput();
        const result = await withRealTimeout(invocation, 10_000, () => events.join(","));
        assert.equal(handled.size, 1, "The old owner must not execute new input after losing authority.");
        assert.equal(Date.now(), Date.parse(TEST_NOW), "Required handoff must not wait for idle.");
        assert.ok(snapshotTimes.length > 0);
        assert.equal(effectCalls, 1);
        if (providerChanged) assert.equal(result.immediateRecheckRequested, true);
        return;
      }

      if (arrival === "quiet window") {
        await vi.advanceTimersByTimeAsync(5_000);
        sendInput();
      } else {
        await vi.advanceTimersByTimeAsync(quietMs);
      }
      await awaitReply(2);
      assert.equal(effectCalls, 0, "Background effects must wait for foreground input.");
      assert.equal(foregroundIdleCheckpoints(), 0);
      assert.equal(snapshotInterrupted, arrival === "snapshot");

      await vi.advanceTimersByTimeAsync(1_000);
      sendInput();
      await awaitReply(3);
      const finalReplyAt = Date.now();
      await vi.advanceTimersByTimeAsync(quietMs - 1);
      assert.equal(foregroundIdleCheckpoints(), 0);
      await vi.advanceTimersByTimeAsync(1);
      const result = await withRealTimeout(invocation, 10_000, () => events.join(","));
      assert.equal(imported.size, 3);
      assert.equal(handled.size, 3);
      assert.deepEqual(events.filter((event) => event.startsWith("reply:")),
        ["reply:1", "reply:2", "reply:3"]);
      assert.equal(effectCalls, 1);
      assert.equal(foregroundIdleCheckpoints(), 2,
        "Deferred effects must still converge through their follow-up checkpoint.");
      assert.ok(snapshotTimes.at(-1)! >= finalReplyAt + quietMs);
      assert.ok(events.indexOf("durable-effect") > events.indexOf("reply:3"));
      assert.equal(result.status, "scheduled");
    } finally {
      abort.abort();
      await invocation?.catch(() => undefined);
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  },
);

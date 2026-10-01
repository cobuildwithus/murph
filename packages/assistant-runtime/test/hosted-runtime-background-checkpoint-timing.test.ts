import {
  TEST_NOW,
  createDeferred,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createSnapshotFixtureRef,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  removeTempRoot,
  waitForFakeTimerScheduled,
  withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { test, vi } from "vitest";
import {
  createCoalescingRuntimeWakeSignal,
  runHostedWorkspaceRuntimeJobInProcess,
} from "../src/hosted-runtime.ts";

for (const conversation of ["none", "initial"] as const) {
  test(conversation === "none"
    ? "background assistant work checkpoints when settled without an idle delay"
    : "conversation work retains its configured quiet window", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-background-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const checkpointTimes: number[] = [];
    const items = conversation === "initial" ? [createMailboxItem()] : [];
    const workStarted = createDeferred<void>();
    const finishWork = createDeferred<void>();
    const foregroundObserved = createDeferred<void>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdown = new AbortController();
    const runnerIdleTtlMs = 600_000;
    const futureWake = "2026-04-27T01:00:00.000Z";
    let passes = 0;
    let effectCount = 0;
    let runtime: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | undefined;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      runtime = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs } }),
        {
          async createCheckpointSnapshot() {
            checkpointTimes.push(Date.now());
            return { snapshotRef: createSnapshotFixtureRef({ hash: "b".repeat(64), size: 512 }) };
          },
          async importItem() { return { status: "imported" }; },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items }),
            workspacePort: createWorkspacePort({
              checkpointRequests, events, workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeWakeSignal,
          shutdownSignal: shutdown.signal,
          async runAssistantPhase() {
            passes += 1;
            if (passes === 1) {
              workStarted.resolve();
              await finishWork.promise;
              if (conversation === "initial") foregroundObserved.resolve();
              return {
                progressed: true,
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: futureWake,
                nextWakeReason: "assistant",
                afterCheckpoint: async () => ({
                  checkpointReason: "assistant_runtime_commit",
                  afterDurableCheckpoint: async () => {
                    assert.ok(checkpointRequests.length > 0, "effect requires a durable checkpoint");
                    effectCount += 1;
                  },
                }),
              };
            }
            foregroundObserved.resolve();
            return { progressed: false };
          },
          vaultRoot,
        },
      );
      await withRealTimeout(workStarted.promise, 5_000, () => events.join(","));
      // Work taking longer than the cleanup window must never be cut off.
      await vi.advanceTimersByTimeAsync(90_000);
      assert.equal(checkpointRequests.length, 0);
      assert.equal(effectCount, 0);
      finishWork.resolve();
      if (conversation !== "none") {
        await withRealTimeout(foregroundObserved.promise, 5_000, () => events.join(","));
        await waitForFakeTimerScheduled(() => events.join(","));
        await vi.advanceTimersByTimeAsync(runnerIdleTtlMs - 1);
        assert.equal(checkpointRequests.length, 0);
        await vi.advanceTimersByTimeAsync(1);
      }
      const result = await withRealTimeout(runtime, 5_000, () => events.join(","));
      assert.equal(effectCount, 1);
      assert.equal(checkpointTimes[0], Date.parse(TEST_NOW) + 90_000
        + (conversation === "none" ? 0 : runnerIdleTtlMs));
      assert.equal(result.nextWakeAt, futureWake);
    } finally {
      finishWork.resolve();
      shutdown.abort();
      await runtime?.catch(() => {});
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });
}

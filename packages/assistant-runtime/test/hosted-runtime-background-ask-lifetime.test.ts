import {
  TEST_NOW, createAssistantAskRequestedWake, createDeferred, createMailboxItem,
  createMailboxPort, createPlatform, createSnapshotFixtureRef, createWorkspacePort,
  createWorkspaceRuntimeJobInput, createWorkspaceState, mocks, removeTempRoot,
  waitForFakeTimerScheduled, withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { test, vi } from "vitest";
import { createCoalescingRuntimeWakeSignal, runHostedWorkspaceRuntimeJobInProcess } from "../src/hosted-runtime.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";

test.each(["complete", "expiry", "shutdown", "handoff"] as const)(
  "background group Ask protects preparation and execution until %s",
  async (boundary) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-background-ask-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const prepareStarted = createDeferred<void>();
    const prepareRelease = createDeferred<void>();
    const childStarted = createDeferred<void>();
    const childRelease = createDeferred<void>();
    const shutdown = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const item = createMailboxItem({
      dedupeKey: "ask_background_lifetime", id: "mailbox_background_lifetime",
      kind: "assistant.ask.requested", lane: "system", laneSeq: "1",
    });
    let childSignal: AbortSignal | undefined;
    let runtime: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | undefined;
    mocks.executeReadOnlyAssistantAsk.mockImplementationOnce(async (input) => {
      events.push("child.started");
      childSignal = input.abortSignal ?? undefined;
      input.abortSignal?.addEventListener("abort", () => {
        events.push("child.aborted");
        childRelease.resolve();
      }, { once: true });
      childStarted.resolve();
      await childRelease.promise;
      input.abortSignal?.throwIfAborted();
      return { answer: "Synthetic group answer.", outcome: "answered" };
    });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      runtime = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 600_000 } }),
        {
          async createCheckpointSnapshot() {
            events.push("checkpoint");
            return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 512 }) };
          },
          async importItem(resolved) {
            return await enqueueHostedSystemMailboxItem({
              item: resolved, vaultRoot,
              wake: createAssistantAskRequestedWake({ eventId: item.dedupeKey }),
            });
          },
          platform: createPlatform({
            assistantAskPort: {
              async request(request, context) {
                if (request.action === "complete") {
                  events.push("completed");
                  return { action: "complete", status: "completed" };
                }
                events.push("prepare.started");
                context?.signal?.addEventListener("abort", () => events.push("prepare.aborted"), { once: true });
                prepareStarted.resolve();
                await prepareRelease.promise;
                context?.signal?.throwIfAborted();
                return { action: "prepare", status: "ready", question: "Synthetic group question.", targetLabel: null };
              },
            },
            mailboxPort: createMailboxPort({ events, items: [item] }),
            workspacePort: createWorkspacePort({ checkpointRequests, events, workspace: createWorkspaceState({ version: "0" }) }),
          }),
          async runAssistantPhase() {
            if (events.includes("parent.finished")) return { progressed: false };
            await prepareStarted.promise;
            events.push("parent.finished");
            return { progressed: true, checkpointReason: "assistant_runtime_commit" };
          },
          runtimeWakeSignal,
          shutdownSignal: shutdown.signal,
          vaultRoot,
        },
      );
      await withRealTimeout(prepareStarted.promise, 5_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(90_000);
      assert.equal(events.includes("prepare.aborted"), false);
      assert.equal(checkpointRequests.length, 0);
      prepareRelease.resolve();
      await withRealTimeout(childStarted.promise, 5_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(90_000);
      assert.equal(childSignal?.aborted, false);
      assert.equal(checkpointRequests.length, 0);
      if (boundary === "complete") childRelease.resolve();
      else if (boundary === "shutdown") shutdown.abort(new Error("Synthetic shutdown."));
      else if (boundary === "handoff") runtimeWakeSignal.notify({ requestedProcessingMode: "system_mailbox" });
      else await vi.advanceTimersByTimeAsync(420_000);
      await withRealTimeout(runtime, 5_000, () => events.join(","));
      assert.equal(events.filter((event) => event === "completed").length, boundary === "complete" ? 1 : 0);
      assert.equal(events.filter((event) => event === "child.started").length, 1);
      assert.equal(events.includes("child.aborted"), boundary !== "complete");
      assert.ok(checkpointRequests.length > 0);
      if (boundary === "complete") {
        assert.ok(events.indexOf("completed") < events.indexOf("checkpoint"));
        assert.equal(Date.now(), Date.parse(TEST_NOW) + 180_000);
      }
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending.map((pending) => [pending.itemId, pending.status]),
        boundary === "complete" ? [] : [[item.id, "pending"]],
      );
    } finally {
      prepareRelease.resolve();
      childRelease.resolve();
      shutdown.abort();
      await runtime?.catch(() => {});
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  },
);

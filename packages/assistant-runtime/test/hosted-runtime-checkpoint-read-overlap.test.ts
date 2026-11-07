import {
  TEST_NOW, createPlatform, createMailboxPort, createWorkspacePort,
  createWorkspaceState, createWorkspaceRuntimeJobInput, createDeferred, removeTempRoot,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault, runCanonicalWrite } from "@murphai/core";
import * as assistantEngine from "@murphai/assistant-engine";
import { expect, test, vi } from "vitest";
import * as callbacks from "../src/hosted-runtime/callbacks.ts";
import { runHostedWorkspaceRuntimeJobInProcess } from "../src/hosted-runtime.ts";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";

test.each([false, true])("canonical checkpoint overlaps reads and joins them before exit (failed read: %s)", async (failedRead) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-checkpoint-overlap-"));
  const releaseOutbox = createDeferred<void>();
  const abort = new AbortController();
  const reason = new Error("Synthetic checkpoint completed");
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  let observe = false;
  let outboxStarted = false;
  let cronStarted = false;
  let running: Promise<unknown> | undefined;
  let settled = false;
  const readFailure = new Error("Synthetic cron read failure");
  const readOutbox = callbacks.resolveHostedAssistantOutboxNextWakeAt;
  const readCron = assistantEngine.getAssistantCronStatus;
  const outboxSpy = vi.spyOn(callbacks, "resolveHostedAssistantOutboxNextWakeAt")
    .mockImplementation(async (input) => {
      if (observe) {
        outboxStarted = true;
        await releaseOutbox.promise;
      }
      return readOutbox(input);
    });
  const cronSpy = vi.spyOn(assistantEngine, "getAssistantCronStatus")
    .mockImplementation(async (...args) => {
      if (observe) {
        cronStarted = true;
        if (failedRead) throw readFailure;
      }
      return readCron(...args);
    });
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    const platform = createPlatform({
      artifactBytesByHash: new Map(), events,
      mailboxPort: createMailboxPort({ events, items: [] }),
      workspacePort: createWorkspacePort({
        checkpointRequests, events, workspace: createWorkspaceState({ version: "0" }),
        checkpointWorkspace(request) {
          abort.abort(reason);
          return createWorkspaceState({
            version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
            snapshotRef: request.snapshotRef, redactedStatus: request.redactedStatus ?? null,
          });
        },
      }),
    });
    running = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
      platform, vaultRoot, signal: abort.signal,
      async importItem() { return { status: "imported" }; },
      async createCheckpointSnapshot() { throw new Error("Unexpected snapshot"); },
      async runAssistantPhase(input) {
        observe = true;
        await runCanonicalWrite({
          vaultRoot: input.restored.vaultRoot, occurredAt: TEST_NOW,
          operationType: "hosted_canonical_write_test", summary: "Synthetic scheduling overlap proof",
          mutate: async ({ batch }) => { await batch.stageTextWrite("journal/overlap.md", "synthetic\n"); },
        });
        return { checkpointReason: "canonical_runtime_commit", progressed: true };
      },
    });
    void running.then(() => { settled = true; }, () => { settled = true; });
    await vi.waitFor(() => expect(outboxStarted).toBe(true));
    await vi.waitFor(() => expect(cronStarted).toBe(true), { timeout: 1_000 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(checkpointRequests).toHaveLength(0);
    releaseOutbox.resolve();
    await expect(running).rejects.toBe(failedRead ? readFailure : reason);
    if (failedRead) {
      expect(checkpointRequests).toHaveLength(0);
      return;
    }
    expect(checkpointRequests).toHaveLength(1);
    expect(checkpointRequests[0]?.reason).toBe("canonical_runtime_commit");
    expect(checkpointRequests[0]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256).toEqual(expect.any(String));
  } finally {
    releaseOutbox.resolve();
    abort.abort(reason);
    await running?.catch(() => {});
    outboxSpy.mockRestore();
    cronSpy.mockRestore();
    await removeTempRoot(vaultRoot);
  }
});

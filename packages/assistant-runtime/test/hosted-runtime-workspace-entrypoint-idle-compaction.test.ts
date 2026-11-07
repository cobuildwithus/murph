import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { afterEach, expect, test, vi } from "vitest";
import {
  TEST_NOW, createMailboxItem, createMailboxPort, createPlatform,
  createVaultSnapshotBundle, createWorkspacePort, createWorkspaceRuntimeJobInput,
  createWorkspaceState, removeTempRoot,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { runHostedWorkspaceRuntimeJobInProcess } from "../src/hosted-runtime.ts";

const compactWarmCodexThread = vi.hoisted(() => vi.fn());
vi.mock("@murphai/assistant-engine/assistant-codex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@murphai/assistant-engine/assistant-codex")>()),
  compactWarmCodexThread,
}));

afterEach(() => {
  vi.useRealTimers();
  compactWarmCodexThread.mockReset();
});

test.each(["compacted", "failed", "no_warm_process"] as const)(
  "preserves an unserviced retention retry through %s and schedules the successor",
  async (kind) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(TEST_NOW));
    const retentionAt = new Date(Date.now() + 5_000).toISOString();
    const scheduledAt = new Date(Date.now() + 100_000).toISOString();
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-compaction-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    compactWarmCodexThread.mockImplementation(async () => {
      if (kind === "failed") vi.setSystemTime(Date.now() + 120_000);
      return kind === "no_warm_process"
      ? { kind: "skipped", reason: kind, threadContextTokensBefore: null }
      : kind === "failed"
        ? { kind, reason: "timeout", threadContextTokensBefore: 100_000, threadId: "thread_synthetic" }
        : { kind, durationMs: 1, threadContextTokensBefore: 100_000,
            threadId: "thread_synthetic", model: "gpt-6.1-sol", serviceTier: null, usage: null };
    });
    const snapshot = async () => {
      const { bytes, hash, snapshotRef } = await createVaultSnapshotBundle({ vaultRoot });
      artifactBytesByHash.set(hash, bytes);
      return { snapshotRef };
    };
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 1 } }),
        {
          createCheckpointSnapshot: snapshot,
          async importItem() { return { status: "imported" }; },
          platform: createPlatform({
            artifactBytesByHash,
            mailboxPort: createMailboxPort({ events, items: [createMailboxItem({ laneSeq: "1" })] }),
            workspacePort: createWorkspacePort({ events, checkpointRequests,
              workspace: createWorkspaceState({ inboxMediaRetentionWakeAt: retentionAt }) }),
          }),
          async runAssistantPhase() {
            return { checkpointReason: "assistant_runtime_commit", progressed: true,
              nextWakeAt: scheduledAt, nextWakeReason: "device-sync.reconcile" };
          },
          vaultRoot,
        },
      );
      expect(compactWarmCodexThread).toHaveBeenCalledTimes(1);
      const checkpoint = checkpointRequests.find(request => request.reason === "idle_shutdown");
      if (!checkpoint) throw new Error("Expected the idle checkpoint after compaction.");
      expect(checkpoint).toMatchObject({
        inboxMediaRetentionWakeAt: retentionAt,
        nextWakeAt: scheduledAt, nextWakeReason: "device-sync.reconcile",
      });
      expect(result).toMatchObject({ status: "scheduled", nextWakeAt: retentionAt });

      if (kind === "failed") {
        // The failed compaction must still publish and return. Run the next
        // invocation from that checkpoint at the scheduled retention retry.
        vi.setSystemTime(Math.max(Date.now(), Date.parse(retentionAt)));
        const successorCheckpoints: HostedWorkspaceCheckpointRequest[] = [];
        const successor = await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({ request: {
            runnerIdleTtlMs: 1, workspaceVersion: "1", processingMode: "inbox_media_retention",
          } }),
          {
            createCheckpointSnapshot: snapshot,
            async importItem() { return { status: "imported" }; },
            async runAssistantPhase() { throw new Error("Retention successor must stay model-free."); },
            platform: createPlatform({
              artifactBytesByHash,
              mailboxPort: createMailboxPort({ events, items: [] }),
              workspacePort: createWorkspacePort({ events, checkpointRequests: successorCheckpoints,
                workspace: createWorkspaceState({ version: "1", snapshotRef: checkpoint.snapshotRef,
                  inboxMediaRetentionWakeAt: checkpoint.inboxMediaRetentionWakeAt,
                  nextWakeAt: checkpoint.nextWakeAt,
                  nextWakeReason: checkpoint.nextWakeReason }) }),
            }),
            vaultRoot,
          },
        );
        expect(successorCheckpoints).toHaveLength(1);
        expect(successorCheckpoints[0]).toMatchObject({ reason: "idle_shutdown", inboxMediaRetentionWakeAt: null });
        expect(successor).toMatchObject({ status: "scheduled", nextWakeAt: scheduledAt });
        expect(compactWarmCodexThread).toHaveBeenCalledTimes(1);
      }
    } finally {
      await removeTempRoot(vaultRoot);
    }
  },
);

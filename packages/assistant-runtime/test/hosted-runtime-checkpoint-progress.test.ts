import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { test, vi } from "vitest";
import {
  TEST_NOW,
  createMailboxPort,
  createPlatform,
  createSnapshotFixtureRef,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

const controls = vi.hoisted(() => ({
  publishDuringQuiescence: true,
  additionalProgress: false,
}));

vi.mock("../src/hosted-runtime/workspace-system-work.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/workspace-system-work.ts")>();
  return {
    ...actual,
    createHostedWorkspaceSystemWork(input: Parameters<typeof actual.createHostedWorkspaceSystemWork>[0]) {
      const work = actual.createHostedWorkspaceSystemWork(input);
      return {
        ...work,
        async quiesce() {
          await work.quiesce();
          if (!controls.publishDuringQuiescence) return;
          controls.publishDuringQuiescence = false;
          // A completed system pass dirties progress. A later canonical writer
          // publishes it while the idle boundary drains owned mutations.
          input.onCompleted({ checkpointReason: "system_mailbox_receipt", systemProgressed: true }, false);
          assert.ok(input.runnerInput.checkpointRuntimeRedactedStatus);
          await input.runnerInput.checkpointRuntimeRedactedStatus({
            reason: "canonical_runtime_commit",
            redactedStatus: null,
            workspace: input.runnerInput.checkpointRequestBuilder.latestWorkspace(),
          });
          if (controls.additionalProgress) {
            input.onCompleted({ checkpointReason: "system_mailbox_receipt", systemProgressed: true }, false);
          }
        },
      };
    },
  };
});

test.each([
  { initialGeneration: null, additionalProgress: false },
  { initialGeneration: "7", additionalProgress: false },
  { initialGeneration: "7", additionalProgress: true },
])("idle snapshot preserves quiescent progress: %j", async ({ initialGeneration, additionalProgress }) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-checkpoint-progress-"));
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const events: string[] = [];
  let currentVersion = "0";
  let currentGeneration = BigInt(initialGeneration ?? "0");
  controls.publishDuringQuiescence = true;
  controls.additionalProgress = additionalProgress;
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
      request: { runnerIdleTtlMs: 1 },
    }), {
      vaultRoot,
      async createCheckpointSnapshot(snapshot) {
        assert.equal(snapshot.expectedWorkspaceVersion, currentVersion);
        assert.equal(snapshot.systemMailboxProgressGeneration,
          (currentGeneration + (additionalProgress ? 1n : 0n)).toString());
        return { snapshotRef: createSnapshotFixtureRef({ hash: "e".repeat(64), size: 512 }) };
      },
      async importItem() { throw new Error("No mailbox items expected."); },
      async runAssistantPhase() { return { progressed: true, checkpointReason: "assistant_runtime_commit" }; },
      platform: createPlatform({
        mailboxPort: createMailboxPort({ events, items: [] }),
        workspacePort: createWorkspacePort({
          events,
          checkpointRequests,
          workspace: createWorkspaceState({ version: currentVersion, systemMailboxProgressGeneration: initialGeneration }),
          checkpointWorkspace(request) {
            assert.equal(request.expectedWorkspaceVersion, currentVersion);
            const requested = BigInt(request.systemMailboxProgressGeneration ?? "0");
            assert.ok(requested === currentGeneration || requested === currentGeneration + 1n);
            currentVersion = (BigInt(currentVersion) + 1n).toString();
            currentGeneration = requested;
            return createWorkspaceState({
              version: currentVersion,
              systemMailboxProgressGeneration: requested.toString(),
              snapshotRef: request.snapshotRef,
              redactedStatus: request.redactedStatus ?? null,
            });
          },
        }),
      }),
    });
    const publishedGeneration = BigInt(initialGeneration ?? "0") + 1n;
    assert.deepEqual(checkpointRequests.map((request) => [request.reason, request.systemMailboxProgressGeneration]), [
      ["canonical_runtime_commit", publishedGeneration.toString()],
      ["idle_shutdown", (publishedGeneration + (additionalProgress ? 1n : 0n)).toString()],
    ]);
  } finally {
    await removeTempRoot(vaultRoot);
  }
});

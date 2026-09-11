import {
  TEST_NOW,
  createBrowserVaultReplicaRef,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createSnapshotFixtureRef,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  createVaultSnapshotBundle,
  enqueueEnvironmentInterviewSystemMailboxItemForTest,
  mocks,
  removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess,
  writeMailboxImportStateFile,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault, readHabitatAspect } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { test, vi } from "vitest";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";

test.each(["no-active-share", "error"] as const)("settles concurrent Environment completion before a clean return with projection outcome %s", async (projectionOutcome) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-environment-completion-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  mocks.runAssistantAutomationPass.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TEST_NOW));
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    await enqueueEnvironmentInterviewSystemMailboxItemForTest({
      item: createMailboxItem({
        id: "mailbox_item_synthetic_environment_completion",
        dedupeKey: "environment-interview.completed:synthetic-completion",
        kind: "environment-interview.completed", lane: "system", laneSeq: "1",
      }),
      vaultRoot,
    });
    const importState = createEmptyHostedMailboxImportState();
    importState.watermarks.system = "1";
    await writeMailboxImportStateFile(vaultRoot, importState);
    const snapshot = await createVaultSnapshotBundle({ vaultRoot });
    const result = await runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({ request: { idleCheckpointDelayMs: 1 } }),
      {
        vaultRoot,
        runtimeWakeSignal: createCoalescingRuntimeWakeSignal(),
        async createCheckpointSnapshot() {
          assert.ok(checkpointRequests.length < 8, "Environment completion did not settle.");
          return { snapshotRef: createSnapshotFixtureRef({ hash: "e".repeat(64), size: 512 }) };
        },
        async importItem() { throw new Error("Environment work is already imported."); },
        platform: createPlatform({
          artifactBytesByHash: new Map([[snapshot.hash, snapshot.bytes]]),
          mailboxPort: createMailboxPort({
            events,
            items: [],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace: createWorkspaceState({ snapshotRef: snapshot.snapshotRef }),
          }),
          browserVaultReplicaPort: {
            async write({ replica }) {
              events.push("replica.write");
              return createBrowserVaultReplicaRef(replica);
            },
            async publishRef({ replicaRef }) {
              events.push("replica.publish");
              return { published: true, workspace: createWorkspaceState({ browserVaultReplicaRef: replicaRef }) };
            },
          },
          vaultSharePort: {
            async listActiveProjectionScopes() {
              if (projectionOutcome === "error") throw new Error("Synthetic projection failure.");
              return { projectionKinds: [], projectionScopes: [] };
            },
            async deliver() { throw new Error("No active projection scopes."); },
          },
        }),
        async runAssistantPhase() { return { progressed: false }; },
      },
    );
    const state = await readHostedSystemMailboxState(vaultRoot);
    assert.equal(mocks.runAssistantAutomationPass.mock.calls.length, 0);
    assert.equal((await readHabitatAspect({ slug: "sleep-environment", vaultRoot })).indicators.night_temp_c, 19);
    assert.ok(checkpointRequests.some((request) => request.reason === "idle_shutdown"));
    if (projectionOutcome === "error") {
      assert.equal(state.pending.length, 1);
      assert.equal(state.pending[0]?.status, "recording");
      assert.equal(state.pending[0]?.lastErrorCode, "HOSTED_VAULT_SHARE_PROJECTION_FAILED");
      assert.equal(result.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "0");
      assert.equal(state.pending[0]?.nextAttemptAt, new Date(Date.parse(TEST_NOW) + 60_000).toISOString());
      assert.equal(result.status, "scheduled");
      assert.ok(result.nextWakeAt);
    } else {
      assert.equal(state.pending.length, 0);
      assert.equal(result.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "1");
      assert.equal(events.filter((event) => event === "replica.publish").length, 1);
    }
  } finally {
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { initializeVault } from "@murphai/core";
import {
  buildHostedExecutionMemberPreferencesUpdatedWake,
  buildHostedExecutionRuntimeControlWake,
} from "@murphai/hosted-execution";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import {
  TEST_NOW, TEST_USER_ID, createBrowserVaultReplicaRef, createDeviceSyncResolvedConfig,
  createEmptyDeviceSyncPort, createMailboxItem, createMailboxPort, createPlatform,
  createResolvedRuntimeControlSystemMailboxItem, createVaultSnapshotBundle, createWorkspacePort,
  createWorkspaceRuntimeJobInput, createWorkspaceState, ensureHostedBootstrapMetadataForSystemMailboxTest,
  mocks, removeTempRoot, runHostedWorkspaceRuntimeJobInProcess, writeMailboxImportStateFile,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import { runHostedWorkspaceAssistantPhase } from "../src/hosted-runtime/workspace-assistant-phase.ts";

test("a refresh followed by preferences converges through durable default and system handoff", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-refresh-preferences-"));
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const events: string[] = [];
  const artifactBytesByHash = new Map<string, Uint8Array>();
  let publications = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TEST_NOW));
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    await ensureHostedBootstrapMetadataForSystemMailboxTest(vaultRoot);
    const refresh = createMailboxItem({
      id: "refresh_before_preferences", kind: "runtime.browser-vault-refresh-requested",
      dedupeKey: "runtime.browser-vault-refresh-requested:ordering", lane: "system", laneSeq: "1",
    });
    const preferences = createMailboxItem({
      id: "preferences_after_refresh", kind: "member.preferences.updated",
      dedupeKey: "member.preferences.updated:ordering", lane: "system", laneSeq: "2",
    });
    await enqueueHostedSystemMailboxItem({
      item: createResolvedRuntimeControlSystemMailboxItem(refresh), vaultRoot,
      wake: buildHostedExecutionRuntimeControlWake({
        eventId: refresh.dedupeKey, kind: "runtime.browser-vault-refresh-requested",
        occurredAt: TEST_NOW, userId: TEST_USER_ID,
      }),
    });
    const resolvedPreferences = createResolvedRuntimeControlSystemMailboxItem(preferences);
    await enqueueHostedSystemMailboxItem({
      item: { ...resolvedPreferences, route: { ...resolvedPreferences.route, action: "apply-member-preferences" } },
      vaultRoot,
      wake: buildHostedExecutionMemberPreferencesUpdatedWake({
        eventId: preferences.dedupeKey, memberId: TEST_USER_ID, occurredAt: TEST_NOW,
        preferences: { tone: "formal" },
      }),
    });
    const importState = createEmptyHostedMailboxImportState();
    importState.watermarks.system = "2";
    await writeMailboxImportStateFile(vaultRoot, importState);
    const snapshot = await createVaultSnapshotBundle({ vaultRoot });
    artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
    let workspace = createWorkspaceState({
      snapshotRef: snapshot.snapshotRef, version: "0",
      nextWakeAt: TEST_NOW, nextWakeReason: "mailbox",
      nextDefaultProcessingWakeAt: TEST_NOW, nextDefaultProcessingWakeReason: "assistant",
      systemMailboxProgressGeneration: "0",
    });
    const baseWorkspacePort = createWorkspacePort({ checkpointRequests, events, workspace });
    for (const processingMode of ["default", "system_mailbox", "system_mailbox"] as const) {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: { processingMode, workspaceVersion: workspace.version, runnerIdleTtlMs: 1 },
        resolvedConfig: createDeviceSyncResolvedConfig(),
      }), {
        vaultRoot,
        async createCheckpointSnapshot() {
          const next = await createVaultSnapshotBundle({ vaultRoot });
          artifactBytesByHash.set(next.hash, next.bytes);
          return { snapshotRef: next.snapshotRef };
        },
        async importItem() { throw new Error("Already imported work must not be imported again."); },
        async runAssistantPhase(input) {
          assert.equal(processingMode, "default");
          return await runHostedWorkspaceAssistantPhase({ ...input, now: () => TEST_NOW });
        },
        platform: createPlatform({
          artifactBytesByHash, deviceSyncPort: createEmptyDeviceSyncPort(),
          mailboxPort: createMailboxPort({ events, items: [] }),
          browserVaultReplicaPort: {
            async write(request) { return createBrowserVaultReplicaRef(request.replica); },
            async publishRef(request) {
              publications += 1;
              workspace = { ...workspace, browserVaultReplicaRef: request.replicaRef };
              return { published: true, workspace };
            },
          },
          workspacePort: {
            ...baseWorkspacePort,
            async read() { return { fetchedAt: TEST_NOW, workspace }; },
            async checkpoint(request) {
              const response = await baseWorkspacePort.checkpoint(request);
              workspace = { ...response.workspace, browserVaultReplicaRef: workspace.browserVaultReplicaRef };
              return { ...response, workspace };
            },
          },
        }),
      });
      assert.equal(workspace.nextDefaultProcessingWakeAt, null,
        "A completed settings update must not keep forcing default-mode invocations.");
      if (processingMode === "default") {
        assert.equal(result.nextWakeReason, "mailbox");
        assert.equal(workspace.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "0",
          "Applying the later settings item must not acknowledge the pending refresh.");
        assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending.length, 1);
      } else {
        assert.equal(result.nextWakeAt, null);
        assert.equal(workspace.redactedStatus?.hostedMailboxSystemHandledThroughSeq, "2");
        assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
      }
    }
    assert.equal(publications, 1, "Publish the refresh once, then remain idle on replay.");
    assert.equal(mocks.runAssistantAutomationPass.mock.calls.length, 0);
  } finally {
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});

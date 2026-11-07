import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { initializeVault, upsertAutomation } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { readHostedSystemMailboxState, updateHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  TEST_NOW, TEST_USER_ID, createDeviceSyncResolvedConfig, createMailboxItem,
  createMailboxPort, createPlatform, createSnapshotDeviceSyncPort,
  createSnapshotFixtureRef, createVaultSnapshotBundle, createWorkspacePort,
  createWorkspaceRuntimeJobInput, createWorkspaceState,
  enqueueDeviceSyncSystemMailboxItemForTest, removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess, writeMailboxImportStateFile,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

test.each(["future", "clear", "model_free"] as const)(
  "retires a serviced assistant wake while replaying a restored device completion: %s", async (successor) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-empty-followup-"));
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const events: string[] = [];
  const futureAt = "2026-04-27T05:00:00.000Z";
  const deviceSyncPort = createSnapshotDeviceSyncPort({
    connectionId: "synthetic-completed-connection", nextReconcileAt: futureAt,
  });
  let acknowledgments = 0;
  let assistantPasses = 0;
  deviceSyncPort.ackDirtyStateProcessed = async (request) => {
    acknowledgments++;
    return { connectionId: request.connectionId, dirtyRevision: request.processedRevision,
      processedRevision: request.processedRevision, recorded: true, stillDirty: false,
      nextWakeAt: null, userId: TEST_USER_ID };
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TEST_NOW));
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    if (successor === "model_free") {
      await upsertAutomation({
        slug: "synthetic-next-cron", continuityPolicy: "fresh",
        instructions: "Run the synthetic scheduled check.", title: "Synthetic check",
        now: new Date(TEST_NOW), status: "active", vaultRoot,
        schedule: { kind: "at", at: futureAt },
        route: { channel: "telegram", deliveryTarget: "synthetic-chat",
          identityId: null, participantId: null, threadId: null, threadIsDirect: true },
      });
    }
    const item = createMailboxItem({ id: "synthetic-restored-completion",
      dedupeKey: "device-sync.wake:synthetic-completion", kind: "device-sync.wake",
      lane: "system", laneSeq: "1" });
    await enqueueDeviceSyncSystemMailboxItemForTest({ item, vaultRoot });
    await updateHostedSystemMailboxState(vaultRoot, (state) => ({
      pending: state.pending.map((pending) => ({ ...pending, status: "recording" as const,
        postCheckpointRecord: { kind: "device-sync.dirty-processed" as const,
          connectionId: "synthetic-completed-connection", processedRevision: "2",
          processedDirtyPayloadIds: ["synthetic-completed-payload"] },
      })),
    }));
    const imported = createEmptyHostedMailboxImportState();
    imported.watermarks.system = "1";
    await writeMailboxImportStateFile(vaultRoot, imported);
    const snapshot = await createVaultSnapshotBundle({ vaultRoot });
    const result = await runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({
        request: { workspaceVersion: "0", runnerIdleTtlMs: 1 },
        resolvedConfig: createDeviceSyncResolvedConfig(),
      }), {
        vaultRoot,
        platform: createPlatform({
          artifactBytesByHash: new Map([[snapshot.hash, snapshot.bytes]]), deviceSyncPort,
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({ events, checkpointRequests,
            workspace: createWorkspaceState({ version: "0", snapshotRef: snapshot.snapshotRef,
              nextWakeAt: TEST_NOW, nextWakeReason: "assistant" }) }),
        }),
        async createCheckpointSnapshot() {
          assert.equal(acknowledgments, 1, "the restored journal may replay before saving its cleanup");
          assert.equal((await readHostedSystemMailboxState(vaultRoot)).pending
            .some((pending) => pending.itemId === item.id), false, "the snapshot includes journal cleanup");
          return { snapshotRef: createSnapshotFixtureRef({ hash: "b".repeat(64), size: 512 }) };
        },
        async importItem() {
          throw new Error("The restored completion must not import mailbox work.");
        },
        async runAssistantPhase() {
          assistantPasses++;
          return { checkpointReason: "assistant_runtime_commit", progressed: true,
            // The real phase can select the still-recording device journal
            // ahead of the future cron it has just computed.
            nextWakeAt: successor === "clear" ? null : successor === "model_free" ? TEST_NOW : futureAt,
            nextWakeReason: successor === "model_free" ? "device-sync.reconcile" : "assistant" };
        },
      },
    );
    assert.equal(assistantPasses, 1);
    assert.equal(acknowledgments, 1);
    const expectedDefaultWake = successor === "clear" ? null : futureAt;
    assert.equal(checkpointRequests.at(-1)?.nextDefaultProcessingWakeAt, expectedDefaultWake);
    assert.ok(result.nextWakeAt == null || Date.parse(result.nextWakeAt) > Date.now(),
      "the completed wake must not dispatch another invocation");
    assert.equal(checkpointRequests.at(-1)?.nextWakeAt, result.nextWakeAt ?? null);
    if (successor === "future") assert.equal(result.nextWakeAt, futureAt);
    const finalStatus = checkpointRequests.at(-1)?.redactedStatus;
    assert.equal(finalStatus?.hostedMailboxSystemImportedSeq, "1");
    assert.equal(finalStatus?.hostedMailboxSystemHandledThroughSeq, "1");
    assert.equal(checkpointRequests.filter((entry) => entry.reason === "idle_shutdown").length, 1);
  } finally {
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});

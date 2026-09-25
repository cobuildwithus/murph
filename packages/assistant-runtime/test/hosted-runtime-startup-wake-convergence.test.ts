import {
  TEST_NOW,
  createDeviceSyncResolvedConfig,
  createEmptyDeviceSyncPort,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createSnapshotFixtureRef,
  createVaultSnapshotBundle,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  enqueueDeviceSyncSystemMailboxItemForTest,
  removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess,
  writeMailboxImportStateFile,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { initializeVault } from "@murphai/core";
import type {
  HostedMailboxFetchRequest,
  HostedWorkspaceCheckpointRequest,
} from "@murphai/hosted-execution/runtime-control";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";

test.each([false, true].flatMap((restored) =>
  (["quiet", "untyped", "system_mailbox", "default"] as const).map((mode) => ({ restored, mode }))
))(
  "$mode startup hints complete device work (restored=$restored)",
  async ({ mode, restored }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-startup-wake-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const events: string[] = [];
    const wake = createCoalescingRuntimeWakeSignal();
    const device = createEmptyDeviceSyncPort();
    const item = createMailboxItem({
      id: "synthetic_startup_device_item", dedupeKey: "device-sync.wake:startup",
      kind: "device-sync.wake", lane: "system", laneSeq: "1",
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      if (restored) {
        await enqueueDeviceSyncSystemMailboxItemForTest({ item, vaultRoot });
        const state = createEmptyHostedMailboxImportState();
        state.watermarks.system = "1";
        await writeMailboxImportStateFile(vaultRoot, state);
      }
      const snapshot = await createVaultSnapshotBundle({ vaultRoot });
      const mailbox = createMailboxPort({ events, fetchRequests, items: restored ? [] : [item] });
      let notified = false;
      let foregroundReadsBeforeDevice: number | null = null;
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: { processingMode: "system_mailbox", workspaceVersion: "0", runnerIdleTtlMs: 0 },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          vaultRoot,
          runtimeWakeSignal: wake,
          async createCheckpointSnapshot() {
            return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 512 }) };
          },
          async importItem() {
            await enqueueDeviceSyncSystemMailboxItemForTest({ item, vaultRoot });
            return { status: "imported" };
          },
          async runAssistantPhase() { throw new Error("An empty hint must not admit the assistant."); },
          platform: createPlatform({
            artifactBytesByHash: new Map([[snapshot.hash, snapshot.bytes]]),
            deviceSyncPort: {
              ...device,
              async fetchSnapshot() {
                foregroundReadsBeforeDevice ??= fetchRequests.filter((request) =>
                  request.lanes.some(({ lane }) => lane === "conversation")
                ).length;
                return await device.fetchSnapshot();
              },
            },
            mailboxPort: {
              ...mailbox,
              async fetch(request) {
                const response = await mailbox.fetch(request);
                if (!notified && mode !== "quiet") {
                  notified = true;
                  for (let burst = 0; burst < 5; burst += 1) {
                    wake.notify({ requestedProcessingMode: mode === "untyped" ? undefined : mode });
                  }
                }
                return response;
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests, events,
              workspace: createWorkspaceState({ snapshotRef: snapshot.snapshotRef, version: "0" }),
            }),
          }),
        },
      );
      expect(device.fetchSnapshotCalls).toBeGreaterThan(0);
      expect(foregroundReadsBeforeDevice).toBe(mode === "quiet" ? 0 : 1);
      expect((await readHostedSystemMailboxState(vaultRoot)).pending).toEqual([]);
      expect(checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq).toBe("1");
      expect(result.immediateRecheckRequested).not.toBe(true);
      expect(result.nextWakeReason).not.toBe("assistant");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  },
);

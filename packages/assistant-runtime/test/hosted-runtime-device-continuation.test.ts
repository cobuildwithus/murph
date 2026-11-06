import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { initializeVault } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import type { HostedRuntimeDeviceSyncPort } from "../src/hosted-runtime-contracts.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import {
  TEST_NOW, TEST_USER_ID, createDeviceSyncResolvedConfig, createMailboxItem,
  createMailboxPort, createPlatform, createResolvedDeviceSyncSystemMailboxItem,
  createSnapshotDeviceSyncPort, createVaultSnapshotBundle, createWorkspacePort,
  createWorkspaceRuntimeJobInput, createWorkspaceState, removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess, writeMailboxImportStateFile,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

test.each(["progress", "unblocked_progress", "future", "failure", "checkpoint_failure"] as const)(
  "system mailbox history recheck follows committed runnable progress: %s",
  async (scenario) => {
    const expectsProgress = scenario === "progress" || scenario === "unblocked_progress";
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-device-continuation-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const connectionId = "synthetic_junction_history";
    const futureAt = new Date(Date.parse(TEST_NOW) + 86_400_000).toISOString();
    const windowEnd = new Date(Date.parse(TEST_NOW) - 2 * 86_400_000).toISOString();
    const windowStart = new Date(Date.parse(windowEnd) - 1_601 * 86_400_000).toISOString();
    const requestedDays: string[] = [];
    const baseDeviceSyncPort = createSnapshotDeviceSyncPort({ connectionId, nextReconcileAt: futureAt });
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...baseDeviceSyncPort,
      async fetchSnapshot(request) {
        const snapshot = await baseDeviceSyncPort.fetchSnapshot(request);
        return { ...snapshot, connections: snapshot.connections.map((entry) => ({
          ...entry, sources: [],
          connection: { ...entry.connection, provider: "junction", externalAccountId: "synthetic-junction-account" },
          credential: { kind: "provider_config" as const, providerConfigKey: "junction", credentialMetadata: {} },
        })) };
      },
    };
    const resolvedConfig = createDeviceSyncResolvedConfig();
    resolvedConfig.deviceSync!.providerConfigs = { junction: {
      environment: "sandbox", region: "us",
    } };
    const deviceItem = createMailboxItem({
      id: "synthetic_history_item", dedupeKey: "device-sync.wake:synthetic-history",
      kind: "device-sync.wake", lane: "system", laneSeq: "1",
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(TEST_NOW));
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.includes("/user/providers/")) {
        return Response.json({ providers: [] });
      }
      assert.match(url.pathname, /\/hrv\/grouped$/u);
      requestedDays.push(url.searchParams.get("start_date")!);
      return scenario === "failure"
        ? Response.json({ detail: "Synthetic rejected request" }, { status: 400 })
        : Response.json({ groups: {} });
    });
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncSystemMailboxItem(deviceItem), vaultRoot,
        wake: { connectionId, eventId: deviceItem.dedupeKey, expectedConnectedAt: TEST_NOW,
          kind: "device-sync.wake", occurredAt: TEST_NOW, provider: "junction",
          reason: "reconcile_due", userId: TEST_USER_ID,
          hint: { nextReconcileAt: futureAt, jobs: [{
            availableAt: scenario === "future" ? futureAt : TEST_NOW,
            dedupeKey: "synthetic-history-window", kind: "resource", maxAttempts: 1, priority: 30,
            payload: { eventType: "historical.data.hrv.created", resource: "hrv",
              resourceCategory: "timeseries", windowStart, windowEnd },
          }] },
        },
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const snapshot = await createVaultSnapshotBundle({ vaultRoot });
      const artifactBytesByHash = new Map([[snapshot.hash, snapshot.bytes]]);
      const run = () => runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({ request: {
          attemptId: "attempt_synthetic_history_continuation", processingMode: "system_mailbox",
          ...(scenario === "unblocked_progress" ? {} : { assistantExecutionBlocked: true as const }),
          workspaceVersion: "0",
        }, resolvedConfig, platformEnv: {
          JUNCTION_API_KEY: "sk_us_test_123", JUNCTION_CLIENT_USER_ID_SECRET: "synthetic-junction-secret",
          JUNCTION_ENV: "sandbox", JUNCTION_REGION: "us",
        } }),
        {
          async importItem() { return { status: "imported" }; },
          async createCheckpointSnapshot() {
            if (scenario === "checkpoint_failure" && requestedDays.length > 0) throw new Error("Synthetic checkpoint failure");
            const next = await createVaultSnapshotBundle({ vaultRoot });
            artifactBytesByHash.set(next.hash, next.bytes);
            return { snapshotRef: next.snapshotRef };
          },
          platform: createPlatform({ artifactBytesByHash, deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({ checkpointRequests, events,
              workspace: createWorkspaceState({ snapshotRef: snapshot.snapshotRef, version: "0",
                nextWakeAt: TEST_NOW, nextWakeReason: "device-sync.reconcile",
                systemMailboxProgressGeneration: "9" }),
            }),
          }),
          async runAssistantPhase() { throw new Error("History must remain model-free"); },
          vaultRoot,
        },
      );
      if (scenario === "checkpoint_failure") {
        await assert.rejects(run, /Synthetic checkpoint failure/u);
        return;
      }
      const result = await run();
      assert.equal(result.immediateRecheckRequested, expectsProgress ? true : undefined);
      if (expectsProgress) {
        assert.equal(requestedDays.length, 1_600);
        assert.equal(new Set(requestedDays).size, 1_600);
        assert.equal(result.nextWakeReason, "device-sync.reconcile");
        assert.ok(Date.parse(result.nextWakeAt!) <= Date.parse(TEST_NOW));
        assert.ok(BigInt(checkpointRequests.at(-1)?.systemMailboxProgressGeneration ?? "0") > 9n);
        const retained = (await readHostedSystemMailboxState(vaultRoot)).pending[0];
        assert.equal(retained?.wake.kind, "device-sync.wake");
        if (retained?.wake.kind !== "device-sync.wake") throw new Error("Missing history owner");
        assert.equal(retained.wake.hint?.jobs?.[0]?.payload?.windowStart,
          new Date(Date.parse(windowStart) + 1_600 * 86_400_000).toISOString());
      } else if (scenario === "future") {
        assert.equal(requestedDays.length, 0);
        assert.equal(result.nextWakeAt, futureAt);
      }
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  },
);

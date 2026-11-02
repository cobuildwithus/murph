import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "vitest";
import { initializeVault } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import {
  TEST_NOW, createMailboxItem, createMailboxPort, createPlatform,
  createSnapshotFixtureRef, createWorkspacePort, createWorkspaceRuntimeJobInput,
  createWorkspaceState, removeTempRoot, runHostedWorkspaceRuntimeJobInProcess,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime.ts";

test("idle retirement bounds snapshots when a due assistant pass finds no work", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-retirement-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  let snapshots = 0;
  let passes = 0;
  let effects = 0;
  let retiring = false;
  const laterWakeAt = "2026-04-27T00:02:00.000Z";
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    const result = await runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 1 } }), {
        vaultRoot,
        onIdleRetirement: () => { retiring = true; },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({ events, checkpointRequests,
            workspace: createWorkspaceState({ version: "0" }) }),
        }),
        async createCheckpointSnapshot() {
          assert.ok(++snapshots <= 2, "idle retirement must not publish a third snapshot");
          return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 512 }) };
        },
        async importItem() { return { status: "imported" }; },
        async runAssistantPhase() {
          if (++passes > 1) return { progressed: false, nextWakeAt: null, nextWakeReason: null };
          return {
            progressed: true, checkpointReason: "system_mailbox_receipt",
            nextWakeAt: TEST_NOW, nextWakeReason: "assistant",
            afterCheckpoint: async () => ({
              checkpointReason: "system_mailbox_receipt",
              nextWakeAt: TEST_NOW, nextWakeReason: "assistant",
              afterDurableCheckpoint: async () => {
                assert.equal(retiring, true, "host admission closes before effect drain");
                effects++;
                return { requiresFollowUpCheckpoint: true,
                  nextWakeAt: laterWakeAt, nextWakeReason: "system-mailbox" };
              },
            }),
          };
        },
      });
    assert.equal(snapshots, 2, "only source and required effect saves are allowed");
    assert.equal(passes, 1, "the successor owns checkpoint-gated assistant work");
    assert.equal(effects, 1);
    assert.equal(result.nextWakeAt, TEST_NOW);
    assert.equal(result.nextWakeReason, "assistant");
  } finally { await removeTempRoot(vaultRoot); }
});

test("idle retirement leaves a newly arrived device wake to the successor", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-retirement-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const items: ReturnType<typeof createMailboxItem>[] = [];
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  let snapshots = 0;
  let imports = 0;
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    const result = await runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 1 } }), {
        vaultRoot, runtimeWakeSignal,
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items }),
          workspacePort: createWorkspacePort({ events, checkpointRequests,
            workspace: createWorkspaceState({ version: "0" }),
            checkpointWorkspace: (request) => {
              items.push(createMailboxItem({ id: `device-retirement-${checkpointRequests.length}`,
                lane: "system", laneSeq: String(checkpointRequests.length), kind: "device-sync.wake" }));
              runtimeWakeSignal.notify();
              return createWorkspaceState({ version: String(checkpointRequests.length),
                snapshotRef: request.snapshotRef, nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null, redactedStatus: request.redactedStatus ?? null });
            },
          }),
        }),
        async createCheckpointSnapshot() {
          assert.ok(++snapshots <= 1, "device wake must not restart idle snapshots");
          return { snapshotRef: createSnapshotFixtureRef({ hash: "b".repeat(64), size: 512 }) };
        },
        async importItem() { imports++; return { status: "imported" }; },
        async runAssistantPhase() { return { progressed: true,
          checkpointReason: "system_mailbox_receipt", nextWakeAt: TEST_NOW,
          nextWakeReason: "device-sync.reconcile" }; },
      });
    assert.equal(snapshots, 1);
    assert.equal(imports, 0);
    assert.equal(result.status, "scheduled");
    assert.ok(result.nextWakeAt);
  } finally { await removeTempRoot(vaultRoot); }
});

test.each(["empty", "deferred", "yielded"] as const)("assistant wake handoff distinguishes %s service", async (outcome) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-idle-retirement-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  let passes = 0;
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    const result = await runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 100 } }), {
        vaultRoot,
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [createMailboxItem()] }),
          workspacePort: createWorkspacePort({ events, checkpointRequests,
            workspace: createWorkspaceState({ version: "0" }) }),
        }),
        async createCheckpointSnapshot() {
          return { snapshotRef: createSnapshotFixtureRef({ hash: "c".repeat(64), size: 512 }) };
        },
        async importItem() { return { status: "imported" }; },
        async runAssistantPhase() {
          if (++passes > 1) return outcome === "yielded" ? { progressed: false } : {
            progressed: false, nextWakeAt: outcome === "empty" ? null : TEST_NOW,
            nextWakeReason: outcome === "empty" ? null : "assistant",
          };
          return { progressed: true, checkpointReason: "assistant_runtime_commit",
            invocationLocalAssistantWakeAt: TEST_NOW,
            nextWakeAt: TEST_NOW, nextWakeReason: "assistant" };
        },
      });
    assert.equal(passes, 2);
    assert.equal(checkpointRequests.length, 1);
    assert.equal(checkpointRequests[0]?.nextWakeAt, outcome === "empty" ? null : TEST_NOW);
    assert.equal(result.nextWakeAt, outcome === "empty" ? null : TEST_NOW);
  } finally { await removeTempRoot(vaultRoot); }
});

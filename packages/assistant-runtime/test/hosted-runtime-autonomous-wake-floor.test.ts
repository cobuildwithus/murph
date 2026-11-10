import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import type {
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { sha256HostedBundleHex, snapshotHostedBundleRoots } from "@murphai/runtime-state/node";
import { test, vi } from "vitest";
import {
  createMailboxPort, createPlatform, createSnapshotFixtureRef,
  createWorkspacePort, createWorkspaceRuntimeJobInput, createWorkspaceState,
  removeTempRoot, runHostedWorkspaceRuntimeJobInProcess,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

test.each([
  { reason: "device-sync.reconcile", label: "cold-restored 15-second device retry", retryMs: 15_000 },
  { reason: "assistant", label: "republished due assistant wake", retryMs: -1_000 },
])("self-wake floor paces $label after twenty short publications", async ({ reason, retryMs }) => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-autonomous-floor-"));
  const source = path.join(root, "source");
  const artifacts = new Map<string, Uint8Array>();
  const snapshot = async (vaultRoot: string) => {
    const bytes = await snapshotHostedBundleRoots({
      kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault" }],
    });
    assert.ok(bytes);
    const hash = sha256HostedBundleHex(bytes);
    artifacts.set(hash, bytes);
    return createSnapshotFixtureRef({ hash, size: bytes.byteLength });
  };
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const events: string[] = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T12:00:00.000Z"));
  try {
    await initializeVault({ createdAt: new Date().toISOString(), vaultRoot: source });
    let workspace: HostedWorkspaceState = createWorkspaceState({
      version: "0",
      snapshotRef: await snapshot(source),
      nextWakeAt: new Date().toISOString(),
      nextWakeReason: reason,
    });
    for (let invocation = 0; invocation < 22; invocation += 1) {
      const live = path.join(root, `live-${invocation}`);
      const publishedAtMs = Date.now();
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({ request: {
          attemptId: `attempt_synthetic_autonomous_${invocation}`,
          runnerIdleTtlMs: 1,
          workspaceVersion: workspace.version,
        } }),
        {
          vaultRoot: live,
          platform: createPlatform({
            artifactBytesByHash: artifacts,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              events, checkpointRequests, workspace,
              checkpointWorkspace(request) {
                workspace = createWorkspaceState({
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                  snapshotRef: request.snapshotRef,
                  inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  nextDefaultProcessingWakeAt: request.nextDefaultProcessingWakeAt ?? null,
                  nextDefaultProcessingWakeReason: request.nextDefaultProcessingWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                });
                return workspace;
              },
            }),
          }),
          async createCheckpointSnapshot() {
            return { snapshotRef: await snapshot(live) };
          },
          async importItem() { return { status: "imported" }; },
          async runAssistantPhase() {
            return {
              progressed: true as const,
              checkpointReason: "assistant_runtime_commit" as const,
              nextWakeAt: reason === "assistant"
                ? workspace.nextWakeAt
                : new Date(Date.now() + retryMs).toISOString(),
              nextWakeReason: reason,
              ...(reason === "device-sync.reconcile"
                ? { nextWakeAutonomous: true as const }
                : {}),
            };
          },
        },
      );
      const delayMs = Date.parse(result.nextWakeAt ?? "") - publishedAtMs;
      if (invocation < 20) {
        assert.ok(delayMs < 5 * 60_000, `invocation ${invocation} kept its short wake`);
      } else {
        assert.ok(delayMs >= 5 * 60_000, `invocation ${invocation} was paced; delay=${delayMs}; count=${workspace.redactedStatus?.hostedAutonomousShortWakeCount}; reason=${workspace.nextWakeReason}`);
      }
      assert.equal(workspace.nextWakeAt, result.nextWakeAt);
      if (invocation < 21) {
        vi.setSystemTime(new Date(Math.max(
          publishedAtMs + 15_000,
          Date.parse(result.nextWakeAt ?? ""),
        )));
      }
    }
    assert.equal(workspace.redactedStatus?.hostedAutonomousShortWakeCount, 20);
    if (reason === "device-sync.reconcile") {
      const foregroundAt = new Date().toISOString();
      assert.ok(Date.parse(workspace.nextWakeAt ?? "") > Date.parse(foregroundAt));
      const live = path.join(root, "foreground-arrival");
      let foregroundPhaseCalled = false;
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({ request: {
          attemptId: "attempt_synthetic_foreground_arrival",
          runnerIdleTtlMs: 1,
          workspaceVersion: workspace.version,
        } }),
        {
          vaultRoot: live,
          platform: createPlatform({
            artifactBytesByHash: artifacts,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              events, checkpointRequests, workspace,
              checkpointWorkspace(request) {
                workspace = createWorkspaceState({
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                  snapshotRef: request.snapshotRef,
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  nextDefaultProcessingWakeAt: request.nextDefaultProcessingWakeAt ?? null,
                  nextDefaultProcessingWakeReason: request.nextDefaultProcessingWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                });
                return workspace;
              },
            }),
          }),
          async createCheckpointSnapshot() {
            return { snapshotRef: await snapshot(live) };
          },
          async importItem() { return { status: "imported" }; },
          async runAssistantPhase() {
            foregroundPhaseCalled = true;
            return {
              progressed: true as const,
              checkpointReason: "assistant_runtime_commit" as const,
              nextWakeAt: foregroundAt,
              nextWakeReason: "assistant",
              invocationLocalAssistantWakeAt: foregroundAt,
              foregroundReplyFailed: 0,
            };
          },
        },
      );
      assert.equal(foregroundPhaseCalled, true);
      assert.ok(Date.parse(result.nextWakeAt ?? "") < Date.parse(foregroundAt) + 5_000,
        "member-awaited continuation keeps its immediate wake");
    }
  } finally {
    vi.useRealTimers();
    await removeTempRoot(root);
  }
}, 120_000);

test("a clean autonomous return persists its count without a new snapshot", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-autonomous-clean-"));
  const source = path.join(root, "source");
  const live = path.join(root, "live");
  const artifacts = new Map<string, Uint8Array>();
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  let snapshotCalls = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T12:00:00.000Z"));
  try {
    await initializeVault({ createdAt: new Date().toISOString(), vaultRoot: source });
    const bytes = await snapshotHostedBundleRoots({
      kind: "vault", roots: [{ root: source, rootKey: "vault" }],
    });
    assert.ok(bytes);
    const hash = sha256HostedBundleHex(bytes);
    artifacts.set(hash, bytes);
    const initialSnapshotRef = createSnapshotFixtureRef({ hash, size: bytes.byteLength });
    let workspace = createWorkspaceState({
      version: "0",
      snapshotRef: initialSnapshotRef,
      nextWakeAt: new Date().toISOString(),
      nextWakeReason: "device-sync.reconcile",
    });
    const result = await runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({ request: {
        attemptId: "attempt_synthetic_clean_autonomous",
        runnerIdleTtlMs: 1,
        workspaceVersion: workspace.version,
      } }),
      {
        vaultRoot: live,
        platform: createPlatform({
          artifactBytesByHash: artifacts,
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            events, checkpointRequests, workspace,
            checkpointWorkspace(request) {
              workspace = createWorkspaceState({
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                snapshotRef: request.snapshotRef,
                nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null,
                redactedStatus: request.redactedStatus ?? null,
              });
              return workspace;
            },
          }),
        }),
        async createCheckpointSnapshot() {
          snapshotCalls += 1;
          return { snapshotRef: initialSnapshotRef };
        },
        async importItem() { return { status: "imported" }; },
        async runAssistantPhase() {
          return {
            progressed: false as const,
            nextWakeAt: new Date(Date.now() + 15_000).toISOString(),
            nextWakeReason: "device-sync.reconcile",
            nextWakeAutonomous: true as const,
          };
        },
      },
    );
    assert.equal(snapshotCalls, 0);
    assert.deepEqual(workspace.snapshotRef, initialSnapshotRef);
    assert.equal(workspace.redactedStatus?.hostedAutonomousShortWakeCount, 1);
    assert.equal(workspace.nextWakeAt, result.nextWakeAt);
  } finally {
    vi.useRealTimers();
    await removeTempRoot(root);
  }
}, 30_000);

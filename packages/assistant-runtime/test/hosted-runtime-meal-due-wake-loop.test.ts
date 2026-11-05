import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addMeal, initializeVault, runMealPhotoMaintenance } from "@murphai/core";
import type {
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { sha256HostedBundleHex, snapshotHostedBundleRoots } from "@murphai/runtime-state/node";
import { test } from "vitest";
import { createMealMediaStore } from "./hosted-meal-media.harness.ts";
import {
  createMailboxPort, createPlatform, createSnapshotFixtureRef, createWorkspacePort,
  createWorkspaceRuntimeJobInput, createWorkspaceState, removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { publishHostedWorkspaceMediaReferences } from "../src/hosted-runtime/media-references.ts";
import type { HostedWorkspaceRunnerAssistantPhaseResult } from "../src/hosted-runtime/workspace-runner.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==";
const computedWakeAt = () => new Date(Date.now() + 9 * 60 * 60_000).toISOString();

// A thumbnail that stayed pending made each invocation's retry checkpoint rebase
// onto the restored due assistant wake, so the runner re-woke every ~25 s.
test.each([
  ["computes the next schedule", (): HostedWorkspaceRunnerAssistantPhaseResult => ({
    progressed: true, checkpointReason: "assistant_runtime_commit",
    nextWakeAt: computedWakeAt(), nextWakeReason: "assistant" })],
  ["finds no work", (): HostedWorkspaceRunnerAssistantPhaseResult => ({ progressed: false })],
])("a pending meal thumbnail does not re-arm a serviced due wake when the pass %s", async (_label, pass) => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-meal-due-wake-"));
  const source = path.join(root, "source");
  const live = path.join(root, "live");
  const artifacts = new Map<string, Uint8Array>();
  const mealMedia = createMealMediaStore();
  const snapshot = async (vaultRoot: string) => {
    const bundle = await snapshotHostedBundleRoots({ kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault" }] });
    assert.ok(bundle);
    const hash = sha256HostedBundleHex(bundle);
    artifacts.set(hash, bundle);
    return createSnapshotFixtureRef({ hash, size: bundle.byteLength });
  };
  const dueWakeAt = new Date(Date.now() - 60_000).toISOString();
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  try {
    await initializeVault({ createdAt: new Date().toISOString(), vaultRoot: source });
    const photoPath = path.join(root, "fixture.png");
    await writeFile(photoPath, Buffer.from(PNG, "base64"));
    const now = new Date().toISOString();
    await addMeal({ vaultRoot: source, photoPath, occurredAt: now, photoCapturedAt: now });
    await runMealPhotoMaintenance({ vaultRoot: source, now: new Date() });
    await publishHostedWorkspaceMediaReferences({ vaultRoot: source, mediaStore: mealMedia.mediaStore });
    // Slower than the per-invocation delivery budget, so the thumbnail stays pending.
    mealMedia.hooks.before = async () => { await new Promise((resolve) => setTimeout(resolve, 2_500)); };
    let workspace: HostedWorkspaceState = createWorkspaceState({
      version: "0", snapshotRef: await snapshot(source),
      nextWakeAt: dueWakeAt, nextWakeReason: "assistant",
      nextDefaultProcessingWakeAt: dueWakeAt, nextDefaultProcessingWakeReason: "assistant",
    });
    const events: string[] = [];
    const result = await runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 1 } }), {
        vaultRoot: live,
        platform: {
          ...createPlatform({
            artifactBytesByHash: artifacts,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({ events, checkpointRequests, workspace,
              checkpointWorkspace(request) {
                workspace = createWorkspaceState({
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                  snapshotRef: request.snapshotRef,
                  inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                  nextWakeAt: request.nextWakeAt ?? null, nextWakeReason: request.nextWakeReason ?? null,
                  nextDefaultProcessingWakeAt: request.nextDefaultProcessingWakeAt ?? null,
                  nextDefaultProcessingWakeReason: request.nextDefaultProcessingWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                });
                return workspace;
              } }),
          }),
          mediaStore: mealMedia.mediaStore,
        },
        async createCheckpointSnapshot() { return { snapshotRef: await snapshot(live) }; },
        async importItem() { return { status: "imported" }; },
        async runAssistantPhase() { return pass(); },
      });
    assert.deepEqual(mealMedia.calls.map((call) => call.operation), ["record"]);
    assert.deepEqual(checkpointRequests.map((request) => request.reason),
      ["canonical_runtime_commit", "idle_shutdown"]);
    for (const request of checkpointRequests) {
      assert.notEqual(request.nextWakeAt, dueWakeAt, `${request.reason} re-armed the serviced due wake`);
    }
    assert.ok(result.nextWakeAt && Date.parse(result.nextWakeAt) > Date.now(),
      "the next invocation is the thumbnail retry or the computed schedule, not an immediate re-wake");
  } finally { await removeTempRoot(root); }
}, 30_000);

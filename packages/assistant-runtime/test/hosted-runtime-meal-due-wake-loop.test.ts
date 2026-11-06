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

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==";
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

// A thumbnail that stayed pending made each invocation's retry checkpoint rebase
// onto the restored wake: a serviced due wake re-armed itself (~25 s loop) and an
// earlier wake the pass had just computed was replaced by the later restored one.
test.each([
  { label: "a serviced due wake re-arms", committedInMs: -60_000, passInMs: 9 * 60 * 60_000 },
  { label: "a meal-only dirty runtime skip its idle checkpoint timer", committedInMs: -60_000, passInMs: null },
  { label: "an earlier computed wake is replaced", committedInMs: 9 * 60 * 60_000, passInMs: 30 * 60_000 },
])("a pending meal thumbnail retry does not let $label", async ({ committedInMs, passInMs }) => {
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
  const committedWakeAt = inMs(committedInMs);
  const passWakeAt = passInMs === null ? null : inMs(passInMs);
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
      nextWakeAt: committedWakeAt, nextWakeReason: "assistant",
      nextDefaultProcessingWakeAt: committedWakeAt, nextDefaultProcessingWakeReason: "assistant",
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
        async runAssistantPhase() {
          return passWakeAt === null ? { progressed: false } : {
            progressed: true, checkpointReason: "assistant_runtime_commit", nextWakeAt: passWakeAt, nextWakeReason: "assistant" };
        },
      });
    assert.deepEqual(mealMedia.calls.map((call) => call.operation), ["record"]);
    assert.deepEqual(checkpointRequests.map((request) => request.reason),
      ["canonical_runtime_commit", "idle_shutdown"]);
    if (committedInMs < 0) {
      for (const request of checkpointRequests) {
        assert.notEqual(request.nextWakeAt, committedWakeAt, `${request.reason} re-armed the serviced due wake`);
      }
    }
    if (passWakeAt !== null) {
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, passWakeAt, "the idle snapshot publishes the wake the pass computed");
    }
    assert.ok(result.nextWakeAt && Date.parse(result.nextWakeAt) > Date.now(), "no immediate re-wake");
  } finally { await removeTempRoot(root); }
}, 30_000);

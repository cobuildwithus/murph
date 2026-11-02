import {
  createBrowserVaultReplicaRef,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createSnapshotFixtureRef,
  createWorkspacePort,
  createVaultSnapshotBundle,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess,
  withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addMeal, initializeVault } from "@murphai/core";
import { parseBrowserVaultReplica } from "@murphai/query/browser";
import { editMealRecord } from "@murphai/vault-usecases/records";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { test } from "vitest";

test("publishes a confirmed meal after reply and checkpoint without the conversation idle delay", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-journal-publication-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const controller = new AbortController();
  let completion: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | undefined;
  try {
    await initializeVault({ vaultRoot });
    const meal = await addMeal({
      name: "Vegetable soup", note: "Photo awaiting confirmation",
      uploadId: "synthetic-photo-upload", source: "device", vaultRoot,
    });
    const snapshot = await createVaultSnapshotBundle({ vaultRoot });
    const artifactBytesByHash = new Map([[snapshot.hash, snapshot.bytes]]);
    let workspace = createWorkspaceState({ snapshotRef: snapshot.snapshotRef });
    const baseWorkspacePort = createWorkspacePort({ checkpointRequests, events, workspace });
    let edited = false;
    completion = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
      request: { runnerIdleTtlMs: 600_000 },
    }), {
      vaultRoot,
      signal: controller.signal,
      platform: createPlatform({
        artifactBytesByHash,
        mailboxPort: createMailboxPort({ events, items: [createMailboxItem()] }),
        workspacePort: {
          ...baseWorkspacePort,
          async checkpoint(request) {
            const result = await baseWorkspacePort.checkpoint(request);
            workspace = result.workspace;
            if (request.reason === "idle_shutdown") events.push("checkpoint:durable");
            return result;
          },
        },
        browserVaultReplicaPort: {
          async write({ replica }) {
            assert.ok(events.includes("reply:sent"));
            assert.ok(events.includes("checkpoint:durable"));
            const meals = parseBrowserVaultReplica(replica).meals?.days.flatMap(day => day.meals) ?? [];
            assert.equal(meals.length, 1);
            assert.equal(meals[0]?.id, meal.mealId);
            assert.equal(meals[0]?.name, "Tomato lentil soup");
            assert.equal(meals[0]?.calories, 360);
            assert.equal(meals[0]?.proteinGrams, 18);
            assert.equal(meals[0]?.uploadId, "synthetic-photo-upload");
            events.push("replica:written");
            return createBrowserVaultReplicaRef(replica);
          },
          async publishRef({ replicaRef }) {
            events.push("replica:published");
            workspace = { ...workspace, browserVaultReplicaRef: replicaRef };
            return { published: true, workspace };
          },
        },
      }),
      async importItem() { return { status: "imported" }; },
      async createCheckpointSnapshot() {
        events.push("snapshot");
        return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 128 }) };
      },
      async runAssistantPhase() {
        if (edited) return { progressed: false };
        edited = true;
        await editMealRecord({ vault: vaultRoot, lookup: meal.mealId, set: [
          "title=Tomato lentil soup", "note=Two cups", "nutrition.totals.calories=360",
          "nutrition.totals.proteinGrams=18", "nutrition.totals.carbsGrams=56",
          "nutrition.totals.fatGrams=8", "nutrition.totals.fiberGrams=14",
        ] });
        assert.equal(events.includes("snapshot"), false, "Publication must not hold the reply.");
        events.push("reply:sent");
        return { progressed: true, checkpointReason: "assistant_runtime_commit", foregroundPrioritySystemCompletionProcessed: true };
      },
    });
    await withRealTimeout(completion, 15_000, () => JSON.stringify({ events }));
    assert.ok(events.includes("replica:published"));
    assert.ok(events.indexOf("reply:sent") < events.indexOf("checkpoint:durable"));
    assert.ok(events.indexOf("checkpoint:durable") < events.indexOf("replica:published"));
  } finally {
    controller.abort();
    await completion?.catch(() => undefined);
    await removeTempRoot(vaultRoot);
  }
});

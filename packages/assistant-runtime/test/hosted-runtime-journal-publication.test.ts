import {
  createBrowserVaultReplicaRef,
  createDeferred,
  stagePendingLinqAssistantInputForMailboxItem,
  writeSyntheticAssistantAutoReplyTerminalEvidence,
  waitUntil,
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
import { setTimeout as delay } from "node:timers/promises";
import { readAssistantInputEvent } from "@murphai/assistant-engine";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";

test.each([false, true])("publishes a confirmed meal after reply and checkpoint, retaining owned image work: %s", async (retainImage) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-journal-publication-"));
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const controller = new AbortController();
  const imageReady = createDeferred<void>();
  const image: { signal: AbortSignal | null } = { signal: null };
  let originInputId: string | null = null;
  let imageCompletions = 0;
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
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
      runtimeWakeSignal,
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
      async importItem(item) {
        if (!retainImage) return { status: "imported" };
        originInputId = await stagePendingLinqAssistantInputForMailboxItem({
          item: item.item, threadId: "thread_synthetic_meal_image", vaultRoot,
        });
        return { status: "imported", assistantInputId: originInputId };
      },
      async createCheckpointSnapshot() {
        events.push("snapshot");
        return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 128 }) };
      },
      async runAssistantPhase(input) {
        if (edited) {
          const ids = input.initialAssistantInputBatch?.assistantInputIds
            ?? input.initialMailboxImport.importResult.assistantInputIds ?? [];
          const release = await input.beforeProviderAcceptedInputs?.({
            turnId: "turn_synthetic_image_completion", acceptedInputs: ids.map(id => ({ id, source: "assistant-input" as const })),
          });
          for (const inputId of ids) {
            const event = await readAssistantInputEvent({ inputId, vault: vaultRoot });
            assert.equal(event?.sourceRef.kind === "hosted-mailbox" && event.sourceRef.payloadSchema, "murph.hosted-image-completion.v1");
            assert.equal(event?.replyTarget?.channel, "linq");
            assert.equal(event?.conversation?.threadId, "thread_synthetic_meal_image");
            await writeSyntheticAssistantAutoReplyTerminalEvidence({ inputId, vaultRoot });
            imageCompletions += 1;
          }
          await release?.();
          return ids.length > 0
            ? { progressed: true, checkpointReason: "assistant_runtime_commit", foregroundPrioritySystemCompletionProcessed: true }
            : { progressed: false };
        }
        edited = true;
        if (retainImage) {
          assert.ok(originInputId);
          const release = await input.beforeProviderAcceptedInputs?.({
            turnId: "turn_synthetic_meal_image", acceptedInputs: [{ id: originInputId, source: "assistant-input" }],
          });
          await writeSyntheticAssistantAutoReplyTerminalEvidence({ inputId: originInputId, vaultRoot });
          await release?.();
          assert.equal(input.imageGenerationLauncher?.launch({
            continuationSessionId: "asst_synthetic_meal_image",
            operationId: "image_synthetic_meal", originAssistantInputId: originInputId,
            originAssistantInputIdExact: true,
            async run(signal) {
              image.signal = signal;
              await Promise.race([
                imageReady.promise,
                new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
              ]);
              signal.throwIfAborted();
              events.push("image:completed");
              return { media: null, runtimeIssue: null, savedImageRef: null, failureDiagnostic: "Synthetic provider completion" };
            },
          }), "started");
        }
        await editMealRecord({ vault: vaultRoot, lookup: meal.mealId, set: [
          "title=Tomato lentil soup", "note=Two cups", "nutrition.totals.calories=360",
          "nutrition.totals.proteinGrams=18", "nutrition.totals.carbsGrams=56",
          "nutrition.totals.fatGrams=8", "nutrition.totals.fiberGrams=14",
        ] });
        assert.equal(events.includes("snapshot"), false, "Publication must not hold the reply.");
        events.push("reply:sent");
        return {
          progressed: true, checkpointReason: "assistant_runtime_commit", foregroundPrioritySystemCompletionProcessed: true,
          // A separate durable effect disables the old image-only wait. The
          // expedited conversation deadline must still preserve owned work.
          ...(retainImage ? { afterCheckpoint: async () => ({
            afterDurableCheckpoint: async () => undefined,
            checkpointReason: "assistant_runtime_commit" as const,
          }) } : {}),
        };
      },
    });
    if (retainImage) {
      await waitUntil(() => assert.ok(events.includes("reply:sent")));
      await delay(150);
      assert.equal(events.includes("snapshot"), false, "A meal update must not close an accepted image request.");
      assert.equal(image.signal?.aborted, false);
      imageReady.resolve();
    }
    await withRealTimeout(completion, 15_000, () => JSON.stringify({ events }));
    assert.equal(imageCompletions, retainImage ? 1 : 0);
    assert.ok(events.includes("replica:published"));
    assert.ok(events.indexOf("reply:sent") < events.indexOf("checkpoint:durable"));
    assert.ok(events.indexOf("checkpoint:durable") < events.indexOf("replica:published"));
  } finally {
    controller.abort();
    imageReady.resolve();
    await completion?.catch(() => undefined);
    await removeTempRoot(vaultRoot);
  }
});

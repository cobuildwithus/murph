import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { applyCanonicalWriteBatch, initializeVault } from "@murphai/core";
import * as hostedExecution from "@murphai/hosted-execution";
import {
  TEST_NOW, createMailboxItem, createMailboxPort, createPlatform,
  createSnapshotFixtureRef, createVaultSnapshotBundle, createWorkspacePort, createWorkspaceRuntimeJobInput,
  createWorkspaceState, removeTempRoot, runHostedWorkspaceRuntimeJobInProcess,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

afterEach(() => vi.restoreAllMocks());

test.each(["default", "system_mailbox"] as const)(
  "emits numeric reply-path spans without changing checkpoint/provider order: %s",
  async (processingMode) => {
    const log = vi.spyOn(hostedExecution, "emitHostedExecutionStructuredLog");
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-reply-path-timing-"));
    const events: string[] = [];
    const item = createMailboxItem(processingMode === "system_mailbox"
      ? { lane: "system", kind: "device-sync.wake" } : {});
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const snapshot = await createVaultSnapshotBundle({ vaultRoot });
      const workspacePort = createWorkspacePort({
        events, checkpointRequests: [],
        workspace: createWorkspaceState({ version: "0", snapshotRef: snapshot.snapshotRef }),
      });
      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: { processingMode, runnerIdleTtlMs: 1 },
      }), {
        vaultRoot,
        async createCheckpointSnapshot() {
          return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 512 }) };
        },
        async importItem(_item, context) {
          context?.onConversationInputStaged?.("linq");
          await applyCanonicalWriteBatch({
            audit: { action: "experiment_update", commandName: "test.replyTiming", summary: "Synthetic timing write." },
            operationType: "reply_timing_test", summary: "Synthetic timing write.",
            textWrites: [{ relativePath: "bank/timing.md", content: "synthetic\n", overwrite: true }],
            vaultRoot,
          });
          return { status: "imported" };
        },
        platform: createPlatform({
          artifactBytesByHash: new Map([[snapshot.hash, snapshot.bytes]]),
          mailboxPort: createMailboxPort({ events, items: [item] }),
          workspacePort: {
            ...workspacePort,
            async checkpoint(request) {
              if (request.reason === "canonical_runtime_commit") {
                expect(log.mock.calls.at(-1)?.[0]).toMatchObject({
                  message: "Hosted status publication timing.",
                  details: { checkpointReason: request.reason },
                });
                events.push("status-post");
              }
              return workspacePort.checkpoint(request);
            },
          },
        }),
        async runAssistantPhase(input) {
          events.push("provider-hook");
          const release = await input.beforeProviderAcceptedInputs?.({
            acceptedInputs: [], turnId: "turn_synthetic_timing",
          });
          release?.();
          return { progressed: false };
        },
      });
      const expected: readonly (readonly [string, readonly string[]])[] = [
        ["Hosted status publication timing.", ["queueWaitMs", "resolveWakesMs", "progressStatusMs"]],
        ["Hosted mailbox import tail timing.", ["runtimeLogMs", "dirtyMarkerMs"]],
        ["Hosted mailbox watermark write timing.", ["watermarkWriteMs"]],
        ["Hosted mailbox persist wait timing.", ["persistWaitMs"]],
        ...(processingMode === "default"
          ? [["Hosted before provider accepted inputs timing.", ["totalMs"]] as const]
          : [["Hosted system mailbox return timing.", ["totalMs"]] as const]),
      ];
      for (const [message, fields] of expected) {
        const record = log.mock.results.map((result) => result.value)
          .find((entry) => entry?.message === message);
        assert.ok(record, `Missing ${message}`);
        for (const field of fields) {
          const value = record.details?.[field];
          assert.ok(Number.isInteger(value) && value >= 0, `Invalid ${field}`);
        }
        assert.equal(record.userId, null);
        assert.ok(!JSON.stringify(record).includes(vaultRoot));
      }
      if (processingMode === "default") {
        assert.ok(events.indexOf("status-post") < events.indexOf("provider-hook"));
      }
    } finally {
      await removeTempRoot(vaultRoot);
    }
  },
);

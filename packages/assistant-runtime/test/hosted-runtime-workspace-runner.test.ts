import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  sha256HostedBundleHex,
  snapshotHostedBundleRoots,
} from "@murphai/runtime-state/node";
import {
  resolveAssistantStatePaths,
} from "@murphai/runtime-state/node/assistant-state-fs";
import {
  AssistantActiveTurnInputCheckpointRejectedError,
  createAssistantActiveTurnInputController,
  createAssistantOutboxIntent,
  createStoreBackedAssistantInputSource,
  markAssistantContextSnapshotDirty,
  readAssistantContextSnapshotState,
  saveAssistantAutomationState,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import {
  hasPendingAssistantAutoReplyInput,
} from "@murphai/assistant-engine/assistant-automation";
import type {
  HostedMailboxFetchRequest,
  HostedMailboxFetchResponse,
  HostedMailboxItem,
  HostedMailboxPayloadFetchRequest,
  HostedMailboxPayloadFetchResponse,
  HostedRuntimeLatencyTraceStagedMilestones,
  HostedRuntimeLogRequest,
  HostedRuntimeRedactedJson,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedRuntimeLogRequest,
} from "@murphai/hosted-execution/parsers";
import {
  ASSISTANT_USAGE_SCHEMA,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  applyCanonicalWriteBatch,
  initializeVault,
} from "@murphai/core";
import { describe, test, vi } from "vitest";

import {
  HostedMailboxImportCheckpointConflictError,
  createCoalescingRuntimeWakeSignal,
  createHostedWorkspaceCheckpointRequestBuilder,
  createHostedWorkspaceSnapshotCheckpointRequestBuilder,
  HostedWorkspaceRunnerUserMismatchError,
  runHostedWorkspaceUntilIdleOrBudget,
  type HostedMailboxImportCheckpointResult,
  type HostedRuntimeEffectsPort,
  type HostedWorkspaceRunnerRuntimeStatusCheckpointInput,
} from "../src/hosted-runtime.ts";
import type {
  HostedRuntimeLinqRecentInboundEngagementRequest,
} from "../src/hosted-runtime/platform.ts";
import {
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES,
} from "../src/hosted-runtime/canonical-write-receipt-log.ts";
import {
  collectHostedAssistantDeliverySideEffects,
  drainHostedPreparedAssistantDeliveries,
  prepareHostedAssistantDeliveryEffectsForDispatch,
} from "../src/hosted-runtime/callbacks.ts";
import {
  createHostedConversationMailboxImportItem,
} from "../src/hosted-runtime/mailbox-conversation-import.ts";
import {
  createEmptyHostedMailboxImportState,
  readHostedMailboxImportState,
  writeHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import {
  enqueueHostedPendingAssistantInputId,
  ensureHostedPendingAssistantInputIndex,
  readExistingHostedPendingAssistantInputIds,
  resolveHostedPendingAssistantInputStatePath,
} from "../src/hosted-runtime/pending-input-index.ts";
import {
  selectHostedAssistantInputIds,
} from "../src/hosted-runtime/turn-input.ts";
import {
  restoreHostedWorkspaceRuntimeJobWorkspace,
} from "../src/hosted-runtime/workspace-restore.ts";
import {
  resolveHostedUsageNoticeDeliveryTargetFromAcceptedInputs,
  runHostedWorkspaceCanonicalWriteAtBoundary,
  type HostedWorkspaceRunnerAssistantInputBatch,
} from "../src/hosted-runtime/workspace-runner.ts";
import {
  HostedMailboxUserMismatchError,
  prefetchHostedMailboxPrefix,
  type HostedMailboxPostCheckpointEffectResult,
} from "../src/hosted-runtime/mailbox-import.ts";
import type {
  NormalizedHostedAssistantRuntimeConfig,
} from "../src/hosted-runtime/models.ts";
import type {
  HostedRuntimeMailboxPort,
  HostedRuntimeUsageRecordPort,
  HostedRuntimeWorkspacePort,
} from "../src/hosted-runtime-contracts.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";
const TEST_PENDING_INDEX_MAINTENANCE_WAKE_AT = "2026-04-26T00:00:30.000Z";
const TEST_USER_ID = "member_synthetic_workspace_runner";
const TERMINAL_EVIDENCE_SCHEMA =
  "murph.assistant-auto-reply-terminal-evidence.v1";

function createInboxProjectionEffectResult(
  overrides: Partial<HostedMailboxPostCheckpointEffectResult> = {},
): HostedMailboxPostCheckpointEffectResult {
  return {
    attachmentEvidenceUpdated: null,
    kind: "inbox_projection",
    projectionUpdated: true,
    reasonCode: null,
    status: "succeeded",
    ...overrides,
  };
}
const TEST_BROWSER_VAULT_REPLICA_REF = {
  byteLength: 256,
  dataVersion: "2026-04-26",
  generatedAt: "2026-04-26T00:00:00.000Z",
  keyId: "key_synthetic_runner",
  objectKey: "browser-vault/member-synthetic/replica.json",
  replicaSchema: "murph.browser-vault-replica",
  runtimeRootKeyId: "udrk:runtime:synthetic-runner",
  schema: "murph.hosted-browser-vault-replica-ref.v1",
  sourceBundleHash: "bundle_hash_synthetic_runner",
} as const;

describe("runHostedWorkspaceUntilIdleOrBudget", () => {
  test("carries two initial conversation inputs through singleton foreground reruns before checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-initial-input-tail-"));
    const olderItem = createMailboxItem({
      causalSeq: "11",
      id: "mailbox_initial_input_tail_older",
      laneSeq: "1",
      occurredAt: "2026-04-26T00:00:01.000Z",
    });
    const newerItem = createMailboxItem({
      causalSeq: "12",
      id: "mailbox_initial_input_tail_newer",
      laneSeq: "2",
      occurredAt: "2026-04-26T00:00:02.000Z",
    });
    const olderContext = createLinqDeliveryContext("msg_initial_input_tail_older");
    const newerContext = createLinqDeliveryContext("msg_initial_input_tail_newer");
    const contextsByItemId = new Map([
      [olderItem.id, olderContext],
      [newerItem.id, newerContext],
    ]);
    const inputIdsByItemId = new Map<string, string>();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const selectedInputIdsByPass: string[][] = [];
    const selectedContextsByPass: unknown[] = [];
    const { mailboxPort } = createMailboxPort({ items: [olderItem, newerItem] });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const runPass = async (options: {
        attemptId: string;
        initialAssistantInputBatch?: HostedWorkspaceRunnerAssistantInputBatch;
        initialMailboxImport?: HostedMailboxImportCheckpointResult;
      }) => await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: options.attemptId,
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          const stored = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              `initial input ${item.item.laneSeq}`,
            ),
            vault: vaultRoot,
          });
          inputIdsByItemId.set(item.item.id, stored.inputId);
          return {
            assistantInputId: stored.inputId,
            linqDeliveryContext: contextsByItemId.get(item.item.id),
            status: "imported",
          };
        },
        ...(options.initialAssistantInputBatch
          ? { initialAssistantInputBatch: options.initialAssistantInputBatch }
          : {}),
        ...(options.initialMailboxImport
          ? { initialMailboxImport: options.initialMailboxImport }
          : {}),
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: `request_${options.attemptId}`,
        async runAssistantPhase(phaseInput) {
          const freshInputIds = phaseInput.initialAssistantInputBatch?.assistantInputIds
            ?? phaseInput.initialMailboxImport.importResult.assistantInputIds
            ?? [];
          const selection = await selectHostedAssistantInputIds({
            freshAssistantInputIds: freshInputIds,
            mode: "foreground",
            vaultRoot,
          });
          const records = phaseInput.initialAssistantInputBatch?.assistantInputRecords
            ?? phaseInput.initialMailboxImport.importResult.assistantInputRecords
            ?? [];
          selectedInputIdsByPass.push(selection.inputIds);
          selectedContextsByPass.push(
            records.find((record) =>
              record.assistantInputId === selection.inputIds[0]
            )?.linqDeliveryContext,
          );
          return { progressed: false };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      const firstPass = await runPass({
        attemptId: "attempt_synthetic_initial_input_tail_first",
      });
      const olderInputId = inputIdsByItemId.get(olderItem.id);
      const newerInputId = inputIdsByItemId.get(newerItem.id);
      assert.ok(olderInputId);
      assert.ok(newerInputId);
      assert.deepEqual(firstPass.latestAssistantInputBatch?.assistantInputIds, [newerInputId]);
      assert.deepEqual(firstPass.latestAssistantInputBatch?.assistantInputRecords, [{
        assistantInputId: newerInputId,
        causalSeq: "12",
        linqDeliveryContext: newerContext,
      }]);
      assert.deepEqual(firstPass.latestAssistantInputBatch?.linqDeliveryContexts, [newerContext]);
      assert.deepEqual(checkpointRequests, []);

      assert.ok(firstPass.latestAssistantInputBatch);
      const secondPass = await runPass({
        attemptId: "attempt_synthetic_initial_input_tail_second",
        initialAssistantInputBatch: firstPass.latestAssistantInputBatch,
        initialMailboxImport: firstPass.latestMailboxImport,
      });

      assert.deepEqual(selectedInputIdsByPass, [[olderInputId], [newerInputId]]);
      assert.deepEqual(selectedContextsByPass, [olderContext, newerContext]);
      assert.equal(secondPass.latestAssistantInputBatch, null);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test.each([
    {
      foregroundReplyFailed: 0,
      nextWakeAt: "2026-04-26T00:00:30.000Z",
      nextWakeReason: "assistant",
      retryKind: "bootstrap gap",
    },
    {
      foregroundReplyFailed: 1,
      nextWakeAt: "2026-04-26T00:00:30.000Z",
      nextWakeReason: "assistant",
      retryKind: "reply failure",
    },
    {
      foregroundReplyFailed: undefined,
      nextWakeAt: "2026-04-26T00:00:30.000Z",
      nextWakeReason: "assistant",
      retryKind: "future pre-reply assistant work",
    },
    {
      foregroundReplyFailed: undefined,
      nextWakeAt: TEST_NOW,
      nextWakeReason: "mailbox",
      retryKind: "immediate pre-reply mailbox work",
    },
  ])("does not locally rerun a retryable selected initial input ahead of a distinct remainder ($retryKind)", async ({
    foregroundReplyFailed,
    nextWakeAt,
    nextWakeReason,
  }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-retryable-input-tail-"));
    const olderItem = createMailboxItem({
      id: "mailbox_retryable_input_tail_older",
      laneSeq: "1",
      occurredAt: "2026-04-26T00:00:01.000Z",
    });
    const newerItem = createMailboxItem({
      id: "mailbox_retryable_input_tail_newer",
      laneSeq: "2",
      occurredAt: "2026-04-26T00:00:02.000Z",
    });
    const inputIdsByItemId = new Map<string, string>();
    const storedInputsByItemId = new Map<
      string,
      Awaited<ReturnType<typeof upsertAssistantInputEvent>>
    >();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const selectedInputIdsByPass: string[][] = [];
    const { mailboxPort } = createMailboxPort({ items: [olderItem, newerItem] });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const runPass = async (options: {
        attemptId: string;
        initialAssistantInputBatch?: HostedWorkspaceRunnerAssistantInputBatch;
        initialMailboxImport?: HostedMailboxImportCheckpointResult;
      }) => await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: options.attemptId,
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          const stored = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              `retryable input ${item.item.laneSeq}`,
            ),
            vault: vaultRoot,
          });
          inputIdsByItemId.set(item.item.id, stored.inputId);
          storedInputsByItemId.set(item.item.id, stored);
          await enqueueHostedPendingAssistantInputId({
            inputId: stored.inputId,
            vaultRoot,
          });
          return {
            assistantInputId: stored.inputId,
            status: "imported",
          };
        },
        ...(options.initialAssistantInputBatch
          ? { initialAssistantInputBatch: options.initialAssistantInputBatch }
          : {}),
        ...(options.initialMailboxImport
          ? { initialMailboxImport: options.initialMailboxImport }
          : {}),
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: `request_${options.attemptId}`,
        async runAssistantPhase(phaseInput) {
          const freshInputIds = phaseInput.initialAssistantInputBatch?.assistantInputIds
            ?? phaseInput.initialMailboxImport.importResult.assistantInputIds
            ?? [];
          const selection = await selectHostedAssistantInputIds({
            freshAssistantInputIds: freshInputIds,
            mode: "foreground",
            vaultRoot,
          });
          selectedInputIdsByPass.push(selection.inputIds);
          if (selectedInputIdsByPass.length === 1) {
            const selected = storedInputsByItemId.get(olderItem.id);
            assert.ok(selected);
            await saveAssistantAutomationState(vaultRoot, {
              autoReply: [{
                channel: "linq",
                eligibleAfter: selected.cursor,
                enabledAt: TEST_NOW,
              }],
              updatedAt: TEST_NOW,
              version: 1,
            });
            return {
              checkpointReason: "assistant_runtime_commit",
              foregroundReplyFailed,
              nextWakeAt,
              nextWakeReason,
              progressed: true,
            };
          }
          const selected = storedInputsByItemId.get(newerItem.id);
          assert.ok(selected);
          await saveAssistantAutomationState(vaultRoot, {
            autoReply: [{
              channel: "linq",
              eligibleAfter: selected.cursor,
              enabledAt: TEST_NOW,
            }],
            updatedAt: TEST_NOW,
            version: 1,
          });
          return { progressed: false };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      const firstPass = await runPass({
        attemptId: "attempt_synthetic_retryable_input_tail_first",
      });
      const olderInputId = inputIdsByItemId.get(olderItem.id);
      const newerInputId = inputIdsByItemId.get(newerItem.id);
      assert.ok(olderInputId);
      assert.ok(newerInputId);
      assert.deepEqual(firstPass.latestAssistantInputBatch?.assistantInputIds, [newerInputId]);
      assert.deepEqual(await readExistingHostedPendingAssistantInputIds({ vaultRoot }), [
        olderInputId,
        newerInputId,
      ]);

      assert.ok(firstPass.latestAssistantInputBatch);
      const secondPass = await runPass({
        attemptId: "attempt_synthetic_retryable_input_tail_second",
        initialAssistantInputBatch: firstPass.latestAssistantInputBatch,
        initialMailboxImport: firstPass.latestMailboxImport,
      });

      assert.deepEqual(selectedInputIdsByPass, [[olderInputId], [newerInputId]]);
      assert.equal(secondPass.latestAssistantInputBatch, null);
      assert.deepEqual(await readExistingHostedPendingAssistantInputIds({ vaultRoot }), [
        olderInputId,
        newerInputId,
      ]);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("restores a pre-reply selected input ahead of its existing boundary tail", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-pre-reply-input-tail-"));
    const olderItem = createMailboxItem({
      id: "mailbox_pre_reply_input_tail_older",
      laneSeq: "1",
      occurredAt: "2026-04-26T00:00:01.000Z",
    });
    const newerItem = createMailboxItem({
      id: "mailbox_pre_reply_input_tail_newer",
      laneSeq: "2",
      occurredAt: "2026-04-26T00:00:02.000Z",
    });
    const importedInputIds: string[] = [];
    const importedInputs: Array<Awaited<ReturnType<typeof upsertAssistantInputEvent>>> = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const selectedInputIdsByPass: string[][] = [];
    const { mailboxPort } = createMailboxPort({ items: [olderItem, newerItem] });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_pre_reply_input_tail",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          const stored = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              `pre-reply input ${item.item.laneSeq}`,
            ),
            vault: vaultRoot,
          });
          importedInputIds.push(stored.inputId);
          importedInputs.push(stored);
          await enqueueHostedPendingAssistantInputId({
            inputId: stored.inputId,
            vaultRoot,
          });
          return {
            assistantInputId: stored.inputId,
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_pre_reply_input_tail",
        async runAssistantPhase(phaseInput) {
          const selection = await selectHostedAssistantInputIds({
            freshAssistantInputIds:
              phaseInput.initialMailboxImport.importResult.assistantInputIds ?? [],
            mode: "foreground",
            vaultRoot,
          });
          selectedInputIdsByPass.push(selection.inputIds);
          const selected = importedInputs[0];
          assert.ok(selected);
          await saveAssistantAutomationState(vaultRoot, {
            autoReply: [{
              channel: "linq",
              eligibleAfter: selected.cursor,
              enabledAt: TEST_NOW,
            }],
            updatedAt: TEST_NOW,
            version: 1,
          });
          return {
            checkpointReason: "system_mailbox_receipt",
            nextWakeAt: TEST_NOW,
            nextWakeReason: "assistant",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(selectedInputIdsByPass, [[importedInputIds[0]]]);
      assert.deepEqual(
        await readExistingHostedPendingAssistantInputIds({ vaultRoot }),
        importedInputIds,
      );
      assert.deepEqual(
        result.latestAssistantInputBatch?.assistantInputIds,
        importedInputIds,
      );
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("keeps the precomputed boundary tail when every multi-input selection remains pending", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-all-pending-selection-"));
    const mailboxItems = Array.from({ length: 4 }, (_, index) => {
      const laneSeq = String(index + 1);
      return createMailboxItem({
        id: `mailbox_all_pending_selection_${laneSeq}`,
        laneSeq,
        occurredAt: `2026-04-26T00:00:0${laneSeq}.000Z`,
      });
    });
    const importedInputIds: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: mailboxItems });
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_all_pending_selection",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          const threadId = item.item.laneSeq === "4"
            ? "thread_all_pending_boundary"
            : "thread_all_pending_selection";
          const event = createStoredAssistantInputEventForMailboxItem(
            item.item,
            `all-pending input ${item.item.laneSeq}`,
          );
          const stored = await upsertAssistantInputEvent({
            event: {
              ...event,
              conversation: {
                ...event.conversation,
                threadId,
              },
              replyTarget: {
                ...event.replyTarget,
                threadId,
              },
              sourceRef: {
                ...event.sourceRef,
                causalSeq: item.item.laneSeq,
              },
            },
            vault: vaultRoot,
          });
          importedInputIds.push(stored.inputId);
          await enqueueHostedPendingAssistantInputId({
            inputId: stored.inputId,
            vaultRoot,
          });
          return {
            assistantInputId: stored.inputId,
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_all_pending_selection",
        async runAssistantPhase(phaseInput) {
          assistantPhaseCalls += 1;
          const freshInputIds = phaseInput.initialMailboxImport.importResult.assistantInputIds
            ?? [];
          const selection = await selectHostedAssistantInputIds({
            freshAssistantInputIds: freshInputIds,
            mode: "foreground",
            vaultRoot,
          });
          assert.deepEqual(selection.inputIds, importedInputIds.slice(0, 3));
          await saveAssistantAutomationState(vaultRoot, {
            autoReply: [{
              channel: "linq",
              eligibleAfter: null,
              enabledAt: TEST_NOW,
            }],
            updatedAt: TEST_NOW,
            version: 1,
          });
          return {
            checkpointReason: "assistant_runtime_commit",
            foregroundReplyFailed: 0,
            invocationLocalAssistantWakeAt: "2026-04-26T00:00:30.000Z",
            nextWakeAt: "2026-04-26T00:00:30.000Z",
            nextWakeReason: "assistant",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        result.latestAssistantInputBatch?.assistantInputIds,
        [importedInputIds[3]],
      );
      assert.equal(
        result.assistantPhaseResult?.nextWakeAt,
        "2026-04-26T00:00:30.000Z",
      );
      assert.deepEqual(
        await readExistingHostedPendingAssistantInputIds({ vaultRoot }),
        importedInputIds,
      );
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("coalesced runtime wakes preserve first and latest pending notify timestamps", () => {
    vi.useFakeTimers();
    const firstNotifyAt = new Date("2026-04-26T00:00:01.000Z");
    const secondNotifyAt = new Date("2026-04-26T00:00:05.000Z");

    try {
      const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
      vi.setSystemTime(firstNotifyAt);
      runtimeWakeSignal.notify();
      vi.setSystemTime(secondNotifyAt);
      runtimeWakeSignal.notify();
      runtimeWakeSignal.notify(firstNotifyAt.getTime() + 2_000);

      assert.deepEqual(runtimeWakeSignal.consumePending(), {
        latestNotifiedAtEpochMs: secondNotifyAt.getTime(),
        notifiedAtEpochMs: firstNotifyAt.getTime(),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("coalesced runtime wake stays pending when its queued waiter aborts", async () => {
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const waitAbortController = new AbortController();
    const waitAbortReason = new Error("runtime wake waiter finished");
    const notifiedAtEpochMs = Date.parse(TEST_NOW);
    const wake = runtimeWakeSignal.wait(waitAbortController.signal);

    runtimeWakeSignal.notify(notifiedAtEpochMs);
    waitAbortController.abort(waitAbortReason);

    await assert.rejects(wake, (error: unknown) => error === waitAbortReason);
    await Promise.resolve();
    assert.deepEqual(runtimeWakeSignal.consumePending(), {
      notifiedAtEpochMs,
    });
  });

  test("delivery barrier drains repeated no-progress wakes without yielding background maintenance", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-stale-runtime-wake-"));
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const yieldStates: boolean[] = [];

    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_stale_runtime_wake",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort: createMailboxPort({ fetchRequests, items: [] }).mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_stale_runtime_wake",
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          await input.prepareAutoReplyDelivery?.();

          const fetchCountBeforeStaleWake = fetchRequests.length;
          runtimeWakeSignal.notify(Date.parse(TEST_NOW) - 1);
          await waitForCondition(() =>
            fetchRequests.length >= fetchCountBeforeStaleWake + 2
          );
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);

          const fetchCountBeforeFreshWake = fetchRequests.length;
          runtimeWakeSignal.notify(Date.parse(TEST_NOW) + 1);
          await waitForCondition(() =>
            fetchRequests.length >= fetchCountBeforeFreshWake + 2
          );
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);

          return { progressed: false };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(yieldStates, [false, false, false]);
      assert.equal(runtimeWakeSignal.consumePending(), null);
    } finally {
      vi.useRealTimers();
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("tracks blocked initial mailbox import as local workspace mutation completion", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-initial-import-track-"));
    const abortController = new AbortController();
    const hostAbortReason = new Error("host request aborted during runner import");
    const importStarted = createDeferred<void>();
    const importRelease = createDeferred<void>();
    const trackedCompletions: Promise<void>[] = [];
    let trackedCompletionSettled = false;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const runnerPromise = runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_initial_import_track",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          importStarted.resolve();
          await importRelease.promise;
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort: createMailboxPort({
            items: [createMailboxItem({
              id: "mailbox_item_runner_initial_import_track",
              laneSeq: "1",
            })],
          }).mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests: [] }),
        }),
        requestId: "request_synthetic_runner_initial_import_track",
        signal: abortController.signal,
        trackLocalWorkspaceMutationCompletion(completion) {
          if (!completion) {
            return;
          }
          trackedCompletions.push(completion);
          void completion.then(() => {
            trackedCompletionSettled = true;
          });
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
      });
      const racedRunnerPromise = Promise.race([
        runnerPromise,
        new Promise<never>((_resolve, reject) => {
          abortController.signal.addEventListener(
            "abort",
            () => reject(hostAbortReason),
            { once: true },
          );
        }),
      ]);

      await importStarted.promise;
      assert.equal(trackedCompletions.length, 1);
      abortController.abort(hostAbortReason);
      await assert.rejects(racedRunnerPromise, (error) => error === hostAbortReason);
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(trackedCompletionSettled, false);

      importRelease.resolve();
      await runnerPromise.catch(() => undefined);
      await trackedCompletions[0];
      assert.equal(trackedCompletionSettled, true);
    } finally {
      importRelease.resolve();
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("does not start pre-assistant system import after aborted initial import settles", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-aborted-follow-on-import-"));
    const abortController = new AbortController();
    const hostAbortReason = new Error("host request aborted before system import");
    const initialImportStarted = createDeferred<void>();
    const initialImportRelease = createDeferred<void>();
    let systemImportStarted = false;
    let assistantPhaseStarted = false;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const runnerPromise = runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_aborted_follow_on_import",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          if (item.item.lane === "conversation") {
            initialImportStarted.resolve();
            await initialImportRelease.promise;
            return { status: "imported" };
          }
          systemImportStarted = true;
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort: createMailboxPort({
            items: [
              createMailboxItem({
                id: "mailbox_item_runner_aborted_follow_on_conversation",
                lane: "conversation",
                laneSeq: "1",
              }),
              createMailboxItem({
                id: "mailbox_item_runner_aborted_follow_on_system",
                kind: "member.activated",
                lane: "system",
                laneSeq: "1",
              }),
            ],
          }).mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests: [] }),
        }),
        requestId: "request_synthetic_runner_aborted_follow_on_import",
        signal: abortController.signal,
        async runAssistantPhase() {
          assistantPhaseStarted = true;
          return { progressed: false };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
      });
      const racedRunnerPromise = Promise.race([
        runnerPromise,
        new Promise<never>((_resolve, reject) => {
          abortController.signal.addEventListener(
            "abort",
            () => reject(hostAbortReason),
            { once: true },
          );
        }),
      ]);

      await initialImportStarted.promise;
      abortController.abort(hostAbortReason);
      await assert.rejects(racedRunnerPromise, (error) => error === hostAbortReason);
      initialImportRelease.resolve();
      await runnerPromise.catch(() => undefined);

      assert.equal(systemImportStarted, false);
      assert.equal(assistantPhaseStarted, false);
    } finally {
      initialImportRelease.resolve();
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("settles foreground mailbox loop completion when signal is already aborted", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-aborted-foreground-loop-"));
    const abortController = new AbortController();
    const hostAbortReason = new Error("host request already aborted before foreground loop");
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const assistantPhaseStarted = createDeferred<void>();
    const releaseAssistantPhase = createDeferred<void>();
    const trackedCompletions: Promise<void>[] = [];
    let trackedCompletionSettled = false;
    let runnerPromise: ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const initialMailboxImport = createDeferredMailboxImportResult();
      initialMailboxImport.importResult.conversationImportedCount = 1;
      initialMailboxImport.importResult.fetchedLanes = ["conversation", "system"];
      abortController.abort(hostAbortReason);

      runnerPromise = runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_aborted_foreground_loop",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Already-aborted foreground loop should not import mailbox items.");
        },
        initialMailboxImport,
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort: createMailboxPort({ items: [] }).mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests: [] }),
        }),
        requestId: "request_synthetic_runner_aborted_foreground_loop",
        runtimeWakeSignal,
        signal: abortController.signal,
        async runAssistantPhase() {
          assistantPhaseStarted.resolve();
          await releaseAssistantPhase.promise;
          throw hostAbortReason;
        },
        trackLocalWorkspaceMutationCompletion(completion) {
          if (!completion) {
            return;
          }
          trackedCompletions.push(completion);
          void completion.then(() => {
            trackedCompletionSettled = true;
          });
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
      });

      await assistantPhaseStarted.promise;
      assert.equal(trackedCompletions.length, 1);
      await withTestTimeout(trackedCompletions[0]);
      assert.equal(trackedCompletionSettled, true);

      releaseAssistantPhase.resolve();
      await assert.rejects(runnerPromise, (error) => error === hostAbortReason);
    } finally {
      releaseAssistantPhase.resolve();
      await runnerPromise?.catch(() => undefined);
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("delivery barrier still yields background maintenance after fresh conversation import", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-coalesced-runtime-wake-"));
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const items: HostedMailboxItem[] = [];
    const importedSeqs: string[] = [];
    const yieldStates: boolean[] = [];

    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_coalesced_runtime_wake",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort: createMailboxPort({ fetchRequests, items }).mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_coalesced_runtime_wake",
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          await input.prepareAutoReplyDelivery?.();

          const fetchCountBeforeNoProgressWake = fetchRequests.length;
          runtimeWakeSignal.notify(Date.parse(TEST_NOW) - 1);
          runtimeWakeSignal.notify(Date.parse(TEST_NOW) + 1);
          await waitForCondition(() =>
            fetchRequests.length >= fetchCountBeforeNoProgressWake + 2
          );
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);

          items.push(createMailboxItem({
            id: "mailbox_item_runner_delivery_barrier_late_conversation",
            laneSeq: "1",
            occurredAt: "2026-04-26T00:00:02.000Z",
          }));
          runtimeWakeSignal.notify(Date.parse(TEST_NOW) + 2);
          await waitForCondition(() => importedSeqs.includes("1"));
          await waitForCondition(() =>
            input.shouldYieldBackgroundMaintenance?.() === true
          );
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);

          return { progressed: false };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(importedSeqs, ["1"]);
      assert.deepEqual(yieldStates, [false, false, true]);
    } finally {
      vi.useRealTimers();
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("preserves explicit null browser-vault replica refs in checkpoint builders", async () => {
    const state = createEmptyHostedMailboxImportState();
    const requestInput = {
      importResult: {
        blocked: [],
        consumedSeqByLane: {
          conversation: null,
          system: null,
        },
        fetchedCount: 0,
        importedCount: 0,
        state,
      },
      previousState: state,
      reason: "import",
      redactedStatus: {},
      state,
    } satisfies Parameters<ReturnType<typeof createHostedWorkspaceCheckpointRequestBuilder>["createRequest"]>[0];
    const checkpointBuilder = createHostedWorkspaceCheckpointRequestBuilder({
      attemptId: "attempt_synthetic_runner_null_replica",
      browserVaultReplicaRef: null,
      expectedWorkspaceVersion: "0",
      leaseGeneration: "1",
      snapshotRef: null,
    });
    const snapshotBuilder = createHostedWorkspaceSnapshotCheckpointRequestBuilder({
      createSnapshot: () => ({
        browserVaultReplicaRef: null,
        snapshotRef: null,
      }),
      metadata: {
        attemptId: "attempt_synthetic_runner_null_snapshot_replica",
        expectedWorkspaceVersion: "0",
        leaseGeneration: "1",
      },
    });

    const checkpointRequest = await checkpointBuilder.createRequest(requestInput);
    const snapshotRequest = await snapshotBuilder.createRequest(requestInput);

    assert.equal(Object.hasOwn(checkpointRequest, "browserVaultReplicaRef"), true);
    assert.equal(checkpointRequest.browserVaultReplicaRef, null);
    assert.equal(Object.hasOwn(snapshotRequest, "browserVaultReplicaRef"), true);
    assert.equal(snapshotRequest.browserVaultReplicaRef, null);
  });

  test("passes explicit expected workspace versions into snapshot checkpoint builders", async () => {
    const snapshotBuilder = createHostedWorkspaceSnapshotCheckpointRequestBuilder({
      createSnapshot: (snapshotInput) => {
        assert.equal(snapshotInput.expectedWorkspaceVersion, "3");
        return {
          snapshotRef: null,
        };
      },
      metadata: {
        attemptId: "attempt_synthetic_runner_snapshot_expected_version",
        expectedWorkspaceVersion: "0",
        leaseGeneration: "1",
      },
    });

    const snapshotRequest = await snapshotBuilder.createRequest({
      expectedWorkspaceVersion: "3",
      reason: "idle_shutdown",
      redactedStatus: {},
    });

    assert.equal(snapshotRequest.expectedWorkspaceVersion, "3");
  });

  test("passes imported conversation seq through redacted idle snapshot status", async () => {
    const snapshotBuilder = createHostedWorkspaceSnapshotCheckpointRequestBuilder({
      createSnapshot: () => ({
        snapshotRef: null,
      }),
      metadata: {
        attemptId: "attempt_synthetic_runner_snapshot_conversation_seq",
        expectedWorkspaceVersion: "0",
        leaseGeneration: "1",
      },
    });

    const snapshotRequest = await snapshotBuilder.createRequest({
      reason: "idle_shutdown",
      redactedStatus: {
        hostedMailboxConversationImportedSeq: "12",
      },
    });

    assert.equal(
      snapshotRequest.redactedStatus?.hostedMailboxConversationImportedSeq,
      "12",
    );
    assert.equal(
      Object.hasOwn(snapshotRequest, "conversationImportedSeq"),
      false,
    );
  });

  test("checkpoint builders advance expected versions after accepted checkpoints", async () => {
    const requestInput = {
      reason: "idle_shutdown",
      redactedStatus: {},
    } satisfies Parameters<ReturnType<typeof createHostedWorkspaceCheckpointRequestBuilder>["createRequest"]>[0];
    const builder = createHostedWorkspaceSnapshotCheckpointRequestBuilder({
      createSnapshot: () => ({
        snapshotRef: null,
      }),
      metadata: {
        attemptId: "attempt_synthetic_runner_checkpoint_version",
        expectedWorkspaceVersion: "1",
        leaseGeneration: "1",
      },
    });

    builder.recordCheckpoint?.({
      checkpointed: true,
      workspace: createWorkspaceState({ version: "2" }),
    });

    const request = await builder.createRequest(requestInput);
    assert.equal(request.expectedWorkspaceVersion, "2");
  });

  test("snapshot builder mirrors committed wake fields so a follow-up checkpoint cannot resurrect a stale process-start inbox media retention wake", async () => {
    // Regression for PR 240 round 32: hosted-runtime.ts manually updated
    // expectedWorkspaceVersion/nextWakeAt/nextWakeReason on checkpointMetadata
    // after an idle checkpoint, but never inboxMediaRetentionWakeAt. A
    // subsequent foreground pass (e.g. mailbox/assistant) whose checkpoint
    // request omitted inboxMediaRetentionWakeAt then fell back to the stale
    // process-start value via buildHostedWorkspaceSnapshotCheckpointRequest,
    // overwriting the freshly persisted retention wake and either resurrecting
    // a due wake or losing the next one.
    const staleProcessStartWake = "2026-01-01T00:00:00.000Z";
    const advancedRetentionWake = "2026-05-10T00:00:00.000Z";
    const advancedNextWake = "2026-05-09T12:00:00.000Z";
    const builder = createHostedWorkspaceSnapshotCheckpointRequestBuilder({
      createSnapshot: () => ({ snapshotRef: null }),
      metadata: {
        attemptId: "attempt_synthetic_runner_retention_drift",
        expectedWorkspaceVersion: "1",
        inboxMediaRetentionWakeAt: staleProcessStartWake,
        leaseGeneration: "1",
        nextWakeAt: staleProcessStartWake,
        nextWakeReason: "assistant_due",
      },
    });

    builder.recordCheckpoint?.({
      checkpointed: true,
      workspace: createWorkspaceState({
        inboxMediaRetentionWakeAt: advancedRetentionWake,
        nextWakeAt: advancedNextWake,
        nextWakeReason: "mailbox",
        version: "2",
      }),
    });

    const followUpRequest = await builder.createRequest({
      reason: "idle_shutdown",
    });

    assert.equal(followUpRequest.expectedWorkspaceVersion, "2");
    assert.equal(followUpRequest.inboxMediaRetentionWakeAt, advancedRetentionWake);
    assert.equal(followUpRequest.nextWakeAt, advancedNextWake);
    assert.equal(followUpRequest.nextWakeReason, "mailbox");
  });

  test("snapshot builder clears mirrored retention/wake fields when the committed workspace cleared them", async () => {
    const builder = createHostedWorkspaceSnapshotCheckpointRequestBuilder({
      createSnapshot: () => ({ snapshotRef: null }),
      metadata: {
        attemptId: "attempt_synthetic_runner_retention_cleared",
        expectedWorkspaceVersion: "1",
        inboxMediaRetentionWakeAt: "2026-01-01T00:00:00.000Z",
        leaseGeneration: "1",
        nextWakeAt: "2026-01-01T00:00:00.000Z",
        nextWakeReason: "assistant_due",
      },
    });

    builder.recordCheckpoint?.({
      checkpointed: true,
      workspace: createWorkspaceState({
        inboxMediaRetentionWakeAt: null,
        nextWakeAt: null,
        nextWakeReason: null,
        version: "2",
      }),
    });

    const followUpRequest = await builder.createRequest({
      reason: "idle_shutdown",
    });

    assert.equal(followUpRequest.inboxMediaRetentionWakeAt, null);
    assert.equal(followUpRequest.nextWakeAt, null);
    assert.equal(followUpRequest.nextWakeReason, null);
  });

  test("snapshot builder leaves stale metadata in place when a checkpoint is rejected", async () => {
    const staleProcessStartWake = "2026-01-01T00:00:00.000Z";
    const builder = createHostedWorkspaceSnapshotCheckpointRequestBuilder({
      createSnapshot: () => ({ snapshotRef: null }),
      metadata: {
        attemptId: "attempt_synthetic_runner_retention_rejected",
        expectedWorkspaceVersion: "1",
        inboxMediaRetentionWakeAt: staleProcessStartWake,
        leaseGeneration: "1",
        nextWakeAt: staleProcessStartWake,
        nextWakeReason: "assistant_due",
      },
    });

    builder.recordCheckpoint?.({
      checkpointed: false,
      checkpointConflictReason: "workspace_version",
      workspace: createWorkspaceState({
        inboxMediaRetentionWakeAt: "2026-09-01T00:00:00.000Z",
        nextWakeAt: "2026-09-01T00:00:00.000Z",
        nextWakeReason: "mailbox",
        version: "99",
      }),
    });

    const followUpRequest = await builder.createRequest({
      reason: "idle_shutdown",
    });

    assert.equal(followUpRequest.expectedWorkspaceVersion, "1");
    assert.equal(followUpRequest.inboxMediaRetentionWakeAt, staleProcessStartWake);
    assert.equal(followUpRequest.nextWakeAt, staleProcessStartWake);
    assert.equal(followUpRequest.nextWakeReason, "assistant_due");
  });

  test("imports mailbox before the assistant phase and schedules enrichment after the assistant", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    await initializeVault({
      createdAt: new Date(TEST_NOW),
      timezone: "UTC",
      title: "Hosted Workspace Runner Test Vault",
      vaultRoot,
    });
    const events: string[] = [];
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_001",
        laneSeq: "1",
      }),
    ];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    let releaseEffect!: () => void;
    const effectGate = new Promise<void>((resolve) => {
      releaseEffect = resolve;
    });
    let resultPromise: Promise<Awaited<ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget>>>
      | null = null;
    const registeredDeferredUsageCaptures: Promise<void>[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
      async onCheckpoint() {
        throw new Error("Foreground assistant turns must not checkpoint the workspace.");
      },
    });

    try {
      resultPromise = runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_001",
          browserVaultReplicaRef: TEST_BROWSER_VAULT_REPLICA_REF,
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        trackDeferredUsageCapture(capture) {
          registeredDeferredUsageCaptures.push(capture.completion);
        },
        async importItem(item) {
          assert.equal(
            existsSync(path.join(vaultRoot, ".runtime/operations/inbox/config.json")),
            false,
          );
          events.push(`import:${item.item.laneSeq}`);
          return {
            afterCheckpoint: async () => {
              events.push("mailbox:afterCheckpoint:start");
              await effectGate;
              events.push("mailbox:afterCheckpoint:done");
              return createInboxProjectionEffectResult();
            },
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort,
        }),
        requestId: "request_synthetic_runner_001",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_001",
          leaseGeneration: "1",
          workspaceVersion: "0",
        },
        async runAssistantPhase(input) {
          events.push("assistant");
          assert.equal(input.workspace, null);
          assert.equal(input.initialMailboxImport.checkpoint, null);
          assert.equal(input.initialMailboxImport.checkpointDeferred, true);
          assert.equal(input.now?.(), TEST_NOW);
          assert.equal(input.platform.mailboxPort !== undefined, true);
          return {
            progressed: false,
          };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      await waitUntil(() => {
        assert.equal(events.includes("mailbox:afterCheckpoint:start"), true);
      });
      assert.deepEqual(events, [
        "import:1",
        "assistant",
        "mailbox:afterCheckpoint:start",
      ]);
      const result = await withTestTimeout(resultPromise);

      assert.deepEqual(events, [
        "import:1",
        "assistant",
        "mailbox:afterCheckpoint:start",
      ]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
      assert.equal(result.initialMailboxImport.state.watermarks.conversation, "1");
      assert.equal(result.latestWorkspace, null);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(registeredDeferredUsageCaptures.length, 1);
      const registeredDeferredUsageCompletion = registeredDeferredUsageCaptures[0];
      assert.ok(registeredDeferredUsageCompletion);
      let deferredUsageCompletionSettled = false;
      void registeredDeferredUsageCompletion.finally(() => {
        deferredUsageCompletionSettled = true;
      }).catch(() => undefined);
      await Promise.resolve();
      assert.equal(deferredUsageCompletionSettled, true);
      assert.deepEqual(
        logRequests.map((request) => request.entries[0]?.eventCode),
        ["mailbox.imported", "mailbox.imported"],
      );
      assert.deepEqual(
        logRequests.map((request) => request.entries[0]?.mailboxLane),
        ["conversation", "system"],
      );

      releaseEffect();
      assert.ok(result.mailboxPostCheckpointEffectsFinished);
      await result.mailboxPostCheckpointEffectsFinished;
      assert.deepEqual(events, [
        "import:1",
        "assistant",
        "mailbox:afterCheckpoint:start",
        "mailbox:afterCheckpoint:done",
      ]);
      assert.deepEqual(
        logRequests.map((request) => request.entries[0]?.eventCode),
        [
          "mailbox.imported",
          "mailbox.imported",
          "mailbox.post_checkpoint_effects_finished",
        ],
      );
    } finally {
      releaseEffect?.();
      await resultPromise?.catch(() => undefined);
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("imports the system lane after a clean foreground conversation import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const importedRoutes: string[] = [];
    const { mailboxPort } = createMailboxPort({
      fetchRequests,
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_system_fallback",
          kind: "device-sync.wake",
          lane: "system",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let assistantPhaseCalled = false;

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_system_fallback",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedRoutes.push(item.route.action);
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_system_fallback",
        async runAssistantPhase(input) {
          assistantPhaseCalled = true;
          assert.equal(input.initialMailboxImport.state.watermarks.conversation, "0");
          assert.equal(input.initialMailboxImport.state.watermarks.system, "1");
          return { progressed: false };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
      assert.deepEqual(importedRoutes, ["run-device-sync-wake"]);
      assert.equal(assistantPhaseCalled, true);
      assert.equal(result.initialMailboxImport.state.watermarks.conversation, "0");
      assert.equal(result.initialMailboxImport.state.watermarks.system, "1");
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("refreshes a stale shared prefetch before the pre-assistant system import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const events: string[] = [];
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_stale_prefetch_conversation",
        laneSeq: "1",
      }),
    ];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const initialMailboxPrefetch = prefetchHostedMailboxPrefix({
      lanes: ["conversation", "system"],
      limitPerLane: 10,
      mailboxPort,
      requestId: "request_synthetic_runner_stale_prefetch",
      state: createEmptyHostedMailboxImportState(),
    });

    try {
      await initialMailboxPrefetch.response;
      items.push(createMailboxItem({
        id: "mailbox_item_runner_stale_prefetch_activation",
        kind: "member.activated",
        lane: "system",
        laneSeq: "1",
      }));

      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_stale_prefetch",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          events.push(`import:${item.item.lane}`);
          return { status: "imported" };
        },
        initialMailboxPrefetch,
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_stale_prefetch",
        async runAssistantPhase(input) {
          events.push("assistant");
          assert.equal(input.initialMailboxImport.state.watermarks.system, "0");
          return { progressed: false };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
      assert.deepEqual(events, [
        "import:conversation",
        "import:system",
        "assistant",
      ]);
      assert.equal(result.latestMailboxImport.state.watermarks.system, "1");
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("imports paged member preference system work before a fresh conversation assistant phase", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const events: string[] = [];
    const { mailboxPort } = createMailboxPort({
      fetchRequests,
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_preferences_conversation",
          laneSeq: "1",
        }),
        ...Array.from({ length: 10 }, (_, index) => createMailboxItem({
          id: `mailbox_item_runner_preferences_channel_${index + 1}`,
          kind: "member.channels.updated",
          lane: "system",
          laneSeq: `${index + 1}`,
        })),
        createMailboxItem({
          id: "mailbox_item_runner_preferences_update",
          kind: "member.preferences.updated",
          lane: "system",
          laneSeq: "11",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const initialMailboxPrefetch = prefetchHostedMailboxPrefix({
      lanes: ["conversation", "system"],
      limitPerLane: 10,
      mailboxPort,
      requestId: "request_synthetic_runner_preferences_barrier",
      state: createEmptyHostedMailboxImportState(),
    });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_preferences_barrier",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          events.push(`import:${item.route.action}`);
          return { status: "imported" };
        },
        initialMailboxPrefetch,
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_preferences_barrier",
        async runAssistantPhase(input) {
          events.push("assistant");
          assert.equal(input.initialMailboxImport.state.watermarks.conversation, "1");
          assert.equal(input.initialMailboxImport.state.watermarks.system, "0");
          return { progressed: false };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "10", lane: "system" },
        ],
      ]);
      assert.equal(events.at(0), "import:import-conversation-message");
      assert.equal(events.at(-2), "import:apply-member-preferences");
      assert.equal(events.at(-1), "assistant");
      assert.equal(events.filter((event) => event === "import:apply-member-channels-update").length, 10);
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "1");
      assert.equal(result.latestMailboxImport.state.watermarks.system, "11");
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("imports paged member preference system work before a background assistant phase", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const events: string[] = [];
    const { mailboxPort } = createMailboxPort({
      fetchRequests,
      items: [
        ...Array.from({ length: 10 }, (_, index) => createMailboxItem({
          id: `mailbox_item_runner_background_notification_${index + 1}`,
          kind: "assistant.notification.requested",
          lane: "system",
          laneSeq: `${index + 1}`,
        })),
        createMailboxItem({
          id: "mailbox_item_runner_background_preferences_update",
          kind: "member.preferences.updated",
          lane: "system",
          laneSeq: "11",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_background_preferences_barrier",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          events.push(`import:${item.route.action}`);
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_background_preferences_barrier",
        async runAssistantPhase(input) {
          events.push("assistant");
          assert.equal(input.initialMailboxImport.state.watermarks.conversation, "0");
          assert.equal(input.initialMailboxImport.state.watermarks.system, "11");
          return { progressed: false };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "10", lane: "system" },
        ],
      ]);
      assert.equal(events.at(-2), "import:apply-member-preferences");
      assert.equal(events.at(-1), "assistant");
      assert.equal(events.filter((event) => event === "import:dispatch-assistant-notification").length, 10);
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "0");
      assert.equal(result.latestMailboxImport.state.watermarks.system, "11");
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("delivery preparation avoids a remote refetch after pre-assistant system catch-up", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const importedRoutes: string[] = [];
    const { mailboxPort } = createMailboxPort({
      fetchRequests,
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_conversation_before_system_fence",
          laneSeq: "1",
        }),
        createMailboxItem({
          id: "mailbox_item_runner_system_before_delivery",
          kind: "member.channels.updated",
          lane: "system",
          laneSeq: "1",
        }),
        createMailboxItem({
          id: "mailbox_item_runner_system_before_delivery_2",
          kind: "member.channels.updated",
          lane: "system",
          laneSeq: "2",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let deliveryBarrier: unknown = "not-called";

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_pre_auto_reply_system",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedRoutes.push(item.route.action);
          return { status: "imported" };
        },
        limitPerLane: 1,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_pre_auto_reply_system",
        async runAssistantPhase(input) {
          assert.equal(input.initialMailboxImport.state.watermarks.conversation, "1");
          assert.equal(input.initialMailboxImport.state.watermarks.system, "0");
          deliveryBarrier = await input.prepareAutoReplyDelivery?.() ?? null;
          return { progressed: false };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.equal(deliveryBarrier, null);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "1", lane: "system" },
        ],
      ]);
      assert.deepEqual(importedRoutes, [
        "import-conversation-message",
        "apply-member-channels-update",
        "apply-member-channels-update",
      ]);
      assert.equal(result.initialMailboxImport.state.watermarks.conversation, "1");
      assert.equal(result.initialMailboxImport.state.watermarks.system, "0");
      assert.equal(result.latestMailboxImport.state.watermarks.system, "2");
      assert.equal(result.runtimeStateDirty, true);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("delivery preparation does not use a remote system fetch as a foreground barrier", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items: HostedMailboxItem[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const yieldStates: boolean[] = [];
    const providerEntries: string[] = [];
    let lateWakeInjected = false;
    const { mailboxPort } = createMailboxPort({
      beforeFetch(request) {
        const lane = request.lanes[0];
        if (
          lateWakeInjected
          || request.lanes.length !== 1
          || lane?.lane !== "system"
          || !request.requestId.includes(":pre-auto-reply-system:")
        ) {
          return;
        }

        lateWakeInjected = true;
        items.push(createMailboxItem({
          id: "mailbox_item_runner_pre_auto_reply_after_observer_stop",
          laneSeq: "1",
          occurredAt: "2026-04-26T00:00:02.000Z",
        }));
        runtimeWakeSignal.notify();
      },
      fetchRequests,
      items,
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_pre_auto_reply_late_wake",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          if (item.item.lane === "conversation") {
            const staged = await upsertAssistantInputEvent({
              event: createStoredAssistantInputEventForMailboxItem(
                item.item,
                `late pre-auto-reply input ${item.item.laneSeq}`,
              ),
              vault: vaultRoot,
            });
            await enqueueHostedPendingAssistantInputId({
              inputId: staged.inputId,
              vaultRoot,
            });
            return {
              assistantInputId: staged.inputId,
              status: "imported",
            };
          }

          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_pre_auto_reply_late_wake",
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          const deliveryBarrier = await input.prepareAutoReplyDelivery?.() ?? null;
          assert.equal(deliveryBarrier, null);
          const shouldYield = input.shouldYieldBackgroundMaintenance?.() ?? false;
          yieldStates.push(shouldYield);
          if (!shouldYield) {
            providerEntries.push("auto-reply-provider-entry");
          }

          return {
            checkpointReason: "assistant_runtime_commit",
            nextWakeAt: TEST_NOW,
            nextWakeReason: "assistant",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.equal(lateWakeInjected, false);
      assert.deepEqual(yieldStates, [false, false]);
      assert.deepEqual(providerEntries, ["auto-reply-provider-entry"]);
      assert.equal(result.assistantPhaseResult?.nextWakeAt, TEST_NOW);
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("delivery preparation does not chase a remote system high-water page", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const importedRoutes: string[] = [];
    const events: string[] = [];
    let systemFetchCount = 0;
    const conversationItem = createMailboxItem({
      id: "mailbox_item_runner_empty_system_high_water_conversation",
      laneSeq: "1",
    });
    const channelUpdateItem = createMailboxItem({
      id: "mailbox_item_runner_empty_system_high_water_disable",
      kind: "member.channels.updated",
      lane: "system",
      laneSeq: "1",
    });
    const mailboxPort: HostedRuntimeMailboxPort = {
      async fetch(request): Promise<HostedMailboxFetchResponse> {
        fetchRequests.push(request);
        const [lane] = request.lanes;
        assert.ok(lane);
        if (lane.lane === "conversation") {
          return {
            fetchedAt: TEST_NOW,
            items: [conversationItem],
            maxSeqByLane: [{
              lane: "conversation",
              maxSeq: "1",
            }],
            userId: TEST_USER_ID,
          };
        }

        systemFetchCount += 1;
        return {
          consumedSeqByLane: [{
            consumedSeq: "0",
            lane: "system",
          }],
          fetchedAt: TEST_NOW,
          items: systemFetchCount === 1 ? [] : [channelUpdateItem],
          maxSeqByLane: [{
            lane: "system",
            maxSeq: "1",
          }],
          userId: TEST_USER_ID,
        };
      },
      async fetchPayload(request): Promise<HostedMailboxPayloadFetchResponse> {
        return {
          fetchedAt: TEST_NOW,
          payload: {
            createdAt: TEST_NOW,
            mailboxItemId: request.mailboxItemId,
            payloadCiphertext: "ciphertext_synthetic_sidecar",
            payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
            userId: TEST_USER_ID,
          },
        };
      },
    };
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let deliveryBarrier: unknown = "not-called";

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_empty_system_high_water",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          events.push(`import:${item.route.action}`);
          importedRoutes.push(item.route.action);
          return { status: "imported" };
        },
        limitPerLane: 1,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_empty_system_high_water",
        async runAssistantPhase(input) {
          deliveryBarrier = await input.prepareAutoReplyDelivery?.() ?? null;
          events.push("delivery-barrier-cleared");
          return { progressed: false };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.equal(deliveryBarrier, null);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
      assert.deepEqual(importedRoutes, [
        "import-conversation-message",
        "apply-member-channels-update",
      ]);
      assert.deepEqual(events, [
        "import:import-conversation-message",
        "import:apply-member-channels-update",
        "delivery-barrier-cleared",
      ]);
      assert.equal(result.latestMailboxImport.state.watermarks.system, "1");
      assert.equal(result.runtimeStateDirty, true);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("delivery preparation leaves system import to the ordinary pre-assistant path", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const importedRoutes: string[] = [];
    const foregroundImportedRoutes: string[] = [];
    const { mailboxPort } = createMailboxPort({
      fetchRequests,
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_conversation_before_system_fence_budget",
          laneSeq: "1",
        }),
        createMailboxItem({
          id: "mailbox_item_runner_system_before_delivery_budget",
          kind: "member.channels.updated",
          lane: "system",
          laneSeq: "1",
        }),
      ],
    });
    let deliveryBarrier: unknown = "not-called";

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_pre_auto_reply_system_budget",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        foregroundImportItem: async (item) => {
          foregroundImportedRoutes.push(item.route.action);
          return {
            reasonCode: "test.foreground_budget_exhausted",
            status: "deferred",
          };
        },
        async importItem(item) {
          importedRoutes.push(item.route.action);
          return { status: "imported" };
        },
        limitPerLane: 1,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests: [] }),
        }),
        requestId: "request_synthetic_runner_pre_auto_reply_system_budget",
        async runAssistantPhase(input) {
          assert.equal(input.initialMailboxImport.state.watermarks.conversation, "1");
          deliveryBarrier = await input.prepareAutoReplyDelivery?.() ?? null;
          return { progressed: false };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.equal(deliveryBarrier, null);
      assert.deepEqual(importedRoutes, [
        "import-conversation-message",
        "apply-member-channels-update",
      ]);
      assert.deepEqual(foregroundImportedRoutes, []);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
      assert.equal(result.latestMailboxImport.state.watermarks.system, "1");
      assert.equal(result.runtimeStateDirty, true);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("delivery preparation does not extend bounded pre-assistant system catch-up", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const importedRoutes: string[] = [];
    const { mailboxPort } = createMailboxPort({
      fetchRequests,
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_conversation_before_system_cap",
          laneSeq: "1",
        }),
        ...Array.from({ length: 5 }, (_, index) =>
          createMailboxItem({
            id: `mailbox_item_runner_system_before_delivery_cap_${index + 1}`,
            kind: "member.channels.updated",
            lane: "system",
            laneSeq: `${index + 1}`,
          })
        ),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let deliveryBarrier: unknown = "not-called";

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_pre_auto_reply_system_cap",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedRoutes.push(item.route.action);
          return { status: "imported" };
        },
        limitPerLane: 1,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_pre_auto_reply_system_cap",
        async runAssistantPhase(input) {
          deliveryBarrier = await input.prepareAutoReplyDelivery?.() ?? null;
          return { progressed: false };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.equal(deliveryBarrier, null);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "1", lane: "system" },
        ],
        [
          { importedSeq: "2", lane: "system" },
        ],
        [
          { importedSeq: "3", lane: "system" },
        ],
      ]);
      assert.deepEqual(importedRoutes, [
        "import-conversation-message",
        "apply-member-channels-update",
        "apply-member-channels-update",
        "apply-member-channels-update",
        "apply-member-channels-update",
      ]);
      assert.equal(result.latestMailboxImport.state.watermarks.system, "4");
      assert.equal(result.mailboxRetryAt, TEST_NOW);
      assert.equal(result.runtimeStateDirty, true);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("imports the system lane after replay-only conversation coverage", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const importedRoutes: string[] = [];
    const { mailboxPort } = createMailboxPort({
      fetchRequests,
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_system_after_replay_only",
          kind: "device-sync.wake",
          lane: "system",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let assistantPhaseCalled = false;

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_system_after_replay_only",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedRoutes.push(item.route.action);
          return { status: "imported" };
        },
        initialMailboxImport: createReplayOnlyConversationMailboxImportResult(),
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_system_after_replay_only",
        async runAssistantPhase(input) {
          assistantPhaseCalled = true;
          assert.equal(input.initialMailboxImport.state.watermarks.conversation, "0");
          assert.equal(input.initialMailboxImport.state.watermarks.system, "1");
          return { progressed: false };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
      assert.deepEqual(importedRoutes, ["run-device-sync-wake"]);
      assert.equal(assistantPhaseCalled, true);
      assert.equal(result.initialMailboxImport.state.watermarks.conversation, "0");
      assert.equal(result.initialMailboxImport.state.watermarks.system, "1");
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("preserves a replay continuation wake across system fallback", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const initialMailboxState = createEmptyHostedMailboxImportState();
    initialMailboxState.watermarks.conversation = "100";
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxPort: HostedRuntimeMailboxPort = {
      async fetch(request): Promise<HostedMailboxFetchResponse> {
        fetchRequests.push(request);
        const [lane] = request.lanes;
        assert.ok(lane);
        if (lane.lane === "conversation") {
          return {
            consumedSeqByLane: [{
              consumedSeq: "80",
              lane: "conversation",
            }],
            fetchedAt: TEST_NOW,
            items: [
              createMailboxItem({
                id: "mailbox_item_runner_replay_continuation_081",
                laneSeq: "81",
              }),
              createMailboxItem({
                id: "mailbox_item_runner_replay_continuation_082",
                laneSeq: "82",
              }),
            ],
            maxSeqByLane: [{
              lane: "conversation",
              maxSeq: "101",
            }],
            userId: TEST_USER_ID,
          };
        }

        return {
          consumedSeqByLane: [{
            consumedSeq: "0",
            lane: "system",
          }],
          fetchedAt: TEST_NOW,
          items: [],
          maxSeqByLane: [{
            lane: "system",
            maxSeq: lane.importedSeq,
          }],
          userId: TEST_USER_ID,
        };
      },
      async fetchPayload() {
        throw new Error("Replay rows below the local watermark should not fetch payloads.");
      },
    };
    let assistantPhaseCalled = false;

    try {
      await writeHostedMailboxImportState({
        state: initialMailboxState,
        vaultRoot,
      });

      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_replay_continuation",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Replay rows below the local watermark should not import.");
        },
        limitPerLane: 2,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_replay_continuation",
        async runAssistantPhase() {
          assistantPhaseCalled = true;
          return { progressed: false };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.deepEqual(
        fetchRequests.map((request) => request.lanes.map((lane) => lane.lane)),
        [["conversation"], ["system"]],
      );
      assert.equal(assistantPhaseCalled, true);
      assert.equal(result.mailboxRetryAt, TEST_NOW);
      assert.equal(result.latestMailboxImport.importResult.nextRetryAt ?? null, null);
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "100");
      assert.equal(
        result.runtimeRedactedStatus?.["hostedMailboxConversationHandledThroughSeq"],
        undefined,
      );
      assert.equal(result.runtimeStateDirty, true);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("late foreground input interrupts maintenance after clean conversation system fallback", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_late_yield_system",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    const importedRoutes: string[] = [];
    const importedSeqs: string[] = [];
    const yieldStates: boolean[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_late_yield_system",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedRoutes.push(item.route.action);
          if (item.item.lane === "conversation") {
            importedSeqs.push(item.item.laneSeq);
            const staged = await upsertAssistantInputEvent({
              event: createStoredAssistantInputEventForMailboxItem(
                item.item,
                `late clean-fallback input ${item.item.laneSeq}`,
              ),
              vault: vaultRoot,
            });
            await enqueueHostedPendingAssistantInputId({
              inputId: staged.inputId,
              vaultRoot,
            });
            return {
              assistantInputId: staged.inputId,
              status: "imported",
            };
          }
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_late_yield_system",
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          items.push(createMailboxItem({
            id: "mailbox_item_runner_late_yield_foreground",
            laneSeq: "1",
            occurredAt: "2026-04-26T00:00:02.000Z",
          }));
          runtimeWakeSignal.notify();
          await waitForCondition(() => importedSeqs.includes("1"));
          await waitForCondition(() =>
            input.shouldYieldBackgroundMaintenance?.() === true
          );
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          return { progressed: false };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "0", lane: "conversation" },
        ],
      ]);
      assert.deepEqual(importedRoutes, [
        "run-device-sync-wake",
        "import-conversation-message",
      ]);
      assert.deepEqual(importedSeqs, ["1"]);
      assert.deepEqual(yieldStates, [false, true]);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not preserve deferred foreground mailbox imports across a new restore", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-live-"));

    try {
      const vaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceVaultRoot = path.join(workspaceRoot, "source-vault");
      await mkdir(sourceVaultRoot, { recursive: true });
      await writeFile(path.join(sourceVaultRoot, "note.md"), "snapshot note\n", "utf8");
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [{
          root: sourceVaultRoot,
          rootKey: "vault",
        }],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const snapshotRef = createBundleRef({
        hash: baseHash,
        key: `cloudflare-workspace-base/${baseHash}.bundle`,
        size: baseBundle.byteLength,
      });
      const artifactGetCalls: string[] = [];
      const artifactBytesByHash = new Map<string, Uint8Array>([
        [baseHash, baseBundle],
      ]);
      const { mailboxPort } = createMailboxPort({
        items: [
          createMailboxItem({
            id: "mailbox_item_runner_live_state",
            laneSeq: "1",
          }),
        ],
      });
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createPlatform({
          artifactBytesByHash,
          artifactGetCalls,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        vaultRoot,
        workspace: createWorkspaceState({ snapshotRef }),
      });
      assert.deepEqual(artifactGetCalls, [baseHash]);

      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_live_state",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          await writeFile(path.join(vaultRoot, "live-mailbox-state.txt"), "seq=1\n", "utf8");
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          artifactBytesByHash,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_live_state",
        async runAssistantPhase() {
          return {
            progressed: false,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ snapshotRef }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(checkpointRequests, []);
      assert.equal(await readFile(path.join(vaultRoot, "live-mailbox-state.txt"), "utf8"), "seq=1\n");
      artifactGetCalls.length = 0;

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createPlatform({
          artifactBytesByHash,
          artifactGetCalls,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        vaultRoot,
        workspace: createWorkspaceState({ snapshotRef }),
      });

      assert.deepEqual(artifactGetCalls, [baseHash]);
      await assert.rejects(readFile(path.join(vaultRoot, "live-mailbox-state.txt"), "utf8"), {
        code: "ENOENT",
      });
    } finally {
      await rm(workspaceRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not wait for mailbox enrichment before assistant reply-started", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const events: string[] = [];
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_prompt_preparation_effect",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await withTestTimeout(
        runHostedWorkspaceUntilIdleOrBudget({
          checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
            attemptId: "attempt_synthetic_runner_prompt_preparation_effect",
            expectedWorkspaceVersion: "0",
            leaseGeneration: "1",
            nextWakeAt: null,
            nextWakeReason: null,
            snapshotRef: null,
          }),
          expectedUserId: TEST_USER_ID,
          async importItem(item) {
            events.push(`import:${item.item.laneSeq}`);
            return {
              afterCheckpoint: async () => {
                events.push("mailbox:afterCheckpoint:start");
                await Promise.resolve();
                events.push("mailbox:afterCheckpoint:done");
                return createInboxProjectionEffectResult({
                  attachmentEvidenceUpdated: true,
                  projectionUpdated: true,
                  status: "succeeded",
                });
              },
              status: "imported",
            };
          },
          limitPerLane: 10,
          platform: createPlatform({
            mailboxPort,
            workspacePort: createWorkspacePort({ checkpointRequests }),
          }),
          requestId: "request_synthetic_runner_prompt_preparation_effect",
          async runAssistantPhase() {
            events.push("assistant:input.reply-started");
            return {
              progressed: false,
            };
          },
          vaultRoot,
          workspace: null,
          now: () => TEST_NOW,
        }),
      );
      await flushBackgroundMailboxEffects();

      assert.deepEqual(events, [
        "import:1",
        "assistant:input.reply-started",
        "mailbox:afterCheckpoint:start",
        "mailbox:afterCheckpoint:done",
      ]);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("stops foreground imports before post-assistant mailbox enrichment", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_stop_loop_initial",
        laneSeq: "1",
      }),
    ];
    const events: string[] = [];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let effectStartedResolve: (() => void) | null = null;
    const effectStarted = new Promise<void>((resolve) => {
      effectStartedResolve = resolve;
    });
    const effectRelease: { current: (() => void) | null } = { current: null };
    let resultPromise: ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget> | null = null;

    try {
      resultPromise = runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_stop_loop_before_import_effect",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          events.push(`import:${item.item.laneSeq}`);
          return {
            afterCheckpoint: item.item.laneSeq === "1"
              ? async () => {
                events.push("mailbox:afterCheckpoint:start");
                items.push(createMailboxItem({
                  id: "mailbox_item_runner_stop_loop_late",
                  laneSeq: "2",
                  occurredAt: "2026-04-26T00:00:02.000Z",
                }));
                runtimeWakeSignal.notify();
                const result = await new Promise<HostedMailboxPostCheckpointEffectResult>((resolve) => {
                  effectRelease.current = () => resolve(createInboxProjectionEffectResult({
                    attachmentEvidenceUpdated: true,
                    projectionUpdated: true,
                    status: "succeeded",
                  }));
                  effectStartedResolve?.();
                });
                events.push("mailbox:afterCheckpoint:done");
                return result;
              }
              : null,
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_stop_loop_before_import_effect",
        runtimeWakeSignal,
        async runAssistantPhase() {
          events.push("assistant:returned");
          return {
            progressed: false,
          };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      await effectStarted;
      const result = await withTestTimeout(resultPromise);
      assert.deepEqual(events, [
        "import:1",
        "assistant:returned",
        "mailbox:afterCheckpoint:start",
      ]);
      assert.deepEqual(importedSeqs, ["1"]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "1");
      assert.deepEqual(checkpointRequests, []);

      effectRelease.current?.();
      await flushBackgroundMailboxEffects();
      assert.deepEqual(events, [
        "import:1",
        "assistant:returned",
        "mailbox:afterCheckpoint:start",
        "mailbox:afterCheckpoint:done",
      ]);
      assert.deepEqual(importedSeqs, ["1"]);
    } finally {
      effectRelease.current?.();
      if (resultPromise) {
        await resultPromise.catch(() => undefined);
      }
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not wait for post-assistant import enrichment before returning", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_import_effect_background",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const events: string[] = [];
    let effectStartedResolve: (() => void) | null = null;
    const effectStarted = new Promise<void>((resolve) => {
      effectStartedResolve = resolve;
    });
    const effectRelease: { current: (() => void) | null } = { current: null };
    let resultPromise: ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget> | null = null;

    try {
      resultPromise = runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_import_effect_background",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          events.push("import:1");
          return {
            afterCheckpoint: async () => {
              events.push("mailbox:afterCheckpoint:start");
              effectStartedResolve?.();
              return await new Promise<HostedMailboxPostCheckpointEffectResult>((resolve) => {
                effectRelease.current = () => resolve(createInboxProjectionEffectResult({
                  attachmentEvidenceUpdated: true,
                  projectionUpdated: true,
                  status: "succeeded",
                }));
              });
            },
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_import_effect_background",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_import_effect_background",
          leaseGeneration: "1",
          workspaceVersion: "0",
        },
        async runAssistantPhase() {
          events.push("assistant:returned");
          return {
            progressed: false,
          };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      await effectStarted;
      const result = await withTestTimeout(resultPromise);

      assert.deepEqual(events, [
        "import:1",
        "assistant:returned",
        "mailbox:afterCheckpoint:start",
      ]);
      assert.equal(result.assistantPhaseResult?.progressed, false);
      assert.equal(result.latestWorkspace, null);
      assert.deepEqual(checkpointRequests, []);

      effectRelease.current?.();
      assert.ok(result.mailboxPostCheckpointEffectsFinished);
      await result.mailboxPostCheckpointEffectsFinished;
      const effectLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "mailbox.post_checkpoint_effects_finished");
      assert.ok(effectLog);
      assert.doesNotThrow(() => parseHostedRuntimeLogRequest({ entries: [effectLog] }));
      assert.equal(effectLog?.level, "info");
      assert.deepEqual(effectLog?.redactedJson, {
        attemptedCount: 1,
        effectAttachmentEvidenceUpdated: [true],
        effectKinds: ["inbox_projection"],
        effectProjectionUpdated: [true],
        effectReasonCodes: [null],
        effectStatuses: ["succeeded"],
        errorCodes: [],
        failedCount: 0,
        partialCount: 0,
        succeededCount: 1,
      });
    } finally {
      effectRelease.current?.();
      if (resultPromise) {
        await resultPromise.catch(() => undefined);
      }
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("checkpointing performs no runner-level usage recording", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });
    const recordUsage = vi.fn(async () => {
      throw new Error("usage recording should happen inside the assistant phase only.");
    });

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_no_usage_drain",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Import should not run without mailbox items.");
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          usageRecordPort: { recordUsage },
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_no_usage_drain",
        async runAssistantPhase() {
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.equal(recordUsage.mock.calls.length, 0);
      assert.deepEqual(
        checkpointRequests.map((request) => request.reason),
        [],
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("rejects a progressed assistant phase without an explicit checkpoint reason", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });

    try {
      await assert.rejects(
        () =>
          runHostedWorkspaceUntilIdleOrBudget({
            checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
              attemptId: "attempt_synthetic_runner_missing_checkpoint_reason",
              expectedWorkspaceVersion: "0",
              leaseGeneration: "1",
              nextWakeAt: null,
              nextWakeReason: null,
              snapshotRef: null,
            }),
            expectedUserId: TEST_USER_ID,
            async importItem() {
              throw new Error("Import should not run without mailbox items.");
            },
            limitPerLane: 10,
            platform: createPlatform({
              mailboxPort,
              workspacePort: createWorkspacePort({ checkpointRequests }),
            }),
            requestId: "request_synthetic_runner_missing_checkpoint_reason",
            async runAssistantPhase() {
              return JSON.parse("{\"progressed\":true}");
            },
            vaultRoot,
            workspace: createWorkspaceState({ version: "0" }),
            now: () => TEST_NOW,
          }),
        /Hosted workspace assistant phase checkpoint requires an explicit reason\./u,
      );

      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not add an import checkpoint when a deferred import is covered by assistant progress", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    await initializeVault({
      createdAt: new Date(TEST_NOW),
      timezone: "UTC",
      title: "Hosted Workspace Runner Deferred Import Test Vault",
      vaultRoot,
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_deferred_import_covered",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Initial mailbox import was already provided.");
        },
        initialMailboxImport: createDeferredMailboxImportResult(),
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_deferred_import_covered",
        async runAssistantPhase() {
          return {
            checkpointReason: "outbox_sending",
            progressed: true,
            redactedStatus: {
              hostedAssistantDeliveryEffectCount: 1,
            },
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.equal(result.latestWorkspace?.version, "0");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("durably arms automation schedule writes while checkpointing their receipts", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    await initializeVault({
      createdAt: new Date(TEST_NOW),
      timezone: "UTC",
      title: "Hosted Workspace Runner Dirty Receipt Snapshot Test Vault",
      vaultRoot,
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeCheckpointInputs: HostedWorkspaceRunnerRuntimeStatusCheckpointInput[] = [];
    const snapshotInputs: Array<{ reason: string }> = [];
    const { mailboxPort } = createMailboxPort({ items: [] });
    const workspacePort = createWorkspacePort({ checkpointRequests });
    const previousSnapshotRef = createBundleRef({
      hash: "hash_synthetic_previous_receipt_snapshot",
      key: "snapshots/synthetic-previous-receipt-snapshot.tar.zst",
      size: 128,
    });
    const checkpointRequestBuilder = createHostedWorkspaceSnapshotCheckpointRequestBuilder({
      createSnapshot: (snapshotInput) => {
        snapshotInputs.push(snapshotInput);
        return {
          snapshotRef: previousSnapshotRef,
        };
      },
      metadata: {
        attemptId: "attempt_synthetic_runner_dirty_receipt_snapshot",
        expectedWorkspaceVersion: "0",
        leaseGeneration: "1",
      },
    });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRuntimeRedactedStatus: async (checkpointInput) => {
          runtimeCheckpointInputs.push(checkpointInput);
          assert.equal(checkpointInput.reason, "canonical_runtime_commit");
          return await workspacePort.checkpoint!({
            attemptId: "attempt_synthetic_runner_dirty_receipt_snapshot",
            expectedWorkspaceVersion: checkpointInput.workspace?.version ?? "0",
            leaseGeneration: "1",
            nextWakeAt: checkpointInput.nextWakeAt ?? null,
            nextWakeReason: checkpointInput.nextWakeReason ?? null,
            reason: "canonical_runtime_commit",
            redactedStatus: checkpointInput.redactedStatus,
            snapshotRef: checkpointInput.workspace?.snapshotRef ?? null,
          });
        },
        checkpointRequestBuilder,
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Initial mailbox import was already provided.");
        },
        initialMailboxImport: createDeferredMailboxImportResult(),
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort,
        }),
        requestId: "request_synthetic_runner_dirty_receipt_snapshot",
        async runAssistantPhase(phaseInput) {
          assert.equal(phaseInput.assistantAutomationScheduleChanged?.(), false);
          await applyCanonicalWriteBatch({
            audit: {
              action: "automation_upsert",
              commandName: "test.dirtyReceiptSnapshot",
              summary: "Synthetic canonical write on dirty runtime state.",
            },
            operationType: "automation_upsert",
            summary: "Synthetic canonical write on dirty runtime state",
            textWrites: [
              {
                content: "Synthetic dirty receipt snapshot\n",
                overwrite: true,
                relativePath: "bank/automations/dirty-receipt-snapshot.md",
              },
            ],
            vaultRoot,
          });
          assert.equal(phaseInput.assistantAutomationScheduleChanged?.(), true);
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: previousSnapshotRef,
          version: "0",
        }),
        now: () => TEST_NOW,
      });

      assert.equal(result.latestWorkspace?.version, "1");
      assert.equal(result.latestWorkspace?.nextWakeAt, TEST_NOW);
      assert.equal(result.latestWorkspace?.nextWakeReason, "assistant");
      assert.deepEqual(runtimeCheckpointInputs.map((input) => input.reason), [
        "canonical_runtime_commit",
      ]);
      assert.deepEqual(
        runtimeCheckpointInputs.map((input) => ({
          nextWakeAt: input.nextWakeAt ?? null,
          nextWakeReason: input.nextWakeReason ?? null,
        })),
        [{
          nextWakeAt: TEST_NOW,
          nextWakeReason: "assistant",
        }],
      );
      assert.deepEqual(snapshotInputs, []);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "canonical_runtime_commit",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) => ({
          nextWakeAt: request.nextWakeAt ?? null,
          nextWakeReason: request.nextWakeReason ?? null,
        })),
        [{
          nextWakeAt: TEST_NOW,
          nextWakeReason: "assistant",
        }],
      );
      assert.deepEqual(checkpointRequests[0]?.snapshotRef, previousSnapshotRef);
      assert.equal(result.runtimeStateDirty, true);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("rebases delayed canonical writes onto the latest workspace status", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    await initializeVault({
      createdAt: new Date(TEST_NOW),
      timezone: "UTC",
      title: "Hosted Workspace Delayed Canonical Write Test Vault",
      vaultRoot,
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const workspace = createWorkspaceState({
      redactedStatus: {
        hostedSystemMailboxHandledThroughSeq: "7",
      },
      version: "1",
    });
    const platform = createPlatform({
      mailboxPort: createMailboxPort({ items: [] }).mailboxPort,
      workspacePort: createWorkspacePort({ checkpointRequests }),
    });

    try {
      const result = await runHostedWorkspaceCanonicalWriteAtBoundary({
        previousRedactedStatus: workspace.redactedStatus ?? null,
        runnerInput: {
          checkpointRuntimeRedactedStatus:
            createRuntimeRedactedStatusCheckpoint({
              attemptId: "attempt_delayed_canonical_write",
              checkpointRequests,
              expectedWorkspaceVersion: "1",
              leaseGeneration: "1",
            }),
          checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
            attemptId: "attempt_delayed_canonical_write",
            expectedWorkspaceVersion: "1",
            leaseGeneration: "1",
            nextWakeAt: null,
            nextWakeReason: null,
            snapshotRef: null,
          }),
          expectedUserId: TEST_USER_ID,
          async importItem() {
            throw new Error("Mailbox import is not used at a canonical boundary.");
          },
          limitPerLane: 10,
          platform,
          requestId: "request_delayed_canonical_write",
          vaultRoot,
          workspace,
        },
        async write() {
          await applyCanonicalWriteBatch({
            audit: {
              action: "experiment_update",
              commandName: "test.delayedCanonicalWrite",
              summary: "Synthetic delayed canonical write.",
            },
            operationType: "delayed_canonical_write_test",
            summary: "Synthetic delayed canonical write",
            textWrites: [{
              content: "delayed canonical write\n",
              overwrite: true,
              relativePath: "bank/delayed-canonical-write.md",
            }],
            vaultRoot,
          });
        },
      });

      assert.equal(result.workspace?.version, "2");
      assert.equal(
        result.workspace?.redactedStatus?.hostedSystemMailboxHandledThroughSeq,
        "7",
      );
      assert.equal(
        typeof result.workspace?.redactedStatus
          ?.hostedCanonicalWriteReceiptLogSha256,
        "string",
      );
      assert.equal(checkpointRequests[0]?.expectedWorkspaceVersion, "1");
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("rejects a saturated canonical receipt log before uploading payloads", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    await initializeVault({
      createdAt: new Date(TEST_NOW),
      timezone: "UTC",
      title: "Hosted Workspace Runner Saturated Receipt Log Test Vault",
      vaultRoot,
    });
    const receiptLogBytes = new TextEncoder().encode(`${JSON.stringify({
      entries: Array.from(
        { length: HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES },
        () => ({
          byteSize: 0,
          sha256: "a".repeat(64),
        }),
      ),
      schema: "murph.hosted-canonical-write-receipt-log.v1",
    }, null, 2)}\n`);
    const receiptLogSha256 = createHash("sha256").update(receiptLogBytes).digest("hex");
    const artifactGetCalls: string[] = [];
    const artifactPutCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });
    const workspace = createWorkspaceState({
      redactedStatus: {
        hostedCanonicalWriteReceiptLogByteSize: receiptLogBytes.byteLength,
        hostedCanonicalWriteReceiptLogSha256: receiptLogSha256,
      },
      version: "0",
    });

    try {
      await assert.rejects(
        runHostedWorkspaceUntilIdleOrBudget({
          async checkpointRuntimeRedactedStatus() {
            throw new Error("Saturated receipt log must fail before checkpointing status.");
          },
          checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
            attemptId: "attempt_synthetic_runner_saturated_receipt_log",
            expectedWorkspaceVersion: "0",
            leaseGeneration: "1",
            nextWakeAt: null,
            nextWakeReason: null,
            snapshotRef: null,
          }),
          expectedUserId: TEST_USER_ID,
          async importItem() {
            throw new Error("Initial mailbox import was already provided.");
          },
          initialMailboxImport: createDeferredMailboxImportResult(),
          limitPerLane: 10,
          platform: createPlatform({
            artifactBytesByHash: new Map([[receiptLogSha256, receiptLogBytes]]),
            artifactGetCalls,
            artifactPutCalls,
            mailboxPort,
            workspacePort: createWorkspacePort({ checkpointRequests }),
          }),
          requestId: "request_synthetic_runner_saturated_receipt_log",
          async runAssistantPhase() {
            await applyCanonicalWriteBatch({
              audit: {
                action: "experiment_update",
                commandName: "test.saturatedReceiptLog",
                summary: "Synthetic canonical write against a saturated receipt log.",
              },
              operationType: "saturated_receipt_log_test",
              summary: "Exercise saturated canonical receipt log handling",
              textWrites: [
                {
                  content: "must roll back\n",
                  overwrite: true,
                  relativePath: "bank/saturated-receipt-log.md",
                },
              ],
              vaultRoot,
            });
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
          workspace,
          now: () => TEST_NOW,
        }),
        (error: unknown) => (
          error instanceof RangeError
          && error.message === "Hosted canonical write receipt log reached its pending entry limit."
        ),
      );

      assert.deepEqual(artifactGetCalls, [receiptLogSha256]);
      assert.deepEqual(artifactPutCalls, []);
      assert.deepEqual(checkpointRequests, []);
      await assert.rejects(readFile(path.join(vaultRoot, "bank", "saturated-receipt-log.md")));
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("rolls back a canonical write without checkpointing when artifact upload fails", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    await initializeVault({
      createdAt: new Date(TEST_NOW),
      timezone: "UTC",
      title: "Hosted Workspace Runner Failed Artifact Upload Test Vault",
      vaultRoot,
    });
    const artifactPutCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });
    let checkpointAttempted = false;

    try {
      await assert.rejects(
        runHostedWorkspaceUntilIdleOrBudget({
          async checkpointRuntimeRedactedStatus() {
            checkpointAttempted = true;
            throw new Error("Artifact upload failure must prevent checkpointing.");
          },
          checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
            attemptId: "attempt_synthetic_runner_failed_artifact_upload",
            expectedWorkspaceVersion: "0",
            leaseGeneration: "1",
            nextWakeAt: null,
            nextWakeReason: null,
            snapshotRef: null,
          }),
          expectedUserId: TEST_USER_ID,
          async importItem() {
            throw new Error("Initial mailbox import was already provided.");
          },
          initialMailboxImport: createDeferredMailboxImportResult(),
          limitPerLane: 10,
          platform: createPlatform({
            async artifactPut() {
              throw new Error("Synthetic canonical artifact upload failure.");
            },
            artifactPutCalls,
            mailboxPort,
            workspacePort: createWorkspacePort({ checkpointRequests }),
          }),
          requestId: "request_synthetic_runner_failed_artifact_upload",
          async runAssistantPhase() {
            await applyCanonicalWriteBatch({
              audit: {
                action: "experiment_update",
                commandName: "test.failedArtifactUpload",
                summary: "Synthetic canonical write with failed artifact upload.",
              },
              operationType: "failed_artifact_upload_test",
              summary: "Synthetic canonical write with failed artifact upload",
              textWrites: [
                {
                  content: "must roll back\n",
                  overwrite: true,
                  relativePath: "bank/failed-artifact-upload.md",
                },
              ],
              vaultRoot,
            });
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
          workspace: createWorkspaceState({ version: "0" }),
          now: () => TEST_NOW,
        }),
        /Synthetic canonical artifact upload failure/u,
      );

      assert.equal(artifactPutCalls.length >= 3, true);
      assert.equal(checkpointAttempted, false);
      assert.deepEqual(checkpointRequests, []);
      await assert.rejects(readFile(path.join(vaultRoot, "bank", "failed-artifact-upload.md")));
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("checkpoints canonical writes performed while importing mailbox items", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    await initializeVault({
      createdAt: new Date(TEST_NOW),
      timezone: "UTC",
      title: "Hosted Workspace Runner Mailbox Receipt Test Vault",
      vaultRoot,
    });
    const artifactPutCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItem = createMailboxItem({
      id: "mailbox_item_runner_canonical_receipt",
      laneSeq: "1",
    });

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRuntimeRedactedStatus: createRuntimeRedactedStatusCheckpoint({
          attemptId: "attempt_synthetic_runner_mailbox_receipt",
          checkpointRequests,
          leaseGeneration: "1",
        }),
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_mailbox_receipt",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          await applyCanonicalWriteBatch({
            audit: {
              action: "experiment_update",
              commandName: "test.mailboxCanonicalReceipt",
              summary: "Synthetic canonical mailbox import write.",
            },
            operationType: "mailbox_canonical_receipt_test",
            summary: "Synthetic canonical mailbox import write",
            textWrites: [
              {
                content: "canonical mailbox import\n",
                overwrite: true,
                relativePath: "bank/mailbox-canonical-receipt.md",
              },
            ],
            vaultRoot,
          });
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          artifactPutCalls,
          mailboxPort: createMailboxPort({ items: [mailboxItem] }).mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_mailbox_receipt",
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "canonical_runtime_commit",
      ]);
      assert.equal(artifactPutCalls.length >= 3, true);
      assert.equal(
        typeof checkpointRequests[0]?.redactedStatus
          ?.hostedCanonicalWriteReceiptLogSha256,
        "string",
      );
      assert.equal(
        typeof checkpointRequests[0]?.redactedStatus
          ?.hostedCanonicalWriteReceiptLogByteSize,
        "number",
      );
      assert.equal(
        checkpointRequests[0]?.redactedStatus
          ?.hostedMailboxConversationImportedSeq,
        "1",
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("checkpoints mailbox progress when its canonical receipt is already durable", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItem = createMailboxItem({
      id: "mailbox_item_runner_durable_canonical_receipt",
      laneSeq: "1",
    });
    const workspace = createWorkspaceState({
      redactedStatus: {
        hostedCanonicalWriteReceiptLogByteSize: 1,
        hostedCanonicalWriteReceiptLogSha256: "a".repeat(64),
      },
      version: "0",
    });

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRuntimeRedactedStatus: createRuntimeRedactedStatusCheckpoint({
          attemptId: "attempt_synthetic_runner_durable_mailbox_receipt",
          checkpointRequests,
          leaseGeneration: "1",
        }),
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_durable_mailbox_receipt",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort: createMailboxPort({ items: [mailboxItem] }).mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_durable_mailbox_receipt",
        vaultRoot,
        workspace,
        now: () => TEST_NOW,
      });

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "canonical_runtime_commit",
      ]);
      assert.equal(
        checkpointRequests[0]?.redactedStatus
          ?.hostedMailboxConversationImportedSeq,
        "1",
      );
      assert.equal(
        checkpointRequests[0]?.redactedStatus
          ?.hostedCanonicalWriteReceiptLogSha256,
        "a".repeat(64),
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not publish receipt-log status when a post-checkpoint canonical receipt checkpoint fails", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    await initializeVault({
      createdAt: new Date(TEST_NOW),
      timezone: "UTC",
      title: "Hosted Workspace Runner Failed Receipt Checkpoint Test Vault",
      vaultRoot,
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });
    let checkpointAttempted = false;

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRuntimeRedactedStatus: async () => {
          checkpointAttempted = true;
          throw new Error("Synthetic canonical receipt checkpoint failure.");
        },
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_failed_receipt_checkpoint",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Initial mailbox import was already provided.");
        },
        initialMailboxImport: createCheckpointedMailboxImportResult(),
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_failed_receipt_checkpoint",
        async runAssistantPhase() {
          return {
            afterCheckpoint: async () => {
              await applyCanonicalWriteBatch({
                audit: {
                  action: "experiment_update",
                  commandName: "test.failedReceiptCheckpoint",
                  summary: "Synthetic canonical write with failed receipt checkpoint.",
                },
                operationType: "failed_receipt_checkpoint_test",
                summary: "Synthetic canonical write with failed receipt checkpoint",
                textWrites: [
                  {
                    content: "Synthetic failed receipt checkpoint\n",
                    overwrite: true,
                    relativePath: "bank/failed-receipt-checkpoint.md",
                  },
                ],
                vaultRoot,
              });
              return {
                checkpointReason: "canonical_runtime_commit",
              };
            },
            checkpointReason: "assistant_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.equal(checkpointAttempted, true);
      assert.equal(
        result.runtimeRedactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        undefined,
      );
      assert.equal(
        result.runtimeRedactedStatus?.hostedCanonicalWriteReceiptLogByteSize,
        undefined,
      );
      assert.equal(
        result.runtimeRedactedStatus?.hostedCanonicalWriteReceiptLogEntryCount,
        undefined,
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("requests an immediate idle wake after assistant context snapshot source writes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    await initializeVault({
      createdAt: new Date(TEST_NOW),
      timezone: "UTC",
      title: "Hosted Workspace Runner Snapshot Dirty Test Vault",
      vaultRoot,
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeCheckpointInputs: HostedWorkspaceRunnerRuntimeStatusCheckpointInput[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRuntimeRedactedStatus = createRuntimeRedactedStatusCheckpoint({
      attemptId: "attempt_synthetic_runner_snapshot_dirty",
      checkpointRequests,
      leaseGeneration: "1",
    });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRuntimeRedactedStatus: async (checkpointInput) => {
          runtimeCheckpointInputs.push(checkpointInput);
          return await checkpointRuntimeRedactedStatus(checkpointInput);
        },
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_snapshot_dirty",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Initial mailbox import should have no items.");
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_snapshot_dirty",
        async runAssistantPhase() {
          await applyCanonicalWriteBatch({
            audit: {
              action: "experiment_update",
              commandName: "test.snapshotDirty",
              summary: "Synthetic experiment update.",
            },
            operationType: "snapshot_dirty_test",
            summary: "Synthetic experiment update",
            textWrites: [
              {
                content: "Synthetic experiment update\n",
                overwrite: true,
                relativePath: "bank/experiments/snapshot-dirty.md",
              },
            ],
            vaultRoot,
          });
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.equal(result.assistantPhaseResult?.nextWakeAt, TEST_NOW);
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.equal(result.runtimeStateDirty, true);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "canonical_runtime_commit",
      ]);
      assert.deepEqual(
        runtimeCheckpointInputs.map((checkpointInput) => checkpointInput.reason),
        ["canonical_runtime_commit"],
      );
      assert.deepEqual(
        (await readAssistantContextSnapshotState(vaultRoot))?.pendingDirtyDomains,
        ["experiments"],
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("keeps an immediate assistant wake when a prior context snapshot dirty marker is still pending", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    await initializeVault({
      createdAt: new Date(TEST_NOW),
      timezone: "UTC",
      title: "Hosted Workspace Runner Snapshot Pending Test Vault",
      vaultRoot,
    });
    await markAssistantContextSnapshotDirty({
      domains: ["experiments"],
      vaultRoot,
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_snapshot_pending",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Initial mailbox import was already provided.");
        },
        initialMailboxImport: createDeferredMailboxImportResult(),
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_snapshot_pending",
        async runAssistantPhase() {
          return {
            checkpointReason: "canonical_runtime_commit",
            nextWakeAt: "2026-04-27T00:10:00.000Z",
            nextWakeReason: "assistant",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.equal(result.assistantPhaseResult?.nextWakeAt, TEST_NOW);
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), []);
      assert.deepEqual(
        (await readAssistantContextSnapshotState(vaultRoot))?.pendingDirtyDomains,
        ["experiments"],
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not request assistant context snapshot wake for audit-only writes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    await initializeVault({
      createdAt: new Date(TEST_NOW),
      timezone: "UTC",
      title: "Hosted Workspace Runner Snapshot Audit Test Vault",
      vaultRoot,
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRuntimeRedactedStatus: createRuntimeRedactedStatusCheckpoint({
          attemptId: "attempt_synthetic_runner_snapshot_audit_only",
          checkpointRequests,
          leaseGeneration: "1",
        }),
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_snapshot_audit_only",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Initial mailbox import should have no items.");
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_snapshot_audit_only",
        async runAssistantPhase() {
          await applyCanonicalWriteBatch({
            audit: {
              action: "jsonl_append",
              commandName: "test.auditOnly",
              summary: "Synthetic audit append.",
            },
            jsonlAppends: [
              {
                record: {
                  synthetic: true,
                },
                relativePath: "audit/2026/2026-04.jsonl",
              },
            ],
            operationType: "snapshot_audit_only_test",
            summary: "Synthetic audit append",
            vaultRoot,
          });
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.equal(result.assistantPhaseResult?.nextWakeAt ?? null, null);
      assert.equal(result.runtimeStateDirty, true);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "canonical_runtime_commit",
      ]);
      assert.equal(await readAssistantContextSnapshotState(vaultRoot), null);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("sends Linq fast-dispatch without a foreground receipt checkpoint", async () => {
    const checkpointVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const attemptVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const effectObservations: Array<{ effectId: string; idempotencyKey: string | null }> = [];
    const transportRequests: Array<{ idempotencyKey: string | null }> = [];
    const externalMessages = new Map<string, {
      providerMessageId: string;
      providerThreadId: string;
      target: string;
    }>();
    const providerFetch = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        message?: {
          idempotency_key?: string;
        };
      };
      const idempotencyKey = body.message?.idempotency_key ?? null;
      transportRequests.push({ idempotencyKey });
      if (!idempotencyKey) {
        throw new Error("Expected Linq fast dispatch to carry an idempotency key.");
      }
      assert.equal(idempotencyKey, "assistant-outbox:crash-window-linq");
      const existing = externalMessages.get(idempotencyKey);
      if (existing) {
        return Response.json({
          chat: {
            id: existing.providerThreadId,
            message: {
              id: existing.providerMessageId,
            },
          },
        });
      }
      const created = {
        providerMessageId: `provider_synthetic_linq_${externalMessages.size + 1}`,
        providerThreadId: "thread_synthetic_linq_crash_window",
        target: "thread_synthetic_linq_crash_window",
      };
      externalMessages.set(idempotencyKey, created);
      return Response.json({
        chat: {
          id: created.providerThreadId,
          message: {
            id: created.providerMessageId,
          },
        },
      });
    });

    try {
      await initializeVault({
        createdAt: new Date(TEST_NOW),
        timezone: "UTC",
        title: "Hosted Workspace Runner Fast Dispatch Crash Window",
        vaultRoot: checkpointVaultRoot,
      });
      await createAssistantOutboxIntent({
        actorId: "+15550001",
        bindingDelivery: {
          kind: "thread",
          target: "thread_synthetic_linq_crash_window",
        },
        channel: "linq",
        createdAt: TEST_NOW,
        deliveryIdempotencyKey: "assistant-outbox:crash-window-linq",
        deliverySource: {
          kind: "linq",
          fromPhoneNumber: "+15550000",
        },
        identityId: "phone_lookup_synthetic_crash_window",
        message: "Synthetic Linq crash-window reply",
        sessionId: "session_synthetic_crash_window",
        threadId: "thread_synthetic_linq_crash_window",
        threadIsDirect: true,
        turnId: "turn_synthetic_crash_window",
        vault: checkpointVaultRoot,
      });
      await rm(attemptVaultRoot, { force: true, recursive: true });
      await cp(checkpointVaultRoot, attemptVaultRoot, { recursive: true });

      await runFastDispatchCrashWindowAttempt({
        checkpointRequests,
        effectObservations,
        providerFetch,
        vaultRoot: attemptVaultRoot,
      });

      assert.equal(externalMessages.size, 1);
      assert.deepEqual(transportRequests, [
        { idempotencyKey: "assistant-outbox:crash-window-linq" },
      ]);
      assert.equal(effectObservations.length, 1);
      assert.deepEqual(effectObservations.map((effect) => effect.idempotencyKey), [
        "assistant-outbox:crash-window-linq",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), []);
    } finally {
      await rm(checkpointVaultRoot, { force: true, recursive: true });
      await rm(attemptVaultRoot, { force: true, recursive: true });
    }
  });

  test("keeps a deferred mailbox import local after an idle assistant phase", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    await initializeVault({
      createdAt: new Date(TEST_NOW),
      timezone: "UTC",
      title: "Hosted Workspace Runner Deferred Idle Test Vault",
      vaultRoot,
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_deferred_import_idle",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Initial mailbox import was already provided.");
        },
        initialMailboxImport: createDeferredMailboxImportResult(),
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_deferred_import_idle",
        async runAssistantPhase() {
          return {
            progressed: false,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.equal(result.latestWorkspace?.version, "0");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("runs staged mailbox projection effects before assistant input sampling without an extra checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const events: string[] = [];
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_active_turn_projection",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_active_turn_projection",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
          return {
            afterCheckpoint: async () => {
              events.push("mailbox:afterCheckpoint");
              return createInboxProjectionEffectResult({
                attachmentEvidenceUpdated: true,
              });
            },
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_active_turn_projection",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_active_turn_projection",
          leaseGeneration: "1",
          workspaceVersion: "0",
        },
        async runAssistantPhase() {
          events.push("assistant");
          return {
            progressed: false,
          };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      await flushBackgroundMailboxEffects();

      assert.deepEqual(events, [
        "import:1",
        "assistant",
        "mailbox:afterCheckpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.deepEqual(logRequests.map((request) => request.entries[0]?.phase), [
        "import",
        "import",
        "import",
      ]);
      assert.deepEqual(logRequests[2]?.entries[0]?.redactedJson, {
        attemptedCount: 1,
        effectAttachmentEvidenceUpdated: [true],
        effectKinds: ["inbox_projection"],
        effectProjectionUpdated: [true],
        effectReasonCodes: [null],
        effectStatuses: ["succeeded"],
        errorCodes: [],
        failedCount: 0,
        partialCount: 0,
        succeededCount: 1,
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("continues the assistant phase when pre-assistant mailbox effects fail", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const events: string[] = [];
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_before_assistant_error",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_before_assistant_error",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
          return {
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_before_assistant_error",
        async runAssistantPhase() {
          events.push("assistant");
          return {
            progressed: false,
          };
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.deepEqual(events, [
        "import:1",
        "assistant",
      ]);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("keeps reply intent local even when optional runner lanes are degraded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const events: string[] = [];
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_liveness_optional_degraded",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_liveness_optional_degraded",
          browserVaultReplicaRef: null,
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
          return {
            afterCheckpoint: async () => {
              events.push("optional:projection");
              throw Object.assign(new Error("optional projection unavailable"), {
                code: "PROJECTION_UNAVAILABLE",
              });
            },
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: {
          ...createPlatform({
            mailboxPort,
            workspacePort: createWorkspacePort({ checkpointRequests }),
          }),
          logPort: {
            async write() {
              events.push("optional:log");
              throw new Error("log export unavailable");
            },
          },
        },
        requestId: "request_synthetic_runner_liveness_optional_degraded",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_liveness_optional_degraded",
          leaseGeneration: "1",
          workspaceVersion: "0",
        },
        async runAssistantPhase() {
          events.push("assistant");
          return {
            checkpointReason: "outbox_sending",
            progressed: true,
            redactedStatus: {
              hostedOutboxSendingCheckpointed: true,
            },
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      await flushBackgroundMailboxEffects();

      assert.equal(result.assistantPhaseResult?.progressed, true);
      assert.equal(result.latestWorkspace?.version, "0");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.deepEqual(events, [
        "import:1",
        "optional:log",
        "optional:log",
        "assistant",
        "optional:log",
        "optional:projection",
        "optional:log",
      ]);
    } finally {
      warn.mockRestore();
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("runs mailbox post-checkpoint effects before assistant failure without an extra checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const events: string[] = [];
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_after_checkpoint_error",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await assert.rejects(
        () =>
          runHostedWorkspaceUntilIdleOrBudget({
            checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
              attemptId: "attempt_synthetic_runner_after_checkpoint_error",
              expectedWorkspaceVersion: "0",
              leaseGeneration: "1",
              nextWakeAt: null,
              nextWakeReason: null,
              snapshotRef: null,
            }),
            expectedUserId: TEST_USER_ID,
            async importItem(item) {
              events.push(`import:${item.item.laneSeq}`);
              return {
                afterCheckpoint: async () => {
                  events.push("mailbox:afterCheckpoint");
                  return createInboxProjectionEffectResult();
                },
                status: "imported",
              };
            },
            limitPerLane: 10,
            platform: createPlatform({
              mailboxPort,
              workspacePort: createWorkspacePort({ checkpointRequests }),
            }),
            requestId: "request_synthetic_runner_after_checkpoint_error",
            async runAssistantPhase() {
              events.push("assistant");
              throw new Error("assistant failed after mailbox checkpoint");
            },
            vaultRoot,
            workspace: null,
            now: () => TEST_NOW,
          }),
        /assistant failed after mailbox checkpoint/u,
      );

      await flushBackgroundMailboxEffects();

      assert.deepEqual(events, [
        "import:1",
        "assistant",
        "mailbox:afterCheckpoint",
      ]);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("runs the assistant phase on restart after the import checkpoint already advanced", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_reset_replay",
        laneSeq: "1",
      }),
    ];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const firstCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const secondCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];

    try {
      await assert.rejects(
        () =>
          runHostedWorkspaceUntilIdleOrBudget({
            checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
              attemptId: "attempt_synthetic_runner_reset_before_assistant",
              expectedWorkspaceVersion: "0",
              leaseGeneration: "1",
              nextWakeAt: null,
              nextWakeReason: null,
              snapshotRef: null,
            }),
            expectedUserId: TEST_USER_ID,
            async importItem(item) {
              events.push(`import:${item.item.laneSeq}`);
              return { status: "imported" };
            },
            limitPerLane: 10,
            platform: createPlatform({
              mailboxPort,
              workspacePort: createWorkspacePort({
                checkpointRequests: firstCheckpointRequests,
              }),
            }),
            requestId: "request_synthetic_runner_reset_before_assistant",
            async runAssistantPhase() {
              events.push("assistant:first");
              throw new Error("durable object reset before assistant handling");
            },
            vaultRoot,
            workspace: createWorkspaceState({ version: "0" }),
            now: () => TEST_NOW,
          }),
        /durable object reset before assistant handling/u,
      );

      assert.deepEqual(firstCheckpointRequests.map((request) => request.reason), [
      ]);
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
        "1",
      );

      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_reset_replay",
          expectedWorkspaceVersion: "1",
          leaseGeneration: "2",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Import should not rerun after the watermark checkpoint.");
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({
            checkpointRequests: secondCheckpointRequests,
          }),
        }),
        requestId: "request_synthetic_runner_reset_replay",
        async runAssistantPhase(input) {
          events.push("assistant:replay");
          assert.equal(input.initialMailboxImport.stateChanged, false);
          assert.equal(input.initialMailboxImport.importResult.importedCount, 0);
          assert.equal(input.initialMailboxImport.state.watermarks.conversation, "1");
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
            redactedStatus: {
              hostedAssistantReplayHandledCount: 1,
            },
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "1" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(events, [
        "import:1",
        "assistant:first",
        "assistant:replay",
      ]);
      assert.deepEqual(
        fetchRequests
          .filter((request) => request.lanes.some((lane) => lane.lane === "conversation"))
          .map((request) =>
            request.lanes.find((lane) => lane.lane === "conversation")?.importedSeq
          ),
        ["0", "1"],
      );
      assert.deepEqual(secondCheckpointRequests.map((request) => request.reason), [
      ]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("writes a warning mailbox import log when import is blocked", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_blocked",
          laneSeq: "2",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    let assistantPhaseCalled = false;

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_blocked",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "2",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Import should not run for a blocked prefix gap.");
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_blocked",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_blocked",
          leaseGeneration: "2",
          workspaceVersion: "0",
        },
        async runAssistantPhase() {
          assistantPhaseCalled = true;
          return {};
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.equal(logRequests[0]?.entries[0]?.eventCode, "mailbox.imported");
      assert.equal(logRequests[0]?.entries[0]?.level, "warn");
      assert.deepEqual(logRequests[0]?.entries[0]?.redactedJson, {
        assistantInputCount: 0,
        assistantInputPresent: false,
        blockCodes: ["lane.gap"],
        blockedCount: 1,
        checkpointDeferred: false,
        checkpointed: false,
        conversationImportedCount: 0,
        conversationSeqEnd: "0",
        conversationSeqStart: "0",
        fetchedCount: 1,
        importedCount: 0,
        laneCount: 1,
        retryableBlockedCount: 1,
        stateChanged: false,
        systemSeqEnd: "0",
        systemSeqStart: "0",
      });
      assert.deepEqual(checkpointRequests, []);
      assert.equal(assistantPhaseCalled, true);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("defers mailbox import snapshots after foreground import mutates local state", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_snapshot_001",
        laneSeq: "1",
      }),
    ];
    const { mailboxPort } = createMailboxPort({ items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const createSnapshot = vi.fn(async () => ({
      snapshotRef: createBundleRef({
        hash: "a".repeat(64),
        key: "users/bundles/member-synthetic/vault/snapshot-after-import.bundle.json",
        size: 512,
      }),
    }));

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceSnapshotCheckpointRequestBuilder({
          createSnapshot,
          metadata: {
            attemptId: "attempt_synthetic_runner_snapshot",
            expectedWorkspaceVersion: "0",
            leaseGeneration: "5",
            nextWakeAt: null,
            nextWakeReason: null,
          },
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_snapshot",
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
      });

      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "1");
      assert.equal(result.latestWorkspace?.version, "0");
      assert.deepEqual(checkpointRequests, []);
      assert.equal(createSnapshot.mock.calls.length, 0);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("runtime wake preserves late conversation input through post-assistant cleanup", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_initial",
        laneSeq: "1",
      }),
    ];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({
      consumedSeqByLane: [{ consumedSeq: "0", lane: "conversation" }],
      fetchRequests,
      items,
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    let admissionCount = 0;
    const liveSteerInputs: Array<{
      prompt: string;
      relativeDateReferenceWindow: {
        earliestAt: string;
        latestAt: string;
      } | null;
      userMessageContent?: unknown;
    }> = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
    });
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_active_turn",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          events.push(`import:${item.item.laneSeq}`);
          if (item.item.laneSeq === "1") {
            return { status: "imported" };
          }
          const staged = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              `late same-conversation input ${item.item.laneSeq}`,
            ),
            vault: vaultRoot,
          });
          await enqueueHostedPendingAssistantInputId({
            inputId: staged.inputId,
            vaultRoot,
          });
          return {
            afterCheckpoint: item.item.laneSeq === "2"
              ? async () => {
                throw Object.assign(new Error("projection failed before active-turn notification"), {
                  code: "PROJECTION_UNAVAILABLE",
                });
              }
              : null,
            assistantInputId: staged.inputId,
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort,
        }),
        requestId: "request_synthetic_runner_active_turn",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_active_turn",
          leaseGeneration: "4",
          workspaceVersion: "0",
        },
        runtimeWakeSignal,
        async runAssistantPhase() {
          events.push("assistant:start");
          const inputSource = createStoreBackedAssistantInputSource({
            vault: vaultRoot,
          });
          const controller = createAssistantActiveTurnInputController({
            admissionHook: async (input) => {
              admissionCount += 1;
              const candidates = await inputSource.listNewConversationInputs({
                conversation: {
                  accountId: "acct_1",
                  actorId: "actor_1",
                  actorIsSelf: false,
                  source: "linq",
                  threadId: "thread_1",
                  threadIsDirect: true,
                },
                knownInputIds: input.knownInputIds,
                knownProjectionCaptureIds: input.knownProjectionCaptureIds,
                signal: input.signal,
              });
              if (candidates.inputs.length === 0) {
                return {
                  kind: "no-new-input",
                };
              }
              const text = candidates.inputs
                .map((candidate) => candidate.event.transcriptText ?? candidate.event.text)
                .filter((value): value is string => typeof value === "string")
                .join("\n\n");
              return {
                acceptedInputs: candidates.inputs.map((candidate) => candidate.acceptedInput),
                kind: "accepted",
                prompt: text,
                transcriptText: text,
                userMessageContent: candidates.inputs.flatMap(
                  (candidate) => candidate.event.userMessageContent ?? [],
                ),
              };
            },
            conversationKeys: ["channel:linq|identity:acct_1|audience:direct|thread:thread_1"],
            sessionId: "session-runner-active-turn",
            turnId: "turn-runner-active-turn",
            vault: vaultRoot,
          });
          const releaseLiveTurn = controller.registerLiveProviderTurn({
            interrupt: async () => undefined,
            codexThreadId: "codex-thread-runner-active-turn",
            providerTurnId: "provider-turn-runner-active-turn",
            sessionId: "session-runner-active-turn",
            steer: async (input) => {
              liveSteerInputs.push(input);
            },
            turnId: "turn-runner-active-turn",
          });
          items.push(createMailboxItem({
            createdAt: "2026-04-26T00:00:02.000Z",
            id: "mailbox_item_runner_late",
            laneSeq: "2",
            occurredAt: "2026-04-26T00:00:02.000Z",
          }));
          items.push(createMailboxItem({
            createdAt: "2026-04-26T00:00:03.000Z",
            id: "mailbox_item_runner_late_second",
            laneSeq: "3",
            occurredAt: "2026-04-26T00:00:03.000Z",
          }));
          try {
            runtimeWakeSignal.notify();
            runtimeWakeSignal.notify();
            await waitForCondition(() => importedSeqs.includes("3"));
            await waitForCondition(() => admissionCount === 1);
            await waitForCondition(() => liveSteerInputs.length === 1);
            return {
              afterCheckpoint: async () => ({
                checkpointReason: "provider_cleanup",
                nextWakeAt: "2026-04-26T00:05:00.000Z",
                nextWakeReason: "assistant",
              }),
              checkpointReason: "canonical_runtime_commit",
              nextWakeAt: "2026-04-25T23:59:59.000Z",
              nextWakeReason: "assistant",
              progressed: true,
            };
          } finally {
            releaseLiveTurn();
            controller.close();
          }
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(events, [
        "import:1",
        "assistant:start",
        "import:2",
        "import:3",
      ]);
      assert.deepEqual(importedSeqs, ["1", "2", "3"]);
      assert.equal(admissionCount, 1);
      assert.equal(liveSteerInputs.length, 1);
      const liveSteerInput = liveSteerInputs[0];
      assert.ok(liveSteerInput);
      assert.deepEqual(liveSteerInput.relativeDateReferenceWindow, {
        earliestAt: "2026-04-26T00:00:02.000Z",
        latestAt: "2026-04-26T00:00:03.000Z",
      });
      assert.deepEqual({
        prompt: liveSteerInput.prompt,
        userMessageContent: liveSteerInput.userMessageContent,
      }, {
        prompt: "late same-conversation input 2\n\nlate same-conversation input 3",
        userMessageContent: [
          {
            text: "late same-conversation input 2",
            type: "text",
          },
          {
            text: "late same-conversation input 3",
            type: "text",
          },
        ],
      });
      assert.equal(result.initialMailboxImport.state.watermarks.conversation, "1");
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "3");
      assert.equal(
        result.runtimeRedactedStatus?.["hostedMailboxConversationHandledThroughSeq"],
        undefined,
      );
      assert.equal(
        result.assistantPhaseResult?.nextWakeAt,
        TEST_PENDING_INDEX_MAINTENANCE_WAKE_AT,
      );
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "1", lane: "conversation" },
        ],
      ]);
      assert.deepEqual(
        logRequests.map((request) => request.entries[0]?.eventCode).slice(0, 2),
        ["mailbox.imported", "mailbox.imported"],
      );
      assert.deepEqual(logRequests[2]?.entries[0], {
        at: TEST_NOW,
        attemptId: "attempt_synthetic_runner_active_turn",
        component: "mailbox",
        eventCode: "mailbox.imported",
        leaseGeneration: "4",
        level: "info",
        mailboxLane: "conversation",
        mailboxSeqEnd: "3",
        mailboxSeqStart: "1",
        phase: "active_turn_input",
        redactedJson: {
          assistantInputCount: 2,
          assistantInputPresent: true,
          blockCodes: [],
          blockedCount: 0,
          checkpointDeferred: true,
          checkpointed: false,
          conversationImportedCount: 2,
          conversationSeqEnd: "3",
          conversationSeqStart: "1",
          fetchedCount: 2,
          importedCount: 2,
          laneCount: 1,
          retryableBlockedCount: 0,
          stateChanged: true,
          systemSeqEnd: "0",
          systemSeqStart: "0",
        },
        workspaceVersion: "0",
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("runtime wake attaches foreground wake timing to late mailbox imports", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_wake_timing_initial",
        laneSeq: "1",
      }),
    ];
    const importedSeqs: string[] = [];
    const { mailboxPort } = createMailboxPort({ items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const foregroundMilestones: {
      value: HostedRuntimeLatencyTraceStagedMilestones | null;
    } = {
      value: null,
    };

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_wake_timing",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item, context) {
          importedSeqs.push(item.item.laneSeq);
          if (item.item.laneSeq === "2") {
            foregroundMilestones.value = context?.latencyMilestones ?? null;
          }
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_wake_timing",
        runtimePassDiagnostics: {
          foreground: false,
          ordinal: 7,
          startedAtEpochMs: Date.now(),
        },
        runtimeWakeSignal,
        async runAssistantPhase() {
          items.push(createMailboxItem({
            id: "mailbox_item_runner_wake_timing_late",
            laneSeq: "2",
            occurredAt: "2026-04-26T00:00:02.000Z",
          }));
          runtimeWakeSignal.notify({
            orchestration: {
              activeWakeAccepted: true,
              activeWakeFinishedAtEpochMs: 1_777_000_001_005,
              activeWakeStartedAtEpochMs: 1_777_000_001_000,
              userRunnerEnsureStartedAtEpochMs: 1_777_000_000_995,
            },
          });
          await waitForCondition(() => importedSeqs.includes("2"));
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      const wake = foregroundMilestones.value?.phaseBreakdown?.wake;
      const orchestration = foregroundMilestones.value?.phaseBreakdown?.orchestration;
      assert.deepEqual(orchestration, {
        activeWakeAccepted: true,
        activeWakeFinishedAtEpochMs: 1_777_000_001_005,
        activeWakeStartedAtEpochMs: 1_777_000_001_000,
        userRunnerEnsureStartedAtEpochMs: 1_777_000_000_995,
      });
      assert.ok(wake);
      const runtimeWakeNotifiedAtEpochMs = wake.runtimeWakeNotifiedAtEpochMs;
      const foregroundWaitResolvedAtEpochMs = wake.foregroundWaitResolvedAtEpochMs;
      const foregroundImportStartedAtEpochMs = wake.foregroundImportStartedAtEpochMs;
      const activeRuntimePassStartedAtEpochMs = wake.activeRuntimePassStartedAtEpochMs;
      if (
        typeof runtimeWakeNotifiedAtEpochMs !== "number"
        || typeof foregroundWaitResolvedAtEpochMs !== "number"
        || typeof foregroundImportStartedAtEpochMs !== "number"
        || typeof activeRuntimePassStartedAtEpochMs !== "number"
      ) {
        throw new Error("Expected numeric foreground wake timing diagnostics.");
      }
      assert.ok(runtimeWakeNotifiedAtEpochMs <= foregroundWaitResolvedAtEpochMs);
      assert.ok(foregroundWaitResolvedAtEpochMs <= foregroundImportStartedAtEpochMs);
      assert.ok(activeRuntimePassStartedAtEpochMs <= foregroundWaitResolvedAtEpochMs);
      assert.equal(wake.foregroundWakeOrdinal, 1);
      assert.equal(wake.activeRuntimePassOrdinal, 7);
      assert.equal(wake.activeRuntimePassForeground, false);
      assert.deepEqual(importedSeqs, ["1", "2"]);
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "2");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("runtime wake interrupts background maintenance after late assistant input import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_yield_initial",
        laneSeq: "1",
      }),
    ];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const yieldStates: boolean[] = [];
    const backgroundDeviceSyncJobStarts: string[] = [];
    let assistantPhaseCompleted = false;

    try {
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_active_turn_yield",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          if (item.item.laneSeq === "1") {
            return { status: "imported" };
          }
          const staged = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              `late same-conversation input ${item.item.laneSeq}`,
            ),
            vault: vaultRoot,
          });
          await enqueueHostedPendingAssistantInputId({
            inputId: staged.inputId,
            vaultRoot,
          });
          return {
            assistantInputId: staged.inputId,
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_active_turn_yield",
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          backgroundDeviceSyncJobStarts.push("job-1");
          items.push(createMailboxItem({
            id: "mailbox_item_runner_yield_late",
            laneSeq: "2",
            occurredAt: "2026-04-26T00:00:02.000Z",
          }));
          runtimeWakeSignal.notify();
          await waitForCondition(() => importedSeqs.includes("2"));
          await waitForCondition(() =>
            input.shouldYieldBackgroundMaintenance?.() === true
          );
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          if (input.shouldYieldBackgroundMaintenance?.() !== true) {
            backgroundDeviceSyncJobStarts.push("job-2");
          }
          assistantPhaseCompleted = true;
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(importedSeqs, ["1", "2"]);
      assert.deepEqual(yieldStates, [false, true]);
      assert.deepEqual(backgroundDeviceSyncJobStarts, ["job-1"]);
      assert.equal(assistantPhaseCompleted, true);
      assert.equal(
        result.assistantPhaseResult?.nextWakeAt,
        TEST_PENDING_INDEX_MAINTENANCE_WAKE_AT,
      );
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "2");
      assert.equal(result.runtimeStateDirty, true);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "1", lane: "conversation" },
        ],
      ]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("foreground conversation staging flips background yield before projection completes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const lateOccurredAt = "2026-04-26T00:00:02.000Z";
    const lateWake: HostedExecutionConversationMessageWake = {
      ...createRunnerConversationWake(),
      eventId: "evt_synthetic_runner_staging_yield_late",
      occurredAt: lateOccurredAt,
    };
    if (lateWake.message.channel !== "linq") {
      throw new Error("Projection-stall fixture requires a Linq wake.");
    }
    lateWake.message.linqMessage.parts.push({
      attachmentId: "att_synthetic_runner_staging_yield_late",
      fileName: "projection-stall.pdf",
      mimeType: "application/pdf",
      size: 1,
      type: "media",
      url: "https://cdn.example.test/projection-stall.pdf",
    });
    const items: HostedMailboxItem[] = [];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const yieldStates: boolean[] = [];
    let projectionFinished = false;
    let releaseProjection = (): void => {};
    let projectionStarted = (): void => {};
    const projectionStartedPromise = new Promise<void>((resolve) => {
      projectionStarted = resolve;
    });
    const projectionReleasePromise = new Promise<void>((resolve) => {
      releaseProjection = resolve;
    });
    const conversationImportItem = createHostedConversationMailboxImportItem({
      decodePayload: {
        async decode() {
          return {
            status: "decoded",
            wake: lateWake,
          };
        },
      },
      async importConversationWake() {
        projectionStarted();
        await projectionReleasePromise;
        projectionFinished = true;
        return {
          captureId: null,
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext() {},
      runtime: createConversationRuntime(),
      vaultRoot,
    });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_staging_yield",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        foregroundImportItem: async (item, context) => {
          importedSeqs.push(item.item.laneSeq);
          return await conversationImportItem(item, context);
        },
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_staging_yield",
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          items.push(createMailboxItem({
            dedupeKey: lateWake.eventId,
            id: "mailbox_item_runner_staging_yield_late",
            laneSeq: "1",
            occurredAt: lateOccurredAt,
          }));
          runtimeWakeSignal.notify();
          await withTestTimeout(projectionStartedPromise, 1_000);
          assert.equal(projectionFinished, false);
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          releaseProjection();
          await waitForCondition(() => projectionFinished);
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(importedSeqs, ["1"]);
      assert.deepEqual(yieldStates, [false, true]);
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "1");
      assert.equal(result.runtimeStateDirty, true);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
    } finally {
      releaseProjection();
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("foreground stop preserves the mailbox watermark after aborting a staged projection", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const lateOccurredAt = "2026-04-26T00:00:02.000Z";
    const lateWake: HostedExecutionConversationMessageWake = {
      ...createRunnerConversationWake(),
      eventId: "evt_synthetic_runner_stop_aborts_projection",
      occurredAt: lateOccurredAt,
    };
    if (lateWake.message.channel !== "linq") {
      throw new Error("Projection-stall fixture requires a Linq wake.");
    }
    lateWake.message.linqMessage.parts.push({
      attachmentId: "att_synthetic_runner_stop_aborts_projection",
      fileName: "projection-stall.pdf",
      mimeType: "application/pdf",
      size: 1,
      type: "media",
      url: "https://cdn.example.test/projection-stall.pdf",
    });
    const items: HostedMailboxItem[] = [];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const yieldStates: boolean[] = [];
    let projectionAbortObserved = false;
    let projectionFinished = false;
    const projectionStall = {
      reject(_error: unknown): void {},
    };
    let projectionStarted = (): void => {};
    const projectionStartedPromise = new Promise<void>((resolve) => {
      projectionStarted = resolve;
    });
    const conversationImportItem = createHostedConversationMailboxImportItem({
      decodePayload: {
        async decode() {
          return {
            status: "decoded",
            wake: lateWake,
          };
        },
      },
      async importConversationWake({ signal }) {
        projectionStarted();
        await new Promise<never>((_, reject) => {
          projectionStall.reject = reject;
          const abort = () => {
            projectionAbortObserved = true;
            reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
          };
          if (signal?.aborted) {
            abort();
            return;
          }
          signal?.addEventListener("abort", abort, { once: true });
        });
        projectionFinished = true;
        return {
          captureId: null,
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext() {},
      runtime: createConversationRuntime(),
      vaultRoot,
    });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_stop_aborts_projection",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        foregroundImportItem: async (item, context) => {
          importedSeqs.push(item.item.laneSeq);
          return await conversationImportItem(item, context);
        },
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_stop_aborts_projection",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_stop_aborts_projection",
          leaseGeneration: "4",
          workspaceVersion: "0",
        },
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          items.push(createMailboxItem({
            dedupeKey: lateWake.eventId,
            id: "mailbox_item_runner_stop_aborts_projection",
            laneSeq: "1",
            occurredAt: lateOccurredAt,
          }));
          runtimeWakeSignal.notify();
          await projectionStartedPromise;
          assert.equal(projectionFinished, false);
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(importedSeqs, ["1"]);
      assert.deepEqual(yieldStates, [false, true]);
      assert.equal(projectionAbortObserved, true);
      assert.equal(projectionFinished, false);
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "1");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.deepEqual(fetchRequests[0]?.lanes, [
        { importedSeq: "0", lane: "conversation" },
      ]);
      assert.equal(
        logRequests.flatMap((request) => request.entries)
          .some((entry) => entry.errorCode === "foreground_mailbox_import_failed"),
        false,
      );
    } finally {
      projectionStall.reject(new DOMException("Test cleanup", "AbortError"));
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("foreground system lane import does not flip background yield", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items: HostedMailboxItem[] = [];
    const importedLanes: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const yieldStates: boolean[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_system_wake_no_yield",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedLanes.push(item.item.lane);
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_system_wake_no_yield",
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          items.push(createMailboxItem({
            id: "mailbox_item_runner_system_wake_no_yield",
            kind: "member.activated",
            lane: "system",
            laneSeq: "1",
          }));
          runtimeWakeSignal.notify();
          await waitForCondition(() => importedLanes.includes("system"));
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(importedLanes, ["system"]);
      assert.deepEqual(yieldStates, [false, false]);
      assert.equal(result.latestMailboxImport.state.watermarks.system, "1");
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("runtime wake interrupts post-checkpoint background maintenance after late assistant input import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_after_checkpoint_yield_initial",
        laneSeq: "1",
      }),
    ];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const yieldStates: boolean[] = [];

    try {
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_after_checkpoint_yield",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          if (item.item.laneSeq === "1") {
            return { status: "imported" };
          }
          const staged = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              `late post-checkpoint input ${item.item.laneSeq}`,
            ),
            vault: vaultRoot,
          });
          await enqueueHostedPendingAssistantInputId({
            inputId: staged.inputId,
            vaultRoot,
          });
          return {
            assistantInputId: staged.inputId,
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_after_checkpoint_yield",
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          assert.equal(input.backgroundMaintenanceSignal?.aborted, false);
          return {
            afterCheckpointKeepsForegroundImportLoop: true,
            afterCheckpoint: async () => {
              items.push(createMailboxItem({
                id: "mailbox_item_runner_after_checkpoint_yield_late",
                laneSeq: "2",
                occurredAt: "2026-04-26T00:00:02.000Z",
              }));
              runtimeWakeSignal.notify();
              await waitForCondition(() => importedSeqs.includes("2"));
              await waitForCondition(() =>
                input.shouldYieldBackgroundMaintenance?.() === true
              );
              assert.equal(input.backgroundMaintenanceSignal?.aborted, false);
              yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: TEST_NOW,
                nextWakeReason: "assistant",
                redactedStatus: {
                  hostedOutboxDeliveryYielded: 1,
                },
              };
            },
            checkpointReason: "outbox_sending",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(importedSeqs, ["1", "2"]);
      assert.deepEqual(yieldStates, [false, true]);
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "2");
      assert.equal(result.runtimeStateDirty, true);
      assert.equal(result.assistantPhaseResult?.nextWakeAt, TEST_NOW);
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "1", lane: "conversation" },
        ],
      ]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("generic runtime wake without mailbox work does not interrupt background maintenance", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_generic_runtime_wake_initial",
        laneSeq: "1",
      }),
    ];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const yieldStates: boolean[] = [];

    try {
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_generic_runtime_wake",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_generic_runtime_wake",
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          runtimeWakeSignal.notify();
          await waitForCondition(() => fetchRequests.length >= 2);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
          });
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(importedSeqs, ["1"]);
      assert.deepEqual(yieldStates, [false, false]);
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "1");
      assert.equal(result.runtimeStateDirty, true);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "1", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("earlier staged foreground input cannot abort the next item before it stages", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_yield_during_import_initial",
        laneSeq: "1",
      }),
    ];
    const importStartedSeqs: string[] = [];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const yieldStates: boolean[] = [];
    let heldImportSignal: AbortSignal | null = null;
    const readHeldImportSignal = (): AbortSignal | null => heldImportSignal;
    let releaseLateImport = (): void => {};
    let lateImportStarted = (): void => {};
    let assistantPhaseReturned = (): void => {};
    const lateImportStartedPromise = new Promise<void>((resolve) => {
      lateImportStarted = resolve;
    });
    const lateImportReleasePromise = new Promise<void>((resolve) => {
      releaseLateImport = resolve;
    });
    const assistantPhaseReturnedPromise = new Promise<void>((resolve) => {
      assistantPhaseReturned = resolve;
    });

    try {
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
      const runner = runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_active_turn_yield_during_import",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item, context) {
          importStartedSeqs.push(item.item.laneSeq);
          if (item.item.laneSeq === "1") {
            importedSeqs.push(item.item.laneSeq);
            return { status: "imported" };
          }

          if (item.item.laneSeq === "3") {
            heldImportSignal = context?.signal ?? null;
            lateImportStarted();
            await lateImportReleasePromise;
            context?.signal?.throwIfAborted();
          }
          const staged = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              `late same-conversation input ${item.item.laneSeq}`,
            ),
            vault: vaultRoot,
          });
          await enqueueHostedPendingAssistantInputId({
            inputId: staged.inputId,
            vaultRoot,
          });
          context?.onConversationInputStaged?.("linq");
          importedSeqs.push(item.item.laneSeq);
          return {
            assistantInputId: staged.inputId,
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_active_turn_yield_during_import",
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          items.push(createMailboxItem({
            id: "mailbox_item_runner_yield_during_import_first_late",
            laneSeq: "2",
            occurredAt: "2026-04-26T00:00:02.000Z",
          }));
          items.push(createMailboxItem({
            id: "mailbox_item_runner_yield_during_import_second_late",
            laneSeq: "3",
            occurredAt: "2026-04-26T00:00:03.000Z",
          }));
          runtimeWakeSignal.notify();
          await lateImportStartedPromise;
          assert.deepEqual(importedSeqs, ["1", "2"]);
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          if (input.shouldYieldBackgroundMaintenance?.() !== true) {
            throw new Error("Foreground yield must preempt lock-bound input staging.");
          }
          assert.equal(input.backgroundMaintenanceSignal?.aborted, false);
          assistantPhaseReturned();
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });
      let runnerSettled = false;
      void runner.then(
        () => {
          runnerSettled = true;
        },
        () => {
          runnerSettled = true;
        },
      );
      await assistantPhaseReturnedPromise;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      assert.equal(runnerSettled, false);
      assert.deepEqual(importedSeqs, ["1", "2"]);
      assert.equal(readHeldImportSignal()?.aborted, false);
      releaseLateImport();
      const result = await runner;

      assert.deepEqual(importStartedSeqs, ["1", "2", "3"]);
      assert.deepEqual(importedSeqs, ["1", "2", "3"]);
      assert.deepEqual(yieldStates, [false, true]);
      assert.equal(readHeldImportSignal()?.aborted, true);
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "3");
      assert.equal(
        result.assistantPhaseResult?.nextWakeAt,
        TEST_PENDING_INDEX_MAINTENANCE_WAKE_AT,
      );
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "1", lane: "conversation" },
        ],
      ]);
    } finally {
      releaseLateImport();
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("foreground import without staged work releases background maintenance yield", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_unstaged_wake_initial",
        laneSeq: "1",
      }),
    ];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const yieldStates: boolean[] = [];
    let releaseLateImport = (): void => {};
    let lateImportStarted = (): void => {};
    const lateImportStartedPromise = new Promise<void>((resolve) => {
      lateImportStarted = resolve;
    });
    const lateImportReleasePromise = new Promise<void>((resolve) => {
      releaseLateImport = resolve;
    });

    try {
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_unstaged_wake",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          if (item.item.laneSeq === "1") {
            return { status: "imported" };
          }
          lateImportStarted();
          await lateImportReleasePromise;
          return { status: "skipped" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_unstaged_wake",
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          items.push(createMailboxItem({
            id: "mailbox_item_runner_unstaged_wake_late",
            laneSeq: "2",
            occurredAt: "2026-04-26T00:00:02.000Z",
          }));
          runtimeWakeSignal.notify();
          await lateImportStartedPromise;
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          assert.equal(input.backgroundMaintenanceSignal?.aborted, false);
          releaseLateImport();
          await waitForCondition(() => importedSeqs.includes("2"));
          await waitForCondition(() =>
            input.shouldYieldBackgroundMaintenance?.() === false
          );
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(importedSeqs, ["1", "2"]);
      assert.deepEqual(yieldStates, [false, true, false]);
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "2");
      assert.equal(
        result.assistantPhaseResult?.nextWakeAt,
        TEST_PENDING_INDEX_MAINTENANCE_WAKE_AT,
      );
      assert.deepEqual(checkpointRequests.map((request) => request.reason), []);
    } finally {
      releaseLateImport();
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("late foreground input without an active turn schedules pending-index assistant wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_no_active_turn_initial",
        laneSeq: "1",
      }),
    ];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let stagedInputId: string | null = null;

    try {
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
      const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_no_active_turn_late_input",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          if (item.item.laneSeq === "1") {
            return { status: "imported" };
          }

          const staged = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              "late input without active turn",
            ),
            vault: vaultRoot,
          });
          await enqueueHostedPendingAssistantInputId({
            inputId: staged.inputId,
            vaultRoot,
          });
          stagedInputId = staged.inputId;
          return {
            assistantInputId: staged.inputId,
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_no_active_turn_late_input",
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          items.push(createMailboxItem({
            id: "mailbox_item_runner_no_active_turn_late",
            laneSeq: "2",
            occurredAt: "2026-04-26T00:00:02.000Z",
          }));
          runtimeWakeSignal.notify();
          await waitForCondition(() => importedSeqs.includes("2"));
          await waitForCondition(() =>
            input.shouldYieldBackgroundMaintenance?.() === true
          );
          return {
            progressed: false,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(importedSeqs, ["1", "2"]);
      assert.equal(result.assistantPhaseResult?.progressed, false);
      assert.equal(
        result.assistantPhaseResult?.nextWakeAt,
        TEST_PENDING_INDEX_MAINTENANCE_WAKE_AT,
      );
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "2");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.equal(
        await hasPendingAssistantAutoReplyInput({
          inputSource: createStoreBackedAssistantInputSource({
            vault: vaultRoot,
          }),
          state: {
            autoReply: [{
              channel: "linq",
              eligibleAfter: null,
              enabledAt: TEST_NOW,
            }],
          },
          vault: vaultRoot,
        }),
        true,
      );
      const listed = await createStoreBackedAssistantInputSource({
        vault: vaultRoot,
      }).listInputCandidates({
        limit: 1,
        sourceId: "linq",
      });
      assert.equal(listed.inputs[0]?.event.inputId, stagedInputId);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "1", lane: "conversation" },
        ],
      ]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("resolves the latest reply target by canonical mailbox order when provider time goes backward", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    try {
      const older = await stageHostedUsageNoticeAssistantInput({
        itemId: "mailbox_item_usage_notice_same_group_older",
        laneSeq: "41",
        messageId: "linq_message_older",
        occurredAt: "2026-04-26T00:00:02.000Z",
        threadId: "linq_thread_same_group",
        vaultRoot,
      });
      const fresh = await stageHostedUsageNoticeAssistantInput({
        itemId: "mailbox_item_usage_notice_same_group_fresh",
        laneSeq: "42",
        messageId: "linq_message_fresh",
        occurredAt: "2026-04-26T00:00:01.000Z",
        threadId: "linq_thread_same_group",
        vaultRoot,
      });

      assert.deepEqual(
        await resolveHostedUsageNoticeDeliveryTargetFromAcceptedInputs({
          inputIds: [fresh.inputId, older.inputId],
          memberId: TEST_USER_ID,
          vaultRoot,
        }),
        {
          channel: "linq",
          replyToMessageId: "linq_message_fresh",
          routeAuthority: {
            channel: "linq",
            containerMemberId: TEST_USER_ID,
            threadId: "linq_thread_same_group",
          },
          target: "linq_thread_same_group",
        },
      );
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("resolves a background-only accepted group input from durable state", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    try {
      const backgroundInput = await stageHostedUsageNoticeAssistantInput({
        itemId: "mailbox_item_usage_notice_background_only",
        messageId: "linq_message_background_only",
        occurredAt: "2026-04-25T23:59:00.000Z",
        threadId: "linq_thread_background_only",
        vaultRoot,
      });

      assert.deepEqual(
        await resolveHostedUsageNoticeDeliveryTargetFromAcceptedInputs({
          inputIds: [backgroundInput.inputId],
          memberId: TEST_USER_ID,
          vaultRoot,
        }),
        {
          channel: "linq",
          replyToMessageId: "linq_message_background_only",
          routeAuthority: {
            channel: "linq",
            containerMemberId: TEST_USER_ID,
            threadId: "linq_thread_background_only",
          },
          target: "linq_thread_background_only",
        },
      );
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("resolves the latest reply target for a direct Linq conversation", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    try {
      const older = await stageHostedUsageNoticeAssistantInput({
        externalThreadRouteAuthorityPresent: false,
        itemId: "mailbox_item_usage_notice_direct_older",
        laneSeq: "41",
        messageId: "linq_message_direct_older",
        occurredAt: "2026-04-26T00:00:01.000Z",
        threadId: "linq_thread_direct",
        threadIsDirect: true,
        vaultRoot,
      });
      const fresh = await stageHostedUsageNoticeAssistantInput({
        externalThreadRouteAuthorityPresent: false,
        itemId: "mailbox_item_usage_notice_direct_fresh",
        laneSeq: "42",
        messageId: "linq_message_direct_fresh",
        occurredAt: "2026-04-26T00:00:02.000Z",
        threadId: "linq_thread_direct",
        threadIsDirect: true,
        vaultRoot,
      });

      assert.deepEqual(
        await resolveHostedUsageNoticeDeliveryTargetFromAcceptedInputs({
          inputIds: [older.inputId, fresh.inputId],
          memberId: TEST_USER_ID,
          vaultRoot,
        }),
        {
          channel: "linq",
          replyToMessageId: "linq_message_direct_fresh",
          routeAuthority: null,
          target: "linq_thread_direct",
        },
      );
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("resolves the latest reply target for a Telegram conversation", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    try {
      const older = await stageHostedUsageNoticeAssistantInput({
        channel: "telegram",
        itemId: "mailbox_item_usage_notice_telegram_older",
        laneSeq: "41",
        messageId: "telegram_message_older",
        occurredAt: "2026-04-26T00:00:01.000Z",
        threadId: "telegram_thread",
        threadIsDirect: true,
        vaultRoot,
      });
      const fresh = await stageHostedUsageNoticeAssistantInput({
        channel: "telegram",
        itemId: "mailbox_item_usage_notice_telegram_fresh",
        laneSeq: "42",
        messageId: "telegram_message_fresh",
        occurredAt: "2026-04-26T00:00:02.000Z",
        threadId: "telegram_thread",
        threadIsDirect: true,
        vaultRoot,
      });

      assert.deepEqual(
        await resolveHostedUsageNoticeDeliveryTargetFromAcceptedInputs({
          inputIds: [fresh.inputId, older.inputId],
          memberId: TEST_USER_ID,
          vaultRoot,
        }),
        {
          channel: "telegram",
          replyToMessageId: "telegram_message_fresh",
          target: "telegram_thread",
        },
      );
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("preserves home fallback only without accepted input provenance", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    try {
      assert.equal(
        await resolveHostedUsageNoticeDeliveryTargetFromAcceptedInputs({
          inputIds: [],
          memberId: TEST_USER_ID,
          vaultRoot,
        }),
        undefined,
      );

      const unsupportedInput = await stageHostedUsageNoticeAssistantInput({
        channel: "email",
        itemId: "mailbox_item_usage_notice_email",
        messageId: "email_message_usage_notice",
        occurredAt: "2026-04-26T00:00:01.000Z",
        threadId: "email_thread_usage_notice",
        threadIsDirect: true,
        vaultRoot,
      });
      assert.equal(
        await resolveHostedUsageNoticeDeliveryTargetFromAcceptedInputs({
          inputIds: [unsupportedInput.inputId],
          memberId: TEST_USER_ID,
          vaultRoot,
        }),
        null,
      );
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("fails closed for mixed, different, missing, and invalid group input routes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    try {
      const groupA = await stageHostedUsageNoticeAssistantInput({
        itemId: "mailbox_item_usage_notice_group_a",
        messageId: "linq_message_group_a",
        occurredAt: "2026-04-26T00:00:01.000Z",
        threadId: "linq_thread_a",
        vaultRoot,
      });
      const groupB = await stageHostedUsageNoticeAssistantInput({
        itemId: "mailbox_item_usage_notice_group_b",
        messageId: "linq_message_group_b",
        occurredAt: "2026-04-26T00:00:02.000Z",
        threadId: "linq_thread_b",
        vaultRoot,
      });
      const direct = await stageHostedUsageNoticeAssistantInput({
        externalThreadRouteAuthorityPresent: false,
        itemId: "mailbox_item_usage_notice_mixed_direct",
        messageId: "linq_message_mixed_direct",
        occurredAt: "2026-04-26T00:00:03.000Z",
        threadId: "linq_thread_direct",
        threadIsDirect: true,
        vaultRoot,
      });
      const invalidGroup = await stageHostedUsageNoticeAssistantInput({
        externalThreadRouteAuthorityPresent: false,
        itemId: "mailbox_item_usage_notice_invalid_group",
        messageId: "linq_message_invalid_group",
        occurredAt: "2026-04-26T00:00:04.000Z",
        threadId: "linq_thread_invalid",
        vaultRoot,
      });

      for (const inputIds of [
        [groupA.inputId, direct.inputId],
        [groupA.inputId, groupB.inputId],
        [groupA.inputId, "assistant_input_missing"],
        [invalidGroup.inputId],
      ]) {
        assert.equal(
          await resolveHostedUsageNoticeDeliveryTargetFromAcceptedInputs({
            inputIds,
            memberId: TEST_USER_ID,
            vaultRoot,
          }),
          null,
        );
      }
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("fails closed when an accepted input event cannot be read", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    try {
      const readable = await stageHostedUsageNoticeAssistantInput({
        itemId: "mailbox_item_usage_notice_readable",
        messageId: "linq_message_readable",
        occurredAt: "2026-04-26T00:00:01.000Z",
        threadId: "linq_thread_read_failure",
        vaultRoot,
      });
      const unreadable = await stageHostedUsageNoticeAssistantInput({
        itemId: "mailbox_item_usage_notice_unreadable",
        messageId: "linq_message_unreadable",
        occurredAt: "2026-04-26T00:00:02.000Z",
        threadId: "linq_thread_read_failure",
        vaultRoot,
      });
      await writeFile(
        path.join(
          resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
          "input-events",
          `${unreadable.inputId}.json`,
        ),
        "{invalid-json",
        "utf8",
      );

      assert.equal(
        await resolveHostedUsageNoticeDeliveryTargetFromAcceptedInputs({
          inputIds: [readable.inputId, unreadable.inputId],
          memberId: TEST_USER_ID,
          vaultRoot,
        }),
        null,
      );
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  test("does not block normal post-checkpoint delivery on deferred usage flushing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const events: string[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    let releaseUsageFlush!: () => void;
    const usageFlushGate = new Promise<void>((resolve) => {
      releaseUsageFlush = resolve;
    });
    let resolveUsageFlushDone!: () => void;
    const usageFlushDone = new Promise<void>((resolve) => {
      resolveUsageFlushDone = resolve;
    });
    let resultPromise: ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget> | null = null;
    let resultResolved = false;
    let flushSawPostAssistantCheckpointLog = false;
    const usageRecordPort: HostedRuntimeUsageRecordPort = {
      async recordUsage(record, noticeDeliveryTarget) {
        flushSawPostAssistantCheckpointLog = logRequests
          .flatMap((request) => request.entries)
          .some((entry) =>
            entry.eventCode === "checkpoint.runtime_residue_deferred"
            && entry.redactedJson?.checkpointPhase === "post_assistant"
          );
        events.push("usage:flush:start");
        assert.equal(record.usageId, "turn_runner_usage.attempt-1");
        assert.deepEqual(noticeDeliveryTarget, {
          channel: "linq",
          replyToMessageId: "linq_message_123",
          routeAuthority: {
            channel: "linq",
            containerMemberId: TEST_USER_ID,
            threadId: "linq_thread_123",
          },
          target: "linq_thread_123",
        });
        await usageFlushGate;
        events.push("usage:flush:done");
        resolveUsageFlushDone();
        return {
          recorded: true,
          usageId: record.usageId,
        };
      },
    };

    try {
      const acceptedInput = await stageHostedUsageNoticeAssistantInput({
        itemId: "mailbox_item_runner_usage_flush_delivery_order",
        messageId: "linq_message_123",
        occurredAt: "2026-04-26T00:00:01.000Z",
        threadId: "linq_thread_123",
        vaultRoot,
      });
      resultPromise = runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_usage_flush_delivery_order",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("No mailbox import expected.");
        },
        initialMailboxImport: createCheckpointedMailboxImportResult(),
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          usageRecordPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_usage_flush_delivery_order",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_usage_flush_delivery_order",
          leaseGeneration: "1",
          workspaceVersion: "0",
        },
        async runAssistantPhase(input) {
          input.recordDeferredUsage?.(
            createAssistantUsageRecord(),
            [acceptedInput.inputId],
          );
          return {
            afterCheckpoint: async () => {
              events.push("reply:deliver");
              return {
                checkpointReason: "outbox_receipt",
              };
            },
            checkpointReason: "assistant_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });
      void resultPromise.then(() => {
        resultResolved = true;
      });

      await waitUntil(() => {
        assert.equal(events.includes("usage:flush:start"), true);
      });
      assert.deepEqual(events, ["reply:deliver", "usage:flush:start"]);
      assert.equal(flushSawPostAssistantCheckpointLog, true);

      const result = await withTestTimeout(resultPromise, 1_000);

      assert.equal(result.assistantPhaseResult?.progressed, true);
      assert.equal(resultResolved, true);
      assert.deepEqual(events, [
        "reply:deliver",
        "usage:flush:start",
      ]);

      releaseUsageFlush();
      await withTestTimeout(usageFlushDone, 1_000);
      assert.deepEqual(events, [
        "reply:deliver",
        "usage:flush:start",
        "usage:flush:done",
      ]);
    } finally {
      releaseUsageFlush?.();
      if (resultPromise) {
        await resultPromise.catch(() => undefined);
      }
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not block no-progress assistant phases on deferred usage flushing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const events: string[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let releaseUsageFlush!: () => void;
    const usageFlushGate = new Promise<void>((resolve) => {
      releaseUsageFlush = resolve;
    });
    let resolveUsageFlushDone!: () => void;
    const usageFlushDone = new Promise<void>((resolve) => {
      resolveUsageFlushDone = resolve;
    });
    let resultPromise: ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget> | null = null;
    const usageRecordPort: HostedRuntimeUsageRecordPort = {
      async recordUsage(record, noticeDeliveryTarget) {
        events.push("usage:flush:start");
        assert.equal(record.usageId, "turn_runner_no_progress_usage.attempt-1");
        assert.equal(noticeDeliveryTarget, undefined);
        await usageFlushGate;
        events.push("usage:flush:done");
        resolveUsageFlushDone();
        return {
          recorded: true,
          usageId: record.usageId,
        };
      },
    };

    try {
      resultPromise = runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_no_progress_usage",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("No mailbox import expected.");
        },
        initialMailboxImport: createCheckpointedMailboxImportResult(),
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          usageRecordPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_no_progress_usage",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_no_progress_usage",
          leaseGeneration: "1",
          workspaceVersion: "0",
        },
        async runAssistantPhase(input) {
          events.push("assistant");
          input.recordDeferredUsage?.(createAssistantUsageRecord({
            usageId: "turn_runner_no_progress_usage.attempt-1",
          }));
          return {
            progressed: false,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      await waitUntil(() => {
        assert.equal(events.includes("usage:flush:start"), true);
      });

      const result = await withTestTimeout(resultPromise, 1_000);

      assert.equal(result.assistantPhaseResult?.progressed, false);
      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(events, [
        "assistant",
        "usage:flush:start",
      ]);

      releaseUsageFlush();
      await withTestTimeout(usageFlushDone, 1_000);
      assert.deepEqual(events, [
        "assistant",
        "usage:flush:start",
        "usage:flush:done",
      ]);
    } finally {
      releaseUsageFlush?.();
      if (resultPromise) {
        await resultPromise.catch(() => undefined);
      }
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("flushes deferred assistant usage in recorder order", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const events: string[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let releaseFirstUsageFlush: () => void = () => undefined;
    const firstUsageFlushGate = new Promise<void>((resolve) => {
      releaseFirstUsageFlush = resolve;
    });
    let resultPromise: ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget> | null = null;
    const deferredTargets: Array<unknown> = [];
    const usageRecordPort: HostedRuntimeUsageRecordPort = {
      async recordUsage(record, noticeDeliveryTarget) {
        deferredTargets.push(noticeDeliveryTarget);
        events.push(`usage:${record.usageId}:start`);
        if (record.usageId === "turn_runner_usage.first") {
          await firstUsageFlushGate;
        }
        events.push(`usage:${record.usageId}:done`);
        return {
          recorded: true,
          usageId: record.usageId,
        };
      },
    };

    try {
      resultPromise = runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_parallel_usage_flush",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("No mailbox import expected.");
        },
        initialMailboxImport: createCheckpointedMailboxImportResult(),
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          usageRecordPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_parallel_usage_flush",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_parallel_usage_flush",
          leaseGeneration: "1",
          workspaceVersion: "0",
        },
        async runAssistantPhase(input) {
          events.push("assistant");
          input.recordDeferredUsage?.(createAssistantUsageRecord({
            usageId: "turn_runner_usage.first",
          }), ["assistant_input_missing"]);
          input.recordDeferredUsage?.(createAssistantUsageRecord({
            usageId: "turn_runner_usage.second",
          }));
          return {
            progressed: false,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      await waitUntil(() => {
        assert.equal(events.includes("usage:turn_runner_usage.first:start"), true);
      });
      assert.deepEqual(events, [
        "assistant",
        "usage:turn_runner_usage.first:start",
      ]);
      assert.equal(events.includes("usage:turn_runner_usage.second:start"), false);
      assert.equal(events.includes("usage:turn_runner_usage.first:done"), false);

      const result = await withTestTimeout(resultPromise, 1_000);

      assert.equal(result.assistantPhaseResult?.progressed, false);

      releaseFirstUsageFlush();
      await waitUntil(() => {
        assert.equal(events.includes("usage:turn_runner_usage.second:done"), true);
      });
      assert.deepEqual(events, [
        "assistant",
        "usage:turn_runner_usage.first:start",
        "usage:turn_runner_usage.first:done",
        "usage:turn_runner_usage.second:start",
        "usage:turn_runner_usage.second:done",
      ]);
      assert.deepEqual(deferredTargets, [null, undefined]);
    } finally {
      releaseFirstUsageFlush();
      if (resultPromise) {
        await resultPromise.catch(() => undefined);
      }
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("flushes deferred assistant usage when late foreground pending-input wake fails", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_usage_flush_initial",
        laneSeq: "1",
      }),
    ];
    const events: string[] = [];
    const importedSeqs: string[] = [];
    const { mailboxPort } = createMailboxPort({ items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let flushSawAssistantCheckpointLog = false;
    const usageRecordPort: HostedRuntimeUsageRecordPort = {
      async recordUsage(record) {
        flushSawAssistantCheckpointLog = logRequests
          .flatMap((request) => request.entries)
          .some((entry) =>
            entry.eventCode === "checkpoint.runtime_residue_deferred"
            && entry.redactedJson?.checkpointPhase === "assistant"
          );
        events.push("usage:flush");
        assert.equal(record.usageId, "turn_runner_usage.attempt-1");
        return {
          recorded: true,
          usageId: record.usageId,
        };
      },
    };

    try {
      await assert.rejects(
        runHostedWorkspaceUntilIdleOrBudget({
          checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
            attemptId: "attempt_synthetic_runner_usage_flush_pending_input_failure",
            expectedWorkspaceVersion: "0",
            leaseGeneration: "1",
            nextWakeAt: null,
            nextWakeReason: null,
            snapshotRef: null,
          }),
          expectedUserId: TEST_USER_ID,
          async importItem(item) {
            importedSeqs.push(item.item.laneSeq);
            events.push(`import:${item.item.laneSeq}`);
            if (item.item.laneSeq === "1") {
              return { status: "imported" };
            }

            const staged = await upsertAssistantInputEvent({
              event: createStoredAssistantInputEventForMailboxItem(
                item.item,
                "late pending input with corrupt index",
              ),
              vault: vaultRoot,
            });
            await enqueueHostedPendingAssistantInputId({
              inputId: staged.inputId,
              vaultRoot,
            });
            await writeFile(
              resolveHostedPendingAssistantInputStatePath(vaultRoot),
              "{",
              "utf8",
            );
            return {
              assistantInputId: staged.inputId,
              status: "imported",
            };
          },
          limitPerLane: 10,
          platform: createPlatform({
            logRequests,
            mailboxPort,
            usageRecordPort,
            workspacePort: createWorkspacePort({ checkpointRequests }),
          }),
          requestId: "request_synthetic_runner_usage_flush_pending_input_failure",
          runtimeLogContext: {
            attemptId: "attempt_synthetic_runner_usage_flush_pending_input_failure",
            leaseGeneration: "1",
            workspaceVersion: "0",
          },
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            events.push("assistant");
            input.recordDeferredUsage?.(createAssistantUsageRecord());
            items.push(createMailboxItem({
              id: "mailbox_item_runner_usage_flush_late",
              laneSeq: "2",
              occurredAt: "2026-04-26T00:00:02.000Z",
            }));
            runtimeWakeSignal.notify();
            await waitForCondition(() => importedSeqs.includes("2"));
            await waitForCondition(() =>
              input.shouldYieldBackgroundMaintenance?.() === true
            );
            return {
              afterCheckpoint: async () => {
                events.push("assistant:afterCheckpoint");
                return null;
              },
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
          workspace: createWorkspaceState({ version: "0" }),
          now: () => TEST_NOW,
        }),
      );

      assert.deepEqual(importedSeqs, ["1", "2"]);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(events.filter((event) => event === "usage:flush").length, 1);
      assert.equal(events.includes("assistant:afterCheckpoint"), false);
      assert.equal(flushSawAssistantCheckpointLog, true);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("preserves inbox-not-initialized retry backoff over pending input wake synthesis", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const retryAt = "2026-04-26T00:00:30.000Z";

    try {
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
      const pending = await upsertAssistantInputEvent({
        event: createStoredAssistantInputEventForMailboxItem(
          createMailboxItem({
            id: "mailbox_item_runner_inbox_retry_pending",
            laneSeq: "1",
          }),
          "pending input during inbox retry",
        ),
        vault: vaultRoot,
      });
      await enqueueHostedPendingAssistantInputId({
        inputId: pending.inputId,
        vaultRoot,
      });

      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_inbox_retry_backoff",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Import should not run without mailbox items.");
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_inbox_retry_backoff",
        async runAssistantPhase() {
          return {
            checkpointReason: "canonical_runtime_commit",
            nextWakeAt: retryAt,
            nextWakeReason: "assistant",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.equal(result.assistantPhaseResult?.nextWakeAt, retryAt);
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("schedules maintenance for an incomplete pending index without foreground backfill", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_initial_fresh_with_old_pending",
        laneSeq: "1",
      }),
    ];
    const { mailboxPort } = createMailboxPort({ items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const reminderWakeAt = "2026-04-26T06:00:00.000Z";

    try {
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
      await ensureHostedPendingAssistantInputIndex({ vaultRoot });
      await upsertAssistantInputEvent({
        event: createStoredAssistantInputEventForMailboxItem(
          createMailboxItem({
            id: "mailbox_item_runner_old_unindexed_pending",
            laneSeq: "99",
            occurredAt: "2026-04-26T00:00:01.000Z",
          }),
          "older unindexed pending input",
        ),
        vault: vaultRoot,
      });

      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_initial_fresh_incomplete_pending",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: reminderWakeAt,
          nextWakeReason: "assistant",
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          const staged = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              "initial fresh input",
            ),
            vault: vaultRoot,
          });
          return {
            assistantInputId: staged.inputId,
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_initial_fresh_incomplete_pending",
        async runAssistantPhase() {
          return {
            checkpointReason: "canonical_runtime_commit",
            foregroundReplyFailed: 0,
            nextWakeAt: reminderWakeAt,
            nextWakeReason: "assistant",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({
          nextWakeAt: reminderWakeAt,
          nextWakeReason: "assistant",
          version: "0",
        }),
        now: () => TEST_NOW,
      });

      assert.equal(
        result.assistantPhaseResult?.nextWakeAt,
        TEST_PENDING_INDEX_MAINTENANCE_WAKE_AT,
      );
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.equal(
        result.assistantPhaseResult?.invocationLocalAssistantWakeAt,
        TEST_PENDING_INDEX_MAINTENANCE_WAKE_AT,
      );
      assert.equal(result.runtimeStateDirty, true);
      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(
        await readExistingHostedPendingAssistantInputIds({ vaultRoot }),
        [],
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("runtime wake interrupts background maintenance after late conversation import is blocked", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items: HostedMailboxItem[] = [];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const yieldStates: boolean[] = [];
    const backgroundDeviceSyncJobStarts: string[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_active_turn_blocked_yield",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          return {
            reasonCode: "synthetic.retryable-block",
            retryable: true,
            status: "blocked",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_active_turn_blocked_yield",
        runtimeWakeSignal,
        async runAssistantPhase(input) {
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          backgroundDeviceSyncJobStarts.push("job-1");
          items.push(createMailboxItem({
            id: "mailbox_item_runner_yield_late_blocked",
            laneSeq: "1",
            occurredAt: "2026-04-26T00:00:02.000Z",
          }));
          runtimeWakeSignal.notify();
          await waitForCondition(() => importedSeqs.includes("1"));
          yieldStates.push(input.shouldYieldBackgroundMaintenance?.() ?? false);
          if (input.shouldYieldBackgroundMaintenance?.() !== true) {
            backgroundDeviceSyncJobStarts.push("job-2");
          }
          return { progressed: false };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual({
        backgroundDeviceSyncJobStarts,
        importedSeqs,
        yieldStates,
      }, {
        backgroundDeviceSyncJobStarts: ["job-1"],
        importedSeqs: ["1"],
        yieldStates: [false, true],
      });
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "0");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "0", lane: "conversation" },
        ],
      ]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("runtime wake notifies staged input when a later mailbox item blocks", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_initial_before_block",
        laneSeq: "1",
      }),
    ];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let admissionCount = 0;
    const logRequests: HostedRuntimeLogRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_active_turn_blocked_later",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          if (item.item.laneSeq === "1") {
            return { status: "imported" };
          }
          if (item.item.laneSeq === "3") {
            return {
              reasonCode: "synthetic.retryable-block",
              retryable: true,
              status: "blocked",
            };
          }

          const staged = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              `late same-conversation input ${item.item.laneSeq}`,
            ),
            vault: vaultRoot,
          });
          await enqueueHostedPendingAssistantInputId({
            inputId: staged.inputId,
            vaultRoot,
          });
          return {
            assistantInputId: staged.inputId,
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_active_turn_blocked_later",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_active_turn_blocked_later",
          leaseGeneration: "4",
          workspaceVersion: "0",
        },
        runtimeWakeSignal,
        async runAssistantPhase() {
          const controller = createAssistantActiveTurnInputController({
            admissionHook: async () => {
              admissionCount += 1;
              return {
                kind: "no-new-input",
              };
            },
            conversationKeys: ["channel:linq|identity:acct_1|audience:direct|thread:thread_1"],
            sessionId: "session-runner-active-turn-blocked-later",
            turnId: "turn-runner-active-turn-blocked-later",
            vault: vaultRoot,
          });
          items.push(createMailboxItem({
            id: "mailbox_item_runner_late_before_block",
            laneSeq: "2",
            occurredAt: "2026-04-26T00:00:02.000Z",
          }));
          items.push(createMailboxItem({
            id: "mailbox_item_runner_late_blocked",
            laneSeq: "3",
            occurredAt: "2026-04-26T00:00:03.000Z",
          }));
          try {
            runtimeWakeSignal.notify();
            await waitForCondition(() => importedSeqs.includes("3"));
            await waitForCondition(() => admissionCount === 1);
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          } finally {
            controller.close();
          }
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(importedSeqs, ["1", "2", "3"]);
      assert.equal(admissionCount, 1);
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "2");
      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
        [
          { importedSeq: "1", lane: "conversation" },
        ],
      ]);
      assert.deepEqual(logRequests[2]?.entries[0]?.redactedJson, {
        assistantInputCount: 1,
        assistantInputPresent: true,
        blockCodes: ["synthetic.retryable-block"],
        blockedCount: 1,
        checkpointDeferred: true,
        checkpointed: false,
        conversationImportedCount: 1,
        conversationSeqEnd: "2",
        conversationSeqStart: "1",
        fetchedCount: 2,
        importedCount: 1,
        laneCount: 1,
        retryableBlockedCount: 1,
        stateChanged: true,
        systemSeqEnd: "0",
        systemSeqStart: "0",
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("aborts without a later workspace checkpoint when active-turn admission checkpoint is rejected", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_abort_initial",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await assert.rejects(
        runHostedWorkspaceUntilIdleOrBudget({
          checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
            attemptId: "attempt_synthetic_runner_rejected_admission",
            expectedWorkspaceVersion: "0",
            leaseGeneration: "5",
            nextWakeAt: null,
            nextWakeReason: null,
            snapshotRef: null,
          }),
          expectedUserId: TEST_USER_ID,
          async importItem() {
            return { status: "imported" };
          },
          limitPerLane: 10,
          platform: createPlatform({
            mailboxPort,
            workspacePort: createWorkspacePort({ checkpointRequests }),
          }),
          requestId: "request_synthetic_runner_rejected_admission",
          async runAssistantPhase() {
            throw new AssistantActiveTurnInputCheckpointRejectedError(
              "Active turn input checkpoint was rejected; retry from durable state.",
            );
          },
          vaultRoot,
          workspace: createWorkspaceState({ version: "0" }),
          now: () => TEST_NOW,
        }),
        AssistantActiveTurnInputCheckpointRejectedError,
      );

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("can stop after mailbox import when no later assistant phase is provided", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_idle",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Import should not run without mailbox items.");
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_idle",
        vaultRoot,
        workspace: null,
      });

      assert.equal(result.assistantPhaseResult, null);
      assert.equal(result.initialMailboxImport.stateChanged, false);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("runs mailbox post-checkpoint effects without foreground checkpointing when no assistant phase runs", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const events: string[] = [];
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_projection_no_assistant",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_projection_no_assistant",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
          return {
            afterCheckpoint: async () => {
              events.push("mailbox:afterCheckpoint");
              return createInboxProjectionEffectResult();
            },
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_projection_no_assistant",
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.deepEqual(events, [
        "import:1",
        "mailbox:afterCheckpoint",
      ]);
      assert.equal(result.assistantPhaseResult, null);
      assert.equal(result.latestWorkspace, null);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("awaits and logs mailbox post-checkpoint effects without an assistant phase", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const events: string[] = [];
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_projection_no_assistant_blocking",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    let releaseEffect!: () => void;
    let effectEntered = false;
    const effectGate = new Promise<void>((resolve) => {
      releaseEffect = () => resolve();
    });
    let resultPromise: Promise<Awaited<ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget>>> | null = null;

    try {
      resultPromise = runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_projection_no_assistant_blocking",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "0",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
          return {
            afterCheckpoint: async () => {
              effectEntered = true;
              events.push("mailbox:afterCheckpoint:start");
              await effectGate;
              events.push("mailbox:afterCheckpoint:done");
              return createInboxProjectionEffectResult();
            },
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_projection_no_assistant_blocking",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_projection_no_assistant_blocking",
          leaseGeneration: "0",
          workspaceVersion: "0",
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      let resolved = false;
      void resultPromise.then(() => {
        resolved = true;
      });
      await withTestTimeout(
        new Promise<void>((resolve) => {
          const poll = () => {
            if (effectEntered) {
              resolve();
              return;
            }
            setTimeout(poll, 0);
          };
          poll();
        }),
      );
      assert.equal(effectEntered, true);
      assert.equal(events[0], "import:1");
      assert.equal(events[1], "mailbox:afterCheckpoint:start");
      assert.equal(resolved, false);

      releaseEffect();
      const result = await resultPromise;

      assert.deepEqual(events, [
        "import:1",
        "mailbox:afterCheckpoint:start",
        "mailbox:afterCheckpoint:done",
      ]);
      assert.equal(result.assistantPhaseResult, null);
      assert.equal(result.latestWorkspace, null);
      assert.deepEqual(checkpointRequests, []);
      const effectLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "mailbox.post_checkpoint_effects_finished");
      assert.ok(effectLog);
      assert.equal(effectLog?.level, "info");
      assert.deepEqual(effectLog?.redactedJson, {
        attemptedCount: 1,
        effectAttachmentEvidenceUpdated: [null],
        effectKinds: ["inbox_projection"],
        effectProjectionUpdated: [true],
        effectReasonCodes: [null],
        effectStatuses: ["succeeded"],
        errorCodes: [],
        failedCount: 0,
        partialCount: 0,
        succeededCount: 1,
      });
    } finally {
      releaseEffect();
      if (resultPromise) {
        await resultPromise.catch(() => undefined);
      }
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("times out import-phase mailbox post-checkpoint effects without hanging runner completion", async () => {
    vi.useFakeTimers();
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const events: string[] = [];
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_projection_import_timeout",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    let markEffectEntered!: () => void;
    const effectEntered = new Promise<void>((resolve) => {
      markEffectEntered = resolve;
    });
    const unresolvedEffect = new Promise<HostedMailboxPostCheckpointEffectResult>(() => {});

    try {
      const resultPromise = runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_projection_import_timeout",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
          return {
            afterCheckpoint: async () => {
              events.push("mailbox:afterCheckpoint:start");
              markEffectEntered();
              return await unresolvedEffect;
            },
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_projection_import_timeout",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_projection_import_timeout",
          leaseGeneration: "1",
          workspaceVersion: "0",
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      await effectEntered;
      assert.deepEqual(events, [
        "import:1",
        "mailbox:afterCheckpoint:start",
      ]);

      await vi.advanceTimersByTimeAsync(15_000);
      const result = await resultPromise;

      assert.equal(result.assistantPhaseResult, null);
      assert.equal(result.latestWorkspace, null);
      assert.deepEqual(checkpointRequests, []);
      const effectLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "mailbox.post_checkpoint_effects_finished");
      assert.ok(effectLog);
      assert.doesNotThrow(() => parseHostedRuntimeLogRequest({ entries: [effectLog] }));
      assert.equal(effectLog?.level, "warn");
      assert.deepEqual(effectLog?.redactedJson, {
        attemptedCount: 1,
        effectAttachmentEvidenceUpdated: [],
        effectKinds: [],
        effectProjectionUpdated: [],
        effectReasonCodes: [],
        effectStatuses: [],
        errorCodes: ["checkpoint_error", "post_checkpoint_effect_failed"],
        failureCodeDetails: ["HOSTED_MAILBOX_POST_CHECKPOINT_EFFECT_TIMEOUT"],
        failureNames: ["Error"],
        failureSummaries: ["Hosted mailbox post-checkpoint effect timed out."],
        failedCount: 1,
        partialCount: 0,
        succeededCount: 0,
      });
    } finally {
      vi.useRealTimers();
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("logs mailbox post-checkpoint effect failures without foreground checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_projection_failed_log",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_projection_failed_log",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          return {
            afterCheckpoint: async () => {
              throw Object.assign(new Error("projection failed"), {
                code: "PROJECTION_UNAVAILABLE",
              });
            },
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_projection_failed_log",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_projection_failed_log",
          leaseGeneration: "1",
          workspaceVersion: "0",
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.equal(result.assistantPhaseResult, null);
      assert.equal(result.latestWorkspace, null);
      assert.deepEqual(checkpointRequests, []);
      const effectLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "mailbox.post_checkpoint_effects_finished");
      assert.ok(effectLog);
      assert.doesNotThrow(() => parseHostedRuntimeLogRequest({ entries: [effectLog] }));
      assert.equal(effectLog?.level, "warn");
      assert.deepEqual(effectLog?.redactedJson, {
        attemptedCount: 1,
        effectAttachmentEvidenceUpdated: [],
        effectKinds: [],
        effectProjectionUpdated: [],
        effectReasonCodes: [],
        effectStatuses: [],
        errorCodes: ["post_checkpoint_effect_failed", "runtime_error"],
        failureCodeDetails: ["PROJECTION_UNAVAILABLE"],
        failureNames: ["Error"],
        failureSummaries: ["projection failed"],
        failedCount: 1,
        partialCount: 0,
        succeededCount: 0,
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("logs reported mailbox post-checkpoint effect partial results", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_projection_partial_log",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_projection_partial_log",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          return {
            afterCheckpoint: async () =>
              createInboxProjectionEffectResult({
                attachmentEvidenceUpdated: false,
                projectionUpdated: true,
                reasonCode: "conversation-import.attachment-evidence-update-failed",
                status: "partial",
              }),
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_projection_partial_log",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_projection_partial_log",
          leaseGeneration: "1",
          workspaceVersion: "0",
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      const effectLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "mailbox.post_checkpoint_effects_finished");
      assert.ok(effectLog);
      assert.doesNotThrow(() => parseHostedRuntimeLogRequest({ entries: [effectLog] }));
      assert.equal(effectLog.level, "warn");
      assert.deepEqual(effectLog.redactedJson, {
        attemptedCount: 1,
        effectAttachmentEvidenceUpdated: [false],
        effectKinds: ["inbox_projection"],
        effectProjectionUpdated: [true],
        effectReasonCodes: ["conversation-import.attachment-evidence-update-failed"],
        effectStatuses: ["partial"],
        errorCodes: ["post_checkpoint_effect_reported_partial"],
        failedCount: 0,
        partialCount: 1,
        succeededCount: 0,
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("logs internally caught mailbox attachment evidence update failures", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          dedupeKey: "evt_synthetic_runner_attachment_update_failed",
          id: "mailbox_item_runner_attachment_update_failed_log",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const conversationImportItem = createHostedConversationMailboxImportItem({
      decodePayload: {
        async decode() {
          return {
            status: "decoded",
            wake: createRunnerConversationWake(),
          };
        },
      },
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_runner_attachment_update_failed",
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async loadAttachmentEvidenceCapture(input) {
        assert.equal(input.captureId, "cap_synthetic_runner_attachment_update_failed");
        return {
          attachments: [],
          captureId: input.captureId,
        };
      },
      async prepareWakeContext() {},
      runtime: createConversationRuntime(),
      stageAssistantInputEvent: async () => ({
        attachmentDescriptorCount: 1,
        inputId: "ain_00000000000000000000000000000000",
        async recordAttachmentEvidence() {
          throw new Error("attachment evidence update unavailable");
        },
        async recordProjection() {},
      }),
      vaultRoot,
    });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_attachment_update_failed_log",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          return conversationImportItem(item);
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_attachment_update_failed_log",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_attachment_update_failed_log",
          leaseGeneration: "1",
          workspaceVersion: "0",
        },
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      assert.ok(result);
      const importLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "mailbox.imported");
      assert.ok(importLog);
      assert.equal(typeof importLog.redactedJson?.projectionPrepareMs, "number");
      assert.equal(typeof importLog.redactedJson?.projectionImportMs, "number");
      assert.equal(typeof importLog.redactedJson?.attachmentEvidenceMs, "number");
      assert.equal(typeof importLog.redactedJson?.projectionTotalMs, "number");
      const effectLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "mailbox.post_checkpoint_effects_finished");
      assert.equal(effectLog, undefined);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("normalizes reported mailbox post-checkpoint reason codes before logging", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_projection_reason_log",
          laneSeq: "1",
        }),
      ],
    });
    const logRequests: HostedRuntimeLogRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_projection_reason_log",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          return {
            afterCheckpoint: async () =>
              createInboxProjectionEffectResult({
                projectionUpdated: false,
                reasonCode: "projection failed for private message",
                status: "partial",
              }),
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_projection_reason_log",
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });

      const effectLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "mailbox.post_checkpoint_effects_finished");
      assert.deepEqual(effectLog?.redactedJson?.effectReasonCodes, ["unclassified"]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("defers normal hosted post-assistant effects to idle shutdown without foreground checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_post_checkpoint",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "3",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Import should not run without mailbox items.");
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_post_checkpoint",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_post_checkpoint",
          leaseGeneration: "3",
          workspaceVersion: "0",
        },
        async runAssistantPhase() {
          return {
            afterCheckpoint: async () => ({
              checkpointReason: "outbox_receipt",
              nextWakeAt: "2026-04-26T00:05:00.000Z",
              nextWakeReason: "assistant",
              redactedStatus: {
                hostedOutboxDeliveryAttempted: 1,
                hostedOutboxDeliverySent: 1,
                hostedOutboxPendingDeliveryEffects: 0,
              },
            }),
            checkpointReason: "outbox_sending",
            progressed: true,
            redactedStatus: {
              hostedOutboxPendingDeliveryEffects: 1,
            },
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
      });

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.equal(result.latestWorkspace?.version, "0");
      assert.equal(result.assistantPhaseResult?.nextWakeAt, "2026-04-26T00:05:00.000Z");
      assert.deepEqual(result.assistantPhaseResult?.redactedStatus, {
        hostedOutboxDeliveryAttempted: 1,
        hostedOutboxDeliverySent: 1,
        hostedOutboxPendingDeliveryEffects: 0,
      });
      const deferredLog = logRequests.flatMap((request) => request.entries)
        .find((entry) =>
          entry.eventCode === "checkpoint.runtime_residue_deferred"
          && entry.redactedJson?.checkpointPhase === "post_assistant"
        );
      assert.ok(deferredLog);
      assert.doesNotThrow(() => parseHostedRuntimeLogRequest({ entries: [deferredLog] }));
      assert.deepEqual(deferredLog?.redactedJson, {
        checkpointPhase: "post_assistant",
        checkpointReason: "outbox_receipt",
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("replaces consumed assistant wake with post-checkpoint cleanup wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_post_checkpoint_replace_wake",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "3",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Import should not run without mailbox items.");
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_post_checkpoint_replace_wake",
        async runAssistantPhase() {
          return {
            afterCheckpoint: async () => ({
              checkpointReason: "provider_cleanup",
              nextWakeAt: "2026-04-26T00:05:00.000Z",
              nextWakeReason: "assistant",
            }),
            checkpointReason: "canonical_runtime_commit",
            nextWakeAt: "2026-04-26T00:00:00.000Z",
            nextWakeReason: "assistant",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
      });

      assert.deepEqual(checkpointRequests, []);
      assert.equal(result.latestWorkspace?.version, "0");
      assert.equal(result.assistantPhaseResult?.nextWakeAt, "2026-04-26T00:05:00.000Z");
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.deepEqual(
        logRequests.flatMap((request) => request.entries)
          .filter((entry) => entry.eventCode === "checkpoint.runtime_residue_deferred")
          .map((entry) => entry.redactedJson),
        [
          {
            checkpointPhase: "assistant",
            checkpointReason: "canonical_runtime_commit",
          },
          {
            checkpointPhase: "post_assistant",
            checkpointReason: "provider_cleanup",
          },
        ],
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("preserves an invocation-local retry before a later post-checkpoint assistant wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_post_checkpoint_local_retry",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "3",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Import should not run without mailbox items.");
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_post_checkpoint_local_retry",
        async runAssistantPhase() {
          const invocationLocalAssistantWakeAt = "2026-04-26T00:00:30.000Z";
          return {
            afterCheckpoint: async () => ({
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: "2026-04-26T07:00:00.000Z",
              nextWakeReason: "assistant",
            }),
            checkpointReason: "canonical_runtime_commit",
            invocationLocalAssistantWakeAt,
            nextWakeAt: invocationLocalAssistantWakeAt,
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
      });

      assert.equal(
        result.assistantPhaseResult?.nextWakeAt,
        "2026-04-26T00:00:30.000Z",
      );
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.equal(
        result.assistantPhaseResult?.invocationLocalAssistantWakeAt,
        "2026-04-26T00:00:30.000Z",
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("preserves an invocation-local retry when post-checkpoint work has no wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_post_checkpoint_local_retry_null",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "3",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Import should not run without mailbox items.");
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_post_checkpoint_local_retry_null",
        async runAssistantPhase() {
          const invocationLocalAssistantWakeAt = "2026-04-26T00:00:30.000Z";
          return {
            afterCheckpoint: async () => ({
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: null,
              nextWakeReason: null,
            }),
            checkpointReason: "canonical_runtime_commit",
            invocationLocalAssistantWakeAt,
            nextWakeAt: invocationLocalAssistantWakeAt,
            nextWakeReason: "assistant",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
      });

      assert.equal(
        result.assistantPhaseResult?.nextWakeAt,
        "2026-04-26T00:00:30.000Z",
      );
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.equal(
        result.assistantPhaseResult?.invocationLocalAssistantWakeAt,
        "2026-04-26T00:00:30.000Z",
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not import foreground mailbox work during post-assistant cleanup", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items: HostedMailboxItem[] = [];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_post_checkpoint_late_input",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "3",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          const staged = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              "late input during post-assistant cleanup",
            ),
            vault: vaultRoot,
          });
          await enqueueHostedPendingAssistantInputId({
            inputId: staged.inputId,
            vaultRoot,
          });
          return {
            assistantInputId: staged.inputId,
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_post_checkpoint_late_input",
        runtimeWakeSignal,
        async runAssistantPhase() {
          return {
            afterCheckpoint: async () => {
              items.push(createMailboxItem({
                id: "mailbox_item_runner_post_checkpoint_late_input",
                laneSeq: "1",
                occurredAt: "2026-04-26T00:00:02.000Z",
              }));
              runtimeWakeSignal.notify();
              return {
                checkpointReason: "provider_cleanup",
                nextWakeAt: "2026-04-26T00:05:00.000Z",
                nextWakeReason: "assistant",
              };
            },
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(importedSeqs, []);
      assert.equal(result.assistantPhaseResult?.nextWakeAt, "2026-04-26T00:05:00.000Z");
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "0");
      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not drain post-assistant mailbox work after foreground stop", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items: HostedMailboxItem[] = [];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_post_checkpoint_stop_late_input",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "3",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
          });
          const staged = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              "late input drained while stopping foreground import loop",
            ),
            vault: vaultRoot,
          });
          await enqueueHostedPendingAssistantInputId({
            inputId: staged.inputId,
            vaultRoot,
          });
          return {
            assistantInputId: staged.inputId,
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_post_checkpoint_stop_late_input",
        runtimeWakeSignal,
        async runAssistantPhase() {
          return {
            afterCheckpoint: async () => {
              items.push(createMailboxItem({
                id: "mailbox_item_runner_post_checkpoint_stop_late_input",
                laneSeq: "1",
                occurredAt: "2026-04-26T00:00:02.000Z",
              }));
              runtimeWakeSignal.notify();
              return {
                checkpointReason: "provider_cleanup",
                nextWakeAt: "2026-04-26T00:05:00.000Z",
                nextWakeReason: "assistant",
              };
            },
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(importedSeqs, []);
      assert.equal(result.assistantPhaseResult?.nextWakeAt, "2026-04-26T00:05:00.000Z");
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "0");
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("explicit post-assistant cleanup null does not import stopped foreground work", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items: HostedMailboxItem[] = [];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let assistantInputStaged = false;

    try {
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_post_checkpoint_stop_null_late_input",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "3",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          importedSeqs.push(item.item.laneSeq);
          const staged = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              "late input drained while stopping after explicit cleanup null",
            ),
            vault: vaultRoot,
          });
          await enqueueHostedPendingAssistantInputId({
            inputId: staged.inputId,
            vaultRoot,
          });
          assistantInputStaged = true;
          return {
            assistantInputId: staged.inputId,
            status: "imported",
          };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_post_checkpoint_stop_null_late_input",
        runtimeWakeSignal,
        async runAssistantPhase() {
          return {
            afterCheckpoint: async () => {
              items.push(createMailboxItem({
                id: "mailbox_item_runner_post_checkpoint_stop_null_late_input",
                laneSeq: "1",
                occurredAt: "2026-04-26T00:00:02.000Z",
              }));
              runtimeWakeSignal.notify();
              assert.equal(assistantInputStaged, false);
              return {
                checkpointReason: "system_mailbox_receipt",
                nextWakeAt: null,
                nextWakeReason: null,
              };
            },
            checkpointReason: "canonical_runtime_commit",
            nextWakeAt: "2026-04-26T00:10:00.000Z",
            nextWakeReason: "assistant",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(importedSeqs, []);
      assert.equal(assistantInputStaged, false);
      assert.equal(result.assistantPhaseResult?.nextWakeAt, null);
      assert.equal(result.assistantPhaseResult?.nextWakeReason, null);
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "0");
      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("clears stale foreground wake when deferred post-checkpoint work drains it", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_post_checkpoint_cleared_wake",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "3",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Import should not run without mailbox items.");
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_post_checkpoint_cleared_wake",
        async runAssistantPhase() {
          return {
            afterCheckpoint: async () => ({
              checkpointReason: "system_mailbox_receipt",
              nextWakeAt: null,
              nextWakeReason: null,
            }),
            checkpointReason: "activation_bootstrap",
            nextWakeAt: "2026-04-26T00:00:00.000Z",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
      });

      assert.deepEqual(checkpointRequests, []);
      assert.equal(result.latestWorkspace?.version, "0");
      assert.equal(result.latestWorkspace?.nextWakeAt, null);
      assert.equal(result.assistantPhaseResult?.nextWakeAt, null);
      assert.deepEqual(
        logRequests.flatMap((request) => request.entries)
          .filter((entry) => entry.eventCode === "checkpoint.runtime_residue_deferred")
          .map((entry) => entry.redactedJson),
        [
          {
            checkpointPhase: "assistant",
            checkpointReason: "activation_bootstrap",
          },
          {
            checkpointPhase: "post_assistant",
            checkpointReason: "system_mailbox_receipt",
          },
        ],
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("defers runtime-only assistant phase checkpoints without touching the workspace", async () => {
    for (const checkpointReason of ["assistant_runtime_commit", "provider_cleanup"] as const) {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
      const { mailboxPort } = createMailboxPort({ items: [] });
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const logRequests: HostedRuntimeLogRequest[] = [];

      try {
        const result = await runHostedWorkspaceUntilIdleOrBudget({
          checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
            attemptId: `attempt_synthetic_runner_${checkpointReason}`,
            expectedWorkspaceVersion: "0",
            leaseGeneration: "3",
            nextWakeAt: null,
            nextWakeReason: null,
            snapshotRef: null,
          }),
          expectedUserId: TEST_USER_ID,
          async importItem() {
            throw new Error("Initial mailbox import was already provided.");
          },
          initialMailboxImport: createCheckpointedMailboxImportResult(),
          limitPerLane: 10,
          platform: createPlatform({
            logRequests,
            mailboxPort,
            workspacePort: createWorkspacePort({ checkpointRequests }),
          }),
          requestId: `request_synthetic_runner_${checkpointReason}`,
          runtimeLogContext: {
            attemptId: `attempt_synthetic_runner_${checkpointReason}`,
            leaseGeneration: "3",
            workspaceVersion: "0",
          },
          async runAssistantPhase() {
            return {
              checkpointReason,
              nextWakeAt: "2026-04-26T00:10:00.000Z",
              progressed: true,
            };
          },
          vaultRoot,
          workspace: createWorkspaceState({ version: "0" }),
          now: () => TEST_NOW,
        });

        assert.equal(result.assistantPhaseResult?.nextWakeAt, "2026-04-26T00:10:00.000Z");
        assert.deepEqual(checkpointRequests.map((request) => request.reason), []);
        const deferredLog = logRequests.flatMap((request) => request.entries)
          .find((entry) => entry.eventCode === "checkpoint.runtime_residue_deferred");
        assert.ok(deferredLog);
        assert.doesNotThrow(() => parseHostedRuntimeLogRequest({ entries: [deferredLog] }));
        assert.deepEqual(deferredLog?.redactedJson, {
          checkpointPhase: "assistant",
          checkpointReason,
        });
      } finally {
        await rm(vaultRoot, {
          force: true,
          recursive: true,
        });
      }
    }
  });

  test("does not unwind reply intent when post-assistant cleanup throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const events: string[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_post_assistant_cleanup_failed",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "3",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          throw new Error("Import should not run without mailbox items.");
        },
        limitPerLane: 10,
        platform: createPlatform({
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_post_assistant_cleanup_failed",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_post_assistant_cleanup_failed",
          leaseGeneration: "3",
          workspaceVersion: "0",
        },
        async runAssistantPhase() {
          events.push("assistant");
          return {
            afterCheckpoint: async () => {
              events.push("optional:post-assistant-cleanup");
              throw Object.assign(new Error("provider cleanup unavailable"), {
                code: "PROVIDER_CLEANUP_UNAVAILABLE",
              });
            },
            checkpointReason: "outbox_sending",
            progressed: true,
            redactedStatus: {
              hostedOutboxSendingCheckpointed: true,
            },
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.equal(result.assistantPhaseResult?.progressed, true);
      assert.equal(result.latestWorkspace?.version, "0");
      assert.deepEqual(events, [
        "assistant",
        "optional:post-assistant-cleanup",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);

      const postCheckpointFailureLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "runner.error");
      assert.ok(postCheckpointFailureLog);
      assert.doesNotThrow(() =>
        parseHostedRuntimeLogRequest({ entries: [postCheckpointFailureLog] })
      );
      assert.equal(postCheckpointFailureLog.errorCode, "assistant_after_checkpoint_failed");
      assert.equal(postCheckpointFailureLog.level, "warn");
      assert.deepEqual(postCheckpointFailureLog.redactedJson, {
        checkpointed: false,
        failureCodeDetails: ["PROVIDER_CLEANUP_UNAVAILABLE"],
        failureNames: ["Error"],
        failureSummaries: ["provider cleanup unavailable"],
        nestedErrorCode: "runtime_error",
      });
    } finally {
      warn.mockRestore();
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("fails closed when mailbox fetch returns a different user", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({
      fetchUserId: "member_synthetic_other",
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_mismatch",
          laneSeq: "1",
        }),
      ],
    });
    let assistantPhaseCalled = false;
    let checkpointCalled = false;

    try {
      await assert.rejects(
        () =>
          runHostedWorkspaceUntilIdleOrBudget({
            checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
              attemptId: "attempt_synthetic_runner_mismatch",
              expectedWorkspaceVersion: "0",
              leaseGeneration: "1",
              nextWakeAt: null,
              nextWakeReason: null,
              snapshotRef: null,
            }),
            expectedUserId: TEST_USER_ID,
            async importItem() {
              throw new Error("Import should not run after user mismatch.");
            },
            limitPerLane: 10,
            platform: createPlatform({
              mailboxPort,
              workspacePort: {
                async checkpoint(): Promise<HostedWorkspaceCheckpointResponse> {
                  checkpointCalled = true;
                  throw new Error("Checkpoint should not run after user mismatch.");
                },
              },
            }),
            requestId: "request_synthetic_runner_mismatch",
            async runAssistantPhase() {
              assistantPhaseCalled = true;
              return {};
            },
            vaultRoot,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        HostedMailboxUserMismatchError,
      );
      assert.equal(checkpointCalled, false);
      assert.equal(assistantPhaseCalled, false);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("fails closed before mailbox fetch when workspace belongs to another user", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    let mailboxFetchCalled = false;
    let assistantPhaseCalled = false;

    try {
      await assert.rejects(
        () =>
          runHostedWorkspaceUntilIdleOrBudget({
            checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
              attemptId: "attempt_synthetic_runner_workspace_mismatch",
              expectedWorkspaceVersion: "0",
              leaseGeneration: "1",
              nextWakeAt: null,
              nextWakeReason: null,
              snapshotRef: null,
            }),
            expectedUserId: TEST_USER_ID,
            async importItem() {
              throw new Error("Import should not run after workspace user mismatch.");
            },
            limitPerLane: 10,
            platform: createPlatform({
              mailboxPort: {
                async fetch(): Promise<HostedMailboxFetchResponse> {
                  mailboxFetchCalled = true;
                  throw new Error("Mailbox fetch should not run after workspace user mismatch.");
                },
                async fetchPayload(): Promise<HostedMailboxPayloadFetchResponse> {
                  throw new Error("Payload fetch should not run after workspace user mismatch.");
                },
              },
              workspacePort: createWorkspacePort({ checkpointRequests: [] }),
            }),
            requestId: "request_synthetic_runner_workspace_mismatch",
            async runAssistantPhase() {
              assistantPhaseCalled = true;
              return {};
            },
            vaultRoot,
            workspace: createWorkspaceState({
              userId: "member_synthetic_workspace_other",
              version: "0",
            }),
          }),
        HostedWorkspaceRunnerUserMismatchError,
      );
      assert.equal(mailboxFetchCalled, false);
      assert.equal(assistantPhaseCalled, false);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not contact stale workspace checkpoint in the foreground assistant lane", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_stale",
          laneSeq: "1",
        }),
      ],
    });
    let assistantPhaseCalled = false;
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointed: false,
      checkpointRequests,
    });

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_stale",
          expectedWorkspaceVersion: "7",
          leaseGeneration: "2",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem() {
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: createPlatform({
          mailboxPort,
          workspacePort,
        }),
        requestId: "request_synthetic_runner_stale",
        async runAssistantPhase() {
          assistantPhaseCalled = true;
          return {};
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "7" }),
      });
      assert.equal(assistantPhaseCalled, true);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
        "1",
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("marks imported conversation lag dirty without publishing a guessed prefix", async () => {
    const result = await runConversationHandledThroughScenario({});

    assert.equal(
      result.runtimeRedactedStatus?.["hostedMailboxConversationHandledThroughSeq"],
      undefined,
    );
    assert.equal(result.runtimeStateDirty, true);
  });

  test.each([
    {
      foregroundReplyFailed: 1,
      pendingAssistantInput: true,
      reason: "the foreground reply failed",
    },
    {
      foregroundReplyFailed: 0,
      pendingAssistantInput: true,
      reason: "assistant input remains pending",
    },
  ])("does not publish a handled conversation prefix when $reason", async ({
    foregroundReplyFailed,
    pendingAssistantInput,
  }) => {
    const result = await runConversationHandledThroughScenario({
      foregroundReplyFailed,
      pendingAssistantInput,
    });

    assert.equal(
      result.runtimeRedactedStatus?.["hostedMailboxConversationHandledThroughSeq"],
      undefined,
    );
    assert.equal(result.runtimeStateDirty, true);
  });

  test("marks replay-only handled progress dirty so a lagging durable prefix can repair", async () => {
    const result = await runConversationHandledThroughScenario({
      consumedSeq: "13",
      initialImportedSeq: "100",
      items: [],
    });

    assert.equal(
      result.runtimeRedactedStatus?.["hostedMailboxConversationHandledThroughSeq"],
      undefined,
    );
    assert.equal(result.runtimeStateDirty, true);
  });

  test("leaves prefix derivation to Web when a later conversation input is pending", async () => {
    const result = await runConversationHandledThroughScenario({
      foregroundReplyFailed: 1,
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_handled_prefix_1",
          laneSeq: "1",
        }),
        createMailboxItem({
          id: "mailbox_item_runner_handled_prefix_2",
          laneSeq: "2",
        }),
        createMailboxItem({
          id: "mailbox_item_runner_handled_prefix_3",
          laneSeq: "3",
        }),
      ],
      pendingAssistantInputLaneSeq: "2",
    });

    assert.equal(
      result.runtimeRedactedStatus?.["hostedMailboxConversationHandledThroughSeq"],
      undefined,
    );
    assert.equal(result.runtimeStateDirty, true);
  });

  test.each([
    {
      consumedSeq: "100",
      reason: "the durable floor already equals the local prefix",
    },
    {
      consumedSeq: "101",
      reason: "the durable floor is ahead of the local prefix",
    },
    {
      consumedSeq: null,
      reason: "the mailbox response omits the durable floor",
    },
  ])("does not dirty replay-only state when $reason", async ({ consumedSeq }) => {
    const result = await runConversationHandledThroughScenario({
      consumedSeq,
      initialImportedSeq: "100",
      items: [],
    });

    assert.equal(
      result.runtimeRedactedStatus?.["hostedMailboxConversationHandledThroughSeq"],
      undefined,
    );
    assert.equal(result.runtimeStateDirty, false);
  });

});

async function runConversationHandledThroughScenario(input: {
  channel?: "linq" | "telegram";
  consumedSeq?: string | null;
  foregroundReplyFailed?: number;
  initialImportedSeq?: string;
  items?: HostedMailboxItem[];
  pendingAssistantInput?: boolean;
  pendingAssistantInputLaneSeq?: string;
}) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runner-handled-prefix-"));
  const items = input.items ?? [
    createMailboxItem({
      id: "mailbox_item_runner_handled_prefix",
      laneSeq: "1",
    }),
  ];
  const { mailboxPort } = createMailboxPort({
    ...(input.consumedSeq === null
      ? {}
      : {
          consumedSeqByLane: [
            {
              consumedSeq: input.consumedSeq ?? "0",
              lane: "conversation" as const,
            },
          ],
        }),
    items,
  });

  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    if (input.initialImportedSeq !== undefined) {
      const state = createEmptyHostedMailboxImportState();
      state.watermarks.conversation = input.initialImportedSeq;
      await writeHostedMailboxImportState({ state, vaultRoot });
    }
    if (
      input.pendingAssistantInput === true
      || input.pendingAssistantInputLaneSeq !== undefined
    ) {
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: input.channel ?? "telegram",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
    }

    return await runHostedWorkspaceUntilIdleOrBudget({
      checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
        attemptId: "attempt_synthetic_runner_handled_prefix",
        expectedWorkspaceVersion: "0",
        leaseGeneration: "1",
        nextWakeAt: null,
        nextWakeReason: null,
        snapshotRef: null,
      }),
      expectedUserId: TEST_USER_ID,
      async importItem(item) {
        const stored = await upsertAssistantInputEvent({
          event: createStoredAssistantInputEventForMailboxItem(
            item.item,
            "handled prefix input",
            input.channel ?? "telegram",
          ),
          vault: vaultRoot,
        });
        const remainsPending = input.pendingAssistantInput === true
          || item.item.laneSeq === input.pendingAssistantInputLaneSeq;
        if (remainsPending) {
          await enqueueHostedPendingAssistantInputId({
            inputId: stored.inputId,
            vaultRoot,
          });
        } else if (input.pendingAssistantInputLaneSeq !== undefined) {
          await writeTerminalEvidence({
            evidenceId: stored.inputId,
            groupInputIds: [stored.inputId],
            vaultRoot,
          });
        }
        return {
          assistantInputId: stored.inputId,
          status: "imported",
        };
      },
      limitPerLane: 10,
      platform: createPlatform({
        mailboxPort,
        workspacePort: createWorkspacePort({ checkpointRequests: [] }),
      }),
      requestId: "request_synthetic_runner_handled_prefix",
      async runAssistantPhase() {
        return input.foregroundReplyFailed === undefined
          ? { progressed: false }
          : {
              foregroundReplyFailed: input.foregroundReplyFailed,
              progressed: false,
            };
      },
      vaultRoot,
      workspace: null,
      now: () => TEST_NOW,
    });
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
}

function createPlatform(input: {
  artifactBytesByHash?: ReadonlyMap<string, Uint8Array>;
  artifactGetCalls?: string[];
  artifactPut?: (artifact: { bytes: Uint8Array; sha256: string }) => Promise<void>;
  artifactPutCalls?: string[];
  effectsPort?: Partial<HostedRuntimeEffectsPort>;
  logRequests?: HostedRuntimeLogRequest[];
  mailboxPort: HostedRuntimeMailboxPort;
  providerFetch?: typeof fetch;
  usageRecordPort?: HostedRuntimeUsageRecordPort;
  workspacePort: HostedRuntimeWorkspacePort;
}) {
  return {
    artifactStore: {
      async get(sha256: string) {
        input.artifactGetCalls?.push(sha256);
        return input.artifactBytesByHash?.get(sha256) ?? null;
      },
      async put(artifact: { bytes: Uint8Array; sha256: string }) {
        input.artifactPutCalls?.push(artifact.sha256);
        await input.artifactPut?.(artifact);
      },
    },
    effectsPort: {
      async assertLinqRecentInboundEngagement(
        request: HostedRuntimeLinqRecentInboundEngagementRequest,
      ) {
        const target = request.target ?? "linq-thread";
        return {
          ...(request.authorityCheckOnly === true
            ? {}
            : { providerDispatchClaimed: true }),
          resolvedRoute: {
            conversationThreadId: null,
            directRecipientPhoneNumber:
              request.directRecipientPhoneNumber ?? null,
            fromPhoneNumber: request.fromPhoneNumber ?? null,
            target,
            targetKind: request.targetKind === "participant"
              ? "participant"
              : "thread",
            threadIsDirect: true,
          },
        } as const;
      },
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
      ...input.effectsPort,
    },
    ...(input.logRequests
      ? {
          logPort: {
            async write(request: HostedRuntimeLogRequest) {
              input.logRequests?.push(request);
              return {
                loggedCount: request.entries.length,
              };
            },
          },
        }
      : {}),
    mailboxPort: input.mailboxPort,
    ...(input.providerFetch ? { providerFetch: input.providerFetch } : {}),
    ...(input.usageRecordPort ? { usageRecordPort: input.usageRecordPort } : {}),
    workspacePort: input.workspacePort,
  };
}

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

function createConversationRuntime(): Pick<
  NormalizedHostedAssistantRuntimeConfig,
  | "forwardedEnv"
  | "parserToolchain"
  | "platform"
  | "platformEnv"
  | "resolvedConfig"
  | "userEnv"
> {
  return {
    forwardedEnv: {},
    parserToolchain: null,
    platform: {
      artifactStore: {
        async get() {
          return null;
        },
        async put() {},
      },
      effectsPort: {
        async readRawEmailMessage() {
          return null;
        },
        async sendEmail() {},
      },
    },
    platformEnv: {},
    resolvedConfig: {
      channelCapabilities: {
        emailSendReady: false,
        telegramBotConfigured: false,
      },
      deviceSync: null,
      managedAutoReplyChannels: [
        {
          capabilityReady: false,
          channel: "email",
          memberChannel: "email",
        },
        {
          capabilityReady: true,
          channel: "linq",
          memberChannel: "linq",
        },
        {
          capabilityReady: false,
          channel: "telegram",
          memberChannel: "telegram",
        },
      ],
    },
    userEnv: {},
  };
}

function createRunnerConversationWake(): HostedExecutionConversationMessageWake {
  return {
    eventId: "evt_synthetic_runner_attachment_update_failed",
    kind: "conversation.message",
    message: {
      channel: "linq",
      linqMessage: {
        chatId: "chat_synthetic_runner_attachment_update_failed",
        from: "redacted-contact-sentinel",
        isFromMe: false,
        messageId: "msg_synthetic_runner_attachment_update_failed",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      phoneLookupKey: "redacted-contact-sentinel",
    },
    occurredAt: TEST_NOW,
    userId: TEST_USER_ID,
  };
}

function createMailboxPort(input: {
  beforeFetch?: (request: HostedMailboxFetchRequest) => Promise<void> | void;
  consumedSeqByLane?: HostedMailboxFetchResponse["consumedSeqByLane"];
  fetchRequests?: HostedMailboxFetchRequest[];
  fetchUserId?: string;
  items: HostedMailboxItem[];
  payloadsUnavailable?: boolean;
  resolveConsumedSeqByLane?: (
    request: HostedMailboxFetchRequest,
  ) => HostedMailboxFetchResponse["consumedSeqByLane"] | undefined;
}): {
  mailboxPort: HostedRuntimeMailboxPort;
} {
  const fetchRequests = input.fetchRequests ?? [];

  return {
    mailboxPort: {
      async fetch(request): Promise<HostedMailboxFetchResponse> {
        fetchRequests.push(request);
        await input.beforeFetch?.(request);
        const consumedSeqByLane = input.resolveConsumedSeqByLane?.(request)
          ?? input.consumedSeqByLane;
        return {
          ...(consumedSeqByLane === undefined
            ? {}
            : { consumedSeqByLane }),
          fetchedAt: TEST_NOW,
          items: request.lanes.flatMap((lane) => {
            const importedSeq = BigInt(lane.importedSeq);
            return input.items
              .filter((item) =>
                lane.lane === item.lane && BigInt(item.laneSeq) > importedSeq
              )
              .slice(0, request.limitPerLane);
          }),
          maxSeqByLane: request.lanes.map((lane) => ({
            lane: lane.lane,
            maxSeq: input.items
              .filter((item) => item.lane === lane.lane)
              .reduce((maxSeq, item) =>
                BigInt(item.laneSeq) > BigInt(maxSeq) ? item.laneSeq : maxSeq,
              lane.importedSeq),
          })),
          userId: input.fetchUserId ?? TEST_USER_ID,
        };
      },
      async fetchPayload(request): Promise<HostedMailboxPayloadFetchResponse> {
        const payloadFetchRequest: HostedMailboxPayloadFetchRequest = request;
        if (input.payloadsUnavailable) {
          return {
            fetchedAt: TEST_NOW,
            payload: null,
            unavailable: {
              code: "not_found",
              retryable: true,
            },
          };
        }

        return {
          fetchedAt: TEST_NOW,
          payload: {
            createdAt: TEST_NOW,
            mailboxItemId: payloadFetchRequest.mailboxItemId,
            payloadCiphertext: "ciphertext_synthetic_sidecar",
            payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
            userId: TEST_USER_ID,
          },
        };
      },
    },
  };
}

async function runFastDispatchCrashWindowAttempt(input: {
  checkpointRequests: HostedWorkspaceCheckpointRequest[];
  effectObservations: Array<{ effectId: string; idempotencyKey: string | null }>;
  providerFetch: typeof fetch;
  vaultRoot: string;
}) {
  const { mailboxPort } = createMailboxPort({ items: [] });
  return await runHostedWorkspaceUntilIdleOrBudget({
    checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
      attemptId: "attempt_synthetic_fast_dispatch_crash_window",
      expectedWorkspaceVersion: "0",
      leaseGeneration: "1",
      nextWakeAt: null,
      nextWakeReason: null,
      snapshotRef: null,
    }),
    expectedUserId: TEST_USER_ID,
    async importItem() {
      throw new Error("Initial mailbox import was already provided.");
    },
    initialMailboxImport: createCheckpointedMailboxImportResult(),
    limitPerLane: 10,
    platform: createPlatform({
      mailboxPort,
      providerFetch: input.providerFetch,
      workspacePort: createWorkspacePort({
        checkpointRequests: input.checkpointRequests,
      }),
    }),
    requestId: "request_synthetic_fast_dispatch_crash_window",
    async runAssistantPhase(phaseInput) {
      const effects = await collectHostedAssistantDeliverySideEffects({
        includeBackgroundDueIntents: true,
        preferredIntentIds: [],
        vaultRoot: input.vaultRoot,
      });
      assert.equal(effects.length, 1);
      const effect = effects[0];
      assert.equal(effect?.payload.channel, "linq");
      assert.equal(effect?.payload.transportIdempotent, true);
      input.effectObservations.push({
        effectId: effect?.effectId ?? "",
        idempotencyKey: effect?.payload.idempotencyKey ?? null,
      });
      const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
        assistantDeliveryEffects: effects,
        now: () => TEST_NOW,
        vaultRoot: input.vaultRoot,
      });
      const outcomes = await drainHostedPreparedAssistantDeliveries({
        allowPreparedSending: true,
        assistantDeliveryEffects: effects,
        effectsPort: phaseInput.platform.effectsPort,
        forwardedEnv: {
          LINQ_API_BASE_URL: "https://linq.example",
          LINQ_API_TOKEN: "test-linq-token",
        },
        platformEnv: {},
        preparedDispatches: preparation.preparedDispatches,
        providerFetch: phaseInput.platform.providerFetch ?? null,
        vaultRoot: input.vaultRoot,
        wake: createRunnerConversationWake(),
      });
      return {
        checkpointReason: "outbox_receipt",
        progressed: true,
        redactedStatus: {
          hostedOutboxDeliveryAttempted: outcomes.length,
          hostedOutboxDeliverySent: outcomes.filter((outcome) =>
            outcome.deliveryStatus === "sent"
          ).length,
        },
      };
    },
    vaultRoot: input.vaultRoot,
    workspace: createWorkspaceState({ version: "0" }),
    now: () => TEST_NOW,
  });
}

function createWorkspacePort(input: {
  checkpointRequests: HostedWorkspaceCheckpointRequest[];
  checkpointed?: boolean | ((request: HostedWorkspaceCheckpointRequest) => boolean);
  onCheckpoint?: (
    request: HostedWorkspaceCheckpointRequest,
    response: HostedWorkspaceCheckpointResponse,
  ) => Promise<void> | void;
}): HostedRuntimeWorkspacePort {
  return {
    async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
      const checkpointed = typeof input.checkpointed === "function"
        ? input.checkpointed(request)
        : input.checkpointed ?? true;
      const response = {
        checkpointed,
        workspace: createWorkspaceState({
          browserVaultReplicaRef: request.browserVaultReplicaRef ?? null,
          nextWakeAt: request.nextWakeAt ?? null,
          nextWakeReason: request.nextWakeReason ?? null,
          redactedStatus: request.redactedStatus ?? null,
          snapshotRef: request.snapshotRef,
          version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
        }),
      };
      input.checkpointRequests.push(request);
      await input.onCheckpoint?.(request, response);
      return response;
    },
  };
}

function createRuntimeRedactedStatusCheckpoint(input: {
  attemptId: string;
  checkpointRequests: HostedWorkspaceCheckpointRequest[];
  expectedWorkspaceVersion?: string;
  leaseGeneration: string;
}): (request: HostedWorkspaceRunnerRuntimeStatusCheckpointInput) =>
  Promise<HostedWorkspaceCheckpointResponse> {
  const workspacePort = createWorkspacePort({
    checkpointRequests: input.checkpointRequests,
  });
  let expectedWorkspaceVersion = input.expectedWorkspaceVersion ?? "0";

  return async (request) => {
    const response = await workspacePort.checkpoint({
      attemptId: input.attemptId,
      expectedWorkspaceVersion,
      leaseGeneration: input.leaseGeneration,
      nextWakeAt: request.workspace?.nextWakeAt ?? null,
      nextWakeReason: request.workspace?.nextWakeReason ?? null,
      reason: request.reason,
      redactedStatus: request.redactedStatus,
      snapshotRef: request.workspace?.snapshotRef ?? null,
    });
    if (response.checkpointed) {
      expectedWorkspaceVersion = response.workspace.version;
    }
    return response;
  };
}

function createMailboxItem(overrides: Partial<HostedMailboxItem> = {}): HostedMailboxItem {
  return {
    createdAt: TEST_NOW,
    dedupeKey: `dedupe_${overrides.id ?? "mailbox_item_runner_001"}`,
    expiresAt: null,
    id: "mailbox_item_runner_001",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: TEST_NOW,
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext_synthetic_inline",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    ...overrides,
  };
}

function createLinqDeliveryContext(replyToMessageId: string) {
  return {
    directRecipientPhoneNumber: null,
    fromPhoneNumber: null,
    replyToMessageId,
    routeAuthority: null,
    service: "imessage",
    target: "chat_synthetic_workspace_runner",
    threadIsDirect: true,
  };
}

function createAssistantUsageRecord(
  overrides: Partial<AssistantUsageRecord> = {},
): AssistantUsageRecord {
  return {
    apiKeyEnv: null,
    attemptCount: 1,
    baseUrl: null,
    cacheWriteTokens: null,
    cachedInputTokens: null,
    credentialSource: "platform",
    featureKey: null,
    gatewayTags: [],
    inputTokens: 10,
    memberId: TEST_USER_ID,
    occurredAt: TEST_NOW,
    outputTokens: 5,
    provider: "codex-cli",
    providerName: "OpenAI",
    providerRequestId: null,
    providerRequestOutcome: "succeeded",
    providerRequestOrdinal: 0,
    rawUsageJson: null,
    rawUsageJsonHash: null,
    reasoningTokens: null,
    reportingUserId: null,
    requestedModel: "gpt-5.6-terra",
    routeId: "primary",
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: "gpt-5.6-terra",
    sessionId: "asst_runner_usage",
    stripeMeterSource: "murph",
    surface: null,
    tokenPricingBasis: "standard",
    totalTokens: 15,
    triggerKind: null,
    turnId: "turn_runner_usage",
    turnProfileJson: null,
    usageExtractionSourcePath: null,
    usageExtractionVersion: "codex-usage-v1",
    usageId: "turn_runner_usage.attempt-1",
    ...overrides,
  };
}

function createStoredAssistantInputEventForMailboxItem(
  item: HostedMailboxItem,
  text: string,
  channel: "linq" | "telegram" = "linq",
) {
  return {
    content: {
      text,
      transcriptText: text,
      userMessageContent: [
        {
          text,
          type: "text" as const,
        },
      ],
    },
    conversation: {
      accountId: "acct_1",
      actorId: "actor_1",
      actorIsSelf: false,
      source: channel,
      threadId: "thread_1",
      threadIsDirect: true,
    },
    occurredAt: item.occurredAt,
    receivedAt: item.createdAt,
    replyTarget: {
      channel,
      messageId: `msg_${item.id}`,
      threadId: "thread_1",
    },
    sourceRef: {
      dedupeKey: item.dedupeKey,
      eventId: item.dedupeKey,
      itemId: item.id,
      kind: "hosted-mailbox" as const,
      lane: "conversation" as const,
      laneSeq: item.laneSeq,
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      payloadSource: item.payloadInlineCiphertext ? "inline" as const : "sidecar" as const,
      source: "hosted-mailbox" as const,
      wakeSchema: "murph.hosted-execution-wake.v1",
    },
  };
}

async function stageHostedUsageNoticeAssistantInput(input: {
  channel?: "email" | "linq" | "telegram";
  externalThreadRouteAuthorityPresent?: boolean;
  itemId: string;
  laneSeq?: string;
  messageId: string;
  occurredAt: string;
  threadId: string;
  threadIsDirect?: boolean;
  vaultRoot: string;
}) {
  const channel = input.channel ?? "linq";
  const sourceMetadata = channel === "linq"
    ? {
        externalThreadRouteAuthorityPresent:
          input.externalThreadRouteAuthorityPresent ?? true,
        kind: "linq" as const,
        partCount: 1,
        reactionEligible: true,
        replyToMessageId: null,
        service: "iMessage",
      }
    : channel === "email"
    ? {
        kind: "email" as const,
        promptReady: true,
        promptUnavailableReason: null,
      }
    : null;
  const storedInput = createStoredAssistantInputEventForMailboxItem(
    createMailboxItem({
      id: input.itemId,
      laneSeq: input.laneSeq ?? "1",
      occurredAt: input.occurredAt,
    }),
    "accepted usage notice input",
  );
  return await upsertAssistantInputEvent({
    event: {
      ...storedInput,
      conversation: {
        ...storedInput.conversation,
        source: channel,
        threadId: input.threadId,
        threadIsDirect: input.threadIsDirect ?? false,
      },
      replyTarget: {
        channel,
        messageId: input.messageId,
        threadId: input.threadId,
      },
      sourceMetadata,
    },
    vault: input.vaultRoot,
  });
}

async function writeTerminalEvidence(input: {
  evidenceId: string;
  groupInputIds: readonly string[];
  vaultRoot: string;
}): Promise<void> {
  const directory = path.join(
    resolveAssistantStatePaths(input.vaultRoot).assistantStateRoot,
    "auto-reply",
    "evidence",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${encodeURIComponent(input.evidenceId)}.json`),
    `${JSON.stringify({
      captureId: input.evidenceId,
      groupCaptureIds: input.groupInputIds,
      groupId: `group_${input.groupInputIds.join("__")}`,
      groupInputIds: input.groupInputIds,
      inputId: input.evidenceId,
      primaryCaptureId: input.groupInputIds[0] ?? input.evidenceId,
      primaryInputId: input.groupInputIds[0] ?? input.evidenceId,
      providerCleanup: {
        linqMessageIds: [],
        queuedAt: null,
      },
      recordedAt: TEST_NOW,
      schema: TERMINAL_EVIDENCE_SCHEMA,
      terminal: {
        kind: "suppressed",
        reason: "test",
      },
    }, null, 2)}\n`,
    "utf8",
  );
}

function createWorkspaceState(
  overrides: Partial<HostedWorkspaceState> = {},
): HostedWorkspaceState {
  return {
    checkpointedAt: TEST_NOW,
    createdAt: TEST_NOW,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: null,
    snapshotRef: null,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    version: "0",
    ...overrides,
  };
}

function createCheckpointedMailboxImportResult(): HostedMailboxImportCheckpointResult {
  const previousState = createEmptyHostedMailboxImportState();
  const state = {
    ...createEmptyHostedMailboxImportState(),
    watermarks: {
      conversation: "1",
      system: "0",
    },
  };

  return {
    afterCheckpointEffects: [],
    checkpoint: {
      checkpointed: true,
      workspace: createWorkspaceState({ version: "0" }),
    },
    checkpointDeferred: false,
    importResult: {
      blocked: [],
      consumedSeqByLane: {
        conversation: null,
        system: null,
      },
      fetchedCount: 1,
      importedCount: 1,
      state,
    },
    previousState,
    state,
    stateChanged: true,
  };
}

function createDeferredMailboxImportResult(): HostedMailboxImportCheckpointResult {
  const previousState = createEmptyHostedMailboxImportState();
  const state = {
    ...createEmptyHostedMailboxImportState(),
    watermarks: {
      conversation: "1",
      system: "0",
    },
  };

  return {
    afterCheckpointEffects: [],
    checkpoint: null,
    checkpointDeferred: true,
    importResult: {
      blocked: [],
      consumedSeqByLane: {
        conversation: null,
        system: null,
      },
      fetchedCount: 1,
      importedCount: 1,
      state,
    },
    previousState,
    state,
    stateChanged: true,
  };
}

function createReplayOnlyConversationMailboxImportResult(): HostedMailboxImportCheckpointResult {
  const state = {
    ...createEmptyHostedMailboxImportState(),
    watermarks: {
      conversation: "13",
      system: "0",
    },
  };
  const previousState = state;

  return {
    afterCheckpointEffects: [],
    checkpoint: null,
    checkpointDeferred: false,
    importResult: {
      blocked: [],
      conversationImportedCount: 0,
      consumedSeqByLane: {
        conversation: "13",
        system: null,
      },
      fetchedCount: 1,
      importedCount: 0,
      state,
    },
    previousState,
    state,
    stateChanged: false,
  };
}

function createBundleRef(input: {
  hash: string;
  key: string;
  size: number;
}): NonNullable<HostedWorkspaceState["snapshotRef"]> {
  return {
    hash: input.hash,
    key: input.key,
    size: input.size,
    updatedAt: TEST_NOW,
  };
}

async function flushBackgroundMailboxEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitUntil(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for assertion.");
}

async function withTestTimeout<T>(promise: Promise<T>, timeoutMs = 250): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Timed out waiting for hosted workspace runner test operation."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for hosted workspace runner condition.");
}

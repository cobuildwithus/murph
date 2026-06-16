import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  sha256HostedBundleHex,
  snapshotHostedBundleRoots,
} from "@murphai/runtime-state/node";
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
  HostedMailboxConsumeRequest,
  HostedMailboxConsumeResponse,
  HostedMailboxFetchRequest,
  HostedMailboxFetchResponse,
  HostedMailboxItem,
  HostedMailboxPayloadFetchRequest,
  HostedMailboxPayloadFetchResponse,
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
} from "../src/hosted-runtime.ts";
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
} from "../src/hosted-runtime/mailbox-state.ts";
import {
  restoreHostedWorkspaceRuntimeJobWorkspace,
} from "../src/hosted-runtime/workspace-restore.ts";
import {
  HostedMailboxUserMismatchError,
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
const TEST_USER_ID = "member_synthetic_workspace_runner";

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
  test("preserves explicit null browser-vault replica refs in checkpoint builders", async () => {
    const state = createEmptyHostedMailboxImportState();
    const requestInput = {
      importResult: {
        blocked: [],
        fetchedCount: 0,
        importedCount: 0,
        state,
      },
      previousState: state,
      reason: "canonical_runtime_commit",
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
      createMailboxItem({
        id: "mailbox_item_runner_system_001",
        kind: "device-sync.wake",
        lane: "system",
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
      ]);
      assert.equal(result.initialMailboxImport.state.watermarks.conversation, "1");
      assert.equal(result.latestWorkspace, null);
      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(logRequests, [
        {
          entries: [
            {
              at: TEST_NOW,
              attemptId: "attempt_synthetic_runner_001",
              component: "mailbox",
              eventCode: "mailbox.imported",
              leaseGeneration: "1",
              level: "info",
              mailboxLane: "conversation",
              mailboxSeqEnd: "1",
              mailboxSeqStart: "0",
              phase: "import",
              redactedJson: {
                assistantInputCount: 0,
                assistantInputPresent: false,
                blockCodes: [],
                blockedCount: 0,
                checkpointDeferred: true,
                checkpointed: false,
                conversationImportedCount: 1,
                conversationSeqEnd: "1",
                conversationSeqStart: "0",
                fetchedCount: 1,
                importedCount: 1,
                laneCount: 1,
                retryableBlockedCount: 0,
                stateChanged: true,
                systemSeqEnd: "0",
                systemSeqStart: "0",
              },
              workspaceVersion: "0",
            },
          ],
        },
        {
          entries: [
            {
              at: TEST_NOW,
              attemptId: "attempt_synthetic_runner_001",
              component: "mailbox",
              eventCode: "mailbox.consume_ack_skipped",
              leaseGeneration: "1",
              level: "info",
              mailboxLane: "conversation",
              phase: "checkpoint",
              redactedJson: {
                skipReason: "reply_outcome_missing",
              },
              workspaceVersion: "0",
            },
          ],
        },
      ]);

      releaseEffect();
      assert.ok(result.mailboxPostCheckpointEffectsFinished);
      await result.mailboxPostCheckpointEffectsFinished;
      assert.deepEqual(events, [
        "import:1",
        "assistant",
        "mailbox:afterCheckpoint:start",
        "mailbox:afterCheckpoint:done",
      ]);
      assert.deepEqual(logRequests, [
        {
          entries: [
            {
              at: TEST_NOW,
              attemptId: "attempt_synthetic_runner_001",
              component: "mailbox",
              eventCode: "mailbox.imported",
              leaseGeneration: "1",
              level: "info",
              mailboxLane: "conversation",
              mailboxSeqEnd: "1",
              mailboxSeqStart: "0",
              phase: "import",
              redactedJson: {
                assistantInputCount: 0,
                assistantInputPresent: false,
                blockCodes: [],
                blockedCount: 0,
                checkpointDeferred: true,
                checkpointed: false,
                conversationImportedCount: 1,
                conversationSeqEnd: "1",
                conversationSeqStart: "0",
                fetchedCount: 1,
                importedCount: 1,
                laneCount: 1,
                retryableBlockedCount: 0,
                stateChanged: true,
                systemSeqEnd: "0",
                systemSeqStart: "0",
              },
              workspaceVersion: "0",
            },
          ],
        },
        {
          entries: [
            {
              at: TEST_NOW,
              attemptId: "attempt_synthetic_runner_001",
              component: "mailbox",
              eventCode: "mailbox.consume_ack_skipped",
              leaseGeneration: "1",
              level: "info",
              mailboxLane: "conversation",
              phase: "checkpoint",
              redactedJson: {
                skipReason: "reply_outcome_missing",
              },
              workspaceVersion: "0",
            },
          ],
        },
        {
          entries: [
            {
              at: TEST_NOW,
              attemptId: "attempt_synthetic_runner_001",
              component: "mailbox",
              eventCode: "mailbox.post_checkpoint_effects_finished",
              leaseGeneration: "1",
              level: "info",
              phase: "import",
              redactedJson: {
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
              },
              workspaceVersion: "0",
            },
          ],
        },
      ]);
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

  test("requests an immediate idle wake after assistant context snapshot source writes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    await initializeVault({
      createdAt: new Date(TEST_NOW),
      timezone: "UTC",
      title: "Hosted Workspace Runner Snapshot Dirty Test Vault",
      vaultRoot,
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
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
      assert.deepEqual(checkpointRequests.map((request) => request.reason), []);
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
          kind: "participant",
          target: "+15550001",
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
        threadId: null,
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
        "checkpoint",
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
        "assistant",
        "optional:log",
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

  test("runtime wake imports late conversation input without foreground checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_initial",
        laneSeq: "1",
      }),
    ];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    let admissionCount = 0;
    const liveSteerInputs: unknown[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
    });
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
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
            conversationKeys: ["channel:linq|identity:acct_1|thread:thread_1"],
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
            id: "mailbox_item_runner_late",
            laneSeq: "2",
            occurredAt: "2026-04-26T00:00:02.000Z",
          }));
          items.push(createMailboxItem({
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
              checkpointReason: "canonical_runtime_commit",
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
      assert.deepEqual(liveSteerInputs[0], {
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
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "1", lane: "conversation" },
        ],
      ]);
      assert.deepEqual(
        logRequests.map((request) => request.entries[0]?.eventCode).slice(0, 2),
        ["mailbox.imported", "mailbox.imported"],
      );
      assert.deepEqual(logRequests[1]?.entries[0], {
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
      assert.equal(result.assistantPhaseResult?.nextWakeAt, TEST_NOW);
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

  test("late foreground input without an active turn schedules scanner-backed assistant wake", async () => {
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
      assert.equal(result.assistantPhaseResult?.nextWakeAt, TEST_NOW);
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
            conversationKeys: ["channel:linq|identity:acct_1|thread:thread_1"],
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
          { importedSeq: "1", lane: "conversation" },
        ],
      ]);
      assert.deepEqual(logRequests[1]?.entries[0]?.redactedJson, {
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

  test("preserves earlier foreground assistant wake over later post-assistant cleanup wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_post_checkpoint_preserve_wake",
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
        requestId: "request_synthetic_runner_post_checkpoint_preserve_wake",
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
      assert.equal(result.assistantPhaseResult?.nextWakeAt, "2026-04-26T00:00:00.000Z");
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

  test("preserves foreground assistant wake imported during post-assistant cleanup", async () => {
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
        async runAssistantPhase(input) {
          return {
            afterCheckpoint: async () => {
              items.push(createMailboxItem({
                id: "mailbox_item_runner_post_checkpoint_late_input",
                laneSeq: "1",
                occurredAt: "2026-04-26T00:00:02.000Z",
              }));
              runtimeWakeSignal.notify();
              await waitForCondition(() => importedSeqs.includes("1"));
              await waitForCondition(() =>
                input.shouldYieldBackgroundMaintenance?.() === true
              );
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

      assert.deepEqual(importedSeqs, ["1"]);
      assert.equal(result.assistantPhaseResult?.nextWakeAt, TEST_NOW);
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "1");
      assert.deepEqual(checkpointRequests, []);
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

  test("preserves foreground assistant wake when post-assistant import drains during stop", async () => {
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
              await waitForCondition(() => importedSeqs.includes("1"));
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

      assert.deepEqual(importedSeqs, ["1"]);
      assert.equal(result.assistantPhaseResult?.nextWakeAt, TEST_NOW);
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "1");
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("preserves foreground assistant wake imported during stop after explicit cleanup null", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items: HostedMailboxItem[] = [];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let releaseImportForStopDrain!: () => void;
    const importMayComplete = new Promise<void>((resolve) => {
      releaseImportForStopDrain = resolve;
    });
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
          await importMayComplete;
          const staged = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              "late input drained while stopping after explicit cleanup null",
            ),
            vault: vaultRoot,
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
              await waitForCondition(() => importedSeqs.includes("1"));
              assert.equal(assistantInputStaged, false);
              setTimeout(releaseImportForStopDrain, 0);
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

      assert.deepEqual(importedSeqs, ["1"]);
      assert.equal(assistantInputStaged, true);
      assert.equal(result.assistantPhaseResult?.nextWakeAt, TEST_NOW);
      assert.equal(result.assistantPhaseResult?.nextWakeReason, "assistant");
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "1");
      assert.deepEqual(checkpointRequests, []);
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

});

function createPlatform(input: {
  artifactBytesByHash?: ReadonlyMap<string, Uint8Array>;
  artifactGetCalls?: string[];
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
      async put() {
        return undefined;
      },
    },
    effectsPort: {
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
        whatsappCloudApiConfigured: false,
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
  consumeError?: Error;
  consumeRequests?: HostedMailboxConsumeRequest[];
  fetchRequests?: HostedMailboxFetchRequest[];
  fetchUserId?: string;
  items: HostedMailboxItem[];
  payloadsUnavailable?: boolean;
}): {
  mailboxPort: HostedRuntimeMailboxPort;
} {
  const fetchRequests = input.fetchRequests ?? [];
  const consumeRequests = input.consumeRequests;

  return {
    mailboxPort: {
      ...(consumeRequests
        ? {
            async consume(request): Promise<HostedMailboxConsumeResponse> {
              consumeRequests.push(request);
              if (input.consumeError) {
                throw input.consumeError;
              }
              return {
                acknowledgedAt: TEST_NOW,
                consumedSeqByLane: request.lanes,
                userId: input.fetchUserId ?? TEST_USER_ID,
              };
            },
          }
        : {}),
      async fetch(request): Promise<HostedMailboxFetchResponse> {
        fetchRequests.push(request);
        return {
          fetchedAt: TEST_NOW,
          items: input.items.filter((item) =>
            request.lanes.some((lane) =>
              lane.lane === item.lane && BigInt(item.laneSeq) > BigInt(lane.importedSeq)
            )
          ),
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
        preparedAt: preparation.preparedAt,
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

function createStoredAssistantInputEventForMailboxItem(item: HostedMailboxItem, text: string) {
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
      source: "linq",
      threadId: "thread_1",
      threadIsDirect: true,
    },
    occurredAt: item.occurredAt,
    receivedAt: item.createdAt,
    replyTarget: {
      channel: "linq",
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
      fetchedCount: 1,
      importedCount: 1,
      state,
    },
    previousState,
    state,
    stateChanged: true,
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

describe("hosted conversation mailbox consume ack", () => {
  async function runConsumeAckScenario(input: {
    consumeError?: Error;
    items?: HostedMailboxItem[];
    runAssistantPhase: Parameters<typeof runHostedWorkspaceUntilIdleOrBudget>[0]["runAssistantPhase"];
    stagePendingInput?: boolean;
    withoutConsumePort?: boolean;
  }) {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const consumeRequests: HostedMailboxConsumeRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const { mailboxPort } = createMailboxPort({
      ...(input.consumeError ? { consumeError: input.consumeError } : {}),
      ...(input.withoutConsumePort ? {} : { consumeRequests }),
      items: input.items ?? [
        createMailboxItem({
          id: "mailbox_item_runner_consume_ack",
          laneSeq: "1",
        }),
      ],
    });
    if (input.stagePendingInput) {
      // A staged auto-reply input the stub assistant phase never processes
      // keeps hasPendingAssistantAutoReplyInput truthy at ack time.
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
    }

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_consume_ack",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "1",
          nextWakeAt: null,
          nextWakeReason: null,
          snapshotRef: null,
        }),
        expectedUserId: TEST_USER_ID,
        async importItem(item) {
          if (!input.stagePendingInput) {
            return { status: "imported" };
          }
          const staged = await upsertAssistantInputEvent({
            event: createStoredAssistantInputEventForMailboxItem(
              item.item,
              "pending consume ack input",
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
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests: [] }),
        }),
        requestId: "request_synthetic_runner_consume_ack",
        runAssistantPhase: input.runAssistantPhase,
        vaultRoot,
        workspace: null,
        now: () => TEST_NOW,
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }

    return {
      consumeAckLogEntries: logRequests
        .flatMap((request) => request.entries)
        .filter((entry) =>
          entry.eventCode === "mailbox.consume_ack_advanced"
          || entry.eventCode === "mailbox.consume_ack_skipped"
        ),
      consumeRequests,
    };
  }

  test("advances the conversation watermark after a clean foreground pass", async () => {
    const { consumeAckLogEntries, consumeRequests } = await runConsumeAckScenario({
      async runAssistantPhase() {
        return { foregroundReplyFailed: 0, progressed: false };
      },
    });

    assert.deepEqual(
      consumeRequests.map((request) => request.lanes),
      [[{ consumedSeq: "1", lane: "conversation" }]],
    );
    assert.equal(
      consumeRequests[0]?.requestId,
      "request_synthetic_runner_consume_ack:mailbox-consume",
    );
    assert.deepEqual(
      consumeAckLogEntries.map((entry) => ({
        eventCode: entry.eventCode,
        level: entry.level,
        mailboxSeqEnd: entry.mailboxSeqEnd,
      })),
      [{
        eventCode: "mailbox.consume_ack_advanced",
        level: "info",
        mailboxSeqEnd: "1",
      }],
    );
  });

  test("does not ack when a foreground reply failed and logs the skip reason", async () => {
    const { consumeAckLogEntries, consumeRequests } = await runConsumeAckScenario({
      async runAssistantPhase() {
        return { foregroundReplyFailed: 1, progressed: false };
      },
    });

    assert.deepEqual(consumeRequests, []);
    assert.deepEqual(
      consumeAckLogEntries.map((entry) => ({
        eventCode: entry.eventCode,
        level: entry.level,
        skipReason: entry.redactedJson?.skipReason,
      })),
      [{
        eventCode: "mailbox.consume_ack_skipped",
        level: "info",
        skipReason: "reply_failed",
      }],
    );
  });

  test("logs a skip when the pass reported no foreground reply phase", async () => {
    const { consumeAckLogEntries, consumeRequests } = await runConsumeAckScenario({
      async runAssistantPhase() {
        return { progressed: false };
      },
    });

    assert.deepEqual(consumeRequests, []);
    assert.deepEqual(
      consumeAckLogEntries.map((entry) => ({
        eventCode: entry.eventCode,
        level: entry.level,
        skipReason: entry.redactedJson?.skipReason,
      })),
      [{
        eventCode: "mailbox.consume_ack_skipped",
        level: "info",
        skipReason: "reply_outcome_missing",
      }],
    );
  });

  test("skips the ack while staged assistant input is still pending", async () => {
    const { consumeAckLogEntries, consumeRequests } = await runConsumeAckScenario({
      stagePendingInput: true,
      async runAssistantPhase() {
        return { foregroundReplyFailed: 0, progressed: false };
      },
    });

    assert.deepEqual(consumeRequests, []);
    assert.deepEqual(
      consumeAckLogEntries.map((entry) => ({
        eventCode: entry.eventCode,
        level: entry.level,
        skipReason: entry.redactedJson?.skipReason,
      })),
      [{
        eventCode: "mailbox.consume_ack_skipped",
        level: "info",
        skipReason: "pending_assistant_input",
      }],
    );
  });

  test("skips the ack when the conversation watermark is still empty", async () => {
    const { consumeAckLogEntries, consumeRequests } = await runConsumeAckScenario({
      items: [],
      async runAssistantPhase() {
        return { foregroundReplyFailed: 0, progressed: false };
      },
    });

    assert.deepEqual(consumeRequests, []);
    assert.deepEqual(
      consumeAckLogEntries.map((entry) => ({
        eventCode: entry.eventCode,
        level: entry.level,
        skipReason: entry.redactedJson?.skipReason,
      })),
      [{
        eventCode: "mailbox.consume_ack_skipped",
        level: "info",
        skipReason: "empty_watermark",
      }],
    );
  });

  test("warns when the platform mailbox port has no consume", async () => {
    const { consumeAckLogEntries, consumeRequests } = await runConsumeAckScenario({
      withoutConsumePort: true,
      async runAssistantPhase() {
        return { foregroundReplyFailed: 0, progressed: false };
      },
    });

    assert.deepEqual(consumeRequests, []);
    assert.deepEqual(
      consumeAckLogEntries.map((entry) => ({
        eventCode: entry.eventCode,
        level: entry.level,
        skipReason: entry.redactedJson?.skipReason,
      })),
      [{
        eventCode: "mailbox.consume_ack_skipped",
        level: "warn",
        skipReason: "consume_port_missing",
      }],
    );
  });

  test("treats a failed consume ack as best-effort and finishes the pass", async () => {
    const { consumeAckLogEntries, consumeRequests } = await runConsumeAckScenario({
      consumeError: new Error("synthetic consume outage"),
      async runAssistantPhase() {
        return { foregroundReplyFailed: 0, progressed: false };
      },
    });

    assert.equal(consumeRequests.length, 1);
    // The failed ack logs through the existing failure path, not as an advance.
    assert.deepEqual(consumeAckLogEntries, []);
  });
});

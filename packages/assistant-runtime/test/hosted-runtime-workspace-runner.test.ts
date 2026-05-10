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
  createAssistantOutboxIntent,
  type AssistantTurnInputRefreshResult,
} from "@murphai/assistant-engine";
import type {
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
  initializeVault,
} from "@murphai/core";
import { describe, test, vi } from "vitest";

import {
  HostedMailboxImportCheckpointConflictError,
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
type SyntheticConversationCursor = {
  captureId: string;
  createdAt: string | null;
  occurredAt: string;
};

type SyntheticInputSource = {
  refresh(input: { phase: "input_available" }): Promise<AssistantTurnInputRefreshResult>;
  listNewConversationInputs(input: {
    afterCursor: SyntheticConversationCursor;
    conversation: {
      accountId: string | null;
      actorId: string | null;
      actorIsSelf: boolean;
      source: string;
      threadId: string | null;
      threadIsDirect: boolean | null;
    };
    knownProjectionCaptureIds?: readonly string[];
  }): Promise<{
    inputs: unknown[];
    nextCursor: SyntheticConversationCursor;
  }>;
};

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

  test("imports mailbox locally before the assistant phase without foreground checkpointing", async () => {
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
    const { mailboxPort } = createMailboxPort({ items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
      async onCheckpoint() {
        throw new Error("Foreground assistant turns must not checkpoint the workspace.");
      },
    });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
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
              events.push("mailbox:afterCheckpoint");
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
          assert.equal(input.platform.refreshMailboxForActiveTurnInput !== undefined, true);
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
      assert.equal(result.initialMailboxImport.state.watermarks.conversation, "1");
      assert.equal(result.deferredCheckpointRequired, true);
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
              phase: "import",
              redactedJson: {
                blockCodes: [],
                blockedCount: 0,
                checkpointDeferred: true,
                checkpointed: false,
                conversationSeqEnd: "1",
                conversationSeqStart: "0",
                fetchedCount: 1,
                importedCount: 1,
                laneCount: 2,
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
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("marks deferred foreground mailbox imports as live for same-snapshot restore", async () => {
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

      assert.deepEqual(artifactGetCalls, []);
      assert.equal(await readFile(path.join(vaultRoot, "live-mailbox-state.txt"), "utf8"), "seq=1\n");
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
          id: "mailbox_item_runner_never_resolving_effect",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await withTestTimeout(
        runHostedWorkspaceUntilIdleOrBudget({
          checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
            attemptId: "attempt_synthetic_runner_never_resolving_effect",
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
                return await new Promise<HostedMailboxPostCheckpointEffectResult>(() => {});
              },
              status: "imported",
            };
          },
          limitPerLane: 10,
          platform: createPlatform({
            mailboxPort,
            workspacePort: createWorkspacePort({ checkpointRequests }),
          }),
          requestId: "request_synthetic_runner_never_resolving_effect",
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

      assert.deepEqual(events.slice(0, 2), [
        "import:1",
        "assistant:input.reply-started",
      ]);
      assert.deepEqual(checkpointRequests, []);
    } finally {
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
    const sendLinq: NonNullable<HostedRuntimeEffectsPort["sendLinq"]> = vi.fn(
      async (request) => {
        transportRequests.push({ idempotencyKey: request.idempotencyKey ?? null });
        if (!request.idempotencyKey) {
          throw new Error("Expected Linq fast dispatch to carry an idempotency key.");
        }
        const idempotencyKey = request.idempotencyKey;
        assert.equal(idempotencyKey, "assistant-outbox:crash-window-linq");
        const existing = externalMessages.get(idempotencyKey);
        if (existing) {
          return existing;
        }
        const created = {
          providerMessageId: `provider_synthetic_linq_${externalMessages.size + 1}`,
          providerThreadId: "thread_synthetic_linq_crash_window",
          target: "thread_synthetic_linq_crash_window",
        };
        externalMessages.set(idempotencyKey, created);
        return created;
      },
    );

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
        sendLinq,
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
      assert.equal(result.deferredCheckpointRequired, true);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("schedules staged mailbox projection effects after assistant input sampling without an extra checkpoint", async () => {
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
      ]);
      assert.deepEqual(logRequests[1]?.entries[0]?.redactedJson, {
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

  test("schedules mailbox post-checkpoint effects after assistant failure without an extra checkpoint", async () => {
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
        fetchRequests.map((request) =>
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
        blockCodes: ["lane.gap"],
        blockedCount: 1,
        checkpointDeferred: true,
        checkpointed: false,
        conversationSeqEnd: "0",
        conversationSeqStart: "0",
        fetchedCount: 1,
        importedCount: 0,
        laneCount: 2,
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
      assert.equal(result.deferredCheckpointRequired, true);
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

  test("active-turn refresh imports late conversation input without foreground checkpointing", async () => {
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
    const logRequests: HostedRuntimeLogRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
    });

    try {
      let caught: unknown;
      let result: Awaited<ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget>> | null = null;
      try {
        result = await runHostedWorkspaceUntilIdleOrBudget({
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
            if (item.item.laneSeq === "2") {
              return { status: "imported" };
            }
            return { status: "imported" };
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
          async runAssistantPhase(input) {
            items.push(createMailboxItem({
              id: "mailbox_item_runner_late",
              laneSeq: "2",
              occurredAt: "2026-04-26T00:00:02.000Z",
            }));

            const inputSource: SyntheticInputSource = {
              async refresh(refreshInput) {
                assert.equal(refreshInput.phase, "input_available");
                events.push("refresh:start");
                const refreshMailbox = input.platform.refreshMailboxForActiveTurnInput;
                if (typeof refreshMailbox !== "function") {
                  throw new Error("Expected hosted mailbox refresh to be installed.");
                }
                const refresh = await refreshMailbox({
                  requestId: "request_synthetic_runner_active_turn_input",
                });
                events.push("refresh:done");
                return refresh;
              },
              async listNewConversationInputs(query) {
                events.push("list");
                return {
                  inputs: importedSeqs.includes("2")
                    ? [
                        {
                          accountId: null,
                          actorId: "actor_synthetic",
                          actorIsSelf: false,
                          actorName: "Sender",
                          attachmentCount: 0,
                          captureId: "capture_synthetic_late",
                          createdAt: "2026-04-26T00:00:02.000Z",
                          envelopePath: "capture-envelope-redacted",
                          eventId: "event_synthetic_late",
                          externalId: "external_synthetic_late",
                          occurredAt: "2026-04-26T00:00:02.000Z",
                          promotions: [],
                          receivedAt: "2026-04-26T00:00:02.100Z",
                          source: "telegram",
                          text: null,
                          threadId: "thread_synthetic",
                          threadIsDirect: true,
                          threadTitle: null,
                        },
                      ]
                    : [],
                  nextCursor: importedSeqs.includes("2")
                    ? {
                        captureId: "capture_synthetic_late",
                        createdAt: "2026-04-26T00:00:02.000Z",
                        occurredAt: "2026-04-26T00:00:02.000Z",
                    }
                    : query.afterCursor,
                };
              },
            };
            await inputSource.refresh({
              phase: "input_available",
            });
            const checkpointActiveTurnInput = input.platform.checkpointActiveTurnInput;
            if (typeof checkpointActiveTurnInput !== "function") {
              throw new Error("Expected hosted active-turn checkpoint to be installed.");
            }
            await checkpointActiveTurnInput({
              acceptedInputIds: ["request-1"],
              providerRequestOrdinal: 0,
              requestId: "request_synthetic_runner_active_turn_input",
              sessionId: "session_synthetic",
              turnId: "turn_synthetic",
              vault: vaultRoot,
            });
            const lateInputs = await inputSource.listNewConversationInputs({
              afterCursor: {
                captureId: "capture_synthetic_initial",
                createdAt: "2026-04-26T00:00:01.000Z",
                occurredAt: "2026-04-26T00:00:01.000Z",
              },
              conversation: {
                accountId: null,
                actorId: "actor_synthetic",
                actorIsSelf: false,
                source: "telegram",
                threadId: "thread_synthetic",
                threadIsDirect: true,
              },
              knownProjectionCaptureIds: ["capture_synthetic_initial"],
            });
            assert.equal(lateInputs.inputs.length, 1);
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
          workspace: createWorkspaceState({ version: "0" }),
          now: () => TEST_NOW,
        });
      } catch (error) {
        caught = error;
      }

      assert.equal(caught, undefined);
      assert.ok(result);
      assert.deepEqual(events, [
        "refresh:start",
        "refresh:done",
        "list",
      ]);
      assert.deepEqual(importedSeqs, ["1", "2"]);
      assert.equal(result.initialMailboxImport.state.watermarks.conversation, "1");
      assert.equal(result.latestMailboxImport.state.watermarks.conversation, "2");
      assert.equal(result.deferredCheckpointRequired, true);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "system" },
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
        mailboxSeqEnd: "2",
        mailboxSeqStart: "1",
        phase: "active_turn_input",
        redactedJson: {
          blockCodes: [],
          blockedCount: 0,
          checkpointDeferred: true,
          checkpointed: false,
          conversationSeqEnd: "2",
          conversationSeqStart: "1",
          fetchedCount: 1,
          importedCount: 1,
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

  test("active-turn refresh keeps accepted input and reply intent local when optional lanes degrade", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_active_turn_degraded_initial",
        laneSeq: "1",
      }),
    ];
    const importedSeqs: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const { mailboxPort } = createMailboxPort({ fetchRequests, items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
    });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_active_turn_degraded",
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
          if (item.item.laneSeq === "2") {
            return {
              afterCheckpoint: async () => {
                events.push("optional:active-turn-projection");
                throw Object.assign(new Error("active-turn projection unavailable"), {
                  code: "ACTIVE_TURN_PROJECTION_UNAVAILABLE",
                });
              },
              status: "imported",
            };
          }
          return { status: "imported" };
        },
        limitPerLane: 10,
        platform: {
          ...createPlatform({
            mailboxPort,
            workspacePort,
          }),
          logPort: {
            async write() {
              events.push("optional:log");
              throw new Error("log export unavailable");
            },
          },
        },
        requestId: "request_synthetic_runner_active_turn_degraded",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_active_turn_degraded",
          leaseGeneration: "4",
          workspaceVersion: "0",
        },
        async runAssistantPhase(input) {
          events.push("assistant:start");
          items.push(createMailboxItem({
            id: "mailbox_item_runner_active_turn_degraded_late",
            laneSeq: "2",
            occurredAt: "2026-04-26T00:00:02.000Z",
          }));

          const refreshMailbox = input.platform.refreshMailboxForActiveTurnInput;
          if (typeof refreshMailbox !== "function") {
            throw new Error("Expected hosted mailbox refresh to be installed.");
          }
          events.push("refresh:start");
          const refresh = await refreshMailbox({
            requestId: "request_synthetic_runner_active_turn_degraded_input",
          });
          events.push("refresh:done");
          assert.deepEqual(refresh, {
            progressed: true,
            reason: "ingested_input",
          });

          const checkpointActiveTurnInput = input.platform.checkpointActiveTurnInput;
          if (typeof checkpointActiveTurnInput !== "function") {
            throw new Error("Expected hosted active-turn checkpoint to be installed.");
          }
          await checkpointActiveTurnInput({
            acceptedInputIds: ["request-1", "request-2"],
            providerRequestOrdinal: 1,
            requestId: "request_synthetic_runner_active_turn_degraded_input",
            sessionId: "session_synthetic",
            turnId: "turn_synthetic",
            vault: vaultRoot,
          });
          events.push("accepted");

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
      assert.deepEqual(importedSeqs, ["1", "2"]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "system" },
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "1", lane: "conversation" },
        ],
      ]);
      assert.deepEqual(events, [
        "import:1",
        "optional:log",
        "assistant:start",
        "refresh:start",
        "import:2",
        "optional:log",
        "refresh:done",
        "optional:log",
        "accepted",
        "optional:log",
        "optional:active-turn-projection",
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

  test("suppresses runtime logs for idle active-turn mailbox refresh polls", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_idle_active_turn_initial",
        laneSeq: "1",
      }),
    ];
    const { mailboxPort } = createMailboxPort({ items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
    });

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_idle_active_turn",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
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
          logRequests,
          mailboxPort,
          workspacePort,
        }),
        requestId: "request_synthetic_runner_idle_active_turn",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_idle_active_turn",
          leaseGeneration: "4",
          workspaceVersion: "0",
        },
        async runAssistantPhase(input) {
          const refreshMailbox = input.platform.refreshMailboxForActiveTurnInput;
          if (typeof refreshMailbox !== "function") {
            throw new Error("Expected hosted mailbox refresh to be installed.");
          }
          const refresh = await refreshMailbox({
            requestId: "request_synthetic_runner_idle_active_turn_input",
          });
          assert.deepEqual(refresh, {
            progressed: false,
            reason: "no_new_input",
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

      assert.deepEqual(
        logRequests.map((request) => request.entries[0]?.phase),
        ["import", "checkpoint"],
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

  test("accepts active-turn input without foreground checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_initial",
        laneSeq: "1",
      }),
    ];
    const { mailboxPort } = createMailboxPort({ items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
    });

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_acceptance",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
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
        requestId: "request_synthetic_runner_acceptance",
        async runAssistantPhase(input) {
          const checkpointActiveTurnInput = input.platform.checkpointActiveTurnInput;
          if (typeof checkpointActiveTurnInput !== "function") {
            throw new Error("Expected hosted active-turn checkpoint to be installed.");
          }
          await checkpointActiveTurnInput({
            acceptedInputIds: ["request-1"],
            providerRequestOrdinal: 0,
            requestId: "request_synthetic_runner_acceptance",
            sessionId: "session_synthetic",
            turnId: "turn_synthetic",
            vault: vaultRoot,
          });
          return {};
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not checkpoint active-turn input acceptance when scheduled wake fields exist", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_scheduled_wake",
          laneSeq: "1",
        }),
      ],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const nextWakeAt = "2026-04-26T00:05:00.000Z";

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_acceptance_wake",
          expectedWorkspaceVersion: "0",
          leaseGeneration: "4",
          nextWakeAt,
          nextWakeReason: "assistant",
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
        requestId: "request_synthetic_runner_acceptance_wake",
        async runAssistantPhase(input) {
          const checkpointActiveTurnInput = input.platform.checkpointActiveTurnInput;
          if (typeof checkpointActiveTurnInput !== "function") {
            throw new Error("Expected hosted active-turn checkpoint to be installed.");
          }
          await checkpointActiveTurnInput({
            acceptedInputIds: ["request-1"],
            providerRequestOrdinal: 0,
            requestId: "request_synthetic_runner_acceptance_wake",
            sessionId: "session_synthetic",
            turnId: "turn_synthetic",
            vault: vaultRoot,
          });
          return {};
        },
        vaultRoot,
        workspace: createWorkspaceState({
          nextWakeAt,
          nextWakeReason: "assistant",
          version: "0",
        }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
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
      assert.equal(result.deferredCheckpointRequired, false);
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
      assert.equal(result.deferredCheckpointRequired, true);
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
      assert.equal(result.deferredCheckpointRequired, true);
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
      assert.equal(result.deferredCheckpointRequired, true);
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

      const effectLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "mailbox.post_checkpoint_effects_finished");
      assert.ok(effectLog);
      assert.doesNotThrow(() => parseHostedRuntimeLogRequest({ entries: [effectLog] }));
      assert.equal(effectLog?.level, "warn");
      assert.deepEqual(effectLog?.redactedJson, {
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
      assert.equal(result.deferredCheckpointRequired, true);
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

  test("summarizes active-turn refreshes without exposing payload state", async () => {
    const idle = await runActiveTurnRefreshSummaryScenario({
      lateItem: null,
    });
    assert.deepEqual(idle, {
      progressed: false,
      reason: "no_new_input",
    });

    const retryable = await runActiveTurnRefreshSummaryScenario({
      lateItem: createMailboxItem({
        createdAt: "9999-01-01T00:00:00.000Z",
        id: "mailbox_item_runner_sidecar_retry",
        laneSeq: "2",
        payloadInlineCiphertext: null,
        payloadRef: "hosted-mailbox-payload:mailbox_item_runner_sidecar_retry",
      }),
      payloadsUnavailable: true,
    });
    assert.deepEqual(retryable, {
      progressed: false,
      reason: "source_unavailable",
    });

    const quarantined = await runActiveTurnRefreshSummaryScenario({
      lateItem: createMailboxItem({
        id: "mailbox_item_runner_quarantine",
        laneSeq: "2",
        payloadSchema: "murph.invalid-hosted-mailbox-item.v1",
      }),
    });
    assert.deepEqual(quarantined, {
      progressed: true,
      reason: "ingested_input",
    });
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

  test("keeps active-turn mailbox state local when foreground import checkpoints are disabled", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_stale_refresh_initial",
        laneSeq: "1",
      }),
    ];
    const { mailboxPort } = createMailboxPort({
      items,
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
      checkpointed: (request) => request.reason !== "import" || request.expectedWorkspaceVersion !== "1",
    });

    try {
      let caught: unknown;
      try {
        await runHostedWorkspaceUntilIdleOrBudget({
          checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
            attemptId: "attempt_synthetic_runner_stale_refresh",
            expectedWorkspaceVersion: "0",
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
          requestId: "request_synthetic_runner_stale_refresh",
          async runAssistantPhase(phaseInput) {
            items.push(createMailboxItem({
              id: "mailbox_item_runner_stale_refresh_late",
              laneSeq: "2",
              occurredAt: "2026-04-26T00:00:02.000Z",
            }));
            const refreshMailbox = phaseInput.platform.refreshMailboxForActiveTurnInput;
            if (typeof refreshMailbox !== "function") {
              throw new Error("Expected hosted mailbox refresh to be installed.");
            }
            await refreshMailbox({
              requestId: "request_synthetic_runner_stale_refresh_active_turn_input",
            });
            return {};
          },
          vaultRoot,
          workspace: createWorkspaceState({ version: "0" }),
        });
      } catch (error) {
        caught = error;
      }

      assert.equal(caught, undefined);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
      ]);
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
        "2",
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
    ...(input.usageRecordPort ? { usageRecordPort: input.usageRecordPort } : {}),
    workspacePort: input.workspacePort,
  };
}

function createConversationRuntime(): Pick<
  NormalizedHostedAssistantRuntimeConfig,
  "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
> {
  return {
    forwardedEnv: {},
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
  fetchRequests?: HostedMailboxFetchRequest[];
  fetchUserId?: string;
  items: HostedMailboxItem[];
  payloadsUnavailable?: boolean;
}): {
  mailboxPort: HostedRuntimeMailboxPort;
} {
  const fetchRequests = input.fetchRequests ?? [];

  return {
    mailboxPort: {
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

async function runActiveTurnRefreshSummaryScenario(input: {
  lateItem: HostedMailboxItem | null;
  payloadsUnavailable?: boolean;
}) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
  const items = [
    createMailboxItem({
      id: "mailbox_item_runner_summary_initial",
      laneSeq: "1",
    }),
  ];
  const { mailboxPort } = createMailboxPort({
    items,
    payloadsUnavailable: input.payloadsUnavailable,
  });
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const logRequests: HostedRuntimeLogRequest[] = [];
  let refreshResult: AssistantTurnInputRefreshResult | null = null;

  try {
    await runHostedWorkspaceUntilIdleOrBudget({
      checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
        attemptId: "attempt_synthetic_runner_summary",
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
        logRequests,
        mailboxPort,
        workspacePort: createWorkspacePort({ checkpointRequests }),
      }),
      requestId: "request_synthetic_runner_summary",
      async runAssistantPhase(phaseInput) {
        if (input.lateItem) {
          items.push(input.lateItem);
        }
        const refreshMailbox = phaseInput.platform.refreshMailboxForActiveTurnInput;
        if (typeof refreshMailbox !== "function") {
          throw new Error("Expected hosted mailbox refresh to be installed.");
        }
        refreshResult = await refreshMailbox({
          requestId: "request_synthetic_runner_summary_active_turn_input",
        });
        return {};
      },
      vaultRoot,
      workspace: createWorkspaceState({ version: "0" }),
    });

    if (!refreshResult) {
      throw new Error("Expected active-turn refresh result.");
    }
    return refreshResult;
  } finally {
    await rm(vaultRoot, {
      force: true,
      recursive: true,
    });
  }
}

async function runFastDispatchCrashWindowAttempt(input: {
  checkpointRequests: HostedWorkspaceCheckpointRequest[];
  effectObservations: Array<{ effectId: string; idempotencyKey: string | null }>;
  sendLinq: NonNullable<HostedRuntimeEffectsPort["sendLinq"]>;
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
      effectsPort: {
        sendLinq: input.sendLinq,
      },
      mailboxPort,
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
      await prepareHostedAssistantDeliveryEffectsForDispatch({
        assistantDeliveryEffects: effects,
        now: () => TEST_NOW,
        vaultRoot: input.vaultRoot,
      });
      const outcomes = await drainHostedPreparedAssistantDeliveries({
        allowPreparedSending: true,
        assistantDeliveryEffects: effects,
        effectsPort: phaseInput.platform.effectsPort,
        forwardedEnv: {},
        platformEnv: {},
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

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  AssistantActiveTurnInputCheckpointRejectedError,
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
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  listPendingAssistantRuntimeIssueRecords,
  listPendingAssistantUsageRecords,
  resolveAssistantStatePaths,
  resolvePendingAssistantUsagePath,
  writePendingAssistantUsageRecord,
} from "@murphai/runtime-state/node";
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
} from "../src/hosted-runtime.ts";
import {
  createHostedConversationMailboxImportItem,
} from "../src/hosted-runtime/mailbox-conversation-import.ts";
import {
  createEmptyHostedMailboxImportState,
  readHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import {
  HostedMailboxUserMismatchError,
  type HostedMailboxPostCheckpointEffectResult,
} from "../src/hosted-runtime/mailbox-import.ts";
import type {
  NormalizedHostedAssistantRuntimeConfig,
} from "../src/hosted-runtime/models.ts";
import type {
  HostedRuntimeMailboxPort,
  HostedRuntimeUsageExportPort,
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
      reason: "maintenance",
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

  test("imports mailbox and checkpoints before the assistant phase without inbox bootstrap", async () => {
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
      async onCheckpoint(request) {
        events.push(`checkpoint:${request.reason}`);
        const state = await readHostedMailboxImportState({ vaultRoot });
        assert.equal(state.watermarks.conversation, "1");
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
          assert.equal(input.initialMailboxImport.checkpoint?.checkpointed, true);
          assert.equal(input.platform.refreshMailboxForActiveTurnInput !== undefined, true);
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
        "checkpoint:import",
        "mailbox:afterCheckpoint",
        "assistant",
      ]);
      assert.equal(result.initialMailboxImport.state.watermarks.conversation, "1");
      assert.equal(result.latestWorkspace?.version, "1");
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.attemptId, "attempt_synthetic_runner_001");
      assert.equal(checkpointRequests[0]?.leaseGeneration, "1");
      assert.equal(checkpointRequests[0]?.expectedWorkspaceVersion, "0");
      assert.equal(checkpointRequests[0]?.reason, "import");
      assert.deepEqual(checkpointRequests[0]?.browserVaultReplicaRef, TEST_BROWSER_VAULT_REPLICA_REF);
      assert.deepEqual(checkpointRequests[0]?.redactedStatus, {
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "1",
        hostedMailboxFetchedCount: 1,
        hostedMailboxImportedCount: 1,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
      });
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
                checkpointed: true,
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

  test("drains staged mailbox projection effects before assistant input sampling without an extra checkpoint", async () => {
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

      assert.deepEqual(events, [
        "import:1",
        "mailbox:afterCheckpoint",
        "assistant",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "import",
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

  test("exports pending usage after a successful assistant checkpoint and checkpoints cleanup", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const exportedUsageIds: string[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_usage",
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
          logRequests,
          mailboxPort,
          usageExportPort: {
            async recordUsage(usage) {
              exportedUsageIds.push(...usage.map((record) => {
                const usageId = Reflect.get(record, "usageId");
                if (typeof usageId !== "string") {
                  throw new Error("Expected exported usage id.");
                }
                return usageId;
              }));
              return {
                recorded: exportedUsageIds.length,
                usageIds: exportedUsageIds,
              };
            },
          },
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_usage",
        runtimeLogContext: {
          attemptId: "attempt_synthetic_runner_usage",
          leaseGeneration: "1",
          workspaceVersion: "0",
        },
        async runAssistantPhase() {
          await writePendingHostedUsageRecord(vaultRoot, "turn_runner_usage");
          return {
            checkpointReason: "maintenance",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(exportedUsageIds, ["turn_runner_usage.attempt-1"]);
      assert.deepEqual(await listPendingAssistantUsageRecords({ vault: vaultRoot }), []);
      assert.deepEqual(
        checkpointRequests.map((request) => request.reason),
        ["maintenance", "maintenance"],
      );
      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["0", "1"],
      );
      assert.equal(
        checkpointRequests[1]?.redactedStatus?.hostedUsageCleanupCheckpoint,
        true,
      );
      const usageLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "runtime.usage_export_finished");
      assert.deepEqual(usageLog?.redactedJson, {
        cleanupCheckpointed: true,
        exported: 1,
        failed: 0,
        invalid: 0,
        pending: 0,
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("leaves pending usage when post-checkpoint export fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_usage_export_failed",
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
          logRequests,
          mailboxPort,
          usageExportPort: {
            async recordUsage() {
              throw new Error("usage export unavailable");
            },
          },
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_usage_export_failed",
        async runAssistantPhase() {
          await writePendingHostedUsageRecord(vaultRoot, "turn_runner_usage_export_failed");
          return {
            checkpointReason: "maintenance",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(
        (await listPendingAssistantUsageRecords({ vault: vaultRoot }))
          .map((record) => record.usageId),
        ["turn_runner_usage_export_failed.attempt-1"],
      );
      assert.equal(checkpointRequests.length, 1);
      const usageLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "runtime.usage_export_finished");
      assert.equal(usageLog?.level, "warn");
      assert.deepEqual(usageLog?.redactedJson, {
        cleanupCheckpointed: false,
        exported: 0,
        failed: 1,
        invalid: 0,
        pending: 1,
      });
    } finally {
      warn.mockRestore();
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not fail already checkpointed assistant work when usage cleanup checkpoint fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });

    try {
      const result = await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_usage_cleanup_failed",
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
          logRequests,
          mailboxPort,
          usageExportPort: {
            async recordUsage(usage) {
              const usageId = Reflect.get(usage[0], "usageId");
              if (typeof usageId !== "string") {
                throw new Error("Expected exported usage id.");
              }
              return {
                recorded: 1,
                usageIds: [usageId],
              };
            },
          },
          workspacePort: createWorkspacePort({
            checkpointRequests,
            checkpointed(request) {
              return request.redactedStatus?.hostedUsageCleanupCheckpoint !== true;
            },
          }),
        }),
        requestId: "request_synthetic_runner_usage_cleanup_failed",
        async runAssistantPhase() {
          await writePendingHostedUsageRecord(vaultRoot, "turn_runner_usage_cleanup_failed");
          return {
            checkpointReason: "maintenance",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.equal(result.latestWorkspace?.version, "1");
      assert.deepEqual(await listPendingAssistantUsageRecords({ vault: vaultRoot }), []);
      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["0", "1"],
      );
      const usageLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "runtime.usage_export_finished");
      assert.equal(usageLog?.level, "warn");
      assert.equal(usageLog?.errorCode, "usage_cleanup_checkpoint_failed");
      assert.deepEqual(usageLog?.redactedJson, {
        cleanupCheckpointed: false,
        exported: 1,
        failed: 0,
        invalid: 0,
        pending: 0,
      });
    } finally {
      warn.mockRestore();
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("records a durable checkpoint when malformed pending usage creates a runtime issue", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
          attemptId: "attempt_synthetic_runner_usage_invalid",
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
        requestId: "request_synthetic_runner_usage_invalid",
        async runAssistantPhase() {
          await writeMalformedPendingUsageFile(vaultRoot, "turn_runner_usage_invalid.unexpected-1");
          return {
            checkpointReason: "maintenance",
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["0", "1"],
      );
      assert.equal(
        checkpointRequests[1]?.redactedStatus?.hostedUsageInvalidIssueRecorded,
        true,
      );
      assert.equal(
        checkpointRequests[1]?.redactedStatus?.hostedUsageCleanupCheckpoint,
        false,
      );
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
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.reason, "import");
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("checkpoints reply intent even when optional runner lanes are degraded", async () => {
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
            usageExportPort: {
              async recordUsage() {
                events.push("optional:usage-export");
                throw new Error("usage export unavailable");
              },
            },
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
          await writePendingHostedUsageRecord(vaultRoot, "turn_runner_liveness_optional_degraded");
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

      assert.equal(result.assistantPhaseResult?.progressed, true);
      assert.equal(result.latestWorkspace?.version, "2");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "import",
        "outbox_sending",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["0", "1"],
      );
      assert.equal(checkpointRequests[0]?.browserVaultReplicaRef, null);
      assert.deepEqual(checkpointRequests[1]?.redactedStatus, {
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "1",
        hostedMailboxFetchedCount: 1,
        hostedMailboxImportedCount: 1,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
        hostedOutboxSendingCheckpointed: true,
      });
      assert.deepEqual(events, [
        "import:1",
        "optional:log",
        "optional:projection",
        "optional:log",
        "assistant",
        "optional:usage-export",
        "optional:log",
      ]);
      assert.deepEqual(
        (await listPendingAssistantUsageRecords({ vault: vaultRoot }))
          .map((record) => record.usageId),
        ["turn_runner_liveness_optional_degraded.attempt-1"],
      );
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

      assert.deepEqual(events, [
        "import:1",
        "mailbox:afterCheckpoint",
        "assistant",
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.reason, "import");
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
        "import",
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
            checkpointReason: "maintenance",
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
        "maintenance",
      ]);
      assert.equal(secondCheckpointRequests[0]?.expectedWorkspaceVersion, "1");
      assert.deepEqual(secondCheckpointRequests[0]?.redactedStatus, {
        hostedAssistantReplayHandledCount: 1,
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "1",
        hostedMailboxFetchedCount: 0,
        hostedMailboxImportedCount: 0,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("exports pending usage when the assistant phase throws before checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const usageExportCalls: string[] = [];
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_usage_no_drain",
          laneSeq: "1",
        }),
      ],
    });

    try {
      await assert.rejects(
        () =>
          runHostedWorkspaceUntilIdleOrBudget({
            checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
              attemptId: "attempt_synthetic_runner_usage_no_drain",
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
              mailboxPort,
              usageExportPort: {
                async recordUsage(usage) {
                  const usageIds = usage.map((record) => {
                    const usageId = Reflect.get(record, "usageId");
                    if (typeof usageId !== "string") {
                      throw new Error("Expected exported usage id.");
                    }
                    return usageId;
                  });
                  usageExportCalls.push(...usageIds);
                  return {
                    recorded: usageIds.length,
                    usageIds,
                  };
                },
              },
              workspacePort: createWorkspacePort({ checkpointRequests }),
            }),
            requestId: "request_synthetic_runner_usage_no_drain",
            async runAssistantPhase() {
              await writePendingHostedUsageRecord(vaultRoot, "turn_runner_usage_no_drain");
              throw new Error("assistant failed before checkpoint");
            },
            vaultRoot,
            workspace: createWorkspaceState({ version: "0" }),
            now: () => TEST_NOW,
          }),
        /assistant failed before checkpoint/u,
      );

      assert.deepEqual(usageExportCalls, ["turn_runner_usage_no_drain.attempt-1"]);
      assert.deepEqual(
        (await listPendingAssistantUsageRecords({ vault: vaultRoot }))
          .map((record) => record.usageId),
        [],
      );
      assert.equal(checkpointRequests.length, 2);
      assert.equal(checkpointRequests[0]?.reason, "import");
      assert.equal(checkpointRequests[1]?.reason, "maintenance");
      assert.equal(checkpointRequests[1]?.redactedStatus?.hostedUsageExportedCount, 1);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("checkpoints pending usage and records a runtime issue when assistant failure recovery export fails", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const usageExportCalls: string[] = [];
    const { mailboxPort } = createMailboxPort({
      items: [
        createMailboxItem({
          id: "mailbox_item_runner_usage_recovery_failed",
          laneSeq: "1",
        }),
      ],
    });

    try {
      await assert.rejects(
        () =>
          runHostedWorkspaceUntilIdleOrBudget({
            checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
              attemptId: "attempt_synthetic_runner_usage_recovery_failed",
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
              usageExportPort: {
                async recordUsage(usage) {
                  usageExportCalls.push(
                    ...usage.map((record) => {
                      const usageId = Reflect.get(record, "usageId");
                      if (typeof usageId !== "string") {
                        throw new Error("Expected exported usage id.");
                      }
                      return usageId;
                    }),
                  );
                  throw new Error("synthetic usage export failure");
                },
              },
              workspacePort: createWorkspacePort({ checkpointRequests }),
            }),
            requestId: "request_synthetic_runner_usage_recovery_failed",
            async runAssistantPhase() {
              await writePendingHostedUsageRecord(vaultRoot, "turn_runner_usage_recovery_failed");
              throw new Error("assistant failed before checkpoint");
            },
            vaultRoot,
            workspace: createWorkspaceState({ version: "0" }),
            now: () => TEST_NOW,
          }),
        /assistant failed before checkpoint/u,
      );

      assert.deepEqual(usageExportCalls, ["turn_runner_usage_recovery_failed.attempt-1"]);
      assert.deepEqual(
        (await listPendingAssistantUsageRecords({ vault: vaultRoot }))
          .map((record) => record.usageId),
        ["turn_runner_usage_recovery_failed.attempt-1"],
      );
      const issues = await listPendingAssistantRuntimeIssueRecords({ vault: vaultRoot });
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.errorCode, "pending_usage_may_be_stranded");
      assert.equal(issues[0]?.operation, "pending_usage_may_be_stranded");

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "import",
        "maintenance",
      ]);
      assert.equal(checkpointRequests[1]?.redactedStatus?.hostedUsagePendingCount, 1);
      assert.equal(checkpointRequests[1]?.redactedStatus?.hostedUsageStrandedIssueRecorded, true);

      const usageLog = logRequests
        .flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "runtime.usage_export_finished");
      assert.equal(usageLog?.level, "warn");
      assert.equal(usageLog?.redactedJson?.pending, 1);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("recovers pending usage on assistant failure when restored workspace had no import checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const usageExportCalls: string[] = [];
    const { mailboxPort } = createMailboxPort({ items: [] });

    try {
      await assert.rejects(
        () =>
          runHostedWorkspaceUntilIdleOrBudget({
            checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
              attemptId: "attempt_synthetic_runner_usage_replay_no_import_checkpoint",
              expectedWorkspaceVersion: "7",
              leaseGeneration: "1",
              nextWakeAt: "2026-04-26T01:00:00.000Z",
              nextWakeReason: "assistant",
              snapshotRef: null,
            }),
            expectedUserId: TEST_USER_ID,
            async importItem() {
              throw new Error("Import should not run without new mailbox items.");
            },
            limitPerLane: 10,
            platform: createPlatform({
              mailboxPort,
              usageExportPort: {
                async recordUsage(usage) {
                  const usageIds = usage.map((record) => {
                    const usageId = Reflect.get(record, "usageId");
                    if (typeof usageId !== "string") {
                      throw new Error("Expected exported usage id.");
                    }
                    return usageId;
                  });
                  usageExportCalls.push(...usageIds);
                  return {
                    recorded: usageIds.length,
                    usageIds,
                  };
                },
              },
              workspacePort: createWorkspacePort({ checkpointRequests }),
            }),
            requestId: "request_synthetic_runner_usage_replay_no_import_checkpoint",
            async runAssistantPhase(input) {
              assert.equal(input.initialMailboxImport.stateChanged, false);
              await writePendingHostedUsageRecord(vaultRoot, "turn_runner_usage_replay_no_import_checkpoint");
              throw new Error("assistant failed before replay checkpoint");
            },
            vaultRoot,
            workspace: createWorkspaceState({
              nextWakeAt: "2026-04-26T01:00:00.000Z",
              nextWakeReason: "assistant",
              version: "7",
            }),
            now: () => TEST_NOW,
          }),
        /assistant failed before replay checkpoint/u,
      );

      assert.deepEqual(usageExportCalls, ["turn_runner_usage_replay_no_import_checkpoint.attempt-1"]);
      assert.deepEqual(
        (await listPendingAssistantUsageRecords({ vault: vaultRoot }))
          .map((record) => record.usageId),
        [],
      );
      assert.deepEqual(checkpointRequests.map((request) => request.reason), ["maintenance"]);
      assert.equal(checkpointRequests[0]?.expectedWorkspaceVersion, "7");
      assert.equal(checkpointRequests[0]?.nextWakeAt, "2026-04-26T01:00:00.000Z");
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(checkpointRequests[0]?.redactedStatus?.hostedUsageExportedCount, 1);
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
        checkpointed: true,
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
      assert.equal(assistantPhaseCalled, true);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("creates checkpoint snapshot refs after mailbox import mutates local state", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const items = [
      createMailboxItem({
        id: "mailbox_item_runner_snapshot_001",
        laneSeq: "1",
      }),
    ];
    const { mailboxPort } = createMailboxPort({ items });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const snapshotWatermarks: string[] = [];

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
        checkpointRequestBuilder: createHostedWorkspaceSnapshotCheckpointRequestBuilder({
          async createSnapshot(snapshotInput) {
            const sourceBundleHash = "a".repeat(64);
            const state = await readHostedMailboxImportState({ vaultRoot });
            snapshotWatermarks.push(state.watermarks.conversation);
            assert.equal(snapshotInput.state.watermarks.conversation, "1");
            assert.deepEqual(snapshotInput.redactedStatus, {
              hostedMailboxBlockedCount: 0,
              hostedMailboxConversationImportedSeq: "1",
              hostedMailboxFetchedCount: 1,
              hostedMailboxImportedCount: 1,
              hostedMailboxRetryableBlockedCount: 0,
              hostedMailboxSystemImportedSeq: "0",
            });
            return {
              browserVaultReplicaRef: {
                ...TEST_BROWSER_VAULT_REPLICA_REF,
                sourceBundleHash,
              },
              snapshotRef: createBundleRef({
                hash: sourceBundleHash,
                key: "users/bundles/member-synthetic/vault/snapshot-after-import.bundle.json",
                size: 512,
              }),
            };
          },
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

      assert.deepEqual(snapshotWatermarks, ["1"]);
      assert.equal(checkpointRequests.length, 1);
      const checkpointSnapshotRef = requireBundleRef(checkpointRequests[0]?.snapshotRef);
      assert.equal(checkpointSnapshotRef.key, "users/bundles/member-synthetic/vault/snapshot-after-import.bundle.json");
      assert.equal(checkpointRequests[0]?.browserVaultReplicaRef?.sourceBundleHash, "a".repeat(64));
      assert.equal(checkpointRequests[0]?.expectedWorkspaceVersion, "0");
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("active-turn refresh imports and checkpoints late conversation input before continuation admission", async () => {
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
      try {
        await runHostedWorkspaceUntilIdleOrBudget({
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
      assert.deepEqual(events, [
        "refresh:start",
        "refresh:done",
        "list",
      ]);
      assert.deepEqual(importedSeqs, ["1", "2"]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "import",
        "active_turn_input",
        "active_turn_acceptance",
        "maintenance",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["0", "1", "2", "3"],
      );
      assert.deepEqual(checkpointRequests[2]?.redactedStatus, {
        acceptedInputCount: 1,
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "2",
        hostedMailboxFetchedCount: 1,
        hostedMailboxImportedCount: 1,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
        providerRequestOrdinal: 0,
      });
      assert.deepEqual(checkpointRequests[3]?.redactedStatus, {
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "2",
        hostedMailboxFetchedCount: 1,
        hostedMailboxImportedCount: 1,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
      });
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
        logRequests.map((request) => request.entries[0]?.eventCode),
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
          checkpointed: true,
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

  test("active-turn refresh still checkpoints accepted input and reply intent when optional lanes degrade", async () => {
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

      assert.equal(result.assistantPhaseResult?.progressed, true);
      assert.equal(result.latestWorkspace?.version, "4");
      assert.deepEqual(importedSeqs, ["1", "2"]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "import",
        "active_turn_input",
        "active_turn_acceptance",
        "outbox_sending",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["0", "1", "2", "3"],
      );
      assert.deepEqual(checkpointRequests[2]?.redactedStatus, {
        acceptedInputCount: 2,
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "2",
        hostedMailboxFetchedCount: 1,
        hostedMailboxImportedCount: 1,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
        providerRequestOrdinal: 1,
      });
      assert.deepEqual(checkpointRequests[3]?.redactedStatus, {
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "2",
        hostedMailboxFetchedCount: 1,
        hostedMailboxImportedCount: 1,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
        hostedOutboxSendingCheckpointed: true,
      });
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
        "optional:active-turn-projection",
        "optional:log",
        "refresh:done",
        "accepted",
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
            progressed: true,
          };
        },
        vaultRoot,
        workspace: createWorkspaceState({ version: "0" }),
        now: () => TEST_NOW,
      });

      assert.deepEqual(
        logRequests.map((request) => request.entries[0]?.phase),
        ["import"],
      );
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "import",
        "maintenance",
      ]);
      assert.deepEqual(checkpointRequests[1]?.redactedStatus, {
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "1",
        hostedMailboxFetchedCount: 1,
        hostedMailboxImportedCount: 1,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("checkpoints accepted active-turn input before the assistant samples a continuation", async () => {
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
        "import",
        "active_turn_acceptance",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["0", "1"],
      );
      assert.deepEqual(checkpointRequests[1]?.redactedStatus, {
        acceptedInputCount: 1,
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "1",
        hostedMailboxFetchedCount: 1,
        hostedMailboxImportedCount: 1,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
        providerRequestOrdinal: 0,
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("preserves scheduled wake fields when checkpointing active-turn input acceptance", async () => {
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
        "import",
        "active_turn_acceptance",
      ]);
      assert.equal(checkpointRequests[1]?.nextWakeAt, nextWakeAt);
      assert.equal(checkpointRequests[1]?.nextWakeReason, "assistant");
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
        "import",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["0"],
      );
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

  test("checkpoints mailbox post-checkpoint effects without an assistant phase", async () => {
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
      assert.equal(result.latestWorkspace?.version, "2");
      assert.equal(checkpointRequests.length, 2);
      assert.equal(checkpointRequests[0]?.reason, "import");
      assert.equal(checkpointRequests[1]?.expectedWorkspaceVersion, "1");
      assert.equal(checkpointRequests[1]?.reason, "maintenance");
      assert.deepEqual(checkpointRequests[1]?.redactedStatus, {
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "1",
        hostedMailboxFetchedCount: 1,
        hostedMailboxImportedCount: 1,
        hostedMailboxProjectionCheckpoint: true,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("logs mailbox post-checkpoint effect failures without blocking checkpointing", async () => {
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
      assert.equal(result.latestWorkspace?.version, "2");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "import",
        "maintenance",
      ]);
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

  test("checkpoints assistant post-commit status after a progressed phase", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
    const { mailboxPort } = createMailboxPort({ items: [] });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await runHostedWorkspaceUntilIdleOrBudget({
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
          mailboxPort,
          workspacePort: createWorkspacePort({ checkpointRequests }),
        }),
        requestId: "request_synthetic_runner_post_checkpoint",
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
        "outbox_sending",
        "outbox_receipt",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["0", "1"],
      );
      assert.deepEqual(checkpointRequests[1]?.redactedStatus, {
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "0",
        hostedMailboxFetchedCount: 0,
        hostedMailboxImportedCount: 0,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
        hostedOutboxDeliveryAttempted: 1,
        hostedOutboxDeliverySent: 1,
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
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
      assert.equal(result.latestWorkspace?.version, "1");
      assert.deepEqual(events, [
        "assistant",
        "optional:post-assistant-cleanup",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "outbox_sending",
      ]);
      assert.deepEqual(checkpointRequests[0]?.redactedStatus, {
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "0",
        hostedMailboxFetchedCount: 0,
        hostedMailboxImportedCount: 0,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
        hostedOutboxSendingCheckpointed: true,
      });

      const postCheckpointFailureLog = logRequests.flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "runner.error");
      assert.ok(postCheckpointFailureLog);
      assert.doesNotThrow(() =>
        parseHostedRuntimeLogRequest({ entries: [postCheckpointFailureLog] })
      );
      assert.equal(postCheckpointFailureLog.errorCode, "assistant_after_checkpoint_failed");
      assert.equal(postCheckpointFailureLog.level, "warn");
      assert.deepEqual(postCheckpointFailureLog.redactedJson, {
        checkpointed: true,
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

  test("fails closed when the workspace checkpoint is stale", async () => {
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
    const workspacePort = createWorkspacePort({
      checkpointed: false,
      checkpointRequests: [],
    });

    try {
      await assert.rejects(
        () =>
          runHostedWorkspaceUntilIdleOrBudget({
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
          }),
        HostedMailboxImportCheckpointConflictError,
      );
      assert.equal(assistantPhaseCalled, false);
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
        "0",
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("rolls back only the active-turn mailbox state when the second checkpoint is stale", async () => {
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
      checkpointed: (request) => request.reason !== "active_turn_input",
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

      assert.ok(caught instanceof HostedMailboxImportCheckpointConflictError);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "import",
        "active_turn_input",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["0", "1"],
      );
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

async function writePendingHostedUsageRecord(
  vaultRoot: string,
  turnId: string,
): Promise<string> {
  const usageId = createAssistantUsageId({
    attemptCount: 1,
    turnId,
  });

  await writePendingAssistantUsageRecord({
    record: {
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
      rawUsageJson: null,
      rawUsageJsonHash: null,
      reasoningTokens: null,
      reportingUserId: null,
      requestedModel: "gpt-5.5",
      routeId: "primary",
      schema: ASSISTANT_USAGE_SCHEMA,
      servedModel: "gpt-5.5",
      sessionId: "asst_synthetic_runner_usage",
      stripeMeterSource: "murph",
      surface: null,
      totalTokens: 15,
      triggerKind: null,
      turnId,
      usageId,
      usageExtractionSourcePath: null,
      usageExtractionVersion: "legacy",
    },
    vault: vaultRoot,
  });

  return usageId;
}

async function writeMalformedPendingUsageFile(
  vaultRoot: string,
  usageId: string,
): Promise<void> {
  const filePath = resolvePendingAssistantUsagePath(resolveAssistantStatePaths(vaultRoot), usageId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify({
      schema: ASSISTANT_USAGE_SCHEMA,
      turnId: "turn_runner_usage_invalid",
      usageId,
    })}\n`,
    "utf8",
  );
}

function createPlatform(input: {
  logRequests?: HostedRuntimeLogRequest[];
  mailboxPort: HostedRuntimeMailboxPort;
  usageExportPort?: HostedRuntimeUsageExportPort;
  workspacePort: HostedRuntimeWorkspacePort;
}) {
  return {
    artifactStore: {
      async get() {
        return null;
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
    ...(input.usageExportPort ? { usageExportPort: input.usageExportPort } : {}),
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

function requireBundleRef(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("hash" in value)) {
    throw new TypeError("Expected a hosted execution bundle ref.");
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.hash !== "string"
    || typeof record.key !== "string"
    || typeof record.size !== "number"
    || typeof record.updatedAt !== "string"
  ) {
    throw new TypeError("Hosted execution bundle ref is malformed.");
  }

  return {
    hash: record.hash,
    key: record.key,
    size: record.size,
    updatedAt: record.updatedAt,
  };
}

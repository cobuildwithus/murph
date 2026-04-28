import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  AssistantActiveTurnInputCheckpointRejectedError,
  type AssistantTurnInputRefreshResult,
  type AssistantTurnInputPort,
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
} from "@murphai/hosted-execution/runtime-control";
import { describe, test } from "vitest";

import {
  HostedMailboxImportCheckpointConflictError,
  createHostedWorkspaceCheckpointRequestBuilder,
  createHostedWorkspaceSnapshotCheckpointRequestBuilder,
  HostedWorkspaceRunnerUserMismatchError,
  runHostedWorkspaceUntilIdleOrBudget,
} from "../src/hosted-runtime.ts";
import {
  readHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import {
  HostedMailboxUserMismatchError,
} from "../src/hosted-runtime/mailbox-import.ts";
import type {
  HostedRuntimeMailboxPort,
  HostedRuntimeWorkspacePort,
} from "../src/hosted-runtime-contracts.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_workspace_runner";
const TEST_BROWSER_VAULT_REPLICA_REF = {
  byteLength: 256,
  dataVersion: "2026-04-26",
  generatedAt: "2026-04-26T00:00:00.000Z",
  keyId: "key_synthetic_runner",
  objectKey: "browser-vault/member-synthetic/replica.json",
  replicaSchema: "murph.browser-vault-replica.v1",
  schema: "murph.hosted-browser-vault-replica-ref.v1",
  sourceBundleHash: "bundle_hash_synthetic_runner",
} as const;

describe("runHostedWorkspaceUntilIdleOrBudget", () => {
  test("bootstraps empty local mailbox state and checkpoints before the assistant phase", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-runner-"));
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
        events.push("checkpoint:import");
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
          events.push(`import:${item.item.laneSeq}`);
          return {
            afterCheckpoint: async () => {
              events.push("mailbox:afterCheckpoint");
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
        "assistant",
        "mailbox:afterCheckpoint",
      ]);
      assert.equal(result.initialMailboxImport.state.watermarks.conversation, "1");
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
      ]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("runs mailbox post-checkpoint effects when the assistant phase throws", async () => {
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
        "assistant",
        "mailbox:afterCheckpoint",
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
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
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
      assert.equal(checkpointRequests[0]?.snapshotRef?.key, "users/bundles/member-synthetic/vault/snapshot-after-import.bundle.json");
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

            const turnInputPort: AssistantTurnInputPort = {
              async refresh(refreshInput) {
                assert.equal(refreshInput.phase, "request_boundary");
                const refreshMailbox = input.platform.refreshMailboxForActiveTurnInput;
                if (typeof refreshMailbox !== "function") {
                  throw new Error("Expected hosted mailbox refresh to be installed.");
                }
                return refreshMailbox({
                  requestId: "request_synthetic_runner_active_turn_input",
                });
              },
              async listNewConversationCaptures(query) {
                return {
                  captures: importedSeqs.includes("2")
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
            await turnInputPort.refresh({
              phase: "request_boundary",
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
            const lateCaptures = await turnInputPort.listNewConversationCaptures({
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
              knownCaptureIds: ["capture_synthetic_initial"],
            });
            assert.equal(lateCaptures.captures.length, 1);
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

function createPlatform(input: {
  logRequests?: HostedRuntimeLogRequest[];
  mailboxPort: HostedRuntimeMailboxPort;
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
    workspacePort: input.workspacePort,
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
            payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
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

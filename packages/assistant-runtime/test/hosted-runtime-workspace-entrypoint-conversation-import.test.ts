import {
  TEST_NOW,
  TEST_USER_ID,
  createAssistantUsageRecord,
  createBundleRef,
  createDeferred,
  createMailboxImportStateBundle,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceSnapshotV2Ref,
  createWorkspaceState,
  ensureHostedBootstrapMetadataForSystemMailboxTest,
  importRuntimeControlSystemMailboxItemForTest,
  readCheckpointConversationWatermark,
  readConversationImportedSeq,
  readConversationImportedSeqs,
  removeTempRoot,
  requireEventIndex,
  stageAssistantInputEventForMailboxItem,
  stagePendingLinqAssistantInputForMailboxItem,
  waitUntil,
  withRealTimeout,
  writeSyntheticAssistantAutoReplyTerminalEvidence,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

import assert from "node:assert/strict";
import { access, appendFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  addCaptureWithLookup,
  CURRENT_VAULT_FORMAT_VERSION,
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  buildIntegrationEvidencePart,
  buildIntegrationIngestRecord,
  findCaptureByLookup,
  initializeVault,
  patchAutomation,
  readHabitatAspect,
  readJsonlRecords,
  repairVault,
  runCanonicalWrite,
  showAutomation,
  upsertAutomation,
  validateVault,
} from "@murphai/core";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  readHostedRuntimeFailurePhaseCode,
  type HostedMailboxFetchRequest,
  type HostedMailboxFetchResponse,
  type HostedMailboxItem,
  type HostedMailboxPayloadFetchRequest,
  type HostedMailboxPayloadFetchResponse,
  type HostedRuntimeRedactedJson,
  type HostedRuntimeLatencyTraceRequest,
  type HostedRuntimeLogRequest,
  type HostedRuntimeAssistantConfigurationControlRequest,
  type HostedRuntimeAssistantConfigurationSnapshot,
  type HostedRuntimeAssistantConfigurationToolResponse,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationRequest,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  ASSISTANT_USAGE_SCHEMA,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import { describe, expect, test, vi } from "vitest";
import {
  createCoalescingRuntimeWakeSignal,
  HostedRuntimeCheckpointInterruptedByWakeError,
  HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError,
  HostedWorkspaceRunnerUserMismatchError,
  drainHostedRuntimeDeferredUsageCompletionsBestEffort,
  parseHostedAssistantWorkspaceRuntimeJobInput,
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedWorkspaceRuntimeJobOptions,
  type HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
} from "../src/hosted-runtime.ts";
import {
  createEmptyHostedMailboxImportState,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
  HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
  readHostedMailboxImportState,
  writeHostedMailboxImportState,
  type HostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";

describe("hosted workspace runtime entrypoint", () => {test("foreground runtime wake imports conversation input after initial mailbox budget exhaustion", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-foreground-direct-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const importedSeqs: string[] = [];
    const foregroundImportContextMilestones: unknown[] = [];
    const expectedImportedSeqs = Array.from({ length: 14 }, (_, index) => String(index + 1));
    const mailboxItems = Array.from({ length: 13 }, (_, index) => {
      const seq = String(index + 1);
      return createMailboxItem({
        id: `mailbox_item_entrypoint_foreground_direct_${seq.padStart(3, "0")}`,
        laneSeq: seq,
      });
    });
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_foreground_budget",
            budget: {
              maxMailboxItems: 12,
            },
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/foreground-direct.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item, context) {
            importedSeqs.push(item.item.laneSeq);
            events.push(`import:${item.item.laneSeq}`);
            if (item.item.laneSeq === "14") {
              foregroundImportContextMilestones.push(
                structuredClone(context?.latencyMilestones ?? null),
              );
            }
            return { status: "imported" };
          },
          latencyMilestones: {
            phaseBreakdown: {
              schemaVersion: 1,
              dispatch: {
                invokeReceivedAtEpochMs: 1_777_000_000_000,
                containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
              },
              boot: { nodeStartupMs: 4321 },
            },
            runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            events.push("assistant");
            mailboxItems.push(createMailboxItem({
              id: "mailbox_item_entrypoint_foreground_direct_014",
              laneSeq: "14",
              occurredAt: "2026-04-27T00:00:14.000Z",
            }));
            runtimeWakeSignal.notify();
            await waitUntil(() => {
              assert.deepEqual(importedSeqs, expectedImportedSeqs);
            });
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map(readConversationImportedSeq), ["0", "12"]);
      assert.deepEqual(fetchRequests.map((request) => request.limitPerLane), [13, 13]);
      assert.deepEqual(
        events.filter((event) => event.startsWith("import:")),
        expectedImportedSeqs.map((seq) => `import:${seq}`),
      );
      assert.ok(events.includes("snapshot:idle_shutdown:14"));
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "14",
      );
      assert.equal(result.status, "budget_exhausted");
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "14");
      expect(foregroundImportContextMilestones).toEqual([
        expect.objectContaining({
          phaseBreakdown: expect.objectContaining({
            schemaVersion: 1,
            dispatch: {
              invokeReceivedAtEpochMs: 1_777_000_000_000,
              containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
            },
            boot: expect.objectContaining({
              nodeStartupMs: 4321,
              restoreWasCold: expect.any(Boolean),
            }),
            wake: expect.objectContaining({
              foregroundWaitResolvedAtEpochMs: expect.any(Number),
              foregroundImportStartedAtEpochMs: expect.any(Number),
            }),
          }),
          runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          runtimePhaseStartedAt: expect.any(String),
          workspaceRestoreDoneAt: expect.any(String),
        }),
      ]);
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
        "14",
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("late runtime wake imports conversation input after the delivery barrier", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-runtime-late-foreground-direct-"),
    );
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const importedSeqs: string[] = [];
    const mailboxItems = Array.from({ length: 13 }, (_, index) => {
      const seq = String(index + 1);
      return createMailboxItem({
        id: `mailbox_item_entrypoint_late_foreground_direct_${seq.padStart(3, "0")}`,
        laneSeq: seq,
      });
    });
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const assistantPhaseInputIds: string[][] = [];
    const assistantPhaseLinqContextTargets: string[][] = [];
    let lateAssistantInputId: string | null = null;
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_late_foreground_budget",
            budget: {
              maxMailboxItems: 12,
            },
            idleCheckpointDelayMs: 25,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            const conversationWatermark = await readCheckpointConversationWatermark(
              snapshotInput,
              vaultRoot,
            );
            events.push(`snapshot:${snapshotInput.reason}:${conversationWatermark}`);
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/late-foreground-direct.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            importedSeqs.push(item.item.laneSeq);
            events.push(`import:${item.item.laneSeq}`);
            if (item.item.laneSeq !== "14") {
              return { status: "imported" };
            }
            const target = "thread_late_foreground_group";
            lateAssistantInputId = await stagePendingLinqAssistantInputForMailboxItem({
              item: item.item,
              threadId: target,
              vaultRoot,
            });
            return {
              assistantInputId: lateAssistantInputId,
              linqDeliveryContext: {
                directRecipientPhoneNumber: null,
                fromPhoneNumber: null,
                replyToMessageId: `msg_${item.item.id}`,
                routeAuthority: {
                  accountLookupKey: `hbidx:${target}`,
                  channel: "linq" as const,
                  containerMemberId: TEST_USER_ID,
                  threadId: target,
                },
                service: "iMessage",
                target,
                threadIsDirect: false,
              },
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            const inputBatch = input.initialAssistantInputBatch;
            assistantPhaseInputIds.push([...(inputBatch?.assistantInputIds ?? [])]);
            assistantPhaseLinqContextTargets.push(
              [...(inputBatch?.linqDeliveryContexts ?? [])]
                .map((context) => context.target ?? ""),
            );
            events.push(
              `assistant:${assistantPhaseCalls}:${input.initialMailboxImport.state.watermarks.conversation}`,
            );
            if (assistantPhaseCalls === 1) {
              await input.prepareAutoReplyDelivery?.();
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_late_foreground_direct_014",
                laneSeq: "14",
                occurredAt: "2026-04-27T00:00:14.000Z",
              }));
              runtimeWakeSignal.notify();
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 2);
      assert.ok(lateAssistantInputId);
      assert.deepEqual(assistantPhaseInputIds[1], [lateAssistantInputId]);
      assert.deepEqual(assistantPhaseLinqContextTargets[1], [
        "thread_late_foreground_group",
      ]);
      assert.deepEqual(
        importedSeqs,
        Array.from({ length: 14 }, (_, index) => String(index + 1)),
      );
      assert.ok(
        fetchRequests.some((request) =>
          readConversationImportedSeq(request) === "12"
          && request.limitPerLane === 13
        ),
      );
      assert.ok(events.includes("assistant:1:12"));
      assert.ok(events.includes("assistant:2:14"));
      assert.ok(
        requireEventIndex(events, "assistant:2:14")
          < requireEventIndex(events, "snapshot:idle_shutdown:14"),
        "post-barrier assistant input should rerun before idle checkpointing",
      );
      assert.ok(events.includes("snapshot:idle_shutdown:14"));
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "14",
      );
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "14");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground direct import admits rapid follow-ups after the initial import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-replay-budget-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const importedSeqs: string[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_replay_budget_001",
        laneSeq: "1",
      }),
      createMailboxItem({
        id: "mailbox_item_entrypoint_replay_budget_002",
        laneSeq: "2",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_replay_budget",
            budget: {
              maxMailboxItems: 2,
            },
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/replay-budget.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            importedSeqs.push(item.item.laneSeq);
            events.push(`import:${item.item.laneSeq}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            logRequests,
            mailboxPort: createMailboxPort({
              consumedSeqByLane: [
                {
                  consumedSeq: "0",
                  lane: "conversation",
                },
              ],
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            events.push("assistant");
            mailboxItems.push(createMailboxItem({
              id: "mailbox_item_entrypoint_replay_budget_003",
              laneSeq: "3",
              occurredAt: "2026-04-27T00:00:03.000Z",
            }));
            mailboxItems.push(createMailboxItem({
              id: "mailbox_item_entrypoint_replay_budget_004",
              laneSeq: "4",
              occurredAt: "2026-04-27T00:00:04.000Z",
            }));
            runtimeWakeSignal.notify();
            await waitUntil(() => {
              assert.ok(importedSeqs.includes("4"));
            });
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map(readConversationImportedSeq), ["0", "2"]);
      assert.deepEqual(importedSeqs, ["1", "2", "3", "4"]);
      assert.ok(events.includes("snapshot:idle_shutdown:4"));
      assert.equal(result.status, "idle");
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "4");
      const activeImportLogs = logRequests
        .flatMap((request) => request.entries)
        .filter((entry) => entry.phase === "active_turn_input");
      expect(activeImportLogs).toEqual([
        expect.objectContaining({
          eventCode: "mailbox.imported",
          level: "info",
          redactedJson: expect.objectContaining({
            blockCodes: [],
            blockedCount: 0,
            conversationSeqEnd: "4",
            conversationSeqStart: "2",
          }),
        }),
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground conversation import is not capped across a long active invocation", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-foreground-uncapped-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const importedSeqs: string[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_foreground_uncapped_001",
        laneSeq: "1",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_foreground_uncapped",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/foreground-uncapped.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            importedSeqs.push(item.item.laneSeq);
            events.push(`import:${item.item.laneSeq}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            logRequests,
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            events.push("assistant");
            for (let seq = 2; seq <= 12; seq += 1) {
              const laneSeq = String(seq);
              mailboxItems.push(createMailboxItem({
                id: `mailbox_item_entrypoint_foreground_uncapped_${laneSeq.padStart(3, "0")}`,
                laneSeq,
                occurredAt: `2026-04-27T00:00:${laneSeq.padStart(2, "0")}.000Z`,
              }));
              runtimeWakeSignal.notify();
              await waitUntil(() => {
                assert.ok(importedSeqs.includes(laneSeq));
              }, 5_000);
            }
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(
        importedSeqs,
        Array.from({ length: 12 }, (_, index) => String(index + 1)),
      );
      assert.equal(fetchRequests.length, 12);
      assert.deepEqual(fetchRequests.map(readConversationImportedSeq), [
        "0",
        ...Array.from({ length: 11 }, (_, index) => String(index + 1)),
      ]);
      assert.ok(events.includes("snapshot:idle_shutdown:12"));
      assert.equal(result.status, "idle");
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "12");
      expect(JSON.stringify(logRequests)).not.toContain("budget.mailbox_items");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground conversation import survives pending system mailbox churn", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-foreground-system-churn-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const imported: string[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const pushSystemItem = (seq: string) => {
      mailboxItems.push(createMailboxItem({
        id: `mailbox_item_entrypoint_foreground_system_churn_system_${seq.padStart(3, "0")}`,
        kind: "runtime.manual-requested",
        lane: "system",
        laneSeq: seq,
        occurredAt: `2026-04-27T00:00:${seq.padStart(2, "0")}.000Z`,
      }));
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_foreground_system_churn",
            budget: {
              maxMailboxItems: 2,
            },
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/foreground-system-churn.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            imported.push(`${item.item.lane}:${item.item.laneSeq}`);
            events.push(`import:${item.item.lane}:${item.item.laneSeq}`);
            return item.item.lane === "conversation"
              ? {
                  assistantInputId: await stageAssistantInputEventForMailboxItem({
                    item: item.item,
                    vaultRoot,
                  }),
                  status: "imported",
                }
              : await importRuntimeControlSystemMailboxItemForTest({
                  item: item.item,
                  vaultRoot,
                });
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            pushSystemItem("1");
            pushSystemItem("2");
            pushSystemItem("3");
            mailboxItems.push(createMailboxItem({
              id: "mailbox_item_entrypoint_foreground_system_churn_conversation_001",
              laneSeq: "1",
              occurredAt: "2026-04-27T00:00:03.500Z",
            }));
            runtimeWakeSignal.notify();
            await waitUntil(() => {
              assert.ok(imported.includes("conversation:1"));
            }, 5_000);

            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.ok(imported.includes("conversation:1"));
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "1");
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "1",
      );
      assert.ok(
        fetchRequests.some((request) =>
          readConversationImportedSeq(request) === "0"
          && request.lanes.some((lane) => lane.lane === "system")
        ),
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    { label: "successful", systemImportFails: false },
    { label: "failing", systemImportFails: true },
  ])("first-owner conversation survives $label activation decode", async ({
    systemImportFails,
  }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-first-owner-activation-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const phaseInputIds: string[][] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_first_owner_activation_system_001",
        kind: "member.activated",
        lane: "system",
        laneSeq: "1",
        occurredAt: "2026-04-27T00:00:01.000Z",
      }),
      createMailboxItem({
        id: "mailbox_item_entrypoint_first_owner_activation_conversation_001",
        laneSeq: "1",
        occurredAt: "2026-04-27T00:00:01.500Z",
      }),
    ];
    let conversationInputId: string | null = null;

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_first_owner_activation",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/first-owner-activation.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`import:${item.item.lane}:${item.item.laneSeq}`);
            if (item.item.lane === "system") {
              if (systemImportFails) {
                throw new Error("Synthetic first-owner activation decode failure.");
              }
              return { status: "imported" };
            }
            conversationInputId = await stageAssistantInputEventForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            return {
              assistantInputId: conversationInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: createWorkspaceSnapshotV2Ref(
                  "first-owner-activation",
                ),
                version: "0",
              }),
            }),
            workspaceSnapshotPort: {
              async abortSnapshotSession() {
                throw new Error("First-owner activation test should not abort snapshots.");
              },
              async completeSnapshotSession() {
                throw new Error("First-owner activation test should not complete snapshots.");
              },
              async putSnapshotObjectDirect() {
                throw new Error("First-owner activation test should not upload snapshots.");
              },
              async restoreWorkspaceSnapshot(input) {
                await initializeVault({
                  createdAt: TEST_NOW,
                  vaultRoot: input.durableRoot,
                });
                await ensureHostedBootstrapMetadataForSystemMailboxTest(
                  input.durableRoot,
                );
              },
              async startSnapshotSession() {
                throw new Error("First-owner activation test should not start snapshots.");
              },
            },
          }),
          async runAssistantPhase(input) {
            phaseInputIds.push([
              ...(input.initialAssistantInputBatch?.assistantInputIds
                ?? input.initialMailboxImport.importResult.assistantInputIds
                ?? []),
            ]);
            events.push("assistant");
            if (conversationInputId) {
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId: conversationInputId,
                vaultRoot,
              });
            }
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.ok(conversationInputId, events.join(","));
      assert.deepEqual(phaseInputIds, [[conversationInputId]]);
      assert.ok(
        requireEventIndex(events, "import:conversation:1")
        < requireEventIndex(events, "import:system:1"),
      );
      assert.ok(
        requireEventIndex(events, "import:system:1")
        < requireEventIndex(events, "assistant"),
      );
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.system,
        systemImportFails ? "0" : "1",
      );
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "1");
      assert.equal(
        result.redactedStatus?.hostedMailboxSystemImportedSeq,
        systemImportFails ? "0" : "1",
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    { label: "successful", systemImportFails: false },
    { label: "failing", systemImportFails: true },
  ])("foreground conversation stays fresh across $label same-wake activation import", async ({
    systemImportFails,
  }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-foreground-activation-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const imported: string[] = [];
    const phaseInputIds: string[][] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let assistantPhaseCalls = 0;
    let conversationInputId: string | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_foreground_activation",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/foreground-activation.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`import:${item.item.lane}:${item.item.laneSeq}`);
            if (item.item.lane === "system") {
              if (systemImportFails) {
                throw new Error("Synthetic activation import failure.");
              }
              return { status: "imported" };
            }
            conversationInputId = await stageAssistantInputEventForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            imported.push(`${item.item.lane}:${item.item.laneSeq}`);
            return {
              assistantInputId: conversationInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            phaseInputIds.push([
              ...(input.initialAssistantInputBatch?.assistantInputIds
                ?? input.initialMailboxImport.importResult.assistantInputIds
                ?? []),
            ]);
            events.push(`assistant:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              return {
                afterCheckpoint: async () => {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_foreground_activation_system_001",
                    kind: "member.activated",
                    lane: "system",
                    laneSeq: "1",
                    occurredAt: "2026-04-27T00:00:01.000Z",
                  }));
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_foreground_activation_conversation_001",
                    laneSeq: "1",
                    occurredAt: "2026-04-27T00:00:01.500Z",
                  }));
                  runtimeWakeSignal.notify();
                  return null;
                },
                checkpointReason: "canonical_runtime_commit",
                progressed: true,
              };
            } else if (conversationInputId) {
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId: conversationInputId,
                vaultRoot,
              });
            }

            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(imported, ["conversation:1"]);
      assert.equal(assistantPhaseCalls, 2);
      assert.ok(conversationInputId);
      assert.deepEqual(phaseInputIds[1], [conversationInputId]);
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "1");
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "1",
      );
      assert.ok(
        requireEventIndex(events, "import:conversation:1")
        < requireEventIndex(events, "import:system:1"),
      );
      assert.ok(
        requireEventIndex(events, "import:system:1")
        < requireEventIndex(events, "assistant:2"),
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("initial mailbox budget resumes from the restored watermark before importing the fresh tail", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-replay-initial-budget-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const importedSeqs: string[] = [];
    const mailboxItems = [
      ...Array.from({ length: 100 }, (_, index) =>
        createMailboxItem({
          id: `mailbox_item_entrypoint_initial_replay_budget_${String(index + 1).padStart(3, "0")}`,
          laneSeq: String(index + 1),
          payloadInlineCiphertext: null,
          payloadRef: `payload_ref_entrypoint_initial_replay_budget_${String(index + 1).padStart(3, "0")}`,
        })
      ),
      createMailboxItem({
        id: "mailbox_item_entrypoint_initial_replay_budget_251",
        laneSeq: "251",
        occurredAt: "2026-04-27T00:04:11.000Z",
      }),
    ];
    const restoredState = createEmptyHostedMailboxImportState();
    restoredState.watermarks.conversation = "250";
    const bundle = createMailboxImportStateBundle(restoredState);

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_initial_replay_budget",
            budget: {
              maxMailboxItems: 2,
            },
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/initial-replay-budget.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            importedSeqs.push(item.item.laneSeq);
            events.push(`import:${item.item.laneSeq}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[bundle.hash, bundle.bytes]]),
            mailboxPort: {
              ...createMailboxPort({
                consumedSeqByLane: [
                  {
                    consumedSeq: "0",
                    lane: "conversation",
                  },
                ],
                events,
                fetchRequests,
                items: mailboxItems,
              }),
              async fetchPayload(): Promise<HostedMailboxPayloadFetchResponse> {
                throw new Error("locally imported replay sidecar should not be fetched");
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                redactedStatus: {
                  hostedMailboxConversationImportedSeq: "250",
                },
                snapshotRef: createBundleRef({
                  hash: bundle.hash,
                  key: "users/bundles/member-synthetic/initial-replay-budget-before.bundle.json",
                  size: bundle.bytes.byteLength,
                }),
                version: "4",
              }),
            }),
          }),
          async runAssistantPhase() {
            events.push("assistant");
            return {
              checkpointReason: "canonical_runtime_commit",
              foregroundReplyFailed: 0,
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map(readConversationImportedSeq), ["250"]);
      assert.deepEqual(fetchRequests.map((request) => request.limitPerLane), [3]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [[
        { importedSeq: "0", lane: "system" },
        { importedSeq: "250", lane: "conversation" },
      ]]);
      assert.deepEqual(importedSeqs, ["251"]);
      assert.ok(events.includes("import:251"));
      assert.ok(events.includes("snapshot:idle_shutdown:251"));
      assert.equal(result.status, "idle");
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "251");
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "251",
      );
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationHandledThroughSeq,
        undefined,
      );
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "251");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("checkpointed replay budget progress lets restored runs reach the fresh tail", async () => {
    const mailboxItems = [
      ...Array.from({ length: 5 }, (_, index) =>
        createMailboxItem({
          id: `mailbox_item_entrypoint_consumed_replay_budget_${String(index + 1).padStart(3, "0")}`,
          laneSeq: String(index + 1),
          occurredAt: `2026-04-27T00:00:0${index + 1}.000Z`,
        })
      ),
      createMailboxItem({
        id: "mailbox_item_entrypoint_consumed_replay_budget_006",
        laneSeq: "6",
        occurredAt: "2026-04-27T00:00:06.000Z",
      }),
    ];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    let workspace = createWorkspaceState({ version: "4" });
    const conversationFetches = (requests: readonly HostedMailboxFetchRequest[]) =>
      requests.filter((request) => readConversationImportedSeq(request) !== null);
    const conversationFetchImportedSeqs = (requests: readonly HostedMailboxFetchRequest[]) =>
      conversationFetches(requests).map(readConversationImportedSeq);

    const runAttempt = async (input: {
      attemptId: string;
      workspace: HostedWorkspaceState;
    }) => {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-replay-checkpoint-"));
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const events: string[] = [];
      const fetchRequests: HostedMailboxFetchRequest[] = [];
      const importedSeqs: string[] = [];
      const snapshotWatermarks: string[] = [];

      try {
        if (input.workspace.snapshotRef === null) {
          await initializeVault({ createdAt: TEST_NOW, vaultRoot });
        }

        const result = await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: input.attemptId,
              budget: {
                maxMailboxItems: 2,
              },
              idleCheckpointDelayMs: 1,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: input.workspace.version,
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              const checkpointWatermark = await readCheckpointConversationWatermark(
                snapshotInput,
                vaultRoot,
              );
              snapshotWatermarks.push(checkpointWatermark);
              const state = "state" in snapshotInput
                ? snapshotInput.state
                : await readHostedMailboxImportState({ vaultRoot });
              const bundle = createMailboxImportStateBundle(state);
              artifactBytesByHash.set(bundle.hash, bundle.bytes);
              return {
                snapshotRef: createBundleRef({
                  hash: bundle.hash,
                  key: `users/bundles/member-synthetic/${input.attemptId}.bundle.json`,
                  size: bundle.bytes.byteLength,
                }),
              };
            },
            async importItem(item) {
              const kind = item.durablyConsumed === true ? "consumed" : "fresh";
              importedSeqs.push(`${item.item.laneSeq}:${kind}`);
              events.push(`import:${item.item.laneSeq}:${kind}`);
              return item.durablyConsumed === true
                ? { status: "imported" }
                : {
                    assistantInputId: await stageAssistantInputEventForMailboxItem({
                      item: item.item,
                      vaultRoot,
                    }),
                    status: "imported",
                  };
            },
            platform: createPlatform({
              artifactBytesByHash,
              mailboxPort: createMailboxPort({
                consumedSeqByLane: [
                  {
                    consumedSeq: "5",
                    lane: "conversation",
                  },
                ],
                events,
                fetchRequests,
                items: mailboxItems,
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: input.workspace,
              }),
            }),
            async runAssistantPhase() {
              events.push(`assistant:${input.attemptId}`);
              return {
                progressed: false,
              };
            },
            vaultRoot,
          },
        );
        const state = await readHostedMailboxImportState({ vaultRoot });
        const checkpointRequest = checkpointRequests.at(-1) ?? null;
        const checkpointedWorkspace = checkpointRequest?.snapshotRef
          ? createWorkspaceState({
              redactedStatus: checkpointRequest.redactedStatus ?? null,
              snapshotRef: checkpointRequest.snapshotRef,
              version: String(BigInt(checkpointRequest.expectedWorkspaceVersion) + 1n),
            })
          : null;

        return {
          checkpointRequest,
          checkpointedWorkspace,
          events,
          fetchRequests,
          importedSeqs,
          result,
          snapshotWatermarks,
          state,
        };
      } finally {
        await removeTempRoot(vaultRoot);
      }
    };

    const first = await runAttempt({
      attemptId: "attempt_synthetic_consumed_replay_budget_1",
      workspace,
    });
    assert.equal(first.result.status, "budget_exhausted");
    assert.deepEqual(conversationFetchImportedSeqs(first.fetchRequests), ["0"]);
    assert.deepEqual(
      conversationFetches(first.fetchRequests).map((request) => request.limitPerLane),
      [3],
    );
    assert.deepEqual(first.importedSeqs, ["1:consumed", "2:consumed"]);
    assert.deepEqual(first.snapshotWatermarks, ["2"]);
    assert.equal(first.state.watermarks.conversation, "2");
    assert.equal(
      first.checkpointRequest?.redactedStatus?.hostedMailboxConversationImportedSeq,
      "2",
    );
    assert.ok(first.checkpointedWorkspace);
    workspace = first.checkpointedWorkspace;

    const second = await runAttempt({
      attemptId: "attempt_synthetic_consumed_replay_budget_2",
      workspace,
    });
    assert.equal(second.result.status, "budget_exhausted");
    assert.deepEqual(conversationFetchImportedSeqs(second.fetchRequests), ["2"]);
    assert.deepEqual(second.importedSeqs, ["3:consumed", "4:consumed"]);
    assert.deepEqual(second.snapshotWatermarks, ["4"]);
    assert.equal(second.state.watermarks.conversation, "4");
    assert.equal(
      second.checkpointRequest?.redactedStatus?.hostedMailboxConversationImportedSeq,
      "4",
    );
    assert.ok(second.checkpointedWorkspace);
    workspace = second.checkpointedWorkspace;

    const third = await runAttempt({
      attemptId: "attempt_synthetic_consumed_replay_budget_3",
      workspace,
    });
    assert.equal(third.result.status, "idle");
    assert.deepEqual(conversationFetchImportedSeqs(third.fetchRequests), ["4"]);
    assert.deepEqual(third.importedSeqs, ["5:consumed", "6:fresh"]);
    assert.deepEqual(third.snapshotWatermarks, ["6"]);
    assert.equal(third.state.watermarks.conversation, "6");
    assert.equal(
      third.checkpointRequest?.redactedStatus?.hostedMailboxConversationImportedSeq,
      "6",
    );
    assert.deepEqual(
      [...first.importedSeqs, ...second.importedSeqs, ...third.importedSeqs],
      [
        "1:consumed",
        "2:consumed",
        "3:consumed",
        "4:consumed",
        "5:consumed",
        "6:fresh",
      ],
    );
    assert.ok(
      requireEventIndex(third.events, "import:5:consumed")
        < requireEventIndex(third.events, "import:6:fresh"),
    );
    assert.ok(
      requireEventIndex(third.events, "import:6:fresh")
        < requireEventIndex(
          third.events,
          "assistant:attempt_synthetic_consumed_replay_budget_3",
        ),
    );
  });

  test("checkpoints replay budget progress before servicing active wakes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-replay-wake-barrier-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const importedSeqs: string[] = [];
    const snapshotWatermarks: string[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const mailboxItems = [
      ...Array.from({ length: 4 }, (_, index) =>
        createMailboxItem({
          id: `mailbox_item_entrypoint_replay_wake_barrier_${String(index + 1).padStart(3, "0")}`,
          laneSeq: String(index + 1),
          occurredAt: `2026-04-27T00:00:0${index + 1}.000Z`,
        })
      ),
      createMailboxItem({
        id: "mailbox_item_entrypoint_replay_wake_barrier_005",
        laneSeq: "5",
        occurredAt: "2026-04-27T00:00:05.000Z",
      }),
    ];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_consumed_replay_wake_barrier",
            budget: {
              maxMailboxItems: 2,
            },
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            const checkpointWatermark = await readCheckpointConversationWatermark(
              snapshotInput,
              vaultRoot,
            );
            snapshotWatermarks.push(checkpointWatermark);
            const state = "state" in snapshotInput
              ? snapshotInput.state
              : await readHostedMailboxImportState({ vaultRoot });
            const bundle = createMailboxImportStateBundle(state);
            return {
              snapshotRef: createBundleRef({
                hash: bundle.hash,
                key: "users/bundles/member-synthetic/replay-wake-barrier.bundle.json",
                size: bundle.bytes.byteLength,
              }),
            };
          },
          async importItem(item) {
            const kind = item.durablyConsumed === true ? "consumed" : "fresh";
            importedSeqs.push(`${item.item.laneSeq}:${kind}`);
            events.push(`import:${item.item.laneSeq}:${kind}`);
            return item.durablyConsumed === true
              ? { status: "imported" }
              : {
                  assistantInputId: "assistant_input_replay_wake_barrier_fresh_tail",
                  status: "imported",
                };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              consumedSeqByLane: [
                {
                  consumedSeq: "4",
                  lane: "conversation",
                },
              ],
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          async runAssistantPhase() {
            runtimeWakeSignal.notify();
            throw new Error("active wakes must wait for replay progress checkpoint");
          },
          runtimeWakeSignal,
          vaultRoot,
        },
      );

      assert.equal(result.status, "budget_exhausted");
      assert.deepEqual(fetchRequests.map(readConversationImportedSeq), ["0"]);
      assert.deepEqual(importedSeqs, ["1:consumed", "2:consumed"]);
      assert.deepEqual(snapshotWatermarks, ["2"]);
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "2");
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "2",
      );
      assert.ok(!events.includes("import:5:fresh"));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("a conversation wake aborts pre-publication idle checkpoint construction and retries with the latest watermark", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-wake-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const snapshotWatermarks: string[] = [];
    const snapshotStarted = createDeferred<void>();
    const snapshotAborted = createDeferred<void>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_checkpoint_conversation_wake_001",
        laneSeq: "1",
      }),
    ];
    let assistantPhaseCalls = 0;
    let checkpointSnapshotCalls = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_checkpoint_conversation_wake_prepublication",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput, context) {
            checkpointSnapshotCalls += 1;
            const checkpointWatermark = await readCheckpointConversationWatermark(
              snapshotInput,
              vaultRoot,
            );
            snapshotWatermarks.push(checkpointWatermark);
            events.push(
              `snapshot:${checkpointSnapshotCalls}:start:${checkpointWatermark}`,
            );

            if (checkpointSnapshotCalls === 1) {
              const signal = context?.signal;
              assert.ok(signal, "Routine checkpoint construction must receive a wake signal.");
              snapshotStarted.resolve();
              await new Promise<never>((_resolve, reject) => {
                const rejectForAbort = () => {
                  events.push("snapshot:1:abort");
                  snapshotAborted.resolve();
                  reject(signal.reason);
                };
                if (signal.aborted) {
                  rejectForAbort();
                  return;
                }
                signal.addEventListener("abort", rejectForAbort, { once: true });
              });
            }

            events.push(`snapshot:${checkpointSnapshotCalls}:ready`);
            return {
              snapshotRef: createBundleRef({
                hash: String(checkpointSnapshotCalls).repeat(64).slice(0, 64),
                key:
                  "users/bundles/member-synthetic/"
                  + `checkpoint-conversation-wake-${checkpointSnapshotCalls}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.laneSeq}`);
            return {
              assistantInputId: await stageAssistantInputEventForMailboxItem({
                item: item.item,
                vaultRoot,
              }),
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push(
                  `workspace.checkpoint:${request.redactedStatus?.hostedMailboxConversationImportedSeq ?? "none"}`,
                );
                checkpointRequests.push(request);
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    redactedStatus: request.redactedStatus ?? null,
                    snapshotRef: request.snapshotRef,
                    version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                  }),
                };
              },
            },
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant:${assistantPhaseCalls}`);
            return {
              checkpointReason: "assistant_runtime_commit" as const,
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      await withRealTimeout(
        snapshotStarted.promise,
        10_000,
        () => `Initial checkpoint snapshot did not start: ${events.join(",")}`,
      );
      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_entrypoint_checkpoint_conversation_wake_002",
        laneSeq: "2",
      }));
      runtimeWakeSignal.notify();
      await withRealTimeout(
        snapshotAborted.promise,
        10_000,
        () => `Initial checkpoint snapshot was not aborted: ${events.join(",")}`,
      );
      assert.equal(checkpointRequests.length, 0);

      const result = await withRealTimeout(
        resultPromise,
        10_000,
        () => `Runtime did not retry the checkpoint: ${events.join(",")}`,
      );

      assert.equal(result.status, "idle");
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      assert.deepEqual(readConversationImportedSeqs(fetchRequests), ["0", "1"]);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        ["mailbox.importItem:1", "mailbox.importItem:2"],
      );
      assert.deepEqual(snapshotWatermarks, ["1", "2"]);
      assert.deepEqual(
        checkpointRequests.map((request) =>
          request.redactedStatus?.hostedMailboxConversationImportedSeq
        ),
        ["2"],
      );
      assert.ok(
        requireEventIndex(events, "snapshot:1:abort")
          < requireEventIndex(events, "mailbox.importItem:2"),
      );
      assert.ok(
        requireEventIndex(events, "mailbox.importItem:2")
          < requireEventIndex(events, "assistant:2"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:2")
          < requireEventIndex(events, "snapshot:2:start:2"),
      );
      assert.ok(
        requireEventIndex(events, "snapshot:2:ready")
          < requireEventIndex(events, "workspace.checkpoint:2"),
      );
    } finally {
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wakes during the final idle checkpoint do not abort checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const checkpointResponse = createDeferred<HostedWorkspaceCheckpointResponse>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let assistantPhaseCalls = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
    let settled = false;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_wake_during_checkpoint",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-wake-during.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push("workspace.checkpoint");
                checkpointRequests.push(request);
                runtimeWakeSignal.notify();
                return await checkpointResponse.promise;
              },
            },
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls > 1) {
              return {
                progressed: false,
              };
            }

            return {
              checkpointReason: "assistant_runtime_commit" as const,
              progressed: true,
              redactedStatus: {
                hostedAssistantProgressed: true,
              },
            };
          },
          vaultRoot,
        },
      ).finally(() => {
        settled = true;
      });

      await waitUntil(() => {
        assert.equal(checkpointRequests.length, 1, events.join(","));
      }, 10_000);
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(settled, false);
      assert.equal(checkpointRequests.length, 1);

      checkpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({
          snapshotRef: checkpointRequests[0]!.snapshotRef,
          version: "5",
        }),
      });

      assert.ok(resultPromise);
      await expect(resultPromise).resolves.toMatchObject({
        status: "idle",
        redactedStatus: {
          hostedMailboxConversationImportedSeq: "1",
        },
      });
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_001",
      ]);
    } finally {
      checkpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({ version: "5" }),
      });
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("deferred usage flushing does not block the delivered reply idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-deferred-usage-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const restoredState = createEmptyHostedMailboxImportState();
    restoredState.watermarks.conversation = "1";
    const bundle = createMailboxImportStateBundle(restoredState);
    const usageRecordStarted = createDeferred<void>();
    const usageRecordFinished = createDeferred<void>();
    const releaseUsageRecord = createDeferred<void>();
    const checkpointInboxMediaRetentionWakeAt = "2099-04-27T00:02:00.000Z";
    const earlierWakeAt = "2099-04-27T00:05:00.000Z";
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
    let resultSettled = false;
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const platform = createPlatform({
        artifactBytesByHash: new Map([[bundle.hash, bundle.bytes]]),
        mailboxPort: createMailboxPort({
          events,
          items: [],
        }),
        workspacePort: {
          async read() {
            events.push("workspace.read");
            return {
              fetchedAt: TEST_NOW,
              workspace: createWorkspaceState({
                redactedStatus: {
                  hostedMailboxConversationImportedSeq: "1",
                },
                snapshotRef: createBundleRef({
                  hash: bundle.hash,
                  key: "users/bundles/member-synthetic/deferred-usage-clean-wake-before.bundle.json",
                  size: bundle.bytes.byteLength,
                }),
                version: "4",
              }),
            };
          },
          async checkpoint(request) {
            events.push(`workspace.checkpoint:${request.reason}`);
            checkpointRequests.push(request);
            return {
              checkpointed: true,
              workspace: createWorkspaceState({
                inboxMediaRetentionWakeAt:
                  request.reason === "idle_shutdown"
                    ? checkpointInboxMediaRetentionWakeAt
                    : request.inboxMediaRetentionWakeAt ?? null,
                nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null,
                redactedStatus: request.redactedStatus ?? null,
                snapshotRef: request.snapshotRef,
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
              }),
            };
          },
        },
      });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_deferred_usage_idle_checkpoint",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            const hashPrefix = snapshotInput.reason === "outbox_receipt" ? "b" : "c";
            return {
              snapshotRef: createBundleRef({
                hash: hashPrefix.repeat(64),
                key: `users/bundles/member-synthetic/deferred-usage-${snapshotInput.reason}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return {
              assistantInputId: await stageAssistantInputEventForMailboxItem({
                item: item.item,
                vaultRoot,
              }),
              status: "imported",
            };
          },
          platform: {
            ...platform,
            usageRecordPort: {
              async recordUsage(record: AssistantUsageRecord) {
                events.push("usage.record:start");
                usageRecordStarted.resolve();
                await releaseUsageRecord.promise;
                events.push("usage.record:done");
                usageRecordFinished.resolve();
                return {
                  platformAiUsageAllowedAfter: true,
                  recorded: true,
                  usageId: record.usageId,
                };
              },
            },
          },
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls > 1) {
              return {
                foregroundReplyFailed: 0,
                nextWakeAt: "2099-04-27T00:10:00.000Z",
                nextWakeReason: "mailbox.retry",
                progressed: false,
              };
            }

            input.recordDeferredUsage?.(createAssistantUsageRecord({
              usageId: "turn_entrypoint_deferred_usage.attempt-1",
            }));
            return {
              afterCheckpoint: async () => {
                events.push("reply.deliver");
                return {
                  checkpointReason: "outbox_receipt",
                };
              },
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: earlierWakeAt,
              nextWakeReason: "assistant",
              progressed: true,
            };
          },
          vaultRoot,
        },
      ).finally(() => {
        resultSettled = true;
      });

      await withRealTimeout(
        usageRecordStarted.promise,
        1_000,
        () => "Deferred usage recording did not start.",
      );
      await waitUntil(() => {
        assert.equal(
          checkpointRequests.some((request) => request.reason === "idle_shutdown"),
          true,
        );
      });
      assert.equal(assistantPhaseCalls, 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(assistantPhaseCalls, 1);
      assert.equal(events.includes("usage.record:done"), false);
      assert.equal(events.includes("browser.refresh"), false);
      assert.equal(resultSettled, false);
      assert.equal(assistantPhaseCalls, 1);
      assert.equal(events.includes("usage.record:done"), false);
      assert.deepEqual(events.filter((event) => event.startsWith("snapshot:")), [
        "snapshot:idle_shutdown",
      ]);
      assert.equal(events.includes("reply.deliver"), true);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.nextWakeAt), [
        earlierWakeAt,
      ]);

      releaseUsageRecord.resolve();
      await withRealTimeout(
        usageRecordFinished.promise,
        1_000,
        () => "Deferred usage recording did not finish after release.",
      );
      const result = await withRealTimeout(
        resultPromise,
        1_000,
        () => "Runtime did not settle after deferred usage recording finished.",
      );
      assert.equal(resultSettled, true);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, checkpointInboxMediaRetentionWakeAt);
    } finally {
      releaseUsageRecord.resolve();
      if (resultPromise) {
        await resultPromise.catch(() => undefined);
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not let prior deferred usage block unrelated runtime failure cleanup", async () => {
    const firstVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-deferred-usage-prior-"));
    const secondVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-deferred-usage-fail-next-"));
    const events: string[] = [];
    const releaseUsageRecord = createDeferred<void>();
    const usageRecordStarted = createDeferred<void>();
    const usageRecordFinished = createDeferred<void>();
    let firstResultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot: firstVaultRoot });
      firstResultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_deferred_usage_previous_invocation",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`first.snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: `users/bundles/member-synthetic/prior-usage-${snapshotInput.reason}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: {
            ...createPlatform({
              mailboxPort: createMailboxPort({ events, items: [] }),
              workspacePort: createWorkspacePort({
                checkpointRequests: [],
                events,
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            usageRecordPort: {
              async recordUsage(record: AssistantUsageRecord) {
                events.push("first.usage:start");
                usageRecordStarted.resolve();
                await releaseUsageRecord.promise;
                events.push("first.usage:done");
                usageRecordFinished.resolve();
                return {
                  platformAiUsageAllowedAfter: true,
                  recorded: true,
                  usageId: record.usageId,
                };
              },
            },
          },
          async runAssistantPhase(input) {
            events.push("first.assistant.phase");
            input.recordDeferredUsage?.(createAssistantUsageRecord({
              usageId: "turn_entrypoint_deferred_usage_previous.attempt-1",
            }));
            return {
              afterCheckpoint: async () => {
                events.push("first.reply.deliver");
                return {
                  checkpointReason: "outbox_receipt",
                };
              },
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot: firstVaultRoot,
        },
      );

      await withRealTimeout(
        usageRecordStarted.promise,
        1_000,
        () => "Previous invocation deferred usage did not start.",
      );
      assert.equal(events.includes("first.usage:done"), false);

      const failure = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_deferred_usage_next_failure",
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "5",
            },
          }),
          {
            async createCheckpointSnapshot() {
              throw new Error("Stale workspace failure should not snapshot.");
            },
            async importItem() {
              throw new Error("Stale workspace failure should not import mailbox items.");
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({ events, items: [] }),
              workspacePort: createWorkspacePort({
                checkpointRequests: [],
                events,
                workspace: createWorkspaceState({ version: "6" }),
              }),
            }),
            vaultRoot: secondVaultRoot,
          },
        ).then(
          () => null,
          (error: unknown) => error,
        ),
        1_000,
        () => "Unrelated runtime failure waited for previous invocation usage.",
      );

      assert.ok(failure instanceof HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError);
      assert.equal(events.includes("first.usage:done"), false);

      releaseUsageRecord.resolve();
      await withRealTimeout(
        usageRecordFinished.promise,
        1_000,
        () => "Previous invocation deferred usage did not finish after release.",
      );
      await withRealTimeout(
        firstResultPromise,
        1_000,
        () => "Previous invocation did not return after deferred usage finished.",
      );
    } finally {
      releaseUsageRecord.resolve();
      if (firstResultPromise) {
        await firstResultPromise.catch(() => undefined);
      }
      await removeTempRoot(firstVaultRoot);
      await removeTempRoot(secondVaultRoot);
    }
  });

  test("drains started deferred usage before rethrowing idle checkpoint failure", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-deferred-usage-fail-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const usageRecordStarted = createDeferred<void>();
    const releaseUsageRecord = createDeferred<void>();
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
    let resultSettled = false;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_deferred_usage_idle_checkpoint_failure",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: `users/bundles/member-synthetic/deferred-usage-fail-${snapshotInput.reason}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: {
            ...createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [],
              }),
              workspacePort: {
                async read() {
                  events.push("workspace.read");
                  return {
                    fetchedAt: TEST_NOW,
                    workspace: createWorkspaceState({ version: "4" }),
                  };
                },
                async checkpoint(request) {
                  events.push(`workspace.checkpoint:${request.reason}`);
                  checkpointRequests.push(request);
                  if (request.reason === "idle_shutdown") {
                    throw new Error("Synthetic idle checkpoint failure.");
                  }
                  return {
                    checkpointed: true,
                    workspace: createWorkspaceState({
                      snapshotRef: request.snapshotRef,
                      version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                    }),
                  };
                },
              },
            }),
            usageRecordPort: {
              async recordUsage(record: AssistantUsageRecord) {
                events.push("usage.record:start");
                usageRecordStarted.resolve();
                await releaseUsageRecord.promise;
                events.push("usage.record:done");
                return {
                  platformAiUsageAllowedAfter: true,
                  recorded: true,
                  usageId: record.usageId,
                };
              },
            },
          },
          async runAssistantPhase(input) {
            events.push("assistant.phase");
            input.recordDeferredUsage?.(createAssistantUsageRecord({
              usageId: "turn_entrypoint_deferred_usage_failure.attempt-1",
            }));
            return {
              afterCheckpoint: async () => {
                events.push("reply.deliver");
                return {
                  checkpointReason: "outbox_receipt",
                };
              },
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );
      void resultPromise.finally(() => {
        resultSettled = true;
      }).catch(() => undefined);

      await withRealTimeout(
        usageRecordStarted.promise,
        1_000,
        () => "Deferred usage recording did not start before checkpoint failure.",
      );
      await waitUntil(() => {
        assert.equal(
          checkpointRequests.some((request) => request.reason === "idle_shutdown"),
          true,
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(events.includes("usage.record:done"), false);
      assert.equal(resultSettled, false);

      releaseUsageRecord.resolve();
      await expect(resultPromise).rejects.toThrow("Synthetic idle checkpoint failure.");
      assert.equal(events.includes("usage.record:done"), true);
    } finally {
      releaseUsageRecord.resolve();
      if (resultPromise) {
        await resultPromise.catch(() => undefined);
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not drain started deferred usage when host abort wins before runner result returns", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-deferred-usage-abort-"));
    const events: string[] = [];
    const usageRecordStarted = createDeferred<void>();
    const releaseUsageRecord = createDeferred<void>();
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("synthetic host abort after deferred usage starts");
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
    let resultSettled = false;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_deferred_usage_host_abort",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: `users/bundles/member-synthetic/deferred-usage-abort-${snapshotInput.reason}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: {
            ...createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [],
              }),
              workspacePort: {
                async read() {
                  events.push("workspace.read");
                  return {
                    fetchedAt: TEST_NOW,
                    workspace: createWorkspaceState({ version: "4" }),
                  };
                },
                async checkpoint(request) {
                  events.push(`workspace.checkpoint:${request.reason}`);
                  return {
                    checkpointed: true,
                    workspace: createWorkspaceState({
                      snapshotRef: request.snapshotRef,
                      version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                    }),
                  };
                },
              },
            }),
            usageRecordPort: {
              async recordUsage(record: AssistantUsageRecord) {
                events.push("usage.record:start");
                assert.equal(
                  record.usageId,
                  "turn_entrypoint_deferred_usage_host_abort.attempt-1",
                );
                usageRecordStarted.resolve();
                hostAbortController.abort(hostAbortReason);
                await releaseUsageRecord.promise;
                events.push("usage.record:done");
                return {
                  platformAiUsageAllowedAfter: true,
                  recorded: true,
                  usageId: record.usageId,
                };
              },
            },
          },
          async runAssistantPhase(input) {
            events.push("assistant.phase");
            input.recordDeferredUsage?.(createAssistantUsageRecord({
              usageId: "turn_entrypoint_deferred_usage_host_abort.attempt-1",
            }));
            return {
              afterCheckpoint: async () => {
                events.push("reply.deliver");
                return {
                  checkpointReason: "outbox_receipt",
                };
              },
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          signal: hostAbortController.signal,
          vaultRoot,
        },
      );
      void resultPromise.finally(() => {
        resultSettled = true;
      }).catch(() => undefined);

      await withRealTimeout(
        usageRecordStarted.promise,
        1_000,
        () => "Deferred usage recording did not start before host abort.",
      );
      const outcome = await withRealTimeout(
        resultPromise,
        1_000,
        () => "Runtime waited for deferred usage recording after host abort.",
      ).then(
        () => "resolved" as const,
        (error: unknown) => error,
      );

      assert.equal(outcome, hostAbortReason);
      assert.equal(resultSettled, true);
      assert.equal(events.includes("usage.record:done"), false);

      releaseUsageRecord.resolve();
      await waitUntil(() => {
        assert.equal(events.includes("usage.record:done"), true);
      });
      assert.deepEqual(events.filter((event) => event.startsWith("usage.record:")), [
        "usage.record:start",
        "usage.record:done",
      ]);
      assert.equal(events.includes("reply.deliver"), true);
    } finally {
      releaseUsageRecord.resolve();
      if (resultPromise) {
        await resultPromise.catch(() => undefined);
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("starts captured deferred usage without blocking when host abort prevents the phase result", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-deferred-usage-abort-before-result-"));
    const events: string[] = [];
    const usageRecordStarted = createDeferred<void>();
    const usageRecordFinished = createDeferred<void>();
    const releaseUsageRecord = createDeferred<void>();
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("synthetic host abort before assistant phase result");
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_deferred_usage_host_abort_before_result",
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Host abort before phase result should not checkpoint.");
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: {
            ...createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests: [],
                events,
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            usageRecordPort: {
              async recordUsage(record: AssistantUsageRecord) {
                events.push("usage.record:start");
                assert.equal(
                  record.usageId,
                  "turn_entrypoint_deferred_usage_abort_before_result.attempt-1",
                );
                usageRecordStarted.resolve();
                await releaseUsageRecord.promise;
                events.push("usage.record:done");
                usageRecordFinished.resolve();
                return {
                  platformAiUsageAllowedAfter: true,
                  recorded: true,
                  usageId: record.usageId,
                };
              },
            },
          },
          async runAssistantPhase(input) {
            events.push("assistant.phase");
            input.recordDeferredUsage?.(createAssistantUsageRecord({
              usageId: "turn_entrypoint_deferred_usage_abort_before_result.attempt-1",
            }));
            hostAbortController.abort(hostAbortReason);
            throw hostAbortReason;
          },
          signal: hostAbortController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        usageRecordStarted.promise,
        1_000,
        () => "Deferred usage recording did not start after host abort.",
      );
      const outcome = await withRealTimeout(
        resultPromise,
        1_000,
        () => "Runtime waited for captured deferred usage after host abort.",
      ).then(
        () => "resolved" as const,
        (error: unknown) => error,
      );

      assert.equal(outcome, hostAbortReason);
      assert.equal(events.includes("usage.record:done"), false);

      releaseUsageRecord.resolve();
      await withRealTimeout(
        usageRecordFinished.promise,
        1_000,
        () => "Deferred usage recording did not finish after release.",
      );
    } finally {
      releaseUsageRecord.resolve();
      if (resultPromise) {
        await resultPromise.catch(() => undefined);
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("shutdown drain waits for captured deferred usage when host abort wins before flush starts", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-deferred-usage-abort-drain-"));
    const events: string[] = [];
    const assistantPhaseCanFinish = createDeferred<void>();
    const recordLateUsage = createDeferred<void>();
    const lateUsageRecorded = createDeferred<void>();
    const usageRecordStartedA = createDeferred<void>();
    const usageRecordStartedB = createDeferred<void>();
    const releaseUsageRecordA = createDeferred<void>();
    const releaseUsageRecordB = createDeferred<void>();
    const usageRecordFinishedA = createDeferred<void>();
    const usageRecordFinishedB = createDeferred<void>();
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("synthetic host abort before deferred usage flush start");
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_deferred_usage_abort_drain",
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Host abort before phase result should not checkpoint.");
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: {
            ...createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests: [],
                events,
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            usageRecordPort: {
              async recordUsage(record: AssistantUsageRecord) {
                events.push(`usage.record:start:${record.usageId}`);
                if (record.usageId === "turn_entrypoint_deferred_usage_abort_drain.attempt-1") {
                  usageRecordStartedA.resolve();
                  await releaseUsageRecordA.promise;
                  events.push(`usage.record:done:${record.usageId}`);
                  usageRecordFinishedA.resolve();
                } else if (record.usageId === "turn_entrypoint_deferred_usage_abort_drain.attempt-2") {
                  usageRecordStartedB.resolve();
                  await releaseUsageRecordB.promise;
                  events.push(`usage.record:done:${record.usageId}`);
                  usageRecordFinishedB.resolve();
                } else {
                  assert.fail(`Unexpected usage record ${record.usageId}`);
                }
                return {
                  platformAiUsageAllowedAfter: true,
                  recorded: true,
                  usageId: record.usageId,
                };
              },
            },
          },
          async runAssistantPhase(input) {
            events.push("assistant.phase");
            input.recordDeferredUsage?.(createAssistantUsageRecord({
              usageId: "turn_entrypoint_deferred_usage_abort_drain.attempt-1",
            }));
            hostAbortController.abort(hostAbortReason);
            await recordLateUsage.promise;
            input.recordDeferredUsage?.(createAssistantUsageRecord({
              usageId: "turn_entrypoint_deferred_usage_abort_drain.attempt-2",
            }));
            lateUsageRecorded.resolve();
            await assistantPhaseCanFinish.promise;
            throw hostAbortReason;
          },
          signal: hostAbortController.signal,
          vaultRoot,
        },
      );

      const outcome = await withRealTimeout(
        resultPromise,
        1_000,
        () => "Runtime did not return the host abort while assistant phase was blocked.",
      ).then(
        () => "resolved" as const,
        (error: unknown) => error,
      );
      assert.equal(outcome, hostAbortReason);
      await withRealTimeout(
        usageRecordStartedA.promise,
        1_000,
        () => "Deferred usage recording did not start after host abort.",
      );
      assert.equal(
        events.includes("usage.record:done:turn_entrypoint_deferred_usage_abort_drain.attempt-1"),
        false,
      );

      const drainPromise = drainHostedRuntimeDeferredUsageCompletionsBestEffort();
      let drainSettled = false;
      void drainPromise.finally(() => {
        drainSettled = true;
      }).catch(() => undefined);
      recordLateUsage.resolve();
      await withRealTimeout(
        lateUsageRecorded.promise,
        1_000,
        () => "Assistant phase did not record late deferred usage after host abort.",
      );
      assert.equal(
        events.includes("usage.record:start:turn_entrypoint_deferred_usage_abort_drain.attempt-2"),
        false,
      );
      assert.equal(drainSettled, false);

      releaseUsageRecordA.resolve();
      await withRealTimeout(
        usageRecordFinishedA.promise,
        1_000,
        () => "First deferred usage recording did not finish after release.",
      );
      await withRealTimeout(
        usageRecordStartedB.promise,
        1_000,
        () => "Late deferred usage recording did not start after the first record finished.",
      );
      assert.equal(drainSettled, false);

      releaseUsageRecordB.resolve();
      await withRealTimeout(
        usageRecordFinishedB.promise,
        1_000,
        () => "Late deferred usage recording did not finish after release.",
      );
      await Promise.resolve();
      assert.equal(drainSettled, false);
      assistantPhaseCanFinish.resolve();
      await withRealTimeout(
        drainPromise,
        1_000,
        () => "Shutdown deferred usage drain did not settle after capture closed.",
      );
      assert.equal(drainSettled, true);
    } finally {
      recordLateUsage.resolve();
      assistantPhaseCanFinish.resolve();
      releaseUsageRecordA.resolve();
      releaseUsageRecordB.resolve();
      if (resultPromise) {
        await resultPromise.catch(() => undefined);
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("process-fatal drain starts captured deferred usage before runner cleanup", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-deferred-usage-fatal-drain-"));
    const events: string[] = [];
    const assistantPhaseCanFinish = createDeferred<void>();
    const usageCaptured = createDeferred<void>();
    const usageRecordStarted = createDeferred<void>();
    const releaseUsageRecord = createDeferred<void>();
    const usageRecordFinished = createDeferred<void>();
    const usageId = "turn_entrypoint_deferred_usage_fatal_drain.attempt-1";
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_deferred_usage_fatal_drain",
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Blocked fatal-drain phase should not checkpoint.");
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: {
            ...createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests: [],
                events,
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            usageRecordPort: {
              async recordUsage(record: AssistantUsageRecord) {
                events.push("usage.record:start");
                assert.equal(record.usageId, usageId);
                usageRecordStarted.resolve();
                await releaseUsageRecord.promise;
                events.push("usage.record:done");
                usageRecordFinished.resolve();
                return {
                  platformAiUsageAllowedAfter: true,
                  recorded: true,
                  usageId: record.usageId,
                };
              },
            },
          },
          async runAssistantPhase(input) {
            events.push("assistant.phase");
            input.recordDeferredUsage?.(createAssistantUsageRecord({ usageId }));
            usageCaptured.resolve();
            await assistantPhaseCanFinish.promise;
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      await withRealTimeout(
        usageCaptured.promise,
        1_000,
        () => "Assistant phase did not capture deferred usage.",
      );
      await Promise.resolve();
      assert.equal(events.includes("usage.record:start"), false);

      const drainPromise = drainHostedRuntimeDeferredUsageCompletionsBestEffort({
        closeActiveCaptures: true,
        timeoutMs: 1_000,
      });
      let drainSettled = false;
      void drainPromise.finally(() => {
        drainSettled = true;
      }).catch(() => undefined);

      await withRealTimeout(
        usageRecordStarted.promise,
        1_000,
        () => "Process-fatal deferred usage drain did not start captured usage.",
      );
      assert.equal(drainSettled, false);

      releaseUsageRecord.resolve();
      await withRealTimeout(
        usageRecordFinished.promise,
        1_000,
        () => "Deferred usage recording did not finish after release.",
      );
      await withRealTimeout(
        drainPromise,
        1_000,
        () => "Process-fatal deferred usage drain did not settle after usage finished.",
      );
      assert.equal(drainSettled, true);

      assistantPhaseCanFinish.resolve();
      assert.ok(resultPromise);
      await withRealTimeout(
        resultPromise,
        1_000,
        () => "Runtime did not finish after blocked fatal-drain phase was released.",
      );
    } finally {
      assistantPhaseCanFinish.resolve();
      releaseUsageRecord.resolve();
      if (resultPromise) {
        await resultPromise.catch(() => undefined);
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wakes during the final idle checkpoint drain after the checkpoint commits", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointWakeImportContextMilestones: unknown[] = [];
    const firstCheckpointResponse = createDeferred<HostedWorkspaceCheckpointResponse>();
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_checkpoint_wake_001",
        laneSeq: "1",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_pending_wake",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: `${checkpointRequests.length}`.repeat(64).slice(0, 64),
                key: `users/bundles/member-synthetic/runtime-idle-checkpoint-pending-${checkpointRequests.length}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem(item, context) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.id === "mailbox_item_entrypoint_checkpoint_wake_002") {
              checkpointWakeImportContextMilestones.push(
                structuredClone(context?.latencyMilestones ?? null),
              );
            }
            return { status: "imported" };
          },
          latencyMilestones: {
            phaseBreakdown: {
              schemaVersion: 1,
              dispatch: {
                invokeReceivedAtEpochMs: 1_777_000_000_000,
                containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
              },
              boot: { nodeStartupMs: 4321 },
            },
            runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push(`workspace.checkpoint:${request.expectedWorkspaceVersion}`);
                checkpointRequests.push(request);
                if (checkpointRequests.length === 1) {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_checkpoint_wake_002",
                    laneSeq: "2",
                  }));
                  runtimeWakeSignal.notify();
                  return await firstCheckpointResponse.promise;
                }
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    version: "6",
                  }),
                };
              },
            },
          }),
          runtimeWakeSignal,
          vaultRoot,
        },
      );

      await waitUntil(() => {
        assert.equal(checkpointRequests.length, 1);
      }, 5_000);
      firstCheckpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({
          snapshotRef: checkpointRequests[0]!.snapshotRef,
          version: "5",
        }),
      });

      const result = await resultPromise;

      assert.deepEqual(readConversationImportedSeqs(fetchRequests), ["0", "1"]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_checkpoint_wake_001",
        "mailbox.importItem:mailbox_item_entrypoint_checkpoint_wake_002",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.expectedWorkspaceVersion), [
        "4",
        "5",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) =>
          request.redactedStatus?.hostedMailboxConversationImportedSeq
        ),
        ["1", "2"],
      );
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      assert.equal(result.status, "idle");
      expect(checkpointWakeImportContextMilestones).toEqual([
        expect.objectContaining({
          phaseBreakdown: expect.objectContaining({
            schemaVersion: 1,
            dispatch: {
              invokeReceivedAtEpochMs: 1_777_000_000_000,
              containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
            },
            boot: expect.objectContaining({
              nodeStartupMs: 4321,
              restoreWasCold: expect.any(Boolean),
            }),
            wake: expect.objectContaining({
              runtimeWakeNotifiedAtEpochMs: expect.any(Number),
              foregroundWaitResolvedAtEpochMs: expect.any(Number),
              foregroundImportStartedAtEpochMs: expect.any(Number),
            }),
          }),
          runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          runtimePhaseStartedAt: expect.any(String),
          workspaceRestoreDoneAt: expect.any(String),
        }),
      ]);
    } finally {
      firstCheckpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({ version: "5" }),
      });
      await removeTempRoot(vaultRoot);
    }
  });

  });

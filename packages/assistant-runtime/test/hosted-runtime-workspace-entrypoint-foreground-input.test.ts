import {
  TEST_NOW,
  TEST_USER_ID,
  createBundleRef,
  createDeferred,
  createImageFailureCodexAppServerCommand,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceSnapshotV2Ref,
  createWorkspaceState,
  mocks,
  removeTempRoot,
  requireEventIndex,
  stageAssistantInputEventForMailboxItem,
  stagePendingLinqAssistantInputForMailboxItem,
  waitForFakeTimerScheduled,
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
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionEnvironmentInterviewCompletedWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionRuntimeControlWake,
  deriveHostedExecutionErrorCode,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
} from "@murphai/hosted-execution/env";
import {
  appendAssistantTranscriptEntries,
  createAssistantOutboxIntent,
  ensureAutomaticMealCloseoutAutomation,
  getAssistantCronStatus,
  listAssistantTranscriptEntries,
  MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
  listAssistantOutboxIntents,
  markAssistantOutboxIntentSentById,
  readAssistantContextSnapshotState,
  refreshAssistantContextSnapshotBestEffort,
  recordHostedMailboxAssistantInputItem,
  saveAssistantOutboxIntent,
  saveAssistantSession,
  type AssistantHostedImageGenerationLauncher,
  type RunAssistantAutomationPassInput,
} from "@murphai/assistant-engine";
import {
  readAssistantInputEvent,
  shouldGroupAdjacentAssistantInputCandidates,
  updateAssistantInputAttachmentEvidence,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
  writeAssistantAutoReplyReplyTerminalEvidence,
} from "@murphai/assistant-engine/assistant-automation";
import {
  saveAssistantAutomationState,
  updateAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-state";
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
  runHostedWorkspaceAssistantPhase,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";
import {
  importHostedConversationMailboxItem,
} from "../src/hosted-runtime/mailbox-conversation-import.ts";
import {
  collectHostedPendingAssistantInputMediaRetentionProtections,
  compactHostedPendingAssistantInputIds,
  enqueueHostedPendingAssistantInputId,
  ensureHostedPendingAssistantInputIndex,
  inspectHostedPendingAssistantInputWakeCandidate,
  readHostedPendingAssistantInputIds,
} from "../src/hosted-runtime/pending-input-index.ts";
import {
  recordHostedMaterializedArtifactPaths,
  resolveHostedMaterializedArtifactStateRelativePath,
} from "../src/hosted-runtime/materialized-artifact-state.ts";
import {
  createHostedAssistantTurnEnvironment,
  normalizeHostedAssistantRuntimeConfig,
} from "../src/hosted-runtime/environment.ts";
import {
  createHostedAssistantInputSource,
  selectHostedAssistantInputIds,
} from "../src/hosted-runtime/turn-input.ts";
import {
  HostedRuntimeArtifactReadError,
  type HostedRuntimeDeviceSyncPort,
  type HostedRuntimeMailboxPort,
  type HostedRuntimePlatform,
  type RuntimeLivenessPort,
  type HostedRuntimeWorkspacePort,
  type HostedRuntimeWorkspaceSnapshotPort,
} from "../src/hosted-runtime-contracts.ts";

describe("hosted workspace runtime entrypoint", () => {test("late foreground input outranks a due mailbox owner handoff before idle checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-foreground-preempt-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeAbortController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 25;
    const systemFollowUpWakeAt = TEST_NOW;
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_foreground_preempt_system",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    const importedInputIds: string[] = [];
    const assistantPhaseInputIds: string[][] = [];
    const assistantPhaseLinqContextTargets: string[][] = [];
    const lateConversationImportsComplete = createDeferred<void>();
    let assistantPhaseCalls = 0;
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_foreground_preempt_system",
            budget: {
              maxMailboxItems: 2,
            },
            idleCheckpointDelayMs,
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
                key: "users/bundles/member-synthetic/runtime-foreground-preempt.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.lane !== "conversation") {
              return { status: "imported" };
            }

            const inputId = await stagePendingLinqAssistantInputForMailboxItem({
              item: item.item,
              threadId: `thread_${item.item.laneSeq}`,
              vaultRoot,
            });
            importedInputIds.push(inputId);
            if (importedInputIds.length === 2) {
              lateConversationImportsComplete.resolve();
            }
            const target = `thread_${item.item.laneSeq}`;
            return {
              assistantInputId: inputId,
              linqDeliveryContext: {
                directRecipientPhoneNumber: "+15550000001",
                fromPhoneNumber: null,
                replyToMessageId: `msg_${item.item.id}`,
                routeAuthority: {
                  accountLookupKey: `hbidx:${target}`,
                  channel: "linq" as const,
                  containerMemberId: `member_${target}`,
                  threadId: target,
                },
                service: "iMessage",
                target,
                threadIsDirect: true,
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
          async runAssistantPhase(phaseInput) {
            assistantPhaseCalls += 1;
            assistantPhaseInputIds.push([
              ...(phaseInput.initialAssistantInputBatch?.assistantInputIds
                ?? phaseInput.initialMailboxImport.importResult.assistantInputIds
                ?? []),
            ]);
            assistantPhaseLinqContextTargets.push([
              ...(phaseInput.initialAssistantInputBatch?.linqDeliveryContexts
                ?? phaseInput.initialMailboxImport.importResult.linqDeliveryContexts
                ?? [])
                .map((context) => context.target ?? ""),
            ]);
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              const systemRedactedStatus: HostedRuntimeRedactedJson = {
                hostedSystemMailboxRecorded: 1,
              };
              return {
                afterCheckpoint: async () => {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_foreground_preempt_conversation_1",
                    laneSeq: "1",
                    occurredAt: "2026-04-27T00:00:01.000Z",
                  }));
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_foreground_preempt_conversation_2",
                    laneSeq: "2",
                    occurredAt: "2026-04-27T00:00:02.000Z",
                  }));
                  runtimeWakeSignal.notify();
                  await lateConversationImportsComplete.promise;

                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_foreground_preempt_system_deferred",
                    kind: "device-sync.wake",
                    lane: "system",
                    laneSeq: "2",
                    occurredAt: "2026-04-27T00:00:02.000Z",
                  }));
                  runtimeWakeSignal.notify();
                  await waitUntil(() => {
                    assert.ok(fetchRequests.some((request) =>
                      request.requestId.includes(":runtime-wake:")
                      && request.requestId.includes(":system")
                      && request.lanes.some((lane) =>
                        lane.lane === "system" && lane.importedSeq === "1"
                      )
                    ));
                  }, 15_000);
                  events.push("system.afterCheckpoint");
                  return {
                    checkpointReason: "system_mailbox_receipt" as const,
                    nextWakeAt: systemFollowUpWakeAt,
                    nextWakeReason: "mailbox",
                    redactedStatus: systemRedactedStatus,
                  };
                },
                afterCheckpointKeepsForegroundImportLoop: true,
                checkpointReason: "system_mailbox_receipt" as const,
                nextWakeAt: systemFollowUpWakeAt,
                nextWakeReason: "mailbox",
                progressed: true,
                redactedStatus: systemRedactedStatus,
              };
            }

            const assistantRedactedStatus: HostedRuntimeRedactedJson = {
              hostedAssistantProgressed: true,
            };
            const selectedInputIds = assistantPhaseInputIds.at(-1) ?? [];
            const releaseProviderInputs =
              await phaseInput.beforeProviderAcceptedInputs?.({
                turnId: "turn_hosted_runtime_test",
                acceptedInputs: selectedInputIds.map((id) => ({
                  id,
                  source: "assistant-input" as const,
                })),
              });
            for (const inputId of selectedInputIds) {
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId,
                vaultRoot,
              });
            }
            await releaseProviderInputs?.();

            return {
              checkpointReason: "assistant_runtime_commit" as const,
              nextWakeAt: null,
              progressed: true,
              redactedStatus: assistantRedactedStatus,
            };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );
      const result = await withRealTimeout(
        resultPromise,
        15_000,
        () => events.join(","),
      );

      assert.ok(events.includes(
        "mailbox.importItem:mailbox_item_entrypoint_foreground_preempt_conversation_1",
      ));
      assert.ok(events.includes(
        "mailbox.importItem:mailbox_item_entrypoint_foreground_preempt_conversation_2",
      ));
      assert.equal(importedInputIds.length, 2);
      assert.deepEqual(assistantPhaseInputIds[1], [importedInputIds[0]]);
      assert.deepEqual(assistantPhaseLinqContextTargets[1], ["thread_1"]);
      assert.deepEqual(assistantPhaseInputIds[2], [importedInputIds[1]]);
      assert.deepEqual(assistantPhaseLinqContextTargets[2], ["thread_2"]);
      assert.ok(
        requireEventIndex(events, "assistant.phase:2")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
        "fresh foreground input should be serviced before idle checkpoint snapshotting starts",
      );
      assert.ok(
        requireEventIndex(events, "assistant.phase:3")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
        "each selected foreground route should be serviced before idle checkpoint snapshotting starts",
      );
      assert.ok(
        fetchRequests.some((request) =>
          request.lanes.some((lane) => lane.lane === "conversation")
        ),
      );
      assert.ok(
        fetchRequests.some((request) =>
          request.requestId.includes(":runtime-wake:")
          && request.requestId.includes(":system")
          && request.lanes.some((lane) =>
            lane.lane === "system" && lane.importedSeq === "1"
          )
        ),
      );
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      const checkpointWakeAt = checkpointRequests[0]?.nextWakeAt ?? null;
      assert.equal(checkpointWakeAt, systemFollowUpWakeAt);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, checkpointWakeAt);
    } finally {
      runtimeAbortController.abort();
      await removeTempRoot(vaultRoot);
    }
  });

  test("batch-full foreground rerun leaves later foreground wake pending", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-foreground-batch-limit-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeAbortController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_foreground_batch_limit_system",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    const importedInputIds: string[] = [];
    const assistantPhaseInputIds: string[][] = [];
    const assistantPhaseLinqContextTargets: string[][] = [];
    const initialConversationImportsComplete = createDeferred<void>();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_foreground_batch_limit",
            budget: {
              maxMailboxItems: 1,
            },
            idleCheckpointDelayMs: 25,
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
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/runtime-foreground-batch-limit.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.lane !== "conversation") {
              return { status: "imported" };
            }

            const target = `thread_${item.item.laneSeq}`;
            const inputId = await stagePendingLinqAssistantInputForMailboxItem({
              item: item.item,
              threadId: target,
              vaultRoot,
            });
            importedInputIds.push(inputId);
            if (importedInputIds.length === 2) {
              initialConversationImportsComplete.resolve();
            }
            return {
              assistantInputId: inputId,
              linqDeliveryContext: {
                directRecipientPhoneNumber: "+15550000001",
                fromPhoneNumber: null,
                replyToMessageId: `msg_${item.item.id}`,
                routeAuthority: {
                  accountLookupKey: `hbidx:${target}`,
                  channel: "linq" as const,
                  containerMemberId: `member_${target}`,
                  threadId: target,
                },
                service: "iMessage",
                target,
                threadIsDirect: true,
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
          async runAssistantPhase(phaseInput) {
            assistantPhaseCalls += 1;
            assistantPhaseInputIds.push([
              ...(phaseInput.initialAssistantInputBatch?.assistantInputIds
                ?? phaseInput.initialMailboxImport.importResult.assistantInputIds
                ?? []),
            ]);
            assistantPhaseLinqContextTargets.push([
              ...(phaseInput.initialAssistantInputBatch?.linqDeliveryContexts
                ?? phaseInput.initialMailboxImport.importResult.linqDeliveryContexts
                ?? [])
                .map((context) => context.target ?? ""),
            ]);
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              const systemRedactedStatus: HostedRuntimeRedactedJson = {
                hostedSystemMailboxRecorded: 1,
              };
              return {
                afterCheckpoint: async () => {
                  for (let seq = 1; seq <= 2; seq += 1) {
                    mailboxItems.push(createMailboxItem({
                      id: `mailbox_item_entrypoint_foreground_batch_limit_conversation_${seq}`,
                      laneSeq: String(seq),
                      occurredAt: `2026-04-27T00:00:0${seq}.000Z`,
                    }));
                  }
                  runtimeWakeSignal.notify();
                  await initialConversationImportsComplete.promise;
                  return {
                    checkpointReason: "system_mailbox_receipt" as const,
                    nextWakeAt: "2099-04-27T00:10:00.000Z",
                    nextWakeReason: "device-sync.reconcile",
                    redactedStatus: systemRedactedStatus,
                  };
                },
                afterCheckpointKeepsForegroundImportLoop: true,
                checkpointReason: "system_mailbox_receipt" as const,
                nextWakeAt: "2099-04-27T00:10:00.000Z",
                nextWakeReason: "device-sync.reconcile",
                progressed: true,
                redactedStatus: systemRedactedStatus,
              };
            }

            if (assistantPhaseCalls === 2) {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_foreground_batch_limit_conversation_3",
                laneSeq: "3",
                occurredAt: "2026-04-27T00:00:03.000Z",
              }));
              runtimeWakeSignal.notify();
            }

            const assistantRedactedStatus: HostedRuntimeRedactedJson = {
              hostedAssistantProgressed: true,
            };
            return {
              checkpointReason: "assistant_runtime_commit" as const,
              nextWakeAt: null,
              progressed: true,
              redactedStatus: assistantRedactedStatus,
            };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );
      const result = await withRealTimeout(
        resultPromise,
        15_000,
        () => events.join(","),
      );

      assert.equal(importedInputIds.length, 3);
      assert.deepEqual(assistantPhaseInputIds[1], [importedInputIds[0]]);
      assert.deepEqual(assistantPhaseLinqContextTargets[1], ["thread_1"]);
      assert.equal(assistantPhaseInputIds[2]?.length, 1);
      // The foreground selector admits one direct route per phase, so the
      // second accepted input stays ahead of the later third input.
      assert.deepEqual(assistantPhaseInputIds[2], [importedInputIds[1]]);
      assert.deepEqual(assistantPhaseLinqContextTargets[2], ["thread_2"]);
      assert.deepEqual(assistantPhaseInputIds[3], [importedInputIds[2]]);
      assert.deepEqual(assistantPhaseLinqContextTargets[3], ["thread_3"]);
      assert.ok(
        requireEventIndex(events, "assistant.phase:2")
          < requireEventIndex(
            events,
            "mailbox.importItem:mailbox_item_entrypoint_foreground_batch_limit_conversation_3",
          ),
        "the batch-full rerun must not consume and drop the later wake",
      );
      assert.ok(
        fetchRequests.some((request) =>
          request.requestId.includes(":runtime-wake:")
          && request.requestId.includes(":conversation")
          && request.lanes.some((lane) =>
            lane.lane === "conversation" && lane.importedSeq === "0"
          )
        ),
      );
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.nextWakeReason, "device-sync.reconcile");
      assert.equal(result.nextWakeAt, checkpointRequests[0]?.nextWakeAt ?? null);
    } finally {
      runtimeAbortController.abort();
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([11, 21])(
    "keeps one fresh conversation input live across %i due preference items",
    async (preferenceItemCount) => {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-preference-pages-"));
      const events: string[] = [];
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const runtimeAbortController = new AbortController();
      const conversationItem = createMailboxItem({
        id: `mailbox_item_entrypoint_preference_pages_${preferenceItemCount}`,
        laneSeq: "1",
      });
      const selectedInputIdsByPhase: string[][] = [];
      let importedInputId: string | null = null;
      let preferencesApplied = 0;
      let providerCalls = 0;

      try {
        await initializeVault({ createdAt: TEST_NOW, vaultRoot });
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: `attempt_synthetic_preference_pages_${preferenceItemCount}`,
              budget: {
                maxMailboxItems: 1,
              },
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
                  hash: "8".repeat(64),
                  key: `users/bundles/member-synthetic/preference-pages-${preferenceItemCount}.bundle.json`,
                  size: 640,
                }),
              };
            },
            async importItem(item) {
              importedInputId = await stagePendingLinqAssistantInputForMailboxItem({
                item: item.item,
                threadId: "thread_preference_pages",
                vaultRoot,
              });
              return {
                assistantInputId: importedInputId,
                status: "imported",
              };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [conversationItem],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            async runAssistantPhase(phaseInput) {
              const acceptedInputIds = phaseInput.initialAssistantInputBatch?.assistantInputIds
                ?? phaseInput.initialMailboxImport.importResult.assistantInputIds
                ?? [];
              const selection = await selectHostedAssistantInputIds({
                freshAssistantInputIds: acceptedInputIds,
                mode: "foreground",
                vaultRoot,
              });
              selectedInputIdsByPhase.push(selection.inputIds);
              if (selection.inputIds.length === 0) {
                return {
                  foregroundReplyFailed: 0,
                  progressed: false,
                };
              }

              const pageSize = Math.min(10, preferenceItemCount - preferencesApplied);
              preferencesApplied += pageSize;
              events.push(`preferences.applied:${preferencesApplied}`);
              if (preferencesApplied < preferenceItemCount) {
                return {
                  checkpointReason: "system_mailbox_receipt" as const,
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              events.push("provider.accepted");
              providerCalls += 1;
              const selectedInputId = selection.inputIds[0];
              assert.ok(selectedInputId);
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId: selectedInputId,
                vaultRoot,
              });
              return {
                checkpointReason: "assistant_runtime_commit" as const,
                foregroundReplyFailed: 0,
                nextWakeAt: null,
                progressed: true,
              };
            },
            signal: runtimeAbortController.signal,
            vaultRoot,
          },
        );

        assert.ok(importedInputId);
        assert.equal(preferencesApplied, preferenceItemCount);
        assert.equal(providerCalls, 1);
        assert.deepEqual(
          selectedInputIdsByPhase.filter((inputIds) => inputIds.length > 0),
          Array.from(
            { length: Math.ceil(preferenceItemCount / 10) },
            () => [importedInputId],
          ),
        );
        assert.ok(
          requireEventIndex(events, `preferences.applied:${preferenceItemCount}`)
            < requireEventIndex(events, "provider.accepted"),
        );
        assert.ok(
          requireEventIndex(events, "provider.accepted")
            < requireEventIndex(events, "workspace.checkpoint"),
        );
        assert.ok(
          requireEventIndex(events, "provider.accepted")
            < requireEventIndex(events, "snapshot:idle_shutdown"),
        );
        assert.equal(checkpointRequests.length, 1);
        assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      } finally {
        runtimeAbortController.abort();
        await removeTempRoot(vaultRoot);
      }
    },
  );

  test("keeps an uncovered successor ahead of the boundary after handled-prefix repair", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-prefix-repair-order-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeAbortController = new AbortController();
    const importedInputIds: string[] = [];
    const selectedInputIdsByPhase: string[][] = [];
    const providerInputIdsByTurn: string[][] = [];
    const mailboxItems = Array.from({ length: 4 }, (_, index) => {
      const laneSeq = String(index + 1);
      return createMailboxItem({
        id: `mailbox_item_entrypoint_prefix_repair_order_${laneSeq}`,
        laneSeq,
        occurredAt: `2026-04-27T00:00:0${laneSeq}.000Z`,
      });
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_prefix_repair_order",
            budget: {
              maxMailboxItems: 4,
            },
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
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/runtime-prefix-repair-order.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            const inputId = await stagePendingLinqAssistantInputForMailboxItem({
              causalSeq: item.item.laneSeq,
              item: item.item,
              threadId: item.item.laneSeq === "4"
                ? "thread_boundary"
                : "thread_repaired_group",
              vaultRoot,
            });
            importedInputIds.push(inputId);
            return {
              assistantInputId: inputId,
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
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          async runAssistantPhase(phaseInput) {
            const acceptedInputIds = phaseInput.initialAssistantInputBatch?.assistantInputIds
              ?? phaseInput.initialMailboxImport.importResult.assistantInputIds
              ?? [];
            const selection = acceptedInputIds.length > 0
              ? await selectHostedAssistantInputIds({
                  freshAssistantInputIds: acceptedInputIds,
                  mode: "foreground",
                  vaultRoot,
                })
              : await selectHostedAssistantInputIds({
                  mode: "background",
                  vaultRoot,
                });
            if (selection.inputIds.length === 0) {
              return {
                foregroundReplyFailed: 0,
                nextWakeAt: null,
                progressed: false,
                redactedStatus: {
                  hostedAssistantProgressed: false,
                },
              };
            }

            selectedInputIdsByPhase.push(selection.inputIds);

            if (selectedInputIdsByPhase.length === 1) {
              // The assistant-engine regression owns the detailed evidence
              // validation. Exercise its persisted postcondition here: A and B
              // are terminal and checkpointed, while compatible successor C
              // remains pending and boundary D is the precomputed local tail.
              assert.deepEqual(selection.inputIds, importedInputIds.slice(0, 3));
              for (const inputId of importedInputIds.slice(0, 2)) {
                await writeSyntheticAssistantAutoReplyTerminalEvidence({
                  inputId,
                  vaultRoot,
                });
              }
              const repairedThrough = await readAssistantInputEvent({
                inputId: importedInputIds[1] ?? "",
                vault: vaultRoot,
              });
              assert.ok(repairedThrough);
              await updateAssistantAutomationState(vaultRoot, (state) => ({
                ...state,
                autoReply: state.autoReply.map((entry) => ({
                  ...entry,
                  eligibleAfter: repairedThrough.cursor,
                })),
                updatedAt: TEST_NOW,
              }));
            } else {
              providerInputIdsByTurn.push(selection.inputIds);
              assert.equal(selection.inputIds.length, 1);
              const inputId = selection.inputIds[0];
              assert.ok(inputId);
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId,
                vaultRoot,
              });
            }

            return {
              checkpointReason: "assistant_runtime_commit" as const,
              foregroundReplyFailed: 0,
              nextWakeAt: null,
              progressed: true,
              redactedStatus: {
                hostedAssistantProgressed: true,
              },
            };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      assert.equal(importedInputIds.length, 4);
      assert.deepEqual(selectedInputIdsByPhase, [
        importedInputIds.slice(0, 3),
        [importedInputIds[2]],
        [importedInputIds[3]],
      ]);
      assert.deepEqual(providerInputIdsByTurn, [
        [importedInputIds[2]],
        [importedInputIds[3]],
      ]);
      assert.deepEqual(await compactHostedPendingAssistantInputIds({ vaultRoot }), []);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
    } finally {
      runtimeAbortController.abort();
      await removeTempRoot(vaultRoot);
    }
  });

  test("preserves the inbox bootstrap retry across an all-pending boundary tail", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-bootstrap-boundary-tail-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeAbortController = new AbortController();
    const mailboxItems = Array.from({ length: 4 }, (_, index) => {
      const laneSeq = String(index + 1);
      return createMailboxItem({
        id: `mailbox_item_entrypoint_bootstrap_boundary_tail_${laneSeq}`,
        laneSeq,
        occurredAt: `2026-04-27T00:00:0${laneSeq}.000Z`,
      });
    });
    const importedInputIds: string[] = [];
    const secondBootstrapObserved = createDeferred<void>();
    const scheduledRetryObserved = createDeferred<number>();
    const originalAutomationPass =
      mocks.runAssistantAutomationPass.getMockImplementation();
    let automationPassCount = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    assert.ok(originalAutomationPass);
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.runAssistantAutomationPass.mockClear();
      mocks.runAssistantAutomationPass.mockImplementation(
        async (input: RunAssistantAutomationPassInput) => {
          automationPassCount += 1;
          events.push(`automation.pass:${automationPassCount}:${Date.now()}`);
          if (automationPassCount <= 2) {
            if (automationPassCount === 2) {
              secondBootstrapObserved.resolve();
            }
            throw { code: "INBOX_NOT_INITIALIZED" };
          }

          scheduledRetryObserved.resolve(Date.now());
          assert.ok(input.signal);
          return await new Promise((_, reject) => {
            if (input.signal?.aborted) {
              reject(input.signal.reason);
              return;
            }
            input.signal?.addEventListener(
              "abort",
              () => reject(input.signal?.reason),
              { once: true },
            );
          });
        },
      );

      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_bootstrap_boundary_tail",
            budget: {
              maxMailboxItems: 4,
            },
            idleCheckpointDelayMs: 180_000,
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
                hash: "7".repeat(64),
                key: "users/bundles/member-synthetic/bootstrap-boundary-tail.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            const inputId = await stagePendingLinqAssistantInputForMailboxItem({
              causalSeq: item.item.laneSeq,
              item: item.item,
              threadId: item.item.laneSeq === "4"
                ? "thread_bootstrap_boundary"
                : "thread_bootstrap_group",
              vaultRoot,
            });
            importedInputIds.push(inputId);
            return {
              assistantInputId: inputId,
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
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(secondBootstrapObserved.promise, 15_000, () =>
        events.join(",")
      );
      await waitForFakeTimerScheduled(() => events.join(","));
      assert.equal(automationPassCount, 2);
      assert.equal(importedInputIds.length, 4);
      assert.deepEqual(
        await inspectHostedPendingAssistantInputWakeCandidate({ vaultRoot }),
        {
          hasCandidate: true,
          indexComplete: true,
        },
      );
      assert.equal(
        checkpointRequests.some((request) => request.reason === "idle_shutdown"),
        false,
      );
      assert.equal(events.includes("snapshot:idle_shutdown"), false);

      await vi.advanceTimersByTimeAsync(30_000);
      const retryStartedAt = await withRealTimeout(
        scheduledRetryObserved.promise,
        1_000,
        () => events.join(","),
      );

      assert.equal(retryStartedAt, Date.parse(TEST_NOW) + 30_000);
      assert.equal(automationPassCount, 3);
      assert.equal(
        checkpointRequests.some((request) => request.reason === "idle_shutdown"),
        false,
      );
      assert.equal(events.includes("snapshot:idle_shutdown"), false);
    } finally {
      runtimeAbortController.abort(
        new DOMException("Synthetic test cleanup.", "AbortError"),
      );
      await resultPromise?.catch(() => undefined);
      mocks.runAssistantAutomationPass.mockImplementation(originalAutomationPass);
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("services an unindexed older input before an unrelated future reminder", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-unindexed-reminder-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeAbortController = new AbortController();
    const reminderWakeAt = "2026-04-27T06:00:00.000Z";
    const freshMailboxItem = createMailboxItem({
      id: "mailbox_item_entrypoint_unindexed_reminder_fresh",
      laneSeq: "1",
      occurredAt: TEST_NOW,
    });
    const firstPhaseObserved = createDeferred<void>();
    const olderInputServiced = createDeferred<number>();
    let olderInputId = "";
    let freshInputId = "";
    let assistantPhaseCalls = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: TEST_NOW,
        }],
        updatedAt: TEST_NOW,
        version: 1,
      });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_unindexed_reminder",
            budget: { maxMailboxItems: 4 },
            idleCheckpointDelayMs: 180_000,
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
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/unindexed-reminder.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            await ensureHostedPendingAssistantInputIndex({ vaultRoot });
            olderInputId = await stageAssistantInputEventForMailboxItem({
              item: createMailboxItem({
                id: "mailbox_item_entrypoint_unindexed_reminder_older",
                laneSeq: "2",
                occurredAt: "2026-04-26T23:59:59.000Z",
              }),
              threadId: "thread_unindexed_reminder_older",
              vaultRoot,
            });
            await updateAssistantInputProjection({
              inputId: olderInputId,
              projection: { status: "pending" },
              vault: vaultRoot,
            });
            freshInputId = await stagePendingLinqAssistantInputForMailboxItem({
              item: item.item,
              threadId: "thread_unindexed_reminder_fresh",
              vaultRoot,
            });
            return {
              assistantInputId: freshInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [freshMailboxItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: reminderWakeAt,
                nextWakeReason: "assistant",
                version: "4",
              }),
            }),
          }),
          async runAssistantPhase(phaseInput) {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}:${Date.now()}`);
            if (assistantPhaseCalls === 1) {
              assert.deepEqual(
                phaseInput.initialAssistantInputBatch?.assistantInputIds
                  ?? phaseInput.initialMailboxImport.importResult.assistantInputIds,
                [freshInputId],
              );
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId: freshInputId,
                vaultRoot,
              });
              firstPhaseObserved.resolve();
              return {
                checkpointReason: "assistant_runtime_commit" as const,
                foregroundReplyFailed: 0,
                nextWakeAt: reminderWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            assert.ok(await readAssistantInputEvent({
              inputId: olderInputId,
              vault: vaultRoot,
            }));
            await writeSyntheticAssistantAutoReplyTerminalEvidence({
              inputId: olderInputId,
              vaultRoot,
            });
            olderInputServiced.resolve(Date.now());
            return {
              checkpointReason: "assistant_runtime_commit" as const,
              foregroundReplyFailed: 0,
              nextWakeAt: null,
              progressed: true,
            };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(firstPhaseObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        await inspectHostedPendingAssistantInputWakeCandidate({ vaultRoot }),
        { hasCandidate: false, indexComplete: false },
      );
      assert.equal(events.includes("snapshot:idle_shutdown"), false);

      await vi.advanceTimersByTimeAsync(30_000);
      const servicedAt = await withRealTimeout(
        olderInputServiced.promise,
        1_000,
        () => events.join(","),
      );

      assert.equal(servicedAt, Date.parse(TEST_NOW) + 30_000);
      assert.equal(assistantPhaseCalls, 2);
      assert.equal(events.includes("snapshot:idle_shutdown"), false);
      assert.equal(
        checkpointRequests.some((request) => request.reason === "idle_shutdown"),
        false,
      );
    } finally {
      runtimeAbortController.abort(
        new DOMException("Synthetic test cleanup.", "AbortError"),
      );
      await resultPromise?.catch(() => undefined);
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("admits foreground input before a pending durable delivery effect", async () => {
    for (const shutdownDuringDelivery of [false, true]) {
      const scenario = shutdownDuringDelivery ? "shutdown" : "conversation";
      const vaultRoot = await mkdtemp(
        path.join(tmpdir(), `murph-foreground-delivery-image-${scenario}-`),
      );
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const events: string[] = [];
      const imageGenerationRelease = createDeferred<void>();
      const imageCompletionObserved = createDeferred<void>();
      const newerInputObserved = createDeferred<void>();
      const outcomeCheckpointObserved = createDeferred<void>();
      const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
      const shutdownController = new AbortController();
      const mailboxItems = [createMailboxItem({
        id: `mailbox_item_foreground_delivery_image_origin_${scenario}`,
        laneSeq: "1",
      })];
      let imageGenerationCompleted = false;
      let assistantPhaseCalls = 0;
      let newerInputId: string | null = null;
      let originInputId: string | null = null;
      let originInputServiced = false;
      let resultPromise:
        ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

      try {
        await initializeVault({ createdAt: TEST_NOW, vaultRoot });
        const pendingDurableDelivery = async () => {
          events.push("durable-delivery");
          assert.equal(imageGenerationCompleted, false);
          if (shutdownDuringDelivery) {
            shutdownController.abort(
              new DOMException("Synthetic container SIGTERM.", "AbortError"),
            );
          }
          return { requiresFollowUpCheckpoint: true };
        };

        resultPromise = runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: `attempt_foreground_delivery_image_${scenario}`,
              budget: { maxMailboxItems: 10 },
              idleCheckpointDelayMs: 1,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot() {
              const snapshotOrdinal = checkpointRequests.length + 1;
              events.push(`snapshot:${snapshotOrdinal}`);
              if (snapshotOrdinal <= 2) {
                assert.equal(imageGenerationCompleted, false);
              }
              return {
                snapshotRef: createBundleRef({
                  hash: (shutdownDuringDelivery ? "9" : "8").repeat(64),
                  key:
                    "users/bundles/member-synthetic/"
                    + `foreground-delivery-image-${scenario}-${snapshotOrdinal}.bundle.json`,
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              events.push(`mailbox-import:${item.item.laneSeq}`);
              const assistantInputId = await stageAssistantInputEventForMailboxItem({
                item: item.item,
                threadId: `thread_foreground_delivery_image_${scenario}`,
                vaultRoot,
              });
              if (item.item.laneSeq === "1") {
                originInputId = assistantInputId;
              } else {
                newerInputId = assistantInputId;
              }
              return {
                assistantInputId,
                status: "imported",
              };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({ events, items: mailboxItems }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                checkpointResponse(request) {
                  const checkpointOrdinal = checkpointRequests.length;
                  events.push(`checkpoint:${checkpointOrdinal}`);
                  if (!shutdownDuringDelivery && checkpointOrdinal === 1) {
                    mailboxItems.push(createMailboxItem({
                      id:
                        "mailbox_item_foreground_delivery_image_newer_conversation",
                      laneSeq: "2",
                      occurredAt: "2026-04-27T00:00:01.000Z",
                    }));
                  }
                  if (checkpointOrdinal === 2) {
                    outcomeCheckpointObserved.resolve();
                  }
                  return {
                    checkpointed: true,
                    ...(!shutdownDuringDelivery && checkpointOrdinal <= 2
                      ? { conversationInputAhead: true }
                      : {}),
                    workspace: createWorkspaceState({
                      inboxMediaRetentionWakeAt:
                        request.inboxMediaRetentionWakeAt ?? null,
                      nextWakeAt: request.nextWakeAt ?? null,
                      nextWakeReason: request.nextWakeReason ?? null,
                      redactedStatus: request.redactedStatus ?? null,
                      snapshotRef: request.snapshotRef,
                      version: String(
                        BigInt(request.expectedWorkspaceVersion) + 1n,
                      ),
                    }),
                  };
                },
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(phaseInput) {
              assistantPhaseCalls += 1;
              let assistantInputIds =
                phaseInput.initialAssistantInputBatch?.assistantInputIds ?? [];
              if (assistantInputIds.length === 0) {
                assistantInputIds =
                  phaseInput.initialMailboxImport.importResult.assistantInputIds
                  ?? [];
              }
              events.push(
                `assistant-phase:${assistantPhaseCalls}:${assistantInputIds.length}`,
              );

              if (!originInputServiced) {
                assert.equal(assistantPhaseCalls, 1);
                assert.ok(originInputId);
                assert.deepEqual(assistantInputIds, [originInputId]);
                const imageGenerationLauncher =
                  phaseInput.imageGenerationLauncher;
                assert.ok(imageGenerationLauncher);
                assert.equal(imageGenerationLauncher.launch({
                  continuationSessionId:
                    `asst_foreground_delivery_image_${scenario}`,
                  operationId:
                    `image_operation_foreground_delivery_${scenario}`,
                  originAssistantInputId: assistantInputIds[0]!,
                  originAssistantInputIdExact: true,
                  scopeId: `session_foreground_delivery_image_${scenario}`,
                  async run() {
                    await imageGenerationRelease.promise;
                    imageGenerationCompleted = true;
                    return {
                      failureDiagnostic:
                        "synthetic image completion after foreground delivery barrier",
                      media: null,
                      runtimeIssue: null,
                      savedImageRef: null,
                    };
                  },
                }), "started");
                const releaseProviderInputs =
                  await phaseInput.beforeProviderAcceptedInputs?.({
                    turnId: "turn_hosted_runtime_test",
                    acceptedInputs: [{
                      id: originInputId,
                      source: "assistant-input",
                    }],
                  });
                await writeSyntheticAssistantAutoReplyTerminalEvidence({
                  inputId: originInputId,
                  vaultRoot,
                });
                await releaseProviderInputs?.();
                originInputServiced = true;
                return {
                  afterCheckpoint: async () => ({
                    afterDurableCheckpoint: pendingDurableDelivery,
                    checkpointReason: "outbox_sending" as const,
                  }),
                  checkpointReason: "outbox_sending" as const,
                  progressed: true,
                };
              }

              const imageCompletionInputIds: string[] = [];
              for (const assistantInputId of assistantInputIds) {
                const event = await readAssistantInputEvent({
                  inputId: assistantInputId,
                  vault: vaultRoot,
                });
                if (
                  event?.sourceRef.kind === "hosted-mailbox"
                  && event.sourceRef.payloadSchema
                    === "murph.hosted-image-completion.v1"
                ) {
                  imageCompletionInputIds.push(assistantInputId);
                }
              }
              if (imageCompletionInputIds.length > 0) {
                const releaseProviderInputs =
                  await phaseInput.beforeProviderAcceptedInputs?.({
                    turnId: "turn_hosted_runtime_test",
                    acceptedInputs: imageCompletionInputIds.map((id) => ({
                      id,
                      source: "assistant-input" as const,
                    })),
                  });
                for (const assistantInputId of imageCompletionInputIds) {
                  await writeSyntheticAssistantAutoReplyTerminalEvidence({
                    inputId: assistantInputId,
                    vaultRoot,
                  });
                }
                await releaseProviderInputs?.();
                events.push("image-completion-admitted");
                imageCompletionObserved.resolve();
                shutdownController.abort(
                  new DOMException("Synthetic test completed.", "AbortError"),
                );
                return {
                  checkpointReason: "assistant_runtime_commit" as const,
                  progressed: true,
                };
              }

              if (!shutdownDuringDelivery && assistantPhaseCalls === 2) {
                assert.equal(shutdownDuringDelivery, false);
                assert.ok(newerInputId);
                assert.deepEqual(assistantInputIds, [newerInputId]);
                const releaseProviderInputs =
                  await phaseInput.beforeProviderAcceptedInputs?.({
                    turnId: "turn_hosted_runtime_test",
                    acceptedInputs: [{
                      id: newerInputId,
                      source: "assistant-input",
                    }],
                  });
                await writeSyntheticAssistantAutoReplyTerminalEvidence({
                  inputId: newerInputId,
                  vaultRoot,
                });
                await releaseProviderInputs?.();
                events.push("newer-input-admitted");
                newerInputObserved.resolve();
                return {
                  checkpointReason: "assistant_runtime_commit" as const,
                  progressed: true,
                };
              }

              return { progressed: false };
            },
            shutdownSignal: shutdownController.signal,
            vaultRoot,
          },
        );

        if (shutdownDuringDelivery) {
          await withRealTimeout(
            outcomeCheckpointObserved.promise,
            5_000,
            () => events.join(","),
          );
          assert.equal(imageGenerationCompleted, false);
          imageGenerationRelease.resolve();
          await withRealTimeout(
            resultPromise,
            5_000,
            () => events.join(","),
          );
          assert.equal(events.includes("newer-input-admitted"), false);
        } else {
          await withRealTimeout(
            outcomeCheckpointObserved.promise,
            5_000,
            () => events.join(","),
          );
          assert.equal(imageGenerationCompleted, false);
          runtimeWakeSignal.notify();
          await withRealTimeout(
            newerInputObserved.promise,
            5_000,
            () => events.join(","),
          );
          assert.equal(imageGenerationCompleted, false);
          imageGenerationRelease.resolve();
          await withRealTimeout(
            imageCompletionObserved.promise,
            5_000,
            () => events.join(","),
          );
          await withRealTimeout(
            resultPromise,
            5_000,
            () => events.join(","),
          );
        }

        assert.ok(
          requireEventIndex(events, "snapshot:1")
            < requireEventIndex(events, "checkpoint:1"),
          events.join(","),
        );
        if (shutdownDuringDelivery) {
          assert.ok(
            requireEventIndex(events, "checkpoint:1")
              < requireEventIndex(events, "durable-delivery"),
            events.join(","),
          );
          assert.ok(
            requireEventIndex(events, "durable-delivery")
              < requireEventIndex(events, "snapshot:2"),
            events.join(","),
          );
        } else {
          assert.ok(
            requireEventIndex(events, "checkpoint:1")
              < requireEventIndex(events, "newer-input-admitted"),
            events.join(","),
          );
          assert.ok(
            requireEventIndex(events, "newer-input-admitted")
              < requireEventIndex(events, "durable-delivery"),
            events.join(","),
          );
        }
      } finally {
        imageGenerationRelease.resolve();
        shutdownController.abort(new Error("Test cleanup."));
        if (resultPromise) {
          await withRealTimeout(
            resultPromise.catch(() => undefined),
            5_000,
            () => `Cleanup timed out: ${events.join(",")}`,
          );
        }
        await removeTempRoot(vaultRoot);
      }
    }
  }, 30_000);

  test("accepts separately grouped ready image completions before newly arrived conversation input", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-image-completion-preemption-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const exportedIssues: unknown[] = [];
    const releaseSha = "0123456789abcdef0123456789abcdef01234567";
    const runtimeAttemptId =
      "runtime-write-e2cfcf20-f792-4133-b40b-3f381b371dda";
    const runtimeName = "cloudflare-hosted-runner";
    const mailboxItems = [createMailboxItem({
      id: "mailbox_item_image_completion_preemption_origin",
      laneSeq: "1",
    })];
    const generatedMedia = [
      {
        alt: "Generated landscape",
        contentType: "image/webp" as const,
        filename: "generated-landscape.webp",
        kind: "vault_image" as const,
        ref: "raw/captures/2026/04/generated-landscape.webp",
        sha256: "c".repeat(64),
        sizeBytes: 18,
        source: "gpt-image-2",
      },
      {
        alt: "Generated portrait",
        contentType: "image/webp" as const,
        filename: "generated-portrait.webp",
        kind: "vault_image" as const,
        ref: "raw/captures/2026/04/generated-portrait.webp",
        sha256: "d".repeat(64),
        sizeBytes: 20,
        source: "gpt-image-2",
      },
    ];
    const imageReady = createDeferred<void>();
    const combinedPhaseObserved = createDeferred<void>();
    const runtimeAbortController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const originalAutomationPass =
      mocks.runAssistantAutomationPass.getMockImplementation();
    let assistantPhaseCalls = 0;
    let completionInputIds: readonly string[] = [];
    let freshInputId: string | null = null;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    assert.ok(originalAutomationPass);
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      mocks.runAssistantAutomationPass.mockImplementation(
        async (input: RunAssistantAutomationPassInput) => {
          const candidates = await input.inputSource?.listInputCandidates({
            afterCursor: null,
            limit: 10,
            sourceId: "linq",
          });
          const assistantInputIds = candidates?.inputs.map((candidate) =>
            candidate.event.inputId
          ) ?? [];
          if (assistantInputIds.length === 0) {
            return {
              currentTurnDeliveryIntentIds: [],
              nextWakeAt: null,
              progressed: false,
            };
          }

          assistantPhaseCalls += 1;
          const providerInputDetails = await Promise.all(
            assistantInputIds.map(async (inputId) => {
              const event = await readAssistantInputEvent({
                inputId,
                vault: vaultRoot,
              });
              return {
                inputId,
                payloadSchema: event?.sourceRef.kind === "hosted-mailbox"
                  ? event.sourceRef.payloadSchema
                  : null,
                sessionId: event?.conversation?.sessionId ?? null,
                threadId: event?.conversation?.threadId ?? null,
              };
            }),
          );
          assert.equal(
            assistantInputIds.length,
            assistantPhaseCalls === 1 ? 1 : 3,
            `provider turn ${assistantPhaseCalls}: ${JSON.stringify({
              freshInputId,
              providerInputDetails,
            })}`,
          );
          const acceptedInputGroups = assistantPhaseCalls === 1
            ? [assistantInputIds]
            : assistantInputIds.map((assistantInputId) => [assistantInputId]);
          const releaseProviderInputGroups = [];
          for (const acceptedInputIds of acceptedInputGroups) {
            releaseProviderInputGroups.push(
              await input.beforeProviderAcceptedInputs?.({
                turnId: "turn_hosted_runtime_test",
                acceptedInputs: acceptedInputIds.map((id) => ({
                  id,
                  source: "assistant-input" as const,
                })),
              }),
            );
          }

          if (assistantPhaseCalls === 1) {
            const assistantInputId = assistantInputIds[0]!;
            const imageGenerationLauncher =
              input.executionContext?.hosted?.imageGenerationLauncher;
            assert.ok(imageGenerationLauncher);
            for (const [index, media] of generatedMedia.entries()) {
              assert.equal(
                imageGenerationLauncher.launch({
                  continuationSessionId:
                    `asst_image_completion_preemption_${index + 1}`,
                  operationId:
                    `image_operation_completion_preemption_${index + 1}`,
                  originAssistantInputId: assistantInputId,
                  originAssistantInputIdExact: false,
                  scopeId: `session_image_completion_preemption_${index + 1}`,
                  async run() {
                    await imageReady.promise;
                    return {
                      ...(index === 0
                        ? {
                            failureDiagnostic:
                              "synthetic generated image private delivery failure",
                            media: null,
                            runtimeIssue: {
                              component: "assistant.generated-image",
                              errorCode:
                                "GENERATED_IMAGE_PRIVATE_DELIVERY_FAILED",
                              issueKind: "tool_error" as const,
                              operation: "generated_image_private_delivery",
                              phase: "tool_call" as const,
                              severity: "warning" as const,
                              summary:
                                "Generated image private delivery failed.",
                            },
                            savedImageRef: null,
                          }
                        : {
                            media,
                            runtimeIssue: null,
                            savedImageRef: media.ref,
                          }),
                    };
                  },
                }),
                "started",
              );
            }
            imageReady.resolve();
            await withRealTimeout(
              (async () => {
                while (
                  generatedMedia.some((_media, index) =>
                    imageGenerationLauncher.readStatus?.(
                      `session_image_completion_preemption_${index + 1}`,
                    ) !== "queued"
                  )
                ) {
                  await new Promise<void>((resolve) => setImmediate(resolve));
                }
              })(),
              1_000,
              () => events.join(","),
            );
            mailboxItems.push(createMailboxItem({
              id: "mailbox_item_image_completion_preemption_fresh",
              laneSeq: "2",
              occurredAt: new Date(Date.now() + 1_000).toISOString(),
            }));
            runtimeWakeSignal.notify();
          } else if (assistantPhaseCalls === 2) {
            completionInputIds = assistantInputIds.slice(0, 2);
            for (const completionInputId of completionInputIds) {
              const completion = await readAssistantInputEvent({
                inputId: completionInputId,
                vault: vaultRoot,
              });
              assert.equal(
                completion?.sourceRef.kind === "hosted-mailbox"
                  ? completion.sourceRef.payloadSchema
                  : null,
                "murph.hosted-image-completion.v1",
              );
            }
            assert.ok(freshInputId);
            assert.deepEqual(assistantInputIds, [
              ...completionInputIds,
              freshInputId,
            ]);
            combinedPhaseObserved.resolve();
          } else {
            throw new Error("Unexpected extra image completion preemption phase.");
          }

          for (const assistantInputId of assistantInputIds) {
            await writeSyntheticAssistantAutoReplyTerminalEvidence({
              inputId: assistantInputId,
              vaultRoot,
            });
          }
          for (const releaseProviderInputs of releaseProviderInputGroups) {
            await releaseProviderInputs?.();
          }
          if (assistantPhaseCalls === 2) {
            runtimeAbortController.abort(
              new DOMException("Synthetic test completed.", "AbortError"),
            );
          }
          return {
            currentTurnDeliveryIntentIds: [],
            nextWakeAt: null,
            progressed: true,
            replies: {
              considered: assistantInputIds.length,
              failed: 0,
              replied: assistantInputIds.length,
              skipped: 0,
            },
          };
        },
      );
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: runtimeAttemptId,
            budget: { maxMailboxItems: 10 },
            idleCheckpointDelayMs: 180_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "5".repeat(64),
                key: "users/bundles/member-synthetic/image-completion-preemption.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            const inputId = await stagePendingLinqAssistantInputForMailboxItem({
              item: item.item,
              threadId: "thread_image_completion_preemption",
              threadIsDirect: false,
              vaultRoot,
            });
            if (item.item.laneSeq === "2") {
              freshInputId = inputId;
            }
            return {
              assistantInputId: inputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            issueExportPort: {
              async recordIssues(issues) {
                exportedIssues.push(...issues);
                const issueIds = issues.map((issue) => {
                  const issueId = (issue as { issueId?: unknown }).issueId;
                  if (typeof issueId !== "string") {
                    throw new Error("expected exported image runtime issue id");
                  }
                  return issueId;
                });
                return {
                  issueIds,
                  recorded: issues.length,
                };
              },
            },
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeIssueProvenance: {
            releaseSha,
            runtimeName,
          },
          runtimeWakeSignal,
          shutdownSignal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        combinedPhaseObserved.promise,
        15_000,
        () => events.join(","),
      );
      await withRealTimeout(resultPromise, 15_000, () => events.join(","));
      assert.equal(assistantPhaseCalls, 2);
      assert.equal(completionInputIds.length, 2);
      expect(exportedIssues).toEqual([
        expect.objectContaining({
          environment: "hosted",
          errorCode: "GENERATED_IMAGE_PRIVATE_DELIVERY_FAILED",
          releaseSha,
          runtimeAttemptId,
          runtimeName,
        }),
      ]);
    } finally {
      runtimeAbortController.abort(
        new DOMException("Synthetic test cleanup.", "AbortError"),
      );
      await resultPromise?.catch(() => undefined);
      mocks.runAssistantAutomationPass.mockImplementation(originalAutomationPass);
      await removeTempRoot(vaultRoot);
    }
  });

  test("records live and background acceptance without coupling trace failure", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-image-evidence-retry-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];
    const missingAcceptedInputId = "ain_00000000000000000000000000000000";
    const mailboxItems = [createMailboxItem({
      id: "mailbox_item_image_evidence_retry_origin",
      laneSeq: "1",
    })];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let assistantPhaseCalls = 0;
    let completionReplyCount = 0;
    let firstDeliveryIntent: Awaited<
      ReturnType<typeof createAssistantOutboxIntent>
    > | null = null;
    let firstCompletionInputId: string | null = null;
    let imageIndexFailureInjected = false;
    let imageProviderInvocationCount = 0;
    let originInputId: string | null = null;
    let secondCompletionInputId: string | null = null;
    let terminalEvidenceReadFailureInjected = false;
    let terminalEvidenceRetryObserved = false;
    const imageGenerationLauncherRef: {
      current: AssistantHostedImageGenerationLauncher | null;
    } = { current: null };
    const firstPrivateMedia = {
      alt: "Generated sunrise",
      contentType: "image/webp" as const,
      filename: "generated-sunrise.webp",
      kind: "vault_image" as const,
      ref: "raw/captures/2026/04/generated-sunrise.webp",
      sha256: "a".repeat(64),
      sizeBytes: 12,
      source: "gpt-image-2",
    };
    const secondPrivateMedia = {
      alt: "Generated moonrise",
      contentType: "image/webp" as const,
      filename: "generated-moonrise.webp",
      kind: "vault_image" as const,
      ref: "raw/captures/2026/04/generated-moonrise.webp",
      sha256: "b".repeat(64),
      sizeBytes: 14,
      source: "gpt-image-2",
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      mocks.enqueueHostedPendingAssistantInputId.mockClear();
      mocks.hasCompleteAssistantAutoReplyDeliveryTerminalEvidence.mockClear();
      const actualEnqueue = mocks.actualEnqueueHostedPendingAssistantInputId;
      const actualHasCompleteTerminalEvidence =
        mocks.actualHasCompleteAssistantAutoReplyDeliveryTerminalEvidence;
      assert.ok(actualEnqueue);
      assert.ok(actualHasCompleteTerminalEvidence);
      mocks.enqueueHostedPendingAssistantInputId.mockImplementation(
        async (request) => {
          const event = await readAssistantInputEvent({
            inputId: request.inputId,
            vault: request.vaultRoot,
          });
          if (
            !imageIndexFailureInjected
            && event?.sourceRef.kind === "hosted-mailbox"
            && event?.sourceRef.payloadSchema
              === "murph.hosted-image-completion.v1"
          ) {
            imageIndexFailureInjected = true;
            throw new Error("Synthetic first image pending-index failure.");
          }
          return await actualEnqueue(request);
        },
      );
      mocks.hasCompleteAssistantAutoReplyDeliveryTerminalEvidence.mockImplementation(
        async (request) => {
          if (
            !terminalEvidenceReadFailureInjected
            && firstCompletionInputId !== null
            && request.inputId === firstCompletionInputId
          ) {
            terminalEvidenceReadFailureInjected = true;
            throw new Error("Synthetic terminal-evidence read failure.");
          }
          return await actualHasCompleteTerminalEvidence(request);
        },
      );

      await assert.rejects(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_image_evidence_retry",
              budget: { maxMailboxItems: 10 },
              idleCheckpointDelayMs: 180_000,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot() {
              return {
                snapshotRef: createBundleRef({
                  hash: "4".repeat(64),
                  key: "users/bundles/member-synthetic/image-evidence-retry.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              const assistantInputId =
                await stagePendingLinqAssistantInputForMailboxItem({
                  item: item.item,
                  threadId: "thread_image_evidence_retry",
                  vaultRoot,
                });
              return {
                assistantInputId,
                status: "imported",
              };
            },
            platform: {
              ...createPlatform({
                mailboxPort: createMailboxPort({
                  events,
                  items: mailboxItems,
                }),
                workspacePort: createWorkspacePort({
                  checkpointRequests,
                  events,
                  workspace: createWorkspaceState({ version: "0" }),
                }),
              }),
              latencyTracePort: {
                async record(request) {
                  latencyTraceRequests.push(request);
                  throw new Error("Synthetic latency trace write failure.");
                },
              },
            },
            runtimeWakeSignal,
            async runAssistantPhase(phaseInput) {
              const initialBatchInputIds =
                phaseInput.initialAssistantInputBatch?.assistantInputIds ?? [];
              let assistantInputIds: readonly string[] =
                initialBatchInputIds.length > 0
                ? initialBatchInputIds
                : phaseInput.initialMailboxImport.importResult.assistantInputIds
                  ?? [];
              if (assistantInputIds.length === 0) {
                assistantInputIds = (await selectHostedAssistantInputIds({
                  mode: "background",
                  vaultRoot,
                })).inputIds;
              }
              if (assistantInputIds.length === 0) {
                return { progressed: false };
              }
              assistantPhaseCalls += 1;
              assert.equal(assistantInputIds.length, 1);
              const assistantInputId = assistantInputIds[0]!;
              const releaseProviderInputs =
                await phaseInput.beforeProviderAcceptedInputs?.({
                  turnId: "turn_hosted_runtime_test",
                  acceptedInputs: [{
                    id: assistantInputId,
                    source: "assistant-input",
                  }],
                });

              if (assistantPhaseCalls === 1) {
                const releaseMissingInput =
                  await phaseInput.beforeProviderAcceptedInputs?.({
                    turnId: "turn_hosted_runtime_test",
                    acceptedInputs: [{
                      id: missingAcceptedInputId,
                      source: "assistant-input",
                    }],
                  });
                await releaseMissingInput?.();
                originInputId = assistantInputId;
                imageGenerationLauncherRef.current =
                  phaseInput.imageGenerationLauncher ?? null;
                assert.equal(
                  phaseInput.imageGenerationLauncher?.launch({
                    continuationSessionId: "asst_image_evidence_retry",
                    operationId: "image_operation_evidence_retry_1",
                    originAssistantInputId: assistantInputId,
                    originAssistantInputIdExact: false,
                    scopeId: "session_image_evidence_retry",
                    async run() {
                      imageProviderInvocationCount += 1;
                      return {
                        media: firstPrivateMedia,
                        runtimeIssue: null,
                        savedImageRef: firstPrivateMedia.ref,
                      };
                    },
                  }),
                  "started",
                );
              } else if (assistantPhaseCalls === 2) {
                firstCompletionInputId = assistantInputId;
                completionReplyCount += 1;
                assert.equal(
                  imageGenerationLauncherRef.current?.readStatus?.(
                    "session_image_evidence_retry",
                  ),
                  "queued",
                );
              } else if (assistantPhaseCalls === 3) {
                terminalEvidenceRetryObserved = true;
                assert.equal(
                  imageGenerationLauncherRef.current?.readStatus?.(
                    "session_image_evidence_retry",
                  ),
                  "queued",
                );
                assert.equal(
                  phaseInput.imageGenerationLauncher?.launch({
                    continuationSessionId: "asst_image_evidence_retry",
                    operationId: "image_operation_evidence_retry_2",
                    originAssistantInputId: assistantInputId,
                    originAssistantInputIdExact: false,
                    scopeId: "session_image_evidence_retry",
                    async run() {
                      imageProviderInvocationCount += 1;
                      return {
                        media: secondPrivateMedia,
                        runtimeIssue: null,
                        savedImageRef: secondPrivateMedia.ref,
                      };
                    },
                  }),
                  "already-pending",
                );
                assert.equal(imageProviderInvocationCount, 1);
              } else if (assistantPhaseCalls === 4) {
                assert.equal(
                  imageGenerationLauncherRef.current?.readStatus?.(
                    "session_image_evidence_retry",
                  ),
                  null,
                );
                assert.equal(
                  phaseInput.imageGenerationLauncher?.launch({
                    continuationSessionId: "asst_image_evidence_retry",
                    operationId: "image_operation_evidence_retry_2",
                    originAssistantInputId: assistantInputId,
                    originAssistantInputIdExact: false,
                    scopeId: "session_image_evidence_retry",
                    async run() {
                      imageProviderInvocationCount += 1;
                      return {
                        media: secondPrivateMedia,
                        runtimeIssue: null,
                        savedImageRef: secondPrivateMedia.ref,
                      };
                    },
                  }),
                  "started",
                );
              } else if (assistantPhaseCalls === 5) {
                secondCompletionInputId = assistantInputId;
                completionReplyCount += 1;
                assert.equal(
                  imageGenerationLauncherRef.current?.readStatus?.(
                    "session_image_evidence_retry",
                  ),
                  "queued",
                );
              } else {
                throw new Error("Unexpected extra image evidence retry phase.");
              }

              if (assistantPhaseCalls === 2) {
                firstDeliveryIntent = await createAssistantOutboxIntent({
                  channel: "telegram",
                  dedupeToken: `image-delivery:${assistantInputId}`,
                  explicitTarget: "chat_image_evidence_retry",
                  identityId: "participant_image_evidence_retry",
                  media: [firstPrivateMedia],
                  message: "",
                  sessionId: "session_image_evidence_retry",
                  threadId: "thread_image_evidence_retry",
                  threadIsDirect: true,
                  turnId: `turn_${assistantInputId}`,
                  turnTrigger: "automation-auto-reply",
                  vault: vaultRoot,
                });
                await writeAssistantAutoReplyReplyTerminalEvidence({
                  captureIds: [],
                  deliveryIntentId: firstDeliveryIntent.intentId,
                  inputIds: [assistantInputId],
                  outcome: "deferred",
                  recordedAt: "2026-04-27T00:00:01.000Z",
                  sessionId: firstDeliveryIntent.sessionId,
                  terminalKind: "reply_intent_committed",
                  vault: vaultRoot,
                });
                assert.ok(originInputId);
                const releaseSteeringInputs =
                  await phaseInput.beforeProviderAcceptedInputs?.({
                    turnId: "turn_hosted_runtime_test",
                    acceptedInputs: [{
                      id: originInputId,
                      source: "assistant-input",
                    }],
                  });
                await releaseSteeringInputs?.();
                mailboxItems.push(createMailboxItem({
                  id: "mailbox_item_image_evidence_retry_followup",
                  laneSeq: "2",
                  occurredAt: "2026-04-27T00:00:01.000Z",
                }));
                runtimeWakeSignal.notify();
              } else {
                await writeSyntheticAssistantAutoReplyTerminalEvidence({
                  inputId: assistantInputId,
                  vaultRoot,
                });
              }
              if (assistantPhaseCalls === 3) {
                assert.ok(firstDeliveryIntent);
                const sentIntent = await markAssistantOutboxIntentSentById({
                  delivery: {
                    channel: "telegram",
                    idempotencyKey: null,
                    messageLength: 0,
                    providerMessageId: "telegram_image_evidence_retry",
                    providerThreadId: null,
                    sentAt: "2026-04-27T00:00:02.000Z",
                    target: "chat_image_evidence_retry",
                    targetKind: "explicit",
                  },
                  intentId: firstDeliveryIntent.intentId,
                  vault: vaultRoot,
                });
                assert.equal(sentIntent?.status, "sent");
                mailboxItems.push(createMailboxItem({
                  id: "mailbox_item_image_evidence_retry_after_delivery",
                  laneSeq: "3",
                  occurredAt: "2026-04-27T00:00:02.000Z",
                }));
                runtimeWakeSignal.notify();
              }
              await releaseProviderInputs?.();
              if (assistantPhaseCalls === 5) {
                throw new Error(
                  "Synthetic phase failure after second image terminal evidence.",
                );
              }
              return {
                checkpointReason: "assistant_runtime_commit" as const,
                foregroundReplyFailed: 0,
                nextWakeAt: null,
                progressed: true,
              };
            },
            vaultRoot,
          },
        ),
        /Synthetic phase failure after second image terminal evidence\./u,
      );

      assert.equal(imageIndexFailureInjected, true);
      assert.equal(terminalEvidenceReadFailureInjected, true);
      assert.equal(terminalEvidenceRetryObserved, true);
      const pendingAtEnd = await compactHostedPendingAssistantInputIds({
        vaultRoot,
      });
      assert.equal(
        assistantPhaseCalls,
        5,
        JSON.stringify({
          enqueueInputIds:
            mocks.enqueueHostedPendingAssistantInputId.mock.calls
              .map(([request]) => request.inputId),
          pendingAtEnd,
        }),
      );
      assert.equal(completionReplyCount, 2);
      assert.equal(imageProviderInvocationCount, 2);
      assert.ok(firstCompletionInputId);
      assert.ok(secondCompletionInputId);
      await waitUntil(() => {
        assert.equal(
          latencyTraceRequests.filter(({ event }) =>
            event.type === "assistant_milestone"
            && event.milestone === "assistant_input_accepted_for_execution"
          ).length,
          assistantPhaseCalls + 1,
        );
      });
      const acceptedForExecutionInputIds = latencyTraceRequests.flatMap(
        ({ event }) =>
          event.type === "assistant_milestone"
            && event.milestone === "assistant_input_accepted_for_execution"
            ? event.assistantInputIds
            : [],
      );
      assert.ok(originInputId);
      assert.equal(
        acceptedForExecutionInputIds.filter((inputId) => inputId === originInputId)
          .length,
        2,
      );
      assert.ok(acceptedForExecutionInputIds.includes(firstCompletionInputId));
      assert.ok(acceptedForExecutionInputIds.includes(secondCompletionInputId));
      assert.equal(acceptedForExecutionInputIds.includes(missingAcceptedInputId), false);
      const completion = await readAssistantInputEvent({
        inputId: firstCompletionInputId,
        vault: vaultRoot,
      });
      assert.equal(
        completion?.sourceRef.kind === "hosted-mailbox"
          ? completion.sourceRef.payloadSchema
          : null,
        "murph.hosted-image-completion.v1",
      );
      assert.match(completion?.content.text ?? "", /"kind":"vault_image"/u);
      assert.doesNotMatch(completion?.content.text ?? "", /"kind":"image"/u);
      assert.deepEqual(pendingAtEnd, []);
      const firstCompletionEnqueueCalls =
        mocks.enqueueHostedPendingAssistantInputId.mock.calls
          .filter(([request]) => request.inputId === firstCompletionInputId);
      assert.equal(firstCompletionEnqueueCalls.length, 2);
      const terminalEvidenceInputIds =
        mocks.hasCompleteAssistantAutoReplyDeliveryTerminalEvidence.mock.calls
          .map(([request]) => request.inputId);
      assert.equal(
        terminalEvidenceInputIds.filter(
          (inputId) => inputId === firstCompletionInputId,
        ).length >= 2,
        true,
      );
      assert.equal(
        terminalEvidenceInputIds.at(-1),
        secondCompletionInputId,
      );
    } finally {
      const actualEnqueue = mocks.actualEnqueueHostedPendingAssistantInputId;
      if (actualEnqueue) {
        mocks.enqueueHostedPendingAssistantInputId.mockImplementation(
          actualEnqueue,
        );
      }
      const actualHasCompleteTerminalEvidence =
        mocks.actualHasCompleteAssistantAutoReplyDeliveryTerminalEvidence;
      if (actualHasCompleteTerminalEvidence) {
        mocks.hasCompleteAssistantAutoReplyDeliveryTerminalEvidence.mockImplementation(
          actualHasCompleteTerminalEvidence,
        );
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("restores a production-imported group follow-up with image completion delivery", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "murph-image-edit-failure-route-"),
    );
    const vaultRoot = path.join(root, "vault");
    const referenceImageRef = "raw/inbox/2026/04/image-edit-source.png";
    const freshInputText = "Did the group image edit finish?";
    const newestFreshInputText = "Is the finished group image ready now?";
    const codexCommand = await createImageFailureCodexAppServerCommand({
      freshInputText,
      newestFreshInputText,
      referenceImageRef,
      root,
    });
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const currentMailboxAt = new Date().toISOString();
    const mailboxItems = [createMailboxItem({
      createdAt: currentMailboxAt,
      id: "mailbox_item_image_edit_failure_origin",
      laneSeq: "1",
      occurredAt: currentMailboxAt,
      updatedAt: currentMailboxAt,
    })];
    const linqRequests: Array<Record<string, unknown>> = [];
    const linqRequestPaths: string[] = [];
    const firstInvocationAbortController = new AbortController();
    const firstInvocationInterruption = new Error(
      "Synthetic interruption before image completion provider admission.",
    );
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let activeInvocation = 1;
    let combinedPhaseInputIds: readonly string[] = [];
    let combinedPhaseSessionIds: readonly (string | null)[] = [];
    let currentInputAtProviderAcceptance: string | null = null;
    let freshInputId: string | null = null;
    let imageProviderInvocationCount = 0;
    let interruptedPhaseInputIds: readonly string[] = [];
    let newestFreshInputId: string | null = null;
    let snapshotRestoreCount = 0;

    const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
      const method =
        init?.method ?? (request instanceof Request ? request.method : "GET");
      const url = request instanceof Request ? request.url : String(request);
      events.push(`provider.fetch:${method}:${new URL(url).pathname}`);
      if (method === "POST" && url.includes("/v1/images/edits")) {
        imageProviderInvocationCount += 1;
        const followupAt = new Date(Date.now() + 1_000).toISOString();
        mailboxItems.push(createMailboxItem({
          createdAt: followupAt,
          id: "mailbox_item_image_edit_failure_followup",
          laneSeq: "2",
          occurredAt: followupAt,
          updatedAt: followupAt,
        }));
        runtimeWakeSignal.notify();
        return new Response(JSON.stringify({
          error: {
            code: "invalid_image",
            message: "The reference image could not be decoded.",
            type: "invalid_request_error",
          },
        }), {
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_image_edit_failed",
          },
          status: 400,
        });
      }
      if (method === "POST" && url.includes("/messages")) {
        linqRequestPaths.push(new URL(url).pathname);
        const requestBody = typeof init?.body === "string"
          ? init.body
          : request instanceof Request
            ? await request.clone().text()
            : "";
        linqRequests.push(
          requestBody ? JSON.parse(requestBody) as Record<string, unknown> : {},
        );
        events.push(`provider.send:${linqRequests.length}`);
        return new Response(JSON.stringify({
          message: { id: `provider_image_edit_failure_${linqRequests.length}` },
        }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      return new Response(null, { status: 204 });
    });
    try {
      const snapshotRef = createWorkspaceSnapshotV2Ref(
        "snapshot_image_edit_failure_route",
      );

      const basePlatform = createPlatform({
        mailboxPort: createMailboxPort({ events, items: mailboxItems }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({ snapshotRef, version: "0" }),
        }),
        workspaceSnapshotPort: {
          async abortSnapshotSession() {
            throw new Error("Image failure route should not abort snapshots.");
          },
          async completeSnapshotSession() {
            throw new Error("Image failure route should not complete snapshots.");
          },
          async putSnapshotObjectDirect() {
            throw new Error("Image failure route should not upload snapshots.");
          },
          async restoreWorkspaceSnapshot(input) {
            snapshotRestoreCount += 1;
            if (snapshotRestoreCount > 1) {
              return;
            }
            const restoredVaultRoot = path.join(input.durableRoot, "vault");
            await initializeVault({
              createdAt: TEST_NOW,
              vaultRoot: restoredVaultRoot,
            });
            const referenceImagePath = path.join(
              restoredVaultRoot,
              referenceImageRef,
            );
            await mkdir(path.dirname(referenceImagePath), { recursive: true });
            await writeFile(
              referenceImagePath,
              new Uint8Array([
                0x89,
                0x50,
                0x4e,
                0x47,
                0x0d,
                0x0a,
                0x1a,
                0x0a,
              ]),
            );
            await recordHostedMaterializedArtifactPaths({
              materializedArtifactPaths: new Set([
                `vault:${referenceImageRef}`,
              ]),
              vaultRoot: restoredVaultRoot,
            });
          },
          async startSnapshotSession() {
            throw new Error("Image failure route should not start snapshots.");
          },
        },
      });
      const platform: HostedRuntimePlatform = {
        ...basePlatform,
        effectsPort: {
          async assertLinqRecentInboundEngagement(request) {
            assert.equal(
              request.target,
              "thread_image_edit_failure_route",
            );
            return {
              providerDispatchClaimed: true,
              resolvedRoute: {
                conversationThreadId: null,
                directRecipientPhoneNumber: null,
                fromPhoneNumber: null,
                target: "thread_image_edit_failure_route",
                targetKind: "thread",
                threadIsDirect: false,
              },
            };
          },
          async readRawEmailMessage() {
            return null;
          },
          async recordLinqDeliveryOutcome(request) {
            events.push(
              `provider.record:${request.providerMessageId ?? "missing"}`,
            );
          },
          async sendEmail() {},
        },
        providerFetch,
      };
      const createRuntimeJobInput = (
        attemptId: string,
        leaseGeneration: string,
      ) => createWorkspaceRuntimeJobInput({
        forwardedEnv: {
          [HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]: codexCommand,
          LINQ_API_TOKEN: "synthetic-linq-token",
          NODE_ENV: "test",
        },
        resolvedConfig: {
          channelCapabilities: {
            emailSendReady: false,
            telegramBotConfigured: false,
          },
          deviceSync: null,
          managedAutoReplyChannels: [{
            capabilityReady: true,
            channel: "linq",
            memberChannel: "linq",
          }],
        },
        request: {
          attemptId,
          budget: { maxMailboxItems: 10 },
          idleCheckpointDelayMs: 50,
          leaseGeneration,
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
      });
      const firstRuntimeJobInput = createRuntimeJobInput(
        "attempt_image_edit_failure_route_first",
        "8",
      );
      const importRuntime = normalizeHostedAssistantRuntimeConfig(
        firstRuntimeJobInput.runtime,
        platform,
      );
      const runInvocation = (
        runtimeJobInput: ReturnType<typeof createRuntimeJobInput>,
        signal?: AbortSignal,
      ) => runHostedWorkspaceRuntimeJobInProcess(
          runtimeJobInput,
          {
            async createCheckpointSnapshot() {
              return {
                snapshotRef: createBundleRef({
                  hash: "8".repeat(64),
                  key: "users/bundles/member-synthetic/image-edit-failure-route.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem(item, context) {
              const inputText = item.item.laneSeq === "1"
                ? "Edit the shared image so the subject faces left."
                : item.item.laneSeq === "2"
                  ? freshInputText
                  : newestFreshInputText;
              const wake = buildHostedExecutionLinqConversationMessageWake({
                accountLookupKey: "hbidx:group-account",
                eventId: item.item.dedupeKey,
                linqMessage: {
                  chatId: "thread_image_edit_failure_route",
                  from: "+15550000002",
                  isFromMe: false,
                  messageId: `msg_${item.item.id}`,
                  parts: [{ type: "text", value: inputText }],
                  reactionEligible: true,
                  service: "iMessage",
                  threadIsDirect: false,
                },
                occurredAt: item.item.occurredAt,
                phoneLookupKey: "+15550000002",
                routeAuthority: {
                  accountLookupKey: "hbidx:group-account",
                  channel: "linq",
                  containerMemberId: TEST_USER_ID,
                  threadId: "thread_image_edit_failure_route",
                },
                userId: TEST_USER_ID,
              });
              const outcome = await importHostedConversationMailboxItem({
                decodePayload: {
                  async decode() {
                    return { status: "decoded", wake };
                  },
                },
                async importConversationWake() {
                  return {
                    captureId: null,
                    metrics: { nextWakeAt: null, parserProcessed: 0 },
                  };
                },
                item,
                onConversationInputStaged:
                  context?.onConversationInputStaged ?? null,
                runtime: importRuntime,
                signal: context?.signal ?? null,
                vaultRoot,
              });
              events.push(
                `production.import:${item.item.laneSeq}:${outcome.status}`,
              );
              if (item.item.laneSeq === "2") {
                freshInputId = outcome.status === "imported"
                  ? outcome.assistantInputId ?? null
                  : null;
                assert.ok(freshInputId);
                const freshInput = await readAssistantInputEvent({
                  inputId: freshInputId,
                  vault: vaultRoot,
                });
                assert.equal(freshInput?.conversation?.sessionId, null);
              } else if (item.item.laneSeq === "3") {
                newestFreshInputId = outcome.status === "imported"
                  ? outcome.assistantInputId ?? null
                  : null;
                assert.ok(newestFreshInputId);
                const newestFreshInput = await readAssistantInputEvent({
                  inputId: newestFreshInputId,
                  vault: vaultRoot,
                });
                assert.equal(newestFreshInput?.conversation?.sessionId, null);
              }
              return outcome;
            },
            platform,
            runtimeWakeSignal,
            async runAssistantPhase(phaseInput) {
              const phaseInputIds =
                phaseInput.initialAssistantInputBatch?.assistantInputIds
                ?? phaseInput.initialMailboxImport.importResult.assistantInputIds
                ?? [];
              events.push(
                `assistant.phase:${activeInvocation}:${phaseInputIds.length}`,
              );
              if (activeInvocation === 1 && phaseInputIds.length === 2) {
                interruptedPhaseInputIds = phaseInputIds;
                const interruptedRoles = await Promise.all(
                  phaseInputIds.map(async (inputId) => {
                    const event = await readAssistantInputEvent({
                      inputId,
                      vault: vaultRoot,
                    });
                    return event?.sourceRef.kind === "hosted-mailbox"
                        && event.sourceRef.payloadSchema
                          === "murph.hosted-image-completion.v1"
                      ? `completion:${inputId}`
                      : `conversation:${inputId}`;
                  }),
                );
                events.push(`interrupted:${interruptedRoles.join("|")}`);
                firstInvocationAbortController.abort(
                  firstInvocationInterruption,
                );
                throw firstInvocationInterruption;
              }
              const beforeProviderAcceptedInputs =
                phaseInput.beforeProviderAcceptedInputs;
              return await runHostedWorkspaceAssistantPhase({
                ...phaseInput,
                ...(beforeProviderAcceptedInputs
                  ? {
                      beforeProviderAcceptedInputs: async (acceptedInput) => {
                        const release =
                          await beforeProviderAcceptedInputs(acceptedInput);
                        const acceptedAssistantInputIds =
                          acceptedInput.acceptedInputs.flatMap((accepted) =>
                            accepted.source === "assistant-input"
                              ? [accepted.id]
                              : []
                          );
                        events.push(
                          `provider.accept:${activeInvocation}:${acceptedInput.acceptedInputs
                            .map((accepted) => `${accepted.source}:${accepted.id}`)
                            .join("|")}`,
                        );
                        if (
                          activeInvocation === 2
                          && acceptedAssistantInputIds.length === 3
                        ) {
                          combinedPhaseInputIds = acceptedAssistantInputIds;
                          combinedPhaseSessionIds = await Promise.all(
                            acceptedAssistantInputIds.map(async (inputId) =>
                              (await readAssistantInputEvent({
                                inputId,
                                vault: vaultRoot,
                              }))?.conversation?.sessionId ?? null
                            ),
                          );
                          currentInputAtProviderAcceptance =
                            phaseInput.currentAssistantInputId?.() ?? null;
                        }
                        return release;
                      },
                    }
                  : {}),
              });
            },
            ...(signal ? { signal } : {}),
            vaultRoot,
          },
        );

      await assert.rejects(
        withRealTimeout(
          runInvocation(
            firstRuntimeJobInput,
            firstInvocationAbortController.signal,
          ),
          30_000,
          () => events.join(","),
        ),
        (error: unknown) => error === firstInvocationInterruption,
      );
      assert.equal(interruptedPhaseInputIds.length, 2);
      assert.ok(freshInputId);
      assert.deepEqual(
        await compactHostedPendingAssistantInputIds({ vaultRoot }),
        [...interruptedPhaseInputIds].reverse(),
      );
      const restoredSelection = await selectHostedAssistantInputIds({
        mode: "background",
        vaultRoot,
      });
      const restoredSource = createHostedAssistantInputSource({
        initialPendingInputIds: restoredSelection.pendingInputIds,
        pendingInputRefreshMode: "compact",
        preserveSelectedInputOrder: restoredSelection.preserveInputOrder,
        selectedInputIds: restoredSelection.inputIds,
        vaultRoot,
      });
      const restoredCandidates = await restoredSource.listInputCandidates({
        limit: 10,
        sourceId: "linq",
      });
      assert.deepEqual(restoredSelection.inputIds, interruptedPhaseInputIds);
      assert.equal(restoredSelection.preserveInputOrder, true);
      assert.deepEqual(
        restoredCandidates.inputs.map((candidate) => candidate.event.inputId),
        interruptedPhaseInputIds,
      );
      assert.equal(
        shouldGroupAdjacentAssistantInputCandidates(
          restoredCandidates.inputs[0]!,
          restoredCandidates.inputs[1]!,
        ),
        true,
      );
      for (const inputId of interruptedPhaseInputIds) {
        assert.equal(
          await mocks.hasCompleteAssistantAutoReplyDeliveryTerminalEvidence({
            inputId,
            vault: vaultRoot,
          }),
          false,
        );
      }

      const newestFreshAt = new Date(Date.now() + 2_000).toISOString();
      mailboxItems.push(createMailboxItem({
        createdAt: newestFreshAt,
        id: "mailbox_item_image_edit_failure_newest_followup",
        laneSeq: "3",
        occurredAt: newestFreshAt,
        updatedAt: newestFreshAt,
      }));
      activeInvocation = 2;
      await withRealTimeout(
        runInvocation(createRuntimeJobInput(
          "attempt_image_edit_failure_route_second",
          "9",
        )),
        30_000,
        () => events.join(","),
      );

      assert.equal(imageProviderInvocationCount, 1);
      assert.equal(mailboxItems.length, 3);
      assert.ok(freshInputId);
      assert.ok(newestFreshInputId);
      assert.equal(combinedPhaseInputIds.length, 3, events.join(","));
      assert.equal(combinedPhaseInputIds[1], freshInputId);
      assert.equal(combinedPhaseInputIds[2], newestFreshInputId);
      const completionInput = await readAssistantInputEvent({
        inputId: combinedPhaseInputIds[0]!,
        vault: vaultRoot,
      });
      assert.equal(
        completionInput?.sourceRef.kind === "hosted-mailbox"
          ? completionInput.sourceRef.payloadSchema
          : null,
        "murph.hosted-image-completion.v1",
      );
      assert.deepEqual(combinedPhaseSessionIds, [
        completionInput?.conversation?.sessionId ?? null,
        null,
        null,
      ]);
      assert.ok(combinedPhaseSessionIds[0]);
      assert.equal(currentInputAtProviderAcceptance, newestFreshInputId);
      assert.equal(linqRequests.length, 2, events.join(","));
      assert.equal(linqRequestPaths.length, 2);
      for (const requestPath of linqRequestPaths) {
        assert.match(
          requestPath,
          /\/chats\/thread_image_edit_failure_route\/messages$/u,
        );
      }
      const intents = await listAssistantOutboxIntents(vaultRoot);
      assert.deepEqual(
        intents.map((intent) => ({
          channel: intent.channel,
          media: intent.media,
          message: intent.message,
          status: intent.status,
        })),
        [
          {
            channel: "linq",
            media: [],
            message:
              "I'm editing that image now. I'll send the result back here when it's ready.",
            status: "sent",
          },
          {
            channel: "linq",
            media: [],
            message:
              "OpenAI couldn't read the reference image, so the edit didn't complete. I can retry after you confirm, or you can send a different reference.",
            status: "sent",
          },
        ],
      );
      assert.ok(completionInput?.conversation?.threadId);
      assert.notEqual(
        completionInput.conversation.threadId,
        "thread_image_edit_failure_route",
      );
      assert.deepEqual(
        intents.map((intent) => intent.threadId),
        [
          completionInput.conversation.threadId,
          completionInput.conversation.threadId,
        ],
      );
      assert.doesNotMatch(intents[1]?.message ?? "", /invalid_image|req_/u);
      assert.deepEqual(
        await compactHostedPendingAssistantInputIds({ vaultRoot }),
        [],
      );
    } finally {
      await removeTempRoot(root);
    }
  }, 120_000);

  test("foreground rerun batch keeps fresh context after consumed replay", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-foreground-context-replay-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const consumedSeqByLane: NonNullable<HostedMailboxFetchResponse["consumedSeqByLane"]> = [];
    const runtimeAbortController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_foreground_context_replay_system",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    const freshImportedInputIds: string[] = [];
    const assistantPhaseInputIds: string[][] = [];
    const assistantPhaseLinqContextTargets: string[][] = [];
    const assistantPhaseLinqContextRouteThreadIds: string[][] = [];
    const firstFreshImportComplete = createDeferred<void>();
    const secondFreshImportComplete = createDeferred<void>();
    let assistantPhaseCalls = 0;

    const createLinqContext = (item: HostedMailboxItem, target: string) => ({
      directRecipientPhoneNumber: "+15550000001",
      fromPhoneNumber: null,
      replyToMessageId: `msg_${item.id}`,
      routeAuthority: {
        accountLookupKey: `hbidx:${target}`,
        channel: "linq" as const,
        containerMemberId: `member_${target}`,
        threadId: target,
      },
      service: "iMessage",
      target,
      threadIsDirect: true,
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_foreground_context_replay",
            budget: {
              maxMailboxItems: 2,
            },
            idleCheckpointDelayMs: 25,
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
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/runtime-foreground-context-replay.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            const replayKind = item.durablyConsumed === true ? "consumed" : "fresh";
            events.push(`mailbox.importItem:${item.item.id}:${replayKind}`);
            if (item.item.lane !== "conversation") {
              return { status: "imported" };
            }

            const target = `thread_${item.item.laneSeq}`;
            const linqDeliveryContext = createLinqContext(item.item, target);
            if (item.durablyConsumed === true) {
              return {
                linqDeliveryContext,
                status: "imported",
              };
            }

            const inputId = await stagePendingLinqAssistantInputForMailboxItem({
              item: item.item,
              threadId: target,
              vaultRoot,
            });
            freshImportedInputIds.push(inputId);
            if (freshImportedInputIds.length === 1) {
              firstFreshImportComplete.resolve();
            } else if (freshImportedInputIds.length === 2) {
              secondFreshImportComplete.resolve();
            }
            return {
              assistantInputId: inputId,
              linqDeliveryContext,
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              consumedSeqByLane,
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
          async runAssistantPhase(phaseInput) {
            assistantPhaseCalls += 1;
            const phaseLinqContexts = [
              ...(phaseInput.initialAssistantInputBatch?.linqDeliveryContexts
                ?? phaseInput.initialMailboxImport.importResult.linqDeliveryContexts
                ?? []),
            ];
            assistantPhaseInputIds.push([
              ...(phaseInput.initialAssistantInputBatch?.assistantInputIds
                ?? phaseInput.initialMailboxImport.importResult.assistantInputIds
                ?? []),
            ]);
            assistantPhaseLinqContextTargets.push(
              phaseLinqContexts.map((context) => context.target ?? ""),
            );
            assistantPhaseLinqContextRouteThreadIds.push(
              phaseLinqContexts.map((context) => context.routeAuthority?.threadId ?? ""),
            );
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              const systemRedactedStatus: HostedRuntimeRedactedJson = {
                hostedSystemMailboxRecorded: 1,
              };
              return {
                afterCheckpoint: async () => {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_foreground_context_replay_conversation_1",
                    laneSeq: "1",
                    occurredAt: "2026-04-27T00:00:01.000Z",
                  }));
                  runtimeWakeSignal.notify();
                  await firstFreshImportComplete.promise;
                  return {
                    checkpointReason: "system_mailbox_receipt" as const,
                    nextWakeAt: "2099-04-27T00:10:00.000Z",
                    nextWakeReason: "device-sync.reconcile",
                    redactedStatus: systemRedactedStatus,
                  };
                },
                afterCheckpointKeepsForegroundImportLoop: true,
                checkpointReason: "system_mailbox_receipt" as const,
                nextWakeAt: "2099-04-27T00:10:00.000Z",
                nextWakeReason: "device-sync.reconcile",
                progressed: true,
                redactedStatus: systemRedactedStatus,
              };
            }

            if (assistantPhaseCalls === 2) {
              consumedSeqByLane.splice(0, consumedSeqByLane.length, {
                consumedSeq: "2",
                lane: "conversation",
              });
              mailboxItems.push(
                createMailboxItem({
                  id: "mailbox_item_entrypoint_foreground_context_replay_consumed_2",
                  laneSeq: "2",
                  occurredAt: "2026-04-27T00:00:02.000Z",
                }),
                createMailboxItem({
                  id: "mailbox_item_entrypoint_foreground_context_replay_conversation_3",
                  laneSeq: "3",
                  occurredAt: "2026-04-27T00:00:03.000Z",
                }),
              );
              runtimeWakeSignal.notify();
              await secondFreshImportComplete.promise;
            }

            const assistantRedactedStatus: HostedRuntimeRedactedJson = {
              hostedAssistantProgressed: true,
            };
            return {
              checkpointReason: "assistant_runtime_commit" as const,
              nextWakeAt: null,
              progressed: true,
              redactedStatus: assistantRedactedStatus,
            };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );
      const result = await withRealTimeout(
        resultPromise,
        15_000,
        () => events.join(","),
      );

      assert.deepEqual(assistantPhaseInputIds[1], [freshImportedInputIds[0]]);
      assert.deepEqual(assistantPhaseLinqContextTargets[1], ["thread_1"]);
      assert.deepEqual(assistantPhaseLinqContextRouteThreadIds[1], ["thread_1"]);
      assert.deepEqual(assistantPhaseInputIds[2], [freshImportedInputIds[1]]);
      assert.deepEqual(assistantPhaseLinqContextTargets[2], ["thread_3"]);
      assert.deepEqual(assistantPhaseLinqContextRouteThreadIds[2], ["thread_3"]);
      assert.ok(events.includes(
        "mailbox.importItem:mailbox_item_entrypoint_foreground_context_replay_consumed_2:consumed",
      ));
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_foreground_context_replay_consumed_2:consumed",
        ) < requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_foreground_context_replay_conversation_3:fresh",
        ),
      );
      assert.ok(
        fetchRequests.some((request) =>
          request.requestId.includes(":runtime-wake:")
          && request.requestId.includes(":conversation")
          && request.lanes.some((lane) =>
            lane.lane === "conversation" && lane.importedSeq === "1"
          )
        ),
      );
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.nextWakeReason, "device-sync.reconcile");
      assert.equal(result.nextWakeAt, checkpointRequests[0]?.nextWakeAt ?? null);
    } finally {
      runtimeAbortController.abort();
      await removeTempRoot(vaultRoot);
    }
  });

  test("joins an aborted invocation projection before the next invocation owns the model", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-vault-share-abort-"));
    const events: string[] = [];
    const firstAbortController = new AbortController();
    const firstAbortReason = new Error("synthetic first invocation abort");
    const secondAbortController = new AbortController();
    const secondAbortReason = new Error("synthetic second invocation abort");
    const offerStarted = createDeferred<void>();
    const offerRelease = createDeferred<void>();
    const secondProviderStarted = createDeferred<void>();
    const originalAutomationPass =
      mocks.runAssistantAutomationPass.getMockImplementation();
    const deliveredProjectionKinds: string[] = [];
    let importedInputId: string | null = null;

    assert.ok(originalAutomationPass);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.summarizeWearableSleepRuntime.mockResolvedValueOnce([{
        date: "2026-04-26",
        sleepEndAt: "2026-04-27T06:31:00.000Z",
        sleepStartAt: "2026-04-26T22:04:00.000Z",
      }]);
      mocks.runAssistantAutomationPass.mockImplementation(
        async (input: RunAssistantAutomationPassInput) => {
          if (!importedInputId) {
            return {
              currentTurnDeliveryIntentIds: [],
              nextWakeAt: null,
              progressed: false,
            };
          }
          const inputId = importedInputId;
          events.push("provider.started:second");
          await input.onProviderRequestStarted?.({
            assistantInputIds: [inputId],
            providerRequestOrdinal: 0,
            source: "linq",
            startedAt: new Date().toISOString(),
          });
          await writeSyntheticAssistantAutoReplyTerminalEvidence({
            inputId,
            vaultRoot,
          });
          secondProviderStarted.resolve();
          return {
            currentTurnDeliveryIntentIds: [],
            nextWakeAt: null,
            progressed: true,
            replies: {
              considered: 1,
              failed: 0,
              replied: 1,
              skipped: 0,
            },
          };
        },
      );
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const firstResult = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_vault_share_abort_first",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("A clean aborted vault-share offer must not checkpoint.");
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [] }),
            vaultSharePort: {
              async listActiveProjectionScopes() {
                return {
                  generationTokensByProjectionScopeKey: {
                    "sleep-times.v0": "a".repeat(43),
                    "profile-name.v0": "b".repeat(43),
                    "time-zone.v0": "c".repeat(43),
                  },
                  projectionKinds: [
                    "sleep-times.v0" as const,
                    "profile-name.v0" as const,
                    "time-zone.v0" as const,
                  ],
                  projectionScopes: [
                    { projectionKind: "sleep-times.v0" as const },
                    { projectionKind: "profile-name.v0" as const },
                    { projectionKind: "time-zone.v0" as const },
                  ],
                };
              },
              async deliver(request) {
                deliveredProjectionKinds.push(request.projectionKind);
                events.push("vault-share.deliver:start");
                offerStarted.resolve();
                await offerRelease.promise;
                events.push("vault-share.deliver:done");
                return { status: "delivered" as const };
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          async runAssistantPhase() {
            return {
              nextWakeAt: null,
              progressed: false,
              redactedStatus: {
                hostedAssistantProgressed: false,
              },
            };
          },
          signal: firstAbortController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(offerStarted.promise, 5_000, () => events.join(","));
      let firstResultSettled = false;
      void firstResult.then(
        () => {
          firstResultSettled = true;
        },
        () => {
          firstResultSettled = true;
        },
      );
      firstAbortController.abort(firstAbortReason);
      await Promise.resolve();
      assert.equal(firstResultSettled, false);
      assert.equal(events.includes("vault-share.deliver:done"), false);
      offerRelease.resolve();
      await expect(withRealTimeout(
        firstResult,
        5_000,
        () => events.join(","),
      )).rejects.toBe(firstAbortReason);
      assert.ok(events.includes("vault-share.deliver:done"), events.join(","));
      assert.deepEqual(deliveredProjectionKinds, ["sleep-times.v0"]);

      const secondMailboxItem = createMailboxItem({
        id: "mailbox_item_entrypoint_after_stalled_vault_share_offer",
        laneSeq: "1",
        occurredAt: "2026-04-27T00:00:01.000Z",
      });
      const secondResult = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_vault_share_abort_second",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "10",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/runtime-after-stalled-offer.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            importedInputId = await stagePendingLinqAssistantInputForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            return {
              assistantInputId: importedInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [secondMailboxItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          signal: secondAbortController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        secondProviderStarted.promise,
        5_000,
        () => events.join(","),
      );
      assert.ok(
        requireEventIndex(events, "vault-share.deliver:done")
          < requireEventIndex(events, "provider.started:second"),
      );

      secondAbortController.abort(secondAbortReason);
      await expect(withRealTimeout(
        secondResult,
        5_000,
        () => events.join(","),
      )).rejects.toBe(secondAbortReason);
    } finally {
      offerRelease.resolve();
      firstAbortController.abort(firstAbortReason);
      secondAbortController.abort(secondAbortReason);
      mocks.runAssistantAutomationPass.mockImplementation(originalAutomationPass);
      mocks.summarizeWearableSleepRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("a definitive scope failure does not starve later scopes and withholds checkpoint effects", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-runtime-vault-share-projection-retry-"),
    );
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const retryAt = "2026-04-27T00:02:00.000Z";
    let activeScopeReads = 0;
    let assistantPhaseCalls = 0;
    let checkpointEffectCalls = 0;
    const projectedKinds: string[] = [];
    const projectedWorkspaceVersions: string[] = [];

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.summarizeWearableSleepRuntime.mockResolvedValue([]);
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_vault_share_projection_retry",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "7".repeat(64),
                key: "users/bundles/member-synthetic/runtime-vault-share-projection-retry.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            throw new Error("Projection retry proof should not import mailbox work.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [] }),
            vaultSharePort: {
              async listActiveProjectionScopes() {
                activeScopeReads += 1;
                return activeScopeReads === 1
                  ? {
                      generationTokensByProjectionScopeKey: {
                        "profile-name.v0": "a".repeat(43),
                        "time-zone.v0": "b".repeat(43),
                        "sleep-times.v0": "c".repeat(43),
                      },
                      projectionKinds: [
                        "profile-name.v0" as const,
                        "time-zone.v0" as const,
                        "sleep-times.v0" as const,
                      ],
                      projectionScopes: [
                        { projectionKind: "profile-name.v0" as const },
                        { projectionKind: "time-zone.v0" as const },
                        { projectionKind: "sleep-times.v0" as const },
                      ],
                    }
                  : { projectionKinds: [], projectionScopes: [] };
              },
              async deliver(request) {
                projectedKinds.push(request.projectionKind);
                projectedWorkspaceVersions.push(request.sourceWorkspaceVersion);
                events.push(`vault-share.deliver:${request.projectionKind}`);
                return request.projectionKind === "time-zone.v0"
                  ? { status: "scope-failed" as const }
                  : { status: "delivered" as const };
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls === 1) {
              const afterDurableCheckpoint = Object.assign(
                async () => {
                  checkpointEffectCalls += 1;
                  events.push("device-sync.dirty-ack");
                },
                {
                  vaultShareProjectionFailureWake: {
                    nextWakeAt: retryAt,
                    nextWakeReason: "device-sync.reconcile" as const,
                    requiresFollowUpCheckpoint: true,
                  },
                },
              );
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint,
                  checkpointReason: "assistant_runtime_commit" as const,
                }),
                checkpointReason: "assistant_runtime_commit" as const,
                nextWakeAt: null,
                progressed: true,
                redactedStatus: { hostedAssistantProgressed: true },
              };
            }
            return {
              nextWakeAt: null,
              progressed: false,
              redactedStatus: { hostedAssistantProgressed: false },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(checkpointEffectCalls, 0);
      assert.equal(events.includes("device-sync.dirty-ack"), false);
      assert.deepEqual(projectedKinds, [
        "profile-name.v0",
        "time-zone.v0",
        "sleep-times.v0",
      ]);
      assert.deepEqual(projectedWorkspaceVersions, ["5", "5", "5"]);
      assert.ok(
        requireEventIndex(events, "workspace.checkpoint")
          < requireEventIndex(events, "vault-share.deliver:profile-name.v0"),
        events.join(","),
      );
      assert.ok(
        requireEventIndex(events, "vault-share.deliver:time-zone.v0")
          < requireEventIndex(events, "vault-share.deliver:sleep-times.v0"),
        events.join(","),
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, retryAt);
      assert.equal(result.nextWakeReason, "device-sync.reconcile");
      assert.ok(checkpointRequests.some((request) =>
        request.nextWakeAt === retryAt
        && request.nextWakeReason === "device-sync.reconcile"
      ));
    } finally {
      mocks.summarizeWearableSleepRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("offers checkpointed vault-share before servicing repeated device-sync wakes", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-runtime-vault-share-device-pressure-"),
    );
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeAbortController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const offerStarted = createDeferred<void>();
    const offerRelease = createDeferred<void>();
    const mailboxItems: HostedMailboxItem[] = [
      createMailboxItem({
        dedupeKey:
          "device-sync:dirty:v1:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:1",
        id: "mailbox_item_entrypoint_vault_share_device_pressure_1",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
        occurredAt: "2026-04-27T00:00:01.000Z",
      }),
    ];
    let activeScopeReads = 0;
    let assistantPhaseCalls = 0;
    let checkpointCount = 0;
    let mailboxFetchesInFlight = 0;
    let peakMailboxFetchesInFlight = 0;
    let vaultShareDeliverCalls = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.summarizeWearableSleepRuntime.mockResolvedValueOnce([{
        date: "2026-04-26",
        sleepEndAt: "2026-04-27T06:31:00.000Z",
        sleepStartAt: "2026-04-26T22:04:00.000Z",
      }]);
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const baseMailboxPort = createMailboxPort({
        events,
        fetchRequests,
        items: mailboxItems,
      });
      const mailboxPort: HostedRuntimeMailboxPort = {
        ...baseMailboxPort,
        async fetch(request) {
          mailboxFetchesInFlight += 1;
          peakMailboxFetchesInFlight = Math.max(
            peakMailboxFetchesInFlight,
            mailboxFetchesInFlight,
          );
          try {
            return await baseMailboxPort.fetch(request);
          } finally {
            mailboxFetchesInFlight -= 1;
          }
        },
      };

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_vault_share_device_pressure",
            budget: { maxMailboxItems: 3 },
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
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/runtime-vault-share-device-pressure.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort,
            vaultSharePort: {
              async listActiveProjectionScopes() {
                activeScopeReads += 1;
                return activeScopeReads === 1
                  ? {
                      generationTokensByProjectionScopeKey: {
                        "sleep-times.v0": "a".repeat(43),
                      },
                      projectionKinds: ["sleep-times.v0" as const],
                      projectionScopes: [{ projectionKind: "sleep-times.v0" as const }],
                    }
                  : { projectionKinds: [], projectionScopes: [] };
              },
              async deliver() {
                vaultShareDeliverCalls += 1;
                events.push("vault-share.deliver:start");
                offerStarted.resolve();
                await offerRelease.promise;
                events.push("vault-share.deliver:done");
                return { status: "delivered" };
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace(request) {
                checkpointCount += 1;
                events.push(`workspace.checkpoint.committed:${checkpointCount}`);
                if (checkpointCount === 1) {
                  for (const revision of [2, 3, 4] as const) {
                    mailboxItems.push(createMailboxItem({
                      dedupeKey:
                        `device-sync:dirty:v1:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:${revision}`,
                      id: `mailbox_item_entrypoint_vault_share_device_pressure_${revision}`,
                      kind: "device-sync.wake",
                      lane: "system",
                      laneSeq: String(revision),
                      occurredAt: `2026-04-27T00:00:0${revision}.000Z`,
                    }));
                  }
                  runtimeWakeSignal.notify();
                }
                return createWorkspaceState({
                  inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
              },
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: async () => {
                    events.push("device-sync.dirty-ack");
                  },
                  checkpointReason: "assistant_runtime_commit" as const,
                }),
                checkpointReason: "assistant_runtime_commit" as const,
                nextWakeAt: null,
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                },
              };
            }
            return {
              nextWakeAt: null,
              progressed: false,
              redactedStatus: {
                hostedAssistantProgressed: false,
              },
            };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(offerStarted.promise, 5_000, () => events.join(","));
      assert.equal(checkpointRequests.length, 1, events.join(","));
      assert.ok(
        requireEventIndex(events, "workspace.checkpoint.committed:1")
          < requireEventIndex(events, "vault-share.deliver:start"),
        events.join(","),
      );
      assert.equal(
        events.includes("mailbox.importItem:mailbox_item_entrypoint_vault_share_device_pressure_2"),
        false,
        events.join(","),
      );

      mailboxItems.push(createMailboxItem({
        dedupeKey:
          "device-sync:dirty:v1:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:5",
        id: "mailbox_item_entrypoint_vault_share_device_pressure_5",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "5",
        occurredAt: "2026-04-27T00:00:05.000Z",
      }));
      runtimeWakeSignal.notify();
      await withRealTimeout(
        waitUntil(() => {
          assert.ok(fetchRequests.some((request) =>
            request.requestId.includes(":vault-share-wake-classify:")
          ));
        }),
        5_000,
        () => events.join(","),
      );

      assert.equal(vaultShareDeliverCalls, 1);
      assert.equal(
        events.includes("mailbox.importItem:mailbox_item_entrypoint_vault_share_device_pressure_2"),
        false,
        events.join(","),
      );
      assert.equal(
        events.includes("mailbox.importItem:mailbox_item_entrypoint_vault_share_device_pressure_3"),
        false,
        events.join(","),
      );

      offerRelease.resolve();
      const result = await withRealTimeout(resultPromise, 15_000, () => events.join(","));

      assert.ok(
        requireEventIndex(events, "vault-share.deliver:done")
          < requireEventIndex(events, "device-sync.dirty-ack"),
        events.join(","),
      );
      for (const laneSeq of ["2", "3"] as const) {
        assert.ok(
          requireEventIndex(events, "vault-share.deliver:done")
            < requireEventIndex(
              events,
              `mailbox.importItem:mailbox_item_entrypoint_vault_share_device_pressure_${laneSeq}`,
            ),
          events.join(","),
        );
      }
      assert.equal(vaultShareDeliverCalls, 1);
      assert.ok(checkpointRequests.length >= 2);
      assert.equal(
        fetchRequests.filter((request) =>
          request.requestId.includes(":checkpoint-wake-classify:")
        ).length,
        1,
      );
      assert.equal(
        fetchRequests.filter((request) =>
          request.requestId.includes(":vault-share-wake-classify:")
        ).length,
        1,
      );
      assert.equal(
        fetchRequests.some((request) =>
          request.requestId.includes(":idle-wake-foreground-prefetch:")
        ),
        false,
      );
      assert.equal(peakMailboxFetchesInFlight, 1);
      assert.ok(fetchRequests.every((request) => request.limitPerLane === 4));
      assert.equal(result.status, "budget_exhausted");
    } finally {
      offerRelease.resolve();
      runtimeAbortController.abort();
      await resultPromise?.catch(() => undefined);
      mocks.summarizeWearableSleepRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("keeps an incomplete device-sync prefix foreground", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-runtime-vault-share-hidden-command-"),
    );
    const events: string[] = [];
    const firstCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const mailboxItems: HostedMailboxItem[] = [
      createMailboxItem({
        dedupeKey:
          "device-sync:dirty:v1:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:1",
        id: "mailbox_item_entrypoint_vault_share_hidden_command_1",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    let checkpointCount = 0;
    let mailboxFetchesInFlight = 0;
    let peakMailboxFetchesInFlight = 0;
    let vaultShareDeliverCalls = 0;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.summarizeWearableSleepRuntime.mockResolvedValueOnce([{
        date: "2026-04-26",
        sleepEndAt: "2026-04-27T06:31:00.000Z",
        sleepStartAt: "2026-04-26T22:04:00.000Z",
      }]);
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const baseMailboxPort = createMailboxPort({
        events,
        fetchRequests,
        items: mailboxItems,
      });
      const mailboxPort: HostedRuntimeMailboxPort = {
        ...baseMailboxPort,
        async fetch(request) {
          mailboxFetchesInFlight += 1;
          peakMailboxFetchesInFlight = Math.max(
            peakMailboxFetchesInFlight,
            mailboxFetchesInFlight,
          );
          try {
            return await baseMailboxPort.fetch(request);
          } finally {
            mailboxFetchesInFlight -= 1;
          }
        },
      };
      const vaultSharePort: NonNullable<HostedRuntimePlatform["vaultSharePort"]> = {
        async listActiveProjectionScopes() {
          return {
            generationTokensByProjectionScopeKey: {
              "sleep-times.v0": "a".repeat(43),
            },
            projectionKinds: ["sleep-times.v0" as const],
            projectionScopes: [{ projectionKind: "sleep-times.v0" as const }],
          };
        },
        async deliver() {
          vaultShareDeliverCalls += 1;
          events.push("vault-share.deliver:start");
          events.push("vault-share.deliver:done");
          return { status: "delivered" };
        },
      };

      const firstResult = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_vault_share_hidden_command",
            budget: { maxMailboxItems: 3 },
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/runtime-vault-share-hidden-command.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort,
            vaultSharePort,
            workspacePort: createWorkspacePort({
              checkpointRequests: firstCheckpointRequests,
              checkpointWorkspace(request) {
                checkpointCount += 1;
                if (checkpointCount === 1) {
                  for (const revision of [2, 3, 4, 5] as const) {
                    mailboxItems.push(createMailboxItem({
                      dedupeKey:
                        `device-sync:dirty:v1:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:${revision}`,
                      id: `mailbox_item_entrypoint_vault_share_hidden_command_${revision}`,
                      kind: "device-sync.wake",
                      lane: "system",
                      laneSeq: String(revision),
                    }));
                  }
                  mailboxItems.push(createMailboxItem({
                    dedupeKey:
                      "device-sync:disconnect:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:2026-04-27T00:00:06.000Z",
                    id: "mailbox_item_entrypoint_vault_share_hidden_command_disconnect",
                    kind: "device-sync.wake",
                    lane: "system",
                    laneSeq: "6",
                  }));
                  runtimeWakeSignal.notify();
                }
                return createWorkspaceState({
                  inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
              },
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            return {
              nextWakeAt: null,
              progressed: false,
              redactedStatus: { hostedAssistantProgressed: false },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(vaultShareDeliverCalls, 0, events.join(","));
      assert.equal(firstResult.status, "budget_exhausted");
      assert.match(firstResult.nextWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(firstResult.nextWakeReason, "mailbox");
      assert.equal(
        fetchRequests.filter((request) =>
          request.requestId.includes(":checkpoint-wake-classify:")
        ).length,
        1,
      );
      assert.equal(
        fetchRequests.some((request) =>
          request.requestId.includes(":idle-wake-foreground-prefetch:")
        ),
        false,
      );

      const firstCheckpoint = firstCheckpointRequests.at(-1);
      assert.ok(firstCheckpoint);
      const secondCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const secondWorkspace = createWorkspaceState({
        nextWakeAt: firstResult.nextWakeAt,
        nextWakeReason: firstResult.nextWakeReason,
        redactedStatus: firstResult.redactedStatus,
        version: String(BigInt(firstCheckpoint.expectedWorkspaceVersion) + 1n),
      });
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId:
              "attempt_synthetic_runtime_vault_share_hidden_command_continuation",
            budget: { maxMailboxItems: 8 },
            idleCheckpointDelayMs: 1,
            leaseGeneration: "10",
            userId: TEST_USER_ID,
            workspaceVersion: secondWorkspace.version,
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key:
                  "users/bundles/member-synthetic/runtime-vault-share-hidden-command-continuation.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort,
            vaultSharePort,
            workspacePort: createWorkspacePort({
              checkpointRequests: secondCheckpointRequests,
              events,
              workspace: secondWorkspace,
            }),
          }),
          async runAssistantPhase() {
            return {
              nextWakeAt: null,
              progressed: false,
              redactedStatus: { hostedAssistantProgressed: false },
            };
          },
          vaultRoot,
        },
      );

      const explicitCommandImport =
        "mailbox.importItem:mailbox_item_entrypoint_vault_share_hidden_command_disconnect";
      assert.ok(events.includes(explicitCommandImport), events.join(","));
      if (events.includes("vault-share.deliver:start")) {
        assert.ok(
          requireEventIndex(events, explicitCommandImport)
            < requireEventIndex(events, "vault-share.deliver:start"),
          events.join(","),
        );
      }
      assert.equal(peakMailboxFetchesInFlight, 1);
    } finally {
      mocks.summarizeWearableSleepRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("falls back to a foreground refetch when checkpoint wake classification fails", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-runtime-vault-share-classifier-fallback-"),
    );
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeAbortController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const mailboxItems: HostedMailboxItem[] = [
      createMailboxItem({
        dedupeKey:
          "device-sync:dirty:v1:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:1",
        id: "mailbox_item_entrypoint_vault_share_classifier_fallback_device",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    let admittedConversationInputId: string | null = null;
    let checkpointCount = 0;
    let classifierFailures = 0;
    let pendingConversationInputId: string | null = null;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.summarizeWearableSleepRuntime.mockResolvedValueOnce([]);
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const baseMailboxPort = createMailboxPort({
        events,
        items: mailboxItems,
      });
      const mailboxPort: HostedRuntimeMailboxPort = {
        ...baseMailboxPort,
        async fetch(request) {
          fetchRequests.push(request);
          if (
            classifierFailures === 0
            && request.requestId.includes(":checkpoint-wake-classify:")
          ) {
            classifierFailures += 1;
            events.push("mailbox.fetch:classifier-failed");
            throw new Error("Synthetic checkpoint classifier fetch failure.");
          }
          return await baseMailboxPort.fetch(request);
        },
      };

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_vault_share_classifier_fallback",
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
                key: "users/bundles/member-synthetic/runtime-vault-share-classifier-fallback.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.lane !== "conversation") {
              return { status: "imported" };
            }
            pendingConversationInputId = await stagePendingLinqAssistantInputForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            return {
              assistantInputId: pendingConversationInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort,
            vaultSharePort: {
              async listActiveProjectionScopes() {
                return {
                  generationTokensByProjectionScopeKey: {
                    "sleep-times.v0": "a".repeat(43),
                  },
                  projectionKinds: ["sleep-times.v0" as const],
                  projectionScopes: [{ projectionKind: "sleep-times.v0" as const }],
                };
              },
              async deliver() {
                events.push("vault-share.deliver:start");
                return { status: "delivered" };
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace(request) {
                checkpointCount += 1;
                events.push(`workspace.checkpoint.committed:${checkpointCount}`);
                if (checkpointCount === 1) {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_vault_share_classifier_fallback_conversation",
                    laneSeq: "1",
                    occurredAt: "2026-04-27T00:00:02.000Z",
                  }));
                  runtimeWakeSignal.notify();
                }
                return createWorkspaceState({
                  inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
              },
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            if (pendingConversationInputId) {
              admittedConversationInputId = pendingConversationInputId;
              pendingConversationInputId = null;
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId: admittedConversationInputId,
                vaultRoot,
              });
              events.push("assistant.admitted:fallback-conversation");
              return {
                checkpointReason: "assistant_runtime_commit" as const,
                nextWakeAt: null,
                progressed: true,
                redactedStatus: { hostedAssistantProgressed: true },
              };
            }
            return {
              nextWakeAt: null,
              progressed: false,
              redactedStatus: { hostedAssistantProgressed: false },
            };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      const fallbackItemEvent =
        "mailbox.importItem:mailbox_item_entrypoint_vault_share_classifier_fallback_conversation";
      assert.equal(classifierFailures, 1);
      assert.ok(events.includes(fallbackItemEvent), events.join(","));
      assert.ok(admittedConversationInputId);
      assert.ok(events.includes("assistant.admitted:fallback-conversation"));
      assert.ok(
        requireEventIndex(events, "mailbox.fetch:classifier-failed")
          < requireEventIndex(events, fallbackItemEvent),
        events.join(","),
      );
      assert.ok(
        requireEventIndex(events, fallbackItemEvent)
          < requireEventIndex(events, "vault-share.deliver:start"),
        events.join(","),
      );
      assert.equal(
        fetchRequests.filter((request) =>
          request.requestId.includes(":checkpoint-wake-classify:")
        ).length,
        1,
      );
      assert.equal(
        fetchRequests.filter((request) =>
          request.requestId.includes(":checkpoint-wake-foreground-prefetch:")
        ).length,
        1,
      );
      assert.ok(checkpointRequests.length >= 2);
      assert.ok(["idle", "scheduled"].includes(result.status));
    } finally {
      runtimeAbortController.abort();
      mocks.summarizeWearableSleepRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("hands checkpoint wake classification to a replacement runtime on shutdown", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-runtime-checkpoint-classifier-shutdown-"),
    );
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeAbortController = new AbortController();
    const shutdownController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const classificationStarted = createDeferred<void>();
    const classificationRelease = createDeferred<void>();
    const mailboxItems: HostedMailboxItem[] = [
      createMailboxItem({
        dedupeKey:
          "device-sync:dirty:v1:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:1",
        id: "mailbox_item_entrypoint_checkpoint_classifier_shutdown_device",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    let checkpointCount = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.summarizeWearableSleepRuntime.mockResolvedValueOnce([]);
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const baseMailboxPort = createMailboxPort({ events, items: mailboxItems });
      const mailboxPort: HostedRuntimeMailboxPort = {
        ...baseMailboxPort,
        async fetch(request) {
          const response = await baseMailboxPort.fetch(request);
          if (request.requestId.includes(":checkpoint-wake-classify:")) {
            classificationStarted.resolve();
            await classificationRelease.promise;
          }
          return response;
        },
      };

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_checkpoint_classifier_shutdown",
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
                key: "users/bundles/member-synthetic/runtime-checkpoint-classifier-shutdown.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort,
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace(request) {
                checkpointCount += 1;
                if (checkpointCount === 1) {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_checkpoint_classifier_shutdown_conversation",
                    laneSeq: "1",
                    occurredAt: "2026-04-27T00:00:02.000Z",
                  }));
                  runtimeWakeSignal.notify();
                }
                return createWorkspaceState({
                  inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
              },
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            return {
              nextWakeAt: null,
              progressed: false,
              redactedStatus: { hostedAssistantProgressed: false },
            };
          },
          shutdownSignal: shutdownController.signal,
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        classificationStarted.promise,
        5_000,
        () => events.join(","),
      );
      shutdownController.abort(
        new DOMException("Synthetic container SIGTERM.", "AbortError"),
      );
      classificationRelease.resolve();
      const result = await withRealTimeout(resultPromise, 10_000, () => events.join(","));

      assert.equal(
        events.includes(
          "mailbox.importItem:mailbox_item_entrypoint_checkpoint_classifier_shutdown_conversation",
        ),
        false,
        events.join(","),
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, TEST_NOW);
      assert.equal(result.nextWakeReason, "mailbox");
    } finally {
      classificationRelease.resolve();
      runtimeAbortController.abort();
      shutdownController.abort();
      await resultPromise?.catch(() => undefined);
      mocks.summarizeWearableSleepRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("hands a failed checkpoint classifier fallback to a replacement runtime on shutdown", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-runtime-checkpoint-fallback-shutdown-"),
    );
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeAbortController = new AbortController();
    const shutdownController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const fallbackStarted = createDeferred<void>();
    const fallbackRelease = createDeferred<void>();
    const mailboxItems: HostedMailboxItem[] = [
      createMailboxItem({
        dedupeKey:
          "device-sync:dirty:v1:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:1",
        id: "mailbox_item_entrypoint_checkpoint_fallback_shutdown_device",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    let checkpointCount = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.summarizeWearableSleepRuntime.mockResolvedValueOnce([]);
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const baseMailboxPort = createMailboxPort({ events, items: mailboxItems });
      const mailboxPort: HostedRuntimeMailboxPort = {
        ...baseMailboxPort,
        async fetch(request) {
          if (request.requestId.includes(":checkpoint-wake-classify:")) {
            throw new Error("Synthetic checkpoint classifier fetch failure.");
          }
          const response = await baseMailboxPort.fetch(request);
          if (request.requestId.includes(":checkpoint-wake-foreground-prefetch:")) {
            fallbackStarted.resolve();
            await fallbackRelease.promise;
          }
          return response;
        },
      };

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_checkpoint_fallback_shutdown",
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
                hash: "0".repeat(64),
                key: "users/bundles/member-synthetic/runtime-checkpoint-fallback-shutdown.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort,
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace(request) {
                checkpointCount += 1;
                if (checkpointCount === 1) {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_checkpoint_fallback_shutdown_conversation",
                    laneSeq: "1",
                    occurredAt: "2026-04-27T00:00:02.000Z",
                  }));
                  runtimeWakeSignal.notify();
                }
                return createWorkspaceState({
                  inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
              },
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            return {
              nextWakeAt: null,
              progressed: false,
              redactedStatus: { hostedAssistantProgressed: false },
            };
          },
          shutdownSignal: shutdownController.signal,
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(fallbackStarted.promise, 5_000, () => events.join(","));
      shutdownController.abort(
        new DOMException("Synthetic container SIGTERM.", "AbortError"),
      );
      fallbackRelease.resolve();
      const result = await withRealTimeout(resultPromise, 10_000, () => events.join(","));

      assert.equal(
        events.includes(
          "mailbox.importItem:mailbox_item_entrypoint_checkpoint_fallback_shutdown_conversation",
        ),
        false,
        events.join(","),
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, TEST_NOW);
      assert.equal(result.nextWakeReason, "mailbox");
    } finally {
      fallbackRelease.resolve();
      runtimeAbortController.abort();
      shutdownController.abort();
      await resultPromise?.catch(() => undefined);
      mocks.summarizeWearableSleepRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns mailbox wake when shutdown interrupts vault-share after deferring device-sync wake", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-runtime-vault-share-device-shutdown-"),
    );
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeAbortController = new AbortController();
    const shutdownController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const classificationStarted = createDeferred<void>();
    const classificationRelease = createDeferred<void>();
    const offerStarted = createDeferred<void>();
    const offerRelease = createDeferred<void>();
    const mailboxItems: HostedMailboxItem[] = [
      createMailboxItem({
        dedupeKey:
          "device-sync:dirty:v1:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:1",
        id: "mailbox_item_entrypoint_vault_share_device_shutdown_1",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
        occurredAt: "2026-04-27T00:00:01.000Z",
      }),
    ];
    let activeScopeReads = 0;
    let assistantPhaseCalls = 0;
    let checkpointCount = 0;
    let vaultShareDeliverCalls = 0;
    const deliveredProjectionKinds: string[] = [];
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.summarizeWearableSleepRuntime.mockResolvedValueOnce([{
        date: "2026-04-26",
        sleepEndAt: "2026-04-27T06:31:00.000Z",
        sleepStartAt: "2026-04-26T22:04:00.000Z",
      }]);
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const baseMailboxPort = createMailboxPort({
        events,
        fetchRequests,
        items: mailboxItems,
      });
      const mailboxPort: HostedRuntimeMailboxPort = {
        ...baseMailboxPort,
        async fetch(request) {
          const response = await baseMailboxPort.fetch(request);
          if (request.requestId.includes(":vault-share-wake-classify:")) {
            classificationStarted.resolve();
            await classificationRelease.promise;
          }
          return response;
        },
      };

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_vault_share_device_shutdown",
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
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/runtime-vault-share-device-shutdown.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort,
            vaultSharePort: {
              async listActiveProjectionScopes() {
                activeScopeReads += 1;
                return activeScopeReads === 1
                  ? {
                      generationTokensByProjectionScopeKey: {
                        "sleep-times.v0": "a".repeat(43),
                        "profile-name.v0": "b".repeat(43),
                        "time-zone.v0": "c".repeat(43),
                      },
                      projectionKinds: [
                        "sleep-times.v0" as const,
                        "profile-name.v0" as const,
                        "time-zone.v0" as const,
                      ],
                      projectionScopes: [
                        { projectionKind: "sleep-times.v0" as const },
                        { projectionKind: "profile-name.v0" as const },
                        { projectionKind: "time-zone.v0" as const },
                      ],
                    }
                  : { projectionKinds: [], projectionScopes: [] };
              },
              async deliver(request) {
                vaultShareDeliverCalls += 1;
                deliveredProjectionKinds.push(request.projectionKind);
                events.push("vault-share.deliver:start");
                offerStarted.resolve();
                await offerRelease.promise;
                events.push("vault-share.deliver:done");
                return { status: "delivered" as const };
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace(request) {
                checkpointCount += 1;
                events.push(`workspace.checkpoint.committed:${checkpointCount}`);
                if (checkpointCount === 1) {
                  mailboxItems.push(createMailboxItem({
                    dedupeKey:
                      "device-sync:dirty:v1:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:2",
                    id: "mailbox_item_entrypoint_vault_share_device_shutdown_2",
                    kind: "device-sync.wake",
                    lane: "system",
                    laneSeq: "2",
                    occurredAt: "2026-04-27T00:00:02.000Z",
                  }));
                  runtimeWakeSignal.notify();
                }
                return createWorkspaceState({
                  inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
              },
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            return {
              nextWakeAt: null,
              progressed: false,
              redactedStatus: {
                hostedAssistantProgressed: false,
              },
            };
          },
          shutdownSignal: shutdownController.signal,
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(offerStarted.promise, 5_000, () => events.join(","));
      assert.equal(checkpointRequests.length, 1, events.join(","));
      assert.equal(vaultShareDeliverCalls, 1);
      assert.equal(
        events.includes("mailbox.importItem:mailbox_item_entrypoint_vault_share_device_shutdown_2"),
        false,
        events.join(","),
      );

      mailboxItems.push(createMailboxItem({
        dedupeKey:
          "device-sync:dirty:v1:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:3",
        id: "mailbox_item_entrypoint_vault_share_device_shutdown_3",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "3",
        occurredAt: "2026-04-27T00:00:03.000Z",
      }));
      runtimeWakeSignal.notify();
      await withRealTimeout(
        classificationStarted.promise,
        5_000,
        () => events.join(","),
      );
      shutdownController.abort(
        new DOMException("Synthetic container SIGTERM.", "AbortError"),
      );
      classificationRelease.resolve();
      let resultSettled = false;
      void resultPromise.then(
        () => {
          resultSettled = true;
        },
        () => {
          resultSettled = true;
        },
      );
      await Promise.resolve();
      assert.equal(resultSettled, false);
      assert.equal(events.includes("vault-share.deliver:done"), false);
      offerRelease.resolve();
      const result = await withRealTimeout(resultPromise, 10_000, () => events.join(","));

      assert.ok(events.includes("vault-share.deliver:done"), events.join(","));
      assert.deepEqual(deliveredProjectionKinds, ["sleep-times.v0"]);
      assert.equal(vaultShareDeliverCalls, 1);
      assert.equal(
        events.includes("mailbox.importItem:mailbox_item_entrypoint_vault_share_device_shutdown_2"),
        false,
        events.join(","),
      );
      assert.equal(
        events.includes("mailbox.importItem:mailbox_item_entrypoint_vault_share_device_shutdown_3"),
        false,
        events.join(","),
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, TEST_NOW);
      assert.equal(result.nextWakeReason, "mailbox");
    } finally {
      classificationRelease.resolve();
      offerRelease.resolve();
      runtimeAbortController.abort();
      shutdownController.abort();
      await resultPromise?.catch(() => undefined);
      mocks.summarizeWearableSleepRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  });

import {
  TEST_NOW,
  TEST_USER_ID,
  createBundleRef,
  createDeferred,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  mocks,
  removeTempRoot,
  requireEventIndex,
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
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
} from "@murphai/hosted-execution/orchestration-control";
import {
  readAssistantInputEvent,
  shouldGroupAdjacentAssistantInputCandidates,
  updateAssistantInputAttachmentEvidence,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
  writeAssistantAutoReplyReplyTerminalEvidence,
} from "@murphai/assistant-engine/assistant-automation";
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
  readHostedProviderCleanupCheckpoint,
  recordHostedProviderCleanupBeforeCommit,
} from "../src/hosted-runtime/provider-cleanup.ts";

describe("hosted workspace runtime entrypoint", () => {test("keeps one projection owned while a conversation reaches the provider", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-runtime-vault-share-conversation-preempt-"),
    );
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeAbortController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const offerStarted = createDeferred<void>();
    const offerRelease = createDeferred<void>();
    const conversationAssistantStarted = createDeferred<void>();
    const secondConversationAssistantStarted = createDeferred<void>();
    const mailboxItems: HostedMailboxItem[] = [
      createMailboxItem({
        dedupeKey:
          "device-sync:dirty:v1:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:1",
        id: "mailbox_item_entrypoint_vault_share_preempt_device_1",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
        occurredAt: "2026-04-27T00:00:01.000Z",
      }),
    ];
    let activeScopeReads = 0;
    let activeProjectionDeliveries = 0;
    let assistantPhaseCalls = 0;
    let checkpointEffectCalls = 0;
    const checkpointEffectProjectionOutcomes: string[] = [];
    let checkpointCount = 0;
    let conversationAssistantPhaseEvent: string | null = null;
    let peakActiveProjectionDeliveries = 0;
    let projectionDeliveryCalls = 0;
    const projectionKinds: string[] = [];
    let processedConversationInputs = 0;
    let pendingInputId: string | null = null;
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

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_vault_share_conversation_preempt",
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
                key: "users/bundles/member-synthetic/runtime-vault-share-conversation-preempt.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.lane !== "conversation") {
              return { status: "imported" };
            }
            pendingInputId = await stagePendingLinqAssistantInputForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            return {
              assistantInputId: pendingInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            vaultSharePort: {
              async listActiveProjectionScopes() {
                activeScopeReads += 1;
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
                projectionDeliveryCalls += 1;
                projectionKinds.push(request.projectionKind);
                activeProjectionDeliveries += 1;
                peakActiveProjectionDeliveries = Math.max(
                  peakActiveProjectionDeliveries,
                  activeProjectionDeliveries,
                );
                events.push("vault-share.deliver:start");
                offerStarted.resolve();
                try {
                  await offerRelease.promise;
                } finally {
                  activeProjectionDeliveries -= 1;
                  events.push("vault-share.deliver:done");
                }
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
                    id: "mailbox_item_entrypoint_vault_share_preempt_device_2",
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
            const assistantPhaseEvent = `assistant.phase:${assistantPhaseCalls}`;
            events.push(assistantPhaseEvent);
            if (!pendingInputId) {
              return {
                nextWakeAt: null,
                progressed: false,
                redactedStatus: {
                  hostedAssistantProgressed: false,
                },
              };
            }

            const inputId = pendingInputId;
            pendingInputId = null;
            await writeSyntheticAssistantAutoReplyTerminalEvidence({
              inputId,
              vaultRoot,
            });
            processedConversationInputs += 1;
            if (processedConversationInputs === 1) {
              conversationAssistantPhaseEvent = assistantPhaseEvent;
              conversationAssistantStarted.resolve();
            } else if (processedConversationInputs === 2) {
              secondConversationAssistantStarted.resolve();
            }
            const afterDurableCheckpoint = Object.assign(
              async (context?: {
                vaultShareProjectionResult?: { outcome: string };
              }) => {
                checkpointEffectCalls += 1;
                checkpointEffectProjectionOutcomes.push(
                  context?.vaultShareProjectionResult?.outcome ?? "missing",
                );
                events.push("device-sync.dirty-ack");
                assert.deepEqual(projectionKinds.slice(-3), [
                  "sleep-times.v0",
                  "profile-name.v0",
                  "time-zone.v0",
                ]);
                assert.equal(activeProjectionDeliveries, 0);
              },
              {
                requiresVaultShareProjectionResult: true,
                vaultShareProjectionFailureWake: {
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "device-sync.reconcile" as const,
                  requiresFollowUpCheckpoint: true,
                },
              },
            );
            return {
              ...(processedConversationInputs === 2
                ? {
                  afterCheckpoint: async () => ({
                    afterDurableCheckpoint,
                    checkpointReason: "assistant_runtime_commit" as const,
                  }),
                }
                : {}),
              checkpointReason: "assistant_runtime_commit" as const,
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

      await withRealTimeout(offerStarted.promise, 5_000, () => events.join(","));
      assert.equal(checkpointRequests.length, 1, events.join(","));
      assert.ok(
        requireEventIndex(events, "workspace.checkpoint.committed:1")
          < requireEventIndex(events, "vault-share.deliver:start"),
        events.join(","),
      );
      const explicitDeviceCommands = [
        {
          dedupeKey:
            "device-sync:connection-established:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:2026-04-27T00:00:03.000Z",
          id: "mailbox_item_entrypoint_vault_share_preempt_connection",
        },
        {
          dedupeKey:
            "device-sync:disconnect:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:2026-04-27T00:00:04.000Z",
          id: "mailbox_item_entrypoint_vault_share_preempt_disconnect",
        },
        {
          dedupeKey:
            "device-sync:manual-reconcile:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:2026-04-27T00:00:05.000Z",
          id: "mailbox_item_entrypoint_vault_share_preempt_manual",
        },
        {
          dedupeKey:
            "device-sync:scheduled-reconcile:member-synthetic:provider-synthetic:connection-synthetic:2026-04-01T00:00:00.000Z:2026-04-27T00:00:06.000Z",
          id: "mailbox_item_entrypoint_vault_share_preempt_scheduled",
        },
      ] as const;
      explicitDeviceCommands.forEach((command, index) => {
        mailboxItems.push(createMailboxItem({
          dedupeKey: command.dedupeKey,
          id: command.id,
          kind: "device-sync.wake",
          lane: "system",
          laneSeq: String(index + 3),
          occurredAt: `2026-04-27T00:00:0${index + 3}.000Z`,
        }));
      });
      runtimeWakeSignal.notify();
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
      for (const command of explicitDeviceCommands) {
        assert.equal(
          events.includes(`mailbox.importItem:${command.id}`),
          false,
          events.join(","),
        );
      }
      assert.equal(events.includes("vault-share.deliver:done"), false, events.join(","));

      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_entrypoint_vault_share_preempt_conversation",
        laneSeq: "1",
        occurredAt: "2026-04-27T00:00:07.000Z",
      }));
      runtimeWakeSignal.notify();
      await withRealTimeout(
        conversationAssistantStarted.promise,
        10_000,
        () => events.join(","),
      );

      assert.equal(events.includes("vault-share.deliver:done"), false, events.join(","));
      assert.equal(activeProjectionDeliveries, 1);
      assert.equal(peakActiveProjectionDeliveries, 1);
      assert.equal(projectionDeliveryCalls, 1);
      for (const command of explicitDeviceCommands) {
        assert.ok(
          events.includes(`mailbox.importItem:${command.id}`),
          events.join(","),
        );
      }
      assert.ok(events.includes(
        "mailbox.importItem:mailbox_item_entrypoint_vault_share_preempt_conversation",
      ));
      const assistantPhaseEvent = conversationAssistantPhaseEvent;
      assert.ok(assistantPhaseEvent);
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_vault_share_preempt_conversation",
        ) < requireEventIndex(events, assistantPhaseEvent),
        events.join(","),
      );

      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_entrypoint_vault_share_preempt_conversation_2",
        laneSeq: "2",
        occurredAt: "2026-04-27T00:00:08.000Z",
      }));
      runtimeWakeSignal.notify();
      offerRelease.resolve();

      await withRealTimeout(
        secondConversationAssistantStarted.promise,
        10_000,
        () => events.join(","),
      );

      const result = await withRealTimeout(resultPromise, 15_000, () => events.join(","));
      assert.ok(events.includes("vault-share.deliver:done"), events.join(","));
      assert.equal(activeProjectionDeliveries, 0);
      assert.ok(activeScopeReads >= 2);
      assert.equal(projectionDeliveryCalls, 4);
      assert.deepEqual(projectionKinds, [
        "sleep-times.v0",
        "sleep-times.v0",
        "profile-name.v0",
        "time-zone.v0",
      ]);
      assert.equal(checkpointEffectCalls, 1);
      assert.deepEqual(checkpointEffectProjectionOutcomes, ["delivered"]);
      assert.ok(
        events.lastIndexOf("vault-share.deliver:done")
          < requireEventIndex(events, "device-sync.dirty-ack"),
        events.join(","),
      );
      assert.ok(["idle", "scheduled"].includes(result.status));
      assert.ok(checkpointRequests.length >= 1);
    } finally {
      offerRelease.resolve();
      runtimeAbortController.abort();
      await resultPromise?.catch(() => undefined);
      mocks.summarizeWearableSleepRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("failed dirty checkpoint prevents vault-share delivery from egressing uncheckpointed source state", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-vault-share-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeAbortController = new AbortController();
    const checkpointFailure = new Error("synthetic checkpoint failed");
    const importedInputIds: string[] = [];
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

      await expect(runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_vault_share_checkpoint_failure",
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
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/runtime-vault-share-checkpoint.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            const inputId = await stagePendingLinqAssistantInputForMailboxItem({
              item: item.item,
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
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_vault_share_checkpoint_failure",
                  laneSeq: "1",
                }),
              ],
            }),
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
                vaultShareDeliverCalls += 1;
                events.push("vault-share.deliver:start");
                return { status: "delivered" };
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace() {
                throw checkpointFailure;
              },
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          async runAssistantPhase() {
            const inputId = importedInputIds.shift();
            assert.ok(inputId);
            await writeSyntheticAssistantAutoReplyTerminalEvidence({
              inputId,
              vaultRoot,
            });
            return {
              checkpointReason: "assistant_runtime_commit" as const,
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
      )).rejects.toBe(checkpointFailure);

      assert.equal(checkpointRequests.length, 1);
      assert.equal(vaultShareDeliverCalls, 0);
      assert.ok(!events.includes("vault-share.deliver:start"));
    } finally {
      runtimeAbortController.abort();
      mocks.summarizeWearableSleepRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("source-blind wake after checkpoint-gated system pass keeps checkpoint gate", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-foreground-stale-gate-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeAbortController = new AbortController();
    const runtimeAbortReason = new Error("synthetic stale gate foreground proof complete");
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 1;
    const runtimeTransitionTimeoutMs = 15_000;
    const systemFollowUpWakeAt = "2099-04-27T00:10:00.000Z";
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_foreground_stale_gate_system",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_foreground_stale_gate",
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
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/runtime-foreground-stale-gate.bundle.json",
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
              vaultRoot,
            });
            return {
              assistantInputId: inputId,
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
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              const systemRedactedStatus: HostedRuntimeRedactedJson = {
                hostedSystemMailboxRecorded: 1,
              };
              return {
                afterCheckpoint: async () => {
                  events.push("system.afterCheckpoint");
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_foreground_stale_gate_system_late",
                    kind: "device-sync.wake",
                    lane: "system",
                    laneSeq: "2",
                    occurredAt: "2026-04-27T00:00:01.000Z",
                  }));
                  runtimeWakeSignal.notify();
                  return {
                    checkpointReason: "system_mailbox_receipt" as const,
                    nextWakeAt: systemFollowUpWakeAt,
                    nextWakeReason: "device-sync.reconcile",
                    redactedStatus: systemRedactedStatus,
                  };
                },
                checkpointReason: "system_mailbox_receipt" as const,
                nextWakeAt: systemFollowUpWakeAt,
                nextWakeReason: "device-sync.reconcile",
                progressed: true,
                redactedStatus: systemRedactedStatus,
              };
            }

            assert.ok(events.includes("snapshot:idle_shutdown"), events.join(","));
            return {
              progressed: false,
              redactedStatus: {
                hostedAssistantProgressed: false,
              },
            };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      ).then(
        () => "resolved" as const,
        (error: unknown) => error,
      );
      const result = await withRealTimeout(
        resultPromise,
        runtimeTransitionTimeoutMs,
        () => events.join(","),
      );
      assert.equal(result, "resolved");
      assert.equal(assistantPhaseCalls, 2, events.join(","));
      assert.ok(events.includes("snapshot:idle_shutdown"));
      assert.ok(events.includes(
        "mailbox.importItem:mailbox_item_entrypoint_foreground_stale_gate_system_late",
      ));
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown")
          < requireEventIndex(
            events,
            "mailbox.importItem:mailbox_item_entrypoint_foreground_stale_gate_system_late",
          ),
      );
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown")
          < requireEventIndex(events, "assistant.phase:2"),
      );
      assert.ok(checkpointRequests.length >= 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, systemFollowUpWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "device-sync.reconcile");
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, systemFollowUpWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "device-sync.reconcile");
    } finally {
      runtimeAbortController.abort(runtimeAbortReason);
      await removeTempRoot(vaultRoot);
    }
  });

  test("late foreground input does not clear gate for selected device-sync wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-foreground-device-gate-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeAbortController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const deviceSyncWakeAt = "2099-04-27T00:00:00.000Z";
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_foreground_device_gate_system",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    let assistantPhaseCalls = 0;
    let lateConversationInputId: string | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_foreground_device_gate",
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
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/runtime-foreground-device-gate.bundle.json",
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
              vaultRoot,
            });
            lateConversationInputId = inputId;
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
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              const systemRedactedStatus: HostedRuntimeRedactedJson = {
                hostedSystemMailboxRecorded: 1,
              };
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_foreground_device_gate_conversation",
                laneSeq: "1",
                occurredAt: "2026-04-27T00:00:01.000Z",
              }));
              runtimeWakeSignal.notify();
              await waitUntil(() => {
                assert.ok(events.includes(
                  "mailbox.importItem:mailbox_item_entrypoint_foreground_device_gate_conversation",
                ));
              });
              return {
                afterCheckpoint: async () => {
                  events.push("system.afterCheckpoint");
                  return {
                    checkpointReason: "system_mailbox_receipt" as const,
                    nextWakeAt: deviceSyncWakeAt,
                    nextWakeReason: "device-sync.reconcile",
                    redactedStatus: systemRedactedStatus,
                  };
                },
                checkpointReason: "system_mailbox_receipt" as const,
                progressed: true,
                redactedStatus: systemRedactedStatus,
              };
            }

            if (lateConversationInputId) {
              assert.ok(await readAssistantInputEvent({
                inputId: lateConversationInputId,
                vault: vaultRoot,
              }));
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId: lateConversationInputId,
                vaultRoot,
              });
            }
            return {
              checkpointReason: "assistant_runtime_commit" as const,
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

      assert.equal(assistantPhaseCalls, 2);
      assert.ok(lateConversationInputId);
      assert.ok(events.includes("snapshot:idle_shutdown"));
      assert.ok(
        requireEventIndex(events, "assistant.phase:2")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
      );
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, deviceSyncWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "device-sync.reconcile");
      assert.equal(result.nextWakeAt, deviceSyncWakeAt);
    } finally {
      runtimeAbortController.abort();
      await removeTempRoot(vaultRoot);
    }
  });

  test("late foreground input preserves a newer device-sync continuation after an earlier handled wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-device-continuation-key-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeAbortController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const initialWakeAt = "2026-04-26T23:59:59.000Z";
    const continuationWakeAt = "2026-04-27T00:00:30.000Z";
    const mailboxItems: HostedMailboxItem[] = [];
    let assistantPhaseCalls = 0;
    let lateConversationInputId: string | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_device_continuation_key",
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
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/runtime-device-continuation-key.bundle.json",
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
              vaultRoot,
            });
            lateConversationInputId = inputId;
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
              workspace: createWorkspaceState({
                nextWakeAt: initialWakeAt,
                nextWakeReason: "device-sync.reconcile",
                version: "4",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_device_continuation_key_conversation",
                laneSeq: "1",
                occurredAt: "2026-04-27T00:00:01.000Z",
              }));
              runtimeWakeSignal.notify();
              await waitUntil(() => {
                assert.ok(events.includes(
                  "mailbox.importItem:mailbox_item_entrypoint_device_continuation_key_conversation",
                ));
              });
              return {
                checkpointReason: "assistant_runtime_commit" as const,
                deviceSyncMaintenanceRan: true,
                nextWakeAt: continuationWakeAt,
                nextWakeReason: "device-sync.reconcile",
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: false,
                  hostedDeviceSyncSkipped: false,
                },
              };
            }

            assert.deepEqual(input.deviceSyncWorkspaceWakeHandled, {
              nextWakeAt: initialWakeAt,
              nextWakeReason: "device-sync.reconcile",
            });
            assert.equal(input.workspace?.nextWakeAt, initialWakeAt);
            assert.equal(input.workspace?.nextWakeReason, "device-sync.reconcile");
            if (lateConversationInputId) {
              assert.ok(await readAssistantInputEvent({
                inputId: lateConversationInputId,
                vault: vaultRoot,
              }));
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId: lateConversationInputId,
                vaultRoot,
              });
            }
            return {
              checkpointReason: "assistant_runtime_commit" as const,
              nextWakeAt: continuationWakeAt,
              nextWakeReason: "device-sync.reconcile",
              progressed: true,
              redactedStatus: {
                hostedAssistantProgressed: true,
                hostedDeviceSyncSkipped: false,
              },
            };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 2);
      assert.ok(lateConversationInputId);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, continuationWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "device-sync.reconcile");
      assert.equal(result.nextWakeAt, continuationWakeAt);
    } finally {
      runtimeAbortController.abort();
      await removeTempRoot(vaultRoot);
    }
  });

  test("late foreground input preserves retryable outbox wake as checkpoint wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-foreground-outbox-gate-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeAbortController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const competingWakeAt = "2026-04-26T23:59:00.000Z";
    const outboxRetryWakeAt = "2026-04-26T23:59:30.000Z";
    const mailboxItems: HostedMailboxItem[] = [];
    let assistantPhaseCalls = 0;
    let lateConversationInputId: string | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_foreground_outbox_gate",
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
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/runtime-foreground-outbox-gate.bundle.json",
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
              vaultRoot,
            });
            if (item.item.id === "mailbox_item_entrypoint_foreground_outbox_gate_conversation_late") {
              lateConversationInputId = inputId;
            }
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
              workspace: createWorkspaceState({
                nextWakeAt: TEST_NOW,
                nextWakeReason: "assistant",
                version: "4",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_foreground_outbox_gate_conversation_late",
                laneSeq: "1",
                occurredAt: "2026-04-27T00:00:01.000Z",
              }));
              runtimeWakeSignal.notify();
              await waitUntil(() => {
                assert.ok(events.includes(
                  "mailbox.importItem:mailbox_item_entrypoint_foreground_outbox_gate_conversation_late",
                ));
              });
              return {
                afterCheckpoint: async () => {
                  events.push("outbox.afterCheckpoint");
                  return {
                    checkpointReason: "outbox_receipt" as const,
                    nextWakeAt: outboxRetryWakeAt,
                    nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
                    redactedStatus: {
                      hostedAssistantNextWakeAt: outboxRetryWakeAt,
                    },
                  };
                },
                checkpointReason: "outbox_sending" as const,
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                },
              };
            }

            if (assistantPhaseCalls === 2) {
              assert.ok(lateConversationInputId);
              assert.ok(await readAssistantInputEvent({
                inputId: lateConversationInputId,
                vault: vaultRoot,
              }));
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId: lateConversationInputId,
                vaultRoot,
              });
              return {
                checkpointReason: "assistant_runtime_commit" as const,
                nextWakeAt: competingWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                },
              };
            }

            if (assistantPhaseCalls === 3) {
              assert.ok(events.includes("workspace.checkpoint"), events.join(","));
              assert.equal(input.workspace?.nextWakeAt, outboxRetryWakeAt);
              assert.equal(
                input.workspace?.nextWakeReason,
                HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
              );
              return {
                progressed: false,
              };
            }

            if (assistantPhaseCalls > 3) {
              throw new Error("Retryable outbox wake should be serviced at most once.");
            }

            throw new Error("Unexpected assistant phase without late foreground input.");
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 3);
      assert.ok(lateConversationInputId);
      assert.ok(events.includes("outbox.afterCheckpoint"));
      assert.ok(events.includes("snapshot:idle_shutdown"));
      assert.ok(
        requireEventIndex(events, "assistant.phase:2")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
      );
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown")
          < requireEventIndex(events, "assistant.phase:3"),
      );
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, outboxRetryWakeAt);
      assert.equal(
        checkpointRequests[0]?.nextWakeReason,
        HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, outboxRetryWakeAt);
      assert.equal(
        result.nextWakeReason,
        HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      );
    } finally {
      runtimeAbortController.abort();
      await removeTempRoot(vaultRoot);
    }
  });

  test("same selected device-sync wake keeps checkpoint gate across idle wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-same-device-gate-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeAbortController = new AbortController();
    const runtimeAbortReason = new Error("unexpected projected device-sync pass before checkpoint");
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const deviceSyncWakeAt = "2026-04-27T00:00:00.000Z";
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_same_device_gate_system",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_same_device_gate",
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
                key: "users/bundles/member-synthetic/runtime-same-device-gate.bundle.json",
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
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              const systemRedactedStatus: HostedRuntimeRedactedJson = {
                hostedSystemMailboxRecorded: 1,
              };
              return {
                afterCheckpoint: async () => {
                  events.push("system.afterCheckpoint");
                  runtimeWakeSignal.notify();
                  return {
                    checkpointReason: "system_mailbox_receipt" as const,
                    nextWakeAt: deviceSyncWakeAt,
                    nextWakeReason: "device-sync.reconcile",
                    redactedStatus: systemRedactedStatus,
                  };
                },
                checkpointReason: "system_mailbox_receipt" as const,
                nextWakeAt: deviceSyncWakeAt,
                nextWakeReason: "device-sync.reconcile",
                progressed: true,
                redactedStatus: systemRedactedStatus,
              };
            }

            runtimeAbortController.abort(runtimeAbortReason);
            throw runtimeAbortReason;
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.ok(events.includes("snapshot:idle_shutdown"));
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, deviceSyncWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "device-sync.reconcile");
      assert.equal(result.nextWakeAt, deviceSyncWakeAt);
    } finally {
      runtimeAbortController.abort(runtimeAbortReason);
      await removeTempRoot(vaultRoot);
    }
  });

  test("source-blind checkpoint wakes do not replace device-sync checkpoint gates", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-replaced-device-gate-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeAbortController = new AbortController();
    const runtimeAbortReason = new Error("unexpected replacement device-sync pass before checkpoint");
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const initialDeviceSyncWakeAt = "2026-04-27T00:00:00.000Z";
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_replaced_device_gate_system",
        kind: "device-sync.wake",
        lane: "system",
        laneSeq: "1",
      }),
    ];
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_replaced_device_gate",
            idleCheckpointDelayMs: 120,
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
                key: "users/bundles/member-synthetic/runtime-replaced-device-gate.bundle.json",
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
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              const systemRedactedStatus: HostedRuntimeRedactedJson = {
                hostedSystemMailboxRecorded: 1,
              };
              return {
                afterCheckpoint: async () => {
                  events.push("system.afterCheckpoint");
                  runtimeWakeSignal.notify();
                  return {
                    checkpointReason: "system_mailbox_receipt" as const,
                    nextWakeAt: initialDeviceSyncWakeAt,
                    nextWakeReason: "device-sync.reconcile",
                    redactedStatus: systemRedactedStatus,
                  };
                },
                checkpointReason: "system_mailbox_receipt" as const,
                nextWakeAt: initialDeviceSyncWakeAt,
                nextWakeReason: "device-sync.reconcile",
                progressed: true,
                redactedStatus: systemRedactedStatus,
              };
            }

            runtimeAbortController.abort(runtimeAbortReason);
            throw runtimeAbortReason;
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.ok(events.includes("snapshot:idle_shutdown"));
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, initialDeviceSyncWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "device-sync.reconcile");
      assert.equal(result.nextWakeAt, initialDeviceSyncWakeAt);
    } finally {
      runtimeAbortController.abort(runtimeAbortReason);
      await removeTempRoot(vaultRoot);
    }
  });

  test("dirty runtime checkpoints after the idle delay", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const startedAt = performance.now();
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_timer",
            idleCheckpointDelayMs: 250,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            assert.equal(snapshotInput.idleCheckpointTrigger, "idle_window");
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-timer.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          vaultRoot,
        },
      );

      const elapsedMs = performance.now() - startedAt;
      assert.equal(checkpointRequests.length, 1);
      assert.ok(elapsedMs >= 200);
      assert.ok(elapsedMs < 5_000);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("deferred provider cleanup wake does not bypass the foreground idle checkpoint delay", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 1_000;
    const providerCleanupWakeAt = new Date(Date.now() + 5 * 60_000).toISOString();
    let snapshotStartedAtMs: number | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const startedAt = performance.now();
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_provider_cleanup_idle_delay",
            idleCheckpointDelayMs,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotStartedAtMs = performance.now();
            events.push(`snapshot:${snapshotInput.reason}`);
            assert.equal(snapshotInput.reason, "idle_shutdown");
            return {
              snapshotRef: createBundleRef({
                hash: "6".repeat(64),
                key: "users/bundles/member-synthetic/provider-cleanup-idle-delay.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          async runAssistantPhase() {
            return {
              checkpointReason: "outbox_receipt",
              nextWakeAt: providerCleanupWakeAt,
              nextWakeReason: "assistant",
              progressed: true,
              redactedStatus: {
                hostedAssistantNextWakeAt: providerCleanupWakeAt,
                hostedAssistantProgressed: true,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, providerCleanupWakeAt);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, providerCleanupWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.ok(snapshotStartedAtMs !== null);
      assert.ok(snapshotStartedAtMs - startedAt >= idleCheckpointDelayMs - 50);
      assert.ok(snapshotStartedAtMs - startedAt < 5_000);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("deferred provider cleanup append replaces an older wake inside the idle window", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-provider-cleanup-replace-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 250;
    let replacementWakeAt: string | null = null;
    let snapshotStartedAtMs: number | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await recordHostedProviderCleanupBeforeCommit({
        checkpoint: {
          nextWakeAt: new Date(Date.now() + 500).toISOString(),
        },
        linqMessageIds: ["linq_existing_cleanup"],
        vaultRoot,
      });

      const startedAt = performance.now();
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_provider_cleanup_replace_idle_delay",
            idleCheckpointDelayMs,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotStartedAtMs = performance.now();
            events.push(`snapshot:${snapshotInput.reason}`);
            assert.equal(snapshotInput.reason, "idle_shutdown");
            return {
              snapshotRef: createBundleRef({
                hash: "7".repeat(64),
                key: "users/bundles/member-synthetic/provider-cleanup-replace-idle-delay.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          async runAssistantPhase() {
            return {
              afterCheckpoint: async () => {
                replacementWakeAt = new Date(
                  Date.now() + idleCheckpointDelayMs + 1_000,
                ).toISOString();
                const checkpoint = await recordHostedProviderCleanupBeforeCommit({
                  checkpoint: {
                    nextWakeAt: replacementWakeAt,
                  },
                  linqMessageIds: ["linq_new_cleanup"],
                  vaultRoot,
                });
                return {
                  checkpointReason: "provider_cleanup" as const,
                  nextWakeAt: checkpoint.nextWakeAt ?? null,
                  nextWakeReason: "assistant" as const,
                };
              },
              checkpointReason: "outbox_receipt",
              progressed: true,
              redactedStatus: {
                hostedAssistantProgressed: true,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.ok(replacementWakeAt);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, replacementWakeAt);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, replacementWakeAt);
      assert.deepEqual(await readHostedProviderCleanupCheckpoint(vaultRoot), {
        nextWakeAt: replacementWakeAt,
      });
      assert.ok(snapshotStartedAtMs !== null);
      assert.ok(snapshotStartedAtMs - startedAt >= idleCheckpointDelayMs - 50);
      assert.ok(snapshotStartedAtMs - startedAt < 5_000);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("due projected assistant wake runs before the idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 250;
    const projectedWakeAt = new Date(Date.now()).toISOString();
    let assistantPhaseCalls = 0;
    let firstCheckpointStartedAtMs: number | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const startedAt = performance.now();
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_projected_wake",
            idleCheckpointDelayMs,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            firstCheckpointStartedAtMs ??= performance.now();
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-projected-wake.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls > 1) {
              return {
                checkpointReason: "provider_cleanup",
                nextWakeAt: null,
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: null,
                  hostedAssistantProgressed: true,
                },
              };
            }

            return {
              checkpointReason: "assistant_runtime_commit",
              invocationLocalAssistantWakeAt: projectedWakeAt,
              nextWakeAt: projectedWakeAt,
              progressed: true,
              redactedStatus: {
                hostedAssistantNextWakeAt: projectedWakeAt,
                hostedAssistantProgressed: true,
              },
            };
          },
          vaultRoot,
        },
      );

      const elapsedMs = performance.now() - startedAt;
      assert.ok(elapsedMs < 2_000);
      assert.ok(firstCheckpointStartedAtMs !== null);
      assert.ok(firstCheckpointStartedAtMs - startedAt >= idleCheckpointDelayMs - 50);
      assert.equal(assistantPhaseCalls, 2);
      const secondAssistantPhaseIndex = events.indexOf("assistant.phase:2");
      const snapshotIndex = events.findIndex((event) => event === "snapshot:idle_shutdown");
      assert.ok(secondAssistantPhaseIndex >= 0);
      assert.ok(secondAssistantPhaseIndex < snapshotIndex);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("future projected assistant wake runs when due without shortening the idle checkpoint floor", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 180_000;
    const projectedWakeAt = new Date(Date.parse(TEST_NOW) + 60_000).toISOString();
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    let assistantPhaseCalls = 0;
    let firstCheckpointStartedAtMs: number | null = null;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_runtime_projected_wake_deadline_checkpoint",
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              firstCheckpointStartedAtMs ??= Date.now();
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "9".repeat(64),
                  key: "users/bundles/member-synthetic/runtime-projected-wake-deadline.bundle.json",
                  size: 640,
                }),
              };
            },
            async importItem() {
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              events.push(
                `assistant.phase:${assistantPhaseCalls}:${input.workspace?.nextWakeAt ?? "none"}`,
              );
              if (assistantPhaseCalls === 1) {
                assistantOneObserved.resolve();
                return {
                  checkpointReason: "assistant_runtime_commit",
                  invocationLocalAssistantWakeAt: projectedWakeAt,
                  nextWakeAt: projectedWakeAt,
                  progressed: true,
                  redactedStatus: {
                    hostedAssistantNextWakeAt: projectedWakeAt,
                    hostedAssistantProgressed: true,
                  },
                };
              }

              assistantTwoObserved.resolve();
              const redactedStatus: HostedRuntimeRedactedJson = {
                hostedAssistantProgressed: false,
              };
              return {
                progressed: false,
                redactedStatus,
              };
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(59_000);
      assert.equal(checkpointRequests.length, 0);

      await vi.advanceTimersByTimeAsync(1_000);
      assert.equal(checkpointRequests.length, 0);
      await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));
      assert.equal(assistantPhaseCalls, 2);
      await vi.advanceTimersByTimeAsync(119_000);
      assert.equal(checkpointRequests.length, 0);
      assert.equal(assistantPhaseCalls, 2);
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await resultPromise;

      assert.equal(firstCheckpointStartedAtMs, Date.parse(TEST_NOW) + idleCheckpointDelayMs);
      assert.equal(assistantPhaseCalls, 2);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(checkpointRequests[0]?.nextWakeAt, projectedWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.ok(
        requireEventIndex(events, `assistant.phase:2:${projectedWakeAt}`)
          < requireEventIndex(events, "snapshot:idle_shutdown"),
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, projectedWakeAt);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("assistant wake exactly at the idle checkpoint floor checkpoints first", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 180_000;
    const projectedWakeAt = new Date(
      Date.parse(TEST_NOW) + idleCheckpointDelayMs,
    ).toISOString();
    const assistantOneObserved = createDeferred<void>();
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_runtime_projected_wake_at_idle_floor",
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
                  hash: "b".repeat(64),
                  key: "users/bundles/member-synthetic/runtime-projected-wake-at-floor.bundle.json",
                  size: 640,
                }),
              };
            },
            async importItem() {
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({ events, items: [] }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              events.push(
                `assistant.phase:${assistantPhaseCalls}:${input.workspace?.nextWakeAt ?? "none"}`,
              );
              if (assistantPhaseCalls === 1) {
                assistantOneObserved.resolve();
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: projectedWakeAt,
                  progressed: true,
                };
              }
              return {
                progressed: false,
                redactedStatus: {
                  hostedAssistantProgressed: false,
                },
              };
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs - 1);
      assert.equal(assistantPhaseCalls, 1);
      assert.equal(checkpointRequests.length, 0);

      await vi.advanceTimersByTimeAsync(1);
      const result = await resultPromise;

      assert.equal(assistantPhaseCalls, 2);
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown")
          < requireEventIndex(events, `assistant.phase:2:${projectedWakeAt}`),
      );
      assert.deepEqual(checkpointRequests.map((request) => [
        request.nextWakeAt,
        request.nextWakeReason,
      ]), [[projectedWakeAt, "assistant"]]);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, projectedWakeAt);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("progressed-false assistant retry runs hot before the idle floor", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 180_000;
    const retryDelayMs = 60_000;
    const retryWakeAt = new Date(Date.parse(TEST_NOW) + retryDelayMs).toISOString();
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    let assistantPhaseCalls = 0;
    let firstCheckpointStartedAtMs: number | null = null;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_runtime_progressed_false_retry",
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              firstCheckpointStartedAtMs ??= Date.now();
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "a".repeat(64),
                  key: "users/bundles/member-synthetic/runtime-progressed-false-retry.bundle.json",
                  size: 640,
                }),
              };
            },
            async importItem() {
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [createMailboxItem({ laneSeq: "1" })],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              events.push(
                `assistant.phase:${assistantPhaseCalls}:${input.workspace?.nextWakeAt ?? "none"}`,
              );
              if (assistantPhaseCalls === 1) {
                assistantOneObserved.resolve();
                return {
                  invocationLocalAssistantWakeAt: retryWakeAt,
                  nextWakeAt: retryWakeAt,
                  progressed: false,
                  redactedStatus: {
                    hostedAssistantProgressed: false,
                  },
                };
              }

              assistantTwoObserved.resolve();
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                },
              };
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(retryDelayMs - 1);
      assert.equal(assistantPhaseCalls, 1);
      assert.equal(checkpointRequests.length, 0);

      await vi.advanceTimersByTimeAsync(1);
      await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));
      assert.equal(checkpointRequests.length, 0);

      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs - 1);
      assert.equal(checkpointRequests.length, 0);
      await vi.advanceTimersByTimeAsync(1);
      const result = await resultPromise;

      assert.equal(
        firstCheckpointStartedAtMs,
        Date.parse(TEST_NOW) + retryDelayMs + idleCheckpointDelayMs,
      );
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1:none",
        `assistant.phase:2:${retryWakeAt}`,
      ]);
      assert.ok(
        requireEventIndex(events, `assistant.phase:2:${retryWakeAt}`)
          < requireEventIndex(events, "snapshot:idle_shutdown"),
      );
      assert.deepEqual(checkpointRequests.map((request) => [
        request.nextWakeAt,
        request.nextWakeReason,
      ]), [[null, null]]);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("preserves system mailbox receipt counters across a checkpointed follow-up pass", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-redacted-status-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_receipt_status_followup",
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
                hash: `${checkpointRequests.length}`.repeat(64).slice(0, 64),
                key: "users/bundles/member-synthetic/runtime-receipt-status-followup.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              const preparedStatus: HostedRuntimeRedactedJson = {
                hostedSystemMailboxPrepared: 1,
              };
              const recordedStatus: HostedRuntimeRedactedJson = {
                hostedSystemMailboxRecorded: 1,
              };
              return {
                afterCheckpoint: async () => ({
                  checkpointReason: "system_mailbox_receipt" as const,
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  redactedStatus: recordedStatus,
                }),
                checkpointReason: "system_mailbox_receipt" as const,
                nextWakeAt: TEST_NOW,
                nextWakeReason: "assistant",
                progressed: true,
                redactedStatus: preparedStatus,
              };
            }

            if (assistantPhaseCalls === 2) {
              const followUpStatus: HostedRuntimeRedactedJson = {
                hostedAssistantProgressed: true,
                hostedSystemMailboxPrepared: 0,
                hostedSystemMailboxRecorded: 0,
              };
              return {
                checkpointReason: "assistant_runtime_commit" as const,
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
                redactedStatus: followUpStatus,
              };
            }

            throw new Error("System mailbox receipt follow-up should service exactly once.");
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 2, events.join(","));
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.redactedStatus?.hostedSystemMailboxPrepared, 1);
      assert.equal(result.redactedStatus?.hostedSystemMailboxRecorded, 1);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("external runtime wake preserves already-serviced projected wake guard", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 75;
    const projectedWakeAt = new Date(Date.now()).toISOString();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_external_after_projected",
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
                hash: "7".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-external-after-projected.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
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
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: projectedWakeAt,
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: projectedWakeAt,
                  hostedAssistantProgressed: true,
                },
              };
            }
            if (assistantPhaseCalls === 2) {
              setTimeout(() => runtimeWakeSignal.notify(), 0);
            }

            return {};
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 2);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
        "assistant.phase:2",
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, projectedWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(result.nextWakeAt, projectedWakeAt);
      assert.equal(result.status, "scheduled");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("post-checkpoint external runtime wake preserves a future assistant wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 500;
    const projectedWakeDelayMs = 5_000;
    let assistantPhaseCalls = 0;
    let projectedWakeAt: string | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(TEST_NOW));
      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_post_checkpoint_external_future_wake",
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
                  hash: `${checkpointRequests.length}`.repeat(64).slice(0, 64),
                  key:
                    "users/bundles/member-synthetic/"
                    + "runtime-post-checkpoint-external-future-wake.bundle.json",
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
                items: mailboxItems,
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                checkpointWorkspace(request) {
                  const workspace = createWorkspaceState({
                    inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                    nextWakeAt: request.nextWakeAt ?? null,
                    nextWakeReason: request.nextWakeReason ?? null,
                    redactedStatus: request.redactedStatus ?? null,
                    snapshotRef: request.snapshotRef,
                    version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                  });
                  if (request.expectedWorkspaceVersion === "4") {
                    events.push("runtime-wake:after-first-checkpoint");
                    mailboxItems.push(createMailboxItem({
                      id: "mailbox_item_entrypoint_post_checkpoint_future_wake_001",
                      laneSeq: "1",
                    }));
                    runtimeWakeSignal.notify();
                  } else if (request.expectedWorkspaceVersion === "5") {
                    assert.ok(projectedWakeAt);
                    vi.setSystemTime(new Date(Date.parse(projectedWakeAt) + 1));
                  }
                  return workspace;
                },
                events,
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              events.push(
                `assistant.phase:${assistantPhaseCalls}:`
                + `${input.workspace?.nextWakeAt ?? "none"}`,
              );

              if (assistantPhaseCalls === 1) {
                projectedWakeAt = new Date(
                  Date.now() + projectedWakeDelayMs,
                ).toISOString();
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: projectedWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                  redactedStatus: {
                    hostedAssistantNextWakeAt: projectedWakeAt,
                    hostedAssistantProgressed: true,
                  },
                };
              }

              if (assistantPhaseCalls === 2) {
                assert.equal(input.workspace?.nextWakeAt, projectedWakeAt);
                assert.ok(projectedWakeAt);
                assert.ok(Date.parse(projectedWakeAt) > Date.now());
                return {
                  progressed: false,
                };
              }

              if (assistantPhaseCalls === 3) {
                assert.equal(input.workspace?.nextWakeAt, projectedWakeAt);
                return {
                  checkpointReason: "provider_cleanup",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                  redactedStatus: {
                    hostedAssistantNextWakeAt: null,
                    hostedAssistantProgressed: true,
                  },
                };
              }

              throw new Error("Future assistant wake should run exactly once.");
            },
            vaultRoot,
          },
        ),
        10_000,
        () => events.join(","),
      );

      assert.ok(projectedWakeAt);
      assert.equal(assistantPhaseCalls, 3, events.join(","));
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_post_checkpoint_future_wake_001",
      ]);
      assert.ok(
        requireEventIndex(events, "runtime-wake:after-first-checkpoint")
          < requireEventIndex(events, `assistant.phase:2:${projectedWakeAt}`),
      );
      const snapshotIndexes = events
        .map((event, index) => ({ event, index }))
        .filter(({ event }) => event === "snapshot:idle_shutdown")
        .map(({ index }) => index);
      assert.equal(snapshotIndexes.length, 3);
      const finalSnapshotIndex = snapshotIndexes.at(2);
      if (finalSnapshotIndex === undefined) {
        throw new Error(events.join(","));
      }
      assert.ok(
        requireEventIndex(events, `assistant.phase:3:${projectedWakeAt}`)
          < finalSnapshotIndex,
      );
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.expectedWorkspaceVersion,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["4", projectedWakeAt, "assistant"],
          ["5", projectedWakeAt, "assistant"],
          ["6", null, null],
        ],
      );
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.status, "idle");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("idle checkpoint can run before a later projected wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const projectedWakeAt = new Date(Date.now() + 120_000).toISOString();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const startedAt = performance.now();
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_timer_before_projected_wake",
            idleCheckpointDelayMs: 250,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            assert.equal(snapshotInput.idleCheckpointTrigger, "idle_window");
            return {
              snapshotRef: createBundleRef({
                hash: "9".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-timer-before-wake.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          async runAssistantPhase() {
            return {
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: projectedWakeAt,
              progressed: true,
              redactedStatus: {
                hostedAssistantNextWakeAt: projectedWakeAt,
                hostedAssistantProgressed: true,
              },
            };
          },
          vaultRoot,
        },
      );

      const elapsedMs = performance.now() - startedAt;
      assert.ok(elapsedMs >= 200);
      assert.ok(elapsedMs < 2_000);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, projectedWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(result.nextWakeAt, projectedWakeAt);
      assert.equal(result.status, "scheduled");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fails closed when the runtime-owned idle checkpoint returns another user's workspace", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await expect(runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_wrong_user",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            assert.equal(snapshotInput.idleCheckpointTrigger, "idle_window");
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-wrong-user.bundle.json",
                size: 256,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events: [],
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: {
              async read() {
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    userId: "member_synthetic_other",
                    version: "5",
                  }),
                };
              },
            },
          }),
          vaultRoot,
        },
      )).rejects.toThrow(
        "Hosted mailbox import checkpoint returned an unexpected user.",
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  });

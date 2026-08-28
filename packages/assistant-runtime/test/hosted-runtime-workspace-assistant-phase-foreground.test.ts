import {
  createAssistantAskCompletionSystemMailboxItem,
  createAssistantUsageRecord,
  createBrowserVaultRefreshSystemMailboxItem,
  createCodexAuthSystemMailboxItem,
  createDeliveryEffect,
  createDueAssistantWorkspace,
  createExternalCompletionSystemMailboxItem,
  createGroupRoomModelInitializationSystemMailboxItem,
  createMaintenanceSystemMailboxItem,
  createMemberActionSystemMailboxItem,
  createMemberActivationSignupWelcomeSystemMailboxItem,
  createMemberPreferencesSystemMailboxItem,
  createPendingEffectsReconcileSystemMailboxItem,
  createPhaseInput,
  createPreparedDispatchesForDeliveryEffect,
  createResolvedForegroundAdmissionMailboxItem,
  createResolvedMemberActivationMailboxItem,
  createSentDeliveryOutcome,
  createSystemMailboxItem,
  createVaultShareProjectionSystemMailboxItem,
  expectAssistantLaneCallWithoutDeviceSyncOptions,
  loadHostedSystemMailboxRealImplementation,
  mocks,
  runHostedWorkspaceDurableCheckpointEffects,
  runRealForegroundApprovalAdmissionScenario,
  withoutAssistantTurnTimingLogs,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";

import type {
  RuntimeUsageRecordPort,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";

import type {
  HostedAssistantDeliverySideEffect,
} from "@murphai/hosted-execution/side-effects";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type HostedMailboxItem,
  type HostedRuntimeGroupSummary,
  type HostedRuntimeGroupToolRequest,
  type HostedRuntimeLatencyTraceRequest,
  type HostedRuntimeLogRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionPendingEffectsReconcileRequestedWake,
  buildHostedExecutionRuntimeControlWake,
} from "@murphai/hosted-execution";
import {
  ASSISTANT_USAGE_SCHEMA,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
} from "@murphai/hosted-execution/orchestration-control";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeVault,
  patchAutomation,
  showAutomation,
  splitAutomationAvailabilityConflictBlock,
  upsertAutomation,
} from "@murphai/core";
import {
  runHostedWorkspaceAssistantPhase,
  type HostedWorkspaceRuntimeAssistantPhaseInput,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";
import {
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";

describe("runHostedWorkspaceAssistantPhase runtime logs", () => {it("passes foreground Linq delivery context into hosted progress dependencies", async () => {
    const linqDeliveryContext = {
      directRecipientPhoneNumber: "+15550000001",
      fromPhoneNumber: "+15550000002",
      replyToMessageId: "linq-message-1",
      routeAuthority: null,
      service: null,
      target: "linq-thread-1",
      threadIsDirect: null,
    };

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      linqDeliveryContext,
    }));

    expect(mocks.createHostedAssistantProgressDeliveryDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        linqDeliveryContexts: [linqDeliveryContext],
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.createHostedAssistantChannelTypingDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        linqDeliveryContexts: [linqDeliveryContext],
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("passes foreground Linq delivery context into hosted outbox delivery", async () => {
    const linqDeliveryContext = {
      directRecipientPhoneNumber: "+15550000001",
      fromPhoneNumber: "+15550000002",
      replyToMessageId: "linq-message-1",
      routeAuthority: null,
      service: null,
      target: "linq-thread-1",
      threadIsDirect: null,
    };
    const effect = createDeliveryEffect();
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([effect]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      linqDeliveryContext,
    }));
    await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [effect],
        linqDeliveryContexts: [linqDeliveryContext],
      }),
    );
  });

  it("passes a late active-turn Linq delivery context into hosted outbox delivery", async () => {
    const lateLinqDeliveryContext = {
      directRecipientPhoneNumber: "+15550000001",
      fromPhoneNumber: "+15550000002",
      replyToMessageId: "linq-message-late",
      routeAuthority: null,
      service: "imessage",
      target: "linq-thread-late",
      threadIsDirect: true,
    };
    const effect = createDeliveryEffect();
    let latestAssistantInputBatch:
      NonNullable<HostedWorkspaceRuntimeAssistantPhaseInput["initialAssistantInputBatch"]>
      | null = null;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      latestAssistantInputBatch = {
        assistantInputIds: ["ain_00000000000000000000000000000002"],
        assistantInputRecords: [{
          assistantInputId: "ain_00000000000000000000000000000002",
          linqDeliveryContext: lateLinqDeliveryContext,
        }],
        emailDeliveryContexts: [],
        linqDeliveryContexts: [lateLinqDeliveryContext],
      };
      return {
        activeTurnInputIngested: true,
        assistantAutomationCurrentTurnDeliveryIntentIds: [effect.effectId],
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([effect]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      latestAssistantInputBatch: () => latestAssistantInputBatch,
    }));
    await result.afterCheckpoint?.();

    expect(mocks.prepareHostedAssistantDeliveryEffectsForDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [effect],
        linqDeliveryContexts: [lateLinqDeliveryContext],
      }),
    );
    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [effect],
        linqDeliveryContexts: [lateLinqDeliveryContext],
      }),
    );
  });

  it("passes restored foreground assistant input ids through as fresh ids", async () => {
    const assistantInputIds = [
      "ain_00000000000000000000000000000001",
      "ain_00000000000000000000000000000002",
      "ain_00000000000000000000000000000003",
      "ain_00000000000000000000000000000004",
      "ain_00000000000000000000000000000005",
      "ain_00000000000000000000000000000006",
    ];

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds,
      importedCount: assistantInputIds.length,
    }));

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        freshAssistantInputIds: assistantInputIds,
      }),
    );
  });

  it("treats imported assistant input ids as fresh even when no new mailbox rows were imported", async () => {
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce(null);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: ["ain_00000000000000000000000000000007"],
      importedCount: 0,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        freshAssistantInputIds: ["ain_00000000000000000000000000000007"],
      }),
    );
  });

  it("does not treat system-only mailbox imports as foreground conversation input", async () => {
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      importedCount: 1,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        freshAssistantInputIds: [],
      }),
    );
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: true,
      messageVolumeReceiptPort: expect.any(Object),
      preferredIntentIds: [],
      vaultRoot: expect.any(String),
    });
  });

  it("continues through a manual runtime-control receipt so automation can schedule a wake", async () => {
    const nextWakeAt = "2026-04-27T00:45:00.000Z";
    const manualRuntimeItem = {
      ...createSystemMailboxItem(),
      itemId: "system_mailbox_item_runtime_manual",
      mailboxDedupeKey: "dedupe_system_mailbox_item_runtime_manual",
      routeAction: "apply-runtime-control-request" as const,
      wake: {
        eventId: "evt_runtime_manual_requested",
        kind: "runtime.manual-requested" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: manualRuntimeItem,
      itemId: "system_mailbox_item_runtime_manual",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: nextWakeAt,
        hostedAssistantProgressed: true,
        hostedSystemMailboxPrepared: 1,
      }),
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: manualRuntimeItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecorded: 1,
      }),
    }));
  });

  it("does not continue non-manual runtime-control receipts into assistant automation", async () => {
    const browserVaultRefreshItem = createBrowserVaultRefreshSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: browserVaultRefreshItem,
      itemId: "system_mailbox_item_browser_vault_refresh",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    await result.afterCheckpoint?.();

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalled();
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: browserVaultRefreshItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      browserVaultReplicaRefreshRequested: true,
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedBrowserVaultReplicaRefreshRequested: true,
        hostedSystemMailboxPrepared: 1,
      }),
    }));
  });

  it("records maintenance runtime-control receipts without assistant automation", async () => {
    const maintenanceItem = createMaintenanceSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: maintenanceItem,
      itemId: "system_mailbox_item_runtime_maintenance",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    await result.afterCheckpoint?.();

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: maintenanceItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).not.toHaveProperty("browserVaultReplicaRefreshRequested");
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxPrepared: 1,
      }),
    }));
    expect(result.redactedStatus).not.toHaveProperty("hostedBrowserVaultReplicaRefreshRequested");
  });

  it("reconciles bounded pending delivery effects without continuing assistant automation", async () => {
    const deliveryEffect = createDeliveryEffect();
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([deliveryEffect]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: true,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [pendingEffectsItem.wake.effectId],
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      progressed: true,
    }));

    await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [deliveryEffect],
        vaultRoot: "/tmp/murph-vault",
        wake: pendingEffectsItem.wake,
      }),
    );
  });

  it("drains a causal approval wake before simultaneously pending foreground input", async () => {
    let shouldYield = false;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYield);
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    const deliveryEffect = {
      ...createDeliveryEffect(),
      effectId: pendingEffectsItem.wake.effectId,
    };
    const preparation = {
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control" as const,
        redactedLogEntries: [],
      },
      status: "processed" as const,
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      shouldYield = true;
      return preparation;
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([deliveryEffect]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledTimes(1);
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: true,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [pendingEffectsItem.wake.effectId],
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      progressed: true,
    }));

    await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [deliveryEffect],
        shouldYieldBackgroundDelivery: null,
        vaultRoot: "/tmp/murph-vault",
        wake: pendingEffectsItem.wake,
      }),
    );
  });

  it("drains a causal approval wake already queued with foreground input before automation", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    const deliveryEffect = {
      ...createDeliveryEffect(),
      effectId: pendingEffectsItem.wake.effectId,
    };
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(now);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([deliveryEffect]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => now,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: [
          "apply-runtime-control-request",
          "continue-assistant-ask",
        ],
        allowedWakeKinds: [
          "runtime.pending-effects-reconcile-requested",
          "assistant.ask.completed",
        ],
      }),
    );
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: true,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [pendingEffectsItem.wake.effectId],
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      afterCheckpointKeepsForegroundImportLoop: true,
      checkpointReason: "outbox_sending",
      progressed: true,
    }));

    await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [deliveryEffect],
        shouldYieldBackgroundDelivery: null,
        vaultRoot: "/tmp/murph-vault",
        wake: pendingEffectsItem.wake,
      }),
    );
  });

  it("drains a completed assistant ask before later foreground input", async () => {
    const now = "2026-04-27T00:03:00.000Z";
    const pendingInputAt = "2026-04-27T00:02:30.000Z";
    const logRequests: HostedRuntimeLogRequest[] = [];
    const completionItem = createAssistantAskCompletionSystemMailboxItem();
    const deliveryEffect = createDeliveryEffect();
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(now);
    mocks.resolveHostedOldestAssistantInputOccurredAt.mockResolvedValue(pendingInputAt);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: completionItem,
      itemId: completionItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-ask-completion",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([deliveryEffect]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      logRequests,
      now: () => now,
      shouldYieldBackgroundMaintenance: () => true,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: [
          "apply-runtime-control-request",
          "continue-assistant-ask",
        ],
        allowedWakeKinds: [
          "runtime.pending-effects-reconcile-requested",
          "assistant.ask.completed",
        ],
        assistantAskCompletionOccurredBefore: pendingInputAt,
      }),
    );
    expect(mocks.resolveHostedOldestAssistantInputOccurredAt).toHaveBeenCalledWith({
      assistantInputIds: ["ain_00000000000000000000000000000001"],
      signal: null,
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.resolveHostedOldestPendingAssistantInputAt).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      afterCheckpointKeepsForegroundImportLoop: true,
      checkpointReason: "outbox_sending",
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantAskCompletionFirstAttemptDelayed: true,
      }),
    }));
    expect(logRequests.find((request) =>
      request.entries[0]?.eventCode === "mailbox.system_processed"
    )?.entries[0]).toEqual(expect.objectContaining({
      level: "warn",
      redactedJson: expect.objectContaining({
        assistantAskCompletionFirstAttemptDelayed: true,
      }),
    }));

    await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [deliveryEffect],
        shouldYieldBackgroundDelivery: null,
        vaultRoot: "/tmp/murph-vault",
        wake: completionItem.wake,
      }),
    );
  });

  it.each([
    {
      dedupeKey:
        "assistant.notification.requested:phone-call-result:phone_call_123",
      label: "phone-call result",
    },
    {
      dedupeKey:
        "assistant.notification.requested:usage-referral-reward:referral_123",
      label: "usage-referral reward",
    },
    {
      dedupeKey: "aask_done_private_completion",
      label: "legacy private Assistant Ask completion",
    },
    {
      dedupeKey: "aask_private_completion",
      label: "current private Assistant Ask completion",
    },
  ])("drains an exact $label through the causal-only fixed-route outbox once", async ({
    dedupeKey,
  }) => {
    const deferredUsageRecords: AssistantUsageRecord[] = [];
    const usageRecordPort: RuntimeUsageRecordPort = {
      recordUsage: vi.fn(async (record) => ({
        platformAiUsageAllowedAfter: true,
        recorded: true,
        usageId: record.usageId,
      })),
    };
    const completionItem = createExternalCompletionSystemMailboxItem({
      dedupeKey,
    });
    const deliveryEffect: HostedAssistantDeliverySideEffect = {
      ...createDeliveryEffect(),
      effectId: `effect_${completionItem.itemId}`,
      payload: {
        ...createDeliveryEffect().payload,
        channel: "linq",
        explicitTarget: "linq_source_thread",
        idempotencyKey: dedupeKey.replace(
          "assistant.notification.requested:",
          "",
        ),
        identityId: "hbidx:phone:v1:test",
        threadId: "linq_source_thread",
        threadIsDirect: false,
      },
    };
    const deliveryIntentId = `intent_${completionItem.itemId}`;
    mocks.prepareHostedSystemMailboxItemForCheckpoint
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async ({ executionContext }) => {
        await executionContext.hosted?.usageRecorder?.recordUsage(
          createAssistantUsageRecord(),
        );
        return {
          item: completionItem,
          itemId: completionItem.itemId,
          metrics: {
            bootstrapResult: null,
            conversationMetrics: null,
            deliveryIntentIds: [deliveryIntentId],
            mailboxLane: "assistant-notification",
            redactedLogEntries: [],
          },
          status: "processed",
        };
      });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "linq",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deliveryEffect.fingerprint,
        effectId: deliveryEffect.effectId,
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_completion_123",
        providerMessageIds: [],
        providerThreadId: "linq_source_thread",
        retryable: false,
        target: "linq_source_thread",
        targetKind: "explicit",
      },
    ]);

    const input = createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => "2026-04-27T00:03:00.000Z",
      requestAttemptId:
        "runtime-write-e2cfcf20-f792-4133-b40b-3f381b371dda",
      recordDeferredUsage: (record) => {
        deferredUsageRecords.push(record);
        return Promise.resolve();
      },
      runtimeIssueProvenance: {
        releaseSha: "0123456789abcdef0123456789abcdef01234567",
        runtimeName: "cloudflare-hosted-runner",
      },
      runtimeUsageRecordPort: usageRecordPort,
    });
    const result = await runHostedWorkspaceAssistantPhase(input);

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint)
      .toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          allowedMailboxDedupeKeyPrefixes: [
            "assistant.notification.requested:phone-call-result:",
            "assistant.notification.requested:usage-referral-reward:",
            "assistant.notification.requested:group-context-handoff:",
            "aask_done_",
            "aask_private_",
          ],
          allowedRouteActions: ["dispatch-assistant-notification"],
          allowedWakeKinds: ["assistant.notification.requested"],
          executionContext: {
            hosted: expect.objectContaining({
              memberId: "member_synthetic_phase",
              releaseSha: "0123456789abcdef0123456789abcdef01234567",
              runtimeAttemptId:
                "runtime-write-e2cfcf20-f792-4133-b40b-3f381b371dda",
              runtimeName: "cloudflare-hosted-runner",
              usageRecorder: {
                recordUsage: expect.any(Function),
              },
              userEnvKeys: [],
            }),
          },
        }),
      );
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [],
      preferredIntentIds: [deliveryIntentId],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      progressed: true,
    }));
    expect(deferredUsageRecords).toEqual([
      expect.objectContaining({
        usageId: "turn_direct_usage.attempt-1",
      }),
    ]);
    expect(usageRecordPort.recordUsage).not.toHaveBeenCalled();

    await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [expect.objectContaining({
          effectId: deliveryEffect.effectId,
          payload: expect.objectContaining({
            explicitTarget: "linq_source_thread",
            threadId: "linq_source_thread",
          }),
        })],
        shouldYieldBackgroundDelivery: null,
        wake: completionItem.wake,
      }),
    );

    const replay = await runHostedWorkspaceAssistantPhase(input);
    expect(replay.progressed).toBe(false);
    expect(deferredUsageRecords).toHaveLength(1);
    expect(usageRecordPort.recordUsage).not.toHaveBeenCalled();
    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledTimes(1);
  });

  it("leaves an exact phone-call result queued behind pending assistant input", async () => {
    const pendingInputAt = "2026-09-01T15:02:00.000Z";
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(
      pendingInputAt,
    );
    mocks.resolveHostedOldestPendingAssistantInputAt.mockResolvedValue(
      pendingInputAt,
    );
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValue(null);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 2,
      now: () => "2026-09-01T15:03:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalledWith(
      expect.objectContaining({
        allowedMailboxDedupeKeyPrefixes: expect.arrayContaining([
          "assistant.notification.requested:phone-call-result:",
        ]),
      }),
    );
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalled();
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      progressed: false,
    }));
  });

  it.each([
    {
      dedupeKey:
        "assistant.notification.requested:phone-call-result:phone_call_telegram:generation:1",
      label: "generation-scoped phone-call result",
    },
    {
      dedupeKey:
        "assistant.notification.requested:phone-call-result:phone_call_manual_telegram",
      label: "generationless manual phone-call result",
    },
    {
      dedupeKey:
        "assistant.notification.requested:usage-referral-reward:referral_telegram",
      label: "usage-referral reward",
    },
  ])("keeps an exact Telegram $label in the ordinary background drain", async ({
    dedupeKey,
  }) => {
    const now = "2026-04-27T00:03:00.000Z";
    const completionItem = createExternalCompletionSystemMailboxItem({
      dedupeKey,
    });
    const baseDeliveryEffect = createDeliveryEffect();
    const deliveryEffect: HostedAssistantDeliverySideEffect = {
      ...baseDeliveryEffect,
      effectId: `effect_${completionItem.itemId}`,
      payload: {
        ...baseDeliveryEffect.payload,
        channel: "telegram",
        explicitTarget: "telegram_source_thread",
        idempotencyKey: dedupeKey.replace(
          "assistant.notification.requested:",
          "",
        ),
        identityId: "telegram-bot",
        threadId: "telegram_source_thread",
        threadIsDirect: false,
        transportIdempotent: false,
      },
    };
    const deliveryIntentId = `intent_${completionItem.itemId}`;
    mocks.prepareHostedSystemMailboxItemForCheckpoint
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        item: completionItem,
        itemId: completionItem.itemId,
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          deliveryIntentIds: [deliveryIntentId],
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(now);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [],
      preferredIntentIds: [deliveryIntentId],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.resolveHostedAssistantOutboxNextWakeAt).toHaveBeenCalledWith({
      vaultRoot: "/tmp/murph-vault",
    });
    expect(
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch,
    ).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: now,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedOutboxPendingDeliveryEffects: 1,
      }),
    }));
    expect(result.afterCheckpointKeepsForegroundImportLoop).toBeUndefined();

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: now,
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
    }));
  });

  it("keeps managed setup out of a causal-only exact delivery pass", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    const deliveryEffect = {
      ...createDeliveryEffect(),
      effectId: pendingEffectsItem.wake.effectId,
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([deliveryEffect]);
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 0,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
      shouldYieldBackgroundMaintenance: () => true,
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith(
      {
        actionApprovalPort: null,
        includeBackgroundDueIntents: false,
        messageVolumeReceiptPort: expect.any(Object),
        preferredEffectIds: [pendingEffectsItem.wake.effectId],
        preferredIntentIds: [],
        vaultRoot: "/tmp/murph-vault",
      },
    );
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.hydrateHostedExecutionDefaultTarget).not.toHaveBeenCalled();
    expect(mocks.resolveHostedPendingAssistantInputWakeAt).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.prepareHostedProviderCleanupPlan).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      progressed: true,
    }));
  });

  it("does not check external completions while assistant input is pending", async () => {
    const now = "2026-04-27T00:03:00.000Z";
    const armedWakeAt = "2026-04-27T00:08:00.000Z";
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(now);
    mocks.resolveHostedOldestPendingAssistantInputAt.mockResolvedValue(null);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValue(null);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
      workspace: createDueAssistantWorkspace({
        nextWakeAt: armedWakeAt,
      }),
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: [
          "apply-runtime-control-request",
          "apply-member-action",
        ],
        allowedWakeKinds: [
          "runtime.pending-effects-reconcile-requested",
          "member.action.requested",
        ],
      }),
    );
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: ["continue-assistant-ask"],
        allowedWakeKinds: ["assistant.ask.completed"],
        assistantAskCompletionOccurredBefore: null,
      }),
    );
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalledWith(
      expect.objectContaining({
        allowedMailboxDedupeKeyPrefixes: expect.arrayContaining([
          "assistant.notification.requested:phone-call-result:",
        ]),
      }),
    );
    expect(mocks.resolveHostedPendingAssistantInputWakeAt).toHaveBeenCalledWith({
      inspectOnly: true,
      now: expect.any(Function),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.resolveHostedOldestPendingAssistantInputAt).toHaveBeenCalledWith({
      signal: null,
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.resolveHostedOldestAssistantInputOccurredAt).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: armedWakeAt,
      progressed: false,
    }));
  });

  it("drains a causal-only assistant ask completion when no private input is pending", async () => {
    const now = "2026-04-27T00:03:00.000Z";
    const completionItem = createAssistantAskCompletionSystemMailboxItem();
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(null);
    mocks.prepareHostedSystemMailboxItemForCheckpoint
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        item: completionItem,
        itemId: completionItem.itemId,
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-ask-completion",
          redactedLogEntries: [],
        },
        status: "processed",
      });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        allowedRouteActions: ["continue-assistant-ask"],
        allowedWakeKinds: ["assistant.ask.completed"],
      }),
    );
    expect(
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.calls[1]?.[0],
    ).not.toHaveProperty("assistantAskCompletionOccurredBefore");
    expect(mocks.resolveHostedOldestPendingAssistantInputAt).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
    }));
  });

  it("keeps due cron work out of a causal-only zero-effect pass", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.getAssistantCronStatus.mockResolvedValue({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: now,
      runningJobs: 0,
      totalJobs: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
      shouldYieldBackgroundMaintenance: () => true,
      workspace: createDueAssistantWorkspace({
        nextWakeAt: now,
      }),
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [pendingEffectsItem.wake.effectId],
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.prepareHostedProviderCleanupPlan).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
    }));
  });

  it("preserves an armed workspace wake through a causal-only system mailbox checkpoint", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const armedWakeAt = "2026-04-27T00:05:00.000Z";
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
      shouldYieldBackgroundMaintenance: () => true,
      workspace: createDueAssistantWorkspace({
        nextWakeAt: armedWakeAt,
      }),
    }));

    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: armedWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: armedWakeAt,
      nextWakeReason: "assistant",
    }));
  });

  it("selects the exact approval ahead of an older local wake and due cron work", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-causal-approval-"));
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    const effectId = "vault-file-send:effect_causal_exact";

    try {
      await initializeVault({ createdAt: now, vaultRoot });
      const systemMailbox = await loadHostedSystemMailboxRealImplementation();
      const unrelatedWake = buildHostedExecutionRuntimeControlWake({
        eventId: "evt_runtime_manual_causal_exact",
        kind: "runtime.manual-requested",
        occurredAt: "2026-04-26T23:59:00.000Z",
        userId: "member_synthetic_phase",
      });
      const approvalWake = buildHostedExecutionPendingEffectsReconcileRequestedWake({
        effectId,
        eventId: "evt_runtime_pending_effects_causal_exact",
        occurredAt: now,
        userId: "member_synthetic_phase",
      });
      for (const wake of [unrelatedWake, approvalWake]) {
        const outcome = await systemMailbox.enqueueHostedSystemMailboxItem({
          item: createResolvedForegroundAdmissionMailboxItem({
            kind: wake.kind,
            occurredAt: wake.occurredAt,
          }),
          vaultRoot,
          wake,
        });
        expect(outcome.status).toBe("imported");
      }

      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
        systemMailbox.prepareHostedSystemMailboxItemForCheckpoint,
      );
      mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementation(
        systemMailbox.recordHostedSystemMailboxItemAfterCheckpoint,
      );
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId,
      };
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([deliveryEffect]);
      mocks.getAssistantCronStatus.mockResolvedValue({
        dueJobs: 1,
        enabledJobs: 1,
        nextRunAt: now,
        runningJobs: 0,
        totalJobs: 1,
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [],
        foregroundCausalOnly: true,
        conversationImportedCount: 0,
        importedCount: 1,
        now: () => now,
        operatorHomeRoot,
        shouldYieldBackgroundMaintenance: () => true,
        vaultRoot,
        workspace: createDueAssistantWorkspace({ nextWakeAt: now }),
      }));

      expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedRouteActions: [
            "apply-runtime-control-request",
            "apply-member-action",
          ],
          allowedWakeKinds: [
            "runtime.pending-effects-reconcile-requested",
            "member.action.requested",
          ],
        }),
      );
      expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
        actionApprovalPort: null,
        includeBackgroundDueIntents: false,
        messageVolumeReceiptPort: expect.any(Object),
        preferredEffectIds: [effectId],
        preferredIntentIds: [],
        vaultRoot,
      });
      expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
      expect(mocks.createHostedAssistantChannelTypingDependencies).not.toHaveBeenCalled();
      expect(mocks.createHostedAssistantProgressDeliveryDependencies).not.toHaveBeenCalled();
      expect(mocks.hydrateHostedExecutionDefaultTarget).not.toHaveBeenCalled();
      expect(mocks.resolveHostedPendingAssistantInputWakeAt).not.toHaveBeenCalled();
      expect(mocks.resolveHostedSystemMailboxNextWakeCandidate).not.toHaveBeenCalled();
      expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      expect(mocks.prepareHostedProviderCleanupPlan).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_sending",
        progressed: true,
      }));

      await result.afterCheckpoint?.();

      const mailboxState = await readHostedSystemMailboxState(vaultRoot);
      expect(mailboxState.pending).toEqual([
        expect.objectContaining({
          wake: expect.objectContaining({
            kind: "runtime.manual-requested",
          }),
        }),
      ]);
      expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantDeliveryEffects: [deliveryEffect],
          shouldYieldBackgroundDelivery: null,
          wake: approvalWake,
        }),
      );
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("selects a post-checkpoint causal approval before an older device wake", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), "hosted-causal-after-checkpoint-"),
    );
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    const effectId = "vault-file-send:effect_causal_after_checkpoint";

    try {
      await initializeVault({ createdAt: now, vaultRoot });
      const systemMailbox = await loadHostedSystemMailboxRealImplementation();
      const deviceWake = {
        eventId: "evt_device_sync_before_causal_after_checkpoint",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-26T23:59:00.000Z",
        reason: "connected" as const,
        userId: "member_synthetic_phase",
      };
      const approvalWake = buildHostedExecutionPendingEffectsReconcileRequestedWake({
        effectId,
        eventId: "evt_pending_effects_causal_after_checkpoint",
        occurredAt: now,
        userId: "member_synthetic_phase",
      });
      for (const admission of [
        {
          item: createResolvedForegroundAdmissionMailboxItem({
            kind: deviceWake.kind,
            laneSeq: "1",
            occurredAt: deviceWake.occurredAt,
            routeAction: "run-device-sync-wake",
          }),
          wake: deviceWake,
        },
        {
          item: createResolvedForegroundAdmissionMailboxItem({
            kind: approvalWake.kind,
            laneSeq: "2",
            occurredAt: approvalWake.occurredAt,
          }),
          wake: approvalWake,
        },
      ]) {
        const outcome = await systemMailbox.enqueueHostedSystemMailboxItem({
          ...admission,
          vaultRoot,
        });
        expect(outcome.status).toBe("imported");
      }

      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
        systemMailbox.prepareHostedSystemMailboxItemForCheckpoint,
      );
      mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementation(
        systemMailbox.recordHostedSystemMailboxItemAfterCheckpoint,
      );
      mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(
        systemMailbox.resolveHostedSystemMailboxNextWakeCandidate,
      );
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId,
      };
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [],
        conversationImportedCount: 0,
        importedCount: 2,
        now: () => now,
        operatorHomeRoot,
        vaultRoot,
      }));

      expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
      expect(mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.calls[0]?.[0])
        .not.toHaveProperty("allowedRouteActions");
      expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
        actionApprovalPort: null,
        includeBackgroundDueIntents: true,
        messageVolumeReceiptPort: expect.any(Object),
        preferredEffectIds: [effectId],
        preferredIntentIds: [],
        vaultRoot,
      });
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_sending",
        progressed: true,
      }));

      const postCheckpoint = await result.afterCheckpoint?.();

      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeReason: "device-sync.reconcile",
      }));
      expect(await readHostedSystemMailboxState(vaultRoot)).toEqual({
        pending: [
          expect.objectContaining({
            attemptCount: 0,
            itemId: expect.stringContaining("device-sync_wake"),
            status: "pending",
            wake: deviceWake,
          }),
        ],
      });
      expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantDeliveryEffects: [deliveryEffect],
          shouldYieldBackgroundDelivery: null,
          wake: approvalWake,
        }),
      );
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it(
    "hands oldest model-free device maintenance to its owner after causal work",
    async () => {
      const now = "2026-04-27T00:00:00.000Z";
      const parentRoot = await mkdtemp(
        path.join(tmpdir(), "hosted-causal-fallback-"),
      );
      const operatorHomeRoot = path.join(parentRoot, "home");
      const vaultRoot = path.join(parentRoot, "vault");

      try {
        await initializeVault({ createdAt: now, vaultRoot });
        const systemMailbox = await loadHostedSystemMailboxRealImplementation();
        const deviceWake = {
          eventId: "evt_device_sync_causal_fallback",
          kind: "device-sync.wake" as const,
          occurredAt: "2026-04-26T23:59:00.000Z",
          reason: "connected" as const,
          userId: "member_synthetic_phase",
        };
        const outcome = await systemMailbox.enqueueHostedSystemMailboxItem({
          item: createResolvedForegroundAdmissionMailboxItem({
            kind: deviceWake.kind,
            occurredAt: deviceWake.occurredAt,
            routeAction: "run-device-sync-wake",
          }),
          vaultRoot,
          wake: deviceWake,
        });
        expect(outcome.status).toBe("imported");

        mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
          systemMailbox.prepareHostedSystemMailboxItemForCheckpoint,
        );
        mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementation(
          systemMailbox.recordHostedSystemMailboxItemAfterCheckpoint,
        );
        mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(
          systemMailbox.resolveHostedSystemMailboxNextWakeCandidate,
        );

        const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
          assistantInputIds: [],
          conversationImportedCount: 0,
          importedCount: 1,
          now: () => now,
          operatorHomeRoot,
          vaultRoot,
        }));

        expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
        expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({
          nextWakeAt: now,
          nextWakeReason: "device-sync.reconcile",
          progressed: false,
        }));

        await result.afterCheckpoint?.();

        expect(await readHostedSystemMailboxState(vaultRoot)).toEqual({
          pending: [expect.objectContaining({
            itemId: expect.stringContaining("device"),
            status: "pending",
          })],
        });
      } finally {
        await rm(parentRoot, { force: true, recursive: true });
      }
    },
  );

  it("drains approved continuations before handing device maintenance to its owner", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), "hosted-durable-approval-priority-"),
    );
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    const effectIds = [
      "vault-file-send:effect_durable_approval_a",
      "vault-file-send:effect_durable_approval_b",
    ];
    const codexRetryAt = "2026-04-27T00:01:00.000Z";
    const events: string[] = [];

    try {
      await initializeVault({ createdAt: now, vaultRoot });
      const systemMailbox = await loadHostedSystemMailboxRealImplementation();
      const deviceWake = {
        eventId: "evt_device_sync_before_durable_approvals",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-26T23:59:00.000Z",
        reason: "connected" as const,
        userId: "member_synthetic_phase",
      };
      const approvalWakes = effectIds.map((effectId, index) =>
        buildHostedExecutionPendingEffectsReconcileRequestedWake({
          effectId,
          eventId: `evt_pending_effects_durable_approval_${index + 1}`,
          occurredAt: now,
          userId: "member_synthetic_phase",
        })
      );
      const admissions = [
        {
          item: createResolvedForegroundAdmissionMailboxItem({
            idSuffix: "durable_device",
            kind: deviceWake.kind,
            laneSeq: "2",
            occurredAt: deviceWake.occurredAt,
            routeAction: "run-device-sync-wake",
          }),
          wake: deviceWake,
        },
        ...approvalWakes.map((wake, index) => ({
          item: createResolvedForegroundAdmissionMailboxItem({
            idSuffix: `durable_approval_${index + 1}`,
            kind: wake.kind,
            laneSeq: String(index + 3),
            occurredAt: wake.occurredAt,
          }),
          wake,
        })),
      ];
      for (const admission of admissions) {
        expect(await systemMailbox.enqueueHostedSystemMailboxItem({
          ...admission,
          vaultRoot,
        })).toEqual(expect.objectContaining({ status: "imported" }));
      }
      const codexRetryItem = {
        ...createCodexAuthSystemMailboxItem(),
        attemptCount: 1,
        lastAttemptAt: now,
        lastErrorCode: "codex_auth_update_failed",
        lastErrorMessage: "redacted",
        mailboxLaneSeq: "1",
        nextAttemptAt: codexRetryAt,
        status: "recording" as const,
      };
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: [codexRetryItem, ...state.pending],
      }));

      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
        systemMailbox.prepareHostedSystemMailboxItemForCheckpoint,
      );
      mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementation(
        systemMailbox.recordHostedSystemMailboxItemAfterCheckpoint,
      );
      mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(
        systemMailbox.resolveHostedSystemMailboxNextWakeCandidate,
      );
      for (const effectId of effectIds) {
        mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([{
          ...createDeliveryEffect(),
          effectId,
        }]);
      }
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementation(async (input) => {
        for (const effect of input.assistantDeliveryEffects) {
          events.push(`delivery:${effect.effectId}`);
        }
        return [];
      });
      mocks.runHostedDeviceSyncWakeLane.mockImplementation(async () => {
        events.push("device-sync");
        return {
          deviceSyncProcessed: 1,
          deviceSyncSkipped: false,
          nextWakeAt: null,
          parserProcessed: 0,
          postCheckpointRecord: null,
        };
      });

      let workspace = createDueAssistantWorkspace({
        nextWakeAt: now,
        nextWakeReason: "device-sync.reconcile",
      });

      for (const [index, effectId] of effectIds.entries()) {
        const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
          assistantInputIds: [],
          conversationImportedCount: 0,
          importedCount: 0,
          now: () => now,
          operatorHomeRoot,
          resolvedDeviceSync: {
            providerConfigs: {
              whoop: {
                clientId: "synthetic-whoop-client",
                clientSecret: "synthetic-whoop-secret",
              },
            },
            publicBaseUrl: "https://device-sync.example.test",
            secret: "synthetic-device-sync-secret",
          },
          vaultRoot,
          workspace,
        }));

        expect(mocks.collectHostedAssistantDeliverySideEffects)
          .toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
            preferredEffectIds: [effectId],
          }));
        expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({
          checkpointReason: "outbox_sending",
          progressed: true,
        }));
        const postCheckpoint = await result.afterCheckpoint?.();
        expect(postCheckpoint).toEqual(expect.objectContaining({
          nextWakeAt: now,
          nextWakeReason: index === 0 ? "assistant" : "device-sync.reconcile",
        }));
        workspace = createDueAssistantWorkspace({
          nextWakeAt: postCheckpoint?.nextWakeAt ?? now,
          nextWakeReason: postCheckpoint?.nextWakeReason ?? null,
        });
      }

      expect(await readHostedSystemMailboxState(vaultRoot)).toEqual({
        pending: [
          expect.objectContaining({
            itemId: codexRetryItem.itemId,
            nextAttemptAt: codexRetryAt,
            status: "recording",
          }),
          expect.objectContaining({
            itemId: expect.stringContaining("durable_device"),
            status: "pending",
            wake: deviceWake,
          }),
        ],
      });
      expect(events).toEqual(effectIds.map((effectId) => `delivery:${effectId}`));

      const deviceResult = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [],
        conversationImportedCount: 0,
        importedCount: 0,
        now: () => now,
        operatorHomeRoot,
        resolvedDeviceSync: {
          providerConfigs: {
            whoop: {
              clientId: "synthetic-whoop-client",
              clientSecret: "synthetic-whoop-secret",
            },
          },
          publicBaseUrl: "https://device-sync.example.test",
          secret: "synthetic-device-sync-secret",
        },
        vaultRoot,
        workspace,
      }));

      expect(events).toEqual([
        ...effectIds.map((effectId) => `delivery:${effectId}`),
      ]);
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      expect(deviceResult).toEqual(expect.objectContaining({
        nextWakeAt: now,
        nextWakeReason: "device-sync.reconcile",
        progressed: false,
      }));
      await deviceResult.afterCheckpoint?.();
      expect((await readHostedSystemMailboxState(vaultRoot)).pending).toEqual([
        expect.objectContaining({
          itemId: codexRetryItem.itemId,
          nextAttemptAt: codexRetryAt,
          status: "recording",
        }),
        expect.objectContaining({
          itemId: expect.stringContaining("durable_device"),
          status: "pending",
          wake: deviceWake,
        }),
      ]);
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
      vi.useRealTimers();
    }
  });

  it("does not treat an older Assistant Ask completion as an approved continuation", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), "hosted-approval-only-priority-"),
    );
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    const effectId = "vault-file-send:effect_approval_only_priority";

    try {
      await initializeVault({ createdAt: now, vaultRoot });
      const systemMailbox = await loadHostedSystemMailboxRealImplementation();
      const deviceWake = {
        eventId: "evt_device_sync_before_approval_only",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-26T23:57:00.000Z",
        reason: "connected" as const,
        userId: "member_synthetic_phase",
      };
      const assistantAskWake = {
        ask: {
          expiresAt: "2026-04-27T00:10:00.000Z",
          originAssistantInputId: "ain_0123456789abcdef0123456789abcdef",
          originSessionId: "asst_approval_only_origin",
          question: "Is the synthetic result ready?",
          requestId: "aask_req_approval_only",
          result: {
            answer: "The synthetic result is ready.",
            outcome: "answered" as const,
          },
          targetLabel: "Synthetic target",
        },
        eventId: "aask_done_approval_only",
        kind: "assistant.ask.completed" as const,
        occurredAt: "2026-04-26T23:58:00.000Z",
        userId: "member_synthetic_phase",
      };
      const approvalWake = buildHostedExecutionPendingEffectsReconcileRequestedWake({
        effectId,
        eventId: "evt_pending_effects_approval_only",
        occurredAt: now,
        userId: "member_synthetic_phase",
      });
      for (const admission of [
        {
          item: createResolvedForegroundAdmissionMailboxItem({
            idSuffix: "approval_only_device",
            kind: deviceWake.kind,
            laneSeq: "1",
            occurredAt: deviceWake.occurredAt,
            routeAction: "run-device-sync-wake",
          }),
          wake: deviceWake,
        },
        {
          item: createResolvedForegroundAdmissionMailboxItem({
            idSuffix: "approval_only_assistant_ask",
            kind: assistantAskWake.kind,
            laneSeq: "2",
            occurredAt: assistantAskWake.occurredAt,
            routeAction: "continue-assistant-ask",
          }),
          wake: assistantAskWake,
        },
        {
          item: createResolvedForegroundAdmissionMailboxItem({
            idSuffix: "approval_only_target",
            kind: approvalWake.kind,
            laneSeq: "3",
            occurredAt: approvalWake.occurredAt,
          }),
          wake: approvalWake,
        },
      ]) {
        expect(await systemMailbox.enqueueHostedSystemMailboxItem({
          ...admission,
          vaultRoot,
        })).toEqual(expect.objectContaining({ status: "imported" }));
      }

      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
        systemMailbox.prepareHostedSystemMailboxItemForCheckpoint,
      );
      mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementation(
        systemMailbox.recordHostedSystemMailboxItemAfterCheckpoint,
      );
      mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(
        systemMailbox.resolveHostedSystemMailboxNextWakeCandidate,
      );
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId,
      };
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([deliveryEffect]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [],
        conversationImportedCount: 0,
        importedCount: 3,
        now: () => now,
        operatorHomeRoot,
        vaultRoot,
      }));

      expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith(
        expect.objectContaining({ preferredEffectIds: [effectId] }),
      );
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      await result.afterCheckpoint?.();

      expect((await readHostedSystemMailboxState(vaultRoot)).pending).toEqual([
        expect.objectContaining({
          itemId: expect.stringContaining("approval_only_device"),
          status: "pending",
          wake: deviceWake,
        }),
        expect.objectContaining({
          itemId: expect.stringContaining("approval_only_assistant_ask"),
          status: "pending",
          wake: assistantAskWake,
        }),
      ]);
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("keeps a due workspace wake armed through a causal-only exact delivery post-checkpoint", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-causal-due-wake-"));
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    const effectId = "vault-file-send:effect_causal_due_wake";

    try {
      await initializeVault({ createdAt: now, vaultRoot });
      const systemMailbox = await loadHostedSystemMailboxRealImplementation();
      const approvalWake = buildHostedExecutionPendingEffectsReconcileRequestedWake({
        effectId,
        eventId: "evt_runtime_pending_effects_causal_due_wake",
        occurredAt: now,
        userId: "member_synthetic_phase",
      });
      const outcome = await systemMailbox.enqueueHostedSystemMailboxItem({
        item: createResolvedForegroundAdmissionMailboxItem({
          kind: approvalWake.kind,
          occurredAt: approvalWake.occurredAt,
        }),
        vaultRoot,
        wake: approvalWake,
      });
      expect(outcome.status).toBe("imported");

      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
        systemMailbox.prepareHostedSystemMailboxItemForCheckpoint,
      );
      mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementation(
        systemMailbox.recordHostedSystemMailboxItemAfterCheckpoint,
      );
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId,
      };
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([deliveryEffect]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [],
        foregroundCausalOnly: true,
        conversationImportedCount: 0,
        importedCount: 1,
        now: () => now,
        operatorHomeRoot,
        shouldYieldBackgroundMaintenance: () => true,
        vaultRoot,
        workspace: createDueAssistantWorkspace({ nextWakeAt: now }),
      }));

      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_sending",
        progressed: true,
      }));

      const postCheckpoint = await result.afterCheckpoint?.();
      expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
      expect(postCheckpoint).toEqual(expect.objectContaining({
        nextWakeAt: now,
      }));
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("terminates a causal-only approval pass when its exact effect is no longer deliverable", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(now);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      foregroundCausalOnly: true,
      importedCount: 1,
      now: () => now,
      shouldYieldBackgroundMaintenance: () => true,
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [pendingEffectsItem.wake.effectId],
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.prepareHostedProviderCleanupPlan).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
    }));

    await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: pendingEffectsItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
  });

  it("keeps a future causal approval wake behind foreground input at pass admission", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(now);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => now,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: [
          "apply-runtime-control-request",
          "continue-assistant-ask",
        ],
        allowedWakeKinds: [
          "runtime.pending-effects-reconcile-requested",
          "assistant.ask.completed",
        ],
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
  });

  it("keeps unrelated system wakes behind foreground input at pass admission", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(now);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => now,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: [
          "apply-runtime-control-request",
          "continue-assistant-ask",
        ],
        allowedWakeKinds: [
          "runtime.pending-effects-reconcile-requested",
          "assistant.ask.completed",
        ],
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
  });

  it("drains a real exact approval wake ahead of its real pending conversation input", async () => {
    const scenario = await runRealForegroundApprovalAdmissionScenario({
      deliveryEffect: true,
      wake: "due-exact",
    });

    try {
      expect(scenario.pendingInputIds).toEqual([scenario.inputId]);
      expect(scenario.pendingInputIdsAfterRun).toEqual([scenario.inputId]);
      expect(scenario.pendingInputIdsAfterRun).not.toContain(scenario.oldInputId);
      expect(scenario.pendingIndexInspectionAfterRun).toEqual({
        hasCandidate: true,
        indexComplete: false,
      });
      expect(scenario.pendingWakeReads).toEqual([]);
      expect(scenario.pendingIndexStateAfterRun).toBe(scenario.pendingIndexStateBeforeRun);
      expect(scenario.systemMailboxPreparationStatuses[0]).toBe("processed");
      expect(mocks.hasCompleteAssistantAutoReplyTerminalEvidence).toHaveBeenCalledWith({
        captureId: null,
        inputId: scenario.inputId,
        vault: scenario.vaultRoot,
      });
      expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
        actionApprovalPort: null,
        includeBackgroundDueIntents: false,
        messageVolumeReceiptPort: expect.any(Object),
        preferredEffectIds: [scenario.effectId],
        preferredIntentIds: [],
        vaultRoot: scenario.vaultRoot,
      });
      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(scenario.result).toEqual(expect.objectContaining({
        afterCheckpointKeepsForegroundImportLoop: true,
        checkpointReason: "outbox_sending",
        progressed: true,
      }));
    } finally {
      await scenario.cleanup();
    }
  });

  it("ends a real causal-only pass when the exact wake has no effect", async () => {
    const scenario = await runRealForegroundApprovalAdmissionScenario({
      deliveryEffect: false,
      wake: "due-exact",
    });

    try {
      expect(scenario.pendingInputIds).toEqual([scenario.inputId]);
      expect(scenario.pendingInputIdsAfterRun).toEqual([scenario.inputId]);
      expect(scenario.pendingInputIdsAfterRun).not.toContain(scenario.oldInputId);
      expect(scenario.pendingIndexInspectionAfterRun).toEqual({
        hasCandidate: true,
        indexComplete: false,
      });
      expect(scenario.pendingWakeReads).toEqual([]);
      expect(scenario.pendingIndexStateAfterRun).toBe(scenario.pendingIndexStateBeforeRun);
      expect(scenario.systemMailboxPreparationStatuses[0]).toBe("processed");
      expect(mocks.hasCompleteAssistantAutoReplyTerminalEvidence).toHaveBeenCalledWith({
        captureId: null,
        inputId: scenario.inputId,
        vault: scenario.vaultRoot,
      });
      expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith(
        expect.objectContaining({
          preferredEffectIds: [scenario.effectId],
          vaultRoot: scenario.vaultRoot,
        }),
      );
      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(scenario.result).toEqual(expect.objectContaining({
        checkpointReason: "system_mailbox_receipt",
        progressed: true,
      }));
    } finally {
      await scenario.cleanup();
    }
  });

  it("keeps a real future exact wake behind real pending conversation input", async () => {
    const scenario = await runRealForegroundApprovalAdmissionScenario({
      deliveryEffect: false,
      wake: "future-exact",
    });

    try {
      expect(scenario.pendingInputIdsAfterRun).toEqual([scenario.inputId]);
      expect(scenario.pendingIndexInspectionAfterRun.indexComplete).toBe(false);
      expect(mocks.hasCompleteAssistantAutoReplyTerminalEvidence).toHaveBeenCalledWith({
        captureId: null,
        inputId: scenario.inputId,
        vault: scenario.vaultRoot,
      });
      expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
        expect.objectContaining({
          includeBackgroundDueIntents: true,
          preferredEffectIds: [scenario.effectId],
        }),
      );
      expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
        expect.objectContaining({
          freshAssistantInputIds: [scenario.inputId],
        }),
      );
      expect(scenario.systemMailboxState.pending).toEqual([
        expect.objectContaining({
          wake: expect.objectContaining({
            effectId: scenario.effectId,
            kind: "runtime.pending-effects-reconcile-requested",
          }),
        }),
      ]);
    } finally {
      await scenario.cleanup();
    }
  });

  it("keeps a real unrelated wake behind real pending conversation input", async () => {
    const scenario = await runRealForegroundApprovalAdmissionScenario({
      deliveryEffect: false,
      wake: "due-unrelated",
    });

    try {
      expect(scenario.pendingInputIdsAfterRun).toEqual([scenario.inputId]);
      expect(scenario.pendingIndexInspectionAfterRun.indexComplete).toBe(false);
      expect(mocks.hasCompleteAssistantAutoReplyTerminalEvidence).toHaveBeenCalledWith({
        captureId: null,
        inputId: scenario.inputId,
        vault: scenario.vaultRoot,
      });
      expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
        expect.objectContaining({
          includeBackgroundDueIntents: true,
          preferredEffectIds: [scenario.effectId],
        }),
      );
      expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
        expect.objectContaining({
          freshAssistantInputIds: [scenario.inputId],
        }),
      );
      expect(scenario.systemMailboxState.pending).toEqual([
        expect.objectContaining({
          wake: expect.objectContaining({
            kind: "runtime.manual-requested",
          }),
        }),
      ]);
    } finally {
      await scenario.cleanup();
    }
  });

  it("defers Codex auth terminal receipts until after the durable checkpoint", async () => {
    const codexAuthItem = createCodexAuthSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: codexAuthItem,
      itemId: "system_mailbox_item_codex_auth",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      afterDurableCheckpoint: expect.any(Array),
      checkpointReason: "system_mailbox_receipt",
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecordDeferred: true,
        hostedSystemMailboxRecorded: 0,
      }),
    }));

    const effects = postCheckpoint?.afterDurableCheckpoint;
    const effect = typeof effects === "function" ? effects : effects?.[0];
    if (!effect) {
      throw new Error("Expected deferred Codex auth durable checkpoint effect.");
    }
    await expect(effect()).resolves.toEqual({
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      nextWakeReason: "assistant",
      requiresFollowUpCheckpoint: true,
    });
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: codexAuthItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("defers vault-share projection work until after the durable checkpoint", async () => {
    const vaultShareItem = createVaultShareProjectionSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: vaultShareItem,
      itemId: vaultShareItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      afterDurableCheckpoint: expect.any(Array),
      checkpointReason: "system_mailbox_receipt",
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecordDeferred: true,
      }),
    }));

    const effects = postCheckpoint?.afterDurableCheckpoint;
    const effect = typeof effects === "function" ? effects : effects?.[0];
    if (!effect) {
      throw new Error("Expected deferred vault-share projection effect.");
    }
    expect(effect.requiresVaultShareProjectionResult).toBe(true);
    await effect({
      vaultShareProjectionResult: { outcome: "delivered" },
    });
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: vaultShareItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultShareProjectionResult: { outcome: "delivered" },
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("does not discover terminal Linq cleanup for foreground assistant input ids", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: ["ain_00000000000000000000000000000007"],
      importedCount: 0,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result.checkpointReason).not.toBe("provider_cleanup");
  });

  it("collects only current-turn delivery effects on foreground conversation input", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: ["intent_fresh"],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredIntentIds: ["intent_fresh"],
      vaultRoot: expect.any(String),
    });
  });

  it("runs one requested member action after the current foreground reply", async () => {
    const sequence: string[] = [];
    let newerForegroundInputArrived = false;
    const deliveryEffect = createDeliveryEffect();
    const memberActionItem = createMemberActionSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
      async (preparationInput) => {
        if (
          preparationInput.allowedRouteActions?.includes("apply-member-action")
          && preparationInput.allowedWakeKinds?.includes("member.action.requested")
        ) {
          sequence.push("member-action");
          return {
            item: memberActionItem,
            itemId: memberActionItem.itemId,
            metrics: {
              bootstrapResult: null,
              conversationMetrics: null,
              mailboxLane: "member-action" as const,
              postCheckpointRecord: memberActionItem.postCheckpointRecord,
              redactedLogEntries: [],
            },
            status: "processed" as const,
          };
        }
        return null;
      },
    );
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      sequence.push("provider");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [deliveryEffect.effectId],
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 0,
        postCheckpointRecord: null,
        progressed: true,
        redactedLogEntries: [],
      };
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
      sequence.push("foreground-delivery");
      newerForegroundInputArrived = true;
      return [createSentDeliveryOutcome()];
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      shouldYieldBackgroundMaintenance: () => newerForegroundInputArrived,
    }));

    expect(sequence).toEqual(["provider", "foreground-delivery"]);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(sequence).toEqual([
      "provider",
      "foreground-delivery",
      "member-action",
    ]);
    expect(
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.calls.at(-1)?.[0],
    ).toEqual(expect.objectContaining({
      allowedRouteActions: [
        "apply-member-activation",
        "apply-member-action",
      ],
      allowedWakeKinds: [
        "member.activated",
        "member.action.requested",
      ],
      shouldYieldBackgroundMaintenance: null,
    }));
    expect(postCheckpoint).toEqual(expect.objectContaining({
      afterDurableCheckpoint: expect.any(Function),
      checkpointReason: "system_mailbox_receipt",
    }));
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).not.toHaveBeenCalled();

    await runHostedWorkspaceDurableCheckpointEffects(
      postCheckpoint?.afterDurableCheckpoint,
    );

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: memberActionItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("finishes member activation after the first foreground reply", async () => {
    const sequence: string[] = [];
    const activationItem = createMemberActivationSignupWelcomeSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
      async (preparationInput) => {
        if (
          preparationInput.allowedRouteActions?.includes("apply-member-activation")
          && preparationInput.allowedWakeKinds?.includes("member.activated")
        ) {
          sequence.push("member-activation");
          return {
            item: activationItem,
            itemId: activationItem.itemId,
            metrics: {
              bootstrapResult: null,
              conversationMetrics: null,
              mailboxLane: "member-activated" as const,
              nextWakeAt: null,
              postCheckpointRecord: null,
              redactedLogEntries: [],
            },
            status: "processed" as const,
          };
        }
        return null;
      },
    );
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      sequence.push("provider");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 0,
        postCheckpointRecord: null,
        progressed: true,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
    }));

    expect(sequence).toEqual(["provider"]);

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(sequence).toEqual(["provider", "member-activation"]);
    expect(
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.calls.at(-1)?.[0],
    ).toEqual(expect.objectContaining({
      allowedRouteActions: [
        "apply-member-activation",
        "apply-member-action",
      ],
      allowedWakeKinds: [
        "member.activated",
        "member.action.requested",
      ],
      shouldYieldBackgroundMaintenance: null,
    }));
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
    }));
  });

  it("removes a real queued member activation after the first foreground reply", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-member-activation-"));
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    const sequence: string[] = [];

    try {
      await initializeVault({ createdAt: now, vaultRoot });
      const systemMailbox = await loadHostedSystemMailboxRealImplementation();
      const activationWake = buildHostedExecutionMemberActivatedWake({
        eventId: "member.activated:synthetic:first-conversation",
        memberChannels: {
          email: false,
          linq: true,
          telegram: false,
        },
        memberId: "member_synthetic_phase",
        occurredAt: now,
      });
      const activationItem = createResolvedMemberActivationMailboxItem({
        occurredAt: now,
      });
      // Preserve recovery coverage for snapshots created before bootstrap-only
      // activations stopped creating a second queue item.
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [{
          attemptCount: 0,
          itemId: activationItem.item.id,
          lastAttemptAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          mailboxDedupeKey: activationItem.item.dedupeKey,
          mailboxLaneSeq: activationItem.item.laneSeq,
          nextAttemptAt: null,
          occurredAt: activationItem.item.occurredAt,
          postCheckpointRecord: null,
          preferenceCausalSeq: null,
          requestId: null,
          routeAction: "apply-member-activation",
          status: "pending",
          wake: activationWake,
        }],
      }));
      expect(await readHostedSystemMailboxState(vaultRoot)).toMatchObject({
        pending: [
          {
            routeAction: "apply-member-activation",
            wake: { kind: "member.activated" },
          },
        ],
      });

      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
        systemMailbox.prepareHostedSystemMailboxItemForCheckpoint,
      );
      mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementation(
        systemMailbox.recordHostedSystemMailboxItemAfterCheckpoint,
      );
      mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(
        systemMailbox.resolveHostedSystemMailboxNextWakeCandidate,
      );
      mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
        sequence.push("provider");
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: true,
          deviceSyncProcessed: 0,
          deviceSyncSkipped: true,
          nextWakeAt: null,
          parserProcessed: 0,
          postCheckpointRecord: null,
          progressed: true,
          redactedLogEntries: [],
        };
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 1,
        now: () => now,
        operatorHomeRoot,
        vaultRoot,
      }));

      expect(sequence).toEqual(["provider"]);
      expect(await readHostedSystemMailboxState(vaultRoot)).toMatchObject({
        pending: [
          {
            routeAction: "apply-member-activation",
            wake: { kind: "member.activated" },
          },
        ],
      });

      const postCheckpoint = await result.afterCheckpoint?.();

      expect(await readHostedSystemMailboxState(vaultRoot)).toEqual({ pending: [] });
      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "activation_bootstrap",
      }));
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("does not scan terminal Linq cleanup during fresh conversation input", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result.checkpointReason).not.toBe("provider_cleanup");
  });

  it("preserves scheduled cleanup wake after foreground non-fast delivery without provider ids", async () => {
    const providerCleanupWakeAt = "2026-04-27T00:14:00.000Z";
    const baseDeliveryEffect = createDeliveryEffect();
    const deliveryEffect = {
      ...baseDeliveryEffect,
      payload: {
        ...baseDeliveryEffect.payload,
        transportIdempotent: false,
      },
    };
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      providerCleanupWakeAt,
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [deliveryEffect.effectId],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deliveryEffect.fingerprint,
        effectId: deliveryEffect.effectId,
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: null,
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      nextWakeAt: providerCleanupWakeAt,
      progressed: true,
    }));
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: providerCleanupWakeAt,
      redactedStatus: expect.objectContaining({
        nextWakeAt: providerCleanupWakeAt,
      }),
    }));
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
  });

  it("preserves queued provider cleanup during later foreground input with no delivery effects", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:12:00.000Z",
        nextWakeReason: "assistant",
      }),
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredIntentIds: [],
      vaultRoot: expect.any(String),
    });
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:12:00.000Z",
      progressed: true,
    }));
  });

  it("re-arms due provider cleanup when fresh foreground input has no delivery effects", async () => {
    // Stored cleanup checkpoint is already due when the foreground turn runs.
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValue({
      nextWakeAt: "2026-04-27T00:08:00.000Z",
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:08:00.000Z",
        nextWakeReason: "assistant",
      }),
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredIntentIds: [],
      vaultRoot: expect.any(String),
    });
    // The due checkpoint re-arms durably into the cleanup owner state; the
    // phase wake derives from that single owner.
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("uses the persisted provider cleanup wake after foreground Linq delivery behind a stale mailbox wake", async () => {
    mocks.recordHostedProviderCleanupBeforeCommit.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "linq",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_message_from_reply",
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:08:00.000Z",
        nextWakeReason: "mailbox",
      }),
    }));

    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: ["provider_message_from_reply"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("uses the persisted provider cleanup wake after active-turn Linq delivery behind a stale device-sync wake", async () => {
    mocks.recordHostedProviderCleanupBeforeCommit.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      activeTurnInputIngested: true,
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "linq",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_message_from_active_turn",
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:09:00.000Z",
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:08:00.000Z",
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: ["provider_message_from_active_turn"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("does not drain queued provider cleanup when fresh input also produces delivery effects", async () => {
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "linq",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_message_from_reply",
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:08:00.000Z",
        nextWakeReason: "assistant",
      }),
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: ["provider_message_from_reply"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("records provider cleanup only after foreground delivery drains", async () => {
    mocks.recordHostedProviderCleanupBeforeCommit.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "linq",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_message_from_reply",
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:08:00.000Z",
        nextWakeReason: "mailbox",
      }),
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(
      mocks.drainHostedPreparedAssistantDeliveries.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.recordHostedProviderCleanupBeforeCommit.mock.invocationCallOrder[0] ??
        Number.MAX_SAFE_INTEGER,
    );
  });

  it("defers cleanup when input is admitted during the active turn", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      activeTurnInputIngested: true,
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "linq",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_message_from_active_turn",
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredIntentIds: [],
      vaultRoot: expect.any(String),
    });
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: true,
      }),
    );
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: ["provider_message_from_active_turn"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("skips managed automation seeding when pending input appears after system mailbox work", async () => {
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.resolveHostedPendingAssistantInputWakeAt
      .mockResolvedValueOnce(null)
      .mockResolvedValue("2026-04-27T00:10:00.000Z");

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result.nextWakeAt).toBe("2026-04-27T00:10:00.000Z");
    expect(postCheckpoint).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      nextWakeReason: "assistant",
    }));
    expect(mocks.resolveHostedPendingAssistantInputWakeAt).toHaveBeenCalledWith({
      now: expect.any(Function),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(
      mocks.resolveHostedPendingAssistantInputWakeAt.mock.calls[0]?.[0].now(),
    ).toBe("2026-04-27T00:10:00.000Z");
  });

  it("keeps pending input ahead when recording exposes an older model-free wake", async () => {
    const foregroundWakeAt = "2026-04-27T00:10:00.000Z";
    const systemWakeAt = "2026-04-27T00:09:59.000Z";
    let systemItemRecorded = false;
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.resolveHostedPendingAssistantInputWakeAt
      .mockResolvedValueOnce(null)
      .mockResolvedValue(foregroundWakeAt);
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(
      async (input) => {
        if (
          (input?.allowedRouteActions?.length ?? 0) > 0
          || (input?.allowedWakeKinds?.length ?? 0) > 0
        ) {
          return { at: null, executionClass: null, reason: null };
        }
        return systemItemRecorded
          ? {
              at: systemWakeAt,
              executionClass: "model_free",
              reason: "mailbox",
            }
          : { at: null, executionClass: null, reason: null };
      },
    );
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementationOnce(
      async () => {
        systemItemRecorded = true;
        return {
          failed: 0,
          nextWakeAt: systemWakeAt,
          nextWakeReason: "mailbox",
          recorded: 1,
        };
      },
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => foregroundWakeAt,
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      nextWakeAt: foregroundWakeAt,
      nextWakeReason: "assistant",
    }));
  });

  it("probes pending input when imported conversations have no eligible foreground ids", async () => {
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      conversationImportedCount: 1,
      importedCount: 1,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(3);
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.prepareHostedAssistantAutomationForWake).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: false,
    }));
    expect(mocks.resolveHostedPendingAssistantInputWakeAt).toHaveBeenCalledWith({
      inspectOnly: false,
      now: expect.any(Function),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(
      mocks.resolveHostedPendingAssistantInputWakeAt.mock.calls[0]?.[0].now(),
    ).toBe("2026-04-27T00:10:00.000Z");
  });

  it("defers queued provider cleanup behind a pending assistant attempt", async () => {
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
    });
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      "2026-04-27T00:14:00.000Z",
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(3);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedProviderCleanupCheckpoint).toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: true,
    }));
  });

  it("retries prepared room setup before planning the first group conversation", async () => {
    const callOrder: string[] = [];
    const now = "2026-07-29T18:01:00.000Z";
    const item = createGroupRoomModelInitializationSystemMailboxItem();
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) =>
      input?.allowedRouteActions?.includes("initialize-group-room-model")
        ? {
            at: now,
            reason: "assistant",
          }
        : {
            at: null,
            reason: null,
          }
    );
    mocks.prepareHostedSystemMailboxItemForCheckpoint
      .mockImplementationOnce(async (input) => {
        callOrder.push("room-model-failed");
        expect(input.allowedRouteActions).toEqual([
          "initialize-group-room-model",
        ]);
        return {
          attemptCount: item.attemptCount,
          errorCode: "group_room_model_unavailable",
          errorMessage: "Group room model unavailable.",
          itemId: item.itemId,
          legacyUsageReferralAuthorityClassification: null,
          nextWakeAt: "2026-07-29T18:02:00.000Z",
          routeAction: item.routeAction,
          status: "retryable_failed",
          wakeKind: item.wake.kind,
        };
      })
      .mockImplementationOnce(async (input) => {
        callOrder.push("room-model-initialized");
        expect(input.allowedRouteActions).toEqual([
          "initialize-group-room-model",
        ]);
        return {
          item,
          itemId: item.itemId,
          metrics: {
            bootstrapResult: null,
            conversationMetrics: null,
            mailboxLane: "member-activated",
            redactedLogEntries: [],
          },
          status: "processed",
        };
      });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: false,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });
    const input = createPhaseInput({
      importedCount: 1,
      now: () => now,
    });

    const failed = await runHostedWorkspaceAssistantPhase(input);

    expect(failed).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: "2026-07-29T18:02:00.000Z",
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedGroupRoomModelInitializationRetryableFailed: 1,
      }),
    }));
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();

    const replay = await runHostedWorkspaceAssistantPhase(input);

    expect(callOrder).toEqual([
      "room-model-failed",
      "room-model-initialized",
      "assistant",
    ]);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(replay).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedGroupRoomModelInitializationProcessed: 1,
      }),
    }));
  });

  it("applies member preference mailbox work before planning fresh conversation input", async () => {
    const callOrder: string[] = [];
    let preferenceWakeChecks = 0;
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) => {
      if (input?.allowedWakeKinds?.includes("runtime.pending-effects-reconcile-requested")) {
        return {
          at: null,
          reason: null,
        };
      }
      if (input?.allowedRouteActions?.includes("apply-member-preferences")) {
        preferenceWakeChecks += 1;
        return preferenceWakeChecks === 1
          ? {
              at: "2026-04-27T00:00:00.000Z",
              reason: "assistant",
            }
          : {
              at: null,
              reason: null,
            };
      }
      return {
        at: null,
        reason: null,
      };
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(
      async (input) => {
        callOrder.push("member-preferences");
        expect(input.allowedRouteActions).toEqual(["apply-member-preferences"]);
        return {
          item: createMemberPreferencesSystemMailboxItem(),
          itemId: "system_mailbox_item_member_preferences",
          metrics: {
            bootstrapResult: null,
            conversationMetrics: null,
            mailboxLane: "member-preferences-updated",
            redactedLogEntries: [],
          },
          status: "processed",
        };
      },
    );
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: false,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(callOrder).toEqual(["member-preferences", "assistant"]);
    expect(result).toEqual(expect.objectContaining({
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedMemberPreferencesPrePlanningProcessed: 1,
      }),
    }));
  });

  it("drains one bounded due preference page before rescheduling fresh conversation input", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) => {
      if (input?.allowedWakeKinds?.includes("runtime.pending-effects-reconcile-requested")) {
        return {
          at: null,
          reason: null,
        };
      }
      if (
        input?.allowedRouteActions?.includes("initialize-group-room-model")
      ) {
        return {
          at: null,
          reason: null,
        };
      }
      return {
        at: now,
        reason: "assistant",
      };
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(async (input) => {
      expect(input.allowedRouteActions).toEqual(["apply-member-preferences"]);
      const itemNumber = mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.calls.length;
      const item = {
        ...createMemberPreferencesSystemMailboxItem(),
        itemId: `system_mailbox_item_member_preferences_${itemNumber}`,
        mailboxDedupeKey: `dedupe_system_mailbox_item_member_preferences_${itemNumber}`,
      };
      return {
        item,
        itemId: item.itemId,
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "member-preferences-updated",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => now,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(10);
    expect(mocks.resolveHostedSystemMailboxNextWakeCandidate).toHaveBeenCalledTimes(12);
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: now,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedMemberPreferencesPrePlanningPageLimit: 10,
        hostedMemberPreferencesPrePlanningPending: 1,
        hostedMemberPreferencesPrePlanningProcessed: 10,
      }),
    }));
  });

  it("applies member preference mailbox work before background notification work", async () => {
    const callOrder: string[] = [];
    let preferenceWakeChecks = 0;
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) => {
      if (
        input?.allowedRouteActions?.length === 1
        && input.allowedRouteActions[0] === "apply-member-preferences"
      ) {
        preferenceWakeChecks += 1;
        return preferenceWakeChecks === 1
          ? {
              at: "2026-04-27T00:00:00.000Z",
              reason: "assistant",
            }
          : {
              at: null,
              reason: null,
            };
      }

      return {
        at: null,
        reason: null,
      };
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(async (input) => {
      if (
        input.allowedRouteActions?.length === 1
        && input.allowedRouteActions[0] === "apply-member-preferences"
      ) {
        callOrder.push("member-preferences");
        return {
          item: createMemberPreferencesSystemMailboxItem(),
          itemId: "system_mailbox_item_member_preferences",
          metrics: {
            bootstrapResult: null,
            conversationMetrics: null,
            mailboxLane: "member-preferences-updated",
            redactedLogEntries: [],
          },
          status: "processed",
        };
      }

      callOrder.push("assistant-notification");
      expect(input.allowedRouteActions).toBeUndefined();
      return {
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_notification",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(callOrder).toEqual(["member-preferences", "assistant-notification"]);
    expect(result).toEqual(expect.objectContaining({
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedMemberPreferencesPrePlanningProcessed: 1,
        hostedSystemMailboxPrepared: 1,
      }),
    }));
  });

  it("continues fresh conversation planning while member preferences are waiting to retry", async () => {
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) => {
      if (input?.allowedWakeKinds?.includes("runtime.pending-effects-reconcile-requested")) {
        return {
          at: null,
          reason: null,
        };
      }
      if (input?.allowedRouteActions?.includes("apply-member-preferences")) {
        return {
          at: "2026-04-27T00:01:00.000Z",
          reason: "assistant",
        };
      }
      return {
        at: null,
        reason: null,
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      progressed: false,
      redactedStatus: expect.objectContaining({
        hostedMemberPreferencesPrePlanningPending: 1,
        hostedMemberPreferencesPrePlanningProcessed: 0,
      }),
    }));
  });

  it("continues fresh conversation planning when member preferences fail retryably", async () => {
    const callOrder: string[] = [];
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) => {
      if (input?.allowedWakeKinds?.includes("runtime.pending-effects-reconcile-requested")) {
        return {
          at: null,
          reason: null,
        };
      }
      if (input?.allowedRouteActions?.includes("apply-member-preferences")) {
        return {
          at: "2026-04-27T00:00:00.000Z",
          reason: "assistant",
        };
      }
      return {
        at: null,
        reason: null,
      };
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      callOrder.push("member-preferences");
      return {
        attemptCount: 2,
        errorCode: "synthetic_preferences_retry",
        errorMessage: "Synthetic preferences retry.",
        itemId: "system_mailbox_item_member_preferences",
        legacyUsageReferralAuthorityClassification: null,
        nextWakeAt: "2026-04-27T00:01:00.000Z",
        routeAction: "apply-member-preferences",
        status: "retryable_failed",
        wakeKind: "member.preferences.updated",
      };
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: false,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(callOrder).toEqual(["member-preferences", "assistant"]);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedMemberPreferencesPrePlanningErrorCode: "synthetic_preferences_retry",
        hostedMemberPreferencesPrePlanningProcessed: 0,
        hostedMemberPreferencesPrePlanningRetryableFailed: 1,
      }),
    }));
  });

  it("attempts pending assistant input before due system mailbox work", async () => {
    const callOrder: string[] = [];
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(async (input) => {
      if (input.allowedWakeKinds?.includes("runtime.pending-effects-reconcile-requested")) {
        return null;
      }
      callOrder.push("system-mailbox");
      return {
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_processed",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: false,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(callOrder).toEqual(["assistant", "system-mailbox"]);
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      nextWakeReason: "assistant",
    }));
  });

  it("attempts pending assistant input before due device-sync work", async () => {
    const callOrder: string[] = [];
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
    mocks.runHostedDeviceSyncWakeLane.mockImplementationOnce(async () => {
      callOrder.push("device-sync");
      return {
        deviceSyncProcessed: 1,
        deviceSyncSkipped: false,
        nextWakeAt: "2026-04-27T00:11:00.000Z",
        nextWakeReason: "device-sync.reconcile",
        parserProcessed: 0,
        postCheckpointRecord: null,
      };
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: false,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-27T00:09:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(callOrder).toEqual(["assistant", "device-sync"]);
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: true,
    }));
  });

  it("runs an assistant pass after deferred manual runtime-control work", async () => {
    const callOrder: string[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const manualRuntimeItem = {
      ...createSystemMailboxItem(),
      itemId: "system_mailbox_item_deferred_runtime_manual",
      mailboxDedupeKey: "dedupe_system_mailbox_item_deferred_runtime_manual",
      routeAction: "apply-runtime-control-request" as const,
      wake: {
        eventId: "evt_deferred_runtime_manual_requested",
        kind: "runtime.manual-requested" as const,
        occurredAt: "2026-04-27T00:10:01.000Z",
        userId: "member_synthetic_phase",
      },
    };
    mocks.runHostedAssistantAutomationLane
      .mockImplementationOnce(async () => {
        callOrder.push("assistant-1");
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: true,
          nextWakeAt: "2026-04-27T00:10:30.000Z",
          redactedLogEntries: [{
            component: "runtime.provider",
            level: "info",
            message: "First assistant pass timing.",
            phase: "wake.running",
            redacted: {
              schema: "murph.assistant-turn-timing.v1",
              type: "assistant.turn.timing",
              turnTimingElapsedMs: 11,
              turnTimingStage: "provider-result-returned",
            },
          }],
        };
      })
      .mockImplementationOnce(async () => {
        callOrder.push("assistant-2");
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: false,
          nextWakeAt: "2026-04-27T00:45:00.000Z",
          redactedLogEntries: [{
            component: "runtime.provider",
            level: "info",
            message: "Second assistant pass timing.",
            phase: "wake.running",
            redacted: {
              schema: "murph.assistant-turn-timing.v1",
              type: "assistant.turn.timing",
              turnTimingElapsedMs: 29,
              turnTimingStage: "usage-recorded",
            },
          }],
        };
      });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      callOrder.push("system-mailbox");
      return {
        item: manualRuntimeItem,
        itemId: manualRuntimeItem.itemId,
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "runtime-control",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      logRequests,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(callOrder).toEqual(["system-mailbox", "assistant-1"]);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(
      logRequests
        .map((request) => request.entries[0]?.redactedJson)
        .filter((redactedJson) =>
          redactedJson?.detailComponent === "runtime.provider" &&
          redactedJson?.type === "assistant.turn.timing"
        )
        .map((redactedJson) => redactedJson?.turnTimingStage),
    ).toEqual(["provider-result-returned"]);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: true,
    }));

    await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: manualRuntimeItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("keeps buffered first-pass detail logs when deferred manual runtime-control work runs once", async () => {
    const callOrder: string[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const manualRuntimeItem = {
      ...createSystemMailboxItem(),
      itemId: "system_mailbox_item_deferred_runtime_manual",
      mailboxDedupeKey: "dedupe_system_mailbox_item_deferred_runtime_manual",
      routeAction: "apply-runtime-control-request" as const,
      wake: {
        eventId: "evt_deferred_runtime_manual_requested",
        kind: "runtime.manual-requested" as const,
        occurredAt: "2026-04-27T00:10:01.000Z",
        userId: "member_synthetic_phase",
      },
    };
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant-1");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: "2026-04-27T00:10:30.000Z",
        redactedLogEntries: [{
          component: "runtime.provider",
          level: "info",
          message: "First assistant pass timing.",
          phase: "wake.running",
          redacted: {
            schema: "murph.assistant-turn-timing.v1",
            type: "assistant.turn.timing",
            turnTimingElapsedMs: 11,
            turnTimingStage: "provider-result-returned",
          },
        }],
      };
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      callOrder.push("system-mailbox");
      return {
        item: manualRuntimeItem,
        itemId: manualRuntimeItem.itemId,
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "runtime-control",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      logRequests,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(callOrder).toEqual(["system-mailbox", "assistant-1"]);
    expect(
      logRequests
        .map((request) => request.entries[0]?.redactedJson)
        .filter((redactedJson) =>
          redactedJson?.detailComponent === "runtime.provider" &&
          redactedJson?.type === "assistant.turn.timing"
        )
        .map((redactedJson) => redactedJson?.turnTimingStage),
    ).toEqual(["provider-result-returned"]);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: true,
    }));
  });

  it("uses a full bootstrap checkpoint reason for member activation work", async () => {
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: {
          assistantConfigStatus: "hosted-env",
          assistantConfigured: true,
          assistantProvider: "codex-cli",
          assistantSeeded: true,
          emailAutoReplyEnabled: false,
          linqAutoReplyEnabled: true,
          telegramAutoReplyEnabled: false,
          vaultCreated: true,
        },
        conversationMetrics: null,
        mailboxLane: "member-activated",
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result.checkpointReason).toBe("activation_bootstrap");
  });

  it("records dirty post-checkpoint work for due device-sync work", async () => {
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 2,
      deviceSyncSkipped: false,
      nextWakeAt: "not-a-timestamp",
      parserProcessed: 0,
      postCheckpointRecord: {
        connectionId: "dsc_dirty",
        kind: "device-sync.dirty-processed",
        nextWakeAt: "2026-04-27T00:11:00.000Z",
        processedRevision: "42",
      },
    });
    mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:13:00.000Z",
      recorded: 1,
      stillDirty: true,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result.progressed).toBe(true);
    expect(result.nextWakeAt).toBe("2026-04-27T00:11:00.000Z");
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        wake: expect.objectContaining({
          kind: "runtime.timer",
          userId: "member_synthetic_phase",
        }),
      }),
    );

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      afterDurableCheckpoint: expect.any(Function),
    }));
    await runHostedWorkspaceDurableCheckpointEffects(postCheckpoint?.afterDurableCheckpoint);
    expect(mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord).toHaveBeenCalledWith({
      record: {
        connectionId: "dsc_dirty",
        kind: "device-sync.dirty-processed",
        nextWakeAt: "2026-04-27T00:11:00.000Z",
        processedRevision: "42",
      },
      runtime: expect.any(Object),
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:11:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      redactedStatus: expect.objectContaining({
        hostedDeviceSyncDirtyAckDeferred: true,
        hostedDeviceSyncDirtyAckRecorded: false,
        hostedDeviceSyncDirtyStillPending: true,
      }),
    }));
  });

  it("logs dirty checkpoint failures and preserves the retry wake", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 2,
      deviceSyncSkipped: false,
      nextWakeAt: "not-a-timestamp",
      parserProcessed: 0,
      postCheckpointRecord: {
        connectionId: "dsc_dirty",
        kind: "device-sync.dirty-processed",
        nextWakeAt: "2026-04-27T00:11:00.000Z",
        processedRevision: "42",
      },
    });
    mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord.mockRejectedValueOnce(
      new Error("synthetic dirty checkpoint failure"),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));
    const postCheckpoint = await result.afterCheckpoint?.();
    const effects = postCheckpoint?.afterDurableCheckpoint;
    const effect = typeof effects === "function" ? effects : effects?.[0];
    if (!effect) {
      throw new Error("Expected deferred device-sync dirty checkpoint effect.");
    }

    await expect(effect()).resolves.toEqual({
      nextWakeAt: "2026-04-27T00:11:00.000Z",
      nextWakeReason: "device-sync.reconcile",
    });
    const failureLog = logRequests
      .flatMap((request) => request.entries)
      .find((entry) => entry.redactedJson?.failureEventOrigin === "checkpoint");
    expect(failureLog).toEqual(expect.objectContaining({
      component: "device-sync",
      errorCode: "checkpoint_error",
      eventCode: "device-sync.dirty_ack_persistence_failed",
      level: "warn",
      phase: "checkpoint",
      redactedJson: expect.objectContaining({
        errorCode: "checkpoint_error",
        failureEventOrigin: "checkpoint",
        nextWakeAtPresent: true,
        safeErrorMessage: "Hosted execution failed while recording a checkpoint.",
      }),
    }));
    expect(JSON.stringify(logRequests)).not.toContain(
      "synthetic dirty checkpoint failure",
    );
  });

  it("runs pending provider cleanup after a system mailbox receipt without delivery effects", async () => {
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeForwardedEnv: {
        LINQ_API_BASE_URL: "https://linq.example",
        LINQ_API_TOKEN: "forwarded-linq-token",
        OPENAI_API_KEY: "sk-not-for-cleanup",
      },
      runtimeUserEnv: {
        LINQ_API_TOKEN: "user-linq-token",
      },
    }));

    expect(result.checkpointReason).toBe("system_mailbox_receipt");
    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    // Foreground Reply Critical Path: a cleanup-capable post-checkpoint step must
    // keep the foreground import loop alive so a message arriving mid-drain
    // is imported and preempts via the yield hook.
    expect(result.afterCheckpointKeepsForegroundImportLoop).toBe(true);
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: {
          nextWakeAt: null,
        },
        env: {
          LINQ_API_BASE_URL: "https://linq.example",
          LINQ_API_TOKEN: "user-linq-token",
        },
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "provider_cleanup",
      redactedStatus: expect.objectContaining({
        hostedProviderCleanupAttemptedLinqItems: 1,
        hostedProviderCleanupDeletedLinqItems: 1,
        hostedProviderCleanupFailedLinqItems: 0,
        hostedSystemMailboxRecordFailed: 0,
        hostedSystemMailboxRecorded: 1,
      }),
    }));
  });

  it("drains delivery effects created by system mailbox notifications after checkpoint", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_notification",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.resolveHostedAssistantOutboxNextWakeAt
      .mockResolvedValueOnce("2026-04-27T00:20:00.000Z")
      .mockResolvedValueOnce(null);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "linq",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_synthetic",
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
    }));

    expect(result.checkpointReason).toBe("outbox_sending");
    expect(result.nextWakeAt).toBe("2026-04-27T00:20:00.000Z");
    expect(result.redactedStatus).toEqual(expect.objectContaining({
      hostedOutboxPendingDeliveryEffects: 1,
      hostedSystemMailboxPrepared: 1,
    }));
    expect(mocks.prepareHostedAssistantDeliveryEffectsForDispatch)
      .toHaveBeenCalledWith(expect.objectContaining({
        assistantDeliveryEffects: [expect.objectContaining({
          effectId: "effect_synthetic",
        })],
      }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: expect.any(String),
      redactedStatus: expect.objectContaining({
        hostedOutboxDeliveryAttempted: 1,
        hostedOutboxDeliverySent: 1,
        hostedSystemMailboxRecordFailed: 0,
        hostedSystemMailboxRecorded: 1,
      }),
    }));
    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "mailbox.system_processed",
      "mailbox.system_processed",
      "outbox.delivery_finished",
    ]);
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupAfterDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomes: [expect.objectContaining({
          deliveryChannel: "linq",
          providerMessageId: "provider_synthetic",
        })],
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    const deliveryDrainInput = mocks.drainHostedPreparedAssistantDeliveries
      .mock.calls[0]?.[0];
    await expect(deliveryDrainInput.assertLiveness()).resolves.toBeUndefined();
  });

  it("flushes member-channel updates before auto-reply delivery dispatch", async () => {
    const deliveryEffect = createDeliveryEffect();
    mocks.prepareHostedSystemMailboxItemForCheckpoint
      .mockResolvedValueOnce({
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_notification",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      })
      .mockResolvedValueOnce({
        item: {
          ...createSystemMailboxItem(),
          itemId: "system_mailbox_item_member_channels",
          routeAction: "apply-member-channels-update",
        },
        itemId: "system_mailbox_item_member_channels",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "member-channels-updated",
          redactedLogEntries: [],
        },
        status: "processed",
      })
      .mockResolvedValueOnce(null);
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deliveryEffect.fingerprint,
        effectId: deliveryEffect.effectId,
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_synthetic",
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
    }));
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.calls[1]?.[0])
      .toEqual(expect.objectContaining({
        allowedRouteActions: ["apply-member-channels-update"],
      }));
    expect(
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.invocationCallOrder[1],
    ).toBeLessThan(
      mocks.drainHostedPreparedAssistantDeliveries.mock.invocationCallOrder[0] ??
        Number.MAX_SAFE_INTEGER,
    );
  });

  it("stabilizes foreground imports before successful auto-reply delivery dispatch", async () => {
    const deliveryEffect = createDeliveryEffect();
    const prepareAutoReplyDelivery = vi.fn(async () => undefined);
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deliveryEffect.fingerprint,
        effectId: deliveryEffect.effectId,
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_synthetic",
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      prepareAutoReplyDelivery,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      redactedStatus: expect.objectContaining({
        hostedOutboxDeliveryAttempted: 1,
        hostedOutboxDeliverySent: 1,
      }),
    }));
    expect(prepareAutoReplyDelivery).toHaveBeenCalledTimes(1);
    expect(
      prepareAutoReplyDelivery.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.drainHostedPreparedAssistantDeliveries.mock.invocationCallOrder[0] ??
        Number.MAX_SAFE_INTEGER,
    );
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).not.toHaveBeenCalled();
  });

  it("resets prepared delivery claims when the member-channel barrier blocks", async () => {
    const deliveryEffect = createDeliveryEffect();
    const preparedDispatches = createPreparedDispatchesForDeliveryEffect(deliveryEffect);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      attemptCount: 2,
      errorCode: "HOSTED_MEMBER_CHANNELS_TRANSIENT",
      errorMessage: "Hosted member-channel update failed.",
      itemId: "system_mailbox_item_member_channels",
      legacyUsageReferralAuthorityClassification: null,
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      routeAction: "apply-member-channels-update",
      status: "retryable_failed",
      wakeKind: "member.channels.updated",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      redactedStatus: expect.objectContaining({
        hostedMemberChannelPreDispatchBlocked: 1,
      }),
    }));
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).toHaveBeenCalledWith({
      effects: [deliveryEffect],
      preparedDispatches,
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("keeps the owner cleanup wake when a member-channel barrier blocks auto-reply delivery", async () => {
    const deliveryEffect = createDeliveryEffect();
    const preparedDispatches = createPreparedDispatchesForDeliveryEffect(deliveryEffect);
    // The cleanup owner state already carries a scheduled wake.
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      "2026-04-27T00:14:00.000Z",
    );
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      attemptCount: 2,
      errorCode: "HOSTED_MEMBER_CHANNELS_TRANSIENT",
      errorMessage: "Hosted member-channel update failed.",
      itemId: "system_mailbox_item_member_channels",
      legacyUsageReferralAuthorityClassification: null,
      nextWakeAt: "2026-04-27T00:30:00.000Z",
      routeAction: "apply-member-channels-update",
      status: "retryable_failed",
      wakeKind: "member.channels.updated",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      redactedStatus: expect.objectContaining({
        hostedMemberChannelPreDispatchBlocked: 1,
      }),
    }));
    expect(mocks.resolveHostedProviderCleanupScheduledWakeAt).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).toHaveBeenCalledWith({
      effects: [deliveryEffect],
      preparedDispatches,
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("drains due provider cleanup before returning a background member-channel barrier", async () => {
    const deliveryEffect = createDeliveryEffect();
    const preparedDispatches = createPreparedDispatchesForDeliveryEffect(deliveryEffect);
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint
      .mockResolvedValueOnce({
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_notification",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      })
      .mockResolvedValueOnce({
        attemptCount: 2,
        errorCode: "HOSTED_MEMBER_CHANNELS_TRANSIENT",
        errorMessage: "Hosted member-channel update failed.",
        itemId: "system_mailbox_item_member_channels",
        legacyUsageReferralAuthorityClassification: null,
        nextWakeAt: "2026-04-27T00:30:00.000Z",
        routeAction: "apply-member-channels-update",
        status: "retryable_failed",
        wakeKind: "member.channels.updated",
      });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result).toEqual(expect.objectContaining({
      afterCheckpoint: expect.any(Function),
      checkpointReason: "outbox_sending",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:30:00.000Z",
      redactedStatus: expect.objectContaining({
        hostedMemberChannelPreDispatchBlocked: 1,
        hostedProviderCleanupAttemptedLinqItems: 1,
        hostedProviderCleanupDeletedLinqItems: 1,
        hostedProviderCleanupFailedLinqItems: 0,
      }),
    }));
    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: {
          nextWakeAt: null,
        },
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(mocks.resolveHostedProviderCleanupScheduledWakeAt).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).toHaveBeenCalledWith({
      effects: [deliveryEffect],
      preparedDispatches,
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("resets prepared delivery claims and returns a checkpointable barrier when the member-channel barrier throws", async () => {
    const deliveryEffect = createDeliveryEffect();
    const preparedDispatches = createPreparedDispatchesForDeliveryEffect(deliveryEffect);
    const barrierError = new Error("remote system mailbox catch-up failed");
    const prepareAutoReplyDelivery = vi.fn(async () => {
      throw barrierError;
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      prepareAutoReplyDelivery,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      redactedStatus: expect.objectContaining({
        hostedMemberChannelPreDispatchBarrierFailed: 1,
      }),
    }));
    expect(prepareAutoReplyDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).toHaveBeenCalledWith({
      effects: [deliveryEffect],
      preparedDispatches,
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("preserves queued provider cleanup during later non-foreground assistant progress", async () => {
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
    });
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      "2026-04-27T00:14:00.000Z",
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: "2026-04-27T00:30:00.000Z",
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("preserves the post-scan cron wake through due provider cleanup", async () => {
    const now = "2026-04-27T00:10:00.000Z";
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: now,
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 3,
      enabledJobs: 7,
      nextRunAt: now,
      runningJobs: 0,
      totalJobs: 7,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => now,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: now,
      progressed: true,
    }));
    expect(
      withoutAssistantTurnTimingLogs(logRequests)
        .find((request) =>
          request.entries[0]?.eventCode === "assistant.pass_finished"
        )
        ?.entries[0]?.redactedJson,
    ).toEqual(expect.objectContaining({
      nextWakeAtPresent: true,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledTimes(1);
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "provider_cleanup",
      nextWakeAt: now,
      nextWakeReason: "assistant",
    }));
  });

  it("does not preserve a consumed provider cleanup wake after background delivery drains cleanup", async () => {
    const providerCleanupWakeAt = "2026-04-27T00:14:00.000Z";
    const deliveryEffect = createDeliveryEffect();
    const deferredDeliveryEffect = {
      ...deliveryEffect,
      payload: {
        ...deliveryEffect.payload,
        transportIdempotent: false,
      },
    };
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: providerCleanupWakeAt,
    });
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      providerCleanupWakeAt,
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deferredDeliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deferredDeliveryEffect),
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deferredDeliveryEffect.fingerprint,
        effectId: deferredDeliveryEffect.effectId,
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: null,
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      nextWakeAt: providerCleanupWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    // Not-yet-due cleanup state must wait for its scheduled wake; the
    // background delivery pass records outbound ids instead of draining hot.
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupAfterDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: providerCleanupWakeAt,
    }));
  });

  it("uses a hot provider cleanup checkpoint for cleanup-only progress", async () => {
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result.progressed).toBe(true);
    expect(result.checkpointReason).toBe("provider_cleanup");
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: {
          nextWakeAt: null,
        },
        env: {},
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "provider_cleanup",
      redactedStatus: expect.objectContaining({
        hostedProviderCleanupAttemptedLinqItems: 1,
        hostedProviderCleanupDeletedLinqItems: 1,
        hostedProviderCleanupFailedLinqItems: 0,
      }),
    }));
  });

  it("treats pending terminal Linq cleanup evidence as checkpoint progress", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      assistantAutomationTerminalLinqCleanup: ["linq_msg_terminal_cleanup"],
      nextWakeAt: null,
      redactedLogEntries: [],
    });
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result.progressed).toBe(true);
    expect(result.checkpointReason).toBe("provider_cleanup");
    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: expect.any(String),
      },
      linqMessageIds: ["linq_msg_terminal_cleanup"],
      vaultRoot: "/tmp/murph-vault",
    });

    const postCheckpoint = await result.afterCheckpoint?.();

    // Round-47 validation: current-pass terminal cleanup records durable
    // state and requests a checkpoint, but the same invocation never drains
    // provider-visible deletion; the scheduled wake after the durable
    // checkpoint does.
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "provider_cleanup",
    }));
  });
});

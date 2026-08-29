import {
  createCodexAuthSystemMailboxItem,
  createDeliveryEffect,
  createDueAssistantWorkspace,
  createFailedDeliveryOutcome,
  createMemberActivationSignupWelcomeSystemMailboxItem,
  createPhaseInput,
  createPreparedDispatchesForDeliveryEffect,
  createSentDeliveryOutcome,
  createSystemMailboxItem,
  createTerminalFailureOutboxIntent,
  expectAssistantLaneCallWithoutDeviceSyncOptions,
  mocks,
  resolveHostedPendingAssistantInputWakeAtWithRealImplementation,
  seedDirectLinqAssistantInputRoute,
  withoutAssistantTurnTimingLogs,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";

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
import { parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
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
  buildOnboardingFirstPersonalReadAutomationSaveRequest,
  completeAssistantOnboarding,
  getAssistantCronJob,
  markAssistantContextSnapshotDirty,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
  readAssistantContextSnapshotState,
  saveAssistantAutomationState,
  saveAssistantSession,
  setAssistantCronJobEnabled,
  upsertAssistantInputEvent,
  type AssistantAutomationOperationScope,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";
import {
  runHostedWorkspaceAssistantPhase,
  type HostedWorkspaceRuntimeAssistantPhaseInput,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";
import {
  enqueueHostedPendingAssistantInputId,
  inspectHostedPendingAssistantInputWakeCandidate,
  readExistingHostedPendingAssistantInputIds,
  resolveHostedPendingAssistantInputStatePath,
} from "../src/hosted-runtime/pending-input-index.ts";

describe("runHostedWorkspaceAssistantPhase runtime logs", () => {it("writes foreground delivery finished timing after deferred delivery drains", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const backgroundMaintenanceController = new AbortController();
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);
    const deliveryEffect = createDeliveryEffect();
    const deferredDeliveryEffect = {
      ...deliveryEffect,
      payload: {
        ...deliveryEffect.payload,
        transportIdempotent: false,
      },
    };
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [deferredDeliveryEffect.effectId],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
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
        journalMethod: "POST",
        journalStatus: "200",
        providerMessageId: "provider_deferred_foreground",
        providerMessageIds: [],
        providerThreadId: null,
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      backgroundMaintenanceSignal: backgroundMaintenanceController.signal,
      importedCount: 1,
      logRequests,
      shouldYieldBackgroundMaintenance,
    }));

    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    expect(
      logRequests
        .map((request) => request.entries[0]?.redactedJson?.turnTimingStage)
        .filter(Boolean),
    ).not.toContain("foreground-delivery-phase-finished");

    await result.afterCheckpoint?.();

    expect(
      logRequests
        .map((request) => request.entries[0]?.redactedJson?.turnTimingStage)
        .filter(Boolean),
    ).toEqual(expect.arrayContaining([
      "foreground-delivery-phase-started",
      "foreground-delivery-phase-finished",
    ]));
    const finishLogIndex = logRequests.findIndex(
      (request) =>
        request.entries[0]?.redactedJson?.turnTimingStage
          === "foreground-delivery-phase-finished",
    );
    const outboxLogIndex = logRequests.findIndex(
      (request) => request.entries[0]?.eventCode === "outbox.delivery_finished",
    );
    expect(outboxLogIndex).toBeGreaterThanOrEqual(0);
    expect(finishLogIndex).toBeGreaterThan(outboxLogIndex);
    expect(
      mocks.drainHostedPreparedAssistantDeliveries.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.maintainAssistantAutoReplyRouteState.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.maintainAssistantAutoReplyRouteState).toHaveBeenCalledWith({
      shouldYield: shouldYieldBackgroundMaintenance,
      signal: backgroundMaintenanceController.signal,
      vault: "/tmp/murph-vault",
    });
  });

  it("waits for optional product feedback only after a queue-only foreground reply is sent", async () => {
    const deliveryEffect = {
      ...createDeliveryEffect(),
      payload: {
        ...createDeliveryEffect().payload,
        transportIdempotent: false,
      },
    };
    const feedback = {
      idempotencyKey: "feedback-after-member-delivery",
      kind: "feature_request" as const,
      relatedChangelogItemIds: [],
      summary: "Speculative: support the missing Murph path.",
    };
    let resolveFeedback: (value: {
      feedbackId: string;
      recorded: boolean;
    }) => void = () => {
      throw new Error("Product feedback completion was not initialized.");
    };
    const feedbackCompletion = new Promise<{
      feedbackId: string;
      recorded: boolean;
    }>((resolve) => {
      resolveFeedback = resolve;
    });
    let memberDeliveryCompleted = false;
    const recordProductFeedback = vi.fn(() => {
      expect(memberDeliveryCompleted).toBe(true);
      return feedbackCompletion;
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(
      async (laneInput) => {
        laneInput.executionContext.hosted?.productFeedbackCandidateSink
          ?.acceptProductFeedbackCandidate(feedback);
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [
            deliveryEffect.effectId,
          ],
          assistantAutomationProgressed: true,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      },
    );
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(
      async () => {
        memberDeliveryCompleted = true;
        return [createSentDeliveryOutcome()];
      },
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      runtimeProductFeedbackPort: { recordProductFeedback },
    }));

    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    expect(recordProductFeedback).not.toHaveBeenCalled();

    const postCheckpointPromise = result.afterCheckpoint?.();
    await vi.waitFor(() => {
      expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledOnce();
      expect(recordProductFeedback).toHaveBeenCalledWith(feedback);
    });
    expect(memberDeliveryCompleted).toBe(true);

    let postCheckpointSettled = false;
    void postCheckpointPromise?.then(() => {
      postCheckpointSettled = true;
    });
    await Promise.resolve();
    expect(postCheckpointSettled).toBe(false);

    resolveFeedback({
      feedbackId: "feedback_synthetic",
      recorded: true,
    });
    await postCheckpointPromise;
  });

  it("does not record queued product feedback when the current delivery fails", async () => {
    const deliveryEffect = createDeliveryEffect();
    const feedback = {
      idempotencyKey: "feedback-after-failed-delivery",
      kind: "feature_request" as const,
      relatedChangelogItemIds: [],
      summary: "Speculative: support the missing Murph path.",
    };
    const recordProductFeedback = vi.fn();
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(
      async (laneInput) => {
        laneInput.executionContext.hosted?.productFeedbackCandidateSink
          ?.acceptProductFeedbackCandidate(feedback);
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [
            deliveryEffect.effectId,
          ],
          assistantAutomationProgressed: true,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      },
    );
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createFailedDeliveryOutcome({
        deliveryErrorCode: "SYNTHETIC_DELIVERY_FAILURE",
        effectId: deliveryEffect.effectId,
      }),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      runtimeProductFeedbackPort: { recordProductFeedback },
    }));
    await result.afterCheckpoint?.();

    expect(recordProductFeedback).not.toHaveBeenCalled();
  });

  it("records support escalations through the port inside the turn instead of the post-delivery flush", async () => {
    const supportFeedback = {
      idempotencyKey: "support-escalation-in-turn",
      kind: "frustration" as const,
      relatedChangelogItemIds: [],
      summary: "Support escalation: a connected source does not finish connecting.",
    };
    const recordProductFeedback = vi.fn(async () => ({
      feedbackId: "feedback_support_synthetic",
      recorded: true,
    }));
    let deliveredDuringLane: { recorded: boolean } | null = null;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(
      async (laneInput) => {
        const sink =
          laneInput.executionContext.hosted?.productFeedbackCandidateSink;
        if (!sink?.deliverProductSupportEscalation) {
          throw new Error(
            "Expected a durable support-escalation sink for the hosted lane.",
          );
        }
        deliveredDuringLane =
          await sink.deliverProductSupportEscalation(supportFeedback);
        return {
          assistantAutomationProgressed: true,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      },
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      runtimeProductFeedbackPort: { recordProductFeedback },
    }));

    expect(deliveredDuringLane).toEqual({ recorded: true });
    expect(recordProductFeedback).toHaveBeenCalledExactlyOnceWith(
      supportFeedback,
    );

    await result.afterCheckpoint?.();
    expect(recordProductFeedback).toHaveBeenCalledOnce();
  });

  it("does not re-emit a stale pre-delivery outbox wake after deferred foreground delivery drains", async () => {
    const staleOutboxWakeAt = "2026-05-08T16:00:05.000Z";
    const deliveryEffect = createDeliveryEffect();
    const deferredDeliveryEffect = {
      ...deliveryEffect,
      payload: {
        ...deliveryEffect.payload,
        transportIdempotent: false,
      },
    };
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [deferredDeliveryEffect.effectId],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deferredDeliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deferredDeliveryEffect),
    });
    mocks.resolveHostedAssistantOutboxNextWakeAt
      .mockResolvedValueOnce(staleOutboxWakeAt)
      .mockResolvedValueOnce(null);
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

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-05-08T16:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      nextWakeAt: staleOutboxWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        nextWakeAt: null,
      }),
    }));
  });

  it("passes the runtime action-approval port into hosted delivery drain", async () => {
    const actionApprovalPort = {
      consume: vi.fn(),
      read: vi.fn(),
      request: vi.fn(),
    };
    const deliveryEffect = createDeliveryEffect();
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
        deliveryChannel: "linq",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deliveryEffect.fingerprint,
        effectId: deliveryEffect.effectId,
        journalMethod: "POST",
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
      runtimeActionApprovalPort: actionApprovalPort,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        actionApprovalPort,
      }),
    );
    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        actionApprovalPort,
        assistantDeliveryEffects: [deliveryEffect],
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
        vaultRoot: "/tmp/murph-vault",
      }),
    );
  });

  it("yields prepared background outbox delivery when foreground work appears before post-checkpoint drain", async () => {
    const deliveryEffect = createDeliveryEffect();
    const preparedDispatches = createPreparedDispatchesForDeliveryEffect(deliveryEffect);
    let shouldYield = false;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      shouldYield = true;
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:00:30.000Z",
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
      shouldYieldBackgroundMaintenance: () => shouldYield,
      workspace: createDueAssistantWorkspace(),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      progressed: true,
    }));
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: false,
      }),
    );
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).toHaveBeenCalledWith({
      effects: [deliveryEffect],
      preparedDispatches,
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: "2026-04-27T00:00:00.000Z",
        hostedOutboxDeliveryYielded: 1,
        nextWakeAt: "2026-04-27T00:00:00.000Z",
      }),
    }));
  });

  it("yields prepared background outbox delivery when foreground work appears after the member-channel barrier", async () => {
    const deliveryEffect = createDeliveryEffect();
    const preparedDispatches = createPreparedDispatchesForDeliveryEffect(deliveryEffect);
    let shouldYield = false;
    const prepareAutoReplyDelivery = vi.fn(async () => {
      shouldYield = true;
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:00:30.000Z",
    );
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
      prepareAutoReplyDelivery,
      shouldYieldBackgroundMaintenance: () => shouldYield,
      workspace: createDueAssistantWorkspace(),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result).toEqual(expect.objectContaining({
      afterCheckpointKeepsForegroundImportLoop: true,
      checkpointReason: "outbox_sending",
      progressed: true,
    }));
    expect(prepareAutoReplyDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).toHaveBeenCalledWith({
      effects: [deliveryEffect],
      preparedDispatches,
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      redactedStatus: expect.objectContaining({
        hostedOutboxDeliveryYielded: 1,
      }),
    }));
  });

  it("yields prepared background outbox delivery when foreground work appears inside the prepared drain", async () => {
    const firstDeliveryEffect = {
      ...createDeliveryEffect(),
      deliveryPhase: "background_retry" as const,
      effectId: "effect_late_yield_first",
      fingerprint: "fingerprint_late_yield_first",
      payload: {
        ...createDeliveryEffect().payload,
        idempotencyKey: "assistant-outbox:intent_late_yield_first",
      },
    };
    const secondDeliveryEffect = {
      ...createDeliveryEffect(),
      deliveryPhase: "background_retry" as const,
      effectId: "effect_late_yield_second",
      fingerprint: "fingerprint_late_yield_second",
      payload: {
        ...createDeliveryEffect().payload,
        idempotencyKey: "assistant-outbox:intent_late_yield_second",
      },
    };
    const preparedDispatches = [
      ...createPreparedDispatchesForDeliveryEffect(firstDeliveryEffect),
      ...createPreparedDispatchesForDeliveryEffect(secondDeliveryEffect),
    ];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      firstDeliveryEffect,
      secondDeliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:00:30.000Z",
    );
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async (input) => {
      expect(input.shouldYieldBackgroundDelivery?.()).toBe(false);
      input.onBackgroundDeliveryYield?.({ yieldedEffectCount: 1 });
      return [{
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "linq",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: firstDeliveryEffect.fingerprint,
        effectId: firstDeliveryEffect.effectId,
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_late_yield_first",
        providerMessageIds: [],
        providerThreadId: "thread_late_yield_first",
        retryable: false,
        target: null,
        targetKind: null,
      }];
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
      shouldYieldBackgroundMaintenance: () => false,
      workspace: createDueAssistantWorkspace(),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [firstDeliveryEffect, secondDeliveryEffect],
        onBackgroundDeliveryYield: expect.any(Function),
        preparedDispatches,
        shouldYieldBackgroundDelivery: expect.any(Function),
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:05:00.000Z",
      },
      linqMessageIds: ["provider_late_yield_first"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: "2026-04-27T00:00:00.000Z",
        hostedOutboxDeliveryYielded: 1,
        nextWakeAt: "2026-04-27T00:00:00.000Z",
      }),
    }));
  });

  it("stages terminal delivery failure input before yielding prepared background outbox delivery", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-yield-",
    ));
    try {
      const now = "2026-04-27T00:00:00.000Z";
      const intentCreatedAt = "2026-04-26T23:59:50.000Z";
      await seedDirectLinqAssistantInputRoute({
        enabledAt: intentCreatedAt,
        vaultRoot,
      });
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      const baseEffect = createDeliveryEffect();
      const firstDeliveryEffect = {
        ...baseEffect,
        deliveryPhase: "background_retry" as const,
        effectId: "intent_terminal_failure_late_yield_first",
        fingerprint: "fingerprint_terminal_failure_late_yield_first",
        payload: {
          ...baseEffect.payload,
          channel: "linq" as const,
          idempotencyKey:
            "assistant-outbox:intent_terminal_failure_late_yield_first",
          media: [{
            approvalGeneration: "b".repeat(64),
            approvalId: "approval_terminal_failure_late_yield",
            contentType: "application/pdf",
            filename: "lab-results.pdf",
            kind: "vault_file" as const,
            ref: "documents/lab-results.pdf",
            sha256: "a".repeat(64),
            sizeBytes: 1234,
          }, {
            alt: "Start position",
            kind: "image" as const,
            source: "exercise_catalog:movement:1",
            url: "https://cdn.example.test/exercises/start.png",
          }],
        },
      };
      const secondDeliveryEffect = {
        ...createDeliveryEffect(),
        deliveryPhase: "background_retry" as const,
        effectId: "intent_terminal_failure_late_yield_second",
        fingerprint: "fingerprint_terminal_failure_late_yield_second",
        payload: {
          ...createDeliveryEffect().payload,
          channel: "linq" as const,
          idempotencyKey:
            "assistant-outbox:intent_terminal_failure_late_yield_second",
        },
      };
      const preparedDispatches = [
        ...createPreparedDispatchesForDeliveryEffect(firstDeliveryEffect),
        ...createPreparedDispatchesForDeliveryEffect(secondDeliveryEffect),
      ];
      const terminalFailure = {
        ...createFailedDeliveryOutcome({
          deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
          effectId: firstDeliveryEffect.effectId,
        }),
        deliveryStatus: "failed" as const,
        effectFingerprint: firstDeliveryEffect.fingerprint,
        retryable: false,
      };
      let shouldYield = false;
      mocks.readAssistantOutboxIntent.mockImplementation(async (
        _vaultRoot: string,
        intentId: string,
      ) => intentId === firstDeliveryEffect.effectId
        ? createTerminalFailureOutboxIntent({
          bindingDeliveryTarget: "linq_chat_direct",
          channel: "linq",
          createdAt: intentCreatedAt,
          effectId: firstDeliveryEffect.effectId,
          explicitTarget: null,
        })
        : null);
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        firstDeliveryEffect,
        secondDeliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
        preparedDispatches,
      });
      mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(
        "2026-04-27T00:00:30.000Z",
      );
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async (input) => {
        expect(input.shouldYieldBackgroundDelivery?.()).toBe(false);
        const outcomes = [terminalFailure];
        shouldYield = true;
        expect(input.shouldYieldBackgroundDelivery?.()).toBe(true);
        input.onBackgroundDeliveryYield?.({ yieldedEffectCount: 1 });
        return outcomes;
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        shouldYieldBackgroundMaintenance: () => shouldYield,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = await result.afterCheckpoint?.();

      expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
      expect(mocks.resetHostedPreparedAssistantDeliveryEffects).not.toHaveBeenCalled();
      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: now,
        nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
        redactedStatus: expect.objectContaining({
          hostedAssistantNextWakeAt: now,
          hostedOutboxDeliveryYielded: 1,
          hostedOutboxTerminalFailureInputsStaged: 1,
          nextWakeAt: now,
        }),
      }));
      const pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      const event = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: pendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(event?.sourceRef.kind).toBe("hosted-mailbox");
      if (event?.sourceRef.kind !== "hosted-mailbox") {
        throw new Error("Expected hosted-mailbox terminal failure input.");
      }
      expect(event.sourceRef.causalSeq).toBeUndefined();
      expect(event.sourceRef.eventId).toBe(
        `outbox-delivery-failed:${firstDeliveryEffect.effectId}`,
      );
      expect(event?.replyTarget).toEqual({
        channel: "linq",
        messageId: null,
        threadId: "linq_chat_direct",
      });
      expect(event?.occurredAt).toBe(intentCreatedAt);
      expect(event?.content.text).toContain(
        "outgoing message failed to send and was NOT delivered",
      );
      expect(event?.content.text).toContain('vault file "lab-results.pdf"');
      expect(event?.content.text).toContain("1 image");
      expect(event?.content.text).toContain(
        "A text-only substitute is not equivalent; do not offer or send one as recovery",
      );
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it.each([
    {
      bindingDelivery: { kind: "thread" as const, target: "linq_chat_direct" },
      cronStatusAvailable: true,
      label: "direct-thread",
    },
    {
      bindingDelivery: { kind: "participant" as const, target: "member_synthetic" },
      cronStatusAvailable: false,
      label: "participant",
    },
  ])(
    "re-arms cron without a failure note after an authority-stale $label delivery",
    async ({ bindingDelivery, cronStatusAvailable, label }) => {
      const vaultRoot = await mkdtemp(path.join(
        tmpdir(),
        `murph-outbox-authority-stale-${label}-`,
      ));
      try {
        const now = "2026-04-27T00:00:00.000Z";
        const cronRetryAt = "2026-04-27T00:00:30.000Z";
        const effect = {
          ...createDeliveryEffect(),
          deliveryPhase: "background_retry" as const,
          effectId: `intent_authority_stale_${label}`,
          fingerprint: `fingerprint_authority_stale_${label}`,
          payload: {
            ...createDeliveryEffect().payload,
            channel: "linq" as const,
            idempotencyKey: `assistant-outbox:intent_authority_stale_${label}`,
          },
        };
        const authorityStaleOutcome = {
          ...createFailedDeliveryOutcome({
            deliveryErrorCode: "ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE",
            effectId: effect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: effect.fingerprint,
          retryable: false,
        };
        let deliverySettled = false;
        mocks.readAssistantOutboxIntent.mockResolvedValue(
          createTerminalFailureOutboxIntent({
            bindingDelivery,
            createdAt: "2026-04-26T23:59:50.000Z",
            effectId: effect.effectId,
          }),
        );
        mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
          effect,
        ]);
        mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(
          async () => {
            deliverySettled = true;
            return [authorityStaleOutcome];
          },
        );
        mocks.getAssistantCronStatus.mockImplementation(async () => {
          if (deliverySettled && !cronStatusAvailable) {
            throw new Error("cron status temporarily unavailable");
          }
          return deliverySettled
            ? {
                dueJobs: 0,
                enabledJobs: 1,
                nextRunAt: cronRetryAt,
                runningJobs: 0,
                totalJobs: 1,
              }
            : {
                dueJobs: 0,
                enabledJobs: 0,
                nextRunAt: null,
                runningJobs: 0,
                totalJobs: 0,
              };
        });

        const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
          now: () => now,
          vaultRoot,
          workspace: createDueAssistantWorkspace(),
        }));
        const postCheckpoint = await result.afterCheckpoint?.();

        expect(postCheckpoint).toEqual(expect.objectContaining({
          checkpointReason: "outbox_receipt",
          nextWakeAt: cronRetryAt,
          redactedStatus: expect.objectContaining({
            hostedAssistantNextWakeAt: cronRetryAt,
            hostedOutboxTerminalFailureInputsStaged: 0,
            nextWakeAt: cronRetryAt,
          }),
        }));
        expect(mocks.getAssistantCronStatus).toHaveBeenLastCalledWith(
          vaultRoot,
          expect.any(Object),
        );
        await expect(readExistingHostedPendingAssistantInputIds({
          vaultRoot,
        })).resolves.toEqual([]);
      } finally {
        await rm(vaultRoot, { force: true, recursive: true });
      }
    },
  );

  it("does not carry device-sync next-wake reasons from the assistant automation lane", async () => {
    const nextWakeAt = new Date(Date.now() + 60_000).toISOString();
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      workspace: createDueAssistantWorkspace(),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      nextWakeAt,
      progressed: true,
    }));
    expect(result).not.toHaveProperty("nextWakeReason");
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt,
    }));
    expect(postCheckpoint?.nextWakeReason).not.toBe("device-sync.reconcile");
  });

  it("clears a consumed assistant wake after post-checkpoint delivery", async () => {
    let now = "2026-05-08T16:00:00.000Z";
    const consumedWakeAt = "2026-05-08T16:00:05.000Z";
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      nextWakeAt: consumedWakeAt,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
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
      now: () => now,
      workspace: createDueAssistantWorkspace(),
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      nextWakeAt: consumedWakeAt,
    }));

    now = "2026-05-08T16:00:08.000Z";
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedOutboxDeliveryAttempted: 1,
        hostedOutboxDeliverySent: 1,
        hostedOutboxPendingDeliveryEffects: 0,
        hostedOutboxTerminalizedSending: 1,
        nextWakeAt: null,
      }),
    }));
  });

  it("drops a consumed workspace assistant wake echo when post-delivery cron status is unavailable", async () => {
    const consumedWakeAt = "2026-05-08T16:00:05.000Z";
    mocks.getAssistantCronStatus
      .mockResolvedValueOnce({
        dueJobs: 0,
        enabledJobs: 0,
        nextRunAt: null,
        runningJobs: 0,
        totalJobs: 0,
      })
      .mockRejectedValueOnce(new Error("cron status unavailable"));
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      nextWakeAt: consumedWakeAt,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
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
      now: () => "2026-05-08T16:00:08.000Z",
      workspace: createDueAssistantWorkspace({
        checkpointedAt: "2026-05-08T16:00:00.000Z",
        createdAt: "2026-05-08T16:00:00.000Z",
        nextWakeAt: consumedWakeAt,
        updatedAt: "2026-05-08T16:00:00.000Z",
      }),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedOutboxDeliverySent: 1,
        nextWakeAt: null,
      }),
    }));
  });

  it("preserves a post-delivery outbox-only wake with delivery ownership", async () => {
    let now = "2026-05-08T16:00:00.000Z";
    const consumedWakeAt = "2026-05-08T16:00:05.000Z";
    mocks.resolveHostedAssistantOutboxNextWakeAt
      .mockResolvedValueOnce(consumedWakeAt);
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      assistantAutomationOutboxOnlyNextWakeAt: consumedWakeAt,
      nextWakeAt: consumedWakeAt,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
      now = "2026-05-08T16:00:08.000Z";
      return [
        {
          cleanupMessages: [],
          cleanupTargetAliases: [],
          deliveryChannel: "telegram",
          deliveryErrorCode: null,
          deliveryErrorMessage: null,
          deliveryStatus: "sent",
          effectFingerprint: "fingerprint_synthetic",
          effectId: "effect_synthetic",
          journalMethod: "PUT",
          journalStatus: "200",
          providerMessageId: null,
          providerMessageIds: [],
          providerThreadId: "thread_synthetic",
          retryable: false,
          target: null,
          targetKind: null,
        },
      ];
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => now,
      workspace: createDueAssistantWorkspace({
        checkpointedAt: "2026-05-08T16:00:00.000Z",
        createdAt: "2026-05-08T16:00:00.000Z",
        nextWakeAt: consumedWakeAt,
        updatedAt: "2026-05-08T16:00:00.000Z",
      }),
    }));

    expect(mocks.resolveHostedAssistantOutboxNextWakeAt).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: consumedWakeAt,
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: consumedWakeAt,
        hostedOutboxDeliverySent: 1,
        nextWakeAt: consumedWakeAt,
      }),
    }));
  });

  it("drops a consumed workspace assistant wake after fresh system-mailbox delivery", async () => {
    let now = "2026-05-08T16:00:00.000Z";
    const consumedWakeAt = "2026-05-08T16:00:05.000Z";
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      nextWakeAt: consumedWakeAt,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
      now = "2026-05-08T16:00:08.000Z";
      return [
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
      ];
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
      workspace: createDueAssistantWorkspace({
        checkpointedAt: "2026-05-08T16:00:00.000Z",
        createdAt: "2026-05-08T16:00:00.000Z",
        nextWakeAt: consumedWakeAt,
        updatedAt: "2026-05-08T16:00:00.000Z",
      }),
    }));

    expect(mocks.resolveHostedAssistantOutboxNextWakeAt).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-05-08T16:05:08.000Z",
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: "2026-05-08T16:05:08.000Z",
        hostedOutboxDeliverySent: 1,
        nextWakeAt: "2026-05-08T16:05:08.000Z",
      }),
    }));
  });

  it("preserves a pending system-mailbox wake matching a consumed assistant wake after delivery", async () => {
    let now = "2026-05-08T16:00:00.000Z";
    const consumedWakeAt = "2026-05-08T16:00:05.000Z";
    mocks.resolveHostedSystemMailboxNextWakeAt.mockImplementation(async () =>
      now === "2026-05-08T16:00:00.000Z" ? null : consumedWakeAt
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      nextWakeAt: consumedWakeAt,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
      now = "2026-05-08T16:00:08.000Z";
      return [
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
      ];
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => now,
      workspace: createDueAssistantWorkspace({
        checkpointedAt: "2026-05-08T16:00:00.000Z",
        createdAt: "2026-05-08T16:00:00.000Z",
        nextWakeAt: consumedWakeAt,
        updatedAt: "2026-05-08T16:00:00.000Z",
      }),
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: consumedWakeAt,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: consumedWakeAt,
        hostedOutboxDeliverySent: 1,
        nextWakeAt: consumedWakeAt,
      }),
    }));
  });

  it("routes terminal delivery failure pending input to the failed intent thread, not the current session", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-route-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      await seedDirectLinqAssistantInputRoute({
        actorId: "actor_linq_a",
        deliveryTarget: "linq_chat_a",
        enabledAt: intentCreatedAt,
        identityId: "identity_linq_a",
        sessionId: "asst_linq_a",
        threadId: "thread_linq_a",
        vaultRoot,
      });
      await seedDirectLinqAssistantInputRoute({
        actorId: "actor_linq_b",
        deliveryTarget: "linq_chat_b",
        enabledAt: "2026-05-08T16:00:05.000Z",
        identityId: "identity_linq_b",
        sessionId: "asst_linq_b",
        threadId: "thread_linq_b",
        vaultRoot,
      });
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      const baseEffect = createDeliveryEffect();
      const deliveryEffect = {
        ...baseEffect,
        effectId: "intent_terminal_failure_thread_a",
        fingerprint: "fingerprint_terminal_failure_thread_a",
        payload: {
          ...baseEffect.payload,
          channel: "linq" as const,
          idempotencyKey: "assistant-outbox:intent_terminal_failure_thread_a",
        },
      };
      const terminalFailure = {
        ...createFailedDeliveryOutcome({
          deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
          effectId: deliveryEffect.effectId,
        }),
        deliveryStatus: "failed" as const,
        effectFingerprint: deliveryEffect.fingerprint,
        retryable: false,
      };
      mocks.readAssistantOutboxIntent.mockImplementation(async (
        _vaultRoot: string,
        intentId: string,
      ) => intentId === deliveryEffect.effectId
        ? createTerminalFailureOutboxIntent({
          actorId: "actor_linq_a",
          bindingDeliveryTarget: "linq_chat_a",
          channel: "linq",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          identityId: "identity_linq_a",
          replyToMessageId: "linq_message_a",
          threadId: "thread_linq_a",
          threadIsDirect: true,
        })
        : null);
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementation(async () => {
        return [terminalFailure];
      });

      const firstResult = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const firstPostCheckpoint = firstResult.afterCheckpoint
        ? await firstResult.afterCheckpoint()
        : firstResult;

      expect(firstPostCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 1,
          hostedOutboxTerminalizedSending: 1,
        }),
      }));
      const pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      const event = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: pendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(event?.conversation).toEqual({
        accountId: "identity_linq_a",
        actorId: "actor_linq_a",
        actorIsSelf: false,
        sessionId: null,
        source: "linq",
        threadId: "thread_linq_a",
        threadIsDirect: true,
      });
      expect(event?.replyTarget).toEqual({
        channel: "linq",
        messageId: null,
        threadId: "linq_chat_a",
      });
      expect(event?.conversation?.threadId).not.toBe("thread_linq_b");
      expect(event?.replyTarget?.threadId).not.toBe("linq_chat_b");
      expect(event?.occurredAt).toBe(intentCreatedAt);
      expect(event?.receivedAt).toBe(intentCreatedAt);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("routes terminal delivery failure pending input to the explicit target when it overrides binding delivery", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-explicit-target-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      await seedDirectLinqAssistantInputRoute({
        actorId: "actor_linq_a",
        deliveryTarget: "linq_chat_a",
        enabledAt: intentCreatedAt,
        identityId: "identity_linq_a",
        sessionId: "asst_linq_a",
        threadId: "thread_linq_a",
        vaultRoot,
      });
      await seedDirectLinqAssistantInputRoute({
        actorId: "actor_linq_b",
        deliveryTarget: "linq_chat_b",
        enabledAt: "2026-05-08T16:00:05.000Z",
        identityId: "identity_linq_b",
        sessionId: "asst_linq_b",
        threadId: "thread_linq_b",
        vaultRoot,
      });
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      const baseEffect = createDeliveryEffect();
      const deliveryEffect = {
        ...baseEffect,
        effectId: "intent_terminal_failure_explicit_target",
        fingerprint: "fingerprint_terminal_failure_explicit_target",
        payload: {
          ...baseEffect.payload,
          channel: "linq" as const,
          idempotencyKey: "assistant-outbox:intent_terminal_failure_explicit_target",
        },
      };
      const terminalFailure = {
        ...createFailedDeliveryOutcome({
          deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
          effectId: deliveryEffect.effectId,
        }),
        deliveryStatus: "failed" as const,
        effectFingerprint: deliveryEffect.fingerprint,
        retryable: false,
      };
      mocks.readAssistantOutboxIntent.mockImplementation(async (
        _vaultRoot: string,
        intentId: string,
      ) => intentId === deliveryEffect.effectId
        ? createTerminalFailureOutboxIntent({
          actorId: "actor_linq_b",
          bindingDelivery: { kind: "thread", target: "linq_chat_a" },
          channel: "linq",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: "linq_chat_b",
          identityId: "identity_linq_b",
          replyToMessageId: "linq_message_b",
          threadId: "thread_linq_b",
          threadIsDirect: true,
        })
        : null);
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        terminalFailure,
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 1,
          hostedOutboxTerminalizedSending: 1,
        }),
      }));
      const pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      const event = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: pendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(event?.replyTarget?.threadId).toBe("linq_chat_b");
      expect(event?.replyTarget?.threadId).not.toBe("linq_chat_a");
      expect(event?.conversation?.threadId).toBe("thread_linq_b");
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps terminal delivery failure input idempotent after the current session changes", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-idempotent-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const laterNow = "2026-05-08T16:05:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      await seedDirectLinqAssistantInputRoute({
        actorId: "actor_linq_a",
        deliveryTarget: "linq_chat_a",
        enabledAt: intentCreatedAt,
        identityId: "identity_linq_a",
        sessionId: "asst_linq_a",
        threadId: "thread_linq_a",
        vaultRoot,
      });
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      const baseEffect = createDeliveryEffect();
      const deliveryEffect = {
        ...baseEffect,
        effectId: "intent_terminal_failure_idempotent",
        fingerprint: "fingerprint_terminal_failure_idempotent",
        payload: {
          ...baseEffect.payload,
          channel: "linq" as const,
          idempotencyKey: "assistant-outbox:intent_terminal_failure_idempotent",
        },
      };
      const terminalFailure = {
        ...createFailedDeliveryOutcome({
          deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
          effectId: deliveryEffect.effectId,
        }),
        deliveryStatus: "failed" as const,
        effectFingerprint: deliveryEffect.fingerprint,
        retryable: false,
      };
      mocks.readAssistantOutboxIntent.mockImplementation(async (
        _vaultRoot: string,
        intentId: string,
      ) => intentId === deliveryEffect.effectId
        ? createTerminalFailureOutboxIntent({
          actorId: "actor_linq_a",
          bindingDeliveryTarget: "linq_chat_a",
          channel: "linq",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          identityId: "identity_linq_a",
          replyToMessageId: "linq_message_a",
          threadId: "thread_linq_a",
          threadIsDirect: true,
        })
        : null);
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        terminalFailure,
      ]);

      const firstResult = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const firstPostCheckpoint = firstResult.afterCheckpoint
        ? await firstResult.afterCheckpoint()
        : firstResult;
      expect(firstPostCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 1,
        }),
      }));
      const firstPendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(firstPendingInputIds).toHaveLength(1);
      const firstEvent = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: firstPendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(firstEvent?.replyTarget?.threadId).toBe("linq_chat_a");

      await seedDirectLinqAssistantInputRoute({
        actorId: "actor_linq_b",
        deliveryTarget: "linq_chat_b",
        enabledAt: laterNow,
        identityId: "identity_linq_b",
        sessionId: "asst_linq_b",
        threadId: "thread_linq_b",
        vaultRoot,
      });
      const secondResult = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => laterNow,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const secondPostCheckpoint = secondResult.afterCheckpoint
        ? await secondResult.afterCheckpoint()
        : secondResult;
      expect(secondPostCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 1,
        }),
      }));
      const secondPendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(secondPendingInputIds).toEqual(firstPendingInputIds);
      const secondEvent = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: secondPendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(secondEvent?.replyTarget?.threadId).toBe("linq_chat_a");
      expect(secondEvent?.conversation?.threadId).toBe("thread_linq_a");
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps terminal member-facing delivery failure pending input replyable through compaction and the next assistant pass", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-compaction-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const laterNow = "2026-05-08T16:05:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      await seedDirectLinqAssistantInputRoute({
        enabledAt: intentCreatedAt,
        vaultRoot,
      });
      mocks.resolveHostedPendingAssistantInputWakeAt.mockImplementation(
        resolveHostedPendingAssistantInputWakeAtWithRealImplementation,
      );
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      mocks.readAssistantInputEvent.mockImplementation(
        actualAssistantAutomation.readAssistantInputEvent,
      );
      const baseEffect = createDeliveryEffect();
      const deliveryEffect = {
        ...baseEffect,
        effectId: "intent_vault_file_terminal_failure",
        fingerprint: "fingerprint_vault_file_terminal_failure",
        payload: {
          ...baseEffect.payload,
          channel: "linq" as const,
          idempotencyKey: "assistant-outbox:intent_vault_file_terminal_failure",
          media: [{
            approvalGeneration: "b".repeat(64),
            approvalId: "approval_vault_file_terminal_failure",
            contentType: "application/pdf",
            filename: "lab-results.pdf",
            kind: "vault_file" as const,
            ref: "documents/lab-results.pdf",
            sha256: "a".repeat(64),
            sizeBytes: 1234,
          }],
        },
      };
      const terminalFailure = {
        ...createFailedDeliveryOutcome({
          deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
          effectId: deliveryEffect.effectId,
        }),
        deliveryStatus: "failed" as const,
        effectFingerprint: deliveryEffect.fingerprint,
        retryable: false,
      };
      mocks.readAssistantOutboxIntent.mockImplementation(async (
        _vaultRoot: string,
        intentId: string,
      ) => intentId === deliveryEffect.effectId
        ? createTerminalFailureOutboxIntent({
          bindingDeliveryTarget: "linq_chat_direct",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
        })
        : null);
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        terminalFailure,
      ]);

      const firstResult = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const firstPostCheckpoint = firstResult.afterCheckpoint
        ? await firstResult.afterCheckpoint()
        : firstResult;

      expect(firstPostCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: now,
        nextWakeReason: "assistant",
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 1,
          hostedOutboxTerminalizedSending: 1,
        }),
      }));
      let pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      await expect(resolveHostedPendingAssistantInputWakeAtWithRealImplementation({
        now: () => now,
        vaultRoot,
      })).resolves.toBe(now);
      pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      const event = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: pendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(event?.conversation?.source).toBe("linq");
      expect(event?.replyTarget).toEqual({
        channel: "linq",
        messageId: null,
        threadId: "linq_chat_direct",
      });
      expect(event?.occurredAt).toBe(intentCreatedAt);
      expect(event?.receivedAt).toBe(intentCreatedAt);
      expect(event?.content.text).toContain(
        "outgoing message failed to send and was NOT delivered",
      );
      expect(event?.content.text).toContain("channel: linq");
      expect(event?.content.text).toContain("failure code: LINQ_API_REQUEST_FAILED");
      expect(event?.content.text).toContain('vault file "lab-results.pdf"');
      expect(event?.content.text).toContain(
        "Any consumed vault-file approval must be re-requested before retrying",
      );
      expect(event?.content.text).not.toContain("documents/lab-results.pdf");
      expect(event?.content.text).not.toContain("presigned");

      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([]);
      const noteTextsSeenByAssistantPass: string[] = [];
      mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
        expect(laneInput.freshAssistantInputIds).toEqual([event?.inputId]);
        for (const inputId of laneInput.freshAssistantInputIds) {
          const actualEvent = await actualAssistantAutomation.readAssistantInputEvent({
            inputId,
            vault: vaultRoot,
          });
          if (actualEvent?.content.text) {
            noteTextsSeenByAssistantPass.push(actualEvent.content.text);
          }
        }
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: true,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      });

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [event!.inputId],
        importedCount: 1,
        now: () => laterNow,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));

      expect(noteTextsSeenByAssistantPass).toHaveLength(1);
      expect(noteTextsSeenByAssistantPass[0]).toContain(
        "outgoing message failed to send and was NOT delivered",
      );

      pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      expect(pendingInputIds[0]).toBe(event?.inputId);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("stages terminal delivery failure input when a mixed reply answered a failure note and a user message", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-mixed-one-hop-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId: "intent_terminal_failure_mixed_recovery_reply",
        fingerprint: "fingerprint_terminal_failure_mixed_recovery_reply",
        payload: {
          ...createDeliveryEffect().payload,
          channel: "linq" as const,
          idempotencyKey:
            "assistant-outbox:intent_terminal_failure_mixed_recovery_reply",
        },
      };
      mocks.readAssistantOutboxIntent.mockResolvedValue(
        createTerminalFailureOutboxIntent({
          actorId: "actor_linq_direct",
          answeredMailboxItemIds: [
            "outbox-delivery-failed:intent_original_terminal_failure",
            "hosted-mailbox-item-user-b",
          ],
          bindingDeliveryTarget: "linq_chat_direct",
          channel: "linq",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          identityId: "identity_linq_direct",
          replyToMessageId: "linq_message_direct",
          threadId: "thread_linq_direct",
          threadIsDirect: true,
        }),
      );
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        {
          ...createFailedDeliveryOutcome({
            deliveryChannel: "linq",
            deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
            effectId: deliveryEffect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: deliveryEffect.fingerprint,
          retryable: false,
        },
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 1,
          hostedOutboxTerminalizedSending: 1,
        }),
      }));
      const pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      const event = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: pendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(event?.sourceRef.kind).toBe("hosted-mailbox");
      if (event?.sourceRef.kind !== "hosted-mailbox") {
        throw new Error("Expected hosted-mailbox terminal failure input.");
      }
      expect(event.sourceRef.eventId).toBe(
        "outbox-delivery-failed:intent_terminal_failure_mixed_recovery_reply",
      );
      expect(event?.replyTarget).toEqual({
        channel: "linq",
        messageId: null,
        threadId: "linq_chat_direct",
      });
      expect(event?.conversation?.threadId).toBe("thread_linq_direct");
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not stage pending assistant input when a terminal failure was itself replying to a failure note", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-one-hop-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId: "intent_terminal_failure_recovery_reply",
        fingerprint: "fingerprint_terminal_failure_recovery_reply",
        payload: {
          ...createDeliveryEffect().payload,
          channel: "telegram" as const,
          idempotencyKey:
            "assistant-outbox:intent_terminal_failure_recovery_reply",
        },
      };
      mocks.readAssistantOutboxIntent.mockResolvedValue(
        createTerminalFailureOutboxIntent({
          actorId: "actor_telegram_direct",
          answeredMailboxItemIds: [
            "outbox-delivery-failed:intent_original_terminal_failure",
          ],
          bindingDeliveryTarget: "telegram_chat_direct",
          channel: "telegram",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          identityId: "identity_telegram_direct",
          replyToMessageId: "telegram_message_direct",
          threadId: "thread_telegram_direct",
          threadIsDirect: true,
        }),
      );
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        {
          ...createFailedDeliveryOutcome({
            deliveryChannel: "telegram",
            deliveryErrorCode: "TELEGRAM_SEND_FAILED",
            effectId: deliveryEffect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: deliveryEffect.fingerprint,
          retryable: false,
        },
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 0,
          hostedOutboxTerminalizedSending: 1,
        }),
      }));
      await expect(readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not stage pending assistant input for terminal failures without a durable direct route on the intent", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-no-route-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: intentCreatedAt,
        }],
        updatedAt: intentCreatedAt,
        version: 1,
      });
      mocks.resolveHostedPendingAssistantInputWakeAt.mockImplementation(
        resolveHostedPendingAssistantInputWakeAtWithRealImplementation,
      );
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      mocks.readAssistantInputEvent.mockImplementation(
        actualAssistantAutomation.readAssistantInputEvent,
      );
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId: "intent_vault_file_terminal_failure_no_route",
        fingerprint: "fingerprint_vault_file_terminal_failure_no_route",
        payload: {
          ...createDeliveryEffect().payload,
          channel: "linq" as const,
          idempotencyKey:
            "assistant-outbox:intent_vault_file_terminal_failure_no_route",
        },
      };
      mocks.readAssistantOutboxIntent.mockResolvedValue(
        createTerminalFailureOutboxIntent({
          bindingDeliveryTarget: null,
          channel: null,
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          threadId: null,
          threadIsDirect: null,
        }),
      );
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        {
          ...createFailedDeliveryOutcome({
            deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
            effectId: deliveryEffect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: deliveryEffect.fingerprint,
          retryable: false,
        },
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 0,
        }),
      }));
      await expect(readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not stage pending assistant input for terminal reaction operation failures", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-reaction-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId: "intent_telegram_reaction_terminal_failure",
        fingerprint: "fingerprint_telegram_reaction_terminal_failure",
        payload: {
          ...createDeliveryEffect().payload,
          channel: "telegram" as const,
          idempotencyKey:
            "assistant-outbox:intent_telegram_reaction_terminal_failure",
        },
      };
      mocks.readAssistantOutboxIntent.mockResolvedValue(
        createTerminalFailureOutboxIntent({
          actorId: "actor_telegram_direct",
          bindingDeliveryTarget: "telegram_chat_direct",
          channel: "telegram",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          identityId: "identity_telegram_direct",
          operation: {
            kind: "message-reaction",
            reaction: "heart",
          },
          replyToMessageId: "telegram_message_direct",
          threadId: "thread_telegram_direct",
          threadIsDirect: true,
        }),
      );
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        {
          ...createFailedDeliveryOutcome({
            deliveryChannel: "telegram",
            deliveryErrorCode: "TELEGRAM_REACTION_DELIVERY_FAILED",
            effectId: deliveryEffect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: deliveryEffect.fingerprint,
          retryable: false,
        },
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 0,
          hostedOutboxTerminalizedSending: 1,
        }),
      }));
      await expect(readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not stage pending assistant input for participant terminal failure delivery candidates", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-participant-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: intentCreatedAt,
        }],
        updatedAt: intentCreatedAt,
        version: 1,
      });
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId: "intent_vault_file_terminal_failure_participant",
        fingerprint: "fingerprint_vault_file_terminal_failure_participant",
        payload: {
          ...createDeliveryEffect().payload,
          channel: "linq" as const,
          idempotencyKey:
            "assistant-outbox:intent_vault_file_terminal_failure_participant",
        },
      };
      mocks.readAssistantOutboxIntent.mockResolvedValue(
        createTerminalFailureOutboxIntent({
          bindingDelivery: { kind: "participant", target: "+15550000001" },
          channel: "linq",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          threadId: "thread_linq_direct",
          threadIsDirect: true,
        }),
      );
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        {
          ...createFailedDeliveryOutcome({
            deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
            effectId: deliveryEffect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: deliveryEffect.fingerprint,
          retryable: false,
        },
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 0,
        }),
      }));
      await expect(readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not stage terminal failure input for email because it has no supported direct reply route here", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-email-terminal-failure-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId: "intent_email_terminal_failure",
        fingerprint: "fingerprint_email_terminal_failure",
        payload: {
          ...createDeliveryEffect().payload,
          idempotencyKey: "assistant-outbox:intent_email_terminal_failure",
        },
      };
      mocks.readAssistantOutboxIntent.mockResolvedValue(
        createTerminalFailureOutboxIntent({
          bindingDeliveryTarget: "email_thread_direct",
          channel: "email",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: "email_thread_direct",
          threadId: "email_thread_direct",
          threadIsDirect: true,
        }),
      );
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        {
          ...createFailedDeliveryOutcome({
            deliveryChannel: "email",
            deliveryErrorCode: "EMAIL_SEND_FAILED",
            effectId: deliveryEffect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: deliveryEffect.fingerprint,
          retryable: false,
        },
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 0,
        }),
      }));
      await expect(readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not stage pending assistant input for retryable delivery failures", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-retryable-failure-",
    ));
    try {
      const deliveryEffect = createDeliveryEffect();
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        createFailedDeliveryOutcome({
          deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
          effectId: deliveryEffect.effectId,
        }),
      ]);
      mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(null);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 0,
        }),
      }));
      await expect(readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("fast-dispatches idempotent active nudge delivery before the runner checkpoint", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
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
      now: () => "2026-05-08T16:00:00.000Z",
    }));

    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    await expect(result.afterCheckpoint?.()).resolves.toBeNull();
    expect(result.checkpointReason).toBe("outbox_receipt");
    expect(result.redactedStatus).toEqual(expect.objectContaining({
      hostedOutboxDeliveryAttempted: 1,
      hostedOutboxDeliverySent: 1,
      hostedOutboxPendingDeliveryEffects: 0,
      hostedOutboxTerminalizedSending: 1,
      nextWakeAt: null,
    }));
    expect(result.nextWakeAt).toBeNull();
    expect(mocks.drainHostedPreparedAssistantDeliveries)
      .toHaveBeenCalledTimes(1);
    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
  });

  it.each([
    {
      cronStatus: {
        dueJobs: 2,
        enabledJobs: 7,
        nextRunAt: "2026-05-08T16:00:00.000Z",
        runningJobs: 0,
        totalJobs: 7,
      },
      expectedNextWakeAt: "2026-05-08T16:00:00.000Z",
      label: "available due work",
    },
    {
      cronStatus: {
        dueJobs: 0,
        enabledJobs: 7,
        nextRunAt: "2026-05-08T17:00:00.000Z",
        runningJobs: 0,
        totalJobs: 7,
      },
      expectedNextWakeAt: "2026-05-08T17:00:00.000Z",
      label: "available future work",
    },
    {
      cronStatus: {
        dueJobs: 0,
        enabledJobs: 0,
        nextRunAt: null,
        runningJobs: 0,
        totalJobs: 0,
      },
      expectedNextWakeAt: null,
      label: "available empty state",
    },
    {
      cronStatus: null,
      expectedNextWakeAt: null,
      label: "unavailable status",
    },
  ])(
    "reconciles live post-scan cron status through clean fast dispatch: $label",
    async ({ cronStatus, expectedNextWakeAt }) => {
      const now = "2026-05-08T16:00:00.000Z";
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCronProcessed: 1,
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      });
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        createDeliveryEffect(),
      ]);
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
        createSentDeliveryOutcome(),
      ]);
      mocks.getAssistantCronStatus.mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 7,
        nextRunAt: now,
        runningJobs: 0,
        totalJobs: 7,
      });
      if (cronStatus) {
        mocks.getAssistantCronStatus.mockResolvedValueOnce(cronStatus);
      } else {
        mocks.getAssistantCronStatus.mockRejectedValueOnce(
          new Error("synthetic cron status unavailable"),
        );
      }

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [],
        conversationImportedCount: 0,
        importedCount: 1,
        now: () => now,
        workspace: createDueAssistantWorkspace({
          nextWakeAt: now,
        }),
      }));

      expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledTimes(1);
      expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(2);
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: expectedNextWakeAt,
        progressed: true,
      }));
    },
  );

  it("returns a fast-dispatch foreground reply without starting a stalled cron read", async () => {
    const cronStatusPromise = new Promise<never>(() => undefined);
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.getAssistantCronStatus.mockReturnValueOnce(cronStatusPromise);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createSentDeliveryOutcome(),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-05-08T16:00:00.000Z",
    }));

    expect(mocks.drainHostedPreparedAssistantDeliveries)
      .toHaveBeenCalledTimes(1);
    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(result.nextWakeAt).toBeNull();
  });

  it("clears bootstrap-only schedule writes before deciding whether foreground maintenance is needed", async () => {
    let scheduleChanged = true;
    const clearAssistantAutomationScheduleChanged = vi.fn(() => {
      scheduleChanged = false;
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      expect(clearAssistantAutomationScheduleChanged).toHaveBeenCalledTimes(1);
      expect(scheduleChanged).toBe(false);
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: ["effect_synthetic"],
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      };
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createSentDeliveryOutcome(),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantAutomationScheduleChanged: () => scheduleChanged,
      clearAssistantAutomationScheduleChanged,
      importedCount: 1,
      now: () => "2026-05-08T16:00:00.000Z",
    }));

    expect(clearAssistantAutomationScheduleChanged).toHaveBeenCalledTimes(1);
    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(result.nextWakeAt).toBeNull();
  });

  it("arms mutation-driven cron maintenance before deferred foreground delivery drains", async () => {
    const reconciliationWakeAt = "2026-05-08T16:00:00.000Z";
    const existingDeviceSyncWakeAt = "2026-05-08T16:05:00.000Z";
    const baseDeliveryEffect = createDeliveryEffect();
    const deliveryEffect = {
      ...baseDeliveryEffect,
      payload: {
        ...baseDeliveryEffect.payload,
        transportIdempotent: false,
      },
    };
    let scheduleChanged = true;
    const clearAssistantAutomationScheduleChanged = vi.fn(() => {
      scheduleChanged = false;
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      expect(clearAssistantAutomationScheduleChanged).toHaveBeenCalledTimes(1);
      expect(scheduleChanged).toBe(false);
      scheduleChanged = true;
      return {
        assistantAutomationCronStatusDeferred: true,
        assistantAutomationCurrentTurnDeliveryIntentIds: [deliveryEffect.effectId],
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      };
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantAutomationScheduleChanged: () => scheduleChanged,
      clearAssistantAutomationScheduleChanged,
      importedCount: 1,
      now: () => reconciliationWakeAt,
      workspace: {
        checkpointedAt: "2026-05-08T15:59:00.000Z",
        createdAt: "2026-05-08T15:00:00.000Z",
        nextWakeAt: existingDeviceSyncWakeAt,
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-05-08T15:59:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(clearAssistantAutomationScheduleChanged).toHaveBeenCalledTimes(1);
    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      afterCheckpoint: expect.any(Function),
      checkpointReason: "outbox_sending",
      nextWakeAt: reconciliationWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: reconciliationWakeAt,
        hostedOutboxPendingDeliveryEffects: 1,
      }),
    }));
    expect(result).not.toHaveProperty("nextWakeReason");

    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createSentDeliveryOutcome(),
    ]);
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: reconciliationWakeAt,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: reconciliationWakeAt,
        hostedOutboxDeliverySent: 1,
        nextWakeAt: reconciliationWakeAt,
      }),
    }));
  });

  it("arms foreground cron reconciliation without status reads when no delivery effects are produced", async () => {
    const reconciliationWakeAt = "2026-05-08T16:00:00.000Z";
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCronStatusDeferred: true,
      assistantAutomationCurrentTurnDeliveryIntentIds: ["intent_missing"],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantAutomationScheduleChanged: () => true,
      importedCount: 1,
      now: () => reconciliationWakeAt,
    }));

    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: reconciliationWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: reconciliationWakeAt,
        hostedOutboxPendingDeliveryEffects: 0,
      }),
    }));
  });

  it("drops the consumed assistant cron wake after clean post-checkpoint delivery", async () => {
    vi.useFakeTimers();
    try {
      const consumedWakeAt = "2026-05-08T16:00:00.000Z";
      vi.setSystemTime(new Date("2026-05-08T16:00:00.100Z"));
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCronProcessed: 1,
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: consumedWakeAt,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      });
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        createDeliveryEffect(),
      ]);
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date("2026-05-08T16:00:01.000Z"));
        return [createSentDeliveryOutcome()];
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        workspace: {
          checkpointedAt: "2026-05-08T15:59:50.000Z",
          createdAt: "2026-05-08T15:00:00.000Z",
          nextWakeAt: consumedWakeAt,
          nextWakeReason: "assistant",
          redactedStatus: null,
          snapshotRef: null,
          updatedAt: "2026-05-08T15:59:50.000Z",
          userId: "member_synthetic_phase",
          version: "8",
        },
      }));
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_sending",
        nextWakeAt: null,
        progressed: true,
        redactedStatus: expect.objectContaining({
          hostedOutboxPendingDeliveryEffects: 1,
        }),
      }));

      const postCheckpoint = await result.afterCheckpoint?.();

      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: null,
        redactedStatus: expect.objectContaining({
          hostedOutboxDeliveryAttempted: 1,
          hostedOutboxDeliverySent: 1,
          hostedOutboxPendingDeliveryEffects: 0,
          nextWakeAt: null,
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops an available post-delivery cron wake when it is the consumed workspace wake", async () => {
    vi.useFakeTimers();
    try {
      const consumedWakeAt = "2026-05-08T16:00:00.000Z";
      vi.setSystemTime(new Date("2026-05-08T16:00:00.100Z"));
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCronProcessed: 1,
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: consumedWakeAt,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      });
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        createDeliveryEffect(),
      ]);
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date("2026-05-08T16:00:01.000Z"));
        mocks.getAssistantCronStatus.mockResolvedValueOnce({
          dueJobs: 1,
          enabledJobs: 1,
          nextRunAt: consumedWakeAt,
          runningJobs: 0,
          totalJobs: 1,
        });
        return [createSentDeliveryOutcome()];
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        now: () => consumedWakeAt,
        workspace: {
          checkpointedAt: "2026-05-08T15:59:50.000Z",
          createdAt: "2026-05-08T15:00:00.000Z",
          nextWakeAt: consumedWakeAt,
          nextWakeReason: "assistant",
          redactedStatus: null,
          snapshotRef: null,
          updatedAt: "2026-05-08T15:59:50.000Z",
          userId: "member_synthetic_phase",
          version: "8",
        },
      }));
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_sending",
        nextWakeAt: null,
        progressed: true,
      }));

      const postCheckpoint = await result.afterCheckpoint?.();

      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: null,
        redactedStatus: expect.objectContaining({
          hostedAssistantNextWakeAt: null,
          hostedOutboxDeliveryAttempted: 1,
          hostedOutboxDeliverySent: 1,
          hostedOutboxPendingDeliveryEffects: 0,
          nextWakeAt: null,
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the consumed assistant cron wake when system mailbox work is imported in the same pass", async () => {
    vi.useFakeTimers();
    try {
      const consumedWakeAt = "2026-05-08T16:00:00.000Z";
      vi.setSystemTime(new Date("2026-05-08T16:00:00.100Z"));
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCronProcessed: 1,
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: consumedWakeAt,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      });
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        createDeliveryEffect(),
      ]);
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date("2026-05-08T16:00:01.000Z"));
        return [createSentDeliveryOutcome()];
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [],
        conversationImportedCount: 0,
        importedCount: 1,
        workspace: {
          checkpointedAt: "2026-05-08T15:59:50.000Z",
          createdAt: "2026-05-08T15:00:00.000Z",
          nextWakeAt: consumedWakeAt,
          nextWakeReason: "assistant",
          redactedStatus: null,
          snapshotRef: null,
          updatedAt: "2026-05-08T15:59:50.000Z",
          userId: "member_synthetic_phase",
          version: "8",
        },
      }));

      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: null,
        progressed: true,
        redactedStatus: expect.objectContaining({
          hostedAssistantNextWakeAt: null,
          hostedOutboxDeliveryAttempted: 1,
          hostedOutboxDeliverySent: 1,
          hostedOutboxPendingDeliveryEffects: 0,
          nextWakeAt: null,
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not perform another cron read after delivering a consumed reminder", async () => {
    vi.useFakeTimers();
    try {
      const consumedWakeAt = "2026-05-08T16:00:00.000Z";
      vi.setSystemTime(new Date("2026-05-08T16:00:00.100Z"));
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCronProcessed: 1,
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: consumedWakeAt,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      });
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        createDeliveryEffect(),
      ]);
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date("2026-05-08T16:00:01.000Z"));
        return [createSentDeliveryOutcome()];
      });
      mocks.getAssistantCronStatus
        .mockResolvedValueOnce({
          dueJobs: 0,
          enabledJobs: 0,
          nextRunAt: null,
          runningJobs: 0,
          totalJobs: 0,
        })
        .mockResolvedValueOnce({
          dueJobs: 0,
          enabledJobs: 0,
          nextRunAt: null,
          runningJobs: 0,
          totalJobs: 0,
        });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        workspace: {
          checkpointedAt: "2026-05-08T15:59:50.000Z",
          createdAt: "2026-05-08T15:00:00.000Z",
          nextWakeAt: consumedWakeAt,
          nextWakeReason: "assistant",
          redactedStatus: null,
          snapshotRef: null,
          updatedAt: "2026-05-08T15:59:50.000Z",
          userId: "member_synthetic_phase",
          version: "8",
        },
      }));
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_sending",
        nextWakeAt: null,
        progressed: true,
      }));

      const postCheckpoint = await result.afterCheckpoint?.();

      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: null,
        redactedStatus: expect.objectContaining({
          hostedOutboxDeliveryAttempted: 1,
          hostedOutboxDeliverySent: 1,
          hostedOutboxPendingDeliveryEffects: 0,
          nextWakeAt: null,
        }),
      }));
      expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-arms and drains a sibling input after clean fast dispatch", async () => {
    const consumedWakeAt = "2026-05-08T16:00:00.000Z";
    const remainingInputWakeAt = "2026-05-08T16:00:01.000Z";
    const callOrder: string[] = [];
    mocks.runHostedAssistantAutomationLane
      .mockResolvedValueOnce({
        assistantAutomationProgressed: true,
        nextWakeAt: consumedWakeAt,
        redactedLogEntries: [],
      })
      .mockResolvedValueOnce({
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
      callOrder.push("delivery-terminalized");
      return [createSentDeliveryOutcome()];
    });
    mocks.resolveHostedPendingAssistantInputWakeAt
      .mockImplementationOnce(async () => {
        callOrder.push("pending-index-read");
        return remainingInputWakeAt;
      })
      .mockImplementationOnce(async () => {
        callOrder.push("pending-index-read-follow-up");
        return remainingInputWakeAt;
      });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => remainingInputWakeAt,
      workspace: {
        checkpointedAt: "2026-05-08T15:59:50.000Z",
        createdAt: "2026-05-08T15:00:00.000Z",
        nextWakeAt: consumedWakeAt,
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-05-08T15:59:50.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));
    const followUpResult = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => remainingInputWakeAt,
      workspace: {
        checkpointedAt: remainingInputWakeAt,
        createdAt: "2026-05-08T15:00:00.000Z",
        nextWakeAt: remainingInputWakeAt,
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: remainingInputWakeAt,
        userId: "member_synthetic_phase",
        version: "9",
      },
    }));

    expect(mocks.resolveHostedPendingAssistantInputWakeAt).toHaveBeenCalledWith({
      now: expect.any(Function),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(callOrder).toEqual([
      "pending-index-read",
      "delivery-terminalized",
      "pending-index-read-follow-up",
    ]);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(2);
    expect(mocks.runHostedAssistantAutomationLane.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        freshAssistantInputIds: [],
      }),
    );
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: remainingInputWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedOutboxDeliverySent: 1,
        nextWakeAt: remainingInputWakeAt,
      }),
    }));
    expect(followUpResult).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
    }));
  });

  it("preserves the assistant wake after clean fast dispatch", async () => {
    const assistantNextWakeAt = "2026-05-08T16:00:00.000Z";
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: assistantNextWakeAt,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
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
      now: () => "2026-05-08T02:28:12.000Z",
      workspace: {
        checkpointedAt: "2026-05-08T02:02:12.387Z",
        createdAt: "2026-05-08T02:02:12.387Z",
        nextWakeAt: "2026-05-08T02:02:00.725Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-05-08T02:02:12.387Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: assistantNextWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedOutboxDeliverySent: 1,
        nextWakeAt: assistantNextWakeAt,
      }),
    }));
  });

  it("preserves a near-due workspace assistant wake echo after clean fast dispatch", async () => {
    const assistantNextWakeAt = "2026-05-08T16:00:00.000Z";
    mocks.getAssistantCronStatus.mockRejectedValue(new Error("cron status unavailable"));
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: assistantNextWakeAt,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
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
      now: () => "2026-05-08T15:59:55.000Z",
      workspace: {
        checkpointedAt: "2026-05-08T15:59:40.000Z",
        createdAt: "2026-05-08T15:59:40.000Z",
        nextWakeAt: assistantNextWakeAt,
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-05-08T15:59:40.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: assistantNextWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: assistantNextWakeAt,
        hostedOutboxDeliverySent: 1,
        nextWakeAt: assistantNextWakeAt,
      }),
    }));
  });

  it.each([
    {
      deliveryNow: "2026-05-08T16:00:02.000Z",
      initialNow: "2026-05-08T16:00:01.000Z",
      label: "already due",
    },
    {
      deliveryNow: "2026-05-08T16:00:01.000Z",
      initialNow: "2026-05-08T15:59:59.000Z",
      label: "crosses due time during delivery",
    },
  ])(
    "preserves a deferred cron wake that is $label without another cron read",
    async ({ deliveryNow, initialNow }) => {
      const assistantWakeAt = "2026-05-08T16:00:00.000Z";
      let now = initialNow;
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCronStatusDeferred: true,
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      });
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        createDeliveryEffect(),
      ]);
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
        now = deliveryNow;
        return [createSentDeliveryOutcome()];
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 1,
        now: () => now,
        workspace: {
          checkpointedAt: "2026-05-08T15:59:40.000Z",
          createdAt: "2026-05-08T15:59:40.000Z",
          nextWakeAt: assistantWakeAt,
          nextWakeReason: "assistant",
          redactedStatus: null,
          snapshotRef: null,
          updatedAt: "2026-05-08T15:59:40.000Z",
          userId: "member_synthetic_phase",
          version: "8",
        },
      }));

      expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: assistantWakeAt,
        progressed: true,
        redactedStatus: expect.objectContaining({
          hostedOutboxDeliverySent: 1,
          nextWakeAt: assistantWakeAt,
        }),
      }));
    },
  );

  it.each(["assistant", null] as const)(
    "does not keep a synthetic legacy device-sync retry through clean fast dispatch for %s wakes",
    async (nextWakeReason) => {
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationProgressed: false,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      });
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        createDeliveryEffect(),
      ]);
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
        {
          cleanupMessages: [],
          cleanupTargetAliases: [],
          deliveryChannel: "telegram",
          deliveryErrorCode: null,
          deliveryErrorMessage: null,
          deliveryStatus: "sent",
          effectFingerprint: "fingerprint_synthetic",
          effectId: "effect_synthetic",
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
        now: () => "2026-05-08T02:28:12.000Z",
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
          checkpointedAt: "2026-05-08T02:02:12.387Z",
          createdAt: "2026-05-08T02:02:12.387Z",
          nextWakeAt: "2026-05-08T02:02:00.725Z",
          nextWakeReason,
          redactedStatus: null,
          snapshotRef: null,
          updatedAt: "2026-05-08T02:02:12.387Z",
          userId: "member_synthetic_phase",
          version: "8",
        },
      }));

      expectAssistantLaneCallWithoutDeviceSyncOptions({
        freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
      });
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: null,
        progressed: true,
      }));
      expect("nextWakeReason" in result).toBe(false);
    },
  );

  it("preserves a skipped non-assistant due wake after clean fast dispatch", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: "2026-05-08T16:00:00.000Z",
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
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
      now: () => "2026-05-08T02:28:12.000Z",
      workspace: {
        checkpointedAt: "2026-05-08T02:02:12.387Z",
        createdAt: "2026-05-08T02:02:12.387Z",
        nextWakeAt: "2026-05-08T02:02:00.725Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-05-08T02:02:12.387Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-05-08T02:28:42.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("fast-dispatches idempotent nudge delivery when input is admitted during the active turn", async () => {
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
        providerMessageId: "provider_synthetic",
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
    }));

    expect(result.afterCheckpoint).toBeUndefined();
    expect(result.checkpointReason).toBe("outbox_receipt");
    expect(mocks.drainHostedPreparedAssistantDeliveries)
      .toHaveBeenCalledTimes(1);
  });

  it("fast-dispatches idempotent delivery for active-turn input admitted on an alarm wake", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      activeTurnInputIngested: true,
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
        providerMessageId: "provider_synthetic",
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
    }));

    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    expect(result.checkpointReason).toBe("outbox_receipt");
    expect(mocks.drainHostedPreparedAssistantDeliveries)
      .toHaveBeenCalledTimes(1);
    await result.afterCheckpoint?.();
  });

  it("writes a warning outbox delivery summary when a committed delivery fails", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: "HOSTED_PROVIDER_FETCH_UNAVAILABLE",
        deliveryErrorMessage: "redacted",
        deliveryStatus: "failed_ambiguous",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
        journalMethod: "PUT",
        journalStatus: "500",
        providerMessageId: null,
        providerMessageIds: [],
        providerThreadId: null,
        retryable: true,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.pass_finished",
      "outbox.delivery_finished",
    ]);
    expect(filteredLogRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      component: "outbox",
      eventCode: "outbox.delivery_finished",
      level: "warn",
      phase: "outbox",
      redactedJson: expect.objectContaining({
        attempted: 1,
        deliveryErrorCodeSummary: "HOSTED_PROVIDER_FETCH_UNAVAILABLE:1",
        deliveryErrorSummaries: [
          {
            deliveryChannel: "telegram",
            deliveryStatus: "failed_ambiguous",
            deliveryErrorCode: "HOSTED_PROVIDER_FETCH_UNAVAILABLE",
            deliveryErrorMessage: "redacted",
            journalStatus: "500",
            retryable: true,
            targetKind: "none",
          },
        ],
        failed: 1,
        retryable: 1,
        sent: 0,
        statusSummary: "failed_ambiguous:1",
      }),
    }));
  });

  it("logs redacted delivery error diagnostics directly", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createFailedDeliveryOutcome({
        deliveryErrorCode: "ASSISTANT_DELIVERY_ABORTED",
        effectId: "effect_assistant_delivery",
      }),
      createFailedDeliveryOutcome({
        deliveryErrorCode: "provider.raw_tenant_123",
        deliveryErrorMessage:
          "Telegram HTTP 400 authorization: Bearer placeholder for file:///tmp/private note to person@example.invalid +1 555 010 9999",
        effectId: "effect_external_provider",
      }),
      createFailedDeliveryOutcome({
        deliveryErrorCode: "LINQ_API_TOKEN_REQUIRED",
        effectId: "effect_linq_safe",
      }),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      component: "outbox",
      eventCode: "outbox.delivery_finished",
      level: "warn",
      phase: "outbox",
      redactedJson: expect.objectContaining({
        attempted: 3,
        deliveryErrorCodeSummary:
          "ASSISTANT_DELIVERY_ABORTED:1,LINQ_API_TOKEN_REQUIRED:1,provider.raw_tenant_123:1",
        deliveryErrorSummaries: [
          expect.objectContaining({
            deliveryErrorCode: "ASSISTANT_DELIVERY_ABORTED",
            deliveryErrorMessage: "redacted",
          }),
          expect.objectContaining({
            deliveryErrorCode: "provider.raw_tenant_123",
            deliveryErrorMessage:
              "Telegram HTTP 400 authorization [redacted] for <REDACTED_PATH> note to [redacted-email] [redacted-phone]",
          }),
          expect.objectContaining({
            deliveryErrorCode: "LINQ_API_TOKEN_REQUIRED",
            deliveryErrorMessage: "redacted",
          }),
        ],
        failed: 3,
        retryable: 3,
        sent: 0,
      }),
    }));
  });

  it("produces parser-safe delivery diagnostics from redacted home paths", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createFailedDeliveryOutcome({
        deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
        deliveryErrorDetails: {
          description:
            "Linq response referenced <HOME_DIR>/vault/outbox.json.",
        },
        deliveryErrorMessage:
          "Linq delivery failed while reading <HOME_DIR>/vault/outbox.json.",
        effectId: "effect_pre_redacted_home_path",
      }),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);
    const deliveryLogRequest = filteredLogRequests[1];

    expect(deliveryLogRequest?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      deliveryErrorSummaries: [
        expect.objectContaining({
          deliveryErrorDetailDescription:
            "Linq response referenced <REDACTED_PATH>",
          deliveryErrorMessage:
            "Linq delivery failed while reading <REDACTED_PATH>",
        }),
      ],
    }));
    expect(() => parseHostedRuntimeLogRequest(deliveryLogRequest)).not.toThrow();
  });

  it("projects bounded Linq attachment transport fields without provider request details", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createFailedDeliveryOutcome({
        deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
        deliveryErrorDetails: {
          authorization: "Bearer <REDACTED_TOKEN>",
          failureStage: "transport",
          method: "PUT",
          operation: "create_attachment_upload",
          path: "https://uploads.example.test/private-object?signature=private",
          requestOrigin: "https://uploads.example.test",
          retryable: false,
          timedOut: false,
          transportErrorName: "TypeError",
        },
        deliveryErrorMessage: "Linq attachment upload failed before a response was returned.",
        effectId: "effect_linq_attachment_transport",
      }),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);
    const deliveryLogRequest = filteredLogRequests[1];

    expect(deliveryLogRequest?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      deliveryErrorSummaries: [
        expect.objectContaining({
          deliveryErrorDetailFailureStage: "transport",
          deliveryErrorDetailMethod: "PUT",
          deliveryErrorDetailOperation: "create_attachment_upload",
          deliveryErrorDetailRetryable: false,
          deliveryErrorDetailTimedOut: false,
          deliveryErrorDetailTransportErrorName: "TypeError",
        }),
      ],
    }));
    const serializedLog = JSON.stringify(deliveryLogRequest);
    expect(serializedLog).not.toContain("REDACTED_TOKEN");
    expect(serializedLog).not.toContain("private-object");
    expect(serializedLog).not.toContain("uploads.example.test");
    expect(() => parseHostedRuntimeLogRequest(deliveryLogRequest)).not.toThrow();
  });

  it("projects Linq payload shape and response signatures without provider content", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createFailedDeliveryOutcome({
        deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
        deliveryErrorDetails: {
          failureStage: "http",
          method: "POST",
          name: "VaultCliError",
          operation: "send_message",
          providerErrorCode: "INVALID_MEDIA",
          providerErrorMessage: "provider response prose",
          providerRequestId: "trace_safe_123",
          requestAttachmentMediaPartCount: 1,
          requestBodyShape: "object:message|message:idempotency_key,parts",
          requestMediaPartCount: 8,
          requestMessageLength: 4321,
          requestMessagePartCount: 9,
          requestPublicUrlMediaPartCount: 7,
          requestTextPartCount: 1,
          responseBodyKeyCount: 4,
          responseBodyKeySummary: "code,errors,trace_id",
          responseBodyKind: "json_object",
          responseBodySha256: "a".repeat(64),
          responseBodyStringFieldCount: 3,
          responseBodyStringFieldSummary: "code,trace_id",
          responseBodyTextLength: 246,
          retryable: false,
          status: 400,
        },
        deliveryErrorMessage:
          "Linq request POST /chats/[chat]/messages failed with HTTP 400.",
        effectId: "effect_linq_payload_diagnostics",
      }),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const deliveryLogRequest = withoutAssistantTurnTimingLogs(logRequests)[1];

    expect(deliveryLogRequest?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      deliveryErrorSummaries: [
        expect.objectContaining({
          deliveryErrorDetailFailureStage: "http",
          deliveryErrorDetailMethod: "POST",
          deliveryErrorDetailOperation: "send_message",
          deliveryErrorDetailProviderCode: "INVALID_MEDIA",
          deliveryErrorDetailProviderRequestId: "trace_safe_123",
          deliveryErrorDetailRequestSummary: JSON.stringify({
            messageLength: 4321,
            partCount: 9,
            textPartCount: 1,
            mediaPartCount: 8,
            publicUrlMediaPartCount: 7,
            attachmentMediaPartCount: 1,
            bodyShape: "object:message|message:idempotency_key,parts",
          }),
          deliveryErrorDetailResponseSummary: JSON.stringify({
            kind: "json_object",
            textLength: 246,
            keyCount: 4,
            keySummary: "code,errors,trace_id",
            stringFieldCount: 3,
            stringFieldSummary: "code,trace_id",
          }),
          deliveryErrorDetailResponseSignature: "a".repeat(64),
          deliveryErrorDetailStatus: 400,
        }),
      ],
    }));
    const deliveryErrorSummaries = deliveryLogRequest?.entries[0]?.redactedJson
      ?.deliveryErrorSummaries;
    expect(Array.isArray(deliveryErrorSummaries)).toBe(true);
    if (!Array.isArray(deliveryErrorSummaries)) {
      throw new Error("Expected delivery error summaries.");
    }
    const deliveryErrorSummary = deliveryErrorSummaries[0];
    expect(deliveryErrorSummary).toBeDefined();
    if (
      deliveryErrorSummary === null
      || typeof deliveryErrorSummary !== "object"
      || Array.isArray(deliveryErrorSummary)
    ) {
      throw new Error("Expected a delivery error summary object.");
    }
    expect(Object.keys(deliveryErrorSummary)).toHaveLength(16);
    expect(JSON.stringify(deliveryLogRequest)).not.toContain("provider response prose");
    expect(() => parseHostedRuntimeLogRequest(deliveryLogRequest)).not.toThrow();
  });

  it("preserves safe Telegram reaction delivery error codes", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createFailedDeliveryOutcome({
        deliveryChannel: "telegram",
        deliveryErrorCode: "ASSISTANT_TELEGRAM_REACTION_FAILED",
        deliveryErrorDetails: {
          code: "ASSISTANT_TELEGRAM_REACTION_FAILED",
          description: "Forbidden: bot was blocked by the user",
          errorCode: 403,
          operation: "Telegram Bot API setMessageReaction",
          retryable: false,
          status: 403,
          target: "telegram:chat:123456789",
        },
        deliveryErrorMessage:
          "Telegram Bot API setMessageReaction failed with HTTP 403.",
        effectId: "effect_reaction_failed",
      }),
      createFailedDeliveryOutcome({
        deliveryChannel: "telegram",
        deliveryErrorCode: "ASSISTANT_TELEGRAM_REACTION_TARGET_UNSUPPORTED",
        effectId: "effect_reaction_target_unsupported",
      }),
      createFailedDeliveryOutcome({
        deliveryChannel: "telegram",
        deliveryErrorCode: "TELEGRAM_API_BAD_REQUEST",
        effectId: "effect_telegram_provider",
      }),
      createFailedDeliveryOutcome({
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        effectId: "effect_missing_code",
      }),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      component: "outbox",
      eventCode: "outbox.delivery_finished",
      level: "warn",
      phase: "outbox",
      redactedJson: expect.objectContaining({
        attempted: 4,
        deliveryErrorCodeSummary:
          "ASSISTANT_TELEGRAM_REACTION_FAILED:1,ASSISTANT_TELEGRAM_REACTION_TARGET_UNSUPPORTED:1,none:1,TELEGRAM_API_BAD_REQUEST:1",
        deliveryErrorSummaries: [
          expect.objectContaining({
            deliveryChannel: "telegram",
            deliveryErrorCode: "ASSISTANT_TELEGRAM_REACTION_FAILED",
            deliveryErrorDetailDescription: "Forbidden: bot was blocked by the user",
            deliveryErrorDetailFieldCount: 7,
            deliveryErrorDetailOperation: "Telegram Bot API setMessageReaction",
            deliveryErrorDetailProviderCode: 403,
            deliveryErrorDetailRetryable: false,
            deliveryErrorDetailStatus: 403,
            deliveryErrorDetailTarget: "[redacted-telegram-target:chat]",
            deliveryErrorMessage:
              "Telegram Bot API setMessageReaction failed with HTTP 403.",
          }),
          expect.objectContaining({
            deliveryChannel: "telegram",
            deliveryErrorCode: "ASSISTANT_TELEGRAM_REACTION_TARGET_UNSUPPORTED",
          }),
          expect.objectContaining({
            deliveryChannel: "telegram",
            deliveryErrorCode: "TELEGRAM_API_BAD_REQUEST",
          }),
          expect.objectContaining({
            deliveryChannel: "telegram",
            deliveryErrorCode: "none",
          }),
        ],
        failed: 4,
        retryable: 4,
        sent: 0,
      }),
    }));
  });

  it("writes a system mailbox processing summary", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      attemptCount: 2,
      errorCode: "system_mailbox.retryable",
      errorMessage: "redacted",
      itemId: "system_mailbox_item_123456789",
      legacyUsageReferralAuthorityClassification: "identity_mismatch",
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      routeAction: "dispatch-assistant-notification",
      status: "retryable_failed",
      wakeKind: "assistant.notification.requested",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));

    expect(result.checkpointReason).toBe("system_mailbox_receipt");
    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "mailbox.system_processed",
    ]);
    expect(logRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "mailbox",
      errorCode: "system_mailbox.retryable",
      eventCode: "mailbox.system_processed",
      level: "warn",
      phase: "checkpoint",
      redactedJson: expect.objectContaining({
        attemptCount: 2,
        errorCode: "system_mailbox.retryable",
        legacyUsageReferralAuthorityClassification: "identity_mismatch",
        nextWakeAtPresent: true,
        routeAction: "dispatch-assistant-notification",
        status: "retryable_failed",
        wakeKind: "assistant.notification.requested",
      }),
    }));
  });

  it("preserves a future device-sync retry while recording unrelated system mailbox work", async () => {
    const deviceSyncRetryAt = "2026-04-27T00:00:30.000Z";
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce("2026-04-27T01:00:00.000Z");
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
      },
      status: "processed",
    });
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      failed: 0,
      nextWakeAt: null,
      recorded: 1,
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: deviceSyncRetryAt,
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: deviceSyncRetryAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: deviceSyncRetryAt,
      nextWakeReason: "device-sync.reconcile",
    }));
  });

  it("preserves a runtime-only device-sync continuation after recording unrelated system mailbox work", async () => {
    const deviceSyncContinuationAt = "2026-04-27T00:00:30.000Z";
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: false,
      nextWakeAt: deviceSyncContinuationAt,
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
      },
      status: "processed",
    });
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      failed: 0,
      nextWakeAt: null,
      recorded: 1,
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:00:00.000Z",
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: deviceSyncContinuationAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: deviceSyncContinuationAt,
      nextWakeReason: "device-sync.reconcile",
    }));
  });

  it("preserves durable outbox wakes while recording unrelated system mailbox work", async () => {
    const outboxWakeAt = "2026-04-27T00:05:00.000Z";
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValue(outboxWakeAt);
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
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      failed: 0,
      nextWakeAt: null,
      recorded: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: outboxWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: outboxWakeAt,
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
    }));
  });

  it("preserves future provider cleanup wakes while recording unrelated system mailbox work", async () => {
    const providerCleanupWakeAt = "2026-04-27T00:05:00.000Z";
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: providerCleanupWakeAt,
    });
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      providerCleanupWakeAt,
    );
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
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      failed: 0,
      nextWakeAt: null,
      recorded: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: providerCleanupWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: providerCleanupWakeAt,
      nextWakeReason: "assistant",
    }));
  });

  it("does not preserve a consumed system mailbox wake while draining provider cleanup", async () => {
    const staleSystemMailboxWakeAt = "2026-04-27T00:00:00.000Z";
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.resolveHostedSystemMailboxNextWakeAt
      .mockResolvedValueOnce(staleSystemMailboxWakeAt)
      .mockResolvedValue(null);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createCodexAuthSystemMailboxItem(),
      itemId: "system_mailbox_item_codex_auth",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      failed: 0,
      nextWakeAt: null,
      recorded: 1,
    });
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => staleSystemMailboxWakeAt,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
    }));
    expect(result).not.toHaveProperty("nextWakeAt");

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "provider_cleanup",
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedProviderCleanupAttemptedLinqItems: 1,
        hostedProviderCleanupDeletedLinqItems: 1,
        hostedProviderCleanupFailedLinqItems: 0,
        nextWakeAt: null,
      }),
    }));
  });

  it("does not mark a retryable device-sync mailbox attempt as completed", async () => {
    const deviceSyncWorkspaceWakeAt = "2026-04-27T00:00:00.000Z";
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      attemptCount: 2,
      errorCode: "system_mailbox.retryable",
      errorMessage: "redacted",
      itemId: "system_mailbox_item_retryable",
      legacyUsageReferralAuthorityClassification: null,
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      routeAction: "run-device-sync-wake",
      status: "retryable_failed",
      wakeKind: "device-sync.wake",
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: deviceSyncWorkspaceWakeAt,
        nextWakeReason: "device-sync.reconcile",
      }),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result.nextWakeAt).toBe("2026-04-27T00:10:00.000Z");
    expect(result.nextWakeReason).toBeUndefined();
    expect(result.deviceSyncMaintenanceRan).toBeUndefined();
    expect(postCheckpoint).toBeUndefined();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord).not.toHaveBeenCalled();
  });

  it("does not record a retryable mailbox item during an unrelated checkpoint", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      attemptCount: 2,
      errorCode: "system_mailbox.retryable",
      errorMessage: "redacted",
      itemId: "system_mailbox_item_retryable",
      legacyUsageReferralAuthorityClassification: null,
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      routeAction: "dispatch-assistant-notification",
      status: "retryable_failed",
      wakeKind: "assistant.notification.requested",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).not.toHaveBeenCalled();
    expect(
      logRequests.flatMap((request) => request.entries).filter((entry) =>
        entry.eventCode === "mailbox.system_processed"
      ),
    ).toEqual([
      expect.objectContaining({
        redactedJson: expect.objectContaining({
          status: "retryable_failed",
        }),
      }),
    ]);
  });

  it("preserves a device-sync mailbox follow-up wake after recording the mailbox item", async () => {
    const nextWakeAt = new Date(Date.now() + 60_000).toISOString();
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "evt_synthetic_device_sync_wake",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        reason: "connected" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_device_sync",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "device-sync",
        nextWakeAt,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
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
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecorded: 1,
      }),
    }));
  });

  it("preserves an immediate assistant wake after recording a system mailbox item", async () => {
    const nextWakeAt = "2026-04-27T00:00:00.000Z";
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_immediate_assistant_wake",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        nextWakeAt,
        nextWakeReason: "assistant",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => nextWakeAt,
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt,
      progressed: true,
    }));
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt,
      nextWakeReason: "assistant",
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecorded: 1,
      }),
    }));
  });

  it("drops an immediate non-assistant system mailbox metrics wake", async () => {
    const nextWakeAt = "2026-04-27T00:00:00.000Z";
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "evt_synthetic_device_sync_immediate_reconcile_wake",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        reason: "webhook" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_immediate_reconcile_wake",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "device-sync",
        nextWakeAt,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => nextWakeAt,
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
    }));
    expect(result).not.toHaveProperty("nextWakeAt");
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecorded: 1,
      }),
    }));
  });

  it("keeps an armed assistant cron wake when a device-sync mailbox wake is processed", async () => {
    // Prod regression (2026-06-10): an `at` reminder automation armed next_wake_at=02:45,
    // then WHOOP device-sync wakes at 01:59/02:03 early-returned a device-sync-only result
    // whose nextWakeAt replaced the armed cron wake, so the runtime slept through 02:45.
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-cron-wake-clobber-"));
    const vaultRoot = path.join(parentRoot, "vault");

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      await upsertAutomation({
        continuityPolicy: "fresh",
        instructions: "Remind me to start red light therapy.",
        now: new Date("2026-04-27T00:00:00.000Z"),
        status: "active",
        route: {
          channel: "linq",
          deliverySource: {
            fromPhoneNumber: "+15555550199",
            kind: "linq",
          },
          deliveryTarget: "+15555550100",
          identityId: null,
          participantId: null,
          threadId: null,
        },
        schedule: {
          at: "2026-04-27T02:45:00.000Z",
          kind: "at",
        },
        title: "Red light therapy reminder",
        vaultRoot,
      });
      mocks.getAssistantCronStatus.mockResolvedValue({
        dueJobs: 0,
        enabledJobs: 1,
        nextRunAt: "2026-04-27T02:45:00.000Z",
        runningJobs: 0,
        totalJobs: 1,
      });

      const deviceSyncItem = {
        ...createSystemMailboxItem(),
        routeAction: "run-device-sync-wake" as const,
        wake: {
          eventId: "evt_synthetic_device_sync_wake_clobber",
          kind: "device-sync.wake" as const,
          occurredAt: "2026-04-27T00:00:00.000Z",
          reason: "connected" as const,
          userId: "member_synthetic_phase",
        },
      };
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
        item: deviceSyncItem,
        itemId: "system_mailbox_item_device_sync_clobber",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "device-sync",
          nextWakeAt: "2026-04-27T08:03:00.000Z",
          postCheckpointRecord: null,
          redactedLogEntries: [],
        },
        status: "processed",
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      }));
      const postCheckpoint = await result.afterCheckpoint?.();

      // The device-sync-only pass must not narrow the alarm past the armed
      // cron occurrence at 02:45; the 08:03 device reconcile loses. The
      // recorded-receipt post-checkpoint recomputes its own wake, so assert
      // it directly instead of falling back to the pre-checkpoint result.
      expect(result.nextWakeAt).toBe("2026-04-27T02:45:00.000Z");
      expect(postCheckpoint?.nextWakeAt).toBe("2026-04-27T02:45:00.000Z");
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("keeps an armed assistant cron wake when idle dirty device-sync work runs", async () => {
    // Same clobber as the mailbox-item route, but through the idle dirty
    // device-sync-only result (no system-mailbox item): the device reconcile
    // follow-up at 08:03 must not replace the earlier 02:45 cron occurrence.
    mocks.getAssistantCronStatus.mockResolvedValue({
      dueJobs: 0,
      enabledJobs: 1,
      nextRunAt: "2026-04-27T02:45:00.000Z",
      runningJobs: 0,
      totalJobs: 1,
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-27T08:03:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
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

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T02:45:00.000Z",
      nextWakeReason: "assistant",
      progressed: true,
    }));
  });

  it("continues into the assistant lane when dirty device-sync work finds due cron", async () => {
    const dueAt = "2026-04-27T00:00:00.000Z";
    mocks.getAssistantCronStatus.mockResolvedValue({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: dueAt,
      runningJobs: 0,
      totalJobs: 1,
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: dueAt,
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => dueAt,
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
        checkpointedAt: dueAt,
        createdAt: dueAt,
        nextWakeAt: dueAt,
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: dueAt,
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
  });

  it("keeps the earlier device-sync wake when the assistant cron occurrence is later", async () => {
    // The injected cron candidate stays earliest-wins: it must never delay an
    // earlier device-sync reconcile wake.
    mocks.getAssistantCronStatus.mockResolvedValue({
      dueJobs: 0,
      enabledJobs: 1,
      nextRunAt: "2026-04-27T09:00:00.000Z",
      runningJobs: 0,
      totalJobs: 1,
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
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

    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("retries an unavailable cron status read before mailbox post-checkpoint wake selection", async () => {
    mocks.getAssistantCronStatus
      .mockRejectedValueOnce(new Error("synthetic transient cron status read failure"))
      .mockResolvedValueOnce({
        dueJobs: 0,
        enabledJobs: 1,
        nextRunAt: "2026-04-27T02:45:00.000Z",
        runningJobs: 0,
        totalJobs: 1,
      });
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "evt_synthetic_device_sync_wake_transient_cron_read",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        reason: "connected" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_device_sync_transient_cron_read",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "device-sync",
        nextWakeAt: "2026-04-27T08:03:00.000Z",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(2);
    expect(result.nextWakeAt).toBe("2026-04-27T08:03:00.000Z");
    expect(postCheckpoint?.nextWakeAt).toBe("2026-04-27T02:45:00.000Z");
  });

  it("preserves an existing assistant workspace wake when cron status remains unavailable", async () => {
    mocks.getAssistantCronStatus.mockRejectedValue(
      new Error("synthetic persistent cron status read failure"),
    );
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "evt_synthetic_device_sync_wake_existing_assistant_cron_read_failure",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        reason: "connected" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_device_sync_existing_assistant_cron_read_failure",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "device-sync",
        nextWakeAt: "2026-04-27T08:03:00.000Z",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T02:45:00.000Z",
      }),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(2);
    expect(result.nextWakeAt).toBe("2026-04-27T02:45:00.000Z");
    expect(postCheckpoint).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T02:45:00.000Z",
      nextWakeReason: "assistant",
    }));
  });

  it("still schedules the device-sync wake when the assistant cron status read fails", async () => {
    // Best-effort invariant: a failed cron-status vault read must not break
    // the device-sync lane or its wake selection, before or after checkpoint.
    mocks.getAssistantCronStatus.mockRejectedValue(
      new Error("synthetic cron status read failure"),
    );
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "evt_synthetic_device_sync_wake_cron_read_failure",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        reason: "connected" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_device_sync_cron_read_failure",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "device-sync",
        nextWakeAt: "2026-04-27T08:03:00.000Z",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T08:03:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
    expect(postCheckpoint?.nextWakeAt).toBe("2026-04-27T08:03:00.000Z");
  });

  it("preserves device-sync ownership returned by mailbox post-checkpoint recording", async () => {
    const nextWakeAt = "2026-04-27T00:10:00.000Z";
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_device_sync_recorded",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      failed: 0,
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      recorded: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecorded: 1,
      }),
    }));
  });

  it("drains queue-only signup welcome outbox after member activation mailbox checkpoint", async () => {
    const deliveryEffect = createDeliveryEffect();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createMemberActivationSignupWelcomeSystemMailboxItem(),
      itemId: "system_mailbox_item_member_activation",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "member-activated",
        nextWakeAt: null,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([deliveryEffect]);
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:01:00.000Z",
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
        journalMethod: "POST",
        journalStatus: "200",
        providerMessageId: "provider_signup_welcome",
        providerMessageIds: [],
        providerThreadId: null,
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      progressed: true,
    }));
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: true,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [],
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [deliveryEffect],
        vaultRoot: "/tmp/murph-vault",
        wake: expect.objectContaining({
          kind: "member.activated",
          signupWelcome: expect.any(Object),
        }),
      }),
    );
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      redactedStatus: expect.objectContaining({
        hostedOutboxDeliverySent: 1,
        hostedSystemMailboxRecorded: 1,
      }),
    }));
  });

  it("writes a system mailbox record summary after checkpoint", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        redactedLogEntries: [{
          component: "runtime",
          level: "warn",
          message:
            "Hosted assistant notification failed and was skipped so the hosted runtime pass can continue.",
          phase: "wake.running",
          redacted: {
            ...Object.fromEntries(
              Array.from({ length: 24 }, (_entry, index) => [
                `diagnosticFiller${index}`,
                index,
              ]),
            ),
            assistantNotificationCodexConnectionLost: false,
            assistantNotificationCodexExitCode: 1,
            assistantNotificationCodexFailureStage: "process_exit",
            assistantNotificationCodexStderrPresent: true,
            assistantNotificationErrorCode: "runtime_error",
            assistantNotificationProviderErrorCode: "ASSISTANT_CODEX_FAILED",
            deliveryDispatchMode: "queue-only",
            errorCode: "assistant_provider_failed",
            localPathPreview: "/tmp/not-allowed",
            notificationChannel: "linq",
          },
        }],
      },
      status: "processed",
    });
    mocks.resolveHostedSystemMailboxNextWakeAt.mockResolvedValueOnce(null);
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      errorCode: "MEMBER_ACTION_OUTCOME_UNAVAILABLE",
      errorMessage: "Hosted member action outcome write was unavailable.",
      failed: 1,
      nextWakeAt: "2026-04-27T00:15:00.000Z",
      recorded: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));
    await result.afterCheckpoint?.();

    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.automation_detail",
      "mailbox.system_processed",
      "mailbox.system_processed",
    ]);
    expect(logRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "assistant",
      errorCode: "ASSISTANT_CODEX_FAILED",
      eventCode: "assistant.automation_detail",
      level: "warn",
      phase: "invoke",
      redactedJson: expect.objectContaining({
        assistantNotificationCodexConnectionLost: false,
        assistantNotificationCodexExitCode: 1,
        assistantNotificationCodexFailureStage: "process_exit",
        assistantNotificationCodexStderrPresent: true,
        assistantNotificationErrorCode: "runtime_error",
        assistantNotificationProviderErrorCode: "ASSISTANT_CODEX_FAILED",
        deliveryDispatchMode: "queue-only",
        detailComponent: "runtime",
        detailLabel:
          "Hosted assistant notification failed and was skipped so the hosted runtime pass can continue.",
        errorCode: "assistant_provider_failed",
        localPathPreview: "<REDACTED_PATH>",
        notificationChannel: "linq",
        safeErrorMessage:
          "Hosted assistant notification failed and was skipped so the hosted runtime pass can continue.",
      }),
    }));
    expect(logRequests[2]?.entries[0]).toEqual(expect.objectContaining({
      component: "mailbox",
      errorCode: "MEMBER_ACTION_OUTCOME_UNAVAILABLE",
      eventCode: "mailbox.system_processed",
      level: "warn",
      redactedJson: expect.objectContaining({
        attemptCount: 2,
        errorCode: "MEMBER_ACTION_OUTCOME_UNAVAILABLE",
        nextWakeAtPresent: true,
        recordFailed: 1,
        recorded: 0,
        routeAction: "dispatch-assistant-notification",
        safeErrorMessage: "Hosted member action outcome write was unavailable.",
        status: "recorded",
        wakeKind: "assistant.notification.requested",
      }),
    }));
  });

  it("runs the assistant lane before optional system work when fresh conversation input exists", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.resolveHostedSystemMailboxNextWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:12:00.000Z",
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      logRequests,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: true,
      }),
    );
    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(result.nextWakeAt).toBe("2026-04-27T00:12:00.000Z");
    expect(result.redactedStatus).toEqual(expect.objectContaining({
      hostedAssistantNextWakeAt: "2026-04-27T00:12:00.000Z",
      hostedSystemMailboxPrepared: 0,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(postCheckpoint).toBeUndefined();
    expect(filteredLogRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.pass_finished",
    ]);
    expect(filteredLogRequests[0]?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      nextWakeAtPresent: true,
      progressed: false,
      systemWakeAtPresent: true,
    }));
  });

  it("keeps due device-sync maintenance deferred while fresh conversation input runs", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      logRequests,
      now: () => "2026-04-27T00:09:00.000Z",
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
        nextWakeAt: "2026-04-27T00:08:00.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.createHostedAssistantChannelTypingDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        providerFetch: null,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.createHostedAssistantProgressDeliveryDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        providerFetch: null,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: true,
      }),
    );
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:09:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toContain(
      "assistant.pass_finished",
    );
    const passFinishedLog = logRequests.find(
      (request) => request.entries[0]?.eventCode === "assistant.pass_finished",
    );
    expect(passFinishedLog?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      nextWakeAtPresent: true,
      progressed: true,
    }));
  });

  });

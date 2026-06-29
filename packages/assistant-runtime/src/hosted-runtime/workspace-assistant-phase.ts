import {
  buildHostedExecutionSafeErrorDiagnostics,
  buildHostedExecutionRuntimeTimerWake,
  deriveHostedExecutionErrorCode,
  sanitizeHostedExecutionStructuredLogDetails,
  sanitizeHostedExecutionStructuredLogText,
  type HostedExecutionRedactedLogEntry,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  type HostedWorkspaceCheckpointReason,
  type HostedRuntimeRedactedJson,
  type HostedRuntimeRedactedObject,
  type HostedRuntimeRedactedScalar,
} from "@murphai/hosted-execution/runtime-control";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_ASSISTANT_TURN_TIMING_SCHEMA,
  HOSTED_ASSISTANT_TURN_TIMING_TYPE,
  applyMurphManagedAutomations,
  getAssistantCronStatus,
  readAssistantOutboxIntent,
  readAssistantInputEvent,
  refreshAssistantContextSnapshotBestEffort,
  scheduleDeviceActivityTriggeredAutomations,
  type AssistantExecutionContext,
  type HostedAssistantTurnTimingStage,
} from "@murphai/assistant-engine";
import type {
  AutomationRoute,
} from "@murphai/contracts";
import {
  findAssistantAutoReplyDeliveryIntentIds,
  listPendingAssistantAutoReplyLinqCleanupEvidence,
  markAssistantAutoReplyLinqCleanupQueued,
} from "@murphai/assistant-engine/assistant-automation";
import {
  listConfiguredDeviceSyncConnectTargets,
  listConfiguredDeviceSyncReconnectTargets,
} from "@murphai/device-syncd/config";
import type {
  AssistantCurrentDeliveryRoute,
} from "@murphai/operator-config/assistant/current-delivery-route";

import {
  collectHostedAssistantDeliverySideEffects,
  createHostedAssistantProgressDeliveryDependencies,
  drainHostedPreparedAssistantDeliveries,
  prepareHostedAssistantDeliveryEffectsForDispatch,
  resetHostedPreparedAssistantDeliveryEffects,
  resolveHostedAssistantOutboxNextWakeAt,
  type HostedAssistantDeliveryPreparation,
} from "./callbacks.ts";
import {
  buildHostedLinqChannelEnv,
  createHostedAssistantChannelTypingDependencies,
} from "./channel-activity.ts";
import {
  hydrateHostedExecutionDefaultTarget,
  prepareHostedAssistantAutomationForWake,
} from "./context.ts";
import {
  readHostedAssistantInputCurrentDeliveryRoute,
  resolveUnambiguousCurrentDeliveryRoute,
} from "./current-delivery-route.ts";
import {
  runHostedAssistantAutomationLane,
  runHostedDeviceSyncWakeLane,
  resolveHostedDeviceSyncNextWakeAt,
} from "./maintenance.ts";
import {
  buildHostedDeviceSyncStatusPrompt,
  type HostedDeviceSyncStatusPromptReconnectTarget,
} from "./device-sync-status-prompt.ts";
import {
  resolveHostedPendingAssistantInputWakeAt,
} from "./pending-assistant-input.ts";
import {
  collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes,
  drainHostedProviderCleanupAfterCommit,
  readHostedProviderCleanupCheckpoint,
  recordHostedProviderCleanupBeforeCommit,
  type HostedProviderCleanupCheckpoint,
} from "./provider-cleanup.ts";
import { normalizeHostedFutureWakeAt } from "./wake-time.ts";
import {
  prepareHostedSystemMailboxItemForCheckpoint,
  recordHostedDeviceSyncDirtyPostCheckpointRecord,
  recordHostedSystemMailboxItemAfterCheckpoint,
  resolveHostedSystemMailboxNextWakeAt,
  resolveHostedSystemMailboxNextWakeCandidate,
  type HostedSystemMailboxCheckpointPreparation,
  type HostedSystemMailboxPendingItem,
} from "./system-mailbox.ts";
import type {
  HostedAssistantDeliveryOutcome,
  HostedAssistantWorkspaceRuntimeJobInput,
  HostedDeviceSyncDirtyProcessedPostCheckpointRecord,
  HostedRestoredExecutionContext,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  buildHostedRuntimeLogContextFields,
  summarizeHostedRuntimeStatusCounts,
  toHostedRuntimeLogCode,
  writeHostedRuntimeLogBestEffort,
} from "./runtime-logs.ts";
import type {
  HostedWorkspaceDurableCheckpointEffect,
  HostedWorkspaceRunnerAssistantPhaseInput,
  HostedWorkspaceRunnerAssistantPhaseDeliveryBarrier,
  HostedWorkspaceRunnerAssistantPhasePostCheckpoint,
  HostedWorkspaceRunnerAssistantPhaseResult,
} from "./workspace-runner.ts";
import {
  HOSTED_ASSISTANT_WAKE_REASON,
  HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
  createHostedRuntimeWakeCandidate,
  selectHostedRuntimeWakeCandidate,
  type HostedRuntimeWakeCandidate,
} from "./wake-candidates.ts";

const HOSTED_DEVICE_SYNC_DIRTY_ACK_FAILURE_RETRY_DELAY_MS = 60_000;
const HOSTED_OUTBOX_DELIVERY_ERROR_LOG_LIMIT = 16;

const HOSTED_RUNTIME_REDACTED_TEXT_MAX_LENGTH = 2048;
const HOSTED_RUNTIME_BLOCKED_LOG_KEY_PARTS = [
  "payload",
  "preview",
  "prompt",
  "transcript",
  "vault",
] as const;
const HOSTED_RUNTIME_SECRET_VALUE_KEY_PARTS = [
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
] as const;
const HOSTED_RUNTIME_ERROR_DESCRIPTION_KEY_PARTS = [
  "cause",
  "detail",
  "error",
  "exception",
  "failure",
  "message",
  "reason",
  "status",
] as const;
const HOSTED_RUNTIME_ALLOWED_LOG_KEY_NAMES = new Set([
  "localPathPreview",
]);
const HOSTED_ASSISTANT_AUTOMATION_DETAIL_MAX_KEYS = 40;
const HOSTED_ASSISTANT_CRON_STATUS_RETRY_DELAY_MS = 30_000;
const HOSTED_MANAGED_AUTOMATION_SETUP_RETRY_DELAY_MS = 30_000;
const HOSTED_SKIPPED_DEVICE_SYNC_RETRY_DELAY_MS = 30_000;
const HOSTED_DEFERRED_PENDING_ASSISTANT_INPUT_RETRY_DELAY_MS = 30_000;
const HOSTED_IDLE_DEVICE_SYNC_PREEMPTION_POLL_MS = 25;
const HOSTED_MEMBER_CHANNEL_UPDATE_ROUTE_ACTIONS = ["apply-member-channels-update"] as const;

export interface HostedWorkspaceRuntimeAssistantPhaseInput
  extends HostedWorkspaceRunnerAssistantPhaseInput {
  request: HostedAssistantWorkspaceRuntimeJobInput["request"];
  restored: HostedRestoredExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
  stagedDirtyAcks?: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null;
  suppressDirtyPendingFetch?: boolean;
  signal?: AbortSignal | null;
}

export type HostedWorkspaceRuntimeAssistantPhase = (
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
) => Promise<HostedWorkspaceRunnerAssistantPhaseResult>;

export async function runHostedWorkspaceAssistantPhase(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): Promise<HostedWorkspaceRunnerAssistantPhaseResult> {
  const assistantPhaseStartedAt = Date.now();
  const channelAbortController = new AbortController();
  const releaseChannelAbortRelay = relayHostedAssistantPhaseAbortSignal(
    input.signal ?? null,
    channelAbortController,
  );
  const wake = buildHostedExecutionRuntimeTimerWake({
    eventId: `hosted-workspace-invocation:${input.request.attemptId}:assistant`,
    occurredAt: new Date().toISOString(),
    triggerKind: "runtime_timer",
    userId: input.request.userId,
  });
  const deviceConnectProviders = resolveHostedWorkspaceDeviceConnectProviders(input.runtime);
  const issueDeviceConnectLink = resolveHostedWorkspaceIssueDeviceConnectLink({
    deviceConnectProviders,
    input,
  });
  const recordDeferredUsage = (record: AssistantUsageRecord): Promise<void> => {
    input.recordDeferredUsage?.(record);
    return Promise.resolve();
  };
  if (shouldWriteHostedDeviceConnectContextLog({ deviceConnectProviders, input })) {
    void writeHostedDeviceConnectRuntimeLog({
      deviceConnectProviders,
      input,
      issueLinkAvailable: issueDeviceConnectLink !== undefined,
      stage: "context",
      status: issueDeviceConnectLink ? "available" : "unavailable",
    }).catch(() => undefined);
  }
  const executionContext: AssistantExecutionContext = await hydrateHostedExecutionDefaultTarget(
    {
      hosted: {
        actionApprovalPort: input.runtime.platform.actionApprovalPort ?? null,
        connectedApps: input.runtime.platform.connectedApps ?? null,
        phoneCalls: input.runtime.platform.phoneCalls ?? null,
        progressDeliveryDependencies: createHostedAssistantProgressDeliveryDependencies({
          effectsPort: input.runtime.platform.effectsPort,
          forwardedEnv: input.runtime.forwardedEnv,
          ...(input.initialMailboxImport.importResult.latestLinqDeliveryContext
            ? { linqDeliveryContext: input.initialMailboxImport.importResult.latestLinqDeliveryContext }
            : {}),
          platformEnv: input.runtime.platformEnv,
          providerFetch: input.runtime.platform.providerFetch ?? null,
          signal: channelAbortController.signal,
          userEnv: input.runtime.userEnv,
          wake,
        }),
        channelTypingDependencies: createHostedAssistantChannelTypingDependencies({
          forwardedEnv: input.runtime.forwardedEnv,
          platformEnv: input.runtime.platformEnv,
          providerFetch: input.runtime.platform.providerFetch ?? null,
          signal: channelAbortController.signal,
          userEnv: input.runtime.userEnv,
        }),
        deviceConnectProviders,
        ...(issueDeviceConnectLink ? { issueDeviceConnectLink } : {}),
        ...(input.materializeWorkspaceArtifacts
          ? { materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts }
          : {}),
        generatedImageUploader: input.runtime.platform.generatedImageUploader ?? null,
        generatedImageUploaderRequired: true,
        ...(input.runtime.platform.productFeedbackPort
          ? { productFeedbackRecorder: input.runtime.platform.productFeedbackPort }
          : {}),
        memberId: input.request.userId,
        providerFetch: input.runtime.platform.providerFetch ?? null,
        publicInternetFetch: input.runtime.platform.publicInternetFetch ?? null,
        ...(input.runtime.platform.usageRecordPort && input.recordDeferredUsage
          ? {
              usageRecorder: {
                recordUsage: recordDeferredUsage,
              },
            }
          : {}),
        userEnvKeys: Object.keys(input.runtime.userEnv),
      },
    },
    {
      homeDirectory: input.restored.operatorHomeRoot,
      runtimeEnv: input.runtimeEnv,
    },
  );
  try {
    const hasFreshConversationInput = hasFreshHostedConversationInput(input);
    const pendingAssistantInputWakeAt = await resolveInitialPendingAssistantInputWakeAt({
      hasFreshConversationInput,
      input,
    });
    const shouldRunPendingAssistantInputFirst = pendingAssistantInputWakeAt !== null;
    const systemMailboxMaintenance = shouldRunPendingAssistantInputFirst
      ? emptyHostedSystemMailboxMaintenanceResult({
        pendingAssistantInputWakeAt,
      })
      : await runSystemMailboxMaintenancePhase({
        executionContext,
        hasFreshConversationInput,
        input,
        wake,
      });
    const managedAutomationsResult = hasFreshConversationInput
      || systemMailboxMaintenance.pendingAssistantInputWakeAt !== null
      ? null
      : await applyHostedManagedAutomationsBestEffort({
        input,
        retryStableKeyFailure: false,
      });
    const shouldContinueAssistantLane = systemMailboxMaintenance.continueAssistantLane
      || managedAutomationsResult !== null;
    if (
      systemMailboxMaintenance.result
      && !shouldContinueAssistantLane
    ) {
      return withHostedDeviceSyncMaintenanceRan(
        systemMailboxMaintenance.result,
        systemMailboxMaintenance.deviceSyncMaintenanceRan,
      );
    }
    let continuingSystemMailboxResult = shouldContinueAssistantLane
      ? mergeHostedAssistantPhaseResults(systemMailboxMaintenance.result, managedAutomationsResult)
      : managedAutomationsResult;
    let deviceSyncMaintenanceRan = systemMailboxMaintenance.deviceSyncMaintenanceRan;
    const initialProviderCleanupCheckpoint =
      systemMailboxMaintenance.initialProviderCleanupCheckpoint;
    const mergeContinuingSystemMailboxResult = (
      assistantResult: HostedWorkspaceRunnerAssistantPhaseResult,
    ): HostedWorkspaceRunnerAssistantPhaseResult =>
      withHostedDeviceSyncMaintenanceRan(
        mergeContinuingSystemMailboxAssistantPhaseResult({
          assistantResult,
          systemMailboxResult: continuingSystemMailboxResult,
        }),
        deviceSyncMaintenanceRan,
      );

    const freshAssistantInputIds =
      input.initialMailboxImport.importResult.assistantInputIds ?? [];
    const assistantAutomationRedactedLogEntries: HostedExecutionRedactedLogEntry[] = [];
    let assistantLaneExecutionContextWithDynamicPrompt: AssistantExecutionContext | null = null;
    const resolveAssistantLaneExecutionContext = async (options: {
      includeDeviceSyncStatusPrompt: boolean;
    }): Promise<AssistantExecutionContext> => {
      if (!options.includeDeviceSyncStatusPrompt) {
        return executionContext;
      }
      if (assistantLaneExecutionContextWithDynamicPrompt) {
        return assistantLaneExecutionContextWithDynamicPrompt;
      }

      const deviceSyncStatusPrompt = await buildHostedDeviceSyncStatusPrompt({
        deviceSyncPort: input.runtime.platform.deviceSyncPort ?? null,
        reconnectTargets: resolveHostedWorkspaceDeviceReconnectTargets(input.runtime),
        signal: channelAbortController.signal,
      });
      assistantLaneExecutionContextWithDynamicPrompt =
        withHostedAssistantDynamicContextPrompt({
          executionContext,
          prompt: deviceSyncStatusPrompt,
        });
      return assistantLaneExecutionContextWithDynamicPrompt;
    };
    const shouldIncludeDeviceSyncStatusPrompt = async (): Promise<boolean> => {
      if (
        systemMailboxMaintenance.continueAssistantLane
        || managedAutomationsResult !== null
      ) {
        return true;
      }
      if (
        hasFreshConversationInput
        || systemMailboxMaintenance.pendingAssistantInputWakeAt !== null
      ) {
        return false;
      }

      return await hasDueHostedAssistantCronJob(input);
    };
    const runAutomationLane = async (options: {
      includeDeviceSyncStatusPrompt: boolean;
    }) => {
      const automationLaneStartedAt = Date.now();
      const assistantRuntimeState = await prepareHostedAssistantAutomationForWake(
        input.restored.vaultRoot,
        wake,
        buildHostedAssistantAutomationBootstrapEnv(input),
        input.runtime.resolvedConfig,
        {
          operatorHomeRoot: input.restored.operatorHomeRoot,
        },
      );
      const automationExecutionContext = await resolveAssistantLaneExecutionContext({
        includeDeviceSyncStatusPrompt:
          options.includeDeviceSyncStatusPrompt
          && assistantRuntimeState.assistantConfigured,
      });
      const assistantMetrics = await (async () => {
        try {
          return await runHostedAssistantAutomationLane({
            assistantRuntimeState,
            executionContext: automationExecutionContext,
            freshAssistantInputIds,
            requestId: `hosted-workspace-invocation:${input.request.attemptId}:assistant`,
            runtime: {
              commitTimeoutMs: input.runtime.commitTimeoutMs,
              forwardedEnv: input.runtime.forwardedEnv,
              platform: input.platform,
              platformEnv: input.runtime.platformEnv,
              resolvedConfig: input.runtime.resolvedConfig,
            },
            operatorHomeRoot: input.restored.operatorHomeRoot,
            runtimeAttemptId: input.request.attemptId,
            runtimeEnv: input.runtimeEnv,
            signal: input.signal ?? undefined,
            vaultRoot: input.restored.vaultRoot,
            wake,
          });
        } catch (error) {
          const failureLogEntries =
            readHostedAssistantAutomationFailureRedactedLogEntries(error);
          const redactedLogEntries = [
            ...assistantAutomationRedactedLogEntries,
            ...failureLogEntries,
          ];
          if (redactedLogEntries.length > 0) {
            await writeHostedAssistantAutomationDetailRuntimeLogs({
              assistantMetrics: {
                redactedLogEntries,
              },
              input,
            });
          }
          throw error;
        }
      })();
      assistantAutomationRedactedLogEntries.push(
        ...(assistantMetrics.redactedLogEntries ?? []),
      );
      writeHostedAssistantTurnTimingRuntimeLog({
        currentTurnDeliveryIntentCount:
          assistantMetrics.assistantAutomationCurrentTurnDeliveryIntentIds?.length ?? 0,
        elapsedMs: elapsedSince(assistantPhaseStartedAt),
        input,
        stage: "automation-pass-finished",
        stepElapsedMs: elapsedSince(automationLaneStartedAt),
      });
      return {
        ...assistantMetrics,
        ...(assistantAutomationRedactedLogEntries.length === 0
          ? {}
          : { redactedLogEntries: [...assistantAutomationRedactedLogEntries] }),
      };
    };
    let assistantMetrics = await runAutomationLane({
      includeDeviceSyncStatusPrompt: await shouldIncludeDeviceSyncStatusPrompt(),
    });
    let currentTurnDeliveryIntentIds =
      assistantMetrics.assistantAutomationCurrentTurnDeliveryIntentIds ?? [];
    let foregroundAssistantPass = isHostedForegroundAssistantDeliveryPass({
      assistantMetrics,
      currentTurnDeliveryIntentIds,
      hasFreshConversationInput,
      input,
    });
    let assistantNextWakeAt = resolveHostedAssistantAutomationNextWakeAt({
      input,
      nextWakeAt: assistantMetrics.nextWakeAt,
    });
    let assistantNextWakeReason = resolveHostedAssistantAutomationNextWakeReason({
      assistantNextWakeAt,
    });
    const deferredPendingSystemMailboxMaintenance =
      await runBackgroundMaintenanceAfterDeferredPendingAssistantInput({
        assistantMetrics,
        assistantNextWakeAt,
        executionContext,
        foregroundAssistantPass,
        hasFreshConversationInput,
        input,
        systemMailboxMaintenance,
        wake,
      });
    if (deferredPendingSystemMailboxMaintenance) {
      continuingSystemMailboxResult = mergeHostedAssistantPhaseResults(
        continuingSystemMailboxResult,
        deferredPendingSystemMailboxMaintenance.result,
      );
      deviceSyncMaintenanceRan = deviceSyncMaintenanceRan
        || deferredPendingSystemMailboxMaintenance.deviceSyncMaintenanceRan;
    }
    if (deferredPendingSystemMailboxMaintenance?.continueAssistantLane === true) {
      assistantMetrics = await runAutomationLane({
        includeDeviceSyncStatusPrompt: true,
      });
      currentTurnDeliveryIntentIds =
        assistantMetrics.assistantAutomationCurrentTurnDeliveryIntentIds ?? [];
      foregroundAssistantPass = isHostedForegroundAssistantDeliveryPass({
        assistantMetrics,
        currentTurnDeliveryIntentIds,
        hasFreshConversationInput,
        input,
      });
      assistantNextWakeAt = resolveHostedAssistantAutomationNextWakeAt({
        input,
        nextWakeAt: assistantMetrics.nextWakeAt,
      });
      assistantNextWakeReason = resolveHostedAssistantAutomationNextWakeReason({
        assistantNextWakeAt,
      });
    }
    const deviceSyncFollowUpWake = resolveHostedDeviceSyncFollowUpWake({
      deviceSyncMaintenanceRan,
      input,
      pendingAssistantInputWakeAt: systemMailboxMaintenance.pendingAssistantInputWakeAt,
    });
    const systemMailboxWake = await resolveHostedSystemMailboxNextWakeCandidate({
      vaultRoot: input.restored.vaultRoot,
    });
    const systemMailboxWakeAt = systemMailboxWake.at;
    const terminalLinqCleanup = await listPendingAssistantAutoReplyLinqCleanupEvidence({
      vault: input.restored.vaultRoot,
    });
    const providerCleanupPhase = await runProviderCleanupPhase({
      foregroundAssistantPass,
      initialProviderCleanupCheckpoint,
      input,
      terminalLinqCleanup,
    });
    if (foregroundAssistantPass) {
      writeHostedAssistantTurnTimingRuntimeLog({
        currentTurnDeliveryIntentCount: currentTurnDeliveryIntentIds.length,
        elapsedMs: elapsedSince(assistantPhaseStartedAt),
        foregroundAssistantPass,
        input,
        stage: "foreground-delivery-phase-started",
      });
      const foregroundAssistantPhaseStartedAt = Date.now();
      const writeForegroundAssistantFinishedTiming = () => {
        writeHostedAssistantTurnTimingRuntimeLog({
          currentTurnDeliveryIntentCount: currentTurnDeliveryIntentIds.length,
          elapsedMs: elapsedSince(assistantPhaseStartedAt),
          foregroundAssistantPass,
          input,
          stage: "foreground-delivery-phase-finished",
          stepElapsedMs: elapsedSince(foregroundAssistantPhaseStartedAt),
        });
      };
      const foregroundAssistantResult = await runForegroundAssistantReplyPhase({
        assistantMetrics,
        currentTurnDeliveryIntentIds,
        deferredProviderCleanupWakeAt: providerCleanupPhase.deferredProviderCleanupWakeAt,
        input,
        skippedDeviceSyncWake: deviceSyncFollowUpWake,
        systemMailboxWake,
        systemMailboxWakeAt,
        wake,
      });
      const foregroundAfterCheckpoint = foregroundAssistantResult.afterCheckpoint;
      const timedForegroundAssistantResult =
        foregroundAfterCheckpoint
          ? {
              ...foregroundAssistantResult,
              afterCheckpoint: async () => {
                try {
                  return await foregroundAfterCheckpoint();
                } finally {
                  writeForegroundAssistantFinishedTiming();
                }
              },
            }
          : foregroundAssistantResult;
      if (!foregroundAssistantResult.afterCheckpoint) {
        writeForegroundAssistantFinishedTiming();
      }
      const result = mergeContinuingSystemMailboxResult(
        withFreshHostedManagedAutomationsAfterCheckpoint({
          input,
          result: timedForegroundAssistantResult,
        }),
      );
      return result;
    }
    const assistantCronWakeAfterPass =
      shouldResolveHostedAssistantCronWakeAfterAssistantPass({
        assistantMetrics,
        input,
      })
        ? await resolveHostedAssistantCronWakeStateBestEffort(input)
        : null;
    const assistantCronWakeAfterPassCandidate = assistantCronWakeAfterPass
      ? resolveHostedAssistantCronWakeCandidate({
          phaseInput: input,
          state: assistantCronWakeAfterPass,
        })
      : null;
    const providerCleanupCheckpoint = providerCleanupPhase.providerCleanupCheckpoint;
    const providerCleanupDue = providerCleanupPhase.providerCleanupDue;
    const terminalLinqCleanupDue = providerCleanupPhase.terminalLinqCleanupDue;
    const deferredProviderCleanupWakeAt = providerCleanupPhase.deferredProviderCleanupWakeAt;
    const deliveryEffects = await collectHostedAssistantDeliverySideEffects({
      actionApprovalPort: input.runtime.platform.actionApprovalPort ?? null,
      includeBackgroundDueIntents: true,
      preferredIntentIds: currentTurnDeliveryIntentIds,
      vaultRoot: input.restored.vaultRoot,
    });
    const deliveryEffectsPreparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: deliveryEffects,
      vaultRoot: input.restored.vaultRoot,
    });

    if (
      shouldFastDispatchAssistantDeliveryEffects({
        assistantMetrics,
        deliveryEffects,
        input,
      })
    ) {
      const fastDispatchBaseNextWake = selectHostedRuntimeWakeCandidate([
        resolveHostedFastDispatchBaseNextWake({
          assistantMetrics,
          deferredProviderCleanupWakeAt,
          input,
          skippedDeviceSyncWake: deviceSyncFollowUpWake,
          systemMailboxWake,
          systemMailboxWakeAt,
        }),
        assistantCronWakeAfterPassCandidate,
      ]);
      const postDelivery = await drainHostedPostCheckpointDelivery({
        assistantDeliveryEffects: deliveryEffects,
        assistantDeliveryPreparation: deliveryEffectsPreparation,
        baseNextWake: fastDispatchBaseNextWake,
        checkpointReason: "outbox_receipt",
        canConsumeWorkspaceAssistantWake: true,
        input,
        providerCleanup: {
          checkpoint: providerCleanupCheckpoint,
          mode: "drain",
        },
        redactedStatus: null,
        wake,
      });
      const nextWakeAt = postDelivery.nextWakeAt ?? null;
      const wakeStateProgressed = hostedAssistantWakeStateProgressed({
        assistantMetrics,
        input,
        nextWakeAt,
        skippedDeviceSyncWakeAt: deviceSyncFollowUpWake?.at ?? null,
      });
      const progressed = assistantMetricsProgressed({
        ...assistantMetrics,
        nextWakeAt,
      }, deliveryEffects.length)
        || wakeStateProgressed
        || terminalLinqCleanupDue;
      await writeHostedAssistantAutomationDetailRuntimeLogs({
        assistantMetrics,
        input,
      });
      await writeHostedAssistantPassRuntimeLog({
        assistantMetrics,
        deliveryEffectCount: deliveryEffects.length,
        input,
        nextWakeAt,
        progressed,
        systemMailboxWakeAt,
      });
      const phaseProgressed = progressed || providerCleanupDue;
      const redactedStatus = {
        ...buildHostedWorkspaceAssistantPhaseRedactedStatus({
          deliveryEffectCount: deliveryEffects.length,
          nextWakeAt,
          outboxTerminalizedSendingCount: 0,
          progressed: phaseProgressed,
          systemMailboxPrepared: 0,
          systemMailboxRetryableFailed: 0,
        }),
        ...(postDelivery.redactedStatus ?? {}),
      };
      if (!phaseProgressed) {
        return mergeContinuingSystemMailboxResult({
          ...(nextWakeAt ? { nextWakeAt } : {}),
          ...(shouldExposeHostedAssistantPhaseNextWakeReason(postDelivery.nextWakeReason)
            ? { nextWakeReason: postDelivery.nextWakeReason }
            : {}),
          progressed: false,
          redactedStatus,
        });
      }
      return mergeContinuingSystemMailboxResult({
        checkpointReason: postDelivery.checkpointReason,
        nextWakeAt,
        ...(shouldExposeHostedAssistantPhaseNextWakeReason(postDelivery.nextWakeReason)
          ? { nextWakeReason: postDelivery.nextWakeReason }
          : {}),
        progressed: true,
        redactedStatus,
      });
    }

    const outboxWakeAt = await resolveHostedAssistantOutboxNextWakeAt({
      vaultRoot: input.restored.vaultRoot,
    });
    const nextWake = selectHostedRuntimeWakeCandidate([
      createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
      assistantCronWakeAfterPassCandidate,
      deviceSyncFollowUpWake,
      createHostedRuntimeWakeCandidate(outboxWakeAt, "assistant"),
      systemMailboxWake,
      createHostedRuntimeWakeCandidate(deferredProviderCleanupWakeAt, "assistant"),
    ]);
    const nextWakeAt = nextWake.at;
    const wakeStateProgressed = hostedAssistantWakeStateProgressed({
      assistantMetrics,
      input,
      nextWakeAt,
      skippedDeviceSyncWakeAt: deviceSyncFollowUpWake?.at ?? null,
    });
    const progressed = assistantMetricsProgressed({
      ...assistantMetrics,
      nextWakeAt,
    }, deliveryEffects.length)
      || wakeStateProgressed
      || terminalLinqCleanupDue;
    await writeHostedAssistantAutomationDetailRuntimeLogs({
      assistantMetrics,
      input,
    });
    await writeHostedAssistantPassRuntimeLog({
      assistantMetrics,
      deliveryEffectCount: deliveryEffects.length,
      input,
      nextWakeAt,
      progressed,
      systemMailboxWakeAt,
    });
    const hasPostCommitProviderCleanup = providerCleanupDue
      || deliveryEffects.length > 0
      || terminalLinqCleanupDue;

    const phaseProgressed = progressed || providerCleanupDue;
    const redactedStatus = buildHostedWorkspaceAssistantPhaseRedactedStatus({
      deliveryEffectCount: deliveryEffects.length,
      nextWakeAt,
      outboxTerminalizedSendingCount: 0,
      progressed: phaseProgressed,
      systemMailboxPrepared: 0,
      systemMailboxRetryableFailed: 0,
    });
    if (!phaseProgressed) {
      return mergeContinuingSystemMailboxResult({
        ...(nextWakeAt ? { nextWakeAt } : {}),
        ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
          ? { nextWakeReason: nextWake.reason }
        : {}),
        progressed: false,
        redactedStatus,
      });
    }

    const result = mergeContinuingSystemMailboxResult({
      ...(hasPostCommitProviderCleanup
        ? {
            afterCheckpoint: async () => {
              assertHostedAssistantPhaseLiveness(input.signal);
              const baseNextWake = selectHostedRuntimeWakeCandidate([
                createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
                assistantCronWakeAfterPassCandidate,
                deviceSyncFollowUpWake,
                systemMailboxWake,
                createHostedRuntimeWakeCandidate(deferredProviderCleanupWakeAt, "assistant"),
              ]);
              const baseNextWakeAt = baseNextWake.at;
              if (
                deliveryEffects.length === 0
                && !providerCleanupDue
                && !terminalLinqCleanupDue
              ) {
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: baseNextWakeAt,
                  nextWakeReason: baseNextWake.reason,
                  redactedStatus: {
                    nextWakeAt: baseNextWakeAt,
                  },
                };
              }
              return await drainHostedPostCheckpointDelivery({
                assistantDeliveryEffects: deliveryEffects,
                assistantDeliveryPreparation: deliveryEffectsPreparation,
                baseNextWake,
                checkpointReason: deliveryEffects.length > 0 ? "outbox_receipt" : "provider_cleanup",
                canConsumeWorkspaceAssistantWake: true,
                input,
                providerCleanup: {
                  checkpoint: providerCleanupCheckpoint,
                  mode: "drain",
                },
                redactedStatus: null,
                wake,
              });
            },
          }
        : {}),
      checkpointReason: deliveryEffects.length > 0
        ? "outbox_sending"
        : resolveHostedAssistantTimerCheckpointReason({
            assistantMetrics: {
              ...assistantMetrics,
              nextWakeAt,
            },
            providerCleanupDue,
            terminalLinqCleanupDue,
            wakeStateProgressed,
          }),
      nextWakeAt,
      ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
        ? { nextWakeReason: nextWake.reason }
        : {}),
      progressed: true,
      redactedStatus,
    });
    return result;
  } finally {
    releaseChannelAbortRelay();
    channelAbortController.abort();
  }
}

function hasFreshHostedConversationInput(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return (input.initialMailboxImport.importResult.assistantInputIds?.length ?? 0) > 0
    || (input.initialMailboxImport.importResult.conversationImportedCount ?? 0) > 0;
}

function hasFreshHostedMailboxInput(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return input.initialMailboxImport.importResult.fetchedCount > 0;
}

async function resolveInitialPendingAssistantInputWakeAt(input: {
  hasFreshConversationInput: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<string | null> {
  if (input.hasFreshConversationInput) {
    return null;
  }

  return await resolvePendingAssistantInputWakeAt(input.input);
}

function emptyHostedSystemMailboxMaintenanceResult(input: {
  pendingAssistantInputWakeAt: string | null;
}): {
  continueAssistantLane: boolean;
  deviceSyncMaintenanceRan: boolean;
  initialProviderCleanupCheckpoint: HostedProviderCleanupCheckpoint | null;
  pendingAssistantInputWakeAt: string | null;
  result: HostedWorkspaceRunnerAssistantPhaseResult | null;
} {
  return {
    continueAssistantLane: false,
    deviceSyncMaintenanceRan: false,
    initialProviderCleanupCheckpoint: null,
    pendingAssistantInputWakeAt: input.pendingAssistantInputWakeAt,
    result: null,
  };
}

async function applyHostedManagedAutomationsBestEffort(input: {
  defaultRoute?: AutomationRoute | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  retryStableKeyFailure: boolean;
}): Promise<HostedWorkspaceRunnerAssistantPhaseResult | null> {
  if (input.input.shouldYieldBackgroundMaintenance?.() === true) {
    return null;
  }

  try {
    const result = await applyMurphManagedAutomations({
      now: new Date(resolveHostedAssistantPhaseNowMs(input.input)),
      operatorHomeRoot: input.input.restored.operatorHomeRoot,
      ...(input.defaultRoute !== undefined
        ? { defaultRoute: input.defaultRoute }
        : {}),
      routeValidationProfile: "hosted",
      runtimeEnv: input.input.runtimeEnv,
      vaultRoot: input.input.restored.vaultRoot,
    });
    const changed = result.created + result.updated;
    const shouldRetryStableKey =
      result.stableKeyRetryNeeded === true &&
      (input.retryStableKeyFailure || changed > 0);
    if (
      result.stableKeyRetryNeeded === true &&
      result.stableKeyFailure !== undefined
    ) {
      const failure = buildHostedRuntimeFailureDiagnostics(
        result.stableKeyFailure,
        "Hosted managed automation stable-key setup failed.",
      );
      await writeHostedRuntimeLogBestEffort({
        entry: {
          ...buildHostedRuntimeLogContextFields({
            attemptId: input.input.request.attemptId,
            leaseGeneration: input.input.request.leaseGeneration,
            workspaceVersion: input.input.request.workspaceVersion,
          }),
          component: "runtime",
          errorCode: failure.errorCode,
          eventCode: "runner.error",
          level: "warn",
          phase: "error",
          redactedJson: {
            ...failure.redactedJson,
            murphManagedAutomationCreated: result.created,
            murphManagedAutomationFailed: true,
            murphManagedAutomationSkipped: result.skipped,
            murphManagedAutomationUpdated: result.updated,
          },
        },
        platform: input.input.runtime.platform,
      });
    }
    if (
      changed === 0 &&
      !shouldRetryStableKey
    ) {
      return null;
    }

    await writeHostedRuntimeLogBestEffort({
      entry: {
        ...buildHostedRuntimeLogContextFields({
          attemptId: input.input.request.attemptId,
          leaseGeneration: input.input.request.leaseGeneration,
          workspaceVersion: input.input.request.workspaceVersion,
        }),
        component: "runtime",
        eventCode: "assistant.pass_finished",
        level: "info",
        phase: "invoke",
        redactedJson: {
          murphManagedAutomationCreated: result.created,
          murphManagedAutomationSkipped: result.skipped,
          ...(result.stableKeyRetryNeeded === true
            ? { murphManagedAutomationFailed: true }
            : {}),
          murphManagedAutomationUpdated: result.updated,
        },
      },
      platform: input.input.runtime.platform,
    });

    return {
      checkpointReason: "assistant_runtime_commit",
      ...(shouldRetryStableKey
        ? {
            nextWakeAt: new Date(
              resolveHostedAssistantPhaseNowMs(input.input)
                + HOSTED_MANAGED_AUTOMATION_SETUP_RETRY_DELAY_MS,
            ).toISOString(),
          }
        : {}),
      progressed: true,
      redactedStatus: {
        murphManagedAutomationCreated: result.created,
        ...(result.stableKeyRetryNeeded === true
          ? { murphManagedAutomationFailed: true }
          : {}),
        murphManagedAutomationSkipped: result.skipped,
        murphManagedAutomationUpdated: result.updated,
      },
    };
  } catch (error) {
    const failure = buildHostedRuntimeFailureDiagnostics(
      error,
      "Hosted managed automation setup failed.",
    );
    await writeHostedRuntimeLogBestEffort({
      entry: {
        ...buildHostedRuntimeLogContextFields({
          attemptId: input.input.request.attemptId,
          leaseGeneration: input.input.request.leaseGeneration,
          workspaceVersion: input.input.request.workspaceVersion,
        }),
        component: "runtime",
        errorCode: failure.errorCode,
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: {
          ...failure.redactedJson,
          murphManagedAutomationFailed: true,
        },
      },
      platform: input.input.runtime.platform,
    });
    return null;
  }
}

function withFreshHostedManagedAutomationsAfterCheckpoint(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  result: HostedWorkspaceRunnerAssistantPhaseResult;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  const assistantInputIds =
    input.input.initialMailboxImport.importResult.assistantInputIds ?? [];
  if (assistantInputIds.length === 0 || input.result.progressed !== true) {
    return input.result;
  }

  return {
    ...input.result,
    afterCheckpoint: composeHostedAssistantPhaseAfterCheckpoint({
      callbacks: [
        input.result.afterCheckpoint,
        async () => await applyFreshHostedManagedAutomationsAfterCheckpoint({
          input: input.input,
        }),
      ],
    }),
  };
}

async function applyFreshHostedManagedAutomationsAfterCheckpoint(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null> {
  if (input.input.shouldYieldBackgroundMaintenance?.() === true) {
    return null;
  }

  const defaultRoute = await resolveHostedManagedAutomationDefaultRouteBestEffort({
    input: input.input,
  });
  if (!defaultRoute) {
    return null;
  }

  const result = await applyHostedManagedAutomationsBestEffort({
    defaultRoute,
    input: input.input,
    retryStableKeyFailure: true,
  });
  if (!result || result.progressed !== true) {
    return null;
  }

  const assistantCronWake =
    await resolveHostedAssistantCronWakeStateBestEffort(input.input);
  const cronNextWakeAt = assistantCronWake.available
    ? assistantCronWake.wake?.at ?? null
    : new Date(
        resolveHostedAssistantPhaseNowMs(input.input)
          + HOSTED_ASSISTANT_CRON_STATUS_RETRY_DELAY_MS,
      ).toISOString();
  const hasManagedNextWakeAt = Object.hasOwn(result, "nextWakeAt");
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      cronNextWakeAt,
      assistantCronWake.wake?.reason ?? HOSTED_ASSISTANT_WAKE_REASON,
    ),
    createHostedRuntimeWakeCandidate(
      hasManagedNextWakeAt ? result.nextWakeAt ?? null : null,
      result.nextWakeReason ?? HOSTED_ASSISTANT_WAKE_REASON,
    ),
  ]);
  const hasNextWakeAt = cronNextWakeAt !== null || hasManagedNextWakeAt;

  return {
    checkpointReason: result.checkpointReason,
    ...(hasNextWakeAt ? { nextWakeAt: nextWake.at } : {}),
    ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
      ? { nextWakeReason: nextWake.reason }
      : {}),
    ...(result.redactedStatus ? { redactedStatus: result.redactedStatus } : {}),
  };
}

async function resolveHostedManagedAutomationDefaultRouteBestEffort(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<AutomationRoute | null> {
  const assistantInputIds =
    input.input.initialMailboxImport.importResult.assistantInputIds ?? [];
  if (assistantInputIds.length === 0) {
    return null;
  }

  const routes: AssistantCurrentDeliveryRoute[] = [];
  for (const inputId of assistantInputIds) {
    if (!inputId) {
      continue;
    }

    try {
      const event = await readAssistantInputEvent({
        inputId,
        vault: input.input.restored.vaultRoot,
      });
      if (!event) {
        return null;
      }
      if (event.replyTarget === null) {
        return null;
      }
      const route = readHostedAssistantInputCurrentDeliveryRoute({
        conversation: event.conversation ?? null,
        replyTarget: event.replyTarget ?? null,
      });
      if (!route) {
        return null;
      }
      routes.push(route);
    } catch {
      return null;
    }
  }

  const route = resolveUnambiguousCurrentDeliveryRoute(routes);
  if (!route) {
    return null;
  }

  return {
    channel: route.channel,
    deliverySource: null,
    deliveryTarget: route.deliveryTarget,
    identityId: route.identityId ?? null,
    participantId: route.participantId ?? null,
    threadId: route.threadId ?? null,
  };
}

function isHostedForegroundAssistantDeliveryPass(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  currentTurnDeliveryIntentIds: readonly string[];
  hasFreshConversationInput: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): boolean {
  return input.currentTurnDeliveryIntentIds.length > 0
    || input.hasFreshConversationInput
    || input.assistantMetrics.activeTurnInputIngested === true;
}

function mergeHostedAssistantPhaseResults(
  first: HostedWorkspaceRunnerAssistantPhaseResult | null,
  second: HostedWorkspaceRunnerAssistantPhaseResult | null,
): HostedWorkspaceRunnerAssistantPhaseResult | null {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }

  return mergeContinuingSystemMailboxAssistantPhaseResult({
    assistantResult: second,
    systemMailboxResult: first,
  });
}

function mergePendingAssistantInputMaintenanceResult(input: {
  pendingAttemptResult: HostedWorkspaceRunnerAssistantPhaseResult;
  systemMailboxResult: HostedWorkspaceRunnerAssistantPhaseResult | null;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  return mergeContinuingSystemMailboxAssistantPhaseResult({
    assistantResult: input.pendingAttemptResult,
    systemMailboxResult: stripHostedAssistantPhaseWake(input.systemMailboxResult),
  });
}

function stripHostedAssistantPhaseWake(
  result: HostedWorkspaceRunnerAssistantPhaseResult | null,
): HostedWorkspaceRunnerAssistantPhaseResult | null {
  if (!result) {
    return null;
  }

  const stripped: HostedWorkspaceRunnerAssistantPhaseResult = { ...result };
  delete stripped.nextWakeAt;
  delete stripped.nextWakeReason;
  if (result.afterCheckpoint) {
    stripped.afterCheckpoint = async () =>
      stripHostedAssistantPostCheckpointWake(await result.afterCheckpoint?.());
  }
  return stripped;
}

function stripHostedAssistantPostCheckpointWake(
  result: HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null | void,
): HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null {
  if (!result) {
    return null;
  }

  const stripped: HostedWorkspaceRunnerAssistantPhasePostCheckpoint = { ...result };
  delete stripped.nextWakeAt;
  delete stripped.nextWakeReason;
  return stripped;
}

function mergeContinuingSystemMailboxAssistantPhaseResult(input: {
  assistantResult: HostedWorkspaceRunnerAssistantPhaseResult;
  systemMailboxResult: HostedWorkspaceRunnerAssistantPhaseResult | null;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  if (!input.systemMailboxResult) {
    return input.assistantResult;
  }

  const hasNextWakeAt = Object.hasOwn(input.systemMailboxResult, "nextWakeAt")
    || Object.hasOwn(input.assistantResult, "nextWakeAt");
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      input.systemMailboxResult.nextWakeAt ?? null,
      input.systemMailboxResult.nextWakeReason ?? "assistant",
    ),
    createHostedRuntimeWakeCandidate(
      input.assistantResult.nextWakeAt ?? null,
      input.assistantResult.nextWakeReason ?? "assistant",
    ),
  ]);
  const redactedStatus = mergeHostedRuntimeRedactedStatus(
    input.systemMailboxResult.redactedStatus,
    input.assistantResult.redactedStatus,
  );
  const stagedDirtyAcks = mergeHostedDeviceSyncStagedDirtyAcks(
    input.systemMailboxResult.stagedDirtyAcks,
    input.assistantResult.stagedDirtyAcks,
  );
  const browserVaultReplicaRefreshRequested =
    input.systemMailboxResult.browserVaultReplicaRefreshRequested === true
    || input.assistantResult.browserVaultReplicaRefreshRequested === true;
  const deviceSyncMaintenanceRan =
    input.systemMailboxResult.deviceSyncMaintenanceRan === true
    || input.assistantResult.deviceSyncMaintenanceRan === true;
  const afterCheckpoint = composeHostedAssistantPhaseAfterCheckpoint({
    callbacks: [
      input.systemMailboxResult.afterCheckpoint,
      input.assistantResult.afterCheckpoint,
    ],
  });

  const progressedResult = input.assistantResult.progressed === true
    ? input.assistantResult
    : input.systemMailboxResult.progressed === true
    ? input.systemMailboxResult
    : null;
  // The foreground reply phase only ever reports its failed-reply count on the
  // assistant-lane result; carry it through the system-mailbox merge so the
  // workspace runner can gate the durable conversation consumed ack.
  const foregroundReplyFailed = input.assistantResult.foregroundReplyFailed;
  if (progressedResult) {
    return {
      ...(afterCheckpoint ? { afterCheckpoint } : {}),
      ...(browserVaultReplicaRefreshRequested
        ? { browserVaultReplicaRefreshRequested: true }
        : {}),
      ...(deviceSyncMaintenanceRan ? { deviceSyncMaintenanceRan: true } : {}),
      checkpointReason: progressedResult.checkpointReason,
      ...(foregroundReplyFailed === undefined ? {} : { foregroundReplyFailed }),
      ...(hasNextWakeAt ? { nextWakeAt: nextWake.at } : {}),
      ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
        ? { nextWakeReason: nextWake.reason }
        : {}),
      progressed: true,
      ...(redactedStatus ? { redactedStatus } : {}),
      ...withHostedDeviceSyncStagedDirtyAcks(stagedDirtyAcks),
    };
  }

  return {
    ...(browserVaultReplicaRefreshRequested
      ? { browserVaultReplicaRefreshRequested: true }
      : {}),
    ...(deviceSyncMaintenanceRan ? { deviceSyncMaintenanceRan: true } : {}),
    ...(foregroundReplyFailed === undefined ? {} : { foregroundReplyFailed }),
    ...(hasNextWakeAt ? { nextWakeAt: nextWake.at } : {}),
    ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
      ? { nextWakeReason: nextWake.reason }
      : {}),
    progressed: false,
    ...(redactedStatus ? { redactedStatus } : {}),
    ...withHostedDeviceSyncStagedDirtyAcks(stagedDirtyAcks),
  };
}

function withHostedDeviceSyncMaintenanceRan(
  result: HostedWorkspaceRunnerAssistantPhaseResult,
  deviceSyncMaintenanceRan: boolean,
): HostedWorkspaceRunnerAssistantPhaseResult {
  return deviceSyncMaintenanceRan
    ? { ...result, deviceSyncMaintenanceRan: true }
    : result;
}

function composeHostedAssistantPhaseAfterCheckpoint(input: {
  callbacks: readonly HostedWorkspaceRunnerAssistantPhaseResult["afterCheckpoint"][];
}): HostedWorkspaceRunnerAssistantPhaseResult["afterCheckpoint"] {
  const activeCallbacks = input.callbacks.filter(
    (callback): callback is NonNullable<
      HostedWorkspaceRunnerAssistantPhaseResult["afterCheckpoint"]
    > => callback !== null && callback !== undefined,
  );
  if (activeCallbacks.length === 0) {
    return null;
  }

  return async () => {
    let merged: HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null = null;
    for (const callback of activeCallbacks) {
      const result = await callback();
      if (!result) {
        continue;
      }
      merged = mergeHostedAssistantPhasePostCheckpoint(merged, result);
    }
    return merged;
  };
}

function mergeHostedAssistantPhasePostCheckpoint(
  previous: HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null,
  current: HostedWorkspaceRunnerAssistantPhasePostCheckpoint,
): HostedWorkspaceRunnerAssistantPhasePostCheckpoint {
  if (!previous) {
    return current;
  }

  const hasNextWakeAt = Object.hasOwn(previous, "nextWakeAt")
    || Object.hasOwn(current, "nextWakeAt");
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      previous.nextWakeAt ?? null,
      previous.nextWakeReason ?? "assistant",
    ),
    createHostedRuntimeWakeCandidate(
      current.nextWakeAt ?? null,
      current.nextWakeReason ?? "assistant",
    ),
  ]);
  const redactedStatus = mergeHostedRuntimeRedactedStatus(
    previous.redactedStatus,
    current.redactedStatus,
  );
  const afterDurableCheckpoint = composeHostedAssistantPhaseDurableCheckpointEffects(
    previous.afterDurableCheckpoint ?? null,
    current.afterDurableCheckpoint ?? null,
  );

  return {
    ...(afterDurableCheckpoint ? { afterDurableCheckpoint } : {}),
    checkpointReason: current.checkpointReason,
    ...(hasNextWakeAt ? { nextWakeAt: nextWake.at } : {}),
    ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
      ? { nextWakeReason: nextWake.reason }
      : {}),
    ...(redactedStatus ? { redactedStatus } : {}),
  };
}

function composeHostedAssistantPhaseDurableCheckpointEffects(
  first: HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"] | null,
  second: HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"] | null,
): HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"] | null {
  const effects = [
    ...listHostedAssistantPhaseDurableCheckpointEffects(first),
    ...listHostedAssistantPhaseDurableCheckpointEffects(second),
  ];
  if (effects.length === 0) {
    return null;
  }
  return effects;
}

function listHostedAssistantPhaseDurableCheckpointEffects(
  effect: HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"] | null,
): HostedWorkspaceDurableCheckpointEffect[] {
  if (!effect) {
    return [];
  }
  return typeof effect === "function" ? [effect] : [...effect];
}

interface DeferredHostedDeviceSyncDirtyPostCheckpointRecord {
  afterDurableCheckpoint: NonNullable<
    HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"]
  >;
  nextWakeAt: string | null;
  redactedStatus: HostedRuntimeRedactedJson;
}

interface DeferredHostedSystemMailboxPostCheckpointRecord {
  afterDurableCheckpoint: NonNullable<
    HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"]
  >;
  redactedStatus: HostedRuntimeRedactedJson;
  statusCallback: {
    failed: number;
    nextWakeAt: string | null;
    nextWakeReason?: string | null;
    recorded: number;
  };
}

function shouldDeferHostedSystemMailboxRecordAfterDurableCheckpoint(
  input: HostedSystemMailboxPendingItem,
): boolean {
  return input.postCheckpointRecord?.kind === "codex-auth.updated";
}

function deferHostedDeviceSyncDirtyPostCheckpointRecord(input: Parameters<
  typeof recordHostedDeviceSyncDirtyPostCheckpointRecord
>[0]): DeferredHostedDeviceSyncDirtyPostCheckpointRecord {
  return {
    afterDurableCheckpoint: async () => {
      try {
        const result = await recordHostedDeviceSyncDirtyPostCheckpointRecord(input);
        return result.nextWakeAt
          ? {
              nextWakeAt: result.nextWakeAt,
              nextWakeReason: HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
            }
          : null;
      } catch (error) {
        const failure = buildHostedRuntimeFailureDiagnostics(
          error,
          "Hosted device-sync dirty checkpoint ack failed.",
        );
        const nextWakeAt = resolveHostedDeviceSyncDirtyAckFailureWakeAt(input.record);
        await writeHostedRuntimeLogBestEffort({
          entry: {
            component: "device-sync",
            errorCode: failure.errorCode,
            eventCode: "device-sync.job_failed",
            level: "warn",
            phase: "checkpoint",
            redactedJson: {
              ...failure.redactedJson,
              nextWakeAtPresent: true,
            },
          },
          platform: input.runtime.platform,
        });
        return {
          nextWakeAt,
          nextWakeReason: HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
        };
      }
    },
    nextWakeAt: input.record.nextWakeAt ?? null,
    redactedStatus: {
      hostedDeviceSyncDirtyAckDeferred: true,
      hostedDeviceSyncDirtyAckRecorded: false,
      hostedDeviceSyncDirtyStillPending: true,
    },
  };
}

function deferHostedSystemMailboxPostCheckpointRecord(input: Parameters<
  typeof recordHostedSystemMailboxItemAfterCheckpoint
>[0] & {
  followUpWakeAt: string;
}): DeferredHostedSystemMailboxPostCheckpointRecord {
  const { followUpWakeAt, ...recordInput } = input;
  return {
    afterDurableCheckpoint: async () => {
      const result = await recordHostedSystemMailboxItemAfterCheckpoint(recordInput);
      if (result.failed > 0) {
        return {
          nextWakeAt: result.nextWakeAt,
          nextWakeReason: result.nextWakeReason ?? "assistant",
          requiresFollowUpCheckpoint: true,
        };
      }
      return {
        nextWakeAt: followUpWakeAt,
        nextWakeReason: "assistant",
        requiresFollowUpCheckpoint: true,
      };
    },
    redactedStatus: {
      hostedSystemMailboxRecordDeferred: true,
    },
    statusCallback: {
      failed: 0,
      nextWakeAt: null,
      recorded: 0,
    },
  };
}

function resolveHostedDeviceSyncDirtyAckFailureWakeAt(input: Parameters<
  typeof recordHostedDeviceSyncDirtyPostCheckpointRecord
>[0]["record"]): string {
  return input.nextWakeAt
    ?? new Date(Date.now() + HOSTED_DEVICE_SYNC_DIRTY_ACK_FAILURE_RETRY_DELAY_MS).toISOString();
}

function mergeHostedRuntimeRedactedStatus(
  first: HostedRuntimeRedactedJson | null | undefined,
  second: HostedRuntimeRedactedJson | null | undefined,
): HostedRuntimeRedactedJson | null {
  if (!first && !second) {
    return null;
  }

  const merged: HostedRuntimeRedactedJson = {
    ...(first ?? {}),
    ...(second ?? {}),
  };
  const systemMailboxPrepared =
    readHostedRuntimeRedactedNumber(first, "hostedSystemMailboxPrepared")
    + readHostedRuntimeRedactedNumber(second, "hostedSystemMailboxPrepared");
  const systemMailboxRetryableFailed =
    readHostedRuntimeRedactedNumber(first, "hostedSystemMailboxRetryableFailed")
    + readHostedRuntimeRedactedNumber(second, "hostedSystemMailboxRetryableFailed");
  if (systemMailboxPrepared > 0) {
    merged.hostedSystemMailboxPrepared = systemMailboxPrepared;
  }
  if (systemMailboxRetryableFailed > 0) {
    merged.hostedSystemMailboxRetryableFailed = systemMailboxRetryableFailed;
  }
  if (
    first?.hostedAssistantProgressed === true
    || second?.hostedAssistantProgressed === true
  ) {
    merged.hostedAssistantProgressed = true;
  }

  return merged;
}

function readHostedRuntimeRedactedNumber(
  value: HostedRuntimeRedactedJson | null | undefined,
  key: string,
): number {
  const field = value?.[key];
  return typeof field === "number" ? field : 0;
}

function shouldContinueAssistantLaneAfterSystemMailboxPreparation(
  systemMailboxPreparation: NonNullable<
    Awaited<ReturnType<typeof prepareHostedSystemMailboxItemForCheckpoint>>
  >,
): boolean {
  return "item" in systemMailboxPreparation
    && systemMailboxPreparation.status === "processed"
    && systemMailboxPreparation.item.routeAction === "apply-runtime-control-request"
    && systemMailboxPreparation.item.wake.kind === "runtime.manual-requested";
}

type HostedAssistantDeliveryEffects = Awaited<
  ReturnType<typeof collectHostedAssistantDeliverySideEffects>
>;
interface HostedPreparedAssistantDeliveryEffects {
  effects: HostedAssistantDeliveryEffects;
  preparation: HostedAssistantDeliveryPreparation | null;
}
type HostedAssistantMetrics = Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
type HostedDeviceSyncWakeMetrics = Awaited<ReturnType<typeof runHostedDeviceSyncWakeLane>>;
type HostedDeviceActivityAutomationScheduleResult =
  Awaited<ReturnType<typeof scheduleDeviceActivityTriggeredAutomations>>;
type HostedSystemMailboxPreparation = NonNullable<
  Awaited<ReturnType<typeof prepareHostedSystemMailboxItemForCheckpoint>>
>;
type HostedTerminalLinqCleanupEvidence = Awaited<
  ReturnType<typeof listPendingAssistantAutoReplyLinqCleanupEvidence>
>;
type HostedAssistantCronStatus = Awaited<ReturnType<typeof getAssistantCronStatus>>;

interface HostedAssistantCronWakeState {
  available: boolean;
  dueNow: boolean;
  wake: HostedRuntimeWakeCandidate | null;
}

function isBrowserVaultReplicaRefreshSystemMailboxPreparation(
  systemMailboxPreparation: HostedSystemMailboxPreparation,
): boolean {
  return "item" in systemMailboxPreparation
    && systemMailboxPreparation.status === "processed"
    && systemMailboxPreparation.item.routeAction === "apply-runtime-control-request"
    && systemMailboxPreparation.item.wake.kind === "runtime.browser-vault-refresh-requested";
}

function mergeHostedDeviceSyncStagedDirtyAcks(
  ...groups: readonly (readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null | undefined)[]
): HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] {
  return groups.flatMap((group) => group ?? []);
}

function withHostedDeviceSyncStagedDirtyAcks(
  records: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null | undefined,
): { stagedDirtyAcks: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] } | Record<string, never> {
  return records && records.length > 0
    ? { stagedDirtyAcks: records }
    : {};
}

function emptyHostedDeviceActivityAutomationScheduleResult(): HostedDeviceActivityAutomationScheduleResult {
  return {
    matched: 0,
    nextWakeAt: null,
    scheduled: 0,
  };
}

function createHostedDeviceActivityAutomationWakeCandidate(
  result: HostedDeviceActivityAutomationScheduleResult | null,
): HostedRuntimeWakeCandidate | null {
  return createHostedRuntimeWakeCandidate(
    result?.nextWakeAt ?? null,
    HOSTED_ASSISTANT_WAKE_REASON,
  );
}

function resolveHostedAssistantCronWakeState(
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput,
  cronStatus: HostedAssistantCronStatus,
): HostedAssistantCronWakeState {
  const nowMs = resolveHostedAssistantPhaseNowMs(phaseInput);
  const dueNow = cronStatus.dueJobs > 0;
  if (dueNow) {
    return {
      available: true,
      dueNow: true,
      wake: createHostedRuntimeWakeCandidate(
        new Date(nowMs).toISOString(),
        HOSTED_ASSISTANT_WAKE_REASON,
      ),
    };
  }

  return {
    available: true,
    dueNow: false,
    wake: createHostedRuntimeWakeCandidate(
      resolveHostedAssistantAutomationNextWakeAt({
        input: phaseInput,
        nextWakeAt: cronStatus.nextRunAt,
      }),
      HOSTED_ASSISTANT_WAKE_REASON,
    ),
  };
}

// Best-effort because this read is wake reconciliation for background lanes:
// due cron should run the assistant lane now, future cron should stay armed,
// and a transient status-read failure must not break unrelated maintenance.
async function resolveHostedAssistantCronWakeStateBestEffort(
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput,
): Promise<HostedAssistantCronWakeState> {
  try {
    const cronStatus = await getAssistantCronStatus(phaseInput.restored.vaultRoot);
    return resolveHostedAssistantCronWakeState(phaseInput, cronStatus);
  } catch {
    return {
      available: false,
      dueNow: false,
      wake: null,
    };
  }
}

function resolveHostedAssistantCronWakeCandidate(input: {
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
  state: HostedAssistantCronWakeState;
}): HostedRuntimeWakeCandidate | null {
  if (input.state.available) {
    return input.state.wake;
  }

  return createExistingHostedAssistantWorkspaceWakeCandidate(input.phaseInput);
}

function createExistingHostedAssistantWorkspaceWakeCandidate(
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput,
): HostedRuntimeWakeCandidate | null {
  const wakeAt = phaseInput.workspace?.nextWakeAt ?? null;
  const wakeReason = phaseInput.workspace?.nextWakeReason ?? null;
  if (wakeReason !== null && wakeReason !== HOSTED_ASSISTANT_WAKE_REASON) {
    return null;
  }

  return createHostedRuntimeWakeCandidate(wakeAt, HOSTED_ASSISTANT_WAKE_REASON);
}

function withHostedAssistantCronWakeCandidate(input: {
  assistantCronWake: HostedRuntimeWakeCandidate | null;
  result: HostedWorkspaceRunnerAssistantPhaseResult;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  return withHostedRuntimeWakeCandidate({
    result: input.result,
    wake: input.assistantCronWake,
  });
}

function withHostedRuntimeWakeCandidate(input: {
  result: HostedWorkspaceRunnerAssistantPhaseResult;
  wake: HostedRuntimeWakeCandidate | null;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  const currentWake = Object.hasOwn(input.result, "nextWakeAt")
    || Object.hasOwn(input.result, "nextWakeReason")
    ? createHostedRuntimeWakeCandidate(
        input.result.nextWakeAt ?? null,
        input.result.nextWakeReason ?? "assistant",
      )
    : null;
  const nextWake = selectHostedRuntimeWakeCandidate([
    currentWake,
    input.wake,
  ]);
  if (!nextWake.at && !currentWake?.at) {
    return input.result;
  }

  const selectedExistingWake =
    currentWake?.at === nextWake.at
    && currentWake.reason === nextWake.reason
    && Object.hasOwn(input.result, "nextWakeReason");
  const nextWakeReason = selectedExistingWake
    ? input.result.nextWakeReason ?? "assistant"
    : shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
      ? nextWake.reason
      : null;
  const result = { ...input.result };
  delete result.nextWakeAt;
  delete result.nextWakeReason;
  return {
    ...result,
    ...(nextWake.at ? { nextWakeAt: nextWake.at } : {}),
    ...(nextWakeReason
      ? { nextWakeReason }
      : {}),
  };
}

async function resolveHostedBackgroundMaintenanceWakeCandidate(input: {
  assistantCronWake?: HostedRuntimeWakeCandidate | null;
  deviceActivityAutomation?: HostedDeviceActivityAutomationScheduleResult | null;
  deviceSyncFollowUpWake?: HostedRuntimeWakeCandidate | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  pendingAssistantInputWakeAt?: string | null;
  providerCleanupCheckpoint?: HostedProviderCleanupCheckpoint | null;
  providerCleanupDue?: boolean;
  systemMailboxWake?: HostedRuntimeWakeCandidate | null;
  systemMailboxWakeAt?: string | null;
}): Promise<HostedRuntimeWakeCandidate> {
  const outboxWakeAt = await resolveHostedAssistantOutboxNextWakeAt({
    vaultRoot: input.input.restored.vaultRoot,
  });
  const systemMailboxWake = Object.hasOwn(input, "systemMailboxWake")
    ? input.systemMailboxWake ?? null
    : Object.hasOwn(input, "systemMailboxWakeAt")
      ? createHostedRuntimeWakeCandidate(input.systemMailboxWakeAt ?? null, "assistant")
      : await resolveHostedSystemMailboxNextWakeCandidate({
          vaultRoot: input.input.restored.vaultRoot,
        });

  return selectHostedRuntimeWakeCandidate([
    input.deviceSyncFollowUpWake,
    createHostedRuntimeWakeCandidate(outboxWakeAt, "assistant"),
    systemMailboxWake,
    createHostedRuntimeWakeCandidate(input.pendingAssistantInputWakeAt ?? null, "assistant"),
    createHostedDeviceActivityAutomationWakeCandidate(input.deviceActivityAutomation ?? null),
    input.assistantCronWake,
    createHostedRuntimeWakeCandidate(
      input.providerCleanupDue ? null : input.providerCleanupCheckpoint?.nextWakeAt ?? null,
      "assistant",
    ),
  ]);
}

function shouldPreflightHostedAssistantCronWakeBeforeSystemMailbox(
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  const wakeAt = phaseInput.workspace?.nextWakeAt ?? null;
  if (!wakeAt) {
    return false;
  }
  const wakeReason = phaseInput.workspace?.nextWakeReason ?? null;
  if (wakeReason !== null && wakeReason !== HOSTED_ASSISTANT_WAKE_REASON) {
    return false;
  }

  const wakeTimeMs = Date.parse(wakeAt);
  return Number.isFinite(wakeTimeMs)
    && wakeTimeMs <= resolveHostedAssistantPhaseNowMs(phaseInput);
}

function systemMailboxPreparationRanDeviceSync(
  systemMailboxPreparation: HostedSystemMailboxPreparation,
): boolean {
  return "item" in systemMailboxPreparation
    && systemMailboxPreparation.item.routeAction === "run-device-sync-wake";
}

function shouldRunIdleDeviceSyncMaintenance(input: {
  pendingAssistantInputBlocksMaintenance: boolean;
  pendingAssistantInputWakeAt: string | null;
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
  shouldYieldAfterSystemMailboxPreparation: boolean;
  systemMailboxPreparation: HostedSystemMailboxPreparation | null;
}): boolean {
  if (
    input.pendingAssistantInputWakeAt
    && input.pendingAssistantInputBlocksMaintenance
  ) {
    return false;
  }
  if (input.shouldYieldAfterSystemMailboxPreparation) {
    return false;
  }
  if (!hasHostedDeviceSyncRuntimeConfigured(input.phaseInput)) {
    return false;
  }

  const preparation = input.systemMailboxPreparation;
  if (preparation?.status === "retryable_failed") {
    return false;
  }

  if (
    preparation
    && "item" in preparation
    && preparation.item.routeAction === "run-device-sync-wake"
  ) {
    return false;
  }

  return isDueHostedDeviceSyncReconcileAlarm(input.phaseInput);
}

async function runIdleDeviceSyncWakeLaneBestEffort(input: {
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<HostedDeviceSyncWakeMetrics> {
  const cancellation = createHostedIdleDeviceSyncMaintenanceCancellation({
    signal: input.phaseInput.signal ?? null,
    shouldYield: input.phaseInput.shouldYieldBackgroundMaintenance ?? null,
    timeoutMs: input.phaseInput.runtime.commitTimeoutMs,
  });

  try {
    return await runHostedDeviceSyncWakeLane({
      deviceSyncPort: input.phaseInput.runtime.platform.deviceSyncPort ?? null,
      platformEnv: input.phaseInput.runtime.platformEnv,
      runtimeLogPlatform: input.phaseInput.runtime.platform,
      resolvedConfig: input.phaseInput.runtime.resolvedConfig,
      ...(input.phaseInput.shouldYieldBackgroundMaintenance
        ? { shouldYieldDeviceSync: input.phaseInput.shouldYieldBackgroundMaintenance }
        : {}),
      signal: cancellation.signal,
      skipDirtyPendingFetch: input.phaseInput.suppressDirtyPendingFetch ?? false,
      stagedDirtyAcks: input.phaseInput.stagedDirtyAcks ?? null,
      timeoutMs: input.phaseInput.runtime.commitTimeoutMs,
      vaultRoot: input.phaseInput.restored.vaultRoot,
      wake: input.wake,
    });
  } catch (error) {
    const retryAt = new Date(
      resolveHostedAssistantPhaseNowMs(input.phaseInput)
        + HOSTED_SKIPPED_DEVICE_SYNC_RETRY_DELAY_MS,
    ).toISOString();
    await writeHostedIdleDeviceSyncFailureRuntimeLog({
      error,
      input: input.phaseInput,
      retryAt,
    });
    return {
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: retryAt,
      nextWakeReason: HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
      parserProcessed: 0,
      postCheckpointRecord: null,
    };
  } finally {
    cancellation.dispose();
  }
}

async function scheduleDeviceActivityAutomationsAfterDeviceSyncBestEffort(input: {
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<HostedDeviceActivityAutomationScheduleResult> {
  try {
    return await scheduleDeviceActivityTriggeredAutomations({
      now: () => new Date(resolveHostedAssistantPhaseNowMs(input.phaseInput)).toISOString(),
      signal: input.phaseInput.signal ?? undefined,
      vault: input.phaseInput.restored.vaultRoot,
    });
  } catch (error) {
    await writeHostedDeviceActivityAutomationScheduleFailureRuntimeLog({
      error,
      input: input.phaseInput,
      wake: input.wake,
    });
    return emptyHostedDeviceActivityAutomationScheduleResult();
  }
}

function createHostedIdleDeviceSyncMaintenanceCancellation(input: {
  signal: AbortSignal | null;
  shouldYield: (() => boolean) | null;
  timeoutMs: number | null;
}): {
  dispose(): void;
  signal: AbortSignal | null;
} {
  if (!input.signal && !input.shouldYield && !input.timeoutMs) {
    return {
      dispose: () => undefined,
      signal: null,
    };
  }

  const controller = new AbortController();
  const abort = (reason: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };
  const abortForOuterSignal = () => {
    abort(readHostedIdleDeviceSyncAbortReason(input.signal));
  };
  const abortForForeground = () => {
    abort(new DOMException("Idle device sync yielded to foreground input.", "AbortError"));
  };
  const abortForTimeout = () => {
    abort(new DOMException("Idle device sync exceeded its maintenance budget.", "AbortError"));
  };

  input.signal?.addEventListener("abort", abortForOuterSignal, { once: true });
  if (input.signal?.aborted) {
    abortForOuterSignal();
  }

  const pollTimer = input.shouldYield
    ? setInterval(() => {
        if (input.shouldYield?.() === true) {
          abortForForeground();
        }
      }, HOSTED_IDLE_DEVICE_SYNC_PREEMPTION_POLL_MS)
    : null;
  pollTimer?.unref?.();

  const timeoutTimer = input.timeoutMs && input.timeoutMs > 0
    ? setTimeout(abortForTimeout, input.timeoutMs)
    : null;
  timeoutTimer?.unref?.();

  return {
    dispose() {
      input.signal?.removeEventListener("abort", abortForOuterSignal);
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
    },
    signal: controller.signal,
  };
}

function readHostedIdleDeviceSyncAbortReason(signal: AbortSignal | null): unknown {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Idle device sync was aborted.", "AbortError");
}

async function writeHostedIdleDeviceSyncFailureRuntimeLog(input: {
  error: unknown;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  retryAt: string;
}): Promise<void> {
  const failure = buildHostedRuntimeFailureDiagnostics(
    input.error,
    "Hosted idle device-sync maintenance failed.",
  );
  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "device-sync",
      errorCode: failure.errorCode,
      eventCode: "device-sync.job_failed",
      level: "warn",
      phase: "idle",
      redactedJson: {
        ...failure.redactedJson,
        errorMessagePresent: input.error instanceof Error
          ? input.error.message.length > 0
          : input.error !== null && input.error !== undefined,
        idleMaintenanceFailed: true,
        retryAt: input.retryAt,
      },
    },
    platform: input.input.runtime.platform,
  });
}

async function writeHostedDeviceActivityAutomationScheduleFailureRuntimeLog(input: {
  error: unknown;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<void> {
  const failure = buildHostedRuntimeFailureDiagnostics(
    input.error,
    "Hosted device activity automation scheduling failed.",
  );
  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "runtime",
      errorCode: failure.errorCode,
      eventCode: "device-sync.job_failed",
      level: "warn",
      phase: "idle",
      redactedJson: {
        deviceActivityAutomationScheduleFailed: true,
        ...failure.redactedJson,
        errorMessagePresent: input.error instanceof Error
          ? input.error.message.length > 0
          : input.error !== null && input.error !== undefined,
        wakeKind: input.wake.kind,
      },
    },
    platform: input.input.runtime.platform,
  });
}

function buildIdleDeviceSyncOnlyAssistantPhaseResult(input: {
  assistantCronWake: HostedRuntimeWakeCandidate | null;
  backgroundWake: HostedRuntimeWakeCandidate | null;
  deviceActivityAutomation: HostedDeviceActivityAutomationScheduleResult | null;
  dirtyDeviceSyncMetrics: HostedDeviceSyncWakeMetrics;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  pendingAssistantInputWakeAt: string | null;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  const dirtyDeviceSyncWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      input.dirtyDeviceSyncMetrics.nextWakeAt,
      input.dirtyDeviceSyncMetrics.nextWakeReason ?? HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
    ),
    createHostedRuntimeWakeCandidate(
      input.dirtyDeviceSyncMetrics.postCheckpointRecord?.nextWakeAt ?? null,
      HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
    ),
    createHostedDeviceActivityAutomationWakeCandidate(input.deviceActivityAutomation),
    input.assistantCronWake,
    input.backgroundWake,
    createHostedRuntimeWakeCandidate(
      input.pendingAssistantInputWakeAt,
      HOSTED_ASSISTANT_WAKE_REASON,
    ),
  ]);
  const nextWakeAt = dirtyDeviceSyncWake.at;
  const dirtyPostCheckpoint = input.dirtyDeviceSyncMetrics.postCheckpointRecord
    ? deferHostedDeviceSyncDirtyPostCheckpointRecord({
        record: input.dirtyDeviceSyncMetrics.postCheckpointRecord,
        runtime: input.input.runtime,
      })
    : null;
  return {
    ...(dirtyPostCheckpoint
      ? {
          afterCheckpoint: async () => {
            assertHostedAssistantPhaseLiveness(input.input.signal);
            return {
              afterDurableCheckpoint: dirtyPostCheckpoint.afterDurableCheckpoint,
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt,
              ...(shouldExposeHostedAssistantPhaseNextWakeReason(dirtyDeviceSyncWake.reason)
                ? { nextWakeReason: dirtyDeviceSyncWake.reason }
                : {}),
              redactedStatus: dirtyPostCheckpoint.redactedStatus,
            };
          },
        }
      : {}),
    checkpointReason: "assistant_runtime_commit",
    nextWakeAt,
    ...(dirtyDeviceSyncWake.reason ? { nextWakeReason: dirtyDeviceSyncWake.reason } : {}),
    progressed: true,
    redactedStatus: buildHostedWorkspaceAssistantPhaseRedactedStatus({
      deliveryEffectCount: 0,
      nextWakeAt,
      outboxTerminalizedSendingCount: 0,
      progressed: true,
      systemMailboxPrepared: 0,
      systemMailboxRetryableFailed: 0,
    }),
    ...withHostedDeviceSyncStagedDirtyAcks(input.dirtyDeviceSyncMetrics.stagedDirtyAcks),
  };
}

async function runBackgroundMaintenanceAfterDeferredPendingAssistantInput(input: {
  assistantMetrics: HostedAssistantMetrics;
  assistantNextWakeAt: string | null;
  executionContext: AssistantExecutionContext;
  foregroundAssistantPass: boolean;
  hasFreshConversationInput: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  systemMailboxMaintenance: Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>>;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>> | null> {
  if (!shouldRunBackgroundMaintenanceAfterDeferredPendingAssistantInput(input)) {
    return null;
  }

  const pendingAssistantInputWakeAt = resolveDeferredPendingAssistantInputWakeAt(input);
  const maintenance = await runSystemMailboxMaintenancePhase({
    executionContext: input.executionContext,
    hasFreshConversationInput: input.hasFreshConversationInput,
    input: input.input,
    pendingAssistantInputBlocksMaintenance: false,
    pendingAssistantInputWakeAt,
    wake: input.wake,
  });
  return withDeferredPendingAssistantInputWake({
    maintenance,
    pendingAssistantInputWakeAt,
  });
}

function withDeferredPendingAssistantInputWake(input: {
  maintenance: Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>>;
  pendingAssistantInputWakeAt: string | null;
}): Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>> {
  const pendingWakeResult = buildDeferredPendingAssistantInputWakeResult({
    pendingAssistantInputWakeAt: input.pendingAssistantInputWakeAt,
  });
  if (!pendingWakeResult) {
    return input.maintenance;
  }

  return {
    ...input.maintenance,
    result: mergeHostedAssistantPhaseResults(
      input.maintenance.result,
      pendingWakeResult,
    ),
  };
}

function buildDeferredPendingAssistantInputWakeResult(input: {
  pendingAssistantInputWakeAt: string | null;
}): HostedWorkspaceRunnerAssistantPhaseResult | null {
  if (!input.pendingAssistantInputWakeAt) {
    return null;
  }

  return {
    nextWakeAt: input.pendingAssistantInputWakeAt,
    progressed: false,
  };
}

function shouldRunBackgroundMaintenanceAfterDeferredPendingAssistantInput(input: {
  assistantMetrics: HostedAssistantMetrics;
  assistantNextWakeAt: string | null;
  foregroundAssistantPass: boolean;
  hasFreshConversationInput: boolean;
  systemMailboxMaintenance: Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>>;
}): boolean {
  if (
    input.hasFreshConversationInput
    || input.foregroundAssistantPass
    || !input.systemMailboxMaintenance.pendingAssistantInputWakeAt
  ) {
    return false;
  }

  if (input.assistantNextWakeAt !== null) {
    return true;
  }

  return input.assistantMetrics.assistantAutomationProgressed !== true;
}

function resolveDeferredPendingAssistantInputWakeAt(input: {
  assistantMetrics: HostedAssistantMetrics;
  assistantNextWakeAt: string | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): string | null {
  if (input.assistantNextWakeAt !== null) {
    return input.assistantNextWakeAt;
  }

  if (input.assistantMetrics.assistantAutomationProgressed === true) {
    return null;
  }

  return new Date(
    resolveHostedAssistantPhaseNowMs(input.input)
      + HOSTED_DEFERRED_PENDING_ASSISTANT_INPUT_RETRY_DELAY_MS,
  ).toISOString();
}

async function runSystemMailboxMaintenancePhase(input: {
  executionContext: AssistantExecutionContext;
  hasFreshConversationInput: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  pendingAssistantInputBlocksMaintenance?: boolean;
  pendingAssistantInputWakeAt?: string | null;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<{
  continueAssistantLane: boolean;
  deviceSyncMaintenanceRan: boolean;
  initialProviderCleanupCheckpoint: HostedProviderCleanupCheckpoint | null;
  pendingAssistantInputWakeAt: string | null;
  result: HostedWorkspaceRunnerAssistantPhaseResult | null;
}> {
  if (
    input.hasFreshConversationInput
    || input.input.shouldYieldBackgroundMaintenance?.() === true
  ) {
    return {
      continueAssistantLane: false,
      deviceSyncMaintenanceRan: false,
      initialProviderCleanupCheckpoint: null,
      pendingAssistantInputWakeAt: null,
      result: null,
    };
  }

  const phaseInput = input.input;
  const initialProviderCleanupCheckpoint =
    await readHostedProviderCleanupCheckpoint(phaseInput.restored.vaultRoot);
  let assistantCronWakeState: HostedAssistantCronWakeState | null = null;
  const readAssistantCronWakeState = async (): Promise<HostedAssistantCronWakeState> => {
    if (assistantCronWakeState) {
      return assistantCronWakeState;
    }
    const state = await resolveHostedAssistantCronWakeStateBestEffort(phaseInput);
    if (state.available) {
      assistantCronWakeState = state;
    }
    return state;
  };
  const invalidateAssistantCronWakeState = (): void => {
    assistantCronWakeState = null;
  };
  const hasPendingAssistantInputWakeOverride = Object.hasOwn(input, "pendingAssistantInputWakeAt");
  let pendingAssistantInputWakeAt = hasPendingAssistantInputWakeOverride
    ? input.pendingAssistantInputWakeAt ?? null
    : await resolvePendingAssistantInputWakeAt(phaseInput);
  const pendingAssistantInputBlocksMaintenance =
    input.pendingAssistantInputBlocksMaintenance ?? true;
  if (pendingAssistantInputWakeAt && pendingAssistantInputBlocksMaintenance) {
    return {
      continueAssistantLane: false,
      deviceSyncMaintenanceRan: false,
      initialProviderCleanupCheckpoint,
      pendingAssistantInputWakeAt,
      result: null,
    };
  }

  if (
    pendingAssistantInputBlocksMaintenance
    && shouldPreflightHostedAssistantCronWakeBeforeSystemMailbox(phaseInput)
  ) {
    const preflightAssistantCronWakeState = await readAssistantCronWakeState();
    if (preflightAssistantCronWakeState.dueNow) {
      return {
        continueAssistantLane: true,
        deviceSyncMaintenanceRan: false,
        initialProviderCleanupCheckpoint,
        pendingAssistantInputWakeAt: null,
        result: null,
      };
    }
  }

  const systemMailboxPreparation = await prepareHostedSystemMailboxItemForCheckpoint({
    executionContext: input.executionContext,
    operatorHomeRoot: phaseInput.restored.operatorHomeRoot,
    runtime: phaseInput.runtime,
    runtimeEnv: phaseInput.runtimeEnv,
    shouldYieldBackgroundMaintenance: phaseInput.shouldYieldBackgroundMaintenance ?? null,
    vaultRoot: phaseInput.restored.vaultRoot,
  });
  const shouldYieldAfterSystemMailboxPreparation =
    phaseInput.shouldYieldBackgroundMaintenance?.() === true;
  if (!hasPendingAssistantInputWakeOverride && !pendingAssistantInputWakeAt) {
    pendingAssistantInputWakeAt = await resolvePendingAssistantInputWakeAt(phaseInput);
  }
  const initialProviderCleanupDue =
    !shouldYieldAfterSystemMailboxPreparation
    && isHostedProviderCleanupCheckpointDue(initialProviderCleanupCheckpoint, phaseInput);
  const shouldRunDirtyDeviceSyncWorkSource = shouldRunIdleDeviceSyncMaintenance({
    phaseInput,
    pendingAssistantInputBlocksMaintenance,
    pendingAssistantInputWakeAt,
    shouldYieldAfterSystemMailboxPreparation,
    systemMailboxPreparation,
  });
  const dirtyDeviceSyncMetrics = shouldRunDirtyDeviceSyncWorkSource
    ? await runIdleDeviceSyncWakeLaneBestEffort({
        phaseInput,
        wake: input.wake,
      })
    : null;
  const dirtyDeviceActivityAutomation = dirtyDeviceSyncMetrics &&
      !dirtyDeviceSyncMetrics.deviceSyncSkipped &&
      phaseInput.shouldYieldBackgroundMaintenance?.() !== true
    ? await scheduleDeviceActivityAutomationsAfterDeviceSyncBestEffort({
      phaseInput,
      wake: input.wake,
    })
    : null;
  if (dirtyDeviceSyncMetrics && !dirtyDeviceSyncMetrics.deviceSyncSkipped) {
    invalidateAssistantCronWakeState();
  }
  if (!systemMailboxPreparation) {
    if (pendingAssistantInputWakeAt && pendingAssistantInputBlocksMaintenance) {
      return {
        continueAssistantLane: false,
        deviceSyncMaintenanceRan: false,
        initialProviderCleanupCheckpoint,
        pendingAssistantInputWakeAt,
        result: null,
      };
    }
    if (dirtyDeviceSyncMetrics) {
      const dirtyAssistantCronWakeState = await readAssistantCronWakeState();
      const assistantCronWake = resolveHostedAssistantCronWakeCandidate({
        phaseInput,
        state: dirtyAssistantCronWakeState,
      });
      const backgroundWake = await resolveHostedBackgroundMaintenanceWakeCandidate({
        assistantCronWake,
        deviceActivityAutomation: dirtyDeviceActivityAutomation,
        input: phaseInput,
        pendingAssistantInputWakeAt,
        providerCleanupCheckpoint: initialProviderCleanupCheckpoint,
        providerCleanupDue: initialProviderCleanupDue,
      });
      return {
        continueAssistantLane: dirtyAssistantCronWakeState.dueNow,
        deviceSyncMaintenanceRan: !dirtyDeviceSyncMetrics.deviceSyncSkipped,
        initialProviderCleanupCheckpoint,
        pendingAssistantInputWakeAt,
        result: buildIdleDeviceSyncOnlyAssistantPhaseResult({
          assistantCronWake,
          backgroundWake,
          deviceActivityAutomation: dirtyDeviceActivityAutomation,
          dirtyDeviceSyncMetrics,
          input: phaseInput,
          pendingAssistantInputWakeAt,
        }),
      };
    }
    const contextSnapshotRefresh =
      await runAssistantContextSnapshotIdleRefreshBestEffort({
        phaseInput,
      });
    if (contextSnapshotRefresh) {
      const contextAssistantCronWakeState = await readAssistantCronWakeState();
      const assistantCronWake = resolveHostedAssistantCronWakeCandidate({
        phaseInput,
        state: contextAssistantCronWakeState,
      });
      const backgroundWake = await resolveHostedBackgroundMaintenanceWakeCandidate({
        assistantCronWake,
        input: phaseInput,
        pendingAssistantInputWakeAt,
        providerCleanupCheckpoint: initialProviderCleanupCheckpoint,
        providerCleanupDue: initialProviderCleanupDue,
      });
      return {
        continueAssistantLane: false,
        deviceSyncMaintenanceRan: false,
        initialProviderCleanupCheckpoint,
        pendingAssistantInputWakeAt,
        result: withHostedRuntimeWakeCandidate({
          wake: backgroundWake,
          result: contextSnapshotRefresh,
        }),
      };
    }

    return {
      continueAssistantLane: false,
      deviceSyncMaintenanceRan: false,
      initialProviderCleanupCheckpoint,
      pendingAssistantInputWakeAt,
      result: null,
    };
  }
  const systemMailboxDeliveryEffects =
    shouldCollectSystemMailboxDeliveryEffects({
      preparation: systemMailboxPreparation,
      shouldYieldAfterSystemMailboxPreparation,
    })
      ? await collectHostedAssistantDeliverySideEffects({
        actionApprovalPort: phaseInput.runtime.platform.actionApprovalPort ?? null,
        includeBackgroundDueIntents: true,
        preferredIntentIds: [],
        vaultRoot: phaseInput.restored.vaultRoot,
      })
      : [];
  let systemMailboxDeliveryPreparation: HostedAssistantDeliveryPreparation | null = null;
  if (systemMailboxDeliveryEffects.length > 0) {
    systemMailboxDeliveryPreparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: systemMailboxDeliveryEffects,
      vaultRoot: phaseInput.restored.vaultRoot,
    });
  }
  const systemMailboxWake = systemMailboxPreparation.status === "retryable_failed"
    ? createHostedRuntimeWakeCandidate(systemMailboxPreparation.nextWakeAt, "assistant")
    : await resolveHostedSystemMailboxNextWakeCandidate({
        vaultRoot: phaseInput.restored.vaultRoot,
      });
  const systemMailboxWakeAt = systemMailboxWake.at;
  const rawSystemMailboxMetricsWakeAt = "metrics" in systemMailboxPreparation
    ? systemMailboxPreparation.metrics.nextWakeAt ?? null
    : null;
  const systemMailboxMetricsWakeReason = resolveHostedSystemMailboxMetricsWakeReason({
    metricsWakeAt: rawSystemMailboxMetricsWakeAt,
    systemMailboxPreparation,
  });
  const systemMailboxMetricsWakeAt = resolveHostedSystemMailboxMetricsWakeAt({
    input: phaseInput,
    metricsWakeAt: rawSystemMailboxMetricsWakeAt,
    metricsWakeReason: systemMailboxMetricsWakeReason,
  });
  const systemMailboxDeviceSyncRan =
    systemMailboxPreparationRanDeviceSync(systemMailboxPreparation);
  if (systemMailboxDeviceSyncRan) {
    invalidateAssistantCronWakeState();
  }
  const deviceSyncMaintenanceRan =
    systemMailboxDeviceSyncRan
    || (dirtyDeviceSyncMetrics !== null && !dirtyDeviceSyncMetrics.deviceSyncSkipped);
  const deviceSyncFollowUpWake = resolveHostedDeviceSyncFollowUpWake({
    deviceSyncMaintenanceRan,
    input: phaseInput,
    pendingAssistantInputWakeAt,
  });
  const systemAssistantCronWakeState = await readAssistantCronWakeState();
  const systemAssistantCronWake = resolveHostedAssistantCronWakeCandidate({
    phaseInput,
    state: systemAssistantCronWakeState,
  });
  const dirtyDeviceSyncWake = dirtyDeviceSyncMetrics
    ? selectHostedRuntimeWakeCandidate([
        createHostedRuntimeWakeCandidate(
          dirtyDeviceSyncMetrics.nextWakeAt,
          HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
        ),
        createHostedRuntimeWakeCandidate(
          dirtyDeviceSyncMetrics.postCheckpointRecord?.nextWakeAt ?? null,
          HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
        ),
        createHostedDeviceActivityAutomationWakeCandidate(dirtyDeviceActivityAutomation),
      ])
    : null;
  const dirtyDeviceSyncWakeAt = dirtyDeviceSyncWake?.at ?? null;
  const backgroundWake = await resolveHostedBackgroundMaintenanceWakeCandidate({
    assistantCronWake: systemAssistantCronWake,
    deviceActivityAutomation: dirtyDeviceActivityAutomation,
    deviceSyncFollowUpWake,
    input: phaseInput,
    pendingAssistantInputWakeAt,
    providerCleanupCheckpoint: initialProviderCleanupCheckpoint,
    providerCleanupDue: initialProviderCleanupDue,
    systemMailboxWake,
  });
  const nextWake = selectHostedRuntimeWakeCandidate([
    backgroundWake,
    createHostedRuntimeWakeCandidate(systemMailboxMetricsWakeAt, systemMailboxMetricsWakeReason),
    dirtyDeviceSyncWake,
  ]);
  const nextWakeAt = nextWake.at;
  const shouldRecordSystemMailbox = systemMailboxPreparation.status === "processed"
    || systemMailboxPreparation.status === "recording";
  const browserVaultReplicaRefreshRequested =
    isBrowserVaultReplicaRefreshSystemMailboxPreparation(systemMailboxPreparation);
  const shouldRunPostSystemCheckpoint = shouldRecordSystemMailbox
    || initialProviderCleanupDue
    || (dirtyDeviceSyncMetrics?.postCheckpointRecord ?? null) !== null;
  if ("metrics" in systemMailboxPreparation) {
    await writeHostedAssistantAutomationDetailRuntimeLogs({
      assistantMetrics: systemMailboxPreparation.metrics,
      input: phaseInput,
    });
  }
  await writeHostedSystemMailboxRuntimeLog({
    input: phaseInput,
    nextWakeAt,
    recorded: null,
    recordFailed: null,
    status: systemMailboxPreparation.status,
    ...("item" in systemMailboxPreparation
      ? {
          attemptCount: systemMailboxPreparation.item.attemptCount,
          routeAction: systemMailboxPreparation.item.routeAction,
          wakeKind: systemMailboxPreparation.item.wake.kind,
        }
      : {
          attemptCount: null,
          errorCode: systemMailboxPreparation.errorCode,
          errorMessage: systemMailboxPreparation.errorMessage,
          routeAction: null,
          wakeKind: null,
        }),
  });

  return {
    continueAssistantLane:
      systemAssistantCronWakeState.dueNow
      || shouldYieldAfterSystemMailboxPreparation
      || shouldContinueAssistantLaneAfterSystemMailboxPreparation(systemMailboxPreparation),
    initialProviderCleanupCheckpoint,
    pendingAssistantInputWakeAt,
    result: {
      ...(browserVaultReplicaRefreshRequested
        ? { browserVaultReplicaRefreshRequested: true }
        : {}),
      ...(shouldRunPostSystemCheckpoint
        ? {
            afterCheckpoint: async () => {
              assertHostedAssistantPhaseLiveness(phaseInput.signal);
              return await runSystemMailboxPostCheckpointPhase({
                dirtyDeviceSyncMetrics,
                dirtyDeviceSyncWake,
                dirtyDeviceActivityAutomation,
                assistantCronWakeState: systemAssistantCronWakeState,
                initialProviderCleanupCheckpoint,
                initialProviderCleanupDue,
                input: phaseInput,
                pendingAssistantInputWakeAt,
                deviceSyncFollowUpWake,
                readAssistantCronWakeState,
                systemMailboxMetricsWakeAt,
                systemMailboxMetricsWakeReason,
                systemMailboxDeliveryPreparation,
                systemMailboxDeliveryEffects,
                systemMailboxPreparation,
                systemMailboxWake,
                systemMailboxWakeAt,
                wake: input.wake,
              });
            },
          }
        : {}),
      checkpointReason: resolveHostedSystemMailboxCheckpointReason({
        shouldRecordSystemMailbox,
        systemMailboxDeliveryEffectCount: systemMailboxDeliveryEffects.length,
        systemMailboxPreparation,
      }),
      ...(nextWakeAt ? { nextWakeAt } : {}),
      ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
        ? { nextWakeReason: nextWake.reason }
        : {}),
      progressed: true,
      redactedStatus: {
        ...buildHostedWorkspaceAssistantPhaseRedactedStatus({
          deliveryEffectCount: systemMailboxDeliveryEffects.length,
          nextWakeAt,
          outboxTerminalizedSendingCount: 0,
          progressed: true,
          systemMailboxPrepared: systemMailboxPreparation.status === "retryable_failed" ? 0 : 1,
          systemMailboxRetryableFailed:
            systemMailboxPreparation.status === "retryable_failed" ? 1 : 0,
        }),
        ...(browserVaultReplicaRefreshRequested
          ? { hostedBrowserVaultReplicaRefreshRequested: true }
          : {}),
      },
      ...withHostedDeviceSyncStagedDirtyAcks(
        mergeHostedDeviceSyncStagedDirtyAcks(
          dirtyDeviceSyncMetrics?.stagedDirtyAcks,
        ),
      ),
    },
    deviceSyncMaintenanceRan,
  };
}

async function runAssistantContextSnapshotIdleRefreshBestEffort(input: {
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<HostedWorkspaceRunnerAssistantPhaseResult | null> {
  if (input.phaseInput.shouldYieldBackgroundMaintenance?.() === true) {
    return null;
  }

  const refresh = await refreshAssistantContextSnapshotBestEffort({
    now: () => new Date(resolveHostedAssistantPhaseNowMs(input.phaseInput)).toISOString(),
    shouldYield: input.phaseInput.shouldYieldBackgroundMaintenance ?? null,
    signal: input.phaseInput.signal ?? null,
    vaultRoot: input.phaseInput.restored.vaultRoot,
  });
  if (refresh.skipped) {
    return null;
  }

  const nextWakeAt = refresh.pendingDirtyDomains.length > 0
    ? new Date(resolveHostedAssistantPhaseNowMs(input.phaseInput)).toISOString()
    : null;
  return {
    checkpointReason: "assistant_runtime_commit",
    ...(nextWakeAt ? { nextWakeAt, nextWakeReason: "assistant" } : {}),
    progressed: true,
    redactedStatus: {
      ...buildHostedWorkspaceAssistantPhaseRedactedStatus({
        deliveryEffectCount: 0,
        nextWakeAt,
        outboxTerminalizedSendingCount: 0,
        progressed: true,
        systemMailboxPrepared: 0,
        systemMailboxRetryableFailed: 0,
      }),
      assistantContextSnapshotPendingDirtyDomainCount:
        refresh.pendingDirtyDomains.length,
      assistantContextSnapshotRefreshAttempted: true,
      assistantContextSnapshotRefreshed: refresh.refreshed,
    },
  };
}

async function runSystemMailboxPostCheckpointPhase(input: {
  assistantCronWakeState: HostedAssistantCronWakeState;
  deviceSyncFollowUpWake: HostedRuntimeWakeCandidate | null;
  dirtyDeviceActivityAutomation: HostedDeviceActivityAutomationScheduleResult | null;
  dirtyDeviceSyncMetrics: HostedDeviceSyncWakeMetrics | null;
  dirtyDeviceSyncWake: HostedRuntimeWakeCandidate | null;
  initialProviderCleanupCheckpoint: HostedProviderCleanupCheckpoint | null;
  initialProviderCleanupDue: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  pendingAssistantInputWakeAt: string | null;
  readAssistantCronWakeState: () => Promise<HostedAssistantCronWakeState>;
  systemMailboxMetricsWakeAt: string | null;
  systemMailboxMetricsWakeReason: string | null;
  systemMailboxDeliveryEffects: HostedAssistantDeliveryEffects;
  systemMailboxDeliveryPreparation: HostedAssistantDeliveryPreparation | null;
  systemMailboxPreparation: NonNullable<
    Awaited<ReturnType<typeof prepareHostedSystemMailboxItemForCheckpoint>>
  >;
  systemMailboxWake: HostedRuntimeWakeCandidate | null;
  systemMailboxWakeAt: string | null;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null> {
  const assistantCronWakeState = input.assistantCronWakeState.available
    ? input.assistantCronWakeState
    : await input.readAssistantCronWakeState();
  const assistantCronWake = resolveHostedAssistantCronWakeCandidate({
    phaseInput: input.input,
    state: assistantCronWakeState,
  });

  if ("item" in input.systemMailboxPreparation) {
    const statusCallbackInput = {
      item: input.systemMailboxPreparation.item,
      operatorHomeRoot: input.input.restored.operatorHomeRoot,
      runtime: input.input.runtime,
      vaultRoot: input.input.restored.vaultRoot,
    };
    const deferredSystemMailboxRecord =
      shouldDeferHostedSystemMailboxRecordAfterDurableCheckpoint(
        input.systemMailboxPreparation.item,
      )
        ? deferHostedSystemMailboxPostCheckpointRecord({
            ...statusCallbackInput,
            followUpWakeAt: new Date(resolveHostedAssistantPhaseNowMs(input.input)).toISOString(),
          })
        : null;
    const statusCallback = deferredSystemMailboxRecord
      ? deferredSystemMailboxRecord.statusCallback
      : await recordHostedSystemMailboxItemAfterCheckpoint(statusCallbackInput);
    const dirtyPostCheckpoint = input.dirtyDeviceSyncMetrics?.postCheckpointRecord
      ? deferHostedDeviceSyncDirtyPostCheckpointRecord({
          record: input.dirtyDeviceSyncMetrics.postCheckpointRecord,
          runtime: input.input.runtime,
        })
      : null;
    const afterDurableCheckpoint = composeHostedAssistantPhaseDurableCheckpointEffects(
      deferredSystemMailboxRecord?.afterDurableCheckpoint ?? null,
      dirtyPostCheckpoint?.afterDurableCheckpoint ?? null,
    );
    const dirtyPostCheckpointWakeAt = dirtyPostCheckpoint?.nextWakeAt ?? null;
    const backgroundWake = await resolveHostedBackgroundMaintenanceWakeCandidate({
      assistantCronWake,
      deviceActivityAutomation: input.dirtyDeviceActivityAutomation,
      deviceSyncFollowUpWake: input.deviceSyncFollowUpWake,
      input: input.input,
      pendingAssistantInputWakeAt: input.pendingAssistantInputWakeAt,
      providerCleanupCheckpoint: input.initialProviderCleanupCheckpoint,
      providerCleanupDue: input.initialProviderCleanupDue,
      systemMailboxWake: createHostedRuntimeWakeCandidate(
        statusCallback.nextWakeAt,
        statusCallback.nextWakeReason ?? "assistant",
      ),
    });
    const statusNextWake = selectHostedRuntimeWakeCandidate([
      createHostedRuntimeWakeCandidate(
        statusCallback.nextWakeAt,
        statusCallback.nextWakeReason ?? "assistant",
      ),
      backgroundWake,
      input.dirtyDeviceSyncWake,
      createHostedRuntimeWakeCandidate(
        dirtyPostCheckpointWakeAt,
        HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
      ),
      createHostedRuntimeWakeCandidate(
        input.systemMailboxMetricsWakeAt,
        input.systemMailboxMetricsWakeReason,
      ),
    ]);
    const statusNextWakeAt = statusNextWake.at;
    const statusNextWakeReason = statusNextWake.reason;
    const dirtyRedactedStatus: HostedRuntimeRedactedJson = dirtyPostCheckpoint
      ? dirtyPostCheckpoint.redactedStatus
      : {};
    const systemMailboxRecordRedactedStatus: HostedRuntimeRedactedJson =
      deferredSystemMailboxRecord?.redactedStatus ?? {};
    await writeHostedSystemMailboxRuntimeLog({
      attemptCount: input.systemMailboxPreparation.item.attemptCount,
      input: input.input,
      nextWakeAt: statusNextWakeAt,
      recorded: statusCallback.recorded,
      recordFailed: statusCallback.failed,
      routeAction: input.systemMailboxPreparation.item.routeAction,
      status: deferredSystemMailboxRecord ? "recording" : "recorded",
      wakeKind: input.systemMailboxPreparation.item.wake.kind,
    });
    if (input.systemMailboxDeliveryEffects.length > 0 || input.initialProviderCleanupDue) {
      return await drainHostedPostCheckpointDelivery({
        afterDurableCheckpoint,
        assistantDeliveryEffects: input.systemMailboxDeliveryEffects,
        assistantDeliveryPreparation: input.systemMailboxDeliveryPreparation,
        baseNextWake: {
          at: statusNextWakeAt,
          reason: statusNextWakeReason,
        },
        checkpointReason: input.systemMailboxDeliveryEffects.length > 0
          ? "outbox_receipt"
          : "provider_cleanup",
        canConsumeWorkspaceAssistantWake: false,
        input: input.input,
        providerCleanup: {
          checkpoint: input.initialProviderCleanupCheckpoint,
          mode: "drain",
        },
        redactedStatus: {
          ...dirtyRedactedStatus,
          ...systemMailboxRecordRedactedStatus,
          hostedSystemMailboxRecordFailed: statusCallback.failed,
          hostedSystemMailboxRecorded: statusCallback.recorded,
        },
        wake: input.systemMailboxPreparation.item.wake,
      });
    }
    return {
      ...(afterDurableCheckpoint ? { afterDurableCheckpoint } : {}),
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: statusNextWakeAt,
      nextWakeReason: statusNextWakeReason,
      redactedStatus: {
        ...dirtyRedactedStatus,
        ...systemMailboxRecordRedactedStatus,
        hostedSystemMailboxRecordFailed: statusCallback.failed,
        hostedSystemMailboxRecorded: statusCallback.recorded,
      },
    };
  }

  const dirtyPostCheckpoint = input.dirtyDeviceSyncMetrics?.postCheckpointRecord
    ? deferHostedDeviceSyncDirtyPostCheckpointRecord({
        record: input.dirtyDeviceSyncMetrics.postCheckpointRecord,
        runtime: input.input.runtime,
      })
    : null;
  const dirtyPostCheckpointWakeAt = dirtyPostCheckpoint?.nextWakeAt ?? null;

  if (input.initialProviderCleanupDue) {
    const backgroundWake = await resolveHostedBackgroundMaintenanceWakeCandidate({
      assistantCronWake,
      deviceActivityAutomation: input.dirtyDeviceActivityAutomation,
      deviceSyncFollowUpWake: input.deviceSyncFollowUpWake,
      input: input.input,
      pendingAssistantInputWakeAt: input.pendingAssistantInputWakeAt,
      providerCleanupCheckpoint: input.initialProviderCleanupCheckpoint,
      providerCleanupDue: input.initialProviderCleanupDue,
      systemMailboxWake: input.systemMailboxWake,
    });
    const baseNextWake = selectHostedRuntimeWakeCandidate([
      backgroundWake,
      input.dirtyDeviceSyncWake,
      createHostedRuntimeWakeCandidate(
        dirtyPostCheckpointWakeAt,
        HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
      ),
    ]);
    return await drainHostedPostCheckpointDelivery({
      afterDurableCheckpoint: dirtyPostCheckpoint?.afterDurableCheckpoint ?? null,
      assistantDeliveryEffects: [],
      baseNextWake,
      checkpointReason: "provider_cleanup",
      canConsumeWorkspaceAssistantWake: false,
      input: input.input,
      providerCleanup: {
        checkpoint: input.initialProviderCleanupCheckpoint,
        mode: "drain",
      },
      redactedStatus: dirtyPostCheckpoint?.redactedStatus ?? null,
      wake: input.wake,
    });
  }

  if (!dirtyPostCheckpoint) {
    return null;
  }

  const backgroundWake = await resolveHostedBackgroundMaintenanceWakeCandidate({
    assistantCronWake,
    deviceActivityAutomation: input.dirtyDeviceActivityAutomation,
    deviceSyncFollowUpWake: input.deviceSyncFollowUpWake,
    input: input.input,
    pendingAssistantInputWakeAt: input.pendingAssistantInputWakeAt,
    providerCleanupCheckpoint: input.initialProviderCleanupCheckpoint,
    providerCleanupDue: input.initialProviderCleanupDue,
    systemMailboxWake: input.systemMailboxWake,
  });
  const dirtyNextWake = selectHostedRuntimeWakeCandidate([
    backgroundWake,
    input.dirtyDeviceSyncWake,
    createHostedRuntimeWakeCandidate(
      dirtyPostCheckpoint.nextWakeAt,
      HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
    ),
  ]);
  const dirtyNextWakeAt = dirtyNextWake.at;
  return {
    ...(dirtyPostCheckpoint
      ? { afterDurableCheckpoint: dirtyPostCheckpoint.afterDurableCheckpoint }
      : {}),
    checkpointReason: "assistant_runtime_commit",
    nextWakeAt: dirtyNextWakeAt,
    nextWakeReason: dirtyNextWake.reason,
    redactedStatus: {
      ...dirtyPostCheckpoint.redactedStatus,
      nextWakeAt: dirtyNextWakeAt,
    },
  };
}

function resolveHostedSystemMailboxMetricsWakeReason(input: {
  metricsWakeAt: string | null;
  systemMailboxPreparation: NonNullable<
    Awaited<ReturnType<typeof prepareHostedSystemMailboxItemForCheckpoint>>
  >;
}): string | null {
  if (!input.metricsWakeAt || !("item" in input.systemMailboxPreparation)) {
    return null;
  }

  if ("metrics" in input.systemMailboxPreparation) {
    const metricsWakeReason = input.systemMailboxPreparation.metrics.nextWakeReason ?? null;
    if (metricsWakeReason) {
      return metricsWakeReason;
    }
  }

  return input.systemMailboxPreparation.item.routeAction === "run-device-sync-wake"
    ? HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON
    : null;
}

function resolveHostedSystemMailboxMetricsWakeAt(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  metricsWakeAt: string | null;
  metricsWakeReason: string | null;
}): string | null {
  const futureWakeAt = resolveHostedAssistantAutomationNextWakeAt({
    input: input.input,
    nextWakeAt: input.metricsWakeAt,
  });
  if (futureWakeAt) {
    return futureWakeAt;
  }

  if (
    input.metricsWakeReason !== HOSTED_ASSISTANT_WAKE_REASON
  ) {
    return null;
  }

  const wakeMs = Date.parse(input.metricsWakeAt ?? "");
  if (!Number.isFinite(wakeMs)) {
    return null;
  }

  const nowMs = resolveHostedAssistantPhaseNowMs(input.input);
  return wakeMs <= nowMs ? new Date(nowMs).toISOString() : null;
}

async function runProviderCleanupPhase(input: {
  foregroundAssistantPass: boolean;
  initialProviderCleanupCheckpoint: HostedProviderCleanupCheckpoint | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  terminalLinqCleanup: HostedTerminalLinqCleanupEvidence;
}): Promise<{
  deferredProviderCleanupWakeAt: string | null;
  providerCleanupCheckpoint: HostedProviderCleanupCheckpoint | null;
  providerCleanupDue: boolean;
  terminalLinqCleanupDue: boolean;
}> {
  const terminalLinqCleanupDue =
    !input.foregroundAssistantPass && input.terminalLinqCleanup.linqMessageIds.length > 0;
  if (terminalLinqCleanupDue) {
    await recordHostedProviderCleanupBeforeCommit({
      checkpoint: {
        nextWakeAt: null,
      },
      linqMessageIds: input.terminalLinqCleanup.linqMessageIds,
      vaultRoot: input.input.restored.vaultRoot,
    });
    await markAssistantAutoReplyLinqCleanupQueued({
      captureIds: input.terminalLinqCleanup.captureIds,
      vault: input.input.restored.vaultRoot,
    });
  }

  const providerCleanupCheckpoint = input.foregroundAssistantPass
    ? null
    : input.initialProviderCleanupCheckpoint;
  const providerCleanupDue = !input.foregroundAssistantPass
    && isHostedProviderCleanupCheckpointDue(providerCleanupCheckpoint, input.input);
  const deferredProviderCleanupWakeAt = input.foregroundAssistantPass
    ? resolveHostedForegroundDeferredProviderCleanupWakeAt({
        input: input.input,
        terminalLinqCleanupPending: input.terminalLinqCleanup.linqMessageIds.length > 0,
      })
    : null;
  return {
    deferredProviderCleanupWakeAt,
    providerCleanupCheckpoint,
    providerCleanupDue,
    terminalLinqCleanupDue,
  };
}

async function collectForegroundDeliveryEffects(input: {
  actionApprovalPort: HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["actionApprovalPort"];
  preferredIntentIds: readonly string[];
  vaultRoot: string;
}): Promise<HostedPreparedAssistantDeliveryEffects> {
  const deliveryEffects = await collectHostedAssistantDeliverySideEffects({
    actionApprovalPort: input.actionApprovalPort ?? null,
    includeBackgroundDueIntents: false,
    preferredIntentIds: input.preferredIntentIds,
    vaultRoot: input.vaultRoot,
  });
  const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
    assistantDeliveryEffects: deliveryEffects,
    vaultRoot: input.vaultRoot,
  });
  return {
    effects: deliveryEffects,
    preparation,
  };
}

async function runForegroundAssistantReplyPhase(input: {
  assistantMetrics: HostedAssistantMetrics;
  currentTurnDeliveryIntentIds: readonly string[];
  deferredProviderCleanupWakeAt: string | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  skippedDeviceSyncWake: HostedRuntimeWakeCandidate | null;
  systemMailboxWake: HostedRuntimeWakeCandidate | null;
  systemMailboxWakeAt: string | null;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<HostedWorkspaceRunnerAssistantPhaseResult> {
  const foregroundReplyFailed = input.assistantMetrics.assistantAutomationReplyFailed ?? 0;
  const preparedDeliveryEffects = await collectForegroundDeliveryEffects({
    actionApprovalPort: input.input.runtime.platform.actionApprovalPort ?? null,
    preferredIntentIds: input.currentTurnDeliveryIntentIds,
    vaultRoot: input.input.restored.vaultRoot,
  });
  const deliveryEffects = preparedDeliveryEffects.effects;

  if (
    shouldFastDispatchAssistantDeliveryEffects({
      assistantMetrics: input.assistantMetrics,
      deliveryEffects,
      input: input.input,
    })
  ) {
    const fastDispatchBaseNextWake = resolveHostedFastDispatchBaseNextWake({
      assistantMetrics: input.assistantMetrics,
      deferredProviderCleanupWakeAt: input.deferredProviderCleanupWakeAt,
      input: input.input,
      skippedDeviceSyncWake: input.skippedDeviceSyncWake,
      systemMailboxWake: input.systemMailboxWake,
      systemMailboxWakeAt: input.systemMailboxWakeAt,
    });
    const postDelivery = await drainHostedPostCheckpointDelivery({
      assistantDeliveryEffects: deliveryEffects,
      assistantDeliveryPreparation: preparedDeliveryEffects.preparation,
      baseNextWake: fastDispatchBaseNextWake,
      checkpointReason: "outbox_receipt",
      canConsumeWorkspaceAssistantWake: true,
      input: input.input,
      providerCleanup: {
        mode: "defer",
      },
      redactedStatus: null,
      wake: input.wake,
    });
    const nextWakeAt = postDelivery.nextWakeAt ?? null;
    const wakeStateProgressed = hostedAssistantWakeStateProgressed({
      assistantMetrics: input.assistantMetrics,
      input: input.input,
      nextWakeAt,
      skippedDeviceSyncWakeAt: input.skippedDeviceSyncWake?.at ?? null,
    });
    const progressed = assistantMetricsProgressed({
      ...input.assistantMetrics,
      nextWakeAt,
    }, deliveryEffects.length)
      || wakeStateProgressed;
    await writeHostedAssistantAutomationDetailRuntimeLogs({
      assistantMetrics: input.assistantMetrics,
      input: input.input,
    });
    await writeHostedAssistantPassRuntimeLog({
      assistantMetrics: input.assistantMetrics,
      deliveryEffectCount: deliveryEffects.length,
      input: input.input,
      nextWakeAt,
      progressed,
      systemMailboxWakeAt: input.systemMailboxWakeAt,
    });
    const redactedStatus = {
      ...buildHostedWorkspaceAssistantPhaseRedactedStatus({
        deliveryEffectCount: deliveryEffects.length,
        nextWakeAt,
        outboxTerminalizedSendingCount: 0,
        progressed,
        systemMailboxPrepared: 0,
        systemMailboxRetryableFailed: 0,
      }),
      ...(postDelivery.redactedStatus ?? {}),
    };
    if (!progressed) {
      return {
        foregroundReplyFailed,
        ...(nextWakeAt ? { nextWakeAt } : {}),
        ...(shouldExposeHostedAssistantPhaseNextWakeReason(postDelivery.nextWakeReason)
          ? { nextWakeReason: postDelivery.nextWakeReason }
          : {}),
        progressed: false,
        redactedStatus,
      };
    }
    return {
      checkpointReason: postDelivery.checkpointReason,
      foregroundReplyFailed,
      nextWakeAt,
      ...(shouldExposeHostedAssistantPhaseNextWakeReason(postDelivery.nextWakeReason)
        ? { nextWakeReason: postDelivery.nextWakeReason }
        : {}),
      progressed: true,
      redactedStatus,
    };
  }

  const outboxWakeAt = await resolveHostedAssistantOutboxNextWakeAt({
    vaultRoot: input.input.restored.vaultRoot,
  });
  const assistantNextWakeAt = resolveHostedAssistantAutomationNextWakeAt({
    input: input.input,
    nextWakeAt: input.assistantMetrics.nextWakeAt,
  });
  const assistantNextWakeReason = resolveHostedAssistantAutomationNextWakeReason({
    assistantNextWakeAt,
  });
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
    input.skippedDeviceSyncWake,
    createHostedRuntimeWakeCandidate(outboxWakeAt, "assistant"),
    input.systemMailboxWake,
    createHostedRuntimeWakeCandidate(input.deferredProviderCleanupWakeAt, "assistant"),
  ]);
  const nextWakeAt = nextWake.at;
  const wakeStateProgressed = hostedAssistantWakeStateProgressed({
    assistantMetrics: input.assistantMetrics,
    input: input.input,
    nextWakeAt,
    skippedDeviceSyncWakeAt: input.skippedDeviceSyncWake?.at ?? null,
  });
  const progressed = assistantMetricsProgressed({
    ...input.assistantMetrics,
    nextWakeAt,
  }, deliveryEffects.length)
    || wakeStateProgressed;
  await writeHostedAssistantAutomationDetailRuntimeLogs({
    assistantMetrics: input.assistantMetrics,
    input: input.input,
  });
  await writeHostedAssistantPassRuntimeLog({
    assistantMetrics: input.assistantMetrics,
    deliveryEffectCount: deliveryEffects.length,
    input: input.input,
    nextWakeAt,
    progressed,
    systemMailboxWakeAt: input.systemMailboxWakeAt,
  });
  const hasPostCommitProviderCleanup = deliveryEffects.length > 0;

  const redactedStatus = buildHostedWorkspaceAssistantPhaseRedactedStatus({
    deliveryEffectCount: deliveryEffects.length,
    nextWakeAt,
    outboxTerminalizedSendingCount: 0,
    progressed,
    systemMailboxPrepared: 0,
    systemMailboxRetryableFailed: 0,
  });
  if (!progressed) {
    return {
      foregroundReplyFailed,
      ...(nextWakeAt ? { nextWakeAt } : {}),
      ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
        ? { nextWakeReason: nextWake.reason }
        : {}),
      progressed: false,
      redactedStatus,
    };
  }

  return {
    ...(hasPostCommitProviderCleanup
      ? {
          afterCheckpoint: async () => {
            assertHostedAssistantPhaseLiveness(input.input.signal);
            const baseNextWake = selectHostedRuntimeWakeCandidate([
              createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
              input.skippedDeviceSyncWake,
              input.systemMailboxWake,
              createHostedRuntimeWakeCandidate(input.deferredProviderCleanupWakeAt, "assistant"),
            ]);
            return await drainHostedPostCheckpointDelivery({
              assistantDeliveryEffects: deliveryEffects,
              assistantDeliveryPreparation: preparedDeliveryEffects.preparation,
              baseNextWake,
              checkpointReason: "outbox_receipt",
              canConsumeWorkspaceAssistantWake: true,
              input: input.input,
              providerCleanup: {
                mode: "defer",
              },
              redactedStatus: null,
              wake: input.wake,
            });
          },
        }
      : {}),
    checkpointReason: deliveryEffects.length > 0
      ? "outbox_sending"
      : resolveHostedAssistantTimerCheckpointReason({
          assistantMetrics: {
            ...input.assistantMetrics,
            nextWakeAt,
          },
          providerCleanupDue: false,
          terminalLinqCleanupDue: false,
          wakeStateProgressed,
        }),
    foregroundReplyFailed,
    nextWakeAt,
    ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
      ? { nextWakeReason: nextWake.reason }
      : {}),
    progressed: true,
    redactedStatus,
  };
}

async function drainHostedPostCheckpointDelivery(input: {
  afterDurableCheckpoint?: HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"] | null;
  assistantDeliveryEffects: HostedAssistantDeliveryEffects;
  assistantDeliveryPreparation?: HostedAssistantDeliveryPreparation | null;
  baseNextWake: HostedRuntimeWakeCandidate;
  checkpointReason: HostedWorkspaceRunnerAssistantPhasePostCheckpoint["checkpointReason"];
  canConsumeWorkspaceAssistantWake: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  providerCleanup:
    | { checkpoint: HostedProviderCleanupCheckpoint | null; mode: "drain" }
    | { mode: "defer" };
  redactedStatus: HostedRuntimeRedactedJson | null;
  wake: Parameters<typeof drainHostedPreparedAssistantDeliveries>[0]["wake"];
}): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint> {
  let memberChannelBarrier: HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null = null;
  try {
    memberChannelBarrier = input.assistantDeliveryEffects.length > 0
      ? await flushHostedMemberChannelUpdatesBeforeAutoReplyDelivery(input)
      : null;
  } catch (error) {
    await resetHostedPreparedDeliveryForBarrier({
      assistantDeliveryEffects: input.assistantDeliveryEffects,
      assistantDeliveryPreparation: input.assistantDeliveryPreparation ?? null,
      input: input.input,
    });
    const failure = buildHostedRuntimeFailureDiagnostics(
      error,
      "Hosted member-channel pre-dispatch barrier failed.",
    );
    return buildHostedMemberChannelDeliveryBarrierResult({
      input,
      nextWakeAt: new Date(resolveHostedAssistantPhaseNowMs(input.input)).toISOString(),
      nextWakeReason: "assistant",
      redactedStatus: {
        hostedMemberChannelPreDispatchBarrierFailed: 1,
        hostedMemberChannelPreDispatchBarrierErrorCode: failure.errorCode,
      },
    });
  }
  if (memberChannelBarrier) {
    await resetHostedPreparedDeliveryForBarrier({
      assistantDeliveryEffects: input.assistantDeliveryEffects,
      assistantDeliveryPreparation: input.assistantDeliveryPreparation ?? null,
      input: input.input,
    });
    return memberChannelBarrier;
  }

  const outcomes = input.assistantDeliveryEffects.length > 0
    ? await drainHostedPreparedAssistantDeliveries({
        actionApprovalPort: input.input.runtime.platform.actionApprovalPort ?? null,
        allowPreparedSending: true,
        assistantDeliveryEffects: input.assistantDeliveryEffects,
        assertLiveness: async () => {
          assertHostedAssistantPhaseLiveness(input.input.signal);
        },
        effectsPort: input.input.platform.effectsPort,
        forwardedEnv: input.input.runtime.forwardedEnv,
        platformEnv: input.input.runtime.platformEnv,
        preparedDispatches: input.assistantDeliveryPreparation?.preparedDispatches ?? null,
        providerFetch: input.input.runtime.platform.providerFetch ?? null,
        signal: input.input.signal ?? null,
        userEnv: input.input.runtime.userEnv,
        vaultRoot: input.input.restored.vaultRoot,
        wake: input.wake,
      })
    : [];
  let providerCleanupNextWakeAt: string | null;
  let providerCleanupRedactedStatus: HostedRuntimeRedactedJson = {};
  if (input.providerCleanup.mode === "drain") {
    const providerCleanup = await drainHostedProviderCleanupAfterCommit({
      assistantDeliveryOutcomes: outcomes,
      assertLiveness: async () => {
        assertHostedAssistantPhaseLiveness(input.input.signal);
      },
      checkpoint: input.providerCleanup.checkpoint ?? {
        nextWakeAt: null,
      },
      env: buildHostedLinqChannelEnv({
        forwardedEnv: input.input.runtime.forwardedEnv,
        userEnv: input.input.runtime.userEnv,
      }) as NodeJS.ProcessEnv,
      fetchImplementation: input.input.runtime.platform.providerFetch ?? null,
      signal: input.input.signal ?? null,
      vaultRoot: input.input.restored.vaultRoot,
      wake: input.wake,
    });
    providerCleanupNextWakeAt = providerCleanup.nextWakeAt;
    providerCleanupRedactedStatus = buildHostedProviderCleanupRedactedStatus(providerCleanup);
  } else {
    const providerCleanup = await deferHostedProviderCleanupAfterDelivery({
      input: input.input,
      outcomes,
    });
    providerCleanupNextWakeAt = providerCleanup.nextWakeAt;
  }
  const postOutboxWakeAt = await resolveHostedAssistantOutboxNextWakeAt({
    vaultRoot: input.input.restored.vaultRoot,
  });
  const postAssistantCronWake =
    await resolveHostedAssistantCronWakeStateBestEffort(input.input);
  const dropConsumedWorkspaceAssistantWake = (
    candidate: HostedRuntimeWakeCandidate | null,
  ): HostedRuntimeWakeCandidate | null =>
    dropConsumedPostDeliveryWorkspaceAssistantWake({
      candidate,
      canConsumeWorkspaceAssistantWake: input.canConsumeWorkspaceAssistantWake,
      phaseInput: input.input,
    });
  let postAssistantCronWakeCandidate = resolveHostedAssistantCronWakeCandidate({
    phaseInput: input.input,
    state: postAssistantCronWake,
  });
  if (!postAssistantCronWake.available) {
    postAssistantCronWakeCandidate = dropConsumedWorkspaceAssistantWake(
      postAssistantCronWakeCandidate,
    );
  }
  const postSystemMailboxWakeAt = await resolveHostedSystemMailboxNextWakeAt({
    vaultRoot: input.input.restored.vaultRoot,
  });
  const postBaseNextWake = dropConsumedWorkspaceAssistantWake(
    resolveHostedPostDeliveryBaseNextWake(input),
  );
  const postNextWake = selectHostedRuntimeWakeCandidate([
    postBaseNextWake,
    postAssistantCronWakeCandidate,
    createHostedRuntimeWakeCandidate(postOutboxWakeAt, "assistant"),
    createHostedRuntimeWakeCandidate(postSystemMailboxWakeAt, "assistant"),
    createHostedRuntimeWakeCandidate(providerCleanupNextWakeAt, "assistant"),
  ]);
  const postNextWakeAt = postNextWake.at;
  if (input.assistantDeliveryEffects.length > 0) {
    await writeHostedOutboxDeliveryRuntimeLog({
      input: input.input,
      outcomes,
      postNextWakeAt,
    });
  }

  const sentCount = outcomes.filter((outcome) =>
    outcome.deliveryStatus === "sent"
  ).length;
  const terminalizedSendingCount = outcomes.filter((outcome) =>
    isHostedAssistantDeliveryOutcomeTerminalized(outcome)
  ).length;
  const deliveryRedactedStatus: HostedRuntimeRedactedJson =
    input.assistantDeliveryEffects.length > 0
      ? {
          hostedOutboxDeliveryAttempted: outcomes.length,
          hostedOutboxDeliverySent: sentCount,
          hostedOutboxPendingDeliveryEffects: 0,
          hostedOutboxTerminalizedSending: terminalizedSendingCount,
        }
      : {};

  return {
    ...(input.afterDurableCheckpoint ? { afterDurableCheckpoint: input.afterDurableCheckpoint } : {}),
    checkpointReason: input.checkpointReason,
    nextWakeAt: postNextWakeAt,
    nextWakeReason: postNextWake.reason,
    redactedStatus: {
      ...providerCleanupRedactedStatus,
      ...(input.redactedStatus ?? {}),
      ...deliveryRedactedStatus,
      hostedAssistantNextWakeAt: postNextWakeAt,
      nextWakeAt: postNextWakeAt,
    },
  };
}

function resolveHostedPostDeliveryBaseNextWake(
  input: Parameters<typeof drainHostedPostCheckpointDelivery>[0],
): HostedRuntimeWakeCandidate | null {
  const baseNextWake = input.baseNextWake;
  if (!baseNextWake.at) {
    return null;
  }
  if (
    baseNextWake.reason !== null
    && baseNextWake.reason !== HOSTED_ASSISTANT_WAKE_REASON
  ) {
    return baseNextWake;
  }

  return createHostedRuntimeWakeCandidate(
    normalizeHostedFutureWakeAt(
      baseNextWake.at,
      resolveHostedAssistantPhaseNowMs(input.input),
    ),
    baseNextWake.reason ?? HOSTED_ASSISTANT_WAKE_REASON,
  );
}

function dropConsumedPostDeliveryWorkspaceAssistantWake(input: {
  candidate: HostedRuntimeWakeCandidate | null;
  canConsumeWorkspaceAssistantWake: boolean;
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
}): HostedRuntimeWakeCandidate | null {
  const candidate = input.candidate;
  if (!candidate?.at) {
    return candidate;
  }
  if (!input.canConsumeWorkspaceAssistantWake) {
    return candidate;
  }
  if (candidate.reason !== HOSTED_ASSISTANT_WAKE_REASON) {
    return candidate;
  }
  const workspaceWakeAt = input.phaseInput.workspace?.nextWakeAt ?? null;
  if (candidate.at !== workspaceWakeAt) {
    return candidate;
  }
  const workspaceWakeReason = input.phaseInput.workspace?.nextWakeReason ?? null;
  if (
    workspaceWakeReason !== null
    && workspaceWakeReason !== HOSTED_ASSISTANT_WAKE_REASON
  ) {
    return candidate;
  }

  return isDueHostedAssistantWorkspaceWake(input.phaseInput) ? null : candidate;
}

function isHostedAssistantDeliveryOutcomeTerminalized(
  outcome: HostedAssistantDeliveryOutcome,
): boolean {
  return outcome.retryable !== true
    && outcome.deliveryStatus !== "pending"
    && outcome.deliveryStatus !== "retryable"
    && outcome.deliveryStatus !== "sending";
}

async function flushHostedMemberChannelUpdatesBeforeAutoReplyDelivery(
  input: Parameters<typeof drainHostedPostCheckpointDelivery>[0],
): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null> {
  if (!await hostedDeliveryEffectsContainAutoReply({
    effects: input.assistantDeliveryEffects,
    vaultRoot: input.input.restored.vaultRoot,
  })) {
    return null;
  }

  const remoteBarrier = await input.input.prepareAutoReplyDelivery?.();
  if (remoteBarrier) {
    return buildHostedMemberChannelDeliveryBarrierResult({
      input,
      nextWakeAt: remoteBarrier.nextWakeAt ?? null,
      nextWakeReason: remoteBarrier.nextWakeReason ?? null,
      redactedStatus: {
        ...(remoteBarrier.redactedStatus ?? {}),
      },
    });
  }

  let processed = 0;
  while (true) {
    assertHostedAssistantPhaseLiveness(input.input.signal);
    const preparation = await prepareHostedSystemMailboxItemForCheckpoint({
      allowedRouteActions: HOSTED_MEMBER_CHANNEL_UPDATE_ROUTE_ACTIONS,
      operatorHomeRoot: input.input.restored.operatorHomeRoot,
      runtime: input.input.runtime,
      runtimeEnv: input.input.runtimeEnv,
      vaultRoot: input.input.restored.vaultRoot,
    });
    if (!preparation) {
      break;
    }
    if (preparation.status === "retryable_failed") {
      return buildHostedMemberChannelDeliveryBarrierResult({
        input,
        nextWakeAt: preparation.nextWakeAt,
        nextWakeReason: "assistant",
        redactedStatus: {
          hostedMemberChannelPreDispatchBlocked: 1,
          hostedMemberChannelPreDispatchErrorCode: preparation.errorCode,
        },
      });
    }
    if (preparation.status === "recording") {
      const record = await recordHostedSystemMailboxItemAfterCheckpoint({
        item: preparation.item,
        operatorHomeRoot: input.input.restored.operatorHomeRoot,
        runtime: input.input.runtime,
        vaultRoot: input.input.restored.vaultRoot,
      });
      if (record.failed > 0) {
        return buildHostedMemberChannelDeliveryBarrierResult({
          input,
          nextWakeAt: record.nextWakeAt,
          nextWakeReason: record.nextWakeReason ?? "assistant",
          redactedStatus: {
            hostedMemberChannelPreDispatchRecordFailed: record.failed,
          },
        });
      }
    }
    processed += 1;
  }

  const pendingWakeAt = await resolveHostedSystemMailboxNextWakeAt({
    allowedRouteActions: HOSTED_MEMBER_CHANNEL_UPDATE_ROUTE_ACTIONS,
    vaultRoot: input.input.restored.vaultRoot,
  });
  if (!pendingWakeAt) {
    return null;
  }

  return buildHostedMemberChannelDeliveryBarrierResult({
    input,
    nextWakeAt: pendingWakeAt,
    nextWakeReason: "assistant",
    redactedStatus: {
      hostedMemberChannelPreDispatchPending: 1,
      hostedMemberChannelPreDispatchProcessed: processed,
    },
  });
}

async function hostedDeliveryEffectsContainAutoReply(input: {
  effects: HostedAssistantDeliveryEffects;
  vaultRoot: string;
}): Promise<boolean> {
  const intents = (
    await Promise.all(
      input.effects.map((effect) =>
        readAssistantOutboxIntent(input.vaultRoot, effect.effectId)
      ),
    )
  ).filter((intent): intent is NonNullable<typeof intent> => intent !== null);
  if (intents.length === 0) {
    return false;
  }

  const autoReplyIntentIds = await findAssistantAutoReplyDeliveryIntentIds({
    intents,
    vault: input.vaultRoot,
  });
  return autoReplyIntentIds.size > 0;
}

function buildHostedMemberChannelDeliveryBarrierResult(input: {
  input: Parameters<typeof drainHostedPostCheckpointDelivery>[0];
  nextWakeAt: string | null;
  nextWakeReason?: string | null;
  redactedStatus: HostedRuntimeRedactedJson;
}): HostedWorkspaceRunnerAssistantPhasePostCheckpoint {
  const nextWake = selectHostedRuntimeWakeCandidate([
    input.input.baseNextWake,
    createHostedRuntimeWakeCandidate(input.nextWakeAt, input.nextWakeReason ?? "assistant"),
  ]);
  return {
    ...(input.input.afterDurableCheckpoint
      ? { afterDurableCheckpoint: input.input.afterDurableCheckpoint }
      : {}),
    checkpointReason: "assistant_runtime_commit",
    nextWakeAt: nextWake.at,
    nextWakeReason: nextWake.reason,
    redactedStatus: {
      ...(input.input.redactedStatus ?? {}),
      ...input.redactedStatus,
      nextWakeAt: nextWake.at,
    },
  };
}

async function resetHostedPreparedDeliveryForBarrier(input: {
  assistantDeliveryEffects: HostedAssistantDeliveryEffects;
  assistantDeliveryPreparation: HostedAssistantDeliveryPreparation | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<void> {
  await resetHostedPreparedAssistantDeliveryEffects({
    effects: input.assistantDeliveryEffects,
    preparedDispatches: input.assistantDeliveryPreparation?.preparedDispatches ?? null,
    vaultRoot: input.input.restored.vaultRoot,
  });
}

async function deferHostedProviderCleanupAfterDelivery(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  outcomes: readonly HostedAssistantDeliveryOutcome[];
}): Promise<{ nextWakeAt: string | null }> {
  const providerCleanupMessageIds =
    collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes(input.outcomes);
  if (providerCleanupMessageIds.length === 0) {
    return {
      nextWakeAt: null,
    };
  }

  await recordHostedProviderCleanupBeforeCommit({
    checkpoint: {
      nextWakeAt: null,
    },
    linqMessageIds: providerCleanupMessageIds,
    vaultRoot: input.input.restored.vaultRoot,
  });
  return {
    nextWakeAt: new Date(resolveHostedAssistantPhaseNowMs(input.input)).toISOString(),
  };
}

function relayHostedAssistantPhaseAbortSignal(
  source: AbortSignal | null,
  controller: AbortController,
): () => void {
  if (!source) {
    return () => undefined;
  }

  const onAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(source.reason);
    }
  };
  if (source.aborted) {
    onAbort();
    return () => undefined;
  }

  source.addEventListener("abort", onAbort, { once: true });
  return () => {
    source.removeEventListener("abort", onAbort);
  };
}

function assertHostedAssistantPhaseLiveness(signal: AbortSignal | null | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throw new Error("Hosted workspace assistant phase was aborted.");
}

function isHostedProviderCleanupCheckpointDue(
  checkpoint: HostedProviderCleanupCheckpoint | null,
  input?: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  if (!checkpoint) {
    return false;
  }

  if (!checkpoint.nextWakeAt) {
    return true;
  }

  const timestamp = Date.parse(checkpoint.nextWakeAt);
  const nowMs = input ? resolveHostedAssistantPhaseNowMs(input) : Date.now();
  return Number.isFinite(timestamp) && timestamp <= nowMs;
}

function resolveHostedAssistantPhaseNowMs(input: {
  now?: (() => string) | null;
}): number {
  const fallbackNowMs = Date.now();
  if (!input.now) {
    return fallbackNowMs;
  }

  const parsed = Date.parse(input.now());
  return Number.isFinite(parsed) ? parsed : fallbackNowMs;
}

async function resolvePendingAssistantInputWakeAt(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): Promise<string | null> {
  return await resolveHostedPendingAssistantInputWakeAt({
    now: input.now,
    vaultRoot: input.restored.vaultRoot,
  });
}

function buildHostedProviderCleanupRedactedStatus(input: {
  attemptedLinqMessageCount: number;
  deletedLinqMessageCount: number;
  failedLinqMessageCount: number;
}): HostedRuntimeRedactedJson {
  return {
    hostedProviderCleanupAttemptedLinqItems: input.attemptedLinqMessageCount,
    hostedProviderCleanupDeletedLinqItems: input.deletedLinqMessageCount,
    hostedProviderCleanupFailedLinqItems: input.failedLinqMessageCount,
  };
}

function isDueHostedDeviceSyncRecoveryAlarm(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return (
    isDueHostedDeviceSyncReconcileAlarm(input)
    || isDueHostedLegacyDeviceSyncRecoveryAlarm(input)
  );
}

function isDueHostedDeviceSyncReconcileAlarm(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return (
    isDueHostedWorkspaceAlarm(input)
    && input.workspace?.nextWakeReason === HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON
  );
}

function isDueHostedDeviceSyncReconcileWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return (
    input.workspace?.nextWakeReason === HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON
    && !hasFreshHostedMailboxInput(input)
    && isDueHostedWorkspaceWakeAt(input)
  );
}

function isDueHostedLegacyDeviceSyncRecoveryAlarm(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return isDueHostedWorkspaceAlarm(input) && isDueHostedLegacyDeviceSyncRecoveryWake(input);
}

function isDueHostedWorkspaceAlarm(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  if (hasFreshHostedMailboxInput(input)) {
    return false;
  }

  return isDueHostedWorkspaceWake(input);
}

function isDueHostedWorkspaceWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  if (!input.workspace?.nextWakeAt) {
    return false;
  }

  return isDueHostedWorkspaceWakeAt(input);
}

function isDueHostedWorkspaceWakeAt(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  if (!input.workspace?.nextWakeAt) {
    return false;
  }

  const wakeTime = Date.parse(input.workspace.nextWakeAt);
  return Number.isFinite(wakeTime) && wakeTime <= resolveHostedAssistantPhaseNowMs(input);
}

function isDueHostedAssistantWorkspaceWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  const wakeReason = input.workspace?.nextWakeReason ?? null;
  return (
    (wakeReason === null || wakeReason === HOSTED_ASSISTANT_WAKE_REASON)
    && isDueHostedWorkspaceWakeAt(input)
  );
}

function isDueHostedLegacyDeviceSyncRecoveryWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  if (!hasHostedDeviceSyncRuntimeConfigured(input) || !isDueHostedWorkspaceWakeAt(input)) {
    return false;
  }

  const wakeReason = input.workspace?.nextWakeReason ?? null;
  return wakeReason === null || wakeReason === "assistant";
}

function hasHostedDeviceSyncRuntimeConfigured(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return input.runtime.resolvedConfig.deviceSync !== null;
}

function buildHostedAssistantAutomationBootstrapEnv(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): Record<string, string> {
  return {
    ...input.runtimeEnv,
    ...input.runtime.forwardedEnv,
    ...input.runtime.userEnv,
  };
}

function resolveSkippedDeviceSyncWake(input: {
  deviceSyncMaintenanceRan: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  pendingAssistantInputWakeAt: string | null;
}): HostedRuntimeWakeCandidate | null {
  if (input.deviceSyncMaintenanceRan) {
    return null;
  }

  const existingWakeAt = input.input.workspace?.nextWakeAt ?? null;
  const existingWakeReason = input.input.workspace?.nextWakeReason ?? null;
  if (existingWakeReason !== HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON) {
    return null;
  }
  if (!existingWakeAt) {
    return null;
  }

  const wakeTime = Date.parse(existingWakeAt);
  if (!Number.isFinite(wakeTime)) {
    return {
      at: existingWakeAt,
      reason: existingWakeReason,
    };
  }

  const nowMs = resolveHostedAssistantPhaseNowMs(input.input);
  if (wakeTime > nowMs) {
    return {
      at: existingWakeAt,
      reason: existingWakeReason,
    };
  }

  const handledDeviceSyncWake = input.input.deviceSyncWorkspaceWakeHandled ?? null;
  if (
    handledDeviceSyncWake?.nextWakeAt === existingWakeAt
    && handledDeviceSyncWake.nextWakeReason === existingWakeReason
    && !input.pendingAssistantInputWakeAt
    && !shouldRescheduleSkippedDeviceSyncWake(input.input)
  ) {
    return null;
  }

  if (input.pendingAssistantInputWakeAt || shouldRescheduleSkippedDeviceSyncWake(input.input)) {
    return {
      at: new Date(nowMs + HOSTED_SKIPPED_DEVICE_SYNC_RETRY_DELAY_MS).toISOString(),
      reason: existingWakeReason,
    };
  }

  return null;
}

function resolveHostedDeviceSyncFollowUpWake(input: {
  deviceSyncMaintenanceRan: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  pendingAssistantInputWakeAt: string | null;
}): HostedRuntimeWakeCandidate | null {
  const localDeviceSyncScheduledWake = resolveHostedLocalDeviceSyncScheduledWake(input.input);
  const handledDeviceSyncWake = input.input.deviceSyncWorkspaceWakeHandled ?? null;
  if (
    localDeviceSyncScheduledWake?.at
    && handledDeviceSyncWake !== null
    && handledDeviceSyncWake?.nextWakeAt === input.input.workspace?.nextWakeAt
    && handledDeviceSyncWake.nextWakeReason === input.input.workspace?.nextWakeReason
  ) {
    return localDeviceSyncScheduledWake;
  }

  const skippedDeviceSyncWake = resolveSkippedDeviceSyncWake(input);
  const selectedDeviceSyncFollowUpWake = selectHostedRuntimeWakeCandidate([
    localDeviceSyncScheduledWake,
    skippedDeviceSyncWake,
  ]);
  return selectedDeviceSyncFollowUpWake.at
    ? selectedDeviceSyncFollowUpWake
    : null;
}

function shouldRescheduleSkippedDeviceSyncWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return (
    !consumedScheduledWorkspaceWake(input)
    || hasFreshHostedConversationInput(input)
    || input.shouldYieldBackgroundMaintenance?.() === true
  );
}

function resolveHostedLocalDeviceSyncScheduledWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): HostedRuntimeWakeCandidate | null {
  if (!hasHostedDeviceSyncRuntimeConfigured(input)) {
    return null;
  }

  const nextWakeAt = resolveHostedDeviceSyncNextWakeAt({
    deviceSyncConfig: input.runtime.resolvedConfig.deviceSync,
    platform: input.runtime.platform,
    vaultRoot: input.restored.vaultRoot,
  });
  if (!nextWakeAt) {
    return null;
  }

  return createHostedRuntimeWakeCandidate(
    nextWakeAt,
    HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
  );
}

async function writeHostedSystemMailboxRuntimeLog(input: {
  attemptCount: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  nextWakeAt: string | null;
  recorded: number | null;
  recordFailed: number | null;
  routeAction: string | null;
  status: "processed" | "recorded" | "recording" | "retryable_failed";
  wakeKind: string | null;
}): Promise<void> {
  const errorCode = toHostedRuntimeLogCode(input.errorCode);
  const safeErrorMessage = input.errorMessage
    ? sanitizeHostedExecutionStructuredLogText(input.errorMessage)
      ?? "Hosted system mailbox processing failed."
    : input.errorCode
      ? "Hosted system mailbox processing failed."
      : null;
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({
        attemptId: input.input.request.attemptId,
        leaseGeneration: input.input.request.leaseGeneration,
        workspaceVersion: input.input.request.workspaceVersion,
      }),
      ...(input.errorCode ? { errorCode } : {}),
      component: "mailbox",
      eventCode: "mailbox.system_processed",
      level: input.status === "retryable_failed" || (input.recordFailed ?? 0) > 0 ? "warn" : "info",
      phase: "checkpoint",
      redactedJson: {
        attemptCount: input.attemptCount,
        errorCode: input.errorCode ? errorCode : null,
        nextWakeAtPresent: input.nextWakeAt !== null,
        recordFailed: input.recordFailed,
        recorded: input.recorded,
        routeAction: input.routeAction,
        ...(safeErrorMessage ? { safeErrorMessage } : {}),
        status: input.status,
        wakeKind: input.wakeKind,
      },
    },
    platform: input.input.platform,
  });
}

// Hot-path-safe: writeHostedRuntimeLogBestEffort queues info-level entries
// and returns synchronously, so foreground delivery is never blocked on the
// underlying log port write (invariant: "observability writes are never
// user latency", docs/contracts/00-invariants.md § Hosted Foreground
// Priority).
function writeHostedAssistantTurnTimingRuntimeLog(input: {
  currentTurnDeliveryIntentCount?: number | null;
  elapsedMs: number;
  foregroundAssistantPass?: boolean | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  stage: HostedAssistantTurnTimingStage;
  stepElapsedMs?: number | null;
}): void {
  const redactedJson: HostedRuntimeRedactedJson = {
    currentTurnDeliveryIntentCount: input.currentTurnDeliveryIntentCount ?? null,
    detailLabel: "Hosted assistant turn timing milestone captured.",
    foregroundAssistantPass: input.foregroundAssistantPass ?? null,
    schema: HOSTED_ASSISTANT_TURN_TIMING_SCHEMA,
    type: HOSTED_ASSISTANT_TURN_TIMING_TYPE,
    turnTimingElapsedMs: input.elapsedMs,
    turnTimingStage: input.stage,
    ...(input.stepElapsedMs === undefined
      ? {}
      : { turnTimingStepElapsedMs: input.stepElapsedMs }),
  };

  void writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({
        attemptId: input.input.request.attemptId,
        leaseGeneration: input.input.request.leaseGeneration,
        workspaceVersion: input.input.request.workspaceVersion,
      }),
      component: "assistant",
      eventCode: "assistant.automation_detail",
      level: "info",
      phase: "invoke",
      redactedJson,
    },
    platform: input.input.platform,
  });
}

async function writeHostedAssistantPassRuntimeLog(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  deliveryEffectCount: number;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  nextWakeAt: string | null;
  progressed: boolean;
  systemMailboxWakeAt: string | null;
}): Promise<void> {
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({
        attemptId: input.input.request.attemptId,
        leaseGeneration: input.input.request.leaseGeneration,
        workspaceVersion: input.input.request.workspaceVersion,
      }),
      component: "assistant",
      eventCode: "assistant.pass_finished",
      level: "info",
      phase: "invoke",
      redactedJson: {
        automationLogCount: input.assistantMetrics.redactedLogEntries?.length ?? 0,
        assistantAutomationAfterStateElapsedMs:
          input.assistantMetrics.assistantAutomationAfterStateElapsedMs ?? null,
        assistantAutomationBeforeStateElapsedMs:
          input.assistantMetrics.assistantAutomationBeforeStateElapsedMs ?? null,
        assistantAutomationElapsedMs: input.assistantMetrics.assistantAutomationElapsedMs ?? null,
        assistantAutomationPassElapsedMs:
          input.assistantMetrics.assistantAutomationPassElapsedMs ?? null,
        assistantAutomationProgressed:
          input.assistantMetrics.assistantAutomationProgressed ?? null,
        assistantAutomationTotalElapsedMs:
          input.assistantMetrics.assistantAutomationTotalElapsedMs ?? null,
        assistantInputCandidateListed:
          input.assistantMetrics.assistantInputCandidateListed ?? null,
        assistantInputCandidateQueryCount:
          input.assistantMetrics.assistantInputCandidateQueryCount ?? null,
        deliveryEffectCount: input.deliveryEffectCount,
        deviceSyncElapsedMs: null,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        deviceSyncDirtyAckPending: false,
        nextWakeAtPresent: input.nextWakeAt !== null,
        parserProcessed: 0,
        progressed: input.progressed,
        readinessElapsedMs: input.assistantMetrics.readinessElapsedMs ?? null,
        systemWakeAtPresent: input.systemMailboxWakeAt !== null,
        totalElapsedMs: input.assistantMetrics.totalElapsedMs ?? null,
      },
    },
    platform: input.input.platform,
  });
}

async function writeHostedAssistantAutomationDetailRuntimeLogs(input: {
  assistantMetrics: {
    redactedLogEntries?: HostedExecutionRedactedLogEntry[] | null;
  };
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<void> {
  const entries = input.assistantMetrics.redactedLogEntries ?? [];
  for (const [index, entry] of entries.entries()) {
    const redactedJson = buildHostedAssistantAutomationDetailRedactedJson(entry.redacted, {
      detailComponent: entry.component,
      detailEventIdPresent: entry.eventId !== undefined && entry.eventId !== null,
      detailIndex: index,
      detailLabel: entry.message,
      detailPhase: entry.phase,
    });
    const errorCode = resolveHostedAssistantAutomationDetailErrorCode(entry.redacted);
    await writeHostedRuntimeLogBestEffort({
      entry: {
        ...buildHostedRuntimeLogContextFields({
          attemptId: input.input.request.attemptId,
          leaseGeneration: input.input.request.leaseGeneration,
          workspaceVersion: input.input.request.workspaceVersion,
        }),
        component: "assistant",
        ...(errorCode ? { errorCode } : {}),
        eventCode: "assistant.automation_detail",
        level: entry.level,
        phase: "invoke",
        redactedJson,
      },
      platform: input.input.platform,
    });
  }
}

function readHostedAssistantAutomationFailureRedactedLogEntries(
  error: unknown,
): HostedExecutionRedactedLogEntry[] {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return [];
  }

  const value = (error as {
    hostedAssistantAutomationRedactedLogEntries?: unknown;
  }).hostedAssistantAutomationRedactedLogEntries;
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isHostedExecutionRedactedLogEntry);
}

function isHostedExecutionRedactedLogEntry(
  value: unknown,
): value is HostedExecutionRedactedLogEntry {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { component?: unknown }).component === "string" &&
    typeof (value as { level?: unknown }).level === "string" &&
    typeof (value as { message?: unknown }).message === "string" &&
    typeof (value as { phase?: unknown }).phase === "string"
  );
}

function buildHostedAssistantAutomationDetailRedactedJson(
  redacted: Record<string, unknown> | null | undefined,
  detail: HostedRuntimeRedactedJson,
): HostedRuntimeRedactedJson {
  const output: HostedRuntimeRedactedJson = {};
  const input = redacted ?? {};
  const entries = Object.entries(input);

  for (const [key, value] of entries) {
    if (isAnchorHostedAssistantAutomationDetailKey(key)) {
      maybeCopyHostedAssistantAutomationDetailRedactedEntry(output, key, value);
    }
  }

  for (const [key, value] of entries) {
    if (
      !isAnchorHostedAssistantAutomationDetailKey(key)
      && isPreferredHostedAssistantAutomationDetailKey(key)
    ) {
      maybeCopyHostedAssistantAutomationDetailRedactedEntry(output, key, value);
    }
  }

  for (const [key, value] of entries) {
    if (!isPreferredHostedAssistantAutomationDetailKey(key)) {
      maybeCopyHostedAssistantAutomationDetailRedactedEntry(output, key, value);
    }
  }

  const combined: HostedRuntimeRedactedJson = {
    ...output,
    ...detail,
  };
  if (
    typeof combined.errorCode === "string"
    && typeof combined.safeErrorMessage !== "string"
  ) {
    combined.safeErrorMessage = typeof combined.detailLabel === "string"
      ? sanitizeHostedExecutionStructuredLogText(combined.detailLabel)
        ?? "Hosted assistant automation detail failed."
      : "Hosted assistant automation detail failed.";
  }

  return combined;
}

function isAnchorHostedAssistantAutomationDetailKey(key: string): boolean {
  return key === "errorCode"
    || key === "providerTraceKind"
    || key === "safeDetails"
    || key === "safeErrorLength"
    || key === "safeErrorMessage"
    || key === "safeErrorPresent"
    || key === "schema"
    || key === "type";
}

function isPreferredHostedAssistantAutomationDetailKey(key: string): boolean {
  return isAnchorHostedAssistantAutomationDetailKey(key)
    || key.startsWith("assistantNotification")
    || key.startsWith("codexInvalidOutput")
    || key.startsWith("codexResumeFailure")
    || key.startsWith("failure")
    || key.startsWith("routePlanning")
    || key.startsWith("turnTiming");
}

function maybeCopyHostedAssistantAutomationDetailRedactedEntry(
  output: HostedRuntimeRedactedJson,
  key: string,
  value: unknown,
): void {
  if (
    key in output
    || Object.keys(output).length >= HOSTED_ASSISTANT_AUTOMATION_DETAIL_MAX_KEYS
  ) {
    return;
  }

  const redactedValue = normalizeHostedRuntimeRedactedLogValue(key, value);
  if (redactedValue !== undefined) {
    output[key] = redactedValue;
  }
}

function resolveHostedAssistantAutomationDetailErrorCode(
  redacted: Record<string, unknown> | null | undefined,
): string | null {
  const candidate =
    readHostedRuntimeRedactedLogString(redacted, "assistantNotificationProviderErrorCode")
    ?? readHostedRuntimeRedactedLogString(redacted, "assistantNotificationErrorCodeDetail")
    ?? readHostedRuntimeRedactedLogString(redacted, "assistantNotificationErrorCode")
    ?? readHostedRuntimeRedactedLogString(redacted, "errorCode");

  return candidate ? toHostedRuntimeLogCode(candidate) : null;
}

function readHostedRuntimeRedactedLogString(
  redacted: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = redacted?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function normalizeHostedRuntimeRedactedLogValue(
  key: string,
  value: unknown,
): HostedRuntimeRedactedJson[string] | undefined {
  if (!isHostedRuntimeLogKeyAllowed(key)) {
    return undefined;
  }

  if (Array.isArray(value)) {
    if (key === "codexActionToolSummaries") {
      return normalizeHostedRuntimeRedactedLogObjectArray(key, value);
    }

    return normalizeHostedRuntimeRedactedLogArray(key, value);
  }

  return normalizeHostedRuntimeRedactedLogScalar(key, value);
}

function normalizeHostedRuntimeRedactedLogObjectArray(
  key: string,
  value: unknown[],
): HostedRuntimeRedactedJson[string] | undefined {
  if (value.length > 16) {
    return undefined;
  }

  const output = value.flatMap((entry) => {
    const normalized = normalizeHostedRuntimeRedactedLogObject(key, entry);
    return normalized === null ? [] : [normalized];
  });
  return output.length > 0 ? output : undefined;
}

function normalizeHostedRuntimeRedactedLogObject(
  parentKey: string,
  value: unknown,
): HostedRuntimeRedactedObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value);
  if (entries.length > 8) {
    return null;
  }

  const output: HostedRuntimeRedactedObject = {};
  for (const [key, entry] of entries) {
    const normalized = normalizeHostedRuntimeRedactedLogScalar(key, entry);
    if (normalized !== undefined) {
      output[key] = normalized;
    }
  }

  return Object.keys(output).length > 0 && isHostedRuntimeLogKeyAllowed(parentKey)
    ? output
    : null;
}

function normalizeHostedRuntimeRedactedLogArray(
  key: string,
  value: unknown[],
): HostedRuntimeRedactedJson[string] | undefined {
  if (value.length > 16) {
    return undefined;
  }

  const output = value.flatMap((entry) => {
    const normalized = normalizeHostedRuntimeRedactedLogScalar(key, entry);
    return normalized === undefined ? [] : [normalized];
  });
  return output.length > 0 ? output : undefined;
}

function normalizeHostedRuntimeRedactedLogScalar(
  key: string,
  value: unknown,
): HostedRuntimeRedactedScalar | undefined {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  return redactHostedRuntimeLogString(key, value);
}

function redactHostedRuntimeLogString(key: string, value: string): string | undefined {
  if (isHostedRuntimeSecretValueKey(key) && !isHostedRuntimeErrorDescriptionKey(key)) {
    return "[redacted]";
  }

  const normalized = sanitizeHostedExecutionStructuredLogText(value);
  if (!normalized) {
    return undefined;
  }

  const redacted = normalized
    .replace(/<HOME_DIR>(?:\/[^\s)"']*)?/gu, "<REDACTED_PATH>")
    .replace(/file:\/\/[^\s)"']+/giu, "<REDACTED_PATH>")
    .replace(/\bhttps?:\/\/[^\s)"']+/giu, "<REDACTED_URL>")
    .replace(/(^|[\s(])\/[^\s)"']+/gu, "$1<REDACTED_PATH>")
    .replace(/[A-Za-z]:\\[^\s)"']+/gu, "<REDACTED_PATH>")
    .replace(
      /\b((?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|secret|token))\b\s*[:=]\s*(?:Bearer\s+|Basic\s+)?(?:\[[^\]]+\]|[^"',\s}]+)/giu,
      "$1 [redacted]",
    )
    .replace(/\b(Basic|Bearer)\s+(?!\[redacted\])[A-Za-z0-9._~+/=-]+\b/giu, "$1 [redacted]")
    .replace(/\+\d[\d().\s-]{7,}\d/gu, "[redacted-phone]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]")
    .replace(/\s+/gu, " ")
    .trim();
  if (redacted.length === 0) {
    return undefined;
  }

  const bounded = redacted.length <= HOSTED_RUNTIME_REDACTED_TEXT_MAX_LENGTH
    ? redacted
    : `${redacted.slice(0, HOSTED_RUNTIME_REDACTED_TEXT_MAX_LENGTH - 3).trimEnd()}...`;

  return isHostedRuntimeRedactedLogStringValue(bounded) ? bounded : undefined;
}

function isHostedRuntimeLogKeyAllowed(key: string): boolean {
  if (HOSTED_RUNTIME_ALLOWED_LOG_KEY_NAMES.has(key)) {
    return true;
  }

  const normalized = key.toLowerCase();
  return !HOSTED_RUNTIME_BLOCKED_LOG_KEY_PARTS.some((part) =>
    normalized.includes(part)
  );
}

function isHostedRuntimeSecretValueKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return HOSTED_RUNTIME_SECRET_VALUE_KEY_PARTS.some((part) => normalized.includes(part));
}

function isHostedRuntimeErrorDescriptionKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return HOSTED_RUNTIME_ERROR_DESCRIPTION_KEY_PARTS.some((part) =>
    normalized.includes(part)
  );
}

function isHostedRuntimeRedactedLogStringValue(value: string): boolean {
  return !(
    /\/Users\/|file:\/\/|[A-Za-z]:\\|<HOME_DIR>|(^|[\s(])\/[^\s)]+/u.test(value)
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)
    || /\bhttps?:\/\//iu.test(value)
    || /\+\d[\d().\s-]{7,}\d/u.test(value)
    || /(["']?(?:authorization|secret|token|password|cookie|set-cookie|api[-_]?key)["']?\s*[:=]\s*["']?)([^"',\s}]+)/iu
      .test(value)
    || /\b(Basic|Bearer)\s+[A-Z0-9._~+/=-]+\b/iu.test(value)
    || /\b(?:sk|pk|rk)_(?:live|test)_[A-Z0-9]+\b/iu.test(value)
    || /\bwhsec_[A-Z0-9]+\b/iu.test(value)
  );
}

async function writeHostedOutboxDeliveryRuntimeLog(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  outcomes: HostedAssistantDeliveryOutcome[];
  postNextWakeAt: string | null;
}): Promise<void> {
  const statuses = input.outcomes.map((outcome) => outcome.deliveryStatus);
  const sent = input.outcomes.filter((outcome) => outcome.deliveryStatus === "sent").length;
  const retryable = input.outcomes.filter((outcome) => outcome.retryable).length;
  const failed = input.outcomes.filter((outcome) =>
    outcome.deliveryStatus === "failed"
      || outcome.deliveryStatus === "failed_ambiguous"
      || outcome.deliveryStatus === "missing-result"
      || outcome.deliveryStatus === "threw"
  ).length;
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({
        attemptId: input.input.request.attemptId,
        leaseGeneration: input.input.request.leaseGeneration,
        workspaceVersion: input.input.request.workspaceVersion,
      }),
      component: "outbox",
      eventCode: "outbox.delivery_finished",
      level: failed > 0 || retryable > 0 ? "warn" : "info",
      phase: "outbox",
      redactedJson: {
        ...summarizeHostedRuntimeStatusCounts(statuses),
        attempted: input.outcomes.length,
        deliveryChannelSummary: summarizeHostedOutboxDeliveryCodes(
          input.outcomes.map((outcome) => outcome.deliveryChannel),
        ),
        deliveryErrorCodeSummary: summarizeHostedOutboxDeliveryErrorCodes(
          input.outcomes.map((outcome) => outcome.deliveryErrorCode),
        ),
        ...buildHostedOutboxDeliveryErrorLogFields(input.outcomes),
        failed,
        journalStatusSummary: summarizeHostedOutboxDeliveryCodes(
          input.outcomes.map((outcome) => outcome.journalStatus),
        ),
        nextWakeAtPresent: input.postNextWakeAt !== null,
        providerMessageIdPresentCount: input.outcomes.filter((outcome) =>
          outcome.providerMessageId !== null
        ).length,
        providerThreadIdPresentCount: input.outcomes.filter((outcome) =>
          outcome.providerThreadId !== null
        ).length,
        retryable,
        sent,
        targetKindSummary: summarizeHostedOutboxDeliveryCodes(
          input.outcomes.map((outcome) => outcome.targetKind),
        ),
      },
    },
    platform: input.input.platform,
  });
}

function summarizeHostedOutboxDeliveryCodes(values: readonly (string | null)[]): string {
  const summary = summarizeHostedRuntimeStatusCounts(
    values.map((value) => toHostedRuntimeLogCode(value ?? "none")),
  ).statusSummary;
  return typeof summary === "string" ? summary : "";
}

function summarizeHostedOutboxDeliveryErrorCodes(values: readonly (string | null)[]): string {
  const summary = summarizeHostedRuntimeStatusCounts(
    values.map(normalizeHostedOutboxDeliveryErrorCode),
  ).statusSummary;
  return typeof summary === "string" ? summary : "";
}

function normalizeHostedOutboxDeliveryErrorCode(value: string | null): string {
  if (!value) {
    return "none";
  }
  const safe = sanitizeHostedExecutionStructuredLogText(value);
  return toHostedRuntimeLogCode(safe);
}

function buildHostedOutboxDeliveryErrorLogFields(
  outcomes: readonly HostedAssistantDeliveryOutcome[],
): HostedRuntimeRedactedJson {
  const deliveryErrorSummaries = outcomes
    .filter(hostedOutboxDeliveryOutcomeNeedsErrorLog)
    .map(buildHostedOutboxDeliveryErrorSummary)
    .slice(0, HOSTED_OUTBOX_DELIVERY_ERROR_LOG_LIMIT);

  return deliveryErrorSummaries.length > 0
    ? { deliveryErrorSummaries }
    : {};
}

function hostedOutboxDeliveryOutcomeNeedsErrorLog(
  outcome: HostedAssistantDeliveryOutcome,
): boolean {
  return outcome.deliveryStatus !== "sent"
    || outcome.deliveryErrorCode !== null
    || outcome.deliveryErrorMessage !== null
    || outcome.deliveryErrorDetails != null;
}

function buildHostedOutboxDeliveryErrorSummary(
  outcome: HostedAssistantDeliveryOutcome,
): HostedRuntimeRedactedObject {
  return {
    deliveryChannel: toHostedRuntimeLogCode(outcome.deliveryChannel ?? "none"),
    deliveryStatus: toHostedRuntimeLogCode(outcome.deliveryStatus),
    deliveryErrorCode: normalizeHostedOutboxDeliveryErrorCode(outcome.deliveryErrorCode),
    deliveryErrorMessage: normalizeHostedOutboxDeliveryErrorMessage(
      outcome.deliveryErrorMessage,
    ) ?? "none",
    journalStatus: toHostedRuntimeLogCode(outcome.journalStatus ?? "none"),
    retryable: outcome.retryable,
    targetKind: toHostedRuntimeLogCode(outcome.targetKind ?? "none"),
    ...buildHostedOutboxDeliveryErrorDetailSummary(outcome.deliveryErrorDetails),
  };
}

function normalizeHostedOutboxDeliveryErrorMessage(
  value: string | null,
): string | null {
  if (!value) {
    return null;
  }

  return sanitizeHostedExecutionStructuredLogText(value);
}

function buildHostedOutboxDeliveryErrorDetailSummary(
  details: HostedAssistantDeliveryOutcome["deliveryErrorDetails"],
): HostedRuntimeRedactedObject {
  const sanitizedDetails = normalizeHostedOutboxDeliveryErrorDetails(details);
  if (!sanitizedDetails) {
    return {};
  }

  const output: HostedRuntimeRedactedObject = {};
  appendHostedOutboxDeliveryErrorDetail(output, "Status", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["status", "statusCode", "responseStatus", "errorStatus"],
  ));
  appendHostedOutboxDeliveryErrorDetail(output, "ProviderCode", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["errorCode", "errorCodeDetail", "providerErrorCode"],
  ));
  appendHostedOutboxDeliveryErrorDetail(output, "Description", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["description", "errorDetail", "safeErrorMessage"],
  ));
  appendHostedOutboxDeliveryErrorDetail(output, "Operation", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["operation", "action"],
  ));
  appendHostedOutboxDeliveryErrorDetail(output, "Retryable", sanitizedDetails.retryable);
  appendHostedOutboxDeliveryErrorDetail(output, "ErrorName", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["name", "errorName"],
  ));
  appendHostedOutboxDeliveryErrorDetail(output, "Target", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["target", "targetLabel"],
  ));
  appendHostedOutboxDeliveryErrorDetail(output, "Cause", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["errorCause", "cause"],
  ));
  output.deliveryErrorDetailFieldCount = Object.keys(sanitizedDetails).length;
  return output;
}

function normalizeHostedOutboxDeliveryErrorDetails(
  details: HostedAssistantDeliveryOutcome["deliveryErrorDetails"],
): Record<string, HostedRuntimeRedactedScalar> | null {
  if (!details) {
    return null;
  }

  const sanitized = sanitizeHostedExecutionStructuredLogDetails(
    details as HostedExecutionStructuredLogDetails,
  );
  if (!sanitized) {
    return null;
  }

  const output: Record<string, HostedRuntimeRedactedScalar> = {};
  for (const [key, value] of Object.entries(sanitized)) {
    if (
      value === null
      || typeof value === "boolean"
      || typeof value === "number"
      || typeof value === "string"
    ) {
      output[key] = value;
    }
  }

  return Object.keys(output).length > 0 ? output : null;
}

function appendHostedOutboxDeliveryErrorDetail(
  output: HostedRuntimeRedactedObject,
  suffix: string,
  value: HostedRuntimeRedactedScalar | undefined,
): void {
  if (value === undefined) {
    return;
  }

  const normalized = normalizeHostedOutboxDeliveryErrorDetail(value);
  if (normalized === null) {
    return;
  }

  output[`deliveryErrorDetail${suffix}`] = normalized;
}

function readFirstHostedOutboxDeliveryErrorDetail(
  details: Record<string, HostedRuntimeRedactedScalar>,
  keys: readonly string[],
): HostedRuntimeRedactedScalar | undefined {
  for (const key of keys) {
    if (key in details) {
      return details[key];
    }
  }
  return undefined;
}

function normalizeHostedOutboxDeliveryErrorDetail(
  value: HostedRuntimeRedactedScalar,
): HostedRuntimeRedactedScalar | null {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  return sanitizeHostedExecutionStructuredLogText(value);
}

function consumedScheduledWorkspaceWake(input: HostedWorkspaceRuntimeAssistantPhaseInput): boolean {
  if (hasFreshHostedMailboxInput(input) && !hasFreshHostedConversationInput(input)) {
    return false;
  }
  if (!input.workspace?.nextWakeAt) {
    return false;
  }

  const wakeTime = Date.parse(input.workspace.nextWakeAt);
  return Number.isFinite(wakeTime) && wakeTime <= resolveHostedAssistantPhaseNowMs(input);
}

function hostedAssistantWakeStateProgressed(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  nextWakeAt: string | null;
  skippedDeviceSyncWakeAt: string | null;
}): boolean {
  if (input.skippedDeviceSyncWakeAt !== null) {
    const existingWakeAt = input.input.workspace?.nextWakeAt ?? null;
    return (
      hasFreshHostedConversationInput(input.input)
      || input.assistantMetrics.activeTurnInputIngested === true
      || input.skippedDeviceSyncWakeAt !== existingWakeAt
    );
  }

  const existingWakeAt = input.input.workspace?.nextWakeAt ?? null;
  if (input.nextWakeAt === existingWakeAt) {
    return false;
  }

  if (!consumedScheduledWorkspaceWake(input.input)) {
    return (
      input.nextWakeAt !== null
      && !hasFreshHostedConversationInput(input.input)
      && input.assistantMetrics.activeTurnInputIngested !== true
    );
  }

  if (isDueHostedDeviceSyncRecoveryAlarm(input.input)) {
    return true;
  }

  return (
    input.nextWakeAt !== null
    || hasFreshHostedConversationInput(input.input)
    || input.assistantMetrics.activeTurnInputIngested === true
  );
}

function resolveHostedWorkspaceDeviceConnectProviders(
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "resolvedConfig">,
): Array<{ label: string; provider: string }> {
  const providerConfigs = runtime.resolvedConfig.deviceSync?.providerConfigs ?? null;
  if (!providerConfigs) {
    return [];
  }

  return listConfiguredDeviceSyncConnectTargets(providerConfigs).map((target) => ({
    label: target.label,
    provider: target.connectTarget,
  }));
}

function resolveHostedWorkspaceDeviceReconnectTargets(
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "resolvedConfig">,
): HostedDeviceSyncStatusPromptReconnectTarget[] {
  const providerConfigs = runtime.resolvedConfig.deviceSync?.providerConfigs ?? null;
  if (!providerConfigs) {
    return [];
  }

  return listConfiguredDeviceSyncReconnectTargets(providerConfigs).map((target) => ({
    label: target.label,
    provider: target.connectTarget,
    ...(target.sourceProviderSlug
      ? { sourceProviderSlug: target.sourceProviderSlug }
      : {}),
  }));
}

function withHostedAssistantDynamicContextPrompt(input: {
  executionContext: AssistantExecutionContext;
  prompt: string | null;
}): AssistantExecutionContext {
  if (!input.prompt || !input.executionContext.hosted) {
    return input.executionContext;
  }

  return {
    hosted: {
      ...input.executionContext.hosted,
      dynamicContextPrompts: [
        ...(input.executionContext.hosted.dynamicContextPrompts ?? []),
        input.prompt,
      ],
    },
  };
}

async function hasDueHostedAssistantCronJob(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): Promise<boolean> {
  const cronStatus = await getAssistantCronStatus(input.restored.vaultRoot)
    .catch(() => null);
  return (cronStatus?.dueJobs ?? 0) > 0;
}

function resolveHostedWorkspaceIssueDeviceConnectLink(input: {
  deviceConnectProviders: readonly { label: string; provider: string }[];
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): NonNullable<AssistantExecutionContext["hosted"]>["issueDeviceConnectLink"] | undefined {
  const deviceSyncPort = input.input.runtime.platform.deviceSyncPort ?? null;
  if (!deviceSyncPort || input.deviceConnectProviders.length === 0) {
    return undefined;
  }

  return async ({ messagingReturnTarget, provider }) => {
    await writeHostedDeviceConnectRuntimeLog({
      deviceConnectProviders: input.deviceConnectProviders,
      input: input.input,
      issueLinkAvailable: true,
      messagingReturnTarget,
      provider,
      stage: "request",
      status: "requested",
    });

    try {
      const result = await deviceSyncPort.createConnectLink({
        connectTarget: provider,
        ...(messagingReturnTarget ? { messagingReturnTarget } : {}),
      });
      await writeHostedDeviceConnectRuntimeLog({
        deviceConnectProviders: input.deviceConnectProviders,
        expiresAtPresent: Boolean(result.expiresAt),
        input: input.input,
        issueLinkAvailable: true,
        messagingReturnTarget,
        provider: result.provider,
        stage: "request",
        status: "issued",
      });
      return result;
    } catch (error) {
      await writeHostedDeviceConnectRuntimeLog({
        deviceConnectProviders: input.deviceConnectProviders,
        error,
        input: input.input,
        issueLinkAvailable: true,
        messagingReturnTarget,
        provider,
        stage: "request",
        status: "failed",
      });
      throw error;
    }
  };
}

function shouldWriteHostedDeviceConnectContextLog(input: {
  deviceConnectProviders: readonly { label: string; provider: string }[];
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): boolean {
  return input.deviceConnectProviders.length > 0
    || input.input.runtime.platform.deviceSyncPort != null
    || input.input.runtime.resolvedConfig.deviceSync !== null;
}

async function writeHostedDeviceConnectRuntimeLog(input: {
  deviceConnectProviders: readonly { label: string; provider: string }[];
  error?: unknown;
  expiresAtPresent?: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  issueLinkAvailable: boolean;
  messagingReturnTarget?: string | null;
  provider?: string | null;
  stage: "context" | "request";
  status: "available" | "failed" | "issued" | "requested" | "unavailable";
}): Promise<void> {
  const failure = input.error === undefined
    ? null
    : buildHostedRuntimeFailureDiagnostics(
        input.error,
        "Hosted device connect request failed.",
      );
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({
        attemptId: input.input.request.attemptId,
        leaseGeneration: input.input.request.leaseGeneration,
        workspaceVersion: input.input.request.workspaceVersion,
      }),
      ...(failure ? { errorCode: failure.errorCode } : {}),
      component: "assistant",
      eventCode: "assistant.device_connect",
      level: input.status === "failed" ? "warn" : "info",
      phase: "invoke",
      redactedJson: {
        deviceConnectIssueLinkAvailable: input.issueLinkAvailable,
        deviceConnectPortPresent: input.input.runtime.platform.deviceSyncPort != null,
        deviceConnectProviderCount: input.deviceConnectProviders.length,
        deviceConnectProviders: input.deviceConnectProviders
          .map((provider) => toHostedRuntimeLogCode(provider.provider))
          .filter((provider) => provider !== "unclassified")
          .slice(0, 16),
        deviceConnectStage: input.stage,
        deviceConnectStatus: input.status,
        ...(failure ? failure.redactedJson : {}),
        ...(input.error === undefined
          ? {}
          : { errorStatus: readHostedDeviceConnectErrorStatus(input.error) }),
        ...(input.expiresAtPresent === undefined
          ? {}
          : { expiresAtPresent: input.expiresAtPresent }),
        ...(input.messagingReturnTarget
          ? { deviceConnectReturnTarget: toHostedRuntimeLogCode(input.messagingReturnTarget) }
          : {}),
        ...(input.provider
          ? { provider: toHostedRuntimeLogCode(input.provider) }
          : {}),
      },
    },
    platform: input.input.platform,
  });
}

function buildHostedRuntimeFailureDiagnostics(
  error: unknown,
  fallbackMessage: string,
): {
  errorCode: string;
  redactedJson: HostedRuntimeRedactedJson;
} {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  const diagnosticErrorCode = typeof diagnostics?.errorCode === "string"
    ? diagnostics.errorCode
    : null;
  const diagnosticErrorMessage = typeof diagnostics?.errorMessage === "string"
    ? diagnostics.errorMessage
    : null;
  const errorCode = toHostedRuntimeLogCode(
    diagnosticErrorCode ?? deriveHostedExecutionErrorCode(error),
  );
  const safeErrorMessage = sanitizeHostedExecutionStructuredLogText(
    diagnosticErrorMessage ?? fallbackMessage,
  ) ?? fallbackMessage;
  const redactedJson: HostedRuntimeRedactedJson = {
    errorCode,
    safeErrorMessage,
  };

  return {
    errorCode,
    redactedJson,
  };
}

function readHostedDeviceConnectErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  for (const property of ["status", "statusCode", "responseStatus"] as const) {
    const value = Reflect.get(error, property);
    if (
      typeof value === "number"
      && Number.isInteger(value)
      && value >= 100
      && value <= 599
    ) {
      return value;
    }
  }

  return null;
}

function assistantMetricsProgressed(
  metrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>,
  deliveryEffectCount: number,
): boolean {
  return (
    deliveryEffectCount > 0
    || metrics.assistantAutomationProgressed === true
  );
}

function resolveHostedAssistantAutomationNextWakeReason(_input: {
  assistantNextWakeAt: string | null;
}): string | null {
  return null;
}

function shouldResolveHostedAssistantCronWakeAfterAssistantPass(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): boolean {
  if (input.assistantMetrics.assistantAutomationProgressed === true) {
    return true;
  }

  const nextWakeAt = input.assistantMetrics.nextWakeAt ?? null;
  if (!nextWakeAt) {
    return false;
  }

  const nextWakeTimeMs = Date.parse(nextWakeAt);
  return Number.isFinite(nextWakeTimeMs)
    && nextWakeTimeMs <= resolveHostedAssistantPhaseNowMs(input.input);
}

function shouldExposeHostedAssistantPhaseNextWakeReason(reason: string | null | undefined): boolean {
  return reason === HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON;
}

function assistantMetricsCanonicalRuntimeProgressed(
  metrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>,
): boolean {
  return metrics.assistantAutomationProgressed === true;
}

function resolveHostedAssistantTimerCheckpointReason(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  providerCleanupDue: boolean;
  terminalLinqCleanupDue: boolean;
  wakeStateProgressed: boolean;
}): HostedWorkspaceCheckpointReason {
  if (
    assistantMetricsCanonicalRuntimeProgressed(input.assistantMetrics)
    || input.wakeStateProgressed
  ) {
    return "canonical_runtime_commit";
  }
  if (input.providerCleanupDue || input.terminalLinqCleanupDue) {
    return "provider_cleanup";
  }
  return "canonical_runtime_commit";
}

function resolveHostedSystemMailboxCheckpointReason(input: {
  shouldRecordSystemMailbox: boolean;
  systemMailboxDeliveryEffectCount: number;
  systemMailboxPreparation: NonNullable<
    Awaited<ReturnType<typeof prepareHostedSystemMailboxItemForCheckpoint>>
  >;
}): HostedWorkspaceCheckpointReason {
  if (input.systemMailboxPreparation.status === "retryable_failed") {
    return "system_mailbox_receipt";
  }
  if (!input.shouldRecordSystemMailbox) {
    return "canonical_runtime_commit";
  }
  if (input.systemMailboxDeliveryEffectCount > 0) {
    return "outbox_sending";
  }
  if (
    "metrics" in input.systemMailboxPreparation
    && input.systemMailboxPreparation.metrics.bootstrapResult !== null
  ) {
    return "activation_bootstrap";
  }
  return "system_mailbox_receipt";
}

function shouldCollectSystemMailboxDeliveryEffects(input: {
  preparation: HostedSystemMailboxCheckpointPreparation;
  shouldYieldAfterSystemMailboxPreparation: boolean;
}): boolean {
  if (
    input.shouldYieldAfterSystemMailboxPreparation
    || input.preparation.status !== "processed"
  ) {
    return false;
  }

  const item = input.preparation.item;
  if (item.routeAction === "dispatch-assistant-notification") {
    return true;
  }

  return item.routeAction === "apply-member-activation"
    && item.wake.kind === "member.activated"
    && item.wake.signupWelcome != null;
}

function shouldFastDispatchAssistantDeliveryEffects(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  deliveryEffects: HostedAssistantDeliveryEffects;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): boolean {
  return (
    (
      !consumedScheduledWorkspaceWake(input.input)
      || hasFreshHostedConversationInput(input.input)
      || input.assistantMetrics.activeTurnInputIngested === true
    )
    && input.deliveryEffects.length > 0
    && input.deliveryEffects.every((effect) => effect.payload.transportIdempotent === true)
  );
}

function resolveHostedFastDispatchBaseNextWake(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  deferredProviderCleanupWakeAt: string | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  skippedDeviceSyncWake: HostedRuntimeWakeCandidate | null;
  systemMailboxWake: HostedRuntimeWakeCandidate | null;
  systemMailboxWakeAt: string | null;
}): HostedRuntimeWakeCandidate {
  const skippedDeviceSyncWake = shouldDropHostedFastDispatchSkippedDeviceSyncRetry(input)
    ? null
    : input.skippedDeviceSyncWake;
  const assistantNextWakeAt = resolveHostedAssistantAutomationNextWakeAt({
    input: input.input,
    nextWakeAt: input.assistantMetrics.nextWakeAt,
  });
  const assistantNextWakeReason = resolveHostedAssistantAutomationNextWakeReason({
    assistantNextWakeAt,
  });
  return selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
    skippedDeviceSyncWake,
    input.systemMailboxWake,
    createHostedRuntimeWakeCandidate(input.deferredProviderCleanupWakeAt, "assistant"),
  ]);
}

function resolveHostedDeferredProviderCleanupWakeAt(input: {
  checkpoint: HostedProviderCleanupCheckpoint | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  terminalLinqCleanupPending: boolean;
}): string | null {
  const wakeAt = new Date(resolveHostedAssistantPhaseNowMs(input.input)).toISOString();
  if (input.terminalLinqCleanupPending) {
    return wakeAt;
  }

  if (!input.checkpoint) {
    return null;
  }

  if (isHostedProviderCleanupCheckpointDue(input.checkpoint, input.input)) {
    return wakeAt;
  }

  return input.checkpoint.nextWakeAt ?? null;
}

function resolveHostedForegroundDeferredProviderCleanupWakeAt(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  terminalLinqCleanupPending: boolean;
}): string | null {
  return input.terminalLinqCleanupPending
    ? new Date(resolveHostedAssistantPhaseNowMs(input.input)).toISOString()
    : null;
}

function shouldDropHostedFastDispatchSkippedDeviceSyncRetry(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  skippedDeviceSyncWake: HostedRuntimeWakeCandidate | null;
}): boolean {
  if (!input.skippedDeviceSyncWake?.at) {
    return false;
  }
  if (input.skippedDeviceSyncWake.reason === HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON) {
    return false;
  }

  const existingWakeAt = input.input.workspace?.nextWakeAt ?? null;
  if (!existingWakeAt) {
    return false;
  }

  const existingWakeReason = input.input.workspace?.nextWakeReason ?? null;
  if (existingWakeReason !== "assistant" && existingWakeReason !== null) {
    return false;
  }

  const existingWakeTime = Date.parse(existingWakeAt);
  return (
    Number.isFinite(existingWakeTime)
    && existingWakeTime <= resolveHostedAssistantPhaseNowMs(input.input)
    && shouldRescheduleSkippedDeviceSyncWake(input.input)
  );
}

function resolveHostedAssistantAutomationNextWakeAt(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  nextWakeAt: string | null;
}): string | null {
  return normalizeHostedFutureWakeAt(
    input.nextWakeAt,
    resolveHostedAssistantPhaseNowMs(input.input),
  );
}

function buildHostedWorkspaceAssistantPhaseRedactedStatus(input: {
  deliveryEffectCount: number;
  nextWakeAt: string | null;
  outboxTerminalizedSendingCount: number;
  progressed: boolean;
  systemMailboxPrepared: number;
  systemMailboxRetryableFailed: number;
}): HostedRuntimeRedactedJson {
  return {
    hostedAssistantNextWakeAt: input.nextWakeAt,
    hostedAssistantProgressed: input.progressed,
    hostedOutboxPendingDeliveryEffects: input.deliveryEffectCount,
    hostedOutboxTerminalizedSending: input.outboxTerminalizedSendingCount,
    hostedSystemMailboxPrepared: input.systemMailboxPrepared,
    hostedSystemMailboxRetryableFailed: input.systemMailboxRetryableFailed,
  };
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

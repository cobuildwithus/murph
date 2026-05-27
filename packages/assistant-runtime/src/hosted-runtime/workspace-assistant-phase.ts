import {
  buildHostedExecutionRuntimeTimerWake,
  deriveHostedExecutionErrorCode,
  sanitizeHostedExecutionStructuredLogText,
  type HostedExecutionRedactedLogEntry,
} from "@murphai/hosted-execution";
import type {
  HostedWorkspaceCheckpointReason,
  HostedRuntimeRedactedJson,
  HostedRuntimeRedactedScalar,
} from "@murphai/hosted-execution/runtime-control";
import type {
  AssistantExecutionContext,
} from "@murphai/assistant-engine";
import {
  compareAssistantInputCursors,
  listPendingAssistantAutoReplyLinqCleanupEvidence,
  markAssistantAutoReplyLinqCleanupQueued,
  readLatestAssistantInputCursor,
} from "@murphai/assistant-engine/assistant-automation";
import {
  readAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-store";
import {
  listConfiguredDeviceSyncConnectTargets,
} from "@murphai/device-syncd/config";

import {
  collectHostedAssistantDeliverySideEffects,
  drainHostedPreparedAssistantDeliveries,
  prepareHostedAssistantDeliveryEffectsForDispatch,
  resolveHostedAssistantOutboxNextWakeAt,
} from "./callbacks.ts";
import {
  buildHostedLinqChannelEnv,
  createHostedAssistantChannelTypingDependencies,
} from "./channel-activity.ts";
import {
  hydrateHostedExecutionDefaultTarget,
} from "./context.ts";
import {
  runHostedAssistantRuntimeTimerLane,
  runHostedDeviceSyncWakeLane,
} from "./maintenance.ts";
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
} from "./system-mailbox.ts";
import type {
  HostedAssistantDeliveryOutcome,
  HostedAssistantWorkspaceRuntimeJobInput,
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
  HostedWorkspaceRunnerAssistantPhasePostCheckpoint,
  HostedWorkspaceRunnerAssistantPhaseResult,
} from "./workspace-runner.ts";
import {
  HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
  createHostedRuntimeWakeCandidate,
  selectHostedRuntimeWakeCandidate,
  type HostedRuntimeWakeCandidate,
} from "./wake-candidates.ts";

const HOSTED_ASSISTANT_AUTOMATION_DETAIL_PRIORITY_KEYS = [
  "assistantNotificationErrorCode",
  "assistantNotificationProviderErrorCode",
  "assistantNotificationErrorCodeDetail",
  "assistantNotificationCodexFailureStage",
  "assistantNotificationCodexStderrPresent",
  "assistantNotificationCodexExitCode",
  "assistantNotificationCodexConnectionLost",
  "assistantNotificationCodexFailureDetailPresent",
  "assistantNotificationCodexRetryable",
  "failureAssistantProviderErrorBodyCode",
  "failureAssistantProviderErrorBodyMessage",
  "failureAssistantProviderErrorBodyType",
  "failureAssistantProviderErrorCode",
  "failureAssistantProviderErrorMessage",
  "failureAssistantProviderErrorRetryable",
  "failureAssistantProviderErrorStatus",
  "failureAssistantProviderErrorStatusText",
  "failureAssistantProviderErrorType",
  "failureCodexConnectionLost",
  "failureCodexExitCode",
  "failureCodexDiagnosticsPresent",
  "failureCodexFailureDetailPresent",
  "failureCodexFailureStage",
  "failureCodexRetryable",
  "failureCodexSignalPresent",
  "failureCodexStderrPresent",
  "failureCodexTurnStatus",
  "failureConnectionLost",
  "failureInterrupted",
  "failureProviderActionCount",
  "failureProviderSessionId",
  "failureProviderStalled",
  "failureProviderUsageLimit",
  "failureRecoverableConnectionLoss",
  "failureRetryAfterSeconds",
  "failureRetryable",
  "failureFieldsPresent",
  "deliveryDispatchMode",
  "notificationChannel",
  "errorCode",
  "safeErrorLength",
  "safeErrorMessage",
  "safeErrorPresent",
  "schema",
  "providerTraceKind",
  "codexInvalidOutputTraceType",
  "codexInvalidOutputPhase",
  "codexInvalidOutputInputIndex",
  "codexInvalidOutputErrorField",
  "codexInvalidOutputErrorCode",
  "codexInvalidOutputErrorKind",
  "codexInvalidOutputErrorMessageLength",
  "codexInvalidOutputResumeSessionPresent",
  "codexInvalidOutputFailureSessionPresent",
  "codexInvalidOutputFailureTurnPresent",
  "codexInvalidOutputResumeMatchesFailureSession",
  "codexInvalidOutputFailureProviderActionCount",
  "codexInvalidOutputFailureEventCount",
  "codexInvalidOutputFailureEventMethods",
  "codexInvalidOutputFailureEventStatuses",
  "codexInvalidOutputFailureEventKinds",
  "codexInvalidOutputFailureParamKeys",
  "codexInvalidOutputFailureOutputKinds",
  "codexInvalidOutputFailureOutputArrayLengths",
  "codexInvalidOutputFailureOutputPartTypes",
  "codexInvalidOutputFailureOutputObjectKeys",
  "codexInvalidOutputFailureOutputStringLengths",
  "codexInvalidOutputFallbackAttempted",
  "codexInvalidOutputFallbackResult",
  "codexInvalidOutputFallbackSessionPresent",
  "codexInvalidOutputFallbackTurnPresent",
  "codexInvalidOutputFallbackSessionChanged",
  "codexInvalidOutputFallbackProviderActionCount",
  "codexInvalidOutputFallbackEventCount",
  "codexInvalidOutputFallbackErrorCode",
  "codexInvalidOutputFallbackErrorMessagePresent",
  "codexInvalidOutputFallbackErrorMessageLength",
  "codexResumeFailureTraceType",
  "codexResumeFailurePhase",
  "codexResumeFailureCodexFailureStage",
  "codexResumeFailureCodexTurnStatus",
  "codexResumeFailureErrorCode",
  "codexResumeFailureErrorKind",
  "codexResumeFailureErrorMessage",
  "codexResumeFailureErrorMessageLength",
  "codexResumeFailureErrorMessagePresent",
  "codexResumeFailureErrorPhrases",
  "codexResumeFailureResumeSessionPresent",
  "codexResumeFailureSessionPresent",
  "codexResumeFailureTurnPresent",
  "codexResumeFailureResumeMatchesFailureSession",
  "codexResumeFailureProviderActionCount",
  "codexResumeFailureEventCount",
  "codexResumeFailureEventMethods",
  "codexResumeFailureEventStatuses",
  "codexResumeFailureEventKinds",
  "codexResumeFailureParamKeys",
  "codexResumeFailureOutputKinds",
  "codexResumeFailureOutputArrayLengths",
  "codexResumeFailureOutputPartTypes",
  "codexResumeFailureOutputObjectKeys",
  "codexResumeFailureOutputStringLengths",
  "codexResumeFailureRetryable",
] as const;

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
const HOSTED_FOREGROUND_REPLAY_PROMPT_INPUT_LIMIT = 5;
const HOSTED_SKIPPED_DEVICE_SYNC_RETRY_DELAY_MS = 30_000;

export interface HostedWorkspaceRuntimeAssistantPhaseInput
  extends HostedWorkspaceRunnerAssistantPhaseInput {
  request: HostedAssistantWorkspaceRuntimeJobInput["request"];
  restored: HostedRestoredExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
  signal?: AbortSignal | null;
}

export type HostedWorkspaceRuntimeAssistantPhase = (
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
) => Promise<HostedWorkspaceRunnerAssistantPhaseResult>;

export async function runHostedWorkspaceAssistantPhase(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): Promise<HostedWorkspaceRunnerAssistantPhaseResult> {
  const typingAbortController = new AbortController();
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
  if (shouldWriteHostedDeviceConnectContextLog({ deviceConnectProviders, input })) {
    await writeHostedDeviceConnectRuntimeLog({
      deviceConnectProviders,
      input,
      issueLinkAvailable: issueDeviceConnectLink !== undefined,
      stage: "context",
      status: issueDeviceConnectLink ? "available" : "unavailable",
    });
  }
  const executionContext: AssistantExecutionContext = await hydrateHostedExecutionDefaultTarget(
    {
        hosted: {
          channelTypingDependencies: createHostedAssistantChannelTypingDependencies({
            forwardedEnv: input.runtime.forwardedEnv,
            platformEnv: input.runtime.platformEnv,
            providerFetch: input.runtime.platform.providerFetch ?? null,
            signal: typingAbortController.signal,
            userEnv: input.runtime.userEnv,
          }),
          deviceConnectProviders,
          ...(issueDeviceConnectLink ? { issueDeviceConnectLink } : {}),
          ...(input.materializeWorkspaceArtifacts
            ? { materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts }
            : {}),
          memberId: input.request.userId,
        ...(input.runtime.platform.usageRecordPort
          ? {
              usageRecorder: {
                recordUsage: async (record) => {
                  await input.runtime.platform.usageRecordPort?.recordUsage(record);
                },
              },
            }
          : {}),
        userEnvKeys: Object.keys(input.runtime.userEnv),
      },
    },
    {
      runtimeEnv: input.runtimeEnv,
    },
  );

  try {
    const hasFreshConversationInput = hasFreshHostedConversationInput(input);
    const systemMailboxMaintenance = await runSystemMailboxMaintenancePhase({
      executionContext,
      hasFreshConversationInput,
      input,
      wake,
    });
    if (
      systemMailboxMaintenance.result
      && !systemMailboxMaintenance.continueAssistantLane
    ) {
      return systemMailboxMaintenance.result;
    }
    const continuingSystemMailboxResult = systemMailboxMaintenance.continueAssistantLane
      ? systemMailboxMaintenance.result
      : null;
    const initialProviderCleanupCheckpoint =
      systemMailboxMaintenance.initialProviderCleanupCheckpoint;
    const mergeContinuingSystemMailboxResult = (
      assistantResult: HostedWorkspaceRunnerAssistantPhaseResult,
    ): HostedWorkspaceRunnerAssistantPhaseResult =>
      mergeContinuingSystemMailboxAssistantPhaseResult({
        assistantResult,
        systemMailboxResult: continuingSystemMailboxResult,
      });

    const skipDeviceSync = shouldSkipDeviceSyncForAssistantPhase(input);
    const foregroundReplayInputIds = resolveHostedForegroundReplayInputIds(input);
    const foregroundReplayPromptInputIds =
      resolveHostedForegroundReplayPromptInputIds(foregroundReplayInputIds);
    const preferredInputIds = hasFreshConversationInput
      ? foregroundReplayInputIds
      : input.initialMailboxImport.importResult.assistantInputIds ?? [];
    let assistantMetrics = await runHostedAssistantRuntimeTimerLane({
      executionContext,
      foregroundReplayInputIds,
      foregroundReplayPromptInputIds,
      preferredInputIds,
      requestId: `hosted-workspace-invocation:${input.request.attemptId}:assistant`,
      runtime: {
        commitTimeoutMs: input.runtime.commitTimeoutMs,
        forwardedEnv: input.runtime.forwardedEnv,
        platform: input.platform,
        platformEnv: input.runtime.platformEnv,
        resolvedConfig: input.runtime.resolvedConfig,
      },
      signal: input.signal ?? undefined,
      ...(input.shouldYieldBackgroundMaintenance
        ? { shouldYieldDeviceSync: input.shouldYieldBackgroundMaintenance }
        : {}),
      skipDeviceSync,
      vaultRoot: input.restored.vaultRoot,
      wake,
    });
    if (shouldRunDeferredLegacyDeviceSyncRecovery({ assistantMetrics, input })) {
      const deviceSyncMetrics = await runHostedDeviceSyncWakeLane({
        deviceSyncPort: input.runtime.platform.deviceSyncPort ?? null,
        platformEnv: input.runtime.platformEnv,
        runtimeLogPlatform: input.runtime.platform,
        resolvedConfig: input.runtime.resolvedConfig,
        ...(input.shouldYieldBackgroundMaintenance
          ? { shouldYieldDeviceSync: input.shouldYieldBackgroundMaintenance }
          : {}),
        timeoutMs: input.runtime.commitTimeoutMs,
        vaultRoot: input.restored.vaultRoot,
        wake,
      });
      assistantMetrics = mergeDeferredLegacyDeviceSyncMetrics({
        assistantMetrics,
        deviceSyncMetrics,
      });
    }
    const skippedDeviceSyncWake = resolveSkippedDeviceSyncWake({
      assistantMetrics,
      input,
      skipDeviceSync,
    });
    const currentTurnDeliveryIntentIds =
      assistantMetrics.assistantAutomationCurrentTurnDeliveryIntentIds ?? [];
    const foregroundAssistantPass = isHostedForegroundAssistantDeliveryPass({
      assistantMetrics,
      currentTurnDeliveryIntentIds,
      hasFreshConversationInput,
      input,
    });
    const systemMailboxWakeAt = await resolveHostedSystemMailboxNextWakeAt({
      vaultRoot: input.restored.vaultRoot,
    });
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
      const foregroundAssistantResult = await runForegroundAssistantReplyPhase({
        assistantMetrics,
        currentTurnDeliveryIntentIds,
        deferredProviderCleanupWakeAt: providerCleanupPhase.deferredProviderCleanupWakeAt,
        input,
        skippedDeviceSyncWake,
        systemMailboxWakeAt,
        wake,
      });
      return mergeContinuingSystemMailboxResult(foregroundAssistantResult);
    }
    const providerCleanupCheckpoint = providerCleanupPhase.providerCleanupCheckpoint;
    const providerCleanupDue = providerCleanupPhase.providerCleanupDue;
    const terminalLinqCleanupDue = providerCleanupPhase.terminalLinqCleanupDue;
    const deferredProviderCleanupWakeAt = providerCleanupPhase.deferredProviderCleanupWakeAt;
    const deliveryEffects = await collectHostedAssistantDeliverySideEffects({
      includeBackgroundDueIntents: true,
      preferredIntentIds: currentTurnDeliveryIntentIds,
      vaultRoot: input.restored.vaultRoot,
    });
    await prepareHostedAssistantDeliveryEffectsForDispatch({
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
      const fastDispatchBaseNextWake = resolveHostedFastDispatchBaseNextWake({
        assistantMetrics,
        deferredProviderCleanupWakeAt,
        input,
        skippedDeviceSyncWake,
        systemMailboxWakeAt,
      });
      const postDelivery = await drainHostedPostCheckpointDelivery({
        assistantDeliveryEffects: deliveryEffects,
        baseNextWake: fastDispatchBaseNextWake,
        checkpointReason: "outbox_receipt",
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
        skippedDeviceSyncWakeAt: skippedDeviceSyncWake?.at ?? null,
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
    const assistantNextWakeAt = resolveHostedAssistantAutomationNextWakeAt({
      input,
      nextWakeAt: assistantMetrics.nextWakeAt,
    });
    const assistantNextWakeReason = resolveHostedAssistantMetricsNextWakeReason({
      assistantMetrics,
      assistantNextWakeAt,
    });
    const nextWake = selectHostedRuntimeWakeCandidate([
      createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
      skippedDeviceSyncWake,
      createHostedRuntimeWakeCandidate(outboxWakeAt, "assistant"),
      createHostedRuntimeWakeCandidate(systemMailboxWakeAt, "assistant"),
      createHostedRuntimeWakeCandidate(deferredProviderCleanupWakeAt, "assistant"),
    ]);
    const nextWakeAt = nextWake.at;
    const wakeStateProgressed = hostedAssistantWakeStateProgressed({
      assistantMetrics,
      input,
      nextWakeAt,
      skippedDeviceSyncWakeAt: skippedDeviceSyncWake?.at ?? null,
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
      || terminalLinqCleanupDue
      || (assistantMetrics.postCheckpointRecord ?? null) !== null;

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

    return mergeContinuingSystemMailboxResult({
      ...(hasPostCommitProviderCleanup
        ? {
            afterCheckpoint: async () => {
              assertHostedAssistantPhaseLiveness(input.signal);
              const deviceSyncPostCheckpoint = assistantMetrics.postCheckpointRecord
                ? deferHostedDeviceSyncDirtyPostCheckpointRecord({
                    record: assistantMetrics.postCheckpointRecord,
                    runtime: input.runtime,
                  })
                : null;
              const baseNextWake = selectHostedRuntimeWakeCandidate([
                createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
                skippedDeviceSyncWake,
                createHostedRuntimeWakeCandidate(
                  deviceSyncPostCheckpoint?.nextWakeAt ?? null,
                  HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
                ),
                createHostedRuntimeWakeCandidate(systemMailboxWakeAt, "assistant"),
                createHostedRuntimeWakeCandidate(deferredProviderCleanupWakeAt, "assistant"),
              ]);
              const baseNextWakeAt = baseNextWake.at;
              if (
                deliveryEffects.length === 0
                && !providerCleanupDue
                && !terminalLinqCleanupDue
              ) {
                return {
                  ...(deviceSyncPostCheckpoint
                    ? { afterDurableCheckpoint: deviceSyncPostCheckpoint.afterDurableCheckpoint }
                    : {}),
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: baseNextWakeAt,
                  nextWakeReason: baseNextWake.reason,
                  redactedStatus: {
                    ...(deviceSyncPostCheckpoint?.redactedStatus ?? {}),
                    nextWakeAt: baseNextWakeAt,
                  },
                };
              }
              return await drainHostedPostCheckpointDelivery({
                afterDurableCheckpoint: deviceSyncPostCheckpoint?.afterDurableCheckpoint ?? null,
                assistantDeliveryEffects: deliveryEffects,
                baseNextWake,
                checkpointReason: deliveryEffects.length > 0 ? "outbox_receipt" : "provider_cleanup",
                input,
                providerCleanup: {
                  checkpoint: providerCleanupCheckpoint,
                  mode: "drain",
                },
                redactedStatus: deviceSyncPostCheckpoint?.redactedStatus ?? null,
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
  } finally {
    typingAbortController.abort();
  }
}

function hasFreshHostedConversationInput(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return (input.initialMailboxImport.importResult.assistantInputIds?.length ?? 0) > 0
    || (input.initialMailboxImport.importResult.conversationImportedCount ?? 0) > 0;
}

function resolveHostedForegroundReplayInputIds(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): readonly string[] {
  const assistantInputIds =
    input.initialMailboxImport.importResult.assistantInputIds ?? [];
  if (assistantInputIds.length === 0 || !hasFreshHostedConversationInput(input)) {
    return [];
  }
  return assistantInputIds.slice(-HOSTED_FOREGROUND_REPLAY_PROMPT_INPUT_LIMIT);
}

function resolveHostedForegroundReplayPromptInputIds(
  assistantInputIds: readonly string[],
): readonly string[] {
  return assistantInputIds.slice(-HOSTED_FOREGROUND_REPLAY_PROMPT_INPUT_LIMIT);
}

function isHostedForegroundAssistantDeliveryPass(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantRuntimeTimerLane>>;
  currentTurnDeliveryIntentIds: readonly string[];
  hasFreshConversationInput: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): boolean {
  return input.currentTurnDeliveryIntentIds.length > 0
    || input.hasFreshConversationInput
    || input.assistantMetrics.activeTurnInputIngested === true;
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
  const afterCheckpoint = composeHostedAssistantPhaseAfterCheckpoint({
    baseNextWake: hasNextWakeAt ? nextWake : null,
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
  if (progressedResult) {
    return {
      ...(afterCheckpoint ? { afterCheckpoint } : {}),
      checkpointReason: progressedResult.checkpointReason,
      ...(hasNextWakeAt ? { nextWakeAt: nextWake.at } : {}),
      ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
        ? { nextWakeReason: nextWake.reason }
        : {}),
      progressed: true,
      ...(redactedStatus ? { redactedStatus } : {}),
    };
  }

  return {
    ...(hasNextWakeAt ? { nextWakeAt: nextWake.at } : {}),
    ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
      ? { nextWakeReason: nextWake.reason }
      : {}),
    progressed: false,
    ...(redactedStatus ? { redactedStatus } : {}),
  };
}

function composeHostedAssistantPhaseAfterCheckpoint(input: {
  baseNextWake: HostedRuntimeWakeCandidate | null;
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
      const base = merged ?? buildHostedAssistantPhaseBasePostCheckpoint(input.baseNextWake);
      merged = mergeHostedAssistantPhasePostCheckpoint(base, result);
    }
    return merged;
  };
}

function buildHostedAssistantPhaseBasePostCheckpoint(
  baseNextWake: HostedRuntimeWakeCandidate | null,
): HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null {
  if (!baseNextWake) {
    return null;
  }

  return {
    checkpointReason: "assistant_runtime_commit",
    nextWakeAt: baseNextWake.at,
    ...(shouldExposeHostedAssistantPhaseNextWakeReason(baseNextWake.reason)
      ? { nextWakeReason: baseNextWake.reason }
      : {}),
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

function deferHostedDeviceSyncDirtyPostCheckpointRecord(input: Parameters<
  typeof recordHostedDeviceSyncDirtyPostCheckpointRecord
>[0]): DeferredHostedDeviceSyncDirtyPostCheckpointRecord {
  return {
    afterDurableCheckpoint: async () => {
      const result = await recordHostedDeviceSyncDirtyPostCheckpointRecord(input);
      return result.nextWakeAt
        ? {
            nextWakeAt: result.nextWakeAt,
            nextWakeReason: HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
          }
        : null;
    },
    nextWakeAt: input.record.nextWakeAt ?? null,
    redactedStatus: {
      hostedDeviceSyncDirtyAckDeferred: true,
      hostedDeviceSyncDirtyAckRecorded: false,
      hostedDeviceSyncDirtyStillPending: true,
    },
  };
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
type HostedAssistantMetrics = Awaited<ReturnType<typeof runHostedAssistantRuntimeTimerLane>>;
type HostedDeviceSyncWakeMetrics = Awaited<ReturnType<typeof runHostedDeviceSyncWakeLane>>;
type HostedTerminalLinqCleanupEvidence = Awaited<
  ReturnType<typeof listPendingAssistantAutoReplyLinqCleanupEvidence>
>;

async function runSystemMailboxMaintenancePhase(input: {
  executionContext: AssistantExecutionContext;
  hasFreshConversationInput: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<{
  continueAssistantLane: boolean;
  initialProviderCleanupCheckpoint: HostedProviderCleanupCheckpoint | null;
  result: HostedWorkspaceRunnerAssistantPhaseResult | null;
}> {
  if (
    input.hasFreshConversationInput
    || input.input.shouldYieldBackgroundMaintenance?.() === true
  ) {
    return {
      continueAssistantLane: false,
      initialProviderCleanupCheckpoint: null,
      result: null,
    };
  }

  const phaseInput = input.input;
  const systemMailboxPreparation = await prepareHostedSystemMailboxItemForCheckpoint({
    executionContext: input.executionContext,
    runtime: phaseInput.runtime,
    runtimeEnv: phaseInput.runtimeEnv,
    shouldYieldBackgroundMaintenance: phaseInput.shouldYieldBackgroundMaintenance ?? null,
    vaultRoot: phaseInput.restored.vaultRoot,
  });
  const shouldYieldAfterSystemMailboxPreparation =
    phaseInput.shouldYieldBackgroundMaintenance?.() === true;
  const initialProviderCleanupCheckpoint =
    await readHostedProviderCleanupCheckpoint(phaseInput.restored.vaultRoot);
  const initialProviderCleanupDue =
    !shouldYieldAfterSystemMailboxPreparation
    && isHostedProviderCleanupCheckpointDue(initialProviderCleanupCheckpoint, phaseInput);
  if (!systemMailboxPreparation) {
    return {
      continueAssistantLane: false,
      initialProviderCleanupCheckpoint,
      result: null,
    };
  }

  const shouldRunDirtyDeviceSyncWorkSource =
    !shouldYieldAfterSystemMailboxPreparation
    && (
      !("item" in systemMailboxPreparation)
      || systemMailboxPreparation.item.routeAction !== "run-device-sync-wake"
    );
  const dirtyDeviceSyncMetrics = shouldRunDirtyDeviceSyncWorkSource
    ? await runHostedDeviceSyncWakeLane({
        deviceSyncPort: phaseInput.runtime.platform.deviceSyncPort ?? null,
        platformEnv: phaseInput.runtime.platformEnv,
        runtimeLogPlatform: phaseInput.runtime.platform,
        resolvedConfig: phaseInput.runtime.resolvedConfig,
        ...(phaseInput.shouldYieldBackgroundMaintenance
          ? { shouldYieldDeviceSync: phaseInput.shouldYieldBackgroundMaintenance }
          : {}),
        timeoutMs: phaseInput.runtime.commitTimeoutMs,
        vaultRoot: phaseInput.restored.vaultRoot,
        wake: input.wake,
      })
    : null;
  const systemMailboxDeliveryEffects =
    !shouldYieldAfterSystemMailboxPreparation
      && systemMailboxPreparation.status === "processed"
      && systemMailboxPreparation.item.routeAction === "dispatch-assistant-notification"
      ? await collectHostedAssistantDeliverySideEffects({
        includeBackgroundDueIntents: true,
        preferredIntentIds: [],
        vaultRoot: phaseInput.restored.vaultRoot,
      })
      : [];
  if (systemMailboxDeliveryEffects.length > 0) {
    await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: systemMailboxDeliveryEffects,
      vaultRoot: phaseInput.restored.vaultRoot,
    });
  }
  const outboxWakeAt = systemMailboxDeliveryEffects.length > 0
    ? await resolveHostedAssistantOutboxNextWakeAt({
        vaultRoot: phaseInput.restored.vaultRoot,
      })
    : null;
  const systemMailboxWakeAt = systemMailboxPreparation.status === "retryable_failed"
    ? systemMailboxPreparation.nextWakeAt
    : await resolveHostedSystemMailboxNextWakeAt({
        vaultRoot: phaseInput.restored.vaultRoot,
      });
  const systemMailboxMetricsWakeAt = "metrics" in systemMailboxPreparation
    ? resolveHostedAssistantAutomationNextWakeAt({
        input: phaseInput,
        nextWakeAt: systemMailboxPreparation.metrics.nextWakeAt ?? null,
      })
    : null;
  const systemMailboxMetricsWakeReason = resolveHostedSystemMailboxMetricsWakeReason({
    metricsWakeAt: systemMailboxMetricsWakeAt,
    systemMailboxPreparation,
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
      ])
    : null;
  const dirtyDeviceSyncWakeAt = dirtyDeviceSyncWake?.at ?? null;
  const pendingAssistantInputWakeAt = await resolvePendingAssistantInputWakeAt(phaseInput);
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(systemMailboxWakeAt, "assistant"),
    createHostedRuntimeWakeCandidate(systemMailboxMetricsWakeAt, systemMailboxMetricsWakeReason),
    dirtyDeviceSyncWake,
    createHostedRuntimeWakeCandidate(outboxWakeAt, "assistant"),
    createHostedRuntimeWakeCandidate(
      initialProviderCleanupDue ? null : initialProviderCleanupCheckpoint?.nextWakeAt ?? null,
      "assistant",
    ),
    createHostedRuntimeWakeCandidate(pendingAssistantInputWakeAt, "assistant"),
  ]);
  const nextWakeAt = nextWake.at;
  const shouldRecordSystemMailbox = systemMailboxPreparation.status === "processed"
    || systemMailboxPreparation.status === "recording";
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
          routeAction: null,
          wakeKind: null,
        }),
  });

  return {
    continueAssistantLane:
      shouldYieldAfterSystemMailboxPreparation
      || shouldContinueAssistantLaneAfterSystemMailboxPreparation(systemMailboxPreparation),
    initialProviderCleanupCheckpoint,
    result: {
      ...(shouldRunPostSystemCheckpoint
        ? {
            afterCheckpoint: async () => {
              assertHostedAssistantPhaseLiveness(phaseInput.signal);
              return await runSystemMailboxPostCheckpointPhase({
                dirtyDeviceSyncMetrics,
                initialProviderCleanupCheckpoint,
                initialProviderCleanupDue,
                input: phaseInput,
                pendingAssistantInputWakeAt,
                systemMailboxMetricsWakeAt,
                systemMailboxMetricsWakeReason,
                systemMailboxDeliveryEffects,
                systemMailboxPreparation,
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
      redactedStatus: buildHostedWorkspaceAssistantPhaseRedactedStatus({
        deliveryEffectCount: systemMailboxDeliveryEffects.length,
        nextWakeAt,
        outboxTerminalizedSendingCount: 0,
        progressed: true,
        systemMailboxPrepared: systemMailboxPreparation.status === "retryable_failed" ? 0 : 1,
        systemMailboxRetryableFailed:
          systemMailboxPreparation.status === "retryable_failed" ? 1 : 0,
      }),
    },
  };
}

async function runSystemMailboxPostCheckpointPhase(input: {
  dirtyDeviceSyncMetrics: HostedDeviceSyncWakeMetrics | null;
  initialProviderCleanupCheckpoint: HostedProviderCleanupCheckpoint | null;
  initialProviderCleanupDue: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  pendingAssistantInputWakeAt: string | null;
  systemMailboxMetricsWakeAt: string | null;
  systemMailboxMetricsWakeReason: string | null;
  systemMailboxDeliveryEffects: HostedAssistantDeliveryEffects;
  systemMailboxPreparation: NonNullable<
    Awaited<ReturnType<typeof prepareHostedSystemMailboxItemForCheckpoint>>
  >;
  systemMailboxWakeAt: string | null;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null> {
  if ("item" in input.systemMailboxPreparation) {
    const statusCallback = await recordHostedSystemMailboxItemAfterCheckpoint({
      item: input.systemMailboxPreparation.item,
      runtime: input.input.runtime,
      vaultRoot: input.input.restored.vaultRoot,
    });
    const dirtyPostCheckpoint = input.dirtyDeviceSyncMetrics?.postCheckpointRecord
      ? deferHostedDeviceSyncDirtyPostCheckpointRecord({
          record: input.dirtyDeviceSyncMetrics.postCheckpointRecord,
          runtime: input.input.runtime,
        })
      : null;
    const dirtyPostCheckpointWakeAt = dirtyPostCheckpoint?.nextWakeAt ?? null;
    const statusNextWake = selectHostedRuntimeWakeCandidate([
      createHostedRuntimeWakeCandidate(
        statusCallback.nextWakeAt,
        statusCallback.nextWakeReason ?? "assistant",
      ),
      createHostedRuntimeWakeCandidate(
        dirtyPostCheckpointWakeAt,
        HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
      ),
      createHostedRuntimeWakeCandidate(input.pendingAssistantInputWakeAt, "assistant"),
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
    await writeHostedSystemMailboxRuntimeLog({
      attemptCount: input.systemMailboxPreparation.item.attemptCount,
      input: input.input,
      nextWakeAt: statusNextWakeAt,
      recorded: statusCallback.recorded,
      recordFailed: statusCallback.failed,
      routeAction: input.systemMailboxPreparation.item.routeAction,
      status: "recorded",
      wakeKind: input.systemMailboxPreparation.item.wake.kind,
    });
    if (input.systemMailboxDeliveryEffects.length > 0 || input.initialProviderCleanupDue) {
      return await drainHostedPostCheckpointDelivery({
        afterDurableCheckpoint: dirtyPostCheckpoint?.afterDurableCheckpoint ?? null,
        assistantDeliveryEffects: input.systemMailboxDeliveryEffects,
        baseNextWake: {
          at: statusNextWakeAt,
          reason: statusNextWakeReason,
        },
        checkpointReason: input.systemMailboxDeliveryEffects.length > 0
          ? "outbox_receipt"
          : "provider_cleanup",
        input: input.input,
        providerCleanup: {
          checkpoint: input.initialProviderCleanupCheckpoint,
          mode: "drain",
        },
        redactedStatus: {
          ...dirtyRedactedStatus,
          hostedSystemMailboxRecordFailed: statusCallback.failed,
          hostedSystemMailboxRecorded: statusCallback.recorded,
        },
        wake: input.systemMailboxPreparation.item.wake,
      });
    }
    return {
      ...(dirtyPostCheckpoint
        ? { afterDurableCheckpoint: dirtyPostCheckpoint.afterDurableCheckpoint }
        : {}),
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: statusNextWakeAt,
      nextWakeReason: statusNextWakeReason,
      redactedStatus: {
        ...dirtyRedactedStatus,
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
    const baseNextWake = selectHostedRuntimeWakeCandidate([
      createHostedRuntimeWakeCandidate(input.systemMailboxWakeAt, "assistant"),
      createHostedRuntimeWakeCandidate(
        dirtyPostCheckpointWakeAt,
        HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
      ),
      createHostedRuntimeWakeCandidate(input.pendingAssistantInputWakeAt, "assistant"),
    ]);
    return await drainHostedPostCheckpointDelivery({
      afterDurableCheckpoint: dirtyPostCheckpoint?.afterDurableCheckpoint ?? null,
      assistantDeliveryEffects: [],
      baseNextWake,
      checkpointReason: "provider_cleanup",
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

  const dirtyNextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(input.systemMailboxWakeAt, "assistant"),
    createHostedRuntimeWakeCandidate(input.pendingAssistantInputWakeAt, "assistant"),
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
  preferredIntentIds: readonly string[];
  vaultRoot: string;
}): Promise<HostedAssistantDeliveryEffects> {
  const deliveryEffects = await collectHostedAssistantDeliverySideEffects({
    includeBackgroundDueIntents: false,
    preferredIntentIds: input.preferredIntentIds,
    vaultRoot: input.vaultRoot,
  });
  await prepareHostedAssistantDeliveryEffectsForDispatch({
    assistantDeliveryEffects: deliveryEffects,
    vaultRoot: input.vaultRoot,
  });
  return deliveryEffects;
}

async function runForegroundAssistantReplyPhase(input: {
  assistantMetrics: HostedAssistantMetrics;
  currentTurnDeliveryIntentIds: readonly string[];
  deferredProviderCleanupWakeAt: string | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  skippedDeviceSyncWake: HostedRuntimeWakeCandidate | null;
  systemMailboxWakeAt: string | null;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<HostedWorkspaceRunnerAssistantPhaseResult> {
  const deliveryEffects = await collectForegroundDeliveryEffects({
    preferredIntentIds: input.currentTurnDeliveryIntentIds,
    vaultRoot: input.input.restored.vaultRoot,
  });

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
      systemMailboxWakeAt: input.systemMailboxWakeAt,
    });
    const postDelivery = await drainHostedPostCheckpointDelivery({
      assistantDeliveryEffects: deliveryEffects,
      baseNextWake: fastDispatchBaseNextWake,
      checkpointReason: "outbox_receipt",
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
  const assistantNextWakeReason = resolveHostedAssistantMetricsNextWakeReason({
    assistantMetrics: input.assistantMetrics,
    assistantNextWakeAt,
  });
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
    input.skippedDeviceSyncWake,
    createHostedRuntimeWakeCandidate(outboxWakeAt, "assistant"),
    createHostedRuntimeWakeCandidate(input.systemMailboxWakeAt, "assistant"),
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
  const hasPostCommitProviderCleanup = deliveryEffects.length > 0
    || (input.assistantMetrics.postCheckpointRecord ?? null) !== null;

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
            const deviceSyncPostCheckpoint = input.assistantMetrics.postCheckpointRecord
              ? deferHostedDeviceSyncDirtyPostCheckpointRecord({
                  record: input.assistantMetrics.postCheckpointRecord,
                  runtime: input.input.runtime,
                })
              : null;
            const baseNextWake = selectHostedRuntimeWakeCandidate([
              createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
              input.skippedDeviceSyncWake,
              createHostedRuntimeWakeCandidate(
                deviceSyncPostCheckpoint?.nextWakeAt ?? null,
                HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
              ),
              createHostedRuntimeWakeCandidate(input.systemMailboxWakeAt, "assistant"),
              createHostedRuntimeWakeCandidate(input.deferredProviderCleanupWakeAt, "assistant"),
            ]);
            const baseNextWakeAt = baseNextWake.at;
            if (deliveryEffects.length === 0) {
              return {
                ...(deviceSyncPostCheckpoint
                  ? { afterDurableCheckpoint: deviceSyncPostCheckpoint.afterDurableCheckpoint }
                  : {}),
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: baseNextWakeAt,
                nextWakeReason: baseNextWake.reason,
                redactedStatus: {
                  ...(deviceSyncPostCheckpoint?.redactedStatus ?? {}),
                  nextWakeAt: baseNextWakeAt,
                },
              };
            }
            return await drainHostedPostCheckpointDelivery({
              afterDurableCheckpoint: deviceSyncPostCheckpoint?.afterDurableCheckpoint ?? null,
              assistantDeliveryEffects: deliveryEffects,
              baseNextWake,
              checkpointReason: "outbox_receipt",
              input: input.input,
              providerCleanup: {
                mode: "defer",
              },
              redactedStatus: deviceSyncPostCheckpoint?.redactedStatus ?? null,
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
  baseNextWake: HostedRuntimeWakeCandidate;
  checkpointReason: HostedWorkspaceRunnerAssistantPhasePostCheckpoint["checkpointReason"];
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  providerCleanup:
    | { checkpoint: HostedProviderCleanupCheckpoint | null; mode: "drain" }
    | { mode: "defer" };
  redactedStatus: HostedRuntimeRedactedJson | null;
  wake: Parameters<typeof drainHostedPreparedAssistantDeliveries>[0]["wake"];
}): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint> {
  const outcomes = input.assistantDeliveryEffects.length > 0
    ? await drainHostedPreparedAssistantDeliveries({
        allowPreparedSending: true,
        assistantDeliveryEffects: input.assistantDeliveryEffects,
        assertLiveness: async () => {
          assertHostedAssistantPhaseLiveness(input.input.signal);
        },
        effectsPort: input.input.platform.effectsPort,
        forwardedEnv: input.input.runtime.forwardedEnv,
        platformEnv: input.input.runtime.platformEnv,
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
      fetchImplementation: input.input.runtime.platform.providerFetch ?? undefined,
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
  const postSystemMailboxWakeAt = await resolveHostedSystemMailboxNextWakeAt({
    vaultRoot: input.input.restored.vaultRoot,
  });
  const postNextWake = selectHostedRuntimeWakeCandidate([
    input.baseNextWake,
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

  return {
    ...(input.afterDurableCheckpoint ? { afterDurableCheckpoint: input.afterDurableCheckpoint } : {}),
    checkpointReason: input.checkpointReason,
    nextWakeAt: postNextWakeAt,
    nextWakeReason: postNextWake.reason,
    redactedStatus: {
      hostedOutboxDeliveryAttempted: outcomes.length,
      hostedOutboxDeliverySent: outcomes.filter((outcome) =>
        outcome.deliveryStatus === "sent"
      ).length,
      ...providerCleanupRedactedStatus,
      ...(input.redactedStatus ?? {}),
      nextWakeAt: postNextWakeAt,
    },
  };
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
  const wakeAt = new Date(resolveHostedAssistantPhaseNowMs(input)).toISOString();
  const assistantInputIds = input.initialMailboxImport.importResult.assistantInputIds ?? [];
  if (assistantInputIds.length > 0) {
    return wakeAt;
  }

  const [automationState, latestInputCursor] = await Promise.all([
    readAssistantAutomationState(input.restored.vaultRoot),
    readLatestAssistantInputCursor({
      vault: input.restored.vaultRoot,
    }),
  ]);
  if (!latestInputCursor) {
    return null;
  }

  const hasPendingAutoReplyInput = automationState.autoReply.some((entry) =>
    !entry.eligibleAfter
    || compareAssistantInputCursors(latestInputCursor, entry.eligibleAfter) > 0
  );
  return hasPendingAutoReplyInput ? wakeAt : null;
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

function shouldSkipDeviceSyncForAssistantPhase(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  if (input.shouldYieldBackgroundMaintenance?.() === true) {
    return true;
  }

  if (input.request.source === "device_sync_recovery") {
    return hasFreshHostedConversationInput(input);
  }

  if (isDueHostedDeviceSyncReconcileWake(input)) {
    return false;
  }

  return true;
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
    && !hasFreshHostedConversationInput(input)
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
  if (
    input.request.reason !== "alarm"
    || hasFreshHostedConversationInput(input)
  ) {
    return false;
  }

  return isDueHostedWorkspaceWake(input);
}

function isDueHostedWorkspaceWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  if (
    input.request.reason !== "alarm"
    || !input.workspace?.nextWakeAt
  ) {
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

function resolveSkippedDeviceSyncWake(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantRuntimeTimerLane>>;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  skipDeviceSync: boolean;
}): HostedRuntimeWakeCandidate | null {
  if (!input.skipDeviceSync || !input.assistantMetrics.deviceSyncSkipped) {
    return null;
  }

  if (
    input.input.request.source === "device_sync_recovery"
    && shouldRescheduleSkippedDeviceSyncWake(input.input)
  ) {
    return {
      at: new Date(
        resolveHostedAssistantPhaseNowMs(input.input)
          + HOSTED_SKIPPED_DEVICE_SYNC_RETRY_DELAY_MS,
      ).toISOString(),
      reason: HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
    };
  }

  const existingWakeAt = input.input.workspace?.nextWakeAt ?? null;
  if (!existingWakeAt) {
    return null;
  }

  const wakeTime = Date.parse(existingWakeAt);
  const existingWakeReason = input.input.workspace?.nextWakeReason ?? null;
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

  if (isDueHostedLegacyDeviceSyncRecoveryWake(input.input)) {
    return null;
  }

  if (shouldRescheduleSkippedDeviceSyncWake(input.input)) {
    return {
      at: new Date(nowMs + HOSTED_SKIPPED_DEVICE_SYNC_RETRY_DELAY_MS).toISOString(),
      reason: existingWakeReason,
    };
  }

  return null;
}

function shouldRunDeferredLegacyDeviceSyncRecovery(input: {
  assistantMetrics: HostedAssistantMetrics;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): boolean {
  if (!isDueHostedLegacyDeviceSyncRecoveryAlarm(input.input)) {
    return false;
  }
  if (input.input.shouldYieldBackgroundMaintenance?.() === true) {
    return false;
  }

  const assistantNextWakeAt = resolveHostedAssistantAutomationNextWakeAt({
    input: input.input,
    nextWakeAt: input.assistantMetrics.nextWakeAt,
  });
  return (
    assistantNextWakeAt === null
    && input.assistantMetrics.activeTurnInputIngested !== true
    && input.assistantMetrics.assistantAutomationProgressed !== true
    && (input.assistantMetrics.assistantAutomationCurrentTurnDeliveryIntentIds?.length ?? 0) === 0
    && input.assistantMetrics.deviceSyncProcessed === 0
    && input.assistantMetrics.parserProcessed === 0
    && (input.assistantMetrics.postCheckpointRecord ?? null) === null
  );
}

function mergeDeferredLegacyDeviceSyncMetrics(input: {
  assistantMetrics: HostedAssistantMetrics;
  deviceSyncMetrics: HostedDeviceSyncWakeMetrics;
}): HostedAssistantMetrics {
  const assistantMetrics = { ...input.assistantMetrics };
  delete assistantMetrics.nextWakeReason;
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      input.assistantMetrics.nextWakeAt,
      input.assistantMetrics.nextWakeReason ?? null,
    ),
    createHostedRuntimeWakeCandidate(
      input.deviceSyncMetrics.nextWakeAt,
      input.deviceSyncMetrics.nextWakeReason ?? HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
    ),
    createHostedRuntimeWakeCandidate(
      input.deviceSyncMetrics.postCheckpointRecord?.nextWakeAt ?? null,
      HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
    ),
  ]);

  return {
    ...assistantMetrics,
    deviceSyncElapsedMs: input.deviceSyncMetrics.deviceSyncElapsedMs
      ?? input.assistantMetrics.deviceSyncElapsedMs
      ?? null,
    deviceSyncProcessed: input.deviceSyncMetrics.deviceSyncProcessed,
    deviceSyncSkipped: input.deviceSyncMetrics.deviceSyncSkipped,
    nextWakeAt: nextWake.at,
    ...(nextWake.reason ? { nextWakeReason: nextWake.reason } : {}),
    postCheckpointRecord: input.deviceSyncMetrics.postCheckpointRecord ?? null,
  };
}

function shouldRescheduleSkippedDeviceSyncWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return (
    input.request.reason === "nudge"
    || hasFreshHostedConversationInput(input)
    || input.shouldYieldBackgroundMaintenance?.() === true
  );
}

async function writeHostedSystemMailboxRuntimeLog(input: {
  attemptCount: number | null;
  errorCode?: string | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  nextWakeAt: string | null;
  recorded: number | null;
  recordFailed: number | null;
  routeAction: string | null;
  status: "processed" | "recorded" | "recording" | "retryable_failed";
  wakeKind: string | null;
}): Promise<void> {
  const errorCode = toHostedRuntimeLogCode(input.errorCode);
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
        status: input.status,
        wakeKind: input.wakeKind,
      },
    },
    platform: input.input.platform,
  });
}

async function writeHostedAssistantPassRuntimeLog(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantRuntimeTimerLane>>;
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
        deviceSyncElapsedMs: input.assistantMetrics.deviceSyncElapsedMs ?? null,
        deviceSyncProcessed: input.assistantMetrics.deviceSyncProcessed,
        deviceSyncSkipped: input.assistantMetrics.deviceSyncSkipped,
        deviceSyncDirtyAckPending: (input.assistantMetrics.postCheckpointRecord ?? null) !== null,
        nextWakeAtPresent: input.nextWakeAt !== null,
        parserProcessed: input.assistantMetrics.parserProcessed,
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

function buildHostedAssistantAutomationDetailRedactedJson(
  redacted: Record<string, unknown> | null | undefined,
  detail: HostedRuntimeRedactedJson,
): HostedRuntimeRedactedJson {
  const output: HostedRuntimeRedactedJson = {};
  const input = redacted ?? {};

  for (const key of HOSTED_ASSISTANT_AUTOMATION_DETAIL_PRIORITY_KEYS) {
    maybeCopyHostedAssistantAutomationDetailRedactedEntry(output, input, key);
  }

  for (const [key, value] of Object.entries(input)) {
    if (key in output) {
      continue;
    }

    if (Object.keys(output).length >= HOSTED_ASSISTANT_AUTOMATION_DETAIL_MAX_KEYS) {
      continue;
    }

    const redactedValue = normalizeHostedRuntimeRedactedLogValue(key, value);
    if (redactedValue !== undefined) {
      output[key] = redactedValue;
    }
  }

  return {
    ...output,
    ...detail,
  };
}

function maybeCopyHostedAssistantAutomationDetailRedactedEntry(
  output: HostedRuntimeRedactedJson,
  input: Record<string, unknown>,
  key: string,
): void {
  if (
    key in output
    || Object.keys(output).length >= HOSTED_ASSISTANT_AUTOMATION_DETAIL_MAX_KEYS
  ) {
    return;
  }

  const value = input[key];
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
    return normalizeHostedRuntimeRedactedLogArray(key, value);
  }

  return normalizeHostedRuntimeRedactedLogScalar(key, value);
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
  const code = toHostedRuntimeLogCode(value);
  if (code === "unclassified") {
    return code;
  }
  return /^ASSISTANT_[A-Z0-9_]*DELIVERY[A-Z0-9_]*$/u.test(code)
    ? code
    : "external_code";
}

function consumedScheduledWorkspaceWake(input: HostedWorkspaceRuntimeAssistantPhaseInput): boolean {
  if (input.request.reason !== "alarm" || !input.workspace?.nextWakeAt) {
    return false;
  }

  const wakeTime = Date.parse(input.workspace.nextWakeAt);
  return Number.isFinite(wakeTime) && wakeTime <= resolveHostedAssistantPhaseNowMs(input);
}

function hostedAssistantWakeStateProgressed(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantRuntimeTimerLane>>;
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

  if (input.input.request.reason !== "alarm") {
    return (
      input.nextWakeAt !== null
      && !hasFreshHostedConversationInput(input.input)
      && input.assistantMetrics.activeTurnInputIngested !== true
    );
  }

  if (!consumedScheduledWorkspaceWake(input.input)) {
    return false;
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
  const errorCode = input.error === undefined
    ? null
    : deriveHostedExecutionErrorCode(input.error);
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({
        attemptId: input.input.request.attemptId,
        leaseGeneration: input.input.request.leaseGeneration,
        workspaceVersion: input.input.request.workspaceVersion,
      }),
      ...(errorCode ? { errorCode } : {}),
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
        ...(errorCode ? { errorCode } : {}),
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
  metrics: Awaited<ReturnType<typeof runHostedAssistantRuntimeTimerLane>>,
  deliveryEffectCount: number,
): boolean {
  return (
    deliveryEffectCount > 0
    || metrics.assistantAutomationProgressed === true
    || metrics.deviceSyncProcessed > 0
    || metrics.parserProcessed > 0
    || (metrics.postCheckpointRecord ?? null) !== null
  );
}

function resolveHostedAssistantMetricsNextWakeReason(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantRuntimeTimerLane>>;
  assistantNextWakeAt: string | null;
}): string | null {
  if (!input.assistantNextWakeAt) {
    return null;
  }

  return input.assistantMetrics.nextWakeReason === HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON
    ? HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON
    : null;
}

function shouldExposeHostedAssistantPhaseNextWakeReason(reason: string | null | undefined): boolean {
  return reason === HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON;
}

function assistantMetricsCanonicalRuntimeProgressed(
  metrics: Awaited<ReturnType<typeof runHostedAssistantRuntimeTimerLane>>,
): boolean {
  return (
    metrics.assistantAutomationProgressed === true
    || metrics.deviceSyncProcessed > 0
    || metrics.parserProcessed > 0
  );
}

function resolveHostedAssistantTimerCheckpointReason(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantRuntimeTimerLane>>;
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
  if ((input.assistantMetrics.postCheckpointRecord ?? null) !== null) {
    return "assistant_runtime_commit";
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

function shouldFastDispatchAssistantDeliveryEffects(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantRuntimeTimerLane>>;
  deliveryEffects: HostedAssistantDeliveryEffects;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): boolean {
  return (
    (
      input.input.request.reason === "nudge"
      || hasFreshHostedConversationInput(input.input)
      || input.assistantMetrics.activeTurnInputIngested === true
    )
    && input.deliveryEffects.length > 0
    && input.deliveryEffects.every((effect) => effect.payload.transportIdempotent === true)
    && (input.assistantMetrics.postCheckpointRecord ?? null) === null
  );
}

function resolveHostedFastDispatchBaseNextWake(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantRuntimeTimerLane>>;
  deferredProviderCleanupWakeAt: string | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  skippedDeviceSyncWake: HostedRuntimeWakeCandidate | null;
  systemMailboxWakeAt: string | null;
}): HostedRuntimeWakeCandidate {
  const skippedDeviceSyncWake = shouldDropHostedFastDispatchSkippedDeviceSyncRetry(input)
    ? null
    : input.skippedDeviceSyncWake;
  const assistantNextWakeAt = resolveHostedAssistantAutomationNextWakeAt({
    input: input.input,
    nextWakeAt: input.assistantMetrics.nextWakeAt,
  });
  const assistantNextWakeReason = resolveHostedAssistantMetricsNextWakeReason({
    assistantMetrics: input.assistantMetrics,
    assistantNextWakeAt,
  });
  return selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
    skippedDeviceSyncWake,
    createHostedRuntimeWakeCandidate(input.systemMailboxWakeAt, "assistant"),
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

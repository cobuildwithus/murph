import {
  buildHostedExecutionRuntimeTimerWake,
  deriveHostedExecutionErrorCode,
  sanitizeHostedExecutionStructuredLogText,
  type HostedExecutionRedactedLogEntry,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeRedactedJson,
  HostedRuntimeRedactedScalar,
} from "@murphai/hosted-execution/runtime-control";
import type {
  AssistantExecutionContext,
} from "@murphai/assistant-engine";
import {
  listPendingAssistantAutoReplyLinqCleanupEvidence,
  markAssistantAutoReplyLinqCleanupQueued,
} from "@murphai/assistant-engine/assistant-automation";
import {
  listConfiguredDeviceSyncConnectTargets,
} from "@murphai/device-syncd/config";

import {
  collectHostedAssistantDeliverySideEffects,
  drainHostedCommittedAssistantDeliveriesAfterCommit,
  prepareHostedAssistantDeliverySideEffectsForCheckpoint,
  resolveHostedAssistantOutboxNextWakeAt,
} from "./callbacks.ts";
import {
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
  drainHostedProviderCleanupAfterCommit,
  readHostedProviderCleanupCheckpoint,
  recordHostedProviderCleanupBeforeCommit,
  type HostedProviderCleanupCheckpoint,
} from "./provider-cleanup.ts";
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
  HostedWorkspaceRunnerAssistantPhaseInput,
  HostedWorkspaceRunnerAssistantPhasePostCheckpoint,
  HostedWorkspaceRunnerAssistantPhaseResult,
} from "./workspace-runner.ts";

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
          effectsPort: input.runtime.platform.effectsPort,
          forwardedEnv: input.runtime.forwardedEnv,
          platformEnv: input.runtime.platformEnv,
          signal: typingAbortController.signal,
          userEnv: input.runtime.userEnv,
        }),
        deviceConnectProviders,
        ...(issueDeviceConnectLink ? { issueDeviceConnectLink } : {}),
        memberId: input.request.userId,
        userEnvKeys: Object.keys(input.runtime.userEnv),
      },
    },
    {
      runtimeEnv: input.runtimeEnv,
    },
  );

  try {
    const systemMailboxPreparation = await prepareHostedSystemMailboxItemForCheckpoint({
      executionContext,
      runtime: input.runtime,
      runtimeEnv: input.runtimeEnv,
      vaultRoot: input.restored.vaultRoot,
    });
    const providerCleanupCheckpoint = await readHostedProviderCleanupCheckpoint(
      input.restored.vaultRoot,
    );
    const providerCleanupDue =
      isHostedProviderCleanupCheckpointDue(providerCleanupCheckpoint);
    if (systemMailboxPreparation) {
      const shouldRunDirtyDeviceSyncWorkSource =
        !("item" in systemMailboxPreparation)
        || systemMailboxPreparation.item.routeAction !== "run-device-sync-wake";
      const dirtyDeviceSyncMetrics = shouldRunDirtyDeviceSyncWorkSource
        ? await runHostedDeviceSyncWakeLane({
            deviceSyncPort: input.runtime.platform.deviceSyncPort ?? null,
            platformEnv: input.runtime.platformEnv,
            runtimeLogPlatform: input.runtime.platform,
            resolvedConfig: input.runtime.resolvedConfig,
            timeoutMs: input.runtime.commitTimeoutMs,
            vaultRoot: input.restored.vaultRoot,
            wake,
          })
        : null;
      const systemMailboxDeliveryEffects =
        systemMailboxPreparation.status === "processed"
          && systemMailboxPreparation.item.routeAction === "dispatch-assistant-notification"
          ? await collectHostedAssistantDeliverySideEffects(input.restored.vaultRoot)
          : [];
      if (systemMailboxDeliveryEffects.length > 0) {
        await prepareHostedAssistantDeliverySideEffectsForCheckpoint({
          assistantDeliveryEffects: systemMailboxDeliveryEffects,
          vaultRoot: input.restored.vaultRoot,
        });
      }
      const outboxWakeAt = systemMailboxDeliveryEffects.length > 0
        ? await resolveHostedAssistantOutboxNextWakeAt({
            vaultRoot: input.restored.vaultRoot,
          })
        : null;
      const systemMailboxWakeAt = systemMailboxPreparation.status === "retryable_failed"
        ? systemMailboxPreparation.nextWakeAt
        : await resolveHostedSystemMailboxNextWakeAt({
            vaultRoot: input.restored.vaultRoot,
          });
      const systemMailboxMetricsWakeAt = "metrics" in systemMailboxPreparation
        ? systemMailboxPreparation.metrics.nextWakeAt ?? null
        : null;
      const dirtyDeviceSyncWakeAt = dirtyDeviceSyncMetrics
        ? resolveEarliestHostedWorkspaceWakeAt(
            dirtyDeviceSyncMetrics.nextWakeAt,
            dirtyDeviceSyncMetrics.postCheckpointRecord?.nextWakeAt ?? null,
          )
        : null;
      const nextWakeAt = resolveEarliestHostedWorkspaceWakeAt(
        resolveEarliestHostedWorkspaceWakeAt(
          resolveEarliestHostedWorkspaceWakeAt(
            resolveEarliestHostedWorkspaceWakeAt(
              systemMailboxWakeAt,
              systemMailboxMetricsWakeAt,
            ),
            dirtyDeviceSyncWakeAt,
          ),
          outboxWakeAt,
        ),
        providerCleanupDue ? null : providerCleanupCheckpoint?.nextWakeAt ?? null,
      );
      const shouldRecordSystemMailbox = systemMailboxPreparation.status === "processed"
        || systemMailboxPreparation.status === "recording";
      const shouldRunPostSystemCheckpoint = shouldRecordSystemMailbox
        || providerCleanupDue
        || (dirtyDeviceSyncMetrics?.postCheckpointRecord ?? null) !== null;
      if ("metrics" in systemMailboxPreparation) {
        await writeHostedAssistantAutomationDetailRuntimeLogs({
          assistantMetrics: systemMailboxPreparation.metrics,
          input,
        });
      }
      await writeHostedSystemMailboxRuntimeLog({
        input,
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
        ...(shouldRunPostSystemCheckpoint
          ? {
              afterCheckpoint: async () => {
                assertHostedAssistantPhaseLiveness(input.signal);
                if ("item" in systemMailboxPreparation) {
                  const statusCallback = await recordHostedSystemMailboxItemAfterCheckpoint({
                    item: systemMailboxPreparation.item,
                    runtime: input.runtime,
                    vaultRoot: input.restored.vaultRoot,
                  });
                  const dirtyPostCheckpoint = dirtyDeviceSyncMetrics?.postCheckpointRecord
                    ? await recordHostedDeviceSyncDirtyPostCheckpointRecord({
                        record: dirtyDeviceSyncMetrics.postCheckpointRecord,
                        runtime: input.runtime,
                      })
                    : null;
                  const dirtyPostCheckpointWakeAt = dirtyPostCheckpoint?.nextWakeAt ?? null;
                  const statusNextWakeAt = resolveEarliestHostedWorkspaceWakeAt(
                    statusCallback.nextWakeAt,
                    dirtyPostCheckpointWakeAt,
                  );
                  const dirtyRedactedStatus: HostedRuntimeRedactedJson = dirtyPostCheckpoint
                    ? {
                        hostedDeviceSyncDirtyAckRecorded: dirtyPostCheckpoint.recorded,
                        hostedDeviceSyncDirtyStillPending: dirtyPostCheckpoint.stillDirty,
                      }
                    : {};
                  await writeHostedSystemMailboxRuntimeLog({
                    attemptCount: systemMailboxPreparation.item.attemptCount,
                    input,
                    nextWakeAt: statusNextWakeAt,
                    recorded: statusCallback.recorded,
                    recordFailed: statusCallback.failed,
                    routeAction: systemMailboxPreparation.item.routeAction,
                    status: "recorded",
                    wakeKind: systemMailboxPreparation.item.wake.kind,
                  });
                  if (systemMailboxDeliveryEffects.length > 0 || providerCleanupDue) {
                    return await drainHostedPostCheckpointDeliveryCleanup({
                      assistantDeliveryEffects: systemMailboxDeliveryEffects,
                      baseNextWakeAt: statusNextWakeAt,
                      checkpointReason: systemMailboxDeliveryEffects.length > 0
                        ? "outbox_receipt"
                        : "system_mailbox_receipt",
                      input,
                      providerCleanupCheckpoint,
                      redactedStatus: {
                        ...dirtyRedactedStatus,
                        hostedSystemMailboxRecordFailed: statusCallback.failed,
                        hostedSystemMailboxRecorded: statusCallback.recorded,
                      },
                      wake: systemMailboxPreparation.item.wake,
                    });
                  }
                  const postCheckpoint: HostedWorkspaceRunnerAssistantPhasePostCheckpoint = {
                    checkpointReason: "system_mailbox_receipt",
                    nextWakeAt: statusNextWakeAt,
                    nextWakeReason: statusNextWakeAt ? "assistant" : null,
                    redactedStatus: {
                      ...dirtyRedactedStatus,
                      hostedSystemMailboxRecordFailed: statusCallback.failed,
                      hostedSystemMailboxRecorded: statusCallback.recorded,
                    },
                  };
                  return postCheckpoint;
                }

                const dirtyPostCheckpoint = dirtyDeviceSyncMetrics?.postCheckpointRecord
                  ? await recordHostedDeviceSyncDirtyPostCheckpointRecord({
                      record: dirtyDeviceSyncMetrics.postCheckpointRecord,
                      runtime: input.runtime,
                    })
                  : null;
                const dirtyPostCheckpointWakeAt = dirtyPostCheckpoint?.nextWakeAt ?? null;

                if (providerCleanupDue) {
                  return await drainHostedPostCheckpointDeliveryCleanup({
                    assistantDeliveryEffects: [],
                    baseNextWakeAt: resolveEarliestHostedWorkspaceWakeAt(
                      systemMailboxWakeAt,
                      dirtyPostCheckpointWakeAt,
                    ),
                    checkpointReason: "maintenance",
                    input,
                    providerCleanupCheckpoint,
                    redactedStatus: dirtyPostCheckpoint
                      ? {
                          hostedDeviceSyncDirtyAckRecorded: dirtyPostCheckpoint.recorded,
                          hostedDeviceSyncDirtyStillPending: dirtyPostCheckpoint.stillDirty,
                        }
                      : null,
                    wake,
                  });
                }

                if (dirtyPostCheckpoint) {
                  return {
                    checkpointReason: "maintenance",
                    nextWakeAt: dirtyPostCheckpoint.nextWakeAt,
                    nextWakeReason: dirtyPostCheckpoint.nextWakeAt ? "assistant" : null,
                    redactedStatus: {
                      hostedDeviceSyncDirtyAckRecorded: dirtyPostCheckpoint.recorded,
                      hostedDeviceSyncDirtyStillPending: dirtyPostCheckpoint.stillDirty,
                      nextWakeAt: dirtyPostCheckpoint.nextWakeAt,
                    },
                  };
                }

                return null;
              },
            }
          : {}),
        checkpointReason: shouldRecordSystemMailbox
          ? systemMailboxDeliveryEffects.length > 0
            ? "outbox_sending"
            : "system_mailbox_receipt"
          : "maintenance",
        ...(nextWakeAt ? { nextWakeAt } : {}),
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
      };
    }

    const assistantMetrics = await runHostedAssistantRuntimeTimerLane({
      executionContext,
      requestId: `hosted-workspace-invocation:${input.request.attemptId}:assistant`,
      runtime: {
        commitTimeoutMs: input.runtime.commitTimeoutMs,
        forwardedEnv: input.runtime.forwardedEnv,
        platform: input.platform,
        platformEnv: input.runtime.platformEnv,
        resolvedConfig: input.runtime.resolvedConfig,
      },
      signal: input.signal ?? undefined,
      skipDeviceSync: input.initialMailboxImport.importResult.importedCount > 0,
      vaultRoot: input.restored.vaultRoot,
      wake,
    });
    const terminalLinqCleanup = await listPendingAssistantAutoReplyLinqCleanupEvidence({
      vault: input.restored.vaultRoot,
    });
    const terminalLinqCleanupDue = terminalLinqCleanup.linqMessageIds.length > 0;
    if (terminalLinqCleanupDue) {
      await recordHostedProviderCleanupBeforeCommit({
        checkpoint: {
          nextWakeAt: null,
        },
        linqMessageIds: terminalLinqCleanup.linqMessageIds,
        vaultRoot: input.restored.vaultRoot,
      });
      await markAssistantAutoReplyLinqCleanupQueued({
        captureIds: terminalLinqCleanup.captureIds,
        vault: input.restored.vaultRoot,
      });
    }
    const outboxWakeAt = await resolveHostedAssistantOutboxNextWakeAt({
      vaultRoot: input.restored.vaultRoot,
    });
    const systemMailboxWakeAt = await resolveHostedSystemMailboxNextWakeAt({
      vaultRoot: input.restored.vaultRoot,
    });
    const deliveryEffects = await collectHostedAssistantDeliverySideEffects(
      input.restored.vaultRoot,
    );
    await prepareHostedAssistantDeliverySideEffectsForCheckpoint({
      assistantDeliveryEffects: deliveryEffects,
      vaultRoot: input.restored.vaultRoot,
    });
    const nextWakeAt = resolveEarliestHostedWorkspaceWakeAt(
      resolveEarliestHostedWorkspaceWakeAt(
        assistantMetrics.nextWakeAt,
        outboxWakeAt,
      ),
      systemMailboxWakeAt,
    );
    const progressed = assistantMetricsProgressed({
      ...assistantMetrics,
      nextWakeAt,
    }, deliveryEffects.length)
      || consumedScheduledWorkspaceWake(input)
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

    return {
      ...(hasPostCommitProviderCleanup
        ? {
            afterCheckpoint: async () => {
              assertHostedAssistantPhaseLiveness(input.signal);
              const deviceSyncPostCheckpoint = assistantMetrics.postCheckpointRecord
                ? await recordHostedDeviceSyncDirtyPostCheckpointRecord({
                    record: assistantMetrics.postCheckpointRecord,
                    runtime: input.runtime,
                  })
                : null;
              const deviceSyncNextWakeAt = deviceSyncPostCheckpoint?.nextWakeAt ?? null;
              if (
                deliveryEffects.length === 0
                && !providerCleanupDue
                && !terminalLinqCleanupDue
              ) {
                return {
                  checkpointReason: "maintenance",
                  nextWakeAt: deviceSyncNextWakeAt,
                  nextWakeReason: deviceSyncNextWakeAt ? "assistant" : null,
                  redactedStatus: {
                    hostedDeviceSyncDirtyAckRecorded: deviceSyncPostCheckpoint?.recorded ?? false,
                    hostedDeviceSyncDirtyStillPending: deviceSyncPostCheckpoint?.stillDirty ?? false,
                    nextWakeAt: deviceSyncNextWakeAt,
                  },
                };
              }
              return await drainHostedPostCheckpointDeliveryCleanup({
                assistantDeliveryEffects: deliveryEffects,
                baseNextWakeAt: resolveEarliestHostedWorkspaceWakeAt(
                  assistantMetrics.nextWakeAt,
                  deviceSyncNextWakeAt,
                ),
                checkpointReason: deliveryEffects.length > 0 ? "outbox_receipt" : "maintenance",
                input,
                providerCleanupCheckpoint,
                redactedStatus: deviceSyncPostCheckpoint
                  ? {
                      hostedDeviceSyncDirtyAckRecorded: deviceSyncPostCheckpoint.recorded,
                      hostedDeviceSyncDirtyStillPending: deviceSyncPostCheckpoint.stillDirty,
                    }
                  : null,
                wake,
              });
            },
          }
        : {}),
      checkpointReason: deliveryEffects.length > 0
        ? "outbox_sending"
        : "maintenance",
      ...(progressed || providerCleanupDue ? { nextWakeAt } : {}),
      progressed: progressed || providerCleanupDue,
      redactedStatus: buildHostedWorkspaceAssistantPhaseRedactedStatus({
        deliveryEffectCount: deliveryEffects.length,
        nextWakeAt,
        outboxTerminalizedSendingCount: 0,
        progressed: progressed || providerCleanupDue,
        systemMailboxPrepared: 0,
        systemMailboxRetryableFailed: 0,
      }),
    };
  } finally {
    typingAbortController.abort();
  }
}

type HostedAssistantDeliveryEffects = Awaited<
  ReturnType<typeof collectHostedAssistantDeliverySideEffects>
>;

async function drainHostedPostCheckpointDeliveryCleanup(input: {
  assistantDeliveryEffects: HostedAssistantDeliveryEffects;
  baseNextWakeAt: string | null;
  checkpointReason: HostedWorkspaceRunnerAssistantPhasePostCheckpoint["checkpointReason"];
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  providerCleanupCheckpoint: HostedProviderCleanupCheckpoint | null;
  redactedStatus: HostedRuntimeRedactedJson | null;
  wake: Parameters<typeof drainHostedCommittedAssistantDeliveriesAfterCommit>[0]["wake"];
}): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint> {
  const outcomes = input.assistantDeliveryEffects.length > 0
    ? await drainHostedCommittedAssistantDeliveriesAfterCommit({
        allowPreparedSending: true,
        assistantDeliveryEffects: input.assistantDeliveryEffects,
        assertLiveness: () => assertHostedAssistantPhaseRuntimeLiveness(input.input),
        effectsPort: input.input.platform.effectsPort,
        forwardedEnv: input.input.runtime.forwardedEnv,
        platformEnv: input.input.runtime.platformEnv,
        signal: input.input.signal ?? null,
        vaultRoot: input.input.restored.vaultRoot,
        wake: input.wake,
      })
    : [];
  const providerCleanup = await drainHostedProviderCleanupAfterCommit({
    assistantDeliveryOutcomes: outcomes,
    assertLiveness: () => assertHostedAssistantPhaseRuntimeLiveness(input.input),
    checkpoint: input.providerCleanupCheckpoint ?? {
      nextWakeAt: null,
    },
    effectsPort: input.input.runtime.platform.effectsPort,
    env: input.input.runtimeEnv,
    signal: input.input.signal ?? null,
    vaultRoot: input.input.restored.vaultRoot,
    wake: input.wake,
  });
  const postOutboxWakeAt = await resolveHostedAssistantOutboxNextWakeAt({
    vaultRoot: input.input.restored.vaultRoot,
  });
  const postSystemMailboxWakeAt = await resolveHostedSystemMailboxNextWakeAt({
    vaultRoot: input.input.restored.vaultRoot,
  });
  const postNextWakeAt = resolveEarliestHostedWorkspaceWakeAt(
    resolveEarliestHostedWorkspaceWakeAt(
      input.baseNextWakeAt,
      postOutboxWakeAt,
    ),
    resolveEarliestHostedWorkspaceWakeAt(
      postSystemMailboxWakeAt,
      providerCleanup.nextWakeAt,
    ),
  );
  if (input.assistantDeliveryEffects.length > 0) {
    await writeHostedOutboxDeliveryRuntimeLog({
      input: input.input,
      outcomes,
      postNextWakeAt,
    });
  }

  return {
    checkpointReason: input.checkpointReason,
    nextWakeAt: postNextWakeAt,
    nextWakeReason: postNextWakeAt ? "assistant" : null,
    redactedStatus: {
      hostedOutboxDeliveryAttempted: outcomes.length,
      hostedOutboxDeliverySent: outcomes.filter((outcome) =>
        outcome.deliveryStatus === "sent"
      ).length,
      ...buildHostedProviderCleanupRedactedStatus(providerCleanup),
      ...(input.redactedStatus ?? {}),
      nextWakeAt: postNextWakeAt,
    },
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

async function assertHostedAssistantPhaseRuntimeLiveness(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): Promise<void> {
  assertHostedAssistantPhaseLiveness(input.signal);
  const port = input.runtime.platform.runtimeLivenessPort ?? null;
  if (!port) {
    return;
  }

  const result = await port.touch({
    requestId: `hosted-workspace-invocation:${input.request.attemptId}:post-checkpoint`,
    signal: input.signal ?? undefined,
  });
  if (!result.ok) {
    throw new Error(`Hosted workspace runtime liveness proof was rejected: ${result.reason}.`);
  }
  assertHostedAssistantPhaseLiveness(input.signal);
}

function isHostedProviderCleanupCheckpointDue(
  checkpoint: HostedProviderCleanupCheckpoint | null,
): boolean {
  if (!checkpoint) {
    return false;
  }

  if (!checkpoint.nextWakeAt) {
    return true;
  }

  const timestamp = Date.parse(checkpoint.nextWakeAt);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
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
        deliveryEffectCount: input.deliveryEffectCount,
        deviceSyncProcessed: input.assistantMetrics.deviceSyncProcessed,
        deviceSyncSkipped: input.assistantMetrics.deviceSyncSkipped,
        deviceSyncDirtyAckPending: (input.assistantMetrics.postCheckpointRecord ?? null) !== null,
        nextWakeAtPresent: input.nextWakeAt !== null,
        parserProcessed: input.assistantMetrics.parserProcessed,
        progressed: input.progressed,
        systemWakeAtPresent: input.systemMailboxWakeAt !== null,
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
        failed,
        nextWakeAtPresent: input.postNextWakeAt !== null,
        retryable,
        sent,
      },
    },
    platform: input.input.platform,
  });
}

function consumedScheduledWorkspaceWake(input: HostedWorkspaceRuntimeAssistantPhaseInput): boolean {
  if (input.request.reason !== "alarm" || !input.workspace?.nextWakeAt) {
    return false;
  }

  const wakeTime = Date.parse(input.workspace.nextWakeAt);
  return Number.isFinite(wakeTime) && wakeTime <= Date.now();
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
    || metrics.deviceSyncProcessed > 0
    || metrics.nextWakeAt !== null
    || metrics.parserProcessed > 0
    || (metrics.postCheckpointRecord ?? null) !== null
  );
}

function resolveEarliestHostedWorkspaceWakeAt(
  left: string | null,
  right: string | null,
): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left < right ? left : right;
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

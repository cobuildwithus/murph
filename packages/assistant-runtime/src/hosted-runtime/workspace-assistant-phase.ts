import {
  buildHostedExecutionRuntimeTimerWake,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";
import type {
  AssistantExecutionContext,
} from "@murphai/assistant-engine";
import {
  listConfiguredDeviceSyncProviderNames,
} from "@murphai/device-syncd/config";
import {
  formatDeviceSyncProviderLabel,
} from "@murphai/device-syncd/provider-label";

import {
  collectHostedAssistantDeliverySideEffects,
  drainHostedCommittedAssistantDeliveriesAfterCommit,
  prepareHostedAssistantDeliverySideEffectsForCheckpoint,
  resolveHostedAssistantOutboxNextWakeAt,
} from "./callbacks.ts";
import {
  createHostedAssistantChannelTypingDependencies,
} from "./channel-typing.ts";
import {
  runHostedAssistantRuntimeTimerLane,
} from "./maintenance.ts";
import {
  prepareHostedSystemMailboxItemForCheckpoint,
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
  HostedWorkspaceRunnerAssistantPhaseResult,
} from "./workspace-runner.ts";

export interface HostedWorkspaceRuntimeAssistantPhaseInput
  extends HostedWorkspaceRunnerAssistantPhaseInput {
  request: HostedAssistantWorkspaceRuntimeJobInput["request"];
  restored: HostedRestoredExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
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
  const executionContext: AssistantExecutionContext = {
    hosted: {
      channelTypingDependencies: createHostedAssistantChannelTypingDependencies({
        forwardedEnv: input.runtime.forwardedEnv,
        platformEnv: input.runtime.platformEnv,
        runtimeEnv: input.runtimeEnv,
        signal: typingAbortController.signal,
      }),
      deviceConnectProviders: resolveHostedWorkspaceDeviceConnectProviders(input.runtime),
      memberId: input.request.userId,
      userEnvKeys: Object.keys(input.runtime.userEnv),
    },
  };

  try {
    const systemMailboxPreparation = await prepareHostedSystemMailboxItemForCheckpoint({
      runtime: input.runtime,
      runtimeEnv: input.runtimeEnv,
      vaultRoot: input.restored.vaultRoot,
    });
    if (systemMailboxPreparation) {
      const systemMailboxWakeAt = systemMailboxPreparation.status === "retryable_failed"
        ? systemMailboxPreparation.nextWakeAt
        : await resolveHostedSystemMailboxNextWakeAt({
            vaultRoot: input.restored.vaultRoot,
          });
      await writeHostedSystemMailboxRuntimeLog({
        input,
        nextWakeAt: systemMailboxWakeAt,
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
        ...(systemMailboxPreparation.status === "processed"
            || systemMailboxPreparation.status === "recording"
          ? {
              afterCheckpoint: async () => {
                const statusCallback = await recordHostedSystemMailboxItemAfterCheckpoint({
                  item: systemMailboxPreparation.item,
                  runtime: input.runtime,
                  vaultRoot: input.restored.vaultRoot,
                });
                await writeHostedSystemMailboxRuntimeLog({
                  attemptCount: systemMailboxPreparation.item.attemptCount,
                  input,
                  nextWakeAt: statusCallback.nextWakeAt,
                  recorded: statusCallback.recorded,
                  recordFailed: statusCallback.failed,
                  routeAction: systemMailboxPreparation.item.routeAction,
                  status: "recorded",
                  wakeKind: systemMailboxPreparation.item.wake.kind,
                });
                return {
                  checkpointReason: "system_mailbox_receipt",
                  nextWakeAt: statusCallback.nextWakeAt,
                  nextWakeReason: statusCallback.nextWakeAt ? "assistant" : null,
                  redactedStatus: {
                    hostedSystemMailboxRecordFailed: statusCallback.failed,
                    hostedSystemMailboxRecorded: statusCallback.recorded,
                  },
                };
              },
            }
          : {}),
        checkpointReason: systemMailboxPreparation.status === "processed"
            || systemMailboxPreparation.status === "recording"
          ? "system_mailbox_receipt"
          : "maintenance",
        ...(systemMailboxWakeAt ? { nextWakeAt: systemMailboxWakeAt } : {}),
        progressed: true,
        redactedStatus: buildHostedWorkspaceAssistantPhaseRedactedStatus({
          deliveryEffectCount: 0,
          nextWakeAt: systemMailboxWakeAt,
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
        forwardedEnv: input.runtime.forwardedEnv,
        platform: input.platform,
        platformEnv: input.runtime.platformEnv,
      },
      vaultRoot: input.restored.vaultRoot,
      wake,
    });
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
      || consumedScheduledWorkspaceWake(input);
    await writeHostedAssistantPassRuntimeLog({
      assistantMetrics,
      deliveryEffectCount: deliveryEffects.length,
      input,
      nextWakeAt,
      progressed,
      systemMailboxWakeAt,
    });

    return {
      ...(deliveryEffects.length > 0
        ? {
            afterCheckpoint: async () => {
              const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
                allowPreparedSending: true,
                assistantDeliveryEffects: deliveryEffects,
                effectsPort: input.platform.effectsPort,
                forwardedEnv: input.runtime.forwardedEnv,
                platformEnv: input.runtime.platformEnv,
                vaultRoot: input.restored.vaultRoot,
                wake,
              });
              const postOutboxWakeAt = await resolveHostedAssistantOutboxNextWakeAt({
                vaultRoot: input.restored.vaultRoot,
              });
              const postSystemMailboxWakeAt = await resolveHostedSystemMailboxNextWakeAt({
                vaultRoot: input.restored.vaultRoot,
              });
              const postNextWakeAt = resolveEarliestHostedWorkspaceWakeAt(
                resolveEarliestHostedWorkspaceWakeAt(
                  assistantMetrics.nextWakeAt,
                  postOutboxWakeAt,
                ),
                postSystemMailboxWakeAt,
              );
              await writeHostedOutboxDeliveryRuntimeLog({
                input,
                outcomes,
                postNextWakeAt,
              });
              return {
                checkpointReason: "outbox_receipt",
                nextWakeAt: postNextWakeAt,
                nextWakeReason: postNextWakeAt ? "assistant" : null,
                redactedStatus: {
                  hostedOutboxDeliveryAttempted: outcomes.length,
                  hostedOutboxDeliverySent: outcomes.filter((outcome) =>
                    outcome.deliveryStatus === "sent"
                  ).length,
                  nextWakeAt: postNextWakeAt,
                },
              };
            },
          }
        : {}),
      checkpointReason: deliveryEffects.length > 0
        ? "outbox_sending"
        : "maintenance",
      ...(progressed ? { nextWakeAt } : {}),
      progressed,
      redactedStatus: buildHostedWorkspaceAssistantPhaseRedactedStatus({
        deliveryEffectCount: deliveryEffects.length,
        nextWakeAt,
        outboxTerminalizedSendingCount: 0,
        progressed,
        systemMailboxPrepared: 0,
        systemMailboxRetryableFailed: 0,
      }),
    };
  } finally {
    typingAbortController.abort();
  }
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
        nextWakeAtPresent: input.nextWakeAt !== null,
        parserProcessed: input.assistantMetrics.parserProcessed,
        progressed: input.progressed,
        systemWakeAtPresent: input.systemMailboxWakeAt !== null,
      },
    },
    platform: input.input.platform,
  });
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

  return listConfiguredDeviceSyncProviderNames(providerConfigs).map((provider) => ({
    label: formatDeviceSyncProviderLabel(provider),
    provider,
  }));
}

function assistantMetricsProgressed(
  metrics: Awaited<ReturnType<typeof runHostedAssistantRuntimeTimerLane>>,
  deliveryEffectCount: number,
): boolean {
  return (
    deliveryEffectCount > 0
    || metrics.nextWakeAt !== null
    || metrics.parserProcessed > 0
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

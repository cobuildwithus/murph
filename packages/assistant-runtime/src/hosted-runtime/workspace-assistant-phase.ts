import {
  buildHostedExecutionRuntimeTimerWake,
  type HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution";
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
} from "./callbacks.ts";
import {
  createHostedAssistantChannelTypingDependencies,
} from "./channel-typing.ts";
import {
  runHostedAssistantRuntimeTimerLane,
} from "./maintenance.ts";
import type {
  HostedAssistantWorkspaceRuntimeJobInput,
  HostedRestoredExecutionContext,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
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
    "forwardedEnv" | "platformEnv" | "resolvedConfig" | "userEnv"
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
    eventId: `hosted-workspace-run:${input.request.attemptId}:assistant`,
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
    const assistantMetrics = await runHostedAssistantRuntimeTimerLane({
      executionContext,
      requestId: `hosted-workspace-run:${input.request.attemptId}:assistant`,
      runtime: {
        forwardedEnv: input.runtime.forwardedEnv,
        platform: input.platform,
        platformEnv: input.runtime.platformEnv,
      },
      vaultRoot: input.restored.vaultRoot,
      wake,
    });
    const deliveryEffects = await collectHostedAssistantDeliverySideEffects(
      input.restored.vaultRoot,
    );
    const progressed = assistantMetricsProgressed(assistantMetrics, deliveryEffects.length)
      || consumedScheduledWorkspaceWake(input);

    return {
      ...(deliveryEffects.length > 0
        ? {
            afterCheckpoint: async () => {
              const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
                assistantDeliveryEffects: deliveryEffects,
                effectsPort: input.platform.effectsPort,
                forwardedEnv: input.runtime.forwardedEnv,
                platformEnv: input.runtime.platformEnv,
                vaultRoot: input.restored.vaultRoot,
                wake,
              });
              return {
                checkpointReason: "outbox_receipt",
                nextWakeAt: assistantMetrics.nextWakeAt,
                nextWakeReason: assistantMetrics.nextWakeAt ? "assistant" : null,
                redactedStatus: {
                  hostedOutboxDeliveryAttempted: outcomes.length,
                  hostedOutboxDeliverySent: outcomes.filter((outcome) =>
                    outcome.deliveryStatus === "sent"
                  ).length,
                },
              };
            },
          }
        : {}),
      checkpointReason: deliveryEffects.length > 0 ? "outbox_intent" : "maintenance",
      ...(progressed ? { nextWakeAt: assistantMetrics.nextWakeAt } : {}),
      progressed,
      redactedStatus: buildHostedWorkspaceAssistantPhaseRedactedStatus({
        deliveryEffectCount: deliveryEffects.length,
        nextWakeAt: assistantMetrics.nextWakeAt,
        progressed,
      }),
    };
  } finally {
    typingAbortController.abort();
  }
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

function buildHostedWorkspaceAssistantPhaseRedactedStatus(input: {
  deliveryEffectCount: number;
  nextWakeAt: string | null;
  progressed: boolean;
}): HostedRuntimeRedactedJson {
  return {
    hostedAssistantNextWakeAt: input.nextWakeAt,
    hostedAssistantProgressed: input.progressed,
    hostedOutboxPendingDeliveryEffects: input.deliveryEffectCount,
  };
}

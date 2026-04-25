import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  decodeHostedBundleBase64,
  restoreHostedExecutionContext,
} from "@murphai/runtime-state/node";
import {
  listConfiguredDeviceSyncProviderNames,
} from "@murphai/device-syncd/config";
import {
  formatDeviceSyncProviderLabel,
} from "@murphai/device-syncd/provider-label";
import type {
  HostedExecutionRunnerResult,
  HostedExecutionStructuredLogDetails,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HostedAssistantConfigurationError,
} from "@murphai/operator-config/hosted-assistant-config";
import type { AssistantExecutionContext } from "@murphai/assistant-engine";

import {
  createHostedArtifactMaterializer,
  createHostedArtifactResolver,
} from "./hosted-runtime/artifacts.ts";
import {
  normalizeHostedAssistantRuntimeConfig,
  withHostedProcessEnvironment,
} from "./hosted-runtime/environment.ts";
import {
  resolveHostedVercelAiGatewayStripeCustomerId,
} from "./hosted-runtime/billing.ts";
import {
  completeHostedRunDrainAfterCommit,
  executeHostedRunDrainForCommit,
} from "./hosted-runtime/execution.ts";
import {
  createHostedAssistantChannelTypingDependencies,
} from "./hosted-runtime/channel-typing.ts";
import type {
  HostedAssistantRuntimeJobResult,
  HostedAssistantRuntimeJobInput,
} from "./hosted-runtime/models.ts";
import type {
  HostedRuntimeDeviceSyncMessagingReturnTarget,
  HostedRuntimePlatform,
} from "./hosted-runtime/platform.ts";
import {
  classifyHostedRuntimeEnvCategories,
  computeHostedRunElapsedMs,
  HOSTED_RUNTIME_FORWARDED_ENV_CATEGORY_KEYS,
  HOSTED_RUNTIME_USER_ENV_CATEGORY_KEYS,
  resolveHostedWake,
} from "./hosted-runtime/utils.ts";
export {
  formatHostedRuntimeChildResult,
  parseHostedRuntimeChildResult,
} from "./hosted-runtime/child-result.ts";
export {
  resolveHostedVercelAiGatewayStripeCustomerId,
} from "./hosted-runtime/billing.ts";

export type {
  HostedAssistantRuntimeChannelCapabilities,
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeCompletedJobResult,
  HostedAssistantRuntimePreparedJobResult,
  HostedAssistantRuntimeDeviceSyncConfig,
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobResult,
  HostedAssistantRuntimeJobRequest,
  HostedAssistantRuntimeManagedAutoReplyChannel,
  HostedAssistantRuntimeResolvedConfig,
} from "./hosted-runtime/models.ts";
export type {
  HostedRuntimeArtifactStore,
  HostedRuntimeDeviceSyncPort,
  HostedRuntimeEffectsPort,
  HostedRuntimePlatform,
  HostedRuntimeTurnInputPort,
  HostedRuntimeUsageRecordResponse,
  HostedRuntimeUsageExportPort,
} from "./hosted-runtime/platform.ts";
export {
  sanitizeHostedAssistantRuntimeForwardedEnv,
} from "./hosted-runtime/environment.ts";
export {
  parseHostedRuntimeBillingStripeCustomerResponse,
  parseHostedRuntimeUsageRecordResponse,
} from "./hosted-runtime/platform.ts";
export {
  HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY_ENV,
  HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV,
} from "./hosted-runtime/platform.ts";
export {
  computeHostedRunElapsedMs,
} from "./hosted-runtime/utils.ts";
export {
  createHostedAssistantChannelTypingDependencies,
} from "./hosted-runtime/channel-typing.ts";
export {
  readHostedRunnerCommitTimeoutMs,
} from "./hosted-runtime/timeouts.ts";
export {
  parseHostedAssistantRuntimeConfig,
  parseHostedAssistantRuntimeJobInput,
  parseHostedAssistantRuntimeJobRequest,
} from "./hosted-runtime/parsers.ts";

export async function runHostedAssistantRuntimeJobInProcess(
  input: HostedAssistantRuntimeJobInput,
  options: {
    platform: HostedRuntimePlatform;
  },
): Promise<HostedExecutionRunnerResult> {
  return (await runHostedAssistantRuntimeJobInProcessDetailed(input, options)).result;
}

export async function runHostedAssistantRuntimeJobInProcessDetailed(
  input: HostedAssistantRuntimeJobInput,
  options: {
    platform: HostedRuntimePlatform;
  },
): Promise<HostedAssistantRuntimeJobResult> {
  let workspaceRoot: string | null = null;
  let wakeForLog: HostedRuntimeEvent | null = null;

  try {
    const { runDrain } = input.request;
    if (runDrain === undefined || runDrain === null) {
      throw new TypeError("Hosted assistant runtime job request.runDrain is required.");
    }
    const wake = resolveHostedWake(runDrain);
    wakeForLog = wake;
    const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime, options.platform);
    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: buildHostedRuntimeStartDetails(input, runtime),
      wake,
      message: "Hosted runtime starting.",
      phase: "runtime.starting",
      run: input.request.run ?? null,
    });
    const nextWorkspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-"));
    workspaceRoot = nextWorkspaceRoot;
    const incomingBundle = decodeHostedBundleBase64(input.request.bundle);
    const artifactResolver = createHostedArtifactResolver({
      artifactStore: runtime.platform.artifactStore,
    });
    const materializedArtifactPaths = new Set<string>();
    const restoreStartedAtMs = Date.now();
    const restored = await restoreHostedExecutionContext({
      artifactResolver,
      bundle: incomingBundle,
      shouldRestoreArtifact: () => false,
      workspaceRoot: nextWorkspaceRoot,
    });
    const runtimeEnv = {
      ...runtime.forwardedEnv,
      ...runtime.userEnv,
    };
    emitHostedExecutionStructuredLog({
      component: "runtime",
      wake,
      details: {
        bundlePresent: incomingBundle !== null,
        restoreLatencyMs: Date.now() - restoreStartedAtMs,
        runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
      },
      message: "Hosted runtime restored execution context.",
      phase: "runtime.starting",
      run: input.request.run ?? null,
    });

    return await withHostedProcessEnvironment(
      {
        envOverrides: runtimeEnv,
        operatorHomeRoot: restored.operatorHomeRoot,
        vaultRoot: restored.vaultRoot,
      },
      async () => {
        if (runDrain.resumeFinalize) {
          const finalResult = await completeHostedRunDrainAfterCommit({
            materializedArtifactPaths,
            run: input.request.run ?? null,
            runtime,
            restored,
            request: input.request,
            wake,
          });

          emitHostedExecutionStructuredLog({
            component: "runtime",
            wake,
            details: {
              runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
            },
            message: "Hosted runtime completed run-drain finalization.",
            phase: "completed",
            run: input.request.run ?? null,
          });

          return finalResult;
        }

        const stripeCustomerId = await resolveHostedVercelAiGatewayStripeCustomerId({
          billingPort: runtime.platform.billingPort ?? null,
          forwardedEnv: runtime.forwardedEnv,
          run: input.request.run ?? null,
          userEnv: runtime.userEnv,
          wake,
        });
        const deviceConnectProviders = resolveHostedDeviceConnectProviders(runtime);
        const typingAbortController = new AbortController();
        const executionContext: AssistantExecutionContext = {
          hosted: {
            channelTypingDependencies: createHostedAssistantChannelTypingDependencies({
              forwardedEnv: runtime.forwardedEnv,
              platformEnv: runtime.platformEnv,
              runtimeEnv,
              signal: typingAbortController.signal,
            }),
            deviceConnectProviders,
            issueDeviceConnectLink: createHostedDeviceConnectLinkIssuer({
              messagingReturnTarget: resolveHostedDeviceConnectMessagingReturnTarget(wake),
              platform: runtime.platform,
              supportedProviders: deviceConnectProviders.map((entry) => entry.provider),
            }),
            memberId: wake.userId,
            stripeCustomerId,
            userEnvKeys: Object.keys(runtime.userEnv),
          },
        };
        try {
          const committedExecution = await executeHostedRunDrainForCommit({
            artifactMaterializer: incomingBundle
              ? createHostedArtifactMaterializer({
                  artifactResolver,
                  bundle: incomingBundle,
                  materializedArtifactPaths,
                  workspaceRoot: nextWorkspaceRoot,
                })
              : null,
            materializedArtifactPaths,
            request: input.request,
            restored,
            runtime,
            executionContext,
            runtimeEnv,
          });

          return {
            committedAssistantDeliveryEffects:
              committedExecution.committedAssistantDeliveryEffects,
            committedGatewayProjectionSnapshot:
              committedExecution.committedGatewayProjectionSnapshot ?? null,
            phase: "prepared",
            result: committedExecution.committedResult,
          };
        } finally {
          typingAbortController.abort();
        }
      },
    );
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      error,
      message: "Hosted runtime failed.",
      phase: "failed",
      run: input.request.run ?? null,
      wake: wakeForLog,
    });
    throw error;
  } finally {
    if (workspaceRoot) {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  }
}

function createHostedDeviceConnectLinkIssuer(input: {
  messagingReturnTarget: HostedRuntimeDeviceSyncMessagingReturnTarget | null;
  platform: HostedRuntimePlatform;
  supportedProviders: readonly string[];
}) {
  const supportedProviders = new Set(input.supportedProviders);

  return async ({ provider }: { provider: string }) => {
    const client = input.platform.deviceSyncPort ?? null;

    if (!client) {
      throw new HostedAssistantConfigurationError(
        "HOSTED_ASSISTANT_CONFIG_INVALID",
        "Hosted device connect links are unavailable because the device-sync control plane is not configured.",
      );
    }

    const normalizedProvider = provider.trim().toLowerCase();
    if (!supportedProviders.has(normalizedProvider)) {
      throw new HostedAssistantConfigurationError(
        "HOSTED_ASSISTANT_CONFIG_INVALID",
        "Hosted device connect links are unavailable for that provider because it is not configured in this hosted environment.",
      );
    }

    return client.createConnectLink({
      ...(input.messagingReturnTarget
        ? { messagingReturnTarget: input.messagingReturnTarget }
        : {}),
      provider: normalizedProvider,
    });
  };
}

function resolveHostedDeviceConnectMessagingReturnTarget(
  wake: HostedRuntimeEvent,
): HostedRuntimeDeviceSyncMessagingReturnTarget | null {
  if (wake.kind !== "conversation.message") {
    return null;
  }

  if (wake.message.channel === "linq") {
    return "imessage";
  }

  if (wake.message.channel === "telegram") {
    return "telegram";
  }

  return null;
}

function resolveHostedDeviceConnectProviders(
  runtime: ReturnType<typeof normalizeHostedAssistantRuntimeConfig>,
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

function buildHostedRuntimeStartDetails(
  input: HostedAssistantRuntimeJobInput,
  runtime: ReturnType<typeof normalizeHostedAssistantRuntimeConfig>,
): HostedExecutionStructuredLogDetails {
  return {
    channelCapabilities: {
      emailSendReady: runtime.resolvedConfig.channelCapabilities.emailSendReady,
      telegramBotConfigured: runtime.resolvedConfig.channelCapabilities.telegramBotConfigured,
    },
    currentBundleRefPresent: input.request.currentBundleRef !== undefined,
    commitTimeoutMs: runtime.commitTimeoutMs,
    deviceSync: {
      configured: runtime.resolvedConfig.deviceSync !== null,
      controlPortBound: Boolean(runtime.platform.deviceSyncPort),
      providerNames: runtime.resolvedConfig.deviceSync
        ? listConfiguredDeviceSyncProviderNames(runtime.resolvedConfig.deviceSync.providerConfigs)
        : [],
      publicBaseUrlConfigured: Boolean(runtime.resolvedConfig.deviceSync?.publicBaseUrl),
      secretConfigured: Boolean(runtime.resolvedConfig.deviceSync?.secret),
    },
    forwardedEnvCategories: classifyHostedRuntimeEnvCategories(
      runtime.forwardedEnv,
      HOSTED_RUNTIME_FORWARDED_ENV_CATEGORY_KEYS,
    ),
    forwardedEnvKeyCount: Object.keys(runtime.forwardedEnv).length,
    platformBindings: {
      artifactStoreBound: Boolean(runtime.platform.artifactStore),
      billingPortBound: Boolean(runtime.platform.billingPort),
      effectsPortBound: Boolean(runtime.platform.effectsPort),
      issueExportBound: Boolean(runtime.platform.issueExportPort),
      usageExportBound: Boolean(runtime.platform.usageExportPort),
    },
    runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
    userEnvCategories: classifyHostedRuntimeEnvCategories(
      runtime.userEnv,
      HOSTED_RUNTIME_USER_ENV_CATEGORY_KEYS,
    ),
    userEnvKeyCount: Object.keys(runtime.userEnv).length,
  };
}

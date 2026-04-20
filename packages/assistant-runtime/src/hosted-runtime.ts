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
import type {
  HostedExecutionRunnerResult,
  HostedExecutionStructuredLogDetails,
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
  completeHostedRunDrainAfterCommit,
  executeHostedRunDrainForCommit,
  executeHostedWakeForCommit,
} from "./hosted-runtime/execution.ts";
import {
  startHostedWakeTypingIndicator,
  stopHostedWakeTypingIndicator,
} from "./hosted-runtime/typing.ts";
import type {
  HostedAssistantRuntimeJobResult,
  HostedAssistantRuntimeJobInput,
} from "./hosted-runtime/models.ts";
import type {
  HostedRuntimePlatform,
} from "./hosted-runtime/platform.ts";
import {
  resolveHostedWake,
} from "./hosted-runtime/utils.ts";
export {
  formatHostedRuntimeChildResult,
  parseHostedRuntimeChildResult,
} from "./hosted-runtime/child-result.ts";

export type {
  HostedAssistantRuntimeChannelCapabilities,
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeCompletedJobResult,
  HostedAssistantRuntimeCommittedJobResult,
  HostedAssistantRuntimeDeviceSyncConfig,
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobResult,
  HostedAssistantRuntimeJobRequest,
  HostedAssistantRuntimeResolvedConfig,
} from "./hosted-runtime/models.ts";
export type {
  HostedRuntimeArtifactStore,
  HostedRuntimeDeviceSyncPort,
  HostedRuntimeEffectsPort,
  HostedRuntimePlatform,
  HostedRuntimeUsageRecordResponse,
  HostedRuntimeUsageExportPort,
} from "./hosted-runtime/platform.ts";
export {
  createHostedRuntimeChildLauncherDirectories,
  createHostedRuntimeChildProcessEnv,
  resolveHostedRuntimeTsconfigPath,
  resolveHostedRuntimeTsxImportSpecifier,
} from "./hosted-runtime/environment.ts";
export {
  parseHostedRuntimeUsageRecordResponse,
} from "./hosted-runtime/platform.ts";
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

  try {
    const wake = resolveHostedWake(input.request);
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
    const executionContext: AssistantExecutionContext = {
      hosted: {
        issueDeviceConnectLink: createHostedDeviceConnectLinkIssuer({
          boundUserId: wake.userId,
          platform: runtime.platform,
        }),
        memberId: wake.userId,
        userEnvKeys: Object.keys(runtime.userEnv),
      },
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
        const typingIndicator = startHostedWakeTypingIndicator({
          wake,
          runtimeEnv,
          run: input.request.run ?? null,
        });

        try {
          if (input.request.runDrain?.resumeFinalize) {
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

          const committedExecution = input.request.runDrain
            ? await executeHostedRunDrainForCommit({
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
              })
            : await executeHostedWakeForCommit({
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
            phase: "committed",
            result: committedExecution.committedResult,
          };
        } finally {
          await stopHostedWakeTypingIndicator({
            wake,
            typingIndicator,
            run: input.request.run ?? null,
          });
        }
      },
    );
  } catch (error) {
    const wake = resolveHostedWake(input.request);
    emitHostedExecutionStructuredLog({
      component: "runtime",
      wake,
      error,
      message: "Hosted runtime failed.",
      phase: "failed",
      run: input.request.run ?? null,
    });
    throw error;
  } finally {
    if (workspaceRoot) {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  }
}

function createHostedDeviceConnectLinkIssuer(input: {
  boundUserId: string;
  platform: HostedRuntimePlatform;
}) {
  return async ({ provider }: { provider: string }) => {
    const client = input.platform.deviceSyncPort ?? null;

    if (!client) {
      throw new HostedAssistantConfigurationError(
        "HOSTED_ASSISTANT_CONFIG_INVALID",
        "Hosted device connect links are unavailable because the device-sync control plane is not configured.",
      );
    }

    return client.createConnectLink({
      provider,
    });
  };
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
    forwardedEnvCategories: {
      assistantConfigured: hasAnyHostedRuntimeConfigKey(runtime.forwardedEnv, [
        "ANTHROPIC_API_KEY",
        "CEREBRAS_API_KEY",
        "DEEPSEEK_API_KEY",
        "FIREWORKS_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_GENERATIVE_AI_API_KEY",
        "GROQ_API_KEY",
        "MISTRAL_API_KEY",
        "OPENAI_API_KEY",
        "OPENROUTER_API_KEY",
        "PERPLEXITY_API_KEY",
        "TOGETHER_API_KEY",
        "VERCEL_AI_API_KEY",
        "VENICE_API_KEY",
        "XAI_API_KEY",
      ]),
      hostedEmailConfigured: hasAnyHostedRuntimeConfigKey(runtime.forwardedEnv, [
        "HOSTED_EMAIL_DOMAIN",
        "HOSTED_EMAIL_FROM_ADDRESS",
        "HOSTED_EMAIL_LOCAL_PART",
      ]),
      linqConfigured: hasAnyHostedRuntimeConfigKey(runtime.forwardedEnv, [
        "LINQ_API_BASE_URL",
        "LINQ_API_TOKEN",
        "LINQ_WEBHOOK_SECRET",
      ]),
      parserToolingConfigured: hasAnyHostedRuntimeConfigKey(runtime.forwardedEnv, [
        "FFMPEG_COMMAND",
        "WHISPER_COMMAND",
        "WHISPER_MODEL_PATH",
      ]),
      telegramConfigured: hasAnyHostedRuntimeConfigKey(runtime.forwardedEnv, [
        "TELEGRAM_API_BASE_URL",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_BOT_USERNAME",
        "TELEGRAM_FILE_BASE_URL",
      ]),
      webSearchConfigured: hasAnyHostedRuntimeConfigKey(runtime.forwardedEnv, [
        "BRAVE_API_KEY",
        "MURPH_WEB_FETCH_ENABLED",
        "MURPH_WEB_SEARCH_MAX_RESULTS",
        "MURPH_WEB_SEARCH_PROVIDER",
      ]),
    },
    forwardedEnvKeyCount: Object.keys(runtime.forwardedEnv).length,
      platformBindings: {
        artifactStoreBound: Boolean(runtime.platform.artifactStore),
        effectsPortBound: Boolean(runtime.platform.effectsPort),
        usageExportBound: Boolean(runtime.platform.usageExportPort),
      },
    runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
    sharePackAttached: Boolean(input.request.sharePack),
    userEnvCategories: {
      modelCredentialConfigured: hasAnyHostedRuntimeConfigKey(runtime.userEnv, [
        "ANTHROPIC_API_KEY",
        "BRAVE_API_KEY",
        "CEREBRAS_API_KEY",
        "DEEPSEEK_API_KEY",
        "FIREWORKS_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_GENERATIVE_AI_API_KEY",
        "GROQ_API_KEY",
        "HF_TOKEN",
        "HUGGINGFACEHUB_API_TOKEN",
        "HUGGINGFACE_API_KEY",
        "HUGGING_FACE_HUB_TOKEN",
        "LITELLM_PROXY_API_KEY",
        "MISTRAL_API_KEY",
        "NVIDIA_API_KEY",
        "NGC_API_KEY",
        "OPENAI_API_KEY",
        "OPENROUTER_API_KEY",
        "PERPLEXITY_API_KEY",
        "TOGETHER_API_KEY",
        "VERCEL_AI_API_KEY",
        "VENICE_API_KEY",
        "XAI_API_KEY",
      ]),
    },
    userEnvKeyCount: Object.keys(runtime.userEnv).length,
  };
}

function computeHostedRunElapsedMs(
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null,
): number | null {
  if (!run?.startedAt) {
    return null;
  }

  const startedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  return Math.max(0, Date.now() - startedAtMs);
}

function hasAnyHostedRuntimeConfigKey(
  source: Readonly<Record<string, string>>,
  keys: readonly string[],
): boolean {
  return keys.some((key) => typeof source[key] === "string" && source[key].length > 0);
}

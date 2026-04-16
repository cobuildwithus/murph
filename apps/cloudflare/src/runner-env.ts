import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeResolvedConfig,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { readHostedRunnerCommitTimeoutMs } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  cloneSerializableConfiguredDeviceSyncProviderConfigs,
  hasConfiguredDeviceSyncProviderConfigs,
  readConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/config";
import {
  readHostedEmailCapabilities,
} from "@murphai/hosted-execution/hosted-email";

import {
  buildHostedRunnerContainerEnv,
  filterHostedRunnerSecrets,
} from "./hosted-env-policy.ts";

export function buildHostedRunnerJobRuntime(input: {
  commitTimeoutMs?: number | null;
  configSource?: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Readonly<Record<string, string>>;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  runnerSecrets?: Readonly<Record<string, string>>;
}): HostedAssistantRuntimeConfig {
  const forwardedEnv = { ...input.forwardedEnv };

  return {
    commitTimeoutMs: readHostedRunnerCommitTimeoutMs(input.commitTimeoutMs ?? null),
    forwardedEnv,
    resolvedConfig:
      input.resolvedConfig
      ?? buildHostedRunnerResolvedConfig(input.configSource ?? forwardedEnv),
    userEnv: { ...(input.runnerSecrets ?? {}) },
  };
}

export {
  buildHostedRunnerContainerEnv,
  filterHostedRunnerSecrets,
} from "./hosted-env-policy.ts";

export function buildHostedRunnerJobRuntimeConfig(input: {
  configSource?: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Readonly<Record<string, string>>;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  runnerSecrets: Readonly<Record<string, string>>;
}): HostedAssistantRuntimeConfig {
  const configSource = input.configSource ?? input.forwardedEnv;

  return buildHostedRunnerJobRuntime({
    commitTimeoutMs: Number.parseInt(
      configSource.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS ?? "",
      10,
    ),
    configSource,
    forwardedEnv: input.forwardedEnv,
    resolvedConfig: input.resolvedConfig,
    runnerSecrets: filterHostedRunnerSecrets(input.runnerSecrets, configSource),
  });
}

export function buildHostedRunnerResolvedConfig(
  configSource: Readonly<Record<string, string | undefined>>,
): HostedAssistantRuntimeResolvedConfig {
  const providerConfigs = cloneSerializableConfiguredDeviceSyncProviderConfigs(
    readConfiguredDeviceSyncProviderConfigs(configSource),
  );
  const emailCapabilities = readHostedEmailCapabilities(configSource);
  const deviceSyncPublicBaseUrl = normalizeEnvString(configSource.DEVICE_SYNC_PUBLIC_BASE_URL);
  // This codec secret protects hosted device-sync token bundles inside the runner.
  // It is distinct from the local daemon's DEVICE_SYNC_CONTROL_TOKEN contract.
  const deviceSyncCodecSecret = normalizeEnvString(configSource.DEVICE_SYNC_SECRET);

  return {
    channelCapabilities: {
      emailSendReady: emailCapabilities.sendReady,
      telegramBotConfigured: normalizeEnvString(configSource.TELEGRAM_BOT_TOKEN) !== null,
    },
    deviceSync:
      deviceSyncPublicBaseUrl
      && deviceSyncCodecSecret
      && hasConfiguredDeviceSyncProviderConfigs(providerConfigs)
        ? {
            providerConfigs,
            publicBaseUrl: deviceSyncPublicBaseUrl,
            secret: deviceSyncCodecSecret,
          }
        : null,
  };
}

function normalizeEnvString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeResolvedConfig,
} from "@murphai/assistant-runtime";
import { readHostedRunnerCommitTimeoutMs } from "@murphai/assistant-runtime";
import {
  readConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/config";
import {
  readHostedEmailCapabilities,
} from "@murphai/hosted-execution";

import {
  buildHostedRunnerContainerEnv,
  filterHostedRunnerUserEnv,
} from "./hosted-env-policy.ts";

export {
  buildHostedRunnerContainerEnv,
  filterHostedRunnerUserEnv,
} from "./hosted-env-policy.ts";

export function buildHostedRunnerJobRuntimeConfig(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  runtimeConfigSource?: Readonly<Record<string, string | undefined>>;
  userEnvSource?: Readonly<Record<string, string | undefined>>;
  userEnv: Readonly<Record<string, string>>;
}): HostedAssistantRuntimeConfig {
  const forwardedEnv = { ...input.forwardedEnv };
  const runtimeConfigSource = input.runtimeConfigSource ?? forwardedEnv;
  const resolvedConfig = input.resolvedConfig ?? buildHostedRunnerResolvedConfig(forwardedEnv);

  return {
    commitTimeoutMs: readHostedRunnerCommitTimeoutMs(
      Number.parseInt(runtimeConfigSource.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS ?? "", 10),
    ),
    forwardedEnv,
    resolvedConfig,
    userEnv: filterHostedRunnerUserEnv(
      input.userEnv,
      input.userEnvSource ?? runtimeConfigSource,
    ),
  };
}

export function buildHostedRunnerResolvedConfig(
  forwardedEnv: Readonly<Record<string, string>>,
): HostedAssistantRuntimeResolvedConfig {
  const providerConfigs = readConfiguredDeviceSyncProviderConfigs(forwardedEnv);
  const emailCapabilities = readHostedEmailCapabilities(forwardedEnv);
  const deviceSyncPublicBaseUrl = normalizeEnvString(forwardedEnv.DEVICE_SYNC_PUBLIC_BASE_URL);
  const deviceSyncSecret = normalizeEnvString(forwardedEnv.DEVICE_SYNC_SECRET);

  return {
    channelCapabilities: {
      emailSendReady: emailCapabilities.sendReady,
      telegramBotConfigured: normalizeEnvString(forwardedEnv.TELEGRAM_BOT_TOKEN) !== null,
    },
    deviceSync:
      deviceSyncPublicBaseUrl
      && deviceSyncSecret
      && hasConfiguredDeviceSyncProviderConfigs(providerConfigs)
        ? {
            providerConfigs,
            publicBaseUrl: deviceSyncPublicBaseUrl,
            secret: deviceSyncSecret,
          }
        : null,
  };
}

function hasConfiguredDeviceSyncProviderConfigs(
  value: ReturnType<typeof readConfiguredDeviceSyncProviderConfigs>,
): boolean {
  return value.garmin !== undefined || value.oura !== undefined || value.whoop !== undefined;
}

function normalizeEnvString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

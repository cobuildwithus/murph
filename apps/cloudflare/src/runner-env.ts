import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeResolvedConfig,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { readHostedRunnerCommitTimeoutMs } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  readConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/config";
import {
  readHostedEmailCapabilities,
} from "@murphai/hosted-execution/hosted-email";

import {
  buildHostedRunnerContainerEnv,
  filterHostedRunnerUserEnv,
} from "./hosted-env-policy.ts";

export function buildHostedRunnerJobRuntime(input: {
  commitTimeoutMs?: number | null;
  forwardedEnv: Readonly<Record<string, string>>;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  userEnv?: Readonly<Record<string, string>>;
}): HostedAssistantRuntimeConfig {
  const forwardedEnv = { ...input.forwardedEnv };

  return {
    commitTimeoutMs: readHostedRunnerCommitTimeoutMs(input.commitTimeoutMs ?? null),
    forwardedEnv,
    resolvedConfig: input.resolvedConfig ?? buildHostedRunnerResolvedConfig(forwardedEnv),
    userEnv: { ...(input.userEnv ?? {}) },
  };
}

export {
  buildHostedRunnerContainerEnv,
  filterHostedRunnerUserEnv,
} from "./hosted-env-policy.ts";

export function buildHostedRunnerJobRuntimeConfig(input: {
  configSource?: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Readonly<Record<string, string>>;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  userEnv: Readonly<Record<string, string>>;
}): HostedAssistantRuntimeConfig {
  const configSource = input.configSource ?? input.forwardedEnv;

  return buildHostedRunnerJobRuntime({
    commitTimeoutMs: Number.parseInt(
      configSource.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS ?? "",
      10,
    ),
    forwardedEnv: input.forwardedEnv,
    resolvedConfig: input.resolvedConfig,
    userEnv: filterHostedRunnerUserEnv(
      input.userEnv,
      configSource,
    ),
  });
}

export function buildHostedRunnerResolvedConfig(
  forwardedEnv: Readonly<Record<string, string>>,
): HostedAssistantRuntimeResolvedConfig {
  const providerConfigs = readConfiguredDeviceSyncProviderConfigs(forwardedEnv);
  const emailCapabilities = readHostedEmailCapabilities(forwardedEnv);
  const deviceSyncPublicBaseUrl = normalizeEnvString(forwardedEnv.DEVICE_SYNC_PUBLIC_BASE_URL);
  // This codec secret protects hosted device-sync token bundles inside the runner.
  // It is distinct from the local daemon's DEVICE_SYNC_CONTROL_TOKEN contract.
  const deviceSyncCodecSecret = normalizeEnvString(forwardedEnv.DEVICE_SYNC_SECRET);

  return {
    channelCapabilities: {
      emailSendReady: emailCapabilities.sendReady,
      telegramBotConfigured: normalizeEnvString(forwardedEnv.TELEGRAM_BOT_TOKEN) !== null,
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

function hasConfiguredDeviceSyncProviderConfigs(
  value: ReturnType<typeof readConfiguredDeviceSyncProviderConfigs>,
): boolean {
  return value.garmin !== undefined || value.oura !== undefined || value.whoop !== undefined;
}

function normalizeEnvString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

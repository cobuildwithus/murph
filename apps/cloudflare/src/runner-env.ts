import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeResolvedConfig,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { readHostedRunnerCommitTimeoutMs } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  readConfiguredDeviceSyncRuntimeConfig,
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
  const emailCapabilities = readHostedEmailCapabilities(configSource);
  const deviceSync = readConfiguredDeviceSyncRuntimeConfig(configSource);

  return {
    channelCapabilities: {
      emailSendReady: emailCapabilities.sendReady,
      telegramBotConfigured: normalizeEnvString(configSource.TELEGRAM_BOT_TOKEN) !== null,
    },
    deviceSync,
  };
}

function normalizeEnvString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

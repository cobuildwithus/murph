import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeResolvedConfig,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { readHostedRunnerCommitTimeoutMs } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  readConfiguredDeviceSyncRuntimeConfig,
} from "@murphai/device-syncd/runtime-config";
import {
  readHostedEmailCapabilities,
} from "@murphai/hosted-execution/hosted-email";

import {
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerContainerEnv,
  filterHostedRunnerSecrets,
} from "./hosted-env-policy.ts";

const HOSTED_RUNNER_OPERATOR_ENV_KEYS = [
  "HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS",
  "HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  "HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID",
  "HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK",
  "HOSTED_EXECUTION_RETRY_DELAY_MS",
  "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
  "HOSTED_EXECUTION_RUNNER_ENV_PROFILES",
  "HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS",
  "HOSTED_EXECUTION_RUNNER_TIMEOUT_MS",
  "HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  "HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT",
  "HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL",
  "HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME",
  "HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG",
  "HOSTED_WAKE_ENCRYPTION_KEY",
  "HOSTED_WAKE_ENCRYPTION_KEYRING_JSON",
  "HOSTED_WAKE_ENCRYPTION_KEY_VERSION",
  "HOSTED_WEB_BASE_URL",
  "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID",
  "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
] as const;

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
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerContainerEnv,
  filterHostedRunnerSecrets,
} from "./hosted-env-policy.ts";

export function buildHostedRunnerOperatorEnv(
  source: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of HOSTED_RUNNER_OPERATOR_ENV_KEYS) {
    const value = source[key];

    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }

  return env;
}

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

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
  isHostedRunnerProcessControlEnvKey,
  rewriteHostedRunnerLoopbackUrlForContainer,
} from "./hosted-env-policy.ts";

export function buildHostedRunnerSupervisorEnv(input: {
  port: number;
}): Record<string, string> {
  return {
    PORT: String(input.port),
  };
}

const HOSTED_RUNNER_PLATFORM_ENV_KEYS = [
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_FILE_BASE_URL",
] as const;
const HOSTED_RUNNER_CHILD_SECRET_ENV_KEYS = [
  "HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS",
  "HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON",
  "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK",
  "HOSTED_EXECUTION_CONTROL_TOKEN",
  "HOSTED_EXECUTION_CONTROL_TOKENS",
  "HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON",
  "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID",
  "HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID",
  "HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK",
  "HOSTED_EXECUTION_RETRY_DELAY_MS",
  "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKENS",
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
  "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID",
  "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
] as const;
const HOSTED_RUNNER_CHILD_SECRET_ENV_KEY_SET = new Set<string>(
  HOSTED_RUNNER_CHILD_SECRET_ENV_KEYS,
);
const HOSTED_RUNNER_CHILD_FORBIDDEN_ENV_KEY_SET = new Set<string>([
  "HOME",
  "PATH",
  "PORT",
  "PWD",
  "VAULT",
]);

export function buildHostedRunnerJobRuntime(input: {
  commitTimeoutMs?: number | null;
  configSource?: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  runnerSecrets?: Readonly<Record<string, string>>;
}): HostedAssistantRuntimeConfig {
  const splitEnv = splitHostedRunnerRuntimeEnv({
    forwardedEnv: input.forwardedEnv,
    platformEnv: input.platformEnv,
  });
  const resolvedConfigSource = {
    ...(input.configSource ?? input.forwardedEnv),
    ...splitEnv.platformEnv,
  };

  return {
    commitTimeoutMs: readHostedRunnerCommitTimeoutMs(input.commitTimeoutMs ?? null),
    forwardedEnv: splitEnv.forwardedEnv,
    ...(Object.keys(splitEnv.platformEnv).length === 0
      ? {}
      : { platformEnv: splitEnv.platformEnv }),
    resolvedConfig:
      input.resolvedConfig
      ?? buildHostedRunnerResolvedConfig(resolvedConfigSource),
    userEnv: filterHostedRunnerSecrets(input.runnerSecrets ?? {}, resolvedConfigSource),
  };
}

export {
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerContainerEnv,
  filterHostedRunnerSecrets,
};

export function buildHostedRunnerChildRuntimeEnv(input: {
  ambientSource?: Readonly<Record<string, unknown>>;
  forwardedEnv?: Readonly<Record<string, string>>;
} = {}): Record<string, string> {
  if (input.forwardedEnv) {
    return splitHostedRunnerRuntimeEnv({
      forwardedEnv: input.forwardedEnv,
    }).forwardedEnv;
  }

  return splitHostedRunnerRuntimeEnv({
    forwardedEnv: buildHostedRunnerAmbientEnv(input.ambientSource ?? process.env),
  }).forwardedEnv;
}

export function buildHostedRunnerPlatformEnv(
  source: Readonly<Record<string, unknown>>,
  options: {
    rewriteLoopbackUrlsForContainer?: boolean;
  } = {},
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of HOSTED_RUNNER_PLATFORM_ENV_KEYS) {
    const value = normalizeEnvString(
      typeof source[key] === "string" ? source[key] : undefined,
    );
    if (value) {
      env[key] = options.rewriteLoopbackUrlsForContainer
        ? rewriteHostedRunnerLoopbackUrlForContainer(key, value, source)
        : value;
    }
  }

  return env;
}

export function buildHostedRunnerJobRuntimeConfig(input: {
  configSource?: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Readonly<Record<string, string>>;
  rewritePlatformUrlsForContainer?: boolean;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  runnerSecrets: Readonly<Record<string, string>>;
}): HostedAssistantRuntimeConfig {
  const configSource = input.configSource ?? input.forwardedEnv;
  const platformEnv = buildHostedRunnerPlatformEnv(configSource, {
    rewriteLoopbackUrlsForContainer: input.rewritePlatformUrlsForContainer === true,
  });

  return buildHostedRunnerJobRuntime({
    commitTimeoutMs: readHostedRunnerCommitTimeoutConfigValue(
      configSource.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS,
    ),
    configSource,
    forwardedEnv: input.forwardedEnv,
    platformEnv: Object.keys(platformEnv).length === 0 ? undefined : platformEnv,
    resolvedConfig: input.resolvedConfig,
    runnerSecrets: input.runnerSecrets,
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
    managedAutoReplyChannels: [
      {
        capabilityReady: emailCapabilities.sendReady,
        channel: "email",
        memberChannel: "email",
      },
      {
        capabilityReady: true,
        channel: "linq",
        memberChannel: "linq",
      },
      {
        capabilityReady: normalizeEnvString(configSource.TELEGRAM_BOT_TOKEN) !== null,
        channel: "telegram",
        memberChannel: "telegram",
      },
    ],
  };
}

function normalizeEnvString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readHostedRunnerCommitTimeoutConfigValue(value: string | undefined): number | null {
  const normalized = normalizeEnvString(value);
  if (normalized === null) {
    return null;
  }

  if (!/^[0-9]+$/u.test(normalized)) {
    return Number.NaN;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function splitHostedRunnerRuntimeEnv(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
}): {
  forwardedEnv: Record<string, string>;
  platformEnv: Record<string, string>;
} {
  const forwardedEnv = Object.fromEntries(
    Object.entries(input.forwardedEnv).filter(([key]) =>
      !HOSTED_RUNNER_CHILD_SECRET_ENV_KEY_SET.has(key)
      && !HOSTED_RUNNER_CHILD_FORBIDDEN_ENV_KEY_SET.has(key)
      && !isHostedRunnerProcessControlEnvKey(key)
    ),
  );
  const explicitPlatformEnv =
    input.platformEnv === undefined
      ? null
      : buildHostedRunnerPlatformEnv(input.platformEnv);
  const platformEnv = explicitPlatformEnv ? { ...explicitPlatformEnv } : {};

  for (const key of HOSTED_RUNNER_PLATFORM_ENV_KEYS) {
    const forwardedValue = normalizeEnvString(forwardedEnv[key]);

    if (explicitPlatformEnv === null && forwardedValue !== null) {
      platformEnv[key] = forwardedValue;
    }

    delete forwardedEnv[key];
  }

  return {
    forwardedEnv,
    platformEnv,
  };
}

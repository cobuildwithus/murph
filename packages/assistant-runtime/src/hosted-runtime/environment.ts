import { cloneConfiguredDeviceSyncRuntimeConfig } from "@murphai/device-syncd/runtime-config";

import {
  HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES,
  HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES,
} from "../hosted-env-categories.ts";

import type {
  HostedAssistantRuntimeManagedAutoReplyChannel,
  HostedAssistantRuntimeResolvedConfig,
  HostedAssistantRuntimeConfig,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  createDefaultHostedManagedAutoReplyChannels,
} from "./managed-auto-reply.ts";
import type {
  HostedRuntimePlatform,
} from "./platform.ts";

const HOSTED_RUNTIME_CONTROL_PLANE_ENV_NAMES = [
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
const HOSTED_RUNTIME_FORWARDED_ENV_DENYLIST = new Set<string>(
  [
    ...HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES,
    ...HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES,
    ...HOSTED_RUNTIME_CONTROL_PLANE_ENV_NAMES,
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "HOME",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "NODE_OPTIONS",
    "NODE_PATH",
    "PATH",
    "PORT",
    "PWD",
    "VAULT",
  ],
);
const HOSTED_RUNTIME_USER_ENV_DENYLIST = new Set<string>(
  [
    ...HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES,
    ...HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES,
    ...HOSTED_RUNTIME_CONTROL_PLANE_ENV_NAMES,
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "HOME",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "NODE_OPTIONS",
    "NODE_PATH",
    "PATH",
    "PORT",
    "PWD",
    "VAULT",
  ],
);
const HOSTED_RUNTIME_USER_ENV_DENYLIST_PREFIXES = [
  "HOSTED_EXECUTION_",
  "HOSTED_WAKE_",
  "HOSTED_WEB_CALLBACK_SIGNING_",
] as const;
let hostedProcessEnvironmentQueue: Promise<void> = Promise.resolve();

export function normalizeHostedAssistantRuntimeConfig(
  input: HostedAssistantRuntimeConfig | undefined,
  platform: HostedRuntimePlatform | null | undefined,
): NormalizedHostedAssistantRuntimeConfig {
  const forwardedEnv = sanitizeHostedAssistantRuntimeForwardedEnv(
    input?.forwardedEnv ?? {},
  );
  const platformEnv = sanitizeHostedAssistantRuntimePlatformEnv(input?.platformEnv ?? {});
  const userEnv = sanitizeHostedAssistantRuntimeUserEnv({
    forwardedEnv,
    userEnv: input?.userEnv ?? {},
  });
  const normalizedPlatform = platform ?? null;

  if (!normalizedPlatform) {
    throw new TypeError("Hosted assistant runtime platform must be injected.");
  }

  return {
    commitTimeoutMs: input?.commitTimeoutMs ?? null,
    forwardedEnv,
    platform: normalizedPlatform,
    platformEnv,
    resolvedConfig: cloneHostedAssistantRuntimeResolvedConfig(input?.resolvedConfig),
    userEnv,
  };
}

export function buildHostedPlatformBackedRuntimeEnv(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
}): Record<string, string> {
  return {
    ...sanitizeHostedAssistantRuntimeForwardedEnv(input.forwardedEnv),
    ...sanitizeHostedAssistantRuntimePlatformEnv(input.platformEnv ?? {}),
  };
}

export function sanitizeHostedAssistantRuntimeForwardedEnv(
  forwardedEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(forwardedEnv).filter(([key]) => !HOSTED_RUNTIME_FORWARDED_ENV_DENYLIST.has(key)),
  );
}

export function sanitizeHostedAssistantRuntimePlatformEnv(
  platformEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  const allowedKeys = new Set<string>(HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES);
  return Object.fromEntries(
    Object.entries(platformEnv).filter(([key]) => allowedKeys.has(key)),
  );
}

export function sanitizeHostedAssistantRuntimeUserEnv(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  userEnv: Readonly<Record<string, string>>;
}): Record<string, string> {
  const normalizedUserEnv = Object.fromEntries(
    Object.entries(input.userEnv).filter(([key]) =>
      !HOSTED_RUNTIME_USER_ENV_DENYLIST.has(key)
      && !HOSTED_RUNTIME_USER_ENV_DENYLIST_PREFIXES.some((prefix) => key.startsWith(prefix))
    ),
  );
  const configuredApiKeyEnv = normalizeHostedRuntimeString(
    input.forwardedEnv.HOSTED_ASSISTANT_API_KEY_ENV,
  );

  if (
    configuredApiKeyEnv &&
    normalizeHostedRuntimeString(normalizedUserEnv[configuredApiKeyEnv]) === null
  ) {
    delete normalizedUserEnv[configuredApiKeyEnv];
  }

  return normalizedUserEnv;
}

function normalizeHostedRuntimeString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function cloneHostedAssistantRuntimeResolvedConfig(
  input: HostedAssistantRuntimeResolvedConfig | undefined,
): HostedAssistantRuntimeResolvedConfig {
  const channelCapabilities = {
    emailSendReady: input?.channelCapabilities.emailSendReady ?? false,
    telegramBotConfigured: input?.channelCapabilities.telegramBotConfigured ?? false,
  };

  return {
    channelCapabilities,
    deviceSync: input?.deviceSync ? cloneConfiguredDeviceSyncRuntimeConfig(input.deviceSync) : null,
    managedAutoReplyChannels: (input?.managedAutoReplyChannels
      ?? createDefaultHostedManagedAutoReplyChannels(channelCapabilities))
      .map(cloneHostedManagedAutoReplyChannel),
  };
}

function cloneHostedManagedAutoReplyChannel(
  channel: HostedAssistantRuntimeManagedAutoReplyChannel,
): HostedAssistantRuntimeManagedAutoReplyChannel {
  return {
    capabilityReady: channel.capabilityReady,
    channel: channel.channel,
    memberChannel: channel.memberChannel ?? null,
  };
}

export async function withHostedProcessEnvironment<T>(input: {
  envOverrides: Record<string, string>;
  operatorHomeRoot: string;
  vaultRoot: string;
}, run: () => Promise<T>): Promise<T> {
  let releaseEnvironmentLock = () => {};
  const previousEnvironmentLock = hostedProcessEnvironmentQueue;
  hostedProcessEnvironmentQueue = new Promise<void>((resolve) => {
    releaseEnvironmentLock = resolve;
  });
  await previousEnvironmentLock;

  try {
    return await runWithHostedProcessEnvironment(input, run);
  } finally {
    releaseEnvironmentLock();
  }
}

async function runWithHostedProcessEnvironment<T>(input: {
  envOverrides: Record<string, string>;
  operatorHomeRoot: string;
  vaultRoot: string;
}, run: () => Promise<T>): Promise<T> {
  const previousValues = new Map<string, string | undefined>();
  const nextValues: Record<string, string> = {
    ...input.envOverrides,
    HOME: input.operatorHomeRoot,
    VAULT: input.vaultRoot,
  };

  for (const [key, value] of Object.entries(nextValues)) {
    previousValues.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return await run();
  } finally {
    for (const [key, previousValue] of previousValues) {
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
}

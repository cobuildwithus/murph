import { cloneConfiguredDeviceSyncRuntimeConfig } from "@murphai/device-syncd/runtime-config";
import type {
  AssistantTurnEnvironment,
} from "@murphai/assistant-engine";
import {
  MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH_ENV,
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
} from "@murphai/assistant-engine/assistant-skill-env";
import {
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
  isMurphAndroidAppEnabled,
  MURPH_ANDROID_APP_ENABLED_ENV,
} from "@murphai/hosted-execution/env";

import {
  HOSTED_SHARED_CHANNEL_PLATFORM_ENV_NAMES,
  HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES,
  HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
  HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES,
  HOSTED_SHARED_TRUSTED_PLATFORM_ENV_NAMES,
} from "../hosted-env-categories.ts";

import type {
  HostedAssistantRuntimeManagedAutoReplyChannel,
  HostedAssistantRuntimeParserToolchainConfig,
  HostedAssistantRuntimeParserToolConfig,
  HostedAssistantRuntimeParserToolName,
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
  "HOSTED_EXECUTION_CONTROL_TOKEN",
  "HOSTED_EXECUTION_CONTROL_TOKENS",
  "HOSTED_EXECUTION_RETRY_DELAY_MS",
  "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
  "HOSTED_EXECUTION_RUNNER_ENV_PROFILES",
  "HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS",
  "HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT",
  "HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL",
  "HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME",
  "HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG",
  "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID",
  "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
] as const;
const HOSTED_RUNTIME_PROCESS_ENV_MARKER = "MURPH_HOSTED_RUNTIME_PROCESS";
const HOSTED_RUNTIME_OPERATOR_TOOL_SELECTOR_ENV_NAMES = [
  "FFMPEG_COMMAND",
  "FILE_COMMAND",
  "MUTOOL_COMMAND",
  "PDFINFO_COMMAND",
  "PDFTOPPM_COMMAND",
  "PDFTOTEXT_COMMAND",
  "QPDF_COMMAND",
  "WHISPER_COMMAND",
  "WHISPER_MODEL_PATH",
] as const;
const HOSTED_RUNTIME_BASE_PROCESS_ENV_NAMES = [
  "CODEX_CA_CERTIFICATE",
  "CURL_CA_BUNDLE",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
  // Image-owned Health Commons package root. Keep the name literal so
  // assistant-runtime does not depend on @murphai/health-commons.
  "MURPH_HEALTH_COMMONS_PACKAGE_ROOT",
  "NODE_ENV",
  "NODE_EXTRA_CA_CERTS",
  "PATH",
  "PATHEXT",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SystemDrive",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
] as const;
const HOSTED_RUNTIME_TRUST_STORE_PROCESS_ENV_NAMES = [
  "CODEX_CA_CERTIFICATE",
  "CURL_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
] as const;
export const HOSTED_RUNNER_EXECUTABLE_PATH_ENTRIES = [
  "/app/node_modules/.bin",
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
] as const;
export const HOSTED_RUNNER_EXECUTABLE_PATH =
  HOSTED_RUNNER_EXECUTABLE_PATH_ENTRIES.join(":");
const HOSTED_RUNTIME_PLATFORM_TRANSPORT_ENV_NAMES = [
  "ALL_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
] as const;
const HOSTED_RUNTIME_REJECTED_HOSTED_ASSISTANT_SEED_ENV_NAMES = [
  "HOSTED_ASSISTANT_API_KEY_ENV",
  "HOSTED_ASSISTANT_BASE_URL",
  "HOSTED_ASSISTANT_CODEX_COMMAND",
  "HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS",
  "HOSTED_ASSISTANT_OSS",
  "HOSTED_ASSISTANT_PROFILE",
  "HOSTED_ASSISTANT_PROVIDER_NAME",
] as const;
const HOSTED_RUNTIME_USER_PROCESS_ENV_OVERRIDE_NAMES = [
  "ALL_PROXY",
  "CODEX_CA_CERTIFICATE",
  "CURL_CA_BUNDLE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const;
const HOSTED_RUNTIME_FORWARDED_ENV_DENYLIST = new Set<string>(
  [
    ...HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES,
    ...HOSTED_SHARED_PLATFORM_ONLY_ENV_NAMES,
    ...HOSTED_RUNTIME_CONTROL_PLANE_ENV_NAMES,
    ...HOSTED_RUNTIME_OPERATOR_TOOL_SELECTOR_ENV_NAMES,
    ...HOSTED_RUNTIME_REJECTED_HOSTED_ASSISTANT_SEED_ENV_NAMES,
    ...HOSTED_RUNTIME_USER_PROCESS_ENV_OVERRIDE_NAMES,
    HOSTED_RUNTIME_PROCESS_ENV_MARKER,
    // Image-owned Codex model catalog path. Runtime producers must not
    // redirect it through normal forwarded env; projectHostedRuntimeProcessEnv
    // preserves only the ambient image value.
    HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
    // Platform-owned assistant-engine asset roots (Dockerfile ENV pins).
    // Job producers must not redirect the skills root or the prebuilt CLI
    // surface contract; the runtime boundary owns this guard for every
    // producer, not just the Cloudflare runner-secret policy.
    MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH_ENV,
    MURPH_ASSISTANT_SKILLS_ROOT_ENV,
    // Health Commons owns this env-name contract from @murphai/health-commons/runtime.
    // Keep it literal here so assistant-runtime does not gain that dependency edge.
    "MURPH_HEALTH_COMMONS_PACKAGE_ROOT",
    "CODEX_HOME",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "HOME",
    "HOSTED_WEB_BASE_URL",
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
const HOSTED_RUNTIME_FORWARDED_ENV_DENYLIST_PREFIXES = [
  "HOSTED_CRYPTO_",
  "HOSTED_CONTAINER_",
  "HOSTED_EXECUTION_",
  "HOSTED_WAKE_",
  "HOSTED_WEB_CALLBACK_SIGNING_",
  "HOSTED_WEB_ENCRYPTION_",
  "DEVICE_SYNC_",
  "NPM_CONFIG_",
  "npm_config_",
] as const;
const HOSTED_RUNTIME_USER_ENV_DENYLIST = new Set<string>(
  [
    ...HOSTED_SHARED_INGRESS_ONLY_SECRET_ENV_NAMES,
    ...HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
    ...HOSTED_SHARED_TRUSTED_PLATFORM_ENV_NAMES,
    ...HOSTED_RUNTIME_CONTROL_PLANE_ENV_NAMES,
    ...HOSTED_RUNTIME_OPERATOR_TOOL_SELECTOR_ENV_NAMES,
    ...HOSTED_RUNTIME_REJECTED_HOSTED_ASSISTANT_SEED_ENV_NAMES,
    ...HOSTED_RUNTIME_USER_PROCESS_ENV_OVERRIDE_NAMES,
    HOSTED_RUNTIME_PROCESS_ENV_MARKER,
    // Platform-owned assistant-engine asset roots — see the forwarded-env
    // deny list note above.
    MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH_ENV,
    MURPH_ASSISTANT_SKILLS_ROOT_ENV,
    // Health Commons owns this env-name contract from @murphai/health-commons/runtime.
    // Keep it literal here so assistant-runtime does not gain that dependency edge.
    "MURPH_HEALTH_COMMONS_PACKAGE_ROOT",
    "CODEX_HOME",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "HOME",
    "HOSTED_WEB_BASE_URL",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "MURPH_DATA_API_KEY",
    "NODE_OPTIONS",
    "NODE_PATH",
    "PATH",
    "PORT",
    "PWD",
    // Local harness-owned auth seed. Platform forwarded env may carry this for
    // hosted-local dev, but member userEnv must never select Codex auth mode.
    "HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON",
    HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
    "HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL",
    "VAULT",
  ],
);
const HOSTED_RUNTIME_USER_ENV_DENYLIST_PREFIXES = [
  "AGENTMAIL_",
  "CF_",
  "HOSTED_ASSISTANT_",
  "HOSTED_CRYPTO_",
  "HOSTED_CONTAINER_",
  "HOSTED_EMAIL_",
  "HOSTED_EXECUTION_",
  "HOSTED_WAKE_",
  "HOSTED_WEB_CALLBACK_SIGNING_",
  "HOSTED_WEB_ENCRYPTION_",
  "DEVICE_SYNC_",
  "NPM_CONFIG_",
  "npm_config_",
  "WRANGLER_",
] as const;
let hostedProcessEnvironmentQueue: Promise<void> = Promise.resolve();

const hostedParserToolNames = [
  "ffmpeg",
  "pdfinfo",
  "pdftotext",
  "transcription",
  "whisper",
] as const satisfies readonly HostedAssistantRuntimeParserToolName[];

export function normalizeHostedAssistantRuntimeConfig(
  input: HostedAssistantRuntimeConfig | undefined,
  platform: HostedRuntimePlatform | null | undefined,
): NormalizedHostedAssistantRuntimeConfig {
  const forwardedEnv = sanitizeHostedAssistantRuntimeForwardedEnv(
    input?.forwardedEnv ?? {},
  );
  const platformEnv = sanitizeHostedAssistantRuntimePlatformEnv(input?.platformEnv ?? {});
  const parserToolchain =
    normalizeHostedAssistantRuntimeParserToolchain(input?.parserToolchain);
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
    parserToolchain,
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
    ...sanitizeHostedAssistantRuntimeChannelPlatformEnv(input.platformEnv ?? {}),
  };
}

export function projectHostedRuntimeProcessEnv(input: {
  ambientEnv: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Readonly<Record<string, string>>;
  platformTransportEnv?: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  const baseEnv = buildHostedBaseProcessEnvironment(input.ambientEnv);
  const imageCodexModelCatalogJson =
    baseEnv[HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV];

  return {
    ...baseEnv,
    ...buildHostedPlatformTransportProcessEnvironment(input.platformTransportEnv ?? {}),
    ...sanitizeHostedAssistantRuntimeForwardedEnv(input.forwardedEnv),
    ...(imageCodexModelCatalogJson
      ? { [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: imageCodexModelCatalogJson }
      : {}),
  };
}

export function projectHostedRuntimeTrustStoreEnv(
  ambientEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of HOSTED_RUNTIME_TRUST_STORE_PROCESS_ENV_NAMES) {
    const value = ambientEnv[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  return env;
}

export function buildHostedRunnerExecutablePath(
  sourcePath: string | null | undefined,
): string {
  const seen = new Set<string>(HOSTED_RUNNER_EXECUTABLE_PATH_ENTRIES);
  const entries: string[] = [...HOSTED_RUNNER_EXECUTABLE_PATH_ENTRIES];

  if (sourcePath) {
    for (const rawEntry of sourcePath.split(":")) {
      const entry = rawEntry.trim();
      if (!entry || entry === "." || !entry.startsWith("/") || seen.has(entry)) {
        continue;
      }

      seen.add(entry);
      entries.push(entry);
    }
  }

  return entries.join(":");
}

export function createHostedAssistantTurnEnvironment(input: {
  operatorHomeRoot?: string | null;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
}): AssistantTurnEnvironment {
  const env: NodeJS.ProcessEnv = {
    ...input.runtimeEnv,
    [HOSTED_RUNTIME_PROCESS_ENV_MARKER]: "1",
    VAULT: input.vaultRoot,
  };

  if (input.operatorHomeRoot) {
    env.HOME = input.operatorHomeRoot;
  }

  return {
    currentWorkingDirectory: null,
    env,
  };
}

export function sanitizeHostedAssistantRuntimeForwardedEnv(
  forwardedEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(forwardedEnv).filter(([key]) =>
      !HOSTED_RUNTIME_FORWARDED_ENV_DENYLIST.has(key)
      && !HOSTED_RUNTIME_FORWARDED_ENV_DENYLIST_PREFIXES.some((prefix) => key.startsWith(prefix))
    ),
  );
}

export function sanitizeHostedAssistantRuntimePlatformEnv(
  platformEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  const allowedKeys = new Set<string>(HOSTED_SHARED_TRUSTED_PLATFORM_ENV_NAMES);
  const sanitized = Object.fromEntries(
    Object.entries(platformEnv).filter(([key]) => allowedKeys.has(key)),
  );

  if (isMurphAndroidAppEnabled(platformEnv)) {
    sanitized[MURPH_ANDROID_APP_ENABLED_ENV] = "1";
  } else {
    delete sanitized[MURPH_ANDROID_APP_ENABLED_ENV];
  }

  return sanitized;
}

function sanitizeHostedAssistantRuntimeChannelPlatformEnv(
  platformEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  const allowedKeys = new Set<string>(HOSTED_SHARED_CHANNEL_PLATFORM_ENV_NAMES);
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

  for (const envName of HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES) {
    if (normalizeHostedRuntimeString(normalizedUserEnv[envName]) === null) {
      delete normalizedUserEnv[envName];
    }
  }

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

function normalizeHostedAssistantRuntimeParserToolchain(
  input: HostedAssistantRuntimeParserToolchainConfig | null | undefined,
): HostedAssistantRuntimeParserToolchainConfig | null {
  if (input === null) {
    throw new TypeError(
      "Hosted runtime parserToolchain:null is not supported; omit parserToolchain to use the runner image toolchain.",
    );
  }

  return cloneHostedAssistantRuntimeParserToolchain(input);
}

function cloneHostedAssistantRuntimeParserToolchain(
  input: HostedAssistantRuntimeParserToolchainConfig | undefined,
): HostedAssistantRuntimeParserToolchainConfig | null {
  if (!input) {
    return null;
  }

  const tools: HostedAssistantRuntimeParserToolchainConfig["tools"] = {};
  for (const toolName of hostedParserToolNames) {
    const toolConfig = input.tools[toolName];
    if (toolConfig) {
      tools[toolName] = cloneHostedAssistantRuntimeParserToolConfig(toolConfig);
    }
  }

  return { tools };
}

function cloneHostedAssistantRuntimeParserToolConfig(
  input: HostedAssistantRuntimeParserToolConfig,
): HostedAssistantRuntimeParserToolConfig {
  return {
    ...(input.authorizationHeader === undefined
      ? {}
      : {
          authorizationHeader: normalizeHostedAssistantRuntimeParserToolAuthorizationHeader(
            input.authorizationHeader,
          ),
        }),
    ...(input.command === undefined
      ? {}
      : {
          command: normalizeHostedAssistantRuntimeParserToolPath(
            input.command,
            "command",
          ),
        }),
    ...(input.endpoint === undefined
      ? {}
      : {
          endpoint: normalizeHostedAssistantRuntimeParserToolEndpoint(
            input.endpoint,
          ),
        }),
    ...(input.modelPath === undefined
      ? {}
      : {
          modelPath: normalizeHostedAssistantRuntimeParserToolPath(
            input.modelPath,
            "modelPath",
          ),
        }),
  };
}

function normalizeHostedAssistantRuntimeParserToolAuthorizationHeader(
  value: string | null | undefined,
): string {
  const normalized = normalizeHostedRuntimeString(value);
  if (!normalized) {
    throw new TypeError(
      "Hosted runtime parser toolchain authorizationHeader must be a non-empty string.",
    );
  }

  return normalized;
}

function normalizeHostedAssistantRuntimeParserToolEndpoint(
  value: string | null | undefined,
): string {
  const normalized = normalizeHostedRuntimeString(value);
  if (!normalized) {
    throw new TypeError(
      "Hosted runtime parser toolchain endpoint must be a non-empty http(s) URL.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TypeError(
      "Hosted runtime parser toolchain endpoint must be an absolute http(s) URL.",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(
      "Hosted runtime parser toolchain endpoint must be an absolute http(s) URL.",
    );
  }

  return normalized;
}

function normalizeHostedAssistantRuntimeParserToolPath(
  value: string | null | undefined,
  fieldName: string,
): string {
  const normalized = normalizeHostedRuntimeString(value);
  if (!normalized) {
    throw new TypeError(
      `Hosted runtime parser toolchain ${fieldName} must be a non-empty absolute path.`,
    );
  }
  if (!normalized.startsWith("/")) {
    throw new TypeError(
      `Hosted runtime parser toolchain ${fieldName} must be an absolute path.`,
    );
  }
  return normalized;
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
  const previousEnvironment = { ...process.env };
  const previousWorkingDirectory = process.cwd();
  const nextEnvironment: NodeJS.ProcessEnv = {
    ...buildHostedBaseProcessEnvironment(previousEnvironment),
    ...input.envOverrides,
    HOME: input.operatorHomeRoot,
    [HOSTED_RUNTIME_PROCESS_ENV_MARKER]: "1",
    VAULT: input.vaultRoot,
  };

  replaceProcessEnvironment(nextEnvironment);

  try {
    process.chdir(input.vaultRoot);
    return await run();
  } finally {
    try {
      process.chdir(previousWorkingDirectory);
    } finally {
      replaceProcessEnvironment(previousEnvironment);
    }
  }
}

function buildHostedBaseProcessEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of HOSTED_RUNTIME_BASE_PROCESS_ENV_NAMES) {
    const value = source[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  env.PATH = buildHostedRunnerExecutablePath(source.PATH);

  return env;
}

function buildHostedPlatformTransportProcessEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of HOSTED_RUNTIME_PLATFORM_TRANSPORT_ENV_NAMES) {
    const value = source[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  return env;
}

function replaceProcessEnvironment(nextEnvironment: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(nextEnvironment)) {
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }
}

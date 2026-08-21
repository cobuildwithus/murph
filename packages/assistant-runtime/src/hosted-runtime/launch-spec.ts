import {
  readConfiguredDeviceSyncRuntimeConfig,
} from "@murphai/device-syncd/runtime-config";
import {
  readHostedEmailCapabilities,
} from "@murphai/hosted-execution/hosted-email";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
  isMurphAndroidAppEnabled,
  MURPH_ANDROID_APP_ENABLED_ENV,
} from "@murphai/hosted-execution/env";
import {
  HOSTED_ELEVENLABS_ENV_NAMES,
  HOSTED_EXA_SEARCH_CODEX_SHELL_ENV_NAMES,
  HOSTED_GEMINI_VIDEO_ANALYSIS_ENV_NAMES,
  HOSTED_MAPBOX_ROUTES_CODEX_SHELL_ENV_NAMES,
  HOSTED_MURPH_DATA_API_CODEX_SHELL_ENV_NAMES,
  HOSTED_XAI_SEARCH_ENV_NAMES,
} from "@murphai/hosted-execution/assistant-capabilities";
import {
  HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  HOSTED_ASSISTANT_PROVIDER_ENV,
} from "@murphai/operator-config/hosted-assistant-config-constants";
import {
  OPENAI_CODEX_MODEL_PROVIDER_CONFIG,
  VENICE_CODEX_MODEL_PROVIDER_ID,
} from "@murphai/operator-config/assistant/target-runtime";
import {
  HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS,
  HOSTED_SHARED_TRUSTED_PLATFORM_ENV_NAMES,
} from "../hosted-env-categories.ts";
import {
  sanitizeHostedAssistantRuntimeForwardedEnv,
  sanitizeHostedAssistantRuntimePlatformEnv,
  sanitizeHostedAssistantRuntimeUserEnv,
} from "./environment.ts";
import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeParserToolchainConfig,
  HostedAssistantRuntimeResolvedConfig,
} from "./models.ts";
import {
  readHostedRunnerCommitTimeoutMs,
} from "./timeouts.ts";

export const HOSTED_RUNTIME_ENV_PROFILES_ENV =
  "HOSTED_EXECUTION_RUNNER_ENV_PROFILES";
export { HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV };
export { HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV };
export const HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV =
  "HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL";
// Local-dev-only: ChatGPT-subscription Codex auth.json content seeded by the
// hosted-local harness. Honored only when NODE_ENV=development; see
// prepareHostedCodexRuntimeEnvironment.
export const HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV =
  "HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON";
export const HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV =
  "MURPH_DEV_CODEX_APP_SERVER_PROXY_URL";
export const HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV =
  "MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN";
const HOSTED_RUNTIME_CHECKPOINT_DEBUG_ENV_KEYS = [
  "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS",
  "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_FILE",
  "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG",
  "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT",
  "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW",
] as const;
export const HOSTED_RUNTIME_ENV_PROFILE_KEYS = {
  assistant: [
    ...HOSTED_RUNTIME_CHECKPOINT_DEBUG_ENV_KEYS,
    ...HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
    ...HOSTED_GEMINI_VIDEO_ANALYSIS_ENV_NAMES,
    ...HOSTED_ELEVENLABS_ENV_NAMES,
    ...HOSTED_MURPH_DATA_API_CODEX_SHELL_ENV_NAMES,
    ...HOSTED_XAI_SEARCH_ENV_NAMES,
    HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
    HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
    HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
    "NODE_ENV",
    ...HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  ],
  "hosted-email": HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS.hostedEmailConfigured,
  // Linq webhook verification stays on the ingress boundary. The runtime only
  // receives outbound Linq API config.
  linq: HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS.linqConfigured,
  exa: HOSTED_EXA_SEARCH_CODEX_SHELL_ENV_NAMES,
  mapbox: HOSTED_MAPBOX_ROUTES_CODEX_SHELL_ENV_NAMES,
  // Parser support is a semantic runner capability. Concrete native binary and
  // model paths are image-owned toolchain config, not forwarded runtime env.
  parsers: [],
  telegram: HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS.telegramConfigured,
} as const;

export const HOSTED_RUNTIME_ENV_KEY_NAMES: readonly string[] = Array.from(
  new Set(Object.values(HOSTED_RUNTIME_ENV_PROFILE_KEYS).flatMap((keys) => [...keys])),
);

export const HOSTED_RUNTIME_FORWARDED_ENV_LOG_CATEGORY_KEYS =
  HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS;

export type HostedRuntimeEnvProfileName = keyof typeof HOSTED_RUNTIME_ENV_PROFILE_KEYS;

const DEFAULT_HOSTED_RUNTIME_ENV_PROFILE_NAMES = [
  "assistant",
] as const satisfies readonly HostedRuntimeEnvProfileName[];

type UnknownEnvSource = Readonly<Record<string, unknown>>;

export interface HostedRuntimeLaunchSpec {
  runtime: HostedAssistantRuntimeConfig;
}

export interface HostedRuntimeLaunchSpecInput {
  commitTimeoutMs?: number | null;
  configSource?: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Readonly<Record<string, string>>;
  parserToolchain?: HostedAssistantRuntimeParserToolchainConfig;
  platformEnv?: Readonly<Record<string, string>>;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  userEnv?: Readonly<Record<string, string>>;
}

export function buildHostedRuntimeLaunchSpec(
  input: HostedRuntimeLaunchSpecInput,
): HostedRuntimeLaunchSpec {
  const splitEnv = splitHostedRuntimeLaunchEnv({
    forwardedEnv: input.forwardedEnv,
    platformEnv: input.platformEnv,
  });
  const parserToolchain = readHostedRuntimeLaunchParserToolchain(input.parserToolchain);
  const resolvedConfigSource = {
    ...(input.configSource ?? input.forwardedEnv),
    ...splitEnv.platformEnv,
  };

  return {
    runtime: {
      commitTimeoutMs: readHostedRunnerCommitTimeoutMs(input.commitTimeoutMs ?? null),
      forwardedEnv: splitEnv.forwardedEnv,
      ...(parserToolchain === undefined
        ? {}
        : { parserToolchain }),
      ...(Object.keys(splitEnv.platformEnv).length === 0
        ? {}
        : { platformEnv: splitEnv.platformEnv }),
      resolvedConfig:
        input.resolvedConfig
        ?? buildHostedRuntimeResolvedConfig(resolvedConfigSource),
      userEnv: sanitizeHostedAssistantRuntimeUserEnv({
        forwardedEnv: splitEnv.forwardedEnv,
        userEnv: input.userEnv ?? {},
      }),
    },
  };
}

function readHostedRuntimeLaunchParserToolchain(
  parserToolchain: HostedAssistantRuntimeParserToolchainConfig | null | undefined,
): HostedAssistantRuntimeParserToolchainConfig | undefined {
  if (parserToolchain === null) {
    throw new TypeError(
      "Hosted runtime parserToolchain:null is not supported; omit parserToolchain to use the runner image toolchain.",
    );
  }

  if (!parserToolchain) {
    return undefined;
  }

  const tools: HostedAssistantRuntimeParserToolchainConfig["tools"] = {};
  for (const [toolName, config] of Object.entries(parserToolchain.tools)) {
    if (config === undefined) {
      continue;
    }

    tools[toolName as keyof HostedAssistantRuntimeParserToolchainConfig["tools"]] = {
      ...(config.authorizationHeader === undefined
        ? {}
        : {
            authorizationHeader: normalizeHostedRuntimeLaunchParserToolString(
              config.authorizationHeader,
              `parserToolchain.tools.${toolName}.authorizationHeader`,
            ),
          }),
      ...(config.command === undefined
        ? {}
        : {
            command: normalizeHostedRuntimeLaunchParserToolPath(
              config.command,
              `parserToolchain.tools.${toolName}.command`,
            ),
          }),
      ...(config.endpoint === undefined
        ? {}
        : {
            endpoint: normalizeHostedRuntimeLaunchParserToolEndpoint(
              config.endpoint,
              `parserToolchain.tools.${toolName}.endpoint`,
            ),
          }),
      ...(config.modelPath === undefined
        ? {}
        : {
            modelPath: normalizeHostedRuntimeLaunchParserToolPath(
              config.modelPath,
              `parserToolchain.tools.${toolName}.modelPath`,
            ),
          }),
    };
  }

  return { tools };
}

function normalizeHostedRuntimeLaunchParserToolString(
  value: string | null | undefined,
  label: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function normalizeHostedRuntimeLaunchParserToolEndpoint(
  value: string | null | undefined,
  label: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty http(s) URL.`);
  }

  const normalized = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TypeError(`${label} must be an absolute http(s) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(`${label} must be an absolute http(s) URL.`);
  }

  return normalized;
}

function normalizeHostedRuntimeLaunchParserToolPath(
  value: string | null | undefined,
  label: string,
): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a non-empty absolute path.`);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${label} must be a non-empty absolute path.`);
  }
  if (!normalized.startsWith("/")) {
    throw new TypeError(`${label} must be an absolute path.`);
  }

  return normalized;
}

export function buildHostedRuntimeForwardedEnv(
  source: UnknownEnvSource,
  options: {
    mapValue?: (input: {
      key: string;
      source: UnknownEnvSource;
      value: string;
    }) => string;
  } = {},
): Record<string, string> {
  const values: Record<string, string> = {};
  const enabledProfileNames = resolveHostedRuntimeEnvProfileNames(source);
  const allowedKeys = resolveHostedRuntimeEnvKeys(enabledProfileNames);

  for (const key of allowedKeys) {
    const value = source[key];
    if (
      typeof value !== "string"
      || value.length === 0
      || (
        isHostedAssistantConfigEnvKey(key)
        && !shouldForwardHostedCodexAssistantConfigEnv(source)
      )
    ) {
      continue;
    }

    values[key] = options.mapValue
      ? options.mapValue({ key, source, value })
      : value;
  }

  if (!values.NODE_ENV) {
    values.NODE_ENV = "production";
  }

  const emailCapabilities = enabledProfileNames.has("hosted-email")
    ? readHostedEmailCapabilities(source)
    : {
        ingressReady: false,
        sendReady: false,
      };
  values.HOSTED_EMAIL_INGRESS_READY = emailCapabilities.ingressReady ? "true" : "false";
  values.HOSTED_EMAIL_SEND_READY = emailCapabilities.sendReady ? "true" : "false";

  return values;
}

function isHostedAssistantConfigEnvKey(key: string): boolean {
  return (HOSTED_ASSISTANT_CONFIG_ENV_NAMES as readonly string[]).includes(key);
}

function shouldForwardHostedCodexAssistantConfigEnv(source: UnknownEnvSource): boolean {
  const provider = source[HOSTED_ASSISTANT_PROVIDER_ENV];
  if (typeof provider !== "string") {
    return false;
  }
  const normalized = provider.trim();
  return normalized === OPENAI_CODEX_MODEL_PROVIDER_CONFIG.id
    || normalized === VENICE_CODEX_MODEL_PROVIDER_ID;
}

export function buildHostedRuntimeChildEnv(input: {
  forwardedEnv: Readonly<Record<string, string>>;
}): Record<string, string> {
  return splitHostedRuntimeLaunchEnv({
    forwardedEnv: input.forwardedEnv,
  }).forwardedEnv;
}

export function buildHostedRuntimePlatformEnv(
  source: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of HOSTED_SHARED_TRUSTED_PLATFORM_ENV_NAMES) {
    if (key === MURPH_ANDROID_APP_ENABLED_ENV) {
      const value = source[key];
      if (isMurphAndroidAppEnabled({
        [key]: typeof value === "string" ? value : undefined,
      })) {
        env[key] = "1";
      }
      continue;
    }

    const value = normalizeHostedRuntimeEnvString(
      typeof source[key] === "string" ? source[key] : undefined,
    );
    if (value) {
      env[key] = value;
    }
  }

  return env;
}

export function buildHostedRuntimeResolvedConfig(
  configSource: Readonly<Record<string, string | undefined>>,
): HostedAssistantRuntimeResolvedConfig {
  const emailCapabilities = readHostedEmailCapabilities(configSource);
  const deviceSync = readConfiguredDeviceSyncRuntimeConfig(configSource);
  const telegramBotConfigured =
    normalizeHostedRuntimeEnvString(configSource.TELEGRAM_BOT_TOKEN) !== null;

  return {
    channelCapabilities: {
      emailSendReady: emailCapabilities.sendReady,
      telegramBotConfigured,
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
        capabilityReady: telegramBotConfigured,
        channel: "telegram",
        memberChannel: "telegram",
      },
    ],
  };
}

export function readHostedRuntimeCommitTimeoutConfigValue(
  value: string | undefined,
): number | null {
  const normalized = normalizeHostedRuntimeEnvString(value);
  if (normalized === null) {
    return null;
  }

  if (!/^[0-9]+$/u.test(normalized)) {
    return Number.NaN;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function splitHostedRuntimeLaunchEnv(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
}): {
  forwardedEnv: Record<string, string>;
  platformEnv: Record<string, string>;
} {
  const forwardedPlatformEnv = buildHostedRuntimePlatformEnv(input.forwardedEnv);
  const forwardedEnv = sanitizeHostedAssistantRuntimeForwardedEnv(input.forwardedEnv);
  const explicitPlatformEnv =
    input.platformEnv === undefined
      ? null
      : sanitizeHostedAssistantRuntimePlatformEnv(input.platformEnv);
  const platformEnv = explicitPlatformEnv ? { ...explicitPlatformEnv } : forwardedPlatformEnv;

  return {
    forwardedEnv,
    platformEnv,
  };
}

function resolveHostedRuntimeEnvProfileNames(
  source: UnknownEnvSource,
): Set<HostedRuntimeEnvProfileName> {
  const enabledProfiles = new Set<HostedRuntimeEnvProfileName>(
    DEFAULT_HOSTED_RUNTIME_ENV_PROFILE_NAMES,
  );
  const configuredProfiles = parseHostedRuntimeEnvCsvList(
    typeof source[HOSTED_RUNTIME_ENV_PROFILES_ENV] === "string"
      ? source[HOSTED_RUNTIME_ENV_PROFILES_ENV]
      : undefined,
    (entry) => entry.toLowerCase(),
  );

  for (const profileName of configuredProfiles) {
    if (isHostedRuntimeEnvProfileName(profileName)) {
      enabledProfiles.add(profileName);
    }
  }

  return enabledProfiles;
}

function resolveHostedRuntimeEnvKeys(
  profileNames: ReadonlySet<HostedRuntimeEnvProfileName>,
): Set<string> {
  const keys = new Set<string>();

  for (const profileName of profileNames) {
    for (const key of HOSTED_RUNTIME_ENV_PROFILE_KEYS[profileName]) {
      keys.add(key);
    }
  }

  return keys;
}

function isHostedRuntimeEnvProfileName(
  value: string,
): value is HostedRuntimeEnvProfileName {
  return Object.hasOwn(HOSTED_RUNTIME_ENV_PROFILE_KEYS, value);
}

function parseHostedRuntimeEnvCsvList(
  value: string | undefined,
  normalize: (entry: string) => string = (entry) => entry.toUpperCase(),
): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => normalize(entry));
}

function normalizeHostedRuntimeEnvString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

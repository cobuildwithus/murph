import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
  resolveAssistantSkillsRoot,
} from "@murphai/assistant-engine/assistant-skill-assets";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from "@murphai/hosted-execution/cli-runtime-bridge";
import {
  parseHostedLocalCodexSubscriptionSeedAuth,
} from "@murphai/hosted-execution/hosted-codex-subscription-auth";
import {
  HostedAssistantConfigurationError,
  HOSTED_ASSISTANT_API_KEY_ENV,
  HOSTED_ASSISTANT_BASE_URL_ENV,
  HOSTED_ASSISTANT_CODEX_COMMAND_ENV,
  HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS_ENV,
  HOSTED_ASSISTANT_OSS_ENV,
  HOSTED_ASSISTANT_PROFILE_ENV,
  HOSTED_ASSISTANT_PROVIDER_NAME_ENV,
} from "@murphai/operator-config/hosted-assistant-config";
import {
  type AssistantCodexModelProviderConfig,
  OPENAI_CODEX_MODEL_PROVIDER_CONFIG,
  resolveAssistantCodexModelProviderConfig,
} from "@murphai/operator-config/assistant/target-runtime";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV,
  HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "./launch-spec.ts";
import {
  HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV,
} from "./codex-runtime-env.ts";
import {
  HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE,
  HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY,
} from "./codex-shell-env-policy.ts";
import {
  buildHostedRunnerExecutablePath,
  HOSTED_RUNNER_EXECUTABLE_PATH,
} from "./environment.ts";

const HOSTED_CODEX_CONFIG_DIR_NAME = ".codex-hosted";
const HOSTED_CODEX_CONFIG_FILE_NAME = "config.toml";
const HOSTED_CODEX_AUTH_FILE_NAME = "auth.json";
// Codex's built-in OpenAI provider id. With hosted-local subscription auth in
// CODEX_HOME, Codex routes this provider to the ChatGPT subscription backend
// itself; configuring a base_url would misroute subscription bearer tokens.
const HOSTED_CODEX_CHATGPT_MODEL_PROVIDER_ID = "openai";
const DEFAULT_HOSTED_CODEX_REASONING_EFFORT = "low";
const DEFAULT_HOSTED_CODEX_APPROVAL_POLICY = "never";
const DEFAULT_HOSTED_CODEX_SANDBOX = "danger-full-access";
// Hosted thread cost scales linearly with this ceiling: every tool round-trip
// re-sends the whole thread, and OpenAI Standard-tier prompt caches evict
// within ~45 minutes regardless of prefix size or prompt_cache_retention
// (measured 2026-06-10 across 32k-170k prefixes), so member messages after an
// idle gap re-pay the full thread at uncached input rates. 128k cuts both the
// per-round-trip cached-read cost and the cold re-pay roughly in half versus
// the previous 233k while keeping ample conversational context between
// compactions.
const DEFAULT_HOSTED_CODEX_AUTO_COMPACT_TOKEN_LIMIT = 128_000;
const DEFAULT_HOSTED_CODEX_LOG_DIR = "/tmp/murph-codex-log";
const HOSTED_CODEX_PROVIDER_REQUEST_MAX_RETRIES = 4;
const HOSTED_CODEX_PROVIDER_STREAM_MAX_RETRIES = 5;
const HOSTED_CODEX_REJECTED_SEED_ENV_KEYS = [
  HOSTED_ASSISTANT_API_KEY_ENV,
  HOSTED_ASSISTANT_BASE_URL_ENV,
  HOSTED_ASSISTANT_CODEX_COMMAND_ENV,
  HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS_ENV,
  HOSTED_ASSISTANT_OSS_ENV,
  HOSTED_ASSISTANT_PROFILE_ENV,
  HOSTED_ASSISTANT_PROVIDER_NAME_ENV,
  // Auth token material must never linger in the runtime process env; in
  // dev subscription mode it is persisted to CODEX_HOME/auth.json instead.
  HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
] as const;
const HOSTED_CODEX_SUPPORTED_PROVIDER_LABEL =
  OPENAI_CODEX_MODEL_PROVIDER_CONFIG.id;
const HOSTED_CODEX_OPENAI_MODEL_PROVIDER_ID = "hosted-openai";
const HOSTED_CODEX_BOUND_USER_ID_ENV = "MURPH_HOSTED_CODEX_BOUND_USER_ID";
const HOSTED_CODEX_RUNTIME_ATTEMPT_ID_ENV = "MURPH_HOSTED_CODEX_RUNTIME_ATTEMPT_ID";
const HOSTED_CODEX_RUNTIME_LEASE_GENERATION_ENV =
  "MURPH_HOSTED_CODEX_RUNTIME_LEASE_GENERATION";
const HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION_ENV =
  "MURPH_HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION";

export const HOSTED_CODEX_RUNTIME_AUTHORITY_ENV = {
  attemptId: HOSTED_CODEX_RUNTIME_ATTEMPT_ID_ENV,
  boundUserId: HOSTED_CODEX_BOUND_USER_ID_ENV,
  leaseGeneration: HOSTED_CODEX_RUNTIME_LEASE_GENERATION_ENV,
  workspaceVersion: HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION_ENV,
} as const;
const HOSTED_CODEX_REJECTED_RUNTIME_AUTHORITY_ENV_KEYS = Object.values(
  HOSTED_CODEX_RUNTIME_AUTHORITY_ENV,
);

export interface HostedCodexRuntimeEnvironmentInput {
  operatorHomeRoot: string;
  runtimeEnv: Readonly<Record<string, string>>;
}

export interface HostedCodexRuntimeEnvironmentResult {
  codexConfigPath: string;
  codexHome: string;
  runtimeEnv: Record<string, string>;
}

export async function prepareHostedCodexRuntimeEnvironment(
  input: HostedCodexRuntimeEnvironmentInput,
): Promise<HostedCodexRuntimeEnvironmentResult> {
  rejectDeprecatedHostedCodexAppServerProxyEnv(input.runtimeEnv);
  rejectInvalidHostedCodexAppServerCommandOverride(input.runtimeEnv);

  const providerConfig = resolveHostedCodexModelProviderConfig({
    provider: normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_PROVIDER),
    runtimeEnv: input.runtimeEnv,
  });
  const usesTestProviderBaseUrlOverride =
    normalizeHostedCodexEnvString(
      input.runtimeEnv[HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV],
    ) !== null;
  const codexHome = path.join(input.operatorHomeRoot, HOSTED_CODEX_CONFIG_DIR_NAME);
  const codexConfigPath = path.join(codexHome, HOSTED_CODEX_CONFIG_FILE_NAME);
  const codexAuthPath = path.join(codexHome, HOSTED_CODEX_AUTH_FILE_NAME);
  const seededChatGptAuthJson = readHostedCodexChatGptAuthJson(input.runtimeEnv);

  await mkdir(codexHome, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(codexHome, 0o700);
  let chatGptAuthKind = await readHostedCodexAuthKind(codexAuthPath);
  if (chatGptAuthKind === "invalid" || chatGptAuthKind === "managed") {
    await rm(codexAuthPath, { force: true });
    chatGptAuthKind = null;
  }
  if (seededChatGptAuthJson !== null) {
    await writeFile(codexAuthPath, seededChatGptAuthJson, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(codexAuthPath, 0o600);
    chatGptAuthKind = "seeded";
  }
  if (seededChatGptAuthJson === null && chatGptAuthKind === "seeded") {
    await rm(codexAuthPath, { force: true });
    chatGptAuthKind = null;
  }
  const chatGptAuth = chatGptAuthKind !== null;
  const apiKeyValue = normalizeHostedCodexEnvString(input.runtimeEnv[providerConfig.envKey]);
  if (!chatGptAuth && !apiKeyValue) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_REQUIRED",
      `Hosted assistant provider ${providerConfig.id} requires ${providerConfig.envKey} in the isolated runtime environment.`,
    );
  }

  const runtimeEnv = stripHostedCodexRejectedSeedEnv(input.runtimeEnv);
  runtimeEnv.PATH = buildHostedRunnerExecutablePath(runtimeEnv.PATH);
  const hostedModel = normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_MODEL);
  delete runtimeEnv.HOSTED_ASSISTANT_MODEL;
  Object.assign(runtimeEnv, {
    CODEX_HOME: codexHome,
    [HOSTED_RUNTIME_PROCESS_ENV]: "1",
    [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: resolveAssistantSkillsRoot(),
    ...(hostedModel ? { HOSTED_ASSISTANT_MODEL: hostedModel } : {}),
    HOSTED_ASSISTANT_REASONING_EFFORT:
      normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT)
      ?? DEFAULT_HOSTED_CODEX_REASONING_EFFORT,
    HOSTED_ASSISTANT_APPROVAL_POLICY:
      normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_APPROVAL_POLICY)
      ?? DEFAULT_HOSTED_CODEX_APPROVAL_POLICY,
    HOSTED_ASSISTANT_SANDBOX:
      normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_SANDBOX)
      ?? DEFAULT_HOSTED_CODEX_SANDBOX,
    [HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV]: chatGptAuth
      ? HOSTED_CODEX_CHATGPT_MODEL_PROVIDER_ID
      : providerConfig.id,
  });
  await writeFile(
    codexConfigPath,
    buildHostedCodexConfigToml({
      chatGptAuth,
      writeProviderRetryDefaults: usesTestProviderBaseUrlOverride,
      model: normalizeHostedCodexEnvString(runtimeEnv.HOSTED_ASSISTANT_MODEL),
      provider: providerConfig,
      reasoningEffort: runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT,
    }),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  await chmod(codexConfigPath, 0o600);

  return {
    codexConfigPath,
    codexHome,
    runtimeEnv,
  };
}

type HostedCodexAuthKind = "invalid" | "managed" | "seeded";

async function readHostedCodexAuthKind(
  codexAuthPath: string,
): Promise<HostedCodexAuthKind | null> {
  let raw: string;
  try {
    raw = await readFile(codexAuthPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "invalid";
  }

  try {
    const authMode = typeof parsed === "object" && parsed !== null
      ? Reflect.get(parsed, "auth_mode")
      : null;
    if (authMode === "chatgpt") {
      return "managed";
    }
    if (authMode === "chatgptAuthTokens") {
      parseHostedLocalCodexSubscriptionSeedAuth(parsed);
      return "seeded";
    }
  } catch {
    // Normalize every credential-shape failure to one non-secret error.
  }

  return "invalid";
}

// Local-dev-only ChatGPT-subscription auth for hosted Codex. The harness seeds
// the host Codex home's auth.json through this env var (base64url-encoded so
// the value survives the wrangler env-file hop intact); production and e2e
// lanes never set it and the NODE_ENV gate fails closed if one ever does.
function readHostedCodexChatGptAuthJson(
  runtimeEnv: Readonly<Record<string, string>>,
): string | null {
  const encodedAuthJson = normalizeHostedCodexEnvString(
    runtimeEnv[HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV],
  );
  if (encodedAuthJson === null) {
    return null;
  }

  if (normalizeHostedCodexEnvString(runtimeEnv.NODE_ENV) !== "development") {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV} is only available when NODE_ENV=development.`,
    );
  }

  const authJson = Buffer.from(encodedAuthJson, "base64url").toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(authJson);
  } catch {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV} must contain base64url-encoded Codex auth.json content.`,
    );
  }

  try {
    return JSON.stringify(parseHostedLocalCodexSubscriptionSeedAuth(parsed));
  } catch {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV} must contain hosted-local Codex subscription seed auth tokens.`,
    );
  }
}

function rejectInvalidHostedCodexAppServerCommandOverride(
  runtimeEnv: Readonly<Record<string, string>>,
): void {
  const configuredCommand = normalizeHostedCodexEnvString(
    runtimeEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV],
  );
  if (!configuredCommand) {
    return;
  }

  if (normalizeHostedCodexEnvString(runtimeEnv.NODE_ENV) !== "test") {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV} is only available when NODE_ENV=test.`,
    );
  }

  if (!path.isAbsolute(configuredCommand)) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV} must be an absolute path.`,
    );
  }
}

function stripHostedCodexRejectedSeedEnv(
  runtimeEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  const nextEnv = { ...runtimeEnv };

  for (const key of [
    ...HOSTED_CODEX_REJECTED_SEED_ENV_KEYS,
    ...HOSTED_CODEX_REJECTED_RUNTIME_AUTHORITY_ENV_KEYS,
  ]) {
    delete nextEnv[key];
  }

  return nextEnv;
}

function rejectDeprecatedHostedCodexAppServerProxyEnv(
  runtimeEnv: Readonly<Record<string, string>>,
): void {
  const configuredProxyEnvKeys = [
    HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV,
    HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV,
  ].filter((key) => normalizeHostedCodexEnvString(runtimeEnv[key]) !== null);

  if (configuredProxyEnvKeys.length === 0) {
    return;
  }

  throw new HostedAssistantConfigurationError(
    "HOSTED_ASSISTANT_CONFIG_INVALID",
    `${configuredProxyEnvKeys.join(", ")} are no longer supported by hosted Codex runtime; configure HOSTED_ASSISTANT_PROVIDER=openai with OPENAI_API_KEY instead.`,
  );
}

function resolveHostedCodexModelProviderConfig(input: {
  provider: string | null;
  runtimeEnv: Readonly<Record<string, string | undefined>>;
}): AssistantCodexModelProviderConfig {
  const resolvedProviderConfig = input.provider === OPENAI_CODEX_MODEL_PROVIDER_CONFIG.id
    ? resolveAssistantCodexModelProviderConfig(input.provider)
    : null;
  if (!resolvedProviderConfig) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `Hosted Codex runtime only supports HOSTED_ASSISTANT_PROVIDER=${HOSTED_CODEX_SUPPORTED_PROVIDER_LABEL}.`,
    );
  }
  const providerConfig = {
    ...resolvedProviderConfig,
    id: HOSTED_CODEX_OPENAI_MODEL_PROVIDER_ID,
  };

  const override = normalizeHostedCodexEnvString(
    input.runtimeEnv[HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV],
  );

  if (!override) {
    return providerConfig;
  }

  if (normalizeHostedCodexEnvString(input.runtimeEnv.NODE_ENV) !== "test") {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV} is test-only.`,
    );
  }

  let url: URL;
  try {
    url = new URL(override);
  } catch {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV} must be an absolute URL.`,
    );
  }

  if (url.protocol !== "http:") {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV} must use http.`,
    );
  }

  if (!isHostedLocalCodexTestHostname(normalizeHostedCodexUrlHostname(url.hostname))) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `${HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV} must point at a local test host.`,
    );
  }

  return {
    ...providerConfig,
    baseUrl: url.toString(),
    supportsWebSockets: false,
  };
}

function isHostedLocalCodexTestHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "127.0.0.1"
    || normalized === "localhost"
    || normalized === "::1"
    || normalized === "host.docker.internal"
    || normalized === "host.containers.internal"
    || isHostedLocalCodexPrivateIpv4Host(normalized);
}

function isHostedLocalCodexPrivateIpv4Host(hostname: string): boolean {
  const parts = parseHostedLocalCodexIpv4Parts(hostname);
  if (!parts) {
    return false;
  }

  const [first, second] = parts;
  return first === 10
    || first === 127
    || first === 169 && second === 254
    || first === 172 && second >= 16 && second <= 31
    || first === 192 && second === 168;
}

function parseHostedLocalCodexIpv4Parts(value: string): [number, number, number, number] | null {
  const rawParts = value.split(".");
  if (rawParts.length !== 4) {
    return null;
  }

  const parts = rawParts.map((part) => {
    if (!/^\d{1,3}$/u.test(part)) {
      return Number.NaN;
    }

    return Number(part);
  });

  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return parts as [number, number, number, number];
}

function normalizeHostedCodexUrlHostname(hostname: string): string {
  return hostname.replace(/^\[/u, "").replace(/\]$/u, "");
}

export function buildHostedCodexConfigToml(input: {
  chatGptAuth?: boolean;
  writeProviderRetryDefaults?: boolean;
  model: string | null;
  provider: AssistantCodexModelProviderConfig;
  reasoningEffort: string;
}): string {
  // ChatGPT-subscription auth uses Codex's built-in provider so Codex itself
  // selects the subscription backend; a custom provider entry with base_url or
  // env_key would bypass that routing.
  const providerConfigLines = input.chatGptAuth ? [] : [
    `[model_providers.${tomlQuotedKey(input.provider.id)}]`,
    `name = ${tomlString(input.provider.name)}`,
    `base_url = ${tomlString(input.provider.baseUrl)}`,
    `env_key = ${tomlString(input.provider.envKey)}`,
    `wire_api = ${tomlString(input.provider.wireApi)}`,
    ...(input.provider.supportsWebSockets
      ? ["supports_websockets = true"]
      : []),
    "requires_openai_auth = false",
    ...(input.writeProviderRetryDefaults
      ? [
          `request_max_retries = ${HOSTED_CODEX_PROVIDER_REQUEST_MAX_RETRIES}`,
          `stream_max_retries = ${HOSTED_CODEX_PROVIDER_STREAM_MAX_RETRIES}`,
        ]
      : []),
    "",
  ];
  const modelProviderId = input.chatGptAuth
    ? HOSTED_CODEX_CHATGPT_MODEL_PROVIDER_ID
    : input.provider.id;

  return [
    ...(input.model ? [`model = ${tomlString(input.model)}`] : []),
    ...(input.chatGptAuth ? ['cli_auth_credentials_store = "file"'] : []),
    `model_provider = ${tomlString(modelProviderId)}`,
    `model_reasoning_effort = ${tomlString(input.reasoningEffort)}`,
    `model_auto_compact_token_limit = ${DEFAULT_HOSTED_CODEX_AUTO_COMPACT_TOKEN_LIMIT}`,
    `log_dir = ${tomlString(DEFAULT_HOSTED_CODEX_LOG_DIR)}`,
    `approval_policy = ${tomlString(DEFAULT_HOSTED_CODEX_APPROVAL_POLICY)}`,
    `sandbox_mode = ${tomlString(DEFAULT_HOSTED_CODEX_SANDBOX)}`,
    "check_for_update_on_startup = false",
    "",
    ...providerConfigLines,
    "# Hosted runs should not perform Codex plugin marketplace or remote plugin",
    "# sync work on cold wake; Murph owns the hosted runtime tool surface.",
    "[features]",
    "plugins = false",
    "",
    "# Keep Codex skill file instructions out of hosted prompts. Their temporary",
    "# runner paths change on each wake and break provider prefix caching.",
    "[skills]",
    "include_instructions = false",
    "",
    "[skills.bundled]",
    "enabled = false",
    "",
    "[history]",
    'persistence = "none"',
    "",
    "[shell_environment_policy]",
    `inherit = ${tomlString(HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE)}`,
    `include_only = ${tomlStringArray(HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY)}`,
    "",
    "[shell_environment_policy.set]",
    `PATH = ${tomlString(HOSTED_RUNNER_EXECUTABLE_PATH)}`,
    "",
  ].join("\n");
}

function normalizeHostedCodexEnvString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function tomlQuotedKey(value: string): string {
  return tomlString(value);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

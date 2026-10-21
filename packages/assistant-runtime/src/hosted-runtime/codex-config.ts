import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildHostedCodexBehaviorTomlLines, HOSTED_CODEX_AUTO_COMPACT_TOKEN_LIMIT } from "@murphai/hosted-execution/codex-behavior";
import {
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
  resolveAssistantSkillsRoot,
} from "@murphai/assistant-engine/assistant-skill-assets";
import {
  buildMurphHostedPermissionProfileTomlLines,
} from "@murphai/hosted-execution/assistant-permissions";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
  HOSTED_RUNTIME_SUBAGENT_MODEL_OVERRIDES_ALLOWED_ENV,
} from "@murphai/hosted-execution/env";
import {
  parseHostedLocalCodexSubscriptionHostAuth,
  parseHostedLocalCodexSubscriptionSeedAuth,
} from "@murphai/hosted-execution/hosted-codex-subscription-auth";
import {
  HostedAssistantConfigurationError,
  HOSTED_ASSISTANT_ALLOWED_PROVIDER_IDS,
  HOSTED_ASSISTANT_API_KEY_ENV,
  HOSTED_ASSISTANT_BASE_URL_ENV,
  HOSTED_ASSISTANT_CODEX_COMMAND_ENV,
  HOSTED_ASSISTANT_OSS_ENV,
  HOSTED_ASSISTANT_PROFILE_ENV,
  HOSTED_ASSISTANT_PROVIDER_NAME_ENV,
} from "@murphai/operator-config/hosted-assistant-config";
import {
  type AssistantCodexModelProviderConfig,
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
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
  resolveHostedOperatorModelProvider,
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

export function resolveHostedCodexModelCatalogPath(input: {
  imageCatalogPath: string | undefined;
  astraAllowed: boolean | undefined;
}): string | undefined {
  const catalogPath = input.imageCatalogPath?.trim();
  return catalogPath && input.astraAllowed === true ? `${catalogPath}.astra` : catalogPath;
}

const HOSTED_CODEX_CONFIG_FILE_NAME = "config.toml";
const HOSTED_CODEX_AUTH_FILE_NAME = "auth.json";
const DEFAULT_HOSTED_CODEX_REASONING_EFFORT = "low";
const DEFAULT_HOSTED_CODEX_APPROVAL_POLICY = "never";
const DEFAULT_HOSTED_CODEX_SANDBOX = "danger-full-access";
const DEFAULT_HOSTED_CODEX_LOG_DIR = "/tmp/murph-codex-log";
const HOSTED_CODEX_PROVIDER_REQUEST_MAX_RETRIES = 4;
// Hosted runs get one WebSocket attempt, then Codex replays the request over
// HTTPS. Repeating the full idle window here can outlive the enclosing hosted
// attempt and make Codex's native transport fallback unreachable.
const HOSTED_CODEX_PROVIDER_STREAM_MAX_RETRIES = 0;
// Native Responses compaction shares this window with ordinary sampling and
// can be silent while producing its replacement history. A 30-second window
// can abort valid slow compactions. Keep retries owned by Codex
// and retain the existing outer attempt/idle-maintenance wall-clock bounds.
// The deployed Codex patch separately fails a WebSocket request that receives
// no provider frame within 15 seconds, so a dropped reused socket falls back
// to HTTPS without waiting for this window.
const HOSTED_CODEX_PROVIDER_STREAM_IDLE_TIMEOUT_MS = 90_000;
export function hostedCodexProviderTransportDiagnostics() {
  return {
    codexProviderRequestMaxRetries: HOSTED_CODEX_PROVIDER_REQUEST_MAX_RETRIES,
    codexProviderStreamIdleTimeoutMs: HOSTED_CODEX_PROVIDER_STREAM_IDLE_TIMEOUT_MS,
    codexProviderStreamMaxRetries: HOSTED_CODEX_PROVIDER_STREAM_MAX_RETRIES,
  } as const;
}
const HOSTED_CODEX_REJECTED_SEED_ENV_KEYS = [
  HOSTED_ASSISTANT_API_KEY_ENV,
  HOSTED_ASSISTANT_BASE_URL_ENV,
  HOSTED_ASSISTANT_CODEX_COMMAND_ENV,
  HOSTED_ASSISTANT_OSS_ENV,
  HOSTED_ASSISTANT_PROFILE_ENV,
  HOSTED_ASSISTANT_PROVIDER_NAME_ENV,
  // Auth token material must never linger in the runtime process env; in
  // dev subscription mode it is persisted to CODEX_HOME/auth.json instead.
  HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
] as const;
const HOSTED_CODEX_SUPPORTED_PROVIDER_IDS = new Set<string>(
  HOSTED_ASSISTANT_ALLOWED_PROVIDER_IDS,
);
const HOSTED_CODEX_SUPPORTED_PROVIDER_LABEL =
  [...HOSTED_CODEX_SUPPORTED_PROVIDER_IDS].join(" or ");
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

export function projectHostedRuntimeProcessEnvironment(
  input: Pick<HostedCodexRuntimeEnvironmentInput, "runtimeEnv">,
): Record<string, string> {
  const runtimeEnv = stripHostedCodexRejectedSeedEnv(input.runtimeEnv);
  runtimeEnv.PATH = buildHostedRunnerExecutablePath(runtimeEnv.PATH);
  Object.assign(runtimeEnv, {
    [HOSTED_RUNTIME_PROCESS_ENV]: "1",
    [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: resolveAssistantSkillsRoot(),
  });
  return runtimeEnv;
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
  const codexHome = path.join(input.operatorHomeRoot, HOSTED_CODEX_CONFIG_DIR_NAME);
  const codexConfigPath = path.join(codexHome, HOSTED_CODEX_CONFIG_FILE_NAME);
  const codexAuthPath = path.join(codexHome, HOSTED_CODEX_AUTH_FILE_NAME);
  const openAiProvider = providerConfig.id === HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID;
  const seededChatGptAuthJson = openAiProvider
    ? readHostedCodexChatGptAuthJson(input.runtimeEnv)
    : null;

  await mkdir(codexHome, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(codexHome, 0o700);
  if (!openAiProvider) {
    await rm(codexAuthPath, { force: true });
  }
  let chatGptAuthKind = openAiProvider
    ? await readHostedCodexAuthKind(codexAuthPath)
    : null;
  if (
    chatGptAuthKind === "invalid"
    || (chatGptAuthKind === "managed" && seededChatGptAuthJson !== null)
  ) {
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
  const chatGptAuth = openAiProvider && chatGptAuthKind !== null;
  const apiKeyValue = normalizeHostedCodexEnvString(input.runtimeEnv[providerConfig.envKey]);
  if (!chatGptAuth && !apiKeyValue) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_REQUIRED",
      `Hosted assistant provider ${providerConfig.id} requires ${providerConfig.envKey} in the isolated runtime environment.`,
    );
  }

  const runtimeEnv = projectHostedRuntimeProcessEnvironment(input);
  const hostedModel = normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_MODEL);
  delete runtimeEnv.HOSTED_ASSISTANT_MODEL;
  Object.assign(runtimeEnv, {
    CODEX_HOME: codexHome,
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
      ? HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID
      : providerConfig.id,
  });
  await writeFile(
    codexConfigPath,
    buildHostedCodexConfigToml({
      chatGptAuth,
      model: normalizeHostedCodexEnvString(runtimeEnv.HOSTED_ASSISTANT_MODEL),
      exposeSpawnAgentModelOverrides:
        input.runtimeEnv[HOSTED_RUNTIME_SUBAGENT_MODEL_OVERRIDES_ALLOWED_ENV]
          === "1",
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
      parseHostedLocalCodexSubscriptionHostAuth(parsed);
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
  const resolvedProviderConfig = input.provider
    && HOSTED_CODEX_SUPPORTED_PROVIDER_IDS.has(input.provider)
    ? resolveAssistantCodexModelProviderConfig(input.provider)
    : null;
  if (!resolvedProviderConfig) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `Hosted Codex runtime only supports HOSTED_ASSISTANT_PROVIDER=${HOSTED_CODEX_SUPPORTED_PROVIDER_LABEL}.`,
    );
  }
  const providerConfig = resolvedProviderConfig.id === OPENAI_CODEX_MODEL_PROVIDER_CONFIG.id
    ? {
        ...resolvedProviderConfig,
        id: HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
      }
    : resolvedProviderConfig;

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
    id: HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
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

function buildHostedCodexProviderTomlLines(input: {
  provider: AssistantCodexModelProviderConfig;
  chatGptAuth?: boolean;
}): string[] {
  const modelProviderId = input.chatGptAuth
    ? HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID
    : input.provider.id;
  const transport = hostedCodexProviderTransportDiagnostics();
  return [
    `[model_providers.${tomlQuotedKey(modelProviderId)}]`,
    `name = ${tomlString(input.provider.name)}`,
    ...(input.chatGptAuth
      ? []
      : [
          `base_url = ${tomlString(input.provider.baseUrl)}`,
          `env_key = ${tomlString(input.provider.envKey)}`,
        ]),
    `wire_api = ${tomlString(input.provider.wireApi)}`,
    ...(input.provider.supportsWebSockets
      ? ["supports_websockets = true"]
      : []),
    `stream_idle_timeout_ms = ${transport.codexProviderStreamIdleTimeoutMs}`,
    `requires_openai_auth = ${input.chatGptAuth ? "true" : "false"}`,
    `request_max_retries = ${transport.codexProviderRequestMaxRetries}`,
    `stream_max_retries = ${transport.codexProviderStreamMaxRetries}`,
    "",
  ];
}

export function buildHostedCodexConfigToml(input: {
  chatGptAuth?: boolean;
  exposeSpawnAgentModelOverrides: boolean;
  model: string | null;
  provider: AssistantCodexModelProviderConfig;
  reasoningEffort: string | null;
}): string {
  const modelProviderId = input.chatGptAuth
    ? HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID
    : input.provider.id;
  const operatorModelProvider = resolveHostedOperatorModelProvider(modelProviderId);
  const providerConfigLines = [
    ...buildHostedCodexProviderTomlLines(input),
    ...(input.chatGptAuth ? buildHostedCodexProviderTomlLines({
      provider: { ...OPENAI_CODEX_MODEL_PROVIDER_CONFIG, id: HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID },
    }) : []),
    ...(operatorModelProvider === modelProviderId ? [] : buildHostedCodexProviderTomlLines({
      provider: {
        ...OPENAI_CODEX_MODEL_PROVIDER_CONFIG,
        id: operatorModelProvider,
        ...(operatorModelProvider === HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID
          ? { baseUrl: input.provider.baseUrl }
          : {}),
      },
    })),
  ];

  return [
    ...(input.model ? [`model = ${tomlString(input.model)}`] : []),
    ...(input.chatGptAuth ? ['cli_auth_credentials_store = "file"'] : []),
    `model_provider = ${tomlString(modelProviderId)}`,
    ...(input.reasoningEffort
      ? [`model_reasoning_effort = ${tomlString(input.reasoningEffort)}`]
      : []),
    `model_auto_compact_token_limit = ${HOSTED_CODEX_AUTO_COMPACT_TOKEN_LIMIT}`,
    `log_dir = ${tomlString(DEFAULT_HOSTED_CODEX_LOG_DIR)}`,
    `approval_policy = ${tomlString(DEFAULT_HOSTED_CODEX_APPROVAL_POLICY)}`,
    `sandbox_mode = ${tomlString(DEFAULT_HOSTED_CODEX_SANDBOX)}`,
    "check_for_update_on_startup = false",
    // Login shells re-source /etc/profile, which resets PATH to the stock
    // system dirs and drops /app/node_modules/.bin (vault-cli). The runner
    // image has no profile.d content worth sourcing, so force non-login
    // shells and let shell_environment_policy own the exec environment.
    "allow_login_shell = false",
    "",
    ...providerConfigLines,
    ...buildMurphHostedPermissionProfileTomlLines(),
    ...buildHostedCodexBehaviorTomlLines(input),
    "[shell_environment_policy]",
    `inherit = ${tomlString(HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE)}`,
    // include_only is the single gate for shell env. Codex's default
    // *KEY*/*TOKEN*/*SECRET* excludes run before include_only and can only
    // subtract deliberately allowlisted vars (App Server proxy token, provider keys),
    // so they add no protection here and must stay off.
    "ignore_default_excludes = true",
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

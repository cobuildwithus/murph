import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from "@murphai/hosted-execution/cli-runtime-bridge";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "./launch-spec.ts";
import {
  maybeInstallHostedE2ECodexAppServerStub,
} from "./codex-e2e-app-server-stub.ts";
import {
  HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV,
} from "./codex-runtime-env.ts";

const HOSTED_CODEX_CONFIG_DIR_NAME = ".codex-hosted";
const HOSTED_CODEX_CONFIG_FILE_NAME = "config.toml";
const DEFAULT_HOSTED_CODEX_REASONING_EFFORT = "medium";
const DEFAULT_HOSTED_CODEX_APPROVAL_POLICY = "never";
const DEFAULT_HOSTED_CODEX_SANDBOX = "danger-full-access";
const DEFAULT_HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE = "none";
const DEFAULT_HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY = [
  "CI",
  "CODEX_HOME",
  "COLORTERM",
  "CURL_CA_BUNDLE",
  "FORCE_COLOR",
  "HOME",
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NODE_EXTRA_CA_CERTS",
  "NO_COLOR",
  "PATH",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "VAULT",
] as const;
const HOSTED_CODEX_REJECTED_SEED_ENV_KEYS = [
  HOSTED_ASSISTANT_API_KEY_ENV,
  HOSTED_ASSISTANT_BASE_URL_ENV,
  HOSTED_ASSISTANT_CODEX_COMMAND_ENV,
  HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS_ENV,
  HOSTED_ASSISTANT_OSS_ENV,
  HOSTED_ASSISTANT_PROFILE_ENV,
  HOSTED_ASSISTANT_PROVIDER_NAME_ENV,
] as const;
const HOSTED_CODEX_SUPPORTED_PROVIDER_LABEL =
  OPENAI_CODEX_MODEL_PROVIDER_CONFIG.id;
const HOSTED_CODEX_LOCAL_TEST_MODEL_PROVIDER_ID = "openai-local-test";

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

  const providerConfig = resolveHostedCodexModelProviderConfig({
    provider: normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_PROVIDER),
    runtimeEnv: input.runtimeEnv,
  });
  const usesTestProviderBaseUrlOverride =
    normalizeHostedCodexEnvString(
      input.runtimeEnv[HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV],
    ) !== null;
  const apiKeyValue = normalizeHostedCodexEnvString(input.runtimeEnv[providerConfig.envKey]);

  if (!apiKeyValue) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_REQUIRED",
      `Hosted assistant provider ${providerConfig.id} requires ${providerConfig.envKey} in the isolated runtime environment.`,
    );
  }

  const codexHome = path.join(input.operatorHomeRoot, HOSTED_CODEX_CONFIG_DIR_NAME);
  const codexConfigPath = path.join(codexHome, HOSTED_CODEX_CONFIG_FILE_NAME);
  const runtimeEnv = stripHostedCodexRejectedSeedEnv(input.runtimeEnv);
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
    [HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV]: providerConfig.id,
  });

  await mkdir(codexHome, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(codexHome, 0o700);
  await writeFile(
    codexConfigPath,
    buildHostedCodexConfigToml({
      disableProviderRetries: usesTestProviderBaseUrlOverride,
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
  await maybeInstallHostedE2ECodexAppServerStub({
    codexHome,
    runtimeEnv,
  });

  return {
    codexConfigPath,
    codexHome,
    runtimeEnv,
  };
}

function stripHostedCodexRejectedSeedEnv(
  runtimeEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  const nextEnv = { ...runtimeEnv };

  for (const key of HOSTED_CODEX_REJECTED_SEED_ENV_KEYS) {
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
  const providerConfig = input.provider === OPENAI_CODEX_MODEL_PROVIDER_CONFIG.id
    ? resolveAssistantCodexModelProviderConfig(input.provider)
    : null;
  if (!providerConfig) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      `Hosted Codex runtime only supports HOSTED_ASSISTANT_PROVIDER=${HOSTED_CODEX_SUPPORTED_PROVIDER_LABEL}.`,
    );
  }

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
    id: HOSTED_CODEX_LOCAL_TEST_MODEL_PROVIDER_ID,
    baseUrl: url.toString(),
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
  disableProviderRetries?: boolean;
  model: string | null;
  provider: AssistantCodexModelProviderConfig;
  reasoningEffort: string;
}): string {
  const providerConfigLines = isHostedCodexBuiltInProvider(input.provider)
    ? []
    : [
        `[model_providers.${tomlQuotedKey(input.provider.id)}]`,
        `name = ${tomlString(input.provider.name)}`,
        `base_url = ${tomlString(input.provider.baseUrl)}`,
        `env_key = ${tomlString(input.provider.envKey)}`,
        `wire_api = ${tomlString(input.provider.wireApi)}`,
        ...(input.disableProviderRetries
          ? [
              "request_max_retries = 0",
              "stream_max_retries = 0",
            ]
          : []),
        "",
      ];

  return [
    ...(input.model ? [`model = ${tomlString(input.model)}`] : []),
    `model_provider = ${tomlString(input.provider.id)}`,
    `model_reasoning_effort = ${tomlString(input.reasoningEffort)}`,
    `approval_policy = ${tomlString(DEFAULT_HOSTED_CODEX_APPROVAL_POLICY)}`,
    `sandbox_mode = ${tomlString(DEFAULT_HOSTED_CODEX_SANDBOX)}`,
    "",
    ...providerConfigLines,
    "# Keep Codex skill file instructions out of hosted prompts. Their temporary",
    "# runner paths change on each wake and break provider prefix caching.",
    "[skills]",
    "include_instructions = false",
    "",
    "[skills.bundled]",
    "enabled = false",
    "",
    "[shell_environment_policy]",
    `inherit = ${tomlString(DEFAULT_HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE)}`,
    `include_only = ${tomlStringArray(DEFAULT_HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY)}`,
    "",
  ].join("\n");
}

function isHostedCodexBuiltInProvider(
  provider: AssistantCodexModelProviderConfig,
): boolean {
  return provider.id === OPENAI_CODEX_MODEL_PROVIDER_CONFIG.id
    && provider.baseUrl === OPENAI_CODEX_MODEL_PROVIDER_CONFIG.baseUrl
    && provider.envKey === OPENAI_CODEX_MODEL_PROVIDER_CONFIG.envKey
    && provider.wireApi === OPENAI_CODEX_MODEL_PROVIDER_CONFIG.wireApi;
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

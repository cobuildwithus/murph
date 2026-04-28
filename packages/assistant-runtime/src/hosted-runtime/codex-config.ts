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
  HOSTED_ASSISTANT_ZERO_DATA_RETENTION_ENV,
} from "@murphai/operator-config/hosted-assistant-config";
import {
  VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
} from "@murphai/operator-config/assistant/target-runtime";

const HOSTED_CODEX_CONFIG_DIR_NAME = ".codex-hosted";
const HOSTED_CODEX_CONFIG_FILE_NAME = "config.toml";
const DEFAULT_HOSTED_CODEX_MODEL = "gpt-5.5";
const DEFAULT_HOSTED_CODEX_REASONING_EFFORT = "medium";
const DEFAULT_HOSTED_CODEX_APPROVAL_POLICY = "never";
const DEFAULT_HOSTED_CODEX_SANDBOX = "danger-full-access";
const HOSTED_CODEX_REJECTED_SEED_ENV_KEYS = [
  HOSTED_ASSISTANT_API_KEY_ENV,
  HOSTED_ASSISTANT_BASE_URL_ENV,
  HOSTED_ASSISTANT_CODEX_COMMAND_ENV,
  HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS_ENV,
  HOSTED_ASSISTANT_OSS_ENV,
  HOSTED_ASSISTANT_PROFILE_ENV,
  HOSTED_ASSISTANT_PROVIDER_NAME_ENV,
  HOSTED_ASSISTANT_ZERO_DATA_RETENTION_ENV,
] as const;

export interface HostedCodexRuntimeEnvironmentInput {
  operatorHomeRoot: string;
  runtimeEnv: Readonly<Record<string, string>>;
}

export interface HostedCodexRuntimeEnvironmentResult {
  codexConfigPath: string | null;
  codexHome: string | null;
  runtimeEnv: Record<string, string>;
}

export async function prepareHostedCodexRuntimeEnvironment(
  input: HostedCodexRuntimeEnvironmentInput,
): Promise<HostedCodexRuntimeEnvironmentResult> {
  const provider = normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_PROVIDER);

  if (provider !== VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG.id) {
    return {
      codexConfigPath: null,
      codexHome: null,
      runtimeEnv: { ...input.runtimeEnv },
    };
  }

  const providerConfig = VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG;
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
  Object.assign(runtimeEnv, {
    CODEX_HOME: codexHome,
    HOSTED_ASSISTANT_MODEL:
      normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_MODEL)
      ?? DEFAULT_HOSTED_CODEX_MODEL,
    HOSTED_ASSISTANT_REASONING_EFFORT:
      normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT)
      ?? DEFAULT_HOSTED_CODEX_REASONING_EFFORT,
    HOSTED_ASSISTANT_APPROVAL_POLICY:
      normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_APPROVAL_POLICY)
      ?? DEFAULT_HOSTED_CODEX_APPROVAL_POLICY,
    HOSTED_ASSISTANT_SANDBOX:
      normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_SANDBOX)
      ?? DEFAULT_HOSTED_CODEX_SANDBOX,
  });

  await mkdir(codexHome, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(codexHome, 0o700);
  await writeFile(
    codexConfigPath,
    buildHostedCodexConfigToml({
      model: runtimeEnv.HOSTED_ASSISTANT_MODEL,
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

function stripHostedCodexRejectedSeedEnv(
  runtimeEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  const nextEnv = { ...runtimeEnv };

  for (const key of HOSTED_CODEX_REJECTED_SEED_ENV_KEYS) {
    delete nextEnv[key];
  }

  return nextEnv;
}

export function buildHostedCodexConfigToml(input: {
  model: string;
  provider: typeof VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG;
  reasoningEffort: string;
}): string {
  return [
    `model = ${tomlString(input.model)}`,
    `model_provider = ${tomlString(input.provider.id)}`,
    `model_reasoning_effort = ${tomlString(input.reasoningEffort)}`,
    "",
    `[model_providers.${tomlQuotedKey(input.provider.id)}]`,
    `name = ${tomlString(input.provider.name)}`,
    `base_url = ${tomlString(input.provider.baseUrl)}`,
    `env_key = ${tomlString(input.provider.envKey)}`,
    `wire_api = ${tomlString(input.provider.wireApi)}`,
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

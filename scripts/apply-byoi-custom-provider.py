#!/usr/bin/env python3
"""Apply the fixed custom provider and native Responses egress slice.

Temporary branch tooling. Remove this file before the pull request is ready.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement anchor, found {count}")
    target.write_text(text.replace(old, new, 1))


def write_exact(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.read_text() == content:
        return
    target.write_text(content)


def patch_internal_host() -> None:
    replace_once(
        "apps/cloudflare/src/internal-hosts.ts",
        '''// Worker-mediated transcription is signed provider egress, not an internal
// control-plane host, so it stays out of
// CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.
export const CLOUDFLARE_HOSTED_TRANSCRIBE_HOST = "murph-transcribe.worker";
''',
        '''// Custom inference and transcription are signed provider egress, not internal
// control-plane hosts, so they stay out of
// CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.
export const CLOUDFLARE_HOSTED_CUSTOM_INFERENCE_HOST =
  "murph-custom-inference.worker";
export const CLOUDFLARE_HOSTED_CUSTOM_INFERENCE_BASE_URL =
  `http://${CLOUDFLARE_HOSTED_CUSTOM_INFERENCE_HOST}/v1`;
export const CLOUDFLARE_HOSTED_TRANSCRIBE_HOST = "murph-transcribe.worker";
''',
    )


def patch_hosted_config_constants() -> None:
    path = "packages/operator-config/src/hosted-assistant-config-constants.ts"
    replace_once(
        path,
        "export const HOSTED_ASSISTANT_REASONING_EFFORT_ENV = 'HOSTED_ASSISTANT_REASONING_EFFORT'\n",
        "export const HOSTED_ASSISTANT_REASONING_EFFORT_ENV = 'HOSTED_ASSISTANT_REASONING_EFFORT'\nexport const HOSTED_ASSISTANT_CONTEXT_WINDOW_TOKENS_ENV =\n  'HOSTED_ASSISTANT_CONTEXT_WINDOW_TOKENS'\n",
    )
    replace_once(
        path,
        '''  HOSTED_ASSISTANT_MODEL_ENV,
  HOSTED_ASSISTANT_APPROVAL_POLICY_ENV,
''',
        '''  HOSTED_ASSISTANT_MODEL_ENV,
  HOSTED_ASSISTANT_CONTEXT_WINDOW_TOKENS_ENV,
  HOSTED_ASSISTANT_APPROVAL_POLICY_ENV,
''',
    )
    replace_once(
        path,
        '''export const HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES = [
  'OPENAI_API_KEY',
  'VENICE_API_KEY',
] as const
''',
        '''export const HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES = [
  'MURPH_CUSTOM_INFERENCE_API_KEY',
  'OPENAI_API_KEY',
  'VENICE_API_KEY',
] as const
''',
    )


def patch_model_credential_categories() -> None:
    path = "packages/assistant-runtime/src/hosted-env-categories.ts"
    replace_once(
        path,
        '''  assistantConfigured: [
    "OPENAI_API_KEY",
    "VENICE_API_KEY",
  ],
''',
        '''  assistantConfigured: [
    "MURPH_CUSTOM_INFERENCE_API_KEY",
    "OPENAI_API_KEY",
    "VENICE_API_KEY",
  ],
''',
    )
    replace_once(
        path,
        '''export const HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES = [
  "OPENAI_API_KEY",
  "VENICE_API_KEY",
] as const;
''',
        '''export const HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES = [
  "MURPH_CUSTOM_INFERENCE_API_KEY",
  "OPENAI_API_KEY",
  "VENICE_API_KEY",
] as const;
''',
    )


def patch_target_runtime() -> None:
    path = "packages/operator-config/src/assistant/target-runtime.ts"
    replace_once(
        path,
        "export const HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID = 'hosted-openai'\n",
        "export const HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID = 'hosted-openai'\nexport const HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID =\n  'hosted-custom-inference'\nexport const HOSTED_CUSTOM_INFERENCE_API_KEY_ENV =\n  'MURPH_CUSTOM_INFERENCE_API_KEY'\n",
    )
    replace_once(
        path,
        '''  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
''',
        '''  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
''',
    )
    replace_once(
        path,
        '''export const OPENAI_CODEX_MODEL_PROVIDER_CONFIG = {
''',
        '''export const HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_CONFIG = {
  id: HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
  name: 'Murph Custom Inference',
  baseUrl: 'http://murph-custom-inference.worker/v1',
  envKey: HOSTED_CUSTOM_INFERENCE_API_KEY_ENV,
  failureHint:
    'The selected custom inference endpoint is unavailable or incompatible. Murph did not fall back to managed inference.',
  wireApi: 'responses',
} as const satisfies AssistantCodexModelProviderConfig

export const OPENAI_CODEX_MODEL_PROVIDER_CONFIG = {
''',
    )
    replace_once(
        path,
        '''    return {
      continuityFingerprint,
      executionDriver: 'codex-app-server',
      modelProvider,
      resumeKind: 'codex-thread',
      supportsNativeResume: true,
      supportsReasoningEffort: true,
      target: { kind: 'codex-cli' },
    }
''',
        '''    return {
      continuityFingerprint,
      executionDriver: 'codex-app-server',
      modelProvider,
      resumeKind: 'codex-thread',
      supportsNativeResume: true,
      supportsReasoningEffort:
        modelProvider !== HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
      target: { kind: 'codex-cli' },
    }
''',
    )
    replace_once(
        path,
        '''export function isCodexReservedModelProviderId(
  value: string | null | undefined,
): boolean {
''',
        '''export function assistantCodexModelProviderRequiresModelThreadCompatibility(
  value: string | null | undefined,
): boolean {
  return normalizeAssistantCodexModelProvider(value) ===
    HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID
}

export function isCodexReservedModelProviderId(
  value: string | null | undefined,
): boolean {
''',
    )
    replace_once(
        path,
        '''    modelProvider: normalizeAssistantCodexModelProvider(input.modelProvider),
    sandbox: normalizeNullableString(input.sandbox),
''',
        '''    modelProvider: normalizeAssistantCodexModelProvider(input.modelProvider),
    model: assistantCodexModelProviderRequiresModelThreadCompatibility(
        input.modelProvider,
      )
      ? normalizeNullableString(input.model)
      : null,
    sandbox: normalizeNullableString(input.sandbox),
''',
    )


def patch_thread_compatibility() -> None:
    path = "packages/assistant-engine/src/assistant/codex-thread-route.ts"
    replace_once(
        path,
        '''import {
  type AssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant-cli-contracts'
''',
        '''import {
  type AssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  assistantCodexModelProviderRequiresModelThreadCompatibility,
} from '@murphai/operator-config/assistant/target-runtime'
''',
    )
    replace_once(
        path,
        '''        modelProvider: input.providerOptions.modelProvider ?? null,
        sandbox: input.providerOptions.sandbox,
''',
        '''        modelProvider: input.providerOptions.modelProvider ?? null,
        model: assistantCodexModelProviderRequiresModelThreadCompatibility(
            input.providerOptions.modelProvider,
          )
          ? input.providerOptions.model
          : null,
        sandbox: input.providerOptions.sandbox,
''',
    )


def patch_codex_config() -> None:
    path = "packages/assistant-runtime/src/hosted-runtime/codex-config.ts"
    replace_once(
        path,
        '''  type AssistantCodexModelProviderConfig,
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
''',
        '''  type AssistantCodexModelProviderConfig,
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_CONFIG,
  HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
''',
    )
    replace_once(
        path,
        '''  OPENAI_CODEX_MODEL_PROVIDER_CONFIG.id,
  VENICE_CODEX_MODEL_PROVIDER_ID,
''',
        '''  OPENAI_CODEX_MODEL_PROVIDER_CONFIG.id,
  HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
  VENICE_CODEX_MODEL_PROVIDER_ID,
''',
    )
    replace_once(
        path,
        '''  const providerConfig = resolveHostedCodexModelProviderConfig({
    provider: normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_PROVIDER),
    runtimeEnv: input.runtimeEnv,
  });
''',
        '''  const providerConfig = resolveHostedCodexModelProviderConfig({
    provider: normalizeHostedCodexEnvString(input.runtimeEnv.HOSTED_ASSISTANT_PROVIDER),
    runtimeEnv: input.runtimeEnv,
  });
  const customInferenceProvider =
    providerConfig.id === HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID;
  const contextWindowTokens = customInferenceProvider
    ? requireHostedCustomInferenceContextWindowTokens(
        input.runtimeEnv.HOSTED_ASSISTANT_CONTEXT_WINDOW_TOKENS,
      )
    : null;
''',
    )
    replace_once(
        path,
        '''      provider: providerConfig,
      reasoningEffort: runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT,
''',
        '''      contextWindowTokens,
      provider: providerConfig,
      reasoningEffort: customInferenceProvider
        ? null
        : runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT,
''',
    )
    replace_once(
        path,
        '''  const resolvedProviderConfig = input.provider
    && HOSTED_CODEX_SUPPORTED_PROVIDER_IDS.has(input.provider)
    ? resolveAssistantCodexModelProviderConfig(input.provider)
    : null;
''',
        '''  const resolvedProviderConfig = input.provider
    && HOSTED_CODEX_SUPPORTED_PROVIDER_IDS.has(input.provider)
    ? input.provider === HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID
      ? HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_CONFIG
      : resolveAssistantCodexModelProviderConfig(input.provider)
    : null;
''',
    )
    replace_once(
        path,
        '''export function buildHostedCodexConfigToml(input: {
  chatGptAuth?: boolean;
  model: string | null;
  provider: AssistantCodexModelProviderConfig;
  reasoningEffort: string;
}): string {
''',
        '''export function buildHostedCodexConfigToml(input: {
  chatGptAuth?: boolean;
  contextWindowTokens?: number | null;
  model: string | null;
  provider: AssistantCodexModelProviderConfig;
  reasoningEffort: string | null;
}): string {
''',
    )
    replace_once(
        path,
        '''  const providerConfigLines = [
''',
        '''  const customInferenceProvider =
    input.provider.id === HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID;
  const operatorMemoriesEnabled = !customInferenceProvider;
  const multiAgentEnabled = !customInferenceProvider;
  const autoCompactTokenLimit = input.contextWindowTokens === null
      || input.contextWindowTokens === undefined
    ? DEFAULT_HOSTED_CODEX_AUTO_COMPACT_TOKEN_LIMIT
    : Math.min(
        DEFAULT_HOSTED_CODEX_AUTO_COMPACT_TOKEN_LIMIT,
        Math.max(4_096, Math.floor(input.contextWindowTokens * 0.75)),
      );
  const providerConfigLines = [
''',
    )
    replace_once(
        path,
        '''    `request_max_retries = ${HOSTED_CODEX_PROVIDER_REQUEST_MAX_RETRIES}`,
''',
        '''    `request_max_retries = ${
      customInferenceProvider ? 1 : HOSTED_CODEX_PROVIDER_REQUEST_MAX_RETRIES
    }`,
''',
    )
    replace_once(
        path,
        '''    `model_provider = ${tomlString(modelProviderId)}`,
    `model_reasoning_effort = ${tomlString(input.reasoningEffort)}`,
    `model_auto_compact_token_limit = ${DEFAULT_HOSTED_CODEX_AUTO_COMPACT_TOKEN_LIMIT}`,
''',
        '''    `model_provider = ${tomlString(modelProviderId)}`,
    ...(input.reasoningEffort
      ? [`model_reasoning_effort = ${tomlString(input.reasoningEffort)}`]
      : []),
    ...(input.contextWindowTokens
      ? [`model_context_window = ${input.contextWindowTokens}`]
      : []),
    `model_auto_compact_token_limit = ${autoCompactTokenLimit}`,
''',
    )
    replace_once(
        path,
        '''    `memories = ${HOSTED_CODEX_OPERATOR_MEMORY_CONFIG.featureEnabled}`,
''',
        '''    `memories = ${
      operatorMemoriesEnabled && HOSTED_CODEX_OPERATOR_MEMORY_CONFIG.featureEnabled
    }`,
''',
    )
    replace_once(
        path,
        '''    "[features.multi_agent_v2]",
    "enabled = true",
    "# V2 counts the root in this limit: four means root plus three children.",
    "max_concurrent_threads_per_session = 4",
    `usage_hint_text = ${tomlString(HOSTED_CODEX_MULTI_AGENT_USAGE_HINT_TEXT)}`,
    `multi_agent_mode_hint_text = ${tomlString(HOSTED_CODEX_MULTI_AGENT_MODE_HINT_TEXT)}`,
    `subagent_usage_hint_text = ${tomlString(HOSTED_CODEX_SUBAGENT_USAGE_HINT_TEXT)}`,
''',
        '''    "[features.multi_agent_v2]",
    `enabled = ${multiAgentEnabled}`,
    ...(multiAgentEnabled
      ? [
          "# V2 counts the root in this limit: four means root plus three children.",
          "max_concurrent_threads_per_session = 4",
          `usage_hint_text = ${tomlString(HOSTED_CODEX_MULTI_AGENT_USAGE_HINT_TEXT)}`,
          `multi_agent_mode_hint_text = ${tomlString(HOSTED_CODEX_MULTI_AGENT_MODE_HINT_TEXT)}`,
          `subagent_usage_hint_text = ${tomlString(HOSTED_CODEX_SUBAGENT_USAGE_HINT_TEXT)}`,
        ]
      : []),
''',
    )
    replace_once(
        path,
        '''    `use_memories = ${HOSTED_CODEX_OPERATOR_MEMORY_CONFIG.useMemories}`,
    `generate_memories = ${HOSTED_CODEX_OPERATOR_MEMORY_CONFIG.generateMemories}`,
''',
        '''    `use_memories = ${
      operatorMemoriesEnabled && HOSTED_CODEX_OPERATOR_MEMORY_CONFIG.useMemories
    }`,
    `generate_memories = ${
      operatorMemoriesEnabled && HOSTED_CODEX_OPERATOR_MEMORY_CONFIG.generateMemories
    }`,
''',
    )
    replace_once(
        path,
        '''function normalizeHostedCodexUrlHostname(hostname: string): string {
  return hostname.replace(/^\\[/u, "").replace(/\\]$/u, "");
}
''',
        '''function normalizeHostedCodexUrlHostname(hostname: string): string {
  return hostname.replace(/^\\[/u, "").replace(/\\]$/u, "");
}

function requireHostedCustomInferenceContextWindowTokens(value: unknown): number {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9]+$/u.test(normalized)) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      "Custom inference requires HOSTED_ASSISTANT_CONTEXT_WINDOW_TOKENS.",
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 8_192 || parsed > 2_000_000) {
    throw new HostedAssistantConfigurationError(
      "HOSTED_ASSISTANT_CONFIG_INVALID",
      "HOSTED_ASSISTANT_CONTEXT_WINDOW_TOKENS is outside the supported range.",
    );
  }
  return parsed;
}
''',
    )


def patch_runtime_invocation_custom_provider() -> None:
    path = "apps/cloudflare/src/user-runner/runtime-invocation.ts"
    replace_once(
        path,
        '''import {
  readHostedProviderCredentialDiagnosticKind,
} from "../hosted-provider-credential-diagnostics.js";
''',
        '''import {
  readHostedProviderCredentialDiagnosticKind,
} from "../hosted-provider-credential-diagnostics.js";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "../runner-injected-credential.ts";
''',
    )
    replace_once(
        path,
        "const HOSTED_RUNNER_WORKERS_AI_TRANSCRIBE_PROVIDER_KIND = \"workers_ai_transcribe\";\n",
        '''const HOSTED_RUNNER_WORKERS_AI_TRANSCRIBE_PROVIDER_KIND = "workers_ai_transcribe";
const HOSTED_CUSTOM_INFERENCE_PROVIDER = "hosted-custom-inference";
const HOSTED_CUSTOM_INFERENCE_API_KEY_ENV = "MURPH_CUSTOM_INFERENCE_API_KEY";
const HOSTED_CUSTOM_INFERENCE_CONTEXT_WINDOW_ENV =
  "HOSTED_ASSISTANT_CONTEXT_WINDOW_TOKENS";
''',
    )
    replace_once(
        path,
        '''    if (input.hostedAssistantProviderOverride !== null) {
      forwardedEnv.HOSTED_ASSISTANT_PROVIDER =
        input.hostedAssistantProviderOverride;
    }
    if (input.hostedAssistantModelOverride !== null) {
      forwardedEnv.HOSTED_ASSISTANT_MODEL =
        input.hostedAssistantModelOverride;
    }
    if (input.hostedAssistantReasoningEffortOverride !== null) {
      forwardedEnv.HOSTED_ASSISTANT_REASONING_EFFORT =
        input.hostedAssistantReasoningEffortOverride;
    }
''',
        '''    if (input.hostedAssistantCustomInferenceOverride !== null) {
      forwardedEnv.HOSTED_ASSISTANT_PROVIDER = HOSTED_CUSTOM_INFERENCE_PROVIDER;
      forwardedEnv.HOSTED_ASSISTANT_MODEL =
        input.hostedAssistantCustomInferenceOverride.modelAlias;
      forwardedEnv[HOSTED_CUSTOM_INFERENCE_API_KEY_ENV] =
        HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL;
      forwardedEnv[HOSTED_CUSTOM_INFERENCE_CONTEXT_WINDOW_ENV] =
        String(input.hostedAssistantCustomInferenceOverride.contextWindowTokens);
      delete forwardedEnv.HOSTED_ASSISTANT_REASONING_EFFORT;
    } else {
      if (input.hostedAssistantProviderOverride !== null) {
        forwardedEnv.HOSTED_ASSISTANT_PROVIDER =
          input.hostedAssistantProviderOverride;
      }
      if (input.hostedAssistantModelOverride !== null) {
        forwardedEnv.HOSTED_ASSISTANT_MODEL =
          input.hostedAssistantModelOverride;
      }
      if (input.hostedAssistantReasoningEffortOverride !== null) {
        forwardedEnv.HOSTED_ASSISTANT_REASONING_EFFORT =
          input.hostedAssistantReasoningEffortOverride;
      }
    }
''',
    )
    replace_once(
        path,
        '''        hostedAssistantProviderConfigured:
          typeof forwardedEnv.HOSTED_ASSISTANT_PROVIDER === "string"
          && forwardedEnv.HOSTED_ASSISTANT_PROVIDER.length > 0,
''',
        '''        hostedAssistantProviderConfigured:
          typeof forwardedEnv.HOSTED_ASSISTANT_PROVIDER === "string"
          && forwardedEnv.HOSTED_ASSISTANT_PROVIDER.length > 0,
        hostedAssistantCustomInferenceConfigured:
          input.hostedAssistantCustomInferenceOverride !== null,
''',
    )


def add_custom_inference_request_module() -> None:
    write_exact(
        "apps/cloudflare/src/runner-egress-custom-inference.ts",
        '''import {
  buildHostedCustomInferenceModelAlias,
} from "@murphai/hosted-execution/assistant-inference";
import type {
  HostedInferenceRuntimeTarget,
} from "./hosted-inference-runtime-target.ts";

export const HOSTED_CUSTOM_INFERENCE_RESPONSES_MAX_BODY_BYTES = 8 * 1024 * 1024;

export class HostedCustomInferenceRequestError extends Error {
  constructor(
    readonly code:
      | "CHAT_BRIDGE_UNAVAILABLE"
      | "IMAGE_INPUT_UNSUPPORTED"
      | "MODEL_ALIAS_MISMATCH"
      | "REQUEST_INVALID",
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "HostedCustomInferenceRequestError";
  }
}

export function buildHostedCustomInferenceUpstreamRequestBody(input: {
  body: ArrayBuffer;
  target: HostedInferenceRuntimeTarget;
}): string {
  if (input.target.protocol !== "responses") {
    throw new HostedCustomInferenceRequestError(
      "CHAT_BRIDGE_UNAVAILABLE",
      503,
      "Chat Completions compatibility is not enabled for this deployment.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input.body));
  } catch {
    throw invalidRequest();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalidRequest();
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.model !== buildHostedCustomInferenceModelAlias(input.target.revision)
  ) {
    throw new HostedCustomInferenceRequestError(
      "MODEL_ALIAS_MISMATCH",
      403,
      "The custom inference model alias did not match the active connection.",
    );
  }
  if (!input.target.supportsImages && containsImageInput(record.input)) {
    throw new HostedCustomInferenceRequestError(
      "IMAGE_INPUT_UNSUPPORTED",
      422,
      "The selected custom inference endpoint does not support image input.",
    );
  }

  const upstream = {
    ...record,
    model: input.target.model,
    parallel_tool_calls: false,
    store: false,
    stream: true,
  };
  delete upstream.include;
  delete upstream.prompt_cache_key;
  delete upstream.prompt_cache_retention;
  delete upstream.reasoning;
  delete upstream.service_tier;
  return JSON.stringify(upstream);
}

export function injectHostedCustomInferenceAuth(
  headers: Headers,
  target: HostedInferenceRuntimeTarget,
): void {
  switch (target.auth.kind) {
    case "bearer":
      headers.set("authorization", `Bearer ${target.auth.secret}`);
      return;
    case "api_key":
      headers.set("api-key", target.auth.secret);
      return;
    case "x_api_key":
      headers.set("x-api-key", target.auth.secret);
      return;
  }
}

function invalidRequest(): HostedCustomInferenceRequestError {
  return new HostedCustomInferenceRequestError(
    "REQUEST_INVALID",
    400,
    "The custom inference request was invalid.",
  );
}

function containsImageInput(value: unknown): boolean {
  const stack: unknown[] = [value];
  let visited = 0;
  while (stack.length > 0 && visited < 50_000) {
    const current = stack.pop();
    visited += 1;
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (record.type === "input_image" || "image_url" in record) return true;
    stack.push(...Object.values(record));
  }
  return false;
}
''',
    )


def patch_egress_intercept() -> None:
    path = "apps/cloudflare/src/runner-egress-intercept.ts"
    replace_once(
        path,
        '''  CLOUDFLARE_HOSTED_CONTAINER_FATAL_PATH,
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
''',
        '''  CLOUDFLARE_HOSTED_CONTAINER_FATAL_PATH,
  CLOUDFLARE_HOSTED_CUSTOM_INFERENCE_HOST,
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
''',
    )
    replace_once(
        path,
        '''import {
  readHostedProviderCredentialDiagnosticKind,
} from "./hosted-provider-credential-diagnostics.ts";
''',
        '''import {
  readHostedProviderCredentialDiagnosticKind,
} from "./hosted-provider-credential-diagnostics.ts";
import {
  openHostedInferenceRuntimeTarget,
} from "./hosted-inference-target-envelope.ts";
import {
  HOSTED_CUSTOM_INFERENCE_RESPONSES_MAX_BODY_BYTES,
  HostedCustomInferenceRequestError,
  buildHostedCustomInferenceUpstreamRequestBody,
  injectHostedCustomInferenceAuth,
} from "./runner-egress-custom-inference.ts";
''',
    )
    replace_once(
        path,
        '''interface HostedProviderEgressAuthorization {
  authorized: boolean;
''',
        '''interface HostedProviderEgressAuthorization {
  authorized: boolean;
  customInferenceEnvelope?: string | null;
''',
    )
    replace_once(
        path,
        '''  browserVaultReplicaStore: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.browserVaultReplicaStore,
  dataApi: HOSTED_DATA_API_RUNTIME_HOST,
''',
        '''  browserVaultReplicaStore: CLOUDFLARE_HOSTED_RUNTIME_HOSTS.browserVaultReplicaStore,
  customInference: CLOUDFLARE_HOSTED_CUSTOM_INFERENCE_HOST,
  dataApi: HOSTED_DATA_API_RUNTIME_HOST,
''',
    )
    replace_once(
        path,
        '''  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.browserVaultReplicaStore]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.dataApi]: handleHostedRunnerOpenInternetOutbound,
''',
        '''  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.browserVaultReplicaStore]: handleHostedRunnerInternalOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.customInference]:
    handleHostedRunnerCustomInferenceOutbound,
  [HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.dataApi]: handleHostedRunnerOpenInternetOutbound,
''',
    )
    replace_once(
        path,
        '''    await maybeHandleHostedDataApiRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleHostedTranscribeRequest({ ctx, env, request, url, userId })
''',
        '''    await maybeHandleHostedDataApiRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleCustomInferenceRequest({ ctx, env, request, url, userId })
    ?? await maybeHandleHostedTranscribeRequest({ ctx, env, request, url, userId })
''',
    )
    replace_once(
        path,
        '''export async function handleHostedRunnerOpenAiOutbound(
''',
        '''export async function handleHostedRunnerCustomInferenceOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  ctx: HostedRunnerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);
  return await requireHandledProviderEgress(
    await maybeHandleCustomInferenceRequest({
      ctx,
      env,
      request,
      url,
      userId: readHostedRunnerBoundUserId(request),
    }),
  );
}

export async function handleHostedRunnerOpenAiOutbound(
''',
    )
    replace_once(
        path,
        '''async function maybeHandleOpenAiRequest(input: {
''',
        '''async function maybeHandleCustomInferenceRequest(input: {
  ctx?: HostedRunnerOutboundContext;
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  upstreamFetchImpl?: typeof fetch;
  url: URL;
  userId: string | null;
}): Promise<Response | null> {
  if (input.url.hostname !== CLOUDFLARE_HOSTED_CUSTOM_INFERENCE_HOST) {
    return null;
  }
  if (
    input.request.method !== "POST"
    || input.url.pathname !== "/v1/responses"
    || !hasBearerCredentialSentinel(input.request.headers)
  ) {
    return disallowedProviderEgress();
  }

  const startedAt = Date.now();
  const authorization = await authorizeHostedProviderEgress({
    ctx: input.ctx,
    env: input.env,
    providerKind: "custom_inference",
    request: input.request,
    userId: input.userId,
  });
  if (!authorization.authorized) {
    return unauthorizedProviderEgress({
      authorization,
      providerKind: "custom_inference",
      request: input.request,
      startedAt,
      url: input.url,
    });
  }
  if (!authorization.customInferenceEnvelope) {
    return new Response("Custom inference is not active for this invocation.", {
      status: 409,
    });
  }

  let target;
  try {
    target = await openHostedInferenceRuntimeTarget({
      envelope: authorization.customInferenceEnvelope,
      source: input.env,
    });
  } catch {
    return new Response("Hosted custom inference configuration is unavailable.", {
      status: 500,
    });
  }
  const body = await readBoundedRequestBody(
    input.request,
    HOSTED_CUSTOM_INFERENCE_RESPONSES_MAX_BODY_BYTES,
  );
  if (body === null) {
    return new Response("Payload Too Large", { status: 413 });
  }

  let upstreamBody: string;
  try {
    upstreamBody = buildHostedCustomInferenceUpstreamRequestBody({
      body,
      target,
    });
  } catch (error) {
    if (error instanceof HostedCustomInferenceRequestError) {
      return new Response(error.message, { status: error.httpStatus });
    }
    return new Response("The custom inference request was invalid.", {
      status: 400,
    });
  }

  const headers = stripHostedProviderUpstreamHeaders(input.request.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  injectHostedCustomInferenceAuth(headers, target);
  return await fetchAuthorizedProviderUpstream({
    authorization,
    providerKind: "custom_inference",
    request: input.request,
    startedAt,
    upstreamRequest: await createHostedRunnerUpstreamRequest(
      input.request,
      new URL(target.endpointUrl),
      headers,
      {
        body: upstreamBody,
        redirect: "manual",
      },
    ),
    upstreamFetchImpl: input.upstreamFetchImpl,
    url: input.url,
  });
}

async function maybeHandleOpenAiRequest(input: {
''',
    )
    replace_once(
        path,
        '''  return {
    authorized: validation.owns,
    durationMs: Date.now() - input.startedAt,
''',
        '''  return {
    authorized: validation.owns,
    ...(validation.customInferenceEnvelope
      ? { customInferenceEnvelope: validation.customInferenceEnvelope }
      : {}),
    durationMs: Date.now() - input.startedAt,
''',
    )
    replace_once(
        path,
        '''function normalizeProviderEgressTokenValidationResult(value: unknown): {
  owns: boolean;
''',
        '''function normalizeProviderEgressTokenValidationResult(value: unknown): {
  customInferenceEnvelope?: string;
  owns: boolean;
''',
    )
    replace_once(
        path,
        '''  return {
    owns: true,
    rejectReason: null,
    writeFence: {
      attemptId: record.attemptId,
''',
        '''  return {
    ...(typeof record.customInferenceEnvelope === "string"
        && record.customInferenceEnvelope.length > 0
      ? { customInferenceEnvelope: record.customInferenceEnvelope }
      : {}),
    owns: true,
    rejectReason: null,
    writeFence: {
      attemptId: record.attemptId,
''',
    )
    replace_once(
        path,
        '''  stripped.delete("authorization");
  stripped.delete("cookie");
''',
        '''  stripped.delete("api-key");
  stripped.delete("authorization");
  stripped.delete("cookie");
''',
    )


def main() -> None:
    patch_internal_host()
    patch_hosted_config_constants()
    patch_model_credential_categories()
    patch_target_runtime()
    patch_thread_compatibility()
    patch_codex_config()
    patch_runtime_invocation_custom_provider()
    add_custom_inference_request_module()
    patch_egress_intercept()


if __name__ == "__main__":
    main()

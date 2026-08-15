import { createHash } from 'node:crypto'

import { normalizeNullableString } from './shared.js'
import { VaultCliError } from '../vault-cli-errors.js'

export const assistantExecutionDriverValues = [
  'codex-app-server',
] as const

export const assistantResumeKindValues = [
  'codex-thread',
] as const

export type AssistantExecutionDriver =
  (typeof assistantExecutionDriverValues)[number]
export type AssistantResumeKind = (typeof assistantResumeKindValues)[number]

export const assistantCodexModelProviderWireApiValues = ['responses'] as const

export type AssistantCodexModelProviderWireApi =
  (typeof assistantCodexModelProviderWireApiValues)[number]

export interface AssistantCodexModelProviderConfig {
  id: string
  name: string
  baseUrl: string
  envKey: string
  failureHint?: string
  supportsWebSockets?: boolean
  wireApi: AssistantCodexModelProviderWireApi
}

export interface AssistantCodexLocalOnboardingProviderConfig {
  defaultModel: string | null
  description: string
  label: string
  modelPrompt: string
  providerId: string
  selectableInLocalOnboarding: boolean
}

interface AssistantCodexModelProviderRegistration {
  config: AssistantCodexModelProviderConfig
  localOnboarding?: AssistantCodexLocalOnboardingProviderConfig
}

export const VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_ID = 'vercel-ai-gateway'
export const OPENAI_CODEX_MODEL_PROVIDER_ID = 'openai'
export const HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID = 'hosted-openai'
export const HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID =
  'hosted-custom-inference'
export const HOSTED_CUSTOM_INFERENCE_API_KEY_ENV =
  'MURPH_CUSTOM_INFERENCE_API_KEY'
// The hosted runtime writes this internal provider into its generated Codex
// config when local development uses ChatGPT subscription auth.
export const HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID =
  'hosted-chatgpt-openai'
// Hosted-local sends multiple providers through one recorder origin. Keep
// their reserved ids distinct so thread resume preserves production's provider
// handoff boundary without registered-provider CLI overrides replacing it.
export const HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID = 'openai-local-test'
export const HOSTED_LOCAL_TEST_VENICE_CODEX_MODEL_PROVIDER_ID =
  'venice-local-test'
export const VENICE_CODEX_MODEL_PROVIDER_ID = 'venice'

export function resolveAssistantCodexUsageProviderName(
  modelProviderId: string | null,
): string | null {
  return modelProviderId === HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID
    ? HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID
    : modelProviderId
}

export const CODEX_RESERVED_MODEL_PROVIDER_IDS = [
  OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
  HOSTED_LOCAL_TEST_VENICE_CODEX_MODEL_PROVIDER_ID,
  'ollama',
  'lmstudio',
] as const
const CODEX_RESERVED_MODEL_PROVIDER_ID_SET = new Set<string>(
  CODEX_RESERVED_MODEL_PROVIDER_IDS,
)

export const HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_CONFIG = {
  id: HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
  name: 'Murph Custom Inference',
  baseUrl: 'http://murph-custom-inference.worker/v1',
  envKey: HOSTED_CUSTOM_INFERENCE_API_KEY_ENV,
  failureHint:
    'The selected custom inference endpoint is unavailable or incompatible. Murph did not fall back to managed inference.',
  wireApi: 'responses',
} as const satisfies AssistantCodexModelProviderConfig

export const OPENAI_CODEX_MODEL_PROVIDER_CONFIG = {
  id: OPENAI_CODEX_MODEL_PROVIDER_ID,
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  envKey: 'OPENAI_API_KEY',
  supportsWebSockets: true,
  wireApi: 'responses',
} as const satisfies AssistantCodexModelProviderConfig

export const VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG = {
  id: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_ID,
  name: 'Vercel AI Gateway',
  baseUrl: 'https://ai-gateway.vercel.sh/v1',
  envKey: 'VERCEL_AI_API_KEY',
  wireApi: 'responses',
} as const satisfies AssistantCodexModelProviderConfig

export const VENICE_CODEX_MODEL_PROVIDER_CONFIG = {
  id: VENICE_CODEX_MODEL_PROVIDER_ID,
  name: 'Venice.ai',
  baseUrl: 'https://api.venice.ai/api/v1',
  envKey: 'VENICE_API_KEY',
  failureHint:
    'Venice via Codex Responses failed. Check VENICE_API_KEY, the Venice model id, account balance/rate limits, and whether this key/model has Venice Responses API Alpha access.',
  wireApi: 'responses',
} as const satisfies AssistantCodexModelProviderConfig

const ASSISTANT_CODEX_MODEL_PROVIDER_REGISTRATIONS = [
  {
    config: OPENAI_CODEX_MODEL_PROVIDER_CONFIG,
  },
  {
    config: HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_CONFIG,
  },
  {
    config: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
    localOnboarding: createLocalOnboardingProviderConfig(
      VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
      {
        defaultModel: 'gpt-5.6-terra',
        description: 'Use Codex through Vercel AI Gateway.',
        label: 'Vercel AI Gateway',
        modelPrompt: 'Model id to use with Codex',
        selectableInLocalOnboarding: false,
      },
    ),
  },
  {
    config: VENICE_CODEX_MODEL_PROVIDER_CONFIG,
    localOnboarding: createLocalOnboardingProviderConfig(
      VENICE_CODEX_MODEL_PROVIDER_CONFIG,
      {
        defaultModel: null,
        description: 'Use Codex with a Venice API key.',
        label: 'Venice.ai',
        modelPrompt: 'Venice model id to use with Codex',
        selectableInLocalOnboarding: true,
      },
    ),
  },
] as const satisfies readonly AssistantCodexModelProviderRegistration[]

export const ASSISTANT_CODEX_MODEL_PROVIDER_CONFIGS = [
  ...ASSISTANT_CODEX_MODEL_PROVIDER_REGISTRATIONS.map(
    (registration) => registration.config,
  ),
] as const satisfies readonly AssistantCodexModelProviderConfig[]

export const ASSISTANT_CODEX_MODEL_PROVIDER_IDS =
  ASSISTANT_CODEX_MODEL_PROVIDER_CONFIGS.map((config) => config.id)

export const LOCAL_SETUP_CODEX_PROVIDER_CONFIGS =
  ASSISTANT_CODEX_MODEL_PROVIDER_REGISTRATIONS.flatMap((registration) =>
    'localOnboarding' in registration && registration.localOnboarding
      ? [registration.localOnboarding]
      : [],
  ) as readonly AssistantCodexLocalOnboardingProviderConfig[]

export const LOCAL_SETUP_CODEX_PROVIDER_IDS =
  LOCAL_SETUP_CODEX_PROVIDER_CONFIGS.map((config) => config.providerId)

const ASSISTANT_CODEX_MODEL_PROVIDER_CONFIG_MAP = new Map<
  string,
  AssistantCodexModelProviderConfig
>(ASSISTANT_CODEX_MODEL_PROVIDER_CONFIGS.map((config) => [config.id, config]))

const LOCAL_SETUP_CODEX_PROVIDER_CONFIG_MAP = new Map<
  string,
  AssistantCodexLocalOnboardingProviderConfig
>(
  LOCAL_SETUP_CODEX_PROVIDER_CONFIGS.map((config) => [
    config.providerId,
    config,
  ]),
)

export class UnsupportedAssistantRuntimeTargetError extends Error {
  readonly code = 'ASSISTANT_RUNTIME_TARGET_UNSUPPORTED'

  constructor(message = unsupportedAssistantRuntimeTargetMessage()) {
    super(message)
    this.name = 'UnsupportedAssistantRuntimeTargetError'
  }
}

export function createUnsupportedAssistantRuntimeTargetError(): UnsupportedAssistantRuntimeTargetError {
  return new UnsupportedAssistantRuntimeTargetError()
}

export function normalizeAssistantCodexModelProvider(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? null
  return normalized && /^[a-z0-9][a-z0-9._-]*$/u.test(normalized)
    ? normalized
    : null
}

export function resolveAssistantCodexModelProviderConfig(
  value: string | null | undefined,
): AssistantCodexModelProviderConfig | null {
  const normalized = normalizeAssistantCodexModelProvider(value)
  return normalized
    ? ASSISTANT_CODEX_MODEL_PROVIDER_CONFIG_MAP.get(normalized) ?? null
    : null
}

export function resolveStrictAssistantCodexModelProvider(
  value: string | null | undefined,
): {
  config: AssistantCodexModelProviderConfig | null
  id: string | null
} {
  const raw = normalizeNullableString(value)
  if (!raw) {
    return {
      config: null,
      id: null,
    }
  }

  const id = normalizeAssistantCodexModelProvider(raw)
  if (!id) {
    throw new VaultCliError(
      'invalid_option',
      `Unknown Codex model provider: ${raw}.`,
    )
  }

  const config = resolveAssistantCodexModelProviderConfig(id)
  if (!config && !isCodexReservedModelProviderId(id)) {
    throw new VaultCliError(
      'invalid_option',
      `Unknown Codex model provider: ${raw}.`,
    )
  }

  return {
    config,
    id,
  }
}

export function resolveAssistantCodexLocalOnboardingProviderConfig(
  value: string | null | undefined,
): AssistantCodexLocalOnboardingProviderConfig | null {
  const normalized = normalizeAssistantCodexModelProvider(value)
  return normalized
    ? LOCAL_SETUP_CODEX_PROVIDER_CONFIG_MAP.get(normalized) ?? null
    : null
}

export function isAssistantCodexLocalOnboardingProvider(
  value: string | null | undefined,
): boolean {
  return resolveAssistantCodexLocalOnboardingProviderConfig(value) !== null
}

function createLocalOnboardingProviderConfig(
  providerConfig: AssistantCodexModelProviderConfig,
  onboarding: Omit<AssistantCodexLocalOnboardingProviderConfig, 'providerId'>,
): AssistantCodexLocalOnboardingProviderConfig {
  return {
    ...onboarding,
    providerId: providerConfig.id,
  }
}

export function assistantCodexModelProviderRequiresModelThreadCompatibility(
  value: string | null | undefined,
): boolean {
  return normalizeAssistantCodexModelProvider(value) ===
    HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID
}

export function isCodexReservedModelProviderId(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeAssistantCodexModelProvider(value)
  return normalized !== null && CODEX_RESERVED_MODEL_PROVIDER_ID_SET.has(normalized)
}

export function buildCodexAssistantContinuityFingerprint(
  input: {
    approvalPolicy?: string | null
    codexHome?: string | null
    model?: string | null
    modelProvider?: string | null
    oss?: boolean | null
    profile?: string | null
    sandbox?: string | null
  },
): string {
  const identity = JSON.stringify({
    provider: 'codex-cli',
    executionDriver: 'codex-app-server',
    modelProvider: normalizeAssistantCodexModelProvider(input.modelProvider),
    model: assistantCodexModelProviderRequiresModelThreadCompatibility(
      input.modelProvider,
    )
      ? normalizeNullableString(input.model)
      : null,
    sandbox: normalizeNullableString(input.sandbox),
    approvalPolicy: normalizeNullableString(input.approvalPolicy),
    profile: normalizeNullableString(input.profile),
    oss: input.oss === true,
    codexHome: normalizeNullableString(input.codexHome),
  })
  return `sha256:${createHash('sha256').update(identity).digest('hex')}`
}

function unsupportedAssistantRuntimeTargetMessage(): string {
  return 'Assistant runtime targets must use Codex App Server. Reconfigure the assistant for Codex App Server.'
}

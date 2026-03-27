import type { AssistantChatProvider } from '../assistant-cli-contracts.js'
import {
  normalizeAssistantProviderConfig,
  type AssistantProviderConfig,
} from './provider-config.js'
import { normalizeNullableString } from './shared.js'

const MODEL_DISCOVERY_TIMEOUT_MS = 2_500
const MAX_DISCOVERED_MODELS = 12
const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'local-model'

export interface AssistantModelOption {
  description: string
  value: string
}

export interface AssistantReasoningOption {
  description: string
  label: string
  value: string
}

export interface AssistantProviderCapabilities {
  supportsDirectCliExecution: boolean
  supportsModelDiscovery: boolean
  supportsReasoningEffort: boolean
}

export interface AssistantProviderProfile extends AssistantProviderConfig {
  provider: AssistantChatProvider
  providerLabel: string
}

export interface AssistantModelCatalog {
  capabilities: AssistantProviderCapabilities
  modelOptions: readonly AssistantModelOption[]
  provider: AssistantChatProvider
  providerLabel: string
  reasoningOptions: readonly AssistantReasoningOption[]
}

export const DEFAULT_ASSISTANT_CHAT_MODEL_OPTIONS: readonly AssistantModelOption[] = [
  {
    value: 'gpt-5.4',
    description: 'Latest frontier agentic coding model.',
  },
  {
    value: 'gpt-5.4-mini',
    description: 'Smaller frontier agentic coding model.',
  },
  {
    value: 'gpt-5.3-codex',
    description: 'Frontier Codex-optimized agentic coding model.',
  },
  {
    value: 'gpt-5.3-codex-spark',
    description: 'Ultra-fast coding model.',
  },
] as const

export const DEFAULT_ASSISTANT_REASONING_OPTIONS: readonly AssistantReasoningOption[] = [
  {
    value: 'low',
    label: 'Low',
    description: 'Fast responses with lighter reasoning',
  },
  {
    value: 'medium',
    label: 'Medium',
    description: 'Balances speed and reasoning depth for everyday tasks',
  },
  {
    value: 'high',
    label: 'High',
    description: 'Greater reasoning depth for complex problems',
  },
  {
    value: 'xhigh',
    label: 'Extra high',
    description: 'Extra high reasoning depth for complex problems',
  },
] as const

const ASSISTANT_PROVIDER_CAPABILITIES: Record<
  AssistantChatProvider,
  AssistantProviderCapabilities
> = {
  'codex-cli': {
    supportsDirectCliExecution: true,
    supportsModelDiscovery: false,
    supportsReasoningEffort: true,
  },
  'openai-compatible': {
    supportsDirectCliExecution: false,
    supportsModelDiscovery: true,
    supportsReasoningEffort: false,
  },
}

export function resolveAssistantProviderCapabilities(
  provider: AssistantChatProvider,
): AssistantProviderCapabilities {
  return {
    ...ASSISTANT_PROVIDER_CAPABILITIES[provider],
  }
}

export function resolveAssistantProviderProfile(
  input:
    | ({
        provider?: AssistantChatProvider | null
      } & Partial<AssistantProviderConfig>)
    | null
    | undefined,
): AssistantProviderProfile {
  const provider = input?.provider ?? 'codex-cli'
  const normalized = normalizeAssistantProviderConfig(input)

  return {
    ...normalized,
    provider,
    providerLabel: resolveAssistantProviderLabel({
      provider,
      baseUrl: normalized.baseUrl,
      oss: normalized.oss,
      providerName: normalized.providerName,
    }),
  }
}

export function resolveAssistantModelCatalog(input: {
  baseUrl?: string | null
  currentModel?: string | null
  currentReasoningEffort?: string | null
  discoveredModels?: readonly string[] | null
  oss?: boolean | null
  provider?: AssistantChatProvider | null
  providerName?: string | null
}): AssistantModelCatalog {
  const profile = resolveAssistantProviderProfile(input)
  const capabilities = resolveAssistantProviderCapabilities(profile.provider)
  const modelOptions = buildAssistantModelOptions({
    currentModel: input.currentModel,
    discoveredModels: input.discoveredModels,
    profile,
  })

  return {
    capabilities,
    modelOptions,
    provider: profile.provider,
    providerLabel: profile.providerLabel,
    reasoningOptions: capabilities.supportsReasoningEffort
      ? DEFAULT_ASSISTANT_REASONING_OPTIONS
      : [],
  }
}

export async function discoverAssistantProviderModels(input: {
  baseUrl?: string | null
  provider: AssistantChatProvider
}): Promise<string[]> {
  switch (input.provider) {
    case 'openai-compatible':
      return await defaultDiscoverOpenAICompatibleModels(input.baseUrl)
    case 'codex-cli':
      return []
    default:
      return []
  }
}

export function findAssistantCatalogModelOptionIndex(
  model: string | null,
  options: readonly AssistantModelOption[],
): number {
  if (options.length === 0) {
    return 0
  }

  const normalizedModel = normalizeNullableString(model)
  const index = options.findIndex((option) => option.value === normalizedModel)
  return index >= 0 ? index : 0
}

export function findAssistantCatalogReasoningOptionIndex(
  reasoningEffort: string | null,
  options: readonly AssistantReasoningOption[],
): number {
  if (options.length === 0) {
    return 0
  }

  const normalizedReasoningEffort = normalizeNullableString(reasoningEffort)
  const index = options.findIndex(
    (option) => option.value === normalizedReasoningEffort,
  )
  return index >= 0 ? index : Math.min(1, options.length - 1)
}

export async function defaultDiscoverOpenAICompatibleModels(
  baseUrl: string | null | undefined,
): Promise<string[]> {
  const normalizedBaseUrl = normalizeNullableString(baseUrl)
  if (!normalizedBaseUrl) {
    return []
  }

  try {
    const modelsUrl = new URL('models', ensureTrailingSlash(normalizedBaseUrl))
    const timeoutSignal =
      typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
        ? AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS)
        : undefined
    const response = await fetch(modelsUrl, {
      headers: {
        accept: 'application/json',
      },
      signal: timeoutSignal,
    })

    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown }>
    }

    return normalizeDiscoveredModelIds(
      (payload.data ?? []).map((entry) =>
        typeof entry?.id === 'string' ? entry.id : null,
      ),
    )
  } catch {
    return []
  }
}

function buildAssistantModelOptions(input: {
  currentModel?: string | null
  discoveredModels?: readonly string[] | null
  profile: AssistantProviderProfile
}): readonly AssistantModelOption[] {
  const normalizedCurrentModel = normalizeNullableString(input.currentModel)

  switch (input.profile.provider) {
    case 'codex-cli':
      return mergeAssistantModelOptions({
        currentModel: normalizedCurrentModel,
        discoveredModels: null,
        fallbackModel: normalizedCurrentModel,
        profile: input.profile,
        staticOptions: DEFAULT_ASSISTANT_CHAT_MODEL_OPTIONS,
      })

    case 'openai-compatible':
      return mergeAssistantModelOptions({
        currentModel: normalizedCurrentModel,
        discoveredModels: input.discoveredModels,
        fallbackModel: DEFAULT_OPENAI_COMPATIBLE_MODEL,
        profile: input.profile,
        staticOptions: [],
      })

    default:
      return mergeAssistantModelOptions({
        currentModel: normalizedCurrentModel,
        discoveredModels: input.discoveredModels,
        fallbackModel: normalizedCurrentModel,
        profile: input.profile,
        staticOptions: [],
      })
  }
}

function mergeAssistantModelOptions(input: {
  currentModel: string | null
  discoveredModels: readonly string[] | null | undefined
  fallbackModel: string | null
  profile: AssistantProviderProfile
  staticOptions: readonly AssistantModelOption[]
}): readonly AssistantModelOption[] {
  const options: AssistantModelOption[] = []
  const seen = new Set<string>()

  const pushOption = (value: string | null, description: string) => {
    const normalizedValue = normalizeNullableString(value)
    if (!normalizedValue || seen.has(normalizedValue)) {
      return
    }

    seen.add(normalizedValue)
    options.push({
      value: normalizedValue,
      description,
    })
  }

  pushOption(
    input.currentModel,
    buildCurrentModelDescription(input.profile),
  )

  for (const option of input.staticOptions) {
    pushOption(option.value, option.description)
  }

  for (const model of normalizeDiscoveredModelIds(input.discoveredModels ?? [])) {
    pushOption(model, buildDiscoveredModelDescription(input.profile))
  }

  if (options.length === 0) {
    pushOption(input.fallbackModel, buildFallbackModelDescription(input.profile))
  }

  return options
}

function normalizeDiscoveredModelIds(
  models: readonly (string | null | undefined)[],
): string[] {
  const normalizedModels = models
    .map((model) => normalizeNullableString(model))
    .filter((model): model is string => Boolean(model))

  return [...new Set(normalizedModels)].slice(0, MAX_DISCOVERED_MODELS)
}

function buildCurrentModelDescription(profile: AssistantProviderProfile): string {
  switch (profile.provider) {
    case 'codex-cli':
      return profile.oss
        ? 'Current Codex OSS local model.'
        : 'Current Codex model.'
    case 'openai-compatible':
      return `Current model for ${profile.providerLabel}.`
    default:
      return 'Current model.'
  }
}

function buildDiscoveredModelDescription(profile: AssistantProviderProfile): string {
  switch (profile.provider) {
    case 'openai-compatible':
      return `Discovered from ${profile.providerLabel}.`
    case 'codex-cli':
      return 'Discovered Codex model.'
    default:
      return 'Discovered model.'
  }
}

function buildFallbackModelDescription(profile: AssistantProviderProfile): string {
  switch (profile.provider) {
    case 'openai-compatible':
      return `Fallback model entry for ${profile.providerLabel}.`
    case 'codex-cli':
      return 'Fallback Codex model entry.'
    default:
      return 'Fallback model entry.'
  }
}

function resolveAssistantProviderLabel(input: {
  baseUrl: string | null
  oss: boolean | null
  provider: AssistantChatProvider
  providerName: string | null
}): string {
  const explicitProviderName = normalizeNullableString(input.providerName)
  if (explicitProviderName) {
    return explicitProviderName
  }

  switch (input.provider) {
    case 'codex-cli':
      return input.oss ? 'Codex OSS' : 'Codex CLI'
    case 'openai-compatible': {
      const normalizedBaseUrl = normalizeNullableString(input.baseUrl)
      if (!normalizedBaseUrl) {
        return 'OpenAI-compatible endpoint'
      }

      try {
        const parsed = new URL(normalizedBaseUrl)
        return parsed.host ? `OpenAI-compatible endpoint at ${parsed.host}` : 'OpenAI-compatible endpoint'
      } catch {
        return 'OpenAI-compatible endpoint'
      }
    }
    default:
      return input.provider
  }
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

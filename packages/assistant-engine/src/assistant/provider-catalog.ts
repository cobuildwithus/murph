import type { AssistantChatProvider } from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeAssistantProviderConfig,
  type AssistantProviderConfig,
  type AssistantProviderConfigInput,
} from '@murphai/operator-config/assistant/provider-config'
import {
  createCatalogModel,
  discoverAssistantProviderModels as discoverAssistantProviderModelsWithRegistry,
  resolveAssistantProviderTargetCapabilities as resolveAssistantProviderRegistryTargetCapabilities,
  resolveAssistantProviderCapabilities as resolveAssistantProviderRegistryCapabilities,
  resolveAssistantProviderLabel,
  resolveAssistantProviderStaticModels,
  type AssistantCatalogModel,
  type AssistantModelDiscoveryResult,
  type AssistantProviderCapabilities,
} from '../assistant-provider.js'
import { normalizeNullableString } from '../assistant-runtime.js'

export type {
  AssistantCatalogModel,
  AssistantModelDiscoveryResult,
} from '../assistant-provider.js'

export interface AssistantModelOption {
  description: string
  value: string
}

export interface AssistantReasoningOption {
  description: string
  label: string
  value: string
}

export type AssistantProviderProfile = AssistantProviderConfig & {
  providerLabel: string
}

export interface AssistantModelCatalog {
  capabilities: AssistantProviderCapabilities
  discovery: AssistantModelDiscoveryResult | null
  modelOptions: readonly AssistantModelOption[]
  models: readonly AssistantCatalogModel[]
  provider: AssistantChatProvider
  providerLabel: string
  reasoningOptions: readonly AssistantReasoningOption[]
  selectedModel: AssistantCatalogModel | null
}

export const DEFAULT_ASSISTANT_CHAT_MODEL_OPTIONS: readonly AssistantModelOption[] =
  resolveAssistantProviderStaticModels({
    provider: 'codex-cli',
  }).map((model) => ({
    value: model.id,
    description: model.description,
  }))

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

export function resolveAssistantProviderCapabilities(
  provider: AssistantChatProvider,
): AssistantProviderCapabilities {
  return resolveAssistantProviderRegistryCapabilities(provider)
}

export function resolveAssistantTargetCapabilities(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderCapabilities {
  return resolveAssistantProviderRegistryTargetCapabilities(input)
}

export function resolveAssistantProviderProfile(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderProfile {
  const normalized = normalizeAssistantProviderConfig(input)

  return {
    ...normalized,
    providerLabel: resolveAssistantProviderLabel(normalized),
  }
}

export function resolveAssistantModelCatalog(input: {
  apiKeyEnv?: string | null
  baseUrl?: string | null
  currentModel?: string | null
  currentReasoningEffort?: string | null
  discoveredModels?: readonly string[] | null
  discovery?: AssistantModelDiscoveryResult | null
  headers?: Record<string, string> | null
  oss?: boolean | null
  presetId?: string | null
  provider?: AssistantChatProvider | null
  providerName?: string | null
}): AssistantModelCatalog {
  const profile = resolveAssistantProviderProfile(input)
  const capabilities = resolveAssistantTargetCapabilities(profile)
  const staticModels = resolveAssistantProviderStaticModels(profile)
  const discovery = normalizeAssistantModelDiscoveryResult({
    capabilities,
    discovery:
      input.discovery ??
      (input.discoveredModels
        ? {
            models: input.discoveredModels.map((model) =>
              createCatalogModel({
                id: model,
                description: `Discovered from ${profile.providerLabel}.`,
                source: 'discovered',
                capabilities: resolveAssistantCatalogModelCapabilities(
                  profile,
                  capabilities,
                ),
              }),
            ),
            status: 'ok' as const,
            message: null,
          }
        : null),
    profile,
  })
  const models = buildAssistantCatalogModels({
    currentModel: input.currentModel,
    discovery,
    profile,
    staticModels,
    targetCapabilities: capabilities,
  })
  const selectedModel =
    models.find((model) => model.id === normalizeNullableString(input.currentModel)) ??
    models[0] ??
    null

  return {
    capabilities,
    discovery,
    modelOptions: models.map((model) => ({
      value: model.id,
      description: model.description,
    })),
    models,
    provider: profile.provider,
    providerLabel: profile.providerLabel,
    reasoningOptions: resolveAssistantCatalogReasoningOptions(selectedModel),
    selectedModel,
  }
}

export async function discoverAssistantProviderModels(input: {
  apiKeyEnv?: string | null
  baseUrl?: string | null
  env?: NodeJS.ProcessEnv
  headers?: Record<string, string> | null
  provider: AssistantChatProvider
  providerName?: string | null
}): Promise<AssistantModelDiscoveryResult> {
  return await discoverAssistantProviderModelsWithRegistry(input)
}

export async function defaultDiscoverOpenAICompatibleModels(
  baseUrl: string | null | undefined,
  options?: {
    apiKeyEnv?: string | null
    env?: NodeJS.ProcessEnv
    headers?: Record<string, string> | null
    providerName?: string | null
  },
): Promise<string[]> {
  const result = await discoverAssistantProviderModelsWithRegistry({
    provider: 'openai-compatible',
    baseUrl,
    apiKeyEnv: options?.apiKeyEnv,
    env: options?.env,
    headers: options?.headers,
    providerName: options?.providerName,
  })

  return result.models.map((model) => model.id)
}

export function resolveAssistantCatalogReasoningOptions(
  model: AssistantCatalogModel | null | undefined,
): readonly AssistantReasoningOption[] {
  return model?.capabilities.reasoning ? DEFAULT_ASSISTANT_REASONING_OPTIONS : []
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

function buildAssistantCatalogModels(input: {
  currentModel?: string | null
  discovery?: AssistantModelDiscoveryResult | null
  profile: AssistantProviderProfile
  staticModels: readonly AssistantCatalogModel[]
  targetCapabilities: AssistantProviderCapabilities
}): readonly AssistantCatalogModel[] {
  const normalizedCurrentModel = normalizeNullableString(input.currentModel)
  const models: AssistantCatalogModel[] = []
  const seen = new Set<string>()

  const pushModel = (model: AssistantCatalogModel | null | undefined) => {
    if (!model) {
      return
    }

    const normalizedId = normalizeNullableString(model.id)
    if (!normalizedId || seen.has(normalizedId)) {
      return
    }

    seen.add(normalizedId)
    models.push({
      ...model,
      id: normalizedId,
      label: normalizedId,
    })
  }

  if (normalizedCurrentModel) {
    pushModel(
      createCatalogModel({
        id: normalizedCurrentModel,
        description: buildCurrentModelDescription(input.profile),
        source: 'current',
        capabilities:
          input.staticModels.find((model) => model.id === normalizedCurrentModel)
            ?.capabilities ??
          input.discovery?.models.find((model) => model.id === normalizedCurrentModel)
            ?.capabilities ??
          resolveAssistantCatalogModelCapabilities(
            input.profile,
            input.targetCapabilities,
          ),
      }),
    )
  }

  for (const model of input.staticModels) {
    pushModel(model)
  }

  for (const model of input.discovery?.models ?? []) {
    pushModel(model)
  }

  return models
}

function buildCurrentModelDescription(profile: AssistantProviderProfile): string {
  switch (profile.provider) {
    case 'openai-compatible':
      return `Current model from ${profile.providerLabel}.`
    case 'codex-cli':
      return profile.oss ? 'Current Codex OSS model.' : 'Current Codex model.'
    default:
      return 'Current model.'
  }
}

function normalizeAssistantModelDiscoveryResult(input: {
  capabilities: AssistantProviderCapabilities
  discovery: AssistantModelDiscoveryResult | null
  profile: AssistantProviderProfile
}): AssistantModelDiscoveryResult | null {
  if (!input.discovery) {
    return null
  }

  if (input.profile.provider === 'codex-cli') {
    return input.discovery
  }

  return {
    ...input.discovery,
    models: input.discovery.models.map((model) => ({
      ...model,
      capabilities: resolveAssistantCatalogModelCapabilities(
        input.profile,
        input.capabilities,
      ),
    })),
  }
}

function resolveAssistantCatalogModelCapabilities(
  profile: AssistantProviderProfile,
  capabilities: AssistantProviderCapabilities,
): AssistantCatalogModel['capabilities'] {
  if (profile.provider === 'codex-cli') {
    return {
      images: false,
      pdf: false,
      reasoning: true,
      streaming: true,
      tools: true,
    }
  }

  return {
    images: false,
    pdf: false,
    reasoning: capabilities.supportsReasoningEffort,
    streaming: true,
    tools: true,
  }
}

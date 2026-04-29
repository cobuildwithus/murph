import type { AssistantChatProvider } from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeAssistantProviderConfig,
  resolveAssistantChatProviderFromConfig,
  type AssistantProviderConfig,
  type AssistantProviderConfigLike,
} from '@murphai/operator-config/assistant/provider-config'
import {
  createCatalogModel,
  resolveAssistantProviderTargetCapabilities as resolveAssistantProviderRegistryTargetCapabilities,
  resolveAssistantProviderCapabilities as resolveAssistantProviderRegistryCapabilities,
  resolveAssistantProviderLabel,
  resolveAssistantProviderStaticModels,
  type AssistantCatalogModel,
  type AssistantProviderCapabilities,
} from '../assistant-provider.js'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'

export type {
  AssistantCatalogModel,
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
  input: AssistantProviderConfigLike | null | undefined,
): AssistantProviderCapabilities {
  return resolveAssistantProviderRegistryTargetCapabilities(input)
}

export function resolveAssistantProviderProfile(
  input: AssistantProviderConfigLike | null | undefined,
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
  headers?: Record<string, string> | null
  oss?: boolean | null
  presetId?: string | null
  provider?: AssistantChatProvider | null
  providerName?: string | null
}): AssistantModelCatalog {
  const profile = resolveAssistantProviderProfile(input)
  const capabilities = resolveAssistantTargetCapabilities(profile)
  const staticModels = resolveAssistantProviderStaticModels(profile)
  const models = buildAssistantCatalogModels({
    currentModel: input.currentModel,
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
    modelOptions: models.map((model) => ({
      value: model.id,
      description: model.description,
    })),
    models,
    provider: resolveAssistantChatProviderFromConfig(profile),
    providerLabel: profile.providerLabel,
    reasoningOptions: resolveAssistantCatalogReasoningOptions(selectedModel),
    selectedModel,
  }
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
          resolveAssistantCatalogModelCapabilities(input.targetCapabilities),
      }),
    )
  }

  for (const model of input.staticModels) {
    pushModel(model)
  }

  return models
}

function buildCurrentModelDescription(profile: AssistantProviderProfile): string {
  return profile.target.oss ? 'Current Codex OSS model.' : 'Current Codex model.'
}

function resolveAssistantCatalogModelCapabilities(
  capabilities: AssistantProviderCapabilities,
): AssistantCatalogModel['capabilities'] {
  const supportedContentTypes = new Set(capabilities.supportedUserMessageContentTypes)

  return {
    images: supportedContentTypes.has('image'),
    pdf: supportedContentTypes.has('file'),
    reasoning: true,
    streaming: true,
    tools: true,
  }
}

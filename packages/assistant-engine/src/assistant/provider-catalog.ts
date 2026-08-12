import type { AssistantChatProvider } from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeAssistantProviderConfig,
  type AssistantProviderConfig,
  type AssistantProviderConfigLike,
} from '@murphai/operator-config/assistant/provider-config'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import {
  resolveCodexAssistantCapabilities,
  resolveCodexAssistantLabel,
  resolveCodexAssistantTargetCapabilities,
  resolveCodexStaticModels,
  type AssistantCatalogModel,
  type AssistantModelCapabilities,
  type AssistantProviderCapabilities,
} from './codex-runtime.js'
import { createCatalogModel } from './providers/catalog.js'

export type CodexCatalogModel = AssistantCatalogModel
export type CodexModelCapabilities = AssistantModelCapabilities
export type CodexAssistantCapabilities = AssistantProviderCapabilities

export interface CodexModelOption {
  description: string
  value: string
}

export interface CodexReasoningOption {
  description: string
  label: string
  value: string
}

export type CodexAssistantProfile = AssistantProviderConfig & {
  providerLabel: string
}

export interface CodexModelCatalog {
  capabilities: CodexAssistantCapabilities
  modelOptions: readonly CodexModelOption[]
  models: readonly CodexCatalogModel[]
  provider: AssistantChatProvider
  providerLabel: string
  reasoningOptions: readonly CodexReasoningOption[]
  selectedModel: CodexCatalogModel | null
}

export const DEFAULT_CODEX_CHAT_MODEL_OPTIONS: readonly CodexModelOption[] =
  [
    {
      value: '',
      description: 'Use the model configured by Codex.',
    },
  ] as const

export const DEFAULT_CODEX_REASONING_OPTIONS: readonly CodexReasoningOption[] = [
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

export function resolveCodexModelCapabilities(): CodexAssistantCapabilities {
  return resolveCodexAssistantCapabilities()
}

export function resolveCodexTargetCapabilities(
  input: AssistantProviderConfigLike | null | undefined,
): CodexAssistantCapabilities {
  return resolveCodexAssistantTargetCapabilities(input)
}

export function resolveCodexAssistantProfile(
  input: AssistantProviderConfigLike | null | undefined,
): CodexAssistantProfile {
  const normalized = normalizeAssistantProviderConfig(input)

  return {
    ...normalized,
    providerLabel: resolveCodexAssistantLabel(normalized),
  }
}

export function resolveCodexModelCatalog(input: {
  apiKeyEnv?: string | null
  baseUrl?: string | null
  currentModel?: string | null
  currentReasoningEffort?: string | null
  headers?: Record<string, string> | null
  oss?: boolean | null
  presetId?: string | null
  provider?: AssistantChatProvider | null
  providerName?: string | null
}): CodexModelCatalog {
  const profile = resolveCodexAssistantProfile(input)
  const capabilities = resolveCodexTargetCapabilities(profile)
  const staticModels = resolveCodexStaticModels(profile)
  const models = buildCodexCatalogModels({
    currentModel: input.currentModel,
    profile,
    staticModels,
    targetCapabilities: capabilities,
  })
  const normalizedCurrentModel = normalizeNullableString(input.currentModel)
  const selectedModel = normalizedCurrentModel
    ? models.find((model) => model.id === normalizedCurrentModel) ?? null
    : null
  const modelOptions = [
    ...DEFAULT_CODEX_CHAT_MODEL_OPTIONS,
    ...models.map((model) => ({
      value: model.id,
      description: model.description,
    })),
  ]

  return {
    capabilities,
    modelOptions,
    models,
    provider: 'codex-cli',
    providerLabel: profile.providerLabel,
    reasoningOptions: capabilities.supportsReasoningEffort
      ? DEFAULT_CODEX_REASONING_OPTIONS
      : resolveCodexCatalogReasoningOptions(selectedModel),
    selectedModel,
  }
}

export function resolveCodexCatalogReasoningOptions(
  model: CodexCatalogModel | null | undefined,
): readonly CodexReasoningOption[] {
  return model?.capabilities.reasoning ? DEFAULT_CODEX_REASONING_OPTIONS : []
}

export function findCodexCatalogModelOptionIndex(
  model: string | null,
  options: readonly CodexModelOption[],
): number {
  if (options.length === 0) {
    return 0
  }

  const normalizedModel = normalizeNullableString(model)
  const index = options.findIndex((option) => option.value === normalizedModel)
  return index >= 0 ? index : 0
}

export function findCodexCatalogReasoningOptionIndex(
  reasoningEffort: string | null,
  options: readonly CodexReasoningOption[],
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

function buildCodexCatalogModels(input: {
  currentModel?: string | null
  profile: CodexAssistantProfile
  staticModels: readonly CodexCatalogModel[]
  targetCapabilities: CodexAssistantCapabilities
}): readonly CodexCatalogModel[] {
  const normalizedCurrentModel = normalizeNullableString(input.currentModel)
  const models: CodexCatalogModel[] = []
  const seen = new Set<string>()

  const pushModel = (model: CodexCatalogModel | null | undefined) => {
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
        description: buildCurrentCodexModelDescription(input.profile),
        source: 'current',
        capabilities:
          input.staticModels.find((model) => model.id === normalizedCurrentModel)
            ?.capabilities ??
          resolveCodexCatalogModelCapabilities(input.targetCapabilities),
      }),
    )
  }

  for (const model of input.staticModels) {
    pushModel(model)
  }

  return models
}

function buildCurrentCodexModelDescription(profile: CodexAssistantProfile): string {
  return profile.target.oss ? 'Current Codex OSS model.' : 'Current Codex model.'
}

function resolveCodexCatalogModelCapabilities(
  capabilities: CodexAssistantCapabilities,
): CodexCatalogModel['capabilities'] {
  const supportedContentTypes = new Set(capabilities.supportedUserMessageContentTypes)

  return {
    images: supportedContentTypes.has('image'),
    pdf: supportedContentTypes.has('file'),
    reasoning: true,
    streaming: true,
    tools: true,
  }
}

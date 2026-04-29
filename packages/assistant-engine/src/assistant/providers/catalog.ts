import type {
  AssistantCatalogModel,
  AssistantModelCapabilities,
} from './types.js'

export const DEFAULT_CODEX_MODEL_CAPABILITIES: AssistantModelCapabilities = {
  images: true,
  pdf: false,
  reasoning: true,
  streaming: true,
  tools: true,
}

export const DEFAULT_CODEX_MODELS: readonly AssistantCatalogModel[] = [
  {
    id: 'gpt-5.5',
    label: 'gpt-5.5',
    description: 'Latest frontier agentic coding model.',
    source: 'static',
    capabilities: DEFAULT_CODEX_MODEL_CAPABILITIES,
  },
  {
    id: 'gpt-5.4',
    label: 'gpt-5.4',
    description: 'Previous frontier agentic coding model.',
    source: 'static',
    capabilities: DEFAULT_CODEX_MODEL_CAPABILITIES,
  },
  {
    id: 'gpt-5.4-mini',
    label: 'gpt-5.4-mini',
    description: 'Smaller frontier agentic coding model.',
    source: 'static',
    capabilities: DEFAULT_CODEX_MODEL_CAPABILITIES,
  },
  {
    id: 'gpt-5.3-codex',
    label: 'gpt-5.3-codex',
    description: 'Frontier Codex-optimized agentic coding model.',
    source: 'static',
    capabilities: DEFAULT_CODEX_MODEL_CAPABILITIES,
  },
  {
    id: 'gpt-5.3-codex-spark',
    label: 'gpt-5.3-codex-spark',
    description: 'Ultra-fast coding model.',
    source: 'static',
    capabilities: DEFAULT_CODEX_MODEL_CAPABILITIES,
  },
] as const

export function createCatalogModel(input: {
  capabilities: AssistantModelCapabilities
  description: string
  id: string
  source: AssistantCatalogModel['source']
}): AssistantCatalogModel {
  return {
    id: input.id,
    label: input.id,
    description: input.description,
    source: input.source,
    capabilities: {
      ...input.capabilities,
    },
  }
}

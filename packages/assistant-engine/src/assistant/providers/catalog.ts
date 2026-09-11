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

import {
  createAssistantToolCatalog,
  type AssistantToolCatalog,
  type AssistantToolDefinition,
} from '../model-harness.js'
import {
  createAssistantCliExecutorToolDefinitions,
  createAssistantKnowledgeReadToolDefinitions,
  createAssistantKnowledgeWriteToolDefinitions,
  createAssistantRuntimeToolDefinitions,
  createCanonicalVaultWriteToolDefinitions,
  createInboxPromotionToolDefinitions,
  createOutwardSideEffectToolDefinitions,
  createQueryAndReadToolDefinitions,
  createVaultTextReadToolDefinitions,
  createWebFetchToolDefinitions,
  createWebPdfReadToolDefinitions,
  createWebSearchToolDefinitions,
} from './capability-definitions.js'
import type {
  AssistantToolCatalogOptions,
  AssistantToolContext,
} from './shared.js'

interface AssistantToolConcernDefinitions {
  assistantRuntimeTools: AssistantToolDefinition[]
  canonicalVaultWriteTools: AssistantToolDefinition[]
  outwardSideEffectTools: AssistantToolDefinition[]
  queryAndReadTools: AssistantToolDefinition[]
}

export function createDefaultAssistantToolCatalog(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
): AssistantToolCatalog {
  const concerns = resolveAssistantToolConcernDefinitions(input, options)
  return createAssistantToolCatalog([
    ...concerns.assistantRuntimeTools,
    ...concerns.queryAndReadTools,
    ...concerns.canonicalVaultWriteTools,
    ...concerns.outwardSideEffectTools,
  ])
}

export function createInboxRoutingAssistantToolCatalog(
  input: AssistantToolContext,
): AssistantToolCatalog {
  return createDefaultAssistantToolCatalog(input, {
    includeAssistantRuntimeTools: false,
    includeQueryTools: false,
    includeStatefulWriteTools: false,
    includeVaultTextReadTool: false,
    includeVaultWriteTools: true,
    includeWebSearchTools: false,
  })
}

export function createProviderTurnAssistantToolCatalog(
  input: AssistantToolContext,
): AssistantToolCatalog {
  return createAssistantToolCatalog([
    ...createAssistantKnowledgeReadToolDefinitions(input),
    ...createAssistantKnowledgeWriteToolDefinitions(input),
    ...createAssistantCliExecutorToolDefinitions(input),
    ...createVaultTextReadToolDefinitions(input),
    ...createOutwardSideEffectToolDefinitions(input),
    ...createWebSearchToolDefinitions(),
    ...createWebFetchToolDefinitions(),
    ...createWebPdfReadToolDefinitions(),
  ])
}

function resolveAssistantToolConcernDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions,
): AssistantToolConcernDefinitions {
  const includeAssistantRuntimeTools = options.includeAssistantRuntimeTools ?? true
  const includeVaultWriteTools = options.includeVaultWriteTools ?? true

  return {
    assistantRuntimeTools: includeAssistantRuntimeTools
      ? createAssistantRuntimeToolDefinitions(input, options)
      : [],
    canonicalVaultWriteTools: [
      ...createInboxPromotionToolDefinitions(input),
      ...(includeVaultWriteTools
        ? createCanonicalVaultWriteToolDefinitions(input, options)
        : []),
    ],
    outwardSideEffectTools: includeVaultWriteTools
      ? createOutwardSideEffectToolDefinitions(input)
      : [],
    queryAndReadTools: createQueryAndReadToolDefinitions(input, options),
  }
}

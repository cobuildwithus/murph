import {
  CliBackedCapabilityHost,
  NativeLocalCapabilityHost,
  createAssistantCapabilityRegistry,
  createAssistantToolCatalogFromCapabilities,
  type AssistantToolCatalog,
  type AssistantCapabilityDefinition,
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

interface AssistantCapabilityConcernDefinitions {
  assistantRuntimeTools: AssistantCapabilityDefinition[]
  canonicalVaultWriteTools: AssistantCapabilityDefinition[]
  outwardSideEffectTools: AssistantCapabilityDefinition[]
  queryAndReadTools: AssistantCapabilityDefinition[]
}

const defaultAssistantCapabilityHosts = [
  new CliBackedCapabilityHost(),
  new NativeLocalCapabilityHost(),
] as const

export function createDefaultAssistantCapabilityRegistry(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
) {
  return createAssistantCapabilityRegistry(
    listDefaultAssistantCapabilities(input, options),
  )
}

export function createDefaultAssistantToolCatalog(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
): AssistantToolCatalog {
  return createAssistantToolCatalogFromCapabilities(
    listDefaultAssistantCapabilities(input, options),
    defaultAssistantCapabilityHosts,
  )
}

export function createInboxRoutingAssistantCapabilityRegistry(
  input: AssistantToolContext,
) {
  return createDefaultAssistantCapabilityRegistry(input, {
    includeAssistantRuntimeTools: false,
    includeQueryTools: false,
    includeStatefulWriteTools: false,
    includeVaultTextReadTool: false,
    includeVaultWriteTools: true,
    includeWebSearchTools: false,
  })
}

export function createInboxRoutingAssistantToolCatalog(
  input: AssistantToolContext,
): AssistantToolCatalog {
  return createAssistantToolCatalogFromCapabilities(
    listInboxRoutingAssistantCapabilities(input),
    defaultAssistantCapabilityHosts,
  )
}

export function createProviderTurnAssistantCapabilityRegistry(
  input: AssistantToolContext,
) {
  return createAssistantCapabilityRegistry(listProviderTurnAssistantCapabilities(input))
}

export function createProviderTurnAssistantToolCatalog(
  input: AssistantToolContext,
): AssistantToolCatalog {
  return createAssistantToolCatalogFromCapabilities(
    listProviderTurnAssistantCapabilities(input),
    defaultAssistantCapabilityHosts,
  )
}

function listDefaultAssistantCapabilities(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
): AssistantCapabilityDefinition[] {
  const concerns = resolveAssistantToolConcernDefinitions(input, options)
  return [
    ...concerns.assistantRuntimeTools,
    ...concerns.queryAndReadTools,
    ...concerns.canonicalVaultWriteTools,
    ...concerns.outwardSideEffectTools,
  ]
}

function listInboxRoutingAssistantCapabilities(
  input: AssistantToolContext,
): AssistantCapabilityDefinition[] {
  return listDefaultAssistantCapabilities(input, {
    includeAssistantRuntimeTools: false,
    includeQueryTools: false,
    includeStatefulWriteTools: false,
    includeVaultTextReadTool: false,
    includeVaultWriteTools: true,
    includeWebSearchTools: false,
  })
}

function listProviderTurnAssistantCapabilities(
  input: AssistantToolContext,
): AssistantCapabilityDefinition[] {
  return [
    ...createAssistantKnowledgeReadToolDefinitions(input),
    ...createAssistantKnowledgeWriteToolDefinitions(input),
    ...createAssistantCliExecutorToolDefinitions(input),
    ...createVaultTextReadToolDefinitions(input),
    ...createOutwardSideEffectToolDefinitions(input),
    ...createWebSearchToolDefinitions(),
    ...createWebFetchToolDefinitions(),
    ...createWebPdfReadToolDefinitions(),
  ]
}

function resolveAssistantToolConcernDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions,
): AssistantCapabilityConcernDefinitions {
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

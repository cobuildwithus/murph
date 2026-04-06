import {
  CliBackedCapabilityHost,
  NativeLocalCapabilityHost,
  createAssistantCapabilityRegistry,
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

export interface AssistantCapabilityRuntime {
  toolCatalog: AssistantToolCatalog
}

const inboxRoutingAssistantToolCatalogOptions = {
  includeAssistantRuntimeTools: false,
  includeCanonicalWriteTools: true,
  includeOutwardSideEffectTools: true,
  includeQueryTools: false,
  includeStatefulWriteTools: false,
  includeVaultTextReadTool: false,
  includeWebSearchTools: false,
} satisfies AssistantToolCatalogOptions

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
  return createDefaultAssistantCapabilityRegistry(input, options).createToolCatalog(
    defaultAssistantCapabilityHosts,
  )
}

export function createInboxRoutingAssistantCapabilityRegistry(
  input: AssistantToolContext,
) {
  return createAssistantCapabilityRegistry(listInboxRoutingAssistantCapabilities(input))
}

export function createInboxRoutingAssistantToolCatalog(
  input: AssistantToolContext,
): AssistantToolCatalog {
  return createInboxRoutingAssistantCapabilityRegistry(input).createToolCatalog(
    defaultAssistantCapabilityHosts,
  )
}

export function createProviderTurnAssistantCapabilityRegistry(
  input: AssistantToolContext,
) {
  return createAssistantCapabilityRegistry(listProviderTurnAssistantCapabilities(input))
}

export function createProviderTurnAssistantCapabilityRuntime(
  input: AssistantToolContext,
): AssistantCapabilityRuntime {
  return {
    toolCatalog: createProviderTurnAssistantCapabilityRegistry(input).createToolCatalog(
      defaultAssistantCapabilityHosts,
    ),
  }
}

export function createProviderTurnAssistantToolCatalog(
  input: AssistantToolContext,
): AssistantToolCatalog {
  return createProviderTurnAssistantCapabilityRuntime(input).toolCatalog
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
  return listDefaultAssistantCapabilities(input, inboxRoutingAssistantToolCatalogOptions)
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
  const includeCanonicalWriteTools =
    options.includeCanonicalWriteTools ?? options.includeVaultWriteTools ?? true
  const includeOutwardSideEffectTools =
    options.includeOutwardSideEffectTools ?? options.includeVaultWriteTools ?? true

  return {
    assistantRuntimeTools: includeAssistantRuntimeTools
      ? createAssistantRuntimeToolDefinitions(input, options)
      : [],
    canonicalVaultWriteTools: [
      ...createInboxPromotionToolDefinitions(input),
      ...(includeCanonicalWriteTools
        ? createCanonicalVaultWriteToolDefinitions(input, options)
        : []),
    ],
    outwardSideEffectTools: includeOutwardSideEffectTools
      ? createOutwardSideEffectToolDefinitions(input)
      : [],
    queryAndReadTools: createQueryAndReadToolDefinitions(input, options),
  }
}

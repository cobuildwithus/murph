import { z, type ZodType, type ZodTypeAny } from 'zod'

import type {
  AssistantToolBackendKind,
  AssistantToolHostKind,
  AssistantToolMutationSemantics,
  AssistantToolProvenance,
  AssistantToolRiskClass,
} from '../inbox-model-contracts.js'
import {
  bindAssistantCapabilitiesToCatalog,
  bindAssistantCapabilityToBoundTool,
  type AnyAssistantBoundToolDefinition,
  type AssistantToolCatalog,
} from './tool-catalog.js'

export type JsonRecord = Record<string, unknown>

export type AssistantCapabilityHostKind = AssistantToolHostKind
export type AssistantCapabilityBackendKind = AssistantToolBackendKind
export type AssistantCapabilityMutationSemantics = AssistantToolMutationSemantics
export type AssistantCapabilityRiskClass = AssistantToolRiskClass

export type AssistantCapabilityExecutor<
  TSchema extends ZodTypeAny = ZodTypeAny,
  TResult = unknown,
> = (input: z.infer<TSchema>) => Promise<TResult>

export interface AssistantCapabilityDefinition<
  TSchema extends ZodTypeAny = ZodTypeAny,
  TResult = unknown,
> {
  name: string
  description: string
  provenance?: AssistantToolProvenance
  backendKind?: AssistantCapabilityBackendKind
  mutationSemantics?: AssistantCapabilityMutationSemantics
  riskClass?: AssistantCapabilityRiskClass
  preferredHostKind?: AssistantCapabilityHostKind
  inputSchema: TSchema
  outputSchema?: ZodType<TResult>
  inputExample?: JsonRecord
  executionBindings: Partial<
    Record<AssistantCapabilityHostKind, AssistantCapabilityExecutor<TSchema, TResult>>
  >
}

export type AnyAssistantCapabilityDefinition = AssistantCapabilityDefinition<
  ZodTypeAny,
  unknown
>

export interface NormalizedAssistantCapabilityDefinition<
  TSchema extends ZodTypeAny = ZodTypeAny,
  TResult = unknown,
> extends AssistantCapabilityDefinition<TSchema, TResult> {
  provenance: AssistantToolProvenance
  backendKind: AssistantCapabilityBackendKind
  mutationSemantics: AssistantCapabilityMutationSemantics
  riskClass: AssistantCapabilityRiskClass
  preferredHostKind: AssistantCapabilityHostKind
  outputSchema: ZodType<TResult>
}

export type AnyNormalizedAssistantCapabilityDefinition =
  NormalizedAssistantCapabilityDefinition<ZodTypeAny, unknown>

export interface AssistantCapabilitySpec {
  backendKind: AssistantCapabilityBackendKind
  description: string
  supportedHostKinds: AssistantCapabilityHostKind[]
  inputExample: JsonRecord | null
  mutationSemantics: AssistantCapabilityMutationSemantics
  name: string
  preferredHostKind: AssistantCapabilityHostKind
  provenance: AssistantToolProvenance
  riskClass: AssistantCapabilityRiskClass
}

export interface AssistantCapabilityRegistry {
  createToolCatalog(hosts: readonly AssistantCapabilityHost[]): AssistantToolCatalog
  getCapability(name: string): AssistantCapabilitySpec | null
  hasCapability(name: string): boolean
  listCapabilities(): AssistantCapabilitySpec[]
}

export interface AssistantCapabilityHost {
  readonly hostKind: AssistantCapabilityHostKind
  bindCapability(
    capability: AnyNormalizedAssistantCapabilityDefinition,
  ): AnyAssistantBoundToolDefinition | null
}

function resolveAssistantOutputSchema<TResult>(
  outputSchema?: ZodType<TResult>,
): ZodType<TResult> {
  return outputSchema ?? z.custom<TResult>(() => true)
}

export function defineAssistantCapability<
  TSchema extends ZodTypeAny,
  TResult = unknown,
>(
  definition: AssistantCapabilityDefinition<TSchema, TResult>,
): NormalizedAssistantCapabilityDefinition<TSchema, TResult> {
  const provenance = definition.provenance ?? inferAssistantToolProvenance(definition.name)
  const backendKind =
    definition.backendKind ?? inferAssistantCapabilityBackendKind(definition.name, provenance)
  const preferredHostKind =
    definition.preferredHostKind ??
    inferAssistantCapabilityHostKind(definition.name, provenance)
  const mutationSemantics =
    definition.mutationSemantics ??
    inferAssistantCapabilityMutationSemantics(definition.name, provenance)
  const executionBindings = Object.fromEntries(
    Object.entries(definition.executionBindings).filter(
      (entry): entry is [
        AssistantCapabilityHostKind,
        AssistantCapabilityExecutor<TSchema, TResult>,
      ] => entry[1] !== undefined,
    ),
  ) as Partial<Record<AssistantCapabilityHostKind, AssistantCapabilityExecutor<TSchema, TResult>>>
  const supportedHostKinds = Object.keys(executionBindings) as AssistantCapabilityHostKind[]
  const defaultBinding = executionBindings[preferredHostKind]

  if (supportedHostKinds.length === 0) {
    throw new Error(
      `Assistant capability "${definition.name}" must declare at least one execution binding.`,
    )
  }

  if (defaultBinding === undefined) {
    throw new Error(
      `Assistant capability "${definition.name}" prefers host "${preferredHostKind}" but does not declare a binding for it.`,
    )
  }

  return {
    ...definition,
    provenance,
    backendKind,
    mutationSemantics,
    riskClass:
      definition.riskClass ??
      inferAssistantCapabilityRiskClass(mutationSemantics, definition.name, provenance),
    preferredHostKind,
    outputSchema: resolveAssistantOutputSchema(definition.outputSchema),
    executionBindings,
  }
}

export function inferAssistantToolProvenance(name: string): AssistantToolProvenance {
  if (name === 'vault.cli.run') {
    return {
      origin: 'cli-backed',
      localOnly: true,
      generatedFrom: 'vault-cli',
      policyWrappers: [
        'command-blocking',
        'default-vault-injection',
        'format-default',
        'stdin-input-materialization',
        'argv-redaction',
        'output-redaction',
      ],
    }
  }

  if (name === 'murph.device.connect') {
    return {
      origin: 'hosted-api-backed',
      localOnly: false,
      generatedFrom: null,
      policyWrappers: [],
    }
  }

  if (name.startsWith('assistant.web.') || name.startsWith('web.')) {
    return {
      origin: 'configured-web-read',
      localOnly: false,
      generatedFrom: null,
      policyWrappers: [],
    }
  }

  if (name.startsWith('vault.fs.')) {
    return {
      origin: 'native-local-only',
      localOnly: true,
      generatedFrom: null,
      policyWrappers: ['output-redaction'],
    }
  }

  if (name.startsWith('vault.') || name.startsWith('inbox.')) {
    return {
      origin: 'vault-service-backed',
      localOnly: true,
      generatedFrom: null,
      policyWrappers: [],
    }
  }

  return {
    origin: 'hand-authored-helper',
    localOnly: true,
    generatedFrom: null,
    policyWrappers: [],
  }
}

export function inferAssistantCapabilityHostKind(
  _name: string,
  provenance: AssistantToolProvenance,
): AssistantCapabilityHostKind {
  if (provenance.origin === 'cli-backed') {
    return 'cli-backed'
  }

  return 'native-local'
}

function inferAssistantCapabilityBackendKind(
  _name: string,
  provenance: AssistantToolProvenance,
): AssistantCapabilityBackendKind {
  switch (provenance.origin) {
    case 'cli-backed':
      return 'cli-wrapper'
    case 'configured-web-read':
      return 'configured-web-read'
    case 'hosted-api-backed':
      return 'hosted-api'
    case 'native-local-only':
      return 'native-file'
    case 'descriptor-generated':
    case 'hand-authored-helper':
    case 'vault-service-backed':
      return 'local-service'
  }
}

function inferAssistantCapabilityMutationSemantics(
  name: string,
  provenance: AssistantToolProvenance,
): AssistantCapabilityMutationSemantics {
  if (name === 'vault.cli.run' || provenance.origin === 'cli-backed') {
    return 'mixed'
  }

  if (name.startsWith('murph.device.')) {
    return 'outward-side-effect'
  }

  if (
    name === 'assistant.selfTarget.list' ||
    name === 'assistant.selfTarget.show'
  ) {
    return 'read-only'
  }

  if (
    name.startsWith('assistant.knowledge.upsert') ||
    name.startsWith('assistant.knowledge.rebuildIndex') ||
    name.startsWith('assistant.selfTarget.')
  ) {
    return 'assistant-runtime-write'
  }

  if (
    name.startsWith('vault.') ||
    name.startsWith('inbox.promote.')
  ) {
    if (
      name.endsWith('.show') ||
      name.endsWith('.list') ||
      name.endsWith('.search') ||
      name.endsWith('.get') ||
      name.endsWith('.lint') ||
      name.endsWith('.sources') ||
      name.endsWith('.day') ||
      name.endsWith('.sleep') ||
      name.endsWith('.activity') ||
      name.endsWith('.body') ||
      name.endsWith('.recovery') ||
      name.endsWith('.readText')
    ) {
      return 'read-only'
    }

    return 'canonical-write'
  }

  return 'read-only'
}

function inferAssistantCapabilityRiskClass(
  mutationSemantics: AssistantCapabilityMutationSemantics,
  _name: string,
  _provenance: AssistantToolProvenance,
): AssistantCapabilityRiskClass {
  switch (mutationSemantics) {
    case 'read-only':
      return 'low'
    case 'assistant-runtime-write':
      return 'medium'
    case 'mixed':
    case 'canonical-write':
    case 'outward-side-effect':
      return 'high'
  }
}

export function createAssistantCapabilityRegistry<
  const TDefinitions extends readonly AnyAssistantCapabilityDefinition[],
>(
  definitions: TDefinitions,
): AssistantCapabilityRegistry {
  const capabilityMap = new Map<string, AnyNormalizedAssistantCapabilityDefinition>()

  for (const definition of definitions) {
    const normalizedDefinition = defineAssistantCapability(definition)
    if (capabilityMap.has(normalizedDefinition.name)) {
      throw new Error(
        `Duplicate assistant capability "${normalizedDefinition.name}" cannot be registered.`,
      )
    }
    capabilityMap.set(normalizedDefinition.name, normalizedDefinition)
  }

  return {
    createToolCatalog(hosts) {
      return bindAssistantCapabilitiesToCatalog(
        Array.from(capabilityMap.values()),
        hosts,
      )
    },

    getCapability(name) {
      const capability = capabilityMap.get(name)
      return capability ? toAssistantCapabilitySpec(capability) : null
    },

    hasCapability(name) {
      return capabilityMap.has(name)
    },

    listCapabilities() {
      return Array.from(capabilityMap.values()).map((capability) =>
        toAssistantCapabilitySpec(capability),
      )
    },
  }
}

export class CliBackedCapabilityHost implements AssistantCapabilityHost {
  readonly hostKind = 'cli-backed' as const

  bindCapability(
    capability: AnyNormalizedAssistantCapabilityDefinition,
  ): AnyAssistantBoundToolDefinition | null {
    return bindAssistantCapabilityToBoundTool(capability, this.hostKind)
  }
}

export class NativeLocalCapabilityHost implements AssistantCapabilityHost {
  readonly hostKind = 'native-local' as const

  bindCapability(
    capability: AnyNormalizedAssistantCapabilityDefinition,
  ): AnyAssistantBoundToolDefinition | null {
    return bindAssistantCapabilityToBoundTool(capability, this.hostKind)
  }
}

function toAssistantCapabilitySpec(
  capability: AnyNormalizedAssistantCapabilityDefinition,
): AssistantCapabilitySpec {
  return {
    backendKind: capability.backendKind,
    name: capability.name,
    description: capability.description,
    inputExample: capability.inputExample ?? null,
    mutationSemantics: capability.mutationSemantics,
    riskClass: capability.riskClass,
    preferredHostKind: capability.preferredHostKind,
    supportedHostKinds: Object.keys(
      capability.executionBindings,
    ) as AssistantCapabilityHostKind[],
    provenance: capability.provenance,
  }
}

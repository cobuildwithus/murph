import { createHash } from 'node:crypto'

import { tool, type ToolSet } from 'ai'
import { z, type ZodType, type ZodTypeAny } from 'zod'

import { errorMessage } from '@murphai/operator-config/text/shared'

import {
  assistantToolExecutionResultSchema,
  assistantToolSpecSchema,
  type AssistantToolCall,
  type AssistantToolExecutionResult,
  type AssistantToolProvenance,
  type AssistantToolSpec,
} from '../inbox-model-contracts.js'
import {
  defineAssistantCapability,
  type AnyAssistantCapabilityDefinition,
  type AnyNormalizedAssistantCapabilityDefinition,
  type AssistantCapabilityBackendKind,
  type AssistantCapabilityHost,
  type AssistantCapabilityHostKind,
  type AssistantCapabilityMutationSemantics,
  type AssistantCapabilityRiskClass,
  type JsonRecord,
} from './capabilities.js'

export interface AssistantBoundToolDefinition<
  TSchema extends ZodTypeAny = ZodTypeAny,
  TResult = unknown,
> {
  name: string
  description: string
  provenance: AssistantToolProvenance
  backendKind: AssistantCapabilityBackendKind
  mutationSemantics: AssistantCapabilityMutationSemantics
  riskClass: AssistantCapabilityRiskClass
  preferredHostKind: AssistantCapabilityHostKind
  selectedHostKind: AssistantCapabilityHostKind
  inputSchema: TSchema
  outputSchema: ZodType<TResult>
  inputExample?: JsonRecord
  execute(input: z.infer<TSchema>): Promise<TResult>
}

export type AnyAssistantBoundToolDefinition = AssistantBoundToolDefinition<
  ZodTypeAny,
  unknown
>

const ASSISTANT_TOOL_CACHE_SIGNATURE_VERSION =
  'murph.assistant-tool-cache-signature.v1'

export type AssistantToolExecutionMode = 'preview' | 'apply'

export interface AssistantAiSdkToolEvent {
  errorCode?: string | null
  errorMessage?: string | null
  input: JsonRecord
  kind: 'failed' | 'previewed' | 'started' | 'succeeded'
  mode: AssistantToolExecutionMode
  result?: JsonRecord | null
  tool: string
}

export interface AssistantCreateAiSdkToolsOptions {
  onToolEvent?: (event: AssistantAiSdkToolEvent) => void
}

export interface AssistantToolCatalog {
  createAiSdkTools(
    mode?: AssistantToolExecutionMode,
    options?: AssistantCreateAiSdkToolsOptions,
  ): ToolSet
  executeCalls(input: {
    calls: readonly AssistantToolCall[]
    maxCalls?: number
    mode?: AssistantToolExecutionMode
  }): Promise<AssistantToolExecutionResult[]>
  hasTool(name: string): boolean
  listTools(): AssistantToolSpec[]
  promptCacheToolSchemaHash?(): string
}

export function createBoundAssistantToolCatalog(
  definitions: readonly AnyAssistantBoundToolDefinition[],
): AssistantToolCatalog {
  const orderedDefinitions = sortAssistantBoundToolDefinitions(definitions)
  const promptCacheToolSchemaHash =
    hashAssistantBoundToolDefinitionsForPromptCache(orderedDefinitions)
  const toolMap = new Map<string, AnyAssistantBoundToolDefinition>()

  for (const definition of orderedDefinitions) {
    if (toolMap.has(definition.name)) {
      throw new Error(
        `Duplicate assistant bound tool "${definition.name}" cannot be added to one catalog.`,
      )
    }
    toolMap.set(definition.name, definition)
  }

  return {
    createAiSdkTools(mode = 'preview', options = {}) {
      const tools: ToolSet = {}

      for (const definition of toolMap.values()) {
        tools[definition.name] = tool<z.infer<typeof definition.inputSchema>, unknown>({
          description: definition.description,
          inputSchema: definition.inputSchema as ZodType<
            z.infer<typeof definition.inputSchema>
          >,
          execute: async (toolInput) => {
            const normalizedInput = normalizeJsonRecord(toolInput)
            options.onToolEvent?.({
              input: normalizedInput,
              kind: 'started',
              mode,
              tool: definition.name,
            })

            const executionResult = await executeKnownToolCall({
              definition,
              input: toolInput,
              mode,
            })

            if (executionResult.status === 'failed') {
              options.onToolEvent?.({
                errorCode: executionResult.errorCode,
                errorMessage: executionResult.errorMessage,
                input: normalizedInput,
                kind: 'failed',
                mode,
                tool: definition.name,
              })
              return executionResult
            }

            options.onToolEvent?.({
              input: normalizedInput,
              kind: mode === 'preview' ? 'previewed' : 'succeeded',
              mode,
              result: executionResult.result,
              tool: definition.name,
            })
            return executionResult
          },
        })
      }

      return tools
    },

    async executeCalls(input) {
      const maxCalls = input.maxCalls ?? input.calls.length
      const mode = input.mode ?? 'apply'
      const results: AssistantToolExecutionResult[] = []

      for (const [index, call] of input.calls.entries()) {
        if (index >= maxCalls) {
          results.push(
            assistantToolExecutionResultSchema.parse({
              tool: call.tool,
              input: normalizeJsonRecord(call.input),
              status: 'skipped',
              result: null,
              errorCode: null,
              errorMessage: 'Skipped because the plan exceeded the configured call limit.',
            }),
          )
          continue
        }

        results.push(await executeCall(toolMap, call, mode))
      }

      return results
    },

    hasTool(name) {
      return toolMap.has(name)
    },

    listTools() {
      return Array.from(toolMap.values()).map((definition) =>
        assistantToolSpecSchema.parse({
          name: definition.name,
          description: definition.description,
          inputExample: definition.inputExample ?? null,
          backendKind: definition.backendKind,
          mutationSemantics: definition.mutationSemantics,
          riskClass: definition.riskClass,
          preferredHostKind: definition.preferredHostKind,
          selectedHostKind: definition.selectedHostKind,
          provenance: definition.provenance,
        }),
      )
    },

    promptCacheToolSchemaHash() {
      return promptCacheToolSchemaHash
    },
  }
}

export function createAssistantToolCatalogFromCapabilities(
  capabilities: readonly AnyAssistantCapabilityDefinition[],
  hosts: readonly AssistantCapabilityHost[],
): AssistantToolCatalog {
  const capabilityMap = new Map<string, AnyNormalizedAssistantCapabilityDefinition>()

  for (const definition of capabilities) {
    const normalizedDefinition = defineAssistantCapability(definition)
    if (capabilityMap.has(normalizedDefinition.name)) {
      throw new Error(
        `Duplicate assistant capability "${normalizedDefinition.name}" cannot be registered.`,
      )
    }
    capabilityMap.set(normalizedDefinition.name, normalizedDefinition)
  }

  return bindAssistantCapabilitiesToCatalog(
    Array.from(capabilityMap.values()),
    hosts,
  )
}

export function normalizeJsonRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      value,
    }
  }

  return value as JsonRecord
}

export async function executeCall<TDefinition extends AnyAssistantBoundToolDefinition>(
  toolMap: Map<string, TDefinition>,
  call: AssistantToolCall,
  mode: AssistantToolExecutionMode,
): Promise<AssistantToolExecutionResult> {
  const definition = toolMap.get(call.tool)
  if (!definition) {
    return assistantToolExecutionResultSchema.parse({
      tool: call.tool,
      input: normalizeJsonRecord(call.input),
      status: 'failed',
      result: null,
      errorCode: 'ASSISTANT_TOOL_UNKNOWN',
      errorMessage: `Unknown assistant tool "${call.tool}".`,
    })
  }

  return executeKnownToolCall({
    definition,
    input: call.input,
    mode,
  })
}

export async function executeKnownToolCall<
  TDefinition extends AnyAssistantBoundToolDefinition,
>(input: {
  definition: TDefinition
  input: unknown
  mode: AssistantToolExecutionMode
}): Promise<AssistantToolExecutionResult> {
  try {
    const parsedInput = input.definition.inputSchema.parse(input.input)
    const result = await executeDefinition(
      input.definition,
      parsedInput,
      input.mode,
    )
    const status = input.mode === 'preview' ? 'previewed' : 'succeeded'

    return assistantToolExecutionResultSchema.parse({
      tool: input.definition.name,
      input: normalizeJsonRecord(parsedInput),
      status,
      result: normalizeJsonRecord(result),
      errorCode: null,
      errorMessage: null,
    })
  } catch (error) {
    return buildAssistantToolFailureResult(
      input.definition.name,
      normalizeJsonRecord(input.input),
      error,
    )
  }
}

export function buildAssistantToolFailureResult(
  toolName: string,
  input: JsonRecord,
  error: unknown,
): AssistantToolExecutionResult {
  return assistantToolExecutionResultSchema.parse({
    tool: toolName,
    input,
    status: 'failed',
    result: null,
    errorCode: inferAssistantErrorCode(error),
    errorMessage: errorMessage(error),
  })
}

export async function executeDefinition<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantBoundToolDefinition<TSchema, TResult>,
  input: z.infer<TSchema>,
  mode: AssistantToolExecutionMode,
): Promise<TResult | JsonRecord> {
  if (mode === 'preview') {
    return {
      preview: true,
      tool: definition.name,
      input: normalizeJsonRecord(input),
    }
  }

  return definition.outputSchema.parse(await definition.execute(input))
}

export function resolveAssistantCapabilityHostBinding(
  capability: AnyNormalizedAssistantCapabilityDefinition,
  hosts: readonly AssistantCapabilityHost[],
): AnyAssistantBoundToolDefinition | null {
  const preferredHost = hosts.find(
    (host) => host.hostKind === capability.preferredHostKind,
  )

  if (preferredHost) {
    const preferredBinding = preferredHost.bindCapability(capability)
    if (preferredBinding) {
      return preferredBinding
    }
  }

  for (const host of hosts) {
    const binding = host.bindCapability(capability)
    if (binding) {
      return binding
    }
  }

  return null
}

export function bindAssistantCapabilitiesToCatalog(
  capabilities: readonly AnyNormalizedAssistantCapabilityDefinition[],
  hosts: readonly AssistantCapabilityHost[],
): AssistantToolCatalog {
  return createBoundAssistantToolCatalog(
    capabilities.flatMap((capability) => {
      const boundTool = resolveAssistantCapabilityHostBinding(capability, hosts)
      return boundTool ? [boundTool] : []
    }),
  )
}

export function bindAssistantCapabilityToBoundTool(
  capability: AnyNormalizedAssistantCapabilityDefinition,
  selectedHostKind: AssistantCapabilityHostKind,
): AnyAssistantBoundToolDefinition | null {
  const execute = capability.executionBindings[selectedHostKind]
  if (!execute) {
    return null
  }

  return {
    name: capability.name,
    description: capability.description,
    provenance: capability.provenance,
    backendKind: capability.backendKind,
    mutationSemantics: capability.mutationSemantics,
    riskClass: capability.riskClass,
    preferredHostKind: capability.preferredHostKind,
    selectedHostKind,
    inputSchema: capability.inputSchema,
    outputSchema: capability.outputSchema,
    inputExample: capability.inputExample,
    execute: async (input) => await execute(input),
  }
}

export function hashAssistantToolCatalogForPromptCache(
  toolCatalog: Pick<AssistantToolCatalog, 'promptCacheToolSchemaHash'>,
): string {
  const promptCacheToolSchemaHash = toolCatalog.promptCacheToolSchemaHash?.()
  if (promptCacheToolSchemaHash) {
    return promptCacheToolSchemaHash
  }

  throw new Error('Assistant tool catalog is missing a schema-aware prompt cache hash.')
}

function hashAssistantBoundToolDefinitionsForPromptCache(
  definitions: readonly AnyAssistantBoundToolDefinition[],
): string {
  return hashAssistantToolCacheValue({
    schema: ASSISTANT_TOOL_CACHE_SIGNATURE_VERSION,
    tools: sortAssistantBoundToolDefinitions(definitions).map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputExample: definition.inputExample ?? null,
      inputSchema: z.toJSONSchema(definition.inputSchema, {
        io: 'input',
        unrepresentable: 'any',
      }),
      backendKind: definition.backendKind,
      mutationSemantics: definition.mutationSemantics,
      riskClass: definition.riskClass,
      preferredHostKind: definition.preferredHostKind,
      selectedHostKind: definition.selectedHostKind,
      provenance: definition.provenance,
    })),
  })
}

function sortAssistantBoundToolDefinitions(
  definitions: readonly AnyAssistantBoundToolDefinition[],
): AnyAssistantBoundToolDefinition[] {
  return [...definitions].sort((left, right) => left.name.localeCompare(right.name))
}

function hashAssistantToolCacheValue(value: unknown): string {
  return createHash('sha256')
    .update(stableStringifyAssistantToolCacheValue(value))
    .digest('hex')
}

function stableStringifyAssistantToolCacheValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }

  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyAssistantToolCacheValue).join(',')}]`
  }

  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .sort()
    .flatMap((key) =>
      record[key] === undefined
        ? []
        : [
            `${JSON.stringify(key)}:${stableStringifyAssistantToolCacheValue(
              record[key],
            )}`,
          ],
    )
  return `{${entries.join(',')}}`
}

function inferAssistantErrorCode(error: unknown): string {
  if (error instanceof z.ZodError) {
    return 'ASSISTANT_TOOL_INPUT_INVALID'
  }

  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code
  }

  return 'ASSISTANT_TOOL_EXECUTION_FAILED'
}

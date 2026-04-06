import {
  generateObject,
  generateText,
  gateway,
  Output,
  stepCountIs,
  tool,
  type LanguageModel,
  type ToolSet,
} from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z, type ZodType, type ZodTypeAny } from 'zod'
import {
  assistantToolExecutionResultSchema,
  assistantToolSpecSchema,
  type AssistantToolCall,
  type AssistantToolBackendKind,
  type AssistantToolExecutionResult,
  type AssistantToolHostKind,
  type AssistantToolMutationSemantics,
  type AssistantToolProvenance,
  type AssistantToolRiskClass,
  type AssistantToolSpec,
} from './inbox-model-contracts.js'
import { errorMessage } from './text/shared.js'
import { isAssistantOpenAIBaseUrl } from './assistant/shared.js'

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

type AnyAssistantCapabilityDefinition = AssistantCapabilityDefinition<ZodTypeAny, unknown>

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

type AnyNormalizedAssistantCapabilityDefinition = NormalizedAssistantCapabilityDefinition<
  ZodTypeAny,
  unknown
>

interface AssistantBoundToolDefinition<
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

type AnyAssistantBoundToolDefinition = AssistantBoundToolDefinition<ZodTypeAny, unknown>

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
  const defaultBinding = definition.executionBindings[preferredHostKind]
  const executionBindings =
    defaultBinding === undefined
      ? definition.executionBindings
      : {
          ...definition.executionBindings,
          [preferredHostKind]: defaultBinding,
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

function inferAssistantToolProvenance(name: string): AssistantToolProvenance {
  if (name === 'murph.cli.run') {
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

  if (name === 'vault.share.createLink' || name === 'murph.device.connect') {
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

function inferAssistantCapabilityHostKind(
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
  if (name === 'murph.cli.run' || provenance.origin === 'cli-backed') {
    return 'mixed'
  }

  if (name.startsWith('vault.share.') || name.startsWith('murph.device.')) {
    return 'outward-side-effect'
  }

  if (
    name.startsWith('assistant.state.') ||
    name.startsWith('assistant.knowledge.upsert') ||
    name.startsWith('assistant.knowledge.rebuildIndex') ||
    name.startsWith('assistant.cron.') ||
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

export interface AssistantModelTextPart {
  type: 'text'
  text: string
}

export interface AssistantModelImagePart {
  type: 'image'
  image: string | Uint8Array | Buffer | ArrayBuffer | URL
  mediaType?: string
  mimeType?: string
}

export interface AssistantModelFilePart {
  type: 'file'
  data: string | Uint8Array | Buffer | ArrayBuffer | URL
  mediaType: string
  filename?: string
}

export type AssistantModelContentPart =
  | AssistantModelTextPart
  | AssistantModelImagePart
  | AssistantModelFilePart
  | Record<string, unknown>

export type AssistantUserMessageContentPart =
  | AssistantModelTextPart
  | AssistantModelImagePart
  | AssistantModelFilePart

export interface AssistantModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | AssistantModelContentPart[]
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
}

export interface AssistantModelSpec {
  apiKey?: string
  apiKeyEnv?: string
  baseUrl?: string
  headers?: Record<string, string>
  model: string
  providerName?: string
}

export interface GenerateAssistantObjectInput<TSchema extends z.ZodTypeAny> {
  maxSteps?: number
  messages?: AssistantModelMessage[]
  model: LanguageModel
  prompt?: string
  schema: TSchema
  schemaName?: string
  system?: string
  temperature?: number
  tools?: ToolSet
}

const OPENAI_RESPONSES_AUTO_COMPACTION_THRESHOLD = 200_000
const OPENAI_RESPONSES_AUTO_COMPACTION_CONTEXT = Object.freeze([
  {
    type: 'compaction',
    compact_threshold: OPENAI_RESPONSES_AUTO_COMPACTION_THRESHOLD,
  },
] as const)

type AssistantFetchInput = Parameters<typeof fetch>[0]
type AssistantFetchInit = Parameters<typeof fetch>[1]

function createBoundAssistantToolCatalog(
  definitions: readonly AnyAssistantBoundToolDefinition[],
): AssistantToolCatalog {
  const toolMap = new Map<string, AnyAssistantBoundToolDefinition>()

  for (const definition of definitions) {
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

            try {
              const result = await executeDefinition(definition, toolInput, mode)
              const normalizedResult = normalizeJsonRecord(result)
              options.onToolEvent?.({
                input: normalizedInput,
                kind: mode === 'preview' ? 'previewed' : 'succeeded',
                mode,
                result: normalizedResult,
                tool: definition.name,
              })
              return result
            } catch (error) {
              options.onToolEvent?.({
                errorCode: inferAssistantErrorCode(error),
                errorMessage: errorMessage(error),
                input: normalizedInput,
                kind: 'failed',
                mode,
                tool: definition.name,
              })
              throw error
            }
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
  }
}

export function createAssistantToolCatalogFromCapabilities(
  capabilities: readonly AnyAssistantCapabilityDefinition[],
  hosts: readonly AssistantCapabilityHost[],
): AssistantToolCatalog {
  return createAssistantCapabilityRegistry(capabilities).createToolCatalog(hosts)
}

export async function generateAssistantObject<TSchema extends z.ZodTypeAny>(
  input: GenerateAssistantObjectInput<TSchema>,
): Promise<z.infer<TSchema>> {
  const promptOrMessages = resolveAssistantPromptOrMessages(input)

  if (input.tools || 'messages' in promptOrMessages) {
    const result = await generateText({
      model: input.model,
      system: input.system,
      temperature: input.temperature,
      ...(input.tools
        ? {
            tools: input.tools,
            stopWhen: stepCountIs(input.maxSteps ?? 6),
          }
        : {}),
      ...promptOrMessages,
      experimental_output: Output.object({
        schema: input.schema,
      }),
    } as Parameters<typeof generateText>[0])

    return input.schema.parse(
      (result as { experimental_output?: unknown; output?: unknown }).experimental_output ??
        (result as { output?: unknown }).output,
    )
  }

  const result = await generateObject({
    model: input.model,
    system: input.system,
    prompt: promptOrMessages.prompt,
    temperature: input.temperature,
    schema: input.schema,
    schemaName: input.schemaName,
  })

  return input.schema.parse(result.object)
}

export function resolveAssistantLanguageModel(
  spec: AssistantModelSpec,
): LanguageModel {
  if (spec.baseUrl) {
    if (isAssistantOpenAIBaseUrl(spec.baseUrl)) {
      const provider = createOpenAI({
        name: normalizeAssistantProviderName(spec.providerName),
        apiKey: resolveAssistantApiKey(spec),
        baseURL: spec.baseUrl,
        headers: spec.headers,
        fetch: createAssistantOpenAIResponsesFetch(),
      })

      return provider.responses(spec.model)
    }

    const provider = createOpenAICompatible({
      name: normalizeAssistantProviderName(spec.providerName),
      apiKey: resolveAssistantApiKey(spec),
      baseURL: spec.baseUrl,
      headers: spec.headers,
    })

    return provider(spec.model)
  }

  return gateway(spec.model)
}

export function normalizeJsonRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      value,
    }
  }

  return value as JsonRecord
}

async function executeCall<TDefinition extends AnyAssistantBoundToolDefinition>(
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

  try {
    const parsedInput = definition.inputSchema.parse(call.input)
    const result = await executeDefinition(definition, parsedInput, mode)
    const status = mode === 'preview' ? 'previewed' : 'succeeded'

    return assistantToolExecutionResultSchema.parse({
      tool: definition.name,
      input: normalizeJsonRecord(parsedInput),
      status,
      result: normalizeJsonRecord(result),
      errorCode: null,
      errorMessage: null,
    })
  } catch (error) {
    return assistantToolExecutionResultSchema.parse({
      tool: definition.name,
      input: normalizeJsonRecord(call.input),
      status: 'failed',
      result: null,
      errorCode: inferAssistantErrorCode(error),
      errorMessage: errorMessage(error),
    })
  }
}

async function executeDefinition<
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

function resolveAssistantCapabilityHostBinding(
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

function bindAssistantCapabilitiesToCatalog(
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

function bindAssistantCapabilityToBoundTool(
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

function resolveAssistantPromptOrMessages(
  input: Pick<GenerateAssistantObjectInput<z.ZodTypeAny>, 'messages' | 'prompt'>,
): { messages: AssistantModelMessage[] } | { prompt: string } {
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    return {
      messages: input.messages,
    }
  }

  if (typeof input.prompt === 'string' && input.prompt.trim().length > 0) {
    return {
      prompt: input.prompt,
    }
  }

  throw new Error('Assistant generation requires either a prompt string or at least one message.')
}

function createAssistantOpenAIResponsesFetch(
  baseFetch: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  return async (input: AssistantFetchInput, init?: AssistantFetchInit) => {
    const nextInit = await maybeInjectAssistantOpenAIResponsesCompaction(
      input,
      init,
    )
    return await baseFetch(input, nextInit)
  }
}

async function maybeInjectAssistantOpenAIResponsesCompaction(
  input: AssistantFetchInput,
  init?: AssistantFetchInit,
): Promise<AssistantFetchInit | undefined> {
  if (!shouldInjectAssistantOpenAIResponsesCompaction(input, init)) {
    return init
  }

  const body = await readAssistantFetchBody(input, init)
  if (!body) {
    return init
  }

  let payload: Record<string, unknown>

  try {
    payload = JSON.parse(body) as Record<string, unknown>
  } catch {
    return init
  }

  if ('context_management' in payload) {
    return init
  }

  return {
    ...init,
    body: JSON.stringify({
      ...payload,
      context_management: OPENAI_RESPONSES_AUTO_COMPACTION_CONTEXT,
    }),
  }
}

function shouldInjectAssistantOpenAIResponsesCompaction(
  input: AssistantFetchInput,
  init?: AssistantFetchInit,
): boolean {
  const url = readAssistantFetchUrl(input)
  if (!url) {
    return false
  }

  const method = (
    init?.method ??
    (input instanceof Request ? input.method : 'POST')
  ).toUpperCase()

  if (method !== 'POST') {
    return false
  }

  try {
    return new URL(url).pathname.endsWith('/responses')
  } catch {
    return false
  }
}

function readAssistantFetchUrl(
  input: AssistantFetchInput,
): string | null {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  if (input instanceof Request) {
    return input.url
  }

  return null
}

async function readAssistantFetchBody(
  input: AssistantFetchInput,
  init?: AssistantFetchInit,
): Promise<string | null> {
  if (typeof init?.body === 'string') {
    return init.body
  }

  if (input instanceof Request) {
    try {
      return await input.clone().text()
    } catch {
      return null
    }
  }

  return null
}

function resolveAssistantApiKey(spec: AssistantModelSpec): string | undefined {
  if (typeof spec.apiKey === 'string' && spec.apiKey.length > 0) {
    return spec.apiKey
  }

  if (typeof spec.apiKeyEnv === 'string' && spec.apiKeyEnv.length > 0) {
    const value = process.env[spec.apiKeyEnv]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }

  return undefined
}

function normalizeAssistantProviderName(value: string | null | undefined): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }

  return 'murph-assistant'
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

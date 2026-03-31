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
  type AssistantToolExecutionResult,
  type AssistantToolSpec,
} from './inbox-model-contracts.js'
import { errorMessage } from './text/shared.js'
import { isAssistantOpenAIBaseUrl } from './assistant/shared.js'

export type JsonRecord = Record<string, unknown>

export interface AssistantToolDefinition<
  TSchema extends ZodTypeAny = ZodTypeAny,
  TResult = unknown,
> {
  name: string
  description: string
  inputSchema: TSchema
  inputExample?: JsonRecord
  execute(input: z.infer<TSchema>): Promise<TResult>
}

type AnyAssistantToolDefinition = AssistantToolDefinition<ZodTypeAny, unknown>

export function defineAssistantTool<
  TSchema extends ZodTypeAny,
  TResult = unknown,
>(
  definition: AssistantToolDefinition<TSchema, TResult>,
): AssistantToolDefinition<TSchema, TResult> {
  return definition
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

export function createAssistantToolCatalog<
  const TDefinitions extends readonly AnyAssistantToolDefinition[],
>(
  definitions: TDefinitions,
): AssistantToolCatalog {
  const toolMap = new Map<string, TDefinitions[number]>()

  for (const definition of definitions) {
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
        }),
      )
    },
  }
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

async function executeCall<TDefinition extends AnyAssistantToolDefinition>(
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
  definition: AssistantToolDefinition<TSchema, TResult>,
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

  return definition.execute(input)
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

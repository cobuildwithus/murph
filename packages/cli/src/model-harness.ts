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

export type AssistantModelContentPart =
  | AssistantModelTextPart
  | AssistantModelImagePart
  | Record<string, unknown>

export interface AssistantModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | AssistantModelContentPart[]
}

export interface AssistantToolCatalog {
  createAiSdkTools(mode?: AssistantToolExecutionMode): ToolSet
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
    createAiSdkTools(mode = 'preview') {
      const tools: ToolSet = {}

      for (const definition of toolMap.values()) {
        tools[definition.name] = tool<z.infer<typeof definition.inputSchema>, unknown>({
          description: definition.description,
          inputSchema: definition.inputSchema as ZodType<
            z.infer<typeof definition.inputSchema>
          >,
          execute: async (toolInput) =>
            executeDefinition(definition, toolInput, mode),
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

  return 'healthybob-assistant'
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

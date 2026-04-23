import {
  generateObject,
  generateText,
  Output,
  type LanguageModel,
} from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import type { AssistantExecutionDriver } from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

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

export type AssistantUserMessageContentPart =
  | AssistantModelTextPart
  | AssistantModelImagePart
  | AssistantModelFilePart

export interface AssistantModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | AssistantUserMessageContentPart[]
}

export interface AssistantResponsesRequestPolicy {
  gatewayOnlyProviders?: readonly string[] | null
  gatewayReporting?: {
    tags?: readonly string[]
    user?: string | null
  }
  gatewayZeroDataRetention?: boolean
}

export interface AssistantModelSpec {
  apiKey?: string
  apiKeyEnv?: string
  baseUrl?: string
  executionDriver?: AssistantExecutionDriver
  headers?: Record<string, string>
  model: string
  providerName?: string
  responsesRequestPolicy?: AssistantResponsesRequestPolicy
}

export const ASSISTANT_MODEL_CONFIG_INVALID_CODE =
  'assistant_model_config_invalid' as const

export interface GenerateAssistantObjectInput<TSchema extends z.ZodTypeAny> {
  messages?: AssistantModelMessage[]
  model: LanguageModel
  prompt?: string
  schema: TSchema
  schemaName?: string
  system?: string
  temperature?: number
}

type ValidatedAssistantModelSpec =
  | {
      baseUrl?: string
      executionDriver: 'responses'
    }
  | {
      baseUrl: string
      executionDriver: 'openai-compatible'
    }

const OPENAI_RESPONSES_AUTO_COMPACTION_THRESHOLD = 200_000
const ASSISTANT_RESPONSES_AUTO_COMPACTION_CONTEXT = Object.freeze([
  {
    type: 'compaction',
    compact_threshold: OPENAI_RESPONSES_AUTO_COMPACTION_THRESHOLD,
  },
] as const)

type AssistantFetchInput = Parameters<typeof fetch>[0]
type AssistantFetchInit = Parameters<typeof fetch>[1]

export function assertAssistantModelSpecReadyForExecution(
  spec: AssistantModelSpec,
): void {
  validateAssistantModelSpecForExecution(spec, 'assert')
}

export async function generateAssistantObject<TSchema extends z.ZodTypeAny>(
  input: GenerateAssistantObjectInput<TSchema>,
): Promise<z.infer<TSchema>> {
  const promptOrMessages = resolveAssistantPromptOrMessages(input)

  if ('messages' in promptOrMessages) {
    const result = await generateText({
      model: input.model,
      system: input.system,
      temperature: input.temperature,
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
  const { baseUrl, executionDriver } =
    validateAssistantModelSpecForExecution(spec, 'resolve')

  switch (executionDriver) {
    case 'responses': {
      const provider = createOpenAI({
        name: normalizeAssistantProviderName(spec.providerName),
        apiKey: resolveAssistantApiKey(spec),
        ...(baseUrl ? { baseURL: baseUrl } : {}),
        ...(spec.headers ? { headers: spec.headers } : {}),
        fetch: createAssistantResponsesFetch(spec.responsesRequestPolicy),
      })

      return provider.responses(spec.model)
    }

    case 'openai-compatible':
    default: {
      const provider = createOpenAICompatible({
        name: normalizeAssistantProviderName(spec.providerName),
        apiKey: resolveAssistantApiKey(spec),
        baseURL: baseUrl,
        ...(spec.headers ? { headers: spec.headers } : {}),
      })

      return provider(spec.model)
    }
  }
}

function validateAssistantModelSpecForExecution(
  spec: AssistantModelSpec,
  mode: 'assert',
): {
  baseUrl?: string
  executionDriver: 'openai-compatible' | 'responses'
}
function validateAssistantModelSpecForExecution(
  spec: AssistantModelSpec,
  mode: 'resolve',
): ValidatedAssistantModelSpec
function validateAssistantModelSpecForExecution(
  spec: AssistantModelSpec,
  mode: 'assert' | 'resolve',
): {
  baseUrl?: string
  executionDriver: 'openai-compatible' | 'responses'
} {
  const configuredExecutionDriver =
    typeof spec.executionDriver === 'string' && spec.executionDriver.trim().length > 0
      ? spec.executionDriver.trim()
      : 'openai-compatible'

  if (spec.model.trim().length === 0) {
    throw new VaultCliError(
      ASSISTANT_MODEL_CONFIG_INVALID_CODE,
      'Assistant model configuration is invalid: model id is required.',
      {
        executionDriver: configuredExecutionDriver,
      },
    )
  }

  if (configuredExecutionDriver === 'responses') {
    return {
      baseUrl: spec.baseUrl,
      executionDriver: 'responses',
    }
  }

  if (configuredExecutionDriver === 'codex-app-server') {
    throw new VaultCliError(
      ASSISTANT_MODEL_CONFIG_INVALID_CODE,
      'Assistant model configuration is invalid: Codex app-server models cannot be resolved through the AI SDK model harness.',
      {
        executionDriver: configuredExecutionDriver,
      },
    )
  }

  if (
    mode === 'resolve'
    || configuredExecutionDriver === 'openai-compatible'
  ) {
    if (!spec.baseUrl) {
      throw new VaultCliError(
        ASSISTANT_MODEL_CONFIG_INVALID_CODE,
        'Assistant model configuration is invalid: OpenAI-compatible routing requires a base URL.',
        {
          executionDriver: configuredExecutionDriver,
        },
      )
    }
  }

  return {
    baseUrl: spec.baseUrl ?? '',
    executionDriver: 'openai-compatible',
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

function createAssistantResponsesFetch(
  requestPolicy: AssistantResponsesRequestPolicy | undefined,
  baseFetch: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  return async (input: AssistantFetchInput, init?: AssistantFetchInit) => {
    const nextInit = await maybeMutateAssistantResponsesRequest(requestPolicy, input, init)
    return await baseFetch(input, nextInit)
  }
}

async function maybeMutateAssistantResponsesRequest(
  requestPolicy: AssistantResponsesRequestPolicy | undefined,
  input: AssistantFetchInput,
  init?: AssistantFetchInit,
): Promise<AssistantFetchInit | undefined> {
  if (!shouldMutateAssistantResponsesRequest(input, init)) {
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

  const nextPayload = applyAssistantResponsesRequestPolicy(payload, requestPolicy)
  if (!nextPayload) {
    return init
  }

  return {
    ...init,
    body: JSON.stringify(nextPayload),
  }
}

function applyAssistantResponsesRequestPolicy(
  payload: Record<string, unknown>,
  requestPolicy: AssistantResponsesRequestPolicy | undefined,
): Record<string, unknown> | null {
  let nextPayload: Record<string, unknown> | null = null

  if (!('context_management' in payload)) {
    nextPayload = {
      ...payload,
      context_management: ASSISTANT_RESPONSES_AUTO_COMPACTION_CONTEXT,
    }
  }

  const gatewayOptions = resolveAssistantGatewayRequestOptions(requestPolicy)
  if (!gatewayOptions) {
    return nextPayload
  }

  const currentProviderOptions = nextPayload?.providerOptions ?? payload.providerOptions
  const nextProviderOptions = isAssistantPlainObject(currentProviderOptions)
    ? {
        ...currentProviderOptions,
      }
    : {}
  const currentGatewayOptions = isAssistantPlainObject(nextProviderOptions.gateway)
    ? {
        ...nextProviderOptions.gateway,
      }
    : {}

  nextProviderOptions.gateway = {
    ...currentGatewayOptions,
    ...gatewayOptions,
  }

  return {
    ...(nextPayload ?? payload),
    providerOptions: nextProviderOptions,
  }
}

function resolveAssistantGatewayRequestOptions(
  requestPolicy: AssistantResponsesRequestPolicy | undefined,
): Record<string, unknown> | null {
  const gatewayOptions: Record<string, unknown> = {}

  if (requestPolicy?.gatewayZeroDataRetention === true) {
    gatewayOptions.zeroDataRetention = true
  }

  const only = normalizeGatewayProviderSlugs(
    requestPolicy?.gatewayOnlyProviders ?? [],
  )
  if (only.length > 0) {
    gatewayOptions.only = only
  }

  const reporting = requestPolicy?.gatewayReporting
  const user = normalizeGatewayReportingString(reporting?.user ?? null)
  const tags = normalizeGatewayReportingTags(reporting?.tags ?? [])

  if (user) {
    gatewayOptions.user = user
  }

  if (tags.length > 0) {
    gatewayOptions.tags = tags
  }

  return Object.keys(gatewayOptions).length > 0 ? gatewayOptions : null
}

function normalizeGatewayProviderSlugs(providers: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalizedProviders: string[] = []

  for (const provider of providers) {
    const normalized = normalizeGatewayReportingString(provider)?.toLowerCase() ?? null
    if (
      !normalized ||
      !/^[a-z0-9][a-z0-9._-]*$/u.test(normalized) ||
      seen.has(normalized)
    ) {
      continue
    }

    seen.add(normalized)
    normalizedProviders.push(normalized)
  }

  return normalizedProviders
}

function normalizeGatewayReportingString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeGatewayReportingTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalizedTags: string[] = []

  for (const tag of tags) {
    const normalized = normalizeGatewayReportingString(tag)
    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    normalizedTags.push(normalized)
  }

  return normalizedTags
}

function shouldMutateAssistantResponsesRequest(
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

function isAssistantPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

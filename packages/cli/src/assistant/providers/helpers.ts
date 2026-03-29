import { getAssistantBindingContextLines } from '../bindings.js'
import { normalizeNullableString } from '../shared.js'
import type { AssistantProviderConfig } from '../provider-config.js'
import type {
  AssistantProviderTurnExecutionInput,
  AssistantProviderUsage,
} from './types.js'

export function buildOpenAICompatibleDiscoveryHeaders(input: {
  config: Extract<AssistantProviderConfig, { provider: 'openai-compatible' }>
  env?: NodeJS.ProcessEnv
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(input.config.headers ?? {}),
  }
  const env = {
    ...process.env,
    ...(input.env ?? {}),
  }
  const apiKeyEnv = normalizeNullableString(input.config.apiKeyEnv)
  const apiKeyValue =
    apiKeyEnv && typeof env[apiKeyEnv] === 'string' && env[apiKeyEnv].trim().length > 0
      ? env[apiKeyEnv].trim()
      : null

  if (apiKeyValue && !('Authorization' in headers)) {
    headers.Authorization = `Bearer ${apiKeyValue}`
  }

  return headers
}

export function buildAssistantProviderLabel(config: AssistantProviderConfig): string {
  const explicitProviderName = normalizeNullableString(config.providerName)
  if (explicitProviderName) {
    return explicitProviderName
  }

  if (config.provider === 'codex-cli') {
    return config.oss ? 'Codex OSS' : 'Codex CLI'
  }

  const normalizedBaseUrl = normalizeNullableString(config.baseUrl)
  if (!normalizedBaseUrl) {
    return 'OpenAI-compatible endpoint'
  }

  try {
    const parsed = new URL(normalizedBaseUrl)
    return parsed.host
      ? `OpenAI-compatible endpoint at ${parsed.host}`
      : 'OpenAI-compatible endpoint'
  } catch {
    return 'OpenAI-compatible endpoint'
  }
}

export function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

function normalizeConversationMessages(
  messages: AssistantProviderTurnExecutionInput['conversationMessages'],
): Array<{
  content: string
  role: 'assistant' | 'user'
}> {
  return (messages ?? [])
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0)
}

export function resolveAssistantProviderPrompt(
  input: AssistantProviderTurnExecutionInput,
): string {
  const explicitPrompt = normalizeNullableString(input.prompt)
  if (explicitPrompt) {
    return explicitPrompt
  }

  const userPrompt = normalizeNullableString(input.userPrompt)
  if (!userPrompt) {
    throw new Error(
      'Assistant provider turns require either prompt or userPrompt.',
    )
  }

  const systemPrompt = normalizeNullableString(input.systemPrompt)
  const contextLines =
    input.sessionContext?.binding
      ? getAssistantBindingContextLines(input.sessionContext.binding)
      : []

  return [
    systemPrompt,
    contextLines.length > 0
      ? `Conversation context:\n${contextLines.join('\n')}`
      : null,
    normalizeNullableString(input.continuityContext),
    `User message:\n${userPrompt}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n')
}

export function buildAssistantProviderMessages(
  input: AssistantProviderTurnExecutionInput,
): Array<{
  content: string
  role: 'assistant' | 'user'
}> {
  const messages = normalizeConversationMessages(input.conversationMessages)
  const prompt = normalizeNullableString(input.prompt)
  if (prompt) {
    messages.push({
      role: 'user',
      content: prompt,
    })
    return messages
  }

  const userPrompt = normalizeNullableString(input.userPrompt)
  if (!userPrompt) {
    throw new Error(
      'Assistant provider turns require either prompt or userPrompt.',
    )
  }

  const sessionContextLines =
    input.sessionContext?.binding
      ? getAssistantBindingContextLines(input.sessionContext.binding)
      : []
  const continuityContext = normalizeNullableString(input.continuityContext)
  const userParts = [
    sessionContextLines.length > 0
      ? `Conversation context:\n${sessionContextLines.join('\n')}`
      : null,
    continuityContext,
    userPrompt,
  ].filter((part): part is string => Boolean(part))

  messages.push({
    role: 'user',
    content: userParts.join('\n\n'),
  })
  return messages
}

export function mergeCodexConfigOverrides(input: {
  configOverrides?: readonly string[]
  showThinkingTraces: boolean
}): readonly string[] | undefined {
  const overrides = [...(input.configOverrides ?? [])]

  if (!input.showThinkingTraces) {
    return overrides.length > 0 ? overrides : input.configOverrides
  }

  upsertCodexConfigOverride(overrides, 'model_reasoning_summary', '"auto"')
  upsertCodexConfigOverride(overrides, 'hide_agent_reasoning', 'false')

  return overrides
}

function upsertCodexConfigOverride(
  overrides: string[],
  key: string,
  value: string,
): void {
  const assignmentPrefix = `${key}=`
  const existingIndex = overrides.findIndex((override) =>
    override.trim().startsWith(assignmentPrefix),
  )

  if (existingIndex >= 0) {
    overrides[existingIndex] = `${key}=${value}`
    return
  }

  overrides.push(`${key}=${value}`)
}

export function extractOpenAICompatibleAssistantProviderUsage(input: {
  providerConfig: Extract<AssistantProviderConfig, { provider: 'openai-compatible' }>
  result: unknown
}): AssistantProviderUsage {
  const resultRecord = readAssistantProviderRecord(input.result)
  const usageRecord =
    readAssistantProviderRecord(resultRecord?.totalUsage) ??
    readAssistantProviderRecord(resultRecord?.usage)
  const providerMetadata = readAssistantProviderRecord(resultRecord?.providerMetadata)
  const rawRecord = readAssistantProviderRecord(resultRecord?.raw)
  const responseRecord = readAssistantProviderRecord(resultRecord?.response)
  const requestRecord = readAssistantProviderRecord(resultRecord?.request)
  const inputTokens =
    readAssistantProviderInteger(
      usageRecord,
      'inputTokens',
      'promptTokens',
      'prompt_tokens',
      'input_tokens',
    ) ??
    readAssistantProviderInteger(rawRecord, 'inputTokens', 'promptTokens')
  const outputTokens =
    readAssistantProviderInteger(
      usageRecord,
      'outputTokens',
      'completionTokens',
      'completion_tokens',
      'output_tokens',
    ) ??
    readAssistantProviderInteger(rawRecord, 'outputTokens', 'completionTokens')

  return {
    apiKeyEnv: input.providerConfig.apiKeyEnv,
    baseUrl: input.providerConfig.baseUrl,
    cacheWriteTokens: readAssistantProviderInteger(
      usageRecord,
      'cacheWriteTokens',
      'cache_write_tokens',
    ),
    cachedInputTokens: readAssistantProviderInteger(
      usageRecord,
      'cachedInputTokens',
      'cached_input_tokens',
    ),
    inputTokens,
    outputTokens,
    providerMetadataJson: providerMetadata ?? null,
    providerName: input.providerConfig.providerName,
    providerRequestId: readAssistantProviderString(
      responseRecord?.requestId,
      responseRecord?.id,
      requestRecord?.id,
      rawRecord?.id,
    ),
    rawUsageJson:
      usageRecord
      ?? readAssistantProviderRecord(resultRecord?.usage)
      ?? rawRecord
      ?? null,
    reasoningTokens: readAssistantProviderInteger(
      usageRecord,
      'reasoningTokens',
      'reasoning_tokens',
    ),
    requestedModel: input.providerConfig.model,
    servedModel: readAssistantProviderString(
      responseRecord?.modelId,
      responseRecord?.model,
      rawRecord?.model,
      providerMetadata?.model,
    ) ?? input.providerConfig.model,
    totalTokens:
      readAssistantProviderInteger(usageRecord, 'totalTokens', 'total_tokens')
      ?? resolveAssistantProviderTotalTokens({
        inputTokens,
        outputTokens,
      }),
  }
}

export function extractCodexAssistantProviderUsage(input: {
  providerConfig: Extract<AssistantProviderConfig, { provider: 'codex-cli' }>
  rawEvents: readonly unknown[]
}): AssistantProviderUsage {
  const completionEvent = findAssistantCodexCompletionEvent(input.rawEvents)
  const completionRecord = completionEvent ? readAssistantProviderRecord(completionEvent) : null
  const usageRecord =
    readAssistantProviderRecord(completionRecord?.usage) ??
    readAssistantProviderRecord(readAssistantProviderRecord(completionRecord?.turn)?.usage) ??
    readAssistantProviderRecord(readAssistantProviderRecord(completionRecord?.metrics)?.usage) ??
    null
  const inputTokens = readAssistantProviderInteger(
    usageRecord ?? completionRecord,
    'inputTokens',
    'input_tokens',
  )
  const outputTokens = readAssistantProviderInteger(
    usageRecord ?? completionRecord,
    'outputTokens',
    'output_tokens',
  )

  return {
    apiKeyEnv: input.providerConfig.apiKeyEnv,
    baseUrl: input.providerConfig.baseUrl,
    cacheWriteTokens: readAssistantProviderInteger(
      usageRecord ?? completionRecord,
      'cacheWriteTokens',
      'cache_write_tokens',
    ),
    cachedInputTokens: readAssistantProviderInteger(
      usageRecord ?? completionRecord,
      'cachedInputTokens',
      'cached_input_tokens',
    ),
    inputTokens,
    outputTokens,
    providerMetadataJson: completionRecord ?? null,
    providerName: input.providerConfig.providerName,
    providerRequestId: readAssistantProviderString(
      completionRecord?.request_id,
      completionRecord?.requestId,
      completionRecord?.id,
    ),
    rawUsageJson: usageRecord ?? completionRecord ?? null,
    reasoningTokens: readAssistantProviderInteger(
      usageRecord ?? completionRecord,
      'reasoningTokens',
      'reasoning_tokens',
    ),
    requestedModel: input.providerConfig.model,
    servedModel: readAssistantProviderString(
      completionRecord?.model,
      completionRecord?.model_id,
      completionRecord?.modelId,
    ) ?? input.providerConfig.model,
    totalTokens:
      readAssistantProviderInteger(usageRecord ?? completionRecord, 'totalTokens', 'total_tokens')
      ?? resolveAssistantProviderTotalTokens({
        inputTokens,
        outputTokens,
      }),
  }
}

function findAssistantCodexCompletionEvent(
  rawEvents: readonly unknown[],
): Record<string, unknown> | null {
  for (let index = rawEvents.length - 1; index >= 0; index -= 1) {
    const record = readAssistantProviderRecord(rawEvents[index])
    const eventType = readAssistantProviderString(record?.type, record?.event)

    if (eventType === 'turn.completed' || eventType === 'turn/completed') {
      return record ?? null
    }
  }

  return null
}

function readAssistantProviderRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function readAssistantProviderString(
  ...values: unknown[]
): string | null {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }

    const normalized = value.trim()

    if (normalized.length > 0) {
      return normalized
    }
  }

  return null
}

function readAssistantProviderInteger(
  record: Record<string, unknown> | null | undefined,
  ...keys: string[]
): number | null {
  if (!record) {
    return null
  }

  for (const key of keys) {
    const value = record[key]

    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return value
    }
  }

  return null
}

function resolveAssistantProviderTotalTokens(input: {
  inputTokens: number | null
  outputTokens: number | null
}): number | null {
  if (input.inputTokens === null && input.outputTokens === null) {
    return null
  }

  return (input.inputTokens ?? 0) + (input.outputTokens ?? 0)
}

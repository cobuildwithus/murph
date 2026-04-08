import type { ModelMessage, UserModelMessage } from 'ai'
import { getAssistantBindingContextLines } from '../bindings.js'
import { resolveOpenAICompatibleProviderTitle } from '@murphai/operator-config/assistant/openai-compatible-provider-presets'
import {
  normalizeNullableString,
  readAssistantEnvString,
} from '../shared.js'
import {
  normalizeAssistantHeaders,
  type AssistantProviderConfig,
} from '@murphai/operator-config/assistant/provider-config'
import type {
  AssistantUserMessageContentPart,
} from '../../model-harness.js'
import type {
  AssistantProviderTurnExecutionInput,
  AssistantProviderUsage,
} from './types.js'

export function buildOpenAICompatibleDiscoveryHeaders(input: {
  config: AssistantProviderConfig
  env?: NodeJS.ProcessEnv
}): Record<string, string> {
  const headers =
    normalizeAssistantHeaders({
      Accept: 'application/json',
      ...(input.config.headers ?? {}),
    }) ?? {
      Accept: 'application/json',
    }
  const env = {
    ...process.env,
    ...(input.env ?? {}),
  }
  const apiKeyValue = readAssistantEnvString(env, input.config.apiKeyEnv)

  if (apiKeyValue && !('Authorization' in headers)) {
    headers.Authorization = `Bearer ${apiKeyValue}`
  }

  return headers
}

export function buildAssistantProviderLabel(config: AssistantProviderConfig): string {
  const explicitProviderName = normalizeNullableString(config.providerName)
  if (explicitProviderName) {
    return (
      resolveOpenAICompatibleProviderTitle({
        providerName: explicitProviderName,
      }) ?? explicitProviderName
    )
  }

  if (config.provider === 'codex-cli') {
    return config.oss ? 'Codex OSS' : 'Codex CLI'
  }

  const normalizedBaseUrl = normalizeNullableString(config.baseUrl)
  const presetTitle = resolveOpenAICompatibleProviderTitle({
    baseUrl: normalizedBaseUrl,
  })
  if (presetTitle) {
    return presetTitle
  }

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

function sanitizeAssistantProviderConversationMessages(
  messages: AssistantProviderTurnExecutionInput['conversationMessages'],
): ModelMessage[] {
  const sanitized: ModelMessage[] = []

  for (const message of messages ?? []) {
    if (message.role === 'assistant') {
      const content =
        Array.isArray(message.content)
          ? serializeAssistantConversationContent(message.content)
          : message.content.trim()
      if (content.length === 0) {
        continue
      }

      sanitized.push({
        role: 'assistant',
        content,
      })
      continue
    }

    if (Array.isArray(message.content)) {
      const content = sanitizeAssistantModelContentParts(message.content)
      if (content.length === 0) {
        continue
      }

      sanitized.push({
        role: 'user',
        content,
      } satisfies UserModelMessage)
      continue
    }

    const content = message.content.trim()
    if (content.length === 0) {
      continue
    }

    sanitized.push({
      role: 'user',
      content,
    } satisfies UserModelMessage)
  }

  return sanitized
}

function requireAssistantProviderUserPrompt(
  input: AssistantProviderTurnExecutionInput,
): string {
  const userPrompt = normalizeNullableString(input.userPrompt)
  if (userPrompt) {
    return userPrompt
  }

  throw new Error(
    'Assistant provider turns require either prompt or userPrompt.',
  )
}

function resolveAssistantProviderContextSections(
  input: AssistantProviderTurnExecutionInput,
): string[] {
  const contextLines =
    input.sessionContext?.binding
      ? getAssistantBindingContextLines(input.sessionContext.binding)
      : []

  return [
    contextLines.length > 0
      ? `Conversation context:\n${contextLines.join('\n')}`
      : null,
    normalizeNullableString(input.continuityContext),
  ].filter((section): section is string => Boolean(section))
}

function resolveAssistantProviderComposedUserContent(
  input: AssistantProviderTurnExecutionInput,
  options: {
    labelUserPrompt: boolean
  },
): string {
  const userPrompt = requireAssistantProviderUserPrompt(input)
  return [
    ...resolveAssistantProviderContextSections(input),
    options.labelUserPrompt ? `User message:\n${userPrompt}` : userPrompt,
  ]
    .join('\n\n')
}

function sanitizeAssistantModelContentParts(
  content: readonly AssistantUserMessageContentPart[],
): AssistantUserMessageContentPart[] {
  return content.flatMap((part) => {
    if (
      part
      && typeof part === 'object'
      && 'type' in part
      && part.type === 'text'
      && typeof part.text === 'string'
    ) {
      const text = part.text.trim()
      return text.length > 0 ? [{ ...part, text }] : []
    }

    return [part]
  })
}

function serializeAssistantConversationContent(
  content: readonly AssistantUserMessageContentPart[],
): string {
  return sanitizeAssistantModelContentParts(content)
    .map((part) => {
      if (part.type === 'text') {
        return part.text
      }

      if (part.type === 'file') {
        return `Assistant shared file${part.filename ? ` (${part.filename})` : ''}.`
      }

      return `Assistant shared image${part.mediaType ? ` (${part.mediaType})` : ''}.`
    })
    .join('\n\n')
    .trim()
}

function buildAssistantProviderUserMessageContent(
  input: AssistantProviderTurnExecutionInput,
): string | AssistantUserMessageContentPart[] | null {
  const explicitContent = Array.isArray(input.userMessageContent)
    ? sanitizeAssistantModelContentParts(input.userMessageContent)
    : []

  if (explicitContent.length === 0) {
    return null
  }

  const content: AssistantUserMessageContentPart[] = []
  const contextSections = resolveAssistantProviderContextSections(input)
  if (contextSections.length > 0) {
    content.push({
      type: 'text',
      text: contextSections.join('\n\n'),
    })
  }
  content.push(...explicitContent)
  return content
}

export function resolveAssistantProviderPrompt(
  input: AssistantProviderTurnExecutionInput,
): string {
  const explicitPrompt = normalizeNullableString(input.prompt)
  if (explicitPrompt) {
    return explicitPrompt
  }

  const systemPrompt = normalizeNullableString(input.systemPrompt)

  return [
    systemPrompt,
    resolveAssistantProviderComposedUserContent(input, {
      labelUserPrompt: true,
    }),
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n')
}

export function buildAssistantProviderMessages(
  input: AssistantProviderTurnExecutionInput,
): ModelMessage[] {
  const messages: ModelMessage[] = sanitizeAssistantProviderConversationMessages(
    input.conversationMessages,
  )
  const userMessageContent = buildAssistantProviderUserMessageContent(input)
  if (userMessageContent) {
    messages.push({
      role: 'user',
      content: userMessageContent,
    })
    return messages
  }

  const prompt = normalizeNullableString(input.prompt)
  if (prompt) {
    messages.push({
      role: 'user',
      content: prompt,
    })
    return messages
  }

  messages.push({
    role: 'user',
    content: resolveAssistantProviderComposedUserContent(input, {
      labelUserPrompt: false,
    }),
  })
  return messages
}

export function mergeCodexConfigOverrides(input: {
  showThinkingTraces: boolean
}): readonly string[] | undefined {
  const overrides: string[] = []

  if (!input.showThinkingTraces) {
    return undefined
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
  providerConfig: AssistantProviderConfig
  result: unknown
}): AssistantProviderUsage {
  const resultRecord = readAssistantProviderRecord(input.result)
  const usageRecord =
    readAssistantProviderRecord(resultRecord?.totalUsage) ??
    readAssistantProviderRecord(resultRecord?.usage)
  const providerMetadata = readAssistantProviderRecord(resultRecord?.providerMetadata)
  const openAiProviderMetadata = readAssistantProviderRecord(providerMetadata?.openai)
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
      openAiProviderMetadata?.responseId,
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

export function extractOpenAICompatibleProviderSessionId(
  result: unknown,
): string | null {
  const resultRecord = readAssistantProviderRecord(result)
  const providerMetadata = readAssistantProviderRecord(resultRecord?.providerMetadata)
  const openAiProviderMetadata = readAssistantProviderRecord(providerMetadata?.openai)
  const responseRecord = readAssistantProviderRecord(resultRecord?.response)

  return readAssistantProviderString(
    openAiProviderMetadata?.responseId,
    responseRecord?.id,
    responseRecord?.responseId,
  )
}

export function extractCodexAssistantProviderUsage(input: {
  providerConfig: AssistantProviderConfig
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

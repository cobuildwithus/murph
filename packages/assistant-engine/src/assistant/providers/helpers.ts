import type { ModelMessage, UserModelMessage } from 'ai'
import { getAssistantBindingContextLines } from '../bindings.js'
import { resolveOpenAICompatibleProviderTitle } from '@murphai/operator-config/assistant/openai-compatible-provider-presets'
import {
  normalizeNullableString,
  readAssistantEnvString,
} from '../shared.js'
import {
  isAssistantCodexTargetConfig,
  isAssistantOpenAICompatibleTargetConfig,
  isAssistantResponsesTargetConfig,
  normalizeAssistantHeaders,
  supportsAssistantNativeResume,
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
      ...(isAssistantOpenAICompatibleTargetConfig(input.config)
        ? (input.config.target.headers ?? {})
        : {}),
    }) ?? {
      Accept: 'application/json',
    }
  const env = {
    ...process.env,
    ...(input.env ?? {}),
  }
  const apiKeyValue = readAssistantEnvString(
    env,
    isAssistantOpenAICompatibleTargetConfig(input.config)
      ? input.config.target.apiKeyEnv
      : null,
  )

  if (apiKeyValue && !('Authorization' in headers)) {
    headers.Authorization = `Bearer ${apiKeyValue}`
  }

  return headers
}

export function buildAssistantProviderLabel(config: AssistantProviderConfig): string {
  const explicitProviderName = normalizeNullableString(
    isAssistantOpenAICompatibleTargetConfig(config)
      ? config.target.providerName
      : null,
  )
  if (explicitProviderName) {
    return (
      resolveOpenAICompatibleProviderTitle({
        providerName: explicitProviderName,
      }) ?? explicitProviderName
    )
  }

  if (isAssistantCodexTargetConfig(config)) {
    return config.target.oss ? 'Codex OSS app-server' : 'Codex app-server'
  }
  if (!isAssistantOpenAICompatibleTargetConfig(config)) {
    return 'OpenAI-compatible endpoint'
  }

  const normalizedBaseUrl = normalizeNullableString(config.target.baseUrl)
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

function hasAssistantProviderUsableNativeResume(
  input: AssistantProviderTurnExecutionInput,
): boolean {
  if ((input.activeTurnMessages?.length ?? 0) > 0) {
    return false
  }

  const resumeProviderSessionId = normalizeNullableString(
    input.resumeProviderSessionId,
  )
  if (!resumeProviderSessionId) {
    return false
  }

  if (
    input.providerConfig.policy.zeroDataRetention === true ||
    !supportsAssistantNativeResume(input.providerConfig)
  ) {
    return false
  }

  return isAssistantResponsesTargetConfig(input.providerConfig)
    ? resumeProviderSessionId.startsWith('resp_')
    : true
}

export type AssistantProviderHistoryMode =
  | 'none'
  | 'structured-messages'

export function resolveAssistantProviderHistoryMode(
  input: AssistantProviderTurnExecutionInput,
): AssistantProviderHistoryMode {
  if (hasAssistantProviderUsableNativeResume(input)) {
    return 'none'
  }

  return 'structured-messages'
}

function resolveAssistantProviderContextSections(
  input: AssistantProviderTurnExecutionInput,
): string[] {
  const contextLines =
    input.sessionContext?.binding
      ? getAssistantBindingContextLines(input.sessionContext.binding)
      : []
  const continuityContext = hasAssistantProviderUsableNativeResume(input)
    ? null
    : normalizeNullableString(input.continuityContext)

  return [
    contextLines.length > 0
      ? `Conversation context:\n${contextLines.join('\n')}`
      : null,
    continuityContext,
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

function resolveAssistantProviderFlatPromptTranscriptSection(
  input: AssistantProviderTurnExecutionInput,
): string | null {
  if (hasAssistantProviderUsableNativeResume(input)) {
    return null
  }

  const transcriptLines = (input.conversationMessages ?? []).flatMap((message) => {
    const content = Array.isArray(message.content)
      ? serializeAssistantConversationContent(message.content)
      : message.content.trim()
    if (content.length === 0) {
      return []
    }

    const label = message.role === 'assistant' ? 'Assistant' : 'User'
    return [`${label}:\n${content}`]
  })

  return transcriptLines.length > 0
    ? `Conversation so far:\n${transcriptLines.join('\n\n')}`
    : null
}

function resolveAssistantProviderFlatPromptActiveTurnSection(
  input: AssistantProviderTurnExecutionInput,
): string | null {
  const activeTurnLines = (input.activeTurnMessages ?? []).flatMap((message) => {
    const content = Array.isArray(message.content)
      ? serializeAssistantConversationContent(message.content)
      : message.content.trim()
    if (content.length === 0) {
      return []
    }

    const label = message.role === 'assistant' ? 'Assistant' : 'User'
    return [`${label}:\n${content}`]
  })

  return activeTurnLines.length > 0
    ? `Active turn so far:\n${activeTurnLines.join('\n\n')}`
    : null
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

  const systemPrompt = hasAssistantProviderUsableNativeResume(input)
    ? null
    : normalizeNullableString(input.systemPrompt)

  return [
    systemPrompt,
    resolveAssistantProviderFlatPromptTranscriptSection(input),
    resolveAssistantProviderFlatPromptActiveTurnSection(input),
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
  const messages = buildAssistantProviderHistoryMessages(input)
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

function buildAssistantProviderHistoryMessages(
  input: AssistantProviderTurnExecutionInput,
): ModelMessage[] {
  const appendActiveTurnMessages = (messages: ModelMessage[]): ModelMessage[] => [
    ...messages,
    ...sanitizeAssistantProviderConversationMessages(input.activeTurnMessages),
  ]

  switch (resolveAssistantProviderHistoryMode(input)) {
    case 'none':
      return appendActiveTurnMessages([])
    case 'structured-messages':
      return appendActiveTurnMessages(
        sanitizeAssistantProviderConversationMessages(
          input.conversationMessages,
        ),
      )
  }
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
  const cachedInputTokens =
    readAssistantProviderInteger(
      usageRecord,
      'cachedInputTokens',
      'cached_input_tokens',
    ) ??
    readAssistantProviderNestedInteger(
      usageRecord,
      ['inputTokensDetails', 'input_tokens_details'],
      ['cachedTokens', 'cached_tokens'],
    ) ??
    readAssistantProviderNestedInteger(
      usageRecord,
      ['promptTokensDetails', 'prompt_tokens_details'],
      ['cachedTokens', 'cached_tokens'],
    )

  return {
    apiKeyEnv:
      isAssistantOpenAICompatibleTargetConfig(input.providerConfig)
        ? input.providerConfig.target.apiKeyEnv
        : null,
    baseUrl:
      isAssistantOpenAICompatibleTargetConfig(input.providerConfig)
        ? input.providerConfig.target.baseUrl
        : null,
    cacheWriteTokens: readAssistantProviderInteger(
      usageRecord,
      'cacheWriteTokens',
      'cache_write_tokens',
    ),
    cachedInputTokens,
    inputTokens,
    outputTokens,
    providerMetadataJson: providerMetadata ?? null,
    providerName:
      isAssistantOpenAICompatibleTargetConfig(input.providerConfig)
        ? input.providerConfig.target.providerName
        : null,
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
    requestedModel: input.providerConfig.target.model,
    servedModel: readAssistantProviderString(
      responseRecord?.modelId,
      responseRecord?.model,
      rawRecord?.model,
      providerMetadata?.model,
    ) ?? input.providerConfig.target.model,
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
  const completionParams = readAssistantProviderRecord(completionRecord?.params)
  const completionTurn =
    readAssistantProviderRecord(completionParams?.turn) ??
    readAssistantProviderRecord(completionRecord?.turn)
  const completionMetrics =
    readAssistantProviderRecord(completionParams?.metrics) ??
    readAssistantProviderRecord(completionRecord?.metrics)
  const usageRecord =
    readAssistantProviderRecord(completionParams?.usage) ??
    readAssistantProviderRecord(completionTurn?.usage) ??
    readAssistantProviderRecord(completionMetrics?.usage) ??
    readAssistantProviderRecord(completionRecord?.usage) ??
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
    apiKeyEnv: null,
    baseUrl: null,
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
    providerName: null,
    providerRequestId: readAssistantProviderString(
      completionRecord?.request_id,
      completionRecord?.requestId,
      completionTurn?.id,
      completionRecord?.id,
    ),
    rawUsageJson: usageRecord ?? completionRecord ?? null,
    reasoningTokens: readAssistantProviderInteger(
      usageRecord ?? completionRecord,
      'reasoningTokens',
      'reasoning_tokens',
    ),
    requestedModel: input.providerConfig.target.model,
    servedModel: readAssistantProviderString(
      completionTurn?.model,
      completionRecord?.model,
      completionRecord?.model_id,
      completionRecord?.modelId,
    ) ?? input.providerConfig.target.model,
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
    const eventType = readAssistantProviderString(
      record?.type,
      record?.event,
      record?.method,
    )

    if (
      eventType === 'turn.completed' ||
      eventType === 'turn/completed'
    ) {
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

function readAssistantProviderNestedInteger(
  record: Record<string, unknown> | null | undefined,
  recordKeys: readonly string[],
  valueKeys: readonly string[],
): number | null {
  if (!record) {
    return null
  }

  for (const recordKey of recordKeys) {
    const nested = readAssistantProviderRecord(record[recordKey])
    const value = readAssistantProviderInteger(nested, ...valueKeys)

    if (value !== null) {
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

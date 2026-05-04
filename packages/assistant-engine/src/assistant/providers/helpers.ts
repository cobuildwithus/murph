import { createHash } from 'node:crypto'

import { getAssistantBindingContextLines } from '../bindings.js'
import {
  normalizeNullableString,
} from '../shared.js'
import {
  supportsAssistantNativeResume,
  type AssistantProviderConfig,
} from '@murphai/operator-config/assistant/provider-config'
import type {
  AssistantUserMessageContentPart,
} from '../content-types.js'
import type {
  AssistantProviderTurnExecutionInput,
  AssistantProviderUsage,
} from './types.js'

const CODEX_USAGE_EXTRACTION_VERSION = 'codex-usage-v1'

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

  if (!supportsAssistantNativeResume(input.providerConfig)) {
    return false
  }

  void resumeProviderSessionId
  return true
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
  const turnContextPrompt = normalizeNullableString(input.turnContextPrompt)
  const continuityContext = hasAssistantProviderUsableNativeResume(input)
    ? null
    : normalizeNullableString(input.continuityContext)

  return [
    turnContextPrompt,
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

export function resolveAssistantProviderPrompt(
  input: AssistantProviderTurnExecutionInput,
): string {
  const explicitPrompt = normalizeNullableString(input.prompt)
  if (explicitPrompt) {
    return explicitPrompt
  }

  return [
    resolveAssistantProviderFlatPromptTranscriptSection(input),
    resolveAssistantProviderFlatPromptActiveTurnSection(input),
    resolveAssistantProviderComposedUserContent(input, {
      labelUserPrompt: true,
    }),
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n')
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
  const usageSource = resolveAssistantProviderUsageSource({
    completionMetrics,
    completionParams,
    completionRecord,
    completionTurn,
    rawEvents: input.rawEvents,
  })
  const usageRecord = usageSource?.record ?? null
  const sanitizedRawUsageJson = sanitizeAssistantProviderRawUsageJson(
    usageRecord ?? completionRecord,
  )
  const inputTokens = readAssistantProviderInteger(
    usageRecord ?? completionRecord,
    'inputTokens',
    'input_tokens',
    'prompt_tokens',
    'promptTokens',
  )
  const outputTokens = readAssistantProviderInteger(
    usageRecord ?? completionRecord,
    'outputTokens',
    'output_tokens',
    'completion_tokens',
    'completionTokens',
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
    ) ?? readAssistantProviderNestedInteger(
      usageRecord ?? completionRecord,
      'input_tokens_details',
      'cached_tokens',
    ),
    inputTokens,
    outputTokens,
    providerMetadataJson: completionRecord ?? null,
    providerName:
      input.providerConfig.target.kind === 'codex-cli'
        ? input.providerConfig.target.modelProvider
        : null,
    providerRequestId: readAssistantProviderString(
      completionRecord?.request_id,
      completionRecord?.requestId,
      completionTurn?.id,
      completionRecord?.id,
    ),
    rawUsageJson: sanitizedRawUsageJson,
    rawUsageJsonHash: sanitizedRawUsageJson
      ? hashAssistantProviderStableJson(sanitizedRawUsageJson)
      : null,
    reasoningTokens: readAssistantProviderInteger(
      usageRecord ?? completionRecord,
      'reasoningTokens',
      'reasoning_tokens',
      'reasoningOutputTokens',
    ) ?? readAssistantProviderNestedInteger(
      usageRecord ?? completionRecord,
      'output_tokens_details',
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
    usageExtractionSourcePath: usageSource?.sourcePath ?? (completionRecord ? 'completion' : null),
    usageExtractionVersion: CODEX_USAGE_EXTRACTION_VERSION,
  }
}

function resolveAssistantProviderUsageSource(input: {
  completionMetrics: Record<string, unknown> | null
  completionParams: Record<string, unknown> | null
  completionRecord: Record<string, unknown> | null
  completionTurn: Record<string, unknown> | null
  rawEvents: readonly unknown[]
}): { record: Record<string, unknown>; sourcePath: string } | null {
  const candidates = [
    {
      record: readAssistantProviderRecord(input.completionParams?.usage),
      sourcePath: 'params.usage',
    },
    {
      record: readAssistantProviderRecord(input.completionTurn?.usage),
      sourcePath: input.completionParams?.turn ? 'params.turn.usage' : 'turn.usage',
    },
    {
      record: readAssistantProviderRecord(input.completionMetrics?.usage),
      sourcePath: input.completionParams?.metrics ? 'params.metrics.usage' : 'metrics.usage',
    },
    {
      record: readAssistantProviderRecord(input.completionRecord?.usage),
      sourcePath: 'usage',
    },
  ]

  for (const candidate of candidates) {
    if (hasAssistantProviderUsageTokenFields(candidate.record)) {
      return {
        record: candidate.record!,
        sourcePath: candidate.sourcePath,
      }
    }
  }

  const tokenUsageRecord = findAssistantCodexThreadTokenUsageRecord(input.rawEvents)
  return tokenUsageRecord
    ? {
        record: tokenUsageRecord,
        sourcePath: 'thread.tokenUsage.last',
      }
    : null
}

function hasAssistantProviderUsageTokenFields(
  record: Record<string, unknown> | null,
): boolean {
  if (!record) {
    return false
  }

  return (
    readAssistantProviderInteger(
      record,
      'cacheWriteTokens',
      'cache_write_tokens',
      'cachedInputTokens',
      'cached_input_tokens',
      'inputTokens',
      'input_tokens',
      'prompt_tokens',
      'promptTokens',
      'outputTokens',
      'output_tokens',
      'completion_tokens',
      'completionTokens',
      'reasoningTokens',
      'reasoning_tokens',
      'reasoningOutputTokens',
      'totalTokens',
      'total_tokens',
    ) !== null ||
    readAssistantProviderNestedInteger(
      record,
      'input_tokens_details',
      'cached_tokens',
    ) !== null ||
    readAssistantProviderNestedInteger(
      record,
      'output_tokens_details',
      'reasoning_tokens',
    ) !== null
  )
}

function findAssistantCodexThreadTokenUsageRecord(
  rawEvents: readonly unknown[],
): Record<string, unknown> | null {
  for (let index = rawEvents.length - 1; index >= 0; index -= 1) {
    const record = readAssistantProviderRecord(rawEvents[index])
    const eventType = readAssistantProviderString(
      record?.type,
      record?.event,
      record?.method,
    )

    if (eventType !== 'thread/tokenUsage/updated') {
      continue
    }

    const params = readAssistantProviderRecord(record?.params)
    const tokenUsage = readAssistantProviderRecord(params?.tokenUsage)
    const last = readAssistantProviderRecord(tokenUsage?.last)

    if (last) {
      return last
    }
  }

  return null
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
  objectKey: string,
  valueKey: string,
): number | null {
  return readAssistantProviderInteger(
    readAssistantProviderRecord(record?.[objectKey]),
    valueKey,
  )
}

function sanitizeAssistantProviderRawUsageJson(
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!record) {
    return null
  }

  const sanitized: Record<string, unknown> = {}
  copyAssistantProviderIntegerFields(sanitized, record, [
    'cacheWriteTokens',
    'cache_write_tokens',
    'cachedInputTokens',
    'cached_input_tokens',
    'completionTokens',
    'completion_tokens',
    'inputTokens',
    'input_tokens',
    'outputTokens',
    'output_tokens',
    'promptTokens',
    'prompt_tokens',
    'reasoningTokens',
    'reasoning_tokens',
    'reasoningOutputTokens',
    'totalTokens',
    'total_tokens',
  ])
  copyAssistantProviderTokenDetails(
    sanitized,
    record,
    'input_tokens_details',
    ['cached_tokens'],
  )
  copyAssistantProviderTokenDetails(
    sanitized,
    record,
    'output_tokens_details',
    ['reasoning_tokens'],
  )

  return Object.keys(sanitized).length > 0 ? sanitized : null
}

function copyAssistantProviderIntegerFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    const value = source[key]

    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      target[key] = value
    }
  }
}

function copyAssistantProviderTokenDetails(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  objectKey: string,
  valueKeys: readonly string[],
): void {
  const sourceDetails = readAssistantProviderRecord(source[objectKey])

  if (!sourceDetails) {
    return
  }

  const sanitizedDetails: Record<string, unknown> = {}
  copyAssistantProviderIntegerFields(sanitizedDetails, sourceDetails, valueKeys)

  if (Object.keys(sanitizedDetails).length > 0) {
    target[objectKey] = sanitizedDetails
  }
}

function hashAssistantProviderStableJson(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(stableStringifyAssistantProviderJson(value))
    .digest('hex')}`
}

function stableStringifyAssistantProviderJson(value: unknown): string {
  return JSON.stringify(sortAssistantProviderJson(value))
}

function sortAssistantProviderJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortAssistantProviderJson(entry))
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortAssistantProviderJson(record[key])
        return result
      }, {})
  }

  return value
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

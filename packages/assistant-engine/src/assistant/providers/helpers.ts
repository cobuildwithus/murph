import { createHash } from 'node:crypto'

import { getAssistantBindingContextLines } from '../bindings.js'
import {
  normalizeNullableString,
} from '../shared.js'
import {
  supportsAssistantNativeResume,
  type AssistantProviderConfig,
} from '@murphai/operator-config/assistant/provider-config'
import {
  isCodexReservedModelProviderId,
  resolveAssistantCodexModelProviderConfig,
} from '@murphai/operator-config/assistant/target-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
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
  const resumeCodexThreadId = normalizeNullableString(
    input.resume?.codexThreadId,
  )
  if (!resumeCodexThreadId) {
    return false
  }

  if (!supportsAssistantNativeResume(input.providerConfig)) {
    return false
  }

  void resumeCodexThreadId
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

  return [
    turnContextPrompt,
    contextLines.length > 0
      ? `Conversation context:\n${contextLines.join('\n')}`
      : null,
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

export function resolveAssistantProviderFlatPromptConversationHistorySection(
  input: AssistantProviderTurnExecutionInput,
): string | null {
  const conversationHistoryLines = serializeAssistantConversationMessages(
    input.conversationHistoryMessages ?? [],
  )

  return conversationHistoryLines.length > 0
    ? `Recent conversation history for context only; do not answer these prior messages:\n${conversationHistoryLines.join('\n\n')}`
    : null
}

function serializeAssistantConversationMessages(
  messages: ReadonlyArray<{
    content: string | AssistantUserMessageContentPart[]
    role: 'assistant' | 'user'
  }>,
): string[] {
  return messages.flatMap((message) => {
    const content = Array.isArray(message.content)
      ? serializeAssistantConversationContent(message.content)
      : message.content.trim()
    if (content.length === 0) {
      return []
    }

    const label = message.role === 'assistant' ? 'Assistant' : 'User'
    return [`${label}:\n${content}`]
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

export function resolveAssistantProviderPrompt(
  input: AssistantProviderTurnExecutionInput,
): string {
  const explicitPrompt = normalizeNullableString(input.prompt)
  if (explicitPrompt) {
    return explicitPrompt
  }

  return [
    resolveAssistantProviderFlatPromptConversationHistorySection(input),
    resolveAssistantProviderComposedUserContent(input, {
      labelUserPrompt: true,
    }),
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n')
}

export function mergeCodexConfigOverrides(input: {
  modelProvider?: string | null
  showThinkingTraces: boolean
}): readonly string[] | undefined {
  const overrides: string[] = []
  const modelProvider = normalizeNullableString(input.modelProvider)
  const modelProviderConfig =
    resolveAssistantCodexModelProviderConfig(modelProvider)

  if (
    modelProvider &&
    !modelProviderConfig &&
    !isCodexReservedModelProviderId(modelProvider)
  ) {
    throw new VaultCliError(
      'ASSISTANT_PROVIDER_UNSUPPORTED',
      `Unknown Codex model provider: ${modelProvider}.`,
    )
  }

  if (
    modelProviderConfig &&
    !isCodexReservedModelProviderId(modelProviderConfig.id)
  ) {
    const providerKey = formatCodexConfigPathSegment(modelProviderConfig.id)
    upsertCodexConfigOverride(
      overrides,
      `model_providers.${providerKey}.name`,
      formatCodexTomlString(modelProviderConfig.name),
    )
    upsertCodexConfigOverride(
      overrides,
      `model_providers.${providerKey}.base_url`,
      formatCodexTomlString(modelProviderConfig.baseUrl),
    )
    upsertCodexConfigOverride(
      overrides,
      `model_providers.${providerKey}.env_key`,
      formatCodexTomlString(modelProviderConfig.envKey),
    )
    upsertCodexConfigOverride(
      overrides,
      `model_providers.${providerKey}.wire_api`,
      formatCodexTomlString(modelProviderConfig.wireApi),
    )
    upsertCodexConfigOverride(
      overrides,
      `model_providers.${providerKey}.requires_openai_auth`,
      'false',
    )
  }
  if (modelProviderConfig) {
    upsertCodexConfigOverride(
      overrides,
      'shell_environment_policy.ignore_default_excludes',
      'false',
    )
  }

  if (!input.showThinkingTraces) {
    return overrides.length > 0 ? overrides : undefined
  }

  upsertCodexConfigOverride(overrides, 'model_reasoning_summary', '"auto"')
  upsertCodexConfigOverride(overrides, 'hide_agent_reasoning', 'false')

  return overrides
}

function formatCodexTomlString(value: string): string {
  return JSON.stringify(value)
}

function formatCodexConfigPathSegment(value: string): string {
  if (/^[a-z0-9_-]+$/u.test(value)) {
    return value
  }

  throw new VaultCliError(
    'ASSISTANT_PROVIDER_UNSUPPORTED',
    `Codex model provider id cannot be represented as a --config dotted path: ${value}.`,
  )
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
    ) ?? readAssistantProviderNestedInteger(
      usageRecord ?? completionRecord,
      'prompt_tokens_details',
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

  return findAssistantCodexThreadTokenUsageSource({
    rawEvents: input.rawEvents,
    turnId: readAssistantCodexTurnIdFromCompletion(input),
  })
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

function findAssistantCodexThreadTokenUsageSource(input: {
  rawEvents: readonly unknown[]
  turnId: string | null
}): { record: Record<string, unknown>; sourcePath: string } | null {
  const tokenUsageEvents = readAssistantCodexThreadTokenUsageEvents(input)
  const totalDeltaUsage =
    resolveAssistantCodexThreadTokenUsageTotalDelta(tokenUsageEvents)
  if (totalDeltaUsage) {
    return {
      record: totalDeltaUsage,
      sourcePath: 'thread.tokenUsage.total.delta',
    }
  }

  for (let index = tokenUsageEvents.length - 1; index >= 0; index -= 1) {
    const event = tokenUsageEvents[index]!
    if (hasAssistantProviderUsageTokenFields(event.last)) {
      return {
        record: event.last!,
        sourcePath: 'thread.tokenUsage.last',
      }
    }
  }

  return null
}

function readAssistantCodexThreadTokenUsageEvents(input: {
  rawEvents: readonly unknown[]
  turnId: string | null
}): Array<{
  last: Record<string, unknown> | null
  total: Record<string, unknown> | null
}> {
  const turnStartedEventIndex = findAssistantCodexTurnStartedEventIndex(input)
  const currentTurnOutputEventIndex =
    findAssistantCodexCurrentTurnOutputEventIndex({
      rawEvents: input.rawEvents,
      turnId: input.turnId,
      turnStartedEventIndex,
    })

  const events = input.rawEvents.flatMap((rawEvent, index) => {
    if (turnStartedEventIndex !== null && index < turnStartedEventIndex) {
      return []
    }

    const record = readAssistantProviderRecord(rawEvent)
    const eventType = readAssistantProviderString(
      record?.method,
      record?.type,
      record?.event,
    )

    if (!isAssistantCodexTokenUsageEventType(eventType)) {
      return []
    }

    if (!isAssistantCodexTokenUsageEventForTurn(record, input.turnId)) {
      return []
    }

    const tokenUsage = readAssistantCodexTokenUsageRecord(record)
    return [
      {
        index,
        last: readAssistantProviderRecord(tokenUsage?.last),
        total: readAssistantProviderRecord(tokenUsage?.total),
      },
    ]
  })

  if (currentTurnOutputEventIndex === null) {
    return events.map(({ last, total }) => ({
      last,
      total,
    }))
  }

  const postOutputEvents = events.filter(
    (event) => event.index >= currentTurnOutputEventIndex,
  )
  const selectedEvents = postOutputEvents.length > 0 ? postOutputEvents : events

  return selectedEvents.map(({ last, total }) => ({
    last,
    total,
  }))
}

function findAssistantCodexTurnStartedEventIndex(input: {
  rawEvents: readonly unknown[]
  turnId: string | null
}): number | null {
  let fallbackIndex: number | null = null

  for (let index = 0; index < input.rawEvents.length; index += 1) {
    const record = readAssistantProviderRecord(input.rawEvents[index])
    const eventType = readAssistantProviderString(
      record?.method,
      record?.type,
      record?.event,
    )

    if (eventType !== 'turn/started' && eventType !== 'turn.started') {
      continue
    }

    fallbackIndex ??= index
    if (!isAssistantCodexTurnEventForTurn(record, input.turnId)) {
      continue
    }

    return index
  }

  return fallbackIndex
}

function findAssistantCodexCurrentTurnOutputEventIndex(input: {
  rawEvents: readonly unknown[]
  turnId: string | null
  turnStartedEventIndex: number | null
}): number | null {
  const startIndex = input.turnStartedEventIndex ?? 0

  for (let index = startIndex; index < input.rawEvents.length; index += 1) {
    const record = readAssistantProviderRecord(input.rawEvents[index])
    if (!isAssistantCodexTurnEventForTurn(record, input.turnId)) {
      continue
    }

    if (isAssistantCodexCurrentTurnOutputEvent(record)) {
      return index
    }
  }

  return null
}

function isAssistantCodexCurrentTurnOutputEvent(
  record: Record<string, unknown> | null,
): boolean {
  const eventType = readAssistantProviderString(
    record?.method,
    record?.type,
    record?.event,
  )

  if (
    eventType === 'assistant.message.delta'
    || eventType === 'agent.message.delta'
    || eventType === 'item/agentMessage/delta'
    || eventType === 'item/plan/delta'
    || eventType === 'item/reasoning/summaryPartAdded'
    || eventType === 'item/reasoning/summaryTextDelta'
    || eventType === 'item/reasoning/textDelta'
    || eventType === 'rawResponseItem/completed'
  ) {
    return true
  }

  if (eventType !== 'item/started' && eventType !== 'item/completed') {
    return false
  }

  const params = readAssistantProviderRecord(record?.params)
  const item = readAssistantProviderRecord(params?.item)
  const itemType = readAssistantProviderString(item?.type)

  return (
    itemType === 'agentMessage'
    || itemType === 'plan'
    || itemType === 'reasoning'
    || itemType === 'commandExecution'
    || itemType === 'fileChange'
    || itemType === 'mcpToolCall'
    || itemType === 'dynamicToolCall'
    || itemType === 'webSearch'
  )
}

function isAssistantCodexTokenUsageEventForTurn(
  record: Record<string, unknown> | null,
  turnId: string | null,
): boolean {
  if (!turnId) {
    return true
  }

  return readAssistantCodexTurnIdFromRecord(record) === turnId
}

function isAssistantCodexTurnEventForTurn(
  record: Record<string, unknown> | null,
  turnId: string | null,
): boolean {
  if (!turnId) {
    return true
  }

  return readAssistantCodexTurnIdFromRecord(record) === turnId
}

function readAssistantCodexTurnIdFromCompletion(input: {
  completionParams: Record<string, unknown> | null
  completionRecord: Record<string, unknown> | null
  completionTurn: Record<string, unknown> | null
}): string | null {
  return (
    readAssistantProviderString(input.completionTurn?.id) ??
    readAssistantCodexTurnIdFromRecord(input.completionParams) ??
    readAssistantCodexTurnIdFromRecord(input.completionRecord)
  )
}

function isAssistantCodexTokenUsageEventType(eventType: string | null): boolean {
  return (
    eventType === 'thread/tokenUsage/updated' ||
    eventType === 'thread/token_usage/updated' ||
    eventType === 'thread.tokenUsage.updated' ||
    eventType === 'thread.token.usage.updated' ||
    eventType === 'thread.token_usage.updated'
  )
}

function readAssistantCodexTokenUsageRecord(
  record: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const params = readAssistantProviderRecord(record?.params)
  const data = readAssistantProviderRecord(record?.data)

  return (
    readAssistantProviderRecord(params?.tokenUsage) ??
    readAssistantProviderRecord(params?.token_usage) ??
    readAssistantProviderRecord(data?.tokenUsage) ??
    readAssistantProviderRecord(data?.token_usage) ??
    readAssistantProviderRecord(record?.tokenUsage) ??
    readAssistantProviderRecord(record?.token_usage)
  )
}

function readAssistantCodexTurnIdFromRecord(
  record: Record<string, unknown> | null,
): string | null {
  const params = readAssistantProviderRecord(record?.params)
  const data = readAssistantProviderRecord(record?.data)
  const turn =
    readAssistantProviderRecord(params?.turn) ??
    readAssistantProviderRecord(data?.turn) ??
    readAssistantProviderRecord(record?.turn)

  return readAssistantProviderString(
    turn?.id,
    params?.turnId,
    params?.turn_id,
    data?.turnId,
    data?.turn_id,
    record?.turnId,
    record?.turn_id,
  )
}

function resolveAssistantCodexThreadTokenUsageTotalDelta(
  events: ReadonlyArray<{
    last: Record<string, unknown> | null
    total: Record<string, unknown> | null
  }>,
): Record<string, unknown> | null {
  const first = events.find(
    (event) =>
      hasAssistantProviderUsageTokenFields(event.last)
      && hasAssistantProviderUsageTokenFields(event.total),
  )
  const final = [...events].reverse().find(
    (event) =>
      hasAssistantProviderUsageTokenFields(event.last)
      && hasAssistantProviderUsageTokenFields(event.total),
  )

  if (!first?.last || !first.total || !final?.total) {
    return null
  }

  const priorThreadBaseline = subtractAssistantProviderUsageRecords(
    first.total,
    first.last,
  )
  const currentTurnUsage = subtractAssistantProviderUsageRecords(
    final.total,
    priorThreadBaseline,
  )
  if (readAssistantProviderInteger(currentTurnUsage, 'totalTokens') === null) {
    const totalTokens = resolveAssistantProviderTotalTokens({
      inputTokens: readAssistantProviderInteger(currentTurnUsage, 'inputTokens'),
      outputTokens: readAssistantProviderInteger(currentTurnUsage, 'outputTokens'),
    })
    if (totalTokens !== null) {
      currentTurnUsage.totalTokens = totalTokens
    }
  }

  return hasAssistantProviderUsageTokenFields(currentTurnUsage)
    ? currentTurnUsage
    : null
}

function subtractAssistantProviderUsageRecords(
  minuend: Record<string, unknown>,
  subtrahend: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  copyAssistantProviderUsageDifference(
    result,
    'cacheWriteTokens',
    minuend,
    subtrahend,
    ['cacheWriteTokens', 'cache_write_tokens'],
  )
  copyAssistantProviderUsageDifference(
    result,
    'cachedInputTokens',
    minuend,
    subtrahend,
    ['cachedInputTokens', 'cached_input_tokens'],
    {
      nested: [
        ['input_tokens_details', 'cached_tokens'],
        ['prompt_tokens_details', 'cached_tokens'],
      ],
    },
  )
  copyAssistantProviderUsageDifference(
    result,
    'inputTokens',
    minuend,
    subtrahend,
    ['inputTokens', 'input_tokens', 'prompt_tokens', 'promptTokens'],
  )
  copyAssistantProviderUsageDifference(
    result,
    'outputTokens',
    minuend,
    subtrahend,
    ['outputTokens', 'output_tokens', 'completion_tokens', 'completionTokens'],
  )
  copyAssistantProviderUsageDifference(
    result,
    'reasoningOutputTokens',
    minuend,
    subtrahend,
    ['reasoningTokens', 'reasoning_tokens', 'reasoningOutputTokens'],
    {
      nested: [['output_tokens_details', 'reasoning_tokens']],
    },
  )
  copyAssistantProviderUsageDifference(
    result,
    'totalTokens',
    minuend,
    subtrahend,
    ['totalTokens', 'total_tokens'],
  )

  return result
}

function copyAssistantProviderUsageDifference(
  target: Record<string, unknown>,
  targetKey: string,
  minuend: Record<string, unknown>,
  subtrahend: Record<string, unknown>,
  sourceKeys: readonly string[],
  options: {
    nested?: ReadonlyArray<readonly [objectKey: string, valueKey: string]>
  } = {},
): void {
  const minuendValue = readAssistantProviderUsageInteger(
    minuend,
    sourceKeys,
    options,
  )
  if (minuendValue === null) {
    return
  }

  const subtrahendValue =
    readAssistantProviderUsageInteger(subtrahend, sourceKeys, options) ?? 0
  target[targetKey] = Math.max(0, minuendValue - subtrahendValue)
}

function readAssistantProviderUsageInteger(
  source: Record<string, unknown>,
  sourceKeys: readonly string[],
  options: {
    nested?: ReadonlyArray<readonly [objectKey: string, valueKey: string]>
  } = {},
): number | null {
  const directValue = readAssistantProviderInteger(source, ...sourceKeys)
  if (directValue !== null) {
    return directValue
  }

  for (const nested of options.nested ?? []) {
    const nestedValue = readAssistantProviderNestedInteger(
      source,
      nested[0],
      nested[1],
    )
    if (nestedValue !== null) {
      return nestedValue
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
    'prompt_tokens_details',
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

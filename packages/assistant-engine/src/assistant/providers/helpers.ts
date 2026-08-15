import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { getAssistantBindingContextLines } from '../bindings.js'
import {
  readCodexNonEmptyString,
  readCodexRecord,
  readCodexServerNotification,
  readCodexThreadTokenUsage,
  type CodexThreadTokenUsage,
  type CodexTokenUsageBreakdown,
} from '../../assistant-codex/app-server-protocol.js'
import {
  normalizeNullableString,
} from '../shared.js'
import {
  type AssistantProviderConfig,
} from '@murphai/operator-config/assistant/provider-config'
import {
  isCodexReservedModelProviderId,
  resolveAssistantCodexUsageProviderName,
  resolveAssistantCodexModelProviderConfig,
} from '@murphai/operator-config/assistant/target-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  VAULT_CLI_BATCH_RESULT_SCHEMA,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  resolveCodexCommandFamily,
} from '../../assistant-codex/command-family.js'
import {
  isCodexActionStructurallyFailed,
} from '../../assistant-codex/action-outcome.js'
import {
  buildAssistantTurnProfileToolIdentityLabel,
  ASSISTANT_TURN_PROFILE_MAX_REQUESTS,
  ASSISTANT_TURN_PROFILE_MAX_TOOLS,
  ASSISTANT_TURN_PROFILE_SCHEMA,
  type AssistantUsageTokenPricingBasis,
} from '@murphai/hosted-execution/assistant-usage'
import {
  resolveHostedAiUsageTokenPricingBasis,
} from '@murphai/hosted-execution/runtime-control'
import type {
  AssistantUserMessageContentPart,
} from '../content-types.js'
import type {
  AssistantProviderServiceTier,
  AssistantProviderTurnExecutionInput,
  AssistantProviderUsage,
  AssistantProviderUsageDraft,
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
  return normalizeNullableString(input.resume?.codexThreadId) !== null
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
    const turnContextPrompt = normalizeNullableString(input.turnContextPrompt)
    return [
      turnContextPrompt,
      explicitPrompt,
    ]
      .filter((section): section is string => section !== null)
      .join('\n\n')
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
  // Multi-agent V2 is enabled by the hosted config.toml's
  // [features.multi_agent_v2] table (which also carries Murph's
  // proactive-delegation tool and mode hints). A CLI
  // `--config features.multi_agent_v2=true` boolean would take precedence
  // over that table and silently reset the feature to defaults, dropping
  // those configured hints — never emit it.
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
  serviceTier?: AssistantProviderServiceTier | null
}): AssistantProviderUsage {
  const completion = findAssistantCodexCompletionEvent(input.rawEvents)
  const completionTurn = completion
    ? readCodexRecord(completion.params.turn)
    : null
  const turnId = readCodexNonEmptyString(completionTurn?.id)
  const usageSource = findAssistantCodexThreadTokenUsageSource({
    rawEvents: input.rawEvents,
    turnId,
  })
  const usage = usageSource?.record ?? null
  const sanitizedRawUsageJson = usage ? sanitizeCodexUsage(usage) : null
  const turnProfileJson = buildAssistantCodexTurnProfileJson({
    rawEvents: input.rawEvents,
    turnId,
  })
  const providerName = resolveAssistantCodexUsageProviderName(
    input.providerConfig.target.modelProvider,
  )
  const requestedModel = input.providerConfig.target.model
  const servedModel = findAssistantCodexCurrentTurnReroutedModel({
    rawEvents: input.rawEvents,
    turnId,
  }) ?? requestedModel

  return {
    apiKeyEnv: null,
    baseUrl: null,
    cacheWriteTokens: usage?.cacheWriteInputTokens ?? null,
    cachedInputTokens: usage?.cachedInputTokens ?? null,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    providerMetadataJson: completion ?? null,
    providerName,
    providerRequestId: turnId,
    rawUsageJson: sanitizedRawUsageJson,
    rawUsageJsonHash: sanitizedRawUsageJson
      ? hashAssistantProviderStableJson(sanitizedRawUsageJson)
      : null,
    reasoningTokens: usage?.reasoningOutputTokens ?? null,
    requestedModel,
    servedModel,
    tokenPricingBasis: resolveCodexAssistantProviderTokenPricingBasis({
      model: servedModel,
      modelProvider: providerName,
      serviceTier: input.serviceTier ?? null,
    }),
    totalTokens: usage?.totalTokens ?? null,
    turnProfileJson,
    usageExtractionSourcePath: usageSource?.sourcePath ?? null,
    usageExtractionVersion: CODEX_USAGE_EXTRACTION_VERSION,
  }
}

function findAssistantCodexCurrentTurnReroutedModel(input: {
  rawEvents: readonly unknown[]
  turnId: string | null
}): string | null {
  let currentTurnId = input.turnId
  let currentTurnStarted = false
  let servedModel: string | null = null

  for (const rawEvent of input.rawEvents) {
    const notification = readCodexServerNotification(rawEvent)
    if (!notification) {
      continue
    }

    if (notification.method === 'turn/started') {
      const startedTurnId = readCodexNonEmptyString(
        readCodexRecord(notification.params.turn)?.id,
      )
      if (startedTurnId) {
        currentTurnId ??= startedTurnId
        currentTurnStarted = startedTurnId === currentTurnId
      }
      continue
    }

    if (!currentTurnStarted) {
      continue
    }

    if (notification.method === 'model/rerouted') {
      servedModel = readCodexNonEmptyString(notification.params.toModel)
        ?? servedModel
      continue
    }

    if (notification.method === 'turn/completed') {
      const completedTurnId = readCodexNonEmptyString(
        readCodexRecord(notification.params.turn)?.id,
      )
      if (completedTurnId === currentTurnId) {
        break
      }
    }
  }

  return servedModel
}

interface AssistantCodexTokenUsageEvent {
  index: number
  last: CodexTokenUsageBreakdown
  threadId: string
  tokenUsage: CodexThreadTokenUsage
  total: CodexTokenUsageBreakdown
  turnId: string
}

function findAssistantCodexThreadTokenUsageSource(input: {
  rawEvents: readonly unknown[]
  turnId: string | null
}): { record: CodexTokenUsageBreakdown; sourcePath: string } | null {
  const tokenUsageEvents = readAssistantCodexThreadTokenUsageEvents(input)
  const totalDeltaUsage = resolveAssistantCodexThreadTokenUsageTotalDelta(
    tokenUsageEvents,
  )
  if (totalDeltaUsage) {
    return {
      record: totalDeltaUsage,
      sourcePath: 'thread.tokenUsage.total.delta',
    }
  }

  const last = tokenUsageEvents.at(-1)?.last ?? null
  return last
    ? {
        record: last,
        sourcePath: 'thread.tokenUsage.last',
      }
    : null
}

function readAssistantCodexThreadTokenUsageEvents(input: {
  rawEvents: readonly unknown[]
  turnId: string | null
}): AssistantCodexTokenUsageEvent[] {
  const turnStartedEventIndex = findAssistantCodexTurnStartedEventIndex(input)
  const currentTurnOutputEventIndex =
    findAssistantCodexCurrentTurnOutputEventIndex({
      ...input,
      turnStartedEventIndex,
    })

  const events = input.rawEvents.flatMap((rawEvent, index) => {
    const pair = readAssistantCodexTokenUsagePairFromEvent(rawEvent)
    if (
      !pair ||
      (input.turnId !== null && pair.turnId !== input.turnId) ||
      (turnStartedEventIndex !== null && index < turnStartedEventIndex)
    ) {
      return []
    }

    return [{ index, ...pair }]
  })

  if (currentTurnOutputEventIndex === null) {
    return events
  }

  const postOutputEvents = events.filter(
    (event) => event.index >= currentTurnOutputEventIndex,
  )
  return postOutputEvents.length > 0 ? postOutputEvents : events
}

function sanitizeCodexUsage(
  usage: CodexTokenUsageBreakdown,
): Record<string, unknown> {
  return {
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningOutputTokens: usage.reasoningOutputTokens,
    totalTokens: usage.totalTokens,
  }
}

type AssistantTurnProfileToolKind = 'command' | 'dynamic_tool' | 'mcp_tool'

interface AssistantTurnProfileToolAggregate {
  calls: number
  durationKnownCalls: number
  durationMs: number
  failedCalls: number
  kind: AssistantTurnProfileToolKind
  label: string
  outputBytesMax: number
  outputBytesTotal: number
}

interface AssistantTurnProfileToolAggregateRead {
  aggregates: AssistantTurnProfileToolAggregate[]
  attributionTruncated: boolean
}

// Compact per-turn profile derived entirely from notifications Codex already
// emits (thread/tokenUsage/updated per provider request, item/completed per
// tool call). This is what lets prod answer "which tool calls and which
// requests made this turn expensive" without re-deriving anything client-side.
// The request series reuses the same filtered event reader as the billed
// totals so the profile always reconciles with the row's token deltas.
export function buildAssistantCodexTurnProfileJson(input: {
  rawEvents: readonly unknown[]
  turnId: string | null
}): Record<string, unknown> | null {
  const tokenUsageEvents = readAssistantCodexThreadTokenUsageEvents(input)
  const requests = tokenUsageEvents.map((event) => ({
    cachedInput: event.last.cachedInputTokens,
    input: event.last.inputTokens,
    output: event.last.outputTokens,
  }))
  const modelContextWindow = tokenUsageEvents.at(-1)?.tokenUsage.modelContextWindow
    ?? null

  const toolsByKindAndLabel = new Map<string, AssistantTurnProfileToolAggregate>()
  let toolAttributionTruncated = false
  const startIndex = findAssistantCodexTurnStartedEventIndex(input) ?? 0
  for (let index = startIndex; index < input.rawEvents.length; index += 1) {
    const notification = readCodexServerNotification(input.rawEvents[index])
    if (notification?.method !== 'item/completed') {
      continue
    }
    if (
      input.turnId !== null &&
      readCodexNonEmptyString(notification.params.turnId) !== input.turnId
    ) {
      continue
    }

    const item = readCodexRecord(notification.params.item)
    const toolRead = readAssistantTurnProfileToolAggregates(item)
    if (!toolRead) {
      continue
    }
    toolAttributionTruncated ||= toolRead.attributionTruncated

    for (const aggregate of toolRead.aggregates) {
      const aggregateKey = JSON.stringify([aggregate.kind, aggregate.label])
      const existing = toolsByKindAndLabel.get(aggregateKey)
      if (existing) {
        if (!mergeAssistantTurnProfileToolAggregate(existing, aggregate)) {
          return null
        }
      } else {
        toolsByKindAndLabel.set(aggregateKey, aggregate)
      }
    }
  }

  if (requests.length === 0 && toolsByKindAndLabel.size === 0) {
    return null
  }

  const tools = [...toolsByKindAndLabel.values()].sort((left, right) => {
    if (right.durationMs !== left.durationMs) {
      return right.durationMs > left.durationMs ? 1 : -1
    }
    if (right.outputBytesTotal !== left.outputBytesTotal) {
      return right.outputBytesTotal > left.outputBytesTotal ? 1 : -1
    }
    return 0
  })

  return {
    modelContextWindow,
    requestCount: requests.length,
    requests: requests.slice(-ASSISTANT_TURN_PROFILE_MAX_REQUESTS),
    requestsTruncated: requests.length > ASSISTANT_TURN_PROFILE_MAX_REQUESTS,
    schema: ASSISTANT_TURN_PROFILE_SCHEMA,
    tools: tools.slice(0, ASSISTANT_TURN_PROFILE_MAX_TOOLS).map((tool) => ({
      calls: tool.calls,
      durationKnownCalls: tool.durationKnownCalls,
      durationMs: tool.durationMs,
      failedCalls: tool.failedCalls,
      kind: tool.kind,
      label: tool.label,
      outputBytesMax: tool.outputBytesMax,
      outputBytesTotal: tool.outputBytesTotal,
    })),
    toolsTruncated:
      toolAttributionTruncated
      || tools.length > ASSISTANT_TURN_PROFILE_MAX_TOOLS,
  }
}

function readAssistantTurnProfileToolAggregates(
  item: Record<string, unknown> | null,
): AssistantTurnProfileToolAggregateRead | null {
  const itemType = readAssistantProviderString(item?.type)
  if (!item || !itemType) {
    return null
  }

  if (itemType === 'commandExecution') {
    const aggregatedOutput = item.aggregatedOutput
    const label = resolveCodexCommandFamily({
      allowKnownShellWrapper: true,
      commandLabel: readAssistantProviderString(item.command),
      source: 'display',
    })
    if (label === 'vault-cli batch') {
      const batchRead = readAssistantTurnProfileBatchToolAggregates(aggregatedOutput)
      if (batchRead !== null) {
        return {
          aggregates: batchRead,
          attributionTruncated: false,
        }
      }
    }

    const durationMs = readAssistantProviderInteger(item, 'durationMs')
    const outputBytes = readAssistantTurnProfileUtf8Bytes(aggregatedOutput)

    return {
      aggregates: [{
        calls: 1,
        durationKnownCalls: durationMs === null ? 0 : 1,
        durationMs: durationMs ?? 0,
        failedCalls: isCodexActionStructurallyFailed({ item }) ? 1 : 0,
        kind: 'command',
        label,
        outputBytesMax: outputBytes,
        outputBytesTotal: outputBytes,
      }],
      attributionTruncated: label === 'vault-cli batch',
    }
  }

  if (itemType === 'mcpToolCall' || itemType === 'dynamicToolCall') {
    const server = readAssistantProviderString(
      itemType === 'mcpToolCall' ? item.server : item.namespace,
    )
    const tool = readAssistantProviderString(item.tool)
    const kind = itemType === 'mcpToolCall' ? 'mcp_tool' : 'dynamic_tool'
    const label = buildAssistantTurnProfileToolIdentityLabel({
      context: server,
      kind,
      tool,
    })

    const durationMs = readAssistantProviderInteger(item, 'durationMs')
    const outputBytes = readAssistantTurnProfileUtf8Bytes(
      itemType === 'mcpToolCall' ? item.result : item.contentItems,
    )
    return {
      aggregates: [{
        calls: 1,
        durationKnownCalls: durationMs === null ? 0 : 1,
        durationMs: durationMs ?? 0,
        failedCalls: isCodexActionStructurallyFailed({ item }) ? 1 : 0,
        kind,
        label,
        outputBytesMax: outputBytes,
        outputBytesTotal: outputBytes,
      }],
      attributionTruncated: false,
    }
  }

  return null
}

function readAssistantTurnProfileBatchToolAggregates(
  value: unknown,
): AssistantTurnProfileToolAggregate[] | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }

  const result = readAssistantProviderRecord(parsed)
  if (result?.schema !== VAULT_CLI_BATCH_RESULT_SCHEMA) {
    return null
  }
  const commands = result?.commands
  const count = result?.count
  const failed = result?.failed
  if (
    !Array.isArray(commands)
    || commands.length === 0
    || typeof count !== 'number'
    || !Number.isSafeInteger(count)
    || count !== commands.length
    || typeof failed !== 'number'
    || !Number.isSafeInteger(failed)
    || failed < 0
  ) {
    return null
  }

  const aggregates: AssistantTurnProfileToolAggregate[] = []
  let failedCommands = 0
  for (const value of commands) {
    const command = readAssistantProviderRecord(value)
    const argv = command?.argv
    const durationMs = command?.durationMs
    const ok = command?.ok
    // The v1 batch envelope counts UTF-16 code units, not bytes. Validate it
    // only as part of the envelope; byte metrics come from source-owned bytes.
    const legacyOutputChars = command?.outputChars
    const outputBytes = command?.outputBytes
    const stdout = command?.stdout
    if (
      !command
      || !Array.isArray(argv)
      || argv.some((token) => typeof token !== 'string')
      || typeof durationMs !== 'number'
      || !Number.isSafeInteger(durationMs)
      || durationMs < 0
      || typeof ok !== 'boolean'
      || typeof legacyOutputChars !== 'number'
      || !Number.isSafeInteger(legacyOutputChars)
      || legacyOutputChars < 0
      || typeof outputBytes !== 'number'
      || !Number.isSafeInteger(outputBytes)
      || outputBytes < 0
      || typeof stdout !== 'string'
      || (stdout.length > 0 && Buffer.byteLength(stdout, 'utf8') !== outputBytes)
    ) {
      return null
    }

    if (!ok) {
      const nextFailedCommands = safeAssistantTurnProfileIntegerSum(
        failedCommands,
        1,
      )
      if (nextFailedCommands === null) {
        return null
      }
      failedCommands = nextFailedCommands
    }

    aggregates.push({
      calls: 1,
      durationKnownCalls: 1,
      durationMs,
      failedCalls: ok ? 0 : 1,
      kind: 'command',
      label: resolveCodexCommandFamily({
        argv,
        source: 'batch_argv',
      }),
      outputBytesMax: outputBytes,
      outputBytesTotal: outputBytes,
    })
  }

  if (failedCommands !== failed) {
    return null
  }

  return aggregates
}

function mergeAssistantTurnProfileToolAggregate(
  target: AssistantTurnProfileToolAggregate,
  source: AssistantTurnProfileToolAggregate,
): boolean {
  const calls = safeAssistantTurnProfileIntegerSum(target.calls, source.calls)
  const durationKnownCalls = safeAssistantTurnProfileIntegerSum(
    target.durationKnownCalls,
    source.durationKnownCalls,
  )
  const durationMs = safeAssistantTurnProfileIntegerSum(
    target.durationMs,
    source.durationMs,
  )
  const failedCalls = safeAssistantTurnProfileIntegerSum(
    target.failedCalls,
    source.failedCalls,
  )
  const outputBytesTotal = safeAssistantTurnProfileIntegerSum(
    target.outputBytesTotal,
    source.outputBytesTotal,
  )
  if (
    calls === null
    || durationKnownCalls === null
    || durationMs === null
    || failedCalls === null
    || outputBytesTotal === null
  ) {
    return false
  }

  target.calls = calls
  target.durationKnownCalls = durationKnownCalls
  target.durationMs = durationMs
  target.failedCalls = failedCalls
  target.outputBytesMax = Math.max(target.outputBytesMax, source.outputBytesMax)
  target.outputBytesTotal = outputBytesTotal
  return true
}

function safeAssistantTurnProfileIntegerSum(
  left: number,
  right: number,
): number | null {
  const result = left + right
  return Number.isSafeInteger(result) ? result : null
}

function readAssistantTurnProfileUtf8Bytes(value: unknown): number {
  let serialized: string
  if (typeof value === 'string') {
    serialized = value
  } else if (value === null || value === undefined) {
    serialized = ''
  } else {
    try {
      serialized = JSON.stringify(value) ?? ''
    } catch {
      serialized = ''
    }
  }
  return Buffer.byteLength(serialized, 'utf8')
}

function findAssistantCodexTurnStartedEventIndex(input: {
  rawEvents: readonly unknown[]
  turnId: string | null
}): number | null {
  let fallbackIndex: number | null = null

  for (let index = 0; index < input.rawEvents.length; index += 1) {
    const notification = readCodexServerNotification(input.rawEvents[index])
    if (notification?.method !== 'turn/started') {
      continue
    }

    fallbackIndex ??= index
    if (input.turnId === null) {
      return index
    }

    const eventTurnId = readCodexNonEmptyString(
      readCodexRecord(notification.params.turn)?.id,
    )
    if (eventTurnId === input.turnId) {
      return index
    }
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
    const notification = readCodexServerNotification(input.rawEvents[index])
    if (
      !notification ||
      (
        input.turnId !== null &&
        readCodexNotificationTurnId(notification) !== input.turnId
      )
    ) {
      continue
    }

    if (isAssistantCodexCurrentTurnOutputNotification(notification)) {
      return index
    }
  }

  return null
}

function readCodexNotificationTurnId(
  notification: NonNullable<ReturnType<typeof readCodexServerNotification>>,
): string | null {
  return readCodexNonEmptyString(notification.params.turnId) ??
    readCodexNonEmptyString(readCodexRecord(notification.params.turn)?.id)
}

function isAssistantCodexCurrentTurnOutputNotification(
  notification: NonNullable<ReturnType<typeof readCodexServerNotification>>,
): boolean {
  if (
    notification.method === 'item/agentMessage/delta' ||
    notification.method === 'item/plan/delta' ||
    notification.method === 'item/reasoning/summaryPartAdded' ||
    notification.method === 'item/reasoning/summaryTextDelta' ||
    notification.method === 'item/reasoning/textDelta' ||
    notification.method === 'rawResponseItem/completed'
  ) {
    return true
  }

  if (
    notification.method !== 'item/started' &&
    notification.method !== 'item/completed'
  ) {
    return false
  }

  const itemType = readCodexNonEmptyString(
    readCodexRecord(notification.params.item)?.type,
  )
  return itemType === 'agentMessage' ||
    itemType === 'plan' ||
    itemType === 'reasoning' ||
    itemType === 'commandExecution' ||
    itemType === 'fileChange' ||
    itemType === 'mcpToolCall' ||
    itemType === 'dynamicToolCall' ||
    itemType === 'webSearch'
}

export function isAssistantCodexTokenUsageEventType(
  eventType: string | null,
): boolean {
  return eventType === 'thread/tokenUsage/updated'
}

function readAssistantCodexTokenUsagePairFromEvent(
  rawEvent: unknown,
): Omit<AssistantCodexTokenUsageEvent, 'index'> | null {
  const notification = readCodexServerNotification(rawEvent)
  if (notification?.method !== 'thread/tokenUsage/updated') {
    return null
  }

  const threadId = readCodexNonEmptyString(notification.params.threadId)
  const turnId = readCodexNonEmptyString(notification.params.turnId)
  const tokenUsage = readCodexThreadTokenUsage(notification.params.tokenUsage)
  if (!threadId || !turnId || !tokenUsage) {
    return null
  }

  return {
    last: tokenUsage.last,
    threadId,
    tokenUsage,
    total: tokenUsage.total,
    turnId,
  }
}

function resolveAssistantCodexThreadTokenUsageTotalDelta(
  events: ReadonlyArray<Pick<AssistantCodexTokenUsageEvent, 'last' | 'total'>>,
): CodexTokenUsageBreakdown | null {
  const first = events[0]
  const final = events.at(-1)
  if (!first || !final) {
    return null
  }

  const priorThreadBaseline = subtractCodexTokenUsage(
    first.total,
    first.last,
  )
  return subtractCodexTokenUsage(final.total, priorThreadBaseline)
}

function subtractCodexTokenUsage(
  minuend: CodexTokenUsageBreakdown,
  subtrahend: CodexTokenUsageBreakdown,
): CodexTokenUsageBreakdown {
  return {
    cacheWriteInputTokens: Math.max(
      0,
      minuend.cacheWriteInputTokens - subtrahend.cacheWriteInputTokens,
    ),
    cachedInputTokens: Math.max(
      0,
      minuend.cachedInputTokens - subtrahend.cachedInputTokens,
    ),
    inputTokens: Math.max(0, minuend.inputTokens - subtrahend.inputTokens),
    outputTokens: Math.max(0, minuend.outputTokens - subtrahend.outputTokens),
    reasoningOutputTokens: Math.max(
      0,
      minuend.reasoningOutputTokens - subtrahend.reasoningOutputTokens,
    ),
    totalTokens: Math.max(0, minuend.totalTokens - subtrahend.totalTokens),
  }
}

export interface CodexSubagentTurnTokenUsageSample {
  firstEvent: unknown
  lastEvent: unknown
  occurredAt: string
  threadId: string
  turnId: string
}

// Codex ships no aggregate usage primitive for spawned subagent threads (no
// usage RPC, no usage on the protocol Turn, no parent-side aggregation), so
// the canonical pattern is consuming each child thread's tokenUsage
// notifications. This converts the buffered first/final tokenUsage samples
// per child turn into additional usage drafts on the parent turn, using the
// same total-delta arithmetic as the parent's billed usage. Billing is
// gated on spawn evidence: only threads named by a parent-thread
// collabAgentToolCall item's receiverThreadIds (multi-agent V1: spawnAgent,
// sendInput, wait, resume — covering freshly spawned and reused children) or
// by a subAgentActivity item's agentThreadId (multi-agent V2, which emits
// activity items instead of collab tool calls) become drafts. The model is
// attributed directly from V1 spawn items or optional V2 activity evidence;
// same-model children without explicit evidence inherit parentModel. Warm
// processes are reused across threads, so a foreign thread id alone is not
// proof of a subagent — a stale flush from a previous thread must never mint a
// usage row.
export function extractCodexSubagentUsageDrafts(input: {
  modelProvider: string | null
  ordinalStart: number
  parentModel?: string | null
  parentRawEvents: readonly unknown[]
  serviceTier?: AssistantProviderServiceTier | null
  subagentTokenUsageByTurn: ReadonlyMap<
    string,
    CodexSubagentTurnTokenUsageSample
  >
}): AssistantProviderUsageDraft[] {
  if (input.subagentTokenUsageByTurn.size === 0) {
    return []
  }

  const spawnModelByThreadId = readCodexCollabSpawnModelsByThread(
    input.parentRawEvents,
  )
  const drafts: AssistantProviderUsageDraft[] = []
  let ordinal = input.ordinalStart

  for (const sample of input.subagentTokenUsageByTurn.values()) {
    if (!spawnModelByThreadId.has(sample.threadId)) {
      continue
    }

    const pairs = (
      sample.firstEvent === sample.lastEvent
        ? [sample.firstEvent]
        : [sample.firstEvent, sample.lastEvent]
    ).flatMap((event) => {
      const pair = readAssistantCodexTokenUsagePairFromEvent(event)
      return pair &&
        pair.threadId === sample.threadId &&
        pair.turnId === sample.turnId
        ? [pair]
        : []
    })
    const delta = resolveAssistantCodexThreadTokenUsageTotalDelta(pairs)
    if (!delta) {
      continue
    }

    const model = spawnModelByThreadId.get(sample.threadId)
      ?? input.parentModel
      ?? null
    const rawUsageJson = sanitizeCodexUsage(delta)
    drafts.push({
      occurredAt: sample.occurredAt,
      provider: 'codex-cli',
      providerRequestOrdinal: ordinal++,
      providerRequestOutcome: 'succeeded',
      usage: {
        apiKeyEnv: null,
        baseUrl: null,
        cacheWriteTokens: delta.cacheWriteInputTokens,
        cachedInputTokens: delta.cachedInputTokens,
        inputTokens: delta.inputTokens,
        outputTokens: delta.outputTokens,
        providerMetadataJson: null,
        providerName: resolveAssistantCodexUsageProviderName(input.modelProvider),
        providerRequestId: null,
        rawUsageJson,
        rawUsageJsonHash: hashAssistantProviderStableJson(rawUsageJson),
        reasoningTokens: delta.reasoningOutputTokens,
        requestedModel: model,
        servedModel: model,
        tokenPricingBasis: resolveCodexAssistantProviderTokenPricingBasis({
          model,
          modelProvider: input.modelProvider,
          serviceTier: input.serviceTier ?? null,
        }),
        totalTokens: delta.totalTokens,
        usageExtractionSourcePath: 'subagent.turn.tokenUsage.total.delta',
        usageExtractionVersion: CODEX_USAGE_EXTRACTION_VERSION,
      },
    })
  }

  return drafts
}

export function resolveCodexAssistantProviderTokenPricingBasis(input: {
  model: string | null
  modelProvider: string | null
  serviceTier?: AssistantProviderServiceTier | null
}): AssistantUsageTokenPricingBasis {
  return resolveHostedAiUsageTokenPricingBasis({
    model: input.model,
    providerName: resolveAssistantCodexUsageProviderName(input.modelProvider),
    serviceTier: input.serviceTier ?? null,
  })
}

// Spawn evidence map: every thread id named by a canonical collab tool call
// or subAgentActivity item is a key. That membership authorizes billing a
// foreign thread's usage. Only spawnAgent carries an explicit model in the
// pinned protocol; activity-only evidence inherits the parent model.
function readCodexCollabSpawnModelsByThread(
  rawEvents: readonly unknown[],
): Map<string, string | null> {
  const modelByThreadId = new Map<string, string | null>()
  for (const rawEvent of rawEvents) {
    const collabToolCall = readCodexCollabToolCallFromEvent(rawEvent)
    if (!collabToolCall) {
      continue
    }

    for (const receiverThreadId of collabToolCall.receiverThreadIds) {
      modelByThreadId.set(
        receiverThreadId,
        modelByThreadId.get(receiverThreadId) ?? collabToolCall.spawnModel,
      )
    }
  }

  return modelByThreadId
}

// Receiver thread ids named by a single parent-thread collab tool call or
// subagent activity event, if any. Exported so the live turn loop can
// prioritize evidenced subagent threads when its bounded usage buffer fills
// up.
export function readCodexCollabReceiverThreadIds(
  rawEvent: unknown,
): readonly string[] {
  return readCodexCollabToolCallFromEvent(rawEvent)?.receiverThreadIds ?? []
}

function readCodexCollabToolCallFromEvent(rawEvent: unknown): {
  receiverThreadIds: string[]
  spawnModel: string | null
} | null {
  const notification = readCodexServerNotification(rawEvent)
  if (
    notification?.method !== 'item/started' &&
    notification?.method !== 'item/completed'
  ) {
    return null
  }

  const item = readCodexRecord(notification.params.item)
  const itemType = readCodexNonEmptyString(item?.type)
  if (itemType === 'subAgentActivity') {
    const agentThreadId = readCodexNonEmptyString(item?.agentThreadId)
    return agentThreadId
      ? {
          receiverThreadIds: [agentThreadId],
          spawnModel: null,
        }
      : null
  }
  if (itemType !== 'collabAgentToolCall' || !Array.isArray(item?.receiverThreadIds)) {
    return null
  }

  const receiverThreadIds = item.receiverThreadIds.flatMap((receiverThreadId) => {
    const normalized = readCodexNonEmptyString(receiverThreadId)
    return normalized ? [normalized] : []
  })
  if (receiverThreadIds.length === 0) {
    return null
  }

  return {
    receiverThreadIds,
    spawnModel: item.tool === 'spawnAgent'
      ? readCodexNonEmptyString(item.model)
      : null,
  }
}

function findAssistantCodexCompletionEvent(
  rawEvents: readonly unknown[],
): ReturnType<typeof readCodexServerNotification> {
  for (let index = rawEvents.length - 1; index >= 0; index -= 1) {
    const notification = readCodexServerNotification(rawEvents[index])
    if (notification?.method === 'turn/completed') {
      return notification
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

    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      return value
    }
  }

  return null
}

export function hashAssistantProviderStableJson(value: unknown): string {
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

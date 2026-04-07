/**
 * Owns Codex CLI event normalization and progress/trace extraction so
 * assistant-codex.ts can stay focused on process execution and config loading.
 */

import { homedir } from 'node:os'

import { normalizeNullableString } from '@murphai/operator-config/text/shared'

import type {
  AssistantProviderTraceUpdate,
} from './assistant/provider-traces.js'
import {
  createAssistantProviderToolProgressEvent,
  type AssistantProviderProgressEvent,
} from './assistant/provider-progress.js'

export type CodexProgressEvent = AssistantProviderProgressEvent

export type CodexEventState = 'completed' | 'running'

export type CodexNormalizedEvent =
  | {
      kind: 'assistant_delta'
      deltaText: string
      itemId: string | null
      rawEvent: unknown
    }
  | {
      kind: 'assistant_message'
      itemId: string | null
      itemState: CodexEventState
      rawEvent: unknown
      text: string
    }
  | {
      kind: 'error'
      message: string
      rawEvent: unknown
    }
  | {
      kind: 'model_rerouted'
      model: string
      rawEvent: unknown
    }
  | {
      kind: 'plan_update'
      itemId: string | null
      rawEvent: unknown
      text: string
    }
  | {
      kind: 'reasoning_delta'
      deltaText: string
      itemId: string | null
      rawEvent: unknown
    }
  | {
      kind: 'status_item'
      commandLabel: string | null
      exitCode: number | null
      filePaths: string[]
      itemId: string | null
      itemState: CodexEventState
      itemType: string
      planText: string | null
      reasoningText: string | null
      rawEvent: unknown
    }
  | {
      kind: 'tool_call'
      itemId: string | null
      itemState: CodexEventState
      rawEvent: unknown
      toolName: string | null
      toolServer: string | null
    }
  | {
      kind: 'web_search'
      itemId: string | null
      itemState: CodexEventState
      query: string | null
      rawEvent: unknown
    }
  | {
      kind: 'unknown'
      eventType: string | null
      rawEvent: unknown
    }

export function normalizeCodexEvent(event: unknown): CodexNormalizedEvent {
  const record = asRecord(event)
  if (!record) {
    return {
      kind: 'unknown',
      eventType: null,
      rawEvent: event,
    }
  }

  const eventType = normalizeIdentifier(
    typeof record.type === 'string' ? record.type : null,
  )

  const errorText = extractCodexErrorMessage(event)
  const normalizedErrorText = normalizeStatusText(errorText)
  if (normalizedErrorText) {
    return {
      kind: 'error',
      message: normalizedErrorText,
      rawEvent: event,
    }
  }

  if (!eventType) {
    return {
      kind: 'unknown',
      eventType: null,
      rawEvent: event,
    }
  }

  if (eventType === 'model.rerouted') {
    const model = normalizeStatusText(
      findDeepStringByKeys(record, ['model', 'target_model', 'targetModel']) ??
        null,
    )
    if (!model) {
      return {
        kind: 'unknown',
        eventType,
        rawEvent: event,
      }
    }

    return {
      kind: 'model_rerouted',
      model,
      rawEvent: event,
    }
  }

  const item = extractCodexEventItem(record)
  const itemType = extractCodexEventItemType(record, item)
  const itemState =
    eventType === 'item.started'
      ? 'running'
      : eventType === 'item.completed'
        ? 'completed'
        : null
  const itemId = extractCodexItemId(record, item)

  if (
    eventType.includes('agent.message.delta') ||
    eventType.includes('assistant.message.delta')
  ) {
    const deltaText = extractEventTextDelta(record)
    if (!deltaText) {
      return {
        kind: 'unknown',
        eventType,
        rawEvent: event,
      }
    }

    return {
      kind: 'assistant_delta',
      deltaText,
      itemId,
      rawEvent: event,
    }
  }

  if (
    eventType.includes('reasoning.summary.text.delta') ||
    eventType.includes('reasoning.text.delta')
  ) {
    const deltaText = extractEventTextDelta(record)
    if (!deltaText) {
      return {
        kind: 'unknown',
        eventType,
        rawEvent: event,
      }
    }

    return {
      kind: 'reasoning_delta',
      deltaText,
      itemId,
      rawEvent: event,
    }
  }

  if (eventType.endsWith('plan.updated')) {
    const text = extractCodexEventPlanText(record)
    if (!text) {
      return {
        kind: 'unknown',
        eventType,
        rawEvent: event,
      }
    }

    return {
      kind: 'plan_update',
      itemId,
      rawEvent: event,
      text,
    }
  }

  if (itemType === 'agent.message' || itemType === 'assistant.message') {
    if (!itemState) {
      return {
        kind: 'unknown',
        eventType,
        rawEvent: event,
      }
    }

    const text = extractAssistantTextFromItem(item)
    if (!text) {
      return {
        kind: 'unknown',
        eventType,
        rawEvent: event,
      }
    }

    return {
      kind: 'assistant_message',
      itemId,
      itemState,
      rawEvent: event,
      text,
    }
  }

  if (!itemType || !itemState) {
    return {
      kind: 'unknown',
      eventType,
      rawEvent: event,
    }
  }

  if (itemType === 'web.search') {
    return {
      kind: 'web_search',
      itemId,
      itemState,
      query: normalizeStatusText(
        findDeepStringByKeys(item, ['query', 'search_query', 'searchQuery']) ??
          null,
      ),
      rawEvent: event,
    }
  }

  if (itemType === 'mcp.tool.call' || itemType === 'tool.call') {
    return {
      kind: 'tool_call',
      itemId,
      itemState,
      rawEvent: event,
      toolName: normalizeStatusText(
        findDeepStringByKeys(item, ['tool', 'tool_name', 'toolName', 'name']) ??
          null,
      ),
      toolServer: normalizeStatusText(
        findDeepStringByKeys(item, ['server', 'server_name', 'serverName']) ??
          null,
      ),
    }
  }

  return {
    kind: 'status_item',
    commandLabel: extractCommandLikeLabel(item),
    exitCode: extractNumericField(item, ['exit_code', 'exitCode']),
    filePaths: collectFilePaths(item),
    itemId,
    itemState,
    itemType,
    planText: extractCodexItemPlanText(item),
    reasoningText: extractReasoningTextFromItem(item),
    rawEvent: event,
  }
}

export function extractCodexProgressEventFromNormalized(
  normalized: CodexNormalizedEvent,
): CodexProgressEvent | null {
  if (normalized.kind === 'error') {
    return {
      id: 'codex-status',
      kind: 'status',
      rawEvent: normalized.rawEvent,
      state: 'completed',
      text: normalized.message,
    }
  }

  if (normalized.kind === 'assistant_message') {
    return {
      id: normalized.itemId,
      kind: 'message',
      rawEvent: normalized.rawEvent,
      state: normalized.itemState,
      text: normalized.text,
    }
  }

  if (normalized.kind === 'status_item') {
    const text = statusItemProgressText(normalized)
    if (!text) {
      return null
    }

    const safeLabel =
      normalized.itemType === 'command.execution'
        ? summarizeCodexCommandProgressLabel(normalized.commandLabel)
        : null

    return {
      id: normalized.itemId,
      kind: statusItemProgressKind(normalized),
      label:
        normalized.itemType === 'command.execution'
          ? normalized.commandLabel
          : null,
      rawEvent: normalized.rawEvent,
      safeLabel,
      safeText:
        normalized.itemType === 'command.execution'
          ? commandProgressSafeText(normalized.itemState, safeLabel)
          : null,
      state: normalized.itemState,
      text,
    }
  }

  if (normalized.kind === 'tool_call') {
    return createAssistantProviderToolProgressEvent({
      id: normalized.itemId,
      label: toolCallLabel(normalized),
      rawEvent: normalized.rawEvent,
      state: normalized.itemState,
      text: toolCallText(normalized),
    })
  }

  if (normalized.kind === 'web_search') {
    return {
      id: normalized.itemId,
      kind: 'search',
      rawEvent: normalized.rawEvent,
      state: normalized.itemState,
      text: webSearchProgressText(normalized),
    }
  }

  return null
}

export function extractCodexStatusEventFromStderrLine(
  line: string,
): CodexProgressEvent | null {
  const text = normalizeStatusText(line)
  if (!text || !isCodexConnectionLossText(text)) {
    return null
  }

  return {
    id: 'codex-connection-status',
    kind: 'status',
    rawEvent: {
      type: 'stderr',
      line: text,
    },
    state: /\bre-connecting\b|\bretrying\b/iu.test(text) ? 'running' : 'completed',
    text,
  }
}

export function extractCodexTraceUpdates(
  event: unknown,
): AssistantProviderTraceUpdate[] {
  const normalized = normalizeCodexEvent(event)
  return extractCodexTraceUpdatesFromNormalized(normalized)
}

export function extractCodexTraceUpdatesFromNormalized(
  normalized: CodexNormalizedEvent,
): AssistantProviderTraceUpdate[] {
  if (normalized.kind === 'error') {
    return [
      isRetryableConnectionStatus(normalized.message)
        ? {
            kind: 'status',
            mode: 'replace',
            streamKey: 'status:connection',
            text: normalized.message,
          }
        : {
            kind: 'error',
            text: normalized.message,
          },
    ]
  }

  if (normalized.kind === 'assistant_delta') {
    return [
      {
        kind: 'assistant',
        mode: 'append',
        streamKey: buildTraceStreamKey('assistant', normalized.itemId),
        text: normalized.deltaText,
      },
    ]
  }

  if (normalized.kind === 'reasoning_delta') {
    return [
      {
        kind: 'thinking',
        mode: 'append',
        streamKey: buildTraceStreamKey('thinking', normalized.itemId),
        text: normalized.deltaText,
      },
    ]
  }

  if (normalized.kind === 'plan_update') {
    return [
      {
        kind: 'thinking',
        mode: 'replace',
        streamKey: buildTraceStreamKey('thinking', normalized.itemId ?? 'plan'),
        text: normalized.text,
      },
    ]
  }

  if (normalized.kind === 'model_rerouted') {
    return [
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:model-reroute',
        text: `Switched to ${normalized.model}.`,
      },
    ]
  }

  if (normalized.kind === 'assistant_message') {
    return [
      {
        kind: 'assistant',
        mode: 'replace',
        streamKey: buildTraceStreamKey('assistant', normalized.itemId),
        text: normalized.text,
      },
    ]
  }

  if (normalized.kind === 'status_item') {
    if (normalized.itemType === 'reasoning') {
      const text = statusItemTraceText(normalized)
      if (!text) {
        return []
      }

      return [
        {
          kind: 'thinking',
          mode: 'replace',
          streamKey: buildTraceStreamKey('thinking', normalized.itemId),
          text,
        },
      ]
    }

    const text = statusItemTraceText(normalized)
    if (!text) {
      return []
    }

    return [
      {
        kind: 'status',
        mode: 'replace',
        streamKey: buildTraceStreamKey('status', statusItemTraceStreamId(normalized)),
        text,
      },
    ]
  }

  if (normalized.kind === 'tool_call') {
    const text = toolCallTraceText(normalized)
    if (!text) {
      return []
    }

    return [
      {
        kind: 'status',
        mode: 'replace',
        streamKey: buildTraceStreamKey(
          'status',
          normalized.itemId ?? 'tool.call',
        ),
        text,
      },
    ]
  }

  if (normalized.kind === 'web_search') {
    const text = webSearchTraceText(normalized)
    if (!text) {
      return []
    }

    return [
      {
        kind: 'status',
        mode: 'replace',
        streamKey: buildTraceStreamKey('status', normalized.itemId ?? 'web.search'),
        text,
      },
    ]
  }

  return []
}

function statusItemProgressKind(
  event: Extract<CodexNormalizedEvent, { kind: 'status_item' }>,
): CodexProgressEvent['kind'] {
  if (event.itemType === 'reasoning') {
    return 'reasoning'
  }
  if (event.itemType === 'command.execution') {
    return 'command'
  }
  if (event.itemType === 'file.change') {
    return 'file'
  }
  if (event.itemType === 'plan') {
    return 'plan'
  }

  return 'status'
}

function statusItemProgressText(
  event: Extract<CodexNormalizedEvent, { kind: 'status_item' }>,
): string | null {
  if (event.itemType === 'reasoning') {
    return (
      event.reasoningText ??
      (event.itemState === 'running'
        ? 'Thinking…'
        : 'Thought through the next step.')
    )
  }

  if (event.itemType === 'command.execution') {
    if (!event.commandLabel) {
      return null
    }

    return `$ ${event.commandLabel}`
  }

  if (event.itemType === 'file.change') {
    return event.filePaths.length === 0
      ? 'Updated files.'
      : event.filePaths.length === 1
        ? `Changed ${event.filePaths[0]}`
        : `Changed files: ${event.filePaths.slice(0, 3).join(', ')}${event.filePaths.length > 3 ? ', …' : ''}`
  }

  if (event.itemType === 'plan') {
    return event.planText
      ? `Plan:\n${event.planText}`
      : 'Updated the plan.'
  }

  return null
}

function statusItemTraceText(
  event: Extract<CodexNormalizedEvent, { kind: 'status_item' }>,
): string | null {
  if (event.itemType === 'command.execution') {
    const isRunning = event.itemState === 'running'
    if (isRunning) {
      return event.commandLabel
        ? `Running ${event.commandLabel}.`
        : 'Running command.'
    }

    if (typeof event.exitCode === 'number') {
      return event.commandLabel
        ? event.exitCode === 0
          ? `Finished ${event.commandLabel}.`
          : `${event.commandLabel} exited with code ${event.exitCode}.`
        : event.exitCode === 0
          ? 'Command finished.'
          : `Command exited with code ${event.exitCode}.`
    }

    return event.commandLabel
      ? `Finished ${event.commandLabel}.`
      : 'Command finished.'
  }

  if (event.itemType === 'reasoning') {
    return event.reasoningText ?? null
  }

  if (event.itemType === 'file.change' && event.itemState === 'completed') {
    if (event.filePaths.length === 0) {
      return 'Updated files.'
    }

    if (event.filePaths.length === 1) {
      return `Updated ${event.filePaths[0]}.`
    }

    return `Updated files: ${event.filePaths.slice(0, 3).join(', ')}${event.filePaths.length > 3 ? ', …' : ''}.`
  }

  return null
}

function toolCallText(
  event: Extract<CodexNormalizedEvent, { kind: 'tool_call' }>,
): string {
  return event.toolName &&
    event.toolServer &&
    event.toolServer !== event.toolName
    ? `Tool ${event.toolServer}.${event.toolName}`
    : event.toolName
      ? `Tool ${event.toolName}`
      : event.toolServer
        ? `Tool ${event.toolServer}`
        : 'Used a tool.'
}

function toolCallLabel(
  event: Extract<CodexNormalizedEvent, { kind: 'tool_call' }>,
): string | null {
  return event.toolServer && event.toolName
    ? `${event.toolServer}/${event.toolName}`
    : event.toolName ?? event.toolServer ?? null
}

function toolCallTraceText(
  event: Extract<CodexNormalizedEvent, { kind: 'tool_call' }>,
): string | null {
  const label = toolCallLabel(event) ?? 'tool call'

  return event.itemState === 'running'
    ? `Using ${label}.`
    : `Finished ${label}.`
}

function webSearchProgressText(
  event: Extract<CodexNormalizedEvent, { kind: 'web_search' }>,
): string {
  return event.query ? `Web: ${event.query}` : 'Ran a web search.'
}

function webSearchTraceText(
  event: Extract<CodexNormalizedEvent, { kind: 'web_search' }>,
): string {
  return event.itemState === 'running'
    ? event.query
      ? `Searching the web for ${JSON.stringify(event.query)}.`
      : 'Searching the web.'
    : event.query
      ? `Finished web search for ${JSON.stringify(event.query)}.`
      : 'Finished web search.'
}

function commandProgressSafeText(
  state: 'completed' | 'running',
  safeLabel: string | null,
): string | null {
  if (!safeLabel) {
    return null
  }

  return state === 'running'
    ? `running ${safeLabel}`
    : `finished ${safeLabel}`
}

function statusItemTraceStreamId(
  event: Extract<CodexNormalizedEvent, { kind: 'status_item' }>,
): string {
  return event.itemId ?? event.itemType
}

function extractCodexEventItem(
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  const directItem = asRecord(event.item)
  if (directItem) {
    return directItem
  }

  const data = asRecord(event.data)
  const nestedItem = asRecord(data?.item)
  if (nestedItem) {
    return nestedItem
  }

  return null
}

function extractCodexEventItemType(
  event: Record<string, unknown>,
  item: Record<string, unknown> | null,
): string | null {
  return normalizeIdentifier(
    typeof item?.type === 'string'
      ? item.type
      : typeof event.item_type === 'string'
        ? event.item_type
        : typeof event.itemType === 'string'
          ? event.itemType
          : null,
  )
}

function extractCodexItemId(
  event: Record<string, unknown>,
  item: Record<string, unknown> | null,
): string | null {
  return (
    normalizeNullableString(
      typeof item?.id === 'string'
        ? item.id
        : typeof event.item_id === 'string'
          ? event.item_id
          : typeof event.itemId === 'string'
            ? event.itemId
            : null,
    ) ?? null
  )
}

function extractCodexEventPlanText(
  event: Record<string, unknown>,
): string | null {
  return normalizeStreamingText(
    findDeepStringByKeys(event, ['explanation', 'summary', 'plan']) ?? null,
  )
}

function extractCodexItemPlanText(
  item: Record<string, unknown> | null,
): string | null {
  return normalizeStreamingText(
    findDeepStringByKeys(item, ['explanation', 'summary', 'message', 'text']) ?? null,
  )
}

function extractAssistantTextFromItem(
  item: Record<string, unknown> | null,
): string | null {
  if (!item) {
    return null
  }

  return normalizeStreamingText(
    typeof item.text === 'string'
      ? item.text
      : typeof item.message === 'string'
        ? item.message
        : collectTextParts(item.content) ?? collectTextParts(item.parts),
  )
}

function extractReasoningTextFromItem(
  item: Record<string, unknown> | null,
): string | null {
  if (!item) {
    return null
  }

  return normalizeStreamingText(
    collectReasoningSummaryParts(item.summary) ??
      collectReasoningSummaryParts(item.summary_parts) ??
      collectTextParts(item.content) ??
      collectTextParts(item.parts) ??
      (typeof item.text === 'string' ? item.text : null),
  )
}

function collectReasoningSummaryParts(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null
  }

  const parts = value
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      const record = asRecord(part)
      if (!record) {
        return null
      }

      return collectTextParts(record.text) ?? collectTextParts(record.content)
    })
    .filter((part): part is string => typeof part === 'string' && part.length > 0)

  if (parts.length === 0) {
    return null
  }

  return parts.join('\n\n')
}

function collectTextParts(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }

  if (!Array.isArray(value)) {
    const record = asRecord(value)
    if (!record) {
      return null
    }

    return (
      (typeof record.text === 'string' ? record.text : null) ??
      (typeof record.value === 'string' ? record.value : null) ??
      collectTextParts(record.content)
    )
  }

  const parts: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      parts.push(entry)
      continue
    }

    const record = asRecord(entry)
    if (!record) {
      continue
    }

    const nestedText =
      (typeof record.text === 'string' ? record.text : null) ??
      (typeof record.value === 'string' ? record.value : null) ??
      collectTextParts(record.content)

    if (nestedText) {
      parts.push(nestedText)
    }
  }

  if (parts.length === 0) {
    return null
  }

  return parts.join('')
}

function extractEventTextDelta(record: Record<string, unknown>): string | null {
  const directDelta =
    (typeof record.delta === 'string' ? record.delta : null) ??
    (typeof record.text_delta === 'string' ? record.text_delta : null) ??
    (typeof record.textDelta === 'string' ? record.textDelta : null) ??
    (typeof record.text === 'string' ? record.text : null) ??
    (typeof record.value === 'string' ? record.value : null)

  if (directDelta) {
    return normalizeStreamingText(directDelta)
  }

  const delta = asRecord(record.delta)
  if (!delta) {
    return null
  }

  return normalizeStreamingText(
    (typeof delta.text === 'string' ? delta.text : null) ??
      (typeof delta.value === 'string' ? delta.value : null) ??
      (typeof delta.content === 'string' ? delta.content : null) ??
      null,
  )
}

function extractCommandLikeLabel(item: Record<string, unknown> | null): string | null {
  return normalizeStatusText(
    findDeepStringByKeys(item, [
      'command',
      'command_line',
      'commandLine',
      'cmd',
      'label',
      'description',
      'query',
    ]) ?? null,
  )
}

function summarizeCodexCommandProgressLabel(value: string | null | undefined): string | null {
  const normalized = normalizeStatusText(value)
  if (!normalized) {
    return null
  }

  const tokens = splitCodexCommandLabel(normalized)
  if (tokens.length === 0) {
    return normalized
  }

  if (
    tokens.length >= 3 &&
    ['bash', 'sh', 'zsh'].includes(tokens[0]!.toLowerCase()) &&
    tokens[1] === '-lc'
  ) {
    return summarizeCodexCommandProgressLabel(tokens.slice(2).join(' '))
  }

  let startIndex = 0
  if (
    tokens[0]?.toLowerCase() === 'node' &&
    tokens[1] &&
    simplifyCodexCommandToken(tokens[1]) === 'bin.js'
  ) {
    startIndex = 2
  } else if (simplifyCodexCommandToken(tokens[0]) === 'bin.js') {
    startIndex = 1
  }

  const summaryTokens: string[] = []
  for (const token of tokens.slice(startIndex)) {
    const normalizedToken = simplifyCodexCommandToken(token)
    if (!normalizedToken) {
      continue
    }

    if (normalizedToken.startsWith('-') && summaryTokens.length > 0) {
      break
    }

    summaryTokens.push(normalizedToken)
    if (summaryTokens.length >= 5) {
      break
    }
  }

  return normalizeStatusText(summaryTokens.join(' ')) ?? normalized
}

function splitCodexCommandLabel(value: string): string[] {
  return value.match(/"[^"]*"|'[^']*'|\S+/gu) ?? []
}

function simplifyCodexCommandToken(token: string): string | null {
  const trimmed = token.trim()
  if (trimmed.length === 0) {
    return null
  }

  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed
  const compact = unquoted.trim()
  if (compact.length === 0) {
    return null
  }

  const slashParts = compact.split(/[\\/]/u)
  const tail = slashParts[slashParts.length - 1] ?? compact
  if (tail.length === 0) {
    return null
  }

  return normalizeStatusText(tail) ?? normalizeStatusText(compact)
}

function collectFilePaths(item: Record<string, unknown> | null): string[] {
  const collected = new Set<string>()
  collectDeepStringsByKeys(
    item,
    ['path', 'file_path', 'filePath', 'relative_path', 'relativePath'],
    collected,
  )
  return [...collected]
}

function collectDeepStringsByKeys(
  value: unknown,
  keys: readonly string[],
  output: Set<string>,
  visited = new Set<unknown>(),
): void {
  if (!value || typeof value !== 'object') {
    return
  }

  if (visited.has(value)) {
    return
  }
  visited.add(value)

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectDeepStringsByKeys(entry, keys, output, visited)
    }
    return
  }

  const record = value as Record<string, unknown>
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'string') {
      const normalizedCandidate = redactCodexStatusText(candidate.trim())
      if (normalizedCandidate.length > 0) {
        output.add(normalizedCandidate)
      }
    }
  }

  for (const nested of Object.values(record)) {
    collectDeepStringsByKeys(nested, keys, output, visited)
  }
}

function extractNumericField(
  value: unknown,
  keys: readonly string[],
  visited = new Set<unknown>(),
): number | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  if (visited.has(value)) {
    return null
  }
  visited.add(value)

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractNumericField(entry, keys, visited)
      if (nested !== null) {
        return nested
      }
    }
    return null
  }

  const record = value as Record<string, unknown>
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate
    }
  }

  for (const nested of Object.values(record)) {
    const result = extractNumericField(nested, keys, visited)
    if (result !== null) {
      return result
    }
  }

  return null
}

export function extractAssistantMessageFallback(input: {
  assistantStreams: Map<string, string>
  assistantStreamOrder: readonly string[]
}): string | null {
  for (let index = input.assistantStreamOrder.length - 1; index >= 0; index -= 1) {
    const streamKey = input.assistantStreamOrder[index]
    if (!streamKey) {
      continue
    }

    const text = normalizeStreamingText(input.assistantStreams.get(streamKey) ?? null)
    if (text) {
      return text.trim()
    }
  }

  return null
}

function buildTraceStreamKey(
  kind: 'assistant' | 'status' | 'thinking',
  itemId: string | null,
): string {
  return `${kind}:${itemId ?? 'main'}`
}

function normalizeIdentifier(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  return trimmed
    .replace(/([a-z0-9])([A-Z])/gu, '$1.$2')
    .replace(/[^A-Za-z0-9]+/gu, '.')
    .replace(/\.+/gu, '.')
    .replace(/^\.|\.$/gu, '')
    .toLowerCase()
}

export function normalizeStreamingText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.replace(/\r\n?/gu, '\n')
  return normalized.length > 0 ? normalized : null
}

export function normalizeStatusText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = redactCodexStatusText(value.replace(/\r\n?/gu, '\n')).trim()
  return normalized.length > 0 ? normalized : null
}

function redactCodexStatusText(value: string): string {
  const homeRoot = homedir().trim()
  if (homeRoot.length === 0) {
    return value
  }

  return value.replaceAll(homeRoot, '~')
}

export function extractCodexSessionId(event: unknown): string | null {
  const record = asRecord(event)
  const eventType = typeof record?.type === 'string' ? record.type : null

  if (eventType && eventType.startsWith('thread.')) {
    return (
      findDeepStringByKeys(record, ['thread_id', 'threadId']) ??
      findDeepStringByKeys(record, ['conversation_id', 'conversationId']) ??
      findDeepStringByKeys(record, ['id'])
    )
  }

  return (
    findDeepStringByKeys(record, ['thread_id', 'threadId']) ??
    findDeepStringByKeys(record, ['conversation_id', 'conversationId'])
  )
}

export function extractCodexErrorMessage(event: unknown): string | null {
  const record = asRecord(event)
  if (!record) {
    return null
  }

  const eventType = typeof record.type === 'string' ? record.type : null
  if (
    eventType !== 'error' &&
    eventType !== 'turn.failed' &&
    eventType !== 'turn.error'
  ) {
    return null
  }

  return (
    findDeepStringByKeys(record, ['message']) ??
    findDeepStringByKeys(record, ['error_message', 'errorMessage']) ??
    null
  )
}

function findDeepStringByKeys(
  value: unknown,
  keys: readonly string[],
  visited = new Set<unknown>(),
): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  if (visited.has(value)) {
    return null
  }
  visited.add(value)

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeepStringByKeys(item, keys, visited)
      if (found) {
        return found
      }
    }
    return null
  }

  const record = value as Record<string, unknown>
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }

  for (const nested of Object.values(record)) {
    const found = findDeepStringByKeys(nested, keys, visited)
    if (found) {
      return found
    }
  }

  return null
}

function isRetryableConnectionStatus(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('reconnect') ||
    normalized.includes('retry') ||
    normalized.includes('trying again')
  )
}

export function isCodexConnectionLossText(message: string): boolean {
  const normalized = message.toLowerCase()
  if (isCodexMcpBootstrapFailureText(normalized)) {
    return false
  }

  return (
    normalized.includes('stream disconnected') ||
    normalized.includes('stream closed before response.completed') ||
    normalized.includes('lost the provider stream') ||
    normalized.includes('network error while contacting openai') ||
    normalized.includes('connection closed prematurely') ||
    normalized.includes('connection reset') ||
    normalized.includes('connection lost') ||
    normalized.includes('connection closed') ||
    normalized.includes('socket hang up') ||
    normalized.includes('econnreset') ||
    normalized.includes('econnrefused') ||
    normalized.includes('etimedout') ||
    normalized.includes('enotfound') ||
    normalized.includes('eai_again') ||
    normalized.includes('fetch failed') ||
    normalized.includes('exceeded retry limit') ||
    normalized.includes('retry limit') ||
    normalized.includes('re-connecting') ||
    normalized.includes('retrying') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout')
  )
}

function isCodexMcpBootstrapFailureText(normalizedMessage: string): boolean {
  return (
    normalizedMessage.includes('required mcp servers failed to initialize') ||
    normalizedMessage.includes('handshaking with mcp server failed') ||
    normalizedMessage.includes('initialize response')
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

import { Buffer } from 'node:buffer'

import type { CodexNormalizedEvent } from '../assistant-codex-events.js'
import type {
  AssistantRuntimeIssueInput,
} from '../assistant/issue-reporting.js'

export const CODEX_ACTION_DIAGNOSTICS_TRACE_SCHEMA =
  'murph.assistant-codex-action-diagnostics.v1'
export const CODEX_ACTION_DIAGNOSTICS_TRACE_TYPE =
  'assistant.codex.action_diagnostics'

const ACTION_SAMPLE_LIMIT = 16
const ACTION_DEDUPE_LIMIT = 1024
const SLOW_ACTION_SAMPLE_LIMIT = 8
const OUTPUT_ITEM_SCAN_LIMIT = 64
const TRACKED_ACTION_LIMIT = 256
const TOOL_DIAGNOSTIC_LIMIT = 16
const COMMAND_RUNTIME_ISSUE_TRACK_LIMIT = 256
const COMMAND_RUNTIME_ISSUE_RECOVERY_LIMIT = 8
const COMMAND_CLASSIFICATION_SCAN_LIMIT = 4096
const TOOL_IDENTIFIER_PART_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u
const DIRECT_SEARCH_COMMAND_PATTERN = /^(?:grep|rg)(?:\s|$)/u
const UNQUOTED_SHELL_CONTROL_PATTERN = /[\r\n;&|<>`$(){}]/u

type CodexActionKind =
  | 'command.execution'
  | 'dynamic.tool.call'
  | 'file.change'
  | 'mcp.tool.call'
  | 'web.search'

type DurationMsBucket =
  | 'unknown'
  | 'lt_1s'
  | '1_5s'
  | '5_30s'
  | '30_120s'
  | 'gt_120s'

type BytesBucket =
  | 'unknown'
  | '0'
  | 'lt_1kb'
  | '1_10kb'
  | '10_100kb'
  | 'gt_100kb'

type CommandDiagnosticFamily = 'search' | 'unknown'

type CommandFailureClass =
  | 'nonzero_exit'
  | 'not_executable'
  | 'not_found'
  | 'search_error'
  | 'timeout'

type TrackedCommandDiagnostic = {
  commandOrdinal: number
  commandFamily: CommandDiagnosticFamily
}

type TokenUsageSample = {
  cachedInputTokens: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningOutputTokens: number | null
  totalTokens: number | null
}

type TrackedAction = {
  durationMs: number
  kind: CodexActionKind
}

type ActionOutputMetrics = {
  bytesTotal: number
  itemCount: number
}

type ToolDiagnosticIdentity = {
  kind: CodexActionKind
  namespacePresent: boolean
  serverPresent: boolean
  tool: string | null
}

type ToolDiagnosticMetrics = {
  bytesMax: number
  bytesTotal: number
  callCount: number
  identity: ToolDiagnosticIdentity
}

type ToolDiagnosticSummary = {
  callCount: number
  kind: CodexActionKind
  namespacePresent?: boolean
  outputBytesMax: number
  outputBytesTotal: number
  serverPresent?: boolean
  tool?: string
}

export interface CodexActionDiagnosticsReducer {
  buildTraceEvent(input: {
    codexThreadId: string | null
    providerActionCount: number
    turnId: string | null
  }): Record<string, unknown> | null
  recordEvent(input: {
    activeTurnId: string | null
    normalizedEvent: CodexNormalizedEvent
    rawEvent: unknown
  }): void
}

export interface CodexActionRuntimeIssueTracker {
  recordEvent(input: {
    activeTurnId: string | null
    normalizedEvent: CodexNormalizedEvent
    rawEvent: unknown
  }): AssistantRuntimeIssueInput | null
}

export function createCodexActionRuntimeIssueTracker(): CodexActionRuntimeIssueTracker {
  let commandActionOrdinal = 0
  const startedCommands = new Map<string, TrackedCommandDiagnostic>()
  const completedCommandIds = new Set<string>()
  const pendingSearchFailureDetails: Record<string, unknown>[] = []

  const nextCommandDiagnostic = (
    normalizedEvent: CodexNormalizedEvent,
  ): TrackedCommandDiagnostic => ({
    commandOrdinal: ++commandActionOrdinal,
    commandFamily: resolveDirectSearchCommandFamily(normalizedEvent),
  })

  return {
    recordEvent(input) {
      if (!shouldRecordEventForTurn(input.rawEvent, input.activeTurnId)) {
        return null
      }
      const eventType = readEventType(input.rawEvent)
      const kind = resolveActionKind(input.normalizedEvent, input.rawEvent)
      if (kind !== 'command.execution') {
        return buildRuntimeIssueInputForFailedCodexAction(input)
      }

      const itemId =
        readNormalizedItemId(input.normalizedEvent)
        ?? readRawItemId(input.rawEvent)
      if (eventType === 'item.started') {
        if (
          itemId !== null
          && !startedCommands.has(itemId)
          && startedCommands.size < COMMAND_RUNTIME_ISSUE_TRACK_LIMIT
        ) {
          startedCommands.set(
            itemId,
            nextCommandDiagnostic(input.normalizedEvent),
          )
        }
        return null
      }
      if (eventType !== 'item.completed') {
        return null
      }

      if (itemId !== null && completedCommandIds.has(itemId)) {
        return null
      }
      if (
        itemId !== null
        && completedCommandIds.size < COMMAND_RUNTIME_ISSUE_TRACK_LIMIT
      ) {
        completedCommandIds.add(itemId)
      }

      const startedDiagnostic = itemId === null
        ? null
        : startedCommands.get(itemId) ?? null
      if (itemId !== null) {
        startedCommands.delete(itemId)
      }
      const completionCommandPresent =
        input.normalizedEvent.kind === 'status_item'
        && input.normalizedEvent.commandLabel !== null
      const commandDiagnostic = completionCommandPresent
        ? {
            commandOrdinal:
              startedDiagnostic?.commandOrdinal ?? ++commandActionOrdinal,
            commandFamily: resolveDirectSearchCommandFamily(
              input.normalizedEvent,
            ),
          }
        : startedDiagnostic ?? nextCommandDiagnostic(input.normalizedEvent)
      const exitCode = readCommandExitCode({
        item: readEventItem(input.rawEvent),
        normalizedEvent: input.normalizedEvent,
      })

      if (exitCode === 0) {
        if (commandDiagnostic.commandFamily === 'search') {
          // Raw commands never enter diagnostic state, so recovery is the
          // intentionally coarse fact that a later direct search succeeded;
          // it does not claim that the exact query was retried.
          for (const details of pendingSearchFailureDetails) {
            details.recoveredAfterFailure = true
          }
          pendingSearchFailureDetails.length = 0
        }
        return null
      }
      if (
        exitCode === 1
        && commandDiagnostic.commandFamily === 'search'
      ) {
        return null
      }

      const issue = buildRuntimeIssueInputForFailedCodexAction({
        ...input,
        commandDiagnostic,
      })
      if (
        issue?.details
        && commandDiagnostic.commandFamily === 'search'
        && pendingSearchFailureDetails.length
          < COMMAND_RUNTIME_ISSUE_RECOVERY_LIMIT
      ) {
        pendingSearchFailureDetails.push(issue.details)
      }
      return issue
    },
  }
}

export function createCodexActionDiagnosticsReducer(): CodexActionDiagnosticsReducer {
  let eventCount = 0
  let startedCount = 0
  let completedCount = 0
  let failedCount = 0
  let durationMsTotal = 0
  let durationMsMax = 0
  let outputBytesMax = 0
  let outputBytesTotal = 0
  let outputItemCount = 0
  let tokenSampleCount = 0
  let inputTokensMax = 0
  let cachedInputTokensMax = 0
  let outputTokensMax = 0
  let reasoningOutputTokensMax = 0
  let totalTokensMax = 0
  let finalInputTokens: number | null = null
  let finalCachedInputTokens: number | null = null
  let finalOutputTokens: number | null = null
  let finalReasoningOutputTokens: number | null = null
  let finalTotalTokens: number | null = null

  const actionCounts = new Map<CodexActionKind, number>()
  const actionKinds: string[] = []
  const countedActionKeys = new Set<string>()
  const completedActionKeys = new Set<string>()
  const itemStarts = new Map<string, number>()
  const startedActionKeys = new Set<string>()
  const trackedActions: TrackedAction[] = []
  const toolMetrics = new Map<string, ToolDiagnosticMetrics>()

  const recordActionSample = (kind: CodexActionKind) => {
    if (!actionKinds.includes(kind) && actionKinds.length < ACTION_SAMPLE_LIMIT) {
      actionKinds.push(kind)
    }
  }

  const registerAction = (input: {
    actionKey: string | null
    kind: CodexActionKind
  }): boolean => {
    if (input.actionKey !== null) {
      if (countedActionKeys.has(input.actionKey)) {
        return true
      }
      if (countedActionKeys.size >= ACTION_DEDUPE_LIMIT) {
        return false
      }
      countedActionKeys.add(input.actionKey)
    }

    actionCounts.set(input.kind, (actionCounts.get(input.kind) ?? 0) + 1)
    recordActionSample(input.kind)
    return true
  }

  const recordCompletionMetrics = (input: {
    durationMs: number | null
    kind: CodexActionKind
    output: ActionOutputMetrics
    toolIdentity: ToolDiagnosticIdentity
  }) => {
    if (input.durationMs !== null) {
      durationMsTotal += input.durationMs
      durationMsMax = Math.max(durationMsMax, input.durationMs)
    }
    outputBytesTotal += input.output.bytesTotal
    outputBytesMax = Math.max(outputBytesMax, input.output.bytesTotal)
    outputItemCount += input.output.itemCount
    recordToolMetrics(toolMetrics, {
      identity: input.toolIdentity,
      outputBytes: input.output.bytesTotal,
    })

    if (trackedActions.length < TRACKED_ACTION_LIMIT) {
      trackedActions.push({
        durationMs: input.durationMs ?? 0,
        kind: input.kind,
      })
    }
  }

  const recordTokenUsage = (sample: TokenUsageSample | null) => {
    if (!sample) {
      return
    }

    tokenSampleCount += 1
    if (sample.inputTokens !== null) {
      inputTokensMax = Math.max(inputTokensMax, sample.inputTokens)
      finalInputTokens = sample.inputTokens
    }
    if (sample.cachedInputTokens !== null) {
      cachedInputTokensMax = Math.max(cachedInputTokensMax, sample.cachedInputTokens)
      finalCachedInputTokens = sample.cachedInputTokens
    }
    if (sample.outputTokens !== null) {
      outputTokensMax = Math.max(outputTokensMax, sample.outputTokens)
      finalOutputTokens = sample.outputTokens
    }
    if (sample.reasoningOutputTokens !== null) {
      reasoningOutputTokensMax = Math.max(
        reasoningOutputTokensMax,
        sample.reasoningOutputTokens,
      )
      finalReasoningOutputTokens = sample.reasoningOutputTokens
    }
    if (sample.totalTokens !== null) {
      totalTokensMax = Math.max(totalTokensMax, sample.totalTokens)
      finalTotalTokens = sample.totalTokens
    }
  }

  return {
    buildTraceEvent(input) {
      if (
        eventCount === 0 &&
        tokenSampleCount === 0 &&
        countedActionKeys.size === 0
      ) {
        return null
      }

      const slowActions = [...trackedActions]
        .sort((left, right) => {
          const durationDelta = right.durationMs - left.durationMs
          return durationDelta
        })
        .slice(0, SLOW_ACTION_SAMPLE_LIMIT)
      const topTools = [...toolMetrics.values()]
        .sort((left, right) => {
          const bytesDelta = right.bytesTotal - left.bytesTotal
          if (bytesDelta !== 0) {
            return bytesDelta
          }
          const maxDelta = right.bytesMax - left.bytesMax
          if (maxDelta !== 0) {
            return maxDelta
          }
          const countDelta = right.callCount - left.callCount
          return countDelta !== 0
            ? countDelta
            : toolDiagnosticKey(left.identity).localeCompare(
              toolDiagnosticKey(right.identity),
            )
        })
        .slice(0, TOOL_DIAGNOSTIC_LIMIT)

      return pruneNullishRecord({
        schema: CODEX_ACTION_DIAGNOSTICS_TRACE_SCHEMA,
        type: CODEX_ACTION_DIAGNOSTICS_TRACE_TYPE,
        codexActionCachedInputUnitMax: cachedInputTokensMax,
        codexActionCommandCount: actionCounts.get('command.execution') ?? 0,
        codexActionCompletedCount: completedCount,
        codexActionDurationMsMax: durationMsMax,
        codexActionDurationMsTotal: durationMsTotal,
        codexActionDynamicToolCallCount: actionCounts.get('dynamic.tool.call') ?? 0,
        codexActionEventCount: eventCount,
        codexActionFailedCount: failedCount,
        codexActionFileChangeCount: actionCounts.get('file.change') ?? 0,
        codexActionFinalCachedInputUnit: finalCachedInputTokens,
        codexActionFinalInputUnit: finalInputTokens,
        codexActionFinalOutputUnit: finalOutputTokens,
        codexActionFinalReasoningOutputUnit: finalReasoningOutputTokens,
        codexActionFinalTotalUnit: finalTotalTokens,
        codexActionInputUnitMax: inputTokensMax,
        codexActionKinds: actionKinds,
        codexActionMcpToolCallCount: actionCounts.get('mcp.tool.call') ?? 0,
        codexActionOutputBytesMax: outputBytesMax,
        codexActionOutputBytesTotal: outputBytesTotal,
        codexActionOutputItemCount: outputItemCount,
        codexActionOutputUnitMax: outputTokensMax,
        codexActionProviderActionCount: input.providerActionCount,
        codexActionReasoningOutputUnitMax: reasoningOutputTokensMax,
        codexActionSlowDurationMs: slowActions.map((action) => action.durationMs),
        codexActionSlowKinds: slowActions.map((action) => action.kind),
        codexActionStartedCount: startedCount,
        codexActionThreadIdPresent: input.codexThreadId !== null,
        codexActionToolSummaries: topTools.map(toolDiagnosticSummary),
        codexActionTotalUnitMax: totalTokensMax,
        codexActionUsageSampleCount: tokenSampleCount,
        codexActionTurnIdPresent: input.turnId !== null,
        codexActionWebSearchCount: actionCounts.get('web.search') ?? 0,
      })
    },
    recordEvent(input) {
      if (!shouldRecordEventForTurn(input.rawEvent, input.activeTurnId)) {
        return
      }

      eventCount += 1
      recordTokenUsage(readTokenUsageSample(input.rawEvent, input.activeTurnId))

      const eventType = readEventType(input.rawEvent)
      const kind = resolveActionKind(input.normalizedEvent, input.rawEvent)
      if (!kind || (eventType !== 'item.started' && eventType !== 'item.completed')) {
        return
      }

      const itemId =
        readNormalizedItemId(input.normalizedEvent) ?? readRawItemId(input.rawEvent)
      const actionKey =
        itemId !== null
          ? `${kind}:${itemId}`
          : fallbackActionKeyFromNormalized(input.normalizedEvent, kind)
      const item = readEventItem(input.rawEvent)
      const counted = registerAction({
        actionKey,
        kind,
      })
      if (!counted && actionKey !== null) {
        return
      }

      if (eventType === 'item.started') {
        if (!markActionKey(startedActionKeys, actionKey)) {
          return
        }
        startedCount += 1
        const startedAtMs = readTimestampMs(input.rawEvent, 'startedAtMs', 'started_at_ms')
        if (
          actionKey !== null &&
          startedAtMs !== null &&
          itemStarts.size < ACTION_DEDUPE_LIMIT
        ) {
          itemStarts.set(actionKey, startedAtMs)
        }
        return
      }

      if (!markActionKey(completedActionKeys, actionKey)) {
        return
      }
      completedCount += 1
      if (isFailedAction(item, input.normalizedEvent)) {
        failedCount += 1
      }

      const durationMs =
        readItemDurationMs(item)
        ?? readObservedDurationMs({
          actionKey,
          completedAtMs: readTimestampMs(input.rawEvent, 'completedAtMs', 'completed_at_ms'),
          itemStarts,
        })
      if (actionKey !== null) {
        itemStarts.delete(actionKey)
      }
      recordCompletionMetrics({
        durationMs,
        kind,
        output: measureActionOutput(item),
        toolIdentity: resolveToolDiagnosticIdentity(kind, item),
      })
    },
  }
}

function buildRuntimeIssueInputForFailedCodexAction(input: {
  commandDiagnostic?: TrackedCommandDiagnostic
  normalizedEvent: CodexNormalizedEvent
  rawEvent: unknown
}): AssistantRuntimeIssueInput | null {
  if (readEventType(input.rawEvent) !== 'item.completed') {
    return null
  }

  const kind = resolveActionKind(input.normalizedEvent, input.rawEvent)
  if (
    kind !== 'command.execution' &&
    kind !== 'dynamic.tool.call' &&
    kind !== 'mcp.tool.call'
  ) {
    return null
  }

  const item = readEventItem(input.rawEvent)
  if (!isFailedAction(item, input.normalizedEvent)) {
    return null
  }

  const durationMs = readItemDurationMs(item)
  const output = measureActionOutput(item)
  // The sanitized tool name is the difference between "a tool call failed" and
  // a diagnosable record; without it a failure cannot be traced to a surface
  // without pulling the web tier's request logs.
  const toolIdentity = resolveToolDiagnosticIdentity(kind, item)
  const commonDetails = {
    actionKind: kind,
    durationMsBucket: durationMsBucket(durationMs),
    outputBytesBucket: bytesBucket(output.bytesTotal),
    ...(toolIdentity.tool === null ? {} : { tool: toolIdentity.tool }),
  }

  if (kind === 'command.execution') {
    const exitCode = readCommandExitCode({
      item,
      normalizedEvent: input.normalizedEvent,
    })
    if (exitCode === null || exitCode === 0) {
      return null
    }

    return {
      component: 'assistant.codex-action',
      operation: 'command.execution',
      phase: 'provider_turn',
      issueKind: 'tool_error',
      severity: 'warning',
      errorCode: 'CODEX_COMMAND_EXIT_NONZERO',
      summary: 'Codex command execution failed during provider turn.',
      details: {
        ...commonDetails,
        ...(input.commandDiagnostic
          ? {
              commandFamily: input.commandDiagnostic.commandFamily,
              commandOrdinal: input.commandDiagnostic.commandOrdinal,
              failureClass: classifyCommandFailure({
                commandFamily: input.commandDiagnostic.commandFamily,
                exitCode,
              }),
              ...(input.commandDiagnostic.commandFamily === 'search'
                ? { recoveredAfterFailure: false }
                : {}),
            }
          : {}),
        exitCode,
      },
    }
  }

  if (kind === 'dynamic.tool.call') {
    return {
      component: 'assistant.codex-action',
      operation: 'dynamic.tool.call',
      phase: 'tool_call',
      issueKind: 'tool_error',
      severity: 'warning',
      errorCode: 'CODEX_DYNAMIC_TOOL_CALL_FAILED',
      summary: 'Codex dynamic tool call failed during provider turn.',
      details: commonDetails,
    }
  }

  return {
    component: 'assistant.codex-action',
    operation: 'mcp.tool.call',
    phase: 'tool_call',
    issueKind: 'tool_error',
    severity: 'warning',
    errorCode: 'CODEX_TOOL_CALL_FAILED',
    summary: 'Codex tool call failed during provider turn.',
    details: commonDetails,
  }
}

function resolveDirectSearchCommandFamily(
  normalizedEvent: CodexNormalizedEvent,
): CommandDiagnosticFamily {
  if (
    normalizedEvent.kind !== 'status_item'
    || normalizedEvent.commandLabel === null
  ) {
    return 'unknown'
  }

  const command = normalizedEvent.commandLabel.trim()
  return DIRECT_SEARCH_COMMAND_PATTERN.test(command)
    && !hasExecutableShellControl(command)
    ? 'search'
    : 'unknown'
}

/**
 * Codex serializes command argv with shell quoting for display. Keep this scan
 * transient and bounded: quoted or escaped regex syntax is argument data, while
 * unquoted control syntax means the displayed command is not provably a direct
 * `rg` or `grep` invocation. No token or argument content leaves this helper.
 */
function hasExecutableShellControl(command: string): boolean {
  if (command.length > COMMAND_CLASSIFICATION_SCAN_LIMIT) {
    return true
  }

  let quote: 'double' | 'single' | null = null
  let escaped = false
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? ''
    if (character === '\r' || character === '\n') {
      return true
    }
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && quote !== 'single') {
      escaped = true
      continue
    }
    if (quote === 'single') {
      if (character === "'") {
        quote = null
      }
      continue
    }
    if (quote === 'double') {
      if (character === '"') {
        quote = null
        continue
      }
      if (
        character === '`'
        || (character === '$' && command[index + 1] === '(')
      ) {
        return true
      }
      continue
    }
    if (character === "'") {
      quote = 'single'
      continue
    }
    if (character === '"') {
      quote = 'double'
      continue
    }
    if (UNQUOTED_SHELL_CONTROL_PATTERN.test(character)) {
      return true
    }
  }

  return escaped || quote !== null
}

function classifyCommandFailure(input: {
  commandFamily: CommandDiagnosticFamily
  exitCode: number
}): CommandFailureClass {
  if (input.exitCode === 127) {
    return 'not_found'
  }
  if (input.exitCode === 126) {
    return 'not_executable'
  }
  if (input.exitCode === 124) {
    return 'timeout'
  }
  if (input.commandFamily === 'search') {
    return 'search_error'
  }
  return 'nonzero_exit'
}

function readCommandExitCode(input: {
  item: Record<string, unknown> | null
  normalizedEvent: CodexNormalizedEvent
}): number | null {
  if (
    input.normalizedEvent.kind === 'status_item' &&
    input.normalizedEvent.exitCode !== null
  ) {
    return input.normalizedEvent.exitCode
  }

  return readInteger(input.item?.exitCode, input.item?.exit_code)
}

function durationMsBucket(value: number | null): DurationMsBucket {
  if (value === null) {
    return 'unknown'
  }
  if (value < 1_000) {
    return 'lt_1s'
  }
  if (value < 5_000) {
    return '1_5s'
  }
  if (value < 30_000) {
    return '5_30s'
  }
  if (value < 120_000) {
    return '30_120s'
  }
  return 'gt_120s'
}

function bytesBucket(value: number | null): BytesBucket {
  if (value === null) {
    return 'unknown'
  }
  if (value === 0) {
    return '0'
  }
  if (value < 1_024) {
    return 'lt_1kb'
  }
  if (value < 10 * 1_024) {
    return '1_10kb'
  }
  if (value < 100 * 1_024) {
    return '10_100kb'
  }
  return 'gt_100kb'
}

function recordToolMetrics(
  metrics: Map<string, ToolDiagnosticMetrics>,
  input: {
    identity: ToolDiagnosticIdentity
    outputBytes: number
  },
): void {
  const key = toolDiagnosticKey(input.identity)
  const existing = metrics.get(key)
  if (existing) {
    existing.bytesMax = Math.max(existing.bytesMax, input.outputBytes)
    existing.bytesTotal += input.outputBytes
    existing.callCount += 1
    return
  }

  metrics.set(key, {
    bytesMax: input.outputBytes,
    bytesTotal: input.outputBytes,
    callCount: 1,
    identity: input.identity,
  })
}

function resolveToolDiagnosticIdentity(
  kind: CodexActionKind,
  item: Record<string, unknown> | null,
): ToolDiagnosticIdentity {
  if (kind === 'dynamic.tool.call') {
    const namespace = readToolIdentifierPart(item?.namespace)
    const tool = readToolIdentifierPart(
      item?.tool,
      item?.toolName,
      item?.tool_name,
      item?.name,
    )
    return {
      kind,
      namespacePresent: namespace !== null,
      serverPresent: false,
      tool,
    }
  }

  if (kind === 'mcp.tool.call') {
    const server = readToolIdentifierPart(
      item?.server,
      item?.serverName,
      item?.server_name,
    )
    const tool = readToolIdentifierPart(
      item?.tool,
      item?.toolName,
      item?.tool_name,
      item?.name,
    )
    return {
      kind,
      namespacePresent: false,
      serverPresent: server !== null,
      tool,
    }
  }

  return {
    kind,
    namespacePresent: false,
    serverPresent: false,
    tool: null,
  }
}

function toolDiagnosticKey(identity: ToolDiagnosticIdentity): string {
  return JSON.stringify([
    identity.kind,
    identity.namespacePresent,
    identity.serverPresent,
    identity.tool,
  ])
}

function toolDiagnosticSummary(
  metrics: ToolDiagnosticMetrics,
): ToolDiagnosticSummary {
  return pruneNullishRecord({
    callCount: metrics.callCount,
    kind: metrics.identity.kind,
    namespacePresent: metrics.identity.namespacePresent ? true : null,
    outputBytesMax: metrics.bytesMax,
    outputBytesTotal: metrics.bytesTotal,
    serverPresent: metrics.identity.serverPresent ? true : null,
    tool: metrics.identity.tool,
  }) as ToolDiagnosticSummary
}

function readToolIdentifierPart(...values: unknown[]): string | null {
  const value = readNonemptyString(...values)
  if (!value || !TOOL_IDENTIFIER_PART_PATTERN.test(value)) {
    return null
  }
  return value
}

function fallbackActionKeyFromNormalized(
  normalized: CodexNormalizedEvent,
  kind: CodexActionKind,
): string | null {
  if (normalized.kind === 'status_item') {
    if (normalizeIdentifier(normalized.itemType) !== kind) {
      return null
    }
    return JSON.stringify({
      commandLabel: normalized.commandLabel,
      filePaths: normalized.filePaths,
      itemType: normalized.itemType,
      kind,
    })
  }

  if (normalized.kind === 'tool_call' && kind === 'mcp.tool.call') {
    return JSON.stringify({
      kind,
      toolName: normalized.toolName,
      toolServer: normalized.toolServer,
    })
  }

  if (normalized.kind === 'web_search' && kind === 'web.search') {
    return JSON.stringify({
      kind,
      query: normalized.query,
    })
  }

  return null
}

function markActionKey(set: Set<string>, key: string | null): boolean {
  if (key === null) {
    return true
  }
  if (set.has(key)) {
    return false
  }
  if (set.size >= ACTION_DEDUPE_LIMIT) {
    return false
  }
  set.add(key)
  return true
}

function shouldRecordEventForTurn(
  event: unknown,
  activeTurnId: string | null,
): boolean {
  if (activeTurnId === null) {
    return false
  }

  const eventTurnId = readEventTurnId(event)
  return eventTurnId === null || eventTurnId === activeTurnId
}

function resolveActionKind(
  normalized: CodexNormalizedEvent,
  rawEvent: unknown,
): CodexActionKind | null {
  const itemType =
    normalized.kind === 'status_item'
      ? normalizeIdentifier(normalized.itemType)
      : readItemType(rawEvent)

  if (itemType === 'command.execution') {
    return 'command.execution'
  }
  if (itemType === 'dynamic.tool.call') {
    return 'dynamic.tool.call'
  }
  if (itemType === 'file.change') {
    return 'file.change'
  }
  if (itemType === 'mcp.tool.call') {
    return 'mcp.tool.call'
  }
  if (itemType === 'web.search' || normalized.kind === 'web_search') {
    return 'web.search'
  }

  return null
}

function readNormalizedItemId(normalized: CodexNormalizedEvent): string | null {
  switch (normalized.kind) {
    case 'assistant_delta':
    case 'assistant_message':
    case 'plan_update':
    case 'reasoning_delta':
    case 'status_item':
    case 'tool_call':
    case 'web_search':
      return normalized.itemId
    case 'error':
    case 'model_rerouted':
    case 'unknown':
      return null
  }
}

function readEventTurnId(event: unknown): string | null {
  const record = asRecord(event)
  const params = asRecord(record?.params)
  const data = asRecord(record?.data)
  const turn =
    asRecord(params?.turn) ??
    asRecord(data?.turn) ??
    asRecord(record?.turn)
  return readNonemptyString(
    turn?.id,
    params?.turnId,
    params?.turn_id,
    data?.turnId,
    data?.turn_id,
    record?.turnId,
    record?.turn_id,
  )
}

function readEventType(event: unknown): string | null {
  const record = asRecord(event)
  const raw =
    readFirstString(record?.method, record?.type, record?.event)
  return normalizeIdentifier(raw)
}

function readEventItem(event: unknown): Record<string, unknown> | null {
  const record = asRecord(event)
  const params = asRecord(record?.params)
  const data = asRecord(record?.data)
  return asRecord(params?.item) ?? asRecord(data?.item) ?? asRecord(record?.item)
}

function readRawItemId(event: unknown): string | null {
  const record = asRecord(event)
  const params = asRecord(record?.params)
  const data = asRecord(record?.data)
  const item = readEventItem(event)
  return readNonemptyString(
    item?.id,
    params?.itemId,
    params?.item_id,
    data?.itemId,
    data?.item_id,
    record?.itemId,
    record?.item_id,
  )
}

function readItemType(event: unknown): string | null {
  const record = asRecord(event)
  const params = asRecord(record?.params)
  const item = readEventItem(event)
  return normalizeIdentifier(
    readFirstString(
      item?.type,
      record?.itemType,
      record?.item_type,
      params?.itemType,
      params?.item_type,
    ),
  )
}

function readTimestampMs(
  event: unknown,
  camelKey: string,
  snakeKey: string,
): number | null {
  const record = asRecord(event)
  const params = asRecord(record?.params)
  return readNonnegativeInteger(params?.[camelKey], params?.[snakeKey], record?.[camelKey], record?.[snakeKey])
}

function readObservedDurationMs(input: {
  actionKey: string | null
  completedAtMs: number | null
  itemStarts: Map<string, number>
}): number | null {
  if (!input.actionKey || input.completedAtMs === null) {
    return null
  }
  const startedAtMs = input.itemStarts.get(input.actionKey)
  if (startedAtMs === undefined || input.completedAtMs < startedAtMs) {
    return null
  }
  return input.completedAtMs - startedAtMs
}

function readItemDurationMs(item: Record<string, unknown> | null): number | null {
  if (!item) {
    return null
  }
  return readNonnegativeInteger(item.durationMs, item.duration_ms)
}

function isFailedAction(
  item: Record<string, unknown> | null,
  normalized: CodexNormalizedEvent,
): boolean {
  if (normalized.kind === 'status_item' && normalized.exitCode !== null) {
    return normalized.exitCode !== 0
  }
  const status = normalizeIdentifier(readFirstString(item?.status))
  if (status === 'failed' || status === 'errored') {
    return true
  }
  const success = item?.success
  if (typeof success === 'boolean') {
    return !success
  }
  const exitCode = readInteger(item?.exitCode, item?.exit_code)
  return exitCode !== null ? exitCode !== 0 : false
}

function measureActionOutput(item: Record<string, unknown> | null): ActionOutputMetrics {
  if (!item) {
    return {
      bytesTotal: 0,
      itemCount: 0,
    }
  }

  let bytesTotal = 0
  let itemCount = 0
  const addString = (value: unknown) => {
    if (typeof value !== 'string' || value.length === 0) {
      return
    }
    itemCount += 1
    bytesTotal += Buffer.byteLength(value, 'utf8')
  }

  addString(item.aggregatedOutput)
  addString(item.aggregated_output)
  addString(item.formattedOutput)
  addString(item.formatted_output)
  addString(item.stdout)
  addString(item.stderr)

  const contentItems = readArray(item.contentItems, item.content_items)
  if (contentItems) {
    for (
      let index = 0;
      index < contentItems.length && index < OUTPUT_ITEM_SCAN_LIMIT;
      index += 1
    ) {
      const contentItem = contentItems[index]
      const record = asRecord(contentItem)
      addString(record?.text)
      addString(record?.imageUrl)
      addString(record?.image_url)
    }
  }

  const result = asRecord(item.result)
  const resultContent = readArray(result?.content)
  if (resultContent) {
    for (
      let index = 0;
      index < resultContent.length && index < OUTPUT_ITEM_SCAN_LIMIT;
      index += 1
    ) {
      const contentItem = resultContent[index]
      const record = asRecord(contentItem)
      if (record) {
        const beforeCount = itemCount
        addString(record.text)
        addString(record.imageUrl)
        addString(record.image_url)
        if (itemCount === beforeCount) {
          addJsonValue(record)
        }
      } else {
        addJsonValue(contentItem)
      }
    }
  }
  addJsonValue(result?.structuredContent)
  addJsonValue(result?.structured_content)
  addJsonValue(result?._meta)
  const error = asRecord(item.error)
  addString(error?.message)

  return {
    bytesTotal,
    itemCount,
  }

  function addJsonValue(value: unknown) {
    if (value === null || value === undefined) {
      return
    }
    if (typeof value === 'string') {
      addString(value)
      return
    }
    const encoded = safeJsonStringify(value)
    if (!encoded) {
      return
    }
    itemCount += 1
    bytesTotal += Buffer.byteLength(encoded, 'utf8')
  }
}

function readTokenUsageSample(
  event: unknown,
  activeTurnId: string | null,
): TokenUsageSample | null {
  if (readEventType(event) !== 'thread.token.usage.updated') {
    return null
  }
  if (activeTurnId === null || readEventTurnId(event) !== activeTurnId) {
    return null
  }

  const record = asRecord(event)
  const params = asRecord(record?.params)
  const tokenUsage = asRecord(params?.tokenUsage) ?? asRecord(params?.token_usage)
  const last = asRecord(tokenUsage?.last)
  if (!last) {
    return null
  }

  return {
    cachedInputTokens: readNonnegativeInteger(
      last.cachedInputTokens,
      last.cached_input_tokens,
    ),
    inputTokens: readNonnegativeInteger(last.inputTokens, last.input_tokens),
    outputTokens: readNonnegativeInteger(last.outputTokens, last.output_tokens),
    reasoningOutputTokens: readNonnegativeInteger(
      last.reasoningOutputTokens,
      last.reasoning_output_tokens,
    ),
    totalTokens: readNonnegativeInteger(last.totalTokens, last.total_tokens),
  }
}

function pruneNullishRecord(
  input: Record<
    string,
    | string
    | number
    | boolean
    | string[]
    | number[]
    | ToolDiagnosticSummary[]
    | null
  >,
): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === null) {
      continue
    }
    if (Array.isArray(value) && value.length === 0) {
      continue
    }
    output[key] = value
  }
  return output
}

function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null
  } catch {
    return null
  }
}

function readFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      return value
    }
  }
  return null
}

function readNonemptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }
  return null
}

function readArray(...values: unknown[]): unknown[] | null {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value
    }
  }
  return null
}

function readInteger(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isInteger(value)) {
      return value
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (/^-?\d+$/u.test(trimmed)) {
        const parsed = Number(trimmed)
        if (Number.isSafeInteger(parsed)) {
          return parsed
        }
      }
    }
  }
  return null
}

function readNonnegativeInteger(...values: unknown[]): number | null {
  const value = readInteger(...values)
  return value !== null && value >= 0 ? value : null
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

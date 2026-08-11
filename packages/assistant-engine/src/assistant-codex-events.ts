/**
 * Owns Codex app-server event normalization and progress/trace extraction so
 * assistant-codex.ts can stay focused on process execution and config loading.
 */

import { homedir } from 'node:os'

import type {
  AssistantProviderTraceUpdate,
} from './assistant/provider-traces.js'
import {
  createAssistantProviderToolProgressEvent,
  type AssistantProviderProgressEvent,
} from './assistant/provider-progress.js'
import {
  readCodexFiniteNumber,
  readCodexNonEmptyString,
  readCodexRecord,
  readCodexServerNotification,
  readCodexString,
} from './assistant-codex/app-server-protocol.js'

export type CodexProgressEvent = AssistantProviderProgressEvent

export const CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS = [
  'Hang on, refreshing my memory real quick.',
  'One moment while I catch up on our conversation.',
  'Bear with me, pulling my thoughts together.',
  'Hang on, piecing everything together real quick.',
  'One sec, getting everything sorted in my head.',
  'Give me a moment - lots to keep track of here.',
  'Hold on, gathering my thoughts on all of this.',
  'One sec - just making sure I\'m not missing anything.',
  'Hang on, getting back up to speed.',
  'One sec, reorienting myself here.',
  'Give me a moment, picking up where we left off.',
  'Hold on, regrouping on all of this.',
  'One moment, getting my bearings again.',
  'Hang tight, walking back through everything.',
  'One sec, retracing our conversation.',
  'Give me a beat, lining everything back up.',
  'Hold on, getting my head around all the pieces.',
  'One moment, refreshing on where we are.',
  'Hang on, getting the full picture back.',
  'One sec, reconnecting the dots.',
  'Give me a second, making sure I have it all.',
  'Hold on, getting reacquainted with the details.',
  'One moment, settling back in here.',
  'Hang on, taking another pass through this.',
  'One sec, getting fully caught up.',
  'Give me a moment, threading this back together.',
  'Hold on, getting the whole thread in view.',
  'One moment, working through the backlog.',
  'Hang tight, getting reoriented.',
  'One sec, reviewing where we left things.',
  'Give me a beat, pulling the thread back together.',
  'Hold on, reading back through to be sure.',
  'One moment, getting the details straight.',
  'Hang on, picking the thread back up.',
  'One sec, making sure I have the full picture.',
  'Give me a moment, walking through it again.',
  'Hold on, getting current on everything.',
  'One moment, double-checking I have it right.',
  'Hang on, sorting through what we covered.',
  'One sec, getting the lay of the land again.',
  'Give me a moment, retracing our steps.',
  'Hold on, putting the pieces back together.',
  'One moment, getting all this loaded back in.',
  'Hang tight, going back through our thread.',
  'One sec, regrouping on what we discussed.',
  'Give me a second, getting the full thread back.',
  'Hold on, lining up the details again.',
  'One moment, getting reacquainted with all this.',
  'Hang on, getting the picture back in focus.',
  'One sec, making sure I have the whole story.',
  'Give me a moment, tracing this back through.',
  'Hold on, getting it all back in front of me.',
  'One moment, picking back up on everything.',
  'Hang on, getting situated again.',
  'One sec, walking back through the details.',
  'Give me a beat, getting fully oriented.',
  'Hold on, threading everything back together.',
  'One moment, getting back into the flow here.',
  'Just pulling our thread back up, then I\'ll keep going.',
  'Refreshing where we left off so I stay on track.',
  'Catching myself up on this chat before continuing.',
  'Getting my bearings on our conversation, then I\'ll keep going.',
  'Picking the conversation back up before I continue.',
  'Quickly reorienting on what we\'ve been working through.',
  'Pulling our recent back-and-forth up so I can keep going.',
  'Re-reading the thread so I don\'t drop anything.',
  'Getting reacquainted with what we\'ve covered, then continuing.',
  'Settling back into our conversation, then I\'ll keep moving.',
  'Bringing our discussion back into focus before I continue.',
  'Recapping our thread to myself, then back to work.',
  'Taking a quick look back at what we\'ve discussed.',
  'Re-grounding on the conversation so I stay accurate.',
  'Refreshing the thread on my end before pushing forward.',
  'Pulling the conversation back up, then I\'ll keep at it.',
  'Reviewing where we left things so I can continue properly.',
  'Catching up to our latest, then I\'ll keep going.',
  'Tracking back through the thread, then continuing the work.',
  'Reading back through our chat so I stay aligned.',
  'Pulling our notes from this chat back up before continuing.',
  'Re-checking our exchange so I don\'t miss a detail.',
  'Getting back up to speed on what we\'ve discussed.',
  'Doubling back on the thread, then I\'ll keep going.',
  'Refreshing on the details from earlier, then continuing.',
  'Quick look back at our thread, then I\'ll pick up.',
  'Just syncing back on what we\'ve worked through so far.',
  'Coming back up to speed on this conversation.',
  'Reviewing what we\'ve already covered before I continue.',
  'Pulling the conversation back into view, then continuing.',
  'Catching myself up on the thread before moving on.',
  'Walking back through our chat so I keep things straight.',
  'Refreshing on our exchange, then I\'ll keep going.',
  'Reorienting on the thread, then back to the work.',
  'Reading back over what we\'ve said so I stay on point.',
  'Glancing back over the thread, then continuing.',
  'Just refreshing on the back-and-forth from earlier.',
  'Picking the thread back up so I can keep going cleanly.',
  'Looping back through our chat before I continue.',
  'Refreshing on where we are, then carrying on with the work.',
  'Catching back up on this conversation, then continuing.',
  'Reading the thread again so I stay grounded in what we said.',
] as const

export type CodexEventState = 'completed' | 'running'
export type CodexAssistantMessagePhase = 'commentary' | 'final_answer'

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
	      messagePhase: CodexAssistantMessagePhase | null
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
  const notification = readCodexServerNotification(event)
  if (!notification) {
    return {
      kind: 'unknown',
      eventType: readCodexString(readCodexRecord(event)?.method),
      rawEvent: event,
    }
  }

  const eventType = notification.method
  const params = notification.params
  const errorText = normalizeStatusText(extractCodexErrorMessage(notification))
  if (errorText) {
    return {
      kind: 'error',
      message: errorText,
      rawEvent: event,
    }
  }

  if (eventType === 'model/rerouted') {
    const model = normalizeStatusText(readCodexString(params.toModel))
    return model
      ? {
          kind: 'model_rerouted',
          model,
          rawEvent: event,
        }
      : {
          kind: 'unknown',
          eventType,
          rawEvent: event,
        }
  }

  if (eventType === 'item/agentMessage/delta') {
    return normalizeCodexTextDeltaEvent({
      event,
      eventType,
      kind: 'assistant_delta',
      params,
    })
  }

  if (
    eventType === 'item/reasoning/summaryTextDelta' ||
    eventType === 'item/reasoning/textDelta'
  ) {
    return normalizeCodexTextDeltaEvent({
      event,
      eventType,
      kind: 'reasoning_delta',
      params,
    })
  }

  if (eventType === 'item/plan/delta') {
    const text = normalizeStreamingText(readCodexString(params.delta))
    return text
      ? {
          kind: 'plan_update',
          itemId: readCodexNonEmptyString(params.itemId),
          rawEvent: event,
          text,
        }
      : {
          kind: 'unknown',
          eventType,
          rawEvent: event,
        }
  }

  if (eventType === 'turn/plan/updated') {
    const text = extractCodexTurnPlanText(params)
    return text
      ? {
          kind: 'plan_update',
          itemId: null,
          rawEvent: event,
          text,
        }
      : {
          kind: 'unknown',
          eventType,
          rawEvent: event,
        }
  }

  const itemState: CodexEventState | null =
    eventType === 'item/started'
      ? 'running'
      : eventType === 'item/completed'
        ? 'completed'
        : null
  if (!itemState) {
    return {
      kind: 'unknown',
      eventType,
      rawEvent: event,
    }
  }

  const item = readCodexRecord(params.item)
  const itemType = readCodexNonEmptyString(item?.type)
  const itemId = readCodexNonEmptyString(item?.id)
  if (!item || !itemType) {
    return {
      kind: 'unknown',
      eventType,
      rawEvent: event,
    }
  }

  if (itemType === 'agentMessage') {
    const text = extractAssistantTextFromItem(item)
    return text
      ? {
          kind: 'assistant_message',
          itemId,
          itemState,
          messagePhase: extractAssistantMessagePhase(item),
          rawEvent: event,
          text,
        }
      : {
          kind: 'unknown',
          eventType,
          rawEvent: event,
        }
  }

  if (itemType === 'webSearch') {
    return {
      kind: 'web_search',
      itemId,
      itemState,
      query: normalizeStatusText(readCodexString(item.query)),
      rawEvent: event,
    }
  }

  if (itemType === 'mcpToolCall' || itemType === 'dynamicToolCall') {
    return {
      kind: 'tool_call',
      itemId,
      itemState,
      rawEvent: event,
      toolName: normalizeStatusText(readCodexString(item.tool)),
      toolServer: normalizeStatusText(
        readCodexString(
          itemType === 'mcpToolCall' ? item.server : item.namespace,
        ),
      ),
    }
  }

  return {
    kind: 'status_item',
    commandLabel: extractCommandLikeLabel(item),
    exitCode: extractNumericField(item, 'exitCode'),
    filePaths: collectFilePaths(item),
    itemId,
    itemState,
    itemType,
    planText: extractCodexItemPlanText(item),
    reasoningText: extractReasoningTextFromItem(item),
    rawEvent: event,
  }
}

function normalizeCodexTextDeltaEvent(input: {
  event: unknown
  eventType: string
  kind: 'assistant_delta' | 'reasoning_delta'
  params: Record<string, unknown>
}): CodexNormalizedEvent {
  const deltaText = normalizeStreamingText(readCodexString(input.params.delta))
  if (!deltaText) {
    return {
      kind: 'unknown',
      eventType: input.eventType,
      rawEvent: input.event,
    }
  }

  return {
    kind: input.kind,
    deltaText,
    itemId: readCodexNonEmptyString(input.params.itemId),
    rawEvent: input.event,
  }
}

function extractCodexTurnPlanText(
  params: Record<string, unknown>,
): string | null {
  const explanation = normalizeStreamingText(readCodexString(params.explanation))
  if (explanation) {
    return explanation
  }

  if (!Array.isArray(params.plan)) {
    return null
  }
  const steps = params.plan.flatMap((step) => {
    const text = readCodexNonEmptyString(readCodexRecord(step)?.step)
    return text ? [text] : []
  })
  return steps.length > 0 ? steps.join('\n') : null
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
      normalized.itemType === 'commandExecution'
        ? summarizeCodexCommandProgressLabel(normalized.commandLabel)
        : null

    return {
      id: normalized.itemId,
      kind: statusItemProgressKind(normalized),
      label:
        normalized.itemType === 'commandExecution'
          ? normalized.commandLabel
          : null,
      rawEvent: normalized.rawEvent,
      safeLabel,
      safeText:
        normalized.itemType === 'commandExecution'
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

export function extractCodexContextCompactionProgressTextFromNormalized(
  normalized: CodexNormalizedEvent,
): string | null {
  if (normalized.kind !== 'status_item') {
    return null
  }

  return contextCompactionStartedText(normalized)
}

export function extractCodexCompletedFinalAgentMessageTextFromNormalized(
  normalized: CodexNormalizedEvent,
): string | null {
  if (!isCodexCompletedFinalAgentMessageItemFromNormalized(normalized)) {
    return null
  }

  const text = normalizeStreamingText(normalized.text)?.trim()
  return text && text.length > 0 ? text : null
}

export function isCodexCompletedFinalAgentMessageItemFromNormalized(
  normalized: CodexNormalizedEvent,
): normalized is Extract<CodexNormalizedEvent, { kind: 'assistant_message' }> {
  return (
    normalized.kind === 'assistant_message' &&
    normalized.itemState === 'completed' &&
    normalized.messagePhase !== 'commentary'
  )
}

// Steered (mid-turn) user input is recorded by the Codex app-server as a
// completed user-message turn item. Its position in the item stream is the
// only race-free steer boundary: a final-phase agent message completed before
// it was already "sent" from the model's perspective and must not be
// superseded by a later final answer in the same turn.
export function isCodexCompletedUserMessageItemFromNormalized(
  normalized: CodexNormalizedEvent,
): boolean {
  return (
    normalized.kind === 'status_item' &&
    normalized.itemState === 'completed' &&
    normalized.itemType === 'userMessage'
  )
}

export function selectCodexContextCompactionProgressText(): string {
  const index = Math.floor(
    Math.random() * CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS.length,
  )
  return (
    CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS[index] ??
    CODEX_CONTEXT_COMPACTION_PROGRESS_TEXTS[0]
  )
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
          normalized.itemId ?? 'toolCall',
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
        streamKey: buildTraceStreamKey('status', normalized.itemId ?? 'webSearch'),
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
  if (event.itemType === 'commandExecution') {
    return 'command'
  }
  if (event.itemType === 'fileChange') {
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

  if (event.itemType === 'commandExecution') {
    if (!event.commandLabel) {
      return null
    }

    return `$ ${event.commandLabel}`
  }

  if (event.itemType === 'fileChange') {
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
  if (event.itemType === 'commandExecution') {
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

  if (event.itemType === 'fileChange' && event.itemState === 'completed') {
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

function contextCompactionStartedText(
  event: Extract<CodexNormalizedEvent, { kind: 'status_item' }>,
): string | null {
  if (
    event.itemType !== 'contextCompaction' ||
    event.itemState !== 'running'
  ) {
    return null
  }

  return selectCodexContextCompactionProgressText()
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

function extractCodexItemPlanText(
  item: Record<string, unknown>,
): string | null {
  return item.type === 'plan'
    ? normalizeStreamingText(readCodexString(item.text))
    : null
}

function extractAssistantTextFromItem(
  item: Record<string, unknown>,
): string | null {
  return normalizeStreamingText(readCodexString(item.text))
}

function extractAssistantMessagePhase(
  item: Record<string, unknown>,
): CodexAssistantMessagePhase | null {
  return item.phase === 'commentary' || item.phase === 'final_answer'
    ? item.phase
    : null
}

function extractReasoningTextFromItem(
  item: Record<string, unknown>,
): string | null {
  if (item.type !== 'reasoning') {
    return null
  }

  const summary = collectCodexStringArray(item.summary)
  if (summary) {
    return normalizeStreamingText(summary.join('\n\n'))
  }
  const content = collectCodexStringArray(item.content)
  return content
    ? normalizeStreamingText(content.join('\n\n'))
    : null
}

function collectCodexStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((part) => typeof part !== 'string')) {
    return null
  }
  const parts = value.filter((part): part is string => part.length > 0)
  return parts.length > 0 ? parts : null
}

function extractCommandLikeLabel(
  item: Record<string, unknown>,
): string | null {
  return item.type === 'commandExecution'
    ? normalizeStatusText(readCodexString(item.command))
    : null
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

function simplifyCodexCommandToken(token: string | undefined): string | null {
  if (!token) {
    return null
  }
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
  return normalizeStatusText(tail) ?? normalizeStatusText(compact)
}

function collectFilePaths(item: Record<string, unknown>): string[] {
  if (item.type !== 'fileChange' || !Array.isArray(item.changes)) {
    return []
  }

  const paths = new Set<string>()
  for (const change of item.changes) {
    const path = readCodexNonEmptyString(readCodexRecord(change)?.path)
    if (path) {
      paths.add(redactCodexStatusText(path))
    }
  }
  return [...paths]
}

function extractNumericField(
  value: Record<string, unknown>,
  key: string,
): number | null {
  return readCodexFiniteNumber(value[key])
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
  const notification = readCodexServerNotification(event)
  if (!notification) {
    return null
  }

  const directThreadId = readCodexNonEmptyString(notification.params.threadId)
  if (directThreadId) {
    return directThreadId
  }

  return readCodexNonEmptyString(
    readCodexRecord(notification.params.thread)?.id,
  )
}

export function extractCodexErrorMessage(event: unknown): string | null {
  const error = readCodexTurnError(event)
  return normalizeStreamingText(readCodexString(error?.message))
}

// Structured error classification from the Codex app-server protocol
// (`TurnError.codexErrorInfo`). String variants arrive as e.g.
// "usageLimitExceeded"; carrier variants arrive as single-key objects like
// `{ "httpConnectionFailed": { "httpStatusCode": 502 } }`.
export interface CodexStructuredErrorInfo {
  httpStatusCode: number | null
  kind: string
}

export function extractCodexErrorInfo(
  event: unknown,
): CodexStructuredErrorInfo | null {
  return normalizeCodexErrorInfoValue(readCodexTurnError(event)?.codexErrorInfo)
}

function readCodexTurnError(event: unknown): Record<string, unknown> | null {
  const notification = readCodexServerNotification(event)
  if (!notification) {
    return null
  }

  if (notification.method === 'error') {
    return readCodexRecord(notification.params.error)
  }
  if (notification.method !== 'turn/completed') {
    return null
  }

  return readCodexRecord(
    readCodexRecord(notification.params.turn)?.error,
  )
}

function normalizeCodexErrorInfoValue(
  value: unknown,
): CodexStructuredErrorInfo | null {
  if (typeof value === 'string') {
    const kind = readCodexNonEmptyString(value)
    return kind
      ? {
          httpStatusCode: null,
          kind,
        }
      : null
  }

  const record = readCodexRecord(value)
  if (!record) {
    return null
  }

  const entries = Object.entries(record)
  if (entries.length !== 1) {
    return null
  }

  const [kind, payload] = entries[0] as [string, unknown]
  const normalizedKind = readCodexNonEmptyString(kind)
  if (!normalizedKind) {
    return null
  }

  const httpStatusCode = readCodexFiniteNumber(
    readCodexRecord(payload)?.httpStatusCode,
  )
  return {
    httpStatusCode,
    kind: normalizedKind,
  }
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

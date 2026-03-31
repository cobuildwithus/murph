import type {
  AssistantSession,
  AssistantTranscriptEntry,
} from '@murph/assistant-core/assistant-cli-contracts'
import {
  findAssistantCatalogModelOptionIndex,
  findAssistantCatalogReasoningOptionIndex,
  resolveAssistantProviderCapabilities,
  type AssistantModelOption,
  type AssistantReasoningOption,
} from '../provider-catalog.js'
import { normalizeNullableString } from '@murph/assistant-core/assistant/shared'

export type InkChatTraceKind =
  | 'command'
  | 'file'
  | 'plan'
  | 'reasoning'
  | 'search'
  | 'status'
  | 'tool'

export type InkChatEntry =
  | {
      kind: 'assistant' | 'error' | 'status' | 'thinking' | 'user'
      streamKey?: string | null
      text: string
    }
  | {
      kind: 'trace'
      pending: boolean
      text: string
      traceId: string | null
      traceKind: InkChatTraceKind
    }

interface InkChatProgressEvent {
  id: string | null
  kind: InkChatTraceKind | 'message'
  rawEvent?: unknown
  state: 'completed' | 'running'
  text: string
}

export interface InkChatTraceUpdate {
  kind: 'assistant' | 'error' | 'status' | 'thinking'
  mode?: 'append' | 'replace'
  streamKey?: string | null
  text: string
}

export type {
  AssistantModelOption,
  AssistantReasoningOption,
} from '../provider-catalog.js'

export interface AssistantSlashCommand {
  command: string
  description: string
}

export interface ChatMetadataBadge {
  key: 'model' | 'reasoning' | 'vault'
  label: string
  value: string
}

export type ChatSubmitTrigger = 'enter' | 'tab'

export type ChatSubmitAction =
  | {
      kind: 'exit'
    }
  | {
      kind: 'ignore'
    }
  | {
      kind: 'model'
    }
  | {
      kind: 'prompt'
      prompt: string
    }
  | {
      kind: 'queue'
      prompt: string
    }
  | {
      kind: 'session'
    }

export const CHAT_BANNER =
  'Local-first chat backed by transcript history and resumable provider sessions when available.'

export const CHAT_COMPOSER_HINT =
  'Enter send · Tab queue when busy · Shift+Enter newline · Esc pause · /model switch model · /session show session · /exit quit'

export const CHAT_STARTER_SUGGESTIONS = [
  'Summarize recent sleep and recovery',
  'Review meal and workout patterns',
  'Find recent health anomalies',
] as const

export function shouldShowChatComposerGuidance(entryCount: number): boolean {
  return entryCount === 0
}

export const CHAT_SLASH_COMMANDS: readonly AssistantSlashCommand[] = [
  {
    command: '/model',
    description: 'switch model and reasoning',
  },
  {
    command: '/session',
    description: 'show the current session id',
  },
  {
    command: '/exit',
    description: 'quit the chat',
  },
] as const

export function seedChatEntries(
  transcriptEntries: readonly AssistantTranscriptEntry[],
): InkChatEntry[] {
  return transcriptEntries.map((entry) => ({
    kind: entry.kind,
    text: entry.text,
  }))
}

export function applyProviderProgressEventToEntries(input: {
  entries: readonly InkChatEntry[]
  event: InkChatProgressEvent
}): InkChatEntry[] {
  const traceKind = resolveInkTraceKind(input.event.kind)
  const text = input.event.text.trim()
  if (!traceKind || text.length === 0) {
    return [...input.entries]
  }

  const nextEntry: InkChatEntry = {
    kind: 'trace',
    pending: input.event.state === 'running',
    text,
    traceId: input.event.id,
    traceKind,
  }

  if (input.event.id) {
    const existingIndex = [...input.entries]
      .map((entry, index) => ({ entry, index }))
      .reverse()
      .find(
        (candidate) =>
          candidate.entry.kind === 'trace' &&
          candidate.entry.traceId === input.event.id,
      )?.index

    if (typeof existingIndex === 'number') {
      const existingEntry = input.entries[existingIndex]
      if (
        existingEntry &&
        existingEntry.kind === 'trace' &&
        existingEntry.pending === nextEntry.pending &&
        existingEntry.text === nextEntry.text &&
        existingEntry.traceKind === nextEntry.traceKind
      ) {
        return [...input.entries]
      }

      return input.entries.map((entry, index) =>
        index === existingIndex ? nextEntry : entry,
      )
    }
  }

  const previousEntry = input.entries[input.entries.length - 1]
  if (
    previousEntry &&
    previousEntry.kind === 'trace' &&
    previousEntry.traceId === nextEntry.traceId &&
    previousEntry.pending === nextEntry.pending &&
    previousEntry.text === nextEntry.text &&
    previousEntry.traceKind === nextEntry.traceKind
  ) {
    return [...input.entries]
  }

  return [...input.entries, nextEntry]
}

export function finalizePendingInkChatTraces(
  entries: readonly InkChatEntry[],
  turnTracePrefix?: string | null,
): InkChatEntry[] {
  const normalizedPrefix = normalizeNullableString(turnTracePrefix)

  return entries.map((entry) =>
    entry.kind === 'trace' &&
    entry.pending &&
    (!normalizedPrefix ||
      (entry.traceId !== null && entry.traceId.startsWith(`${normalizedPrefix}:`)))
      ? {
          ...entry,
          pending: false,
        }
      : entry,
  )
}

export function applyInkChatTraceUpdates(
  entries: readonly InkChatEntry[],
  updates: readonly InkChatTraceUpdate[],
): InkChatEntry[] {
  if (updates.length === 0) {
    return [...entries]
  }

  const nextEntries = [...entries]

  for (const update of updates) {
    const normalizedText = normalizeTraceText(update.text)
    if (!normalizedText) {
      continue
    }

    const streamKey = normalizeNullableString(update.streamKey) ?? null
    if (!streamKey) {
      nextEntries.push({
        kind: update.kind,
        text: normalizedText,
      })
      continue
    }

    const existingEntryIndex = findInkChatEntryIndexByStreamKey(
      nextEntries,
      streamKey,
      update.kind,
    )

    if (existingEntryIndex < 0) {
      nextEntries.push({
        kind: update.kind,
        streamKey,
        text: normalizedText,
      })
      continue
    }

    const existingEntry = nextEntries[existingEntryIndex]
    if (!existingEntry) {
      continue
    }

    nextEntries[existingEntryIndex] = {
      ...existingEntry,
      text:
        update.mode === 'append'
          ? `${existingEntry.text}${normalizedText}`
          : normalizedText,
    }
  }

  return nextEntries
}

function resolveInkTraceKind(
  kind: InkChatProgressEvent['kind'],
): InkChatTraceKind | null {
  switch (kind) {
    case 'command':
    case 'file':
    case 'plan':
    case 'reasoning':
    case 'search':
    case 'status':
    case 'tool':
      return kind
    default:
      return null
  }
}

export function findAssistantModelOptionIndex(
  model: string | null,
  options: readonly AssistantModelOption[],
): number {
  return findAssistantCatalogModelOptionIndex(model, options)
}

export function findAssistantReasoningOptionIndex(
  reasoningEffort: string | null,
  options: readonly AssistantReasoningOption[],
): number {
  return findAssistantCatalogReasoningOptionIndex(reasoningEffort, options)
}

export function getMatchingSlashCommands(
  input: string,
): readonly AssistantSlashCommand[] {
  const trimmedInput = input.trim()
  if (!trimmedInput.startsWith('/')) {
    return []
  }

  const normalizedInput = trimmedInput.toLowerCase()
  return CHAT_SLASH_COMMANDS.filter((command) =>
    command.command.startsWith(normalizedInput),
  )
}

export function formatElapsedClock(elapsedSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(elapsedSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatBusyStatus(elapsedSeconds: number): string {
  return `Working · ${formatElapsedClock(elapsedSeconds)}`
}

export function resolveChatSubmitAction(
  input: string,
  options:
    | boolean
    | {
        busy: boolean
        trigger?: ChatSubmitTrigger
      },
): ChatSubmitAction {
  const prompt = input.trim()
  const busy = typeof options === 'boolean' ? options : options.busy
  const trigger = typeof options === 'boolean' ? 'enter' : options.trigger ?? 'enter'

  if (prompt.length === 0) {
    return {
      kind: 'ignore',
    }
  }

  if (prompt === '/exit' || prompt === '/quit') {
    return busy
      ? {
          kind: 'ignore',
        }
      : {
          kind: 'exit',
        }
  }

  if (prompt === '/session') {
    return busy
      ? {
          kind: 'ignore',
        }
      : {
          kind: 'session',
        }
  }

  if (prompt === '/model') {
    return busy
      ? {
          kind: 'ignore',
        }
      : {
          kind: 'model',
        }
  }

  if (busy) {
    return trigger === 'tab'
      ? {
          kind: 'queue',
          prompt,
        }
      : {
          kind: 'ignore',
        }
  }

  return {
    kind: 'prompt',
    prompt,
  }
}

export function shouldClearComposerForSubmitAction(
  action: ChatSubmitAction,
): boolean {
  return (
    action.kind === 'model' ||
    action.kind === 'prompt' ||
    action.kind === 'queue'
  )
}

export function formatChatMetadata(
  input: {
    model: string | null
    provider: AssistantSession['provider']
    reasoningEffort: string | null
  },
  redactedVault: string,
): string {
  return [
    formatModelSummary(input),
    redactedVault,
  ].join(' · ')
}

export function resolveChatMetadataBadges(
  input: {
    model: string | null
    provider: AssistantSession['provider']
    reasoningEffort: string | null
  },
  redactedVault: string,
): ChatMetadataBadge[] {
  const normalizedModel = normalizeNullableString(input.model) ?? input.provider
  const normalizedReasoningEffort = normalizeNullableString(input.reasoningEffort)
  const capabilities = resolveAssistantProviderCapabilities(input.provider)

  return [
    {
      key: 'model',
      label: 'model',
      value: normalizedModel,
    },
    ...(capabilities.supportsReasoningEffort && normalizedReasoningEffort
      ? [
          {
            key: 'reasoning' as const,
            label: 'reasoning',
            value: normalizedReasoningEffort,
          },
        ]
      : []),
    {
      key: 'vault',
      label: 'vault',
      value: redactedVault,
    },
  ]
}

export function formatSessionBinding(session: AssistantSession): string | null {
  const parts = [
    session.binding.channel,
    session.binding.actorId,
    session.binding.threadId,
  ].filter((value): value is string => Boolean(value))

  return parts.length > 0 ? parts.join(' · ') : null
}

function findInkChatEntryIndexByStreamKey(
  entries: readonly InkChatEntry[],
  streamKey: string,
  kind: InkChatTraceUpdate['kind'],
): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (
      entry &&
      entry.kind !== 'trace' &&
      entry.streamKey === streamKey &&
      entry.kind === kind
    ) {
      return index
    }
  }

  return -1
}

function normalizeTraceText(value: string): string | null {
  const normalized = value.replace(/\r\n?/gu, '\n')
  return normalized.length > 0 ? normalized : null
}

function formatModelSummary(input: {
  model: string | null
  provider: AssistantSession['provider']
  reasoningEffort: string | null
}): string {
  const model = input.model?.trim()
  const capabilities = resolveAssistantProviderCapabilities(input.provider)
  const reasoningEffort = capabilities.supportsReasoningEffort
    ? input.reasoningEffort?.trim()
    : null

  if (model) {
    return reasoningEffort ? `${model} ${reasoningEffort}` : model
  }

  if (reasoningEffort) {
    return `${input.provider} ${reasoningEffort}`
  }

  return input.provider
}

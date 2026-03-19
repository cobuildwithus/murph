import type {
  AssistantSession,
  AssistantTranscriptEntry,
} from '../../assistant-cli-contracts.js'
import { normalizeNullableString } from '../shared.js'

export interface InkChatEntry {
  kind: 'assistant' | 'error' | 'status' | 'thinking' | 'user'
  streamKey?: string | null
  text: string
}

export interface InkChatTraceUpdate {
  kind: 'assistant' | 'error' | 'status' | 'thinking'
  mode?: 'append' | 'replace'
  streamKey?: string | null
  text: string
}

export interface AssistantModelOption {
  description: string
  value: string
}

export interface AssistantReasoningOption {
  description: string
  label: string
  value: string
}

export interface AssistantSlashCommand {
  command: string
  description: string
}

export interface ChatMetadataBadge {
  key: 'model' | 'reasoning' | 'vault'
  label: string
  value: string
}

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
      kind: 'session'
    }

export const CHAT_BANNER =
  'Local-first chat backed by transcript history and resumable provider sessions when available.'

export const CHAT_COMPOSER_HINT =
  'Enter send · Shift+Enter newline · /model switch model · /session show session · /exit quit'

export const CHAT_STARTER_SUGGESTIONS = [
  'Summarize the current codebase',
  'Continue the last session',
  'Find likely issues in this area',
] as const

export const CHAT_MODEL_OPTIONS: readonly AssistantModelOption[] = [
  {
    value: 'gpt-5.4',
    description: 'Latest frontier agentic coding model.',
  },
  {
    value: 'gpt-5.4-mini',
    description: 'Smaller frontier agentic coding model.',
  },
  {
    value: 'gpt-5.3-codex',
    description: 'Frontier Codex-optimized agentic coding model.',
  },
  {
    value: 'gpt-5.3-codex-spark',
    description: 'Ultra-fast coding model.',
  },
] as const

export const CHAT_REASONING_OPTIONS: readonly AssistantReasoningOption[] = [
  {
    value: 'low',
    label: 'Low',
    description: 'Fast responses with lighter reasoning',
  },
  {
    value: 'medium',
    label: 'Medium',
    description: 'Balances speed and reasoning depth for everyday tasks',
  },
  {
    value: 'high',
    label: 'High',
    description: 'Greater reasoning depth for complex problems',
  },
  {
    value: 'xhigh',
    label: 'Extra high',
    description: 'Extra high reasoning depth for complex problems',
  },
] as const

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

export function findAssistantModelOptionIndex(model: string | null): number {
  const normalizedModel = normalizeNullableString(model)
  const index = CHAT_MODEL_OPTIONS.findIndex(
    (option) => option.value === normalizedModel,
  )
  return index >= 0 ? index : 0
}

export function findAssistantReasoningOptionIndex(reasoningEffort: string | null): number {
  const normalizedReasoningEffort = normalizeNullableString(reasoningEffort)
  const index = CHAT_REASONING_OPTIONS.findIndex(
    (option) => option.value === normalizedReasoningEffort,
  )
  return index >= 0 ? index : 1
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
  busy: boolean,
): ChatSubmitAction {
  const prompt = input.trim()

  if (prompt.length === 0 || busy) {
    return {
      kind: 'ignore',
    }
  }

  if (prompt === '/exit' || prompt === '/quit') {
    return {
      kind: 'exit',
    }
  }

  if (prompt === '/session') {
    return {
      kind: 'session',
    }
  }

  if (prompt === '/model') {
    return {
      kind: 'model',
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
  return action.kind === 'model' || action.kind === 'prompt'
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

  return [
    {
      key: 'model',
      label: 'model',
      value: normalizedModel,
    },
    ...(normalizedReasoningEffort
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
  kind: InkChatEntry['kind'],
): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry?.streamKey === streamKey && entry.kind === kind) {
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
  const reasoningEffort = input.reasoningEffort?.trim()

  if (model) {
    return reasoningEffort ? `${model} ${reasoningEffort}` : model
  }

  if (reasoningEffort) {
    return `${input.provider} ${reasoningEffort}`
  }

  return input.provider
}

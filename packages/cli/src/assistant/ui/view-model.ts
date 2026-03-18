import type {
  AssistantSession,
  AssistantTranscriptEntry,
} from '../../assistant-cli-contracts.js'

export interface InkChatEntry {
  kind: 'assistant' | 'error' | 'user'
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
  'Local-first chat. Healthy Bob replays locally stored transcripts and may also resume provider-side history when supported.'

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
    description: 'choose what model and reasoning effort to use',
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

export function formatBusyStatus(elapsedSeconds: number): string {
  if (elapsedSeconds <= 0) {
    return 'Working'
  }

  return `Working (${elapsedSeconds}s)`
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

export function formatSessionBinding(session: AssistantSession): string | null {
  const parts = [
    session.binding.channel,
    session.binding.actorId,
    session.binding.threadId,
  ].filter((value): value is string => Boolean(value))

  return parts.length > 0 ? parts.join(' · ') : null
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

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

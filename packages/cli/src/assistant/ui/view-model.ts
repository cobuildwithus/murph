import type { AssistantSession } from '../../assistant-cli-contracts.js'

export interface InkChatEntry {
  kind: 'assistant' | 'error' | 'user'
  text: string
}

export const CHAT_BANNER =
  'Local-first chat. Provider transcripts stay with the provider when supported.'

export const CHAT_COMMAND_HINT = '/session for session id · /exit to quit'

export function seedChatEntries(_session: AssistantSession): InkChatEntry[] {
  return []
}

export function formatBusyStatus(elapsedSeconds: number): string {
  if (elapsedSeconds <= 0) {
    return 'Working'
  }

  return `Working (${elapsedSeconds}s)`
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

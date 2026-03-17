import type { AssistantSession } from '../../assistant-cli-contracts.js'

export interface InkChatEntry {
  kind: 'assistant' | 'error' | 'system' | 'user'
  text: string
}

export const DEFAULT_CHAT_FOOTER =
  'Type a message. Use /session to inspect the Healthy Bob session id and /exit to quit.'

export const ACTIVE_CHAT_FOOTER =
  'Use /session to inspect the Healthy Bob session id and /exit to quit.'

export const BUSY_CHAT_STATUS = 'assistant> thinking...'

export function seedChatEntries(session: AssistantSession): InkChatEntry[] {
  const entries: InkChatEntry[] = [
    {
      kind: 'system',
      text: 'Local-first chat. Provider transcripts stay with the provider when supported.',
    },
  ]

  if (session.lastUserMessage) {
    entries.push({
      kind: 'user',
      text: session.lastUserMessage,
    })
  }

  if (session.lastAssistantMessage) {
    entries.push({
      kind: 'assistant',
      text: session.lastAssistantMessage,
    })
  }

  return entries
}

export function formatEntry(entry: InkChatEntry): string {
  switch (entry.kind) {
    case 'assistant':
      return `assistant> ${entry.text}`
    case 'error':
      return `error> ${entry.text}`
    case 'system':
      return `system> ${entry.text}`
    case 'user':
      return `you> ${entry.text}`
  }
}

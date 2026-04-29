import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export const LOCAL_ASSISTANT_LINQ_IMESSAGE_ERROR =
  'Local assistant Linq/iMessage routes are no longer supported. Hosted/shared assistant-engine Linq/iMessage support remains available.'

export function normalizeAssistantLocalChannel(
  channel?: string | null,
): string | null {
  if (typeof channel !== 'string') {
    return null
  }

  const normalized = channel.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  switch (normalized) {
    case 'imessage':
    case 'i-message':
      return 'linq'
    default:
      return normalized
  }
}

export function throwLocalAssistantLinqIMessageUnsupported(): never {
  throw new VaultCliError('invalid_option', LOCAL_ASSISTANT_LINQ_IMESSAGE_ERROR)
}

export function assertLocalAssistantLinqIMessageChannelSupported(
  channel?: string | null,
): void {
  if (normalizeAssistantLocalChannel(channel) === 'linq') {
    throwLocalAssistantLinqIMessageUnsupported()
  }
}

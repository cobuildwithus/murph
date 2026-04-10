import type {
  AssistantAutomationCursor,
  AssistantAutomationState,
} from '@murphai/operator-config/assistant-cli-contracts'

export type AssistantAutoReplyChannelState = AssistantAutomationState['autoReply'][number]

export function normalizeAssistantAutoReplyChannels(
  channels: readonly string[],
): string[] {
  return [...new Set(channels.map((channel) => channel.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  )
}

export function reconcileAssistantAutoReplyState(input: {
  current: readonly AssistantAutoReplyChannelState[]
  enabledChannels: readonly string[]
  latestCursor: AssistantAutomationCursor | null
}): AssistantAutoReplyChannelState[] {
  const currentByChannel = new Map(
    input.current.map((entry) => [entry.channel, entry] as const),
  )

  return normalizeAssistantAutoReplyChannels(input.enabledChannels).map((channel) => {
    const existing = currentByChannel.get(channel)
    if (existing) {
      return existing
    }

    return {
      channel,
      cursor: input.latestCursor,
    }
  })
}

export function hasAssistantAutoReplyChannel(
  autoReply: readonly AssistantAutoReplyChannelState[],
  channel: string,
): boolean {
  return autoReply.some((entry) => entry.channel === channel)
}

export function sameAssistantAutoReplyState(
  left: readonly AssistantAutoReplyChannelState[],
  right: readonly AssistantAutoReplyChannelState[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index]
      return (
        other?.channel === entry.channel &&
        other.cursor?.captureId === entry.cursor?.captureId &&
        other.cursor?.occurredAt === entry.cursor?.occurredAt
      )
    })
  )
}

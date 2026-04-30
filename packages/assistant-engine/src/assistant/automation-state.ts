import type {
  AssistantInputCursor,
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
  enabledAt: string
  enabledChannels: readonly string[]
  eligibleAfter: AssistantInputCursor | null
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
      eligibleAfter: input.eligibleAfter,
      enabledAt: input.enabledAt,
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
        other.enabledAt === entry.enabledAt &&
        sameAssistantInputCursor(other.eligibleAfter, entry.eligibleAfter)
      )
    })
  )
}

function sameAssistantInputCursor(
  left: AssistantInputCursor | null | undefined,
  right: AssistantInputCursor | null | undefined,
): boolean {
  return (
    left?.inputId === right?.inputId &&
    (left?.createdAt ?? null) === (right?.createdAt ?? null) &&
    left?.occurredAt === right?.occurredAt &&
    left?.sourceKind === right?.sourceKind &&
    (left?.sourcePosition ?? null) === (right?.sourcePosition ?? null)
  )
}

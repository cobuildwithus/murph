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

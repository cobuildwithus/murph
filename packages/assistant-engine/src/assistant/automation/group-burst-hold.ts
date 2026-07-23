import type { AssistantInputSourceRef } from '../input-source.js'
import type { AssistantAutomationInputSummary } from './input-summary.js'

export const ASSISTANT_GROUP_BURST_QUIET_MS = 5_000
export const ASSISTANT_GROUP_BURST_MAX_HOLD_MS = 15_000

export type AssistantGroupBurstHoldDecision =
  | {
      ready: true
    }
  | {
      ready: false
      resumeAt: number
    }

export interface AssistantGroupBurstHoldItem {
  groupParticipantAdded?: true
  sourceRef: AssistantInputSourceRef | null
  summary: Pick<
    AssistantAutomationInputSummary,
    | 'actorIsSelf'
    | 'affirmativeReaction'
    | 'conversation'
    | 'occurredAt'
    | 'receivedAt'
  >
}

export function decideAssistantGroupBurstHold(input: {
  items: readonly AssistantGroupBurstHoldItem[]
  now: number
}): AssistantGroupBurstHoldDecision {
  if (
    input.items.length === 0 ||
    input.items.some((item) => !isAssistantGroupBurstHoldItem(item))
  ) {
    return {
      ready: true,
    }
  }

  const timestamps = input.items.map((item) =>
    Date.parse(item.summary.receivedAt ?? item.summary.occurredAt),
  )
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) {
    return {
      ready: true,
    }
  }

  const oldest = Math.min(...timestamps)
  const newest = Math.max(...timestamps)
  const resumeAt = Math.min(
    newest + ASSISTANT_GROUP_BURST_QUIET_MS,
    oldest + ASSISTANT_GROUP_BURST_MAX_HOLD_MS,
  )

  return input.now >= resumeAt
    ? {
        ready: true,
      }
    : {
        ready: false,
        resumeAt,
      }
}

function isAssistantGroupBurstHoldItem(
  item: AssistantGroupBurstHoldItem,
): boolean {
  if (
    item.groupParticipantAdded === true ||
    item.summary.actorIsSelf ||
    item.summary.affirmativeReaction === true ||
    item.summary.conversation.threadIsDirect !== false
  ) {
    return false
  }

  return item.sourceRef?.kind === 'inbox-capture' ||
    (
      item.sourceRef?.kind === 'hosted-mailbox' &&
      item.sourceRef.lane === 'conversation'
    )
}

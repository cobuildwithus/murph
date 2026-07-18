import type { AssistantOutboxIntent } from '@murphai/operator-config/assistant-cli-contracts'
import { parseHostedEmailThreadTarget } from '@murphai/runtime-state'

export const GROUP_NEWSLETTER_DELIVERY_KEY_PREFIX = 'group-newsletter:'

export type NewsletterRecipientState =
  | 'active'
  | 'sent'
  | 'safely_replayable'
  | 'non_replayable'

export type NewsletterRecipientGroup = {
  intents: readonly AssistantOutboxIntent[]
  memberId: string
  state: NewsletterRecipientState
}

export function buildGroupNewsletterDeliveryKey(input: {
  automationId: string
  groupId: string
  occurrenceAt: string
}): string {
  return `${buildGroupNewsletterOccurrenceKeyPrefix(input)}${input.groupId}`
}

export function buildGroupNewsletterOccurrenceKeyPrefix(input: {
  automationId: string
  occurrenceAt: string
}): string {
  return [
    'group-newsletter',
    input.automationId,
    input.occurrenceAt,
    '',
  ].join(':')
}

export function isGroupNewsletterOutboxIntent(
  intent: AssistantOutboxIntent,
): boolean {
  return (
    intent.deliveryIdempotencyKey?.startsWith(
      GROUP_NEWSLETTER_DELIVERY_KEY_PREFIX,
    ) === true &&
    parseHostedEmailThreadTarget(intent.explicitTarget)?.targetKind === 'group'
  )
}

export function classifyNewsletterRecipientFamily(
  intents: readonly AssistantOutboxIntent[],
): NewsletterRecipientGroup[] {
  const grouped = new Map<string, AssistantOutboxIntent[]>()
  for (const intent of intents) {
    const memberId = parseHostedEmailThreadTarget(
      intent.explicitTarget,
    )?.recipientMemberId
    if (!memberId) {
      continue
    }
    const group = grouped.get(memberId) ?? []
    group.push(intent)
    grouped.set(memberId, group)
  }

  return [...grouped].map(([memberId, groupIntents]) => ({
    intents: groupIntents,
    memberId,
    state: classifyNewsletterRecipientGroup(groupIntents),
  }))
}

function classifyNewsletterRecipientGroup(
  intents: readonly AssistantOutboxIntent[],
): NewsletterRecipientState {
  if (intents.some(isActiveNewsletterRecipientIntent)) {
    return 'active'
  }
  if (intents.some((intent) => intent.status === 'sent')) {
    return 'sent'
  }
  if (intents.some(isNonReplayableNewsletterRecipientIntent)) {
    return 'non_replayable'
  }
  return 'safely_replayable'
}

function isActiveNewsletterRecipientIntent(intent: AssistantOutboxIntent): boolean {
  return (
    intent.status === 'awaiting_approval' ||
    intent.status === 'pending' ||
    intent.status === 'retryable' ||
    intent.status === 'sending'
  )
}

function isNonReplayableNewsletterRecipientIntent(
  intent: AssistantOutboxIntent,
): boolean {
  return (
    (intent.status === 'failed' || intent.status === 'abandoned') &&
    (intent.lastError?.code === 'ASSISTANT_DELIVERY_AMBIGUOUS' ||
      intent.lastError?.code === 'ASSISTANT_DELIVERY_RETRY_EXHAUSTED')
  )
}

export interface AssistantOutboxDeliverySequenceIntent {
  deliveryIdempotencyKey?: string | null
  turnId: string
}

export interface AssistantOutboxRequiredBeforeFinalSequenceMember {
  kind: 'final' | 'predecessor'
  segmentOrdinal: number | null
  sequenceBaseKey: string
  turnId: string
}

export interface AssistantOutboxRequiredBeforeFinalDependencyIntent
  extends AssistantOutboxDeliverySequenceIntent {
  delivery?: unknown | null
  deliveryTransportIdempotent: boolean
  intentId: string
  lastError?: {
    code?: string | null
  } | null
  sessionId: string
  status:
    | 'abandoned'
    | 'awaiting_approval'
    | 'failed'
    | 'pending'
    | 'retryable'
    | 'sending'
    | 'sent'
}

export interface AssistantOutboxRequiredBeforeFinalDependencyState {
  blockedIntentIds: Set<string>
  predecessorByFinalIntentId: Map<string, string>
  unavailableFinalIntentIds: Set<string>
}

export interface AssistantOutboxRequiredBeforeFinalAttemptState {
  attemptCount: number
  delivery?: unknown | null
  deliveryConfirmationPending: boolean
  lastAttemptAt: string | null
  preparedDispatchToken: string | null
  sentAt: string | null
  status:
    | 'abandoned'
    | 'awaiting_approval'
    | 'failed'
    | 'pending'
    | 'retryable'
    | 'sending'
    | 'sent'
}

const ASSISTANT_OUTBOX_REQUIRED_BEFORE_FINAL_SUFFIX =
  ':required-before-final'

interface AssistantOutboxDeliveryBubbleOrder {
  kind: 'fallback' | 'generated'
  ordinal: number
  prefixKey: string
  turnId: string
}

interface AssistantOutboxDeliverySegmentOrder {
  groupKey: string
  kind: 'fallback' | 'generated'
  ordinal: number
  turnId: string
}

interface AssistantOutboxDeliverySequenceOrder {
  baseKey: string | null
  bubble: AssistantOutboxDeliveryBubbleOrder | null
  segment: AssistantOutboxDeliverySegmentOrder | null
  turnId: string
}

export function compareAssistantOutboxDeliverySequenceOrder(
  left: AssistantOutboxDeliverySequenceIntent,
  right: AssistantOutboxDeliverySequenceIntent,
): number {
  const leftOrder = readAssistantOutboxDeliverySequenceOrder(left)
  const rightOrder = readAssistantOutboxDeliverySequenceOrder(right)
  return (
    compareAssistantOutboxDeliverySegmentOrder(leftOrder, rightOrder) ||
    compareAssistantOutboxDeliveryBubbleOrder(leftOrder, rightOrder)
  )
}

export function isAssistantOutboxReplyBubbleSuccessor(
  current: AssistantOutboxDeliverySequenceIntent,
  next: AssistantOutboxDeliverySequenceIntent,
): boolean {
  const currentOrder = readAssistantOutboxDeliverySequenceOrder(current)
  const nextOrder = readAssistantOutboxDeliverySequenceOrder(next)
  const currentBubble = currentOrder.bubble
  if (!currentBubble || currentOrder.turnId !== nextOrder.turnId) {
    return false
  }
  if (nextOrder.bubble) {
    return nextOrder.bubble.prefixKey === currentBubble.prefixKey
      && nextOrder.bubble.ordinal > currentBubble.ordinal
  }
  return shouldAssistantOutboxBubblePrecedeNonBubble(currentBubble, nextOrder)
}

export function buildAssistantOutboxRequiredBeforeFinalSequenceBase(
  intent: AssistantOutboxDeliverySequenceIntent,
): string {
  const explicitBaseKey = intent.deliveryIdempotencyKey?.trim() || null
  if (explicitBaseKey?.endsWith(
    ASSISTANT_OUTBOX_REQUIRED_BEFORE_FINAL_SUFFIX,
  )) {
    return explicitBaseKey
  }
  const baseKey = explicitBaseKey ?? `assistant-turn:${intent.turnId}`
  return `${baseKey}${ASSISTANT_OUTBOX_REQUIRED_BEFORE_FINAL_SUFFIX}`
}

export function readAssistantOutboxRequiredBeforeFinalSequenceMember(
  intent: AssistantOutboxDeliverySequenceIntent,
): AssistantOutboxRequiredBeforeFinalSequenceMember | null {
  const deliveryIdempotencyKey = intent.deliveryIdempotencyKey ?? null
  if (!deliveryIdempotencyKey) {
    return null
  }
  const bubbleMatch = /^(.*):bubble:([0-9]+)$/.exec(deliveryIdempotencyKey)
  const memberKey = bubbleMatch?.[1] ?? deliveryIdempotencyKey
  const segmentMatch = /^(.*):segment:([0-9]+)$/.exec(memberKey)
  const sequenceBaseKey = segmentMatch?.[1] ?? memberKey
  if (!sequenceBaseKey.endsWith(
    ASSISTANT_OUTBOX_REQUIRED_BEFORE_FINAL_SUFFIX,
  )) {
    return null
  }
  if (!segmentMatch?.[2]) {
    return {
      kind: 'final',
      segmentOrdinal: null,
      sequenceBaseKey,
      turnId: intent.turnId,
    }
  }
  const segmentOrdinal = Number.parseInt(segmentMatch[2], 10)
  if (!Number.isSafeInteger(segmentOrdinal)) {
    return null
  }
  return {
    kind: 'predecessor',
    segmentOrdinal,
    sequenceBaseKey,
    turnId: intent.turnId,
  }
}

export function isAssistantOutboxRequiredBeforeFinalPair(
  predecessor: AssistantOutboxDeliverySequenceIntent,
  final: AssistantOutboxDeliverySequenceIntent,
): boolean {
  const predecessorMember =
    readAssistantOutboxRequiredBeforeFinalSequenceMember(predecessor)
  const finalMember =
    readAssistantOutboxRequiredBeforeFinalSequenceMember(final)
  return (
    predecessorMember?.kind === 'predecessor' &&
    finalMember?.kind === 'final' &&
    predecessorMember.turnId === finalMember.turnId &&
    predecessorMember.sequenceBaseKey === finalMember.sequenceBaseKey
  )
}

export function resolveAssistantOutboxRequiredBeforeFinalDependencies(
  intents: readonly AssistantOutboxRequiredBeforeFinalDependencyIntent[],
): AssistantOutboxRequiredBeforeFinalDependencyState {
  const blockedIntentIds = new Set<string>()
  const predecessorByFinalIntentId = new Map<string, string>()
  const unavailableFinalIntentIds = new Set<string>()
  const groups = new Map<
    string,
    AssistantOutboxRequiredBeforeFinalDependencyIntent[]
  >()

  for (const intent of intents) {
    const member =
      readAssistantOutboxRequiredBeforeFinalSequenceMember(intent)
    if (!member) {
      continue
    }
    const groupKey = JSON.stringify([
      intent.sessionId,
      member.turnId,
      member.sequenceBaseKey,
    ])
    const group = groups.get(groupKey)
    if (group) {
      group.push(intent)
    } else {
      groups.set(groupKey, [intent])
    }
  }

  for (const group of groups.values()) {
    group.sort((left, right) =>
      compareAssistantOutboxDeliverySequenceOrder(left, right) ||
      left.intentId.localeCompare(right.intentId)
    )
    const predecessors = group.filter((intent) =>
      readAssistantOutboxRequiredBeforeFinalSequenceMember(intent)?.kind ===
        'predecessor'
    )
    const finals = group.filter((intent) =>
      readAssistantOutboxRequiredBeforeFinalSequenceMember(intent)?.kind ===
        'final'
    )
    if (finals.length === 0) {
      continue
    }

    if (
      predecessors.length === 0 ||
      predecessors.some(
        assistantOutboxRequiredBeforeFinalPredecessorIsUnavailable,
      )
    ) {
      for (const intent of group) {
        if (assistantOutboxRequiredBeforeFinalIntentIsActive(intent)) {
          blockedIntentIds.add(intent.intentId)
        }
      }
      for (const final of finals) {
        if (assistantOutboxRequiredBeforeFinalIntentIsActive(final)) {
          unavailableFinalIntentIds.add(final.intentId)
        }
      }
      continue
    }

    const earliestActive =
      group.find(assistantOutboxRequiredBeforeFinalIntentIsActive) ?? null
    if (!earliestActive) {
      continue
    }
    for (const intent of group) {
      if (
        intent.intentId !== earliestActive.intentId &&
        assistantOutboxRequiredBeforeFinalIntentIsActive(intent)
      ) {
        blockedIntentIds.add(intent.intentId)
      }
    }
    if (
      readAssistantOutboxRequiredBeforeFinalSequenceMember(earliestActive)
        ?.kind === 'predecessor'
    ) {
      for (const final of finals) {
        if (assistantOutboxRequiredBeforeFinalIntentIsActive(final)) {
          predecessorByFinalIntentId.set(
            final.intentId,
            earliestActive.intentId,
          )
        }
      }
    }
  }

  return {
    blockedIntentIds,
    predecessorByFinalIntentId,
    unavailableFinalIntentIds,
  }
}

export function isAssistantOutboxRequiredBeforeFinalIntentProvenUnattempted(
  intent: AssistantOutboxRequiredBeforeFinalAttemptState,
): boolean {
  return (
    (intent.status === 'pending' || intent.status === 'retryable') &&
    intent.attemptCount === 0 &&
    intent.lastAttemptAt === null &&
    intent.sentAt === null &&
    intent.delivery == null &&
    intent.deliveryConfirmationPending === false &&
    intent.preparedDispatchToken === null
  )
}

function assistantOutboxRequiredBeforeFinalIntentIsActive(
  intent: AssistantOutboxRequiredBeforeFinalDependencyIntent,
): boolean {
  return (
    intent.status === 'awaiting_approval' ||
    intent.status === 'pending' ||
    intent.status === 'retryable' ||
    intent.status === 'sending'
  )
}

function assistantOutboxRequiredBeforeFinalPredecessorIsUnavailable(
  intent: AssistantOutboxRequiredBeforeFinalDependencyIntent,
): boolean {
  if (intent.status === 'sent') {
    return intent.delivery == null
  }
  if (intent.status === 'failed' || intent.status === 'abandoned') {
    return true
  }
  return (
    intent.status === 'retryable' &&
    !intent.deliveryTransportIdempotent &&
    intent.lastError?.code ===
      'ASSISTANT_DELIVERY_CONFIRMATION_PENDING'
  )
}

function readAssistantOutboxDeliverySequenceOrder(
  intent: AssistantOutboxDeliverySequenceIntent,
): AssistantOutboxDeliverySequenceOrder {
  const deliveryIdempotencyKey = intent.deliveryIdempotencyKey ?? null
  const bubble = readAssistantOutboxDeliveryBubbleOrder({
    deliveryIdempotencyKey,
    turnId: intent.turnId,
  })
  const baseKey = bubble?.prefixKey ?? deliveryIdempotencyKey
  return {
    baseKey,
    bubble,
    segment: readAssistantOutboxDeliverySegmentOrder({
      deliveryIdempotencyKey: baseKey,
      turnId: intent.turnId,
    }),
    turnId: intent.turnId,
  }
}

function readAssistantOutboxDeliveryBubbleOrder(input: {
  deliveryIdempotencyKey: string | null
  turnId: string
}): AssistantOutboxDeliveryBubbleOrder | null {
  if (!input.deliveryIdempotencyKey) {
    return null
  }
  const match = /^(.*):bubble:([0-9]+)$/.exec(input.deliveryIdempotencyKey)
  if (!match?.[1] || !match[2]) {
    return null
  }
  const ordinal = Number.parseInt(match[2], 10)
  if (!Number.isSafeInteger(ordinal)) {
    return null
  }
  const fallbackPrefix = `assistant-bubble:${input.turnId}:bubble:`
  const prefixKey = match[1]
  return {
    kind:
      input.deliveryIdempotencyKey.startsWith(fallbackPrefix) &&
      prefixKey === `assistant-bubble:${input.turnId}`
        ? 'fallback'
        : 'generated',
    ordinal,
    prefixKey,
    turnId: input.turnId,
  }
}

function readAssistantOutboxDeliverySegmentOrder(input: {
  deliveryIdempotencyKey: string | null
  turnId: string
}): AssistantOutboxDeliverySegmentOrder | null {
  if (!input.deliveryIdempotencyKey) {
    return null
  }
  const match = /^(.*):segment:([0-9]+)$/.exec(input.deliveryIdempotencyKey)
  if (match?.[1] && match[2]) {
    const ordinal = Number.parseInt(match[2], 10)
    return Number.isSafeInteger(ordinal)
      ? {
          groupKey: match[1],
          kind: 'generated',
          ordinal,
          turnId: input.turnId,
        }
      : null
  }
  const fallbackPrefix = `assistant-segment:${input.turnId}:`
  if (!input.deliveryIdempotencyKey.startsWith(fallbackPrefix)) {
    return null
  }
  const ordinalText = input.deliveryIdempotencyKey.slice(fallbackPrefix.length)
  if (!/^[0-9]+$/.test(ordinalText)) {
    return null
  }
  const ordinal = Number.parseInt(ordinalText, 10)
  return Number.isSafeInteger(ordinal)
    ? {
        groupKey: `assistant-segment:${input.turnId}`,
        kind: 'fallback',
        ordinal,
        turnId: input.turnId,
      }
    : null
}

function compareAssistantOutboxDeliverySegmentOrder(
  left: AssistantOutboxDeliverySequenceOrder,
  right: AssistantOutboxDeliverySequenceOrder,
): number {
  if (left.segment && right.segment && left.segment.groupKey === right.segment.groupKey) {
    return left.segment.ordinal - right.segment.ordinal
  }
  if (
    left.segment &&
    !right.segment &&
    shouldAssistantOutboxSegmentPrecedeNonSegment(left.segment, right)
  ) {
    return -1
  }
  if (
    right.segment &&
    !left.segment &&
    shouldAssistantOutboxSegmentPrecedeNonSegment(right.segment, left)
  ) {
    return 1
  }
  return 0
}

function shouldAssistantOutboxSegmentPrecedeNonSegment(
  segment: AssistantOutboxDeliverySegmentOrder,
  nonSegment: AssistantOutboxDeliverySequenceOrder,
): boolean {
  if (segment.kind === 'generated') {
    return nonSegment.baseKey === segment.groupKey
  }
  return (
    (nonSegment.baseKey === null && nonSegment.turnId === segment.turnId) ||
    nonSegment.baseKey === `assistant-bubble:${segment.turnId}`
  )
}

function compareAssistantOutboxDeliveryBubbleOrder(
  left: AssistantOutboxDeliverySequenceOrder,
  right: AssistantOutboxDeliverySequenceOrder,
): number {
  if (left.bubble && right.bubble && left.bubble.prefixKey === right.bubble.prefixKey) {
    return left.bubble.ordinal - right.bubble.ordinal
  }
  if (
    left.bubble &&
    !right.bubble &&
    shouldAssistantOutboxBubblePrecedeNonBubble(left.bubble, right)
  ) {
    return -1
  }
  if (
    right.bubble &&
    !left.bubble &&
    shouldAssistantOutboxBubblePrecedeNonBubble(right.bubble, left)
  ) {
    return 1
  }
  return 0
}

function shouldAssistantOutboxBubblePrecedeNonBubble(
  bubble: AssistantOutboxDeliveryBubbleOrder,
  nonBubble: AssistantOutboxDeliverySequenceOrder,
): boolean {
  if (bubble.kind === 'generated') {
    return nonBubble.baseKey === bubble.prefixKey
  }
  return nonBubble.baseKey === null && nonBubble.turnId === bubble.turnId
}

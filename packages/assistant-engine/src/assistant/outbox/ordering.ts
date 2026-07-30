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
  requiredBeforeFinalPredecessorIntentId?: string | null
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
  unavailableIntentIds: Set<string>
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

export function resolveAssistantOutboxRequiredBeforeFinalDependencies(
  intents: readonly AssistantOutboxRequiredBeforeFinalDependencyIntent[],
): AssistantOutboxRequiredBeforeFinalDependencyState {
  const blockedIntentIds = new Set<string>()
  const predecessorByFinalIntentId = new Map<string, string>()
  const unavailableIntentIds = new Set<string>()
  const intentById = new Map<
    string,
    AssistantOutboxRequiredBeforeFinalDependencyIntent
  >()
  const duplicateIntentIds = new Set<string>()
  for (const intent of intents) {
    if (intentById.has(intent.intentId)) {
      duplicateIntentIds.add(intent.intentId)
      continue
    }
    intentById.set(intent.intentId, intent)
  }
  const groups = new Map<
    string,
    AssistantOutboxRequiredBeforeFinalDependencyIntent[]
  >()

  for (const intent of intents) {
    const member =
      readAssistantOutboxRequiredBeforeFinalSequenceMember(intent)
    if (
      !member &&
      intent.requiredBeforeFinalPredecessorIntentId === undefined
    ) {
      continue
    }
    const groupKey = JSON.stringify([
      intent.sessionId,
      member?.sequenceBaseKey ??
        `explicit-root:${intent.intentId}`,
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
    const hasExplicitPrerequisite = group.some(
      (intent) =>
        intent.requiredBeforeFinalPredecessorIntentId !== undefined,
    )
    if (hasExplicitPrerequisite) {
      resolveAssistantOutboxExplicitRequiredDependencies({
        blockedIntentIds,
        group,
        duplicateIntentIds,
        intentById,
        predecessorByFinalIntentId,
        unavailableIntentIds,
      })
      continue
    }
    markAssistantOutboxRequiredGroupUnavailable({
      blockedIntentIds,
      group,
      unavailableIntentIds,
    })
  }

  return {
    blockedIntentIds,
    predecessorByFinalIntentId,
    unavailableIntentIds,
  }
}

function resolveAssistantOutboxExplicitRequiredDependencies(input: {
  blockedIntentIds: Set<string>
  duplicateIntentIds: ReadonlySet<string>
  group: readonly AssistantOutboxRequiredBeforeFinalDependencyIntent[]
  intentById: ReadonlyMap<
    string,
    AssistantOutboxRequiredBeforeFinalDependencyIntent
  >
  predecessorByFinalIntentId: Map<string, string>
  unavailableIntentIds: Set<string>
}): void {
  const groupIntentIds = new Set(
    input.group.map((intent) => intent.intentId),
  )
  const successorByIntentId = new Map<string, string>()
  const roots: AssistantOutboxRequiredBeforeFinalDependencyIntent[] = []
  let invalid = false

  if (
    input.group.some((intent) =>
      input.duplicateIntentIds.has(intent.intentId) ||
      readAssistantOutboxRequiredBeforeFinalSequenceMember(intent) === null
    )
  ) {
    invalid = true
  }

  for (const intent of input.group) {
    const predecessorIntentId =
      intent.requiredBeforeFinalPredecessorIntentId
    if (predecessorIntentId === undefined) {
      invalid = true
      continue
    }
    if (predecessorIntentId === null) {
      roots.push(intent)
      if (
        readAssistantOutboxRequiredBeforeFinalSequenceMember(intent)?.kind ===
          'final'
      ) {
        invalid = true
      }
      continue
    }
    const predecessor = input.intentById.get(predecessorIntentId)
    if (
      !predecessor ||
      predecessor.intentId === intent.intentId ||
      predecessor.sessionId !== intent.sessionId ||
      !groupIntentIds.has(predecessor.intentId) ||
      !assistantOutboxExplicitRequiredMembersAreCompatible(
        predecessor,
        intent,
      )
    ) {
      invalid = true
      continue
    }
    if (successorByIntentId.has(predecessor.intentId)) {
      invalid = true
    } else {
      successorByIntentId.set(predecessor.intentId, intent.intentId)
    }
  }

  if (
    roots.length !== 1 ||
    (
      roots.length === 1 &&
      !assistantOutboxExplicitRequiredChainVisitsEveryIntent({
        groupIntentIds,
        rootIntentId: roots[0]!.intentId,
        successorByIntentId,
      })
    ) ||
    input.group.some(
      assistantOutboxRequiredBeforeFinalPredecessorIsUnavailable,
    )
  ) {
    invalid = true
  }

  if (invalid) {
    markAssistantOutboxRequiredGroupUnavailable({
      blockedIntentIds: input.blockedIntentIds,
      group: input.group,
      unavailableIntentIds: input.unavailableIntentIds,
    })
    return
  }

  const active = input.group.filter(
    assistantOutboxRequiredBeforeFinalIntentIsActive,
  )
  const ready =
    active.find((intent) =>
      assistantOutboxExplicitRequiredIntentIsReady(
        intent,
        input.intentById,
      )
    ) ?? null
  for (const intent of active) {
    if (intent.intentId !== ready?.intentId) {
      input.blockedIntentIds.add(intent.intentId)
    }
  }

  if (ready) {
    for (const final of input.group) {
      if (
        final.intentId !== ready.intentId &&
        assistantOutboxRequiredBeforeFinalIntentIsActive(final) &&
        readAssistantOutboxRequiredBeforeFinalSequenceMember(final)?.kind ===
          'final'
      ) {
        input.predecessorByFinalIntentId.set(
          final.intentId,
          ready.intentId,
        )
      }
    }
  }
}

function assistantOutboxExplicitRequiredChainVisitsEveryIntent(input: {
  groupIntentIds: ReadonlySet<string>
  rootIntentId: string
  successorByIntentId: ReadonlyMap<string, string>
}): boolean {
  const visited = new Set<string>()
  let currentIntentId: string | undefined = input.rootIntentId
  while (currentIntentId && !visited.has(currentIntentId)) {
    visited.add(currentIntentId)
    currentIntentId = input.successorByIntentId.get(currentIntentId)
  }
  return (
    visited.size === input.groupIntentIds.size &&
    [...visited].every((intentId) => input.groupIntentIds.has(intentId))
  )
}

function assistantOutboxExplicitRequiredMembersAreCompatible(
  predecessor: AssistantOutboxRequiredBeforeFinalDependencyIntent,
  successor: AssistantOutboxRequiredBeforeFinalDependencyIntent,
): boolean {
  const predecessorMember =
    readAssistantOutboxRequiredBeforeFinalSequenceMember(predecessor)
  const successorMember =
    readAssistantOutboxRequiredBeforeFinalSequenceMember(successor)
  if (!predecessorMember || !successorMember) {
    return false
  }
  return (
    predecessorMember.sequenceBaseKey === successorMember.sequenceBaseKey &&
    compareAssistantOutboxDeliverySequenceOrder(
      predecessor,
      successor,
    ) < 0
  )
}

function assistantOutboxExplicitRequiredIntentIsReady(
  intent: AssistantOutboxRequiredBeforeFinalDependencyIntent,
  intentById: ReadonlyMap<
    string,
    AssistantOutboxRequiredBeforeFinalDependencyIntent
  >,
): boolean {
  const predecessorIntentId =
    intent.requiredBeforeFinalPredecessorIntentId
  if (predecessorIntentId === null) {
    return true
  }
  if (predecessorIntentId === undefined) {
    return false
  }
  const predecessor = intentById.get(predecessorIntentId)
  return predecessor?.status === 'sent' && predecessor.delivery != null
}

function markAssistantOutboxRequiredGroupUnavailable(input: {
  blockedIntentIds: Set<string>
  group: readonly AssistantOutboxRequiredBeforeFinalDependencyIntent[]
  unavailableIntentIds: Set<string>
}): void {
  for (const intent of input.group) {
    if (!assistantOutboxRequiredBeforeFinalIntentIsActive(intent)) {
      continue
    }
    input.blockedIntentIds.add(intent.intentId)
    input.unavailableIntentIds.add(intent.intentId)
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

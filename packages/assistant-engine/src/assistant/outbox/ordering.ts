export interface AssistantOutboxDeliverySequenceIntent {
  deliveryIdempotencyKey?: string | null
  turnId: string
}

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

import { describe, expect, it } from 'vitest'

import {
  buildAssistantOutboxRequiredBeforeFinalSequenceBase,
  compareAssistantOutboxDeliverySequenceOrder,
  isAssistantOutboxRequiredBeforeFinalPair,
  isAssistantOutboxReplyBubbleSuccessor,
  readAssistantOutboxRequiredBeforeFinalSequenceMember,
} from '../src/assistant/outbox/ordering.ts'

describe('assistant outbox required-before-final ordering', () => {
  it('builds a marked base from an explicit key and preserves an existing mark', () => {
    const marked = buildAssistantOutboxRequiredBeforeFinalSequenceBase({
      deliveryIdempotencyKey: 'delivery-final',
      turnId: 'turn-explicit',
    })

    expect(marked).toBe('delivery-final:required-before-final')
    expect(buildAssistantOutboxRequiredBeforeFinalSequenceBase({
      deliveryIdempotencyKey: marked,
      turnId: 'turn-explicit',
    })).toBe(marked)
  })

  it('builds a deterministic marked base when no explicit key exists', () => {
    expect(buildAssistantOutboxRequiredBeforeFinalSequenceBase({
      deliveryIdempotencyKey: null,
      turnId: 'turn-fallback',
    })).toBe('assistant-turn:turn-fallback:required-before-final')
  })

  it('reads and recognizes a marked predecessor/final pair through bubble keys', () => {
    const predecessor = {
      deliveryIdempotencyKey:
        'delivery-final:required-before-final:segment:2:bubble:0',
      turnId: 'turn-pair',
    }
    const final = {
      deliveryIdempotencyKey:
        'delivery-final:required-before-final:bubble:1',
      turnId: 'turn-pair',
    }

    expect(readAssistantOutboxRequiredBeforeFinalSequenceMember(
      predecessor,
    )).toEqual({
      kind: 'predecessor',
      segmentOrdinal: 2,
      sequenceBaseKey: 'delivery-final:required-before-final',
      turnId: 'turn-pair',
    })
    expect(readAssistantOutboxRequiredBeforeFinalSequenceMember(final))
      .toEqual({
        kind: 'final',
        segmentOrdinal: null,
        sequenceBaseKey: 'delivery-final:required-before-final',
        turnId: 'turn-pair',
      })
    expect(isAssistantOutboxRequiredBeforeFinalPair(
      predecessor,
      final,
    )).toBe(true)
    expect(compareAssistantOutboxDeliverySequenceOrder(
      predecessor,
      final,
    )).toBeLessThan(0)
  })

  it.each([
    {
      final: 'delivery-final:required-before-final',
      predecessor: 'other-delivery:required-before-final:segment:0',
      predecessorTurnId: 'turn-one',
    },
    {
      final: 'delivery-final:required-before-final',
      predecessor: 'delivery-final:required-before-final:segment:0',
      predecessorTurnId: 'turn-two',
    },
    {
      final: 'delivery-final',
      predecessor: 'delivery-final:segment:0',
      predecessorTurnId: 'turn-one',
    },
  ])(
    'rejects an unrelated required pair $predecessor -> $final',
    ({ final, predecessor, predecessorTurnId }) => {
      expect(isAssistantOutboxRequiredBeforeFinalPair(
        {
          deliveryIdempotencyKey: predecessor,
          turnId: predecessorTurnId,
        },
        {
          deliveryIdempotencyKey: final,
          turnId: 'turn-one',
        },
      )).toBe(false)
    },
  )
})

describe('assistant outbox reply bubble ordering', () => {
  it.each([
    {
      current: 'delivery-final:bubble:0',
      next: 'delivery-final:bubble:1',
      turnId: 'turn-generated',
    },
    {
      current: 'delivery-final:bubble:1',
      next: 'delivery-final',
      turnId: 'turn-generated',
    },
    {
      current: 'delivery-final:segment:0:bubble:0',
      next: 'delivery-final:segment:0',
      turnId: 'turn-segment',
    },
    {
      current: 'assistant-bubble:turn-fallback:bubble:0',
      next: 'assistant-bubble:turn-fallback:bubble:2',
      turnId: 'turn-fallback',
    },
  ])('recognizes $current followed by $next', ({ current, next, turnId }) => {
    expect(isAssistantOutboxReplyBubbleSuccessor(
      { deliveryIdempotencyKey: current, turnId },
      { deliveryIdempotencyKey: next, turnId },
    )).toBe(true)
  })

  it('recognizes the keyless final fallback bubble before dispatch assigns a key', () => {
    expect(isAssistantOutboxReplyBubbleSuccessor(
      {
        deliveryIdempotencyKey: 'assistant-bubble:turn-fallback:bubble:0',
        turnId: 'turn-fallback',
      },
      { deliveryIdempotencyKey: null, turnId: 'turn-fallback' },
    )).toBe(true)
  })

  it.each([
    {
      current: 'delivery-final',
      currentTurnId: 'turn-one',
      next: 'delivery-final:bubble:0',
      nextTurnId: 'turn-one',
    },
    {
      current: 'delivery-final:bubble:1',
      currentTurnId: 'turn-one',
      next: 'delivery-final:bubble:0',
      nextTurnId: 'turn-one',
    },
    {
      current: 'delivery-final:bubble:0',
      currentTurnId: 'turn-one',
      next: 'other-delivery:bubble:1',
      nextTurnId: 'turn-one',
    },
    {
      current: 'delivery-final:bubble:0',
      currentTurnId: 'turn-one',
      next: 'delivery-final',
      nextTurnId: 'turn-two',
    },
  ])(
    'rejects unrelated transition $current -> $next',
    ({ current, currentTurnId, next, nextTurnId }) => {
      expect(isAssistantOutboxReplyBubbleSuccessor(
        { deliveryIdempotencyKey: current, turnId: currentTurnId },
        { deliveryIdempotencyKey: next, turnId: nextTurnId },
      )).toBe(false)
    },
  )
})

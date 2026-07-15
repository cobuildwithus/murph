import { describe, expect, it } from 'vitest'

import {
  isAssistantOutboxReplyBubbleSuccessor,
} from '../src/assistant/outbox/ordering.ts'

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

import { describe, expect, it } from 'vitest'

import {
  buildAssistantOutboxRequiredBeforeFinalSequenceBase,
  compareAssistantOutboxDeliverySequenceOrder,
  isAssistantOutboxReplyBubbleSuccessor,
  readAssistantOutboxRequiredBeforeFinalSequenceMember,
  resolveAssistantOutboxRequiredBeforeFinalDependencies,
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
    expect(compareAssistantOutboxDeliverySequenceOrder(
      predecessor,
      final,
    )).toBeLessThan(0)
  })

  it('orders required predecessors before the final intent exists', () => {
    const createPredecessor = (input: {
      delivery?: unknown
      intentId: string
      predecessorIntentId: string | null
      segmentOrdinal: number
      status: 'failed' | 'pending' | 'sent'
    }) => ({
      delivery: input.delivery ?? null,
      deliveryIdempotencyKey:
        `delivery-final:required-before-final:segment:${input.segmentOrdinal}`,
      deliveryTransportIdempotent: true,
      intentId: input.intentId,
      requiredBeforeFinalPredecessorIntentId:
        input.predecessorIntentId,
      sessionId: 'session-predecessor-only',
      status: input.status,
      turnId: 'turn-predecessor-only',
    })
    const firstPending = createPredecessor({
      intentId: 'intent-predecessor-0',
      predecessorIntentId: null,
      segmentOrdinal: 0,
      status: 'pending',
    })
    const secondPending = createPredecessor({
      intentId: 'intent-predecessor-1',
      predecessorIntentId: firstPending.intentId,
      segmentOrdinal: 1,
      status: 'pending',
    })

    const bothPending =
      resolveAssistantOutboxRequiredBeforeFinalDependencies([
        firstPending,
        secondPending,
      ])
    expect([...bothPending.blockedIntentIds]).toEqual([
      secondPending.intentId,
    ])
    expect(bothPending.predecessorByFinalIntentId.size).toBe(0)
    expect(bothPending.unavailableIntentIds.size).toBe(0)

    const firstSent =
      resolveAssistantOutboxRequiredBeforeFinalDependencies([
        {
          ...firstPending,
          delivery: { providerMessageId: 'provider-predecessor-0' },
          status: 'sent',
        },
        secondPending,
      ])
    expect(firstSent.blockedIntentIds.size).toBe(0)

    const firstFailed =
      resolveAssistantOutboxRequiredBeforeFinalDependencies([
        {
          ...firstPending,
          status: 'failed',
        },
        secondPending,
      ])
    expect([...firstFailed.blockedIntentIds]).toEqual([
      secondPending.intentId,
    ])
    expect([...firstFailed.unavailableIntentIds]).toEqual([
      secondPending.intentId,
    ])
  })

  it('keeps a deduplicated predecessor paired with a final from a retry turn', () => {
    const sequenceBaseKey =
      'delivery-retry:required-before-final'
    const predecessor = {
      delivery: null,
      deliveryIdempotencyKey: `${sequenceBaseKey}:segment:0`,
      deliveryTransportIdempotent: true,
      intentId: 'intent-retry-predecessor',
      requiredBeforeFinalPredecessorIntentId: null,
      sessionId: 'session-retry-sequence',
      status: 'pending' as const,
      turnId: 'turn-first-attempt',
    }
    const final = {
      delivery: null,
      deliveryIdempotencyKey: sequenceBaseKey,
      deliveryTransportIdempotent: true,
      intentId: 'intent-retry-final',
      requiredBeforeFinalPredecessorIntentId:
        'intent-retry-predecessor',
      sessionId: 'session-retry-sequence',
      status: 'pending' as const,
      turnId: 'turn-second-attempt',
    }

    const dependencies =
      resolveAssistantOutboxRequiredBeforeFinalDependencies([
        final,
        predecessor,
      ])

    expect([...dependencies.blockedIntentIds]).toEqual([final.intentId])
    expect(dependencies.predecessorByFinalIntentId.get(final.intentId))
      .toBe(predecessor.intentId)
    expect(dependencies.unavailableIntentIds.size).toBe(0)
  })

  it('follows the exact persisted predecessor chain one member at a time', () => {
    const sequenceBaseKey =
      'delivery-exact:required-before-final'
    const root = {
      delivery: null,
      deliveryIdempotencyKey: `${sequenceBaseKey}:segment:0`,
      deliveryTransportIdempotent: true,
      intentId: 'intent-exact-root',
      requiredBeforeFinalPredecessorIntentId: null,
      sessionId: 'session-exact',
      status: 'pending' as const,
      turnId: 'turn-exact',
    }
    const middle = {
      ...root,
      deliveryIdempotencyKey: `${sequenceBaseKey}:segment:1`,
      intentId: 'intent-exact-middle',
      requiredBeforeFinalPredecessorIntentId: root.intentId,
    }
    const final = {
      ...root,
      deliveryIdempotencyKey: sequenceBaseKey,
      intentId: 'intent-exact-final',
      requiredBeforeFinalPredecessorIntentId: middle.intentId,
    }

    const pending =
      resolveAssistantOutboxRequiredBeforeFinalDependencies([
        final,
        middle,
        root,
      ])
    expect([...pending.blockedIntentIds].sort()).toEqual([
      final.intentId,
      middle.intentId,
    ])
    expect(pending.predecessorByFinalIntentId.get(final.intentId))
      .toBe(root.intentId)

    const rootSent =
      resolveAssistantOutboxRequiredBeforeFinalDependencies([
        final,
        middle,
        {
          ...root,
          delivery: { providerMessageId: 'provider-exact-root' },
          status: 'sent',
        },
      ])
    expect([...rootSent.blockedIntentIds]).toEqual([final.intentId])
    expect(rootSent.predecessorByFinalIntentId.get(final.intentId))
      .toBe(middle.intentId)
    expect(rootSent.unavailableIntentIds.size).toBe(0)
  })

  it.each([
    {
      label: 'missing',
      predecessorIntentId: 'intent-missing',
      extraIntents: [],
    },
    {
      label: 'wrong-session',
      predecessorIntentId: 'intent-foreign-session',
      extraIntents: [{
        delivery: null,
        deliveryIdempotencyKey:
          'delivery-exact-invalid:required-before-final:segment:9',
        deliveryTransportIdempotent: true,
        intentId: 'intent-foreign-session',
        requiredBeforeFinalPredecessorIntentId: null,
        sessionId: 'session-foreign',
        status: 'pending' as const,
        turnId: 'turn-exact-invalid',
      }],
    },
    {
      label: 'wrong-sequence',
      predecessorIntentId: 'intent-foreign-sequence',
      extraIntents: [{
        delivery: null,
        deliveryIdempotencyKey:
          'delivery-other:required-before-final:segment:0',
        deliveryTransportIdempotent: true,
        intentId: 'intent-foreign-sequence',
        requiredBeforeFinalPredecessorIntentId: null,
        sessionId: 'session-exact-invalid',
        status: 'pending' as const,
        turnId: 'turn-exact-invalid',
      }],
    },
  ])('fails the whole active group for a $label direct predecessor', ({
    extraIntents,
    predecessorIntentId,
  }) => {
    const sequenceBaseKey =
      'delivery-exact-invalid:required-before-final'
    const root = {
      delivery: null,
      deliveryIdempotencyKey: `${sequenceBaseKey}:segment:0`,
      deliveryTransportIdempotent: true,
      intentId: 'intent-exact-invalid-root',
      requiredBeforeFinalPredecessorIntentId: null,
      sessionId: 'session-exact-invalid',
      status: 'pending' as const,
      turnId: 'turn-exact-invalid',
    }
    const successor = {
      ...root,
      deliveryIdempotencyKey: sequenceBaseKey,
      intentId: 'intent-exact-invalid-final',
      requiredBeforeFinalPredecessorIntentId: predecessorIntentId,
    }

    const dependencies =
      resolveAssistantOutboxRequiredBeforeFinalDependencies([
        root,
        successor,
        ...extraIntents,
      ])
    expect([...dependencies.unavailableIntentIds].sort()).toEqual([
      root.intentId,
      successor.intentId,
    ].sort())
    expect([...dependencies.blockedIntentIds].sort()).toEqual([
      root.intentId,
      successor.intentId,
    ].sort())
  })

  it('fails closed for a predecessor-only confirmation-pending root', () => {
    const root = {
      delivery: null,
      deliveryIdempotencyKey:
        'delivery-confirmation:required-before-final:segment:0',
      deliveryTransportIdempotent: false,
      intentId: 'intent-confirmation-root',
      lastError: {
        code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
      },
      requiredBeforeFinalPredecessorIntentId: null,
      sessionId: 'session-confirmation-root',
      status: 'retryable' as const,
      turnId: 'turn-confirmation-root',
    }

    const dependencies =
      resolveAssistantOutboxRequiredBeforeFinalDependencies([root])
    expect([...dependencies.blockedIntentIds]).toEqual([root.intentId])
    expect([...dependencies.unavailableIntentIds]).toEqual([root.intentId])
  })

  it('rejects an explicit-null final as a sequence root', () => {
    const final = {
      delivery: null,
      deliveryIdempotencyKey:
        'delivery-final-root:required-before-final',
      deliveryTransportIdempotent: true,
      intentId: 'intent-final-root',
      requiredBeforeFinalPredecessorIntentId: null,
      sessionId: 'session-final-root',
      status: 'pending' as const,
      turnId: 'turn-final-root',
    }

    const dependencies =
      resolveAssistantOutboxRequiredBeforeFinalDependencies([final])
    expect([...dependencies.unavailableIntentIds]).toEqual([final.intentId])
  })
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

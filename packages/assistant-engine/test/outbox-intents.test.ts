import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildAssistantOutboxPersistedTarget,
  buildAssistantOutboxRawTargetIdentity,
  hashAssistantOutboxIdentity,
  hashAssistantOutboxLegacyMediaDedupeIdentity,
  hashAssistantOutboxTargetFingerprint,
  resolveAssistantOutboxIntentPath,
  resolveAssistantOutboxQuarantineDirectory,
} from '../src/assistant/outbox/intents.ts'


const NUTRITION_CARD = {
  kind: 'daily_nutrition',
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1_490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
  },
} as const

describe('assistant outbox intent helpers', () => {
  it('normalizes persisted target fields while keeping delivery bindings intact', () => {
    expect(
      buildAssistantOutboxPersistedTarget({
        channel: ' telegram ',
        identityId: ' user-1 ',
        actorId: '   ',
        threadId: ' thread-1 ',
        threadIsDirect: true,
        replyToMessageId: '   ',
        explicitTarget: ' @murph ',
        bindingDelivery: {
          kind: 'thread',
          target: 'chat-123',
        },
      }),
    ).toEqual({
      channel: 'telegram',
      identityId: 'user-1',
      actorId: null,
      threadId: 'thread-1',
      threadIsDirect: true,
      replyToMessageId: null,
      explicitTarget: '@murph',
      bindingDelivery: {
        kind: 'thread',
        target: 'chat-123',
      },
      deliverySource: null,
    })

    expect(
      buildAssistantOutboxPersistedTarget({
        threadIsDirect: undefined,
      }).threadIsDirect,
    ).toBeNull()

    expect(
      buildAssistantOutboxPersistedTarget({
        bindingDelivery: null,
        channel: 'telegram',
        nativeReplyRequested: true,
        replyToMessageId: '42',
        threadId: 'thread-1',
      }),
    ).toMatchObject({
      bindingDelivery: null,
      nativeReplyRequested: true,
      replyToMessageId: '42',
    })

    expect(
      buildAssistantOutboxPersistedTarget({
        channel: 'telegram',
        threadId: 'thread-1',
      }).bindingDelivery,
    ).toEqual({
      kind: 'thread',
      target: 'thread-1',
    })
  })

  it('uses a normalized dedupe token as the entire identity hash when present', () => {
    const first = hashAssistantOutboxIdentity({
      dedupeToken: ' same-token ',
      message: 'first message',
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/media/first.png',
          alt: null,
          source: null,
        },
      ],
      subject: null,
      sessionId: 'session-a',
      turnId: 'turn-a',
      channel: 'telegram',
      identityId: 'user-a',
    })
    const second = hashAssistantOutboxIdentity({
      dedupeToken: 'same-token',
      message: 'second message',
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/media/retry.png',
          alt: null,
          source: null,
        },
      ],
      subject: null,
      sessionId: 'session-b',
      turnId: 'turn-b',
      explicitTarget: 'another-target',
    })

    expect(first).toBe(second)

    const fallbackA = hashAssistantOutboxIdentity({
      dedupeToken: '   ',
      message: 'first message',
      media: [],
      subject: null,
      sessionId: 'session-a',
      turnId: 'turn-a',
      channel: 'telegram',
      identityId: 'user-a',
    })
    const fallbackB = hashAssistantOutboxIdentity({
      dedupeToken: '',
      message: 'second message',
      media: [],
      subject: null,
      sessionId: 'session-a',
      turnId: 'turn-a',
      channel: 'telegram',
      identityId: 'user-a',
    })

    expect(fallbackA).not.toBe(fallbackB)
  })

  it('preserves the legacy ordinary-message identity when card is null', () => {
    const base = {
      media: [],
      message: 'ordinary message',
      sessionId: 'session-legacy-card-null',
      subject: null,
      turnId: 'turn-legacy-card-null',
    }

    expect(hashAssistantOutboxIdentity(base)).toBe(
      hashAssistantOutboxIdentity({
        ...base,
        card: null,
      }),
    )
  })

  it('includes cards in content identity while explicit tokens freeze one delivery', () => {
    const changedCard = {
      ...NUTRITION_CARD,
      totals: {
        ...NUTRITION_CARD.totals,
        calories: {
          ...NUTRITION_CARD.totals.calories,
          total: 1_491.25,
        },
      },
    } as const
    const base = {
      media: [],
      message: 'same deterministic message',
      sessionId: 'session-card',
      subject: null,
      turnId: 'turn-card',
    }

    expect(hashAssistantOutboxIdentity({
      ...base,
      card: NUTRITION_CARD,
    })).not.toBe(hashAssistantOutboxIdentity({
      ...base,
      card: changedCard,
    }))

    const legacyTokenIdentity = hashAssistantOutboxIdentity({
      ...base,
      card: null,
      dedupeToken: 'meal-closeout-token',
    })
    const firstCardIdentity = hashAssistantOutboxIdentity({
      ...base,
      card: NUTRITION_CARD,
      dedupeToken: 'meal-closeout-token',
    })
    const changedCardIdentity = hashAssistantOutboxIdentity({
      ...base,
      card: changedCard,
      dedupeToken: 'meal-closeout-token',
    })

    expect(firstCardIdentity).toBe(legacyTokenIdentity)
    expect(changedCardIdentity).toBe(firstCardIdentity)
    expect(hashAssistantOutboxLegacyMediaDedupeIdentity({
      dedupeToken: 'meal-closeout-token',
      media: [],
    })).not.toBeNull()
  })

  it('includes native reply intent in non-token identity while preserving legacy absence', () => {
    const base = {
      channel: 'linq',
      dedupeToken: null,
      identityId: 'user-a',
      media: [],
      message: 'reply message',
      replyToMessageId: 'linq-message-a',
      sessionId: 'session-a',
      subject: null,
      threadId: 'linq-thread-a',
      turnId: 'turn-a',
    }

    const legacyIdentity = hashAssistantOutboxIdentity(base)
    expect(hashAssistantOutboxIdentity({ ...base })).toBe(legacyIdentity)
    expect(hashAssistantOutboxIdentity({
      ...base,
      nativeReplyRequested: true,
    })).not.toBe(legacyIdentity)
  })

  it('hashes target fingerprints from the extracted raw delivery identity', () => {
    const rawTarget = buildAssistantOutboxRawTargetIdentity({
      channel: 'telegram',
      identityId: 'user-1',
      actorId: 'actor-1',
      threadId: 'thread-1',
      replyToMessageId: 'reply-1',
      explicitTarget: '@murph',
      bindingDelivery: {
        kind: 'thread',
        target: 'chat-123',
      },
    })

    const sameFingerprint = hashAssistantOutboxTargetFingerprint(
      buildAssistantOutboxRawTargetIdentity({
        ...rawTarget,
      }),
    )
    const changedFingerprint = hashAssistantOutboxTargetFingerprint({
      ...rawTarget,
      replyToMessageId: 'reply-2',
    })
    const markedFingerprint = hashAssistantOutboxTargetFingerprint({
      ...rawTarget,
      nativeReplyRequested: true,
    })

    expect(hashAssistantOutboxTargetFingerprint(rawTarget)).toBe(sameFingerprint)
    expect(hashAssistantOutboxTargetFingerprint(rawTarget)).not.toBe(changedFingerprint)
    expect(hashAssistantOutboxTargetFingerprint(rawTarget)).not.toBe(markedFingerprint)
  })

  it('keeps outbox intent files inside the expected directory and exposes quarantine storage', () => {
    const outboxDirectory = path.join('/tmp', 'murph-assistant-outbox')

    expect(resolveAssistantOutboxIntentPath(outboxDirectory, 'intent_123')).toBe(
      path.resolve(outboxDirectory, 'intent_123.json'),
    )
    expect(resolveAssistantOutboxQuarantineDirectory(outboxDirectory)).toBe(
      path.join(outboxDirectory, '.quarantine'),
    )
    expect(() =>
      resolveAssistantOutboxIntentPath(outboxDirectory, '../intent_123'),
    ).toThrowError(/opaque runtime ids/u)
  })
})

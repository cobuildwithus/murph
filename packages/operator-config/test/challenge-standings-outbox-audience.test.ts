import { describe, expect, it } from 'vitest'

import { assistantOutboxIntentSchema } from '../src/assistant-cli-contracts.ts'

const CHALLENGE_CARD = {
  kind: 'challenge_standings',
  version: 1,
  format: 'individual',
  title: 'Weird Health Week',
  subtitle: null,
  objective: { kind: 'ranking' },
  entries: [{
    label: 'Maya',
    points: 120,
    coverage: 'complete',
    detail: null,
  }],
  footer: null,
} as const

const baseIntent = {
  schema: 'murph.assistant-outbox-intent.v1',
  intentId: 'outbox_challenge_card',
  sessionId: 'session_challenge_card',
  turnId: 'turn_challenge_card',
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
  lastAttemptAt: null,
  nextAttemptAt: null,
  sentAt: null,
  attemptCount: 0,
  status: 'pending',
  message: 'challenge standings',
  media: [],
  operation: null,
  subject: null,
  dedupeKey: 'dedupe-challenge-card',
  targetFingerprint: 'target-challenge-card',
  channel: 'linq',
  identityId: null,
  actorId: null,
  answeredMailboxItemIds: [],
  threadId: 'linq-group-challenge-card',
  threadIsDirect: false,
  replyToMessageId: null,
  bindingDelivery: {
    kind: 'thread',
    target: 'linq-group-challenge-card',
  },
  deliverySource: null,
  explicitTarget: null,
  delivery: null,
  deliveryConfirmationPending: false,
  deliveryIdempotencyKey: null,
  deliveryTransportIdempotent: false,
  preparedDispatchToken: null,
  lastError: null,
} as const

describe('challenge standings outbox audience', () => {
  it('admits only a Linq group destination', () => {
    expect(assistantOutboxIntentSchema.parse({
      ...baseIntent,
      card: CHALLENGE_CARD,
    }).card).toEqual(CHALLENGE_CARD)

    expect(() => assistantOutboxIntentSchema.parse({
      ...baseIntent,
      card: CHALLENGE_CARD,
      threadIsDirect: true,
    })).toThrow(
      'Challenge standings response cards require an authenticated Linq group conversation.',
    )
    expect(() => assistantOutboxIntentSchema.parse({
      ...baseIntent,
      card: CHALLENGE_CARD,
      channel: 'telegram',
    })).toThrow(
      'Challenge standings response cards require an authenticated Linq group conversation.',
    )
    expect(() => assistantOutboxIntentSchema.parse({
      ...baseIntent,
      card: CHALLENGE_CARD,
      threadIsDirect: null,
    })).toThrow(
      'Challenge standings response cards require an authenticated Linq group conversation.',
    )
  })
})

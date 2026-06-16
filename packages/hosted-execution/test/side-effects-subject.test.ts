import { describe, expect, it } from 'vitest'

import {
  buildHostedAssistantDeliveryEffect,
  parseHostedAssistantDeliveryEffects,
} from '../src/side-effects.js'

describe('hosted assistant delivery side effects subject support', () => {
  it('round-trips an explicit subject through the side-effect codec', () => {
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: 'dedupe_123',
      effectId: 'effect_123',
      payload: {
        actorId: null,
        bindingDeliveryKind: null,
        bindingDeliveryTarget: null,
        channel: 'email',
        deliverySourceKey: null,
	        explicitTarget: 'user@example.com',
	        idempotencyKey: 'idempotency_123',
	        identityId: 'assistant@example.com',
	        media: [],
	        message: 'Hello from Murph',
        subject: 'Daily check-in',
        replyToMessageId: null,
        sessionId: 'session_123',
        threadId: null,
        threadIsDirect: null,
        transportIdempotent: false,
        turnId: 'turn_123',
      },
    })

    expect(parseHostedAssistantDeliveryEffects([effect])).toEqual([effect])
  })

  it('treats a missing subject as null for greenfield payload parsing', () => {
    const effect = parseHostedAssistantDeliveryEffects([
      {
        effectId: 'effect_123',
        fingerprint: 'dedupe_123',
        kind: 'assistant.delivery',
        payload: {
          actorId: null,
          bindingDeliveryKind: null,
          bindingDeliveryTarget: null,
          channel: 'email',
          explicitTarget: 'user@example.com',
          idempotencyKey: 'idempotency_123',
          identityId: 'assistant@example.com',
          message: 'Hello from Murph',
          replyToMessageId: null,
          sessionId: 'session_123',
          threadId: null,
          threadIsDirect: null,
          transportIdempotent: false,
          turnId: 'turn_123',
        },
      },
    ])[0]

    expect(effect?.deliveryPhase).toBe('background_retry')
    expect(effect?.payload.subject).toBeNull()
  })
})

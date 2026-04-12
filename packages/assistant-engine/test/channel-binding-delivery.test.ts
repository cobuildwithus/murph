import { describe, expect, it } from 'vitest'

import {
  inferFallbackBindingDelivery,
  inferThreadFirstBindingDelivery,
  resolveExplicitBindingDelivery,
} from '../src/assistant/channels/helpers.js'

describe('assistant channel binding delivery helpers', () => {
  it('parses explicit binding delivery through the shared gateway route helpers', () => {
    expect(
      resolveExplicitBindingDelivery({
        deliveryKind: 'participant',
        deliveryTarget: ' contact:alex ',
      }),
    ).toEqual({
      kind: 'participant',
      target: 'contact:alex',
    })
  })

  it('keeps thread-first channels bound to the conversation thread', () => {
    expect(
      inferThreadFirstBindingDelivery(
        {
          conversation: {
            participantId: 'contact:alex',
            threadId: 'thread-42',
          },
        },
        {
          includeParticipant: true,
        },
      ),
    ).toEqual({
      kind: 'thread',
      target: 'thread-42',
    })
  })

  it('keeps fallback bindings actor-first for direct conversations', () => {
    expect(
      inferFallbackBindingDelivery({
        conversation: {
          directness: 'direct',
          participantId: 'contact:alex',
          threadId: 'thread-42',
        },
      }),
    ).toEqual({
      kind: 'participant',
      target: 'contact:alex',
    })
  })
})

import { describe, expect, it } from 'vitest'

import {
  inferFallbackGatewayReplyRoute,
  inferThreadFirstGatewayReplyRoute,
  resolveExplicitGatewayReplyRoute,
} from '../src/reply-routes.js'

describe('gateway reply route inference', () => {
  it('uses the explicit reply target when both kind and target are present', () => {
    expect(
      resolveExplicitGatewayReplyRoute({
        deliveryKind: 'participant',
        deliveryTarget: ' contact:alex ',
      }),
    ).toEqual({
      kind: 'participant',
      target: 'contact:alex',
    })
  })

  it('prefers the thread target before the participant for thread-first channels', () => {
    expect(
      inferThreadFirstGatewayReplyRoute({
        conversation: {
          participantId: 'contact:alex',
          threadId: 'thread-42',
        },
        includeParticipant: true,
      }),
    ).toEqual({
      kind: 'thread',
      target: 'thread-42',
    })
  })

  it('prefers the participant before the thread for fallback routing in direct conversations', () => {
    expect(
      inferFallbackGatewayReplyRoute({
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

  it('keeps group conversations thread-addressed in fallback routing', () => {
    expect(
      inferFallbackGatewayReplyRoute({
        conversation: {
          directness: 'group',
          participantId: 'contact:alex',
          threadId: 'thread-42',
        },
      }),
    ).toEqual({
      kind: 'thread',
      target: 'thread-42',
    })
  })
})

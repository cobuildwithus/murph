import { describe, expect, it } from 'vitest'

import {
  inferGatewayReplyRouteForChannel,
} from '@murphai/gateway-core'

describe('inferGatewayReplyRouteForChannel', () => {
  it('uses participant fallback for telegram and email when no thread exists', () => {
    expect(
      inferGatewayReplyRouteForChannel({
        channel: 'telegram',
        conversation: {
          participantId: 'tg-user',
        },
      }),
    ).toEqual({
      kind: 'participant',
      target: 'tg-user',
    })

    expect(
      inferGatewayReplyRouteForChannel({
        channel: 'email',
        conversation: {
          participantId: 'person@example.com',
        },
      }),
    ).toEqual({
      kind: 'participant',
      target: 'person@example.com',
    })
  })

  it('prefers threads over participants for telegram and email channels', () => {
    expect(
      inferGatewayReplyRouteForChannel({
        channel: 'telegram',
        conversation: {
          participantId: 'tg-user',
          threadId: 'tg-thread',
        },
      }),
    ).toEqual({
      kind: 'thread',
      target: 'tg-thread',
    })

    expect(
      inferGatewayReplyRouteForChannel({
        channel: 'email',
        conversation: {
          participantId: 'person@example.com',
          threadId: 'email-thread',
        },
      }),
    ).toEqual({
      kind: 'thread',
      target: 'email-thread',
    })
  })

  it('keeps linq thread-only by default but allows requested participant delivery', () => {
    expect(
      inferGatewayReplyRouteForChannel({
        channel: 'linq',
        conversation: {
          participantId: 'linq-user',
        },
      }),
    ).toBeNull()

    expect(
      inferGatewayReplyRouteForChannel({
        channel: 'linq',
        conversation: {
          participantId: 'linq-user',
        },
        deliveryKind: 'participant',
        deliveryTarget: ' linq-user ',
      }),
    ).toEqual({
      kind: 'participant',
      target: 'linq-user',
    })

    expect(
      inferGatewayReplyRouteForChannel({
        channel: 'linq',
        conversation: {
          participantId: 'linq-user',
        },
        deliveryKind: 'participant',
      }),
    ).toEqual({
      kind: 'participant',
      target: 'linq-user',
    })
  })

  it('falls back to group-thread routing for unknown channels', () => {
    expect(
      inferGatewayReplyRouteForChannel({
        channel: 'custom-chat',
        conversation: {
          directness: 'group',
          participantId: 'group-user',
          threadId: 'group-thread',
        },
      }),
    ).toEqual({
      kind: 'thread',
      target: 'group-thread',
    })
  })
})

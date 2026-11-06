import { describe, expect, it } from 'vitest'

import {
  inferFallbackGatewayReplyRoute,
  inferGatewayReplyRouteForChannel,
  inferThreadFirstGatewayReplyRoute,
  normalizeGatewayConversationDirectness,
  resolveExplicitGatewayReplyRoute,
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

describe('reply-route edge cases', () => {
  it('uses an explicit route only when both kind and a non-blank target are present', () => {
    expect(
      resolveExplicitGatewayReplyRoute({ deliveryKind: 'thread', deliveryTarget: ' thread-1 ' }),
    ).toEqual({ kind: 'thread', target: 'thread-1' })
    expect(
      resolveExplicitGatewayReplyRoute({ deliveryKind: 'thread', deliveryTarget: '   ' }),
    ).toBeNull()
    expect(
      resolveExplicitGatewayReplyRoute({ deliveryKind: null, deliveryTarget: 'thread-1' }),
    ).toBeNull()
  })

  it('normalizes directness and rejects unknown values', () => {
    expect(normalizeGatewayConversationDirectness(' group ')).toBe('group')
    expect(normalizeGatewayConversationDirectness('direct')).toBe('direct')
    expect(normalizeGatewayConversationDirectness('broadcast')).toBeNull()
    expect(normalizeGatewayConversationDirectness(null)).toBeNull()
  })

  it('honors a requested delivery kind before the thread-first default', () => {
    const conversation = { participantId: 'user-1', threadId: 'thread-1' }
    expect(
      inferThreadFirstGatewayReplyRoute({
        conversation,
        deliveryKind: 'participant',
        includeParticipant: false,
      }),
    ).toEqual({ kind: 'participant', target: 'user-1' })
    expect(
      inferThreadFirstGatewayReplyRoute({
        conversation,
        deliveryKind: 'thread',
        includeParticipant: true,
      }),
    ).toEqual({ kind: 'thread', target: 'thread-1' })
    expect(
      inferThreadFirstGatewayReplyRoute({
        conversation: { participantId: 'user-1' },
        includeParticipant: false,
      }),
    ).toBeNull()
    expect(
      inferThreadFirstGatewayReplyRoute({
        conversation: { participantId: 'user-1', threadId: '  ' },
        deliveryKind: 'thread',
        deliveryTarget: 'explicit-thread',
        includeParticipant: true,
      }),
    ).toEqual({ kind: 'thread', target: 'explicit-thread' })
  })

  it('falls back from participant to thread for non-group conversations', () => {
    expect(
      inferFallbackGatewayReplyRoute({
        conversation: { directness: 'direct', participantId: 'user-1', threadId: 'thread-1' },
      }),
    ).toEqual({ kind: 'participant', target: 'user-1' })
    expect(
      inferFallbackGatewayReplyRoute({
        conversation: { directness: 'group', participantId: ' ', threadId: null },
      }),
    ).toBeNull()
    expect(
      inferFallbackGatewayReplyRoute({
        conversation: { threadId: 'thread-only' },
      }),
    ).toEqual({ kind: 'thread', target: 'thread-only' })
    expect(inferFallbackGatewayReplyRoute({ conversation: null })).toBeNull()
    expect(
      inferFallbackGatewayReplyRoute({
        conversation: { directness: 'group', threadId: 'thread-1' },
        deliveryKind: 'participant',
        deliveryTarget: 'explicit-user',
      }),
    ).toEqual({ kind: 'participant', target: 'explicit-user' })
  })

  it('routes linq to the thread and treats a missing channel as the fallback family', () => {
    expect(
      inferGatewayReplyRouteForChannel({
        channel: 'linq',
        conversation: { participantId: 'linq-user', threadId: 'linq-thread' },
      }),
    ).toEqual({ kind: 'thread', target: 'linq-thread' })
    expect(
      inferGatewayReplyRouteForChannel({
        channel: 'linq',
        conversation: { threadId: 'linq-thread' },
        deliveryKind: 'participant',
      }),
    ).toEqual({ kind: 'thread', target: 'linq-thread' })
    expect(
      inferGatewayReplyRouteForChannel({
        conversation: { participantId: 'user-1' },
      }),
    ).toEqual({ kind: 'participant', target: 'user-1' })
  })
})

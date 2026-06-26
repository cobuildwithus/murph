import { describe, expect, it } from 'vitest'

import {
  getAssistantChannelAdapter,
  inferAssistantBindingDelivery,
} from '../src/assistant/channels/registry.js'

describe('assistant channel adapter delivery inference', () => {
  it('uses the shared gateway-owned telegram and email fallback policy', () => {
    expect(
      getAssistantChannelAdapter('telegram')?.inferBindingDelivery({
        conversation: {
          participantId: 'tg-user',
        },
      }),
    ).toEqual({
      kind: 'participant',
      target: 'tg-user',
    })

    expect(
      getAssistantChannelAdapter('email')?.inferBindingDelivery({
        conversation: {
          participantId: 'person@example.com',
        },
      }),
    ).toEqual({
      kind: 'participant',
      target: 'person@example.com',
    })
  })

  it('keeps telegram and email thread-first when both thread and participant exist', () => {
    expect(
      getAssistantChannelAdapter('telegram')?.inferBindingDelivery({
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
      getAssistantChannelAdapter('email')?.inferBindingDelivery({
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

  it('keeps linq thread-only even when participant delivery is requested', () => {
    expect(
      getAssistantChannelAdapter('linq')?.inferBindingDelivery({
        conversation: {
          participantId: 'linq-user',
        },
      }),
    ).toBeNull()

    expect(
      getAssistantChannelAdapter('linq')?.inferBindingDelivery({
        conversation: {
          threadId: 'linq-thread',
        },
      }),
    ).toEqual({
      kind: 'thread',
      target: 'linq-thread',
    })

    expect(
      getAssistantChannelAdapter('linq')?.inferBindingDelivery({
        conversation: {
          participantId: 'linq-user',
        },
        deliveryKind: 'participant',
      }),
    ).toBeNull()
  })

  it('uses the same fallback policy when no channel adapter exists', () => {
    expect(
      inferAssistantBindingDelivery({
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

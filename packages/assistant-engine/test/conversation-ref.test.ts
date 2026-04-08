import { describe, expect, it } from 'vitest'

import {
  conversationDirectnessFromThreadIsDirect,
  conversationRefFromBinding,
  conversationRefFromCapture,
  conversationRefFromLocator,
  conversationRefToBindingFields,
  mergeConversationRefs,
  resolveConversationLocator,
  threadIsDirectFromConversationDirectness,
} from '../src/assistant/conversation-ref.ts'

describe('assistant conversation references', () => {
  it('merges locator fields, preserves explicit alias precedence, and records null binding patches', () => {
    const resolved = resolveConversationLocator({
      actorId: 'actor-123',
      alias: ' top-level alias ',
      channel: ' telegram ',
      conversation: {
        alias: ' nested alias ',
        channel: '  ',
        directness: ' unknown ',
        identityId: ' identity-123 ',
        participantId: ' participant-123 ',
        threadId: ' nested-thread ',
      },
      sourceThreadId: 'source-thread',
      threadIsDirect: null,
    })

    expect(resolved.conversation).toEqual({
      alias: 'top-level alias',
      channel: 'telegram',
      directness: 'unknown',
      identityId: 'identity-123',
      participantId: 'actor-123',
      sessionId: null,
      threadId: 'source-thread',
    })
    expect(resolved.bindingFields).toEqual({
      actorId: 'actor-123',
      threadIsDirect: null,
    })
    expect(resolved.bindingPatch).toEqual({
      actorId: 'actor-123',
      channel: 'telegram',
      identityId: 'identity-123',
      threadId: 'source-thread',
      threadIsDirect: null,
    })
    expect(resolved.explicitAlias).toBe('nested alias')
    expect(
      conversationRefFromLocator({
        conversation: {
          channel: ' ',
          participantId: ' participant-only ',
        },
      }),
    ).toEqual({
      alias: null,
      channel: null,
      directness: null,
      identityId: null,
      participantId: 'participant-only',
      sessionId: null,
      threadId: null,
    })
  })

  it('maps binding and capture inputs into normalized conversation refs', () => {
    expect(
      conversationRefFromBinding({
        actorId: 'actor-1',
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: false,
      }),
    ).toEqual({
      alias: null,
      channel: 'telegram',
      directness: 'group',
      identityId: 'identity-1',
      participantId: 'actor-1',
      sessionId: null,
      threadId: 'thread-1',
    })

    expect(
      conversationRefFromCapture({
        accountId: 'account-email',
        actorId: 'actor-email',
        source: 'email',
        threadId: 'thread-email',
        threadIsDirect: true,
      }),
    ).toMatchObject({
      channel: 'email',
      directness: 'direct',
      identityId: 'account-email',
      participantId: 'actor-email',
      threadId: 'thread-email',
    })

    expect(
      conversationRefFromCapture({
        accountId: 'account-sms',
        actorId: 'actor-sms',
        source: 'sms',
        threadId: 'thread-sms',
        threadIsDirect: null,
      }),
    ).toMatchObject({
      channel: 'sms',
      directness: null,
      identityId: null,
      participantId: 'actor-sms',
      threadId: 'thread-sms',
    })
  })

  it('merges conversation refs and converts directness back to binding fields', () => {
    const merged = mergeConversationRefs(
      {
        alias: 'base',
        channel: 'telegram',
        directness: 'group',
        identityId: 'identity-base',
        participantId: 'participant-base',
        threadId: 'thread-base',
      },
      {
        alias: 'patch',
        directness: 'direct',
        threadId: 'thread-patch',
      },
    )

    expect(merged).toEqual({
      alias: 'patch',
      channel: 'telegram',
      directness: 'direct',
      identityId: 'identity-base',
      participantId: 'participant-base',
      sessionId: null,
      threadId: 'thread-patch',
    })
    expect(conversationRefToBindingFields(merged)).toEqual({
      actorId: 'participant-base',
      threadIsDirect: true,
    })
    expect(conversationDirectnessFromThreadIsDirect(false)).toBe('group')
    expect(conversationDirectnessFromThreadIsDirect(null)).toBeNull()
    expect(threadIsDirectFromConversationDirectness('direct')).toBe(true)
    expect(threadIsDirectFromConversationDirectness('unknown')).toBeNull()
  })
})

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildAssistantOutboxPersistedTarget,
  buildAssistantOutboxRawTargetIdentity,
  hashAssistantOutboxIdentity,
  hashAssistantOutboxTargetFingerprint,
  resolveAssistantOutboxIntentPath,
  resolveAssistantOutboxQuarantineDirectory,
} from '../src/assistant/outbox/intents.ts'

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
        threadId: 'thread-1',
      }).bindingDelivery,
    ).toBeNull()

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
      payload: {
        kind: 'message',
        message: 'first message',
        media: [
          {
            kind: 'image',
            url: 'https://cdn.example.test/media/first.png',
            alt: null,
            source: null,
          },
        ],
        replyToMessageId: null,
        subject: null,
      },
      sessionId: 'session-a',
      turnId: 'turn-a',
      channel: 'telegram',
      identityId: 'user-a',
    })
    const second = hashAssistantOutboxIdentity({
      dedupeToken: 'same-token',
      payload: {
        kind: 'message',
        message: 'second message',
        media: [
          {
            kind: 'image',
            url: 'https://cdn.example.test/media/retry.png',
            alt: null,
            source: null,
          },
        ],
        replyToMessageId: null,
        subject: null,
      },
      sessionId: 'session-b',
      turnId: 'turn-b',
      explicitTarget: 'another-target',
    })

    expect(first).toBe(second)

    const fallbackA = hashAssistantOutboxIdentity({
      dedupeToken: '   ',
      payload: {
        kind: 'message',
        message: 'first message',
        media: [],
        replyToMessageId: null,
        subject: null,
      },
      sessionId: 'session-a',
      turnId: 'turn-a',
      channel: 'telegram',
      identityId: 'user-a',
    })
    const fallbackB = hashAssistantOutboxIdentity({
      dedupeToken: '',
      payload: {
        kind: 'message',
        message: 'second message',
        media: [],
        replyToMessageId: null,
        subject: null,
      },
      sessionId: 'session-a',
      turnId: 'turn-a',
      channel: 'telegram',
      identityId: 'user-a',
    })

    expect(fallbackA).not.toBe(fallbackB)
  })

  it('includes reaction payload target and reaction in the fallback identity hash', () => {
    const base = {
      channel: 'linq',
      identityId: 'user-a',
      sessionId: 'session-a',
      turnId: 'turn-a',
    }
    const heart = hashAssistantOutboxIdentity({
      ...base,
      payload: {
        kind: 'reaction',
        reaction: 'heart',
        targetMessageId: 'message-1',
      },
    })
    const same = hashAssistantOutboxIdentity({
      ...base,
      payload: {
        kind: 'reaction',
        reaction: 'heart',
        targetMessageId: 'message-1',
      },
    })
    const differentReaction = hashAssistantOutboxIdentity({
      ...base,
      payload: {
        kind: 'reaction',
        reaction: 'laugh',
        targetMessageId: 'message-1',
      },
    })
    const differentTargetMessage = hashAssistantOutboxIdentity({
      ...base,
      payload: {
        kind: 'reaction',
        reaction: 'heart',
        targetMessageId: 'message-2',
      },
    })

    expect(heart).toBe(same)
    expect(heart).not.toBe(differentReaction)
    expect(heart).not.toBe(differentTargetMessage)
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

    expect(hashAssistantOutboxTargetFingerprint(rawTarget)).toBe(sameFingerprint)
    expect(hashAssistantOutboxTargetFingerprint(rawTarget)).not.toBe(changedFingerprint)
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

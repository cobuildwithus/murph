import { describe, expect, it } from 'vitest'

import {
  serializeHostedEmailThreadTarget,
} from '@murphai/runtime-state'
import {
  hashAssistantOutboxIdentity,
  hashAssistantOutboxTargetFingerprint,
} from '../src/assistant/outbox/intents.js'
import { resolveAssistantNotificationDeliverySubject } from '../src/assistant/notification-turn.js'

describe('assistant email subject support', () => {
  it('changes outbox identity when only the subject changes', () => {
    const base = {
      actorId: null,
      bindingDelivery: null,
      channel: 'email',
      dedupeToken: null,
      explicitTarget: 'user@example.com',
      identityId: 'assistant@example.com',
      replyToMessageId: null,
      sessionId: 'session_123',
      threadId: null,
      turnId: 'turn_123',
    } as const

    expect(
      hashAssistantOutboxIdentity({
        ...base,
        media: [],
        message: 'Hello from Murph',
        subject: 'Daily check-in',
      }),
    ).not.toBe(
      hashAssistantOutboxIdentity({
        ...base,
        media: [],
        message: 'Hello from Murph',
        subject: 'Plan update',
      }),
    )
  })

  it('keeps the target fingerprint stable when only the subject changes', () => {
    const daily = {
      actorId: null,
      bindingDelivery: null,
      channel: 'email',
      explicitTarget: 'user@example.com',
      identityId: 'assistant@example.com',
      replyToMessageId: null,
      threadId: null,
      subject: 'Daily check-in',
    } as const
    const plan = {
      ...daily,
      subject: 'Plan update',
    } as const

    expect(hashAssistantOutboxTargetFingerprint(daily)).toBe(
      hashAssistantOutboxTargetFingerprint(plan),
    )
  })

  it('uses a generated subject for non-thread email delivery', () => {
    expect(
      resolveAssistantNotificationDeliverySubject({
        bindingDelivery: null,
        channel: 'email',
        decisionSubject: 'Custom subject',
        explicitTarget: 'user@example.com',
        inputDeliverySubject: null,
      }),
    ).toBe('Custom subject')
  })

  it('drops generated subjects for email thread replies', () => {
    expect(
      resolveAssistantNotificationDeliverySubject({
        bindingDelivery: {
          kind: 'thread',
          target: 'thread_123',
        },
        channel: 'email',
        decisionSubject: 'Should not be used',
        explicitTarget: null,
        inputDeliverySubject: null,
      }),
    ).toBeNull()
  })

  it('uses generated subjects for explicit email targets with stale thread bindings', () => {
    expect(
      resolveAssistantNotificationDeliverySubject({
        bindingDelivery: {
          kind: 'thread',
          target: 'stale-thread-target',
        },
        channel: 'email',
        decisionSubject: 'Fresh direct subject',
        explicitTarget: 'user@example.com',
        inputDeliverySubject: null,
      }),
    ).toBe('Fresh direct subject')
  })

  it('rejects a manually configured subject when the email target is a thread', () => {
    expect(() =>
      resolveAssistantNotificationDeliverySubject({
        bindingDelivery: {
          kind: 'thread',
          target: 'thread_123',
        },
        channel: 'email',
        decisionSubject: 'Generated subject',
        explicitTarget: null,
        inputDeliverySubject: 'Manual subject',
      }),
    ).toThrow(
      'Email thread replies preserve the existing subject. Do not provide a subject override when replying to a thread.',
    )
  })

  it('drops generated subjects for hosted email thread targets', () => {
    const threadTarget = serializeHostedEmailThreadTarget({
      lastMessageId: 'message_123',
      subject: 'Existing thread subject',
      to: ['user@example.test'],
    })

    expect(
      resolveAssistantNotificationDeliverySubject({
        bindingDelivery: null,
        channel: 'email',
        decisionSubject: 'Generated subject',
        explicitTarget: threadTarget,
        inputDeliverySubject: null,
      }),
    ).toBeNull()
  })

  it('rejects a manually configured subject for hosted email thread targets', () => {
    const threadTarget = serializeHostedEmailThreadTarget({
      lastMessageId: 'message_123',
      subject: 'Existing thread subject',
      to: ['user@example.test'],
    })

    expect(() =>
      resolveAssistantNotificationDeliverySubject({
        bindingDelivery: null,
        channel: 'email',
        decisionSubject: null,
        explicitTarget: threadTarget,
        inputDeliverySubject: 'Manual subject',
      }),
    ).toThrow(
      'Email thread replies preserve the existing subject. Do not provide a subject override when replying to a thread.',
    )
  })

  it('drops generated subjects for non-email channels', () => {
    expect(
      resolveAssistantNotificationDeliverySubject({
        bindingDelivery: null,
        channel: 'telegram',
        decisionSubject: 'Email only subject',
        explicitTarget: 'chat_123',
        inputDeliverySubject: null,
      }),
    ).toBeNull()
  })
})

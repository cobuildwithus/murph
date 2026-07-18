import { describe, expect, it } from 'vitest'
import { serializeHostedEmailThreadTarget } from '@murphai/runtime-state'

import {
  assistantDeliveryRoutesBelongToSameConversation,
  getAssistantAutomationRouteDeliverabilityIssue,
  looksLikePrivateAssistantRoutePlaceholder,
  resolveAssistantDeliveryRouteConversationKey,
  resolveAssistantDeliveryRouteWithCurrentRoute,
  stripPrivateAssistantRoutePlaceholders,
} from '../src/assistant/current-delivery-route.ts'

const LINQ_IDENTITY_ID = 'h1_111111111111111111111111'
const LINQ_PARTICIPANT_ID = 'h1_222222222222222222222222'
const LINQ_THREAD_ID = 'h1_333333333333333333333333'

describe('assistant current delivery route', () => {
  it('recognizes only verified direct Linq participant-to-chat transitions', () => {
    const participantRoute = {
      channel: 'linq',
      deliveryTarget: '+15550123',
      identityId: LINQ_IDENTITY_ID,
      participantId: LINQ_PARTICIPANT_ID,
      threadId: null,
      threadIsDirect: true,
    }
    const materializedChatRoute = {
      channel: 'linq',
      deliveryTarget: 'linq_chat_real',
      identityId: LINQ_IDENTITY_ID,
      participantId: LINQ_PARTICIPANT_ID,
      threadId: LINQ_THREAD_ID,
      threadIsDirect: true,
    }

    expect(assistantDeliveryRoutesBelongToSameConversation(
      participantRoute,
      materializedChatRoute,
    )).toBe(true)
    expect(assistantDeliveryRoutesBelongToSameConversation(
      { ...participantRoute, threadIsDirect: false },
      { ...materializedChatRoute, threadIsDirect: false },
    )).toBe(false)
    expect(assistantDeliveryRoutesBelongToSameConversation(
      participantRoute,
      { ...materializedChatRoute, participantId: 'hid_other_participant' },
    )).toBe(false)
  })

  it('identifies hosted email conversations by sender identity and stable thread', () => {
    const firstEnvelope = serializeHostedEmailThreadTarget({
      cc: [],
      lastMessageId: '<first@example.test>',
      references: [],
      subject: 'Weekly check-in',
      to: ['group@example.test'],
    })
    const laterEnvelope = serializeHostedEmailThreadTarget({
      cc: [],
      lastMessageId: '<later@example.test>',
      references: ['<first@example.test>'],
      subject: 'Re: Weekly check-in',
      to: ['group@example.test'],
    })
    const firstKey = resolveAssistantDeliveryRouteConversationKey({
      channel: 'email',
      deliveryTarget: firstEnvelope,
      identityId: 'sender-identity',
      threadId: 'stable-thread',
    })

    expect(resolveAssistantDeliveryRouteConversationKey({
      channel: 'email',
      deliveryTarget: laterEnvelope,
      identityId: 'sender-identity',
      threadId: 'stable-thread',
    })).toBe(firstKey)
    expect(resolveAssistantDeliveryRouteConversationKey({
      channel: 'email',
      deliveryTarget: laterEnvelope,
      identityId: 'other-sender',
      threadId: 'stable-thread',
    })).not.toBe(firstKey)
    expect(resolveAssistantDeliveryRouteConversationKey({
      channel: 'email',
      deliveryTarget: laterEnvelope,
      identityId: 'sender-identity',
      threadId: 'other-thread',
    })).not.toBe(firstKey)
    expect(resolveAssistantDeliveryRouteConversationKey({
      channel: 'linq',
      deliveryTarget: 'other-target',
      identityId: 'sender-identity',
      threadId: 'stable-thread',
    })).not.toBe(resolveAssistantDeliveryRouteConversationKey({
      channel: 'linq',
      deliveryTarget: 'current-target',
      identityId: 'sender-identity',
      threadId: 'stable-thread',
    }))
  })

  it('preserves blinded Linq current-route locators for session lookup', () => {
    const route = resolveAssistantDeliveryRouteWithCurrentRoute(
      { channel: 'linq' },
      {
        channel: 'linq',
        deliveryTarget: 'linq_chat_real',
        identityId: LINQ_IDENTITY_ID,
        participantId: LINQ_PARTICIPANT_ID,
        threadId: LINQ_THREAD_ID,
        threadIsDirect: true,
      },
    )

    expect(route).toEqual({
      channel: 'linq',
      deliveryTarget: 'linq_chat_real',
      identityId: LINQ_IDENTITY_ID,
      participantId: LINQ_PARTICIPANT_ID,
      threadId: LINQ_THREAD_ID,
      threadIsDirect: true,
    })
    expect(stripPrivateAssistantRoutePlaceholders(route)).toEqual(route)
  })

  it('does not attach current-route locators to an explicit delivery target', () => {
    expect(
      resolveAssistantDeliveryRouteWithCurrentRoute(
        {
          channel: 'linq',
          deliveryTarget: 'linq_chat_other',
        },
        {
          channel: 'linq',
          deliveryTarget: 'linq_chat_real',
          identityId: LINQ_IDENTITY_ID,
          participantId: LINQ_PARTICIPANT_ID,
          threadId: LINQ_THREAD_ID,
        },
      ),
    ).toEqual({
      channel: 'linq',
      deliveryTarget: 'linq_chat_other',
      identityId: null,
      participantId: null,
      threadId: null,
    })
  })

  it('fills missing locators when the explicit target names the current conversation', () => {
    expect(
      resolveAssistantDeliveryRouteWithCurrentRoute(
        {
          channel: 'linq',
          deliveryTarget: 'linq_chat_real',
        },
        {
          channel: 'linq',
          deliveryTarget: 'linq_chat_real',
          identityId: LINQ_IDENTITY_ID,
          participantId: LINQ_PARTICIPANT_ID,
          threadId: LINQ_THREAD_ID,
        },
      ),
    ).toEqual({
      channel: 'linq',
      deliveryTarget: 'linq_chat_real',
      identityId: LINQ_IDENTITY_ID,
      participantId: LINQ_PARTICIPANT_ID,
      threadId: LINQ_THREAD_ID,
    })
  })

  it('keeps explicit locators over current-route locators for the same conversation', () => {
    expect(
      resolveAssistantDeliveryRouteWithCurrentRoute(
        {
          channel: 'linq',
          deliveryTarget: 'linq_chat_real',
          threadId: 'explicit_thread',
        },
        {
          channel: 'linq',
          deliveryTarget: 'linq_chat_real',
          identityId: LINQ_IDENTITY_ID,
          participantId: LINQ_PARTICIPANT_ID,
          threadId: LINQ_THREAD_ID,
        },
      ),
    ).toEqual({
      channel: 'linq',
      deliveryTarget: 'linq_chat_real',
      identityId: LINQ_IDENTITY_ID,
      participantId: LINQ_PARTICIPANT_ID,
      threadId: 'explicit_thread',
    })
  })

  it('does not enrich an explicit target on a different channel', () => {
    expect(
      resolveAssistantDeliveryRouteWithCurrentRoute(
        {
          channel: 'telegram',
          deliveryTarget: 'linq_chat_real',
        },
        {
          channel: 'linq',
          deliveryTarget: 'linq_chat_real',
          identityId: LINQ_IDENTITY_ID,
          participantId: LINQ_PARTICIPANT_ID,
          threadId: LINQ_THREAD_ID,
        },
      ),
    ).toEqual({
      channel: 'telegram',
      deliveryTarget: 'linq_chat_real',
      identityId: null,
      participantId: null,
      threadId: null,
    })
  })

  it('keeps private lookup identifiers separate from redacted placeholders', () => {
    expect(looksLikePrivateAssistantRoutePlaceholder(LINQ_THREAD_ID)).toBe(true)
    expect(
      looksLikePrivateAssistantRoutePlaceholder('[REDACTED thread]'),
    ).toBe(true)
    expect(
      looksLikePrivateAssistantRoutePlaceholder('WRAPPED:AIN_PRIVATE'),
    ).toBe(true)
    expect(
      stripPrivateAssistantRoutePlaceholders({
        channel: 'linq',
        deliveryTarget: 'linq_chat_real',
        identityId: 'hbidx:phone:v1:redacted',
        participantId: 'hid_redacted_participant',
        threadId: '[redacted thread]',
      }),
    ).toEqual({
      channel: 'linq',
      deliveryTarget: 'linq_chat_real',
      identityId: null,
      participantId: null,
      threadId: null,
    })
  })

  it('validates email automation delivery routes by runtime profile', () => {
    expect(
      getAssistantAutomationRouteDeliverabilityIssue({
        channel: 'email',
        deliveryTarget: 'friend@example.test',
        identityId: null,
        participantId: null,
        threadId: null,
      }),
    ).toMatchObject({
      code: 'email_identity_required',
    })

    expect(
      getAssistantAutomationRouteDeliverabilityIssue(
        {
          channel: 'email',
          deliveryTarget: 'friend@example.test',
          identityId: null,
          participantId: null,
          threadId: null,
        },
        'hosted',
      ),
    ).toBeNull()

    expect(
      getAssistantAutomationRouteDeliverabilityIssue({
        channel: 'email',
        deliveryTarget: 'friend@example.test',
        identityId: 'hid_email_identity',
        participantId: null,
        threadId: null,
      }),
    ).toMatchObject({
      code: 'email_identity_required',
    })

    expect(
      getAssistantAutomationRouteDeliverabilityIssue(
        {
          channel: 'email',
          deliveryTarget: 'friend@example.test',
          identityId: 'hid_email_identity',
          participantId: null,
          threadId: null,
        },
        'hosted',
      ),
    ).toBeNull()

    expect(
      getAssistantAutomationRouteDeliverabilityIssue(
        {
          channel: 'email',
          deliveryTarget: 'hostedmail:truncated...',
          identityId: null,
          participantId: null,
          threadId: null,
        },
        'hosted',
      ),
    ).toMatchObject({
      code: 'email_hosted_thread_target_invalid',
    })

    expect(
      getAssistantAutomationRouteDeliverabilityIssue(
        {
          channel: 'email',
          deliveryTarget: serializeHostedEmailThreadTarget({
            cc: [],
            lastMessageId: '<message@example.test>',
            references: [],
            subject: 'Status',
            to: [],
          }),
          identityId: null,
          participantId: null,
          threadId: null,
        },
        'hosted',
      ),
    ).toMatchObject({
      code: 'email_hosted_thread_target_recipient_required',
    })

    expect(
      getAssistantAutomationRouteDeliverabilityIssue(
        {
          channel: 'email',
          deliveryTarget: serializeHostedEmailThreadTarget({
            cc: [],
            lastMessageId: '<message@example.test>',
            references: [],
            subject: 'Status',
            to: [],
          }),
          identityId: 'inbox_123',
          participantId: null,
          threadId: null,
        },
        'local',
      ),
    ).toMatchObject({
      code: 'email_hosted_thread_target_recipient_required',
    })

    expect(
      getAssistantAutomationRouteDeliverabilityIssue(
        {
          channel: 'email',
          deliveryTarget: serializeHostedEmailThreadTarget({
            cc: [],
            lastMessageId: '<message@example.test>',
            references: [],
            subject: 'Status',
            to: ['friend@example.test'],
          }),
          identityId: null,
          participantId: null,
          threadId: null,
        },
        'hosted',
      ),
    ).toBeNull()

    expect(
      getAssistantAutomationRouteDeliverabilityIssue({
        channel: 'email',
        deliveryTarget: 'h1_333333333333333333333333',
        identityId: null,
        participantId: null,
        threadId: null,
      }),
    ).toMatchObject({
      code: 'email_private_delivery_target',
    })

    expect(
      getAssistantAutomationRouteDeliverabilityIssue({
        channel: 'email',
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: 'h1_333333333333333333333333',
      }),
    ).toMatchObject({
      code: 'email_delivery_target_required',
    })

    expect(
      getAssistantAutomationRouteDeliverabilityIssue(
        {
          channel: 'email',
          deliveryTarget: null,
          identityId: 'inbox_123',
          participantId: null,
          threadId: 'thread_123',
        },
        'hosted',
      ),
    ).toMatchObject({
      code: 'email_delivery_target_required',
    })

    expect(
      getAssistantAutomationRouteDeliverabilityIssue(
        {
          channel: 'email',
          deliveryTarget: null,
          identityId: 'inbox_123',
          participantId: null,
          threadId: 'thread_123',
        },
        'local',
      ),
    ).toBeNull()

    expect(
      getAssistantAutomationRouteDeliverabilityIssue(
        {
          channel: 'email',
          deliveryTarget: null,
          identityId: 'inbox_123',
          participantId: 'friend@example.test',
          threadId: null,
        },
        'hosted',
      ),
    ).toMatchObject({
      code: 'email_delivery_target_required',
    })

    expect(
      getAssistantAutomationRouteDeliverabilityIssue(
        {
          channel: 'email',
          deliveryTarget: null,
          identityId: 'inbox_123',
          participantId: 'friend@example.test',
          threadId: null,
        },
        'local',
      ),
    ).toBeNull()

    expect(
      getAssistantAutomationRouteDeliverabilityIssue(
        {
          channel: 'email',
          deliveryTarget: null,
          identityId: 'hid_email_identity',
          participantId: null,
          threadId: 'hid_email_thread',
        },
        'local',
      ),
    ).toMatchObject({
      code: 'email_delivery_target_required',
    })
  })

  it('allows non-private Linq thread-only routes and rejects private locators', () => {
    expect(
      getAssistantAutomationRouteDeliverabilityIssue({
        channel: 'linq',
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: 'thread_123',
      }),
    ).toBeNull()

    expect(
      getAssistantAutomationRouteDeliverabilityIssue({
        channel: 'linq',
        deliverySource: {
          kind: 'linq',
        },
        deliveryTarget: null,
        identityId: null,
        participantId: 'hid_redacted_participant',
        threadId: null,
      }),
    ).toMatchObject({
      code: 'linq_private_participant',
    })

    expect(
      getAssistantAutomationRouteDeliverabilityIssue(
        {
          channel: 'linq',
          deliveryTarget: null,
          identityId: null,
          participantId: null,
          threadId: 'thread_123',
        },
        'local',
      ),
    ).toBeNull()

    expect(
      getAssistantAutomationRouteDeliverabilityIssue(
        {
          channel: 'linq',
          deliveryTarget: null,
          identityId: null,
          participantId: null,
          threadId: 'hid_redacted_thread',
        },
        'local',
      ),
    ).toMatchObject({
      code: 'linq_delivery_target_required',
    })
  })
})

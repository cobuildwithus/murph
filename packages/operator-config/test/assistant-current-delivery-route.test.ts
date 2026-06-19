import { describe, expect, it } from 'vitest'

import {
  getAssistantAutomationRouteDeliverabilityIssue,
  looksLikePrivateAssistantRoutePlaceholder,
  resolveAssistantDeliveryRouteWithCurrentRoute,
  stripPrivateAssistantRoutePlaceholders,
} from '../src/assistant/current-delivery-route.ts'

const LINQ_IDENTITY_ID = 'h1_111111111111111111111111'
const LINQ_PARTICIPANT_ID = 'h1_222222222222222222222222'
const LINQ_THREAD_ID = 'h1_333333333333333333333333'

describe('assistant current delivery route', () => {
  it('preserves blinded Linq current-route locators for session lookup', () => {
    const route = resolveAssistantDeliveryRouteWithCurrentRoute(
      { channel: 'linq' },
      {
        channel: 'linq',
        deliveryTarget: 'linq_chat_real',
        identityId: LINQ_IDENTITY_ID,
        participantId: LINQ_PARTICIPANT_ID,
        threadId: LINQ_THREAD_ID,
      },
    )

    expect(route).toEqual({
      channel: 'linq',
      deliveryTarget: 'linq_chat_real',
      identityId: LINQ_IDENTITY_ID,
      participantId: LINQ_PARTICIPANT_ID,
      threadId: LINQ_THREAD_ID,
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

  it('requires email automation delivery targets unless local thread replies are explicitly allowed', () => {
    expect(
      getAssistantAutomationRouteDeliverabilityIssue({
        channel: 'email',
        deliveryTarget: 'friend@example.test',
        identityId: null,
        participantId: null,
        threadId: null,
      }),
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
      getAssistantAutomationRouteDeliverabilityIssue({
        channel: 'email',
        deliveryTarget: null,
        identityId: 'inbox_123',
        participantId: null,
        threadId: 'thread_123',
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
        {
          allowEmailThreadDelivery: true,
        },
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
        {
          allowEmailThreadDelivery: true,
        },
      ),
    ).toMatchObject({
      code: 'email_delivery_target_required',
    })
  })

  it('keeps Linq thread-only routes strict at save/import boundaries and explicit at runtime', () => {
    expect(
      getAssistantAutomationRouteDeliverabilityIssue({
        channel: 'linq',
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: 'thread_123',
      }),
    ).toMatchObject({
      code: 'linq_delivery_target_required',
    })

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
        {
          allowLinqThreadDelivery: true,
        },
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
        {
          allowLinqThreadDelivery: true,
        },
      ),
    ).toMatchObject({
      code: 'linq_delivery_target_required',
    })
  })
})

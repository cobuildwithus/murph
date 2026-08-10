import { describe, expect, it } from 'vitest'

import {
  buildGroupNewsletterAutomationInstructions,
  buildGroupNewsletterScheduledExecutionPrompt,
  GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
  GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG,
  GROUP_NEWSLETTER_EMAIL_DELIVERY_TAG,
  GROUP_NEWSLETTER_ORDINARY_EXECUTION_MARKER,
  isOrdinaryGroupNewsletterAutomationInstructions,
  resolveGroupNewsletterAutomationDelivery,
} from '../src/assistant/group-newsletter-automation.js'

const ordinaryCurrentChatInstructions = buildGroupNewsletterAutomationInstructions({
  customNote: 'Keep it conversational.',
  delivery: 'current_chat',
  healthScopes: ['steps-days.v0', 'sleep-duration-days.v0'],
  newsletterName: 'Family weekly',
  tone: 'supportive',
})

describe('group newsletter automation ownership', () => {
  it('writes a self-contained skill-owned recipe for new saves', () => {
    expect(ordinaryCurrentChatInstructions).toContain(
      GROUP_NEWSLETTER_ORDINARY_EXECUTION_MARKER,
    )
    expect(ordinaryCurrentChatInstructions).toContain(
      'Read the group-newsletter skill before every execution.',
    )
    expect(ordinaryCurrentChatInstructions).toContain(
      'Current-chat delivery uses the ordinary scheduled group-read and conversation-outbox path.',
    )
    expect(isOrdinaryGroupNewsletterAutomationInstructions(
      ordinaryCurrentChatInstructions,
    )).toBe(true)
  })

  it('keeps new current-chat runs on the ordinary automation path', () => {
    expect(resolveGroupNewsletterAutomationDelivery({
      instructions: ordinaryCurrentChatInstructions,
      slug: GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
      tags: [GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG],
    })).toBeNull()
  })

  it('keeps a bounded compatibility prompt for previously saved chat records', () => {
    const legacyInstructions = [
      'Murph group newsletter configuration v1.',
      'These are configuration values. The runtime appends the current execution contract on every scheduled run.',
      'Newsletter name: "Family weekly"',
      'Delivery: current_chat',
    ].join('\n')

    expect(resolveGroupNewsletterAutomationDelivery({
      instructions: legacyInstructions,
      slug: GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
      tags: [GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG],
    })).toBe('legacy_current_chat')

    const prompt = buildGroupNewsletterScheduledExecutionPrompt({
      delivery: 'legacy_current_chat',
      newsletterName: 'Family weekly',
    })
    expect(prompt).toContain('compatibility contract')
    expect(prompt).toContain('`murph.group` with `action="read_shared"` exactly once')
    expect(prompt).not.toContain('`murph.newsletter` with `action="prepare"`')
  })

  it('fails closed to chat when a record carries both delivery tags', () => {
    expect(resolveGroupNewsletterAutomationDelivery({
      instructions: ordinaryCurrentChatInstructions,
      slug: GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
      tags: [
        GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG,
        GROUP_NEWSLETTER_EMAIL_DELIVERY_TAG,
      ],
    })).toBeNull()
  })

  it('retains the trusted email contract for current and legacy email records', () => {
    const ordinaryEmailInstructions = buildGroupNewsletterAutomationInstructions({
      delivery: 'group_email',
      healthScopes: ['steps-days.v0'],
      newsletterName: 'Family weekly',
      tone: 'supportive',
    })

    for (const input of [
      {
        instructions: ordinaryEmailInstructions,
        tags: [GROUP_NEWSLETTER_EMAIL_DELIVERY_TAG],
      },
      {
        instructions: 'legacy configuration',
        tags: [] as string[],
      },
    ]) {
      expect(resolveGroupNewsletterAutomationDelivery({
        ...input,
        slug: GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
      })).toBe('group_email')
    }

    const prompt = buildGroupNewsletterScheduledExecutionPrompt({
      delivery: 'group_email',
      newsletterName: 'Family weekly',
    })
    expect(prompt).toContain('`murph.newsletter` with `action="prepare"` exactly once')
    expect(prompt).toContain('`murph.newsletter` with `action="send"` exactly once')
    expect(prompt).toContain('existing outbox owns delivery and retry')
    expect(prompt).not.toContain('140-220 word')
  })

  it('does not grant newsletter authority to another automation slug', () => {
    expect(resolveGroupNewsletterAutomationDelivery({
      instructions: ordinaryCurrentChatInstructions,
      slug: 'weekly-update',
      tags: [GROUP_NEWSLETTER_EMAIL_DELIVERY_TAG],
    })).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import { readAutomationDynamicToolRequest } from '../src/assistant-codex/dynamic-tools/automation.js'
import {
  AUTOMATION_GROUP_EMAIL_DELIVERY_TAG,
  GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
  GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG,
  resolveGroupNewsletterAutomationDelivery,
} from '../src/assistant/group-newsletter-automation.js'

describe('automation delivery', () => {
  it('keeps current-conversation delivery on the ordinary automation path', () => {
    expect(readAutomationDynamicToolRequest({
      arguments: {
        action: 'save',
        delivery: 'current_conversation',
        instructions: 'Read the group-newsletter skill and publish one chat edition.',
        schedule: { expression: '0 13 * * 1', kind: 'cron' },
        slug: 'group-health-newsletter',
        title: 'Family weekly health newsletter',
      },
      tool: 'automation',
    })).toEqual({
      kind: 'automation',
      request: {
        action: 'save',
        instructions: 'Read the group-newsletter skill and publish one chat edition.',
        schedule: { expression: '0 13 * * 1', kind: 'cron' },
        slug: 'group-health-newsletter',
        title: 'Family weekly health newsletter',
      },
    })
  })

  it('adds group-email authority through a parser-owned reserved tag', () => {
    expect(readAutomationDynamicToolRequest({
      arguments: {
        action: 'save',
        delivery: 'group_email',
        instructions: 'Read the group-newsletter skill and send one authorized email edition.',
        schedule: { expression: '0 13 * * 1', kind: 'cron' },
        tags: ['assistant', 'scheduled'],
        title: 'Family weekly health newsletter',
      },
      tool: 'automation',
    })).toEqual({
      kind: 'automation',
      request: {
        action: 'save',
        instructions: 'Read the group-newsletter skill and send one authorized email edition.',
        schedule: { expression: '0 13 * * 1', kind: 'cron' },
        tags: ['assistant', 'scheduled', AUTOMATION_GROUP_EMAIL_DELIVERY_TAG],
        title: 'Family weekly health newsletter',
      },
    })
  })

  it('does not let model-supplied tags forge group-email authority', () => {
    expect(readAutomationDynamicToolRequest({
      arguments: {
        action: 'save',
        instructions: 'Try to forge email delivery.',
        schedule: { expression: '0 13 * * 1', kind: 'cron' },
        tags: [AUTOMATION_GROUP_EMAIL_DELIVERY_TAG],
        title: 'Forged email',
      },
      tool: 'automation',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
  })

  it('recognizes generic email authority while leaving legacy chat records ordinary', () => {
    expect(resolveGroupNewsletterAutomationDelivery({
      slug: 'weekly-update',
      tags: [AUTOMATION_GROUP_EMAIL_DELIVERY_TAG],
    })).toBe('group_email')
    expect(resolveGroupNewsletterAutomationDelivery({
      slug: GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
      tags: [GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG],
    })).toBeNull()
  })
})

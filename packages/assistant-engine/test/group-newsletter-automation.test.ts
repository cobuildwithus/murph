import { describe, expect, it } from 'vitest'

import {
  buildGroupNewsletterScheduledExecutionPrompt,
  GROUP_NEWSLETTER_CURRENT_CHAT_DEFAULT_HEALTH_SCOPES,
  GROUP_NEWSLETTER_HEALTH_SCOPE_VALUES,
} from '../src/assistant/group-newsletter-automation.js'

describe('group newsletter execution prompt', () => {
  it('requests workout details for current-chat context', () => {
    expect(GROUP_NEWSLETTER_HEALTH_SCOPE_VALUES).toContain('workouts.v0')
    expect(GROUP_NEWSLETTER_CURRENT_CHAT_DEFAULT_HEALTH_SCOPES).toEqual([
      'steps-days.v0',
      'workouts.v0',
      'sleep-duration-days.v0',
    ])
  })

  for (const delivery of ['current_chat', 'group_email'] as const) {
    it(`grounds contextual stories for ${delivery}`, () => {
      const prompt = buildGroupNewsletterScheduledExecutionPrompt({
        delivery,
        newsletterName: 'Weekly check-in',
      })
      expect(prompt).toContain('When highlighting or ranking a number')
      expect(prompt).toContain('workout count, duration, or type alongside steps or movement')
      expect(prompt).toContain('Never invent a reason')
      expect(prompt).toContain('If no grounded context is available, state the number plainly')
      expect(prompt).toContain('workout-kind-<type>-count')
      expect(prompt).toContain('never multiply them into a weekly session or minute total')
    })
  }
})

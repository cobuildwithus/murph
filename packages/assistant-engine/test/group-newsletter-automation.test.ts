import { describe, expect, it } from 'vitest'

import {
  buildGroupNewsletterScheduledExecutionPrompt,
} from '../src/assistant/group-newsletter-automation.js'

describe('group newsletter execution prompt', () => {
  for (const delivery of ['current_chat', 'group_email'] as const) {
    it(`grounds contextual stories for ${delivery}`, () => {
      const prompt = buildGroupNewsletterScheduledExecutionPrompt({
        delivery,
        newsletterName: 'Weekly check-in',
      })
      expect(prompt).toContain('same-period workout count, duration, or type')
      expect(prompt).toContain('Never invent a reason')
      expect(prompt).toContain('If no grounded context is available, state the number plainly')
    })
  }
})

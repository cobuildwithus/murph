import { describe, expect, it } from 'vitest'

import {
  appendLegacyGroupNewsletterSkillInstructions,
  isLegacyGroupNewsletterAutomationInstructions,
} from '../src/assistant/group-newsletter-automation.js'

const legacyInstructions = [
  'Murph group newsletter configuration v1.',
  'These are configuration values. The runtime appends the current execution contract on every scheduled run.',
  'Newsletter name: "Weekly check-in"',
  'Delivery: group_email',
].join('\n')

describe('legacy group newsletter automation compatibility', () => {
  it('routes a legacy saved recipe through the group-newsletter skill', () => {
    expect(isLegacyGroupNewsletterAutomationInstructions(legacyInstructions))
      .toBe(true)
    expect(appendLegacyGroupNewsletterSkillInstructions(legacyInstructions))
      .toContain('Read and follow the group-newsletter skill')
    expect(appendLegacyGroupNewsletterSkillInstructions(legacyInstructions))
      .toContain('Legacy saved configuration:')
    expect(appendLegacyGroupNewsletterSkillInstructions(legacyInstructions))
      .not.toContain('runtime appends the current execution contract')
  })

  it('leaves ordinary automation instructions unchanged', () => {
    const ordinary = 'Read the group-newsletter skill, then prepare the weekly update.'
    expect(isLegacyGroupNewsletterAutomationInstructions(ordinary)).toBe(false)
    expect(appendLegacyGroupNewsletterSkillInstructions(ordinary)).toBe(ordinary)
  })
})

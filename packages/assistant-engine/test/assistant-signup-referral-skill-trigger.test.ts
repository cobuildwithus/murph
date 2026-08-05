import { describe, expect, it } from 'vitest'

import { ASSISTANT_SKILLS } from '../src/assistant-skill-assets.js'

describe('assistant signup referral skill trigger', () => {
  it('loads referral guidance for an explicit shareable signup-link request', () => {
    const skill = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'hosted-low-usage',
    )

    expect(skill?.triggerHint).toContain(
      'signup, invite, share, or referral link to send someone',
    )
  })
})

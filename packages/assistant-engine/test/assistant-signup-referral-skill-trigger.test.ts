import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

describe('assistant signup referral guidance', () => {
  it('loads referral guidance for an explicit shareable signup-link request', () => {
    const skill = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'hosted-low-usage',
    )

    expect(skill?.triggerHint).toContain(
      'signup, invite, share, or referral link to send someone',
    )
  })

  it('keeps group introductions as the default and requires an explicit link ask', async () => {
    const skill = await readFile(
      path.join(
        resolveAssistantSkillsRoot(),
        'hosted-low-usage',
        'SKILL.md',
      ),
      'utf8',
    )
    const normalizedSkill = skill.replace(/\s+/gu, ' ')

    expect(normalizedSkill).toContain(
      'The existing group introduction flow remains the default',
    )
    expect(normalizedSkill).toContain(
      'Only after the current member explicitly asks for a signup, invite, referral, or shareable link to forward',
    )
    expect(normalizedSkill).toContain(
      '`murph.group action="create_signup_referral_link"`',
    )
    expect(normalizedSkill).toContain(
      'Murph returns the link to the requester and does not choose, contact, or message the recipient',
    )
    expect(normalizedSkill).toContain(
      'The link records signup attribution only',
    )
  })
})

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  buildAssistantSkillFileRef,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

describe('assistant signup link guidance', () => {
  it('loads a small dedicated skill only for an explicit shareable-link request', () => {
    const skill = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'signup-link',
    )
    const lowUsage = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'hosted-low-usage',
    )

    expect(skill?.triggerHint).toContain('explicitly asks')
    expect(skill?.triggerHint).toContain('shareable link')
    expect(buildAssistantSkillFileRef('signup-link')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/signup-link/SKILL.md',
    )
    expect(lowUsage?.triggerHint).not.toContain('signup link')
    expect(lowUsage?.triggerHint).not.toContain('invite link')
  })

  it('keeps group introductions as the default and separates attribution from rewards', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'signup-link', 'SKILL.md'),
      'utf8',
    )
    const normalizedSkill = skill.replace(/\s+/gu, ' ')

    expect(normalizedSkill).toContain(
      'The existing group-chat introduction flow remains the default',
    )
    expect(normalizedSkill).toContain(
      'Only when the current member explicitly asks for a signup, invite, referral, or shareable link to forward',
    )
    expect(normalizedSkill).toContain(
      '`action="create_signup_referral_link"`',
    )
    expect(normalizedSkill).toContain(
      'pass the exact accepted `message_ref` from the requester',
    )
    expect(normalizedSkill).toContain(
      'Never choose, contact, or message the recipient',
    )
    expect(normalizedSkill).toContain(
      'does not earn usage, complete a mission, or guarantee a reward',
    )
  })
})

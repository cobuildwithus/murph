import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

describe('Murph Family group setup handoff', () => {
  it('routes Family setup away from room funding at the skill index', () => {
    const family = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'murph-family',
    )
    const lowUsage = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'hosted-low-usage',
    )

    expect(family?.triggerHint).toContain(
      'are not group sponsorship, room funding, or room usage top-ups',
    )
    expect(lowUsage?.triggerHint).toContain(
      'is not room funding or a room usage top-up',
    )
    expect(lowUsage?.triggerHint).toContain('use murph-family')
    expect(lowUsage?.triggerHint).toContain(
      'unless the same request explicitly asks about funding or usage for the current room',
    )
  })

  it('offers a private conversation or stable link without room billing authority', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'murph-family', 'SKILL.md'),
      'utf8',
    )
    const normalized = skill.replace(/\s+/gu, ' ').trim()

    expect(normalized).toContain(
      'not the group\'s synthetic thread-container member',
    )
    expect(normalized).toContain(
      'This classification outranks generic group funding or usage language.',
    )
    expect(normalized).toContain(
      'Do not call `murph.group` usage or referral actions',
    )
    expect(normalized).toContain(
      'unless the same request explicitly asks about funding or usage for the current room.',
    )
    expect(normalized).toContain(
      'You can message me privately to set one up for your family, or click this link to do it:',
    )
    expect(normalized).toContain(
      'https://www.withmurph.ai/family/setup',
    )
    expect(normalized).toContain('Keep the raw URL on the final line.')
    expect(normalized).toContain(
      'The person starts the private conversation; do not initiate a private message from the group.',
    )
    expect(normalized).toContain(
      'It contains no member, group, checkout, invite, billing, or health-data identifiers',
    )
    expect(normalized).toContain(
      'Do not require an extra confirmation merely to send it.',
    )
    expect(normalized).toContain(
      'Do not call `murph.family_plan`, claim account state, choose an owner, or create a checkout or invite from the group runtime.',
    )
    expect(normalized).toContain(
      'Never return a generated Family checkout, top-up, or invite URL to a group.',
    )
  })
})

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

describe('Murph Family group setup handoff', () => {
  it('starts setup from the room without granting the room billing authority', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'murph-family', 'SKILL.md'),
      'utf8',
    )
    const normalized = skill.replace(/\s+/gu, ' ').trim()

    expect(normalized).toContain(
      'not the group\'s synthetic thread-container member',
    )
    expect(normalized).toContain(
      'send `https://www.withmurph.ai/family/setup` immediately',
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

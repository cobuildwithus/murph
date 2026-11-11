import { readdir } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  buildAssistantSkillFileRef,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

const skillRoot = path.join(resolveAssistantSkillsRoot(), 'goal-setup')

describe('assistant goal setup skill', () => {
  it('registers exactly one outcome-level setup route', () => {
    const matches = ASSISTANT_SKILLS.filter(
      ({ slug }) => slug === 'goal-setup',
    )

    expect(matches).toHaveLength(1)
    expect(matches[0]?.name).toBe('goal-setup')
    expect(buildAssistantSkillFileRef('goal-setup')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/goal-setup/SKILL.md',
    )
  })

  it('ships one concise orchestration file and no per-goal resources', async () => {
    expect(await readdir(skillRoot)).toEqual(['SKILL.md'])
  })
})

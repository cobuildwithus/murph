import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  buildAssistantSkillFileRef,
} from '../src/assistant-skill-assets.js'

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
})

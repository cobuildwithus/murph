import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

describe('experiment onboarding skill guidance', () => {
  async function readExperimentOnboardingSkill() {
    const skill = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'experiment-onboarding',
    )
    expect(skill).toBeTruthy()
    if (!skill) {
      throw new Error('experiment-onboarding skill is not registered')
    }

    return readFile(
      path.join(resolveAssistantSkillsRoot(), skill.slug, 'SKILL.md'),
      'utf8',
    )
  }

  it('requires first-session prep to include a compact walkthrough', async () => {
    const raw = await readExperimentOnboardingSkill()

    expect(raw).toContain(
      'First-session support is not just a time reminder.',
    )
    expect(raw).toContain(
      'give a brief first-session walkthrough in the current reply after creating the run',
    )
    expect(raw).toContain(
      'the one-shot prep automation must instruct the scheduled assistant to give that brief walkthrough at reminder time',
    )
    expect(raw).toContain(
      'Summarize only what the user needs for session one',
    )
    expect(raw).toContain(
      'Do not make the reminder merely say "you have a session" or "I can walk you through it."',
    )
    expect(raw).toContain(
      'This is the user\'s first time doing this experiment. If sending, give a brief first-session walkthrough, not just a reminder.',
    )
    expect(raw).toContain(
      'experimentOnboarding.planDefaults.firstSessionGuidance',
    )
    expect(raw).toContain('Keep it short and do not dump the full protocol.')
  })
})

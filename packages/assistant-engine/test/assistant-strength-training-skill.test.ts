import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

function buildPrompt(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'telegram',
    cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
    currentLocalDate: '2026-06-25',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: false,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
  })
}

async function readSkill(): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), 'strength-training', 'SKILL.md'),
    'utf8',
  )
}

describe('assistant strength training skill', () => {
  it('routes strength training turns through Murph assistant skills', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'strength-training: Use for ordinary strength and resistance-training questions for generally healthy adults',
    )
    expect(prompt).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/strength-training/SKILL.md',
    )
    expect(prompt).toContain(
      'Use `strength-training` for ordinary resistance-training programming, progression, plateaus, strength/hypertrophy/power goals, gym/home/calisthenics setup, competition preparation, and adherence coaching for generally healthy adults.',
    )
  })

  it('keeps the reusable planning references with the assistant skill', async () => {
    const skill = await readSkill()

    expect(skill).toContain('references/programming.md')
    expect(skill).toContain('references/coaching.md')
    expect(skill).toContain('references/safety.md')
    expect(skill).toContain('references/evidence.md')
    expect(skill).not.toContain('$murph-exercise-images')
  })
})

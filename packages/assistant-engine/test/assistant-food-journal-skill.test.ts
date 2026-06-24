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
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-06-24',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: false,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
  })
}

describe('assistant food journal skill', () => {
  it('routes food journaling without making nutrition estimates the default', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'food-journal: Use when the user logs meals or asks Murph to notice patterns',
    )
    expect(prompt).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/SKILL.md',
    )
    expect(prompt).toContain(
      'When logging supplements, workouts, or activities, capture the full recoverable structure',
    )
    expect(prompt).toContain(
      'Do not assume calorie or macro tracking is the purpose of a meal log.',
    )
    expect(prompt).toContain(
      'do not estimate or surface calories or macros unless asked.',
    )
    expect(prompt).toContain(
      'food/performance observation where nutrition detail is not needed',
    )
    expect(prompt).toContain(
      'When a specific food product is looked up because nutrition, ingredients, allergens, or exact identity matter',
    )
    expect(prompt).not.toContain('estimate calories first')
  })

  it('keeps observation runs bounded and composed from existing surfaces', async () => {
    const skillsRoot = resolveAssistantSkillsRoot()
    const [skill, onboarding] = await Promise.all([
      readFile(path.join(skillsRoot, 'food-journal', 'SKILL.md'), 'utf8'),
      readFile(path.join(skillsRoot, 'murph-onboarding', 'SKILL.md'), 'utf8'),
    ])

    expect(skill).toContain(
      'Do not create a new food-journal store, observation entity, scoring model, streak, or CLI family.',
    )
    expect(skill).toContain(
      'A photo, voice note, or rough phrase can be a complete meal log.',
    )
    expect(skill).toContain(
      'Use `behavior-followthrough` only when repeated support or missed logs become central.',
    )
    expect(skill).toContain(
      'one focus, a duration, a review point, and an off-ramp',
    )
    expect(skill).toContain(
      'store only its focus, window, and review preference in existing Context memory or confirmed automation instructions',
    )
    expect(skill).toContain(
      'performance work where nutrition detail materially affects the question',
    )
    expect(skill).toContain('Private is the default.')
    expect(onboarding).toContain(
      'A bounded observation run is a structured deferral, not a fourth experiment state.',
    )
    expect(onboarding).toContain(
      'Treat a meal photo, symptom report, or other health data as an immediate request',
    )
    expect(onboarding).toContain(
      'do not append an onboarding question in the same turn',
    )
  })
})

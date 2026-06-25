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
    currentLocalDate: '2026-06-25',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: false,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
  })
}

async function readSkills(): Promise<{
  nutrition: string
  foodJournal: string
}> {
  const root = resolveAssistantSkillsRoot()
  const [nutrition, foodJournal] = await Promise.all([
    readFile(path.join(root, 'nutrition-strategy', 'SKILL.md'), 'utf8'),
    readFile(path.join(root, 'food-journal', 'SKILL.md'), 'utf8'),
  ])
  return { nutrition, foodJournal }
}

describe('assistant nutrition strategy skill', () => {
  it('routes forward-looking strategy without stealing meal capture', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'nutrition-strategy: Use for forward-looking nutrition decisions',
    )
    expect(prompt).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/SKILL.md',
    )
    expect(prompt).toContain(
      'food-journal: Use when the user logs meals or asks Murph to notice patterns',
    )
  })

  it('stays policy-only and composes with existing owners', async () => {
    const { nutrition, foodJournal } = await readSkills()

    expect(nutrition).toMatch(/^---\nname: nutrition-strategy\n/)
    expect(nutrition).toContain(
      'Food-journal answers "what happened?" This skill answers "what should we do next?"',
    )
    expect(nutrition).toContain('Use `experiment-onboarding` after the user chooses')
    expect(nutrition).toContain('Use `behavior-followthrough` when reminders')
    expect(nutrition).toContain('Use `chronic-illness-support` and care navigation')
    expect(nutrition).toContain(
      'Do not add a nutrition store, diet-plan entity, calorie engine, body-composition score, adherence score, or nutrition-specific CLI.',
    )
    expect(foodJournal).toContain(
      'Use `nutrition-strategy` for forward-looking decisions about what to eat or change',
    )
    expect(nutrition).not.toContain('/tmp/')
    expect(nutrition).not.toContain('.codex-hosted')
  })

  it('uses silent reusable lanes and adaptive answer depth', async () => {
    const { nutrition } = await readSkills()

    for (const lane of [
      '### General healthy eating',
      '### Low-friction meal structure',
      '### Performance fueling',
      '### Body composition',
      '### Hydration',
      '### Under-fueling, low appetite, and recovery',
      '### Sensitive and escalation-aware handling',
    ]) {
      expect(nutrition).toContain(lane)
    }

    expect(nutrition).toContain('The coaching lanes below are internal routing aids.')
    expect(nutrition).toContain('do not force every reply into a template')
    expect(nutrition).toContain('### Use a numbers ladder')
    expect(nutrition).toContain('Do not give unsolicited calorie, macro, or weight-loss estimates.')
    expect(nutrition).toContain('Do not pathologize tracking that a user finds useful and non-distressing.')
    expect(nutrition).toContain('include an exit or step-down point')
    expect(nutrition).toContain('Treat appetite cues as information')
    expect(nutrition).toContain('treat estimated maintenance as a starting hypothesis')
  })

  it('keeps performance numbers bounded and qualified', async () => {
    const { nutrition } = await readSkills()

    expect(nutrition).toMatch(/1\.4-2\.0 g\/kg\/day/)
    expect(nutrition).toMatch(/target near 1\.6 g\/kg\/day/)
    expect(nutrition).toMatch(/up to about 2\.2 g\/kg\/day/)
    expect(nutrition).toMatch(/0\.25-0\.4 g\/kg/)
    expect(nutrition).toMatch(/30-60 g carbohydrate per hour/)
    expect(nutrition).toMatch(/as much as 90 g carbohydrate per hour/)
    expect(nutrition).toContain(
      'do not blindly turn it into a target',
    )
    expect(nutrition).toContain('Sodium does not make overdrinking safe.')
    expect(nutrition).toContain('gain body mass during exercise')
  })

  it('protects under-fueled, eating-disorder-sensitive, and acute contexts', async () => {
    const { nutrition } = await readSkills()

    expect(nutrition).toContain('can occur at any body size')
    expect(nutrition).toContain('Do not calculate energy availability or diagnose RED-S')
    expect(nutrition).toContain('little or nothing for about five days')
    expect(nutrition).toContain('refeeding can require medical monitoring')
    expect(nutrition).toContain(
      'Do not provide a calorie deficit, weight-loss target, compensatory exercise plan, fasting strategy, or detailed macro prescription.',
    )
    expect(nutrition).toContain('A benign food question does not need a repetitive warning.')
    expect(nutrition).toContain('Recommend urgent medical assessment')
    expect(nutrition).toContain(
      'Medical stability, adequate fueling, and eating-disorder recovery outrank body-composition optimization.',
    )
  })
})

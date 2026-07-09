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
  it('routes meal execution without stealing meal capture, body composition, or digestion', () => {
    const prompt = buildPrompt()
    const nutritionLine = prompt
      .split('\n')
      .find((line) => line.includes('nutrition-strategy:'))

    expect(nutritionLine).toContain(
      'Use for forward-looking nutrition decisions about meal structure',
    )
    expect(nutritionLine).toContain('training fuel and recovery eating')
    expect(nutritionLine).toContain('real-life food-system execution')
    expect(nutritionLine).toContain('Use food-journal for meal capture')
    expect(nutritionLine).toContain('body-composition for fat loss/muscle gain/recomposition')
    expect(nutritionLine).toContain('gut-digestion for digestive symptom strategy')
    expect(nutritionLine).not.toContain('body composition, training fuel')
    expect(nutritionLine).not.toContain('GI comfort')
    expect(prompt).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/SKILL.md',
    )
    expect(prompt).toContain(
      'food-journal: Use when the user logs meals or asks Murph to notice patterns',
    )
  })

  it('keeps prompt guidance focused on meal execution and focused-owner handoffs', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'For forward-looking nutrition advice about meal structure, protein, training fuel, recovery eating, hydration, appetite or under-fueling, or realistic food-system execution, read `$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/SKILL.md` before recommending what to eat or change.',
    )
    expect(prompt).toContain(
      'Use food-journal for capture and retrospective observation, body-composition for fat-loss, muscle-gain, recomposition, weight, waist, or plateau strategy, gut-digestion for digestive symptom strategy, and experiment-onboarding only after the user chooses a bounded change to test.',
    )
  })

  it('stays policy-only and composes with existing owners', async () => {
    const { nutrition, foodJournal } = await readSkills()

    expect(nutrition).toMatch(/^---\nname: nutrition-strategy\n/)
    expect(nutrition).toContain(
      'Food-journal answers "what happened?" This skill answers "what should we do next?"',
    )
    expect(nutrition).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/body-composition/SKILL.md')
    expect(nutrition).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/gut-digestion/SKILL.md')
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

  it('uses practical lanes without owning body-composition or digestion strategy', async () => {
    const { nutrition } = await readSkills()

    for (const lane of [
      '### Meal structure',
      '### Protein',
      '### Performance fueling',
      '### Hydration',
      '### Under-fueling, low appetite, and recovery',
      '### Sensitive and escalation-aware handling',
    ]) {
      expect(nutrition).toContain(lane)
    }

    expect(nutrition).toContain('It is not the owner for body-composition strategy or digestive symptom strategy.')
    expect(nutrition).toContain('The lowest useful tracking burden wins')
    expect(nutrition).toContain('Do not give unsolicited calorie, macro, or weight-loss estimates.')
    expect(nutrition).toContain('Treat appetite cues as information')
    expect(nutrition).not.toContain('### Body composition')
    expect(nutrition).not.toContain('### GI comfort and performance')
  })

  it('keeps performance numbers bounded and qualified', async () => {
    const { nutrition } = await readSkills()

    expect(nutrition).toMatch(/1\.4-2\.0 g\/kg\/day/)
    expect(nutrition).toMatch(/target near 1\.6 g\/kg\/day/)
    expect(nutrition).toMatch(/up to about 2\.2 g\/kg\/day/)
    expect(nutrition).toMatch(/0\.25-0\.4 g\/kg/)
    expect(nutrition).toMatch(/30-60 g carbohydrate per hour/)
    expect(nutrition).toMatch(/as much as 90 g carbohydrate per hour/)
    expect(nutrition).toContain('do not blindly turn it into a target')
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
      'Medical stability, adequate fueling, and eating-disorder recovery outrank appearance, performance, and optimization.',
    )
  })
})

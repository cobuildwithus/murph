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
  gut: string
}> {
  const root = resolveAssistantSkillsRoot()
  const [nutrition, foodJournal, gut] = await Promise.all([
    readFile(path.join(root, 'nutrition-strategy', 'SKILL.md'), 'utf8'),
    readFile(path.join(root, 'food-journal', 'SKILL.md'), 'utf8'),
    readFile(path.join(root, 'gut-digestion', 'SKILL.md'), 'utf8'),
  ])
  return { nutrition, foodJournal, gut }
}

describe('assistant nutrition strategy skill', () => {
  it('routes meal execution without repeating every skill trigger hint', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'Nutrition/metabolic: food-journal, nutrition-strategy, body-composition, gut-digestion',
    )
    expect(prompt).toContain(
      'Food-journal owns capture and retrospective patterns; nutrition-strategy owns forward meal execution and named-diet evaluation; body-composition owns weight/waist/recomposition; gut-digestion owns digestive symptoms and elimination/reintroduction',
    )
    expect(prompt).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/<slug>/SKILL.md')
    expect(prompt).not.toContain(
      'For forward-looking nutrition advice about meal structure, protein, training fuel',
    )
  })

  it('keeps the compact router bounded to task-relevant skill reads', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      "Route by the user's visible outcome and read the primary owner.",
    )
    expect(prompt).toContain(
      'inspect at most two candidates; this cap is discovery-only',
    )
    expect(prompt).toContain(
      'follow explicit handoffs and load every distinct safety or execution owner',
    )
    expect(prompt).toContain('Do not preload skills or call a discovery CLI just to route.')
  })

  it('stays policy-only and composes with existing owners', async () => {
    const { nutrition, foodJournal, gut } = await readSkills()

    expect(nutrition).toMatch(/^---\nname: nutrition-strategy\n/)
    expect(nutrition).toContain(
      'named diets and dietary patterns',
    )
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
    expect(nutrition).toContain(
      'A named diet is a rule package, not the user\'s goal.',
    )
    expect(nutrition).toContain(
      'Popularity is evidence of demand, not efficacy.',
    )
    expect(nutrition).toContain(
      'Child references are progressive disclosure, not separately registered skills.',
    )
    for (const reference of [
      'intermittent-fasting.md',
      'low-carbohydrate.md',
      'ketogenic.md',
      'mediterranean.md',
      'carnivore-animal-based.md',
      'vegan-plant-based.md',
      'vegetarian-spectrum.md',
      'dash.md',
    ]) {
      expect(nutrition).toContain(`references/named-diets/${reference}`)
    }
    expect(foodJournal).toContain(
      'Use `nutrition-strategy` for forward-looking decisions about what to eat or change',
    )
    expect(nutrition).toContain(
      'When exact food identity, ingredients, allergens, or label nutrition could change a recommendation, read `food-journal`',
    )
    expect(gut).toContain(
      "When exact product ingredients or allergens could change the digestive plan, read food-journal's exact-label section",
    )
    expect(gut).toContain(
      'Use nutrition-strategy for broad diet planning once the digestion constraint is understood.',
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

    expect(nutrition).toContain('It is not the owner for body-composition strategy, digestive symptom strategy, or clinician-managed therapeutic diets.')
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
    expect(nutrition).toContain('supplement dosing, fasting, or personalized fluid/electrolyte plans')
    expect(nutrition).toContain('an older adult with frailty, sarcopenia, or low intake')
    expect(nutrition).toContain(
      'Do not provide a calorie deficit, weight-loss target, compensatory exercise plan, fasting strategy, or detailed macro prescription.',
    )
    expect(nutrition).toContain('A benign food question does not need a repetitive warning.')
    expect(nutrition).toContain('Recommend urgent medical assessment')
    expect(nutrition).toContain(
      'Medical stability, adequate fueling, and eating-disorder recovery outrank appearance, performance, and optimization.',
    )
  })

  it('routes named diets through bounded, non-registered child references', async () => {
    const { nutrition } = await readSkills()

    expect(nutrition).toContain('## Named Diets And Dietary Patterns')
    expect(nutrition).toContain('Answer a direct factual question before asking about goals.')
    expect(nutrition).toContain('Do not infer one exact implementation from a label.')
    expect(nutrition).toContain('direct health-outcome evidence')
    expect(nutrition).toContain(
      '`gut-digestion` owns symptom-driven elimination and reintroduction, including low-FODMAP-style work.',
    )
    expect(nutrition).toContain(
      '`cardiometabolic-health`, `chronic-illness-support`, care navigation, and the user\'s clinician own marker-first',
    )
    expect(nutrition).toContain('preserve the useful core with the least avoidable restriction')
    expect(nutrition).toContain('Do not use purity, moral, identity, or compliance framing.')
    expect(nutrition).toContain('do not scan the directory, invent an absent file, or preload references')
    expect(nutrition).toContain('Read at most one mapped child for a narrow question')
    expect(nutrition).toContain('two only when the user explicitly compares two patterns')
    expect(nutrition).toContain('For an unmapped named diet, use this parent contract')
    expect(nutrition).not.toContain('diet-patterns/SKILL.md')
    expect(nutrition).not.toContain('named-diets/SKILL.md')
  })
})

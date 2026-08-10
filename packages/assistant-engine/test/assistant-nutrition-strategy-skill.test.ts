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
  bodyComposition: string
  cardGoals: string
}> {
  const root = resolveAssistantSkillsRoot()
  const [nutrition, foodJournal, gut, bodyComposition, cardGoals] =
    await Promise.all([
      readFile(path.join(root, 'nutrition-strategy', 'SKILL.md'), 'utf8'),
      readFile(path.join(root, 'food-journal', 'SKILL.md'), 'utf8'),
      readFile(path.join(root, 'gut-digestion', 'SKILL.md'), 'utf8'),
      readFile(path.join(root, 'body-composition', 'SKILL.md'), 'utf8'),
      readFile(
        path.join(
          root,
          'nutrition-strategy',
          'references',
          'daily-nutrition-card-goals.md',
        ),
        'utf8',
      ),
    ])
  return { nutrition, foodJournal, gut, bodyComposition, cardGoals }
}

describe('assistant nutrition strategy skill', () => {
  it('routes meal execution without repeating every skill trigger hint', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'Nutrition/metabolic: food-journal, nutrition-strategy, body-composition, gut-digestion',
    )
    expect(prompt).toContain(
      'Food-journal owns capture and retrospective patterns; nutrition-strategy forward meal execution; body-composition weight/waist/recomposition; gut-digestion digestive symptoms',
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

    expect(nutrition).toContain('It is not the owner for body-composition strategy or digestive symptom strategy.')
    expect(nutrition).toContain('The lowest useful tracking burden wins')
    expect(nutrition).toContain('Do not give unsolicited calorie, macro, or weight-loss estimates.')
    expect(nutrition).toContain('Treat appetite cues as information')
    expect(nutrition).not.toContain('### Body composition')
    expect(nutrition).not.toContain('### GI comfort and performance')
  })

  it('grounds first-card goals in one researched, explanation-first owner', async () => {
    const { bodyComposition, cardGoals, nutrition } = await readSkills()
    const compactGoals = cardGoals.replace(/\s+/gu, ' ').trim()

    expect(nutrition).toContain('### Daily nutrition-card goals')
    expect(nutrition).toContain('references/daily-nutrition-card-goals.md')
    expect(nutrition).toContain('the single canonical Goal proposal')
    expect(nutrition).toContain('explanation-before-card')
    expect(bodyComposition).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-goals.md',
    )

    for (const source of [
      'https://www.ncbi.nlm.nih.gov/books/NBK591034/',
      'https://www.ncbi.nlm.nih.gov/books/NBK208874/',
      'https://link.springer.com/article/10.1186/s12970-017-0177-8',
      'https://www.ncbi.nlm.nih.gov/books/NBK208887/',
      'https://pubmed.ncbi.nlm.nih.gov/35233712/',
      'https://pubmed.ncbi.nlm.nih.gov/31247944/',
      'https://pubmed.ncbi.nlm.nih.gov/34623696/',
    ]) {
      expect(cardGoals).toContain(source)
    }

    expect(compactGoals).toContain('2023 National Academies EER equation')
    expect(cardGoals).toContain('5-10% above maintenance')
    expect(cardGoals).toContain('10-20% below maintenance')
    expect(cardGoals).toContain('1.6 g/kg/day')
    expect(cardGoals).toContain('1.4 g/kg/day')
    expect(cardGoals).toContain('0.8 g/kg/day')
    expect(cardGoals).toContain('adult 10-35% protein AMDR')
    expect(cardGoals).toContain('45-65% AMDR')
    expect(cardGoals).toContain('fat within 20-35%')
    expect(cardGoals).toContain('14 g per 1,000 kcal')
    expect(cardGoals).toContain('Round the final target to the nearest 100 kcal')
    expect(compactGoals).toContain('Round to the nearest 5 g')

    expect(compactGoals).toContain(
      'Reuse at most one Goal with slug `murph-daily-nutrition-starting-targets`.',
    )
    expect(compactGoals).toContain(
      'Use this only after an explicit interactive request to set nutrition targets or to receive a numeric daily nutrition card',
    )
    expect(compactGoals).toContain(
      'A scheduled closeout may use an already accepted active bundle, but it must not use this workflow to ask for inputs, derive or save targets, or surface a proposal.',
    )
    expect(compactGoals).toContain('status `paused`')
    expect(compactGoals).toContain('vault-cli goal import-json --input -')
    expect(compactGoals).toContain('kind: "metric"')
    expect(compactGoals).toContain(
      "Supplying `metricTargets` replaces that Goal's stored array",
    )
    expect(compactGoals).toContain(
      'every edit or overlap removal must therefore send the complete intended post-update array for the managed Goal.',
    )
    expect(compactGoals).toContain(
      'Preserve every unchanged target and stable target id, and omit only a metric deliberately removed because an explicit owner now exists.',
    )
    expect(compactGoals).toContain(
      'Read the Goal back and verify the complete retained set',
    )
    expect(compactGoals).toContain(
      'A turn that creates or changes the paused proposal must be ordinary text, never a card.',
    )
    expect(compactGoals).toContain(
      'Briefly name all five effective values, which facts and labeled assumptions materially drove them, and why calories, protein, carbohydrate, fat, and fiber landed there.',
    )
    expect(compactGoals).toContain(
      'Call them provisional and invite correction or acceptance.',
    )
    expect(compactGoals).toContain(
      'vault-cli goal save "Daily nutrition targets" --id <goal-id> --status active',
    )
    expect(compactGoals).toContain('first re-read target authority')
    expect(compactGoals.indexOf('first re-read target authority')).toBeLessThan(
      compactGoals.indexOf(
        'vault-cli goal save "Daily nutrition targets" --id <goal-id> --status active',
      ),
    )
    expect(compactGoals).toContain(
      'Only a later eligible response with five scalar values resolved from active canonical goals may attach the card.',
    )
    expect(compactGoals).toContain(
      'A member- or clinician-chosen active target always wins for its metric.',
    )
    expect(compactGoals).toContain(
      "send the managed Goal's complete retained array without that overlapping metric; never edit the explicit Goal.",
    )
    expect(compactGoals).toContain(
      'If the member declines, update the same Goal to `abandoned`.',
    )
    expect(compactGoals).toContain(
      'On an interactive card request, explain an existing paused proposal again',
    )
    expect(compactGoals).toContain(
      'an abandoned or completed record is an opt-out and must not be recreated automatically.',
    )
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
    const { cardGoals, nutrition } = await readSkills()

    expect(nutrition).toContain('can occur at any body size')
    expect(cardGoals).toContain(
      'Do not derive, save, or surface numeric goals',
    )
    const compactGoals = cardGoals.replace(/\s+/gu, ' ').trim()

    expect(compactGoals).toContain('under-fueling or RED-S concern')
    expect(cardGoals).toContain('anyone under 18')
    expect(compactGoals).toContain('pregnancy or breastfeeding')
    expect(compactGoals).toContain('glucose-lowering medication')
    expect(compactGoals).toContain('another clinician-managed nutrition context')
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

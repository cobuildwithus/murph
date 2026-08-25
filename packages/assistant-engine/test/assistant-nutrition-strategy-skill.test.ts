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
  const [
    nutrition,
    foodJournal,
    gut,
    bodyComposition,
    cardGoals,
  ] =
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
  return {
    nutrition,
    foodJournal,
    gut,
    bodyComposition,
    cardGoals,
  }
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
    expect(nutrition).toContain(
      'Outside the one first-run managed closeout proposal below, do not give',
    )
    expect(nutrition).toContain('Treat appetite cues as information')
    expect(nutrition).not.toContain('### Body composition')
    expect(nutrition).not.toContain('### GI comfort and performance')
  })

  it('grounds first-card goals in one researched, explanation-first owner', async () => {
    const { bodyComposition, cardGoals, nutrition } = await readSkills()
    const compactGoals = cardGoals.replace(/\s+/gu, ' ').trim()

    expect(nutrition).toContain('### Daily nutrition-card goals')
    expect(nutrition).not.toContain('daily-nutrition-card-safety.md')
    expect(nutrition).toContain('references/daily-nutrition-card-goals.md')
    expect(nutrition).toContain('prompt owns the numeric-suitability rule')
    expect(nutrition).toContain('one compact safety question')
    expect(nutrition).toContain(
      'a routine card with accepted goals does not repeat screening',
    )
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
      'https://www.ncbi.nlm.nih.gov/books/NBK591042/',
      'https://www.ncbi.nlm.nih.gov/books/NBK278991/',
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
    expect(compactGoals).toContain('1.4 g/kg/day')
    expect(compactGoals).toContain('0.8 g/kg/day')
    expect(cardGoals).toContain('10-35% protein AMDR')
    expect(cardGoals).toContain('carbohydrate within 45-65%')
    expect(compactGoals).toContain('Fat must remain within 20-35%')
    expect(cardGoals).toContain('14 g per 1,000 kcal')
    expect(cardGoals).toContain('Round the final target to the nearest 100 kcal')
    expect(compactGoals).toContain(
      'Round each derived missing macro to the nearest 5 g',
    )
    expect(compactGoals).toContain(
      'If the adjusted or rounded target is below 1,200 kcal/day, stop',
    )
    expect(compactGoals).toContain(
      'Hold those applicable, compatible explicit targets fixed.',
    )
    expect(compactGoals).toContain(
      'With exactly one macro missing, assign that macro the remaining energy.',
    )
    expect(compactGoals).toContain(
      'clamp it to the feasible value nearest that preference',
    )
    expect(compactGoals).toContain(
      'choose the feasible fat share closest to 30%, or closest to 25% when running or another endurance demand is material',
    )
    expect(compactGoals).toContain(
      '`4*protein + 4*carbohydrate + 9*fat` must be within 50 kcal of the calorie target.',
    )
    expect(compactGoals).toContain(
      'If the residual is negative, the feasible interval is empty, rounding breaks an AMDR or the 50 kcal tolerance, or known inputs cannot prove one result, do not write or update the Goal.',
    )
    expect(compactGoals).toContain(
      'explicit 2,000 kcal, 150 g protein, and 250 g carbohydrate',
    )
    expect(compactGoals).toContain(
      'With the same calories and protein but explicit 300 g carbohydrate',
    )

    expect(compactGoals).toContain(
      'Reuse at most one Goal with slug `murph-daily-nutrition-starting-targets`.',
    )
    expect(compactGoals).toContain(
      'Use the target-authority and canonical-discovery rules below after every explicit interactive request to set nutrition targets or receive a numeric daily nutrition card, even when the visible context appears to contain a complete bundle.',
    )
    expect(compactGoals).toContain(
      'run `vault-cli goal list --status active --limit 200 --format json`.',
    )
    expect(compactGoals).toContain(
      'If it returns 200 records, the bounded read may be incomplete: fail closed with ordinary text, no Goal or measurement mutation, and no card.',
    )
    expect(compactGoals).toContain(
      'run `vault-cli goal show <goal-id> --format json` for every returned active Goal whose list item reports a nonzero `data.metricTargetsCount`.',
    )
    expect(compactGoals).toContain(
      'Do not select detail reads by title, slug, domain, context-snapshot visibility, or the default list prefix.',
    )
    expect(compactGoals).toContain(
      'Keep this active-target authority read separate from the all-status lookup used below to reuse or honor Murph\'s managed paused or abandoned proposal',
    )
    expect(compactGoals).toContain(
      'Use context already known or read only what a concrete concern requires; do not fan out across unrelated clinical history.',
    )
    expect(compactGoals).toContain(
      'Separately run `vault-cli goal list --limit 200 --format json`',
    )
    expect(compactGoals).toContain(
      'It authorizes only the one paused canonical proposal below so the provisional values do not live in transient assistant state; it does not accept, activate, or use those targets.',
    )
    expect(nutrition).toContain(
      'The narrow paused daily-card proposal below has two initiation paths:',
    )
    expect(nutrition).toContain(
      'an explicit numeric-card request, or the first eligible managed automatic meal',
    )
    expect(compactGoals).toContain(
      'The owning automatic-meal-capture skill may also use this workflow for one first eligible managed closeout',
    )
    expect(compactGoals).toContain(
      'a complete all-status Goal read proves that no Goal with slug `murph-daily-nutrition-starting-targets` exists in any status.',
    )
    expect(compactGoals).toContain(
      'That scheduled exception may use only already-known responsible inputs, creates and explains one paused proposal in ordinary text, asks no question, attaches no card, and never activates the proposal.',
    )
    expect(compactGoals).toContain(
      'Once the managed Goal exists in any status, later scheduled closeouts may use an accepted active bundle but never create, change, or automatically repeat a numeric proposal.',
    )
    expect(compactGoals).toContain('status `paused`')
    expect(compactGoals).toContain(
      'Before that first write, establish one proposal-effective local date.',
    )
    expect(compactGoals).toContain(
      "Use the member's explicitly requested effective date when present; otherwise use the selected card `localDate` for a dated card request, including a historical date; otherwise use the engine-supplied current vault-local date for an undated target or card request.",
    )
    expect(compactGoals).toContain(
      'Include `window: { startAt: <proposal-effective-localDate> }` in the initial `goal import-json` payload.',
    )
    expect(compactGoals).toContain(
      "Do not rely on the Goal owner's write-day default or substitute a wall-clock date.",
    )
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
      'Read the Goal back and verify the complete retained set and window',
    )
    expect(compactGoals).toContain(
      'Preserve the existing Goal window on every later value, overlap-removal, status, or card-request turn; omit `window` from those patches and never silently rebase it to another requested card date.',
    )
    expect(compactGoals).toContain(
      "Change the window only when the member explicitly changes the proposal's effective date, then explain that revision and verify the complete record.",
    )
    expect(compactGoals).toContain(
      'Any write that adds or changes a derived managed value must include `status: "paused"` atomically, even when the same Goal was active',
    )
    expect(compactGoals).toContain(
      'Removing an overlapping metric without adding or changing a derived value may leave the managed Goal active',
    )
    expect(compactGoals).toContain(
      'A turn that creates or changes the paused proposal must be ordinary text, never a card.',
    )
    expect(compactGoals).toContain(
      'Briefly name all five effective values, which facts and labeled assumptions materially drove them, and why calories, protein, carbohydrate, fat, and fiber landed there.',
    )
    expect(compactGoals).toContain(
      'State the proposal-effective date, especially when it is historical or future.',
    )
    expect(compactGoals).toContain(
      'Call the values provisional and invite correction or acceptance.',
    )
    expect(compactGoals).toContain(
      'vault-cli goal save "Daily nutrition targets" --id <goal-id> --status active',
    )
    expect(compactGoals.indexOf('reapply the card tool\'s known-context numeric-suitability rule')).toBeLessThan(
      compactGoals.indexOf(
        'vault-cli goal save "Daily nutrition targets" --id <goal-id> --status active',
      ),
    )
    expect(compactGoals).toContain(
      'its next unambiguous acceptance may be the first later eligible response',
    )
    expect(compactGoals).toContain(
      'after the known-context suitability rule in step 5 passes, activate and read back the Goal, re-read same-date canonical meal totals, and attach exactly one card in that acceptance response',
    )
    expect(compactGoals).toContain(
      'leave the proposal paused and unchanged, surface no target values, use ordinary non-numeric text, and attach no card.',
    )
    expect(compactGoals).toContain(
      'A target-setting-only request, correction, decline, ambiguous acceptance, or compound request remains ordinary text with no card.',
    )
    expect(compactGoals).toContain(
      'Otherwise, a later eligible response may attach the card only when the target-authority read above resolves one complete, unambiguous card-authorizing bundle.',
    )
    expect(compactGoals).toContain(
      'Consume that resolved bundle directly; do not restate accepted metric keys or require a second `dietary-calories` owner after calorie resolution.',
    )
    expect(compactGoals).not.toContain(
      'five-value bundle from active canonical Goals',
    )
    expect(compactGoals).toContain(
      'A member- or clinician-chosen active target always wins for its metric.',
    )
    expect(compactGoals).toContain(
      'Comparator compatibility is part of target authority.',
    )
    expect(compactGoals).toContain(
      'This point-target card and its managed derivation normally accept a target only when its evaluation is `selected-value`, its comparator is `between`, and its numeric `value` and `highValue` are identical.',
    )
    expect(compactGoals).toContain(
      'The complete same-Goal historical `daily-*` nutrition set below has one read-only display-compatibility path',
    )
    expect(compactGoals).toContain(
      '`evaluation.kind: rolling-window` plus `selectionPolicyOverride.kind: daily-aggregate` with a unit-preserving statistic, never `count`.',
    )
    expect(compactGoals).toContain(
      'preserve the Goal, and never extend this exception to another target identity or workflow.',
    )
    expect(compactGoals).toContain(
      'A mixed evaluation bundle or any other rolling or aggregate shape is incompatible.',
    )
    expect(compactGoals).toContain(
      'A one-sided `<`, `<=`, `>`, or `>=` threshold, a non-identical `between` range, or any other target shape remains authoritative canonical state but is incompatible with this workflow.',
    )
    expect(compactGoals).toContain(
      'do not expose, compare, or copy it into the card; use it for the 1,200 kcal boundary, residual-energy, or fiber calculations; or create, replace, or remove managed targets around it.',
    )
    expect(compactGoals).toContain(
      'Use ordinary text or one narrow interactive question without mutation; a scheduled closeout asks nothing and sends no card.',
    )
    expect(compactGoals).toContain(
      'Unit compatibility is part of target authority.',
    )
    expect(compactGoals).toContain(
      'Calorie metric compatibility has one narrow read-only exception for an existing complete nutrition Goal.',
    )
    expect(compactGoals).toContain(
      'When exactly one compatible canonical owner remains, use it and ignore every `calories` target',
    )
    expect(compactGoals).toContain(
      'Only when no canonical owner exists may the historical target `daily-calories` with metric `calories` and unit `kcal` fill the card\'s calorie slot.',
    )
    expect(compactGoals).toContain(
      '`daily-protein` / `protein-grams` / `g`, `daily-carbohydrates` / `carbs-grams` / `g`, `daily-fat` / `fat-grams` / `g`, and `daily-fiber` / `fiber-grams` / `g`.',
    )
    expect(compactGoals).toContain(
      'Any other `calories` target is not dietary authority, even when co-located with all four macro and fiber metrics.',
    )
    expect(compactGoals).toContain(
      'Do not use titles, slugs, domains, descriptions, or guessed intent as authority.',
    )
    expect(compactGoals).not.toContain(
      'five exact point values in the exact canonical metric/unit pairs resolved from active canonical goals',
    )
    expect(compactGoals).toContain(
      'This fixed-unit workflow accepts the resolved calorie owner above in `kcal`, and `protein-grams`, `carbs-grams`, `fat-grams`, and `fiber-grams` in `g`.',
    )
    expect(compactGoals).toContain(
      'its raw value must not be compared with the 1,200 kcal boundary, copied into a card, or used by the residual-energy or fiber calculations.',
    )
    expect(compactGoals).toContain(
      'perform no managed Goal mutation, use ordinary text or one narrow interactive question, and let a scheduled closeout use ordinary text without a question or card.',
    )
    expect(compactGoals).toContain(
      "Run this only after the calorie target and every explicit protein, carbohydrate, and fat target are proven applicable to the proposal's card date and exact points with comparator `between` and identical endpoints, then prove the calorie target is in `kcal` and each macro target is in `g`.",
    )
    expect(compactGoals).toContain('Effective dates are also part of target authority.')
    expect(compactGoals).toContain(
      'Resolve them against the exact card `localDate`: the selected capture date for a scheduled closeout, which may be a historical catch-up date rather than the occurrence date, or the explicitly requested date.',
    )
    expect(compactGoals).toContain(
      'Never use wall-clock today as a substitute.',
    )
    expect(compactGoals).toContain(
      '`window.startAt <= localDate` and its optional `window.targetAt` is absent or `localDate <= window.targetAt`.',
    )
    expect(compactGoals).toContain(
      'An out-of-window target remains canonical authority for its own period, but it is not a current owner or conflict',
    )
    expect(compactGoals).toContain(
      'If one complete applicable bundle does not remain, use ordinary text or one narrow interactive question with no mutation; a scheduled closeout asks nothing and sends no card.',
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
    expect(compactGoals).toContain(
      'do not fan out across unrelated clinical history',
    )
    expect(compactGoals).toContain(
      'If known context suppresses numeric guidance, make no Goal or measurement mutation',
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
    const { nutrition } = await readSkills()

    expect(nutrition).toContain('can occur at any body size')
    expect(nutrition).toContain('one compact safety question')
    expect(nutrition).toContain(
      'do not add a universal medical-history or measurement\npreflight',
    )
    expect(nutrition).toContain(
      'Apply that rule only to the numeric target or guidance the known fact\nmaterially affects.',
    )
    expect(nutrition).toContain(
      'An allergy, intolerance, dietary restriction, or\nclinician-directed diet is not by itself a reason to suppress benign totals or\nan accepted compatible target bundle.',
    )
    expect(nutrition).toContain(
      'A scheduled occurrence with unresolved suitability uses ordinary nonnumeric\ncloseout text and makes no proposal, mutation, question, or card.',
    )
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

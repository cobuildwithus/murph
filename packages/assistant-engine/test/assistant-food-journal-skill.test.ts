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
  it('keeps food journaling discoverable in the compact skill router', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'Nutrition/metabolic: food-journal, nutrition-strategy, body-composition, gut-digestion, micronutrients-supplements',
    )
    expect(prompt).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/<slug>/SKILL.md',
    )
    expect(prompt).toContain(
      'Food-journal owns capture and retrospective patterns; nutrition-strategy owns forward meal execution and named-diet evaluation',
    )
    expect(prompt).toContain(
      'When exact food or supplement identity, ingredients, allergens, dose, or movement instruction matters, follow the owning skill',
    )
    expect(prompt).not.toContain('vault-cli food search-labels')
  })

  it('keeps observation runs bounded and composed from existing surfaces', async () => {
    const skillsRoot = resolveAssistantSkillsRoot()
    const [skill, onboarding, cardGoals] = await Promise.all([
      readFile(path.join(skillsRoot, 'food-journal', 'SKILL.md'), 'utf8'),
      readFile(path.join(skillsRoot, 'murph-onboarding', 'SKILL.md'), 'utf8'),
      readFile(
        path.join(
          skillsRoot,
          'nutrition-strategy',
          'references',
          'daily-nutrition-card-goals.md',
        ),
        'utf8',
      ),
    ])
    const compactCardGoals = cardGoals.replace(/\s+/gu, ' ').trim()

    expect(skill).toContain(
      'Do not create a new food-journal store, observation entity, scoring model, streak, or CLI family.',
    )
    expect(skill).toContain(
      'A photo, voice note, or rough phrase can be a complete meal log.',
    )
    expect(skill).toContain(
      'vault-cli meal nutrients --from <date> --to <date> --format json',
    )
    expect(skill).toContain(
      'A `null` total with zero\ncontributing meals means unavailable, not zero.',
    )
    expect(skill).toContain(
      'A `contributingMealCount` below\nthe enclosing `mealCount` means the total is partial',
    )
    expect(skill).toContain(
      'The aggregate may combine connected and manually saved meals.',
    )
    expect(skill).toContain(
      'Do not\nattribute its totals or coverage to one provider',
    )
    expect(skill).toContain(
      "Source-app targets, daily percentages, and completeness\nclaims are not imported.",
    )
    expect(skill).toContain(
      'use a current\nauthoritative source rather than a remembered target',
    )
    expect(skill).toContain(
      'folic acid, vitamin A, vitamin E, or niacin to DFE,\nRAE, alpha-tocopherol, or niacin-equivalent targets',
    )
    expect(skill).toContain(
      'One day of food records does not diagnose a\ndeficiency.',
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
      'Provide calorie and macro estimates by default when logging a meal',
    )
    expect(skill).toContain(
      'After every verified private meal mutation',
    )
    expect(skill).toContain(
      'default attachment intent for its eligible daily nutrition card',
    )
    expect(skill).toContain(
      'the card alone completely answers the turn',
    )
    expect(skill).toContain(
      'attach that card as the complete response with no companion prose',
    )
    expect(skill).toContain(
      'this is not an explicit numeric-card request and does not authorize target derivation, a paused proposal, or any Goal mutation',
    )
    expect(skill).toContain(
      'Without an already accepted complete bundle',
    )
    expect(skill).not.toContain(
      'Do not turn every meal confirmation into analysis or a nutrition report.',
    )
    expect(compactCardGoals).toContain(
      'An ordinary verified private meal log carries default attachment intent only.',
    )
    expect(compactCardGoals).toContain(
      'it does not authorize this proposal workflow, target setting, or any Goal mutation.',
    )
    expect(compactCardGoals).toContain(
      "When that accepted bundle is absent or any card gate fails, return the owning food-journal skill's short truthful fallback.",
    )
    expect(skill).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-safety.md',
    )
    expect(skill).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-goals.md',
    )
    expect(skill.indexOf('daily-nutrition-card-safety.md')).toBeLessThan(
      skill.indexOf('daily-nutrition-card-goals.md'),
    )
    expect(skill).toContain('even when all five goals already appear to exist')
    expect(skill).toContain(
      'complete active-condition\nand active-regimen discovery is mandatory before numeric target derivation as\nwell as before a card',
    )
    expect(skill).toContain(
      'the five-record context projection is not completeness\nproof',
    )
    expect(skill).toContain(
      'lifetime canonical procedure-event and encounter-diagnosis discovery,\nbounded body-measurement read, separate `pregnancy-test` measurement read, and\nbounded canonical test-event list plus required detail reads are likewise\nmandatory before deriving, saving, or surfacing a proposal and again before\nactivating one',
    )
    expect(skill).toContain(
      'complete `vault-cli memory show --format json` read is also mandatory',
    )
    expect(skill).toContain(
      'the snapshot does not inject the canonical Identity, Preferences,\nInstructions, and Context memory document',
    )
    expect(skill).toContain(
      'a failed or unreadable memory read\nfails closed, while missing or ambiguous age alone is not a universal block',
    )
    expect(skill).toContain(
      'target-authority and complete active-Goal discovery contract',
    )
    expect(skill).toContain(
      'before deciding that the five canonical daily goals are complete',
    )
    expect(skill).toContain(
      'Use its\nproposal workflow only if a target is genuinely missing after that read and the\nmember made an explicit numeric-card or target-setting request. Default meal-card\nintent never invokes it.',
    )
    expect(skill).toContain(
      'Treat a routine daily-card request, including a requested meal estimate needed\nfor that card, as one fulfillment workflow.',
    )
    expect(skill).toContain(
      'Skip progress when the pass will\nfinish within ordinary conversational latency',
    )
    expect(skill).toContain(
      'reply once with the card or\none concise truthful fallback',
    )
    expect(skill).toContain(
      'reuse the existing direct-turn progress owner for one brief, outcome-oriented\nacknowledgement before the first slow phase',
    )
    expect(skill).toContain(
      'Never narrate individual safety,\ntotals, estimation, or target-resolution mechanics.',
    )
    expect(skill).toContain(
      'first setup response explains a paused canonical proposal in ordinary text',
    )
    expect(skill).toContain('does not attach a goal-less card')
    expect(skill).toContain(
      'An unambiguous acceptance may complete the\npending explicit card request in that next response after the complete safety',
    )
    expect(skill).toContain(
      'recheck passes, activation and readback succeed, and a fresh same-date totals\nread completes.',
    )
    expect(skill).toContain('vault-cli food search-labels`')
    expect(skill).toContain('vault-cli food search-labels-batch`')
    expect(skill).toContain('Use `--generic` for ordinary ingredients')
    expect(skill).toContain(
      'For a fridge or pantry photo, enumerate distinct visible products and resolve\nthem in one batch.',
    )
    expect(skill).toContain(
      'preserve serving size and returned label\nnutrition on the meal with label-based provenance',
    )
    expect(skill).toContain(
      'save or update the food record with serving, ingredients,\nnutrition, and the label lookup id in provenance',
    )
    expect(skill).toContain(
      'Treat contaminant observations as exact-product lab context only.',
    )
    expect(skill).toContain(
      'absence of an exact test is not proof that a product is clean or safe',
    )
    expect(skill).toContain('Private is the default.')
    expect(onboarding).toContain(
      'Experiments are one optional primitive.',
    )
    expect(onboarding).toContain(
      'If the user arrives with a health question, decision, symptom, file, image,\nlab, meal, workout, data point, connection request, logging request, task, or\nsafety-sensitive need, handle it first.',
    )
    expect(onboarding).toContain(
      'Do not append an onboarding question to a reply about a meal photo, symptom,\nurgent concern, failed task, or other health-data request that should stand\nalone. Resume on a later relevant turn or through the finite managed next-day\nrecovery occurrence in `references/persistence-recovery-follow-up.md`.',
    )
  })
})

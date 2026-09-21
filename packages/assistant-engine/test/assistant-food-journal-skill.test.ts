import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { MURPH_ATTACH_RESPONSE_CARD_TOOL } from '../src/assistant-codex/dynamic-tool-catalog.js'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'
import { buildManualMealEstimationInstructions } from '../src/assistant/manual-meal-estimation.js'

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function buildPrompt(
  conversationScope: 'direct' | 'group' = 'direct',
): string {
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
    conversationScope,
    onboardingGuidance: false,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
  })
}

describe('assistant food journal skill', () => {
  it('composes direct meal execution with bounded official-source inspection', async () => {
    const root = resolveAssistantSkillsRoot()
    const instructions = compact([
      buildPrompt(),
      await readFile(path.join(root, 'food-journal/SKILL.md'), 'utf8'),
      await readFile(path.join(root, 'computer-use/SKILL.md'), 'utf8'),
    ].join('\n'))
    for (const rule of [
      'Do not list meals as a prerequisite to a new capture',
      'meal list --from <date> --to <same-date> --limit 50 --format json',
      '`meal list` has no `--date` option',
      'Use the typed save flags below directly',
      'A landing page is not a failed nutrition lookup',
      'use `computer_act` to follow its relevant menu/nutrition link or search for the exact item',
      'If the first page already contains the exact item and serving facts, use them without extra navigation',
      'Do not force a nutrition lookup, clarification, or safety preflight just to capture the meal',
      'Never invent an exact label',
    ]) {
      expect(instructions.includes(rule), rule).toBe(true)
    }
  })

  it('composes the saved-day summary with card authority without redundant reads', async () => {
    const root = resolveAssistantSkillsRoot()
    const food = compact(await readFile(path.join(root, 'food-journal/SKILL.md'), 'utf8'))
    const goals = compact(await readFile(path.join(root, 'nutrition-strategy/references/daily-nutrition-card-goals.md'), 'utf8'))
    const tool = MURPH_ATTACH_RESPONSE_CARD_TOOL.description
    for (const instructions of [food, goals, tool]) {
      expect(instructions).toContain('--with-daily-totals')
      expect(instructions).toContain('dailyTotals.data')
      expect(instructions).toContain('available')
    }
    expect(food).toContain('never repeat the meal mutation')
    expect(food).toContain('before adding estimates or `--with-daily-totals`, not after receiving totals')
    expect(food).toContain('Omit `--with-daily-totals` when numeric guidance is suppressed')
    expect(tool).not.toContain('Before every daily_nutrition card or explicit target-proposal decision, run')
    expect(food).toContain('Incomplete coverage still triggers the selected-date recovery')
    expect(food).toContain('Do not read the goal-derivation reference or full nutrition-strategy skill unless the member explicitly engages in target-setting')
  })

  it('composes manual estimation with ordinary meal recovery and numeric preferences', async () => {
    const instructions = [
      buildPrompt(),
      buildManualMealEstimationInstructions({
        mealId: 'meal_synthetic', capturedAt: '2026-06-24T12:00:00Z',
      }),
      await readFile(path.join(resolveAssistantSkillsRoot(), 'food-journal/SKILL.md'), 'utf8'),
      await readFile(path.join(resolveAssistantSkillsRoot(), 'automatic-meal-capture/SKILL.md'), 'utf8'),
    ].join('\n')
    expect(instructions).toContain('Complete that existing meal now')
    expect(instructions).toContain('ask one concise follow-up')
    expect(instructions).toContain('without estimate-enabling questions')
    expect(instructions).toContain('do not wait for nightly closeout or add a duplicate')
    expect(instructions).not.toContain('do not inspect or edit a different meal')
    expect(instructions).not.toContain('Only an explicit day-card request')
  })

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
      'In a private direct conversation, when someone asks how to start recurring meal tracking or how Murph can track meals, load both automatic-meal-capture and food-journal even when they do not say "automatic."',
    )
    expect(buildPrompt('group')).not.toContain(
      'when someone asks how to start recurring meal tracking or how Murph can track meals, load both automatic-meal-capture and food-journal',
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
    expect(compact(skill)).toContain(
      'In a private direct conversation, when the member asks how to start recurring meal tracking or how Murph can track meals, read `$MURPH_ASSISTANT_SKILLS_ROOT/automatic-meal-capture/SKILL.md` even when they do not say "automatic."',
    )
    expect(compact(skill)).toContain(
      'That skill owns whether the compatible-iPhone path or this skill\'s manual text, voice-note, and user-sent-photo path should lead based on known device, preference, and setup context.',
    )
    expect(compact(skill)).toContain(
      'For a generic group request, keep the response on group-safe manual capture',
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
      "the card completely answers the turn",
    )
    expect(skill).toContain(
      "Never add analysis,\nnumeric values, a second summary, or a follow-up question around that fixed copy.",
    )
    expect(skill).toContain(
      "Never author a mixed bundle or derive, propose, accept, activate, or mutate goals to send a summary.",
    )
    expect(skill).toContain(
      "`missing` uses five explicit null goals, even when a subset of compatible targets exists.",
    )
    expect(skill).not.toContain(
      'Do not turn every meal confirmation into analysis or a nutrition report.',
    )
    expect(compactCardGoals).toContain(
      "including ordinary meal replies and replies to scheduled check-ins.",
    )
    expect(compactCardGoals).toContain(
      "Only explicit target-setting intent authorizes the proposal workflow below.",
    )
    expect(compactCardGoals).toContain(
      "Conflict, incompatible and capacity remain text-only; never relabel them missing.",
    )
    expect(skill).not.toContain('daily-nutrition-card-safety.md')
    expect(skill).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-goals.md',
    )
    expect(skill).toContain(
      'apply the concise known-context\nnumeric-suitability rule in the `murph.attach_response_card` prompt',
    )
    expect(skill).toContain(
      'Do not run\na universal medical-history or measurement preflight.',
    )
    expect(skill).toContain(
      'target-authority and complete active-Goal discovery contract',
    )
    expect(skill).toContain(
      "before selecting the all-null or accepted all-five presentation.",
    )
    expect(skill).not.toContain(
      'before deciding that the five canonical daily goals are complete',
    )
    expect(skill).toContain(
      "and use its proposal workflow only for an explicit target-setting request,\nnever merely a meal log, daily summary, numeric-card request, or scheduled closeout.",
    )
    expect(skill).toContain(
      'Treat a routine daily-card request, including a requested meal estimate needed\nfor that card, as one fulfillment workflow.',
    )
    expect(skill).toContain(
      'Reply once with the card or one\nconcise truthful fallback',
    )
    expect(skill).toContain(
      'concise truthful fallback. Never narrate individual safety, totals, estimation,\nor target-resolution mechanics.',
    )
    expect(skill).toContain(
      '### Complete an interactive day before attaching its card',
    )
    expect(skill).toContain(
      "compare every\nmetric's `mealCount` with the top-level `mealCount`",
    )
    expect(skill).toContain(
      'List only that selected date, show the exact meals that lack\nnutrition',
    )
    expect(skill).toContain(
      "A member's current statement that the\nmeal is equivalent to a specific prior meal is usable evidence.",
    )
    expect(skill).toContain(
      'Use only the canonical meal surface for this recovery: `vault-cli meal list',
    )
    expect(skill).toContain(
      '`vault-cli meal show\n<meal-id> --format json`, and `vault-cli meal edit <meal-id>` with the typed',
    )
    expect(skill).toContain(
      '`--nutrition-calories`, `--nutrition-protein-grams`,',
    )
    expect(skill).toContain(
      '`--nutrition-confidence`, and `--nutrition-source-detail` flags.',
    )
    expect(skill).toContain(
      'Never inspect\nor modify raw vault files.',
    )
    expect(skill).toContain(
      'show the\nselected prior meal before copying its saved totals.',
    )
    expect(skill).toContain(
      'Use `--nutrition-source inherited` for\ncopied prior-meal totals',
    )
    expect(skill).toContain(
      'Use this selected-date recovery during private meal logging and estimation,',
    )
    expect(compact(skill)).not.toContain(
      'does not authorize reading, editing, or asking about another meal',
    )
    expect(skill).toContain(
      'A similar\ninformal name alone is not: require matching saved ingredients and portion\nevidence or ask instead of copying nutrition.',
    )
    expect(skill).toContain(
      'edit and read\nback the exact existing meal, then rerun fresh same-date totals before any card',
    )
    expect(skill).toContain(
      'ask one compact question for only\nthat missing detail and stop without a card',
    )
    expect(skill).toContain(
      'Do not ask merely to\nenable numeric output for an intuitive-eating, eating-disorder-risk, or\nnumber-sensitive member.',
    )
    expect(skill).toContain(
      'This generic recovery question is interactive-only.',
    )
    expect(skill).toContain(
      'partial-card schema and\nrendering remain compatibility surfaces, not the normal interactive closeout.',
    )
    expect(skill).toContain(
      "An explicit target-setting response still explains a paused canonical proposal\nin ordinary text, not a card.",
    )
    expect(skill).toContain("Ordinary summary requests use\nall-null goals when accepted authority is missing;")
    expect(skill).toContain(
      "When an explicit combined target-setting and card\nrequest remains pending, the acceptance response may complete it after suitability,",
    )
    expect(skill).toContain(
      "activation/readback, and fresh same-date totals.",
    )
    expect(skill).toContain('vault-cli food search-labels`')
    expect(skill).toContain('vault-cli food search-labels-batch`')
    expect(skill).toContain(
      'When the user names a restaurant and recognizable menu item, and known context\ndoes not trigger one of the numeric safety exceptions below, resolve nutrition\nbefore the meal mutation.',
    )
    expect(skill).toContain(
      'Use a normal exact restaurant/menu search rather\nthan a generic substitute.',
    )
    expect(skill).toContain(
      'Run this database search first even when the user\nsupplies an official restaurant URL.',
    )
    expect(skill).toContain(
      'When a numeric safety exception already applies, save the meal without calorie\nor macro estimates.',
    )
    expect(skill).toContain(
      'Do not force a nutrition lookup, clarification, or safety\npreflight just to capture the meal.',
    )
    expect(skill).toContain(
      "If that search has no exact result, read\n`computer-use` and inspect the restaurant's official nutrition or menu source.",
    )
    expect(skill).toContain(
      'When using that official source, retain its URL in nutrition source detail.',
    )
    expect(skill).toContain(
      'Only after the database result, official source, or clearly marked last-resort\nestimate is resolved may you call `meal add` or `meal edit`',
    )
    expect(skill).toContain(
      'Do not save a nutrition-free restaurant meal first\nand then ask the member to repeat the item.',
    )
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

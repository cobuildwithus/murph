import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assistantResponseCardSchema,
} from '@murphai/operator-config/assistant-response-cards'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function buildPrompt(input: {
  currentLocalDate?: string
  scheduledOccurrenceAt?: string
} = {}): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'imessage',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: input.currentLocalDate ?? '2026-07-18',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: false,
    modelBehaviorProfile: 'gpt5-agentic',
    scheduledOccurrenceAt: input.scheduledOccurrenceAt,
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
  })
}

describe('assistant automatic meal capture skill', () => {
  it('registers the skill and routes automatic photo questions to it', () => {
    const matches = ASSISTANT_SKILLS.filter(
      ({ slug }) => slug === 'automatic-meal-capture',
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]?.triggerHint).toContain('Full Photos permission')
    expect(matches[0]?.triggerHint).toContain('missing or delayed photo imports')
    expect(matches[0]?.triggerHint).toContain('automatic 9pm closeout')
    expect(matches[0]?.triggerHint).toContain('retained-photo privacy cleanup')
    expect(matches[0]?.triggerHint).toContain('without duplicate logging')
    expect(matches[0]?.triggerHint).toContain('Always co-load with food-journal')

    const prompt = buildPrompt()
    expect(prompt).toContain(
      'Automatic meal capture: automatic-meal-capture for the iPhone app, Photos permission, background timing, Meals review, import verification, and photo-only meal enrichment.',
    )
    expect(prompt).toContain(
      'Always load automatic-meal-capture alongside food-journal on eligible interactive meal turns and check recent unresolved device meals; import itself does not start a model turn.',
    )
  })

  it('teaches setup, background limits, import proof, and calorie-aware enrichment', async () => {
    const skillsRoot = resolveAssistantSkillsRoot()
    const [skill, cardSafety] = await Promise.all([
      readFile(
        path.join(skillsRoot, 'automatic-meal-capture', 'SKILL.md'),
        'utf8',
      ),
      readFile(
        path.join(
          skillsRoot,
          'nutrition-strategy',
          'references',
          'daily-nutrition-card-safety.md',
        ),
        'utf8',
      ),
    ])

    expect(skill).toMatch(/^---\nname: automatic-meal-capture\n/)
    expect(skill).toContain('iOS 26.1 or later')
    expect(skill).toContain(
      'https://apps.apple.com/us/app/murph-ai/id6786145859',
    )
    expect(skill).toContain('grant **Full Photos** access')
    expect(skill).toContain('existing photos are never scanned')
    expect(skill).toContain("Uncertain candidates stay in the iPhone's")
    expect(skill).toContain('age out after 14 days')
    expect(skill).toContain('24-item limit')
    expect(skill).toContain('`source: device`')
    expect(skill).toContain('managed daily closeout at 9:00pm')
    expect(skill).toContain(
      'The original capture instant—not upload or import time—owns meal timing.',
    )
    expect(skill).toContain('iOS may delay or skip any background\nopportunity')
    expect(skill).toContain(
      'Automatic capture does not itself require a chat reply and its import does not\nstart a model turn.',
    )
    expect(skill).toContain('next eligible interactive turn')
    expect(skill).toContain('scoped upload\ncredential may require renewal')
    expect(skill).toContain('vault-cli meal list --from <YYYY-MM-DD>')
    expect(skill).toContain('vault-cli meal show <meal-id> --format json')
    expect(skill).toContain(
      'do not request a resend solely from back-to-back\nreads',
    )
    expect(skill).toContain(
      'Suggest resending only after later evidence shows the upload failed.',
    )
    expect(skill).toContain('vault-cli meal edit <meal-id>')
    expect(skill).toContain('## Run the automatic 9pm closeout')
    expect(skill).toContain(
      'engine-supplied `Occurrence local date` from the `Scheduled\n   occurrence context` as the action and latest-capture boundary',
    )
    expect(skill).toContain(
      "even when the\n   wall-clock `Today's date` differs",
    )
    expect(skill).toContain('vault-cli meal remove-photo <meal-id>')
    expect(skill).toContain('vault-cli meal closeout-work')
    expect(skill).toContain('oldest bounded batch')
    expect(skill).not.toContain('preceding 31 local days')
    expect(compact(skill)).toContain('partial totals as partial')
    expect(skill).toContain('each retained photo as pending closeout work')
    expect(skill).toContain('late import gets one dated catch-up')
    expect(skill).toContain('latest `recordedAt` is at or after')
    expect(skill).toContain('partial-cleanup failure loses no meal')
    expect(skill).toMatch(
      /canonical\s+`vault-cli meal totals --from <date> --to\s+<date>` read/,
    )
    expect(compact(skill)).toContain(
      'immediately before any response-card attachment',
    )
    const compactSkill = compact(skill)
    expect(compactSkill).toContain(
      'Only when all five scalar targets resolve from active canonical Goals',
    )
    expect(skill).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-safety.md',
    )
    expect(compactSkill).toContain(
      'before resolving a card, even when five accepted goals already exist.',
    )
    expect(compactSkill).toContain(
      'This scheduled closeout uses only that card-time safety gate and does not provide target-setting intent',
    )
    expect(compactSkill).toContain(
      'do not ask for profile inputs, call `goal import-json`, create or change a paused proposal, or surface a numeric target proposal.',
    )
    expect(compactSkill).toContain(
      'If numeric presentation is suppressed, or the active target bundle is incomplete or ambiguous, retain the ordinary compact closeout and do not attach a card.',
    )
    expect(compactSkill).not.toContain(
      'follow it exactly. Resolve all five targets from active canonical Goals.',
    )
    expect(compactSkill).toContain(
      "Never infer a target from this day's meal total or one wearable day.",
    )
    expect(compactSkill).toContain(
      'When the run covers exactly one local date, the canonical read includes a calorie total',
    )
    const compactSafety = compact(cardSafety)
    expect(compactSafety).toContain(
      'before every `daily_nutrition` attachment',
    )
    expect(compactSafety).toContain('under-fueling or RED-S concern')
    expect(compactSafety).toContain('known underweight')
    expect(compactSafety).toContain('frailty, or malnutrition risk')
    expect(compactSafety).toContain('below 1,200 kcal/day')
    expect(compactSafety).toContain('active canonical target at card time')
    expect(compactSafety).toContain('pregnancy or breastfeeding')
    expect(compactSafety).toContain('glucose-lowering medication')
    expect(compactSafety).toContain('kidney disease')
    expect(skill).toContain('`murph.attach_response_card`')
    expect(skill).toContain(
      '`card: { kind: "daily_nutrition", version: 2, localDate: <the single',
    )
    expect(skill).toContain('mealCount: <top-level mealCount>')
    expect(compactSkill).toContain(
      'proteinGrams, carbsGrams, fatGrams, fiberGrams }, goals: { calories,',
    )
    expect(compactSkill).toContain(
      "Copy every metric's complete `{ total, mealCount }` pair unchanged",
    )
    expect(skill).toContain('including `fiberGrams`')
    expect(compactSkill).toContain('There is no universal percentage threshold')
    expect(compactSkill).toContain(
      'A metric whose total is missing or whose `mealCount` is below the top-level `mealCount` must use `unavailable`',
    )
    expect(skill).toContain('Do not author a second nutrition summary')
    expect(skill).toMatch(/For\s+multi-date catch-up, missing calories/u)
    expect(skill).toMatch(
      /retain the current compact text,\s+one-question, or non-numeric behavior/u,
    )
    expect(skill.indexOf('vault-cli meal remove-photo <meal-id>')).toBeLessThan(
      skill.indexOf('vault-cli meal totals --from <date> --to'),
    )
    const attachCardIndex = compactSkill.indexOf(
      'call `murph.attach_response_card` with this exact mapping',
    )
    expect(
      compactSkill.indexOf('vault-cli meal totals --from <date> --to'),
    ).toBeLessThan(attachCardIndex)
    expect(compactSkill.indexOf('daily-nutrition-card-safety.md'))
      .toBeLessThan(attachCardIndex)
    expect(skill).toContain('a delivery prerequisite, not a second automation opt-in')
    expect(skill).toContain('`--nutrition-source label`')
    expect(skill).toContain('`--nutrition-source database`')
    expect(skill).toContain('likely manual,\n   conversation, provider')
    expect(skill).toContain(
      'Do not run `meal add` for a captured photo that already has a meal id.',
    )
    expect(skill).toContain(
      'Estimate calories and macros by default when enriching a captured meal.',
    )
    expect(skill).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/SKILL.md',
    )
  })

  it('maps all five canonical target metrics into the closed V2 card', () => {
    const canonicalTotals = {
      mealCount: 4,
      totals: {
        calories: { total: 2_140, mealCount: 4 },
        proteinGrams: { total: 142, mealCount: 3 },
        carbsGrams: { total: 238, mealCount: 3 },
        fatGrams: { total: 71, mealCount: 3 },
        fiberGrams: { total: 26, mealCount: 2 },
      },
    }
    const canonicalTargets = [
      { metricKey: 'dietary-calories', unit: 'kcal', value: 2_400 },
      { metricKey: 'protein-grams', unit: 'g', value: 150 },
      { metricKey: 'carbs-grams', unit: 'g', value: 270 },
      { metricKey: 'fat-grams', unit: 'g', value: 80 },
      { metricKey: 'fiber-grams', unit: 'g', value: 35 },
    ] as const
    const resolveTarget = (metricKey: string, unit: string): number => {
      const matches = canonicalTargets.filter(
        (target) => target.metricKey === metricKey && target.unit === unit,
      )
      expect(matches).toHaveLength(1)
      return matches[0]!.value
    }
    const expectedArgument = {
      card: {
        kind: 'daily_nutrition',
        version: 2,
        localDate: '2026-07-28',
        mealCount: canonicalTotals.mealCount,
        totals: {
          calories: canonicalTotals.totals.calories,
          proteinGrams: canonicalTotals.totals.proteinGrams,
          carbsGrams: canonicalTotals.totals.carbsGrams,
          fatGrams: canonicalTotals.totals.fatGrams,
          fiberGrams: canonicalTotals.totals.fiberGrams,
        },
        goals: {
          calories: {
            target: resolveTarget('dietary-calories', 'kcal'),
            status: 'on_target',
          },
          proteinGrams: {
            target: resolveTarget('protein-grams', 'g'),
            status: 'unavailable',
          },
          carbsGrams: {
            target: resolveTarget('carbs-grams', 'g'),
            status: 'unavailable',
          },
          fatGrams: {
            target: resolveTarget('fat-grams', 'g'),
            status: 'unavailable',
          },
          fiberGrams: {
            target: resolveTarget('fiber-grams', 'g'),
            status: 'unavailable',
          },
        },
      },
    } as const

    expect(assistantResponseCardSchema.parse(expectedArgument.card)).toEqual(
      expectedArgument.card,
    )
    expect(Object.values(expectedArgument.card.goals)).not.toContain(null)
    expect(expectedArgument.card.totals.fiberGrams).toBe(
      canonicalTotals.totals.fiberGrams,
    )
  })

  it('keeps a post-midnight retry anchored to its scheduled occurrence date', () => {
    const prompt = buildPrompt({
      currentLocalDate: '2026-07-24',
      scheduledOccurrenceAt: '2026-07-24T01:00:00.000Z',
    })

    expect(prompt).toContain("Today's date for the user is July 24, 2026.")
    expect(prompt).toContain('Occurrence instant: `2026-07-24T01:00:00.000Z`.')
    expect(prompt).toContain('Occurrence timezone: `America/New_York`.')
    expect(prompt).toContain('Occurrence local date: `2026-07-23`.')
    expect(prompt).toContain(
      "Use the local date as the anchor for this automation's relevant action window.",
    )
  })
})

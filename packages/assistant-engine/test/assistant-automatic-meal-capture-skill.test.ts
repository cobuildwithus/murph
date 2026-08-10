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
      'Run `vault-cli goal list --status active --limit 200 --format json`.',
    )
    expect(compactSkill).toContain(
      'If it returns 200 records, fail closed with the ordinary compact closeout: run no Goal detail reads, perform no Goal or measurement mutation, ask no question, and attach no card.',
    )
    expect(compactSkill).toContain(
      'run `vault-cli goal show <goal-id> --format json` for every returned active Goal whose list item reports a nonzero `data.metricTargetsCount`.',
    )
    expect(compactSkill).toContain(
      'Do not select detail reads by title, slug, domain, context-snapshot visibility, or the default list prefix.',
    )
    expect(compactSkill).toContain(
      'This active-target authority read is separate from any all-status Goal lookup used to reuse or honor Murph\'s managed paused or abandoned proposal',
    )
    expect(compactSkill).toContain(
      'requires both `vault-cli condition list --status active --limit 200 --format json` and `vault-cli regimen list --status active --limit 200 --format json`.',
    )
    expect(compactSkill).toContain(
      'If either returns exactly 200 records or fails, run no condition or regimen detail reads, keep the ordinary compact closeout, perform no Goal or measurement mutation, ask no question, and attach no card.',
    )
    expect(compactSkill).toContain(
      'run `vault-cli condition show <condition-id> --format json` for every returned condition and `vault-cli regimen show <regimen-id> --format json` for every returned regimen before applying the safety gate.',
    )
    expect(compactSkill).toContain(
      'Never use the five-record context projection, a title, substance, severity, or the default list prefix to select the safety set.',
    )
    expect(compactSkill).toContain(
      'If any required detail read fails or is unreadable, use the same ordinary-text, no-write, no-question, no-card failure behavior.',
    )
    expect(compactSkill).toContain(
      'Also run the shared gate\'s bounded body-measurement read and separate `pregnancy-test` read. A failed read, a body-measurement read saturated without resolving usable BMI evidence, or a saturated pregnancy-test read uses the same failure behavior.',
    )
    expect(compactSkill).toContain(
      'Only when all five qualifying exact point targets resolve from active canonical Goals',
    )
    expect(compactSkill).toContain(
      'A card-qualifying target must use the exact canonical metric/unit pair: `dietary-calories` with `kcal`, and `protein-grams`, `carbs-grams`, `fat-grams`, and `fiber-grams` with `g`.',
    )
    expect(compactSkill).toContain(
      'A target in another unit remains authoritative, but never compare, convert, or copy its raw value into this fixed-unit card',
    )
    expect(compactSkill).toContain(
      'A card-qualifying target must also be an exact point: its selected-value comparator is `between` with identical numeric `value` and `highValue`.',
    )
    expect(compactSkill).toContain(
      'A one-sided `<`, `<=`, `>`, or `>=` threshold, non-identical range, or other shape remains authoritative but is incompatible with this point-target card.',
    )
    expect(compactSkill).toContain(
      'Never expose, compare, copy, or derive from its bound, and never create, replace, or remove a managed target around it.',
    )
    expect(compactSkill).toContain(
      'On a scheduled occurrence, ask no question, perform no Goal or measurement mutation, and use ordinary closeout text without a card.',
    )
    expect(compactSkill).toContain(
      'on a scheduled occurrence, ask no question and use ordinary closeout text.',
    )
    expect(compactSkill).toContain(
      'Keep the occurrence local date from step 1 only as the work and retry boundary.',
    )
    expect(compactSkill).toContain(
      'Resolve target applicability against the single selected card `localDate`: the capture date whose totals and card are being closed out, including a historical catch-up date.',
    )
    expect(compactSkill).toContain(
      "A target qualifies only when that card date is on or after the containing Goal's `window.startAt`, on or before its optional `window.targetAt`, and inside the target's optional inclusive `startAt`/`targetAt` interval.",
    )
    expect(compactSkill).toContain(
      'Ignore an out-of-window target for current authority and conflict resolution; never copy, expose, derive from, or mutate a Goal because of it.',
    )
    expect(compactSkill).toContain(
      'If fewer than five applicable targets remain, ask no question and use ordinary closeout text.',
    )
    expect(skill).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/nutrition-strategy/references/daily-nutrition-card-safety.md',
    )
    expect(compactSkill).toContain(
      'before resolving a card, even when five accepted goals already exist.',
    )
    expect(compactSkill).toContain(
      'first requires `vault-cli memory show --format json`; if that complete canonical memory read fails or is unreadable, keep the ordinary compact closeout, perform no Goal or measurement mutation, ask no question, and attach no card.',
    )
    expect(compactSkill).toContain(
      'A clearly current saved age under 18 or clearly current intuitive-eating or number-sensitive preference uses the same non-numeric, no-write, no-question, no-card path.',
    )
    expect(compactSkill).toContain(
      'Missing or ambiguous age alone does not block a scheduled closeout and never authorizes a question.',
    )
    expect(compactSkill).toContain(
      'This scheduled closeout uses only that card-time safety gate and does not provide target-setting intent',
    )
    expect(compactSkill).toContain(
      'do not ask for profile inputs, call `goal import-json`, create or change a paused proposal, or surface a numeric target proposal.',
    )
    expect(compactSkill).toContain(
      'If numeric presentation is suppressed, or the active target bundle is incomplete, ambiguous, unit-incompatible, or comparator-incompatible, retain the ordinary compact closeout and do not attach a card.',
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
    expect(compactSafety).toContain(
      '`vault-cli measurement entry list --metric bmi --metric height --metric weight --metric body-weight --from <45-days-before-today> --to <today> --limit 200 --format json`',
    )
    expect(compactSafety).toContain(
      '`vault-cli measurement entry list --metric pregnancy-test --from <300-days-before-today> --to <today> --limit 200 --format json`',
    )
    expect(compactSkill).toContain(
      'An explicit positive pregnancy-test result uses the same non-numeric, no-write, no-question, no-card path.',
    )
    expect(compactSafety).toContain(
      'It takes precedence over negative rows in the same window, including a later negative',
    )
    expect(compactSafety).toContain(
      '`vault-cli memory show --format json`',
    )
    expect(compactSafety).toContain(
      'A usable adult BMI below 18.5 suppresses numeric goals, every Goal write or activation, and the card.',
    )
    expect(compactSafety).toContain(
      'Do not combine height and weight from different events or dates',
    )
    expect(compactSafety).toContain(
      'Never ask a scheduled occurrence for these measurements and never mutate measurement records during this check.',
    )
    expect(compactSafety).toContain('below 1,200 kcal/day')
    expect(compactSafety).toContain('active canonical target at card time')
    expect(compactSafety).toContain(
      'Evaluate the boundary only for an exact point `dietary-calories` target in canonical `kcal`: its selected-value comparator must be `between` with identical numeric `value` and `highValue`.',
    )
    expect(compactSafety).toContain(
      'A one-sided threshold, non-identical range, or calorie target in any other unit makes the point-target card bundle incompatible.',
    )
    expect(compactSafety).toContain(
      'a calorie threshold whose satisfying range includes intake below 1,200 cannot authorize numeric self-directed card feedback.',
    )
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
    expect(
      compactSkill.indexOf(
        'vault-cli goal list --status active --limit 200 --format json',
      ),
    ).toBeLessThan(attachCardIndex)
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

  it('maps applicable canonical point targets and rejects incompatible units or comparators', () => {
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
    type CandidateTarget = {
      metricKey: string
      unit: string
      value: number
      comparator: '<' | '<=' | '>' | '>=' | 'between'
      highValue?: number
    }
    const pointTarget = (
      metricKey: string,
      unit: string,
      value: number,
    ): CandidateTarget => ({
      metricKey,
      unit,
      value,
      comparator: 'between',
      highValue: value,
    })
    const canonicalTargets: readonly CandidateTarget[] = [
      pointTarget('dietary-calories', 'kcal', 2_400),
      pointTarget('protein-grams', 'g', 150),
      pointTarget('carbs-grams', 'g', 270),
      pointTarget('fat-grams', 'g', 80),
      pointTarget('fiber-grams', 'g', 35),
    ]
    const resolveTarget = (
      metricKey: string,
      unit: string,
      targets: readonly CandidateTarget[] = canonicalTargets,
    ): number => {
      const matches = targets.filter(
        (target) =>
          target.metricKey === metricKey &&
          target.unit === unit &&
          target.comparator === 'between' &&
          target.highValue === target.value,
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

    const kilojouleCalories = canonicalTargets.map((target) =>
      target.metricKey === 'dietary-calories'
        ? { ...target, unit: 'kJ', value: 4_000 }
        : target
    )
    expect(() => resolveTarget(
      'dietary-calories',
      'kcal',
      kilojouleCalories,
    )).toThrow()

    const lowCalorieCeiling = canonicalTargets.map((target) =>
      target.metricKey === 'dietary-calories'
        ? {
            ...target,
            comparator: '<=' as const,
            highValue: undefined,
            value: 1_200,
          }
        : target
    )
    expect(900).toBeLessThanOrEqual(1_200)
    expect(() => resolveTarget(
      'dietary-calories',
      'kcal',
      lowCalorieCeiling,
    )).toThrow()

    const residualCalorieCeiling = canonicalTargets.map((target) =>
      target.metricKey === 'dietary-calories'
        ? {
            ...target,
            comparator: '<' as const,
            highValue: undefined,
            value: 2_000,
          }
        : target
    )
    expect(() => resolveTarget(
      'dietary-calories',
      'kcal',
      residualCalorieCeiling,
    )).toThrow()

    for (const metricKey of [
      'protein-grams',
      'carbs-grams',
      'fat-grams',
      'fiber-grams',
    ]) {
      const ounceTarget = canonicalTargets.map((target) =>
        target.metricKey === metricKey
          ? { ...target, unit: 'oz' }
          : target
      )
      expect(() => resolveTarget(metricKey, 'g', ounceTarget)).toThrow()

      const thresholdTarget = canonicalTargets.map((target) =>
        target.metricKey === metricKey
          ? {
              ...target,
              comparator: '>=' as const,
              highValue: undefined,
            }
          : target
      )
      expect(() => resolveTarget(metricKey, 'g', thresholdTarget)).toThrow()
    }

    const appliesToCardDate = (input: {
      cardDate: string
      goalStartAt: string
      goalTargetAt?: string
      targetStartAt?: string
      targetTargetAt?: string
    }): boolean =>
      input.goalStartAt <= input.cardDate &&
      (input.goalTargetAt === undefined || input.cardDate <= input.goalTargetAt) &&
      (input.targetStartAt === undefined || input.targetStartAt <= input.cardDate) &&
      (input.targetTargetAt === undefined || input.cardDate <= input.targetTargetAt)

    expect(appliesToCardDate({
      cardDate: '2026-08-10',
      goalStartAt: '2026-09-01',
    })).toBe(false)
    expect(appliesToCardDate({
      cardDate: '2026-08-10',
      goalStartAt: '2026-01-01',
      targetStartAt: '2026-09-01',
    })).toBe(false)
    expect(appliesToCardDate({
      cardDate: '2026-08-10',
      goalStartAt: '2026-01-01',
      goalTargetAt: '2026-08-09',
    })).toBe(false)
    expect(appliesToCardDate({
      cardDate: '2026-08-10',
      goalStartAt: '2026-08-10',
      goalTargetAt: '2026-08-10',
      targetStartAt: '2026-08-10',
      targetTargetAt: '2026-08-10',
    })).toBe(true)

    const datedGoals = [
      {
        name: 'catch-up-date goal',
        calories: 1_100,
        goalStartAt: '2026-01-01',
        goalTargetAt: '2026-08-09',
      },
      {
        name: 'occurrence-date goal',
        calories: 1_800,
        goalStartAt: '2026-08-10',
      },
    ] as const
    const applicableGoals = (cardDate: string) => datedGoals.filter((goal) =>
      appliesToCardDate({
        cardDate,
        goalStartAt: goal.goalStartAt,
        goalTargetAt: 'goalTargetAt' in goal
          ? goal.goalTargetAt
          : undefined,
      })
    )

    const catchUpGoals = applicableGoals('2026-08-09')
    expect(catchUpGoals.map(({ name }) => name)).toEqual(['catch-up-date goal'])
    expect(catchUpGoals[0]?.calories).toBeLessThan(1_200)
    expect(applicableGoals('2026-08-10').map(({ name }) => name)).toEqual([
      'occurrence-date goal',
    ])

    const proposalEffectiveDate = (input: {
      currentVaultDate: string
      explicitEffectiveDate?: string
      selectedCardDate?: string
    }): string =>
      input.explicitEffectiveDate ??
      input.selectedCardDate ??
      input.currentVaultDate

    const historicalProposalStart = proposalEffectiveDate({
      currentVaultDate: '2026-08-10',
      selectedCardDate: '2026-08-09',
    })
    expect(historicalProposalStart).toBe('2026-08-09')
    expect(appliesToCardDate({
      cardDate: '2026-08-09',
      goalStartAt: historicalProposalStart,
    })).toBe(true)

    const currentProposalStart = proposalEffectiveDate({
      currentVaultDate: '2026-08-10',
    })
    expect(currentProposalStart).toBe('2026-08-10')
    expect(appliesToCardDate({
      cardDate: '2026-08-10',
      goalStartAt: currentProposalStart,
    })).toBe(true)

    const futureProposalStart = proposalEffectiveDate({
      currentVaultDate: '2026-08-10',
      explicitEffectiveDate: '2026-08-11',
    })
    expect(futureProposalStart).toBe('2026-08-11')
    expect(appliesToCardDate({
      cardDate: '2026-08-10',
      goalStartAt: futureProposalStart,
    })).toBe(false)
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

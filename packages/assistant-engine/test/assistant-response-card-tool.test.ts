import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import type { AssistantResponseMedia } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantResponseCard } from '@murphai/operator-config/assistant-response-cards'

import {
  executeMurphDynamicToolRequest,
  MURPH_ATTACH_RESPONSE_CARD_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'

const LEGACY_CARD_V1: AssistantResponseCard = {
  kind: 'daily_nutrition',
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1_490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
  },
}

const CARD: AssistantResponseCard = {
  kind: 'daily_nutrition',
  version: 2,
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1_490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
    fiberGrams: { total: 26.5, mealCount: 3 },
  },
  goals: {
    calories: { target: 2_100, status: 'under_target' },
    proteinGrams: { target: 100, status: 'on_target' },
    carbsGrams: { target: 220, status: 'on_target' },
    fatGrams: { target: 40, status: 'on_target' },
    fiberGrams: { target: 30, status: 'under_target' },
  },
}

const REALISTIC_LATE_WORKOUT_CARD: AssistantResponseCard = {
  kind: 'compact_table',
  version: 1,
  title: 'Lower body strength',
  subtitle: '18 of 24 sets complete',
  footer: 'Tap an exercise to log or correct a set.',
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-09T19:45:00.000Z',
  },
  workout: {
    version: 1,
    state: 'active',
    exercises: [
      'Dumbbell Single-Leg Romanian Deadlift',
      'Dumbbell Bulgarian Split Squat',
      'Dumbbell Walking Lunge in Place',
      'Split Squat with Front Heel Lift',
      'Dumbbell Reverse Lunge',
      'Dumbbell Step-Up',
    ].map((name, exerciseIndex) => ({
      name,
      sets: [
        ['55 lb × 8–10', '55 lb × 9'],
        ['55 lb × 10', '55 lb × 10'],
        ['65 lb × 10–12', '65 lb × 11'],
        ['65 lb × 12', '65 lb × 12'],
      ].map(([target, actual], setIndex) => {
        const isCompleted = exerciseIndex * 4 + setIndex < 18
        return {
          status: isCompleted ? 'completed' : 'pending',
          target: target ?? null,
          actual: isCompleted ? actual ?? null : null,
        }
      }),
    })),
  },
}

const IMAGE: AssistantResponseMedia = {
  alt: null,
  kind: 'image',
  source: null,
  url: 'https://cdn.example.test/nutrition.png',
}

function executeCardTool(input: {
  currentResponseCard?: AssistantResponseCard | null
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  privateDirectResponseCardAllowed?: boolean | null
  request?: Parameters<typeof executeMurphDynamicToolRequest>[0]['request']
}) {
  return executeMurphDynamicToolRequest({
    currentResponseCard: input.currentResponseCard ?? null,
    currentResponseMedia: input.currentResponseMedia ?? [],
    env: {},
    fetchImpl: fetch,
    nextUsageOrdinal: () => 0,
    privateDirectResponseCardAllowed:
      input.privateDirectResponseCardAllowed ?? true,
    progressDelivery: null,
    request: input.request ?? {
      card: CARD,
      kind: 'attach-response-card',
    },
  })
}

function readCardToolRequest(argumentsValue: unknown) {
  return readTestMurphDynamicToolRequest({
    id: 1,
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool: 'attach_response_card',
    },
  })
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeCodexSchemaForSize(value: unknown): unknown {
  if (!isSchemaObject(value)) {
    return value
  }
  if ('$ref' in value || '$defs' in value || 'definitions' in value) {
    throw new TypeError('The response-card tool schema must remain inline.')
  }

  const normalized: Record<string, unknown> = {}
  for (const key of ['type', 'description', 'encrypted'] as const) {
    if (key in value) {
      normalized[key] = value[key]
    }
  }
  if ('const' in value) {
    normalized.enum = [value.const]
  } else if ('enum' in value) {
    normalized.enum = value.enum
  }
  if ('items' in value) {
    normalized.items = normalizeCodexSchemaForSize(value.items)
  }
  if (isSchemaObject(value.properties)) {
    normalized.properties = Object.fromEntries(
      Object.entries(value.properties).map(([key, schema]) => [
        key,
        normalizeCodexSchemaForSize(schema),
      ]),
    )
  }
  if ('required' in value) {
    normalized.required = value.required
  }
  if ('additionalProperties' in value) {
    normalized.additionalProperties = isSchemaObject(value.additionalProperties)
      ? normalizeCodexSchemaForSize(value.additionalProperties)
      : value.additionalProperties
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const variants = value[key]
    if (Array.isArray(variants)) {
      normalized[key] = variants.map(normalizeCodexSchemaForSize)
    }
  }
  return normalized
}

describe('murph.attach_response_card', () => {
  it('keeps the complete input schema below the Codex compaction boundary', () => {
    const normalizedSchema = JSON.stringify(
      normalizeCodexSchemaForSize(
        MURPH_ATTACH_RESPONSE_CARD_TOOL.inputSchema,
      ),
    )
    const serializedBytes = Buffer.byteLength(normalizedSchema, 'utf8')

    // Mirrors the supported-key projection used for the pinned App Server's
    // 5,000-byte compaction decision; compaction erases nested card shapes.
    expect(serializedBytes).toBeLessThan(5_000)
    expect(normalizedSchema).toContain('"fiberGrams"')
  })

  it('describes the private on-demand canonical-read contract', () => {
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'saved instructions for the exact scheduled automation occurrence explicitly request it',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Occurrence authority alone is not card intent',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'verified initial card after starting or resuming one canonical live workout',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'with multiple plausible workouts, do not infer authority',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'card replaces the entire final response',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'compound requests with complete ordinary text and no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'vault-cli meal totals --from <date> --to <same-date>',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'never calculate or reuse totals',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'New authoring uses V2 with fiber and five required goal snapshots; nullable V2 goals and nutrition V1 remain legacy replay and rendering compatibility only',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).not.toContain(
      'V2 adds fiber and nullable goal snapshots',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Before every goal-aware daily_nutrition card, first run vault-cli goal list --status active --limit 200 --format json',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'If it returns 200 records, fail closed with ordinary text, no Goal or measurement mutation, and no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'run vault-cli goal show <goal-id> --format json for every returned active Goal whose list item reports a nonzero data.metricTargetsCount',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'never select detail reads by title, slug, domain, context-snapshot visibility, or the default list prefix',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Keep this active-target authority read separate from any all-status lookup used to reuse or honor Murph\'s managed paused or abandoned proposal',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Require exactly one unambiguous applicable exact point target in each fixed card unit: dietary-calories in kcal, and protein-grams, carbs-grams, fat-grams, and fiber-grams in g, resolved across active canonical Goals',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Each target must use selected-value comparator between with identical numeric value and highValue',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A one-sided threshold, non-identical range, or other shape remains authoritative but makes the bundle comparator-incompatible',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'never expose, compare, copy, or derive from its bound or create, replace, or remove a managed target around it',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A target in another unit likewise remains authoritative but makes the bundle incompatible: never compare, convert, copy, or derive from its raw value',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'use ordinary text with no card or managed Goal mutation, and ask no question on a scheduled closeout',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      "For the exact card localDate, require the containing active Goal window and each target's optional startAt/targetAt interval to include that date, with inclusive boundaries",
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'use the selected capture date for a scheduled closeout, which may differ from the occurrence date for a historical catch-up, or the explicitly requested date, never wall-clock today',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Ignore out-of-window targets for current authority and conflicts, and never expose, compare, copy, derive from, or mutate a Goal because of them.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'nutrition-strategy/references/daily-nutrition-card-safety.md',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'before every daily_nutrition attachment, even with five active goals or on a scheduled closeout',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Before deriving, saving, or surfacing numeric nutrition goals, before activating a paused nutrition proposal, and before every daily_nutrition attachment',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'First run vault-cli memory show --format json and inspect the complete canonical Identity, Preferences, Instructions, and Context memory document for explicit, unambiguous safety facts; the context snapshot does not inject it',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'vault-cli measurement entry list --metric pregnancy-test --from <300-days-before-today> --to <today> --limit 200 --format json',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'vault-cli event list --kind test --from <300-days-before-today> --to <today> --limit 200 --format json',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'vault-cli event list --kind procedure --limit 200 --format json',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'vault-cli event list --kind encounter --limit 200 --format json',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'use event show for every item whose list data reports nonzero diagnosesCount',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A safety-relevant active diagnosis with documented or suspected certainty suppresses numeric output.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A failed, unreadable, or exactly 200-record encounter read, or a failed required detail read, fails closed with no Goal or measurement mutation and no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Inspect every returned item; use event show for an item whose procedure or status is missing or truncated.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A completed gastric bypass, Roux-en-Y, sleeve gastrectomy, gastric sleeve, biliopancreatic diversion, duodenal switch, adjustable gastric band, lap band, or other explicit bariatric surgery suppresses numeric output.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A failed, unreadable, or exactly 200-record procedure read, or a failed required detail read, fails closed with no Goal or measurement mutation and no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'any such positive wins over negative evidence from either pregnancy-evidence owner in the window and suppresses numeric output without diagnosing pregnancy',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A failed, unreadable, or exactly 200-record pregnancy-test read fails closed with no Goal or measurement mutation and no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Otherwise event show every returned test because list output compacts results and can truncate summaries',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Do not infer pregnancy from numeric hCG, reference ranges, abnormal status/flags, titles, notes, pending/unknown results, or ambiguous text.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A failed or unreadable memory read fails closed with ordinary non-numeric text, no Goal or measurement mutation, and no card; leave an existing paused proposal unchanged',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A clearly current saved age under 18 or clearly current intuitive-eating or number-sensitive preference uses the same suppression path',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Missing, stale, ambiguous, or conflicting age alone is unavailable evidence, not a universal block; scheduled occurrences never ask',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Run both vault-cli condition list --status active --limit 200 --format json and vault-cli regimen list --status active --limit 200 --format json',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'If either read fails or returns exactly 200 records, run no condition or regimen detail reads and fail closed with ordinary non-numeric text, no Goal or measurement mutation, and no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'run vault-cli condition show <condition-id> --format json for every returned active condition and vault-cli regimen show <regimen-id> --format json for every returned active regimen',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'never select by title, substance, severity, context-snapshot visibility, or the default list prefix',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'If any required detail read fails or is unreadable, use the same fail-closed behavior',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'As part of that same pre-numeric and pre-activation gate, also run its bounded lossless vault-cli measurement entry list read over the canonical 45-day window',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A usable adult BMI below 18.5, including height and weight rows sharing one eventId, suppresses numeric proposal derivation or presentation, every Goal write or activation, and the card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A failed read, or a saturated read that cannot resolve usable BMI evidence, fails closed with ordinary non-numeric text, no Goal or measurement mutation, and no card; leave an existing paused proposal unchanged',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'known underweight, frailty, malnutrition risk, glucose-lowering medication, safety-relevant disease or clinician-managed nutrition context, and calorie targets below 1,200 kcal/day without flooring them upward',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'nutrition-strategy/references/daily-nutrition-card-goals.md',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Save one paused canonical proposal',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'explain its values, reasoning, and effective date in ordinary text with no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'On first creation, set Goal window.startAt explicitly: use a member-requested effective date when present, otherwise the selected card localDate for a dated card request, otherwise the engine-supplied current vault-local date; never rely on the write-day default',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Preserve that window on every later edit, activation, or card request and never silently rebase it to another card date',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'explicit numeric-card request authorizes only the goal-aware workflow\'s paused canonical proposal, not activation or use',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'hold applicable, compatible exact point targets fixed, derive missing macros from residual calories, and require every AMDR plus a 50 kcal energy tolerance before any Goal write',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'an infeasible bundle means ordinary text and no mutation',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'activate it only after member acceptance',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Any derived target addition or change atomically pauses the complete managed bundle until acceptance',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'its next unambiguous acceptance may complete that pending request only after the complete safety recheck passes, then activation and readback, and a fresh same-date totals read',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A scheduled closeout must not ask for inputs or create, change, or explain a proposal',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Explicit active targets win metric by metric',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'one consolidated question, never a goal-less card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'conflicts, thresholds, ranges, unsafe numbers, or missing responsible calorie inputs',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).not.toContain(
      'available only to the managed private-direct closeout',
    )
  })

  it('uses the strict card contract at the model-facing boundary', () => {
    expect(readCardToolRequest({ card: CARD })).toEqual({
      card: CARD,
      kind: 'attach-response-card',
    })
    expect(readCardToolRequest({ card: LEGACY_CARD_V1 })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    expect(readCardToolRequest({ card: REALISTIC_LATE_WORKOUT_CARD })).toEqual({
      card: REALISTIC_LATE_WORKOUT_CARD,
      kind: 'attach-response-card',
    })
    expect(readCardToolRequest({ card: CARD, extra: true })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    expect(readCardToolRequest({
      card: {
        ...CARD,
        kind: 'unknown_card',
      },
    })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })

    for (const metric of [
      'calories',
      'proteinGrams',
      'carbsGrams',
      'fatGrams',
      'fiberGrams',
    ] as const) {
      expect(readCardToolRequest({
        card: {
          ...CARD,
          goals: {
            ...CARD.goals,
            [metric]: null,
          },
        },
      })).toMatchObject({ kind: 'invalid-response-card-arguments' })
    }
    expect(readCardToolRequest({
      card: {
        ...CARD,
        goals: {
          calories: null,
          proteinGrams: null,
          carbsGrams: null,
          fatGrams: null,
          fiberGrams: null,
        },
      },
    })).toMatchObject({ kind: 'invalid-response-card-arguments' })

    const contradictoryCard = {
      ...CARD,
      totals: {
        ...CARD.totals,
        calories: { total: 2_300, mealCount: 3 },
      },
      goals: {
        ...CARD.goals,
        calories: { target: 2_000, status: 'under_target' },
      },
    }
    expect(readCardToolRequest({ card: contradictoryCard })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    expect(readCardToolRequest({
      card: {
        ...contradictoryCard,
        goals: {
          ...contradictoryCard.goals,
          calories: { target: 2_000, status: 'over_target' },
        },
      },
    })).toMatchObject({
      kind: 'attach-response-card',
    })
  })

  it('rejects group use and a second card without echoing nutrition values', async () => {
    const groupResult = await executeCardTool({
      privateDirectResponseCardAllowed: false,
    })
    expect(groupResult.rpcResult).toEqual({
      contentItems: [{
        text: 'response cards require a private direct conversation',
        type: 'inputText',
      }],
      success: false,
    })

    const first = await executeCardTool({})
    expect(first).toMatchObject({
      responseCardPatch: { card: CARD },
      rpcResult: {
        contentItems: [{ text: 'response card attached', type: 'inputText' }],
        success: true,
      },
    })
    expect(JSON.stringify(first.rpcResult)).not.toContain('1490.25')

    const second = await executeCardTool({ currentResponseCard: CARD })
    expect(second.rpcResult).toEqual({
      contentItems: [{
        text: 'a response card is already attached',
        type: 'inputText',
      }],
      success: false,
    })
  })

  it('rejects card and response media in either attachment order', async () => {
    const cardAfterMedia = await executeCardTool({ currentResponseMedia: [IMAGE] })
    expect(cardAfterMedia.rpcResult).toEqual({
      contentItems: [{
        text: 'response cards cannot be combined with response media',
        type: 'inputText',
      }],
      success: false,
    })

    const mediaAfterCard = await executeCardTool({
      currentResponseCard: CARD,
      request: {
        kind: 'attach-response-media',
        media: [IMAGE],
      },
    })
    expect(mediaAfterCard.rpcResult).toEqual({
      contentItems: [{
        text: 'response media cannot be combined with a response card',
        type: 'inputText',
      }],
      success: false,
    })
  })
})

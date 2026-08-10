import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import type { AssistantResponseMedia } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantResponseCard } from '@murphai/operator-config/assistant-response-cards'

import {
  executeMurphDynamicToolRequest,
  MURPH_ATTACH_RESPONSE_CARD_TOOL,
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.ts'

const CARD: AssistantResponseCard = {
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

const CARD_V2: AssistantResponseCard = {
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
    carbsGrams: null,
    fatGrams: { target: 40, status: 'on_target' },
    fiberGrams: { target: 30, status: 'under_target' },
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
  return readMurphDynamicToolRequest({
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
    const serializedBytes = Buffer.byteLength(
      JSON.stringify(normalizeCodexSchemaForSize(
        MURPH_ATTACH_RESPONSE_CARD_TOOL.inputSchema,
      )),
      'utf8',
    )

    // Mirrors the supported-key projection used for the pinned App Server's
    // 5,000-byte compaction decision; compaction erases nested card shapes.
    expect(serializedBytes).toBeLessThan(5_000)
  })

  it('describes the private on-demand canonical-read contract', () => {
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'saved instructions for the exact scheduled automation occurrence explicitly request it',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Occurrence authority alone is not card intent',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'single active tracked workout whose table was explicitly established earlier',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'with no active table or multiple plausible workouts, do not infer authority',
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
      'Require exactly one unambiguous applicable scalar target in each fixed card unit: dietary-calories in kcal, and protein-grams, carbs-grams, fat-grams, and fiber-grams in g, resolved across active canonical Goals',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A target in another unit remains authoritative but makes the bundle incompatible: never compare, convert, copy, or derive from its raw value',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'use ordinary text with no card or managed Goal mutation, and ask no question on a scheduled closeout',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      "For the exact card localDate, require the containing active Goal window and each target's optional startAt/targetAt interval to include that date, with inclusive boundaries",
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'use the scheduled occurrence or explicitly requested date, including historical catch-up, never wall-clock today',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Ignore out-of-window targets for current authority and conflicts, and never expose, compare, copy, derive from, or mutate a Goal because of them.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'nutrition-strategy/references/daily-nutrition-card-safety.md',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Before every daily_nutrition attachment, even with five active goals or on a scheduled closeout',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'run its bounded lossless vault-cli measurement entry list read over the canonical 45-day window and suppress the card for a usable adult BMI below 18.5, including height and weight rows sharing one eventId',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'known underweight, frailty, malnutrition risk, and calorie targets below 1,200 kcal/day without flooring them upward',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'nutrition-strategy/references/daily-nutrition-card-goals.md',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Save one paused canonical proposal',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'explicit numeric-card request authorizes only the goal-aware workflow\'s paused canonical proposal, not activation or use',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'hold applicable, compatible explicit targets fixed, derive missing macros from residual calories, and require every AMDR plus a 50 kcal energy tolerance before any Goal write',
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
      'its next unambiguous acceptance may complete that pending request after activation, safety recheck, and a fresh same-date totals read',
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
      'conflicts, ranges, unsafe numbers, or missing responsible calorie inputs',
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
    expect(readCardToolRequest({ card: CARD_V2 })).toEqual({
      card: CARD_V2,
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

    const contradictoryCard = {
      ...CARD_V2,
      totals: {
        ...CARD_V2.totals,
        calories: { total: 2_300, mealCount: 3 },
      },
      goals: {
        ...CARD_V2.goals,
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

import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
  LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT,
  assistantResponseCardJsonSchema,
  assistantResponseCardSchema,
  buildLinqIMessageAppLayout,
  encodeAppCardDataUrl,
  renderAssistantResponseCardText,
  type DailyNutritionResponseCard,
  type DailyNutritionResponseCardV2,
} from '../src/assistant-response-cards.ts'

const COMPLETE_CARD: DailyNutritionResponseCard = {
  kind: 'daily_nutrition',
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
  },
}

const COMPLETE_CARD_V2: DailyNutritionResponseCardV2 = {
  kind: 'daily_nutrition',
  version: 2,
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1490.25, mealCount: 3 },
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

describe('assistant response cards', () => {
  it('derives the model-facing JSON schema from the runtime contract', () => {
    expect(assistantResponseCardJsonSchema).not.toHaveProperty('$schema')
    expect(assistantResponseCardJsonSchema).toMatchObject({
      anyOf: [
        {
          additionalProperties: false,
          properties: {
            goals: {
              properties: {
                calories: {
                  anyOf: [
                    {
                      properties: {
                        status: {
                          enum: [
                            'far_under_target',
                            'under_target',
                            'on_target',
                            'over_target',
                            'far_over_target',
                            'unavailable',
                          ],
                        },
                        target: { type: 'number' },
                      },
                    },
                    { type: 'null' },
                  ],
                },
              },
            },
            kind: { const: 'daily_nutrition' },
            totals: {
              properties: {
                fiberGrams: {
                  anyOf: [
                    {
                      properties: {
                        total: { type: 'number' },
                      },
                    },
                    {
                      properties: {
                        mealCount: { const: 0 },
                        total: { type: 'null' },
                      },
                    },
                  ],
                },
              },
            },
            version: { const: 2 },
          },
        },
        {
          additionalProperties: false,
          properties: {
            kind: { const: 'daily_nutrition' },
            totals: {
              properties: {
                calories: {
                  properties: {
                    total: { type: 'number' },
                  },
                },
                proteinGrams: {
                  anyOf: [
                    {
                      additionalProperties: false,
                      properties: {
                        total: { type: 'number' },
                      },
                    },
                    {
                      additionalProperties: false,
                      properties: {
                        mealCount: { const: 0 },
                        total: { type: 'null' },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    })
  })

  it('rejects malformed, unknown, and implausible daily nutrition values', () => {
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD,
      kind: 'unknown',
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD,
      extra: true,
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD,
      localDate: '2026-02-30',
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD,
      mealCount: 101,
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD,
      mealCount: 0,
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD,
      totals: {
        ...COMPLETE_CARD.totals,
        calories: { total: null, mealCount: 0 },
      },
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD,
      totals: {
        ...COMPLETE_CARD.totals,
        proteinGrams: { total: Number.POSITIVE_INFINITY, mealCount: 3 },
      },
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD,
      totals: {
        ...COMPLETE_CARD.totals,
        calories: { total: -1, mealCount: 3 },
      },
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD,
      totals: {
        ...COMPLETE_CARD.totals,
        carbsGrams: { total: 2_001, mealCount: 3 },
      },
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD,
      totals: {
        ...COMPLETE_CARD.totals,
        fatGrams: { total: 12, mealCount: 4 },
      },
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD,
      totals: {
        ...COMPLETE_CARD.totals,
        proteinGrams: { total: 12, mealCount: 0 },
      },
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD,
      totals: {
        ...COMPLETE_CARD.totals,
        proteinGrams: { total: null, mealCount: 1 },
      },
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD_V2,
      goals: {
        ...COMPLETE_CARD_V2.goals,
        proteinGrams: { target: 0, status: 'on_target' },
      },
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD_V2,
      goals: {
        ...COMPLETE_CARD_V2.goals,
        fiberGrams: { target: 30, status: 'close_enough' },
      },
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD_V2,
      goals: {
        proteinGrams: null,
      },
    })).toThrow()
    expect(() => assistantResponseCardSchema.parse({
      ...COMPLETE_CARD_V2,
      totals: {
        ...COMPLETE_CARD_V2.totals,
        fiberGrams: { total: null, mealCount: 0 },
      },
      goals: {
        ...COMPLETE_CARD_V2.goals,
        fiberGrams: { target: 30, status: 'on_target' },
      },
    })).toThrow()
  })

  it('round-trips the minified V1 envelope without changing any number', () => {
    const dataUrl = encodeAppCardDataUrl(COMPLETE_CARD)
    expect(dataUrl.length).toBeLessThan(4_096)
    const encoded = dataUrl.replace('data:application/json;base64,', '')
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')

    expect(decoded).not.toContain('\n')
    expect(JSON.parse(decoded)).toEqual({
      schemaVersion: 1,
      card: COMPLETE_CARD,
    })
  })

  it('round-trips the minified V2 envelope with fiber and frozen goal context', () => {
    const dataUrl = encodeAppCardDataUrl(COMPLETE_CARD_V2)
    expect(dataUrl.length).toBeLessThan(4_096)
    const encoded = dataUrl.replace('data:application/json;base64,', '')
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')

    expect(decoded).not.toContain('\n')
    expect(JSON.parse(decoded)).toEqual({
      schemaVersion: 2,
      card: COMPLETE_CARD_V2,
    })
  })

  it('renders deterministic complete and partial semantic text', () => {
    expect(renderAssistantResponseCardText(COMPLETE_CARD)).toBe(
      'Jul 28: about 1,490.25 calories · 94.5g protein · 193.125g carbs · 34.75g fat from 3 logged meals.',
    )

    expect(renderAssistantResponseCardText({
      ...COMPLETE_CARD,
      totals: {
        ...COMPLETE_CARD.totals,
        proteinGrams: { total: 94.5, mealCount: 2 },
        carbsGrams: { total: null, mealCount: 0 },
      },
    })).toBe(
      'Jul 28: about 1,490.25 calories · 94.5g protein · 34.75g fat from 3 logged meals. Some macro estimates were partial.',
    )

    expect(renderAssistantResponseCardText(COMPLETE_CARD_V2)).toBe(
      'Jul 28: about 1,490.25 calories · 94.5g protein · 193.125g carbs · 34.75g fat · 26.5g fiber from 3 logged meals.',
    )
    expect(renderAssistantResponseCardText({
      ...COMPLETE_CARD_V2,
      totals: {
        ...COMPLETE_CARD_V2.totals,
        fiberGrams: { total: null, mealCount: 0 },
      },
      goals: {
        ...COMPLETE_CARD_V2.goals,
        fiberGrams: { target: 30, status: 'unavailable' },
      },
    })).toBe(
      'Jul 28: about 1,490.25 calories · 94.5g protein · 193.125g carbs · 34.75g fat from 3 logged meals. Some nutrition estimates were partial.',
    )
  })

  it('uses the same bounded display precision as the native card', () => {
    expect(renderAssistantResponseCardText({
      ...COMPLETE_CARD,
      totals: {
        ...COMPLETE_CARD.totals,
        calories: { total: 1_490.123_9, mealCount: 3 },
        proteinGrams: { total: 0.1 + 0.2, mealCount: 3 },
      },
    })).toContain('about 1,490.124 calories · 0.3g protein')
  })

  it('derives calorie and combined partial labels from supporting meal counts', () => {
    expect(renderAssistantResponseCardText({
      ...COMPLETE_CARD,
      totals: {
        ...COMPLETE_CARD.totals,
        calories: { total: 1_490.25, mealCount: 2 },
      },
    }).endsWith('Some calorie estimates were partial.')).toBe(true)

    expect(renderAssistantResponseCardText({
      ...COMPLETE_CARD,
      totals: {
        ...COMPLETE_CARD.totals,
        calories: { total: 1_490.25, mealCount: 2 },
        proteinGrams: { total: null, mealCount: 0 },
      },
    }).endsWith('Some calorie and macro estimates were partial.')).toBe(true)
  })

  it('keeps the Linq fallback and layout static and value-free', () => {
    const layout = buildLinqIMessageAppLayout(COMPLETE_CARD)
    expect(LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT).toBe(
      'Open your Murph nutrition summary',
    )
    expect(layout).toEqual({
      caption: 'Murph',
      subcaption: 'Nutrition summary',
      trailing_caption: 'OPEN',
    })
    const staticPresentation = JSON.stringify({
      fallbackText: LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT,
      layout,
    })
    expect(staticPresentation).not.toMatch(/1490|94|193|34|2026-07-28|today|day|time/iu)
  })
})

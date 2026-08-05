import { describe, expect, it } from 'vitest'

import {
  LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT,
  LINQ_IMESSAGE_APP_CARD_URL,
  assistantResponseCardJsonSchema,
  assistantResponseCardSchema,
  buildLinqIMessageAppLayout,
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

  it('rejects contradictory or complete-looking status for untrusted totals', () => {
    const invalidGoals = [
      {
        totals: {
          ...COMPLETE_CARD_V2.totals,
          calories: { total: 2_300, mealCount: 3 },
        },
        goals: {
          ...COMPLETE_CARD_V2.goals,
          calories: { target: 2_000, status: 'under_target' },
        },
      },
      {
        totals: {
          ...COMPLETE_CARD_V2.totals,
          proteinGrams: { total: 80, mealCount: 3 },
        },
        goals: {
          ...COMPLETE_CARD_V2.goals,
          proteinGrams: { target: 120, status: 'far_over_target' },
        },
      },
      {
        totals: {
          ...COMPLETE_CARD_V2.totals,
          fiberGrams: { total: 20, mealCount: 2 },
        },
        goals: {
          ...COMPLETE_CARD_V2.goals,
          fiberGrams: { target: 30, status: 'under_target' },
        },
      },
    ] as const

    for (const invalid of invalidGoals) {
      expect(() => assistantResponseCardSchema.parse({
        ...COMPLETE_CARD_V2,
        ...invalid,
      })).toThrow()
    }

    for (const status of ['on_target', 'unavailable'] as const) {
      expect(() => assistantResponseCardSchema.parse({
        ...COMPLETE_CARD_V2,
        totals: {
          ...COMPLETE_CARD_V2.totals,
          proteinGrams: { total: 100, mealCount: 3 },
        },
        goals: {
          ...COMPLETE_CARD_V2.goals,
          proteinGrams: { target: 100, status },
        },
      })).not.toThrow()
    }
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

  it('renders complete and partial totals in the Linq static layout', () => {
    const completeLayout = buildLinqIMessageAppLayout(COMPLETE_CARD)
    const partialLayout = buildLinqIMessageAppLayout({
      ...COMPLETE_CARD_V2,
      mealCount: 4,
      goals: {
        calories: null,
        proteinGrams: null,
        carbsGrams: null,
        fatGrams: null,
        fiberGrams: null,
      },
    })
    expect(LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT).toBe(
      'Open your Murph nutrition summary',
    )
    expect(LINQ_IMESSAGE_APP_CARD_URL).toBe('https://murph.ai')
    expect(LINQ_IMESSAGE_APP_CARD_URL.length).toBeLessThanOrEqual(2_048)
    expect(new URL(LINQ_IMESSAGE_APP_CARD_URL).protocol).toBe('https:')
    expect(completeLayout).toEqual({
      caption: 'Jul 28 · 3 meals',
      subcaption: '1,490.25 cal · 94.5g protein',
      trailing_caption: '193.125g carbs · 34.75g fat',
    })
    expect(partialLayout).toEqual({
      caption: 'Jul 28 · 4 meals',
      subcaption: '1,490.25 cal · 94.5g protein',
      trailing_caption: '193.125g carbs · 34.75g fat',
      trailing_subcaption: '26.5g fiber · PARTIAL TOTALS',
    })
    expect(LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT).not.toMatch(
      /\d|today|day|time/iu,
    )
  })
})

import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT,
  LINQ_IMESSAGE_APP_CARD_ORIGIN,
  assistantResponseCardAuthoringSchema,
  assistantResponseCardJsonSchema,
  assistantResponseCardSchema,
  buildLinqIMessageAppCardUrl,
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
    carbsGrams: { target: 220, status: 'on_target' },
    fatGrams: { target: 40, status: 'on_target' },
    fiberGrams: { target: 30, status: 'under_target' },
  },
}

function decodeAppCardUrl(url: string): unknown {
  const encoded = new URL(url).hash.replace(/^#murph-card=/u, '')
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
}

describe('assistant response cards', () => {
  it('authors only current cards while the runtime still accepts nutrition V1', () => {
    expect(assistantResponseCardJsonSchema).not.toHaveProperty('$schema')
    expect(assistantResponseCardJsonSchema).toMatchObject({
      description: expect.stringContaining('daily_nutrition V2'),
      anyOf: [
        {
          additionalProperties: false,
          properties: {
            goals: {
              properties: {
                calories: {
                  additionalProperties: false,
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
                  required: ['target', 'status'],
                  type: 'object',
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
          required: [
            'kind',
            'version',
            'localDate',
            'mealCount',
            'totals',
            'goals',
          ],
        },
        {
          additionalProperties: false,
          properties: {
            columns: {
              maxItems: 4,
              minItems: 1,
              type: 'array',
            },
            kind: { const: 'compact_table' },
            rows: {
              maxItems: 8,
              minItems: 1,
              type: 'array',
            },
            tracking: {
              anyOf: [
                {
                  additionalProperties: false,
                  properties: {
                    kind: { const: 'workout' },
                  },
                },
                { type: 'null' },
              ],
            },
            version: { const: 1 },
          },
          required: [
            'kind',
            'version',
            'title',
            'subtitle',
            'rowHeader',
            'columns',
            'rows',
            'footer',
            'tracking',
          ],
        },
      ],
    })
    expect(assistantResponseCardJsonSchema).not.toHaveProperty('$defs')
    expect(assistantResponseCardSchema.parse(COMPLETE_CARD)).toEqual(COMPLETE_CARD)
    expect(assistantResponseCardAuthoringSchema.parse(COMPLETE_CARD_V2)).toEqual(
      COMPLETE_CARD_V2,
    )
    expect(assistantResponseCardAuthoringSchema.safeParse(COMPLETE_CARD).success)
      .toBe(false)

    for (const metric of [
      'calories',
      'proteinGrams',
      'carbsGrams',
      'fatGrams',
      'fiberGrams',
    ] as const) {
      const legacyCompatibleCard = {
        ...COMPLETE_CARD_V2,
        goals: {
          ...COMPLETE_CARD_V2.goals,
          [metric]: null,
        },
      }
      expect(
        assistantResponseCardAuthoringSchema.safeParse(legacyCompatibleCard)
          .success,
      ).toBe(false)
      expect(assistantResponseCardSchema.parse(legacyCompatibleCard)).toEqual(
        legacyCompatibleCard,
      )
    }
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
      'Jul 28: about 1,490.25 calories · 94.5g protein · 193.125g carbs · 34.75g fat · 26.5g fiber from 3 logged meals. Targets: 2,100 calories (UNDER TARGET) · 100g protein (ON TARGET) · 220g carbs (ON TARGET) · 40g fat (ON TARGET) · 30g fiber (UNDER TARGET).',
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
      'Jul 28: about 1,490.25 calories · 94.5g protein · 193.125g carbs · 34.75g fat from 3 logged meals. Targets: 2,100 calories (UNDER TARGET) · 100g protein (ON TARGET) · 220g carbs (ON TARGET) · 40g fat (ON TARGET) · 30g fiber (STATUS UNAVAILABLE). Some nutrition estimates were partial.',
    )

    expect(renderAssistantResponseCardText({
      ...COMPLETE_CARD_V2,
      goals: {
        ...COMPLETE_CARD_V2.goals,
        carbsGrams: null,
      },
    })).toContain('carbs target unavailable')
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

  it('omits unavailable layout metrics while retaining the partial marker', () => {
    expect(buildLinqIMessageAppLayout({
      ...COMPLETE_CARD_V2,
      totals: {
        calories: { total: 1_490.25, mealCount: 3 },
        proteinGrams: { total: null, mealCount: 0 },
        carbsGrams: { total: null, mealCount: 0 },
        fatGrams: { total: null, mealCount: 0 },
        fiberGrams: { total: null, mealCount: 0 },
      },
      goals: {
        calories: null,
        proteinGrams: null,
        carbsGrams: null,
        fatGrams: null,
        fiberGrams: null,
      },
    })).toEqual({
      caption: 'Jul 28 · 3 meals · PARTIAL TOTALS',
      subcaption: '1,490.25 cal',
    })
  })

  it('builds interactive snapshots and truthful Linq fallback layouts', () => {
    const completeLayout = buildLinqIMessageAppLayout(COMPLETE_CARD)
    const goalLayout = buildLinqIMessageAppLayout(COMPLETE_CARD_V2)
    const proteinGoalLayout = buildLinqIMessageAppLayout({
      ...COMPLETE_CARD_V2,
      goals: {
        calories: null,
        proteinGrams: { target: 100, status: 'on_target' },
        carbsGrams: null,
        fatGrams: null,
        fiberGrams: null,
      },
    })
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
      'Ask Murph for this card in text',
    )
    const completeCardUrl = buildLinqIMessageAppCardUrl(COMPLETE_CARD)
    const goalCardUrl = buildLinqIMessageAppCardUrl(COMPLETE_CARD_V2)
    expect(LINQ_IMESSAGE_APP_CARD_ORIGIN).toBe('https://www.withmurph.ai')
    expect(completeCardUrl.startsWith(
      `${LINQ_IMESSAGE_APP_CARD_ORIGIN}/#murph-card=`,
    )).toBe(true)
    expect(completeCardUrl.length).toBeLessThan(2_048)
    expect(goalCardUrl.length).toBeLessThan(2_048)
    expect(new URL(goalCardUrl).protocol).toBe('https:')
    expect(decodeAppCardUrl(completeCardUrl)).toEqual({
      schemaVersion: 1,
      card: COMPLETE_CARD,
    })
    expect(decodeAppCardUrl(goalCardUrl)).toEqual({
      schemaVersion: 2,
      card: COMPLETE_CARD_V2,
    })
    expect(completeLayout).toEqual({
      caption: 'Jul 28 · 3 meals',
      subcaption: '1,490.25 cal',
      trailing_caption: '94.5g protein · 193.125g carbs',
      trailing_subcaption: '34.75g fat',
    })
    expect(goalLayout).toEqual({
      caption: 'Jul 28 · 3 meals',
      subcaption: '1,490.25 cal · 2,100 cal goal · UNDER TARGET',
      trailing_caption: '94.5g protein · 193.125g carbs',
      trailing_subcaption: '34.75g fat · 26.5g fiber',
    })
    expect(proteinGoalLayout.subcaption).toBe(
      '1,490.25 cal · 100g protein goal · ON TARGET',
    )
    expect(partialLayout).toEqual({
      caption: 'Jul 28 · 4 meals · PARTIAL TOTALS',
      subcaption: '1,490.25 cal',
      trailing_caption: '94.5g protein · 193.125g carbs',
      trailing_subcaption: '34.75g fat · 26.5g fiber',
    })
    expect(LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT).not.toMatch(
      /\d|today|day|time/iu,
    )
  })
})

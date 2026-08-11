import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  LINQ_IMESSAGE_APP_CARD_ORIGIN,
  assistantResponseCardAuthoringSchema,
  assistantResponseCardJsonSchema,
  assistantResponseCardSchema,
  buildLinqIMessageAppFallbackText,
  buildLinqIMessageAppCardUrl,
  buildLinqIMessageAppCardImageUrl,
  buildLinqIMessageAppLayout,
  buildTelegramRichMessage,
  exerciseRoutineResponseCardJsonSchema,
  renderAssistantResponseCardText,
  type DailyNutritionResponseCard,
  type DailyNutritionResponseCardV2,
  type ExerciseRoutineResponseCardV1,
  type AssistantResponseCard,
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

const ROUTINE_CARD: ExerciseRoutineResponseCardV1 = {
  exercises: [
    {
      dose: '8 repetitions',
      estimatedSeconds: 45,
      images: [
        {
          alt: 'Person standing tall with the forearm on a door frame.',
          source: 'exercise_catalog:ST170:1',
          step: 'Setup',
          url: 'https://cdn.example.test/doorway-stretch.png?x=1&y=2',
        },
      ],
      instructions: [
        'Stand tall without forcing the lower back.',
        'Move only through a comfortable range.',
      ],
      name: 'Doorway stretch <easy>',
    },
    {
      dose: '5 per side',
      estimatedSeconds: 60,
      images: [],
      instructions: ['Turn slowly and keep the hips quiet.'],
      name: 'Torso rotation',
    },
  ],
  footer: 'Breathe normally.',
  intensity: 'Easy',
  kind: 'exercise_routine',
  labels: {
    dose: 'Dose',
    exercise: 'Exercise',
    time: 'Time',
    visualGuide: 'Visual guide',
  },
  safety: 'Stop if pain or dizziness increases.',
  subtitle: 'Shoulders and chest',
  title: 'Short reset',
  totalSeconds: 120,
  transitionSeconds: 15,
  version: 1,
}

function decodeAppCardUrl(url: string): unknown {
  const encoded = new URL(url).hash.replace(/^#murph-card=/u, '')
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
}

function decodeAppCardImageUrl(url: string): unknown {
  const filename = new URL(url).pathname.split('/').at(-1) ?? ''
  const encoded = filename.replace(/\.png$/u, '')
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
              additionalProperties: false,
              patternProperties: {
                '^(?:proteinGrams|carbsGrams|fatGrams|fiberGrams)$': {
                  additionalProperties: false,
                  properties: {
                    target: {
                      exclusiveMinimum: 0,
                      maximum: 2_000,
                      type: 'number',
                    },
                  },
                  required: ['target', 'status'],
                  type: 'object',
                },
              },
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
                    target: {
                      exclusiveMinimum: 0,
                      maximum: 20_000,
                      type: 'number',
                    },
                  },
                  required: ['target', 'status'],
                  type: 'object',
                },
                proteinGrams: {
                  additionalProperties: false,
                  type: 'object',
                },
                carbsGrams: {},
                fatGrams: {},
                fiberGrams: {},
              },
            },
            kind: { const: 'daily_nutrition' },
            localDate: {
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
              type: 'string',
            },
            mealCount: {
              maximum: 100,
              minimum: 1,
              type: 'integer',
            },
            totals: {
              additionalProperties: false,
              patternProperties: {
                '^(?:proteinGrams|carbsGrams|fatGrams|fiberGrams)$': {
                  additionalProperties: false,
                  properties: {
                    mealCount: {
                      maximum: 100,
                      minimum: 0,
                      type: 'integer',
                    },
                    total: {
                      maximum: 2_000,
                      minimum: 0,
                      type: ['number', 'null'],
                    },
                  },
                },
              },
              properties: {
                calories: {
                  additionalProperties: false,
                  properties: {
                    mealCount: {
                      maximum: 100,
                      minimum: 1,
                      type: 'integer',
                    },
                    total: {
                      maximum: 20_000,
                      minimum: 0,
                      type: 'number',
                    },
                  },
                },
                proteinGrams: {
                  additionalProperties: false,
                  properties: {
                    total: {
                      maximum: 2_000,
                      minimum: 0,
                      type: ['number', 'null'],
                    },
                  },
                },
                carbsGrams: {},
                fatGrams: {},
                fiberGrams: {},
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
          allOf: [
            {
              additionalProperties: false,
              properties: {
                columns: {
                  maxItems: 4,
                  minItems: 1,
                  type: 'array',
                },
                kind: { const: 'compact_table' },
                title: {
                  minLength: 1,
                  pattern: '^\\S(?:.*\\S)?$',
                  type: 'string',
                },
                rows: {
                  maxItems: 8,
                  minItems: 1,
                  type: 'array',
                },
                tracking: {
                  additionalProperties: false,
                  properties: {
                    entityId: {
                      maxLength: 30,
                      pattern: '^evt_[0-9A-HJKMNP-TV-Z]{26}$',
                    },
                    kind: { const: 'workout' },
                    snapshotAt: {
                      maxLength: 24,
                      minLength: 24,
                      pattern: expect.stringContaining('\\.\\d{3}Z'),
                    },
                  },
                  type: ['object', 'null'],
                },
                version: { const: 1 },
              },
              required: [
                'kind',
                'version',
                'title',
                'subtitle',
                'footer',
                'tracking',
              ],
            },
            {},
          ],
        },
      ],
    })
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

  it('keeps routine timing model-authored and renders one accessible rich message', () => {
    expect(exerciseRoutineResponseCardJsonSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        exercises: { maxItems: 8, minItems: 1, type: 'array' },
        kind: { const: 'exercise_routine' },
        totalSeconds: { maximum: 3600, type: 'integer' },
        version: { const: 1 },
      },
    })
    expect(assistantResponseCardSchema.parse(ROUTINE_CARD)).toEqual(ROUTINE_CARD)
    expect(assistantResponseCardSchema.parse({
      ...ROUTINE_CARD,
      totalSeconds: 480,
    })).toMatchObject({ totalSeconds: 480 })

    expect(renderAssistantResponseCardText(ROUTINE_CARD)).toContain(
      'Doorway stretch <easy> — 8 repetitions (45s)',
    )
    const richMessage = buildTelegramRichMessage(ROUTINE_CARD)
    expect(richMessage.html).toContain('<details>')
    expect(richMessage.html).toContain(
      '<details><summary>Doorway stretch &lt;easy&gt;</summary><p><b>Dose:</b> 8 repetitions · <b>Time:</b> 45s</p>',
    )
    expect(richMessage.html).toContain(
      '</ol><tg-slideshow><img src="https://cdn.example.test/doorway-stretch.png?x=1&amp;y=2"/></tg-slideshow></details>',
    )
    expect(richMessage.html).not.toContain('<th>Exercise</th>')
    expect(richMessage.html).toContain('Doorway stretch &lt;easy&gt;')
    expect(richMessage.html).not.toContain('<figcaption>')
    expect(richMessage.html).not.toContain('Person standing tall')
  })

  it('preserves nutrition goals in the Telegram rich projection', () => {
    const richMessage = buildTelegramRichMessage(COMPLETE_CARD_V2)
    expect(richMessage.html).toContain(
      `<figure><img src="${buildLinqIMessageAppCardImageUrl(COMPLETE_CARD_V2)}"/></figure>`,
    )
    expect(richMessage.html).toContain(
      '<details><summary>Daily goals</summary><table bordered>',
    )
    expect(richMessage.html).toContain(
      '<tr><td>Calories</td><td align="right">2,100 cal</td><td>🟠 Below target</td></tr>',
    )
    expect(richMessage.html).toContain(
      '<tr><td>Protein</td><td align="right">100g</td><td>🟢 On target</td></tr>',
    )
    expect(richMessage.html).not.toContain('<summary>Goals</summary><ul>')
    expect(richMessage.html).toContain('<table bordered striped>')
  })

  it('renders generic tables, workouts, and standings as Telegram rich cards', () => {
    const genericTable = {
      columns: ['Result <now>'],
      footer: null,
      kind: 'compact_table',
      rows: [{ label: 'Mobility', values: ['Complete & calm'] }],
      rowHeader: 'Exercise',
      subtitle: null,
      title: 'Today',
      tracking: null,
      version: 1,
    } satisfies AssistantResponseCard
    const workout = {
      footer: 'Reply to log a set.',
      kind: 'compact_table',
      subtitle: null,
      title: 'Strength',
      tracking: {
        entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
        kind: 'workout',
        snapshotAt: '2026-08-11T10:00:00.000Z',
      },
      version: 1,
      workout: {
        exercises: [{
          name: 'Goblet squat',
          sets: [{ actual: '10', status: 'completed', target: '8–10' }],
        }],
        state: 'active',
        version: 1,
      },
    } satisfies AssistantResponseCard
    const standings = {
      entries: [{
        coverage: 'complete',
        detail: null,
        label: 'Team <A>',
        points: 120,
      }],
      footer: null,
      format: 'teams',
      kind: 'challenge_standings',
      objective: { kind: 'ranking' },
      subtitle: null,
      title: 'Weekly standings',
      version: 1,
    } satisfies AssistantResponseCard

    expect(buildTelegramRichMessage(genericTable).html).toContain(
      'Result &lt;now&gt;',
    )
    expect(buildTelegramRichMessage(genericTable).html).toContain(
      'Complete &amp; calm',
    )
    expect(buildTelegramRichMessage(workout).html).toContain('Goblet squat')
    expect(buildTelegramRichMessage(workout).html).toContain(
      '1/1 sets complete',
    )
    expect(buildTelegramRichMessage(standings).html).toContain('Team &lt;A&gt;')
    expect(renderAssistantResponseCardText(standings)).toContain(
      'Team <A>: 120 points',
    )
  })

  it('keeps exercise routine cards on the deterministic iMessage text fallback', () => {
    expect(() => buildLinqIMessageAppLayout(ROUTINE_CARD)).toThrow(
      'do not have a native iMessage layout',
    )
    expect(() => buildLinqIMessageAppCardUrl(ROUTINE_CARD)).toThrow(
      'do not have a native iMessage app URL',
    )
  })

  it('keeps a maximum-count routine within one rich message and one text fallback', () => {
    const imageUrlPrefix = 'https://cdn.example.test/'
    const maximumText = 'x'.repeat(160)
    const maximumAltText = 'x'.repeat(500)
    const longExerciseText = 'x'.repeat(80)
    const maximumImageUrl = imageUrlPrefix.padEnd(500, 'a')
    const maximumRoutine: ExerciseRoutineResponseCardV1 = {
      ...ROUTINE_CARD,
      exercises: Array.from({ length: 8 }, () => ({
        dose: longExerciseText,
        estimatedSeconds: 1,
        images: [{
          alt: maximumAltText,
          source: 'exercise_catalog:EX001:1',
          step: maximumText,
          url: maximumImageUrl,
        }],
        instructions: [longExerciseText, longExerciseText],
        name: longExerciseText,
      })),
      footer: maximumText,
      intensity: maximumText,
      labels: {
        dose: maximumText,
        exercise: maximumText,
        time: maximumText,
        visualGuide: maximumText,
      },
      safety: maximumText,
      subtitle: maximumText,
      title: maximumText,
      totalSeconds: 8,
      transitionSeconds: 0,
    }

    const parsed = assistantResponseCardSchema.parse(maximumRoutine)
    expect(buildTelegramRichMessage(parsed).html.length).toBeLessThanOrEqual(
      32_768,
    )
    expect(renderAssistantResponseCardText(parsed).length).toBeLessThanOrEqual(
      4_096,
    )

    expect(() => assistantResponseCardSchema.parse({
      ...maximumRoutine,
      exercises: maximumRoutine.exercises.map((exercise) => ({
        ...exercise,
        dose: maximumText,
        instructions: [maximumText, maximumText, maximumText],
        name: maximumText,
      })),
    })).toThrow('text fallback must fit 4096 characters')
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
      'Jul 28: about 1,490.25 calories · 94.5g protein · 193.125g carbs · 34.75g fat · 26.5g fiber from 3 logged meals. Targets: 2,100 calories (under target) · 100g protein (on target) · 220g carbs (on target) · 40g fat (on target) · 30g fiber (under target).',
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
      'Jul 28: about 1,490.25 calories · 94.5g protein · 193.125g carbs · 34.75g fat from 3 logged meals. Targets: 2,100 calories (under target) · 100g protein (on target) · 220g carbs (on target) · 40g fat (on target) · 30g fiber (status unavailable). Some nutrition estimates were partial.',
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

  it('keeps the static nutrition layout concise when metrics are unavailable', () => {
    const card: DailyNutritionResponseCardV2 = {
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
    }
    expect(buildLinqIMessageAppLayout(card)).toEqual({
      caption: 'Jul 28 · 3 meals',
      image_url: buildLinqIMessageAppCardImageUrl(card),
      subcaption: 'Some nutrition estimates were partial.',
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
    const completeNoGoalsLayout = buildLinqIMessageAppLayout({
      ...COMPLETE_CARD_V2,
      goals: {
        calories: null,
        proteinGrams: null,
        carbsGrams: null,
        fatGrams: null,
        fiberGrams: null,
      },
    })
    const directionalGoalsLayout = buildLinqIMessageAppLayout({
      ...COMPLETE_CARD_V2,
      goals: {
        calories: { target: 3_000, status: 'far_under_target' },
        proteinGrams: { target: 90, status: 'over_target' },
        carbsGrams: null,
        fatGrams: null,
        fiberGrams: null,
      },
    })
    expect(buildLinqIMessageAppFallbackText(COMPLETE_CARD_V2)).toBe(
      'Your daily nutrition. Ask Murph for this card in text',
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
      image_url: buildLinqIMessageAppCardImageUrl(COMPLETE_CARD),
    })
    expect(goalLayout).toEqual({
      caption: 'Jul 28 · 3 meals',
      image_url: buildLinqIMessageAppCardImageUrl(COMPLETE_CARD_V2),
    })
    expect(proteinGoalLayout).not.toHaveProperty('subcaption')
    expect(completeNoGoalsLayout).not.toHaveProperty('subcaption')
    expect(directionalGoalsLayout).not.toHaveProperty('subcaption')
    expect(decodeAppCardImageUrl(proteinGoalLayout.image_url ?? '')).toEqual({
      schemaVersion: 2,
      card: {
        ...COMPLETE_CARD_V2,
        goals: {
          calories: null,
          proteinGrams: { target: 100, status: 'on_target' },
          carbsGrams: null,
          fatGrams: null,
          fiberGrams: null,
        },
      },
    })
    expect(partialLayout).toEqual({
      caption: 'Jul 28 · 4 meals',
      image_url: expect.stringMatching(
        /^https:\/\/www\.withmurph\.ai\/imessage\/card\/v1\/[A-Za-z0-9_-]+\.png$/u,
      ),
      subcaption: 'Some calorie and nutrition estimates were partial.',
    })
    expect(buildLinqIMessageAppCardImageUrl(COMPLETE_CARD_V2).length)
      .toBeLessThan(2_048)
    expect(buildLinqIMessageAppFallbackText(COMPLETE_CARD_V2)).not.toMatch(
      /\d|today|day|time/iu,
    )
  })
})

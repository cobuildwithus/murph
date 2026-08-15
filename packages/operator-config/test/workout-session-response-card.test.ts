import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
  LINQ_IMESSAGE_APP_CARD_ORIGIN,
  assistantResponseCardJsonSchema,
  assistantResponseCardSchema,
  buildLinqIMessageAppLayout,
  encodeCompactTableAppCardUrl,
  encodeWorkoutSessionAppCardUrl,
  renderAssistantResponseCardText,
  renderAssistantResponseCardTranscriptText,
  type AssistantResponseCard,
  type CompactTableResponseCardV1,
} from '../src/assistant-response-cards.js'

const OPAQUE_ACTION_BINDING =
  '95958f9f83e6943ceb56704e19216f7ff6e105a9b74d8a5e466754b266f67a9a'

const ACTIVE_WORKOUT_CARD = {
  kind: 'compact_table',
  version: 1,
  title: 'Push day',
  subtitle: null,
  footer: 'Reply with the exercise, set, and result to log or correct it.',
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-09T19:45:00.000Z',
  },
  workout: {
    version: 1,
    state: 'active',
    exercises: [
      {
        name: 'Bench press',
        sets: [
          {
            status: 'completed',
            target: '185 lb × 8',
            actual: '185 lb × 8',
          },
          {
            status: 'completed',
            target: '185 lb × 8',
            actual: '185 lb × 7',
          },
          {
            status: 'pending',
            target: '185 lb × 6–8',
            actual: null,
          },
        ],
      },
      {
        name: 'Incline dumbbell press',
        sets: [
          {
            status: 'completed',
            target: '55 lb × 10',
            actual: '55 lb × 10',
          },
          {
            status: 'pending',
            target: '55 lb × 8–10',
            actual: null,
          },
          {
            status: 'pending',
            target: null,
            actual: null,
          },
        ],
      },
    ],
  },
  editor: {
    actionBinding: OPAQUE_ACTION_BINDING,
    version: 1,
    setRemovalBinding: 'b'.repeat(64),
    exercises: [
      {
        unitOverride: 'lb',
        sets: [
          {
            logged: true,
            result: {
              kind: 'weight_reps',
              reps: 8,
              weight: 185,
              weightUnit: null,
            },
          },
          {
            logged: true,
            result: {
              kind: 'weight_reps',
              reps: 7,
              weight: 185,
              weightUnit: 'lb',
            },
          },
          {
            logged: false,
            result: null,
          },
        ],
      },
      {
        unitOverride: 'lb',
        sets: [
          {
            logged: true,
            result: {
              kind: 'weight_reps',
              reps: 10,
              weight: 55,
              weightUnit: null,
            },
          },
          {
            logged: false,
            result: null,
          },
          {
            logged: false,
            result: null,
          },
        ],
      },
    ],
  },
} satisfies AssistantResponseCard

const ORDINARY_TABLE = {
  kind: 'compact_table',
  version: 1,
  title: 'Push day',
  subtitle: null,
  rowHeader: 'Exercise',
  columns: ['Progress'],
  rows: [{ label: 'Bench press', values: ['2/3'] }],
  footer: null,
  tracking: null,
} satisfies AssistantResponseCard

const APP_CARD_URL_PREFIX = `${LINQ_IMESSAGE_APP_CARD_ORIGIN}/#murph-card=`

function decodeAppCardUrl(url: string): unknown {
  expect(url.startsWith(APP_CARD_URL_PREFIX)).toBe(true)
  return JSON.parse(
    Buffer.from(url.slice(APP_CARD_URL_PREFIX.length), 'base64url')
      .toString('utf8'),
  )
}

function decodeImageCardUrl(url: string): unknown {
  const encoded = new URL(url).pathname
    .replace(/^\/imessage\/card\/v1\//u, '')
    .replace(/\.png$/u, '')
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
}

describe('workout session response cards', () => {
  it('binds the native editor without exposing canonical workout identity', () => {
    const url = encodeWorkoutSessionAppCardUrl(ACTIVE_WORKOUT_CARD)

    expect(url.length).toBeLessThan(2_048)
    expect(decodeAppCardUrl(url)).toEqual({
      schemaVersion: 6,
      card: {
        b: ACTIVE_WORKOUT_CARD.editor.actionBinding,
        d: ACTIVE_WORKOUT_CARD.editor.setRemovalBinding,
        k: 'w',
        v: 1,
        t: 'Push day',
        u: null,
        s: 'a',
        e: [
          [
            'Bench press',
            'l',
            [
              ['c', '185 lb × 8', ['w', 8, 185, null]],
              ['c', '185 lb × 8', ['w', 7, 185, 'l']],
              ['p', '185 lb × 6–8', null],
            ],
          ],
          [
            'Incline dumbbell press',
            'l',
            [
              ['c', '55 lb × 10', ['w', 10, 55, null]],
              ['p', '55 lb × 8–10', null],
              ['p', null, null],
            ],
          ],
        ],
        f: 'Reply with the exercise, set, and result to log or correct it.',
      },
    })
    expect(JSON.stringify(decodeAppCardUrl(url))).not.toContain('evt_')
    expect(JSON.stringify(decodeAppCardUrl(url))).not.toContain('snapshotAt')
    const imageEnvelope = decodeImageCardUrl(
      buildLinqIMessageAppLayout(ACTIVE_WORKOUT_CARD).image_url ?? '',
    )
    expect(imageEnvelope).toMatchObject({ schemaVersion: 4 })
    expect(JSON.stringify(imageEnvelope)).not.toContain('"b"')
  })

  it('routes enhanced compact tables through V6 and ordinary tables through V3', () => {
    expect(encodeCompactTableAppCardUrl(ACTIVE_WORKOUT_CARD)).toBe(
      encodeWorkoutSessionAppCardUrl(ACTIVE_WORKOUT_CARD),
    )

    expect(decodeAppCardUrl(encodeCompactTableAppCardUrl(ORDINARY_TABLE))).toMatchObject({
      schemaVersion: 3,
      card: {
        kind: 'compact_table',
        title: 'Push day',
      },
    })
  })

  it('keeps realistic initial, late-active, and completed 6×4 cards within the native URL limit', () => {
    const exerciseNames = [
      'Dumbbell Single-Leg Romanian Deadlift',
      'Dumbbell Bulgarian Split Squat',
      'Dumbbell Walking Lunge in Place',
      'Split Squat with Front Heel Lift',
      'Dumbbell Reverse Lunge',
      'Dumbbell Step-Up',
    ]
    const targets = [
      '55 lb × 8–10',
      '55 lb × 10',
      '65 lb × 10–12',
      '65 lb × 12',
    ]
    const actuals = [
      '55 lb × 9',
      '55 lb × 10',
      '65 lb × 11',
      '65 lb × 12',
    ]
    const buildCard = (
      state: 'active' | 'completed',
      completedSetCount: number,
    ): CompactTableResponseCardV1 => {
      const { editor: _editor, ...base } = ACTIVE_WORKOUT_CARD
      const workout = {
        version: 1 as const,
        state,
        exercises: exerciseNames.map((name, exerciseIndex) => ({
          name,
          sets: targets.map((target, setIndex) => {
            const isCompleted =
              exerciseIndex * targets.length + setIndex < completedSetCount
            return {
              status: isCompleted ? 'completed' as const : 'pending' as const,
              target,
              actual: isCompleted ? actuals[setIndex] ?? target : null,
            }
          }),
        })),
      }
      return {
        ...base,
        title: 'Lower body strength',
        footer: state === 'active'
          ? 'Reply with the exercise, set, and result to log or correct it.'
          : 'Workout completed.',
        workout,
        ...(state === 'active'
          ? {
              editor: {
                actionBinding: 'a'.repeat(64),
                version: 1 as const,
                setRemovalBinding: 'b'.repeat(64),
                exercises: workout.exercises.map((exercise) => ({
                  unitOverride: 'lb' as const,
                  sets: exercise.sets.map((set, setIndex) => ({
                    logged: set.status === 'completed',
                    result: set.status === 'completed' ? {
                      kind: 'weight_reps' as const,
                      reps: [9, 10, 11, 12][setIndex]!,
                      weight: [55, 55, 65, 65][setIndex]!,
                      weightUnit: null,
                    } : null,
                  })),
                })),
              },
            }
          : {}),
      }
    }

    const urls = [
      buildCard('active', 0),
      buildCard('active', 18),
      buildCard('completed', 24),
    ].map((card) => {
      expect(assistantResponseCardSchema.parse(card)).toEqual(card)
      return encodeWorkoutSessionAppCardUrl(card)
    })

    expect(urls.map((url) => url.length)).toEqual([1624, 1905, 1624])
    expect(urls.every((url) => url.length < 2_048)).toBe(true)
  })

  it('renders a useful fallback and keeps tracking private to transcript context', () => {
    const visible = renderAssistantResponseCardText(ACTIVE_WORKOUT_CARD)
    expect(visible).toContain('Active workout · 3/6 sets complete')
    expect(visible).toContain(
      'Bench press: set 1: completed; actual 185 lb × 8; target 185 lb × 8 · set 2: completed; actual 185 lb × 7; target 185 lb × 8 · set 3: pending; target 185 lb × 6–8',
    )
    expect(visible).not.toContain('evt_')
    expect(visible).not.toContain('snapshot')
    expect(visible).not.toContain('Tap an exercise')

    const transcript = renderAssistantResponseCardTranscriptText(
      ACTIVE_WORKOUT_CARD,
    )
    expect(transcript).toContain(
      'Bench press: set 1: completed; actual 185 lb × 8; target 185 lb × 8',
    )
    expect(transcript).toContain(
      '[Murph tracked workout source: evt_01K1ABCDEFGHJKMNPQRSTVWXYZ; snapshot: 2026-08-09T19:45:00.000Z]',
    )

    const { editor: _editor, ...activePresentation } = ACTIVE_WORKOUT_CARD
    const legacyCard = {
      ...activePresentation,
      subtitle: '3/6 sets complete',
    } satisfies AssistantResponseCard
    expect(assistantResponseCardSchema.parse(legacyCard)).toEqual(legacyCard)
    expect(renderAssistantResponseCardText(legacyCard).match(
      /3\/6 sets complete/gu,
    )).toHaveLength(1)
    expect(decodeAppCardUrl(
      encodeWorkoutSessionAppCardUrl(legacyCard),
    )).toMatchObject({
      schemaVersion: 4,
      card: { u: '3/6 sets complete' },
    })
  })

  it('preserves a completed extra set without inventing a target', () => {
    const { editor: _editor, ...activePresentation } = ACTIVE_WORKOUT_CARD
    const completedExtraSetCard = {
      ...activePresentation,
      subtitle: '4 of 7 sets complete',
      workout: {
        ...ACTIVE_WORKOUT_CARD.workout,
        exercises: [
          {
            ...ACTIVE_WORKOUT_CARD.workout.exercises[0],
            sets: [
              ...ACTIVE_WORKOUT_CARD.workout.exercises[0].sets,
              {
                status: 'completed',
                target: null,
                actual: '205 lb × 5',
              },
            ],
          },
          ACTIVE_WORKOUT_CARD.workout.exercises[1],
        ],
      },
    } satisfies AssistantResponseCard
    const semanticSet = 'set 4: completed; actual 205 lb × 5'

    expect(renderAssistantResponseCardText(completedExtraSetCard)).toContain(
      semanticSet,
    )
    expect(buildLinqIMessageAppLayout(completedExtraSetCard).subcaption).toBe(
      '4/7 sets complete',
    )
    expect(renderAssistantResponseCardText(completedExtraSetCard)).not.toContain(
      `${semanticSet}; target`,
    )
  })

  it('builds a truthful Messages preview layout', () => {
    expect(buildLinqIMessageAppLayout(ACTIVE_WORKOUT_CARD)).toEqual({
      caption: 'Push day',
      image_url: expect.stringMatching(
        /^https:\/\/www\.withmurph\.ai\/imessage\/card\/v1\/[A-Za-z0-9_-]+\.png$/u,
      ),
      subcaption: '3/6 sets complete',
    })

    for (const [key, value] of Object.entries(
      buildLinqIMessageAppLayout(ACTIVE_WORKOUT_CARD),
    )) {
      if (key !== 'image_url') {
        expect(value.length).toBeLessThanOrEqual(512)
      }
    }
  })

  it('rejects impossible completion states before encoding', () => {
    const { editor: _editor, ...activePresentation } = ACTIVE_WORKOUT_CARD
    expect(assistantResponseCardSchema.safeParse({
      ...activePresentation,
      workout: {
        ...ACTIVE_WORKOUT_CARD.workout,
        state: 'completed',
      },
    }).success).toBe(false)

    expect(assistantResponseCardSchema.safeParse({
      ...activePresentation,
      workout: {
        ...ACTIVE_WORKOUT_CARD.workout,
        exercises: [
          {
            name: 'Bench press',
            sets: [
              {
                status: 'skipped',
                target: '185 lb × 8',
                actual: null,
              },
            ],
          },
        ],
      },
    }).success).toBe(false)

    expect(() => encodeWorkoutSessionAppCardUrl(ORDINARY_TABLE)).toThrow(
      /workout session detail/u,
    )
  })

  it('keeps the model-facing schema bounded and exposes workout detail', () => {
    expect(JSON.stringify(assistantResponseCardJsonSchema).length)
      .toBeLessThanOrEqual(5_000)
    expect(assistantResponseCardJsonSchema).toMatchObject({
      anyOf: [
        {},
        {
          allOf: [
            {
              properties: {
                workout: {
                  properties: {
                    state: { enum: ['active', 'completed'] },
                    exercises: {
                      items: {
                        properties: {
                          sets: {
                            items: {
                              properties: {
                                status: {
                                  enum: ['pending', 'completed', 'skipped'],
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            {
              oneOf: [
                { required: ['rowHeader', 'columns', 'rows'] },
                {
                  properties: {
                    subtitle: { type: 'null' },
                    tracking: { type: 'object' },
                  },
                  required: ['workout'],
                },
              ],
            },
          ],
        },
      ],
    })
  })

  it('renders a completed workout and both skipped-set variants', () => {
    const { editor: _editor, ...activePresentation } = ACTIVE_WORKOUT_CARD
    const completedCard = {
      ...activePresentation,
      subtitle: null,
      footer: null,
      workout: {
        version: 1,
        state: 'completed',
        exercises: [
          {
            name: 'Bench press',
            sets: [
              {
                status: 'completed',
                target: '185 lb × 8',
                actual: '185 lb × 8',
              },
              {
                status: 'completed',
                target: '185 lb × 8',
                actual: '185 lb × 7',
              },
              {
                status: 'skipped',
                target: '185 lb × 6–8',
                actual: null,
              },
            ],
          },
          {
            name: 'Incline dumbbell press',
            sets: [
              {
                status: 'completed',
                target: '55 lb × 10',
                actual: '55 lb × 10',
              },
              {
                status: 'skipped',
                target: '55 lb × 8–10',
                actual: null,
              },
              {
                status: 'skipped',
                target: null,
                actual: null,
              },
            ],
          },
        ],
      },
    } satisfies AssistantResponseCard

    const visible = renderAssistantResponseCardText(completedCard)
    expect(visible).toContain(
      'Push day\nCompleted workout · 3/6 sets complete',
    )
    expect(visible).toContain(
      'set 3: skipped; target 185 lb × 6–8',
    )
    expect(visible).toContain(
      'Incline dumbbell press: set 1: completed; actual 55 lb × 10; target 55 lb × 10 · set 2: skipped; target 55 lb × 8–10 · set 3: skipped',
    )
    expect(buildLinqIMessageAppLayout(completedCard)).toEqual({
      caption: 'Push day',
      image_url: expect.stringMatching(
        /^https:\/\/www\.withmurph\.ai\/imessage\/card\/v1\/[A-Za-z0-9_-]+\.png$/u,
      ),
      subcaption: '3/6 sets complete',
    })
    expect(decodeAppCardUrl(
      encodeWorkoutSessionAppCardUrl(completedCard),
    )).toMatchObject({
      schemaVersion: 4,
      card: {
        s: 'c',
        u: null,
        f: null,
        e: [
          [
            'Bench press',
            [
              ['c', '185 lb × 8', '185 lb × 8'],
              ['c', '185 lb × 8', '185 lb × 7'],
              ['s', '185 lb × 6–8', null],
            ],
          ],
          [
            'Incline dumbbell press',
            [
              ['c', '55 lb × 10', '55 lb × 10'],
              ['s', '55 lb × 8–10', null],
              ['s', null, null],
            ],
          ],
        ],
      },
    })
  })

})

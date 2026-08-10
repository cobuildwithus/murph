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

const ACTIVE_WORKOUT_CARD = {
  kind: 'compact_table',
  version: 1,
  title: 'Push day',
  subtitle: '3 of 6 sets complete',
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

describe('workout session response cards', () => {
  it('keeps canonical tracking out of the compact V4 payload', () => {
    const url = encodeWorkoutSessionAppCardUrl(ACTIVE_WORKOUT_CARD)

    expect(url.length).toBeLessThan(2_048)
    expect(decodeAppCardUrl(url)).toEqual({
      schemaVersion: 4,
      card: {
        k: 'w',
        v: 1,
        t: 'Push day',
        u: '3 of 6 sets complete',
        s: 'a',
        e: [
          [
            'Bench press',
            [
              ['c', '185 lb × 8', '185 lb × 8'],
              ['c', '185 lb × 8', '185 lb × 7'],
              ['p', '185 lb × 6–8', null],
            ],
          ],
          [
            'Incline dumbbell press',
            [
              ['c', '55 lb × 10', '55 lb × 10'],
              ['p', '55 lb × 8–10', null],
              ['p', null, null],
            ],
          ],
        ],
        f: 'Tap an exercise to log or correct a set.',
      },
    })
    expect(JSON.stringify(decodeAppCardUrl(url))).not.toContain('evt_')
    expect(JSON.stringify(decodeAppCardUrl(url))).not.toContain('snapshotAt')
  })

  it('routes enhanced compact tables through V4 and ordinary tables through V3', () => {
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
    ): CompactTableResponseCardV1 => ({
      ...ACTIVE_WORKOUT_CARD,
      title: 'Lower body strength',
      subtitle: `${completedSetCount} of 24 sets complete`,
      footer: state === 'active'
        ? 'Tap an exercise to log or correct a set.'
        : 'Workout completed.',
      workout: {
        version: 1,
        state,
        exercises: exerciseNames.map((name, exerciseIndex) => ({
          name,
          sets: targets.map((target, setIndex) => {
            const isCompleted =
              exerciseIndex * targets.length + setIndex < completedSetCount
            return {
              status: isCompleted ? 'completed' : 'pending',
              target,
              actual: isCompleted ? actuals[setIndex] ?? target : null,
            }
          }),
        })),
      },
    })

    const urls = [
      buildCard('active', 0),
      buildCard('active', 18),
      buildCard('completed', 24),
    ].map((card) => {
      expect(assistantResponseCardSchema.parse(card)).toEqual(card)
      return encodeWorkoutSessionAppCardUrl(card)
    })

    expect(urls.map((url) => url.length)).toEqual([1399, 1609, 1651])
    expect(urls.every((url) => url.length < 2_048)).toBe(true)
  })

  it('renders a useful fallback and keeps tracking private to transcript context', () => {
    const visible = renderAssistantResponseCardText(ACTIVE_WORKOUT_CARD)
    expect(visible).toContain('Active workout · 3/6 sets complete')
    expect(visible).toContain(
      'Bench press: set 1: 185 lb × 8 · set 2: 185 lb × 7 · set 3: target 185 lb × 6–8',
    )
    expect(visible).not.toContain('evt_')
    expect(visible).not.toContain('snapshot')

    const transcript = renderAssistantResponseCardTranscriptText(
      ACTIVE_WORKOUT_CARD,
    )
    expect(transcript).toContain(
      '[Murph tracked workout source: evt_01K1ABCDEFGHJKMNPQRSTVWXYZ; snapshot: 2026-08-09T19:45:00.000Z]',
    )
  })

  it('builds a truthful Messages preview layout', () => {
    expect(buildLinqIMessageAppLayout(ACTIVE_WORKOUT_CARD)).toEqual({
      caption: 'Push day',
      subcaption: '3/6 sets · ACTIVE',
      trailing_caption: 'OPEN',
    })
  })

  it('rejects impossible completion states before encoding', () => {
    expect(assistantResponseCardSchema.safeParse({
      ...ACTIVE_WORKOUT_CARD,
      workout: {
        ...ACTIVE_WORKOUT_CARD.workout,
        state: 'completed',
      },
    }).success).toBe(false)

    expect(assistantResponseCardSchema.safeParse({
      ...ACTIVE_WORKOUT_CARD,
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
                  properties: { tracking: { type: 'object' } },
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
    const completedCard = {
      ...ACTIVE_WORKOUT_CARD,
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
      'set 3: skipped (target 185 lb × 6–8)',
    )
    expect(visible).toContain(
      'Incline dumbbell press: set 1: 55 lb × 10 · set 2: skipped (target 55 lb × 8–10) · set 3: skipped',
    )
    expect(buildLinqIMessageAppLayout(completedCard)).toEqual({
      caption: 'Push day',
      subcaption: '3/6 sets · COMPLETE',
      trailing_caption: 'OPEN',
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

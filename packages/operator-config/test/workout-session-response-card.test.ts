import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
  assistantResponseCardSchema,
  buildLinqIMessageAppLayout,
  encodeCompactTableAppCardUrl,
  encodeWorkoutSessionAppCardUrl,
  renderAssistantResponseCardText,
  renderAssistantResponseCardTranscriptText,
  type AssistantResponseCard,
} from '../src/assistant-response-cards.js'

const ACTIVE_WORKOUT_CARD = {
  kind: 'compact_table',
  version: 1,
  title: 'Push day',
  subtitle: '3 of 6 sets complete',
  rowHeader: 'Exercise',
  columns: ['Progress'],
  rows: [
    { label: 'Bench press', values: ['2/3'] },
    { label: 'Incline dumbbell press', values: ['1/3'] },
  ],
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

const APP_CARD_URL_PREFIX = 'https://murph.ai/#murph-card='

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
          {
            n: 'Bench press',
            s: [
              { s: 'c', t: '185 lb × 8', a: '185 lb × 8' },
              { s: 'c', t: '185 lb × 8', a: '185 lb × 7' },
              { s: 'p', t: '185 lb × 6–8', a: null },
            ],
          },
          {
            n: 'Incline dumbbell press',
            s: [
              { s: 'c', t: '55 lb × 10', a: '55 lb × 10' },
              { s: 'p', t: '55 lb × 8–10', a: null },
              { s: 'p', t: null, a: null },
            ],
          },
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

    const { workout: _workout, ...ordinaryTable } = ACTIVE_WORKOUT_CARD
    expect(decodeAppCardUrl(encodeCompactTableAppCardUrl(ordinaryTable))).toMatchObject({
      schemaVersion: 3,
      card: {
        kind: 'compact_table',
        title: 'Push day',
      },
    })
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

    const { workout: _workout, ...ordinaryTable } = ACTIVE_WORKOUT_CARD
    expect(() => encodeWorkoutSessionAppCardUrl(ordinaryTable)).toThrow(
      /workout session detail/u,
    )
  })
})

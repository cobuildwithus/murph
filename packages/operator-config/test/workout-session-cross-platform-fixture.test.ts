import { describe, expect, it } from 'vitest'

import {
  encodeWorkoutSessionAppCardUrl,
  type CompactTableResponseCardV1,
} from '../src/assistant-response-cards.js'

const CARD: CompactTableResponseCardV1 = {
  kind: 'compact_table',
  version: 1,
  title: 'Push day',
  subtitle: '3 of 6 sets complete',
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
}

const EXACT_SWIFT_FIXTURE_URL =
  'https://www.withmurph.ai/#murph-card=eyJzY2hlbWFWZXJzaW9uIjo0LCJjYXJkIjp7ImsiOiJ3IiwidiI6MSwidCI6IlB1c2ggZGF5IiwidSI6IjMgb2YgNiBzZXRzIGNvbXBsZXRlIiwicyI6ImEiLCJlIjpbWyJCZW5jaCBwcmVzcyIsW1siYyIsIjE4NSBsYiDDlyA4IiwiMTg1IGxiIMOXIDgiXSxbImMiLCIxODUgbGIgw5cgOCIsIjE4NSBsYiDDlyA3Il0sWyJwIiwiMTg1IGxiIMOXIDbigJM4IixudWxsXV1dLFsiSW5jbGluZSBkdW1iYmVsbCBwcmVzcyIsW1siYyIsIjU1IGxiIMOXIDEwIiwiNTUgbGIgw5cgMTAiXSxbInAiLCI1NSBsYiDDlyA44oCTMTAiLG51bGxdLFsicCIsbnVsbCxudWxsXV1dXSwiZiI6IlJlcGx5IHdpdGggdGhlIGV4ZXJjaXNlLCBzZXQsIGFuZCByZXN1bHQgdG8gbG9nIG9yIGNvcnJlY3QgaXQuIn19'

describe('workout-session TypeScript to Swift contract fixture', () => {
  it('keeps the exact production encoder output pinned for the iOS decoder', () => {
    expect(encodeWorkoutSessionAppCardUrl(CARD)).toBe(
      EXACT_SWIFT_FIXTURE_URL,
    )
  })
})

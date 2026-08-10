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
}

const EXACT_SWIFT_FIXTURE_URL =
  'https://www.withmurph.ai/#murph-card=eyJzY2hlbWFWZXJzaW9uIjo0LCJjYXJkIjp7ImsiOiJ3IiwidiI6MSwidCI6IlB1c2ggZGF5IiwidSI6IjMgb2YgNiBzZXRzIGNvbXBsZXRlIiwicyI6ImEiLCJlIjpbeyJuIjoiQmVuY2ggcHJlc3MiLCJzIjpbeyJzIjoiYyIsInQiOiIxODUgbGIgw5cgOCIsImEiOiIxODUgbGIgw5cgOCJ9LHsicyI6ImMiLCJ0IjoiMTg1IGxiIMOXIDgiLCJhIjoiMTg1IGxiIMOXIDcifSx7InMiOiJwIiwidCI6IjE4NSBsYiDDlyA24oCTOCIsImEiOm51bGx9XX0seyJuIjoiSW5jbGluZSBkdW1iYmVsbCBwcmVzcyIsInMiOlt7InMiOiJjIiwidCI6IjU1IGxiIMOXIDEwIiwiYSI6IjU1IGxiIMOXIDEwIn0seyJzIjoicCIsInQiOiI1NSBsYiDDlyA44oCTMTAiLCJhIjpudWxsfSx7InMiOiJwIiwidCI6bnVsbCwiYSI6bnVsbH1dfV0sImYiOiJUYXAgYW4gZXhlcmNpc2UgdG8gbG9nIG9yIGNvcnJlY3QgYSBzZXQuIn19'

describe('workout-session TypeScript to Swift contract fixture', () => {
  it('keeps the exact production encoder output pinned for the iOS decoder', () => {
    expect(encodeWorkoutSessionAppCardUrl(CARD)).toBe(
      EXACT_SWIFT_FIXTURE_URL,
    )
  })
})

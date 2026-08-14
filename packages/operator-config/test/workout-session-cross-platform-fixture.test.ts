import { describe, expect, it } from 'vitest'

import {
  encodeWorkoutSessionAppCardUrl,
  type CompactTableResponseCardV1,
} from '../src/assistant-response-cards.js'
import { deriveWorkoutActionBinding } from '../src/workout-action-binding.js'

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
  editor: {
    actionBinding: deriveWorkoutActionBinding(
      'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    ),
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
          { logged: false, result: null },
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
          { logged: false, result: null },
          { logged: false, result: null },
        ],
      },
    ],
  },
}

const EXACT_SWIFT_FIXTURE_URL =
  'https://www.withmurph.ai/#murph-card=eyJzY2hlbWFWZXJzaW9uIjo2LCJjYXJkIjp7ImsiOiJ3IiwidiI6MSwidCI6IlB1c2ggZGF5IiwidSI6IjMgb2YgNiBzZXRzIGNvbXBsZXRlIiwicyI6ImEiLCJlIjpbWyJCZW5jaCBwcmVzcyIsImwiLFtbImMiLCIxODUgbGIgw5cgOCIsWyJ3Iiw4LDE4NSxudWxsXV0sWyJjIiwiMTg1IGxiIMOXIDgiLFsidyIsNywxODUsImwiXV0sWyJwIiwiMTg1IGxiIMOXIDbigJM4IixudWxsXV1dLFsiSW5jbGluZSBkdW1iYmVsbCBwcmVzcyIsImwiLFtbImMiLCI1NSBsYiDDlyAxMCIsWyJ3IiwxMCw1NSxudWxsXV0sWyJwIiwiNTUgbGIgw5cgOOKAkzEwIixudWxsXSxbInAiLG51bGwsbnVsbF1dXV0sImYiOiJSZXBseSB3aXRoIHRoZSBleGVyY2lzZSwgc2V0LCBhbmQgcmVzdWx0IHRvIGxvZyBvciBjb3JyZWN0IGl0LiIsImIiOiI5NTk1OGY5ZjgzZTY5NDNjZWI1NjcwNGUxOTIxNmY3ZmY2ZTEwNWE5Yjc0ZDhhNWU0NjY3NTRiMjY2ZjY3YTlhIiwiZCI6ImJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIifX0'

describe('workout-session TypeScript to Swift contract fixture', () => {
  it('keeps the exact production encoder output pinned for the iOS decoder', () => {
    expect(encodeWorkoutSessionAppCardUrl(CARD)).toBe(
      EXACT_SWIFT_FIXTURE_URL,
    )
  })
})

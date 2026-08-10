import { describe, expect, it } from 'vitest'

import {
  encodeCompactTableAppCardUrl,
  type CompactTableResponseCardV1,
} from '../src/assistant-response-cards.js'

const CARD: CompactTableResponseCardV1 = {
  kind: 'compact_table',
  version: 1,
  title: 'Live strength session',
  subtitle: null,
  rowHeader: 'Exercise',
  columns: ['Set 1', 'Set 2', 'Set 3', 'Set 4'],
  rows: [
    {
      label: 'Exercise A',
      values: ['12', '10 (final rep spotted)', '9', '8 (final 2 reps spotted)'],
    },
    {
      label: 'Exercise B',
      values: ['40 × 8', '45 × 8', '45 × 7', '45 × 6 (final rep spotted)'],
    },
  ],
  footer: null,
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-04T21:30:00.000Z',
  },
}

const EXACT_SWIFT_FIXTURE_URL =
  'https://www.withmurph.ai/#murph-card=eyJzY2hlbWFWZXJzaW9uIjozLCJjYXJkIjp7ImtpbmQiOiJjb21wYWN0X3RhYmxlIiwidmVyc2lvbiI6MSwidGl0bGUiOiJMaXZlIHN0cmVuZ3RoIHNlc3Npb24iLCJzdWJ0aXRsZSI6bnVsbCwicm93SGVhZGVyIjoiRXhlcmNpc2UiLCJjb2x1bW5zIjpbIlNldCAxIiwiU2V0IDIiLCJTZXQgMyIsIlNldCA0Il0sInJvd3MiOlt7ImxhYmVsIjoiRXhlcmNpc2UgQSIsInZhbHVlcyI6WyIxMiIsIjEwIChmaW5hbCByZXAgc3BvdHRlZCkiLCI5IiwiOCAoZmluYWwgMiByZXBzIHNwb3R0ZWQpIl19LHsibGFiZWwiOiJFeGVyY2lzZSBCIiwidmFsdWVzIjpbIjQwIMOXIDgiLCI0NSDDlyA4IiwiNDUgw5cgNyIsIjQ1IMOXIDYgKGZpbmFsIHJlcCBzcG90dGVkKSJdfV0sImZvb3RlciI6bnVsbH19'

describe('compact-table TypeScript to Swift contract fixture', () => {
  it('keeps the exact production encoder output pinned for the iOS decoder', () => {
    expect(encodeCompactTableAppCardUrl(CARD)).toBe(EXACT_SWIFT_FIXTURE_URL)
  })
})

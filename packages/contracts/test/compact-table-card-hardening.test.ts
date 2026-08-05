import { describe, expect, it } from 'vitest'

import {
  compactTableCardV1Bounds,
  compactTableResponseCardV1Schema,
} from '../src/index.js'

const VALID_CARD = {
  kind: 'compact_table',
  version: 1,
  title: 'Live workout',
  subtitle: null,
  rowHeader: 'Exercise',
  columns: ['Set 1', 'Set 2', 'Set 3', 'Set 4'],
  rows: [
    {
      label: 'Exercise A',
      values: ['12', '10', '9', '8'],
    },
  ],
  footer: null,
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-04T21:30:00.000Z',
  },
} as const

describe('compact table response-card hardening', () => {
  it('requires one exact canonical workout event id', () => {
    expect(compactTableResponseCardV1Schema.parse(VALID_CARD)).toEqual(VALID_CARD)

    for (const entityId of [
      'evt_01K1ABCDEFGHJKMNPQRSTVWXY',
      'evt_01K1ABCDEFGHJKMNPQRSTVWXYZZ',
      'evt_01K1ABCDEFGHJKMNPQRSTVWXYO',
      'evt_01k1abcdefghjkmnpqrstvwxyz',
      'workout_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    ]) {
      expect(compactTableResponseCardV1Schema.safeParse({
        ...VALID_CARD,
        tracking: {
          ...VALID_CARD.tracking,
          entityId,
        },
      }).success).toBe(false)
    }
  })

  it('requires a canonical UTC snapshot instant', () => {
    for (const snapshotAt of [
      '2026-08-04T21:30:00Z',
      '2026-08-04T17:30:00.000-04:00',
      '2026-08-04T21:30:00.00Z',
      '2026-08-04T21:30:00.000z',
      'not-a-date',
    ]) {
      expect(compactTableResponseCardV1Schema.safeParse({
        ...VALID_CARD,
        tracking: {
          ...VALID_CARD.tracking,
          snapshotAt,
        },
      }).success).toBe(false)
    }
  })

  it('rejects Unicode-heavy cards that exceed the inline Messages URL limit', () => {
    const repeated = (length: number) => '界'.repeat(length)
    const oversized = {
      ...VALID_CARD,
      title: repeated(compactTableCardV1Bounds.title),
      subtitle: repeated(compactTableCardV1Bounds.subtitle),
      rowHeader: repeated(compactTableCardV1Bounds.rowHeader),
      columns: Array.from(
        { length: compactTableCardV1Bounds.columns },
        () => repeated(compactTableCardV1Bounds.columnHeader),
      ),
      rows: Array.from(
        { length: compactTableCardV1Bounds.rows },
        () => ({
          label: repeated(compactTableCardV1Bounds.rowLabel),
          values: Array.from(
            { length: compactTableCardV1Bounds.columns },
            () => repeated(compactTableCardV1Bounds.cellValue),
          ),
        }),
      ),
      footer: repeated(compactTableCardV1Bounds.footer),
      tracking: null,
    }

    expect(compactTableResponseCardV1Schema.safeParse(oversized).success).toBe(false)
  })

  it('rejects Unicode line separators even though they are not ASCII controls', () => {
    for (const title of ['Upper\u2028body', 'Upper\u2029body']) {
      expect(compactTableResponseCardV1Schema.safeParse({
        ...VALID_CARD,
        title,
      }).success).toBe(false)
    }
  })
})

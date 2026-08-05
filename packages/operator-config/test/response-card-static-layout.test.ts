import { describe, expect, it } from 'vitest'

import {
  LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT,
  buildLinqIMessageAppLayout,
  type CompactTableResponseCardV1,
  type DailyNutritionResponseCardV2,
} from '../src/assistant-response-cards.js'

const ONE_OFF_TABLE: CompactTableResponseCardV1 = {
  kind: 'compact_table',
  version: 1,
  title: 'Weekly plan',
  subtitle: null,
  rowHeader: 'Day',
  columns: ['Focus'],
  rows: [{ label: 'Monday', values: ['Upper body'] }],
  footer: null,
  tracking: null,
}

const TRACKED_TABLE: CompactTableResponseCardV1 = {
  ...ONE_OFF_TABLE,
  title: 'Live workout',
  rowHeader: 'Exercise',
  columns: ['Set 1'],
  rows: [{ label: 'Exercise A', values: ['10'] }],
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-04T21:30:00.000Z',
  },
}

const PARTIAL_NUTRITION_CARD: DailyNutritionResponseCardV2 = {
  kind: 'daily_nutrition',
  version: 2,
  localDate: '2026-08-04',
  mealCount: 3,
  totals: {
    calories: { total: 1_500, mealCount: 2 },
    proteinGrams: { total: 100, mealCount: 2 },
    carbsGrams: { total: 180, mealCount: 2 },
    fatGrams: { total: 50, mealCount: 2 },
    fiberGrams: { total: 20, mealCount: 2 },
  },
  goals: {
    calories: null,
    proteinGrams: null,
    carbsGrams: null,
    fatGrams: null,
    fiberGrams: null,
  },
}

describe('response-card static Linq layouts', () => {
  it('uses generic value-free fallback copy across card kinds', () => {
    expect(LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT).toBe('Open your Murph card')
  })

  it('distinguishes one-off and canonical workout tables without exposing values', () => {
    expect(buildLinqIMessageAppLayout(ONE_OFF_TABLE)).toEqual({
      caption: 'Murph',
      subcaption: 'Table',
      trailing_caption: 'OPEN',
    })
    expect(buildLinqIMessageAppLayout(TRACKED_TABLE)).toEqual({
      caption: 'Murph',
      subcaption: 'Workout table',
      trailing_caption: 'OPEN',
    })

    expect(JSON.stringify(buildLinqIMessageAppLayout(TRACKED_TABLE))).not.toMatch(
      /Exercise A|10|evt_|2026/u,
    )
  })

  it('preserves the merged partial-nutrition static marker', () => {
    expect(buildLinqIMessageAppLayout(PARTIAL_NUTRITION_CARD)).toEqual({
      caption: 'Murph',
      subcaption: 'Nutrition summary',
      trailing_caption: 'OPEN',
      trailing_subcaption: 'PARTIAL TOTALS',
    })
  })
})

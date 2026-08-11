import { describe, expect, it } from 'vitest'

import {
  encodeDailyNutritionAppCardUrl,
  type DailyNutritionResponseCardV1,
  type DailyNutritionResponseCardV2,
} from '../src/assistant-response-cards.js'

const V1_CARD: DailyNutritionResponseCardV1 = {
  kind: 'daily_nutrition',
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1_490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
  },
}

const V2_CARD: DailyNutritionResponseCardV2 = {
  ...V1_CARD,
  version: 2,
  totals: {
    ...V1_CARD.totals,
    fiberGrams: { total: 26.5, mealCount: 3 },
  },
  goals: {
    calories: { target: 2_100, status: 'under_target' },
    proteinGrams: { target: 100, status: 'on_target' },
    carbsGrams: null,
    fatGrams: { target: 40, status: 'on_target' },
    fiberGrams: { target: 30, status: 'under_target' },
  },
}

const EXACT_SWIFT_V1_FIXTURE_URL =
  'https://www.withmurph.ai/#murph-card=eyJzY2hlbWFWZXJzaW9uIjoxLCJjYXJkIjp7ImtpbmQiOiJkYWlseV9udXRyaXRpb24iLCJsb2NhbERhdGUiOiIyMDI2LTA3LTI4IiwibWVhbENvdW50IjozLCJ0b3RhbHMiOnsiY2Fsb3JpZXMiOnsidG90YWwiOjE0OTAuMjUsIm1lYWxDb3VudCI6M30sInByb3RlaW5HcmFtcyI6eyJ0b3RhbCI6OTQuNSwibWVhbENvdW50IjozfSwiY2FyYnNHcmFtcyI6eyJ0b3RhbCI6MTkzLjEyNSwibWVhbENvdW50IjozfSwiZmF0R3JhbXMiOnsidG90YWwiOjM0Ljc1LCJtZWFsQ291bnQiOjN9fX19'

const EXACT_SWIFT_V2_FIXTURE_URL =
  'https://www.withmurph.ai/#murph-card=eyJzY2hlbWFWZXJzaW9uIjoyLCJjYXJkIjp7ImtpbmQiOiJkYWlseV9udXRyaXRpb24iLCJ2ZXJzaW9uIjoyLCJsb2NhbERhdGUiOiIyMDI2LTA3LTI4IiwibWVhbENvdW50IjozLCJ0b3RhbHMiOnsiY2Fsb3JpZXMiOnsidG90YWwiOjE0OTAuMjUsIm1lYWxDb3VudCI6M30sInByb3RlaW5HcmFtcyI6eyJ0b3RhbCI6OTQuNSwibWVhbENvdW50IjozfSwiY2FyYnNHcmFtcyI6eyJ0b3RhbCI6MTkzLjEyNSwibWVhbENvdW50IjozfSwiZmF0R3JhbXMiOnsidG90YWwiOjM0Ljc1LCJtZWFsQ291bnQiOjN9LCJmaWJlckdyYW1zIjp7InRvdGFsIjoyNi41LCJtZWFsQ291bnQiOjN9fSwiZ29hbHMiOnsiY2Fsb3JpZXMiOnsidGFyZ2V0IjoyMTAwLCJzdGF0dXMiOiJ1bmRlcl90YXJnZXQifSwicHJvdGVpbkdyYW1zIjp7InRhcmdldCI6MTAwLCJzdGF0dXMiOiJvbl90YXJnZXQifSwiY2FyYnNHcmFtcyI6bnVsbCwiZmF0R3JhbXMiOnsidGFyZ2V0Ijo0MCwic3RhdHVzIjoib25fdGFyZ2V0In0sImZpYmVyR3JhbXMiOnsidGFyZ2V0IjozMCwic3RhdHVzIjoidW5kZXJfdGFyZ2V0In19fX0'

describe('nutrition-card TypeScript to Swift contract fixtures', () => {
  it('keeps the exact V1 encoder output pinned for the iOS decoder', () => {
    expect(encodeDailyNutritionAppCardUrl(V1_CARD)).toBe(
      EXACT_SWIFT_V1_FIXTURE_URL,
    )
  })

  it('keeps the exact V2 encoder output pinned for the iOS decoder', () => {
    expect(encodeDailyNutritionAppCardUrl(V2_CARD)).toBe(
      EXACT_SWIFT_V2_FIXTURE_URL,
    )
  })
})

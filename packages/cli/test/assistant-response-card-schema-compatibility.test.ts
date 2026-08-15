import assert from 'node:assert/strict'

import { Validator, type Schema } from '@cfworker/json-schema'
import * as z from '@murphai/contracts/zod-runtime'
import { resolveMurphDynamicTools } from '@murphai/assistant-engine/assistant-codex'
import {
  assistantResponseCardAuthoringSchema,
} from '@murphai/operator-config/assistant-response-cards'
import { describe, it } from 'vitest'

const attachResponseCardRuntimeSchema = z
  .object({
    card: assistantResponseCardAuthoringSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.card.kind === 'compact_table' &&
      'workout' in value.card &&
      value.card.subtitle !== null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Structured workout card subtitles must be null.',
        path: ['card', 'subtitle'],
      })
    }
  })

const NUTRITION_CARD = {
  kind: 'daily_nutrition',
  version: 2,
  localDate: '2026-08-14',
  mealCount: 2,
  totals: {
    calories: { total: 1_500, mealCount: 2 },
    proteinGrams: { total: 90, mealCount: 2 },
    carbsGrams: { total: 170, mealCount: 2 },
    fatGrams: { total: 50, mealCount: 2 },
    fiberGrams: { total: 25, mealCount: 2 },
  },
  goals: {
    calories: { target: 2_000, status: 'under_target' },
    proteinGrams: { target: 100, status: 'under_target' },
    carbsGrams: { target: 200, status: 'under_target' },
    fatGrams: { target: 60, status: 'under_target' },
    fiberGrams: { target: 30, status: 'under_target' },
  },
} as const

const GENERIC_TABLE_CARD = {
  kind: 'compact_table',
  version: 1,
  title: 'Weekly plan',
  subtitle: null,
  rowHeader: 'Day',
  columns: ['Focus', 'Dose'],
  rows: [{ label: 'Monday', values: ['Strength', '3 sets'] }],
  footer: null,
  tracking: null,
} as const

const WORKOUT_CARD = {
  kind: 'compact_table',
  version: 1,
  title: 'Workout',
  subtitle: null,
  footer: null,
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-14T20:00:00.000Z',
  },
  workout: {
    version: 1,
    state: 'active',
    exercises: [{
      name: 'Squat',
      sets: [{ status: 'pending', target: '8 reps', actual: null }],
    }],
  },
} as const

const attachResponseCardTool = (() => {
  const tool = resolveMurphDynamicTools({
    responseCardsAvailable: true,
  }).find((candidate) => candidate.name === 'attach_response_card')
  if (!tool) {
    throw new TypeError('Expected the private response-card tool.')
  }
  return tool
})()

function offeredSchemaAccepts(value: unknown): boolean {
  return new Validator(
    attachResponseCardTool.inputSchema as Schema,
  ).validate(value).valid
}

describe('attach_response_card schema compatibility', () => {
  it('keeps representative provider and authoritative runtime decisions aligned', () => {
    const cases = [
      { value: { card: NUTRITION_CARD }, valid: true },
      { value: { card: GENERIC_TABLE_CARD }, valid: true },
      { value: { card: WORKOUT_CARD }, valid: true },
      {
        value: {
          card: {
            ...GENERIC_TABLE_CARD,
            rows: [{ label: 'Monday', values: ['Strength', 3] }],
          },
        },
        valid: false,
      },
      {
        value: { card: { ...WORKOUT_CARD, subtitle: 'In progress' } },
        valid: false,
      },
      {
        value: { card: { ...WORKOUT_CARD, rowHeader: 'Set' } },
        valid: false,
      },
      {
        value: {
          card: {
            ...GENERIC_TABLE_CARD,
            tracking: WORKOUT_CARD.tracking,
            workout: WORKOUT_CARD.workout,
          },
        },
        valid: false,
      },
    ]

    for (const testCase of cases) {
      const providerAccepted = offeredSchemaAccepts(testCase.value)
      const runtimeAccepted = attachResponseCardRuntimeSchema.safeParse(
        testCase.value,
      ).success
      assert.equal(providerAccepted, testCase.valid)
      assert.equal(runtimeAccepted, testCase.valid)
      assert.equal(providerAccepted, runtimeAccepted)
    }
  })

  it('keeps cross-array cardinality runtime-owned and repairable', () => {
    const invalid = {
      card: {
        ...GENERIC_TABLE_CARD,
        rows: [{ label: 'Monday', values: ['Strength'] }],
      },
    }
    assert.equal(offeredSchemaAccepts(invalid), true)
    const runtimeResult = attachResponseCardRuntimeSchema.safeParse(invalid)
    assert.equal(runtimeResult.success, false)
    if (runtimeResult.success) {
      throw new TypeError('Expected runtime cardinality validation to fail.')
    }
    assert.ok(runtimeResult.error.issues.some((issue) =>
      issue.code === 'custom'
      && JSON.stringify(issue.path) === JSON.stringify([
        'card',
        'rows',
        0,
        'values',
      ])
    ))

    const repaired = { card: GENERIC_TABLE_CARD }
    assert.equal(offeredSchemaAccepts(repaired), true)
    assert.equal(
      attachResponseCardRuntimeSchema.safeParse(repaired).success,
      true,
    )
  })
})

import { describe, expect, it } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL,
  MURPH_ATTACH_RESPONSE_CARD_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  buildResponseCardValidationFeedback,
} from '../src/assistant-codex/response-card-validation-feedback.ts'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'

const INVALID_TABLE = {
  kind: 'compact_table',
  version: 1,
  title: 'Weekly plan',
  subtitle: null,
  rowHeader: 'Day',
  columns: ['Focus', 'Dose'],
  rows: [{ label: 'Monday', values: [] }],
  footer: null,
  tracking: null,
} as const

const INVALID_NUTRITION_CARD = {
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
    carbsGrams: { target: 200, status: 'over_target' },
    fatGrams: { target: 60, status: 'under_target' },
    fiberGrams: { target: 30, status: 'under_target' },
  },
} as const

const VALID_NUTRITION_CARD = {
  ...INVALID_NUTRITION_CARD,
  goals: {
    ...INVALID_NUTRITION_CARD.goals,
    carbsGrams: { target: 200, status: 'under_target' },
  },
} as const

const INVALID_NUTRITION_MEAL_COUNT_CARD = {
  ...VALID_NUTRITION_CARD,
  totals: {
    ...VALID_NUTRITION_CARD.totals,
    proteinGrams: { total: 90, mealCount: 3 },
  },
} as const

const INVALID_PENDING_ACTUAL_WORKOUT_CARD = {
  kind: 'compact_table',
  version: 1,
  title: 'Synthetic workout',
  subtitle: null,
  footer: null,
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-09T19:45:00.000Z',
  },
  workout: {
    version: 1,
    state: 'active',
    exercises: [{
      name: 'Synthetic movement',
      sets: [{ status: 'pending', target: '8 reps', actual: '8 reps' }],
    }],
  },
} as const

function buildOversizedGenericTableCard() {
  return {
    kind: 'compact_table',
    version: 1,
    title: 'Eight-exercise workout',
    subtitle: 'Verified canonical workout snapshot for today',
    rowHeader: 'Exercise',
    columns: ['Set 1', 'Set 2', 'Set 3', 'Set 4'],
    rows: Array.from({ length: 8 }, (_, rowIndex) => ({
      label: `Exercise ${rowIndex + 1} movement pattern`,
      values: Array.from({ length: 4 }, (_, columnIndex) => {
        const cellLength = rowIndex === 7 && columnIndex === 3 ? 18 : 22
        return `${rowIndex + columnIndex + 1}`.padEnd(cellLength, 'x')
      }),
    })),
    footer: 'Assists and spotted reps remain on the exact set note.',
    tracking: null,
  } as const
}

function readCardToolArguments(
  argumentsValue: unknown,
  responseCardAudience: 'group' | 'private',
) {
  return readTestMurphDynamicToolRequest({
    id: 1,
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool: MURPH_ATTACH_RESPONSE_CARD_TOOL.name,
    },
  }, {
    responseCardAudience,
  })
}

function readCardToolRequest(card: unknown) {
  return readCardToolArguments({ card }, 'private')
}

describe('response-card validation feedback', () => {
  it('returns one family-choice hint when card kind is absent or invalid', () => {
    const cardWithoutKind: Record<string, unknown> = {
      ...VALID_NUTRITION_CARD,
    }
    delete cardWithoutKind.kind
    for (const card of [
      cardWithoutKind,
      { ...VALID_NUTRITION_CARD, kind: 'synthetic-private-family' },
    ]) {
      const request = readCardToolRequest(card)
      expect(request).toMatchObject({
        kind: 'invalid-response-card-arguments',
        validationDigest: {
          pathIssues: [{
            path: 'card.kind',
            code: 'custom',
            expected: 'daily_nutrition_or_compact_table',
          }],
        },
      })
      if (!request || request.kind !== 'invalid-response-card-arguments') {
        throw new Error('expected response-card family choice feedback')
      }
      expect(buildResponseCardValidationFeedback(
        request.validationDigest,
      )).toBe(JSON.stringify({
        error: 'invalid_response_card_arguments',
        hints: [{
          field: 'card.kind',
          code: 'custom',
          expected: 'daily_nutrition_or_compact_table',
        }],
      }))
      const serialized = JSON.stringify(request)
      expect(serialized).not.toContain('synthetic-private-family')
      expect(serialized).not.toContain('card.columns')
      expect(serialized).not.toContain('card.rows')
      expect(serialized).not.toContain('card.workout')
    }

    expect(readCardToolRequest(VALID_NUTRITION_CARD)).toMatchObject({
      kind: 'attach-response-card',
    })
  })

  it('keeps missing-root diagnostics scoped to the offered audience', () => {
    const privateRequest = readCardToolArguments({
      typo: { marker: 'synthetic-private-marker' },
    }, 'private')
    expect(privateRequest).toMatchObject({
      kind: 'invalid-response-card-arguments',
      validationDigest: {
        pathIssues: expect.arrayContaining([
          expect.objectContaining({ path: 'card' }),
        ]),
      },
    })
    expect(JSON.stringify(privateRequest)).not.toContain('challengeSlug')
    expect(JSON.stringify(privateRequest)).not.toContain(
      'synthetic-private-marker',
    )
    expect(JSON.stringify(privateRequest)).not.toContain('typo')

    const groupRequest = readCardToolArguments({}, 'group')
    expect(groupRequest).toMatchObject({
      kind: 'invalid-response-card-arguments',
      validationDigest: {
        pathIssues: expect.arrayContaining([
          expect.objectContaining({ path: 'challengeSlug' }),
          expect.objectContaining({ path: 'pageRevisionDigest' }),
          expect.objectContaining({ path: 'participantObservations' }),
        ]),
      },
    })
    expect(
      groupRequest?.kind === 'invalid-response-card-arguments'
        ? groupRequest.validationDigest.pathIssues
        : [],
    ).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'card' }),
    ]))
  })

  it('returns bounded schema-owned repair hints and accepts the corrected retry', async () => {
    const request = readCardToolRequest(INVALID_TABLE)
    expect(request?.kind).toBe('invalid-response-card-arguments')
    if (!request || request.kind !== 'invalid-response-card-arguments') {
      throw new Error('expected invalid response card arguments')
    }

    expect(request.validationDigest.pathIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'card.rows[].values',
        code: 'too_small',
        expected: 'array.min_1',
      }),
      expect.objectContaining({
        path: 'card.rows[].values',
        code: 'custom',
      }),
    ]))

    const invalidCellRequest = readCardToolRequest({
      ...INVALID_TABLE,
      rows: [{
        label: 'Monday',
        values: ['Strength', { note: 'synthetic-cell-marker' }],
      }],
    })
    expect(invalidCellRequest).toMatchObject({
      kind: 'invalid-response-card-arguments',
      validationDigest: {
        pathIssues: expect.arrayContaining([
          expect.objectContaining({
            path: 'card.rows[].values[]',
            code: 'invalid_type',
            expected: 'string',
          }),
        ]),
      },
    })
    expect(JSON.stringify(invalidCellRequest)).not.toContain('synthetic-cell-marker')
    expect(JSON.stringify(invalidCellRequest)).not.toContain('note')

    expect(readCardToolRequest(INVALID_NUTRITION_CARD)).toMatchObject({
      kind: 'invalid-response-card-arguments',
      validationDigest: {
        pathIssues: expect.arrayContaining([
          expect.objectContaining({
            path: 'card.goals.carbsGrams.status',
            code: 'custom',
            expected: 'consistent_with_total_and_target',
          }),
        ]),
      },
    })

    const result = await executeMurphDynamicToolRequest({
      currentResponseCard: null,
      currentResponseMedia: [],
      env: {},
      fetchImpl: fetch,
      groupChallengeResponseCardAllowed: false,
      groupSharedReadTurnState: null,
      knowledgePageReadTextFile: null,
      nextUsageOrdinal: () => 0,
      privateDirectResponseCardAllowed: true,
      progressDelivery: null,
      request,
      vaultRoot: null,
    })
    const feedback = result.rpcResult.contentItems[0]?.text ?? ''
    expect(result.rpcResult.success).toBe(false)
    expect(feedback).toContain(
      '"field":"card.rows[].values","code":"too_small","expected":"array.min_1"',
    )
    expect(feedback).toContain(
      '"field":"card.rows[].values","code":"custom","expected":"same_count_as_card.columns"',
    )
    expect(feedback.length).toBeLessThanOrEqual(1_600)
    expect(feedback).not.toContain('"received"')
    expect(feedback).not.toContain(INVALID_TABLE.title)
    expect(feedback).not.toContain(INVALID_TABLE.rows[0].label)

    expect(readCardToolRequest({
      ...INVALID_TABLE,
      rows: [{ label: 'Monday', values: ['Strength', '3 sets'] }],
    })).toMatchObject({ kind: 'attach-response-card' })
  })

  it('returns value-free exercise-card hints without attaching a card', async () => {
    const privateMarker = 'synthetic-private-exercise-marker'
    const request = readTestMurphDynamicToolRequest({
      id: 2,
      method: 'item/tool/call',
      params: {
        arguments: {
          card: {
            exercises: [{
              dose: '5 repetitions',
              estimatedSeconds: { privateMarker },
              images: [],
              instructions: ['Move slowly.'],
              name: 'Synthetic movement',
            }],
            footer: null,
            intensity: 'Easy',
            kind: 'exercise_routine',
            labels: {
              dose: 'Dose',
              exercise: 'Exercise',
              time: 'Time',
              visualGuide: 'Visual guide',
            },
            safety: 'Stop if uncomfortable.',
            subtitle: null,
            title: 'Synthetic routine',
            totalSeconds: 60,
            transitionSeconds: 0,
            version: 1,
          },
        },
        namespace: 'murph',
        tool: MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.name,
      },
    })
    expect(request).toMatchObject({ kind: 'invalid-response-card-arguments' })

    const result = await executeMurphDynamicToolRequest({
      currentResponseCard: null,
      currentResponseMedia: [],
      env: {},
      fetchImpl: fetch,
      groupChallengeResponseCardAllowed: false,
      groupSharedReadTurnState: null,
      knowledgePageReadTextFile: null,
      nextUsageOrdinal: () => 0,
      privateDirectResponseCardAllowed: true,
      progressDelivery: null,
      request: request!,
      vaultRoot: null,
    })
    const feedback = result.rpcResult.contentItems[0]?.text ?? ''

    expect(result.rpcResult.success).toBe(false)
    expect(feedback).toContain(
      '"field":"card.exercises[].estimatedSeconds","code":"invalid_type","expected":"number"',
    )
    expect(feedback).not.toContain(privateMarker)
    expect(feedback).not.toContain('privateMarker')
    expect(feedback).not.toContain('"received"')
    expect(result.responseCardPatch).toBeUndefined()
  })

  it('keeps compact-table repair hints on exactly one card shape', () => {
    const genericWithoutColumns = {
      kind: 'compact_table',
      version: 1,
      title: 'Weekly plan',
      subtitle: null,
      rowHeader: 'Day',
      rows: [{ label: 'Monday', values: ['Strength'] }],
      footer: null,
      tracking: null,
    }
    const genericRequest = readCardToolRequest(genericWithoutColumns)
    expect(genericRequest).toMatchObject({
      kind: 'invalid-response-card-arguments',
      validationDigest: {
        pathIssues: expect.arrayContaining([
          expect.objectContaining({ path: 'card.columns' }),
        ]),
      },
    })
    const genericFeedback = JSON.stringify(genericRequest)
    expect(genericFeedback).not.toContain('card.workout')
    expect(genericFeedback).not.toContain('card.tracking')

    const workoutRequest = readCardToolRequest({
      kind: 'compact_table',
      version: 1,
      title: 'Synthetic workout',
      subtitle: null,
      footer: null,
      tracking: {
        kind: 'workout',
        entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
        snapshotAt: '2026-08-09T19:45:00.000Z',
      },
      workout: {
        version: 1,
        state: 'active',
      },
    })
    expect(workoutRequest).toMatchObject({
      kind: 'invalid-response-card-arguments',
      validationDigest: {
        pathIssues: expect.arrayContaining([
          expect.objectContaining({ path: 'card.workout.exercises' }),
        ]),
      },
    })
    const workoutFeedback = JSON.stringify(workoutRequest)
    expect(workoutFeedback).not.toContain('card.rowHeader')
    expect(workoutFeedback).not.toContain('card.columns')
    expect(workoutFeedback).not.toContain('card.rows')

    const workoutWithoutDetailRequest = readCardToolRequest({
      kind: 'compact_table',
      version: 1,
      title: 'Synthetic workout',
      subtitle: null,
      footer: null,
      tracking: {
        kind: 'workout',
        entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
        snapshotAt: '2026-08-09T19:45:00.000Z',
      },
    })
    expect(workoutWithoutDetailRequest).toMatchObject({
      kind: 'invalid-response-card-arguments',
      validationDigest: {
        pathIssues: expect.arrayContaining([
          expect.objectContaining({ path: 'card.workout' }),
        ]),
      },
    })

    const trackedGenericRequest = readCardToolRequest({
      ...genericWithoutColumns,
      tracking: {
        kind: 'workout',
        entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
        snapshotAt: '2026-08-09T19:45:00.000Z',
      },
    })
    expect(trackedGenericRequest).toMatchObject({
      kind: 'invalid-response-card-arguments',
      validationDigest: {
        pathIssues: expect.arrayContaining([
          expect.objectContaining({ path: 'card.columns' }),
        ]),
      },
    })
    expect(JSON.stringify(trackedGenericRequest)).not.toContain('card.workout')

    const conflictingShapeRequest = readCardToolRequest({
      ...INVALID_TABLE,
      workout: {
        version: 1,
        state: 'active',
      },
    })
    expect(conflictingShapeRequest).toMatchObject({
      kind: 'invalid-response-card-arguments',
      validationDigest: {
        pathIssues: [{
          path: 'card',
          code: 'custom',
        }],
      },
    })

    const shapeChoiceRequest = readCardToolRequest({
      kind: 'compact_table',
      version: 1,
      title: 'Synthetic table',
      subtitle: null,
      footer: null,
      tracking: null,
    })
    expect(shapeChoiceRequest).toMatchObject({
      kind: 'invalid-response-card-arguments',
      validationDigest: {
        pathIssues: [{
          path: 'card',
          code: 'custom',
        }],
      },
    })
    if (
      !shapeChoiceRequest
      || shapeChoiceRequest.kind !== 'invalid-response-card-arguments'
    ) {
      throw new Error('expected compact-table shape choice feedback')
    }
    expect(buildResponseCardValidationFeedback(
      shapeChoiceRequest.validationDigest,
    )).toBe(JSON.stringify({
      error: 'invalid_response_card_arguments',
      hints: [{
        field: 'card',
        code: 'custom',
        expected: 'compact_table.generic_or_workout_shape',
      }],
    }))
  })

  it('returns refinement-owned semantics for provider-permissive failures', () => {
    const nutritionMealCountRequest = readCardToolRequest(
      INVALID_NUTRITION_MEAL_COUNT_CARD,
    )
    expect(nutritionMealCountRequest).toMatchObject({
      kind: 'invalid-response-card-arguments',
      validationDigest: {
        pathIssues: expect.arrayContaining([
          expect.objectContaining({
            path: 'card.totals.proteinGrams.mealCount',
            code: 'custom',
            expected: 'at_most_card.meal_count',
          }),
        ]),
      },
    })
    if (
      !nutritionMealCountRequest
      || nutritionMealCountRequest.kind !== 'invalid-response-card-arguments'
    ) {
      throw new Error('expected nutrition meal-count relation to fail')
    }
    expect(buildResponseCardValidationFeedback(
      nutritionMealCountRequest.validationDigest,
    )).toContain('"expected":"at_most_card.meal_count"')
    expect(readCardToolRequest({
      ...INVALID_NUTRITION_MEAL_COUNT_CARD,
      totals: {
        ...INVALID_NUTRITION_MEAL_COUNT_CARD.totals,
        proteinGrams: { total: 90, mealCount: 2 },
      },
    })).toMatchObject({ kind: 'attach-response-card' })

    for (const proteinGrams of [
      { total: null, mealCount: 1 },
      { total: 12, mealCount: 0 },
    ] as const) {
      const hybridMetricCard = {
        ...VALID_NUTRITION_CARD,
        totals: {
          ...VALID_NUTRITION_CARD.totals,
          proteinGrams,
        },
        goals: {
          ...VALID_NUTRITION_CARD.goals,
          proteinGrams: { target: 100, status: 'unavailable' },
        },
      } as const
      const hybridRequest = readCardToolRequest(hybridMetricCard)
      expect(hybridRequest).toMatchObject({
        kind: 'invalid-response-card-arguments',
        validationDigest: {
          pathIssues: [{
            path: 'card.totals.proteinGrams.mealCount',
            code: 'custom',
            expected: 'zero_iff_total_null',
          }],
        },
      })
      if (
        !hybridRequest
        || hybridRequest.kind !== 'invalid-response-card-arguments'
      ) {
        throw new Error('expected optional metric relation to fail')
      }
      expect(buildResponseCardValidationFeedback(
        hybridRequest.validationDigest,
      )).toBe(JSON.stringify({
        error: 'invalid_response_card_arguments',
        hints: [{
          field: 'card.totals.proteinGrams.mealCount',
          code: 'custom',
          expected: 'zero_iff_total_null',
        }],
      }))
    }
    expect(readCardToolRequest(VALID_NUTRITION_CARD)).toMatchObject({
      kind: 'attach-response-card',
    })
    expect(readCardToolRequest({
      ...VALID_NUTRITION_CARD,
      totals: {
        ...VALID_NUTRITION_CARD.totals,
        proteinGrams: { total: null, mealCount: 0 },
      },
      goals: {
        ...VALID_NUTRITION_CARD.goals,
        proteinGrams: { target: 100, status: 'unavailable' },
      },
    })).toMatchObject({ kind: 'attach-response-card' })

    const pendingActualRequest = readCardToolRequest(
      INVALID_PENDING_ACTUAL_WORKOUT_CARD,
    )
    expect(pendingActualRequest).toMatchObject({
      kind: 'invalid-response-card-arguments',
      validationDigest: {
        pathIssues: expect.arrayContaining([
          expect.objectContaining({
            path: 'card.workout.exercises[].sets[].actual',
            code: 'custom',
            expected: 'null_unless_status_completed',
          }),
        ]),
      },
    })
    expect(readCardToolRequest({
      ...INVALID_PENDING_ACTUAL_WORKOUT_CARD,
      workout: {
        ...INVALID_PENDING_ACTUAL_WORKOUT_CARD.workout,
        exercises: [{
          ...INVALID_PENDING_ACTUAL_WORKOUT_CARD.workout.exercises[0],
          sets: [{ status: 'pending', target: '8 reps', actual: null }],
        }],
      },
    })).toMatchObject({ kind: 'attach-response-card' })

    const oversizedCard = buildOversizedGenericTableCard()
    const oversizedRequest = readCardToolRequest(oversizedCard)
    expect(oversizedRequest).toMatchObject({
      kind: 'invalid-response-card-arguments',
      validationDigest: {
        pathIssues: expect.arrayContaining([
          expect.objectContaining({
            path: 'card',
            code: 'custom',
            expected: 'within_response_card_payload_limit',
          }),
        ]),
      },
    })
    if (!oversizedRequest || oversizedRequest.kind !== 'invalid-response-card-arguments') {
      throw new Error('expected oversized response card arguments to fail')
    }
    const feedback = buildResponseCardValidationFeedback(
      oversizedRequest.validationDigest,
    )
    expect(feedback).toContain('within_response_card_payload_limit')
    expect(feedback).not.toContain('generic_or_workout_shape')
    expect(feedback).not.toContain(oversizedCard.title)
    expect(feedback.length).toBeLessThanOrEqual(1_600)
  })
})

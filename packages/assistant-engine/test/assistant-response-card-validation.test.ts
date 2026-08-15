import { describe, expect, it } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  MURPH_ATTACH_RESPONSE_CARD_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'
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

function readCardToolRequest(card: unknown) {
  return readTestMurphDynamicToolRequest({
    id: 1,
    method: 'item/tool/call',
    params: {
      arguments: { card },
      namespace: 'murph',
      tool: MURPH_ATTACH_RESPONSE_CARD_TOOL.name,
    },
  })
}

describe('response-card validation feedback', () => {
  it('returns bounded schema-owned repair hints and accepts the corrected retry', async () => {
    const request = readCardToolRequest(INVALID_TABLE)
    expect(request?.kind).toBe('invalid-response-card-arguments')
    if (!request || request.kind !== 'invalid-response-card-arguments') {
      throw new Error('expected invalid response card arguments')
    }

    expect(request.validationDigest.pathIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'card.rows.[].values',
        code: 'too_small',
        expected: 'array.min_1',
      }),
      expect.objectContaining({
        path: 'card.rows.[].values',
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
            path: 'card.rows.[].values.[]',
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
      '"field":"card.rows.[].values","code":"too_small","expected":"array.min_1"',
    )
    expect(feedback).toContain(
      '"field":"card.rows.[].values","code":"custom","expected":"same_count_as_card.columns"',
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
})

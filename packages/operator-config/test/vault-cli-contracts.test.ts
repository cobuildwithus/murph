import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

function recordTypeDescriptionFromModule(
  module: typeof import('../src/vault-cli-contracts.ts'),
): string | undefined {
  return module.listFilterSchema.shape.recordType.description
}

afterEach(() => {
  vi.doUnmock('@murphai/query/entity-families')
  vi.resetModules()
})

test('listFilterSchema describes query record types from the query package when available', async () => {
  vi.resetModules()
  vi.doMock('@murphai/query/entity-families', () => ({
    ALL_QUERY_ENTITY_FAMILIES: ['custom_a', 'custom_b'],
  }))

  const module = await import('../src/vault-cli-contracts.ts')
  const description = recordTypeDescriptionFromModule(module)

  assert.match(description ?? '', /custom_a, custom_b/u)
})

test('listFilterSchema fails closed when query record types are not an array', async () => {
  vi.resetModules()
  vi.doMock('@murphai/query/entity-families', () => ({
    ALL_QUERY_ENTITY_FAMILIES: 'not-an-array',
  }))

  await assert.rejects(() => import('../src/vault-cli-contracts.ts'), {
    message: /join is not a function/u,
  })
})

test('listFilterSchema surfaces query family loading failures', async () => {
  vi.resetModules()
  vi.doMock('@murphai/query/entity-families', () => {
    const mockedModule: Record<string, unknown> = {}
    Object.defineProperty(mockedModule, 'ALL_QUERY_ENTITY_FAMILIES', {
      enumerable: true,
      get() {
        throw new Error('query families unavailable')
      },
    })
    return mockedModule
  })

  await assert.rejects(() => import('../src/vault-cli-contracts.ts'), {
    message: /query families unavailable/u,
  })
})

test('workout result contracts retain exercise-owned live tracking facts', async () => {
  vi.resetModules()
  const { workoutAddResultSchema } = await import('../src/vault-cli-contracts.ts')
  const parsed = workoutAddResultSchema.parse({
    activityType: 'strength-training',
    created: true,
    distanceKm: null,
    durationMinutes: 30,
    eventId: 'evt_workout',
    kind: 'activity_session',
    ledgerFile: 'events.ndjson',
    lookupId: 'evt_workout',
    note: 'Eight set workout',
    occurredAt: '2026-08-13T14:00:00.000Z',
    title: 'Eight set workout',
    vault: './vault',
    workout: {
      exercises: [{
        memberRepsPerSet: 9,
        name: 'Seated cable curl',
        order: 1,
        setPlanIsFinite: true,
        sets: [{ order: 1 }],
      }],
    },
  })

  assert.equal(parsed.workout?.exercises[0]?.memberRepsPerSet, 9)
  assert.equal(parsed.workout?.exercises[0]?.setPlanIsFinite, true)
})

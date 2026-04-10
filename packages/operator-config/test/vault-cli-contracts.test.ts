import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

function recordTypeDescriptionFromModule(
  module: typeof import('../src/vault-cli-contracts.ts'),
): string | undefined {
  return module.listFilterSchema.shape.recordType.description
}

afterEach(() => {
  vi.doUnmock('@murphai/query')
  vi.resetModules()
})

test('listFilterSchema describes query record types from the query package when available', async () => {
  vi.resetModules()
  vi.doMock('@murphai/query', () => ({
    ALL_QUERY_ENTITY_FAMILIES: ['custom_a', 'custom_b'],
  }))

  const module = await import('../src/vault-cli-contracts.ts')
  const description = recordTypeDescriptionFromModule(module)

  assert.match(description ?? '', /custom_a, custom_b/u)
})

test('listFilterSchema fails closed when query record types are not an array', async () => {
  vi.resetModules()
  vi.doMock('@murphai/query', () => ({
    ALL_QUERY_ENTITY_FAMILIES: 'not-an-array',
  }))

  await assert.rejects(() => import('../src/vault-cli-contracts.ts'), {
    message: /join is not a function/u,
  })
})

test('listFilterSchema surfaces query family loading failures', async () => {
  vi.resetModules()
  vi.doMock('@murphai/query', () => {
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

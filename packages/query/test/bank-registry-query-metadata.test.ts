import { expect, test } from 'vitest'

test('bank registry query metadata exposes only the bank-named reader', async () => {
  const mod = await import('../src/health/bank-registry-query-metadata.ts')

  expect(typeof mod.getBankRegistryQueryMetadata).toBe('function')
  expect(mod.getBankRegistryQueryMetadata('goal')).toBeDefined()
  expect('getHealthRegistryQueryMetadata' in mod).toBe(false)
})

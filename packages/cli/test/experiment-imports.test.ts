import { test, vi } from 'vitest'

test('experiment command registration does not import Health Commons runtime at module load', async () => {
  vi.resetModules()
  vi.doMock('@murphai/health-commons/runtime', () => {
    throw new Error('Experiment commands must not depend on the Health Commons runtime')
  })

  await import('../src/commands/experiment.ts')

  vi.doUnmock('@murphai/health-commons/runtime')
})

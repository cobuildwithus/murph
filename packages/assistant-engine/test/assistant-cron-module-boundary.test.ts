import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('../src/assistant/input-store.js')
  vi.doUnmock('../src/assistant/store.js')
})

describe('assistant cron module boundary', () => {
  it('keeps runtime input and session stores out of cron authoring module load', async () => {
    vi.resetModules()
    vi.doMock('../src/assistant/input-store.js', () => {
      throw new Error('assistant input store loaded eagerly')
    })
    vi.doMock('../src/assistant/store.js', () => {
      throw new Error('assistant session store loaded eagerly')
    })

    // These direct imports prove the mocks are live. The compatibility helper
    // must not touch either mock until it is actually executed.
    await expect(import('../src/assistant/input-store.js')).rejects.toThrow()
    await expect(import('../src/assistant/store.js')).rejects.toThrow()

    vi.resetModules()
    await expect(import('../src/assistant/cron/canonical-jobs.js')).resolves.toMatchObject({
      backfillCanonicalAssistantCronCurrentRouteSnapshot: expect.any(Function),
    })
  })
})

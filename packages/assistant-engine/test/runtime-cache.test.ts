import { afterEach, describe, expect, it, vi } from 'vitest'

describe('assistant runtime cache helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('normalizes invalid limits, tracks hits and misses, and prunes expired entries across caches', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'))

    const {
      createAssistantRuntimeCache,
      listAssistantRuntimeCacheSnapshots,
      pruneAssistantRuntimeCaches,
    } = await import('../src/assistant/runtime-cache.ts')

    const cache = createAssistantRuntimeCache<string, string>({
      maxEntries: 0,
      name: 'cache-a',
      ttlMs: 0,
    })

    expect(cache.get('missing')).toBeUndefined()
    expect(cache.set('alpha', 'first')).toBe('first')
    expect(cache.get('alpha')).toBe('first')
    cache.set('beta', 'second')

    expect(cache.get('alpha')).toBeUndefined()
    expect(cache.snapshot()).toEqual({
      name: 'cache-a',
      limit: 1,
      size: 1,
      hits: 1,
      misses: 2,
      evictions: 1,
      expired: 0,
      ttlMs: 1,
    })

    vi.advanceTimersByTime(5)
    expect(cache.get('beta')).toBeUndefined()
    expect(cache.snapshot().expired).toBe(1)

    const secondCache = createAssistantRuntimeCache<string, string>({
      maxEntries: 2,
      name: 'cache-b',
      ttlMs: 5,
    })
    secondCache.set('one', '1')
    secondCache.set('two', '2')

    vi.advanceTimersByTime(10)
    expect(pruneAssistantRuntimeCaches()).toBeGreaterThanOrEqual(2)
    expect(
      listAssistantRuntimeCacheSnapshots().map((snapshot) => snapshot.name),
    ).toEqual(expect.arrayContaining(['cache-a', 'cache-b']))
  })
})

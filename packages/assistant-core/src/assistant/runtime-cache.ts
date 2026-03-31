export interface AssistantRuntimeCacheSnapshot {
  evictions: number
  expired: number
  hits: number
  limit: number
  misses: number
  name: string
  size: number
  ttlMs: number
}

interface AssistantRuntimeCacheEntry<TValue> {
  expiresAtMs: number
  value: TValue
}

export interface AssistantRuntimeCache<TKey, TValue> {
  clear(): void
  delete(key: TKey): void
  get(key: TKey): TValue | undefined
  pruneExpired(nowMs?: number): number
  set(key: TKey, value: TValue): TValue
  snapshot(): AssistantRuntimeCacheSnapshot
}

const registeredAssistantRuntimeCaches: AssistantRuntimeCache<unknown, unknown>[] = []

export function createAssistantRuntimeCache<TKey, TValue>(input: {
  maxEntries: number
  name: string
  ttlMs: number
}): AssistantRuntimeCache<TKey, TValue> {
  const maxEntries = normalizePositiveInteger(input.maxEntries, 1)
  const ttlMs = normalizePositiveInteger(input.ttlMs, 1)
  const entries = new Map<TKey, AssistantRuntimeCacheEntry<TValue>>()
  let hits = 0
  let misses = 0
  let evictions = 0
  let expired = 0

  const cache: AssistantRuntimeCache<TKey, TValue> = {
    clear() {
      entries.clear()
    },
    delete(key) {
      entries.delete(key)
    },
    get(key) {
      const nowMs = Date.now()
      const entry = entries.get(key)
      if (!entry) {
        misses += 1
        return undefined
      }
      if (entry.expiresAtMs <= nowMs) {
        entries.delete(key)
        misses += 1
        expired += 1
        return undefined
      }

      entries.delete(key)
      entries.set(key, {
        value: entry.value,
        expiresAtMs: nowMs + ttlMs,
      })
      hits += 1
      return entry.value
    },
    pruneExpired(nowMs = Date.now()) {
      let removed = 0
      for (const [key, entry] of entries) {
        if (entry.expiresAtMs > nowMs) {
          continue
        }
        entries.delete(key)
        removed += 1
      }
      expired += removed
      return removed
    },
    set(key, value) {
      const expiresAtMs = Date.now() + ttlMs
      if (entries.has(key)) {
        entries.delete(key)
      }
      entries.set(key, {
        value,
        expiresAtMs,
      })
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value
        if (oldestKey === undefined) {
          break
        }
        entries.delete(oldestKey)
        evictions += 1
      }
      return value
    },
    snapshot() {
      return {
        name: input.name,
        limit: maxEntries,
        size: entries.size,
        hits,
        misses,
        evictions,
        expired,
        ttlMs,
      }
    },
  }

  registeredAssistantRuntimeCaches.push(
    cache as AssistantRuntimeCache<unknown, unknown>,
  )
  return cache
}

export function listAssistantRuntimeCacheSnapshots(): AssistantRuntimeCacheSnapshot[] {
  return registeredAssistantRuntimeCaches.map((cache) => cache.snapshot())
}

export function pruneAssistantRuntimeCaches(nowMs = Date.now()): number {
  return registeredAssistantRuntimeCaches.reduce(
    (total, cache) => total + cache.pruneExpired(nowMs),
    0,
  )
}

function normalizePositiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

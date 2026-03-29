import { createAssistantRuntimeCache } from './runtime-cache.js'

export const ASSISTANT_SESSION_CACHE = {
  maxEntries: 256,
  ttlMs: 30_000,
} as const

export const ASSISTANT_INDEX_CACHE = {
  maxEntries: 16,
  ttlMs: 30_000,
} as const

export const ASSISTANT_AUTOMATION_STATE_CACHE = {
  maxEntries: 8,
  ttlMs: 5_000,
} as const

export const ASSISTANT_TURN_RECEIPT_CACHE = {
  maxEntries: 256,
  ttlMs: 30_000,
} as const

export const ASSISTANT_FAILOVER_STATE_CACHE = {
  maxEntries: 16,
  ttlMs: 15_000,
} as const

export const ASSISTANT_PROVIDER_ROUTE_RECOVERY_CACHE = {
  maxEntries: 128,
  ttlMs: 30_000,
} as const

export function createAssistantBoundedRuntimeCache<TKey, TValue>(input: {
  maxEntries: number
  name: string
  ttlMs: number
}) {
  return createAssistantRuntimeCache<TKey, TValue>(input)
}

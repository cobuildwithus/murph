import { createAssistantRuntimeCache } from './runtime-cache.js'

export const ASSISTANT_AUTOMATION_STATE_CACHE = {
  maxEntries: 8,
  ttlMs: 5_000,
} as const

export function createAssistantBoundedRuntimeCache<TKey, TValue>(input: {
  maxEntries: number
  name: string
  ttlMs: number
}) {
  return createAssistantRuntimeCache<TKey, TValue>(input)
}

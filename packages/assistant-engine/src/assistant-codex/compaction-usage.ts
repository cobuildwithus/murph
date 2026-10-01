import {
  readCodexNonEmptyString,
  readCodexRecord,
  readCodexTokenUsageBreakdown,
  type CodexTokenUsageBreakdown,
} from './app-server-protocol.js'

export interface CodexCompactionResponseUsage extends CodexTokenUsageBreakdown {
  responseId: string
}

export function collectCodexCompactionResponseUsage(
  message: unknown,
  identity: { threadId: string; turnId: string | null },
  responses: Map<string, CodexCompactionResponseUsage>,
): void {
  const usage = readCodexCompactionResponseUsage(message, identity)
  if (usage && responses.size < 32 && !responses.has(usage.responseId)) {
    responses.set(usage.responseId, usage)
  }
}

// The raw notification carries numeric buckets only. Never retain response
// items/content or accept completions from another thread or compaction turn.
export function readCodexCompactionResponseUsage(
  message: unknown,
  identity: { threadId: string; turnId: string | null },
): CodexCompactionResponseUsage | null {
  const event = readCodexRecord(message)
  const params = readCodexRecord(event?.params)
  if (
    event?.method !== 'rawResponse/completed'
    || identity.turnId === null
    || params?.threadId !== identity.threadId
    || params?.turnId !== identity.turnId
  ) return null
  const responseId = readCodexNonEmptyString(params.responseId)
  const usage = readCodexTokenUsageBreakdown(params.usage)
  if (
    !responseId || responseId.length > 512 || !usage
    || usage.totalTokens !== usage.inputTokens + usage.outputTokens
    || usage.cachedInputTokens + usage.cacheWriteInputTokens > usage.inputTokens
    || usage.reasoningOutputTokens > usage.outputTokens
  ) return null
  return { ...usage, responseId }
}

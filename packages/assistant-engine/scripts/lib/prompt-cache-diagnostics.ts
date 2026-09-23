import { createHmac, randomBytes } from 'node:crypto'

type Json = Record<string, unknown>
export function object(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Json : {}
}

const reasons = new Set([
  'model_changed', 'prompt_cache_key_changed', 'service_tier_changed', 'tools_changed',
  'text_format_changed', 'reasoning_effort_changed', 'verbosity_changed',
  'context_compacted', 'input_changed',
])
const outcomes = new Set(['cache_hit', 'cache_miss', 'comparison_response_not_found', 'unavailable'])
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const allowed = (value: unknown, values: readonly string[]): string | null =>
  typeof value === 'string' && values.includes(value) ? value : null

export interface CacheReplayPolicy {
  /** A synthetic fixture cohort, never a member identifier. */
  cohort: string
  key: 'preserve' | 'cohort'
  breakpoint: 'none' | 'developer'
  mode: 'implicit' | 'explicit'
}

export interface PreparedCacheRequest {
  body: Json
  complete(response: unknown): void
}

/** Local replay state only. Neither provider IDs nor raw content leave this owner. */
export class CacheReplayDiagnostics {
  private readonly salt = randomBytes(32)
  private readonly baselines = new Map<string, { id: string; at: number }>()
  private sequence = 0

  constructor(private readonly emit: (event: Json) => void) {}

  private fingerprint(value: unknown): string {
    return createHmac('sha256', this.salt).update(JSON.stringify(value) ?? 'null').digest('hex').slice(0, 24)
  }

  prepare(value: unknown, transport: 'http' | 'websocket', policy: CacheReplayPolicy): PreparedCacheRequest {
    const body = structuredClone(object(value))
    const startedAt = Date.now()
    const prewarm = body.generate === false
    const sequence = ++this.sequence
    // Compare across fresh threads for a replay cohort, but never across cohorts.
    const scope = this.fingerprint(policy.cohort)
    const previous = this.baselines.get(scope)
    const baseline = !prewarm && previous && startedAt - previous.at < 30 * 60_000 ? previous : undefined
    if (policy.key === 'cohort') body.prompt_cache_key = `murph-replay-${scope}`
    let breakpointAdded = false
    if (policy.breakpoint === 'developer' && Array.isArray(body.input)) {
      const developer = body.input.map(object).find((item) => item.role === 'developer' && item.type !== 'additional_tools')
      if (developer) {
        if (typeof developer.content === 'string') {
          developer.content = [{ type: 'input_text', text: developer.content }]
        }
        const content = Array.isArray(developer.content) ? developer.content.map(object) : []
        const lastText = [...content].reverse().find((part) => part.type === 'input_text')
        if (lastText) {
          lastText.prompt_cache_breakpoint = { mode: 'explicit' }
          breakpointAdded = true
        }
      }
    }
    // An absent marker with explicit-only mode would silently disable all caching.
    if (policy.mode === 'explicit' && !breakpointAdded && !body.previous_response_id) throw new Error('cache_replay_missing_developer_breakpoint')
    body.prompt_cache_options = {
      ...object(body.prompt_cache_options),
      mode: policy.mode,
      ...(baseline ? { comparison_response_id: baseline.id } : {}),
    }
    const input = Array.isArray(body.input) ? body.input.map(object) : []
    const tools = [body.tools ?? [], ...input.filter((item) => item.type === 'additional_tools').map((item) => item.tools)]
    const settings = {
      model: allowed(body.model, ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-6-astra']),
      reasoningEffort: allowed(object(body.reasoning).effort, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']),
      requestedServiceTier: allowed(body.service_tier, ['auto', 'default', 'flex', 'priority']),
      cacheKeyFingerprint: this.fingerprint(body.prompt_cache_key),
      toolsFingerprint: this.fingerprint(tools),
      textFormatFingerprint: this.fingerprint(object(body.text).format),
      instructionsFingerprint: this.fingerprint(body.instructions),
      inputItems: input.length,
      requestBytes: Buffer.byteLength(JSON.stringify(body)),
    }
    let completed = false
    return {
      body,
      complete: (value) => {
        if (completed) return
        completed = true
        const response = object(value)
        const usage = object(response.usage)
        const details = object(usage.input_tokens_details)
        const diagnostic = object(response.prompt_cache_diagnostics)
        const inputTokens = count(usage.input_tokens)
        const cachedTokens = count(details.cached_tokens)
        const cacheWriteTokens = count(details.cache_write_tokens)
        const uncachedTokens = inputTokens !== null && cachedTokens !== null && cachedTokens <= inputTokens
          ? inputTokens - cachedTokens : null
        this.emit({
          event: 'prompt_cache_replay', version: 1, sequence, transport, ...settings,
          status: allowed(response.status, ['completed', 'failed', 'incomplete']),
          prewarm, previousResponsePresent: typeof body.previous_response_id === 'string',
          cohortFingerprint: scope, keyPolicy: policy.key, cacheMode: policy.mode,
          breakpointAdded, comparisonSent: Boolean(baseline),
          comparisonAgeMs: baseline ? startedAt - baseline.at : null,
          durationMs: Math.max(0, Date.now() - startedAt),
          inputTokens, cachedTokens, cacheWriteTokens, uncachedTokens,
          outputTokens: count(usage.output_tokens),
          // Equivalent uncached-input token cost, excluding output. Cache writes
          // replace the normal input charge; do not add another full 1.25x.
          inputCostUnits: !prewarm && uncachedTokens !== null && cachedTokens !== null && cacheWriteTokens !== null
            && cacheWriteTokens <= uncachedTokens
            ? uncachedTokens + cachedTokens * 0.1 + cacheWriteTokens * 0.25 : null,
          diagnosticType: typeof diagnostic.type === 'string' && outcomes.has(diagnostic.type) ? diagnostic.type : null,
          diagnosticReason: typeof diagnostic.reason === 'string' && reasons.has(diagnostic.reason) ? diagnostic.reason : null,
          comparisonReusableTokens: count(diagnostic.comparison_reusable_tokens),
          cacheMissedTokens: count(diagnostic.cache_missed_tokens),
          actualServiceTier: allowed(response.service_tier, ['auto', 'default', 'flex', 'priority']),
        })
        if (!prewarm && response.status === 'completed' && typeof response.id === 'string' && /^resp_[a-zA-Z0-9_-]{1,256}$/.test(response.id)) {
          this.baselines.delete(scope)
          this.baselines.set(scope, { id: response.id, at: Date.now() })
          if (this.baselines.size > 128) this.baselines.delete(this.baselines.keys().next().value!)
        }
      },
    }
  }
}

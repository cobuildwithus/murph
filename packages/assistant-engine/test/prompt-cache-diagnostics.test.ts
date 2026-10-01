import { expect, it, vi } from 'vitest'
import { CacheReplayDiagnostics, type CacheReplayPolicy } from '../scripts/lib/prompt-cache-diagnostics.js'

const policy: CacheReplayPolicy = { cohort: 'synthetic', key: 'preserve', breakpoint: 'none', mode: 'implicit' }
const request = { model: 'gpt-5.6-terra', prompt_cache_key: 'private-thread-key', input: [{ role: 'developer', content: [{ type: 'input_text', text: 'private instructions' }] }] }
const response = { status: 'completed', id: 'resp_private', usage: { input_tokens: 2000, input_tokens_details: { cached_tokens: 1500, cache_write_tokens: 400 }, output_tokens: 20 } }

it('compares only completed responses, across transports, without serializing private fields', () => {
  const emit = vi.fn()
  const diagnostics = new CacheReplayDiagnostics(emit)
  const first = diagnostics.prepare(request, 'websocket', policy)
  expect(first.body.prompt_cache_options).toEqual({ mode: 'implicit' })
  expect(diagnostics.prepare(request, 'http', policy).body.prompt_cache_options).toEqual({ mode: 'implicit' })
  first.complete(response)
  first.complete(response)
  expect(emit).toHaveBeenCalledTimes(1)
  expect(diagnostics.prepare(request, 'http', policy).body.prompt_cache_options).toMatchObject({ comparison_response_id: 'resp_private' })
  expect(emit.mock.calls[0]![0]).toMatchObject({ inputCostUnits: 750, cachedTokens: 1500, cacheWriteTokens: 400, transport: 'websocket' })
  expect(JSON.stringify(emit.mock.calls)).not.toContain('private')
})

it('retains the completed baseline after failed responses and expires old comparisons', () => {
  vi.useFakeTimers()
  try {
    const diagnostics = new CacheReplayDiagnostics(() => {})
    diagnostics.prepare(request, 'http', policy).complete(response)
    diagnostics.prepare(request, 'http', policy).complete({ ...response, status: 'failed', id: 'resp_failed' })
    expect(diagnostics.prepare(request, 'websocket', policy).body.prompt_cache_options).toMatchObject({ comparison_response_id: 'resp_private' })
    expect(diagnostics.prepare(request, 'http', { ...policy, cohort: 'other' }).body.prompt_cache_options).toEqual({ mode: 'implicit' })
    vi.advanceTimersByTime(30 * 60_000)
    expect(diagnostics.prepare(request, 'http', policy).body.prompt_cache_options).toEqual({ mode: 'implicit' })
  } finally { vi.useRealTimers() }
})

it('marks the stable developer prefix without mutating the caller or removing implicit writes', () => {
  const diagnostics = new CacheReplayDiagnostics(() => {})
  const prepared = diagnostics.prepare(request, 'websocket', { ...policy, breakpoint: 'developer', key: 'cohort' })
  expect(prepared.body.input).toEqual([{ role: 'developer', content: [{ type: 'input_text', text: 'private instructions', prompt_cache_breakpoint: { mode: 'explicit' } }] }])
  expect(prepared.body.prompt_cache_options).toEqual({ mode: 'implicit' })
  expect(prepared.body.prompt_cache_key).not.toBe(request.prompt_cache_key)
  expect(JSON.stringify(request)).not.toContain('prompt_cache_breakpoint')
  expect(() => diagnostics.prepare({ input: [] }, 'http', { ...policy, mode: 'explicit' })).toThrow('cache_replay_missing_developer_breakpoint')
})

it('allowlists diagnostic labels, and never treats missing usage as zero cost', () => {
  const emit = vi.fn()
  const diagnostics = new CacheReplayDiagnostics(emit)
  diagnostics.prepare(request, 'http', policy).complete({ ...response, usage: {}, prompt_cache_diagnostics: { type: 'cache_miss', reason: 'input_changed', cache_missed_tokens: 123, arbitrary: 'private' } })
  expect(emit.mock.calls[0]![0]).toMatchObject({ inputCostUnits: null, diagnosticType: 'cache_miss', diagnosticReason: 'input_changed', cacheMissedTokens: 123 })
  expect(JSON.stringify(emit.mock.calls)).not.toContain('private')
})

it('does not use WebSocket prewarm responses as diagnostic baselines or generation costs', () => {
  const emit = vi.fn()
  const diagnostics = new CacheReplayDiagnostics(emit)
  diagnostics.prepare(request, 'websocket', policy).complete(response)
  diagnostics.prepare({ ...request, generate: false }, 'websocket', policy).complete({ ...response, id: 'resp_prewarm' })
  expect(emit.mock.calls[1]![0]).toMatchObject({ prewarm: true, comparisonSent: false, inputCostUnits: null })
  expect(diagnostics.prepare(request, 'websocket', policy).body.prompt_cache_options).toMatchObject({ comparison_response_id: 'resp_private' })
})

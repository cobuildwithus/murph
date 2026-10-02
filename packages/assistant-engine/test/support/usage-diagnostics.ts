import type { HostedUsageDiagnosticsResponse } from '@murphai/hosted-execution/usage-diagnostics'

export function syntheticUsageDiagnostics(): HostedUsageDiagnosticsResponse {
  const totals = {
    records: 12, turns: 3, costUsd: 1.25,
    inputTokens: 800000, cachedInputTokens: 600000, cacheWriteTokens: 0,
    outputTokens: 3000, reasoningTokens: 1000, unpricedRecords: 0,
  }
  return {
    status: 'available', generatedAt: '2026-10-01T12:00:00.000Z',
    windowStart: '2026-09-24T12:00:00.000Z', windowEnd: '2026-10-01T12:00:00.000Z',
    costBasis: 'recorded_allowance_usd', totals,
    byModel: [{ ...totals, model: 'gpt-6.1-sol', pricingBasis: 'standard' }],
    bySource: [{ ...totals, source: 'conversation' }],
    topTurns: [{
      ...totals, turnId: 'turn_synthetic_lookup', occurredAt: '2026-09-30T12:00:00.000Z',
      model: 'gpt-6.1-sol', source: 'conversation', toolOutputCoverage: 'partial',
      tools: [{ kind: 'dynamic_tool', label: 't_connected_apps_search', calls: 5,
        outputBytesTotal: 240000, outputBytesMax: 100000 }],
    }],
    modelRates: [{ model: 'gpt-6.1-sol', pricingBasis: 'standard',
      inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.2, cacheWriteUsdPerMillion: 0,
      outputUsdPerMillion: 8, pricingVersion: 'synthetic-fixture' }],
    coverage: { allowanceExcludedRecords: 0, modelGroupsTruncated: false, sourceGroupsTruncated: false,
      toolOutputUnit: 'bytes_not_tokens', toolOutputScope: 'latest_profile_per_top_turn' },
  }
}

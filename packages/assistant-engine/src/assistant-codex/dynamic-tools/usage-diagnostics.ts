import type {
  HostedUsageDiagnosticsRequest,
  HostedUsageDiagnosticsResponse,
} from '@murphai/hosted-execution/usage-diagnostics'

// Member questions need the few costliest turns; the monthly usage review
// passes its own larger limit.
const USAGE_DIAGNOSTICS_DEFAULT_TURN_LIMIT = 5

// The tool description says omitted counts are zero. Turns, records, costs,
// input/output tokens, tool bytes, model rates and coverage flags always stay.
const ZERO_OMITTED_COUNTS = new Set([
  'allowanceExcludedRecords',
  'cachedInputTokens',
  'cacheWriteTokens',
  'reasoningTokens',
  'unpricedRecords',
])

export function withUsageDiagnosticsDefaults(
  request: HostedUsageDiagnosticsRequest,
): HostedUsageDiagnosticsRequest {
  return request.limit === undefined
    ? { ...request, limit: USAGE_DIAGNOSTICS_DEFAULT_TURN_LIMIT }
    : request
}

export function projectUsageDiagnosticsForModel(report: HostedUsageDiagnosticsResponse) {
  if (report.status !== 'available') return report
  return {
    ...report,
    totals: omitZeroCounts(report.totals),
    byModel: report.byModel.map(omitZeroCounts),
    bySource: report.bySource.map(omitZeroCounts),
    topTurns: report.topTurns.map(omitZeroCounts),
    coverage: omitZeroCounts(report.coverage),
  }
}

function omitZeroCounts(row: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key, value]) =>
    !(value === 0 && ZERO_OMITTED_COUNTS.has(key))))
}

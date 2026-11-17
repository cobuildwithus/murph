import type { HostedUsageDiagnosticsRequest } from '@murphai/hosted-execution/usage-diagnostics'

// Member questions need the few costliest turns; the monthly usage review
// passes its own larger limit.
const USAGE_DIAGNOSTICS_DEFAULT_TURN_LIMIT = 5

export function withUsageDiagnosticsDefaults(
  request: HostedUsageDiagnosticsRequest,
): HostedUsageDiagnosticsRequest {
  return request.limit === undefined
    ? { ...request, limit: USAGE_DIAGNOSTICS_DEFAULT_TURN_LIMIT }
    : request
}

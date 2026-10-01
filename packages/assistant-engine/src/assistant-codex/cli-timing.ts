import { randomBytes, randomInt } from 'node:crypto'
import { createSocket, type Socket } from 'node:dgram'

import {
  CLI_TIMING_ENDPOINT_ENV,
  CLI_TIMING_EVENT_METHOD,
  CLI_TIMING_MAX_REPORT_BYTES,
  CLI_TIMING_MAX_REPORTS,
  emptyCliTiming,
  incrementCliTimingDrop,
  mergeCliTiming,
  normalizeCliTiming,
} from '@murphai/runtime-state/cli-timing'

const tickUs = () => Number(process.hrtime.bigint() / 1_000n)
const safeTick = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** One unreferenced socket owned by the EXISTING Codex process lifecycle, with
 * one bounded active-attempt buffer. Warm thread/resume ignores config overrides,
 * so the endpoint must be set at process launch, not replaced on each resume.
 * No awaited bind/flush, retries, persistent collection, or result-channel output.
 */
export function createCodexCliTimingReceiver() {
  let socket: Socket | undefined
  let ready = false
  let closed = false
  let active: { startedUs: number; seen: number; timing: ReturnType<typeof emptyCliTiming> } | null = null
  const close = () => {
    closed = true
    try { socket?.close() } catch { /* Best effort. */ }
  }
  const launchArgs: string[] = []
  try {
    const port = randomInt(49_152, 65_536)
    const key = randomBytes(16).toString('hex')
    socket = createSocket('udp4')
    socket.unref()
    socket.on('error', close)
    socket.on('listening', () => { ready = true; if (closed) close() })
    socket.on('message', (data, remote) => {
      const window = active
      if (closed || !window) return
      if (window.seen >= CLI_TIMING_MAX_REPORTS) { window.timing.transportTruncated = true; return }
      window.seen += 1
      if (remote.address !== '127.0.0.1' || data.byteLength > CLI_TIMING_MAX_REPORT_BYTES) return
      try {
        const envelope: unknown = JSON.parse(data.toString('utf8'))
        if (typeof envelope !== 'object' || envelope === null ||
            !('key' in envelope) || envelope.key !== key || !('timing' in envelope) ||
            !('startedUs' in envelope) || !safeTick(envelope.startedUs) ||
            !('endedUs' in envelope) || !safeTick(envelope.endedUs) ||
            envelope.endedUs < envelope.startedUs) return
        const report = normalizeCliTiming(envelope.timing)
        if (!report) return
        // hrtime is the same host's monotonic clock. Internal window guards only;
        // neither ticks nor transport keys are retained in usage telemetry.
        if (envelope.startedUs < window.startedUs || envelope.endedUs > tickUs()) {
          window.timing.outOfWindowReports = incrementCliTimingDrop(window.timing.outOfWindowReports)
          return
        }
        report.reportCount = 1
        report.outOfWindowReports = 0
        mergeCliTiming(window.timing, report)
      } catch { /* Malformed optional diagnostics cannot affect the provider. */ }
    })
    socket.bind(port, '127.0.0.1')
    launchArgs.push('--config', `shell_environment_policy.set.${CLI_TIMING_ENDPOINT_ENV}=${JSON.stringify(`${port}:${key}`)}`)
  } catch { close() }
  return {
    launchArgs,
    begin(): (turnId: string | null) => unknown | null {
      // A caller that never acquired a window cannot close another turn's data.
      if (closed || active) return () => null
      const window = { startedUs: tickUs(), seen: 0, timing: emptyCliTiming() }
      active = window
      return (turnId) => {
        if (active !== window) return null
        active = null
        if (!ready && window.timing.reportCount === 0) return null
        return { method: CLI_TIMING_EVENT_METHOD, params: { turnId, timing: window.timing } }
      }
    },
    close,
  }
}

/** Preserve the existing restrictive allowlist, admitting only our new explicit
 * diagnostic value. Absent/empty allowlists retain their original behavior. */
export function withCliTimingEnvironmentAdmission(
  config: Readonly<Record<string, unknown>> | null | undefined,
): Readonly<Record<string, unknown>> | null | undefined {
  const includeOnly = config?.['shell_environment_policy.include_only']
  if (!Array.isArray(includeOnly) || includeOnly.length === 0 ||
      includeOnly.includes(CLI_TIMING_ENDPOINT_ENV)) return config
  return { ...config, 'shell_environment_policy.include_only': [...includeOnly, CLI_TIMING_ENDPOINT_ENV] }
}

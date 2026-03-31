import {
  gatewayWaitForEventsInputSchema,
  type GatewayPollEventsInput,
  type GatewayPollEventsResult,
  type GatewayWaitForEventsInput,
} from './contracts.js'

export {
  applyGatewayProjectionSnapshotToEventLog,
  DEFAULT_GATEWAY_EVENT_RETENTION,
  pollGatewayEventLogState,
  type GatewayEventEmission,
  type GatewayEventLogState,
} from './snapshot.js'

export const DEFAULT_GATEWAY_EVENT_POLL_INTERVAL_MS = 250

export async function waitForGatewayEventsByPolling(
  poll: (input?: GatewayPollEventsInput) => Promise<GatewayPollEventsResult>,
  input?: GatewayWaitForEventsInput,
  options?: {
    intervalMs?: number
    sleep?: (ms: number) => Promise<void>
  },
): Promise<GatewayPollEventsResult> {
  const parsed = gatewayWaitForEventsInputSchema.parse(input ?? {})
  const intervalMs = Math.max(
    1,
    Math.trunc(options?.intervalMs ?? DEFAULT_GATEWAY_EVENT_POLL_INTERVAL_MS),
  )
  const sleeper = options?.sleep ?? defaultGatewayEventSleep

  let result = await poll({
    cursor: parsed.cursor,
    kinds: parsed.kinds,
    limit: parsed.limit,
    sessionKey: parsed.sessionKey,
  })
  if (result.events.length > 0 || parsed.timeoutMs <= 0) {
    return result
  }

  const deadline = Date.now() + parsed.timeoutMs
  while (Date.now() < deadline) {
    await sleeper(Math.min(intervalMs, Math.max(1, deadline - Date.now())))
    result = await poll({
      cursor: parsed.cursor,
      kinds: parsed.kinds,
      limit: parsed.limit,
      sessionKey: parsed.sessionKey,
    })
    if (result.events.length > 0) {
      return result
    }
  }

  return result
}

function defaultGatewayEventSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

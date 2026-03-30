import {
  gatewayListOpenPermissionsInputSchema,
  gatewayPollEventsInputSchema,
  gatewayPollEventsResultSchema,
  gatewayRespondToPermissionInputSchema,
  gatewayWaitForEventsInputSchema,
  type GatewayEvent,
  type GatewayListOpenPermissionsInput,
  type GatewayPermissionRequest,
  type GatewayPollEventsInput,
  type GatewayPollEventsResult,
  type GatewayRespondToPermissionInput,
  type GatewayProjectionSnapshot,
  type GatewayWaitForEventsInput,
} from './contracts.js'
import {
  diffGatewayProjectionSnapshots,
  exportGatewayProjectionSnapshotLocal,
  listGatewayOpenPermissionsFromSnapshot,
} from './projection.js'

const LOCAL_GATEWAY_EVENT_POLL_INTERVAL_MS = 250
const LOCAL_GATEWAY_EVENT_RETENTION = 512

interface LocalGatewayLiveState {
  events: GatewayEvent[]
  nextCursor: number
  snapshot: GatewayProjectionSnapshot | null
}

const localGatewayLiveStateByVault = new Map<string, LocalGatewayLiveState>()

export async function listGatewayOpenPermissionsLocal(
  vault: string,
  input?: GatewayListOpenPermissionsInput,
): Promise<GatewayPermissionRequest[]> {
  const parsed = gatewayListOpenPermissionsInputSchema.parse(input ?? {})
  const state = await refreshLocalGatewayLiveState(vault)
  return listGatewayOpenPermissionsFromSnapshot(state.snapshot ?? createEmptyGatewaySnapshot(), parsed)
}

export async function respondToGatewayPermissionLocal(
  _vault: string,
  input: GatewayRespondToPermissionInput,
): Promise<GatewayPermissionRequest | null> {
  gatewayRespondToPermissionInputSchema.parse(input)
  return null
}

export async function pollGatewayEventsLocal(
  vault: string,
  input?: GatewayPollEventsInput,
): Promise<GatewayPollEventsResult> {
  const parsed = gatewayPollEventsInputSchema.parse(input ?? {})
  const state = await refreshLocalGatewayLiveState(vault)
  const events = filterGatewayEvents(state.events, parsed)

  return gatewayPollEventsResultSchema.parse({
    events,
    nextCursor: events[events.length - 1]?.cursor ?? state.nextCursor,
    live: true,
  })
}

export async function waitForGatewayEventsLocal(
  vault: string,
  input?: GatewayWaitForEventsInput,
): Promise<GatewayPollEventsResult> {
  const parsed = gatewayWaitForEventsInputSchema.parse(input ?? {})
  const immediate = await pollGatewayEventsLocal(vault, parsed)
  if (immediate.events.length > 0) {
    return immediate
  }

  const deadline = Date.now() + parsed.timeoutMs
  while (Date.now() < deadline) {
    await sleep(Math.min(LOCAL_GATEWAY_EVENT_POLL_INTERVAL_MS, deadline - Date.now()))
    const polled = await pollGatewayEventsLocal(vault, parsed)
    if (polled.events.length > 0) {
      return polled
    }
  }

  const state = await refreshLocalGatewayLiveState(vault)
  return gatewayPollEventsResultSchema.parse({
    events: [],
    nextCursor: state.nextCursor,
    live: true,
  })
}

export async function refreshLocalGatewayLiveState(
  vault: string,
): Promise<LocalGatewayLiveState> {
  const nextSnapshot = await exportGatewayProjectionSnapshotLocal(vault)
  const existing = localGatewayLiveStateByVault.get(vault)
  if (!existing) {
    const created: LocalGatewayLiveState = {
      events: [],
      nextCursor: 0,
      snapshot: nextSnapshot,
    }
    localGatewayLiveStateByVault.set(vault, created)
    return created
  }

  const emissions = diffGatewayProjectionSnapshots(existing.snapshot, nextSnapshot)
  if (emissions.length === 0) {
    existing.snapshot = nextSnapshot
    return existing
  }

  for (const emission of emissions) {
    existing.nextCursor += 1
    existing.events.push({
      schema: 'murph.gateway-event.v1',
      cursor: existing.nextCursor,
      ...emission,
    })
  }
  if (existing.events.length > LOCAL_GATEWAY_EVENT_RETENTION) {
    existing.events.splice(0, existing.events.length - LOCAL_GATEWAY_EVENT_RETENTION)
  }
  existing.snapshot = nextSnapshot
  return existing
}

function filterGatewayEvents(
  events: GatewayEvent[],
  input: GatewayPollEventsInput,
): GatewayEvent[] {
  return events
    .filter((event) => event.cursor > input.cursor)
    .filter((event) => input.kinds.length === 0 || input.kinds.includes(event.kind))
    .filter((event) => input.sessionKey === null || event.sessionKey === input.sessionKey)
    .slice(0, input.limit)
}

function createEmptyGatewaySnapshot(): GatewayProjectionSnapshot {
  return {
    schema: 'murph.gateway-projection-snapshot.v1',
    generatedAt: new Date().toISOString(),
    conversations: [],
    messages: [],
    permissions: [],
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

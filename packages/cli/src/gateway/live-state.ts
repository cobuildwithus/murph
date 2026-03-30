import {
  gatewayListOpenPermissionsInputSchema,
  gatewayPollEventsResultSchema,
  gatewayRespondToPermissionInputSchema,
  gatewayWaitForEventsInputSchema,
  type GatewayListOpenPermissionsInput,
  type GatewayPermissionRequest,
  type GatewayPollEventsInput,
  type GatewayPollEventsResult,
  type GatewayProjectionSnapshot,
  type GatewayRespondToPermissionInput,
  type GatewayWaitForEventsInput,
} from './contracts.js'
import {
  applyGatewayProjectionSnapshotToEventLog,
  DEFAULT_GATEWAY_EVENT_RETENTION,
  exportGatewayProjectionSnapshotLocal,
  listGatewayOpenPermissionsFromSnapshot,
  pollGatewayEventLogState,
  type GatewayEventLogState,
} from './projection.js'

const LOCAL_GATEWAY_EVENT_POLL_INTERVAL_MS = 250
const LOCAL_GATEWAY_EVENT_RETENTION = DEFAULT_GATEWAY_EVENT_RETENTION

const localGatewayLiveStateByVault = new Map<string, GatewayEventLogState>()

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
  const state = await refreshLocalGatewayLiveState(vault)
  return pollGatewayEventLogState(state, input)
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
): Promise<GatewayEventLogState> {
  const nextSnapshot = await exportGatewayProjectionSnapshotLocal(vault)
  const existing = localGatewayLiveStateByVault.get(vault)
  if (!existing) {
    const created: GatewayEventLogState = {
      events: [],
      nextCursor: 0,
      snapshot: nextSnapshot,
    }
    localGatewayLiveStateByVault.set(vault, created)
    return created
  }

  const updated = applyGatewayProjectionSnapshotToEventLog(
    existing,
    nextSnapshot,
    LOCAL_GATEWAY_EVENT_RETENTION,
  )
  localGatewayLiveStateByVault.set(vault, updated)
  return updated
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

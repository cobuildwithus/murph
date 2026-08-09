import {
  isAssistantContextSnapshotRefreshPending as isCoreAssistantContextSnapshotRefreshPending,
  refreshAssistantContextSnapshot as refreshCoreAssistantContextSnapshot,
  refreshAssistantContextSnapshotBestEffort as refreshCoreAssistantContextSnapshotBestEffort,
  type AssistantContextSnapshotRefreshResult,
} from './assistant/context-snapshot.js'
import {
  isAssistantDeviceAvailabilitySnapshotRefreshPending,
  refreshAssistantDeviceAvailabilitySnapshot,
  type AssistantDeviceAvailabilityRefreshInput,
} from './assistant/context-snapshot-device-availability.js'

export * from './assistant/context-snapshot.js'

export async function isAssistantContextSnapshotRefreshPending(input: {
  vaultRoot: string
}): Promise<boolean> {
  if (await isCoreAssistantContextSnapshotRefreshPending(input)) {
    return true
  }

  return isAssistantDeviceAvailabilitySnapshotRefreshPending(input)
}

export async function refreshAssistantContextSnapshot(
  input: AssistantDeviceAvailabilityRefreshInput,
): Promise<AssistantContextSnapshotRefreshResult> {
  const coreResult = await refreshCoreAssistantContextSnapshot(input)
  return refreshAssistantDeviceAvailabilitySnapshot(input, coreResult)
}

export async function refreshAssistantContextSnapshotBestEffort(
  input: AssistantDeviceAvailabilityRefreshInput,
): Promise<AssistantContextSnapshotRefreshResult> {
  const coreResult = await refreshCoreAssistantContextSnapshotBestEffort(input)
  try {
    return await refreshAssistantDeviceAvailabilitySnapshot(input, coreResult)
  } catch {
    return coreResult
  }
}

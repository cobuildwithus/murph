export interface DeviceActivityCoverageCursor {
  after: string
  afterEntityIds?: readonly string[]
}

export interface DeviceActivityCoverageKey {
  entityId: string
  occurredAt: string
  triggeredAt: string
}

export function compareDeviceActivityCoverageKeys(
  left: DeviceActivityCoverageKey,
  right: DeviceActivityCoverageKey,
): number {
  return compareIsoTimestamps(left.triggeredAt, right.triggeredAt)
    || compareIsoTimestamps(left.occurredAt, right.occurredAt)
    || left.entityId.localeCompare(right.entityId)
}

export function deviceActivityCoverageKeyIsAfterCursor(
  key: DeviceActivityCoverageKey,
  cursor: DeviceActivityCoverageCursor,
): boolean {
  const triggeredComparison = compareIsoTimestamps(key.triggeredAt, cursor.after)
  if (triggeredComparison > 0) {
    return true
  }
  if (triggeredComparison < 0) {
    return false
  }

  return cursor.afterEntityIds !== undefined && !cursor.afterEntityIds.includes(key.entityId)
}

export function resolveNextDeviceActivityCoverageCursor(input: {
  cursor: DeviceActivityCoverageCursor
  keys: readonly DeviceActivityCoverageKey[]
}): { after: string; afterEntityIds: string[] } | null {
  const latest = input.keys.reduce<DeviceActivityCoverageKey | null>((candidate, key) => {
    if (!candidate || compareIsoTimestamps(key.triggeredAt, candidate.triggeredAt) > 0) {
      return key
    }
    return candidate
  }, null)
  if (!latest) {
    return null
  }

  const currentIds = latest.triggeredAt === input.cursor.after
    ? input.cursor.afterEntityIds ?? []
    : []
  const processedIds = input.keys
    .filter((key) => key.triggeredAt === latest.triggeredAt)
    .map((key) => key.entityId)
  const afterEntityIds = [...new Set([...currentIds, ...processedIds])].sort()

  if (
    latest.triggeredAt === input.cursor.after &&
    arraysEqual(afterEntityIds, input.cursor.afterEntityIds ?? [])
  ) {
    return null
  }

  return {
    after: latest.triggeredAt,
    afterEntityIds,
  }
}

function compareIsoTimestamps(left: string, right: string): number {
  const leftMs = Date.parse(left)
  const rightMs = Date.parse(right)
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
    return leftMs - rightMs
  }

  return left.localeCompare(right)
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

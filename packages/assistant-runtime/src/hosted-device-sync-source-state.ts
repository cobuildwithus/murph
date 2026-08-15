import { deviceSyncError } from "@murphai/device-syncd/errors";

import type {
  DeviceConnectionSourceResourceAvailabilitySummary,
  DeviceConnectionSourceStatus,
} from "@murphai/device-syncd/types";

export interface HostedDeviceSyncSourceLifecycleState {
  lastDataAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastSeenAt: string;
  resourceAvailabilitySummary?: DeviceConnectionSourceResourceAvailabilitySummary;
  status: DeviceConnectionSourceStatus;
}

export interface HostedDeviceSyncSourceIdentity {
  firstSeenAt?: string | null;
  sourceInstanceKey?: string | null;
  sourceProviderSlug: string;
}

export interface HostedDeviceSyncSourceIdentityState
  extends HostedDeviceSyncSourceIdentity, HostedDeviceSyncSourceLifecycleState {}

export function compareHostedDeviceSyncSourceIdentity(
  left: HostedDeviceSyncSourceIdentity,
  right: HostedDeviceSyncSourceIdentity,
): number {
  const leftFirstSeenRank = parseHostedDeviceSyncSourceIdentityTimestamp(
    left.firstSeenAt,
  );
  const rightFirstSeenRank = parseHostedDeviceSyncSourceIdentityTimestamp(
    right.firstSeenAt,
  );
  return leftFirstSeenRank !== rightFirstSeenRank
    ? leftFirstSeenRank - rightFirstSeenRank
    : (left.sourceInstanceKey ?? "").localeCompare(right.sourceInstanceKey ?? "")
      || left.sourceProviderSlug.localeCompare(right.sourceProviderSlug);
}

export function dedupeHostedDeviceSyncSourcesByIdentity<
  T extends HostedDeviceSyncSourceIdentityState,
>(
  sources: readonly T[],
  areEquivalent: (left: T, right: T) => boolean,
): T[] {
  const deduped: T[] = [];
  for (const source of sources) {
    const existingIndex = deduped.findIndex((candidate) =>
      areEquivalent(candidate, source)
    );
    if (existingIndex === -1) {
      deduped.push(source);
      continue;
    }

    const existing = deduped[existingIndex];
    if (!existing) {
      continue;
    }
    const identitySource = compareHostedDeviceSyncSourceIdentity(source, existing) < 0
      ? source
      : existing;
    const { lastDataAt, lifecycleSource } = consolidateHostedDeviceSyncSourceState([
      existing,
      source,
    ]);
    const consolidated = { ...lifecycleSource };
    consolidated.firstSeenAt = identitySource.firstSeenAt;
    consolidated.lastDataAt = lastDataAt;
    consolidated.sourceProviderSlug = identitySource.sourceProviderSlug;
    if (identitySource.sourceInstanceKey) {
      consolidated.sourceInstanceKey = identitySource.sourceInstanceKey;
    } else {
      delete consolidated.sourceInstanceKey;
    }
    deduped[existingIndex] = consolidated;
  }
  return deduped;
}

export function consolidateHostedDeviceSyncSourceState<
  T extends HostedDeviceSyncSourceLifecycleState,
>(sources: readonly [T, ...T[]]): {
  lastDataAt: string | null;
  lifecycleSource: T;
} {
  let lifecycleSource = sources[0];
  parseHostedDeviceSyncSourceTimestamp(lifecycleSource.lastSeenAt);
  let lastDataAt = mergeHostedDeviceSyncSourceLastDataAt(
    lifecycleSource.lastDataAt,
    null,
  );

  for (const source of sources.slice(1)) {
    const lifecycleComparison = compareHostedDeviceSyncSourceLifecycle(
      source,
      lifecycleSource,
    );
    if (
      lifecycleComparison === 0
      && !haveEqualHostedDeviceSyncSourceLifecycleState(source, lifecycleSource)
    ) {
      throw hostedSourceStateUnavailable();
    }
    if (lifecycleComparison > 0) {
      lifecycleSource = source;
    }
    lastDataAt = mergeHostedDeviceSyncSourceLastDataAt(
      source.lastDataAt,
      lastDataAt,
    );
  }

  return { lastDataAt, lifecycleSource };
}

function compareHostedDeviceSyncSourceLifecycle(
  left: HostedDeviceSyncSourceLifecycleState,
  right: HostedDeviceSyncSourceLifecycleState,
): number {
  return parseHostedDeviceSyncSourceTimestamp(left.lastSeenAt)
    - parseHostedDeviceSyncSourceTimestamp(right.lastSeenAt);
}

export function mergeHostedDeviceSyncSourceLastDataAt(
  left: string | null,
  right: string | null,
): string | null {
  const leftTimestamp = left === null
    ? Number.NEGATIVE_INFINITY
    : parseHostedDeviceSyncSourceTimestamp(left);
  const rightTimestamp = right === null
    ? Number.NEGATIVE_INFINITY
    : parseHostedDeviceSyncSourceTimestamp(right);
  return leftTimestamp > rightTimestamp
    ? left
    : right;
}

function parseHostedDeviceSyncSourceTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw hostedSourceStateUnavailable();
  }
  return timestamp;
}

function parseHostedDeviceSyncSourceIdentityTimestamp(
  value: string | null | undefined,
): number {
  if (value === null || value === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function haveEqualHostedDeviceSyncSourceLifecycleState(
  left: HostedDeviceSyncSourceLifecycleState,
  right: HostedDeviceSyncSourceLifecycleState,
): boolean {
  return left.status === right.status
    && left.lastErrorCode === right.lastErrorCode
    && left.lastErrorMessage === right.lastErrorMessage
    && haveEqualHostedDeviceSyncSourceAvailability(
      left.resourceAvailabilitySummary,
      right.resourceAvailabilitySummary,
    );
}

function haveEqualHostedDeviceSyncSourceAvailability(
  left: DeviceConnectionSourceResourceAvailabilitySummary | undefined,
  right: DeviceConnectionSourceResourceAvailabilitySummary | undefined,
): boolean {
  const serialize = (value: DeviceConnectionSourceResourceAvailabilitySummary | undefined) =>
    JSON.stringify(Object.entries(value ?? {}).sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey)
    ));
  return serialize(left) === serialize(right);
}

export function hostedSourceStateUnavailable(cause?: unknown) {
  return deviceSyncError({
    code: "HOSTED_DEVICE_SYNC_SOURCE_STATE_UNAVAILABLE",
    message: "Current hosted device source state is unavailable. Retry shortly.",
    retryable: true,
    httpStatus: 503,
    ...(cause === undefined ? {} : { cause }),
  });
}

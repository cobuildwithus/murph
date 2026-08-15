import type {
  DeviceConnectionSourceResourceAvailabilitySummary,
  DeviceConnectionSourceStatus,
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncExistingAccountPolicy,
} from "./types.ts";
export const DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE =
  "HISTORICAL_DATA_RECONNECT_REQUIRED";

export const DEVICE_SYNC_HISTORICAL_RESET_REVOKE_FAILED_ERROR_CODE =
  "HISTORICAL_RESET_REVOKE_FAILED";

export const DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE =
  "DISCONNECT_IN_PROGRESS";

export const DEVICE_SYNC_DISCONNECT_RECOVERY_REQUIRED_ERROR_CODE =
  "DISCONNECT_RECOVERY_REQUIRED";

const DEVICE_SYNC_DISCONNECT_RECOVERY_ERROR_CODES = new Set([
  DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_DISCONNECT_RECOVERY_REQUIRED_ERROR_CODE,
  // Keep interpreting legacy rows written before the canonical recovery marker.
  "PROVIDER_REVOKE_FAILED",
  "PROVIDER_REVOKE_NOT_CONFIGURED",
  DEVICE_SYNC_HISTORICAL_RESET_REVOKE_FAILED_ERROR_CODE,
]);

export const DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE =
  "SOURCE_DISCONNECT_IN_PROGRESS";

export const DEVICE_SYNC_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE =
  "SOURCE_START_CLEANUP_IN_PROGRESS";

export const DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE =
  "SOURCE_USER_DISCONNECTED";
export const DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE =
  "SOURCE_PROVIDER_DISCONNECTED";

const DEVICE_SYNC_SOURCE_DISCONNECT_FENCE_CODES = new Set([
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
]);

export function isDeviceSyncSourceDisconnectFenced(source: {
  lastErrorCode?: string | null;
}): boolean {
  return source.lastErrorCode !== null
    && source.lastErrorCode !== undefined
    && DEVICE_SYNC_SOURCE_DISCONNECT_FENCE_CODES.has(source.lastErrorCode);
}

export function isDeviceSyncSourceAdmitted(
  sources: readonly {
    lastErrorCode?: string | null;
    sourceProviderSlug: string;
    status: string;
  }[],
  sourceProviderSlug: string,
): boolean {
  const matchingSources = sources.filter(
    (source) => source.sourceProviderSlug === sourceProviderSlug,
  );

  return matchingSources.length === 0
    || matchingSources.some(
      (source) => source.status === "connected" && !isDeviceSyncSourceDisconnectFenced(source),
    );
}

export interface DeviceSyncSourceIdentity {
  firstSeenAt?: string | null;
  sourceInstanceKey?: string | null;
  sourceProviderSlug: string;
}

export interface DeviceSyncSourceLifecycleState {
  lastDataAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastSeenAt?: string | null;
  resourceAvailabilitySummary?: DeviceConnectionSourceResourceAvailabilitySummary;
  status: DeviceConnectionSourceStatus;
}

export interface ResolvedDeviceSyncSourceState<
  T extends DeviceSyncSourceIdentity & DeviceSyncSourceLifecycleState,
> {
  identitySource: T;
  lastDataAt: string | null;
  lifecycleSource: T;
}

type DeviceSyncSourceStateUnavailable = () => unknown;

export function compareDeviceSyncSourceIdentity(
  left: DeviceSyncSourceIdentity,
  right: DeviceSyncSourceIdentity,
): number {
  const leftFirstSeenRank = parseDeviceSyncSourceIdentityTimestamp(left.firstSeenAt);
  const rightFirstSeenRank = parseDeviceSyncSourceIdentityTimestamp(right.firstSeenAt);
  return leftFirstSeenRank !== rightFirstSeenRank
    ? leftFirstSeenRank - rightFirstSeenRank
    : (left.sourceInstanceKey ?? "").localeCompare(right.sourceInstanceKey ?? "")
      || left.sourceProviderSlug.localeCompare(right.sourceProviderSlug);
}

export function resolveDeviceSyncSourceState<
  T extends DeviceSyncSourceIdentity & DeviceSyncSourceLifecycleState,
>(
  sources: readonly [T, ...T[]],
  unavailable: DeviceSyncSourceStateUnavailable,
): ResolvedDeviceSyncSourceState<T> {
  let identitySource = sources[0];
  let lifecycleSource = sources[0];
  parseDeviceSyncSourceTimestamp(lifecycleSource.lastSeenAt, unavailable);
  let lastDataAt = mergeDeviceSyncSourceLastDataAt(
    lifecycleSource.lastDataAt,
    null,
    unavailable,
  );

  for (const source of sources.slice(1)) {
    if (compareDeviceSyncSourceIdentity(source, identitySource) < 0) {
      identitySource = source;
    }
    const lifecycleComparison = compareDeviceSyncSourceLifecycle(
      source,
      lifecycleSource,
      unavailable,
    );
    if (
      lifecycleComparison === 0
      && !haveEqualDeviceSyncSourceLifecycleState(source, lifecycleSource)
    ) {
      throw unavailable();
    }
    if (lifecycleComparison > 0) {
      lifecycleSource = source;
    }
    lastDataAt = mergeDeviceSyncSourceLastDataAt(
      source.lastDataAt,
      lastDataAt,
      unavailable,
    );
  }

  return { identitySource, lastDataAt, lifecycleSource };
}

export function dedupeDeviceSyncSourcesByIdentity<
  T extends DeviceSyncSourceIdentity & DeviceSyncSourceLifecycleState,
>(
  sources: readonly T[],
  areEquivalent: (left: T, right: T) => boolean,
  unavailable: DeviceSyncSourceStateUnavailable,
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
    const { identitySource, lastDataAt, lifecycleSource } =
      resolveDeviceSyncSourceState([existing, source], unavailable);
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

export function mergeDeviceSyncSourceLastDataAt(
  left: string | null | undefined,
  right: string | null | undefined,
  unavailable: DeviceSyncSourceStateUnavailable,
): string | null {
  const leftTimestamp = left === null || left === undefined
    ? Number.NEGATIVE_INFINITY
    : parseDeviceSyncSourceTimestamp(left, unavailable);
  const rightTimestamp = right === null || right === undefined
    ? Number.NEGATIVE_INFINITY
    : parseDeviceSyncSourceTimestamp(right, unavailable);
  return leftTimestamp > rightTimestamp
    ? left ?? null
    : right ?? null;
}

function compareDeviceSyncSourceLifecycle(
  left: DeviceSyncSourceLifecycleState,
  right: DeviceSyncSourceLifecycleState,
  unavailable: DeviceSyncSourceStateUnavailable,
): number {
  return parseDeviceSyncSourceTimestamp(left.lastSeenAt, unavailable)
    - parseDeviceSyncSourceTimestamp(right.lastSeenAt, unavailable);
}

function parseDeviceSyncSourceTimestamp(
  value: string | null | undefined,
  unavailable: DeviceSyncSourceStateUnavailable,
): number {
  if (typeof value !== "string") {
    throw unavailable();
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw unavailable();
  }
  return timestamp;
}

function parseDeviceSyncSourceIdentityTimestamp(
  value: string | null | undefined,
): number {
  if (value === null || value === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function haveEqualDeviceSyncSourceLifecycleState(
  left: DeviceSyncSourceLifecycleState,
  right: DeviceSyncSourceLifecycleState,
): boolean {
  return left.status === right.status
    && left.lastErrorCode === right.lastErrorCode
    && left.lastErrorMessage === right.lastErrorMessage
    && haveEqualDeviceSyncSourceAvailability(
      left.resourceAvailabilitySummary,
      right.resourceAvailabilitySummary,
    );
}

function haveEqualDeviceSyncSourceAvailability(
  left: DeviceConnectionSourceResourceAvailabilitySummary | undefined,
  right: DeviceConnectionSourceResourceAvailabilitySummary | undefined,
): boolean {
  const serialize = (
    value: DeviceConnectionSourceResourceAvailabilitySummary | undefined,
  ) => JSON.stringify(Object.entries(value ?? {}).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey)
  ));
  return serialize(left) === serialize(right);
}

// Garmin historical exports can only restart after the provider-side connection is
// deregistered. Keep that provider-specific rule beside the durable recovery marker so
// every reader applies the same narrow interpretation.
export function isJunctionHistoricalResetProviderSlug(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "garmin";
}

export function requiresHistoricalResetDeviceSyncSource(source: {
  lastErrorCode?: string | null;
  sourceProviderSlug: string;
  status?: string | null;
}): boolean {
  return source.status === "error"
    && source.lastErrorCode === DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE
    && isJunctionHistoricalResetProviderSlug(source.sourceProviderSlug);
}

// True for a disconnected account whose provider-side revoke failed while a historical
// reset was pending: the member must remove the old connection in the wearable provider
// account before reconnecting. A fresh established connection clears the code.
export function isHistoricalResetIncompleteDeviceSyncAccount(account: {
  lastErrorCode?: string | null;
  status?: string | null;
}): boolean {
  return account.status === "disconnected"
    && account.lastErrorCode === DEVICE_SYNC_HISTORICAL_RESET_REVOKE_FAILED_ERROR_CODE;
}

export function isEstablishedDeviceSyncConnection(connection: {
  setupPhase?: string | null;
  status?: string | null;
}): boolean {
  return connection.status === "active" && isDeviceSyncConnectionSetupConfirmed(connection);
}

export function shouldPreserveEstablishedDeviceSyncConnection(
  connection: {
    setupPhase?: string | null;
    status?: string | null;
  } | null,
  policy: UpsertPublicDeviceSyncExistingAccountPolicy,
): boolean {
  return policy === "preserve_established"
    && connection !== null
    && isEstablishedDeviceSyncConnection(connection);
}

export function isDeviceSyncDisconnectInProgress(connection: {
  lastErrorCode?: string | null;
  status?: string | null;
}): boolean {
  return connection.status === "reauthorization_required"
    && connection.lastErrorCode === DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE;
}

export function isDeviceSyncDisconnectRecoveryRequired(connection: {
  lastErrorCode?: string | null;
  status?: string | null;
}): boolean {
  return connection.status === "reauthorization_required"
    && typeof connection.lastErrorCode === "string"
    && DEVICE_SYNC_DISCONNECT_RECOVERY_ERROR_CODES.has(
      connection.lastErrorCode,
    );
}

export function isDeviceSyncConnectionSetupConfirmed(connection: {
  setupPhase?: string | null;
}): boolean {
  return connection.setupPhase === "source_confirmed";
}

export function isDeviceSyncConnectionSetupPending(connection: {
  setupPhase?: string | null;
}): boolean {
  return connection.setupPhase === "pending_link"
    || connection.setupPhase === "link_returned";
}

// Provider/account metadata can include raw profile payloads, body measurements, or
// other operator-supplied diagnostics that should not leak through outward-facing
// control-plane responses. Keep the public account surface intentionally minimal.
export function redactPublicDeviceSyncMetadata(
  _metadata: Record<string, unknown> | null | undefined,
): Record<string, never> {
  return {};
}

export function toRedactedPublicDeviceSyncAccount(
  account: PublicDeviceSyncAccount,
): PublicDeviceSyncAccount {
  return {
    ...account,
    metadata: redactPublicDeviceSyncMetadata(account.metadata),
  } satisfies PublicDeviceSyncAccount;
}

export { sanitizeStoredDeviceSyncMetadata } from "./metadata.ts";

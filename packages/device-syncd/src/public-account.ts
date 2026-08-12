import type {
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncExistingAccountPolicy,
} from "./types.ts";

export const DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE =
  "HISTORICAL_DATA_RECONNECT_REQUIRED";

export const DEVICE_SYNC_HISTORICAL_RESET_REVOKE_FAILED_ERROR_CODE =
  "HISTORICAL_RESET_REVOKE_FAILED";

export const DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE =
  "DISCONNECT_IN_PROGRESS";

export const DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE =
  "SOURCE_DISCONNECT_IN_PROGRESS";

export const DEVICE_SYNC_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE =
  "SOURCE_START_CLEANUP_IN_PROGRESS";

export const DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE =
  "SOURCE_USER_DISCONNECTED";

export const DEVICE_SYNC_SOURCE_HISTORICAL_BACKFILL_COMPLETED_AT_KEY =
  "historicalBackfillCompletedAt";

export const DEVICE_SYNC_GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED_ERROR_CODE =
  "GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED";

const DEVICE_SYNC_SOURCE_RESOURCE_AVAILABILITY_METADATA_KEYS = new Set([
  DEVICE_SYNC_SOURCE_HISTORICAL_BACKFILL_COMPLETED_AT_KEY,
  "sourceInstanceKeyFallback",
]);

const DEVICE_SYNC_SOURCE_DISCONNECT_FENCE_CODES = new Set([
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE,
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

export function isDeviceSyncSourceHistoricalBackfillComplete(source: {
  firstSeenAt?: string | null;
  resourceAvailabilitySummary?: Record<string, unknown> | null;
}): boolean {
  const completedAt = source.resourceAvailabilitySummary?.[
    DEVICE_SYNC_SOURCE_HISTORICAL_BACKFILL_COMPLETED_AT_KEY
  ];
  if (typeof completedAt !== "string" || !source.firstSeenAt) {
    return false;
  }

  const completedAtMs = Date.parse(completedAt);
  const firstSeenAtMs = Date.parse(source.firstSeenAt);
  return Number.isFinite(completedAtMs)
    && Number.isFinite(firstSeenAtMs)
    && completedAtMs >= firstSeenAtMs;
}

export function isDeviceSyncSourceResourceAvailabilityMetadataKey(
  key: string,
): boolean {
  return DEVICE_SYNC_SOURCE_RESOURCE_AVAILABILITY_METADATA_KEYS.has(key);
}

export function countAvailableDeviceSyncSourceResources(
  summary: Record<string, unknown> | null | undefined,
): number {
  return Object.entries(summary ?? {}).filter(([key, value]) =>
    isAvailableDeviceSyncSourceResource(key, value)
  ).length;
}

export function isAvailableDeviceSyncSourceResource(
  key: string,
  value: unknown,
): boolean {
  return !isDeviceSyncSourceResourceAvailabilityMetadataKey(key)
    && value !== false
    && value !== null
    && value !== undefined;
}

export function isGoogleHealthFitbitMigrationSuccessorReady(input: {
  firstSeenAt?: string | null;
  historicalBackfillComplete: boolean;
  lastDataAt?: string | null;
  resourceCount: number;
  status: string;
}): boolean {
  if (
    input.status !== "connected"
    || !input.historicalBackfillComplete
    || input.resourceCount <= 0
    || !input.firstSeenAt
    || !input.lastDataAt
  ) {
    return false;
  }

  const firstSeenAtMs = Date.parse(input.firstSeenAt);
  const lastDataAtMs = Date.parse(input.lastDataAt);
  return Number.isFinite(firstSeenAtMs)
    && Number.isFinite(lastDataAtMs)
    && lastDataAtMs > firstSeenAtMs;
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

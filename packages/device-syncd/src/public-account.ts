import type { PublicDeviceSyncAccount } from "./types.ts";

export const DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE =
  "HISTORICAL_DATA_RECONNECT_REQUIRED";

export const DEVICE_SYNC_HISTORICAL_RESET_REVOKE_FAILED_ERROR_CODE =
  "HISTORICAL_RESET_REVOKE_FAILED";

export const DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE =
  "DISCONNECT_IN_PROGRESS";

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

export { sanitizeStoredDeviceSyncMetadata } from "./shared.ts";

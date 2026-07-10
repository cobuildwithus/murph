import type { PublicDeviceSyncAccount } from "./types.ts";

export const DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE =
  "HISTORICAL_DATA_RECONNECT_REQUIRED";

export const DEVICE_SYNC_HISTORICAL_RESET_REVOKE_FAILED_ERROR_CODE =
  "HISTORICAL_RESET_REVOKE_FAILED";

// A Junction historical export can only restart after the provider-side connection is
// deregistered, so recovery state rides the existing durable error-code scalars. These
// predicates are the single reading of that state for the disconnect path and the
// browser/settings projections.
export function requiresHistoricalResetDeviceSyncSource(source: {
  lastErrorCode?: string | null;
  status?: string | null;
}): boolean {
  return source.status === "error"
    && source.lastErrorCode === DEVICE_SYNC_HISTORICAL_DATA_RECONNECT_REQUIRED_ERROR_CODE;
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

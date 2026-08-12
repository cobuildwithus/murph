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

export const DEVICE_SYNC_EXISTING_CONNECTION_RECOVERY_SOURCE_ERROR_CODES = [
  "TOKEN_REFRESH_FAILED",
] as const;

const DEVICE_SYNC_EXISTING_CONNECTION_RECOVERY_SOURCE_ERROR_CODE_SET =
  new Set<string>(DEVICE_SYNC_EXISTING_CONNECTION_RECOVERY_SOURCE_ERROR_CODES);

export type DeviceSyncExistingConnectionRecoveryReason =
  | "account_reauthorization"
  | "newer_sync_error"
  | "source_token_refresh_failed";

export function resolveDeviceSyncExistingConnectionRecoveryReason(input: {
  connection: {
    lastErrorCode?: string | null;
    lastSyncCompletedAt?: string | null;
    lastSyncErrorAt?: string | null;
    setupPhase?: string | null;
    status?: string | null;
  };
  source: {
    lastErrorCode?: string | null;
    status?: string | null;
  } | null;
}): DeviceSyncExistingConnectionRecoveryReason | null {
  if (
    !isDeviceSyncConnectionSetupConfirmed(input.connection)
    || !input.source
    || input.source.status === "disconnected"
  ) {
    return null;
  }

  if (
    input.connection.status === "reauthorization_required"
    && input.connection.lastErrorCode
      !== DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE
  ) {
    return "account_reauthorization";
  }

  if (input.connection.status !== "active") {
    return null;
  }

  if (
    input.source.status === "error"
    && typeof input.source.lastErrorCode === "string"
    && DEVICE_SYNC_EXISTING_CONNECTION_RECOVERY_SOURCE_ERROR_CODE_SET.has(
      input.source.lastErrorCode,
    )
  ) {
    return "source_token_refresh_failed";
  }

  return isDeviceSyncTimestampNewer(
      input.connection.lastSyncErrorAt,
      input.connection.lastSyncCompletedAt,
    )
    ? "newer_sync_error"
    : null;
}

function isDeviceSyncTimestampNewer(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  return !Number.isNaN(leftTime)
    && (Number.isNaN(rightTime) || leftTime > rightTime);
}

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

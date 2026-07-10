import type { PublicDeviceSyncAccount } from "./types.ts";

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

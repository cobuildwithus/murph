/** Maximum serialized request for one complete vault-share projection. */
export const HOSTED_VAULT_SHARE_SERIALIZED_PROJECTION_MAX_BYTES = 4 * 1024 * 1024;
export const HOSTED_VAULT_SHARE_SINGLE_SOURCE_MAX_RECORDS = 8;
export const HOSTED_VAULT_SHARE_DATA_SOURCE_MAX_SOURCES = 8;
export const HOSTED_VAULT_SHARE_DEFAULT_HISTORY_DAYS = 90;
// Complete source/date results only. The independent byte ceiling still rejects
// an oversized projection as a whole; it never silently drops observations.
export const HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS =
  HOSTED_VAULT_SHARE_DEFAULT_HISTORY_DAYS * HOSTED_VAULT_SHARE_DATA_SOURCE_MAX_SOURCES;
export const HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS = 15_000;
export const HOSTED_VAULT_SHARE_DELIVERY_TRANSPORT_MARGIN_MS = 5_000;
export const HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER =
  "x-hosted-vault-share-effect-deadline-epoch-ms";

export function parseHostedVaultShareEffectDeadlineAtEpochMs(
  value: string | null,
): number {
  if (!value || !/^\d{13}$/u.test(value)) {
    throw new TypeError("Hosted vault-share effect deadline header is invalid.");
  }
  const deadlineAtEpochMs = Number(value);
  if (!Number.isSafeInteger(deadlineAtEpochMs)) {
    throw new TypeError("Hosted vault-share effect deadline header is invalid.");
  }
  return deadlineAtEpochMs;
}

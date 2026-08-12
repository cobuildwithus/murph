export const HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS = 8;
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

import { normalizeNullableString } from "./shared";

const ETHEREUM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function coerceHostedWalletAddress(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value);

  if (!normalized || !ETHEREUM_ADDRESS_PATTERN.test(normalized)) {
    return null;
  }

  return normalized.toLowerCase();
}

export function normalizeHostedWalletAddress(value: string | null | undefined): string | null {
  return coerceHostedWalletAddress(value);
}

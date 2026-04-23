import { CONTRACT_ID_FORMAT, ID_PREFIXES } from "./constants.ts";

export const ULID_BODY_LENGTH = 26 as const;
export const ULID_BODY_PATTERN = "[0-9A-HJKMNP-TV-Z]{26}" as const;
export const ULID_BODY_REGEX = new RegExp(`^${ULID_BODY_PATTERN}$`);
export const GENERIC_CONTRACT_ID_PATTERN = `^(?:${Object.values(ID_PREFIXES).join("|")})_${ULID_BODY_PATTERN}$`;
export const GENERIC_CONTRACT_ID_REGEX = new RegExp(GENERIC_CONTRACT_ID_PATTERN);

const CROCKFORD_BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function idPattern(prefix: string): string {
  return `^${prefix}_${ULID_BODY_PATTERN}$`;
}

export function contractIdMaxLength(prefix: string): number {
  return prefix.length + 1 + ULID_BODY_LENGTH;
}

export function generateUlid(now = Date.now()): string {
  return `${encodeCrockfordBase32(now, 10)}${encodeRandomCrockfordBase32(16)}`;
}

export function generateContractId(prefix: string, now = Date.now()): string {
  return `${prefix}_${generateUlid(now)}`;
}

export function isContractId(value: unknown, prefix?: string): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const pattern = prefix ? idPattern(prefix) : GENERIC_CONTRACT_ID_PATTERN;
  return new RegExp(pattern).test(value);
}

export function assertContractId(value: unknown, prefix?: string, fieldName = "id"): string {
  if (!isContractId(value, prefix)) {
    const detail = prefix ? `${prefix}_<ULID>` : `${CONTRACT_ID_FORMAT}`;
    throw new TypeError(`${fieldName} must match ${detail}`);
  }

  return value as string;
}

function encodeCrockfordBase32(value: number, length: number): string {
  let remainder = value;
  let encoded = "";

  do {
    encoded = CROCKFORD_BASE32_ALPHABET[remainder % 32] + encoded;
    remainder = Math.floor(remainder / 32);
  } while (remainder > 0);

  return encoded.padStart(length, "0").slice(-length);
}

function encodeRandomCrockfordBase32(length: number): string {
  const bytes = randomCryptoBytes(length);
  let encoded = "";

  for (const byte of bytes) {
    encoded += CROCKFORD_BASE32_ALPHABET[byte % 32];
    if (encoded.length === length) {
      break;
    }
  }

  return encoded;
}

function randomCryptoBytes(length: number): Uint8Array {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Web Crypto getRandomValues is unavailable.");
  }

  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

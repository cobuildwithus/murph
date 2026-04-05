const BASE64_CANONICAL_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_LENGTH_BYTES = 32;

export function encodeBase64(input: Uint8Array): string {
  return Buffer.from(input).toString("base64");
}

export function decodeBase64(input: string): Uint8Array {
  return decodeStrictBase64(input, "Hosted execution payload must be valid base64.");
}

export function decodeBase64Key(input: string): Uint8Array {
  try {
    const decoded = decodeBase64(normalizeBase64Url(input));

    if (decoded.byteLength !== HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_LENGTH_BYTES) {
      throw new TypeError("invalid-length");
    }

    return decoded;
  } catch {
    throw new TypeError(
      "Hosted execution platform envelope keys must be valid 32-byte base64 or base64url values.",
    );
  }
}

function normalizeBase64Url(input: string): string {
  const normalized = input.trim().replace(/-/gu, "+").replace(/_/gu, "/");
  const remainder = normalized.length % 4;

  if (remainder === 0) {
    return normalized;
  }

  return normalized.padEnd(normalized.length + (4 - remainder), "=");
}

function decodeStrictBase64(input: string, errorMessage: string): Uint8Array {
  const normalized = input.trim();

  if (
    normalized.length === 0
    || normalized.length % 4 !== 0
    || !BASE64_CANONICAL_PATTERN.test(normalized)
  ) {
    throw new TypeError(errorMessage);
  }

  const decoded = Buffer.from(normalized, "base64");
  if (decoded.toString("base64") !== normalized) {
    throw new TypeError(errorMessage);
  }

  return Uint8Array.from(decoded);
}

export function encodeBase64(input: Uint8Array): string {
  return Buffer.from(input).toString("base64");
}

export function decodeBase64(input: string): Uint8Array {
  return Uint8Array.from(Buffer.from(input, "base64"));
}

export function decodeBase64Key(input: string): Uint8Array {
  try {
    return decodeBase64(normalizeBase64Url(input));
  } catch {
    throw new TypeError("Hosted execution bundle encryption keys must be valid base64 or base64url.");
  }
}

function normalizeBase64Url(input: string): string {
  const normalized = input.replace(/-/gu, "+").replace(/_/gu, "/");
  const remainder = normalized.length % 4;

  if (remainder === 0) {
    return normalized;
  }

  return normalized.padEnd(normalized.length + (4 - remainder), "=");
}

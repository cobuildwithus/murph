const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type RandomByteSource = (length: number) => Uint8Array;

export function encodeCrockford(value: number, length: number): string {
  let remainder = value;
  let encoded = "";

  do {
    encoded = CROCKFORD[remainder % 32] + encoded;
    remainder = Math.floor(remainder / 32);
  } while (remainder > 0);

  return encoded.padStart(length, "0").slice(-length);
}

export function encodeRandomCrockford(
  length: number,
  randomByteSource: RandomByteSource = randomCryptoBytes,
): string {
  const bytes = randomByteSource(length);
  let encoded = "";

  for (const byte of bytes) {
    encoded += CROCKFORD[byte % 32];
    if (encoded.length === length) {
      break;
    }
  }

  return encoded.slice(0, length);
}

export function generateUlid(
  now = Date.now(),
  randomByteSource: RandomByteSource = randomCryptoBytes,
): string {
  return `${encodeCrockford(now, 10)}${encodeRandomCrockford(16, randomByteSource)}`;
}

function randomCryptoBytes(length: number): Uint8Array {
  if (typeof crypto?.getRandomValues !== "function") {
    throw new Error("Web Crypto getRandomValues is unavailable.");
  }

  return crypto.getRandomValues(new Uint8Array(length));
}

import { timingSafeEqual } from "node:crypto";

import { HOSTED_EXECUTION_SIGNATURE_HEADER, HOSTED_EXECUTION_TIMESTAMP_HEADER } from "@healthybob/runtime-state";

const HMAC_ALGORITHM = "HMAC";
const HMAC_HASH = "SHA-256";

export async function createHostedExecutionSignature(input: {
  payload: string;
  secret: string;
  timestamp: string;
}): Promise<string> {
  const cryptoKey = await importHmacKey(input.secret);
  const signature = await crypto.subtle.sign(
    HMAC_ALGORITHM,
    cryptoKey,
    new TextEncoder().encode(`${input.timestamp}.${input.payload}`),
  );

  return Buffer.from(signature).toString("hex");
}

export async function verifyHostedExecutionSignature(input: {
  payload: string;
  secret: string;
  signature: string | null;
  timestamp: string | null;
}): Promise<boolean> {
  if (!input.signature || !input.timestamp) {
    return false;
  }

  const expected = await createHostedExecutionSignature({
    payload: input.payload,
    secret: input.secret,
    timestamp: input.timestamp,
  });

  return timingSafeHexEqual(expected, normalizeHex(input.signature));
}

export function readHostedExecutionSignatureHeaders(headers: Headers): {
  signature: string | null;
  timestamp: string | null;
} {
  return {
    signature: headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER),
    timestamp: headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER),
  };
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      hash: HMAC_HASH,
      name: HMAC_ALGORITHM,
    },
    false,
    ["sign"],
  );
}

function normalizeHex(value: string): string {
  return value.trim().replace(/^sha256=/iu, "").toLowerCase();
}

function timingSafeHexEqual(left: string, right: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
  } catch {
    return false;
  }
}

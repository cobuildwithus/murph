import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

import { hostedOnboardingError } from "../hosted-onboarding/errors";

const RETELL_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1_000;
const RETELL_SIGNATURE_PATTERN = /^v=(\d+),d=([a-f0-9]+)$/iu;

export function verifyRetellSignature(input: {
  apiKey?: string | null;
  now?: Date;
  rawBody: string;
  signature: string | null;
}): void {
  const apiKey = input.apiKey?.trim() || process.env.RETELL_API_KEY?.trim();
  if (!apiKey) {
    throw hostedOnboardingError({
      code: "RETELL_SIGNATURE_API_KEY_REQUIRED",
      httpStatus: 500,
      message: "Retell signature verification is not configured.",
      retryable: true,
    });
  }

  const parsed = parseRetellSignatureHeader(input.signature);
  const nowMs = (input.now ?? new Date()).getTime();
  if (Math.abs(nowMs - parsed.timestampMs) > RETELL_SIGNATURE_MAX_AGE_MS) {
    throw invalidRetellSignatureError();
  }

  const expectedDigest = createHmac("sha256", apiKey)
    .update(`${input.rawBody}${parsed.timestamp}`)
    .digest("hex");
  if (!safeEqualHex(expectedDigest, parsed.digest)) {
    throw invalidRetellSignatureError();
  }
}

function parseRetellSignatureHeader(signature: string | null): {
  digest: string;
  timestamp: string;
  timestampMs: number;
} {
  const match = signature?.trim().match(RETELL_SIGNATURE_PATTERN);
  if (!match) {
    throw invalidRetellSignatureError();
  }

  const timestamp = match[1]!;
  const timestampMs = Number.parseInt(timestamp, 10);
  if (!Number.isSafeInteger(timestampMs)) {
    throw invalidRetellSignatureError();
  }

  return {
    digest: match[2]!.toLowerCase(),
    timestamp,
    timestampMs,
  };
}

function safeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.byteLength === rightBuffer.byteLength
    && timingSafeEqual(leftBuffer, rightBuffer);
}

function invalidRetellSignatureError(): Error {
  return hostedOnboardingError({
    code: "RETELL_SIGNATURE_INVALID",
    httpStatus: 401,
    message: "Invalid Retell signature.",
  });
}

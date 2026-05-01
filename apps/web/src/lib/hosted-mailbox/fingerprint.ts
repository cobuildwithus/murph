import { createHmac } from "node:crypto";

import { normalizeNullableString } from "../primitives";

const HOSTED_MAILBOX_FINGERPRINT_KEY_BYTES = 32;

export function hashHostedMailboxStoredPayload(input: {
  serialized: string;
  userId: string;
}): string {
  const key = readHostedMailboxFingerprintKey();
  return `hmac-sha256:${createHmac("sha256", key)
    .update("murph.hosted-mailbox-payload-fingerprint.v1", "utf8")
    .update("\0", "utf8")
    .update(input.userId, "utf8")
    .update("\0", "utf8")
    .update(input.serialized, "utf8")
    .digest("base64url")}`;
}

function readHostedMailboxFingerprintKey(): Buffer {
  const encoded = normalizeNullableString(process.env.HOSTED_MAILBOX_FINGERPRINT_KEY);
  if (!encoded) {
    throw new TypeError("HOSTED_MAILBOX_FINGERPRINT_KEY must be configured for hosted mailbox payload fingerprinting.");
  }
  const decoded = decodeHostedMailboxFingerprintKey(encoded);
  if (decoded.byteLength !== HOSTED_MAILBOX_FINGERPRINT_KEY_BYTES) {
    throw new TypeError("HOSTED_MAILBOX_FINGERPRINT_KEY must decode to exactly 32 bytes.");
  }
  return decoded;
}

function decodeHostedMailboxFingerprintKey(value: string): Buffer {
  const normalized = value.trim();
  if (/^[0-9a-f]{64}$/iu.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }
  const base64 = normalized.replace(/-/gu, "+").replace(/_/gu, "/");
  return Buffer.from(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="), "base64");
}

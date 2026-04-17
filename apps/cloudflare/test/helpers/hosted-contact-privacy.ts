import { createHmac } from "node:crypto";

const TEST_HOSTED_PRIVACY_VERSION = "v1";
const HOSTED_BLIND_INDEX_PREFIX = "hbidx";
const TEST_HOSTED_PRIVACY_ROOT_KEY = Buffer.from(
  "vitest-hosted-contact-privacy-root-key",
  "utf8",
);

export function createHostedPhoneLookupKey(value: string | null | undefined): string | null {
  const normalized = normalizePhoneNumber(value);

  if (!normalized) {
    return null;
  }

  const version = TEST_HOSTED_PRIVACY_VERSION;
  const digest = createHmac("sha256", deriveHostedPrivacyKey(`blind-index:phone`, version))
    .update(normalized)
    .digest("hex");

  return `${HOSTED_BLIND_INDEX_PREFIX}:phone:${version}:${digest}`;
}

function deriveHostedPrivacyKey(purpose: string, version: string): Buffer {
  return createHmac("sha256", TEST_HOSTED_PRIVACY_ROOT_KEY)
    .update(`hosted-contact-privacy:${version}:${purpose}`)
    .digest();
}

function normalizePhoneNumber(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const compact = trimmed.replace(/[\s().-]+/gu, "");
  const prefixed = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;

  if (/^\+[1-9]\d{6,14}$/u.test(prefixed)) {
    return prefixed;
  }

  if (/^[1-9]\d{6,14}$/u.test(prefixed)) {
    return `+${prefixed}`;
  }

  return null;
}

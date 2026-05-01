import { createHmac, hkdfSync } from "node:crypto";

import { normalizeNullableString } from "./shared";

const BLIND_INDEX_PREFIX = "hbdi";
const HOSTED_DEVICE_ROUTING_INDEX_SCOPE_SALT = Buffer.from(
  "murph.hosted.device-sync.secret.v1",
  "utf8",
);
const BASE64_CANONICAL_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export function decodeHostedDeviceRoutingIndexKey(value: string): Buffer {
  const normalized = value.trim();

  if (!normalized) {
    throw new TypeError("Hosted device routing index key must not be empty.");
  }

  if (/^[0-9a-f]{64}$/iu.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  const decoded = decodeStrictHostedBase64(
    normalizeHostedBase64(normalized),
    "Hosted device routing index key must decode to exactly 32 bytes (hex or base64/base64url).",
  );

  if (decoded.length !== 32) {
    throw new TypeError(
      "Hosted device routing index key must decode to exactly 32 bytes (hex or base64/base64url).",
    );
  }

  return decoded;
}

export function buildHostedProviderAccountBlindIndex(input: {
  key: Buffer;
  provider: string;
  externalAccountId: string;
}): string {
  if (input.key.length !== 32) {
    throw new TypeError("Hosted provider account blind-index keys must be 32 bytes.");
  }

  const normalizedProvider = normalizeNullableString(input.provider)?.toLowerCase();
  const normalizedExternalAccountId = normalizeNullableString(input.externalAccountId);

  if (!normalizedProvider || !normalizedExternalAccountId) {
    throw new TypeError("Hosted provider account blind indexes require a provider and external account id.");
  }

  return `${BLIND_INDEX_PREFIX}_${createHmac(
    "sha256",
    deriveHostedDeviceRoutingIndexScopeKey(input.key, "device-sync-provider-account-blind-index"),
  )
    .update(normalizedProvider, "utf8")
    .update(":", "utf8")
    .update(normalizedExternalAccountId, "utf8")
    .digest("base64url")}`;
}

function deriveHostedDeviceRoutingIndexScopeKey(
  rootKey: Buffer,
  keyScope: string,
): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      rootKey,
      HOSTED_DEVICE_ROUTING_INDEX_SCOPE_SALT,
      Buffer.from(keyScope, "utf8"),
      32,
    ),
  );
}

function normalizeHostedBase64(value: string): string {
  const normalized = value.trim().replace(/-/gu, "+").replace(/_/gu, "/");
  const remainder = normalized.length % 4;

  if (remainder === 0) {
    return normalized;
  }

  return normalized.padEnd(normalized.length + (4 - remainder), "=");
}

function decodeStrictHostedBase64(value: string, errorMessage: string): Buffer {
  const normalized = value.trim();

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

  return decoded;
}

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

import { normalizeNullableString } from "../src/lib/device-sync/shared";

const ENCRYPTED_SECRET_PREFIX = "hbds";
const BLIND_INDEX_PREFIX = "hbdi";
const AES_256_GCM = "aes-256-gcm";
const GCM_IV_BYTES = 12;
const HOSTED_SECRET_SCOPE_SALT = Buffer.from("murph.hosted.device-sync.secret.v1", "utf8");
const GCM_AUTH_TAG_BYTES = 16;
const BASE64_CANONICAL_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const BASE64URL_CANONICAL_PATTERN = /^[A-Za-z0-9_-]*$/u;

export interface HostedSecretCipherOptions {
  aad?: Buffer | Uint8Array | string;
  keyScope?: string;
}

export interface HostedSecretCodec {
  readonly keyVersion: string;
  encrypt(value: string, options?: HostedSecretCipherOptions): string;
  decrypt(payload: string, options?: HostedSecretCipherOptions): string;
}

export function decodeHostedEncryptionKey(value: string): Buffer {
  const normalized = value.trim();

  if (!normalized) {
    throw new TypeError("Hosted encryption key must not be empty.");
  }

  if (/^[0-9a-f]{64}$/iu.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  const base64Decoded = decodeStrictHostedBase64(
    normalizeHostedBase64(normalized),
    "Hosted encryption key must decode to exactly 32 bytes (hex or base64/base64url).",
  );

  if (base64Decoded.length === 32) {
    return base64Decoded;
  }

  throw new TypeError(
    "Hosted encryption key must decode to exactly 32 bytes (hex or base64/base64url).",
  );
}

export function decodeHostedEncryptionKeyring(input: {
  currentKey: Buffer;
  currentKeyVersion: string;
  keyringJson: string | null;
  label: string;
}): Readonly<Record<string, Buffer>> {
  const keysByVersion: Record<string, Buffer> = {};

  if (input.keyringJson) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(input.keyringJson);
    } catch (error) {
      throw new TypeError(
        `${input.label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError(`${input.label} must be a JSON object keyed by key version.`);
    }

    for (const [rawVersion, encodedKey] of Object.entries(parsed)) {
      const keyVersion = normalizeNullableString(rawVersion);

      if (!keyVersion) {
        throw new TypeError(`${input.label} contains a blank key version.`);
      }

      if (typeof encodedKey !== "string" || encodedKey.trim().length === 0) {
        throw new TypeError(`${input.label} entry ${keyVersion} must be a non-empty encoded key.`);
      }

      keysByVersion[keyVersion] = decodeHostedEncryptionKey(encodedKey);
    }
  }

  const configuredCurrentKey = keysByVersion[input.currentKeyVersion];

  if (!configuredCurrentKey) {
    keysByVersion[input.currentKeyVersion] = input.currentKey;
  } else if (!sameBytes(configuredCurrentKey, input.currentKey)) {
    throw new TypeError(
      `${input.label} entry ${input.currentKeyVersion} must match the current encryption key.`,
    );
  }

  return keysByVersion;
}

export function buildHostedSecretAad(
  fields: Readonly<Record<string, string | number | boolean | null | undefined>>,
): Buffer {
  const canonical = Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value ?? null]),
  );

  return Buffer.from(JSON.stringify(canonical), "utf8");
}



export function buildHostedConnectionTokenCipherOptions(input: {
  connectionId: string;
  provider: string;
  purpose:
    | "device-sync-access-token"
    | "device-sync-refresh-token"
    | "device-sync-external-account-id";
}): HostedSecretCipherOptions {
  return {
    aad: buildHostedSecretAad({
      connectionId: input.connectionId,
      provider: input.provider,
      purpose: input.purpose,
    }),
    keyScope: input.purpose,
  } satisfies HostedSecretCipherOptions;
}

export function buildHostedProviderAccountBlindIndex(input: {
  key: Buffer;
  provider: string;
  externalAccountId: string;
}): string {
  const normalizedProvider = normalizeNullableString(input.provider)?.toLowerCase();
  const normalizedExternalAccountId = normalizeNullableString(input.externalAccountId);

  if (!normalizedProvider || !normalizedExternalAccountId) {
    throw new TypeError("Hosted provider account blind indexes require a provider and external account id.");
  }

  return `${BLIND_INDEX_PREFIX}_${createHmac(
    "sha256",
    deriveHostedSecretScopeKey(input.key, "device-sync-provider-account-blind-index"),
  )
    .update(normalizedProvider, "utf8")
    .update(":", "utf8")
    .update(normalizedExternalAccountId, "utf8")
    .digest("base64url")}`;
}

export function createHostedSecretCodec(input: {
  key: Buffer;
  keyVersion: string;
  keysByVersion?: Readonly<Record<string, Buffer>>;
}): HostedSecretCodec {
  if (input.key.length !== 32) {
    throw new TypeError("Hosted encryption keys must be 32 bytes.");
  }

  const keyVersion = normalizeNullableString(input.keyVersion);

  if (!keyVersion) {
    throw new TypeError("Hosted encryption key version must not be empty.");
  }

  const configuredKeysByVersion = {
    ...(input.keysByVersion ?? {}),
    [keyVersion]: input.key,
  } satisfies Record<string, Buffer>;

  for (const [configuredVersion, key] of Object.entries(configuredKeysByVersion)) {
    if (key.length !== 32) {
      throw new TypeError(`Hosted encryption key ${configuredVersion} must be 32 bytes.`);
    }
  }

  return {
    keyVersion,
    encrypt(value: string, options?: HostedSecretCipherOptions): string {
      const plaintext = Buffer.from(value, "utf8");
      const iv = randomBytes(GCM_IV_BYTES);
      const cipher = createCipheriv(
        AES_256_GCM,
        deriveHostedSecretScopeKey(input.key, options?.keyScope),
        iv,
      );
      const aad = normalizeHostedSecretAad(options?.aad);

      if (aad) {
        cipher.setAAD(aad);
      }

      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [
        ENCRYPTED_SECRET_PREFIX,
        keyVersion,
        iv.toString("base64url"),
        tag.toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(":");
    },
    decrypt(payload: string, options?: HostedSecretCipherOptions): string {
      const parts = payload.split(":");

      if (parts.length !== 5) {
        throw new TypeError("Encrypted hosted secret payload is malformed.");
      }

      const [prefix, payloadKeyVersion, ivText, tagText, ciphertextText] = parts;

      if (
        prefix !== ENCRYPTED_SECRET_PREFIX
        || !payloadKeyVersion
        || !ivText
        || !tagText
        || ciphertextText === undefined
      ) {
        throw new TypeError("Encrypted hosted secret payload is malformed.");
      }

      const key = configuredKeysByVersion[payloadKeyVersion];

      if (!key) {
        throw new TypeError(`Encrypted hosted secret payload references unknown key version ${payloadKeyVersion}.`);
      }

      const aad = normalizeHostedSecretAad(options?.aad);
      const keyScope = normalizeHostedSecretKeyScope(options?.keyScope);

      if (!keyScope) {
        return decryptHostedSecretPayload({
          aad,
          ciphertextText,
          ivText,
          key,
          tagText,
        });
      }

      return decryptHostedSecretPayload({
        aad,
        ciphertextText,
        ivText,
        key: deriveHostedSecretScopeKey(key, keyScope),
        tagText,
      });
    },
  };
}

function normalizeHostedSecretAad(value: Buffer | Uint8Array | string | null | undefined): Buffer | null {
  if (typeof value === "string") {
    return value.length > 0 ? Buffer.from(value, "utf8") : null;
  }

  if (Buffer.isBuffer(value)) {
    return value.byteLength > 0 ? value : null;
  }

  if (value instanceof Uint8Array) {
    return value.byteLength > 0 ? Buffer.from(value) : null;
  }

  return null;
}

function normalizeHostedSecretKeyScope(value: string | null | undefined): string | null {
  return normalizeNullableString(value);
}

function deriveHostedSecretScopeKey(rootKey: Buffer, keyScope: string | null | undefined): Buffer {
  const normalizedScope = normalizeHostedSecretKeyScope(keyScope);

  if (!normalizedScope) {
    return rootKey;
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      rootKey,
      HOSTED_SECRET_SCOPE_SALT,
      Buffer.from(normalizedScope, "utf8"),
      32,
    ),
  );
}

function decryptHostedSecretPayload(input: {
  aad: Buffer | null;
  ciphertextText: string;
  ivText: string;
  key: Buffer;
  tagText: string;
}): string {
  const iv = decodeStrictHostedBase64Url(
    input.ivText,
    "Encrypted hosted secret payload is malformed.",
  );
  const authTag = decodeStrictHostedBase64Url(
    input.tagText,
    "Encrypted hosted secret payload is malformed.",
  );

  if (iv.byteLength !== GCM_IV_BYTES || authTag.byteLength !== GCM_AUTH_TAG_BYTES) {
    throw new TypeError("Encrypted hosted secret payload is malformed.");
  }

  const decipher = createDecipheriv(
    AES_256_GCM,
    input.key,
    iv,
  );

  if (input.aad) {
    decipher.setAAD(input.aad);
  }

  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(
      decodeStrictHostedBase64Url(
        input.ciphertextText,
        "Encrypted hosted secret payload is malformed.",
      ),
    ),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
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

function decodeStrictHostedBase64Url(value: string, errorMessage: string): Buffer {
  if (!BASE64URL_CANONICAL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new TypeError(errorMessage);
  }

  const decoded = Buffer.from(value, "base64url");

  if (decoded.toString("base64url") !== value) {
    throw new TypeError(errorMessage);
  }

  return decoded;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

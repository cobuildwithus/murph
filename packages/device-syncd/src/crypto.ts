import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

const ENCRYPTED_SECRET_PREFIX = "mdss";
const ENCRYPTED_SECRET_VERSION = "v1";
const AES_256_GCM = "aes-256-gcm";
const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;
const SECRET_SCOPE_SALT = Buffer.from("murph.device-sync.secret.v1", "utf8");
const BASE64URL_CANONICAL_PATTERN = /^[A-Za-z0-9_-]*$/u;

export type DeviceSyncTokenCipherPurpose =
  | "device-sync-access-token"
  | "device-sync-refresh-token";

export interface SecretCipherOptions {
  aad?: Buffer | Uint8Array | string;
  keyScope?: string;
}

export interface SecretCodec {
  encrypt(value: string, options?: SecretCipherOptions): string;
  decrypt(payload: string, options?: SecretCipherOptions): string;
}

export function buildDeviceSyncSecretAad(
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

export function buildDeviceSyncTokenCipherOptions(input: {
  externalAccountId: string;
  provider: string;
  purpose: DeviceSyncTokenCipherPurpose;
}): SecretCipherOptions {
  return {
    aad: buildDeviceSyncSecretAad({
      externalAccountId: input.externalAccountId,
      provider: input.provider,
      purpose: input.purpose,
    }),
    keyScope: input.purpose,
  } satisfies SecretCipherOptions;
}

export function createSecretCodec(secret: string): SecretCodec {
  const rootKey = createHash("sha256").update(secret).digest();

  return {
    encrypt(value, options) {
      const iv = randomBytes(GCM_IV_BYTES);
      const cipher = createCipheriv(
        AES_256_GCM,
        deriveSecretScopeKey(rootKey, options?.keyScope),
        iv,
      );
      const aad = normalizeSecretAad(options?.aad);

      if (aad) {
        cipher.setAAD(aad);
      }

      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return [
        ENCRYPTED_SECRET_PREFIX,
        ENCRYPTED_SECRET_VERSION,
        iv.toString("base64url"),
        authTag.toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(":");
    },
    decrypt(payload, options) {
      const structuredPayload = parseStructuredSecretPayload(payload);

      if (!structuredPayload) {
        throw new TypeError("Encrypted payload is invalid.");
      }

      const decipher = createDecipheriv(
        AES_256_GCM,
        deriveSecretScopeKey(rootKey, options?.keyScope),
        structuredPayload.iv,
      );
      const aad = normalizeSecretAad(options?.aad);

      if (aad) {
        decipher.setAAD(aad);
      }

      decipher.setAuthTag(structuredPayload.authTag);
      const plaintext = Buffer.concat([
        decipher.update(structuredPayload.ciphertext),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    },
  };
}

function normalizeSecretAad(value: Buffer | Uint8Array | string | null | undefined): Buffer | null {
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

function normalizeSecretKeyScope(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function deriveSecretScopeKey(rootKey: Buffer, keyScope: string | null | undefined): Buffer {
  const normalizedScope = normalizeSecretKeyScope(keyScope);

  if (!normalizedScope) {
    return rootKey;
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      rootKey,
      SECRET_SCOPE_SALT,
      Buffer.from(normalizedScope, "utf8"),
      32,
    ),
  );
}

function parseStructuredSecretPayload(payload: string): {
  authTag: Buffer;
  ciphertext: Buffer;
  iv: Buffer;
} | null {
  if (!payload.includes(":")) {
    return null;
  }

  const parts = payload.split(":");

  if (parts.length !== 5) {
    throw new TypeError("Encrypted payload is invalid.");
  }

  const [prefix, version, ivText, authTagText, ciphertextText] = parts;

  if (
    prefix !== ENCRYPTED_SECRET_PREFIX
    || version !== ENCRYPTED_SECRET_VERSION
    || !ivText
    || !authTagText
    || ciphertextText === undefined
  ) {
    throw new TypeError("Encrypted payload is invalid.");
  }

  const iv = decodeStrictBase64UrlSegment(ivText, "Encrypted payload IV");
  const authTag = decodeStrictBase64UrlSegment(authTagText, "Encrypted payload auth tag");

  if (iv.byteLength !== GCM_IV_BYTES || authTag.byteLength !== GCM_AUTH_TAG_BYTES) {
    throw new TypeError("Encrypted payload is invalid.");
  }

  return {
    authTag,
    ciphertext: decodeStrictBase64UrlSegment(ciphertextText, "Encrypted payload ciphertext"),
    iv,
  };
}

function decodeStrictBase64UrlSegment(value: string, label: string): Buffer {
  if (!BASE64URL_CANONICAL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new TypeError(`${label} is invalid.`);
  }

  const decoded = Buffer.from(value, "base64url");

  if (decoded.toString("base64url") !== value) {
    throw new TypeError(`${label} is invalid.`);
  }

  return decoded;
}

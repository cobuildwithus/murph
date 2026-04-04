import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { normalizeNullableString } from "./shared";

const ENCRYPTED_SECRET_PREFIX = "hbds";
const AES_256_GCM = "aes-256-gcm";
const GCM_IV_BYTES = 12;
const HOSTED_SECRET_SCOPE_SALT = Buffer.from("murph.hosted.device-sync.secret.v1", "utf8");

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

  const normalizedBase64 = normalized.replace(/-/gu, "+").replace(/_/gu, "/");
  const padding = normalizedBase64.length % 4 === 0 ? "" : "=".repeat(4 - (normalizedBase64.length % 4));
  const base64Decoded = Buffer.from(`${normalizedBase64}${padding}`, "base64");

  if (base64Decoded.length === 32) {
    return base64Decoded;
  }

  const utf8Decoded = Buffer.from(normalized, "utf8");

  if (utf8Decoded.length === 32) {
    return utf8Decoded;
  }

  throw new TypeError(
    "Hosted encryption key must decode to exactly 32 bytes (hex, base64/base64url, or raw 32-byte text).",
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
      parsed = JSON.parse(input.keyringJson) as unknown;
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
  purpose: "device-sync-access-token" | "device-sync-refresh-token";
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
      const [prefix, payloadKeyVersion, ivText, tagText, ciphertextText] = payload.split(":");

      if (prefix !== ENCRYPTED_SECRET_PREFIX || !payloadKeyVersion || !ivText || !tagText || !ciphertextText) {
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

      try {
        return decryptHostedSecretPayload({
          aad,
          ciphertextText,
          ivText,
          key: deriveHostedSecretScopeKey(key, keyScope),
          tagText,
        });
      } catch {
        return decryptHostedSecretPayload({
          aad,
          ciphertextText,
          ivText,
          key,
          tagText,
        });
      }
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
  const decipher = createDecipheriv(
    AES_256_GCM,
    input.key,
    Buffer.from(input.ivText, "base64url"),
  );

  if (input.aad) {
    decipher.setAAD(input.aad);
  }

  decipher.setAuthTag(Buffer.from(input.tagText, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(input.ciphertextText, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
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

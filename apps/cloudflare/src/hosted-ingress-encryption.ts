import { Buffer } from "node:buffer";

import type { StringEnvSource } from "./string-env.ts";

const ENCRYPTED_SECRET_PREFIX = "hbds";
const AES_GCM_ALGORITHM = "AES-GCM";
const HKDF_HASH = "SHA-256";
const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;
const HOSTED_INGRESS_ENCRYPTION_KEY_BYTES = 32;
// Keep this salt aligned with the web-owned hosted secret codec until the ingress codec
// is extracted into a shared package. A mismatch here makes hosted ingress payloads
// undecryptable across the web/worker boundary.
const HOSTED_INGRESS_SCOPE_SALT = new TextEncoder().encode("murph.hosted.device-sync.secret.v1");
const BASE64_CANONICAL_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const BASE64URL_CANONICAL_PATTERN = /^[A-Za-z0-9_-]*$/u;
const HOSTED_INGRESS_INLINE_PAYLOAD_FIELD = "hosted-ingress-inline-payload";
const HOSTED_INGRESS_REF_PAYLOAD_FIELD = "hosted-ingress-ref-payload";

export interface HostedIngressEncryptionEnvironment {
  key: Uint8Array;
  keyVersion: string;
  keysByVersion: Readonly<Record<string, Uint8Array>>;
}

export function readHostedIngressEncryptionEnvironment(
  source: StringEnvSource = process.env,
): HostedIngressEncryptionEnvironment {
  const encryptionKey = decodeHostedIngressEncryptionKey(
    requireHostedIngressEncryptionString(
      source.HOSTED_WAKE_ENCRYPTION_KEY,
      "HOSTED_WAKE_ENCRYPTION_KEY",
    ),
  );
  const keyVersion = normalizeOptionalString(source.HOSTED_WAKE_ENCRYPTION_KEY_VERSION) ?? "v1";

  return {
    key: encryptionKey,
    keyVersion,
    keysByVersion: decodeHostedIngressEncryptionKeyring({
      currentKey: encryptionKey,
      currentKeyVersion: keyVersion,
      keyringJson: normalizeOptionalString(source.HOSTED_WAKE_ENCRYPTION_KEYRING_JSON),
      label: "HOSTED_WAKE_ENCRYPTION_KEYRING_JSON",
    }),
  };
}

export async function decryptHostedIngressPayloadCiphertext(input: {
  ciphertext: string;
  environment: HostedIngressEncryptionEnvironment;
  userId: string;
}): Promise<unknown> {
  const fields = [
    HOSTED_INGRESS_INLINE_PAYLOAD_FIELD,
    HOSTED_INGRESS_REF_PAYLOAD_FIELD,
  ] as const;
  let lastError: unknown = null;

  for (const field of fields) {
    try {
      const plaintext = await decryptHostedIngressCiphertext({
        ciphertext: input.ciphertext,
        environment: input.environment,
        field,
        userId: input.userId,
      });

      return JSON.parse(plaintext) as unknown;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new TypeError("Hosted ingress payload ciphertext is invalid.");
}

function requireHostedIngressEncryptionString(
  value: string | null | undefined,
  label: string,
): string {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }

  return normalized;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function decodeHostedIngressEncryptionKey(value: string): Uint8Array {
  const normalized = value.trim();

  if (!normalized) {
    throw new TypeError("Hosted ingress encryption key must not be empty.");
  }

  if (/^[0-9a-f]{64}$/iu.test(normalized)) {
    return Uint8Array.from(Buffer.from(normalized, "hex"));
  }

  const decoded = decodeStrictBase64(
    normalizeBase64Url(normalized),
    "Hosted ingress encryption key must decode to exactly 32 bytes (hex or base64/base64url).",
  );

  if (decoded.byteLength !== HOSTED_INGRESS_ENCRYPTION_KEY_BYTES) {
    throw new TypeError(
      "Hosted ingress encryption key must decode to exactly 32 bytes (hex or base64/base64url).",
    );
  }

  return decoded;
}

function decodeHostedIngressEncryptionKeyring(input: {
  currentKey: Uint8Array;
  currentKeyVersion: string;
  keyringJson: string | null;
  label: string;
}): Readonly<Record<string, Uint8Array>> {
  const keysByVersion: Record<string, Uint8Array> = {};

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
      const version = normalizeOptionalString(rawVersion);

      if (!version) {
        throw new TypeError(`${input.label} contains a blank key version.`);
      }

      if (typeof encodedKey !== "string" || encodedKey.trim().length === 0) {
        throw new TypeError(`${input.label} entry ${version} must be a non-empty encoded key.`);
      }

      keysByVersion[version] = decodeHostedIngressEncryptionKey(encodedKey);
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

async function decryptHostedIngressCiphertext(input: {
  ciphertext: string;
  environment: HostedIngressEncryptionEnvironment;
  field: string;
  userId: string;
}): Promise<string> {
  const [prefix, payloadKeyVersion, ivText, tagText, ciphertextText] = input.ciphertext.split(":");

  if (
    prefix !== ENCRYPTED_SECRET_PREFIX
    || !payloadKeyVersion
    || !ivText
    || !tagText
    || ciphertextText === undefined
  ) {
    throw new TypeError("Encrypted hosted ingress payload is malformed.");
  }

  const key = input.environment.keysByVersion[payloadKeyVersion];

  if (!key) {
    throw new TypeError(
      `Encrypted hosted ingress payload references unknown key version ${payloadKeyVersion}.`,
    );
  }

  const scopedKey = await deriveHostedIngressScopeKey(
    key,
    `hosted-ingress-payload:${input.field}`,
  );
  const iv = decodeStrictBase64Url(ivText, "Encrypted hosted ingress payload is malformed.");
  const authTag = decodeStrictBase64Url(tagText, "Encrypted hosted ingress payload is malformed.");
  const ciphertext = decodeStrictBase64Url(
    ciphertextText,
    "Encrypted hosted ingress payload is malformed.",
  );

  if (iv.byteLength !== GCM_IV_BYTES || authTag.byteLength !== GCM_AUTH_TAG_BYTES) {
    throw new TypeError("Encrypted hosted ingress payload is malformed.");
  }

  const keyHandle = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(scopedKey),
    AES_GCM_ALGORITHM,
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: toArrayBuffer(buildHostedIngressFieldAad({
        field: input.field,
        userId: input.userId,
      })),
      iv: toArrayBuffer(iv),
      name: AES_GCM_ALGORITHM,
      tagLength: GCM_AUTH_TAG_BYTES * 8,
    },
    keyHandle,
    toArrayBuffer(concatBytes(ciphertext, authTag)),
  );

  return new TextDecoder().decode(plaintext);
}

function buildHostedIngressFieldAad(input: {
  field: string;
  userId: string;
}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    field: input.field,
    memberId: input.userId,
    purpose: "hosted-ingress-payload",
  }));
}

async function deriveHostedIngressScopeKey(
  rootKey: Uint8Array,
  scope: string,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rootKey),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      hash: HKDF_HASH,
      info: toArrayBuffer(new TextEncoder().encode(scope)),
      name: "HKDF",
      salt: toArrayBuffer(HOSTED_INGRESS_SCOPE_SALT),
    },
    keyMaterial,
    HOSTED_INGRESS_ENCRYPTION_KEY_BYTES * 8,
  );

  return new Uint8Array(derivedBits);
}

function normalizeBase64Url(value: string): string {
  const normalized = value.trim().replace(/-/gu, "+").replace(/_/gu, "/");
  const remainder = normalized.length % 4;

  if (remainder === 0) {
    return normalized;
  }

  return normalized.padEnd(normalized.length + (4 - remainder), "=");
}

function decodeStrictBase64(value: string, errorMessage: string): Uint8Array {
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

  return Uint8Array.from(decoded);
}

function decodeStrictBase64Url(value: string, errorMessage: string): Uint8Array {
  if (!BASE64URL_CANONICAL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new TypeError(errorMessage);
  }

  const decoded = Buffer.from(value, "base64url");

  if (decoded.toString("base64url") !== value) {
    throw new TypeError(errorMessage);
  }

  return Uint8Array.from(decoded);
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left, 0);
  joined.set(right, left.byteLength);
  return joined;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
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

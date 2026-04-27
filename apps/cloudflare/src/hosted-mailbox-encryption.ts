import { Buffer } from "node:buffer";

import type { StringEnvSource } from "./string-env.ts";

const ENCRYPTED_SECRET_PREFIX = "hbds";
const AES_GCM_ALGORITHM = "AES-GCM";
const HKDF_HASH = "SHA-256";
const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;
const HOSTED_MAILBOX_ENCRYPTION_KEY_BYTES = 32;
// Keep this salt aligned with the web-owned hosted secret codec until the ingress codec
// is extracted into a shared package. A mismatch here makes hosted mailbox payloads
// undecryptable across the web/worker boundary.
const HOSTED_MAILBOX_SCOPE_SALT = new TextEncoder().encode("murph.hosted.device-sync.secret.v1");
const BASE64_CANONICAL_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const BASE64URL_CANONICAL_PATTERN = /^[A-Za-z0-9_-]*$/u;
const HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD = "hosted-mailbox-inline-payload";
const HOSTED_MAILBOX_REF_PAYLOAD_FIELD = "hosted-mailbox-ref-payload";

export interface HostedMailboxEncryptionEnvironment {
  key: Uint8Array;
  keyVersion: string;
  keysByVersion: Readonly<Record<string, Uint8Array>>;
}

export function readHostedMailboxEncryptionEnvironment(
  source: StringEnvSource = process.env,
): HostedMailboxEncryptionEnvironment {
  const encryptionKey = decodeHostedMailboxEncryptionKey(
    requireHostedMailboxEncryptionString(
      source.HOSTED_WAKE_ENCRYPTION_KEY,
      "HOSTED_WAKE_ENCRYPTION_KEY",
    ),
  );
  const keyVersion = normalizeOptionalString(source.HOSTED_WAKE_ENCRYPTION_KEY_VERSION) ?? "v1";

  return {
    key: encryptionKey,
    keyVersion,
    keysByVersion: decodeHostedMailboxEncryptionKeyring({
      currentKey: encryptionKey,
      currentKeyVersion: keyVersion,
      keyringJson: normalizeOptionalString(source.HOSTED_WAKE_ENCRYPTION_KEYRING_JSON),
      label: "HOSTED_WAKE_ENCRYPTION_KEYRING_JSON",
    }),
  };
}

export async function decryptHostedMailboxPayloadCiphertext(input: {
  ciphertext: string;
  environment: HostedMailboxEncryptionEnvironment;
  userId: string;
}): Promise<unknown> {
  const fields = [
    HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD,
    HOSTED_MAILBOX_REF_PAYLOAD_FIELD,
  ] as const;
  let lastError: unknown = null;

  for (const field of fields) {
    try {
      const plaintext = await decryptHostedMailboxCiphertext({
        ciphertext: input.ciphertext,
        environment: input.environment,
        field,
        userId: input.userId,
      });

      return parseJsonValue(plaintext, "Hosted mailbox payload ciphertext");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new TypeError("Hosted mailbox payload ciphertext is invalid.");
}

function requireHostedMailboxEncryptionString(
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

function decodeHostedMailboxEncryptionKey(value: string): Uint8Array {
  const normalized = value.trim();

  if (!normalized) {
    throw new TypeError("Hosted mailbox encryption key must not be empty.");
  }

  if (/^[0-9a-f]{64}$/iu.test(normalized)) {
    return Uint8Array.from(Buffer.from(normalized, "hex"));
  }

  const decoded = decodeStrictBase64(
    normalizeBase64Url(normalized),
    "Hosted mailbox encryption key must decode to exactly 32 bytes (hex or base64/base64url).",
  );

  if (decoded.byteLength !== HOSTED_MAILBOX_ENCRYPTION_KEY_BYTES) {
    throw new TypeError(
      "Hosted mailbox encryption key must decode to exactly 32 bytes (hex or base64/base64url).",
    );
  }

  return decoded;
}

function decodeHostedMailboxEncryptionKeyring(input: {
  currentKey: Uint8Array;
  currentKeyVersion: string;
  keyringJson: string | null;
  label: string;
}): Readonly<Record<string, Uint8Array>> {
  const keysByVersion: Record<string, Uint8Array> = {};

  if (input.keyringJson) {
    const parsed = parseJsonValue(input.keyringJson, input.label);

    if (!isRecord(parsed)) {
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

      keysByVersion[version] = decodeHostedMailboxEncryptionKey(encodedKey);
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

function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new TypeError(
      `${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function decryptHostedMailboxCiphertext(input: {
  ciphertext: string;
  environment: HostedMailboxEncryptionEnvironment;
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
    throw new TypeError("Encrypted hosted mailbox payload is malformed.");
  }

  const key = input.environment.keysByVersion[payloadKeyVersion];

  if (!key) {
    throw new TypeError(
      `Encrypted hosted mailbox payload references unknown key version ${payloadKeyVersion}.`,
    );
  }

  const scopedKey = await deriveHostedMailboxScopeKey(
    key,
    `hosted-mailbox-payload:${input.field}`,
  );
  const iv = decodeStrictBase64Url(ivText, "Encrypted hosted mailbox payload is malformed.");
  const authTag = decodeStrictBase64Url(tagText, "Encrypted hosted mailbox payload is malformed.");
  const ciphertext = decodeStrictBase64Url(
    ciphertextText,
    "Encrypted hosted mailbox payload is malformed.",
  );

  if (iv.byteLength !== GCM_IV_BYTES || authTag.byteLength !== GCM_AUTH_TAG_BYTES) {
    throw new TypeError("Encrypted hosted mailbox payload is malformed.");
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
      additionalData: toArrayBuffer(buildHostedMailboxFieldAad({
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

function buildHostedMailboxFieldAad(input: {
  field: string;
  userId: string;
}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    field: input.field,
    memberId: input.userId,
      purpose: "hosted-mailbox-payload",
  }));
}

async function deriveHostedMailboxScopeKey(
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
      salt: toArrayBuffer(HOSTED_MAILBOX_SCOPE_SALT),
    },
    keyMaterial,
    HOSTED_MAILBOX_ENCRYPTION_KEY_BYTES * 8,
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

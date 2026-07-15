const HOSTED_STORAGE_CONTEXT_SALT = new TextEncoder().encode(
  "murph.cloudflare.hosted.storage.v1",
);

export const HOSTED_CIPHER_ENVELOPE_SCHEMA = "murph.hosted-cipher.v1";
const HOSTED_CIPHER_KEY_ID_MAX_LENGTH = 256;

export type HostedCipherEnvelopeSchema = typeof HOSTED_CIPHER_ENVELOPE_SCHEMA;

export type HostedStorageScope =
  | "artifact"
  | "browser-vault-replica"
  | "bundle"
  | "email-raw"
  | "meal-photo"
  | "runner-secrets";

export interface HostedCipherEnvelope {
  algorithm: "AES-GCM";
  ciphertext: string;
  iv: string;
  keyId: string;
  schema: HostedCipherEnvelopeSchema;
  scope: HostedStorageScope;
}

export async function deriveHostedStorageKey(
  rootKey: Uint8Array,
  scope: HostedStorageScope | `id:${string}` | "",
): Promise<Uint8Array> {
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rootKey),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      info: new TextEncoder().encode(scope),
      salt: toArrayBuffer(HOSTED_STORAGE_CONTEXT_SALT),
    },
    hkdfKey,
    256,
  );

  return new Uint8Array(derived);
}

export async function deriveHostedStorageOpaqueId(input: {
  length?: number;
  rootKey: Uint8Array;
  scope: string;
  value: string;
}): Promise<string> {
  const idKey = await deriveHostedStorageKey(input.rootKey, `id:${input.scope}`);
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(idKey),
    {
      hash: "SHA-256",
      name: "HMAC",
    },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(input.value)),
  );
  const hex = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return hex.slice(0, input.length ?? 48);
}

export function buildHostedStorageAad(
  fields: Readonly<Record<string, string | number | boolean | null | undefined>>,
): Uint8Array {
  const canonical = Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value ?? null]),
  );

  return new TextEncoder().encode(JSON.stringify(canonical));
}

export function parseHostedCipherEnvelope(
  value: unknown,
  label = "Hosted cipher envelope",
): HostedCipherEnvelope {
  const record = requireRecord(value, label);
  const algorithm = requireString(record.algorithm, `${label}.algorithm`);
  const schema = requireString(record.schema, `${label}.schema`);
  const scope = requireString(record.scope, `${label}.scope`);

  if (algorithm !== "AES-GCM") {
    throw new TypeError(`${label}.algorithm must be AES-GCM.`);
  }

  if (schema !== HOSTED_CIPHER_ENVELOPE_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${HOSTED_CIPHER_ENVELOPE_SCHEMA}.`);
  }

  if (!isHostedCipherEnvelopeScope(scope)) {
    throw new TypeError(`${label}.scope must be a supported hosted storage scope.`);
  }

  return {
    algorithm: "AES-GCM",
    ciphertext: requireString(record.ciphertext, `${label}.ciphertext`),
    iv: requireString(record.iv, `${label}.iv`),
    keyId: requireHostedCipherKeyId(record.keyId, `${label}.keyId`),
    schema: HOSTED_CIPHER_ENVELOPE_SCHEMA,
    scope,
  };
}

export async function encryptHostedStoragePayload(input: {
  aad?: Uint8Array;
  key: Uint8Array;
  keyId: string;
  plaintext: Uint8Array;
  scope: HostedStorageScope;
}): Promise<HostedCipherEnvelope> {
  const keyId = requireHostedCipherKeyId(input.keyId, "Hosted cipher envelope.keyId");
  const scopedKey = await deriveHostedStorageKey(input.key, input.scope);
  const cryptoKey = await importAesKey(scopedKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        ...(input.aad && input.aad.byteLength > 0
          ? {
              additionalData: toArrayBuffer(input.aad),
            }
          : {}),
        iv: toArrayBuffer(iv),
        name: "AES-GCM",
      },
      cryptoKey,
      toArrayBuffer(input.plaintext),
    ),
  );

  return {
    algorithm: "AES-GCM",
    ciphertext: encodeBase64(ciphertext),
    iv: encodeBase64(iv),
    keyId,
    schema: HOSTED_CIPHER_ENVELOPE_SCHEMA,
    scope: input.scope,
  };
}

export async function decryptHostedStoragePayload(input: {
  aad?: Uint8Array;
  envelope: HostedCipherEnvelope;
  expectedKeyId?: string;
  key: Uint8Array;
  keysById?: Readonly<Record<string, Uint8Array>>;
  label?: string;
  scope: HostedStorageScope;
}): Promise<Uint8Array> {
  const label = input.label ?? "Hosted cipher envelope";

  if (input.envelope.scope !== input.scope) {
    throw new Error(
      `${label} scope mismatch: expected ${input.scope}, got ${input.envelope.scope}.`,
    );
  }

  const rootKey = resolveHostedCipherKey(input, label);
  const scopedKey = await deriveHostedStorageKey(rootKey, input.scope);
  const cryptoKey = await importAesKey(scopedKey);

  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        ...(input.aad && input.aad.byteLength > 0
          ? {
              additionalData: toArrayBuffer(input.aad),
            }
          : {}),
        iv: toArrayBuffer(decodeBase64(input.envelope.iv)),
        name: "AES-GCM",
      },
      cryptoKey,
      toArrayBuffer(decodeBase64(input.envelope.ciphertext)),
    ),
  );
}

function resolveHostedCipherKey(input: {
  envelope: HostedCipherEnvelope;
  expectedKeyId?: string;
  key: Uint8Array;
  keysById?: Readonly<Record<string, Uint8Array>>;
}, label: string): Uint8Array {
  if (input.keysById) {
    const keyForEnvelope = input.keysById[input.envelope.keyId];

    if (!keyForEnvelope) {
      throw new Error(
        `${label} keyId mismatch: expected ${input.expectedKeyId ?? "configured keyring"}, got ${input.envelope.keyId}.`,
      );
    }

    return keyForEnvelope;
  }

  if (input.expectedKeyId && input.envelope.keyId !== input.expectedKeyId) {
    throw new Error(
      `${label} keyId mismatch: expected ${input.expectedKeyId}, got ${input.envelope.keyId}. No keyring is configured for multi-key decryption.`,
    );
  }

  return input.key;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireHostedCipherKeyId(value: unknown, label: string): string {
  const keyId = requireString(value, label);
  if (keyId !== keyId.trim()) {
    throw new TypeError(`${label} must not contain surrounding whitespace.`);
  }
  if (keyId.length > HOSTED_CIPHER_KEY_ID_MAX_LENGTH) {
    throw new TypeError(
      `${label} must be at most ${HOSTED_CIPHER_KEY_ID_MAX_LENGTH} characters.`,
    );
  }
  return keyId;
}

function isHostedStorageScope(value: string): value is HostedStorageScope {
  return HOSTED_STORAGE_SCOPES.has(value as HostedStorageScope);
}

function isHostedCipherEnvelopeScope(
  value: string,
): value is HostedStorageScope {
  return isHostedStorageScope(value);
}

async function importAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const HOSTED_STORAGE_SCOPES = new Set<HostedStorageScope>([
  "artifact",
  "browser-vault-replica",
  "bundle",
  "email-raw",
  "meal-photo",
  "runner-secrets",
]);

import { decodeBase64, encodeBase64 } from "./base64.js";
import {
  deriveHostedStorageKey,
  type HostedStorageScope,
} from "./crypto-context.js";

const HOSTED_CIPHER_SCHEMA = "murph.hosted-cipher.v2";

type HostedCipherSchema = typeof HOSTED_CIPHER_SCHEMA;

export interface HostedCipherEnvelope {
  algorithm: "AES-GCM";
  ciphertext: string;
  iv: string;
  keyId: string;
  schema: HostedCipherSchema;
  scope: HostedStorageScope;
}

export async function encryptHostedBundle(input: {
  aad?: Uint8Array;
  key: Uint8Array;
  keyId: string;
  plaintext: Uint8Array;
  scope: HostedStorageScope;
}): Promise<HostedCipherEnvelope> {
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
        iv,
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
    keyId: input.keyId,
    schema: HOSTED_CIPHER_SCHEMA,
    scope: input.scope,
  };
}

export async function decryptHostedBundle(input: {
  aad?: Uint8Array;
  envelope: HostedCipherEnvelope;
  expectedKeyId?: string;
  key: Uint8Array;
  keysById?: Readonly<Record<string, Uint8Array>>;
  scope: HostedStorageScope;
}): Promise<Uint8Array> {
  if (!isSupportedHostedCipherSchema(input.envelope.schema) || input.envelope.algorithm !== "AES-GCM") {
    throw new Error("Hosted bundle envelope is invalid.");
  }

  if (input.envelope.scope !== input.scope) {
    throw new Error(
      `Hosted bundle envelope scope mismatch: expected ${input.scope}, got ${input.envelope.scope}.`,
    );
  }

  const rootKey = resolveHostedBundleDecryptionKey(input);
  return decryptHostedEnvelopePayload({
    aad: input.aad,
    ciphertext: decodeBase64(input.envelope.ciphertext),
    iv: decodeBase64(input.envelope.iv),
    rootKey,
    scope: input.scope,
  });
}

export interface EncryptedR2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface EncryptedR2BucketLike {
  get(key: string): Promise<EncryptedR2ObjectBodyLike | null>;
  put(key: string, value: string): Promise<void>;
}

const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

export async function readEncryptedR2Payload(input: {
  aad?: Uint8Array;
  bucket: EncryptedR2BucketLike;
  cryptoKey: Uint8Array;
  cryptoKeysById?: Readonly<Record<string, Uint8Array>>;
  expectedKeyId?: string;
  key: string;
  scope: HostedStorageScope;
}): Promise<Uint8Array | null> {
  const object = await input.bucket.get(input.key);

  if (!object) {
    return null;
  }

  const envelope = JSON.parse(
    utf8Decoder.decode(await object.arrayBuffer()),
  ) as HostedCipherEnvelope;
  const plaintext = await decryptHostedBundle({
    aad: input.aad,
    envelope,
    expectedKeyId: input.expectedKeyId,
    key: input.cryptoKey,
    keysById: input.cryptoKeysById,
    scope: input.scope,
  });

  return plaintext;
}

export async function writeEncryptedR2Payload(input: {
  aad?: Uint8Array;
  bucket: EncryptedR2BucketLike;
  cryptoKey: Uint8Array;
  key: string;
  keyId: string;
  plaintext: Uint8Array;
  scope: HostedStorageScope;
}): Promise<void> {
  const envelope = await encryptHostedBundle({
    aad: input.aad,
    key: input.cryptoKey,
    keyId: input.keyId,
    plaintext: input.plaintext,
    scope: input.scope,
  });

  await input.bucket.put(input.key, JSON.stringify(envelope));
}

export async function readEncryptedR2Json<T>(input: {
  aad?: Uint8Array;
  bucket: EncryptedR2BucketLike;
  cryptoKey: Uint8Array;
  cryptoKeysById?: Readonly<Record<string, Uint8Array>>;
  expectedKeyId?: string;
  key: string;
  parse(value: unknown): T;
  scope: HostedStorageScope;
}): Promise<T | null> {
  const plaintext = await readEncryptedR2Payload({
    aad: input.aad,
    bucket: input.bucket,
    cryptoKey: input.cryptoKey,
    cryptoKeysById: input.cryptoKeysById,
    expectedKeyId: input.expectedKeyId,
    key: input.key,
    scope: input.scope,
  });

  if (!plaintext) {
    return null;
  }

  return input.parse(JSON.parse(utf8Decoder.decode(plaintext)) as unknown);
}

export async function writeEncryptedR2Json(input: {
  aad?: Uint8Array;
  bucket: EncryptedR2BucketLike;
  cryptoKey: Uint8Array;
  key: string;
  keyId: string;
  scope: HostedStorageScope;
  value: unknown;
}): Promise<void> {
  await writeEncryptedR2Payload({
    aad: input.aad,
    bucket: input.bucket,
    cryptoKey: input.cryptoKey,
    key: input.key,
    keyId: input.keyId,
    plaintext: utf8Encoder.encode(JSON.stringify(input.value)),
    scope: input.scope,
  });
}

function resolveHostedBundleDecryptionKey(input: {
  envelope: HostedCipherEnvelope;
  expectedKeyId?: string;
  key: Uint8Array;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): Uint8Array {
  if (input.keysById) {
    const keyForEnvelope = input.keysById[input.envelope.keyId];

    if (!keyForEnvelope) {
      throw new Error(
        `Hosted bundle envelope keyId mismatch: expected ${input.expectedKeyId ?? "configured keyring"}, got ${input.envelope.keyId}.`,
      );
    }

    return keyForEnvelope;
  }

  if (input.expectedKeyId && input.envelope.keyId !== input.expectedKeyId) {
    throw new Error(
      `Hosted bundle envelope keyId mismatch: expected ${input.expectedKeyId}, got ${input.envelope.keyId}. No keyring is configured for multi-key decryption.`,
    );
  }

  return input.key;
}

async function importAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function decryptHostedEnvelopePayload(input: {
  aad?: Uint8Array;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  rootKey: Uint8Array;
  scope: HostedStorageScope;
}): Promise<Uint8Array> {
  const scopedKey = await deriveHostedStorageKey(input.rootKey, input.scope);
  const cryptoKey = await importAesKey(scopedKey);

  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        ...(input.aad && input.aad.byteLength > 0
          ? {
              additionalData: toArrayBuffer(input.aad),
            }
          : {}),
        iv: toArrayBuffer(input.iv),
        name: "AES-GCM",
      },
      cryptoKey,
      toArrayBuffer(input.ciphertext),
    ),
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isSupportedHostedCipherSchema(value: string): value is HostedCipherSchema {
  return value === HOSTED_CIPHER_SCHEMA;
}

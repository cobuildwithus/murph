import { decodeBase64, encodeBase64 } from "./base64.js";

const HOSTED_CIPHER_SCHEMA = "murph.hosted-cipher.v1";
const LEGACY_HOSTED_CIPHER_SCHEMA = "healthybob.hosted-cipher.v1";

type HostedCipherSchema = typeof HOSTED_CIPHER_SCHEMA | typeof LEGACY_HOSTED_CIPHER_SCHEMA;

export interface HostedCipherEnvelope {
  algorithm: "AES-GCM";
  ciphertext: string;
  iv: string;
  keyId: string;
  schema: HostedCipherSchema;
}

export async function encryptHostedBundle(input: {
  key: Uint8Array;
  keyId: string;
  plaintext: Uint8Array;
}): Promise<HostedCipherEnvelope> {
  const cryptoKey = await importAesKey(input.key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
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
  };
}

export async function decryptHostedBundle(input: {
  envelope: HostedCipherEnvelope;
  expectedKeyId?: string;
  key: Uint8Array;
}): Promise<Uint8Array> {
  if (!isSupportedHostedCipherSchema(input.envelope.schema) || input.envelope.algorithm !== "AES-GCM") {
    throw new Error("Hosted bundle envelope is invalid.");
  }

  if (input.expectedKeyId && input.envelope.keyId !== input.expectedKeyId) {
    throw new Error(
      `Hosted bundle envelope keyId mismatch: expected ${input.expectedKeyId}, got ${input.envelope.keyId}. Multi-key decryption is not implemented.`,
    );
  }

  const cryptoKey = await importAesKey(input.key);

  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        iv: toArrayBuffer(decodeBase64(input.envelope.iv)),
        name: "AES-GCM",
      },
      cryptoKey,
      toArrayBuffer(decodeBase64(input.envelope.ciphertext)),
    ),
  );
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
  bucket: EncryptedR2BucketLike;
  cryptoKey: Uint8Array;
  expectedKeyId?: string;
  key: string;
}): Promise<Uint8Array | null> {
  const object = await input.bucket.get(input.key);

  if (!object) {
    return null;
  }

  return decryptHostedBundle({
    envelope: JSON.parse(utf8Decoder.decode(await object.arrayBuffer())) as HostedCipherEnvelope,
    expectedKeyId: input.expectedKeyId,
    key: input.cryptoKey,
  });
}

export async function writeEncryptedR2Payload(input: {
  bucket: EncryptedR2BucketLike;
  cryptoKey: Uint8Array;
  key: string;
  keyId: string;
  plaintext: Uint8Array;
}): Promise<void> {
  const envelope = await encryptHostedBundle({
    key: input.cryptoKey,
    keyId: input.keyId,
    plaintext: input.plaintext,
  });

  await input.bucket.put(input.key, JSON.stringify(envelope));
}

export async function readEncryptedR2Json<T>(input: {
  bucket: EncryptedR2BucketLike;
  cryptoKey: Uint8Array;
  expectedKeyId?: string;
  key: string;
  parse(value: unknown): T;
}): Promise<T | null> {
  const plaintext = await readEncryptedR2Payload({
    bucket: input.bucket,
    cryptoKey: input.cryptoKey,
    expectedKeyId: input.expectedKeyId,
    key: input.key,
  });

  if (!plaintext) {
    return null;
  }

  return input.parse(JSON.parse(utf8Decoder.decode(plaintext)) as unknown);
}

export async function writeEncryptedR2Json(input: {
  bucket: EncryptedR2BucketLike;
  cryptoKey: Uint8Array;
  key: string;
  keyId: string;
  value: unknown;
}): Promise<void> {
  await writeEncryptedR2Payload({
    bucket: input.bucket,
    cryptoKey: input.cryptoKey,
    key: input.key,
    keyId: input.keyId,
    plaintext: utf8Encoder.encode(JSON.stringify(input.value)),
  });
}

async function importAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isSupportedHostedCipherSchema(value: string): value is HostedCipherSchema {
  return value === HOSTED_CIPHER_SCHEMA || value === LEGACY_HOSTED_CIPHER_SCHEMA;
}

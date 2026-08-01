import {
  decryptHostedStoragePayload,
  encryptHostedStoragePayload,
  parseHostedCipherEnvelope,
  type HostedCipherEnvelope,
  type HostedStorageScope,
} from "@murphai/runtime-state";

export interface EncryptedR2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array>;
  customMetadata?: Record<string, string>;
  key?: string;
  size?: number;
  uploaded?: Date;
}

export type R2PutValueLike =
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | ReadableStream<Uint8Array>
  | string;

export interface R2PutOptionsLike {
  customMetadata?: Record<string, string>;
  httpMetadata?: {
    contentType?: string;
  };
  onlyIf?: unknown;
}

export interface EncryptedR2BucketLike {
  get(key: string): Promise<EncryptedR2ObjectBodyLike | null>;
  put(key: string, value: R2PutValueLike, options?: R2PutOptionsLike): Promise<void>;
}

const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

export class HostedEncryptedR2PayloadUnreadableError extends Error {
  constructor(cause: unknown) {
    super("Hosted encrypted R2 payload is unreadable.", { cause });
    this.name = "HostedEncryptedR2PayloadUnreadableError";
  }
}

function describeHostedStorageEnvelopeLabel(scope: HostedStorageScope): string {
  switch (scope) {
    case "artifact":
      return "Hosted artifact envelope";
    case "browser-vault-replica":
      return "Hosted browser vault replica envelope";
    case "bundle":
      return "Hosted bundle envelope";
    case "email-raw":
      return "Hosted email raw message envelope";
    case "environment-voice":
      return "Hosted environment voice envelope";
    case "meal-photo":
      return "Hosted meal photo envelope";
    case "private-media":
      return "Hosted private media envelope";
    case "runner-secrets":
      return "Hosted runner secrets envelope";
  }
}

export async function encryptHostedStorageEnvelope(input: {
  aad?: Uint8Array;
  key: Uint8Array;
  keyId: string;
  plaintext: Uint8Array;
  scope: HostedStorageScope;
}): Promise<HostedCipherEnvelope> {
  return encryptHostedStoragePayload({
    aad: input.aad,
    key: input.key,
    keyId: input.keyId,
    plaintext: input.plaintext,
    scope: input.scope,
  });
}

export async function decryptHostedStorageEnvelope(input: {
  aad?: Uint8Array;
  envelope: HostedCipherEnvelope;
  expectedKeyId?: string;
  key: Uint8Array;
  keysById?: Readonly<Record<string, Uint8Array>>;
  label?: string;
  scope: HostedStorageScope;
}): Promise<Uint8Array> {
  return decryptHostedStoragePayload({
    aad: input.aad,
    envelope: input.envelope,
    expectedKeyId: input.expectedKeyId,
    key: input.key,
    keysById: input.keysById,
    label: input.label,
    scope: input.scope,
  });
}

export async function readEncryptedR2Payload(input: {
  aad?: Uint8Array;
  bucket: EncryptedR2BucketLike;
  callerLabel?: string;
  cryptoKey: Uint8Array;
  cryptoKeysById?: Readonly<Record<string, Uint8Array>>;
  expectedKeyId?: string;
  resolveCryptoKeyById?: (keyId: string) => Promise<Uint8Array | null>;
  key: string;
  scope: HostedStorageScope;
}): Promise<Uint8Array | null> {
  const object = await input.bucket.get(input.key);

  if (!object) {
    return null;
  }

  const serializedEnvelope = utf8Decoder.decode(await object.arrayBuffer());
  let envelope: HostedCipherEnvelope;
  try {
    const envelopeValue: unknown = JSON.parse(serializedEnvelope);
    envelope = parseHostedCipherEnvelope(
      envelopeValue,
      input.callerLabel ?? describeHostedStorageEnvelopeLabel(input.scope),
    );
  } catch (error) {
    throw new HostedEncryptedR2PayloadUnreadableError(error);
  }

  let cryptoKeysById = input.cryptoKeysById;
  if (
    input.resolveCryptoKeyById
    && !cryptoKeysById?.[envelope.keyId]
    && envelope.keyId !== input.expectedKeyId
  ) {
    const resolvedKey = await input.resolveCryptoKeyById(envelope.keyId);
    if (resolvedKey) {
      cryptoKeysById = { ...(cryptoKeysById ?? {}), [envelope.keyId]: resolvedKey };
    }
  }

  try {
    return await decryptHostedStorageEnvelope({
      aad: input.aad,
      envelope,
      expectedKeyId: input.expectedKeyId,
      key: input.cryptoKey,
      keysById: cryptoKeysById,
      label: input.callerLabel ?? describeHostedStorageEnvelopeLabel(input.scope),
      scope: input.scope,
    });
  } catch (error) {
    throw new HostedEncryptedR2PayloadUnreadableError(error);
  }
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
  const envelope = await encryptHostedStorageEnvelope({
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
  resolveCryptoKeyById?: (keyId: string) => Promise<Uint8Array | null>;
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
    resolveCryptoKeyById: input.resolveCryptoKeyById,
    key: input.key,
    scope: input.scope,
  });

  if (!plaintext) {
    return null;
  }

  const parsed: unknown = JSON.parse(utf8Decoder.decode(plaintext));
  return input.parse(parsed);
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

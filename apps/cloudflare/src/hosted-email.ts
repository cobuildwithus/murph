/**
 * Public hosted email surface. Routing, config normalization, and outbound send
 * preparation live in smaller feature modules; this file keeps raw-message I/O
 * and the shared worker request shape together.
 */

import type { R2BucketLike } from "./bundle-store.ts";
import { buildHostedStorageAad } from "./crypto-context.js";
import {
  readEncryptedR2Json,
  readEncryptedR2Payload,
  writeEncryptedR2Json,
  writeEncryptedR2Payload,
} from "./crypto.ts";
import { hostedEmailRawMessageObjectKey } from "./storage-paths.ts";

export type { HostedEmailConfig } from "./hosted-email/config.ts";
export { readHostedEmailConfig } from "./hosted-email/config.ts";
export type { HostedEmailInboundRoute } from "./hosted-email/routes.ts";
export {
  createHostedEmailUserAddress,
  HostedEmailIngressRouteResolutionError,
  resolveHostedEmailIngressRoute,
  resolveHostedEmailInboundRoute,
} from "./hosted-email/routes.ts";
export { shouldRejectHostedEmailIngressFailure } from "./hosted-email/ingress-policy.ts";
export {
  HostedEmailPreProviderError,
  HostedEmailSendValidationError,
  sendHostedEmailMessage,
} from "./hosted-email/transport.ts";

const HOSTED_EMAIL_MAX_RAW_MESSAGE_BYTES = 20 * 1024 * 1024;
export const HOSTED_EMAIL_PUBLIC_BOOTSTRAP_MAX_HEADER_BYTES = 64 * 1024;
const HOSTED_EMAIL_RAW_MESSAGE_KEY_SALT = "murph.hosted.email.raw-message-key.v1";
const HOSTED_EMAIL_RAW_MESSAGE_RECOVERY_SCHEMA =
  "murph.hosted-email.raw-message-recovery.v1";

export { hostedEmailRawMessageUserPrefix } from "./storage-paths.ts";

export class HostedEmailRawMessageMissingError extends Error {
  readonly code = "email-raw-message-missing";

  constructor(_input: { rawMessageKey: string; userId: string }) {
    super("Hosted email message fetch failed.");
    this.name = "HostedEmailRawMessageMissingError";
  }
}

export interface HostedEmailWorkerRequest {
  headers?: Headers;
  from: string;
  raw: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | string;
  rawSize?: number;
  setReject?(reason: string): void;
  to: string;
}

export interface HostedEmailRawMessageStorageRef {
  objectKey: string;
  rawMessageKey: string;
}

export interface HostedEmailRawMessageRecoveryRef {
  eventId: string;
  identityId: string;
  occurredAt: string;
  rawMessageKey: string;
  rawMessageObjectKey: string;
  routeAddress: string;
  schema: typeof HOSTED_EMAIL_RAW_MESSAGE_RECOVERY_SCHEMA;
  userId: string;
}

export async function readHostedEmailRawMessage(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  rawMessageKey: string;
  resolveKeyById?: (keyId: string) => Promise<Uint8Array | null>;
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<Uint8Array | null> {
  const objectKey = await hostedEmailRawMessageObjectKey({
    rawMessageKey: input.rawMessageKey,
    storageNamespaceId: input.storageNamespaceId,
    userId: input.userId,
  });

  const rawMessage = await readEncryptedR2Payload({
    aad: buildHostedStorageAad({
      key: objectKey,
      purpose: "email-raw",
      rawMessageKey: input.rawMessageKey,
      userId: input.userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    cryptoKeysById: input.keysById,
    expectedKeyId: input.keyId,
    key: objectKey,
    resolveCryptoKeyById: input.resolveKeyById,
    scope: "email-raw",
  });

  return rawMessage;
}

export async function readHostedEmailRawMessageRecoveryRef(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  objectKey: string;
  resolveKeyById?: (keyId: string) => Promise<Uint8Array | null>;
  userId: string;
}): Promise<HostedEmailRawMessageRecoveryRef | null> {
  return await readEncryptedR2Json({
    aad: buildHostedStorageAad({
      key: input.objectKey,
      purpose: "email-raw-recovery",
      userId: input.userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    cryptoKeysById: input.keysById,
    expectedKeyId: input.keyId,
    key: input.objectKey,
    parse: parseHostedEmailRawMessageRecoveryRef,
    resolveCryptoKeyById: input.resolveKeyById,
    scope: "email-raw",
  });
}

export async function resolveHostedEmailRawMessageStorageRef(input: {
  plaintext: Uint8Array;
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<HostedEmailRawMessageStorageRef> {
  const rawMessageKey = await deriveHostedEmailRawMessageKey(
    input.userId,
    input.plaintext,
  );

  return {
    objectKey: await hostedEmailRawMessageObjectKey({
      rawMessageKey,
      storageNamespaceId: input.storageNamespaceId,
      userId: input.userId,
    }),
    rawMessageKey,
  };
}

export async function writeHostedEmailRawMessage(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  plaintext: Uint8Array;
  storageRef?: HostedEmailRawMessageStorageRef;
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  const storageRef = input.storageRef ?? await resolveHostedEmailRawMessageStorageRef({
    plaintext: input.plaintext,
    storageNamespaceId: input.storageNamespaceId,
    userId: input.userId,
  });
  await writeEncryptedR2Payload({
    aad: buildHostedStorageAad({
      key: storageRef.objectKey,
      purpose: "email-raw",
      rawMessageKey: storageRef.rawMessageKey,
      userId: input.userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    key: storageRef.objectKey,
    keyId: input.keyId,
    plaintext: input.plaintext,
    scope: "email-raw",
  });
  return storageRef.rawMessageKey;
}

export async function writeHostedEmailRawMessageRecoveryRef(input: {
  bucket: R2BucketLike;
  eventId: string;
  identityId: string;
  key: Uint8Array;
  keyId: string;
  occurredAt: string;
  routeAddress: string;
  storageRef: HostedEmailRawMessageStorageRef;
  userId: string;
}): Promise<string> {
  const objectKey = resolveHostedEmailRawMessageRecoveryObjectKey(input.storageRef.objectKey);

  await writeEncryptedR2Json({
    aad: buildHostedStorageAad({
      key: objectKey,
      purpose: "email-raw-recovery",
      userId: input.userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    key: objectKey,
    keyId: input.keyId,
    scope: "email-raw",
    value: {
      eventId: input.eventId,
      identityId: input.identityId,
      occurredAt: input.occurredAt,
      rawMessageKey: input.storageRef.rawMessageKey,
      rawMessageObjectKey: input.storageRef.objectKey,
      routeAddress: input.routeAddress,
      schema: HOSTED_EMAIL_RAW_MESSAGE_RECOVERY_SCHEMA,
      userId: input.userId,
    } satisfies HostedEmailRawMessageRecoveryRef,
  });

  return objectKey;
}

export async function deleteHostedEmailRawMessage(input: {
  bucket: R2BucketLike;
  rawMessageKey: string;
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<void> {
  if (!input.bucket.delete) {
    return;
  }

  const objectKey = await hostedEmailRawMessageObjectKey({
    rawMessageKey: input.rawMessageKey,
    storageNamespaceId: input.storageNamespaceId,
    userId: input.userId,
  });

  await input.bucket.delete(objectKey);
  await input.bucket.delete(resolveHostedEmailRawMessageRecoveryObjectKey(objectKey));
}

export async function readHostedEmailMessageBytes(
  input: HostedEmailWorkerRequest["raw"],
  options: {
    maxBytes?: number;
    rawSize?: number | null;
  } = {},
): Promise<Uint8Array> {
  const maxBytes = options.maxBytes ?? HOSTED_EMAIL_MAX_RAW_MESSAGE_BYTES;
  assertHostedEmailMessageSize(options.rawSize ?? null, maxBytes);

  if (typeof input === "string") {
    const bytes = new TextEncoder().encode(input);
    assertHostedEmailMessageSize(bytes.byteLength, maxBytes);
    return bytes;
  }

  if (input instanceof Uint8Array) {
    assertHostedEmailMessageSize(input.byteLength, maxBytes);
    return input;
  }

  if (input instanceof ArrayBuffer) {
    const bytes = new Uint8Array(input);
    assertHostedEmailMessageSize(bytes.byteLength, maxBytes);
    return bytes;
  }

  return await readHostedEmailReadableStream(input, maxBytes);
}

export async function readHostedEmailHeaderBytes(
  input: HostedEmailWorkerRequest["raw"],
  options: { maxBytes?: number } = {},
): Promise<Uint8Array | null> {
  const maxBytes = options.maxBytes ?? HOSTED_EMAIL_PUBLIC_BOOTSTRAP_MAX_HEADER_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("Hosted email header byte limit must be a positive integer.");
  }

  if (typeof input === "string") {
    // UTF-8 can use four bytes per code point. Slice before encoding so an
    // attacker-controlled body never causes an unbounded allocation here.
    const bounded = new TextEncoder().encode(input.slice(0, maxBytes + 4));
    return sliceHostedEmailHeaderBytes(bounded, maxBytes);
  }

  if (input instanceof Uint8Array) {
    return sliceHostedEmailHeaderBytes(input.subarray(0, maxBytes + 4), maxBytes);
  }

  if (input instanceof ArrayBuffer) {
    return sliceHostedEmailHeaderBytes(
      new Uint8Array(input, 0, Math.min(input.byteLength, maxBytes + 4)),
      maxBytes,
    );
  }

  return readHostedEmailHeaderReadableStream(input, maxBytes);
}

async function readHostedEmailHeaderReadableStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const bounded = new Uint8Array(maxBytes + 4);
  let length = 0;

  try {
    while (length <= maxBytes) {
      const { done, value } = await reader.read();
      if (done) {
        return null;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }

      const remaining = bounded.byteLength - length;
      const copied = Math.min(value.byteLength, remaining);
      bounded.set(value.subarray(0, copied), length);
      length += copied;

      const header = sliceHostedEmailHeaderBytes(bounded.subarray(0, length), maxBytes);
      if (header) {
        await reader.cancel().catch(() => undefined);
        return header;
      }
      if (length > maxBytes || value.byteLength > copied) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
    }

    await reader.cancel().catch(() => undefined);
    return null;
  } finally {
    reader.releaseLock();
  }
}

function sliceHostedEmailHeaderBytes(
  bytes: Uint8Array,
  maxBytes: number,
): Uint8Array | null {
  const end = findHostedEmailHeaderEnd(bytes);
  if (end === null || end > maxBytes) {
    return null;
  }
  return bytes.slice(0, end);
}

function findHostedEmailHeaderEnd(bytes: Uint8Array): number | null {
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (
      index + 3 < bytes.byteLength
      && bytes[index] === 13
      && bytes[index + 1] === 10
      && bytes[index + 2] === 13
      && bytes[index + 3] === 10
    ) {
      return index + 4;
    }
    if (
      index + 1 < bytes.byteLength
      && bytes[index] === 10
      && bytes[index + 1] === 10
    ) {
      return index + 2;
    }
  }
  return null;
}

async function readHostedEmailReadableStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (value) {
        chunks.push(value);
        totalLength += value.byteLength;

        if (totalLength > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // best-effort stream cleanup only
          }

          throw new RangeError(
            `Hosted email message exceeded the maximum accepted size of ${maxBytes} bytes.`,
          );
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return combined;
}

function assertHostedEmailMessageSize(
  size: number | null,
  maxBytes: number,
): void {
  if (typeof size === "number" && Number.isFinite(size) && size > maxBytes) {
    throw new RangeError(
      `Hosted email message exceeded the maximum accepted size of ${maxBytes} bytes.`,
    );
  }
}

async function deriveHostedEmailRawMessageKey(
  userId: string,
  plaintext: Uint8Array,
): Promise<string> {
  const plaintextHash = await sha256Hex(plaintext);
  const rawMessageKey = await sha256Hex(new TextEncoder().encode([
    HOSTED_EMAIL_RAW_MESSAGE_KEY_SALT,
    userId,
    plaintextHash,
  ].join("\0")));

  return rawMessageKey.slice(0, 40);
}

function resolveHostedEmailRawMessageRecoveryObjectKey(rawMessageObjectKey: string): string {
  if (
    !rawMessageObjectKey.startsWith("hosted-email/messages/")
    || !rawMessageObjectKey.endsWith(".eml")
  ) {
    throw new Error("Hosted email raw message recovery refs require a hosted raw email object key.");
  }

  return `${rawMessageObjectKey.slice(0, -".eml".length)}.recovery.json`;
}

function parseHostedEmailRawMessageRecoveryRef(
  value: unknown,
): HostedEmailRawMessageRecoveryRef {
  const record = requireRecord(value, "Hosted email raw message recovery ref");
  const schema = requireString(record.schema, "Hosted email raw message recovery ref.schema");

  if (schema !== HOSTED_EMAIL_RAW_MESSAGE_RECOVERY_SCHEMA) {
    throw new Error("Hosted email raw message recovery ref has an unsupported schema.");
  }

  return {
    eventId: requireString(record.eventId, "Hosted email raw message recovery ref.eventId"),
    identityId: requireString(record.identityId, "Hosted email raw message recovery ref.identityId"),
    occurredAt: requireString(record.occurredAt, "Hosted email raw message recovery ref.occurredAt"),
    rawMessageKey: requireString(
      record.rawMessageKey,
      "Hosted email raw message recovery ref.rawMessageKey",
    ),
    rawMessageObjectKey: requireString(
      record.rawMessageObjectKey,
      "Hosted email raw message recovery ref.rawMessageObjectKey",
    ),
    routeAddress: requireString(
      record.routeAddress,
      "Hosted email raw message recovery ref.routeAddress",
    ),
    schema,
    userId: requireString(record.userId, "Hosted email raw message recovery ref.userId"),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

async function sha256Hex(input: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      input.buffer.slice(
        input.byteOffset,
        input.byteOffset + input.byteLength,
      ) as ArrayBuffer,
    ),
  );

  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

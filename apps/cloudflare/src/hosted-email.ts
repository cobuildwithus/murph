/**
 * Public hosted email surface. Routing, config normalization, and outbound send
 * preparation live in smaller feature modules; this file keeps raw-message I/O
 * and the shared worker request shape together.
 */

import type { HostedEmailAuthenticatedSenderVerdict } from "@murphai/runtime-state";

import type { R2BucketLike } from "./bundle-store.ts";
import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "./crypto-context.js";
import {
  readEncryptedR2Payload,
  writeEncryptedR2Payload,
} from "./crypto.ts";

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
export { HostedEmailSendValidationError, sendHostedEmailMessage } from "./hosted-email/transport.ts";

const HOSTED_EMAIL_MAX_RAW_MESSAGE_BYTES = 20 * 1024 * 1024;
const HOSTED_EMAIL_RAW_MESSAGE_OBJECT_PREFIX = "hosted-email/messages";

export class HostedEmailRawMessageMissingError extends Error {
  readonly code = "email-raw-message-missing";

  constructor(input: { rawMessageKey: string; userId: string }) {
    super(
      `Hosted email message fetch failed for ${input.userId}/${input.rawMessageKey}.`,
    );
    this.name = "HostedEmailRawMessageMissingError";
  }
}

export interface HostedEmailWorkerRequest {
  authenticatedSender?: HostedEmailAuthenticatedSenderVerdict | null;
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

export async function readHostedEmailRawMessage(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  rawMessageKey: string;
  userId: string;
}): Promise<Uint8Array | null> {
  const objectKey = await hostedEmailRawMessageObjectKey(
    input.key,
    input.userId,
    input.rawMessageKey,
  );

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
    scope: "email-raw",
  });

  return rawMessage;
}

export async function resolveHostedEmailRawMessageStorageRef(input: {
  key: Uint8Array;
  plaintext: Uint8Array;
  userId: string;
}): Promise<HostedEmailRawMessageStorageRef> {
  const rawMessageKey = await deriveHostedEmailRawMessageKey(
    input.key,
    input.userId,
    input.plaintext,
  );

  return {
    objectKey: await hostedEmailRawMessageObjectKey(input.key, input.userId, rawMessageKey),
    rawMessageKey,
  };
}

export async function writeHostedEmailRawMessage(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  plaintext: Uint8Array;
  storageRef?: HostedEmailRawMessageStorageRef;
  userId: string;
}): Promise<string> {
  const storageRef = input.storageRef ?? await resolveHostedEmailRawMessageStorageRef({
    key: input.key,
    plaintext: input.plaintext,
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

export async function deleteHostedEmailRawMessage(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keysById?: Readonly<Record<string, Uint8Array>>;
  rawMessageKey: string;
  userId: string;
}): Promise<void> {
  if (!input.bucket.delete) {
    return;
  }

  await input.bucket.delete(
    await hostedEmailRawMessageObjectKey(input.key, input.userId, input.rawMessageKey),
  );
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
  rootKey: Uint8Array,
  userId: string,
  plaintext: Uint8Array,
): Promise<string> {
  const plaintextHash = await sha256Hex(plaintext);

  return await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey,
    scope: "email-raw-id",
    value: `message:${userId}:${plaintextHash}`,
  });
}

async function hostedEmailRawMessageObjectKey(
  rootKey: Uint8Array,
  userId: string,
  rawMessageKey: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "email-raw",
    value: `user:${userId}`,
  });
  const messageSegment = await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey,
    scope: "email-raw",
    value: `message:${userId}:${rawMessageKey}`,
  });

  return `${HOSTED_EMAIL_RAW_MESSAGE_OBJECT_PREFIX}/${userSegment}/${messageSegment}.eml`;
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

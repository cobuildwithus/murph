/**
 * Public hosted email surface. Routing, config normalization, and outbound send
 * preparation live in smaller feature modules; this file keeps raw-message I/O
 * and the shared worker request shape together.
 */

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
  ensureHostedEmailVerifiedSenderRouteAvailable,
  reconcileHostedEmailVerifiedSenderRoute,
  resolveHostedEmailIngressRoute,
  resolveHostedEmailInboundRoute,
} from "./hosted-email/routes.ts";
export { shouldRejectHostedEmailIngressFailure } from "./hosted-email/ingress-policy.ts";
export { sendHostedEmailMessage } from "./hosted-email/transport.ts";

export interface HostedEmailWorkerRequest {
  headers?: Headers;
  from: string;
  raw: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | string;
  rawSize?: number;
  setReject?(reason: string): void;
  to: string;
}

export async function readHostedEmailRawMessage(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  rawMessageKey: string;
  userId: string;
}): Promise<Uint8Array | null> {
  for (const key of await hostedEmailRawMessageObjectKeys(
    input.key,
    input.keysById,
    input.userId,
    input.rawMessageKey,
  )) {
    const payload = await readEncryptedR2Payload({
      aad: buildHostedStorageAad({
        key,
        purpose: "email-raw",
        rawMessageKey: input.rawMessageKey,
        userId: input.userId,
      }),
      bucket: input.bucket,
      cryptoKey: input.key,
      cryptoKeysById: input.keysById,
      expectedKeyId: input.keyId,
      key,
      scope: "email-raw",
    });

    if (payload) {
      return payload;
    }
  }

  return null;
}

export async function writeHostedEmailRawMessage(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  plaintext: Uint8Array;
  userId: string;
}): Promise<string> {
  const rawMessageKey = randomOpaqueToken(16);
  const key = await hostedEmailRawMessageObjectKey(input.key, input.userId, rawMessageKey);
  await writeEncryptedR2Payload({
    aad: buildHostedStorageAad({
      key,
      purpose: "email-raw",
      rawMessageKey,
      userId: input.userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    key,
    keyId: input.keyId,
    plaintext: input.plaintext,
    scope: "email-raw",
  });
  return rawMessageKey;
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

  for (const key of await hostedEmailRawMessageObjectKeys(
    input.key,
    input.keysById,
    input.userId,
    input.rawMessageKey,
  )) {
    await input.bucket.delete(key);
  }
}

export async function readHostedEmailMessageBytes(
  input: HostedEmailWorkerRequest["raw"],
): Promise<Uint8Array> {
  if (typeof input === "string") {
    return new TextEncoder().encode(input);
  }

  if (input instanceof Uint8Array) {
    return input;
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  return await readHostedEmailReadableStream(input);
}

async function readHostedEmailReadableStream(
  stream: ReadableStream<Uint8Array>,
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

  return `transient/hosted-email/messages/${userSegment}/${messageSegment}.eml`;
}

async function hostedEmailRawMessageObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
  rawMessageKey: string,
): Promise<string[]> {
  return Promise.all(
    listHostedStorageRootKeys(rootKey, keysById).map((candidateRootKey) =>
      hostedEmailRawMessageObjectKey(candidateRootKey, userId, rawMessageKey)
    ),
  ).then((keys) => [...new Set(keys)]);
}

function listHostedStorageRootKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
): Uint8Array[] {
  const seen = new Set<string>();
  const unique: Uint8Array[] = [];

  for (const key of [rootKey, ...Object.values(keysById ?? {})]) {
    const signature = [...key].join(",");

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    unique.push(key);
  }

  return unique;
}

function randomOpaqueToken(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

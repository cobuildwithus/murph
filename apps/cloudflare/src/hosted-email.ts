/**
 * Public hosted email surface. Routing, config normalization, and outbound send
 * preparation live in smaller feature modules; this file keeps raw-message I/O
 * and the shared worker request shape together.
 */

import type { R2BucketLike } from "./bundle-store.ts";
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
  isHostedEmailPublicSenderAddress,
  reconcileHostedEmailVerifiedSenderRoute,
  resolveHostedEmailDirectSenderRoute,
  resolveHostedEmailIngressRoute,
  resolveHostedEmailInboundRoute,
} from "./hosted-email/routes.ts";
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
  return readEncryptedR2Payload({
    bucket: input.bucket,
    cryptoKey: input.key,
    cryptoKeysById: input.keysById,
    expectedKeyId: input.keyId,
    key: hostedEmailRawMessageObjectKey(input.userId, input.rawMessageKey),
  });
}

export async function writeHostedEmailRawMessage(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  plaintext: Uint8Array;
  userId: string;
}): Promise<string> {
  const rawMessageKey = (await sha256Hex(input.plaintext)).slice(0, 32);
  await writeEncryptedR2Payload({
    bucket: input.bucket,
    cryptoKey: input.key,
    key: hostedEmailRawMessageObjectKey(input.userId, rawMessageKey),
    keyId: input.keyId,
    plaintext: input.plaintext,
  });
  return rawMessageKey;
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

function hostedEmailRawMessageObjectKey(userId: string, rawMessageKey: string): string {
  return `transient/hosted-email/messages/${encodeURIComponent(userId)}/${rawMessageKey}.eml`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

import {
  HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_ORIGIN,
  HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_PATH_PREFIX,
} from "@murphai/hosted-execution/runtime-control";
import {
  normalizeHostedExecutionBaseUrl,
} from "@murphai/hosted-execution/env";

import type {
  R2BucketLike,
} from "./bundle-store.ts";
import {
  buildHostedStorageAad,
} from "./crypto-context.ts";
import {
  readEncryptedR2Payload,
  writeEncryptedR2Payload,
} from "./crypto.ts";
import {
  hostedPrivateMediaObjectKey,
} from "./storage-paths.ts";

export {
  HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_ORIGIN as HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN,
  HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_PATH_PREFIX as HOSTED_PRIVATE_MEDIA_DELIVERY_PATH_PREFIX,
} from "@murphai/hosted-execution/runtime-control";

export const HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET_ENV =
  "HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET";
export const HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN_ENV = "CF_PUBLIC_BASE_URL";
export const HOSTED_PRIVATE_MEDIA_LIFETIME_SECONDS = 24 * 60 * 60;

const HOSTED_PRIVATE_MEDIA_CAPABILITY_CONTEXT =
  "murph.hosted.private-media.capability.v1";
const HOSTED_PRIVATE_MEDIA_STORAGE_CONTEXT =
  "murph.hosted.private-media.storage.v1";
const HOSTED_PRIVATE_MEDIA_STORAGE_KEY_ID = "private-media:v1";
const HOSTED_PRIVATE_MEDIA_TOKEN_PATTERN =
  /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{32,1024}$/u;
const HOSTED_PRIVATE_MEDIA_SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const HOSTED_PRIVATE_MEDIA_USER_ID_MAX_LENGTH = 512;
const HOSTED_PRIVATE_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const AES_GCM_IV_BYTES = 12;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export type HostedPrivateMediaContentType =
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export interface HostedPrivateMediaPublishInput {
  attemptId: string;
  bytes: Uint8Array;
  contentType: HostedPrivateMediaContentType;
  generation: string;
  userId: string;
}

export type HostedPrivateMediaPublishResult =
  | {
      expiresAt: string;
      ok: true;
      url: string;
    }
  | {
      ok: false;
      reason:
        | "not-configured"
        | "stage-failed"
        | "write-fence-rejected";
    };

interface HostedPrivateMediaCapabilityPayload {
  contentType: HostedPrivateMediaContentType;
  expiresAtUnixSeconds: number;
  sha256: string;
  sizeBytes: number;
  userId: string;
  version: 1;
}

export async function stageHostedPrivateMedia(input: {
  bucket: R2BucketLike;
  bytes: Uint8Array;
  capabilitySecret: string;
  contentType: HostedPrivateMediaContentType;
  deliveryOrigin: string;
  nowMs?: number;
  userId: string;
}): Promise<{
  expiresAt: string;
  objectKey: string;
  url: string;
}> {
  const userId = requireHostedPrivateMediaUserId(input.userId);
  const capabilitySecret = requireHostedPrivateMediaCapabilitySecret(
    input.capabilitySecret,
  );
  const bytes = requireHostedPrivateMediaBytes(input.bytes);
  const deliveryOrigin = requireHostedPrivateMediaDeliveryOrigin(
    input.deliveryOrigin,
  );
  if (!privateImageBytesMatchContentType(bytes, input.contentType)) {
    throw new TypeError("Hosted private media content type is invalid.");
  }
  const sha256 = await sha256Hex(bytes);
  const objectKey = await hostedPrivateMediaObjectKey({ sha256, userId });
  const nowUnixSeconds = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  let expiresAtUnixSeconds =
    nowUnixSeconds + HOSTED_PRIVATE_MEDIA_LIFETIME_SECONDS;
  const storageKey = await deriveHostedPrivateMediaStorageKey({
    capabilitySecret,
    userId,
  });
  const aad = createHostedPrivateMediaAad({
    contentType: input.contentType,
    objectKey,
    sha256,
    sizeBytes: bytes.byteLength,
    userId,
  });
  const existing = await readEncryptedR2Payload({
    aad,
    bucket: input.bucket,
    callerLabel: "Hosted private media envelope",
    cryptoKey: storageKey,
    expectedKeyId: HOSTED_PRIVATE_MEDIA_STORAGE_KEY_ID,
    key: objectKey,
    scope: "private-media",
  });
  let refreshExistingObject = false;
  if (existing) {
    if (
      existing.byteLength !== bytes.byteLength
      || await sha256Hex(existing) !== sha256
    ) {
      throw new Error("Hosted private media retry identity is inconsistent.");
    }

    const object = input.bucket.head
      ? await input.bucket.head(objectKey)
      : null;
    const uploadedAtUnixSeconds = object?.uploaded instanceof Date
      && Number.isFinite(object.uploaded.getTime())
      ? Math.floor(object.uploaded.getTime() / 1_000)
      : null;
    const lifecycleExpiresAtUnixSeconds = uploadedAtUnixSeconds === null
      ? null
      : uploadedAtUnixSeconds + HOSTED_PRIVATE_MEDIA_LIFETIME_SECONDS;
    if (
      lifecycleExpiresAtUnixSeconds === null
      || lifecycleExpiresAtUnixSeconds <= nowUnixSeconds
    ) {
      refreshExistingObject = true;
    } else {
      expiresAtUnixSeconds = Math.min(
        expiresAtUnixSeconds,
        lifecycleExpiresAtUnixSeconds,
      );
    }
  }

  const capability = await sealHostedPrivateMediaCapability({
    capabilitySecret,
    payload: {
      contentType: input.contentType,
      expiresAtUnixSeconds,
      sha256,
      sizeBytes: bytes.byteLength,
      userId,
      version: 1,
    },
  });

  if (!existing || refreshExistingObject) {
    await writeEncryptedR2Payload({
      aad,
      bucket: input.bucket,
      cryptoKey: storageKey,
      key: objectKey,
      keyId: HOSTED_PRIVATE_MEDIA_STORAGE_KEY_ID,
      plaintext: bytes,
      scope: "private-media",
    });
  }

  const url = new URL(
    `${HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_PATH_PREFIX}${capability}`,
    deliveryOrigin,
  );
  url.searchParams.set("exp", String(expiresAtUnixSeconds));

  return {
    expiresAt: new Date(expiresAtUnixSeconds * 1_000).toISOString(),
    objectKey,
    url: url.toString(),
  };
}

export function readHostedPrivateMediaDeliveryOrigin(
  source: Readonly<Record<string, unknown>>,
): string {
  return requireHostedPrivateMediaDeliveryOrigin(
    typeof source[HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN_ENV] === "string"
      ? source[HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN_ENV]
      : HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_ORIGIN,
  );
}

function requireHostedPrivateMediaDeliveryOrigin(value: string): string {
  const origin = normalizeHostedExecutionBaseUrl(value, {
    allowHttpLocalhost: true,
    requireOriginOnly: true,
  });
  if (!origin) {
    throw new TypeError("Hosted private media delivery origin is required.");
  }
  return origin;
}

export async function readHostedPrivateMedia(input: {
  bucket: R2BucketLike;
  capability: string;
  capabilitySecret: string;
  expiresAtUnixSeconds: number;
  nowMs?: number;
}): Promise<{
  bytes: Uint8Array;
  contentType: HostedPrivateMediaContentType;
} | null> {
  try {
    const capabilitySecret = requireHostedPrivateMediaCapabilitySecret(
      input.capabilitySecret,
    );
    const expiresAtUnixSeconds = requirePositiveSafeInteger(
      input.expiresAtUnixSeconds,
      "Hosted private media URL expiry",
    );
    const nowUnixSeconds = Math.floor((input.nowMs ?? Date.now()) / 1_000);
    if (expiresAtUnixSeconds <= nowUnixSeconds) {
      return null;
    }
    const payload = await openHostedPrivateMediaCapability({
      capability: input.capability,
      capabilitySecret,
    });
    if (payload.expiresAtUnixSeconds !== expiresAtUnixSeconds) {
      return null;
    }
    const objectKey = await hostedPrivateMediaObjectKey({
      sha256: payload.sha256,
      userId: payload.userId,
    });
    const storageKey = await deriveHostedPrivateMediaStorageKey({
      capabilitySecret,
      userId: payload.userId,
    });
    const bytes = await readEncryptedR2Payload({
      aad: createHostedPrivateMediaAad({
        contentType: payload.contentType,
        objectKey,
        sha256: payload.sha256,
        sizeBytes: payload.sizeBytes,
        userId: payload.userId,
      }),
      bucket: input.bucket,
      callerLabel: "Hosted private media envelope",
      cryptoKey: storageKey,
      expectedKeyId: HOSTED_PRIVATE_MEDIA_STORAGE_KEY_ID,
      key: objectKey,
      scope: "private-media",
    });
    if (
      !bytes
      || bytes.byteLength !== payload.sizeBytes
      || await sha256Hex(bytes) !== payload.sha256
      || !privateImageBytesMatchContentType(bytes, payload.contentType)
    ) {
      return null;
    }
    return {
      bytes,
      contentType: payload.contentType,
    };
  } catch {
    return null;
  }
}

export function matchHostedPrivateMediaCapabilityPath(
  pathname: string,
): string | null {
  if (!pathname.startsWith(HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_PATH_PREFIX)) {
    return null;
  }
  const capability = pathname.slice(
    HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_PATH_PREFIX.length,
  );
  return HOSTED_PRIVATE_MEDIA_TOKEN_PATTERN.test(capability)
    ? capability
    : null;
}

export function readHostedPrivateMediaCapabilitySecret(
  source: Readonly<Record<string, unknown>>,
): string | null {
  const value = source[HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET_ENV];
  return typeof value === "string" && value.trim().length >= 32
    ? value.trim()
    : null;
}

function createHostedPrivateMediaAad(input: {
  contentType: HostedPrivateMediaContentType;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  userId: string;
}): Uint8Array {
  return buildHostedStorageAad({
    contentType: input.contentType,
    objectKey: input.objectKey,
    purpose: "private-media",
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    userId: input.userId,
  });
}

async function sealHostedPrivateMediaCapability(input: {
  capabilitySecret: string;
  payload: HostedPrivateMediaCapabilityPayload;
}): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const key = await deriveHostedPrivateMediaCapabilityKey(
    input.capabilitySecret,
  );
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {
      additionalData: textEncoder.encode(HOSTED_PRIVATE_MEDIA_CAPABILITY_CONTEXT),
      iv,
      name: "AES-GCM",
    },
    key,
    textEncoder.encode(JSON.stringify(input.payload)),
  ));
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(ciphertext)}`;
}

async function openHostedPrivateMediaCapability(input: {
  capability: string;
  capabilitySecret: string;
}): Promise<HostedPrivateMediaCapabilityPayload> {
  if (!HOSTED_PRIVATE_MEDIA_TOKEN_PATTERN.test(input.capability)) {
    throw new TypeError("Hosted private media capability is invalid.");
  }
  const [, encodedIv, encodedCiphertext] = input.capability.split(".");
  const iv = decodeBase64Url(encodedIv ?? "");
  const ciphertext = decodeBase64Url(encodedCiphertext ?? "");
  if (iv.byteLength !== AES_GCM_IV_BYTES) {
    throw new TypeError("Hosted private media capability is invalid.");
  }
  const key = await deriveHostedPrivateMediaCapabilityKey(
    input.capabilitySecret,
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: textEncoder.encode(HOSTED_PRIVATE_MEDIA_CAPABILITY_CONTEXT),
      iv: copyBytesToArrayBuffer(iv),
      name: "AES-GCM",
    },
    key,
    copyBytesToArrayBuffer(ciphertext),
  );
  return parseHostedPrivateMediaCapabilityPayload(
    JSON.parse(textDecoder.decode(plaintext)),
  );
}

function parseHostedPrivateMediaCapabilityPayload(
  value: unknown,
): HostedPrivateMediaCapabilityPayload {
  if (!isObjectRecord(value)) {
    throw new TypeError("Hosted private media capability payload is invalid.");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 6
    || !keys.every((key) =>
      [
        "contentType",
        "expiresAtUnixSeconds",
        "sha256",
        "sizeBytes",
        "userId",
        "version",
      ].includes(key)
    )
    || value.version !== 1
    || !isHostedPrivateMediaContentType(value.contentType)
    || typeof value.sha256 !== "string"
    || !HOSTED_PRIVATE_MEDIA_SHA256_PATTERN.test(value.sha256)
  ) {
    throw new TypeError("Hosted private media capability payload is invalid.");
  }
  return {
    contentType: value.contentType,
    expiresAtUnixSeconds: requirePositiveSafeInteger(
      value.expiresAtUnixSeconds,
      "Hosted private media capability expiry",
    ),
    sha256: value.sha256,
    sizeBytes: requirePositiveSafeInteger(
      value.sizeBytes,
      "Hosted private media capability byte count",
    ),
    userId: requireHostedPrivateMediaUserId(value.userId),
    version: 1,
  };
}

async function deriveHostedPrivateMediaCapabilityKey(
  capabilitySecret: string,
): Promise<CryptoKey> {
  const keyBytes = await deriveSecretBytes(
    capabilitySecret,
    HOSTED_PRIVATE_MEDIA_CAPABILITY_CONTEXT,
  );
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "decrypt",
    "encrypt",
  ]);
}

async function deriveHostedPrivateMediaStorageKey(input: {
  capabilitySecret: string;
  userId: string;
}): Promise<Uint8Array> {
  return new Uint8Array(await deriveSecretBytes(
    input.capabilitySecret,
    `${HOSTED_PRIVATE_MEDIA_STORAGE_CONTEXT}\0${input.userId}`,
  ));
}

async function deriveSecretBytes(
  secret: string,
  context: string,
): Promise<ArrayBuffer> {
  return crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`${context}\0${secret}`),
  );
}

function requireHostedPrivateMediaCapabilitySecret(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 32) {
    throw new TypeError("Hosted private media capability secret is invalid.");
  }
  return normalized;
}

function requireHostedPrivateMediaUserId(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Hosted private media userId is invalid.");
  }
  const normalized = value.trim();
  if (
    normalized.length === 0
    || normalized.length > HOSTED_PRIVATE_MEDIA_USER_ID_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new TypeError("Hosted private media userId is invalid.");
  }
  return normalized;
}

function requireHostedPrivateMediaBytes(value: Uint8Array): Uint8Array {
  if (
    !(value instanceof Uint8Array)
    || value.byteLength === 0
    || value.byteLength > HOSTED_PRIVATE_MEDIA_MAX_BYTES
  ) {
    throw new RangeError("Hosted private media byte count is invalid.");
  }
  return Uint8Array.from(value);
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
  ) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function isHostedPrivateMediaContentType(
  value: unknown,
): value is HostedPrivateMediaContentType {
  return value === "image/jpeg"
    || value === "image/png"
    || value === "image/webp";
}

function privateImageBytesMatchContentType(
  bytes: Uint8Array,
  contentType: HostedPrivateMediaContentType,
): boolean {
  switch (contentType) {
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8
        && bytes[bytes.length - 2] === 0xff
        && bytes[bytes.length - 1] === 0xd9;
    case "image/png":
      return bytes[0] === 0x89 && bytes[1] === 0x50
        && bytes[2] === 0x4e && bytes[3] === 0x47
        && bytes[4] === 0x0d && bytes[5] === 0x0a
        && bytes[6] === 0x1a && bytes[7] === 0x0a;
    case "image/webp":
      return bytes[0] === 0x52 && bytes[1] === 0x49
        && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45
        && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  ));
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError("Hosted private media capability is invalid.");
  }
  const padding = (4 - (value.length % 4)) % 4;
  const normalized = value
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    + "=".repeat(padding);
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value);
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

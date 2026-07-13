import {
  HOSTED_EXECUTION_MEAL_PHOTO_MAX_BYTES,
} from "@murphai/hosted-execution/contracts";

import type { R2BucketLike } from "./bundle-store.ts";
import { buildHostedStorageAad } from "./crypto-context.ts";
import {
  readEncryptedR2Payload,
  writeEncryptedR2Payload,
} from "./crypto.ts";
import {
  hostedMealPhotoObjectKey,
} from "./storage-paths.ts";

export const HOSTED_MEAL_PHOTO_CONTENT_TYPE = "image/jpeg";
export const HOSTED_MEAL_PHOTO_MAX_BYTES = HOSTED_EXECUTION_MEAL_PHOTO_MAX_BYTES;

const HOSTED_MEAL_PHOTO_KEY_SALT = "murph.hosted.meal-photo-key.v1";
const HOSTED_MEAL_PHOTO_CAPTURE_ID_PATTERN = /^[a-f0-9]{64}$/u;
const HOSTED_MEAL_PHOTO_KEY_PATTERN = /^[a-f0-9]{40}$/u;
const HOSTED_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface HostedMealPhotoStageResult {
  byteLength: number;
  mealPhotoKey: string;
  sha256: string;
}

export interface HostedMealPhotoStore {
  deleteMealPhoto(mealPhotoKey: string): Promise<void>;
  readMealPhoto(mealPhotoKey: string): Promise<Uint8Array | null>;
  stageMealPhoto(input: {
    bytes: Uint8Array;
    captureId: string;
    sha256: string;
  }): Promise<HostedMealPhotoStageResult>;
}

export function createHostedMealPhotoStore(input: {
  bucket: R2BucketLike;
  keysById?: Readonly<Record<string, Uint8Array>>;
  resolveRootKeyById?: (keyId: string) => Promise<Uint8Array | null>;
  rootKey: Uint8Array;
  rootKeyId: string;
  storageNamespaceId?: string | null;
  userId: string;
}): HostedMealPhotoStore {
  const userId = requireNonEmptyString(input.userId, "Hosted meal photo userId");
  const rootKeyId = requireNonEmptyString(
    input.rootKeyId,
    "Hosted meal photo rootKeyId",
  );

  return {
    async deleteMealPhoto(mealPhotoKey) {
      const objectKey = await resolveObjectKey(mealPhotoKey);
      if (!input.bucket.delete) {
        throw new Error("Hosted meal photo deletion is unavailable.");
      }
      await input.bucket.delete(objectKey);
    },
    async readMealPhoto(mealPhotoKey) {
      const normalizedKey = requireHostedMealPhotoKey(mealPhotoKey);
      const objectKey = await resolveObjectKey(normalizedKey);
      return await readEncryptedR2Payload({
        aad: createHostedMealPhotoAad({
          mealPhotoKey: normalizedKey,
          objectKey,
          userId,
        }),
        bucket: input.bucket,
        callerLabel: "Hosted meal photo envelope",
        cryptoKey: input.rootKey,
        cryptoKeysById: input.keysById,
        expectedKeyId: rootKeyId,
        key: objectKey,
        resolveCryptoKeyById: input.resolveRootKeyById,
        scope: "meal-photo",
      });
    },
    async stageMealPhoto(stageInput) {
      const bytes = requireHostedMealPhotoBytes(stageInput.bytes);
      const captureId = requireHostedMealPhotoCaptureId(stageInput.captureId);
      const sha256 = requireHostedMealPhotoSha256(stageInput.sha256);
      const actualSha256 = await sha256Hex(bytes);
      if (actualSha256 !== sha256) {
        throw new TypeError("Hosted meal photo sha256 must match the JPEG bytes.");
      }
      const mealPhotoKey = await deriveHostedMealPhotoKey({
        captureId,
        sha256,
        userId,
      });
      const objectKey = await resolveObjectKey(mealPhotoKey);
      await writeEncryptedR2Payload({
        aad: createHostedMealPhotoAad({ mealPhotoKey, objectKey, userId }),
        bucket: input.bucket,
        cryptoKey: input.rootKey,
        key: objectKey,
        keyId: rootKeyId,
        plaintext: bytes,
        scope: "meal-photo",
      });

      return {
        byteLength: bytes.byteLength,
        mealPhotoKey,
        sha256,
      };
    },
  };

  async function resolveObjectKey(mealPhotoKey: string): Promise<string> {
    return await hostedMealPhotoObjectKey({
      mealPhotoKey: requireHostedMealPhotoKey(mealPhotoKey),
      storageNamespaceId: input.storageNamespaceId,
      userId,
    });
  }
}

export function requireHostedMealPhotoKey(value: string): string {
  const normalized = requireNonEmptyString(value, "Hosted meal photo key");
  if (!HOSTED_MEAL_PHOTO_KEY_PATTERN.test(normalized)) {
    throw new TypeError(
      "Hosted meal photo key must be a 40-character lowercase hexadecimal string.",
    );
  }
  return normalized;
}

export function requireHostedMealPhotoSha256(value: string): string {
  const normalized = requireNonEmptyString(value, "Hosted meal photo sha256");
  if (!HOSTED_SHA256_PATTERN.test(normalized)) {
    throw new TypeError(
      "Hosted meal photo sha256 must be a 64-character lowercase hexadecimal string.",
    );
  }
  return normalized;
}

export function requireHostedMealPhotoCaptureId(value: string): string {
  const normalized = requireNonEmptyString(value, "Hosted meal photo captureId");
  if (!HOSTED_MEAL_PHOTO_CAPTURE_ID_PATTERN.test(normalized)) {
    throw new TypeError(
      "Hosted meal photo captureId must be a 64-character lowercase hexadecimal string.",
    );
  }
  return normalized;
}

export function requireHostedMealPhotoBytes(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError("Hosted meal photo bytes must be a Uint8Array.");
  }
  if (value.byteLength === 0 || value.byteLength > HOSTED_MEAL_PHOTO_MAX_BYTES) {
    throw new RangeError(
      `Hosted meal photo must contain between 1 and ${HOSTED_MEAL_PHOTO_MAX_BYTES} bytes.`,
    );
  }
  if (
    value.byteLength < 4
    || value[0] !== 0xff
    || value[1] !== 0xd8
    || value[value.byteLength - 2] !== 0xff
    || value[value.byteLength - 1] !== 0xd9
  ) {
    throw new TypeError("Hosted meal photo must be a complete JPEG image.");
  }
  return Uint8Array.from(value);
}

function createHostedMealPhotoAad(input: {
  mealPhotoKey: string;
  objectKey: string;
  userId: string;
}): Uint8Array {
  return buildHostedStorageAad({
    mealPhotoKey: input.mealPhotoKey,
    objectKey: input.objectKey,
    purpose: "meal-photo",
    userId: input.userId,
  });
}

async function deriveHostedMealPhotoKey(input: {
  captureId: string;
  sha256: string;
  userId: string;
}): Promise<string> {
  const digest = await sha256Hex(new TextEncoder().encode([
    HOSTED_MEAL_PHOTO_KEY_SALT,
    input.userId,
    input.captureId,
    input.sha256,
  ].join("\0")));
  return digest.slice(0, 40);
}

function requireNonEmptyString(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${label} must not be blank.`);
  }
  return normalized;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ),
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

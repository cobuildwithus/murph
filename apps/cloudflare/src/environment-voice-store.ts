import {
  HOSTED_EXECUTION_ENVIRONMENT_VOICE_MAX_BYTES,
} from "@murphai/hosted-execution/contracts";

import type { R2BucketLike } from "./bundle-store.ts";
import { buildHostedStorageAad } from "./crypto-context.ts";
import {
  readEncryptedR2Payload,
  writeEncryptedR2Payload,
} from "./crypto.ts";
import { hostedEnvironmentVoiceObjectKey } from "./storage-paths.ts";

export const HOSTED_ENVIRONMENT_VOICE_MAX_BYTES =
  HOSTED_EXECUTION_ENVIRONMENT_VOICE_MAX_BYTES;

const HOSTED_ENVIRONMENT_VOICE_KEY_SALT =
  "murph.hosted.environment-voice-key.v1";
const HOSTED_CAPTURE_ID_PATTERN = /^[a-f0-9]{64}$/u;
const HOSTED_ENVIRONMENT_VOICE_KEY_PATTERN = /^[a-f0-9]{40}$/u;
const HOSTED_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface HostedEnvironmentVoiceStageResult {
  audioKey: string;
  byteLength: number;
  sha256: string;
}

export interface HostedEnvironmentVoiceStore {
  deleteAudio(audioKey: string): Promise<void>;
  readAudio(audioKey: string): Promise<Uint8Array | null>;
  stageAudio(input: {
    bytes: Uint8Array;
    captureId: string;
    sha256: string;
  }): Promise<HostedEnvironmentVoiceStageResult>;
}

export function createHostedEnvironmentVoiceStore(input: {
  bucket: R2BucketLike;
  keysById?: Readonly<Record<string, Uint8Array>>;
  resolveRootKeyById?: (keyId: string) => Promise<Uint8Array | null>;
  rootKey: Uint8Array;
  rootKeyId: string;
  storageNamespaceId?: string | null;
  userId: string;
}): HostedEnvironmentVoiceStore {
  const userId = requireNonEmptyString(
    input.userId,
    "Hosted environment voice userId",
  );
  const rootKeyId = requireNonEmptyString(
    input.rootKeyId,
    "Hosted environment voice rootKeyId",
  );

  const resolveObjectKey = async (audioKey: string): Promise<string> =>
    await hostedEnvironmentVoiceObjectKey({
      audioKey: requireHostedEnvironmentVoiceKey(audioKey),
      storageNamespaceId: input.storageNamespaceId,
      userId,
    });

  return {
    async deleteAudio(audioKey) {
      await deleteHostedEnvironmentVoiceObject({
        audioKey,
        bucket: input.bucket,
        storageNamespaceId: input.storageNamespaceId,
        userId,
      });
    },
    async readAudio(audioKey) {
      const normalizedKey = requireHostedEnvironmentVoiceKey(audioKey);
      const objectKey = await resolveObjectKey(normalizedKey);
      return await readEncryptedR2Payload({
        aad: createHostedEnvironmentVoiceAad({
          audioKey: normalizedKey,
          objectKey,
          userId,
        }),
        bucket: input.bucket,
        callerLabel: "Hosted environment voice envelope",
        cryptoKey: input.rootKey,
        cryptoKeysById: input.keysById,
        expectedKeyId: rootKeyId,
        key: objectKey,
        resolveCryptoKeyById: input.resolveRootKeyById,
        scope: "environment-voice",
      });
    },
    async stageAudio(stageInput) {
      const bytes = requireHostedEnvironmentVoiceBytes(stageInput.bytes);
      const captureId = requireHostedEnvironmentVoiceCaptureId(
        stageInput.captureId,
      );
      const sha256 = requireHostedEnvironmentVoiceSha256(stageInput.sha256);
      if (await sha256Hex(bytes) !== sha256) {
        throw new TypeError(
          "Hosted environment voice sha256 must match the audio bytes.",
        );
      }
      const audioKey = await deriveHostedEnvironmentVoiceKey({
        attemptId: crypto.randomUUID(),
        captureId,
        sha256,
        userId,
      });
      const objectKey = await resolveObjectKey(audioKey);
      await writeEncryptedR2Payload({
        aad: createHostedEnvironmentVoiceAad({
          audioKey,
          objectKey,
          userId,
        }),
        bucket: input.bucket,
        cryptoKey: input.rootKey,
        key: objectKey,
        keyId: rootKeyId,
        plaintext: bytes,
        scope: "environment-voice",
      });
      return {
        audioKey,
        byteLength: bytes.byteLength,
        sha256,
      };
    },
  };
}

export async function deleteHostedEnvironmentVoiceObject(input: {
  audioKey: string;
  bucket: R2BucketLike;
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<void> {
  if (!input.bucket.delete) {
    throw new Error("Hosted environment voice deletion is unavailable.");
  }
  await input.bucket.delete(
    await hostedEnvironmentVoiceObjectKey({
      audioKey: requireHostedEnvironmentVoiceKey(input.audioKey),
      storageNamespaceId: input.storageNamespaceId,
      userId: requireNonEmptyString(
        input.userId,
        "Hosted environment voice userId",
      ),
    }),
  );
}

export function requireHostedEnvironmentVoiceKey(value: string): string {
  const normalized = requireNonEmptyString(
    value,
    "Hosted environment voice key",
  );
  if (!HOSTED_ENVIRONMENT_VOICE_KEY_PATTERN.test(normalized)) {
    throw new TypeError(
      "Hosted environment voice key must be a 40-character lowercase hexadecimal string.",
    );
  }
  return normalized;
}

export function requireHostedEnvironmentVoiceCaptureId(value: string): string {
  const normalized = requireNonEmptyString(
    value,
    "Hosted environment voice captureId",
  );
  if (!HOSTED_CAPTURE_ID_PATTERN.test(normalized)) {
    throw new TypeError(
      "Hosted environment voice captureId must be a 64-character lowercase hexadecimal string.",
    );
  }
  return normalized;
}

export function requireHostedEnvironmentVoiceSha256(value: string): string {
  const normalized = requireNonEmptyString(
    value,
    "Hosted environment voice sha256",
  );
  if (!HOSTED_SHA256_PATTERN.test(normalized)) {
    throw new TypeError(
      "Hosted environment voice sha256 must be a 64-character lowercase hexadecimal string.",
    );
  }
  return normalized;
}

export function requireHostedEnvironmentVoiceBytes(
  value: Uint8Array,
): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError("Hosted environment voice bytes must be a Uint8Array.");
  }
  if (
    value.byteLength === 0
    || value.byteLength > HOSTED_ENVIRONMENT_VOICE_MAX_BYTES
  ) {
    throw new RangeError(
      `Hosted environment voice must contain between 1 and ${HOSTED_ENVIRONMENT_VOICE_MAX_BYTES} bytes.`,
    );
  }
  return Uint8Array.from(value);
}

function createHostedEnvironmentVoiceAad(input: {
  audioKey: string;
  objectKey: string;
  userId: string;
}): Uint8Array {
  return buildHostedStorageAad({
    audioKey: input.audioKey,
    objectKey: input.objectKey,
    purpose: "environment-voice",
    userId: input.userId,
  });
}

async function deriveHostedEnvironmentVoiceKey(input: {
  attemptId: string;
  captureId: string;
  sha256: string;
  userId: string;
}): Promise<string> {
  const digest = await sha256Hex(
    new TextEncoder().encode(
      [
        HOSTED_ENVIRONMENT_VOICE_KEY_SALT,
        input.userId,
        input.captureId,
        input.sha256,
        input.attemptId,
      ].join("\0"),
    ),
  );
  return digest.slice(0, 40);
}

function requireNonEmptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

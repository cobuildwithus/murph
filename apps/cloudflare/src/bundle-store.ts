import { createHash } from "node:crypto";

import type { HostedExecutionBundleKind, HostedExecutionBundleRef } from "@healthybob/runtime-state";

import {
  readEncryptedR2Payload,
  writeEncryptedR2Payload,
  type EncryptedR2BucketLike,
} from "./crypto.js";

export interface R2BucketLike extends EncryptedR2BucketLike {
  delete?(key: string): Promise<void>;
}

export interface HostedBundleStore {
  readBundle(userId: string, kind: HostedExecutionBundleKind): Promise<Uint8Array | null>;
  writeBundle(
    userId: string,
    kind: HostedExecutionBundleKind,
    plaintext: Uint8Array,
  ): Promise<HostedExecutionBundleRef>;
}

export interface HostedUserEnvStore {
  clearUserEnv(userId: string): Promise<void>;
  readUserEnv(userId: string): Promise<Uint8Array | null>;
  writeUserEnv(userId: string, plaintext: Uint8Array): Promise<void>;
}

export function createHostedBundleStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
}): HostedBundleStore {
  return {
    async readBundle(userId, kind) {
      return readEncryptedR2Payload({
        bucket: input.bucket,
        cryptoKey: input.key,
        key: bundleObjectKey(userId, kind),
      });
    },

    async writeBundle(userId, kind, plaintext) {
      const key = bundleObjectKey(userId, kind);
      await writeEncryptedR2Payload({
        bucket: input.bucket,
        cryptoKey: input.key,
        key,
        keyId: input.keyId,
        plaintext,
      });

      return {
        hash: sha256Hex(plaintext),
        key,
        size: plaintext.byteLength,
        updatedAt: new Date().toISOString(),
      };
    },
  };
}

export function createHostedUserEnvStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
}): HostedUserEnvStore {
  return {
    async clearUserEnv(userId) {
      await input.bucket.delete?.(userEnvObjectKey(userId));
    },

    async readUserEnv(userId) {
      return readEncryptedR2Payload({
        bucket: input.bucket,
        cryptoKey: input.key,
        key: userEnvObjectKey(userId),
      });
    },

    async writeUserEnv(userId, plaintext) {
      await writeEncryptedR2Payload({
        bucket: input.bucket,
        cryptoKey: input.key,
        key: userEnvObjectKey(userId),
        keyId: input.keyId,
        plaintext,
      });
    },
  };
}

function bundleObjectKey(userId: string, kind: HostedExecutionBundleKind): string {
  return `users/${encodeURIComponent(userId)}/${kind}.bundle.json`;
}

function userEnvObjectKey(userId: string): string {
  return `users/${encodeURIComponent(userId)}/user-env.json`;
}

function sha256Hex(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

import { createHash } from "node:crypto";

import type { HostedExecutionBundleKind, HostedExecutionBundleRef } from "@murph/runtime-state";

import {
  readEncryptedR2Payload,
  writeEncryptedR2Payload,
  type EncryptedR2BucketLike,
} from "./crypto.js";

export interface R2BucketLike extends EncryptedR2BucketLike {
  delete?(key: string): Promise<void>;
}

export interface HostedBundleStore {
  readBundle(ref: HostedExecutionBundleRef | null): Promise<Uint8Array | null>;
  writeBundle(kind: HostedExecutionBundleKind, plaintext: Uint8Array): Promise<HostedExecutionBundleRef>;
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
    async readBundle(ref) {
      if (!ref) {
        return null;
      }

      return readEncryptedR2Payload({
        bucket: input.bucket,
        cryptoKey: input.key,
        key: ref.key,
      });
    },

    async writeBundle(kind, plaintext) {
      const hash = sha256Hex(plaintext);
      const key = bundleObjectKey(kind, hash);
      await writeEncryptedR2Payload({
        bucket: input.bucket,
        cryptoKey: input.key,
        key,
        keyId: input.keyId,
        plaintext,
      });

      return {
        hash,
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

function bundleObjectKey(kind: HostedExecutionBundleKind, hash: string): string {
  return `bundles/${kind}/${hash}.bundle.json`;
}

function userEnvObjectKey(userId: string): string {
  return `users/${encodeURIComponent(userId)}/user-env.json`;
}

function sha256Hex(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

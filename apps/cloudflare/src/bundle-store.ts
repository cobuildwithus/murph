import { createHash } from "node:crypto";

import type { HostedExecutionBundleKind, HostedExecutionBundleRef } from "@healthybob/runtime-state";

import { decryptHostedBundle, encryptHostedBundle } from "./crypto.js";

export interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2BucketLike {
  delete?(key: string): Promise<void>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(key: string, value: string): Promise<void>;
}

export interface HostedBundleStore {
  readBundle(userId: string, kind: HostedExecutionBundleKind): Promise<Uint8Array | null>;
  writeBundle(
    userId: string,
    kind: HostedExecutionBundleKind,
    plaintext: Uint8Array,
  ): Promise<HostedExecutionBundleRef>;
}

export function createHostedBundleStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
}): HostedBundleStore {
  return {
    async readBundle(userId, kind) {
      const object = await input.bucket.get(bundleObjectKey(userId, kind));

      if (!object) {
        return null;
      }

      return decryptHostedBundle({
        envelope: JSON.parse(Buffer.from(await object.arrayBuffer()).toString("utf8")),
        key: input.key,
      });
    },

    async writeBundle(userId, kind, plaintext) {
      const envelope = await encryptHostedBundle({
        key: input.key,
        keyId: input.keyId,
        plaintext,
      });
      const key = bundleObjectKey(userId, kind);
      const payloadText = JSON.stringify(envelope);

      await input.bucket.put(key, payloadText);

      return {
        hash: sha256Hex(plaintext),
        key,
        size: plaintext.byteLength,
        updatedAt: new Date().toISOString(),
      };
    },
  };
}

function bundleObjectKey(userId: string, kind: HostedExecutionBundleKind): string {
  return `users/${encodeURIComponent(userId)}/${kind}.bundle.json`;
}

function sha256Hex(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

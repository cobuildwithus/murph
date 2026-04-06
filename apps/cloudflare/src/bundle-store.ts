import {
  decodeHostedBundleBase64,
  sha256HostedBundleHex,
  sameHostedBundlePayloadRef,
  type HostedExecutionBundleKind,
  type HostedExecutionBundleRef,
  type HostedExecutionBundleRefIdentity,
} from "@murphai/runtime-state/node";

import {
  buildHostedStorageAad,
} from "./crypto-context.js";
import {
  hostedBundleObjectKey,
  hostedArtifactObjectKey,
  hostedArtifactObjectKeys,
  hostedUserEnvObjectKey,
  hostedUserEnvObjectKeys,
} from "./storage-paths.js";
import {
  readEncryptedR2Payload,
  writeEncryptedR2Payload,
  type EncryptedR2BucketLike,
} from "./crypto.js";

export interface R2BucketLike extends EncryptedR2BucketLike {
  delete?(key: string): Promise<void>;
  list?(input: {
    cursor?: string;
    limit?: number;
    prefix?: string;
  }): Promise<{
    cursor?: string;
    objects: Array<{ key: string }>;
    truncated: boolean;
  }>;
}

export interface HostedBundleStore {
  readBundle(ref: HostedExecutionBundleRef | null): Promise<Uint8Array | null>;
  writeBundle(kind: HostedExecutionBundleKind, plaintext: Uint8Array): Promise<HostedExecutionBundleRef>;
}

export interface HostedArtifactStore {
  deleteArtifact(sha256: string): Promise<void>;
  readArtifact(sha256: string): Promise<Uint8Array | null>;
  writeArtifact(sha256: string, plaintext: Uint8Array): Promise<void>;
}

export interface HostedUserEnvStore {
  clearUserEnv(userId: string): Promise<void>;
  readUserEnv(userId: string): Promise<Uint8Array | null>;
  writeUserEnv(userId: string, plaintext: Uint8Array): Promise<void>;
}

export function describeHostedBundleBytesRef(
  kind: HostedExecutionBundleKind,
  plaintext: Uint8Array,
): HostedExecutionBundleRefIdentity {
  const hash = sha256HostedBundleHex(plaintext);

  return {
    hash,
    key: pendingBundleRefKey(kind),
    size: plaintext.byteLength,
  };
}

export function describeHostedBase64BundleRef(input: {
  kind: HostedExecutionBundleKind;
  value: string | null;
}): {
  plaintext: Uint8Array;
  ref: HostedExecutionBundleRefIdentity;
} | null {
  if (input.value === null) {
    return null;
  }

  const plaintext = decodeHostedBundleBase64(input.value) ?? new Uint8Array();

  return {
    plaintext,
    ref: describeHostedBundleBytesRef(input.kind, plaintext),
  };
}

export async function writeHostedBundleBytesIfChanged(input: {
  bundleStore: HostedBundleStore;
  currentRef: HostedExecutionBundleRef | null;
  kind: HostedExecutionBundleKind;
  plaintext: Uint8Array;
}): Promise<HostedExecutionBundleRef> {
  const nextRef = describeHostedBundleBytesRef(input.kind, input.plaintext);

  if (sameHostedBundlePayloadRef(input.currentRef, nextRef)) {
    return input.currentRef!;
  }

  const writtenRef = await input.bundleStore.writeBundle(input.kind, input.plaintext);

  return {
    ...writtenRef,
    size: writtenRef.size ?? input.plaintext.byteLength,
  };
}

export async function writeHostedBase64BundleIfChanged(input: {
  bundleStore: HostedBundleStore;
  currentRef: HostedExecutionBundleRef | null;
  kind: HostedExecutionBundleKind;
  value: string | null;
}): Promise<HostedExecutionBundleRef | null> {
  const decoded = describeHostedBase64BundleRef({
    kind: input.kind,
    value: input.value,
  });

  if (!decoded) {
    return null;
  }

  return writeHostedBundleBytesIfChanged({
    bundleStore: input.bundleStore,
    currentRef: input.currentRef,
    kind: input.kind,
    plaintext: decoded.plaintext,
  });
}

export function createHostedBundleStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedBundleStore {
  return {
    async readBundle(ref) {
      if (!ref) {
        return null;
      }

      const kind = inferBundleKindFromKey(ref.key);
      const plaintext = await readEncryptedR2Payload({
        aad: buildHostedStorageAad({
          hash: ref.hash,
          key: ref.key,
          kind,
          purpose: "bundle",
          size: ref.size,
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        key: ref.key,
        scope: "bundle",
      });

      if (!plaintext) {
        return null;
      }

      assertHostedBundleMatchesRef(ref, plaintext);
      return plaintext;
    },

    async writeBundle(kind, plaintext) {
      const hash = sha256HostedBundleHex(plaintext);
      const key = await hostedBundleObjectKey(input.key, kind, hash);
      await writeEncryptedR2Payload({
        aad: buildHostedStorageAad({
          hash,
          key,
          kind,
          purpose: "bundle",
          size: plaintext.byteLength,
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        key,
        keyId: input.keyId,
        plaintext,
        scope: "bundle",
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

export function createHostedArtifactStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): HostedArtifactStore {
  return {
    async deleteArtifact(sha256) {
      if (!input.bucket.delete) {
        return;
      }

      for (const key of await hostedArtifactObjectKeys(
        input.key,
        input.keysById,
        input.userId,
        sha256,
      )) {
        await input.bucket.delete(key);
      }
    },

    async readArtifact(sha256) {
      for (const key of await hostedArtifactObjectKeys(
        input.key,
        input.keysById,
        input.userId,
        sha256,
      )) {
        const payload = await readEncryptedR2Payload({
          aad: buildHostedStorageAad({
            key,
            purpose: "artifact",
            sha256,
            userId: input.userId,
          }),
          bucket: input.bucket,
          cryptoKey: input.key,
          cryptoKeysById: input.keysById,
          expectedKeyId: input.keyId,
          key,
          scope: "artifact",
        });

        if (payload) {
          return payload;
        }
      }

      return null;
    },

    async writeArtifact(sha256, plaintext) {
      const key = await hostedArtifactObjectKey(input.key, input.userId, sha256);
      await assertHostedArtifactHash(plaintext, sha256);
      await writeEncryptedR2Payload({
        aad: buildHostedStorageAad({
          key,
          purpose: "artifact",
          sha256,
          userId: input.userId,
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        key,
        keyId: input.keyId,
        plaintext,
        scope: "artifact",
      });
    },
  };
}

export function createHostedUserEnvStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedUserEnvStore {
  return {
    async clearUserEnv(userId) {
      if (!input.bucket.delete) {
        return;
      }

      for (const key of await hostedUserEnvObjectKeys(input.key, input.keysById, userId)) {
        await input.bucket.delete(key);
      }
    },

    async readUserEnv(userId) {
      for (const key of await hostedUserEnvObjectKeys(input.key, input.keysById, userId)) {
        const payload = await readEncryptedR2Payload({
          aad: buildHostedStorageAad({
            key,
            purpose: "user-env",
            userId,
          }),
          bucket: input.bucket,
          cryptoKey: input.key,
          cryptoKeysById: input.keysById,
          expectedKeyId: input.keyId,
          key,
          scope: "user-env",
        });

        if (payload) {
          return payload;
        }
      }

      return null;
    },

    async writeUserEnv(userId, plaintext) {
      const key = await hostedUserEnvObjectKey(input.key, userId);
      await writeEncryptedR2Payload({
        aad: buildHostedStorageAad({
          key,
          purpose: "user-env",
          userId,
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        key,
        keyId: input.keyId,
        plaintext,
        scope: "user-env",
      });
    },
  };
}

function pendingBundleRefKey(kind: HostedExecutionBundleKind): string {
  return `pending/${kind}/candidate`;
}

function inferBundleKindFromKey(key: string): HostedExecutionBundleKind {
  if (key.startsWith("bundles/vault/")) {
    return "vault";
  }

  throw new Error(`Hosted bundle key ${key} does not encode a recognized bundle kind.`);
}

function assertHostedBundleMatchesRef(
  ref: HostedExecutionBundleRef,
  plaintext: Uint8Array,
): void {
  if (plaintext.byteLength !== ref.size) {
    throw new Error(
      `Hosted bundle ${ref.key} size mismatch: expected ${ref.size}, got ${plaintext.byteLength}.`,
    );
  }

  const actualHash = sha256HostedBundleHex(plaintext);
  if (actualHash !== ref.hash) {
    throw new Error(
      `Hosted bundle ${ref.key} hash mismatch: expected ${ref.hash}, got ${actualHash}.`,
    );
  }
}

async function assertHostedArtifactHash(plaintext: Uint8Array, expectedSha256: string): Promise<void> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      plaintext.buffer.slice(
        plaintext.byteOffset,
        plaintext.byteOffset + plaintext.byteLength,
      ) as ArrayBuffer,
    ),
  );
  const actualSha256 = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (actualSha256 !== expectedSha256) {
    throw new Error(`Hosted artifact hash mismatch: expected ${expectedSha256}, got ${actualSha256}.`);
  }
}

import {
  decodeHostedBundleBase64,
  sha256HostedBundleHex,
  sameHostedBundlePayloadRef,
  type HostedExecutionBundleKind,
  type HostedExecutionBundleRef,
  type HostedExecutionBundleRefIdentity,
} from "@murphai/runtime-state/node";

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
    key: bundleObjectKey(kind, hash),
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

      const plaintext = await readEncryptedR2Payload({
        bucket: input.bucket,
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        key: ref.key,
      });

      if (!plaintext) {
        return null;
      }

      assertHostedBundleMatchesRef(ref, plaintext);
      return plaintext;
    },

    async writeBundle(kind, plaintext) {
      const hash = sha256HostedBundleHex(plaintext);
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

export function createHostedArtifactStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): HostedArtifactStore {
  return {
    async deleteArtifact(sha256) {
      await input.bucket.delete?.(artifactObjectKey(input.userId, sha256));
    },

    async readArtifact(sha256) {
      const plaintext = await readEncryptedR2Payload({
        bucket: input.bucket,
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        key: artifactObjectKey(input.userId, sha256),
      });

      if (!plaintext) {
        return null;
      }

      const actualSha256 = sha256HostedBundleHex(plaintext);
      if (actualSha256 !== sha256) {
        throw new Error(`Hosted artifact hash mismatch: expected ${sha256}, got ${actualSha256}.`);
      }

      return plaintext;
    },

    async writeArtifact(sha256, plaintext) {
      const actualSha256 = sha256HostedBundleHex(plaintext);
      if (actualSha256 !== sha256) {
        throw new Error(`Hosted artifact hash mismatch: expected ${sha256}, got ${actualSha256}.`);
      }

      await writeEncryptedR2Payload({
        bucket: input.bucket,
        cryptoKey: input.key,
        key: artifactObjectKey(input.userId, sha256),
        keyId: input.keyId,
        plaintext,
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
      await input.bucket.delete?.(userEnvObjectKey(userId));
    },

    async readUserEnv(userId) {
      return readEncryptedR2Payload({
        bucket: input.bucket,
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
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

export function bundleObjectKey(kind: HostedExecutionBundleKind, hash: string): string {
  return `bundles/${kind}/${hash}.bundle.json`;
}

export function artifactObjectKey(userId: string, sha256: string): string {
  return `users/${encodeURIComponent(userId)}/artifacts/${sha256}.artifact.bin`;
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

function userEnvObjectKey(userId: string): string {
  return `users/${encodeURIComponent(userId)}/user-env.json`;
}

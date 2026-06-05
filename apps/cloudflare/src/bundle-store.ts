import {
  decodeHostedBundleBase64,
  sha256HostedBundleHex,
  sameHostedBundlePayloadRef,
  type HostedExecutionBundleKind,
  type HostedExecutionBundleRef,
  type HostedExecutionBundleRefIdentity,
} from "@murphai/runtime-state/node/hosted-bundle-codec";

import {
  buildHostedStorageAad,
} from "./crypto-context.js";
import {
  hostedBundleObjectKey,
  hostedBundleUserPrefix,
  hostedArtifactObjectKey,
  isUserScopedHostedBundleObjectKey,
  hostedRunnerSecretsObjectKey,
} from "./storage-paths.js";
import {
  readEncryptedR2Payload,
  writeEncryptedR2Payload,
  type EncryptedR2ObjectBodyLike,
  type EncryptedR2BucketLike,
} from "./crypto.js";

export interface R2BucketLike extends EncryptedR2BucketLike {
  delete?(key: string | string[]): Promise<void>;
  head?(key: string): Promise<Omit<EncryptedR2ObjectBodyLike, "arrayBuffer" | "body"> | null>;
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
  deleteBundle(ref: HostedExecutionBundleRef | null): Promise<void>;
  readBundle(ref: HostedExecutionBundleRef | null): Promise<Uint8Array | null>;
  writeBundle(kind: HostedExecutionBundleKind, plaintext: Uint8Array): Promise<HostedExecutionBundleRef>;
}

export interface HostedArtifactStore {
  deleteArtifact(sha256: string): Promise<void>;
  readArtifact(sha256: string): Promise<Uint8Array | null>;
  writeArtifact(sha256: string, plaintext: Uint8Array): Promise<void>;
}

export class MissingHostedBundleError extends Error {
  constructor(readonly ref: HostedExecutionBundleRef) {
    super(`Hosted ${inferBundleKindFromKey(ref.key)} bundle ${ref.key} is missing from R2.`);
    this.name = "MissingHostedBundleError";
  }
}

export function isMissingHostedBundleError(error: unknown): error is MissingHostedBundleError {
  return error instanceof MissingHostedBundleError;
}

export function isStoredHostedBundleObjectKey(key: string): boolean {
  return /^users\/[a-z0-9][a-z0-9_-]{3,63}\/bundles\/vault\/[0-9a-f]{48}\.bundle\.json$/u.test(key)
    || /^users\/bundles\/[0-9a-f]{24}\/vault\/[0-9a-f]{48}\.bundle\.json$/u.test(key)
    || /^bundles\/vault\/[0-9a-f]{48}\.bundle\.json$/u.test(key);
}

export interface HostedRunnerSecretsReader {
  readRunnerSecrets(userId: string): Promise<Uint8Array | null>;
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
  resolveKeyById?: (keyId: string) => Promise<Uint8Array | null>;
  userId?: string | null;
}): HostedBundleStore {
  return {
    async deleteBundle(ref) {
      if (!ref || !input.bucket.delete || !isUserScopedHostedBundleObjectKey(ref.key)) {
        return;
      }

      await assertHostedBundleOwnedByUser(input, ref);

      await input.bucket.delete(ref.key);
    },

    async readBundle(ref) {
      if (!ref) {
        return null;
      }

      await assertHostedBundleOwnedByUser(input, ref);

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
        callerLabel: "Hosted bundle envelope",
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        resolveCryptoKeyById: input.resolveKeyById,
        key: ref.key,
        scope: "bundle",
      });

      if (!plaintext) {
        throw new MissingHostedBundleError(ref);
      }

      assertHostedBundleMatchesRef(ref, plaintext);
      return plaintext;
    },

    async writeBundle(kind, plaintext) {
      const hash = sha256HostedBundleHex(plaintext);
      const key = await hostedBundleObjectKey({
        hash,
        kind,
        userId: input.userId ?? null,
      });
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

async function assertHostedBundleOwnedByUser(
  input: {
    userId?: string | null;
  },
  ref: HostedExecutionBundleRef,
): Promise<void> {
  if (!input.userId || !isUserScopedHostedBundleObjectKey(ref.key)) {
    return;
  }

  const expectedPrefix = await hostedBundleUserPrefix({ userId: input.userId });
  if (!ref.key.startsWith(expectedPrefix)) {
    throw new Error(`Hosted bundle ${ref.key} is outside the bound user bundle namespace.`);
  }
}

export function createHostedArtifactStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  resolveKeyById?: (keyId: string) => Promise<Uint8Array | null>;
  userId: string;
}): HostedArtifactStore {
  return {
    async deleteArtifact(sha256) {
      if (!input.bucket.delete) {
        return;
      }

      const key = await hostedArtifactObjectKey({
        sha256,
        userId: input.userId,
      });
      await input.bucket.delete(key);
    },

    async readArtifact(sha256) {
      const key = await hostedArtifactObjectKey({
        sha256,
        userId: input.userId,
      });
      return readEncryptedR2Payload({
        aad: buildHostedStorageAad({
          key,
          purpose: "artifact",
          sha256,
          userId: input.userId,
        }),
        bucket: input.bucket,
        callerLabel: "Hosted artifact envelope",
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        resolveCryptoKeyById: input.resolveKeyById,
        key,
        scope: "artifact",
      });
    },

    async writeArtifact(sha256, plaintext) {
      const key = await hostedArtifactObjectKey({
        sha256,
        userId: input.userId,
      });
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

export function createHostedRunnerSecretsReader(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  resolveKeyById?: (keyId: string) => Promise<Uint8Array | null>;
}): HostedRunnerSecretsReader {
  return {
    async readRunnerSecrets(userId) {
      const key = await hostedRunnerSecretsObjectKey({ userId });
      return readEncryptedR2Payload({
        aad: buildHostedStorageAad({
          key,
          purpose: "runner-secrets",
          userId,
        }),
        bucket: input.bucket,
        callerLabel: "Hosted runner secrets envelope",
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        resolveCryptoKeyById: input.resolveKeyById,
        key,
        scope: "runner-secrets",
      });
    },
  };
}

function pendingBundleRefKey(kind: HostedExecutionBundleKind): string {
  return `pending/${kind}/candidate`;
}

function inferBundleKindFromKey(key: string): HostedExecutionBundleKind {
  const userScopedMatch = /^users\/[a-z0-9][a-z0-9_-]{3,63}\/bundles\/([^/]+)\//u.exec(key)
    ?? /^users\/bundles\/[0-9a-f]{24}\/([^/]+)\//u.exec(key);
  if (userScopedMatch?.[1] === "vault") {
    return "vault";
  }

  if (/^bundles\/vault\/[0-9a-f]{48}\.bundle\.json$/u.test(key)) {
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

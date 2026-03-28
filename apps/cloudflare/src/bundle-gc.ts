import {
  listHostedBundleArtifacts,
  type HostedExecutionBundleRef,
} from "@murph/runtime-state";

import {
  createHostedArtifactStore,
  createHostedBundleStore,
  type R2BucketLike,
} from "./bundle-store.js";

export class HostedBundleGarbageCollector {
  constructor(
    private readonly bucket: R2BucketLike,
    private readonly bundleEncryptionKey: Uint8Array,
    private readonly bundleEncryptionKeyId: string,
    private readonly bundleEncryptionKeysById?: Readonly<Record<string, Uint8Array>>,
  ) {}

  async cleanupBundleTransition(input: {
    nextBundleRefs: {
      agentState: HostedExecutionBundleRef | null;
      vault: HostedExecutionBundleRef | null;
    };
    previousBundleRefs: {
      agentState: HostedExecutionBundleRef | null;
      vault: HostedExecutionBundleRef | null;
    };
    userId: string;
  }): Promise<void> {
    if (!this.bucket.delete) {
      return;
    }

    const bundleStore = createHostedBundleStore({
      bucket: this.bucket,
      key: this.bundleEncryptionKey,
      keyId: this.bundleEncryptionKeyId,
      keysById: this.bundleEncryptionKeysById,
    });

    await this.cleanupRemovedArtifacts({
      bundleStore,
      nextVaultRef: input.nextBundleRefs.vault,
      previousVaultRef: input.previousBundleRefs.vault,
      userId: input.userId,
    });
  }

  private async cleanupRemovedArtifacts(input: {
    bundleStore: ReturnType<typeof createHostedBundleStore>;
    nextVaultRef: HostedExecutionBundleRef | null;
    previousVaultRef: HostedExecutionBundleRef | null;
    userId: string;
  }): Promise<void> {
    if (sameBundleRef(input.previousVaultRef, input.nextVaultRef)) {
      return;
    }

    const previousArtifacts = await this.readArtifactHashes(
      input.bundleStore,
      input.previousVaultRef,
    );
    if (previousArtifacts.size === 0) {
      return;
    }

    const nextArtifacts = await this.readArtifactHashes(
      input.bundleStore,
      input.nextVaultRef,
    );
    const artifactStore = createHostedArtifactStore({
      bucket: this.bucket,
      key: this.bundleEncryptionKey,
      keyId: this.bundleEncryptionKeyId,
      keysById: this.bundleEncryptionKeysById,
      userId: input.userId,
    });

    await Promise.all(
      [...previousArtifacts]
        .filter((sha256) => !nextArtifacts.has(sha256))
        .map((sha256) => artifactStore.deleteArtifact(sha256)),
    );
  }

  private async readArtifactHashes(
    bundleStore: ReturnType<typeof createHostedBundleStore>,
    ref: HostedExecutionBundleRef | null,
  ): Promise<Set<string>> {
    if (!ref) {
      return new Set();
    }

    const bytes = await bundleStore.readBundle(ref);
    if (!bytes) {
      return new Set();
    }

    return new Set(
      listHostedBundleArtifacts({
        bytes,
        expectedKind: "vault",
      }).map((artifact) => artifact.ref.sha256),
    );
  }
}

function sameBundleRef(
  left: {
    hash: string;
    key: string;
    size: number;
    updatedAt: string;
  } | null,
  right: {
    hash: string;
    key: string;
    size: number;
    updatedAt: string;
  } | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.hash === right.hash
    && left.key === right.key
    && left.size === right.size
    && left.updatedAt === right.updatedAt
  );
}

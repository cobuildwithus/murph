import {
  listHostedBundleArtifacts,
  sameHostedBundlePayloadRef,
} from "@murphai/runtime-state/node/hosted-bundle-codec";
import type { HostedExecutionBundleRef } from "@murphai/hosted-execution/contracts";

import {
  createHostedArtifactStore,
  createHostedBundleStore,
  isMissingHostedBundleError,
  isStoredHostedBundleObjectKey,
  type R2BucketLike,
} from "./bundle-store.js";

export class HostedBundleGarbageCollector {
  constructor(
    private readonly bucket: R2BucketLike,
    private readonly platformEnvelopeKey: Uint8Array,
    private readonly platformEnvelopeKeyId: string,
    private readonly platformEnvelopeKeysById?: Readonly<Record<string, Uint8Array>>,
  ) {}

  async cleanupBundleTransition(input: {
    nextBundleRef: HostedExecutionBundleRef | null;
    previousBundleRef: HostedExecutionBundleRef | null;
    userId: string;
  }): Promise<void> {
    if (!this.bucket.delete) {
      return;
    }

    if (sameHostedBundlePayloadRef(input.previousBundleRef, input.nextBundleRef)) {
      return;
    }

    const bundleStore = createHostedBundleStore({
      bucket: this.bucket,
      key: this.platformEnvelopeKey,
      keyId: this.platformEnvelopeKeyId,
      keysById: this.platformEnvelopeKeysById,
      userId: input.userId,
    });

    await this.cleanupRemovedArtifacts({
      bundleStore,
      nextBundleRef: input.nextBundleRef,
      previousBundleRef: input.previousBundleRef,
      userId: input.userId,
    });
    await bundleStore.deleteBundle(input.previousBundleRef);
  }

  private async cleanupRemovedArtifacts(input: {
    bundleStore: ReturnType<typeof createHostedBundleStore>;
    nextBundleRef: HostedExecutionBundleRef | null;
    previousBundleRef: HostedExecutionBundleRef | null;
    userId: string;
  }): Promise<void> {
    if (sameHostedBundlePayloadRef(input.previousBundleRef, input.nextBundleRef)) {
      return;
    }

    const previousArtifacts = await this.readArtifactHashes(
      input.bundleStore,
      input.previousBundleRef,
      {
        failIfMissing: false,
        failIfUnreadable: false,
      },
    );
    const nextArtifacts = await this.readArtifactHashes(
      input.bundleStore,
      input.nextBundleRef,
      {
        failIfMissing: input.nextBundleRef !== null,
        failIfUnreadable: input.nextBundleRef !== null,
      },
    );
    if (previousArtifacts.size === 0) {
      return;
    }
    const artifactStore = createHostedArtifactStore({
      bucket: this.bucket,
      key: this.platformEnvelopeKey,
      keyId: this.platformEnvelopeKeyId,
      keysById: this.platformEnvelopeKeysById,
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
    options: {
      failIfUnreadable?: boolean;
      failIfMissing?: boolean;
    } = {},
  ): Promise<Set<string>> {
    if (!ref) {
      return new Set();
    }

    if (!isStoredHostedBundleObjectKey(ref.key)) {
      return new Set();
    }

    let bytes: Uint8Array | null;
    try {
      bytes = await bundleStore.readBundle(ref);
    } catch (error) {
      if (!options.failIfMissing && isMissingHostedBundleError(error)) {
        return new Set();
      }
      if (!options.failIfUnreadable) {
        return new Set();
      }
      throw error;
    }

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

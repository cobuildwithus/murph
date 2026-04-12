import {
  listHostedBundleArtifacts,
  sameHostedBundlePayloadRef,
} from "@murphai/runtime-state/node";
import type { HostedExecutionBundleRef } from "@murphai/hosted-execution/contracts";

import {
  createHostedArtifactStore,
  createHostedBundleStore,
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

    const bundleStore = createHostedBundleStore({
      bucket: this.bucket,
      key: this.platformEnvelopeKey,
      keyId: this.platformEnvelopeKeyId,
      keysById: this.platformEnvelopeKeysById,
    });

    await this.cleanupRemovedArtifacts({
      bundleStore,
      nextBundleRef: input.nextBundleRef,
      previousBundleRef: input.previousBundleRef,
      userId: input.userId,
    });
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
    );
    if (previousArtifacts.size === 0) {
      return;
    }

    const nextArtifacts = await this.readArtifactHashes(
      input.bundleStore,
      input.nextBundleRef,
    );
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

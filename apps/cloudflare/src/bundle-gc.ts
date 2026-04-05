import {
  listHostedBundleArtifacts,
  sameHostedBundlePayloadRef,
} from "@murphai/runtime-state/node";
import type { HostedExecutionBundleRefs } from "@murphai/hosted-execution";

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
    nextBundleRefs: HostedExecutionBundleRefs;
    previousBundleRefs: HostedExecutionBundleRefs;
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
      nextVaultRef: input.nextBundleRefs.vault,
      previousVaultRef: input.previousBundleRefs.vault,
      userId: input.userId,
    });
  }

  private async cleanupRemovedArtifacts(input: {
    bundleStore: ReturnType<typeof createHostedBundleStore>;
    nextVaultRef: HostedExecutionBundleRefs["vault"];
    previousVaultRef: HostedExecutionBundleRefs["vault"];
    userId: string;
  }): Promise<void> {
    if (sameHostedBundlePayloadRef(input.previousVaultRef, input.nextVaultRef)) {
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
    ref: HostedExecutionBundleRefs["vault"],
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

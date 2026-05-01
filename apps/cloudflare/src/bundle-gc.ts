import {
  sameHostedBundlePayloadRef,
} from "@murphai/runtime-state/node/hosted-bundle-codec";
import type { HostedExecutionBundleRef } from "@murphai/hosted-execution/contracts";

import {
  createHostedArtifactStore,
  createHostedBundleStore,
  isMissingHostedBundleError,
  isStoredHostedBundleObjectKey,
  MissingHostedBundleError,
  type R2BucketLike,
} from "./bundle-store.js";
import {
  HostedBundleArchiveValidationError,
  isHostedBundleArchiveValidationFailure,
  listHostedBundleArtifactsAsync,
} from "./hosted-bundle-validation.js";

export class HostedBundleGarbageCollector {
  constructor(
    private readonly bucket: R2BucketLike,
    private readonly runtimeRootKey: Uint8Array,
    private readonly runtimeRootKeyId: string,
    private readonly runtimeRootKeysById?: Readonly<Record<string, Uint8Array>>,
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
      key: this.runtimeRootKey,
      keyId: this.runtimeRootKeyId,
      keysById: this.runtimeRootKeysById,
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
      key: this.runtimeRootKey,
      keyId: this.runtimeRootKeyId,
      keysById: this.runtimeRootKeysById,
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
      if (isHostedBundleArchiveValidationFailure(error)) {
        throw new HostedBundleArchiveValidationError({
          cause: error,
          operation: "cleanup-authoritative-next",
          ref,
        });
      }
      throw error;
    }

    if (!bytes && options.failIfMissing) {
      throw new MissingHostedBundleError(ref);
    }

    if (!bytes) {
      return new Set();
    }

    try {
      return new Set(
        (await listHostedBundleArtifactsAsync({
          bytes,
          expectedKind: "vault",
        })).map((artifact) => artifact.ref.sha256),
      );
    } catch (error) {
      if (!isHostedBundleArchiveValidationFailure(error)) {
        throw error;
      }
      if (!options.failIfUnreadable) {
        return new Set();
      }

      throw new HostedBundleArchiveValidationError({
        cause: error,
        operation: "cleanup-authoritative-next",
        ref,
      });
    }
  }
}

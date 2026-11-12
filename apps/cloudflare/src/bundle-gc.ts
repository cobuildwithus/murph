import type { HostedExecutionBundleRef } from "@murphai/hosted-execution/contracts";
import {
  createHostedArtifactStore,
  createHostedBundleStore,
  isStoredHostedBundleObjectKey,
  type R2BucketLike,
} from "./bundle-store.ts";
import {
  isHostedBundleArchiveValidationFailure,
  listHostedBundleArtifactsAsync,
} from "./hosted-bundle-validation.ts";

/** Retired legacy snapshots only. Current snapshots own their cleanup separately. */
export async function deleteLegacyHostedBundle(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  ref: HostedExecutionBundleRef;
  userId: string;
}): Promise<void> {
  if (!input.bucket.delete) {
    return;
  }
  const bundleStore = createHostedBundleStore(input);
  // Missing or unreadable retired bundles must not block deleting their object.
  // Without readable evidence, leave their unknown artifacts to member cleanup.
  const bytes = isStoredHostedBundleObjectKey(input.ref.key)
    ? await bundleStore.readBundle(input.ref).catch(() => null)
    : null;
  if (bytes) {
    const artifacts = await listHostedBundleArtifactsAsync({ bytes, expectedKind: "vault" })
      .catch((error) => {
        if (!isHostedBundleArchiveValidationFailure(error)) throw error;
        return [];
      });
    const artifactStore = createHostedArtifactStore(input);
    await Promise.all(
      [...new Set(artifacts.map((artifact) => artifact.ref.sha256))]
        .map((sha256) => artifactStore.deleteArtifact(sha256)),
    );
  }
  await bundleStore.deleteBundle(input.ref);
}

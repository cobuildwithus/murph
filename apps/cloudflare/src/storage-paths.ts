import type { HostedExecutionBundleKind } from "@murphai/runtime-state/node/hosted-bundle-codec";

import { deriveHostedStorageOpaqueId } from "./crypto-context.js";

export async function hostedBundleObjectKey(
  rootKey: Uint8Array,
  kind: HostedExecutionBundleKind,
  hash: string,
): Promise<string> {
  const bundleSegment = await deriveHostedStorageOpaqueId({
    length: 48,
    rootKey,
    scope: "bundle-path",
    value: `bundle:${kind}:${hash}`,
  });

  return `bundles/${kind}/${bundleSegment}.bundle.json`;
}

export async function hostedArtifactObjectKey(
  rootKey: Uint8Array,
  userId: string,
  sha256: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "artifact-path",
    value: `user:${userId}`,
  });
  const artifactSegment = await deriveHostedStorageOpaqueId({
    length: 48,
    rootKey,
    scope: "artifact-path",
    value: `artifact:${userId}:${sha256}`,
  });

  return `users/artifacts/${userSegment}/${artifactSegment}.artifact.bin`;
}

export async function hostedRunnerSecretsObjectKey(
  rootKey: Uint8Array,
  userId: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "runner-secrets-path",
    value: `user:${userId}`,
  });

  return `users/runner-secrets/${userSegment}.json`;
}

export async function hostedBrowserVaultSnapshotObjectKey(
  rootKey: Uint8Array,
  userId: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "browser-vault-snapshot-path",
    value: `user:${userId}`,
  });

  return `users/browser-vault-snapshots/${userSegment}.json`;
}

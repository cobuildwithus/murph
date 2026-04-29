import type { HostedExecutionBundleKind } from "@murphai/runtime-state/node/hosted-bundle-codec";

import { deriveHostedStorageOpaqueId } from "./crypto-context.js";

export async function hostedBundleObjectKey(
  rootKey: Uint8Array,
  kind: HostedExecutionBundleKind,
  hash: string,
  userId?: string | null,
): Promise<string> {
  if (typeof userId === "string" && userId.length > 0) {
    const userSegment = await deriveHostedBundleUserSegment(rootKey, userId);
    const bundleSegment = await deriveHostedStorageOpaqueId({
      length: 48,
      rootKey,
      scope: "bundle-path",
      value: `bundle:${userId}:${kind}:${hash}`,
    });

    return `users/bundles/${userSegment}/${kind}/${bundleSegment}.bundle.json`;
  }

  const bundleSegment = await deriveHostedStorageOpaqueId({
    length: 48,
    rootKey,
    scope: "bundle-path",
    value: `bundle:${kind}:${hash}`,
  });

  return `bundles/${kind}/${bundleSegment}.bundle.json`;
}

export function isUserScopedHostedBundleObjectKey(key: string): boolean {
  return /^users\/bundles\/[0-9a-f]{24}\/[^/]+\/[0-9a-f]{48}\.bundle\.json$/u.test(key);
}

export async function hostedBundleUserPrefix(
  rootKey: Uint8Array,
  userId: string,
): Promise<string> {
  return `users/bundles/${await deriveHostedBundleUserSegment(rootKey, userId)}/`;
}

export async function hostedArtifactObjectKey(
  rootKey: Uint8Array,
  userId: string,
  sha256: string,
): Promise<string> {
  const userSegment = await deriveHostedArtifactUserSegment(rootKey, userId);
  const artifactSegment = await deriveHostedStorageOpaqueId({
    length: 48,
    rootKey,
    scope: "artifact-path",
    value: `artifact:${userId}:${sha256}`,
  });

  return `users/artifacts/${userSegment}/${artifactSegment}.artifact.bin`;
}

export async function hostedArtifactUserPrefix(
  rootKey: Uint8Array,
  userId: string,
): Promise<string> {
  return `users/artifacts/${await deriveHostedArtifactUserSegment(rootKey, userId)}/`;
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

export async function hostedUserRootKeyEnvelopeObjectKey(
  envelopeEncryptionKey: Uint8Array,
  userId: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey: envelopeEncryptionKey,
    scope: "user-key-envelope-path",
    value: `user:${userId}`,
  });

  return `users/keys/${userSegment}.json`;
}

export async function hostedBrowserVaultReplicaObjectKey(input: {
  dataVersion: string;
  rootKey: Uint8Array;
  userId: string;
}): Promise<string> {
  const userSegment = await deriveHostedBrowserVaultReplicaUserSegment(input.rootKey, input.userId);
  const replicaSegment = await deriveHostedStorageOpaqueId({
    length: 48,
    rootKey: input.rootKey,
    scope: "browser-vault-replica-path",
    value: `replica:${input.userId}:${input.dataVersion}`,
  });

  return `users/browser-vault-replicas/${userSegment}/${replicaSegment}.json`;
}

export async function hostedBrowserVaultReplicaUserPrefix(input: {
  rootKey: Uint8Array;
  userId: string;
}): Promise<string> {
  return `users/browser-vault-replicas/${await deriveHostedBrowserVaultReplicaUserSegment(
    input.rootKey,
    input.userId,
  )}/`;
}

async function deriveHostedArtifactUserSegment(
  rootKey: Uint8Array,
  userId: string,
): Promise<string> {
  return deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "artifact-path",
    value: `user:${userId}`,
  });
}

async function deriveHostedBundleUserSegment(
  rootKey: Uint8Array,
  userId: string,
): Promise<string> {
  return deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "bundle-path",
    value: `user:${userId}`,
  });
}

async function deriveHostedBrowserVaultReplicaUserSegment(
  rootKey: Uint8Array,
  userId: string,
): Promise<string> {
  return deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "browser-vault-replica-path",
    value: `user:${userId}`,
  });
}

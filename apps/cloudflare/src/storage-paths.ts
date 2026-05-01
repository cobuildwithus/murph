import { createHash } from "node:crypto";

import type { HostedExecutionBundleKind } from "@murphai/runtime-state/node/hosted-bundle-codec";

type HostedStorageNamespaceInput = Uint8Array | string | null | undefined;

const HOSTED_STORAGE_NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{3,63}$/u;
const HOSTED_STORAGE_NAMESPACE_SALT = "murph.hosted.storage-namespace.v1";
const HOSTED_STORAGE_PATH_SALT = "murph.hosted.storage-path.v1";

export function createHostedStorageNamespaceId(userId: string): string {
  return `hsn_${digestHex(HOSTED_STORAGE_NAMESPACE_SALT, requireStoragePathString(userId, "Hosted storage userId")).slice(0, 24)}`;
}

export async function hostedBundleObjectKey(
  storageNamespace: HostedStorageNamespaceInput,
  kind: HostedExecutionBundleKind,
  hash: string,
  userId?: string | null,
): Promise<string> {
  if (typeof userId === "string" && userId.length > 0) {
    const userSegment = resolveHostedStorageNamespaceId(storageNamespace, userId);
    const bundleSegment = deriveHostedStoragePathId({
      length: 48,
      scope: "bundle-path",
      value: `bundle:${userSegment}:${kind}:${hash}`,
    });

    return `users/${userSegment}/bundles/${kind}/${bundleSegment}.bundle.json`;
  }

  const bundleSegment = deriveHostedStoragePathId({
    length: 48,
    scope: "bundle-path",
    value: `bundle:${kind}:${hash}`,
  });

  return `bundles/${kind}/${bundleSegment}.bundle.json`;
}

export function isUserScopedHostedBundleObjectKey(key: string): boolean {
  return /^users\/[a-z0-9][a-z0-9_-]{3,63}\/bundles\/[^/]+\/[0-9a-f]{48}\.bundle\.json$/u.test(key);
}

export async function hostedBundleUserPrefix(
  storageNamespace: HostedStorageNamespaceInput,
  userId: string,
): Promise<string> {
  return `users/${resolveHostedStorageNamespaceId(storageNamespace, userId)}/bundles/`;
}

export async function hostedArtifactObjectKey(
  storageNamespace: HostedStorageNamespaceInput,
  userId: string,
  sha256: string,
): Promise<string> {
  const userSegment = resolveHostedStorageNamespaceId(storageNamespace, userId);
  const artifactSegment = deriveHostedStoragePathId({
    length: 48,
    scope: "artifact-path",
    value: `artifact:${userSegment}:${sha256}`,
  });

  return `users/${userSegment}/artifacts/${artifactSegment}.artifact.bin`;
}

export async function hostedArtifactUserPrefix(
  storageNamespace: HostedStorageNamespaceInput,
  userId: string,
): Promise<string> {
  return `users/${resolveHostedStorageNamespaceId(storageNamespace, userId)}/artifacts/`;
}

export async function hostedRunnerSecretsObjectKey(
  storageNamespace: HostedStorageNamespaceInput,
  userId: string,
): Promise<string> {
  const userSegment = resolveHostedStorageNamespaceId(storageNamespace, userId);

  return `users/${userSegment}/runner-secrets.json`;
}

export async function hostedBrowserVaultReplicaObjectKey(input: {
  dataVersion: string;
  rootKey?: Uint8Array;
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  const userSegment = resolveHostedStorageNamespaceId(input.storageNamespaceId ?? input.rootKey, input.userId);
  const replicaSegment = deriveHostedStoragePathId({
    length: 48,
    scope: "browser-vault-replica-path",
    value: `replica:${userSegment}:${input.dataVersion}`,
  });

  return `users/${userSegment}/browser-vault-replicas/${replicaSegment}.json`;
}

export async function hostedBrowserVaultReplicaUserPrefix(input: {
  rootKey?: Uint8Array;
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  return `users/${resolveHostedStorageNamespaceId(input.storageNamespaceId ?? input.rootKey, input.userId)}/browser-vault-replicas/`;
}

function resolveHostedStorageNamespaceId(
  storageNamespace: HostedStorageNamespaceInput,
  userId: string,
): string {
  if (typeof storageNamespace === "string" && storageNamespace.trim().length > 0) {
    const normalized = storageNamespace.trim();
    if (!HOSTED_STORAGE_NAMESPACE_PATTERN.test(normalized)) {
      throw new TypeError("Hosted storage namespace id is invalid.");
    }
    return normalized;
  }

  void storageNamespace;
  return createHostedStorageNamespaceId(userId);
}

function deriveHostedStoragePathId(input: {
  length: number;
  scope: string;
  value: string;
}): string {
  return digestHex(HOSTED_STORAGE_PATH_SALT, input.scope, input.value).slice(0, input.length);
}

function digestHex(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part, "utf8");
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

function requireStoragePathString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return normalized;
}

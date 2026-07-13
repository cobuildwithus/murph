import { createHash } from "node:crypto";

import type { HostedExecutionBundleKind } from "@murphai/runtime-state/node/hosted-bundle-codec";

const HOSTED_STORAGE_NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{3,63}$/u;
const HOSTED_MEAL_PHOTO_KEY_PATTERN = /^[a-f0-9]{40}$/u;
const HOSTED_WORKSPACE_SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const HOSTED_STORAGE_NAMESPACE_SALT = "murph.hosted.storage-namespace.v1";
const HOSTED_STORAGE_PATH_SALT = "murph.hosted.storage-path.v1";

export function createHostedStorageNamespaceId(userId: string): string {
  return `hsn_${digestHex(HOSTED_STORAGE_NAMESPACE_SALT, requireStoragePathString(userId, "Hosted storage userId")).slice(0, 24)}`;
}

export async function hostedBundleObjectKey(input: {
  hash: string;
  kind: HostedExecutionBundleKind;
  storageNamespaceId?: string | null;
  userId?: string | null;
}): Promise<string> {
  if (typeof input.userId === "string" && input.userId.length > 0) {
    const userSegment = resolveHostedStorageNamespaceId({
      storageNamespaceId: input.storageNamespaceId,
      userId: input.userId,
    });
    const bundleSegment = deriveHostedStoragePathId({
      length: 48,
      scope: "bundle-path",
      value: `bundle:${userSegment}:${input.kind}:${input.hash}`,
    });

    return `users/${userSegment}/bundles/${input.kind}/${bundleSegment}.bundle.json`;
  }

  const bundleSegment = deriveHostedStoragePathId({
    length: 48,
    scope: "bundle-path",
    value: `bundle:${input.kind}:${input.hash}`,
  });

  return `bundles/${input.kind}/${bundleSegment}.bundle.json`;
}

export function isUserScopedHostedBundleObjectKey(key: string): boolean {
  return /^users\/[a-z0-9][a-z0-9_-]{3,63}\/bundles\/[^/]+\/[0-9a-f]{48}\.bundle\.json$/u.test(key);
}

export async function hostedBundleUserPrefix(input: {
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  return `users/${resolveHostedStorageNamespaceId(input)}/bundles/`;
}

export async function hostedArtifactObjectKey(input: {
  sha256: string;
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  const userSegment = resolveHostedStorageNamespaceId(input);
  const artifactSegment = deriveHostedStoragePathId({
    length: 48,
    scope: "artifact-path",
    value: `artifact:${userSegment}:${input.sha256}`,
  });

  return `users/${userSegment}/artifacts/${artifactSegment}.artifact.bin`;
}

export async function hostedArtifactUserPrefix(input: {
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  return `users/${resolveHostedStorageNamespaceId(input)}/artifacts/`;
}

export async function hostedRunnerSecretsObjectKey(input: {
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  const userSegment = resolveHostedStorageNamespaceId(input);

  return `users/${userSegment}/runner-secrets.json`;
}

export async function hostedEmailRawMessageObjectKey(input: {
  rawMessageKey: string;
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  const userSegment = resolveHostedStorageNamespaceId(input);
  const rawMessageKey = requireStoragePathString(
    input.rawMessageKey,
    "Hosted email raw message key",
  );
  const messageSegment = deriveHostedStoragePathId({
    length: 48,
    scope: "email-raw-path",
    value: `email-raw:${userSegment}:${rawMessageKey}`,
  });

  return `hosted-email/messages/${userSegment}/${messageSegment}.eml`;
}

export async function hostedEmailRawMessageUserPrefix(input: {
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  return `hosted-email/messages/${resolveHostedStorageNamespaceId(input)}/`;
}

export async function hostedMealPhotoObjectKey(input: {
  mealPhotoKey: string;
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  const userSegment = resolveHostedStorageNamespaceId(input);
  const mealPhotoKey = requireHostedMealPhotoKey(input.mealPhotoKey);
  const photoSegment = deriveHostedStoragePathId({
    length: 48,
    scope: "meal-photo-path",
    value: `meal-photo:${userSegment}:${mealPhotoKey}`,
  });

  return `hosted-meal-photos/images/${userSegment}/${photoSegment}.jpg.enc`;
}

export async function hostedMealPhotoUserPrefix(input: {
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  return `hosted-meal-photos/images/${resolveHostedStorageNamespaceId(input)}/`;
}

export async function hostedBrowserVaultReplicaObjectKey(input: {
  dataVersion: string;
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  const userSegment = resolveHostedStorageNamespaceId(input);
  const replicaSegment = deriveHostedStoragePathId({
    length: 48,
    scope: "browser-vault-replica-path",
    value: `replica:${userSegment}:${input.dataVersion}`,
  });

  return `users/${userSegment}/browser-vault-replicas/${replicaSegment}.json`;
}

export async function hostedBrowserVaultReplicaUserPrefix(input: {
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  return `users/${resolveHostedStorageNamespaceId(input)}/browser-vault-replicas/`;
}

export async function hostedWorkspaceSnapshotObjectKey(input: {
  snapshotId: string;
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  const userSegment = resolveHostedStorageNamespaceId(input);
  const snapshotId = requireHostedWorkspaceSnapshotId(input.snapshotId);

  return `users/${userSegment}/workspace-snapshots/${snapshotId}.snapshot.enc`;
}

export function isUserScopedHostedWorkspaceSnapshotObjectKey(key: string): boolean {
  return /^users\/[a-z0-9][a-z0-9_-]{3,63}\/workspace-snapshots\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.snapshot\.enc$/u.test(key);
}

export async function hostedWorkspaceSnapshotUserPrefix(input: {
  storageNamespaceId?: string | null;
  userId: string;
}): Promise<string> {
  return `users/${resolveHostedStorageNamespaceId(input)}/workspace-snapshots/`;
}

function resolveHostedStorageNamespaceId(input: { storageNamespaceId?: string | null; userId: string }): string {
  if (typeof input.storageNamespaceId === "string" && input.storageNamespaceId.trim().length > 0) {
    const normalized = input.storageNamespaceId.trim();
    if (!HOSTED_STORAGE_NAMESPACE_PATTERN.test(normalized)) {
      throw new TypeError("Hosted storage namespace id is invalid.");
    }
    return normalized;
  }

  return createHostedStorageNamespaceId(input.userId);
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

function requireHostedWorkspaceSnapshotId(value: string): string {
  const normalized = requireStoragePathString(value, "Hosted workspace snapshot id");
  if (!HOSTED_WORKSPACE_SNAPSHOT_ID_PATTERN.test(normalized)) {
    throw new TypeError("Hosted workspace snapshot id is invalid.");
  }
  return normalized;
}

function requireHostedMealPhotoKey(value: string): string {
  const normalized = requireStoragePathString(value, "Hosted meal photo key");
  if (!HOSTED_MEAL_PHOTO_KEY_PATTERN.test(normalized)) {
    throw new TypeError("Hosted meal photo key is invalid.");
  }
  return normalized;
}

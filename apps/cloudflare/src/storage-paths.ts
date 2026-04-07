import type { HostedExecutionBundleKind } from "@murphai/runtime-state/node";

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

export async function hostedUserEnvObjectKey(
  rootKey: Uint8Array,
  userId: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "user-env-path",
    value: `user:${userId}`,
  });

  return `users/env/${userSegment}.json`;
}

export async function hostedExecutionJournalObjectKey(
  rootKey: Uint8Array,
  userId: string,
  eventId: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "execution-journal-path",
    value: `user:${userId}`,
  });
  const eventSegment = await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey,
    scope: "execution-journal-path",
    value: `event:${userId}:${eventId}`,
  });

  return `transient/execution-journal/${userSegment}/${eventSegment}.json`;
}

export async function hostedSideEffectRecordKey(
  rootKey: Uint8Array,
  userId: string,
  effectId: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "side-effect-path",
    value: `user:${userId}`,
  });
  const effectSegment = await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey,
    scope: "side-effect-path",
    value: `effect:${userId}:${effectId}`,
  });

  return `transient/side-effects/${userSegment}/${effectSegment}.json`;
}

export async function hostedDispatchPayloadObjectKey(
  rootKey: Uint8Array,
  userId: string,
  eventId: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "dispatch-payload-path",
    value: `user:${userId}`,
  });
  const eventSegment = await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey,
    scope: "dispatch-payload-path",
    value: `event:${userId}:${eventId}`,
  });

  return `transient/dispatch-payloads/${userSegment}/${eventSegment}.json`;
}

export async function hostedDispatchPayloadObjectKeyForSignature(
  rootKey: Uint8Array,
  userId: string,
  eventId: string,
  signature: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "dispatch-payload-path",
    value: `user:${userId}`,
  });
  const payloadSegment = await deriveHostedStorageOpaqueId({
    length: 48,
    rootKey,
    scope: "dispatch-payload-path",
    value: `payload:${userId}:${eventId}:${signature}`,
  });

  return `transient/dispatch-payloads/${userSegment}/${payloadSegment}.json`;
}

export async function hostedSharePackObjectKey(
  rootKey: Uint8Array,
  userId: string,
  shareId: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "share-pack-path",
    value: `user:${userId}`,
  });
  const shareSegment = await deriveHostedStorageOpaqueId({
    length: 48,
    rootKey,
    scope: "share-pack-path",
    value: `share:${userId}:${shareId}`,
  });

  return `transient/share-packs/${userSegment}/${shareSegment}.json`;
}

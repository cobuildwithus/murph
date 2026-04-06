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

export async function hostedArtifactObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
  sha256: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    hostedArtifactObjectKey(candidateRootKey, userId, sha256)
  );
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

export async function hostedUserEnvObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    hostedUserEnvObjectKey(candidateRootKey, userId)
  );
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

export async function hostedExecutionJournalObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
  eventId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    hostedExecutionJournalObjectKey(candidateRootKey, userId, eventId)
  );
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

export async function hostedSideEffectRecordKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
  effectId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    hostedSideEffectRecordKey(candidateRootKey, userId, effectId)
  );
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


export async function hostedDispatchPayloadObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
  eventId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    hostedDispatchPayloadObjectKey(candidateRootKey, userId, eventId)
  );
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

export async function hostedSharePackObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
  shareId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    hostedSharePackObjectKey(candidateRootKey, userId, shareId)
  );
}

export async function listHostedStorageObjectKeys(
  rootKey: Uint8Array,
  _keysById: Readonly<Record<string, Uint8Array>> | undefined,
  mapKey: (candidateRootKey: Uint8Array) => Promise<string> | string,
): Promise<string[]> {
  return [await mapKey(rootKey)];
}

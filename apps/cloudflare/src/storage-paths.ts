import { deriveHostedStorageOpaqueId } from "./crypto-context.js";
import { encodeBase64 } from "./base64.js";

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

export function legacyHostedArtifactObjectKey(userId: string, sha256: string): string {
  return `users/${encodeURIComponent(userId)}/artifacts/${sha256}.artifact.bin`;
}

export async function hostedArtifactObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
  sha256: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(
    rootKey,
    keysById,
    (candidateRootKey) => hostedArtifactObjectKey(candidateRootKey, userId, sha256),
    legacyHostedArtifactObjectKey(userId, sha256),
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

export function legacyHostedUserEnvObjectKey(userId: string): string {
  return `users/${encodeURIComponent(userId)}/user-env.json`;
}

export async function hostedUserEnvObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(
    rootKey,
    keysById,
    (candidateRootKey) => hostedUserEnvObjectKey(candidateRootKey, userId),
    legacyHostedUserEnvObjectKey(userId),
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

export function legacyHostedExecutionJournalObjectKey(userId: string, eventId: string): string {
  return `transient/execution-journal/${encodeURIComponent(userId)}/${encodeURIComponent(eventId)}.json`;
}

export async function hostedExecutionJournalObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
  eventId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(
    rootKey,
    keysById,
    (candidateRootKey) => hostedExecutionJournalObjectKey(candidateRootKey, userId, eventId),
    legacyHostedExecutionJournalObjectKey(userId, eventId),
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

export function legacyHostedSideEffectRecordKey(userId: string, effectId: string): string {
  return `transient/side-effects/${encodeURIComponent(userId)}/${encodeURIComponent(effectId)}.json`;
}

export async function hostedSideEffectRecordKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
  effectId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(
    rootKey,
    keysById,
    (candidateRootKey) => hostedSideEffectRecordKey(candidateRootKey, userId, effectId),
    legacyHostedSideEffectRecordKey(userId, effectId),
  );
}

export async function listHostedStorageObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  mapKey: (candidateRootKey: Uint8Array) => Promise<string> | string,
  legacyKey?: string,
): Promise<string[]> {
  const keys = await Promise.all(
    listHostedStorageRootKeys(rootKey, keysById).map((candidateRootKey) => mapKey(candidateRootKey)),
  );

  return [...new Set(legacyKey ? [...keys, legacyKey] : keys)];
}

function listHostedStorageRootKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
): Uint8Array[] {
  const seen = new Set<string>();
  const unique: Uint8Array[] = [];

  for (const key of [rootKey, ...Object.values(keysById ?? {})]) {
    const signature = encodeBase64(key);

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    unique.push(key);
  }

  return unique;
}

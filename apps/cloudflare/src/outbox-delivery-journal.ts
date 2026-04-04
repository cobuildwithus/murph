import {
  parseHostedExecutionSideEffectRecord,
  sameHostedExecutionAssistantDelivery,
  sameHostedExecutionSideEffectIdentity,
  type HostedExecutionSideEffectRecord,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "./bundle-store.ts";
import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "./crypto-context.js";
import { listHostedStorageObjectKeys } from "./storage-paths.js";
import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "./crypto.js";

export class HostedExecutionSideEffectConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedExecutionSideEffectConflictError";
  }
}

export interface HostedExecutionSideEffectJournalStore {
  deletePrepared(input: {
    effectId: string;
    fingerprint: string;
    kind: HostedExecutionSideEffectRecord["kind"];
    userId: string;
  }): Promise<boolean>;
  read(input: {
    effectId: string;
    fingerprint: string;
    kind: HostedExecutionSideEffectRecord["kind"];
    userId: string;
  }): Promise<HostedExecutionSideEffectRecord | null>;
  write(input: {
    record: HostedExecutionSideEffectRecord;
    userId: string;
  }): Promise<HostedExecutionSideEffectRecord>;
}

export function createHostedExecutionSideEffectJournalStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): HostedExecutionSideEffectJournalStore {
  return {
    async deletePrepared(query) {
      const keys = await sideEffectRecordKeys(
        input.key,
        input.keysById,
        query.userId,
        query.effectId,
      );
      const existing = await readRecordAtKeys(input, keys, query.userId, query.effectId);

      if (!existing) {
        return false;
      }

      assertSideEffectQueryMatchesRecord(query, existing);
      if (existing.state !== "prepared") {
        return false;
      }

      if (!input.bucket.delete) {
        throw new Error("Hosted side-effect journal cleanup requires R2 delete support.");
      }

      for (const key of keys) {
        await input.bucket.delete(key);
      }
      return true;
    },

    async read(query) {
      const existing = await readRecordAtKeys(
        input,
        await sideEffectRecordKeys(input.key, input.keysById, query.userId, query.effectId),
        query.userId,
        query.effectId,
      );

      if (!existing) {
        return null;
      }

      assertSideEffectQueryMatchesRecord(query, existing);
      return existing;
    },

    async write(writeInput) {
      const record = parseHostedExecutionSideEffectRecord(writeInput.record);
      assertSideEffectRecordIsSelfConsistent(record);
      const key = await sideEffectRecordKey(input.key, writeInput.userId, record.effectId);
      const existing = await readRecordAtKeys(
        input,
        await sideEffectRecordKeys(input.key, input.keysById, writeInput.userId, record.effectId),
        writeInput.userId,
        record.effectId,
      );
      const durableRecord = mergeHostedExecutionSideEffectRecord(existing, record);

      if (durableRecord === existing) {
        return durableRecord;
      }

      await writeRecordAtKey(input, key, writeInput.userId, record.effectId, durableRecord);
      return durableRecord;
    },
  };
}

async function readRecordAtKey(
  input: {
    bucket: R2BucketLike;
    key: Uint8Array;
    keyId: string;
    keysById?: Readonly<Record<string, Uint8Array>>;
  },
  key: string,
  userId: string,
  effectId: string,
): Promise<HostedExecutionSideEffectRecord | null> {
  const value = await readEncryptedR2Json({
    aad: buildHostedStorageAad({
      effectId,
      key,
      purpose: "side-effect-journal",
      userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    cryptoKeysById: input.keysById,
    expectedKeyId: input.keyId,
    key,
    parse(value) {
      return value;
    },
    scope: "side-effect-journal",
  });

  if (!value) {
    return null;
  }

  return parseHostedExecutionSideEffectRecord(value);
}

async function readRecordAtKeys(
  input: {
    bucket: R2BucketLike;
    key: Uint8Array;
    keyId: string;
    keysById?: Readonly<Record<string, Uint8Array>>;
  },
  keys: string[],
  userId: string,
  effectId: string,
): Promise<HostedExecutionSideEffectRecord | null> {
  for (const key of keys) {
    const value = await readRecordAtKey(input, key, userId, effectId);

    if (value) {
      return value;
    }
  }

  return null;
}

async function writeRecordAtKey(
  input: {
    bucket: R2BucketLike;
    key: Uint8Array;
    keyId: string;
    keysById?: Readonly<Record<string, Uint8Array>>;
  },
  key: string,
  userId: string,
  effectId: string,
  value: HostedExecutionSideEffectRecord,
): Promise<void> {
  await writeEncryptedR2Json({
    aad: buildHostedStorageAad({
      effectId,
      key,
      purpose: "side-effect-journal",
      userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    key,
    keyId: input.keyId,
    scope: "side-effect-journal",
    value,
  });
}

async function sideEffectRecordKey(rootKey: Uint8Array, userId: string, effectId: string): Promise<string> {
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

async function sideEffectRecordKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  userId: string,
  effectId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    sideEffectRecordKey(candidateRootKey, userId, effectId)
  );
}

function assertSideEffectRecordIsSelfConsistent(
  record: HostedExecutionSideEffectRecord,
): void {
  if (record.effectId !== record.intentId) {
    throw new HostedExecutionSideEffectConflictError(
      `Hosted side effect ${record.effectId} must reuse the same intentId as effectId.`,
    );
  }
}

function assertSideEffectQueryMatchesRecord(
  query: {
    effectId: string;
    fingerprint: string;
    kind: HostedExecutionSideEffectRecord["kind"];
  },
  record: HostedExecutionSideEffectRecord,
): void {
  if (
    record.effectId === query.effectId
    && record.intentId === query.effectId
    && record.fingerprint === query.fingerprint
    && record.kind === query.kind
  ) {
    return;
  }

  throw new HostedExecutionSideEffectConflictError(
    `Hosted side effect ${query.effectId} does not match the stored side-effect identity.`,
  );
}

function mergeHostedExecutionSideEffectRecord(
  existing: HostedExecutionSideEffectRecord | null,
  next: HostedExecutionSideEffectRecord,
): HostedExecutionSideEffectRecord {
  if (!existing) {
    return next;
  }

  if (!sameHostedExecutionSideEffectIdentity(existing, next)) {
    throw new HostedExecutionSideEffectConflictError(
      `Hosted side effect ${next.effectId} cannot change identity after it has been recorded.`,
    );
  }

  if (existing.state === "sent") {
    if (next.state === "prepared") {
      return existing;
    }

    if (!sameHostedExecutionAssistantDelivery(existing.delivery, next.delivery)) {
      throw new HostedExecutionSideEffectConflictError(
        `Hosted side effect ${next.effectId} cannot change delivery details after it has been sent.`,
      );
    }

    return existing;
  }

  return next.state === "prepared" ? existing : next;
}

import {
  parseHostedExecutionSideEffectRecord,
  sameHostedExecutionAssistantDelivery,
  sameHostedExecutionSideEffectIdentity,
  type HostedExecutionSideEffectRecord,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "./bundle-store.ts";
import {
  buildHostedStorageAad,
} from "./crypto-context.js";
import {
  hostedSideEffectRecordKey,
} from "./storage-paths.js";
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

interface HostedExecutionSideEffectJournalContext {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
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

export function createHostedExecutionSideEffectJournalStore(
  input: HostedExecutionSideEffectJournalContext,
): HostedExecutionSideEffectJournalStore {
  return {
    async deletePrepared(query) {
      const objectKey = await hostedSideEffectRecordKey(input.key, query.userId, query.effectId);
      const existing = await readRecordAtKey(input, objectKey, query.userId, query.effectId);

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

      await input.bucket.delete(objectKey);
      return true;
    },

    async read(query) {
      const objectKey = await hostedSideEffectRecordKey(input.key, query.userId, query.effectId);
      const existing = await readRecordAtKey(input, objectKey, query.userId, query.effectId);

      if (!existing) {
        return null;
      }

      assertSideEffectQueryMatchesRecord(query, existing);
      return existing;
    },

    async write(writeInput) {
      const record = parseHostedExecutionSideEffectRecord(writeInput.record);
      assertSideEffectRecordIsSelfConsistent(record);
      const objectKey = await hostedSideEffectRecordKey(
        input.key,
        writeInput.userId,
        record.effectId,
      );
      const existing = await readRecordAtKey(
        input,
        objectKey,
        writeInput.userId,
        record.effectId,
      );
      const durableRecord = mergeHostedExecutionSideEffectRecord(existing, record);

      if (durableRecord === existing) {
        return durableRecord;
      }

      await writeRecordAtKey(
        input,
        objectKey,
        writeInput.userId,
        record.effectId,
        durableRecord,
      );
      return durableRecord;
    },
  };
}

async function readRecordAtKey(
  input: HostedExecutionSideEffectJournalContext,
  objectKey: string,
  userId: string,
  effectId: string,
): Promise<HostedExecutionSideEffectRecord | null> {
  const value = await readEncryptedR2Json({
    aad: buildHostedStorageAad({
      effectId,
      key: objectKey,
      purpose: "side-effect-journal",
      userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    cryptoKeysById: input.keysById,
    expectedKeyId: input.keyId,
    key: objectKey,
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

async function writeRecordAtKey(
  input: HostedExecutionSideEffectJournalContext,
  objectKey: string,
  userId: string,
  effectId: string,
  value: HostedExecutionSideEffectRecord,
): Promise<void> {
  await writeEncryptedR2Json({
    aad: buildHostedStorageAad({
      effectId,
      key: objectKey,
      purpose: "side-effect-journal",
      userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    key: objectKey,
    keyId: input.keyId,
    scope: "side-effect-journal",
    value,
  });
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

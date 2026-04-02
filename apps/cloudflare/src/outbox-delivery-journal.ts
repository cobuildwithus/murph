import {
  parseHostedExecutionSideEffectRecord,
  sameHostedExecutionAssistantDelivery,
  sameHostedExecutionSideEffectIdentity,
  type HostedExecutionSideEffectRecord,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "./bundle-store.ts";
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
      const key = sideEffectRecordKey(query.userId, query.effectId);
      const existing = await readRecordAtKey(input, key);

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

      await input.bucket.delete(key);
      return true;
    },

    async read(query) {
      const existing = await readRecordAtKey(
        input,
        sideEffectRecordKey(query.userId, query.effectId),
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
      const key = sideEffectRecordKey(writeInput.userId, record.effectId);
      const existing = await readRecordAtKey(input, key);
      const durableRecord = mergeHostedExecutionSideEffectRecord(existing, record);

      if (durableRecord === existing) {
        return durableRecord;
      }

      await writeRecordAtKey(input, key, durableRecord);
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
): Promise<HostedExecutionSideEffectRecord | null> {
  const value = await readEncryptedR2Json({
    bucket: input.bucket,
    cryptoKey: input.key,
    cryptoKeysById: input.keysById,
    expectedKeyId: input.keyId,
    key,
    parse(value) {
      return value;
    },
  });

  if (!value) {
    return null;
  }

  return parseHostedExecutionSideEffectRecord(value);
}

async function writeRecordAtKey(
  input: {
    bucket: R2BucketLike;
    key: Uint8Array;
    keyId: string;
    keysById?: Readonly<Record<string, Uint8Array>>;
  },
  key: string,
  value: HostedExecutionSideEffectRecord,
): Promise<void> {
  await writeEncryptedR2Json({
    bucket: input.bucket,
    cryptoKey: input.key,
    key,
    keyId: input.keyId,
    value,
  });
}

function sideEffectRecordKey(userId: string, effectId: string): string {
  return `transient/side-effects/${encodeURIComponent(userId)}/${encodeURIComponent(effectId)}.json`;
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

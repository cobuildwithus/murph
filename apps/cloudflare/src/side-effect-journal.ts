import {
  assertHostedAssistantDeliveryRecordConsistency,
  parseHostedAssistantDeliveryRecord,
  sameHostedAssistantDeliveryReceipt,
  sameHostedAssistantDeliverySideEffectIdentity,
  type HostedAssistantDeliveryRecord,
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

export class HostedAssistantDeliveryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedAssistantDeliveryConflictError";
  }
}

interface HostedAssistantDeliveryJournalContext {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}

export interface HostedAssistantDeliveryJournalStore {
  deletePrepared(input: {
    effectId: string;
    fingerprint: string;
    userId: string;
  }): Promise<boolean>;
  read(input: {
    effectId: string;
    fingerprint: string;
    userId: string;
  }): Promise<HostedAssistantDeliveryRecord | null>;
  write(input: {
    record: HostedAssistantDeliveryRecord;
    userId: string;
  }): Promise<HostedAssistantDeliveryRecord>;
}

export function createHostedAssistantDeliveryJournalStore(
  input: HostedAssistantDeliveryJournalContext,
): HostedAssistantDeliveryJournalStore {
  return {
    async deletePrepared(query) {
      const objectKey = await hostedSideEffectRecordKey(input.key, query.userId, query.effectId);
      const existing = await readRecordAtKey(input, objectKey, query.userId, query.effectId);

      if (!existing) {
        return false;
      }

      assertAssistantDeliveryQueryMatchesRecord(query, existing);
      if (existing.state !== "prepared") {
        return false;
      }

      if (!input.bucket.delete) {
        throw new Error("Hosted assistant-delivery journal cleanup requires R2 delete support.");
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

      assertAssistantDeliveryQueryMatchesRecord(query, existing);
      return existing;
    },

    async write(writeInput) {
      const record = parseHostedAssistantDeliveryRecord(writeInput.record);
      assertHostedAssistantDeliveryRecordConsistency(record);
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
      const durableRecord = mergeHostedAssistantDeliveryRecord(existing, record);

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
  input: HostedAssistantDeliveryJournalContext,
  objectKey: string,
  userId: string,
  effectId: string,
): Promise<HostedAssistantDeliveryRecord | null> {
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

  return parseHostedAssistantDeliveryRecord(value);
}

async function writeRecordAtKey(
  input: HostedAssistantDeliveryJournalContext,
  objectKey: string,
  userId: string,
  effectId: string,
  value: HostedAssistantDeliveryRecord,
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

function assertAssistantDeliveryQueryMatchesRecord(
  query: {
    effectId: string;
    fingerprint: string;
  },
  record: HostedAssistantDeliveryRecord,
): void {
  if (
    record.effectId === query.effectId
    && record.intentId === query.effectId
    && record.fingerprint === query.fingerprint
  ) {
    return;
  }

  throw new HostedAssistantDeliveryConflictError(
    `Hosted assistant delivery ${query.effectId} does not match the stored identity.`,
  );
}

function mergeHostedAssistantDeliveryRecord(
  existing: HostedAssistantDeliveryRecord | null,
  next: HostedAssistantDeliveryRecord,
): HostedAssistantDeliveryRecord {
  if (!existing) {
    return next;
  }

  if (!sameHostedAssistantDeliverySideEffectIdentity(existing, next)) {
    throw new HostedAssistantDeliveryConflictError(
      `Hosted assistant delivery ${next.effectId} cannot change identity after it has been recorded.`,
    );
  }

  if (existing.state === "sent") {
    if (next.state === "prepared") {
      return existing;
    }

    if (!sameHostedAssistantDeliveryReceipt(existing.delivery, next.delivery)) {
      throw new HostedAssistantDeliveryConflictError(
        `Hosted assistant delivery ${next.effectId} cannot change delivery details after it has been sent.`,
      );
    }

    return existing;
  }

  return next.state === "prepared" ? existing : next;
}

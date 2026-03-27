import { createHash } from "node:crypto";

import {
  assistantChannelDeliverySchema,
  type AssistantChannelDelivery,
} from "@healthybob/assistant-runtime";

import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
  type EncryptedR2BucketLike,
} from "./crypto.js";

export interface HostedAssistantOutboxDeliveryRecord {
  dedupeKey: string;
  delivery: AssistantChannelDelivery;
  intentId: string;
  recordedAt: string;
}

export interface HostedAssistantOutboxDeliveryJournalStore {
  read(input: {
    dedupeKey: string;
    intentId: string;
    userId: string;
  }): Promise<HostedAssistantOutboxDeliveryRecord | null>;
  write(input: {
    dedupeKey: string;
    delivery: AssistantChannelDelivery;
    intentId: string;
    userId: string;
  }): Promise<HostedAssistantOutboxDeliveryRecord>;
}

export function createHostedAssistantOutboxDeliveryJournalStore(input: {
  bucket: EncryptedR2BucketLike;
  key: Uint8Array;
  keyId: string;
}): HostedAssistantOutboxDeliveryJournalStore {
  return {
    async read(query) {
      const byIntent = await readRecordAtKey(input, intentRecordObjectKey(query.userId, query.intentId));

      if (byIntent) {
        return byIntent;
      }

      return readRecordAtKey(input, dedupeRecordObjectKey(query.userId, query.dedupeKey));
    },

    async write(writeInput) {
      const record: HostedAssistantOutboxDeliveryRecord = {
        dedupeKey: writeInput.dedupeKey,
        delivery: assistantChannelDeliverySchema.parse(writeInput.delivery),
        intentId: writeInput.intentId,
        recordedAt: new Date().toISOString(),
      };
      await writeRecordAtKey(input, intentRecordObjectKey(writeInput.userId, writeInput.intentId), record);
      await writeRecordAtKey(input, dedupeRecordObjectKey(writeInput.userId, writeInput.dedupeKey), record);
      return record;
    },
  };
}

async function readRecordAtKey(
  input: {
    bucket: EncryptedR2BucketLike;
    key: Uint8Array;
  },
  key: string,
): Promise<HostedAssistantOutboxDeliveryRecord | null> {
  return readEncryptedR2Json({
    bucket: input.bucket,
    cryptoKey: input.key,
    key,
    parse(value) {
      const parsed = value as HostedAssistantOutboxDeliveryRecord;
      return {
        ...parsed,
        delivery: assistantChannelDeliverySchema.parse(parsed.delivery),
      };
    },
  });
}

async function writeRecordAtKey(
  input: {
    bucket: EncryptedR2BucketLike;
    key: Uint8Array;
    keyId: string;
  },
  key: string,
  value: HostedAssistantOutboxDeliveryRecord,
): Promise<void> {
  await writeEncryptedR2Json({
    bucket: input.bucket,
    cryptoKey: input.key,
    key,
    keyId: input.keyId,
    value,
  });
}

function intentRecordObjectKey(userId: string, intentId: string): string {
  return `users/${encodeURIComponent(userId)}/outbox-deliveries/by-intent/${encodeURIComponent(intentId)}.json`;
}

function dedupeRecordObjectKey(userId: string, dedupeKey: string): string {
  return `users/${encodeURIComponent(userId)}/outbox-deliveries/by-dedupe/${hashDedupeKey(dedupeKey)}.json`;
}

function hashDedupeKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

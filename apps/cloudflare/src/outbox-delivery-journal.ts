import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  assistantChannelDeliverySchema,
  type AssistantChannelDelivery,
} from "healthybob";

import { decryptHostedBundle, encryptHostedBundle } from "./crypto.js";

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

interface R2BucketLike {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: string): Promise<void>;
}

export function createHostedAssistantOutboxDeliveryJournalStore(input: {
  bucket: R2BucketLike;
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
    bucket: R2BucketLike;
    key: Uint8Array;
    keyId: string;
  },
  key: string,
): Promise<HostedAssistantOutboxDeliveryRecord | null> {
  const object = await input.bucket.get(key);

  if (!object) {
    return null;
  }

  const plaintext = await decryptHostedBundle({
    envelope: JSON.parse(Buffer.from(await object.arrayBuffer()).toString("utf8")),
    key: input.key,
  });
  const parsed = JSON.parse(Buffer.from(plaintext).toString("utf8")) as HostedAssistantOutboxDeliveryRecord;

  return {
    ...parsed,
    delivery: assistantChannelDeliverySchema.parse(parsed.delivery),
  };
}

async function writeRecordAtKey(
  input: {
    bucket: R2BucketLike;
    key: Uint8Array;
    keyId: string;
  },
  key: string,
  value: HostedAssistantOutboxDeliveryRecord,
): Promise<void> {
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const envelope = await encryptHostedBundle({
    key: input.key,
    keyId: input.keyId,
    plaintext,
  });

  await input.bucket.put(key, JSON.stringify(envelope));
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

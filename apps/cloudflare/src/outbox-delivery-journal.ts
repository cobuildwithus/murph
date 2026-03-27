import { createHash } from "node:crypto";

import {
  parseHostedExecutionSideEffectRecord,
  type HostedExecutionSideEffectRecord,
} from "@healthybob/assistant-runtime";

import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
  type EncryptedR2BucketLike,
} from "./crypto.js";

export interface HostedExecutionSideEffectJournalStore {
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
  bucket: EncryptedR2BucketLike;
  key: Uint8Array;
  keyId: string;
}): HostedExecutionSideEffectJournalStore {
  return {
    async read(query) {
      const byEffect = await readRecordAtKeys(input, effectRecordObjectKeys(query.userId, query.effectId));

      if (byEffect) {
        return byEffect;
      }

      return readRecordAtKeys(
        input,
        fingerprintRecordObjectKeys(query.userId, query.kind, query.fingerprint),
      );
    },

    async write(writeInput) {
      const record = parseHostedExecutionSideEffectRecord(writeInput.record);
      await writeRecordAtKeys(
        input,
        effectRecordObjectKeys(writeInput.userId, record.effectId),
        record,
      );
      await writeRecordAtKeys(
        input,
        fingerprintRecordObjectKeys(writeInput.userId, record.kind, record.fingerprint),
        record,
      );
      return record;
    },
  };
}

async function readRecordAtKeys(
  input: {
    bucket: EncryptedR2BucketLike;
    key: Uint8Array;
  },
  keys: readonly string[],
): Promise<HostedExecutionSideEffectRecord | null> {
  for (const key of keys) {
    const record = await readEncryptedR2Json({
      bucket: input.bucket,
      cryptoKey: input.key,
      key,
      parse(value) {
        return parseHostedExecutionSideEffectRecord(value);
      },
    });

    if (record) {
      return record;
    }
  }

  return null;
}

async function writeRecordAtKeys(
  input: {
    bucket: EncryptedR2BucketLike;
    key: Uint8Array;
    keyId: string;
  },
  keys: readonly string[],
  value: HostedExecutionSideEffectRecord,
): Promise<void> {
  for (const key of keys) {
    await writeEncryptedR2Json({
      bucket: input.bucket,
      cryptoKey: input.key,
      key,
      keyId: input.keyId,
      value,
    });
  }
}

function effectRecordObjectKeys(userId: string, effectId: string): string[] {
  return [
    `users/${encodeURIComponent(userId)}/side-effects/by-effect/${encodeURIComponent(effectId)}.json`,
    legacyIntentRecordObjectKey(userId, effectId),
  ];
}

function fingerprintRecordObjectKeys(
  userId: string,
  kind: HostedExecutionSideEffectRecord["kind"],
  fingerprint: string,
): string[] {
  return [
    `users/${encodeURIComponent(userId)}/side-effects/by-fingerprint/${hashFingerprint(kind, fingerprint)}.json`,
    ...(kind === "assistant.delivery"
      ? [legacyDedupeRecordObjectKey(userId, fingerprint)]
      : []),
  ];
}

function hashFingerprint(kind: string, fingerprint: string): string {
  return createHash("sha256").update(`${kind}:${fingerprint}`).digest("hex");
}

function legacyIntentRecordObjectKey(userId: string, intentId: string): string {
  return `users/${encodeURIComponent(userId)}/outbox-deliveries/by-intent/${encodeURIComponent(intentId)}.json`;
}

function legacyDedupeRecordObjectKey(userId: string, dedupeKey: string): string {
  return `users/${encodeURIComponent(userId)}/outbox-deliveries/by-dedupe/${createHash("sha256").update(dedupeKey).digest("hex")}.json`;
}

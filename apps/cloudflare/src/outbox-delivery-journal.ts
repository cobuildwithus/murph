import { createHash } from "node:crypto";

import {
  parseHostedExecutionSideEffectRecord,
  type HostedExecutionSideEffectRecord,
} from "@murph/assistant-runtime";

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
      const byEffect = await readRecordAtKey(input, effectRecordKey(query.userId, query.effectId));

      if (byEffect) {
        return byEffect;
      }

      return readRecordAtKey(
        input,
        fingerprintRecordKey(query.userId, query.kind, query.fingerprint),
      );
    },

    async write(writeInput) {
      const record = parseHostedExecutionSideEffectRecord(writeInput.record);
      await writeRecordAtKey(input, effectRecordKey(writeInput.userId, record.effectId), record);
      await writeRecordAtKey(
        input,
        fingerprintRecordKey(writeInput.userId, record.kind, record.fingerprint),
        record,
      );
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
): Promise<HostedExecutionSideEffectRecord | null> {
  return readEncryptedR2Json({
    bucket: input.bucket,
    cryptoKey: input.key,
    key,
    parse(value) {
      return parseHostedExecutionSideEffectRecord(value);
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

function effectRecordKey(userId: string, effectId: string): string {
  return `transient/side-effects/by-effect/${encodeURIComponent(userId)}/${encodeURIComponent(effectId)}.json`;
}

function fingerprintRecordKey(
  userId: string,
  kind: HostedExecutionSideEffectRecord["kind"],
  fingerprint: string,
): string {
  return `transient/side-effects/by-fingerprint/${hashFingerprint(kind, fingerprint)}/${encodeURIComponent(userId)}.json`;
}

function hashFingerprint(kind: string, fingerprint: string): string {
  return createHash("sha256").update(`${kind}:${fingerprint}`).digest("hex");
}

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

const HOSTED_EXECUTION_SIDE_EFFECT_ALIAS_SCHEMA =
  "murph.hosted-side-effect-alias.v1";

interface HostedExecutionSideEffectAlias {
  recordKey: string;
  schema: typeof HOSTED_EXECUTION_SIDE_EFFECT_ALIAS_SCHEMA;
}

export function createHostedExecutionSideEffectJournalStore(input: {
  bucket: EncryptedR2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
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
      const canonicalKey = fingerprintRecordKey(
        writeInput.userId,
        record.kind,
        record.fingerprint,
      );
      const effectKey = effectRecordKey(writeInput.userId, record.effectId);
      const existing = await this.read({
        effectId: record.effectId,
        fingerprint: record.fingerprint,
        kind: record.kind,
        userId: writeInput.userId,
      });
      const durableRecord = existing ?? record;

      await writeRecordAtKey(input, canonicalKey, durableRecord);
      await writeAliasAtKey(input, effectKey, canonicalKey);
      return durableRecord;
    },
  };
}

async function readRecordAtKey(
  input: {
    bucket: EncryptedR2BucketLike;
    key: Uint8Array;
    keyId: string;
    keysById?: Readonly<Record<string, Uint8Array>>;
  },
  key: string,
  seenKeys = new Set<string>(),
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
  if (isHostedExecutionSideEffectAlias(value)) {
    if (seenKeys.has(value.recordKey)) {
      return null;
    }
    seenKeys.add(value.recordKey);
    return readRecordAtKey(input, value.recordKey, seenKeys);
  }

  return parseHostedExecutionSideEffectRecord(value);
}

async function writeRecordAtKey(
  input: {
    bucket: EncryptedR2BucketLike;
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

async function writeAliasAtKey(
  input: {
    bucket: EncryptedR2BucketLike;
    key: Uint8Array;
    keyId: string;
    keysById?: Readonly<Record<string, Uint8Array>>;
  },
  key: string,
  recordKey: string,
): Promise<void> {
  await writeEncryptedR2Json({
    bucket: input.bucket,
    cryptoKey: input.key,
    key,
    keyId: input.keyId,
    value: {
      recordKey,
      schema: HOSTED_EXECUTION_SIDE_EFFECT_ALIAS_SCHEMA,
    } satisfies HostedExecutionSideEffectAlias,
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

function isHostedExecutionSideEffectAlias(
  value: unknown,
): value is HostedExecutionSideEffectAlias {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && (value as { schema?: unknown }).schema
        === HOSTED_EXECUTION_SIDE_EFFECT_ALIAS_SCHEMA
      && typeof (value as { recordKey?: unknown }).recordKey === "string",
  );
}

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { readEncryptedR2Json, writeEncryptedR2Json } from "../src/crypto.ts";
import { createHostedExecutionSideEffectJournalStore } from "../src/outbox-delivery-journal.ts";

describe("createHostedExecutionSideEffectJournalStore", () => {
  it("reads canonical fingerprint records even when the effect alias is missing", async () => {
    const bucket = createMemoryBucket();
    const key = Buffer.alloc(32, 9);
    const record = createSideEffectRecord({
      effectId: "outbox_missing_alias",
      fingerprint: "dedupe_missing_alias",
    });

    await writeEncryptedR2Json({
      bucket: bucket.api,
      cryptoKey: key,
      key: fingerprintRecordKey("member_123", record.kind, record.fingerprint),
      keyId: "v1",
      value: record,
    });

    const store = createHostedExecutionSideEffectJournalStore({
      bucket: bucket.api,
      key,
      keyId: "v1",
    });

    await expect(store.read({
      effectId: record.effectId,
      fingerprint: record.fingerprint,
      kind: record.kind,
      userId: "member_123",
    })).resolves.toEqual(record);
  });

  it("repairs legacy effect-only records into canonical and alias-backed journal state", async () => {
    const bucket = createMemoryBucket();
    const key = Buffer.alloc(32, 9);
    const record = createSideEffectRecord({
      effectId: "outbox_legacy_only",
      fingerprint: "dedupe_legacy_only",
    });

    await writeEncryptedR2Json({
      bucket: bucket.api,
      cryptoKey: key,
      key: effectRecordKey("member_123", record.effectId),
      keyId: "v1",
      value: record,
    });

    const store = createHostedExecutionSideEffectJournalStore({
      bucket: bucket.api,
      key,
      keyId: "v1",
    });

    await expect(store.write({
      record,
      userId: "member_123",
    })).resolves.toEqual(record);

    await expect(readEncryptedR2Json({
      bucket: bucket.api,
      cryptoKey: key,
      expectedKeyId: "v1",
      key: fingerprintRecordKey("member_123", record.kind, record.fingerprint),
      parse(value) {
        return value;
      },
    })).resolves.toEqual(record);

    await expect(readEncryptedR2Json({
      bucket: bucket.api,
      cryptoKey: key,
      expectedKeyId: "v1",
      key: effectRecordKey("member_123", record.effectId),
      parse(value) {
        return value;
      },
    })).resolves.toMatchObject({
      recordKey: fingerprintRecordKey("member_123", record.kind, record.fingerprint),
      schema: "murph.hosted-side-effect-alias.v1",
    });
  });

  it("keeps the first canonical side-effect record stable when the same fingerprint is written again", async () => {
    const bucket = createMemoryBucket();
    const key = Buffer.alloc(32, 9);
    const firstRecord = createSideEffectRecord({
      effectId: "outbox_a",
      fingerprint: "dedupe_same",
    });
    const secondRecord = createSideEffectRecord({
      effectId: "outbox_b",
      fingerprint: "dedupe_same",
    });
    const store = createHostedExecutionSideEffectJournalStore({
      bucket: bucket.api,
      key,
      keyId: "v1",
    });

    await expect(store.write({
      record: firstRecord,
      userId: "member_123",
    })).resolves.toEqual(firstRecord);
    await expect(store.write({
      record: secondRecord,
      userId: "member_123",
    })).resolves.toEqual(firstRecord);
    await expect(store.read({
      effectId: secondRecord.effectId,
      fingerprint: secondRecord.fingerprint,
      kind: secondRecord.kind,
      userId: "member_123",
    })).resolves.toEqual(firstRecord);
  });
});

function createSideEffectRecord(input: {
  effectId: string;
  fingerprint: string;
}) {
  return {
    delivery: {
      channel: "telegram" as const,
      idempotencyKey: `assistant-outbox:${input.effectId}`,
      messageLength: 12,
      sentAt: "2026-03-29T10:00:00.000Z",
      target: "thread_123",
      targetKind: "thread" as const,
    },
    effectId: input.effectId,
    fingerprint: input.fingerprint,
    intentId: input.effectId,
    kind: "assistant.delivery" as const,
    recordedAt: "2026-03-29T10:00:05.000Z",
  };
}

function effectRecordKey(userId: string, effectId: string): string {
  return `transient/side-effects/by-effect/${encodeURIComponent(userId)}/${encodeURIComponent(effectId)}.json`;
}

function fingerprintRecordKey(
  userId: string,
  kind: string,
  fingerprint: string,
): string {
  return `transient/side-effects/by-fingerprint/${hashFingerprint(kind, fingerprint)}/${encodeURIComponent(userId)}.json`;
}

function hashFingerprint(kind: string, fingerprint: string): string {
  return createHash("sha256").update(`${kind}:${fingerprint}`).digest("hex");
}

function createMemoryBucket() {
  const objects = new Map<string, string>();
  const encoder = new TextEncoder();

  return {
    api: {
      async delete(key: string) {
        objects.delete(key);
      },
      async get(key: string) {
        const value = objects.get(key);
        if (value === undefined) {
          return null;
        }
        return {
          async arrayBuffer() {
            return encoder.encode(value).buffer;
          },
        };
      },
      async put(key: string, value: string) {
        objects.set(key, value);
      },
    },
  };
}

import { describe, expect, it } from "vitest";

import {
  buildHostedAssistantDeliveryPreparedRecord,
  buildHostedAssistantDeliverySentRecord,
} from "@murphai/hosted-execution";

import { writeEncryptedR2Json } from "../src/crypto.ts";
import {
  HostedExecutionSideEffectConflictError,
  createHostedExecutionSideEffectJournalStore,
} from "../src/outbox-delivery-journal.ts";

describe("createHostedExecutionSideEffectJournalStore", () => {
  it("reads side-effect records stored at the authoritative effect key", async () => {
    const bucket = createMemoryBucket();
    const key = Buffer.alloc(32, 9);
    const record = createSentRecord({
      effectId: "outbox_authoritative",
      fingerprint: "dedupe_authoritative",
    });

    await writeEncryptedR2Json({
      bucket: bucket.api,
      cryptoKey: key,
      key: sideEffectRecordKey("member_123", record.effectId),
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

  it("reads side-effect journal records encrypted with a previous key id after rotation", async () => {
    const bucket = createMemoryBucket();
    const previousKey = Buffer.alloc(32, 8);
    const currentKey = Buffer.alloc(32, 9);
    const record = createSentRecord({
      effectId: "outbox_rotated",
      fingerprint: "dedupe_rotated",
    });

    await writeEncryptedR2Json({
      bucket: bucket.api,
      cryptoKey: previousKey,
      key: sideEffectRecordKey("member_123", record.effectId),
      keyId: "v1",
      value: record,
    });

    await expect(createHostedExecutionSideEffectJournalStore({
      bucket: bucket.api,
      key: currentKey,
      keyId: "v2",
      keysById: {
        v1: previousKey,
        v2: currentKey,
      },
    }).read({
      effectId: record.effectId,
      fingerprint: record.fingerprint,
      kind: record.kind,
      userId: "member_123",
    })).resolves.toEqual(record);
  });

  it("promotes prepared records to sent and keeps sent delivery stable on duplicate writes", async () => {
    const bucket = createMemoryBucket();
    const key = Buffer.alloc(32, 9);
    const preparedRecord = createPreparedRecord({
      effectId: "outbox_promote",
      fingerprint: "dedupe_promote",
    });
    const sentRecord = createSentRecord({
      effectId: "outbox_promote",
      fingerprint: "dedupe_promote",
    });
    const store = createHostedExecutionSideEffectJournalStore({
      bucket: bucket.api,
      key,
      keyId: "v1",
    });

    await expect(store.write({
      record: preparedRecord,
      userId: "member_123",
    })).resolves.toEqual(preparedRecord);
    await expect(store.write({
      record: sentRecord,
      userId: "member_123",
    })).resolves.toEqual(sentRecord);
    await expect(store.write({
      record: preparedRecord,
      userId: "member_123",
    })).resolves.toEqual(sentRecord);
  });

  it("rejects identity conflicts instead of aliasing mismatched records", async () => {
    const bucket = createMemoryBucket();
    const key = Buffer.alloc(32, 9);
    const firstRecord = createPreparedRecord({
      effectId: "outbox_conflict",
      fingerprint: "dedupe_a",
    });
    const store = createHostedExecutionSideEffectJournalStore({
      bucket: bucket.api,
      key,
      keyId: "v1",
    });

    await store.write({
      record: firstRecord,
      userId: "member_123",
    });

    await expect(store.write({
      record: createPreparedRecord({
        effectId: "outbox_conflict",
        fingerprint: "dedupe_b",
      }),
      userId: "member_123",
    })).rejects.toBeInstanceOf(HostedExecutionSideEffectConflictError);
  });

  it("deletes only prepared reservations", async () => {
    const bucket = createMemoryBucket();
    const key = Buffer.alloc(32, 9);
    const preparedRecord = createPreparedRecord({
      effectId: "outbox_prepared",
      fingerprint: "dedupe_prepared",
    });
    const sentRecord = createSentRecord({
      effectId: "outbox_sent",
      fingerprint: "dedupe_sent",
    });
    const store = createHostedExecutionSideEffectJournalStore({
      bucket: bucket.api,
      key,
      keyId: "v1",
    });

    await store.write({
      record: preparedRecord,
      userId: "member_123",
    });
    await store.write({
      record: sentRecord,
      userId: "member_123",
    });

    await expect(store.deletePrepared({
      effectId: preparedRecord.effectId,
      fingerprint: preparedRecord.fingerprint,
      kind: preparedRecord.kind,
      userId: "member_123",
    })).resolves.toBe(true);
    await expect(store.read({
      effectId: preparedRecord.effectId,
      fingerprint: preparedRecord.fingerprint,
      kind: preparedRecord.kind,
      userId: "member_123",
    })).resolves.toBeNull();

    await expect(store.deletePrepared({
      effectId: sentRecord.effectId,
      fingerprint: sentRecord.fingerprint,
      kind: sentRecord.kind,
      userId: "member_123",
    })).resolves.toBe(false);
    await expect(store.read({
      effectId: sentRecord.effectId,
      fingerprint: sentRecord.fingerprint,
      kind: sentRecord.kind,
      userId: "member_123",
    })).resolves.toEqual(sentRecord);
  });
});

function createPreparedRecord(input: {
  effectId: string;
  fingerprint: string;
}) {
  return buildHostedAssistantDeliveryPreparedRecord({
    dedupeKey: input.fingerprint,
    intentId: input.effectId,
    recordedAt: "2026-03-29T10:00:05.000Z",
  });
}

function createSentRecord(input: {
  effectId: string;
  fingerprint: string;
}) {
  return buildHostedAssistantDeliverySentRecord({
    dedupeKey: input.fingerprint,
    delivery: {
      channel: "telegram",
      idempotencyKey: `assistant-outbox:${input.effectId}`,
      messageLength: 12,
      providerMessageId: null,
      providerThreadId: null,
      sentAt: "2026-03-29T10:00:00.000Z",
      target: "thread_123",
      targetKind: "thread",
    },
    intentId: input.effectId,
  });
}

function sideEffectRecordKey(userId: string, effectId: string): string {
  return `transient/side-effects/${encodeURIComponent(userId)}/${encodeURIComponent(effectId)}.json`;
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

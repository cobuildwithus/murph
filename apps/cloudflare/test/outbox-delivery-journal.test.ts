import { describe, expect, it } from "vitest";

import {
  buildHostedAssistantDeliveryPreparedRecord,
  buildHostedAssistantDeliverySentRecord,
} from "@murphai/hosted-execution";

import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "../src/crypto-context.ts";
import { writeEncryptedR2Json } from "../src/crypto.ts";
import {
  HostedExecutionSideEffectConflictError,
  createHostedExecutionSideEffectJournalStore,
} from "../src/outbox-delivery-journal.ts";

import { MemoryEncryptedR2Bucket } from "./test-helpers";

describe("createHostedExecutionSideEffectJournalStore", () => {
  it("reads side-effect records stored at the authoritative effect key", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const key = Buffer.alloc(32, 9);
    const record = createSentRecord({
      effectId: "outbox_authoritative",
      fingerprint: "dedupe_authoritative",
    });
    const objectKey = await sideEffectRecordKey(key, "member_123", record.effectId);

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        effectId: record.effectId,
        key: objectKey,
        purpose: "side-effect-journal",
        userId: "member_123",
      }),
      bucket,
      cryptoKey: key,
      key: objectKey,
      keyId: "v1",
      scope: "side-effect-journal",
      value: record,
    });

    const store = createHostedExecutionSideEffectJournalStore({
      bucket,
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
    const bucket = new MemoryEncryptedR2Bucket();
    const previousKey = Buffer.alloc(32, 8);
    const currentKey = Buffer.alloc(32, 9);
    const record = createSentRecord({
      effectId: "outbox_rotated",
      fingerprint: "dedupe_rotated",
    });
    const objectKey = await sideEffectRecordKey(currentKey, "member_123", record.effectId);

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        effectId: record.effectId,
        key: objectKey,
        purpose: "side-effect-journal",
        userId: "member_123",
      }),
      bucket,
      cryptoKey: previousKey,
      key: objectKey,
      keyId: "v1",
      scope: "side-effect-journal",
      value: record,
    });

    await expect(createHostedExecutionSideEffectJournalStore({
      bucket,
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

  it("ignores removed raw-path side-effect journal records", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const previousKey = Buffer.alloc(32, 7);
    const currentKey = Buffer.alloc(32, 9);
    const record = createPreparedRecord({
      effectId: "outbox_legacy",
      fingerprint: "dedupe_legacy",
    });
    const objectKey = legacySideEffectRecordKey("member_legacy", record.effectId);

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        effectId: record.effectId,
        key: objectKey,
        purpose: "side-effect-journal",
        userId: "member_legacy",
      }),
      bucket,
      cryptoKey: previousKey,
      key: objectKey,
      keyId: "v1",
      scope: "side-effect-journal",
      value: record,
    });

    const store = createHostedExecutionSideEffectJournalStore({
      bucket,
      key: currentKey,
      keyId: "v2",
      keysById: {
        v1: previousKey,
        v2: currentKey,
      },
    });

    await expect(store.read({
      effectId: record.effectId,
      fingerprint: record.fingerprint,
      kind: record.kind,
      userId: "member_legacy",
    })).resolves.toBeNull();
    await expect(store.deletePrepared({
      effectId: record.effectId,
      fingerprint: record.fingerprint,
      kind: record.kind,
      userId: "member_legacy",
    })).resolves.toBe(false);
  });

  it("promotes prepared records to sent and keeps sent delivery stable on duplicate writes", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
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
      bucket,
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
    const bucket = new MemoryEncryptedR2Bucket();
    const key = Buffer.alloc(32, 9);
    const firstRecord = createPreparedRecord({
      effectId: "outbox_conflict",
      fingerprint: "dedupe_a",
    });
    const store = createHostedExecutionSideEffectJournalStore({
      bucket,
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
    const bucket = new MemoryEncryptedR2Bucket();
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
      bucket,
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

async function sideEffectRecordKey(rootKey: Uint8Array, userId: string, effectId: string): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "side-effect-path",
    value: `user:${userId}`,
  });
  const effectSegment = await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey,
    scope: "side-effect-path",
    value: `effect:${userId}:${effectId}`,
  });

  return `transient/side-effects/${userSegment}/${effectSegment}.json`;
}

function legacySideEffectRecordKey(userId: string, effectId: string): string {
  return `transient/side-effects/${encodeURIComponent(userId)}/${encodeURIComponent(effectId)}.json`;
}

import { describe, expect, it } from "vitest";

import { createHostedUserKeyStore } from "../src/user-key-store.js";

import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers";

describe("hosted user key store", () => {
  it("reads and migrates automation recipients across automation-key rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldKey = createTestRootKey(7);
    const nextKey = createTestRootKey(9);

    const oldStore = createHostedUserKeyStore({
      automationKey: oldKey,
      automationKeyId: "automation:v1",
      bucket,
    });
    const original = await oldStore.ensureUserCryptoContext("user_live_123");
    const oldEnvelopeObjectKey = [...bucket.objects.keys()][0] ?? null;

    expect(oldEnvelopeObjectKey).toBeTruthy();
    expect(bucket.objects.size).toBe(1);

    const rotatedStore = createHostedUserKeyStore({
      automationKey: nextKey,
      automationKeyId: "automation:v2",
      bucket,
      envelopeKeysById: {
        "automation:v1": oldKey,
        "automation:v2": nextKey,
      },
    });

    const readBeforeMigration = await rotatedStore.readUserRootKeyEnvelope("user_live_123");
    expect(readBeforeMigration?.userId).toBe("user_live_123");
    expect(
      readBeforeMigration?.recipients.find((recipient) => recipient.kind === "automation")?.keyId,
    ).toBe("automation:v1");

    const migrated = await rotatedStore.ensureUserCryptoContext("user_live_123");
    const migratedEnvelopeObjectKey = [...bucket.objects.keys()][0] ?? null;

    expect([...migrated.rootKey]).toEqual([...original.rootKey]);
    expect(
      migrated.envelope.recipients.find((recipient) => recipient.kind === "automation")?.keyId,
    ).toBe("automation:v2");
    expect(migratedEnvelopeObjectKey).toBeTruthy();
    expect(migratedEnvelopeObjectKey).not.toBe(oldEnvelopeObjectKey);
    expect(bucket.objects.size).toBe(1);
    expect(bucket.deleted).toContain(oldEnvelopeObjectKey);
  });

  it("rejects wrapped recipient keys that are not 32 bytes", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const store = createHostedUserKeyStore({
      automationKey: createTestRootKey(13),
      automationKeyId: "automation:v1",
      bucket,
    });

    await expect(store.upsertRecipient({
      kind: "user-unlock",
      recipientKey: new Uint8Array(16),
      recipientKeyId: "browser:v1",
      userId: "user_live_456",
    })).rejects.toThrow(/32 bytes/u);
  });
});

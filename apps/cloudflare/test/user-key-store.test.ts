import { describe, expect, it } from "vitest";

import type { HostedUserRootKeyEnvelope } from "@murphai/runtime-state";
import { buildLegacyHostedWrappedRootKeyRecipientAadFields } from "@murphai/runtime-state";

import { buildHostedStorageAad } from "../src/crypto-context.js";
import { encryptHostedBundle, writeEncryptedR2Json } from "../src/crypto.js";
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
    expect(migratedEnvelopeObjectKey).toBe(oldEnvelopeObjectKey);
    expect(bucket.objects.size).toBe(1);
    expect(bucket.deleted).not.toContain(oldEnvelopeObjectKey);
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

  it("rewrites legacy automation recipient AAD on read", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const automationKey = createTestRootKey(17);
    const rootKey = createTestRootKey(19);
    const userId = "user_live_789";
    const objectKey = `users/keys/${encodeURIComponent(userId)}.json`;
    const legacyRecipientEnvelope = await encryptHostedBundle({
      aad: buildHostedStorageAad(buildLegacyHostedWrappedRootKeyRecipientAadFields({
        keyId: "automation:v1",
        kind: "automation",
      })),
      key: automationKey,
      keyId: "automation:v1",
      plaintext: rootKey,
      scope: "root-key-recipient",
    });
    const legacyEnvelope: HostedUserRootKeyEnvelope = {
      createdAt: "2026-04-04T00:00:00.000Z",
      recipients: [{
        ciphertext: legacyRecipientEnvelope.ciphertext,
        iv: legacyRecipientEnvelope.iv,
        keyId: legacyRecipientEnvelope.keyId,
        kind: "automation",
        metadata: {
          keyId: "automation:v1",
        },
      }],
      rootKeyId: "root-key:v1",
      schema: "murph.hosted-user-root-key-envelope.v1",
      updatedAt: "2026-04-04T00:00:00.000Z",
      userId,
    };

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        key: objectKey,
        purpose: "root-key-envelope",
        userId,
      }),
      bucket,
      cryptoKey: automationKey,
      key: objectKey,
      keyId: "automation:v1",
      scope: "root-key-envelope",
      value: legacyEnvelope,
    });
    const storedBefore = bucket.objects.get(objectKey);

    const store = createHostedUserKeyStore({
      automationKey,
      automationKeyId: "automation:v1",
      bucket,
    });
    const context = await store.ensureUserCryptoContext(userId);
    const migratedEnvelope = await store.readUserRootKeyEnvelope(userId);
    const storedAfter = bucket.objects.get(objectKey);

    expect([...context.rootKey]).toEqual([...rootKey]);
    expect(migratedEnvelope?.rootKeyId).toBe("root-key:v1");
    expect(storedBefore).toBeDefined();
    expect(storedAfter).not.toBe(storedBefore);
  });
});

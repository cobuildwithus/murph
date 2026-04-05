import { describe, expect, it } from "vitest";

import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";

import { deriveHostedStorageOpaqueId } from "../src/crypto-context.js";
import { createHostedUserKeyStore } from "../src/user-key-store.js";

import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers";

describe("hosted user key store", () => {
  it("reads and migrates automation recipients across automation-key rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const envelopeEncryptionKey = createTestRootKey(7);
    const oldAutomation = await generateHostedUserRecipientKeyPair();
    const nextAutomation = await generateHostedUserRecipientKeyPair();

    const oldStore = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: oldAutomation.privateKeyJwk,
      automationRecipientPublicKey: oldAutomation.publicKeyJwk,
      bucket,
      envelopeEncryptionKey,
      envelopeEncryptionKeyId: "v1",
    });
    const original = await oldStore.ensureUserCryptoContext("user_live_123");
    const oldEnvelopeObjectKey = [...bucket.objects.keys()][0] ?? null;
    const currentObjectKey = await hostedUserKeyEnvelopeObjectKeyForTest(
      envelopeEncryptionKey,
      "user_live_123",
    );

    expect(oldEnvelopeObjectKey).toBeTruthy();
    expect(oldEnvelopeObjectKey).toBe(currentObjectKey);
    expect(oldEnvelopeObjectKey).not.toContain("user_live_123");
    expect(bucket.objects.size).toBe(1);

    const rotatedStore = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v2",
      automationRecipientPrivateKey: nextAutomation.privateKeyJwk,
      automationRecipientPrivateKeysById: {
        "automation:v1": oldAutomation.privateKeyJwk,
        "automation:v2": nextAutomation.privateKeyJwk,
      },
      automationRecipientPublicKey: nextAutomation.publicKeyJwk,
      bucket,
      envelopeEncryptionKey,
      envelopeEncryptionKeyId: "v1",
      envelopeEncryptionKeysById: {
        v1: envelopeEncryptionKey,
      },
    });

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

  it("creates one opaque automation-only envelope per new user and reuses its root key", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const automation = await generateHostedUserRecipientKeyPair();
    const envelopeEncryptionKey = createTestRootKey(17);
    const store = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automation.privateKeyJwk,
      automationRecipientPublicKey: automation.publicKeyJwk,
      bucket,
      envelopeEncryptionKey,
      envelopeEncryptionKeyId: "v1",
    });

    const first = await store.ensureUserCryptoContext("user_live_789");
    const second = await store.ensureUserCryptoContext("user_live_789");
    const objectKey = [...bucket.objects.keys()][0] ?? null;

    expect(first.envelope.recipients).toHaveLength(1);
    expect(first.envelope.recipients[0]).toMatchObject({
      keyId: "automation:v1",
      kind: "automation",
    });
    expect([...second.rootKey]).toEqual([...first.rootKey]);
    expect(second.rootKeyId).toBe(first.rootKeyId);
    expect(objectKey).toBe(await hostedUserKeyEnvelopeObjectKeyForTest(
      envelopeEncryptionKey,
      "user_live_789",
    ));
    expect(objectKey).not.toContain("user_live_789");
    expect(bucket.objects.size).toBe(1);
  });

  it("fails closed when generic callers request a missing envelope without the DO bootstrap lane", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const automation = await generateHostedUserRecipientKeyPair();
    const envelopeEncryptionKey = createTestRootKey(19);
    const store = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automation.privateKeyJwk,
      automationRecipientPublicKey: automation.publicKeyJwk,
      bucket,
      envelopeEncryptionKey,
      envelopeEncryptionKeyId: "v1",
    });

    await expect(store.requireUserCryptoContext("user_missing_123")).rejects.toThrow(
      /cannot be bootstrapped outside the per-user runner lane/u,
    );
    expect(bucket.objects.size).toBe(0);
  });

  it("ignores removed legacy v1 envelopes at the old static object path", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const envelopeEncryptionKey = createTestRootKey(23);
    const automation = await generateHostedUserRecipientKeyPair();
    const legacyUserId = "user_live_legacy";
    const legacyObjectKey = `users/keys/${encodeURIComponent(legacyUserId)}.json`;
    await bucket.put(legacyObjectKey, "stale legacy envelope");

    const store = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v2",
      automationRecipientPrivateKey: automation.privateKeyJwk,
      automationRecipientPublicKey: automation.publicKeyJwk,
      bucket,
      envelopeEncryptionKey,
      envelopeEncryptionKeyId: "v1",
    });

    const context = await store.ensureUserCryptoContext(legacyUserId);
    const currentObjectKey = await hostedUserKeyEnvelopeObjectKeyForTest(envelopeEncryptionKey, legacyUserId);

    expect(context.envelope.schema).toBe("murph.hosted-user-root-key-envelope.v2");
    expect(
      context.envelope.recipients.find((recipient) => recipient.kind === "automation")?.keyId,
    ).toBe("automation:v2");
    expect(context.envelope.rootKeyId).toBe(context.rootKeyId);
    expect(bucket.objects.has(currentObjectKey)).toBe(true);
    expect(bucket.objects.has(legacyObjectKey)).toBe(true);
    expect(bucket.deleted).not.toContain(legacyObjectKey);
  });
});

async function hostedUserKeyEnvelopeObjectKeyForTest(
  envelopeEncryptionKey: Uint8Array,
  userId: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey: envelopeEncryptionKey,
    scope: "user-key-envelope-path",
    value: `user:${userId}`,
  });

  return `users/keys/${userSegment}.json`;
}

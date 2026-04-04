import { describe, expect, it } from "vitest";

import {
  createHostedUserRootKeyEnvelope,
  generateHostedUserRecipientKeyPair,
} from "@murphai/runtime-state";

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

  it("rejects malformed managed-recipient public JWKs", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const automation = await generateHostedUserRecipientKeyPair();
    const store = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automation.privateKeyJwk,
      automationRecipientPublicKey: automation.publicKeyJwk,
      bucket,
      envelopeEncryptionKey: createTestRootKey(13),
      envelopeEncryptionKeyId: "v1",
    });

    await expect(store.upsertRecipient({
      kind: "user-unlock",
      recipientKeyId: "browser:v1",
      recipientPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "invalid",
        y: "invalid",
      },
      userId: "user_live_456",
    })).rejects.toThrow();
  });

  it("persists explicit user root-key envelopes and reuses their root key", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const automation = await generateHostedUserRecipientKeyPair();
    const browser = await generateHostedUserRecipientKeyPair();
    const envelopeEncryptionKey = createTestRootKey(17);
    const store = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automation.privateKeyJwk,
      automationRecipientPublicKey: automation.publicKeyJwk,
      bucket,
      envelopeEncryptionKey,
      envelopeEncryptionKeyId: "v1",
    });
    const created = await createHostedUserRootKeyEnvelope({
      recipients: [
        {
          keyId: "automation:v1",
          kind: "automation",
          publicKeyJwk: automation.publicKeyJwk,
        },
        {
          keyId: "browser:v1",
          kind: "user-unlock",
          publicKeyJwk: browser.publicKeyJwk,
        },
      ],
      userId: "user_live_789",
    });

    await store.putUserRootKeyEnvelope({
      envelope: created.envelope,
      userId: "user_live_789",
    });

    const context = await store.ensureUserCryptoContext("user_live_789");
    const storedEnvelope = await store.readUserRootKeyEnvelope("user_live_789");

    expect([...context.rootKey]).toEqual([...created.rootKey]);
    expect(storedEnvelope?.rootKeyId).toBe(created.envelope.rootKeyId);
    expect(
      storedEnvelope?.recipients.find((recipient) => recipient.kind === "user-unlock")?.keyId,
    ).toBe("browser:v1");
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

    expect(await store.readUserRootKeyEnvelope(legacyUserId)).toBeNull();
    const context = await store.ensureUserCryptoContext(legacyUserId);
    const storedEnvelope = await store.readUserRootKeyEnvelope(legacyUserId);
    const currentObjectKey = await hostedUserKeyEnvelopeObjectKeyForTest(envelopeEncryptionKey, legacyUserId);

    expect(storedEnvelope?.schema).toBe("murph.hosted-user-root-key-envelope.v2");
    expect(
      storedEnvelope?.recipients.find((recipient) => recipient.kind === "automation")?.keyId,
    ).toBe("automation:v2");
    expect(storedEnvelope?.rootKeyId).toBe(context.rootKeyId);
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

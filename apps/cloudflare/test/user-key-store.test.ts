import { describe, expect, it } from "vitest";

import {
  createHostedUserRootKeyEnvelope,
  generateHostedUserRecipientKeyPair,
} from "@murphai/runtime-state";

import { encryptHostedBundle, writeEncryptedR2Json } from "../src/crypto.js";
import { buildHostedStorageAad, deriveHostedStorageOpaqueId } from "../src/crypto-context.js";
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

    expect(oldEnvelopeObjectKey).toBeTruthy();
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

  it("migrates legacy v1 envelopes from the old static object path", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const envelopeEncryptionKey = createTestRootKey(23);
    const automation = await generateHostedUserRecipientKeyPair();
    const legacyUserId = "user_live_legacy";
    const legacyObjectKey = `users/keys/${encodeURIComponent(legacyUserId)}.json`;
    const legacyRootKey = createTestRootKey(29);

    await writeLegacyV1Envelope({
      automationKey: envelopeEncryptionKey,
      bucket,
      envelopeEncryptionKey,
      envelopeEncryptionKeyId: "v1",
      objectKey: legacyObjectKey,
      rootKey: legacyRootKey,
      userId: legacyUserId,
    });

    const store = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v2",
      automationRecipientPrivateKey: automation.privateKeyJwk,
      automationRecipientPublicKey: automation.publicKeyJwk,
      bucket,
      envelopeEncryptionKey,
      envelopeEncryptionKeyId: "v1",
    });

    const context = await store.ensureUserCryptoContext(legacyUserId);
    const storedEnvelope = await store.readUserRootKeyEnvelope(legacyUserId);
    const currentObjectKey = await hostedUserKeyEnvelopeObjectKeyForTest(envelopeEncryptionKey, legacyUserId);

    expect([...context.rootKey]).toEqual([...legacyRootKey]);
    expect(storedEnvelope?.schema).toBe("murph.hosted-user-root-key-envelope.v2");
    expect(
      storedEnvelope?.recipients.find((recipient) => recipient.kind === "automation")?.keyId,
    ).toBe("automation:v2");
    expect(bucket.objects.has(currentObjectKey)).toBe(true);
    expect(bucket.deleted).toContain(legacyObjectKey);
  });
});

async function writeLegacyV1Envelope(input: {
  automationKey: Uint8Array;
  bucket: MemoryEncryptedR2Bucket;
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeyId: string;
  objectKey: string;
  rootKey: Uint8Array;
  userId: string;
}): Promise<void> {
  const recipient = await encryptHostedBundle({
    aad: buildHostedStorageAad({
      keyId: "automation:v1",
      recipientKind: "automation",
      rootKeyId: "legacy-root-key-v1",
      userId: input.userId,
    }),
    key: input.automationKey,
    keyId: "automation:v1",
    plaintext: input.rootKey,
    scope: "root-key-recipient",
  });

  await writeEncryptedR2Json({
    aad: buildHostedStorageAad({
      key: input.objectKey,
      purpose: "root-key-envelope",
      userId: input.userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.envelopeEncryptionKey,
    key: input.objectKey,
    keyId: input.envelopeEncryptionKeyId,
    scope: "root-key-envelope",
    value: {
      createdAt: "2026-03-20T10:00:00.000Z",
      recipients: [{
        ciphertext: recipient.ciphertext,
        iv: recipient.iv,
        keyId: recipient.keyId,
        kind: "automation",
      }],
      rootKeyId: "legacy-root-key-v1",
      schema: "murph.hosted-user-root-key-envelope.v1",
      updatedAt: "2026-03-20T10:05:00.000Z",
      userId: input.userId,
    },
  });
}

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

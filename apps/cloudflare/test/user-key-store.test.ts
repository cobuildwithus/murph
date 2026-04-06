import {
  findHostedWrappedRootKeyRecipient,
  generateHostedUserRecipientKeyPair,
  parseHostedUserRootKeyEnvelope,
  wrapHostedUserRootKeyRecipient,
} from "@murphai/runtime-state";
import { describe, expect, it } from "vitest";

import { buildHostedStorageAad } from "../src/crypto-context.js";
import { readEncryptedR2Payload, writeEncryptedR2Json } from "../src/crypto.js";
import {
  createHostedUserKeyStore,
  type HostedUserKeyAuditRecord,
} from "../src/user-key-store.js";

import { MemoryEncryptedR2Bucket } from "./test-helpers";

const PLATFORM_ENVELOPE_KEY = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));
const PLATFORM_ENVELOPE_KEY_ID = "platform:v1";
const USER_ID = "member_test_user";

describe("createHostedUserKeyStore", () => {
  it("fails closed when runtime access happens before managed provisioning", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const automationKeys = await generateHostedUserRecipientKeyPair();
    const recoveryKeys = await generateHostedUserRecipientKeyPair();
    const store = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automationKeys.privateKeyJwk,
      automationRecipientPublicKey: automationKeys.publicKeyJwk,
      bucket,
      envelopeEncryptionKey: PLATFORM_ENVELOPE_KEY,
      envelopeEncryptionKeyId: PLATFORM_ENVELOPE_KEY_ID,
      recoveryRecipientKeyId: "recovery:v1",
      recoveryRecipientPublicKey: recoveryKeys.publicKeyJwk,
    });

    await expect(
      store.requireUserCryptoContext(USER_ID, { reason: "test-runtime-access" }),
    ).rejects.toThrow(/Provision managed user crypto before runtime access/u);
  });

  it("bootstraps automation, recovery, and optional tee recipients", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const automationKeys = await generateHostedUserRecipientKeyPair();
    const recoveryKeys = await generateHostedUserRecipientKeyPair();
    const teeKeys = await generateHostedUserRecipientKeyPair();
    const auditLog: HostedUserKeyAuditRecord[] = [];
    const store = createHostedUserKeyStore({
      auditLog: (record) => {
        auditLog.push(record);
      },
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automationKeys.privateKeyJwk,
      automationRecipientPublicKey: automationKeys.publicKeyJwk,
      bucket,
      envelopeEncryptionKey: PLATFORM_ENVELOPE_KEY,
      envelopeEncryptionKeyId: PLATFORM_ENVELOPE_KEY_ID,
      recoveryRecipientKeyId: "recovery:v1",
      recoveryRecipientPublicKey: recoveryKeys.publicKeyJwk,
      teeAutomationRecipientKeyId: "tee-automation:v1",
      teeAutomationRecipientPublicKey: teeKeys.publicKeyJwk,
    });

    const context = await store.bootstrapManagedUserCryptoContext(USER_ID, {
      reason: "test-bootstrap",
    });

    expect(context.envelope.recipients.map((recipient) => recipient.kind)).toEqual([
      "automation",
      "recovery",
      "tee-automation",
    ]);
    expect(auditLog).toEqual([
      {
        action: "root-key-bootstrap",
        reason: "test-bootstrap",
        recipientKinds: ["automation", "recovery", "tee-automation"],
        rootKeyId: context.rootKeyId,
        userId: USER_ID,
      },
    ]);
  });

  it("preserves future user-unlock recipients while reconciling managed recipients", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const auditLog: HostedUserKeyAuditRecord[] = [];
    const automationKeys = await generateHostedUserRecipientKeyPair();
    const initialRecoveryKeys = await generateHostedUserRecipientKeyPair();
    const nextRecoveryKeys = await generateHostedUserRecipientKeyPair();
    const teeKeys = await generateHostedUserRecipientKeyPair();
    const futureUserUnlockKeys = await generateHostedUserRecipientKeyPair();
    const initialStore = createHostedUserKeyStore({
      auditLog: (record) => {
        auditLog.push(record);
      },
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automationKeys.privateKeyJwk,
      automationRecipientPublicKey: automationKeys.publicKeyJwk,
      bucket,
      envelopeEncryptionKey: PLATFORM_ENVELOPE_KEY,
      envelopeEncryptionKeyId: PLATFORM_ENVELOPE_KEY_ID,
      recoveryRecipientKeyId: "recovery:v1",
      recoveryRecipientPublicKey: initialRecoveryKeys.publicKeyJwk,
    });
    const initialContext = await initialStore.bootstrapManagedUserCryptoContext(USER_ID, {
      reason: "test-bootstrap",
    });
    const storedEnvelope = await readStoredEnvelope(bucket, USER_ID);
    const envelopeObjectKey = readOnlyObjectKey(bucket);
    const futureRecipient = await wrapHostedUserRootKeyRecipient({
      recipient: {
        kind: "user-unlock",
        keyId: "browser:v1",
        publicKeyJwk: futureUserUnlockKeys.publicKeyJwk,
      },
      rootKey: initialContext.rootKey,
      rootKeyId: storedEnvelope.rootKeyId,
      userId: USER_ID,
    });

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        key: envelopeObjectKey,
        purpose: "root-key-envelope",
        userId: USER_ID,
      }),
      bucket,
      cryptoKey: PLATFORM_ENVELOPE_KEY,
      key: envelopeObjectKey,
      keyId: PLATFORM_ENVELOPE_KEY_ID,
      scope: "root-key-envelope",
      value: {
        ...storedEnvelope,
        recipients: [...storedEnvelope.recipients, futureRecipient],
        updatedAt: "2026-04-05T00:00:01.000Z",
      },
    });

    const reconciledStore = createHostedUserKeyStore({
      auditLog: (record) => {
        auditLog.push(record);
      },
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automationKeys.privateKeyJwk,
      automationRecipientPublicKey: automationKeys.publicKeyJwk,
      bucket,
      envelopeEncryptionKey: PLATFORM_ENVELOPE_KEY,
      envelopeEncryptionKeyId: PLATFORM_ENVELOPE_KEY_ID,
      recoveryRecipientKeyId: "recovery:v2",
      recoveryRecipientPublicKey: nextRecoveryKeys.publicKeyJwk,
      teeAutomationRecipientKeyId: "tee-automation:v1",
      teeAutomationRecipientPublicKey: teeKeys.publicKeyJwk,
    });

    const reconciled = await reconciledStore.requireUserCryptoContext(USER_ID, {
      reason: "test-reconcile",
    });
    const futureRecipientAfterReconcile = findHostedWrappedRootKeyRecipient(
      reconciled.envelope,
      "user-unlock",
    );
    const recoveryRecipient = findHostedWrappedRootKeyRecipient(reconciled.envelope, "recovery");
    const teeRecipient = findHostedWrappedRootKeyRecipient(reconciled.envelope, "tee-automation");

    expect(futureRecipientAfterReconcile?.keyId).toBe("browser:v1");
    expect(recoveryRecipient?.keyId).toBe("recovery:v2");
    expect(teeRecipient?.keyId).toBe("tee-automation:v1");
    expect(reconciled.envelope.recipients.map((recipient) => recipient.kind)).toEqual([
      "user-unlock",
      "automation",
      "recovery",
      "tee-automation",
    ]);
    expect(auditLog.map((record) => record.action)).toEqual([
      "root-key-bootstrap",
      "root-key-unwrap",
      "root-key-reconcile",
    ]);
    expect(auditLog[1]).toMatchObject({
      action: "root-key-unwrap",
      reason: "managed-recipient-reconciliation",
      rootKeyId: reconciled.rootKeyId,
      userId: USER_ID,
    });
    expect(auditLog[2]).toMatchObject({
      action: "root-key-reconcile",
      reason: "managed-recipient-reconciliation",
      recipientKinds: ["user-unlock", "automation", "recovery", "tee-automation"],
      rootKeyId: reconciled.rootKeyId,
      userId: USER_ID,
    });
  });

  it("drops stale tee automation recipients when tee is no longer configured", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const automationKeys = await generateHostedUserRecipientKeyPair();
    const recoveryKeys = await generateHostedUserRecipientKeyPair();
    const teeKeys = await generateHostedUserRecipientKeyPair();
    const initialStore = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automationKeys.privateKeyJwk,
      automationRecipientPublicKey: automationKeys.publicKeyJwk,
      bucket,
      envelopeEncryptionKey: PLATFORM_ENVELOPE_KEY,
      envelopeEncryptionKeyId: PLATFORM_ENVELOPE_KEY_ID,
      recoveryRecipientKeyId: "recovery:v1",
      recoveryRecipientPublicKey: recoveryKeys.publicKeyJwk,
      teeAutomationRecipientKeyId: "tee-automation:v1",
      teeAutomationRecipientPublicKey: teeKeys.publicKeyJwk,
    });

    await initialStore.bootstrapManagedUserCryptoContext(USER_ID, {
      reason: "test-bootstrap",
    });

    const storeWithoutTee = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automationKeys.privateKeyJwk,
      automationRecipientPublicKey: automationKeys.publicKeyJwk,
      bucket,
      envelopeEncryptionKey: PLATFORM_ENVELOPE_KEY,
      envelopeEncryptionKeyId: PLATFORM_ENVELOPE_KEY_ID,
      recoveryRecipientKeyId: "recovery:v1",
      recoveryRecipientPublicKey: recoveryKeys.publicKeyJwk,
    });

    const reconciled = await storeWithoutTee.requireUserCryptoContext(USER_ID, {
      reason: "test-remove-tee",
    });

    expect(findHostedWrappedRootKeyRecipient(reconciled.envelope, "automation")?.keyId).toBe("automation:v1");
    expect(findHostedWrappedRootKeyRecipient(reconciled.envelope, "recovery")?.keyId).toBe("recovery:v1");
    expect(findHostedWrappedRootKeyRecipient(reconciled.envelope, "tee-automation")).toBeNull();
  });
});

async function readStoredEnvelope(bucket: MemoryEncryptedR2Bucket, userId: string) {
  const objectKey = readOnlyObjectKey(bucket);
  const plaintext = await readEncryptedR2Payload({
    aad: buildHostedStorageAad({
      key: objectKey,
      purpose: "root-key-envelope",
      userId,
    }),
    bucket,
    cryptoKey: PLATFORM_ENVELOPE_KEY,
    expectedKeyId: PLATFORM_ENVELOPE_KEY_ID,
    key: objectKey,
    scope: "root-key-envelope",
  });

  if (!plaintext) {
    throw new Error("Expected a stored user root key envelope.");
  }

  return parseHostedUserRootKeyEnvelope(JSON.parse(new TextDecoder().decode(plaintext)));
}

function readOnlyObjectKey(bucket: MemoryEncryptedR2Bucket): string {
  const [objectKey] = bucket.objects.keys();

  if (!objectKey) {
    throw new Error("Expected exactly one stored object key.");
  }

  return objectKey;
}

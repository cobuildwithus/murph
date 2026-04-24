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
  HostedUserCryptoRepairNeededError,
  type HostedUserKeyAuditRecord,
} from "../src/user-key-store.js";

import { MemoryEncryptedR2Bucket } from "./test-helpers.js";

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
    ).rejects.toMatchObject({
      name: "HostedUserCryptoRepairNeededError",
      reason: "missing-envelope",
    } satisfies Partial<HostedUserCryptoRepairNeededError>);
  });

  it("exposes activation-only provisioning and no generic bootstrap helper", async () => {
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

    expect("provisionManagedUserCryptoAtActivation" in store).toBe(true);
    expect("ensureManagedUserCryptoEnvelope" in store).toBe(false);
  });

  it("ensures automation, recovery, and optional tee recipients", async () => {
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

    const status = await store.provisionManagedUserCryptoAtActivation(USER_ID, {
      reason: "test-bootstrap",
    });

    expect(status.needsRunnerStoreRefresh).toBe(true);
    expect(status.envelope.recipients.map((recipient) => recipient.kind)).toEqual([
      "automation",
      "recovery",
      "tee-automation",
    ]);
    expect(auditLog).toEqual([
      {
        action: "root-key-bootstrap",
        reason: "test-bootstrap",
        recipientKinds: ["automation", "recovery", "tee-automation"],
        rootKeyId: status.envelope.rootKeyId,
        userId: USER_ID,
      },
    ]);
  });

  it("activation provisioning preserves future user-unlock recipients while reconciling managed recipients", async () => {
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
    const ensured = await initialStore.provisionManagedUserCryptoAtActivation(USER_ID, {
      reason: "test-bootstrap",
    });
    const initialContext = await initialStore.requireUserCryptoContext(USER_ID, {
      reason: "test-initial-runtime",
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
      rootKeyId: ensured.envelope.rootKeyId,
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

    const reconciled = await reconciledStore.provisionManagedUserCryptoAtActivation(USER_ID, {
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
      "root-key-unwrap",
      "root-key-reconcile",
    ]);
    expect(auditLog[1]).toMatchObject({
      action: "root-key-unwrap",
      reason: "test-initial-runtime",
      rootKeyId: reconciled.envelope.rootKeyId,
      userId: USER_ID,
    });
    expect(auditLog[2]).toMatchObject({
      action: "root-key-unwrap",
      reason: "managed-recipient-reconciliation",
      rootKeyId: reconciled.envelope.rootKeyId,
      userId: USER_ID,
    });
    expect(auditLog[3]).toMatchObject({
      action: "root-key-reconcile",
      reason: "managed-recipient-reconciliation",
      recipientKinds: ["user-unlock", "automation", "recovery", "tee-automation"],
      rootKeyId: reconciled.envelope.rootKeyId,
      userId: USER_ID,
    });
  });

  it("runtime access fails closed when managed recipients require reconciliation", async () => {
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
    const ensured = await initialStore.provisionManagedUserCryptoAtActivation(USER_ID, {
      reason: "test-bootstrap",
    });
    const initialContext = await initialStore.requireUserCryptoContext(USER_ID, {
      reason: "test-initial-runtime",
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
      rootKeyId: ensured.envelope.rootKeyId,
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

    const beforeObjects = Array.from(bucket.objects.entries());
    const runtimeStore = createHostedUserKeyStore({
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

    await expect(
      runtimeStore.requireUserCryptoContext(USER_ID, {
        reason: "test-reconcile",
      }),
    ).rejects.toMatchObject({
      name: "HostedUserCryptoRepairNeededError",
      reason: "managed-recipient-reconciliation",
    } satisfies Partial<HostedUserCryptoRepairNeededError>);

    expect(Array.from(bucket.objects.entries())).toEqual(beforeObjects);
    expect(bucket.deleted).toEqual([]);
    expect(auditLog.map((record) => record.action)).toEqual([
      "root-key-bootstrap",
      "root-key-unwrap",
    ]);

    const envelopeAfterFailure = await readStoredEnvelope(bucket, USER_ID);
    expect(findHostedWrappedRootKeyRecipient(envelopeAfterFailure, "user-unlock")?.keyId).toBe("browser:v1");
    expect(findHostedWrappedRootKeyRecipient(envelopeAfterFailure, "recovery")?.keyId).toBe("recovery:v1");
    expect(findHostedWrappedRootKeyRecipient(envelopeAfterFailure, "tee-automation")).toBeNull();
  });

  it("runtime access decrypts a current-object-key envelope through the envelope keyring after a platform key rotation", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldEnvelopeKey = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 31));
    const oldEnvelopeKeyId = "platform:v0";
    const automationKeys = await generateHostedUserRecipientKeyPair();
    const recoveryKeys = await generateHostedUserRecipientKeyPair();
    const bootstrapStore = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automationKeys.privateKeyJwk,
      automationRecipientPublicKey: automationKeys.publicKeyJwk,
      bucket,
      envelopeEncryptionKey: PLATFORM_ENVELOPE_KEY,
      envelopeEncryptionKeyId: PLATFORM_ENVELOPE_KEY_ID,
      recoveryRecipientKeyId: "recovery:v1",
      recoveryRecipientPublicKey: recoveryKeys.publicKeyJwk,
    });

    const bootstrapped = await bootstrapStore.provisionManagedUserCryptoAtActivation(USER_ID, {
      reason: "test-bootstrap-current-object-key",
    });
    const initialContext = await bootstrapStore.requireUserCryptoContext(USER_ID, {
      reason: "test-bootstrap-runtime-access",
    });
    const currentObjectKey = readOnlyObjectKey(bucket);

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        key: currentObjectKey,
        purpose: "root-key-envelope",
        userId: USER_ID,
      }),
      bucket,
      cryptoKey: oldEnvelopeKey,
      key: currentObjectKey,
      keyId: oldEnvelopeKeyId,
      scope: "root-key-envelope",
      value: bootstrapped.envelope,
    });

    const beforeObjects = Array.from(bucket.objects.entries());
    const runtimeStore = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automationKeys.privateKeyJwk,
      automationRecipientPublicKey: automationKeys.publicKeyJwk,
      bucket,
      envelopeEncryptionKey: PLATFORM_ENVELOPE_KEY,
      envelopeEncryptionKeyId: PLATFORM_ENVELOPE_KEY_ID,
      envelopeEncryptionKeysById: {
        [oldEnvelopeKeyId]: oldEnvelopeKey,
      },
      recoveryRecipientKeyId: "recovery:v1",
      recoveryRecipientPublicKey: recoveryKeys.publicKeyJwk,
    });

    const runtimeContext = await runtimeStore.requireUserCryptoContext(USER_ID, {
      reason: "test-rotated-keyring-runtime-access",
    });

    expect(runtimeContext.envelope.rootKeyId).toBe(bootstrapped.envelope.rootKeyId);
    expect(Array.from(runtimeContext.rootKey)).toEqual(Array.from(initialContext.rootKey));
    expect(Array.from(bucket.objects.entries())).toEqual(beforeObjects);
    expect(bucket.deleted).toEqual([]);
  });

  it("activation provisioning drops stale tee automation recipients when tee is no longer configured", async () => {
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

    await initialStore.provisionManagedUserCryptoAtActivation(USER_ID, {
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

    const reconciled = await storeWithoutTee.provisionManagedUserCryptoAtActivation(USER_ID, {
      reason: "test-remove-tee",
    });

    expect(findHostedWrappedRootKeyRecipient(reconciled.envelope, "automation")?.keyId).toBe("automation:v1");
    expect(findHostedWrappedRootKeyRecipient(reconciled.envelope, "recovery")?.keyId).toBe("recovery:v1");
    expect(findHostedWrappedRootKeyRecipient(reconciled.envelope, "tee-automation")).toBeNull();
  });

  it("runtime access ignores envelopes stored under non-current key-derived object keys", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldEnvelopeKey = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 31));
    const oldEnvelopeKeyId = "platform:v0";
    const automationKeys = await generateHostedUserRecipientKeyPair();
    const recoveryKeys = await generateHostedUserRecipientKeyPair();
    const previousStore = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automationKeys.privateKeyJwk,
      automationRecipientPublicKey: automationKeys.publicKeyJwk,
      bucket,
      envelopeEncryptionKey: oldEnvelopeKey,
      envelopeEncryptionKeyId: oldEnvelopeKeyId,
      recoveryRecipientKeyId: "recovery:v1",
      recoveryRecipientPublicKey: recoveryKeys.publicKeyJwk,
    });

    await previousStore.provisionManagedUserCryptoAtActivation(USER_ID, {
      reason: "test-bootstrap-non-current-location",
    });

    const beforeObjects = Array.from(bucket.objects.entries());
    const currentStore = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automationKeys.privateKeyJwk,
      automationRecipientPublicKey: automationKeys.publicKeyJwk,
      automationRecipientPrivateKeysById: {
        "automation:v1": automationKeys.privateKeyJwk,
      },
      bucket,
      envelopeEncryptionKey: PLATFORM_ENVELOPE_KEY,
      envelopeEncryptionKeyId: PLATFORM_ENVELOPE_KEY_ID,
      envelopeEncryptionKeysById: {
        [oldEnvelopeKeyId]: oldEnvelopeKey,
      },
      recoveryRecipientKeyId: "recovery:v1",
      recoveryRecipientPublicKey: recoveryKeys.publicKeyJwk,
    });

    await expect(
      currentStore.requireUserCryptoContext(USER_ID, {
        reason: "test-non-current-location-runtime",
      }),
    ).rejects.toMatchObject({
      name: "HostedUserCryptoRepairNeededError",
      reason: "missing-envelope",
    } satisfies Partial<HostedUserCryptoRepairNeededError>);

    expect(Array.from(bucket.objects.entries())).toEqual(beforeObjects);
    expect(bucket.deleted).toEqual([]);
  });

  it("activation provisioning writes only the current object key when old platform keys remain configured", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const oldEnvelopeKey = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 31));
    const oldEnvelopeKeyId = "platform:v0";
    const automationKeys = await generateHostedUserRecipientKeyPair();
    const recoveryKeys = await generateHostedUserRecipientKeyPair();
    const previousStore = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automationKeys.privateKeyJwk,
      automationRecipientPublicKey: automationKeys.publicKeyJwk,
      bucket,
      envelopeEncryptionKey: oldEnvelopeKey,
      envelopeEncryptionKeyId: oldEnvelopeKeyId,
      recoveryRecipientKeyId: "recovery:v1",
      recoveryRecipientPublicKey: recoveryKeys.publicKeyJwk,
    });

    await previousStore.provisionManagedUserCryptoAtActivation(USER_ID, {
      reason: "test-bootstrap-non-current-location",
    });
    const [previousObjectKey] = bucket.objects.keys();

    const currentStore = createHostedUserKeyStore({
      automationRecipientKeyId: "automation:v1",
      automationRecipientPrivateKey: automationKeys.privateKeyJwk,
      automationRecipientPublicKey: automationKeys.publicKeyJwk,
      bucket,
      envelopeEncryptionKey: PLATFORM_ENVELOPE_KEY,
      envelopeEncryptionKeyId: PLATFORM_ENVELOPE_KEY_ID,
      envelopeEncryptionKeysById: {
        [oldEnvelopeKeyId]: oldEnvelopeKey,
      },
      recoveryRecipientKeyId: "recovery:v1",
      recoveryRecipientPublicKey: recoveryKeys.publicKeyJwk,
    });

    await currentStore.provisionManagedUserCryptoAtActivation(USER_ID, {
      reason: "test-current-location",
    });

    const currentObjectKey = Array.from(bucket.objects.keys()).find((objectKey) =>
      objectKey !== previousObjectKey
    );
    expect(currentObjectKey).toBeTruthy();
    expect(currentObjectKey).not.toBe(previousObjectKey);
    expect(bucket.objects.size).toBe(2);
    expect(bucket.deleted).toEqual([]);
    if (!currentObjectKey) {
      throw new Error("Expected a current user root key envelope object key.");
    }

    const plaintext = await readEncryptedR2Payload({
      aad: buildHostedStorageAad({
        key: currentObjectKey,
        purpose: "root-key-envelope",
        userId: USER_ID,
      }),
      bucket,
      cryptoKey: PLATFORM_ENVELOPE_KEY,
      expectedKeyId: PLATFORM_ENVELOPE_KEY_ID,
      key: currentObjectKey,
      scope: "root-key-envelope",
    });
    expect(plaintext).toBeTruthy();
    if (!plaintext) {
      throw new Error("Expected a current user root key envelope payload.");
    }
    const envelope = parseHostedUserRootKeyEnvelope(
      JSON.parse(new TextDecoder().decode(plaintext)),
    );
    expect(envelope.userId).toBe(USER_ID);
  });

  it("rejects stored envelopes whose payload user does not match the requested user", async () => {
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

    await store.provisionManagedUserCryptoAtActivation(USER_ID, {
      reason: "test-bootstrap",
    });

    const objectKey = readOnlyObjectKey(bucket);
    const storedEnvelope = await readStoredEnvelope(bucket, USER_ID);
    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        key: objectKey,
        purpose: "root-key-envelope",
        userId: USER_ID,
      }),
      bucket,
      cryptoKey: PLATFORM_ENVELOPE_KEY,
      key: objectKey,
      keyId: PLATFORM_ENVELOPE_KEY_ID,
      scope: "root-key-envelope",
      value: {
        ...storedEnvelope,
        userId: "member_other_user",
      },
    });

    await expect(
      store.requireUserCryptoContext(USER_ID, { reason: "test-user-mismatch" }),
    ).rejects.toThrow(/Hosted user root key envelope user mismatch/u);
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

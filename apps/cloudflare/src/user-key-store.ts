import {
  createHostedUserRootKeyEnvelope,
  findHostedWrappedRootKeyRecipient,
  parseHostedUserRootKeyEnvelope,
  unwrapHostedUserRootKeyForKind,
  wrapHostedUserRootKeyRecipient,
  type HostedUserRecipientPrivateKeyJwk,
  type HostedUserRecipientPublicKeyJwk,
  type HostedUserRootKeyEnvelope,
  type HostedUserRootKeyEnvelopeRecipientInput,
  type HostedUserRootKeyRecipientKind,
} from "@murphai/runtime-state";

import type { R2BucketLike } from "./bundle-store.js";
import { buildHostedStorageAad, deriveHostedStorageOpaqueId } from "./crypto-context.js";
import { readEncryptedR2Payload, writeEncryptedR2Json } from "./crypto.js";
import { listHostedStorageObjectKeys } from "./storage-paths.js";

export interface HostedUserCryptoContext {
  envelope: HostedUserRootKeyEnvelope;
  rootKey: Uint8Array;
  rootKeyId: string;
  keysById: Readonly<Record<string, Uint8Array>>;
}

export interface HostedUserKeyAuditRecord {
  action: "root-key-bootstrap" | "root-key-reconcile" | "root-key-unwrap";
  reason: string;
  recipientKinds: HostedUserRootKeyRecipientKind[];
  rootKeyId: string;
  userId: string;
}

export interface HostedUserKeyStore {
  bootstrapManagedUserCryptoContext(
    userId: string,
    options?: { reason?: string },
  ): Promise<HostedUserCryptoContext>;
  requireUserCryptoContext(
    userId: string,
    options?: { reason?: string },
  ): Promise<HostedUserCryptoContext>;
}

export function createHostedUserKeyStore(input: {
  auditLog?: ((record: HostedUserKeyAuditRecord) => Promise<void> | void) | null;
  automationRecipientKeyId: string;
  automationRecipientPrivateKey: HostedUserRecipientPrivateKeyJwk;
  automationRecipientPrivateKeysById?: Readonly<Record<string, HostedUserRecipientPrivateKeyJwk>>;
  automationRecipientPublicKey: HostedUserRecipientPublicKeyJwk;
  bucket: R2BucketLike;
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeyId: string;
  envelopeEncryptionKeysById?: Readonly<Record<string, Uint8Array>>;
  recoveryRecipientKeyId: string;
  recoveryRecipientPublicKey: HostedUserRecipientPublicKeyJwk;
  teeAutomationRecipientKeyId?: string | null;
  teeAutomationRecipientPublicKey?: HostedUserRecipientPublicKeyJwk | null;
}): HostedUserKeyStore {
  assertOptionalRecipientPairConfigured({
    keyId: input.teeAutomationRecipientKeyId ?? null,
    keyLabel: "tee automation recipient",
    publicKey: input.teeAutomationRecipientPublicKey ?? null,
  });

  const automationPrivateKeysById = {
    ...(input.automationRecipientPrivateKeysById ?? {}),
    [input.automationRecipientKeyId]: input.automationRecipientPrivateKey,
  } satisfies Record<string, HostedUserRecipientPrivateKeyJwk>;
  const envelopeEncryptionKeysById = {
    ...(input.envelopeEncryptionKeysById ?? {}),
    [input.envelopeEncryptionKeyId]: input.envelopeEncryptionKey,
  } satisfies Record<string, Uint8Array>;
  const desiredManagedRecipients = buildDesiredManagedRecipients({
    automationRecipientKeyId: input.automationRecipientKeyId,
    automationRecipientPublicKey: input.automationRecipientPublicKey,
    recoveryRecipientKeyId: input.recoveryRecipientKeyId,
    recoveryRecipientPublicKey: input.recoveryRecipientPublicKey,
    teeAutomationRecipientKeyId: input.teeAutomationRecipientKeyId ?? null,
    teeAutomationRecipientPublicKey: input.teeAutomationRecipientPublicKey ?? null,
  });

  return {
    async bootstrapManagedUserCryptoContext(userId, options = {}) {
      return resolveHostedUserCryptoContext({
        auditLog: input.auditLog ?? null,
        automationRecipientPrivateKeysById: automationPrivateKeysById,
        bucket: input.bucket,
        desiredManagedRecipients,
        envelopeEncryptionKey: input.envelopeEncryptionKey,
        envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
        envelopeEncryptionKeysById,
        allowMissingEnvelopeBootstrap: true,
        reason: options.reason ?? "managed-user-provisioning",
        userId,
      });
    },
    async requireUserCryptoContext(userId, options = {}) {
      return resolveHostedUserCryptoContext({
        auditLog: input.auditLog ?? null,
        automationRecipientPrivateKeysById: automationPrivateKeysById,
        bucket: input.bucket,
        desiredManagedRecipients,
        envelopeEncryptionKey: input.envelopeEncryptionKey,
        envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
        envelopeEncryptionKeysById,
        allowMissingEnvelopeBootstrap: false,
        reason: options.reason ?? "runtime-access",
        userId,
      });
    },
  };
}

async function resolveHostedUserCryptoContext(input: {
  auditLog: ((record: HostedUserKeyAuditRecord) => Promise<void> | void) | null;
  automationRecipientPrivateKeysById: Readonly<Record<string, HostedUserRecipientPrivateKeyJwk>>;
  bucket: R2BucketLike;
  desiredManagedRecipients: readonly HostedUserRootKeyEnvelopeRecipientInput[];
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeyId: string;
  envelopeEncryptionKeysById: Readonly<Record<string, Uint8Array>>;
  allowMissingEnvelopeBootstrap: boolean;
  reason: string;
  userId: string;
}): Promise<HostedUserCryptoContext> {
  const resolved = await resolveHostedUserRootKeyEnvelope(input);
  const rootKey = resolved.rootKey ?? await unwrapHostedAutomationRootKey({
    auditLog: input.auditLog,
    automationRecipientPrivateKeysById: input.automationRecipientPrivateKeysById,
    envelope: resolved.envelope,
    reason: input.reason,
  });

  return {
    envelope: resolved.envelope,
    rootKey,
    rootKeyId: resolved.envelope.rootKeyId,
    keysById: {
      [resolved.envelope.rootKeyId]: rootKey,
    },
  };
}

async function resolveHostedUserRootKeyEnvelope(input: {
  auditLog: ((record: HostedUserKeyAuditRecord) => Promise<void> | void) | null;
  automationRecipientPrivateKeysById: Readonly<Record<string, HostedUserRecipientPrivateKeyJwk>>;
  bucket: R2BucketLike;
  desiredManagedRecipients: readonly HostedUserRootKeyEnvelopeRecipientInput[];
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeyId: string;
  envelopeEncryptionKeysById: Readonly<Record<string, Uint8Array>>;
  allowMissingEnvelopeBootstrap: boolean;
  reason: string;
  userId: string;
}): Promise<{ envelope: HostedUserRootKeyEnvelope; rootKey: Uint8Array | null }> {
  const existingEnvelope = await readStoredHostedUserRootKeyEnvelope({
    bucket: input.bucket,
    envelopeEncryptionKey: input.envelopeEncryptionKey,
    envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
    envelopeEncryptionKeysById: input.envelopeEncryptionKeysById,
    userId: input.userId,
  });

  if (!existingEnvelope) {
    if (!input.allowMissingEnvelopeBootstrap) {
      throw new Error(
        `Hosted user root key envelope ${input.userId} is missing. Provision managed user crypto before runtime access.`,
      );
    }

    const created = await createHostedUserRootKeyEnvelope({
      recipients: input.desiredManagedRecipients,
      userId: input.userId,
    });
    await writeHostedUserRootKeyEnvelope({
      bucket: input.bucket,
      envelope: created.envelope,
      envelopeEncryptionKey: input.envelopeEncryptionKey,
      envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
      envelopeEncryptionKeysById: input.envelopeEncryptionKeysById,
    });
    await emitHostedUserKeyAudit(input.auditLog, {
      action: "root-key-bootstrap",
      reason: input.reason,
      recipientKinds: created.envelope.recipients.map((recipient) => recipient.kind),
      rootKeyId: created.envelope.rootKeyId,
      userId: input.userId,
    });
    return {
      envelope: created.envelope,
      rootKey: created.rootKey,
    };
  }

  const needsReconciliation = input.desiredManagedRecipients.some((desiredRecipient) => {
    const existingRecipient = findHostedWrappedRootKeyRecipient(existingEnvelope, desiredRecipient.kind);
    return !existingRecipient || existingRecipient.keyId !== desiredRecipient.keyId;
  });

  if (!needsReconciliation) {
    return {
      envelope: existingEnvelope,
      rootKey: null,
    };
  }

  const rootKey = await unwrapHostedAutomationRootKey({
    auditLog: input.auditLog,
    automationRecipientPrivateKeysById: input.automationRecipientPrivateKeysById,
    envelope: existingEnvelope,
    reason: "managed-recipient-reconciliation",
  });
  const preservedRecipients = existingEnvelope.recipients.filter((recipient) =>
    !input.desiredManagedRecipients.some((desiredRecipient) => desiredRecipient.kind === recipient.kind)
  );
  const reconciledRecipients = await Promise.all(
    input.desiredManagedRecipients.map(async (desiredRecipient) => {
      const existingRecipient = findHostedWrappedRootKeyRecipient(existingEnvelope, desiredRecipient.kind);

      if (existingRecipient && existingRecipient.keyId === desiredRecipient.keyId) {
        return existingRecipient;
      }

      return wrapHostedUserRootKeyRecipient({
        recipient: desiredRecipient,
        rootKey,
        rootKeyId: existingEnvelope.rootKeyId,
        userId: existingEnvelope.userId,
      });
    }),
  );
  const reconciledEnvelope: HostedUserRootKeyEnvelope = {
    ...existingEnvelope,
    recipients: [...preservedRecipients, ...reconciledRecipients],
    updatedAt: new Date().toISOString(),
  };
  await writeHostedUserRootKeyEnvelope({
    bucket: input.bucket,
    envelope: reconciledEnvelope,
    envelopeEncryptionKey: input.envelopeEncryptionKey,
    envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
    envelopeEncryptionKeysById: input.envelopeEncryptionKeysById,
  });
  await emitHostedUserKeyAudit(input.auditLog, {
    action: "root-key-reconcile",
    reason: "managed-recipient-reconciliation",
    recipientKinds: reconciledEnvelope.recipients.map((recipient) => recipient.kind),
    rootKeyId: reconciledEnvelope.rootKeyId,
    userId: reconciledEnvelope.userId,
  });

  return {
    envelope: reconciledEnvelope,
    rootKey,
  };
}

async function readStoredHostedUserRootKeyEnvelope(input: {
  bucket: R2BucketLike;
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeyId: string;
  envelopeEncryptionKeysById: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): Promise<HostedUserRootKeyEnvelope | null> {
  for (const objectKey of await hostedUserRootKeyEnvelopeObjectKeys(
    input.envelopeEncryptionKey,
    input.envelopeEncryptionKeysById,
    input.userId,
  )) {
    const plaintext = await readEncryptedR2Payload({
      aad: buildHostedStorageAad({
        key: objectKey,
        purpose: "root-key-envelope",
        userId: input.userId,
      }),
      bucket: input.bucket,
      cryptoKey: input.envelopeEncryptionKey,
      cryptoKeysById: input.envelopeEncryptionKeysById,
      expectedKeyId: input.envelopeEncryptionKeyId,
      key: objectKey,
      scope: "root-key-envelope",
    });

    if (!plaintext) {
      continue;
    }

    return parseHostedUserRootKeyEnvelope(JSON.parse(new TextDecoder().decode(plaintext)) as unknown);
  }

  return null;
}

async function writeHostedUserRootKeyEnvelope(input: {
  bucket: R2BucketLike;
  envelope: HostedUserRootKeyEnvelope;
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeyId: string;
  envelopeEncryptionKeysById?: Readonly<Record<string, Uint8Array>>;
}): Promise<void> {
  const objectKey = await hostedUserRootKeyEnvelopeObjectKey(
    input.envelopeEncryptionKey,
    input.envelope.userId,
  );

  await writeEncryptedR2Json({
    aad: buildHostedStorageAad({
      key: objectKey,
      purpose: "root-key-envelope",
      userId: input.envelope.userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.envelopeEncryptionKey,
    key: objectKey,
    keyId: input.envelopeEncryptionKeyId,
    scope: "root-key-envelope",
    value: input.envelope,
  });

  if (!input.bucket.delete) {
    return;
  }

  for (const candidateKey of await hostedUserRootKeyEnvelopeObjectKeys(
    input.envelopeEncryptionKey,
    input.envelopeEncryptionKeysById ?? {},
    input.envelope.userId,
  )) {
    if (candidateKey === objectKey) {
      continue;
    }

    await input.bucket.delete(candidateKey);
  }
}

async function unwrapHostedAutomationRootKey(input: {
  auditLog: ((record: HostedUserKeyAuditRecord) => Promise<void> | void) | null;
  automationRecipientPrivateKeysById: Readonly<Record<string, HostedUserRecipientPrivateKeyJwk>>;
  envelope: HostedUserRootKeyEnvelope;
  reason: string;
}): Promise<Uint8Array> {
  const automationRecipient = findHostedWrappedRootKeyRecipient(input.envelope, "automation");

  if (!automationRecipient) {
    throw new Error(`Hosted user root key envelope ${input.envelope.userId} is missing an automation recipient.`);
  }

  const recipientPrivateKeyJwk = input.automationRecipientPrivateKeysById[automationRecipient.keyId];

  if (!recipientPrivateKeyJwk) {
    throw new Error(
      `Hosted user root key envelope ${input.envelope.userId} references unknown automation key ${automationRecipient.keyId}.`,
    );
  }

  const rootKey = await unwrapHostedUserRootKeyForKind({
    envelope: input.envelope,
    kind: "automation",
    recipientPrivateKeyJwk,
  });
  await emitHostedUserKeyAudit(input.auditLog, {
    action: "root-key-unwrap",
    reason: input.reason,
    recipientKinds: input.envelope.recipients.map((recipient) => recipient.kind),
    rootKeyId: input.envelope.rootKeyId,
    userId: input.envelope.userId,
  });
  return rootKey;
}

async function hostedUserRootKeyEnvelopeObjectKey(
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

async function hostedUserRootKeyEnvelopeObjectKeys(
  envelopeEncryptionKey: Uint8Array,
  envelopeEncryptionKeysById: Readonly<Record<string, Uint8Array>>,
  userId: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(envelopeEncryptionKey, envelopeEncryptionKeysById, (candidateKey) =>
    hostedUserRootKeyEnvelopeObjectKey(candidateKey, userId)
  );
}

function buildDesiredManagedRecipients(input: {
  automationRecipientKeyId: string;
  automationRecipientPublicKey: HostedUserRecipientPublicKeyJwk;
  recoveryRecipientKeyId: string;
  recoveryRecipientPublicKey: HostedUserRecipientPublicKeyJwk;
  teeAutomationRecipientKeyId: string | null;
  teeAutomationRecipientPublicKey: HostedUserRecipientPublicKeyJwk | null;
}): readonly HostedUserRootKeyEnvelopeRecipientInput[] {
  const recipients: HostedUserRootKeyEnvelopeRecipientInput[] = [
    {
      keyId: input.automationRecipientKeyId,
      kind: "automation",
      publicKeyJwk: input.automationRecipientPublicKey,
    },
    {
      keyId: input.recoveryRecipientKeyId,
      kind: "recovery",
      publicKeyJwk: input.recoveryRecipientPublicKey,
    },
  ];

  if (input.teeAutomationRecipientKeyId && input.teeAutomationRecipientPublicKey) {
    recipients.push({
      keyId: input.teeAutomationRecipientKeyId,
      kind: "tee-automation",
      publicKeyJwk: input.teeAutomationRecipientPublicKey,
    });
  }

  return recipients;
}

function assertOptionalRecipientPairConfigured(input: {
  keyId: string | null;
  keyLabel: string;
  publicKey: HostedUserRecipientPublicKeyJwk | null;
}): void {
  const hasKeyId = Boolean(input.keyId);
  const hasPublicKey = input.publicKey !== null;

  if (hasKeyId === hasPublicKey) {
    return;
  }

  throw new TypeError(`${input.keyLabel} keyId and public key must either both be configured or both be omitted.`);
}

async function emitHostedUserKeyAudit(
  auditLog: ((record: HostedUserKeyAuditRecord) => Promise<void> | void) | null,
  record: HostedUserKeyAuditRecord,
): Promise<void> {
  if (!auditLog) {
    return;
  }

  try {
    await auditLog(record);
  } catch (error) {
    console.error(
      `Hosted user key audit logging failed for ${record.userId}/${record.action}.`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

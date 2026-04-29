import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
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
import { buildHostedStorageAad } from "./crypto-context.js";
import { readEncryptedR2Payload, writeEncryptedR2Json } from "./crypto.js";
import type { HostedExecutionEnvironment } from "./env.ts";
import { hostedUserRootKeyEnvelopeObjectKey } from "./storage-paths.js";

export interface HostedUserCryptoContext {
  envelope: HostedUserRootKeyEnvelope;
  rootKey: Uint8Array;
  rootKeyId: string;
  keysById: Readonly<Record<string, Uint8Array>>;
}

export interface HostedManagedUserCryptoEnvelopeStatus {
  envelope: HostedUserRootKeyEnvelope;
  needsRunnerStoreRefresh: boolean;
}

export interface HostedUserKeyAuditRecord {
  action: "root-key-bootstrap" | "root-key-reconcile" | "root-key-unwrap";
  reason: string;
  recipientKinds: HostedUserRootKeyRecipientKind[];
  rootKeyId: string;
  userId: string;
}

export type HostedUserCryptoRepairNeededReason =
  | "missing-envelope"
  | "managed-recipient-reconciliation";

export class HostedUserCryptoRepairNeededError extends Error {
  readonly reason: HostedUserCryptoRepairNeededReason;
  readonly userId: string;

  constructor(input: {
    message: string;
    reason: HostedUserCryptoRepairNeededReason;
    userId: string;
  }) {
    super(input.message);
    this.name = "HostedUserCryptoRepairNeededError";
    this.reason = input.reason;
    this.userId = input.userId;
  }
}

export interface HostedUserKeyStore {
  hasManagedUserCryptoEnvelope(userId: string): Promise<boolean>;
  provisionManagedUserCryptoAtActivation(
    userId: string,
    options?: { reason?: string },
  ): Promise<HostedManagedUserCryptoEnvelopeStatus>;
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
    async hasManagedUserCryptoEnvelope(userId) {
      return (await readStoredHostedUserRootKeyEnvelope({
        bucket: input.bucket,
        envelopeEncryptionKey: input.envelopeEncryptionKey,
        envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
        envelopeEncryptionKeysById,
        userId,
      })) !== null;
    },
    async provisionManagedUserCryptoAtActivation(userId, options = {}) {
      const resolved = await resolveHostedUserRootKeyEnvelope({
        auditLog: input.auditLog ?? null,
        automationRecipientPrivateKeysById: automationPrivateKeysById,
        bucket: input.bucket,
        desiredManagedRecipients,
        envelopeEncryptionKey: input.envelopeEncryptionKey,
        envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
        envelopeEncryptionKeysById,
        accessMode: "activation-provision",
        reason: options.reason ?? "member-activation-provisioning",
        userId,
      });

      return {
        envelope: resolved.envelope,
        needsRunnerStoreRefresh: resolved.rootKey !== null,
      };
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
        accessMode: "require-existing",
        reason: options.reason ?? "runtime-access",
        userId,
      });
    },
  };
}

export function createHostedUserKeyStoreFromEnvironment(input: {
  auditLog?: ((record: HostedUserKeyAuditRecord) => Promise<void> | void) | null;
  bucket: R2BucketLike;
  environment: HostedExecutionEnvironment;
}): HostedUserKeyStore {
  return createHostedUserKeyStore({
    auditLog: input.auditLog ?? null,
    automationRecipientKeyId: input.environment.automationRecipientKeyId,
    automationRecipientPrivateKey: input.environment.automationRecipientPrivateKey,
    automationRecipientPrivateKeysById: input.environment.automationRecipientPrivateKeysById,
    automationRecipientPublicKey: input.environment.automationRecipientPublicKey,
    bucket: input.bucket,
    envelopeEncryptionKey: input.environment.platformEnvelopeKey,
    envelopeEncryptionKeyId: input.environment.platformEnvelopeKeyId,
    envelopeEncryptionKeysById: input.environment.platformEnvelopeKeysById,
    recoveryRecipientKeyId: input.environment.recoveryRecipientKeyId,
    recoveryRecipientPublicKey: input.environment.recoveryRecipientPublicKey,
    teeAutomationRecipientKeyId: input.environment.teeAutomationRecipientKeyId,
    teeAutomationRecipientPublicKey: input.environment.teeAutomationRecipientPublicKey,
  });
}

export function requireHostedUserCryptoContextFromEnvironment(input: {
  auditLog?: ((record: HostedUserKeyAuditRecord) => Promise<void> | void) | null;
  bucket: R2BucketLike;
  environment: HostedExecutionEnvironment;
  reason: string;
  userId: string;
}): Promise<HostedUserCryptoContext> {
  return createHostedUserKeyStoreFromEnvironment({
    auditLog: input.auditLog ?? null,
    bucket: input.bucket,
    environment: input.environment,
  }).requireUserCryptoContext(input.userId, {
    reason: input.reason,
  });
}

async function resolveHostedUserCryptoContext(input: {
  auditLog: ((record: HostedUserKeyAuditRecord) => Promise<void> | void) | null;
  automationRecipientPrivateKeysById: Readonly<Record<string, HostedUserRecipientPrivateKeyJwk>>;
  bucket: R2BucketLike;
  desiredManagedRecipients: readonly HostedUserRootKeyEnvelopeRecipientInput[];
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeyId: string;
  envelopeEncryptionKeysById: Readonly<Record<string, Uint8Array>>;
  accessMode: "activation-provision" | "require-existing";
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
  accessMode: "activation-provision" | "require-existing";
  reason: string;
  userId: string;
}): Promise<{ envelope: HostedUserRootKeyEnvelope; rootKey: Uint8Array | null }> {
  const storedEnvelope = await readStoredHostedUserRootKeyEnvelope({
    bucket: input.bucket,
    envelopeEncryptionKey: input.envelopeEncryptionKey,
    envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
    envelopeEncryptionKeysById: input.envelopeEncryptionKeysById,
    userId: input.userId,
  });
  const existingEnvelope = storedEnvelope?.envelope ?? null;

  if (!existingEnvelope) {
    if (input.accessMode !== "activation-provision") {
      throw createHostedUserCryptoRepairNeededError({
        reason: "missing-envelope",
        userId: input.userId,
      });
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
  }) || existingEnvelope.recipients.some((recipient) =>
    isManagedRecipientKind(recipient.kind)
    && !input.desiredManagedRecipients.some((desiredRecipient) => desiredRecipient.kind === recipient.kind)
  );

  if (!needsReconciliation) {
    return {
      envelope: existingEnvelope,
      rootKey: null,
    };
  }

  if (input.accessMode !== "activation-provision") {
    throw createHostedUserCryptoRepairNeededError({
      reason: "managed-recipient-reconciliation",
      userId: input.userId,
    });
  }

  const rootKey = await unwrapHostedAutomationRootKey({
    auditLog: input.auditLog,
    automationRecipientPrivateKeysById: input.automationRecipientPrivateKeysById,
    envelope: existingEnvelope,
    reason: "managed-recipient-reconciliation",
  });
  const preservedRecipients = existingEnvelope.recipients.filter((recipient) =>
    !isManagedRecipientKind(recipient.kind)
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
}): Promise<{ envelope: HostedUserRootKeyEnvelope } | null> {
  const objectKey = await hostedUserRootKeyEnvelopeObjectKey(
    input.envelopeEncryptionKey,
    input.userId,
  );
  const plaintext = await readEncryptedR2Payload({
    aad: buildHostedStorageAad({
      key: objectKey,
      purpose: "root-key-envelope",
      userId: input.userId,
    }),
    bucket: input.bucket,
    callerLabel: "Hosted user root key envelope",
    cryptoKey: input.envelopeEncryptionKey,
    cryptoKeysById: input.envelopeEncryptionKeysById,
    expectedKeyId: input.envelopeEncryptionKeyId,
    key: objectKey,
    scope: "root-key-envelope",
  });

  if (!plaintext) {
    return null;
  }

  const envelopeValue: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  return {
    envelope: parseStoredHostedUserRootKeyEnvelope(
      envelopeValue,
      input.userId,
    ),
  };
}

function parseStoredHostedUserRootKeyEnvelope(
  value: unknown,
  expectedUserId: string,
): HostedUserRootKeyEnvelope {
  const envelope = parseHostedUserRootKeyEnvelope(value);

  if (envelope.userId !== expectedUserId) {
    throw new Error(
      `Hosted user root key envelope user mismatch: expected ${expectedUserId}, received ${envelope.userId}.`,
    );
  }

  return envelope;
}

async function writeHostedUserRootKeyEnvelope(input: {
  bucket: R2BucketLike;
  envelope: HostedUserRootKeyEnvelope;
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeyId: string;
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

function isManagedRecipientKind(kind: HostedUserRootKeyRecipientKind): boolean {
  return kind === "automation" || kind === "recovery" || kind === "tee-automation";
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

function createHostedUserCryptoRepairNeededError(input: {
  reason: HostedUserCryptoRepairNeededReason;
  userId: string;
}): HostedUserCryptoRepairNeededError {
  switch (input.reason) {
    case "missing-envelope":
      return new HostedUserCryptoRepairNeededError({
        message: "Hosted user root key envelope repair is required before runtime access: missing envelope.",
        reason: input.reason,
        userId: input.userId,
      });
    case "managed-recipient-reconciliation":
      return new HostedUserCryptoRepairNeededError({
        message: "Hosted user root key envelope repair is required before runtime access: managed recipients require reconciliation.",
        reason: input.reason,
        userId: input.userId,
      });
  }
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
    emitHostedExecutionStructuredLog({
      component: "hosted.user-key-store",
      details: {
        action: record.action,
        reason: record.reason,
      },
      error,
      level: "error",
      message: `Hosted user key audit logging failed during ${record.action}.`,
      phase: "runtime.starting",
      userId: record.userId,
    });
  }
}

import {
  findHostedWrappedRootKeyRecipient,
  parseHostedUserRootKeyEnvelope,
  type HostedUserRootKeyEnvelope,
  type HostedUserRootKeyRecipientKind,
  type HostedWrappedRootKeyRecipient,
  HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA,
} from "@murphai/runtime-state";

import type { R2BucketLike } from "./bundle-store.js";
import { decodeBase64, encodeBase64 } from "./base64.js";
import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "./crypto-context.js";
import {
  decryptHostedBundle,
  encryptHostedBundle,
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "./crypto.js";

const DEFAULT_AUTOMATION_RECIPIENT_KEY_ID = "automation:v1";
const HOSTED_USER_RECIPIENT_KEY_BYTES = 32;

export interface HostedUserCryptoContext {
  envelope: HostedUserRootKeyEnvelope;
  rootKey: Uint8Array;
  rootKeyId: string;
  keysById: Readonly<Record<string, Uint8Array>>;
}

export interface HostedUserKeyStore {
  ensureUserCryptoContext(userId: string): Promise<HostedUserCryptoContext>;
  readUserRootKeyEnvelope(userId: string): Promise<HostedUserRootKeyEnvelope | null>;
  upsertRecipient(input: {
    kind: HostedUserRootKeyRecipientKind;
    metadata?: Record<string, string | number | boolean | null>;
    recipientKey: Uint8Array;
    recipientKeyId: string;
    userId: string;
  }): Promise<HostedUserRootKeyEnvelope>;
}

export function createHostedUserKeyStore(input: {
  automationKey: Uint8Array;
  automationKeyId?: string;
  bucket: R2BucketLike;
  envelopeKeyId?: string;
  envelopeKeysById?: Readonly<Record<string, Uint8Array>>;
}): HostedUserKeyStore {
  const automationKeyId = input.automationKeyId ?? DEFAULT_AUTOMATION_RECIPIENT_KEY_ID;
  const envelopeKeyId = input.envelopeKeyId ?? automationKeyId;
  const envelopeKeysById = input.envelopeKeysById ?? {
    [envelopeKeyId]: input.automationKey,
  };

  return {
    async ensureUserCryptoContext(userId) {
      const envelope = await ensureHostedUserRootKeyEnvelope({
        automationKey: input.automationKey,
        automationKeyId,
        bucket: input.bucket,
        envelopeKeyId,
        envelopeKeysById,
        userId,
      });
      const automationRecipient = findHostedWrappedRootKeyRecipient(envelope, "automation");

      if (!automationRecipient) {
        throw new Error(`Hosted user root key envelope ${userId} is missing an automation recipient.`);
      }

      const rootKey = await unwrapHostedUserRootKey({
        recipient: automationRecipient,
        recipientKey: resolveHostedUserRecipientKeyBytes({
          currentKey: input.automationKey,
          currentKeyId: automationKeyId,
          keysById: envelopeKeysById,
          label: `Hosted user root key envelope ${userId} automation recipient`,
          recipient: automationRecipient,
        }),
      });

      return {
        envelope,
        rootKey,
        rootKeyId: envelope.rootKeyId,
        keysById: {
          [envelope.rootKeyId]: rootKey,
        },
      };
    },

    async readUserRootKeyEnvelope(userId) {
      return (await readStoredHostedUserRootKeyEnvelope({
        automationKey: input.automationKey,
        bucket: input.bucket,
        envelopeKeyId,
        envelopeKeysById,
        userId,
      }))?.envelope ?? null;
    },

    async upsertRecipient(recipientInput) {
      const context = await this.ensureUserCryptoContext(recipientInput.userId);
      const nextRecipient = await wrapHostedUserRootKey({
        kind: recipientInput.kind,
        metadata: recipientInput.metadata,
        recipientKey: requireHostedUserRecipientKeyBytes(
          recipientInput.recipientKey,
          `${recipientInput.kind} recipient key`,
        ),
        recipientKeyId: recipientInput.recipientKeyId,
        rootKey: context.rootKey,
      });
      const nowIso = new Date().toISOString();
      const nextEnvelope: HostedUserRootKeyEnvelope = {
        ...context.envelope,
        recipients: [
          ...context.envelope.recipients.filter((recipient) => recipient.kind !== recipientInput.kind),
          nextRecipient,
        ],
        updatedAt: nowIso,
      };

      await writeHostedUserRootKeyEnvelope({
        automationKey: input.automationKey,
        bucket: input.bucket,
        envelope: nextEnvelope,
        envelopeKeyId,
      });

      return nextEnvelope;
    },
  };
}

async function ensureHostedUserRootKeyEnvelope(input: {
  automationKey: Uint8Array;
  automationKeyId: string;
  bucket: R2BucketLike;
  envelopeKeyId: string;
  envelopeKeysById: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): Promise<HostedUserRootKeyEnvelope> {
  const currentKey = hostedUserRootKeyEnvelopeObjectKey(input.userId);
  const existing = await readStoredHostedUserRootKeyEnvelope({
    automationKey: input.automationKey,
    bucket: input.bucket,
    envelopeKeyId: input.envelopeKeyId,
    envelopeKeysById: input.envelopeKeysById,
    userId: input.userId,
  });

  if (existing) {
    const automationRecipient = findHostedWrappedRootKeyRecipient(existing.envelope, "automation");
    const requiresAutomationRecipientMigration = Boolean(
      automationRecipient && automationRecipient.keyId !== input.automationKeyId,
    );
    const requiresEnvelopePathMigration = existing.objectKey !== currentKey;

    if (!requiresAutomationRecipientMigration && !requiresEnvelopePathMigration) {
      return existing.envelope;
    }

    const nextEnvelope = await migrateHostedUserRootKeyEnvelope({
      automationKey: input.automationKey,
      automationKeyId: input.automationKeyId,
      currentKey,
      existing,
      keysById: input.envelopeKeysById,
    });

    await writeHostedUserRootKeyEnvelope({
      automationKey: input.automationKey,
      bucket: input.bucket,
      envelope: nextEnvelope,
      envelopeKeyId: input.envelopeKeyId,
    });
    await deleteLegacyHostedUserRootKeyEnvelopeCopies({
      automationKey: input.automationKey,
      bucket: input.bucket,
      envelopeKeysById: input.envelopeKeysById,
      keepKey: currentKey,
      userId: input.userId,
    });

    return nextEnvelope;
  }

  const rootKey = crypto.getRandomValues(new Uint8Array(HOSTED_USER_RECIPIENT_KEY_BYTES));
  const createdAt = new Date().toISOString();
  const envelope: HostedUserRootKeyEnvelope = {
    createdAt,
    recipients: [
      await wrapHostedUserRootKey({
        kind: "automation",
        metadata: {
          keyId: input.automationKeyId,
        },
        recipientKey: input.automationKey,
        recipientKeyId: input.automationKeyId,
        rootKey,
      }),
    ],
    rootKeyId: createHostedUserRootKeyId(),
    schema: HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: createdAt,
    userId: input.userId,
  };

  await writeHostedUserRootKeyEnvelope({
    automationKey: input.automationKey,
    bucket: input.bucket,
    envelope,
    envelopeKeyId: input.envelopeKeyId,
  });

  return envelope;
}

async function readStoredHostedUserRootKeyEnvelope(input: {
  automationKey: Uint8Array;
  bucket: R2BucketLike;
  envelopeKeyId: string;
  envelopeKeysById: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): Promise<{ envelope: HostedUserRootKeyEnvelope; objectKey: string } | null> {
  for (const key of await hostedUserRootKeyEnvelopeObjectKeys(
    input.automationKey,
    input.envelopeKeysById,
    input.userId,
  )) {
    const envelope = await readEncryptedR2Json({
      aad: buildHostedStorageAad({
        key,
        purpose: "root-key-envelope",
        userId: input.userId,
      }),
      bucket: input.bucket,
      cryptoKey: input.automationKey,
      cryptoKeysById: input.envelopeKeysById,
      expectedKeyId: input.envelopeKeyId,
      key,
      parse(value) {
        return parseHostedUserRootKeyEnvelope(value);
      },
      scope: "root-key-envelope",
    });

    if (envelope) {
      return { envelope, objectKey: key };
    }
  }

  return null;
}

async function migrateHostedUserRootKeyEnvelope(input: {
  automationKey: Uint8Array;
  automationKeyId: string;
  currentKey: string;
  existing: {
    envelope: HostedUserRootKeyEnvelope;
    objectKey: string;
  };
  keysById: Readonly<Record<string, Uint8Array>>;
}): Promise<HostedUserRootKeyEnvelope> {
  const automationRecipient = findHostedWrappedRootKeyRecipient(input.existing.envelope, "automation");

  if (!automationRecipient) {
    throw new Error(
      `Hosted user root key envelope ${input.existing.envelope.userId} is missing an automation recipient.`,
    );
  }

  const rootKey = await unwrapHostedUserRootKey({
    recipient: automationRecipient,
    recipientKey: resolveHostedUserRecipientKeyBytes({
      currentKey: input.automationKey,
      currentKeyId: input.automationKeyId,
      keysById: input.keysById,
      label: `Hosted user root key envelope ${input.existing.envelope.userId} automation recipient`,
      recipient: automationRecipient,
    }),
  });
  const nowIso = new Date().toISOString();

  return {
    ...input.existing.envelope,
    recipients: [
      ...input.existing.envelope.recipients.filter((recipient) => recipient.kind !== "automation"),
      await wrapHostedUserRootKey({
        kind: "automation",
        metadata: {
          ...(automationRecipient.metadata ?? {}),
          keyId: input.automationKeyId,
        },
        recipientKey: input.automationKey,
        recipientKeyId: input.automationKeyId,
        rootKey,
      }),
    ],
    updatedAt:
      input.existing.objectKey === input.currentKey && automationRecipient.keyId === input.automationKeyId
        ? input.existing.envelope.updatedAt
        : nowIso,
  };
}

async function writeHostedUserRootKeyEnvelope(input: {
  automationKey: Uint8Array;
  bucket: R2BucketLike;
  envelope: HostedUserRootKeyEnvelope;
  envelopeKeyId: string;
}): Promise<void> {
  const key = hostedUserRootKeyEnvelopeObjectKey(input.envelope.userId);

  await writeEncryptedR2Json({
    aad: buildHostedStorageAad({
      key,
      purpose: "root-key-envelope",
      userId: input.envelope.userId,
    }),
    bucket: input.bucket,
    cryptoKey: input.automationKey,
    key,
    keyId: input.envelopeKeyId,
    scope: "root-key-envelope",
    value: input.envelope,
  });
}

async function deleteLegacyHostedUserRootKeyEnvelopeCopies(input: {
  automationKey: Uint8Array;
  bucket: R2BucketLike;
  envelopeKeysById: Readonly<Record<string, Uint8Array>>;
  keepKey: string;
  userId: string;
}): Promise<void> {
  if (!input.bucket.delete) {
    return;
  }

  for (const key of await hostedUserRootKeyEnvelopeObjectKeys(
    input.automationKey,
    input.envelopeKeysById,
    input.userId,
  )) {
    if (key === input.keepKey) {
      continue;
    }

    await input.bucket.delete(key);
  }
}

async function hostedUserRootKeyEnvelopeLegacyObjectKey(
  automationKey: Uint8Array,
  userId: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey: automationKey,
    scope: "user-key-envelope-path",
    value: `user:${userId}`,
  });

  return `users/keys/${userSegment}.json`;
}

function hostedUserRootKeyEnvelopeObjectKey(userId: string): string {
  return `users/keys/${encodeURIComponent(userId)}.json`;
}

async function hostedUserRootKeyEnvelopeObjectKeys(
  automationKey: Uint8Array,
  envelopeKeysById: Readonly<Record<string, Uint8Array>>,
  userId: string,
): Promise<string[]> {
  const keys = await Promise.all([
    Promise.resolve(hostedUserRootKeyEnvelopeObjectKey(userId)),
    ...listHostedUserEnvelopeRootKeys(automationKey, envelopeKeysById).map((candidateRootKey) =>
      hostedUserRootKeyEnvelopeLegacyObjectKey(candidateRootKey, userId)
    ),
  ]);

  return [...new Set(keys)];
}

async function wrapHostedUserRootKey(input: {
  kind: HostedUserRootKeyRecipientKind;
  metadata?: Record<string, string | number | boolean | null>;
  recipientKey: Uint8Array;
  recipientKeyId: string;
  rootKey: Uint8Array;
}): Promise<HostedWrappedRootKeyRecipient> {
  const envelope = await encryptHostedBundle({
    aad: buildHostedStorageAad({
      keyId: input.recipientKeyId,
      recipientKind: input.kind,
    }),
    key: requireHostedUserRecipientKeyBytes(input.recipientKey, `${input.kind} recipient key`),
    keyId: input.recipientKeyId,
    plaintext: input.rootKey,
    scope: "root-key-recipient",
  });

  return {
    ciphertext: envelope.ciphertext,
    iv: envelope.iv,
    keyId: envelope.keyId,
    kind: input.kind,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

async function unwrapHostedUserRootKey(input: {
  recipient: HostedWrappedRootKeyRecipient;
  recipientKey: Uint8Array;
}): Promise<Uint8Array> {
  return decryptHostedBundle({
    aad: buildHostedStorageAad({
      keyId: input.recipient.keyId,
      recipientKind: input.recipient.kind,
    }),
    envelope: {
      algorithm: "AES-GCM",
      ciphertext: input.recipient.ciphertext,
      iv: input.recipient.iv,
      keyId: input.recipient.keyId,
      schema: "murph.hosted-cipher.v2",
      scope: "root-key-recipient",
    },
    expectedKeyId: input.recipient.keyId,
    key: input.recipientKey,
    scope: "root-key-recipient",
  });
}

export function encodeHostedUserRootKeyRecipient(input: {
  key: Uint8Array;
  keyId: string;
  kind: HostedUserRootKeyRecipientKind;
  metadata?: Record<string, string | number | boolean | null>;
}): HostedWrappedRootKeyRecipient {
  return {
    ciphertext: encodeBase64(
      requireHostedUserRecipientKeyBytes(input.key, `${input.kind} recipient key`),
    ),
    iv: "",
    keyId: input.keyId,
    kind: input.kind,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function decodeHostedUserRecipientKey(input: HostedWrappedRootKeyRecipient): Uint8Array {
  return requireHostedUserRecipientKeyBytes(
    decodeBase64(input.ciphertext),
    `${input.kind} recipient key`,
  );
}

export function decodeHostedUserRecipientKeyBase64(
  value: string,
  label = "recipient key",
): Uint8Array {
  return requireHostedUserRecipientKeyBytes(decodeBase64(value), label);
}

function resolveHostedUserRecipientKeyBytes(input: {
  currentKey: Uint8Array;
  currentKeyId: string;
  keysById: Readonly<Record<string, Uint8Array>>;
  label: string;
  recipient: HostedWrappedRootKeyRecipient;
}): Uint8Array {
  const key = input.recipient.keyId === input.currentKeyId
    ? input.currentKey
    : input.keysById[input.recipient.keyId] ?? null;

  if (!key) {
    throw new Error(`${input.label} references unknown keyId ${input.recipient.keyId}.`);
  }

  return requireHostedUserRecipientKeyBytes(key, input.label);
}

function listHostedUserEnvelopeRootKeys(
  automationKey: Uint8Array,
  envelopeKeysById: Readonly<Record<string, Uint8Array>>,
): Uint8Array[] {
  const seen = new Set<string>();
  const unique: Uint8Array[] = [];

  for (const key of [automationKey, ...Object.values(envelopeKeysById)]) {
    const signature = encodeBase64(key);

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    unique.push(key);
  }

  return unique;
}

function requireHostedUserRecipientKeyBytes(value: Uint8Array, label: string): Uint8Array {
  if (value.byteLength !== HOSTED_USER_RECIPIENT_KEY_BYTES) {
    throw new TypeError(`${label} must be ${HOSTED_USER_RECIPIENT_KEY_BYTES} bytes.`);
  }

  return value;
}

function createHostedUserRootKeyId(): string {
  return `urk:${crypto.randomUUID()}`;
}

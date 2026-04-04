import {
  createHostedUserRootKeyEnvelope,
  HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA,
  findHostedWrappedRootKeyRecipient,
  parseHostedUserRecipientPublicKeyJwk,
  parseHostedUserRootKeyEnvelope,
  unwrapHostedUserRootKeyForKind,
  wrapHostedUserRootKeyRecipient,
  type HostedUserRecipientPrivateKeyJwk,
  type HostedUserRecipientPublicKeyJwk,
  type HostedUserRootKeyEnvelope,
  type HostedUserRootKeyRecipientKind,
} from "@murphai/runtime-state";

import type { R2BucketLike } from "./bundle-store.js";
import { buildHostedStorageAad, deriveHostedStorageOpaqueId } from "./crypto-context.js";
import { decryptHostedBundle, readEncryptedR2Payload, writeEncryptedR2Json } from "./crypto.js";
import { listHostedStorageObjectKeys } from "./storage-paths.js";

const utf8Decoder = new TextDecoder();

interface LegacyHostedWrappedRootKeyRecipient {
  ciphertext: string;
  iv: string;
  keyId: string;
  kind: HostedUserRootKeyRecipientKind;
  metadata?: Record<string, string | number | boolean | null>;
}

interface LegacyHostedUserRootKeyEnvelope {
  createdAt: string;
  recipients: LegacyHostedWrappedRootKeyRecipient[];
  rootKeyId: string;
  schema: "murph.hosted-user-root-key-envelope.v1";
  updatedAt: string;
  userId: string;
}

type StoredHostedUserRootKeyEnvelopeRead =
  | {
    envelope: HostedUserRootKeyEnvelope;
    format: "v2";
    objectKey: string;
  }
  | {
    envelope: LegacyHostedUserRootKeyEnvelope;
    format: "v1";
    objectKey: string;
  };

export interface HostedUserCryptoContext {
  envelope: HostedUserRootKeyEnvelope;
  rootKey: Uint8Array;
  rootKeyId: string;
  keysById: Readonly<Record<string, Uint8Array>>;
}

export interface HostedUserKeyStore {
  ensureUserCryptoContext(userId: string): Promise<HostedUserCryptoContext>;
  putUserRootKeyEnvelope(input: {
    envelope: HostedUserRootKeyEnvelope;
    userId: string;
  }): Promise<HostedUserRootKeyEnvelope>;
  readUserRootKeyEnvelope(userId: string): Promise<HostedUserRootKeyEnvelope | null>;
  upsertRecipient(input: {
    kind: HostedUserRootKeyRecipientKind;
    metadata?: Record<string, string | number | boolean | null>;
    recipientKeyId: string;
    recipientPublicKeyJwk: HostedUserRecipientPublicKeyJwk;
    userId: string;
  }): Promise<HostedUserRootKeyEnvelope>;
}

export function createHostedUserKeyStore(input: {
  automationRecipientKeyId: string;
  automationRecipientPrivateKey: HostedUserRecipientPrivateKeyJwk;
  automationRecipientPrivateKeysById?: Readonly<Record<string, HostedUserRecipientPrivateKeyJwk>>;
  automationRecipientPublicKey: HostedUserRecipientPublicKeyJwk;
  bucket: R2BucketLike;
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeyId: string;
  envelopeEncryptionKeysById?: Readonly<Record<string, Uint8Array>>;
}): HostedUserKeyStore {
  const automationPrivateKeysById = {
    ...(input.automationRecipientPrivateKeysById ?? {}),
    [input.automationRecipientKeyId]: input.automationRecipientPrivateKey,
  } satisfies Record<string, HostedUserRecipientPrivateKeyJwk>;
  const envelopeEncryptionKeysById = {
    ...(input.envelopeEncryptionKeysById ?? {}),
    [input.envelopeEncryptionKeyId]: input.envelopeEncryptionKey,
  } satisfies Record<string, Uint8Array>;

  return {
    async ensureUserCryptoContext(userId) {
      const envelope = await ensureHostedUserRootKeyEnvelope({
        automationRecipientKeyId: input.automationRecipientKeyId,
        automationRecipientPrivateKeysById: automationPrivateKeysById,
        automationRecipientPublicKey: input.automationRecipientPublicKey,
        bucket: input.bucket,
        envelopeEncryptionKey: input.envelopeEncryptionKey,
        envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
        envelopeEncryptionKeysById,
        userId,
      });
      const rootKey = await unwrapHostedAutomationRootKey({
        automationRecipientPrivateKeysById: automationPrivateKeysById,
        envelope,
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

    async putUserRootKeyEnvelope({ envelope, userId }) {
      const parsedEnvelope = parseHostedUserRootKeyEnvelope(envelope);

      if (parsedEnvelope.userId !== userId) {
        throw new TypeError("Hosted user root key envelope userId does not match the requested user.");
      }

      await requireHostedUserRootKeyEnvelopeAutomationAccess({
        automationRecipientPrivateKeysById: automationPrivateKeysById,
        envelope: parsedEnvelope,
      });
      await writeHostedUserRootKeyEnvelope({
        bucket: input.bucket,
        envelope: parsedEnvelope,
        envelopeEncryptionKey: input.envelopeEncryptionKey,
        envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
      });

      return parsedEnvelope;
    },

    async readUserRootKeyEnvelope(userId) {
      const stored = await readStoredHostedUserRootKeyEnvelope({
        automationRecipientKeyId: input.automationRecipientKeyId,
        automationRecipientPublicKey: input.automationRecipientPublicKey,
        bucket: input.bucket,
        envelopeEncryptionKey: input.envelopeEncryptionKey,
        envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
        envelopeEncryptionKeysById,
        userId,
      });

      if (!stored) {
        return null;
      }

      if (stored.format === "v2") {
        return stored.envelope;
      }

      return migrateLegacyStoredHostedUserRootKeyEnvelope({
        automationRecipientKeyId: input.automationRecipientKeyId,
        automationRecipientPublicKey: input.automationRecipientPublicKey,
        bucket: input.bucket,
        envelopeEncryptionKey: input.envelopeEncryptionKey,
        envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
        envelopeEncryptionKeysById,
        legacyEnvelope: stored.envelope,
      });
    },

    async upsertRecipient(recipientInput) {
      const context = await this.ensureUserCryptoContext(recipientInput.userId);
      const recipientPublicKeyJwk = parseHostedUserRecipientPublicKeyJwk(
        recipientInput.recipientPublicKeyJwk,
        `${recipientInput.kind} recipient public key`,
      );
      const nextRecipient = await wrapHostedUserRootKeyRecipient({
        recipient: {
          keyId: recipientInput.recipientKeyId,
          kind: recipientInput.kind,
          ...(recipientInput.metadata ? { metadata: recipientInput.metadata } : {}),
          publicKeyJwk: recipientPublicKeyJwk,
        },
        rootKey: context.rootKey,
        rootKeyId: context.envelope.rootKeyId,
        userId: context.envelope.userId,
      });
      const nextEnvelope: HostedUserRootKeyEnvelope = {
        ...context.envelope,
        recipients: [
          ...context.envelope.recipients.filter((recipient) => recipient.kind !== recipientInput.kind),
          nextRecipient,
        ],
        updatedAt: new Date().toISOString(),
      };

      await writeHostedUserRootKeyEnvelope({
        bucket: input.bucket,
        envelope: nextEnvelope,
        envelopeEncryptionKey: input.envelopeEncryptionKey,
        envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
      });

      return nextEnvelope;
    },
  };
}

async function ensureHostedUserRootKeyEnvelope(input: {
  automationRecipientKeyId: string;
  automationRecipientPrivateKeysById: Readonly<Record<string, HostedUserRecipientPrivateKeyJwk>>;
  automationRecipientPublicKey: HostedUserRecipientPublicKeyJwk;
  bucket: R2BucketLike;
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeyId: string;
  envelopeEncryptionKeysById: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): Promise<HostedUserRootKeyEnvelope> {
  const existingEnvelope = await readStoredHostedUserRootKeyEnvelope({
    automationRecipientKeyId: input.automationRecipientKeyId,
    automationRecipientPublicKey: input.automationRecipientPublicKey,
    bucket: input.bucket,
    envelopeEncryptionKey: input.envelopeEncryptionKey,
    envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
    envelopeEncryptionKeysById: input.envelopeEncryptionKeysById,
    userId: input.userId,
  });

  if (!existingEnvelope) {
    const created = await createHostedUserRootKeyEnvelope({
      recipients: [
        {
          keyId: input.automationRecipientKeyId,
          kind: "automation",
          publicKeyJwk: input.automationRecipientPublicKey,
        },
      ],
      userId: input.userId,
    });
    await writeHostedUserRootKeyEnvelope({
      bucket: input.bucket,
      envelope: created.envelope,
      envelopeEncryptionKey: input.envelopeEncryptionKey,
      envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
    });
    return created.envelope;
  }

  if (existingEnvelope.format === "v1") {
    return migrateLegacyStoredHostedUserRootKeyEnvelope({
      automationRecipientKeyId: input.automationRecipientKeyId,
      automationRecipientPublicKey: input.automationRecipientPublicKey,
      bucket: input.bucket,
      envelopeEncryptionKey: input.envelopeEncryptionKey,
      envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
      envelopeEncryptionKeysById: input.envelopeEncryptionKeysById,
      legacyEnvelope: existingEnvelope.envelope,
    });
  }

  const automationRecipient = findHostedWrappedRootKeyRecipient(existingEnvelope.envelope, "automation");
  if (!automationRecipient) {
    throw new Error(`Hosted user root key envelope ${input.userId} is missing an automation recipient.`);
  }

  if (automationRecipient.keyId === input.automationRecipientKeyId) {
    return existingEnvelope.envelope;
  }

  const rootKey = await unwrapHostedAutomationRootKey({
    automationRecipientPrivateKeysById: input.automationRecipientPrivateKeysById,
    envelope: existingEnvelope.envelope,
  });
  const migratedAutomationRecipient = await wrapHostedUserRootKeyRecipient({
    recipient: {
      keyId: input.automationRecipientKeyId,
      kind: "automation",
      publicKeyJwk: input.automationRecipientPublicKey,
    },
    rootKey,
    rootKeyId: existingEnvelope.envelope.rootKeyId,
    userId: existingEnvelope.envelope.userId,
  });
  const migratedEnvelope: HostedUserRootKeyEnvelope = {
    ...existingEnvelope.envelope,
    recipients: [
      ...existingEnvelope.envelope.recipients.filter((recipient) => recipient.kind !== "automation"),
      migratedAutomationRecipient,
    ],
    updatedAt: new Date().toISOString(),
  };
  await writeHostedUserRootKeyEnvelope({
    bucket: input.bucket,
    envelope: migratedEnvelope,
    envelopeEncryptionKey: input.envelopeEncryptionKey,
    envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
  });

  return migratedEnvelope;
}

async function readStoredHostedUserRootKeyEnvelope(input: {
  automationRecipientKeyId: string;
  automationRecipientPublicKey: HostedUserRecipientPublicKeyJwk;
  bucket: R2BucketLike;
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeyId: string;
  envelopeEncryptionKeysById: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): Promise<StoredHostedUserRootKeyEnvelopeRead | null> {
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

    const value = JSON.parse(utf8Decoder.decode(plaintext)) as unknown;

    try {
      return {
        envelope: parseHostedUserRootKeyEnvelope(value),
        format: "v2",
        objectKey,
      };
    } catch {
      return {
        envelope: parseLegacyHostedUserRootKeyEnvelope(value),
        format: "v1",
        objectKey,
      };
    }
  }

  return null;
}

async function migrateLegacyStoredHostedUserRootKeyEnvelope(input: {
  automationRecipientKeyId: string;
  automationRecipientPublicKey: HostedUserRecipientPublicKeyJwk;
  bucket: R2BucketLike;
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeyId: string;
  envelopeEncryptionKeysById: Readonly<Record<string, Uint8Array>>;
  legacyEnvelope: LegacyHostedUserRootKeyEnvelope;
}): Promise<HostedUserRootKeyEnvelope> {
  const rootKey = await unwrapLegacyHostedAutomationRootKey({
    envelope: input.legacyEnvelope,
    envelopeEncryptionKey: input.envelopeEncryptionKey,
    envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
    envelopeEncryptionKeysById: input.envelopeEncryptionKeysById,
  });
  const created = await createHostedUserRootKeyEnvelope({
    createdAt: input.legacyEnvelope.createdAt,
    recipients: [{
      keyId: input.automationRecipientKeyId,
      kind: "automation",
      publicKeyJwk: input.automationRecipientPublicKey,
    }],
    rootKey,
    rootKeyId: input.legacyEnvelope.rootKeyId,
    userId: input.legacyEnvelope.userId,
  });
  const envelope: HostedUserRootKeyEnvelope = {
    ...created.envelope,
    updatedAt: new Date().toISOString(),
  };

  await writeHostedUserRootKeyEnvelope({
    bucket: input.bucket,
    envelope,
    envelopeEncryptionKey: input.envelopeEncryptionKey,
    envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
  });
  await deleteLegacyHostedUserRootKeyEnvelopeCopies({
    bucket: input.bucket,
    envelopeEncryptionKey: input.envelopeEncryptionKey,
    envelopeEncryptionKeysById: input.envelopeEncryptionKeysById,
    keepKey: await hostedUserRootKeyEnvelopeObjectKey(
      input.envelopeEncryptionKey,
      input.legacyEnvelope.userId,
    ),
    userId: input.legacyEnvelope.userId,
  });

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

async function requireHostedUserRootKeyEnvelopeAutomationAccess(input: {
  automationRecipientPrivateKeysById: Readonly<Record<string, HostedUserRecipientPrivateKeyJwk>>;
  envelope: HostedUserRootKeyEnvelope;
}): Promise<void> {
  await unwrapHostedAutomationRootKey(input);
}

async function unwrapHostedAutomationRootKey(input: {
  automationRecipientPrivateKeysById: Readonly<Record<string, HostedUserRecipientPrivateKeyJwk>>;
  envelope: HostedUserRootKeyEnvelope;
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

  return unwrapHostedUserRootKeyForKind({
    envelope: input.envelope,
    kind: "automation",
    recipientPrivateKeyJwk,
  });
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
  return [
    legacyHostedUserRootKeyEnvelopeObjectKey(userId),
    ...await listHostedStorageObjectKeys(envelopeEncryptionKey, envelopeEncryptionKeysById, (candidateKey) =>
      hostedUserRootKeyEnvelopeObjectKey(candidateKey, userId)
    ),
  ];
}

async function deleteLegacyHostedUserRootKeyEnvelopeCopies(input: {
  bucket: R2BucketLike;
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeysById: Readonly<Record<string, Uint8Array>>;
  keepKey: string;
  userId: string;
}): Promise<void> {
  if (!input.bucket.delete) {
    return;
  }

  for (const key of await hostedUserRootKeyEnvelopeObjectKeys(
    input.envelopeEncryptionKey,
    input.envelopeEncryptionKeysById,
    input.userId,
  )) {
    if (key === input.keepKey) {
      continue;
    }

    await input.bucket.delete(key);
  }
}

function legacyHostedUserRootKeyEnvelopeObjectKey(userId: string): string {
  return `users/keys/${encodeURIComponent(userId)}.json`;
}

async function unwrapLegacyHostedAutomationRootKey(input: {
  envelope: LegacyHostedUserRootKeyEnvelope;
  envelopeEncryptionKey: Uint8Array;
  envelopeEncryptionKeyId: string;
  envelopeEncryptionKeysById: Readonly<Record<string, Uint8Array>>;
}): Promise<Uint8Array> {
  const recipient = input.envelope.recipients.find((entry) => entry.kind === "automation");

  if (!recipient) {
    throw new Error(`Hosted user root key envelope ${input.envelope.userId} is missing an automation recipient.`);
  }

  const recipientKey =
    input.envelopeEncryptionKeysById[recipient.keyId]
    ?? input.envelopeEncryptionKeysById[input.envelopeEncryptionKeyId]
    ?? input.envelopeEncryptionKey;
  const cipherEnvelope = {
    algorithm: "AES-GCM" as const,
    ciphertext: recipient.ciphertext,
    iv: recipient.iv,
    keyId: recipient.keyId,
    schema: "murph.hosted-cipher.v2" as const,
    scope: "root-key-recipient" as const,
  };

  try {
    return await decryptHostedBundle({
      aad: buildHostedStorageAad({
        keyId: recipient.keyId,
        recipientKind: recipient.kind,
        rootKeyId: input.envelope.rootKeyId,
        userId: input.envelope.userId,
      }),
      envelope: cipherEnvelope,
      expectedKeyId: recipient.keyId,
      key: recipientKey,
      scope: "root-key-recipient",
    });
  } catch {
    return decryptHostedBundle({
      aad: buildHostedStorageAad({
        keyId: recipient.keyId,
        recipientKind: recipient.kind,
      }),
      envelope: cipherEnvelope,
      expectedKeyId: recipient.keyId,
      key: recipientKey,
      scope: "root-key-recipient",
    });
  }
}

function parseLegacyHostedUserRootKeyEnvelope(
  value: unknown,
  label = "Hosted legacy user root key envelope",
): LegacyHostedUserRootKeyEnvelope {
  const record = requireObject(value, label);

  return {
    createdAt: requireString(record.createdAt, `${label}.createdAt`),
    recipients: requireArray(record.recipients, `${label}.recipients`).map((entry, index) =>
      parseLegacyHostedWrappedRootKeyRecipient(entry, `${label}.recipients[${index}]`)
    ),
    rootKeyId: requireString(record.rootKeyId, `${label}.rootKeyId`),
    schema: requireLegacyEnvelopeSchema(record.schema, `${label}.schema`),
    updatedAt: requireString(record.updatedAt, `${label}.updatedAt`),
    userId: requireString(record.userId, `${label}.userId`),
  };
}

function parseLegacyHostedWrappedRootKeyRecipient(
  value: unknown,
  label: string,
): LegacyHostedWrappedRootKeyRecipient {
  const record = requireObject(value, label);

  return {
    ciphertext: requireString(record.ciphertext, `${label}.ciphertext`),
    iv: requireString(record.iv, `${label}.iv`),
    keyId: requireString(record.keyId, `${label}.keyId`),
    kind: requireRecipientKind(record.kind, `${label}.kind`),
    ...(record.metadata === undefined ? {} : { metadata: parseMetadataRecord(record.metadata, `${label}.metadata`) }),
  };
}

function requireLegacyEnvelopeSchema(
  value: unknown,
  label: string,
): LegacyHostedUserRootKeyEnvelope["schema"] {
  const schema = requireString(value, label);

  if (schema !== "murph.hosted-user-root-key-envelope.v1") {
    throw new TypeError(`${label} must be murph.hosted-user-root-key-envelope.v1.`);
  }

  return schema;
}

function requireRecipientKind(value: unknown, label: string): HostedUserRootKeyRecipientKind {
  const kind = requireString(value, label);

  if (
    kind === "automation"
    || kind === "user-unlock"
    || kind === "recovery"
    || kind === "tee-automation"
  ) {
    return kind;
  }

  throw new TypeError(`${label} must be a supported root key recipient kind.`);
}

function parseMetadataRecord(
  value: unknown,
  label: string,
): Record<string, string | number | boolean | null> {
  const record = requireObject(value, label);
  const result: Record<string, string | number | boolean | null> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (
      entry === null
      || typeof entry === "string"
      || typeof entry === "number"
      || typeof entry === "boolean"
    ) {
      result[key] = entry;
      continue;
    }

    throw new TypeError(`${label}.${key} must be a scalar JSON value.`);
  }

  return result;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

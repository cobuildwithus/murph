import {
  createHostedUserRootKeyEnvelope,
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
import { readEncryptedR2Payload, writeEncryptedR2Json } from "./crypto.js";
import { listHostedStorageObjectKeys } from "./storage-paths.js";

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
        bucket: input.bucket,
        envelopeEncryptionKey: input.envelopeEncryptionKey,
        envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
        envelopeEncryptionKeysById,
        userId,
      });

      if (!stored) {
        return null;
      }

      return stored;
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

  const automationRecipient = findHostedWrappedRootKeyRecipient(existingEnvelope, "automation");
  if (!automationRecipient) {
    throw new Error(`Hosted user root key envelope ${input.userId} is missing an automation recipient.`);
  }

  if (automationRecipient.keyId === input.automationRecipientKeyId) {
    return existingEnvelope;
  }

  const rootKey = await unwrapHostedAutomationRootKey({
    automationRecipientPrivateKeysById: input.automationRecipientPrivateKeysById,
    envelope: existingEnvelope,
  });
  const migratedAutomationRecipient = await wrapHostedUserRootKeyRecipient({
    recipient: {
      keyId: input.automationRecipientKeyId,
      kind: "automation",
      publicKeyJwk: input.automationRecipientPublicKey,
    },
    rootKey,
    rootKeyId: existingEnvelope.rootKeyId,
    userId: existingEnvelope.userId,
  });
  const migratedEnvelope: HostedUserRootKeyEnvelope = {
    ...existingEnvelope,
    recipients: [
      ...existingEnvelope.recipients.filter((recipient) => recipient.kind !== "automation"),
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
  return listHostedStorageObjectKeys(envelopeEncryptionKey, envelopeEncryptionKeysById, (candidateKey) =>
    hostedUserRootKeyEnvelopeObjectKey(candidateKey, userId)
  );
}

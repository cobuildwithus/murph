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

const PUBLIC_HOSTED_USER_ROOT_KEY_RECIPIENT_KINDS = new Set<HostedUserRootKeyRecipientKind>([
  "automation",
  "user-unlock",
  "recovery",
]);

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

      const existingEnvelope = await readStoredHostedUserRootKeyEnvelope({
        bucket: input.bucket,
        envelopeEncryptionKey: input.envelopeEncryptionKey,
        envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
        envelopeEncryptionKeysById,
        userId,
      });

      await validateHostedUserRootKeyEnvelopeWrite({
        automationRecipientPrivateKeysById: automationPrivateKeysById,
        existingEnvelope,
        nextEnvelope: parsedEnvelope,
      });
      await writeHostedUserRootKeyEnvelope({
        bucket: input.bucket,
        envelope: parsedEnvelope,
        envelopeEncryptionKey: input.envelopeEncryptionKey,
        envelopeEncryptionKeyId: input.envelopeEncryptionKeyId,
        envelopeEncryptionKeysById,
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
        envelopeEncryptionKeysById,
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
      envelopeEncryptionKeysById: input.envelopeEncryptionKeysById,
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
    envelopeEncryptionKeysById: input.envelopeEncryptionKeysById,
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

async function validateHostedUserRootKeyEnvelopeWrite(input: {
  automationRecipientPrivateKeysById: Readonly<Record<string, HostedUserRecipientPrivateKeyJwk>>;
  existingEnvelope: HostedUserRootKeyEnvelope | null;
  nextEnvelope: HostedUserRootKeyEnvelope;
}): Promise<void> {
  assertPublicHostedUserRootKeyEnvelopeKinds(input.nextEnvelope);
  const nextRootKey = await unwrapHostedAutomationRootKey({
    automationRecipientPrivateKeysById: input.automationRecipientPrivateKeysById,
    envelope: input.nextEnvelope,
  });

  if (!input.existingEnvelope) {
    return;
  }

  const existingRootKey = await unwrapHostedAutomationRootKey({
    automationRecipientPrivateKeysById: input.automationRecipientPrivateKeysById,
    envelope: input.existingEnvelope,
  });

  if (
    input.existingEnvelope.rootKeyId !== input.nextEnvelope.rootKeyId
    || !sameBytes(existingRootKey, nextRootKey)
  ) {
    throw new TypeError(
      "Replacing a hosted user root key is not allowed through putUserRootKeyEnvelope; add or rotate managed recipients instead.",
    );
  }
}

function assertPublicHostedUserRootKeyEnvelopeKinds(envelope: HostedUserRootKeyEnvelope): void {
  for (const recipient of envelope.recipients) {
    if (PUBLIC_HOSTED_USER_ROOT_KEY_RECIPIENT_KINDS.has(recipient.kind)) {
      continue;
    }

    throw new TypeError(
      `Hosted user root key envelopes written through the public control plane must not include ${recipient.kind} recipients.`,
    );
  }
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

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
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

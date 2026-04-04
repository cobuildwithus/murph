import {
  createHostedUserRootKeyEnvelope,
  generateHostedUserRecipientKeyPair,
  unwrapHostedUserRootKeyForKind,
  type HostedUserManagedRootKeyRecipientKind,
  type HostedUserRecipientPrivateKeyJwk,
  type HostedUserRecipientPublicKeyJwk,
  type HostedUserRootKeyEnvelope,
  type HostedUserRootKeyEnvelopeRecipientInput,
} from "@murphai/runtime-state";

const HOSTED_BROWSER_CONTEXT_SALT = new TextEncoder().encode("murph.cloudflare.hosted.storage.v2");
const utf8Encoder = new TextEncoder();

export interface HostedUserRecipientUpsertPayload {
  metadata?: Record<string, string | number | boolean | null>;
  recipientKeyId: string;
  recipientPublicKeyJwk: HostedUserRecipientPublicKeyJwk;
}

export interface HostedBrowserGeneratedRootKeyEnvelopeResult {
  envelope: HostedUserRootKeyEnvelope;
  rootKey: Uint8Array;
}

export async function generateHostedBrowserRecipientKeyPair(): Promise<{
  privateKeyJwk: HostedUserRecipientPrivateKeyJwk;
  publicKeyJwk: HostedUserRecipientPublicKeyJwk;
}> {
  return generateHostedUserRecipientKeyPair();
}

export function createHostedUserRecipientUpsertPayload(input: {
  keyId: string;
  metadata?: Record<string, string | number | boolean | null>;
  publicKeyJwk: HostedUserRecipientPublicKeyJwk;
}): HostedUserRecipientUpsertPayload {
  return {
    ...(input.metadata ? { metadata: input.metadata } : {}),
    recipientKeyId: input.keyId,
    recipientPublicKeyJwk: input.publicKeyJwk,
  };
}

export async function createHostedBrowserGeneratedRootKeyEnvelope(input: {
  automationRecipient: {
    keyId: string;
    publicKeyJwk: HostedUserRecipientPublicKeyJwk;
  };
  createdAt?: string;
  recoveryRecipient?: {
    keyId: string;
    metadata?: Record<string, string | number | boolean | null>;
    publicKeyJwk: HostedUserRecipientPublicKeyJwk;
  };
  rootKeyId?: string;
  userId: string;
  userUnlockRecipient?: {
    keyId: string;
    metadata?: Record<string, string | number | boolean | null>;
    publicKeyJwk: HostedUserRecipientPublicKeyJwk;
  };
}): Promise<HostedBrowserGeneratedRootKeyEnvelopeResult> {
  const recipients: HostedUserRootKeyEnvelopeRecipientInput[] = [
    {
      keyId: input.automationRecipient.keyId,
      kind: "automation",
      publicKeyJwk: input.automationRecipient.publicKeyJwk,
    },
  ];

  if (input.userUnlockRecipient) {
    recipients.push({
      keyId: input.userUnlockRecipient.keyId,
      kind: "user-unlock",
      ...(input.userUnlockRecipient.metadata ? { metadata: input.userUnlockRecipient.metadata } : {}),
      publicKeyJwk: input.userUnlockRecipient.publicKeyJwk,
    });
  }

  if (input.recoveryRecipient) {
    recipients.push({
      keyId: input.recoveryRecipient.keyId,
      kind: "recovery",
      ...(input.recoveryRecipient.metadata ? { metadata: input.recoveryRecipient.metadata } : {}),
      publicKeyJwk: input.recoveryRecipient.publicKeyJwk,
    });
  }

  return createHostedUserRootKeyEnvelope({
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    recipients,
    ...(input.rootKeyId ? { rootKeyId: input.rootKeyId } : {}),
    userId: input.userId,
  });
}

export async function unwrapHostedUserRootKeyForBrowser(input: {
  envelope: HostedUserRootKeyEnvelope;
  kind: HostedUserManagedRootKeyRecipientKind;
  recipientPrivateKeyJwk: HostedUserRecipientPrivateKeyJwk;
}): Promise<Uint8Array> {
  return unwrapHostedUserRootKeyForKind({
    envelope: input.envelope,
    kind: input.kind,
    recipientPrivateKeyJwk: input.recipientPrivateKeyJwk,
  });
}

export async function deriveHostedUserDomainKeyForBrowser(
  rootKey: Uint8Array,
  scope: string,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rootKey),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      info: utf8Encoder.encode(scope),
      salt: HOSTED_BROWSER_CONTEXT_SALT,
    },
    baseKey,
    256,
  );

  return new Uint8Array(derived);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

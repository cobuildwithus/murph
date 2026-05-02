import {
  buildHostedMailboxPayloadAadObjectKey,
  resolveHostedMailboxPayloadField,
  type HostedMailboxPayloadCryptoMetadata,
  type HostedMailboxPayloadStorage,
} from "@murphai/hosted-execution/runtime-control";

import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
  type HostedSecureBoxPrismaClient,
} from "../hosted-crypto/secure-box";

export type HostedMailboxEncryptionPrismaClient = HostedSecureBoxPrismaClient;
export type { HostedMailboxPayloadCryptoMetadata, HostedMailboxPayloadStorage };

export async function encryptHostedMailboxPayloadString(input: HostedMailboxPayloadCryptoMetadata & {
  prisma?: HostedMailboxEncryptionPrismaClient;
  value: string | null | undefined;
}): Promise<string | null> {
  const field = resolveHostedMailboxPayloadField(input.payloadStorage);
  return sealHostedUserSecureBoxString({
    aad: buildHostedMailboxPayloadAad({ ...input, field }),
    lane: "mailbox-payload",
    prisma: input.prisma,
    scope: `hosted-mailbox-payload:${field}`,
    userId: input.userId,
    value: input.value,
  });
}

export async function decryptHostedMailboxPayloadString(input: HostedMailboxPayloadCryptoMetadata & {
  prisma?: HostedMailboxEncryptionPrismaClient;
  value: string | null | undefined;
}): Promise<string | null> {
  const field = resolveHostedMailboxPayloadField(input.payloadStorage);
  return openHostedUserSecureBoxString({
    aad: buildHostedMailboxPayloadAad({ ...input, field }),
    lane: "mailbox-payload",
    prisma: input.prisma,
    scope: `hosted-mailbox-payload:${field}`,
    userId: input.userId,
    value: input.value,
  });
}

function buildHostedMailboxPayloadAad(input: HostedMailboxPayloadCryptoMetadata & { field: string }) {
  return {
    field: input.field,
    objectKey: buildHostedMailboxPayloadAadObjectKey(input),
    purpose: "hosted-mailbox-payload",
    rowId: input.itemId,
    sequence: input.laneSeq,
    table: "hosted_mailbox_item",
  };
}

import {
  buildHostedMailboxPayloadScope,
  buildHostedMailboxPayloadSecureBoxAad,
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
  return sealHostedUserSecureBoxString({
    aad: buildHostedMailboxPayloadSecureBoxAad(input),
    lane: "mailbox-payload",
    prisma: input.prisma,
    scope: buildHostedMailboxPayloadScope(input.payloadStorage),
    userId: input.userId,
    value: input.value,
  });
}

export async function decryptHostedMailboxPayloadString(input: HostedMailboxPayloadCryptoMetadata & {
  prisma?: HostedMailboxEncryptionPrismaClient;
  value: string | null | undefined;
}): Promise<string | null> {
  return openHostedUserSecureBoxString({
    aad: buildHostedMailboxPayloadSecureBoxAad(input),
    lane: "mailbox-payload",
    prisma: input.prisma,
    scope: buildHostedMailboxPayloadScope(input.payloadStorage),
    userId: input.userId,
    value: input.value,
  });
}

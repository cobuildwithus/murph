import {
  buildHostedMailboxPayloadScope,
  buildHostedMailboxPayloadSecureBoxAad,
  type HostedMailboxPayloadCryptoMetadata,
  type HostedMailboxPayloadStorage,
} from "@murphai/hosted-execution/runtime-control";

import type {
  CachedUnwrappedHostedDomainRoot,
} from "../hosted-crypto/domain-root-unwrap-cache";
import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
  sealHostedUserSecureBoxStringFromPreparedRoot,
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

export async function encryptHostedMailboxPayloadStringFromPreparedRoot(
  input: HostedMailboxPayloadCryptoMetadata & {
    preparedRoot: Promise<CachedUnwrappedHostedDomainRoot>;
    preparedRootKeyId: string;
    value: string | null | undefined;
  },
): Promise<string | null> {
  return sealHostedUserSecureBoxStringFromPreparedRoot({
    aad: buildHostedMailboxPayloadSecureBoxAad(input),
    lane: "mailbox-payload",
    preparedRoot: input.preparedRoot,
    preparedRootKeyId: input.preparedRootKeyId,
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

import {
  buildHostedMailboxPayloadScope,
  buildHostedMailboxPayloadSecureBoxAad,
  type HostedMailboxPayloadCryptoMetadata,
  type HostedMailboxPayloadStorage,
} from "@murphai/hosted-execution/runtime-control";

import { getHostedCryptoDomainForLane } from "@murphai/runtime-state";

import type {
  CachedUnwrappedHostedDomainRoot,
} from "../hosted-crypto/domain-root-unwrap-cache";
import {
  prewarmHostedUserSecureBoxStrings,
  openHostedUserSecureBoxStringsWithPreparedRoots,
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
  sealHostedUserSecureBoxStringFromPreparedRoot,
  type HostedSecureBoxPrismaClient,
} from "../hosted-crypto/secure-box";
import { unwrapHostedDomainRootForWeb } from "../hosted-crypto/domain-root-store";

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

export async function prewarmHostedMailboxPayloadStrings(input: {
  entries: ReadonlyArray<HostedMailboxPayloadCryptoMetadata & {
    value: string | null | undefined;
  }>;
  prisma?: HostedMailboxEncryptionPrismaClient;
}): Promise<void> {
  await prewarmHostedUserSecureBoxStrings({
    entries: input.entries.map((entry) => ({
      aad: buildHostedMailboxPayloadSecureBoxAad(entry),
      scope: buildHostedMailboxPayloadScope(entry.payloadStorage),
      userId: entry.userId,
      value: entry.value,
    })),
    lane: "mailbox-payload",
    prisma: input.prisma,
  });
}

export async function decryptHostedMailboxPayloadStringsWithPreparedRoots(input: {
  entries: ReadonlyArray<HostedMailboxPayloadCryptoMetadata & {
    value: string | null | undefined;
  }>;
}): Promise<Array<string | null>> {
  return openHostedUserSecureBoxStringsWithPreparedRoots({
    entries: input.entries.map((entry) => ({
      aad: buildHostedMailboxPayloadSecureBoxAad(entry),
      scope: buildHostedMailboxPayloadScope(entry.payloadStorage),
      userId: entry.userId,
      value: entry.value,
    })),
    lane: "mailbox-payload",
  });
}

export async function prewarmHostedMailboxPayloadActiveRoot(input: {
  prisma?: HostedMailboxEncryptionPrismaClient;
  userId: string;
}): Promise<void> {
  const root = await unwrapHostedDomainRootForWeb({
    domain: getHostedCryptoDomainForLane("mailbox-payload"),
    prisma: input.prisma,
    retainFailureInScopedCache: true,
    userId: input.userId,
  });
  root.rootKey.fill(0);
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

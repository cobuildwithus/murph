import {
  openHostedUserSecureBoxString,
  openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxString,
  sealHostedUserSecureBoxStringFromPreparedRoot,
  type HostedSecureBoxPrismaClient,
} from "../hosted-crypto/secure-box";
import type { CachedUnwrappedHostedDomainRoot } from "../hosted-crypto/domain-root-unwrap-cache";

export type HostedWebEncryptionPrismaClient = HostedSecureBoxPrismaClient;

export interface PreparedHostedWebEncryptionRoot {
  preparedRoot: Promise<CachedUnwrappedHostedDomainRoot>;
  preparedRootKeyId: string;
}

export async function encryptHostedWebNullableString(input: {
  field: string;
  memberId: string;
  prisma?: HostedWebEncryptionPrismaClient;
  signal?: AbortSignal;
  value: string | null | undefined;
}): Promise<string | null> {
  return sealHostedUserSecureBoxString({
    aad: {
      field: input.field,
      purpose: "hosted-member-private-field",
      rowId: input.memberId,
      table: "hosted_member",
    },
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    scope: `hosted-member-private-field:${input.field}`,
    signal: input.signal,
    userId: input.memberId,
    value: input.value,
  });
}

export async function encryptHostedWebNullableStringFromPreparedRoot(input: {
  field: string;
  memberId: string;
  prepared: PreparedHostedWebEncryptionRoot;
  value: string | null | undefined;
}): Promise<string | null> {
  return sealHostedUserSecureBoxStringFromPreparedRoot({
    aad: {
      field: input.field,
      purpose: "hosted-member-private-field",
      rowId: input.memberId,
      table: "hosted_member",
    },
    lane: "hosted-member-private-field",
    preparedRoot: input.prepared.preparedRoot,
    preparedRootKeyId: input.prepared.preparedRootKeyId,
    scope: `hosted-member-private-field:${input.field}`,
    userId: input.memberId,
    value: input.value,
  });
}

export async function decryptHostedWebNullableString(input: {
  field: string;
  memberId: string;
  prisma?: HostedWebEncryptionPrismaClient;
  signal?: AbortSignal;
  value: string | null | undefined;
}): Promise<string | null> {
  return openHostedUserSecureBoxString({
    aad: {
      field: input.field,
      purpose: "hosted-member-private-field",
      rowId: input.memberId,
      table: "hosted_member",
    },
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    scope: `hosted-member-private-field:${input.field}`,
    signal: input.signal,
    userId: input.memberId,
    value: input.value,
  });
}

export async function decryptHostedWebNullableStrings(input: {
  field: string;
  prisma?: HostedWebEncryptionPrismaClient;
  values: ReadonlyArray<{
    memberId: string;
    value: string | null | undefined;
  }>;
}): Promise<Array<string | null>> {
  return decryptHostedWebNullableFields({
    entries: input.values.map(({ memberId, value }) => ({
      field: input.field,
      memberId,
      value,
    })),
    prisma: input.prisma,
  });
}

export async function decryptHostedWebNullableFields(input: {
  entries: ReadonlyArray<{
    field: string;
    memberId: string;
    value: string | null | undefined;
  }>;
  prisma?: HostedWebEncryptionPrismaClient;
  retainFailureInScopedCache?: boolean;
  signal?: AbortSignal;
}): Promise<Array<string | null>> {
  return openHostedUserSecureBoxStrings({
    entries: input.entries.map(({ field, memberId, value }) => ({
      aad: {
        field,
        purpose: "hosted-member-private-field",
        rowId: memberId,
        table: "hosted_member",
      },
      scope: `hosted-member-private-field:${field}`,
      userId: memberId,
      value,
    })),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    ...(input.retainFailureInScopedCache === undefined
      ? {}
      : {
          retainFailureInScopedCache:
            input.retainFailureInScopedCache,
        }),
    signal: input.signal,
  });
}

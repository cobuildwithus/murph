import {
  openHostedUserSecureBoxString,
  openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxString,
  type HostedSecureBoxPrismaClient,
} from "../hosted-crypto/secure-box";

export type HostedWebEncryptionPrismaClient = HostedSecureBoxPrismaClient;

export async function encryptHostedWebNullableString(input: {
  field: string;
  memberId: string;
  prisma?: HostedWebEncryptionPrismaClient;
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
    userId: input.memberId,
    value: input.value,
  });
}

export async function decryptHostedWebNullableString(input: {
  field: string;
  memberId: string;
  prisma?: HostedWebEncryptionPrismaClient;
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
  return openHostedUserSecureBoxStrings({
    entries: input.values.map(({ memberId, value }) => ({
      aad: {
        field: input.field,
        purpose: "hosted-member-private-field",
        rowId: memberId,
        table: "hosted_member",
      },
      scope: `hosted-member-private-field:${input.field}`,
      userId: memberId,
      value,
    })),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
  });
}

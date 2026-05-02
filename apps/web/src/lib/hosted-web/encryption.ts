import {
  openHostedUserSecureBoxString,
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

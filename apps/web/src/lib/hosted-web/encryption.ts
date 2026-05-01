import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
  type HostedSecureBoxPrismaClient,
} from "../hosted-crypto/secure-box";

export type HostedWebEncryptionPrismaClient = HostedSecureBoxPrismaClient;

export class HostedWebConfigurationError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(input: { code: string; httpStatus: number; message: string }) {
    super(input.message);
    this.name = "HostedWebConfigurationError";
    this.code = input.code;
    this.httpStatus = input.httpStatus;
  }
}

export function hostedWebConfigurationError(input: {
  code: string;
  httpStatus: number;
  message: string;
}): HostedWebConfigurationError {
  return new HostedWebConfigurationError(input);
}

export function isHostedWebConfigurationError(error: unknown): error is HostedWebConfigurationError {
  return error instanceof HostedWebConfigurationError;
}

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

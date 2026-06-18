import type { HostedSecureBoxAadFields } from "@murphai/runtime-state";
import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
  type HostedSecureBoxPrismaClient,
} from "../hosted-crypto/secure-box";

export type ComputerUseCryptoPrismaClient = HostedSecureBoxPrismaClient;

export type ComputerRunSecretField =
  | "kernel-cdp-ws-url"
  | "kernel-live-view-url";

export interface ComputerUseCrypto {
  decryptRunSecret(input: ComputerRunSecretInput & {
    value: string | null | undefined;
  }): Promise<string | null>;
  encryptRunSecret(input: ComputerRunSecretInput & {
    value: string | null | undefined;
  }): Promise<string | null>;
}

interface ComputerRunSecretInput {
  field: ComputerRunSecretField;
  memberId: string;
  prisma?: ComputerUseCryptoPrismaClient;
  runId: string;
}

export const hostedComputerUseCrypto: ComputerUseCrypto = {
  decryptRunSecret: decryptComputerRunSecret,
  encryptRunSecret: encryptComputerRunSecret,
};

export async function encryptComputerRunSecret(input: ComputerRunSecretInput & {
  value: string | null | undefined;
}): Promise<string | null> {
  return sealHostedUserSecureBoxString({
    aad: computerRunSecretAad(input),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    scope: `hosted-computer-run:${input.field}`,
    userId: input.memberId,
    value: input.value,
  });
}

export async function decryptComputerRunSecret(input: ComputerRunSecretInput & {
  value: string | null | undefined;
}): Promise<string | null> {
  return openHostedUserSecureBoxString({
    aad: computerRunSecretAad(input),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    scope: `hosted-computer-run:${input.field}`,
    userId: input.memberId,
    value: input.value,
  });
}

function computerRunSecretAad(
  input: ComputerRunSecretInput,
): Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId"> {
  return {
    field: input.field,
    purpose: "hosted-computer-run-secret",
    rowId: input.runId,
    table: "hosted_computer_run",
  };
}

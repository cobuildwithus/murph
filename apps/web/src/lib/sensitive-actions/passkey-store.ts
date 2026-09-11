import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
} from "@/src/lib/hosted-web/encryption";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import { parseApprovalPasskeys, type ApprovalPasskey } from "./webauthn";

const APPROVAL_CREDENTIALS_FIELD = "hosted-member-approval-credentials.v1";

export interface ApprovalPasskeyState {
  credentials: ApprovalPasskey[];
  encrypted: string | null;
  memberId: string;
}

export interface PreparedApprovalPasskeyWrite {
  expectedEncrypted: string | null;
  memberId: string;
  nextEncrypted: string | null;
}

export async function readApprovalPasskeyState(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<ApprovalPasskeyState> {
  const record = await input.prisma.hostedMemberApprovalCredentials.findUnique({
    where: { memberId: input.memberId },
  });
  if (!record) {
    return { credentials: [], encrypted: null, memberId: input.memberId };
  }
  const plaintext = await decryptHostedWebNullableString({
    field: APPROVAL_CREDENTIALS_FIELD,
    memberId: input.memberId,
    prisma: input.prisma,
    value: record.credentialsEncrypted,
  });
  if (!plaintext) {
    throw new Error("Approval credentials could not be read.");
  }
  return {
    credentials: parseApprovalPasskeys(plaintext),
    encrypted: record.credentialsEncrypted,
    memberId: input.memberId,
  };
}

// Provider verification, crypto and KMS preparation happen before the caller's
// transaction. The ciphertext itself is the exact-version guard at commit.
export async function prepareApprovalPasskeyWrite(input: {
  credentials: ApprovalPasskey[];
  prisma: PrismaClient;
  state: ApprovalPasskeyState;
}): Promise<PreparedApprovalPasskeyWrite> {
  const serialized = JSON.stringify(input.credentials);
  parseApprovalPasskeys(serialized);
  const encrypted = await encryptHostedWebNullableString({
    field: APPROVAL_CREDENTIALS_FIELD,
    memberId: input.state.memberId,
    prisma: input.prisma,
    value: serialized,
  });
  if (!encrypted) {
    throw new Error("Approval credentials could not be prepared.");
  }
  return {
    expectedEncrypted: input.state.encrypted,
    memberId: input.state.memberId,
    nextEncrypted: encrypted,
  };
}

export function preserveApprovalPasskeyState(state: ApprovalPasskeyState): PreparedApprovalPasskeyWrite {
  return {
    expectedEncrypted: state.encrypted,
    memberId: state.memberId,
    nextEncrypted: state.encrypted,
  };
}

// Call within the same transaction as the one-use challenge and approved
// mutation. Holding the member lock also serializes enrollment and deletion.
export async function commitApprovalPasskeyWriteTx(input: {
  prepared: PreparedApprovalPasskeyWrite;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const { prepared, prisma } = input;
  await lockHostedMemberRow(prisma, prepared.memberId);
  const member = await prisma.hostedMember.findUnique({
    where: { id: prepared.memberId },
    select: { suspendedAt: true },
  });
  if (!member || member.suspendedAt) {
    throw approvalPasskeysChanged();
  }
  const current = await prisma.hostedMemberApprovalCredentials.findUnique({
    where: { memberId: prepared.memberId },
  });
  if ((current?.credentialsEncrypted ?? null) !== prepared.expectedEncrypted) {
    throw approvalPasskeysChanged();
  }
  if (prepared.nextEncrypted === prepared.expectedEncrypted) {
    return;
  }
  if (!prepared.nextEncrypted) {
    throw new TypeError("An approval credential write cannot remove protection.");
  }
  await prisma.hostedMemberApprovalCredentials.upsert({
    where: { memberId: prepared.memberId },
    create: {
      memberId: prepared.memberId,
      credentialsEncrypted: prepared.nextEncrypted,
    },
    update: { credentialsEncrypted: prepared.nextEncrypted },
  });
}

function approvalPasskeysChanged() {
  return hostedOnboardingError({
    code: "SENSITIVE_ACTION_CREDENTIALS_CHANGED",
    httpStatus: 409,
    message: "Your secure approval changed. Please try again.",
  });
}

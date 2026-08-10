import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
  buildHostedCustomInferenceModelAlias,
  requireHostedInferenceRevision,
  type HostedAssistantCustomInferenceOverride,
  type HostedInferenceProtocol,
} from "@murphai/hosted-execution/assistant-inference";

import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import {
  decryptHostedInferenceConnection,
  encryptHostedInferenceConnection,
} from "./connection-crypto";
import {
  HOSTED_INFERENCE_SECRET_SCHEMA,
  type HostedInferenceConnectionCandidate,
  type HostedInferenceConnectionResolved,
  type HostedInferenceConnectionSecret,
  type HostedInferenceConnectionView,
} from "./types";

export const HOSTED_INFERENCE_CONNECTION_SELECT = {
  configEncrypted: true,
  contextWindowTokens: true,
  createdAt: true,
  memberId: true,
  protocol: true,
  revision: true,
  selected: true,
  supportsImages: true,
  updatedAt: true,
  verificationProfile: true,
  verifiedAt: true,
} as const satisfies Prisma.HostedInferenceConnectionSelect;

type HostedInferenceConnectionRow = Prisma.HostedInferenceConnectionGetPayload<{
  select: typeof HOSTED_INFERENCE_CONNECTION_SELECT;
}>;

type HostedInferenceConnectionReadClient = PrismaClient | Prisma.TransactionClient;

type HostedInferenceConnectionSelectionReadClient = {
  hostedMember: Pick<
    Prisma.TransactionClient["hostedMember"],
    "findUnique"
  >;
};

export class HostedInferenceConnectionError extends Error {
  constructor(
    readonly code:
      | "HOSTED_INFERENCE_CONNECTION_CONFLICT"
      | "HOSTED_INFERENCE_CONNECTION_NOT_FOUND"
      | "HOSTED_INFERENCE_CONNECTION_REVERIFICATION_REQUIRED"
      | "HOSTED_INFERENCE_PERSONAL_CHAT_REQUIRED"
      | "HOSTED_MEMBER_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "HostedInferenceConnectionError";
  }
}

export function isHostedInferenceConnectionError(
  value: unknown,
): value is HostedInferenceConnectionError {
  return value instanceof HostedInferenceConnectionError;
}

export async function readHostedInferenceConnectionView(input: {
  memberId: string;
  prisma?: HostedInferenceConnectionReadClient;
}): Promise<HostedInferenceConnectionView | null> {
  const prisma = input.prisma ?? getPrisma();
  const row = await prisma.hostedInferenceConnection.findUnique({
    select: HOSTED_INFERENCE_CONNECTION_SELECT,
    where: { memberId: input.memberId },
  });
  return row
    ? await projectHostedInferenceConnectionView({ prisma, row })
    : null;
}

export async function readSelectedHostedInferenceConnectionOverride(input: {
  memberId: string;
  prisma?: HostedInferenceConnectionSelectionReadClient;
}): Promise<HostedAssistantCustomInferenceOverride | null> {
  const row = await readSelectedHostedInferenceConnectionRow(input);
  return row ? projectHostedInferenceConnectionOverride(row) : null;
}

export async function readSelectedHostedInferenceConnection(input: {
  expectedRevision?: number | null;
  memberId: string;
  prisma?: HostedInferenceConnectionReadClient;
}): Promise<HostedInferenceConnectionResolved | null> {
  const prisma = input.prisma ?? getPrisma();
  const row = await readSelectedHostedInferenceConnectionRow({
    memberId: input.memberId,
    prisma,
  });
  if (!row) {
    return null;
  }
  if (
    input.expectedRevision !== undefined
    && row.revision !== requireHostedInferenceRevision(input.expectedRevision)
  ) {
    throw connectionConflictError();
  }
  return await projectHostedInferenceConnectionResolved({ prisma, row });
}

export async function replaceHostedInferenceConnection(input: {
  candidate: HostedInferenceConnectionCandidate;
  expectedRevision: number | null;
  memberId: string;
  prisma?: PrismaClient;
  verifiedAt?: Date;
}): Promise<HostedInferenceConnectionView> {
  const prisma = input.prisma ?? getPrisma();
  const configEncrypted = await encryptHostedInferenceConnection({
    candidate: input.candidate,
    memberId: input.memberId,
    prisma,
  });
  const verifiedAt = input.verifiedAt ?? new Date();

  const row = await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await requirePersonalHostedInferenceMember({
      memberId: input.memberId,
      prisma: tx,
    });
    const current = await tx.hostedInferenceConnection.findUnique({
      select: HOSTED_INFERENCE_CONNECTION_SELECT,
      where: { memberId: input.memberId },
    });
    assertExpectedRevision({
      currentRevision: current?.revision ?? null,
      expectedRevision: input.expectedRevision,
    });
    const revision = await allocateHostedInferenceConnectionRevision(tx);

    return await tx.hostedInferenceConnection.upsert({
      create: {
        configEncrypted,
        contextWindowTokens: input.candidate.contextWindowTokens,
        memberId: input.memberId,
        protocol: input.candidate.protocol,
        revision,
        selected: false,
        supportsImages: input.candidate.supportsImages,
        verificationProfile: HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
        verifiedAt,
      },
      select: HOSTED_INFERENCE_CONNECTION_SELECT,
      update: {
        configEncrypted,
        contextWindowTokens: input.candidate.contextWindowTokens,
        protocol: input.candidate.protocol,
        revision,
        selected: false,
        supportsImages: input.candidate.supportsImages,
        verificationProfile: HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
        verifiedAt,
      },
      where: { memberId: input.memberId },
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return projectHostedInferenceConnectionViewFromSecret({
    row,
    secret: {
      auth: input.candidate.auth,
      endpointUrl: input.candidate.endpointUrl,
      model: input.candidate.model,
      protocol: input.candidate.protocol,
      schema: HOSTED_INFERENCE_SECRET_SCHEMA,
    },
  });
}

export async function setHostedInferenceConnectionSelected(input: {
  expectedRevision: number | null;
  memberId: string;
  prisma?: PrismaClient;
  selected: boolean;
}): Promise<HostedInferenceConnectionView> {
  const prisma = input.prisma ?? getPrisma();
  const row = await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await requirePersonalHostedInferenceMember({
      memberId: input.memberId,
      prisma: tx,
    });
    const current = await tx.hostedInferenceConnection.findUnique({
      select: HOSTED_INFERENCE_CONNECTION_SELECT,
      where: { memberId: input.memberId },
    });
    if (!current) {
      throw new HostedInferenceConnectionError(
        "HOSTED_INFERENCE_CONNECTION_NOT_FOUND",
        "Save and verify a custom inference connection before selecting it.",
      );
    }
    // The caller's protocol eligibility check ran against the revision it
    // read; a concurrent replacement may have changed the connection since,
    // so the selection only commits against that same revision.
    assertExpectedRevision({
      currentRevision: current.revision,
      expectedRevision: input.expectedRevision,
    });
    requireCurrentVerificationProfile(current);
    if (current.selected === input.selected) {
      return current;
    }
    return await tx.hostedInferenceConnection.update({
      data: { selected: input.selected },
      select: HOSTED_INFERENCE_CONNECTION_SELECT,
      where: { memberId: input.memberId },
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return await projectHostedInferenceConnectionView({ prisma, row });
}

export async function deleteHostedInferenceConnection(input: {
  expectedRevision: number;
  memberId: string;
  prisma?: PrismaClient;
}): Promise<{ deleted: true; selected: boolean }> {
  const prisma = input.prisma ?? getPrisma();
  return await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await requirePersonalHostedInferenceMember({
      memberId: input.memberId,
      prisma: tx,
    });
    const current = await tx.hostedInferenceConnection.findUnique({
      select: HOSTED_INFERENCE_CONNECTION_SELECT,
      where: { memberId: input.memberId },
    });
    if (!current) {
      throw new HostedInferenceConnectionError(
        "HOSTED_INFERENCE_CONNECTION_NOT_FOUND",
        "No custom inference connection is saved.",
      );
    }
    assertExpectedRevision({
      currentRevision: current.revision,
      expectedRevision: input.expectedRevision,
    });
    await tx.hostedInferenceConnection.delete({
      where: { memberId: input.memberId },
    });
    return { deleted: true as const, selected: current.selected };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function readSelectedHostedInferenceConnectionRow(input: {
  memberId: string;
  prisma?: HostedInferenceConnectionSelectionReadClient;
}): Promise<HostedInferenceConnectionRow | null> {
  const prisma = input.prisma ?? getPrisma();
  const member = await prisma.hostedMember.findUnique({
    select: {
      inferenceConnection: {
        select: HOSTED_INFERENCE_CONNECTION_SELECT,
      },
      threadContainer: {
        select: { memberId: true },
      },
    },
    where: { id: input.memberId },
  });
  if (!member?.inferenceConnection?.selected) {
    return null;
  }
  if (member.threadContainer !== null) {
    throw personalChatRequiredError();
  }
  requireCurrentVerificationProfile(member.inferenceConnection);
  return member.inferenceConnection;
}

export async function requirePersonalHostedInferenceMember(input: {
  memberId: string;
  prisma: HostedInferenceConnectionReadClient;
}): Promise<void> {
  const member = await input.prisma.hostedMember.findUnique({
    select: {
      id: true,
      threadContainer: { select: { memberId: true } },
    },
    where: { id: input.memberId },
  });
  if (!member) {
    throw new HostedInferenceConnectionError(
      "HOSTED_MEMBER_NOT_FOUND",
      "Finish signup before configuring custom inference.",
    );
  }
  if (member.threadContainer !== null) {
    throw personalChatRequiredError();
  }
}

function personalChatRequiredError(): HostedInferenceConnectionError {
  return new HostedInferenceConnectionError(
    "HOSTED_INFERENCE_PERSONAL_CHAT_REQUIRED",
    "Custom inference is available only in your personal Murph chat.",
  );
}

function requireCurrentVerificationProfile(
  row: Pick<HostedInferenceConnectionRow, "verificationProfile">,
): void {
  if (
    row.verificationProfile !== HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE
  ) {
    throw new HostedInferenceConnectionError(
      "HOSTED_INFERENCE_CONNECTION_REVERIFICATION_REQUIRED",
      "Reverify the custom inference connection before using it with this Murph runtime.",
    );
  }
}

// Revisions come from a dedicated sequence rather than current-row + 1: a
// hard delete followed by a new save would otherwise restart at revision 1,
// letting a stale selection that observed the deleted connection commit
// against an endpoint its caller never checked.
async function allocateHostedInferenceConnectionRevision(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ revision: number }>>`
    select nextval('hosted_inference_connection_revision_seq')::integer as revision
  `;
  return requireHostedInferenceRevision(rows[0]?.revision);
}

function assertExpectedRevision(input: {
  currentRevision: number | null;
  expectedRevision: number | null;
}): void {
  const expected = input.expectedRevision === null
    ? null
    : requireHostedInferenceRevision(input.expectedRevision);
  if (input.currentRevision !== expected) {
    throw connectionConflictError();
  }
}

function connectionConflictError(): HostedInferenceConnectionError {
  return new HostedInferenceConnectionError(
    "HOSTED_INFERENCE_CONNECTION_CONFLICT",
    "The custom inference connection changed. Refresh Settings and try again.",
  );
}

async function projectHostedInferenceConnectionView(input: {
  prisma: HostedInferenceConnectionReadClient;
  row: HostedInferenceConnectionRow;
}): Promise<HostedInferenceConnectionView> {
  const secret = await decryptHostedInferenceConnection({
    memberId: input.row.memberId,
    prisma: input.prisma,
    protocol: parseStoredProtocol(input.row.protocol),
    value: input.row.configEncrypted,
  });
  return projectHostedInferenceConnectionViewFromSecret({
    row: input.row,
    secret,
  });
}

async function projectHostedInferenceConnectionResolved(input: {
  prisma: HostedInferenceConnectionReadClient;
  row: HostedInferenceConnectionRow;
}): Promise<HostedInferenceConnectionResolved> {
  const secret = await decryptHostedInferenceConnection({
    memberId: input.row.memberId,
    prisma: input.prisma,
    protocol: parseStoredProtocol(input.row.protocol),
    value: input.row.configEncrypted,
  });
  return {
    ...projectHostedInferenceConnectionViewFromSecret({
      row: input.row,
      secret,
    }),
    auth: secret.auth,
    endpointUrl: secret.endpointUrl,
  };
}

function projectHostedInferenceConnectionOverride(
  row: HostedInferenceConnectionRow,
): HostedAssistantCustomInferenceOverride {
  return {
    contextWindowTokens: row.contextWindowTokens,
    modelAlias: buildHostedCustomInferenceModelAlias(row.revision),
    protocol: parseStoredProtocol(row.protocol),
    revision: row.revision,
    supportsImages: row.supportsImages,
    verificationProfile: row.verificationProfile,
  };
}

function projectHostedInferenceConnectionViewFromSecret(input: {
  row: HostedInferenceConnectionRow;
  secret: HostedInferenceConnectionSecret;
}): HostedInferenceConnectionView {
  return {
    contextWindowTokens: input.row.contextWindowTokens,
    endpointHost: new URL(input.secret.endpointUrl).hostname,
    model: input.secret.model,
    protocol: input.secret.protocol,
    revision: input.row.revision,
    selected: input.row.selected,
    supportsImages: input.row.supportsImages,
    verificationProfile: input.row.verificationProfile,
    verifiedAt: input.row.verifiedAt.toISOString(),
  };
}

function parseStoredProtocol(value: string): HostedInferenceProtocol {
  if (value === "responses" || value === "chat_completions") {
    return value;
  }
  throw new TypeError("Stored custom inference protocol is invalid.");
}

import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  requireHostedInferenceRevision,
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
import type {
  HostedInferenceConnectionCandidate,
  HostedInferenceConnectionResolved,
  HostedInferenceConnectionSecret,
  HostedInferenceConnectionView,
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

export class HostedInferenceConnectionError extends Error {
  constructor(
    readonly code:
      | "HOSTED_INFERENCE_CONNECTION_CONFLICT"
      | "HOSTED_INFERENCE_CONNECTION_NOT_FOUND"
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

export async function readSelectedHostedInferenceConnection(input: {
  memberId: string;
  prisma?: HostedInferenceConnectionReadClient;
}): Promise<HostedInferenceConnectionResolved | null> {
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
  return await projectHostedInferenceConnectionResolved({
    prisma,
    row: member.inferenceConnection,
  });
}

export async function replaceHostedInferenceConnection(input: {
  candidate: HostedInferenceConnectionCandidate;
  expectedRevision: number | null;
  memberId: string;
  prisma?: PrismaClient;
  verificationProfile: string;
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
    const revision = current ? current.revision + 1 : 1;

    return await tx.hostedInferenceConnection.upsert({
      create: {
        configEncrypted,
        contextWindowTokens: input.candidate.contextWindowTokens,
        memberId: input.memberId,
        protocol: input.candidate.protocol,
        revision,
        selected: false,
        supportsImages: input.candidate.supportsImages,
        verificationProfile: input.verificationProfile,
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
        verificationProfile: input.verificationProfile,
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
      schema: "murph.hosted-inference-secret.v1",
    },
  });
}

export async function setHostedInferenceConnectionSelected(input: {
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

async function requirePersonalHostedInferenceMember(input: {
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

function assertExpectedRevision(input: {
  currentRevision: number | null;
  expectedRevision: number | null;
}): void {
  const expected = input.expectedRevision === null
    ? null
    : requireHostedInferenceRevision(input.expectedRevision);
  if (input.currentRevision !== expected) {
    throw new HostedInferenceConnectionError(
      "HOSTED_INFERENCE_CONNECTION_CONFLICT",
      "The custom inference connection changed. Refresh Settings and try again.",
    );
  }
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

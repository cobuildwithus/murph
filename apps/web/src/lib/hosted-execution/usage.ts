import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  parseAssistantUsageRecord,
  type AssistantUsageRecord,
} from "@murph/runtime-state";

import { getPrisma } from "../prisma";

export interface ImportHostedAiUsageResult {
  recordedIds: string[];
  records: AssistantUsageRecord[];
}

type HostedAiUsageClient = PrismaClient | Prisma.TransactionClient;

export interface HostedAiUsageStripeCandidate {
  apiKeyEnv: string | null;
  credentialSource: string | null;
  id: string;
  inputTokens: number | null;
  memberId: string;
  outputTokens: number | null;
  provider: string;
  requestedModel: string | null;
  stripeMeterStatus: string;
  totalTokens: number | null;
  member: {
    stripeCustomerId: string | null;
  };
}

export async function listHostedAiUsagePendingStripeMetering(input: {
  limit?: number;
  prisma?: PrismaClient;
} = {}): Promise<HostedAiUsageStripeCandidate[]> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.hostedAiUsage.findMany({
    where: {
      stripeMeterStatus: "pending",
      member: {
        stripeCustomerId: {
          not: null,
        },
      },
    },
    orderBy: [
      {
        occurredAt: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
    take: Math.max(1, input.limit ?? 32),
    select: {
      apiKeyEnv: true,
      credentialSource: true,
      id: true,
      inputTokens: true,
      memberId: true,
      outputTokens: true,
      provider: true,
      requestedModel: true,
      stripeMeterStatus: true,
      totalTokens: true,
      member: {
        select: {
          stripeCustomerId: true,
        },
      },
    },
  });
}

export async function markHostedAiUsageStripeMetered(input: {
  id: string;
  identifier: string;
  now?: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();

  await prisma.hostedAiUsage.update({
    where: {
      id: input.id,
    },
    data: {
      stripeMeterError: null,
      stripeMeterIdentifier: input.identifier,
      stripeMeterStatus: "metered",
      stripeMeteredAt: new Date(input.now ?? new Date().toISOString()),
    },
  });
}

export async function markHostedAiUsageStripeSkipped(input: {
  id: string;
  message: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();

  await prisma.hostedAiUsage.update({
    where: {
      id: input.id,
    },
    data: {
      stripeMeterError: input.message,
      stripeMeterStatus: "skipped",
    },
  });
}

export async function markHostedAiUsageStripeFailed(input: {
  id: string;
  message: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();

  await prisma.hostedAiUsage.update({
    where: {
      id: input.id,
    },
    data: {
      stripeMeterError: input.message,
      stripeMeterStatus: "failed",
    },
  });
}

export async function importHostedAiUsageRecords(input: {
  prisma?: PrismaClient;
  usage: readonly unknown[];
}): Promise<ImportHostedAiUsageResult> {
  const prisma = input.prisma ?? getPrisma();
  const records = input.usage.map((entry) => parseAssistantUsageRecord(entry));
  const recordedIds: string[] = [];

  for (const record of records) {
    const memberId = requireHostedAiUsageMemberId(record);

    await prisma.hostedAiUsage.upsert({
      where: {
        id: record.usageId,
      },
      create: {
        id: record.usageId,
        memberId,
        sessionId: record.sessionId,
        turnId: record.turnId,
        attemptCount: record.attemptCount,
        occurredAt: new Date(record.occurredAt),
        provider: record.provider,
        routeId: record.routeId,
        requestedModel: record.requestedModel,
        servedModel: record.servedModel,
        providerName: record.providerName,
        baseUrl: record.baseUrl,
        apiKeyEnv: record.apiKeyEnv,
        credentialSource: record.credentialSource,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        reasoningTokens: record.reasoningTokens,
        cachedInputTokens: record.cachedInputTokens,
        cacheWriteTokens: record.cacheWriteTokens,
        totalTokens: record.totalTokens,
        providerSessionId: record.providerSessionId,
        providerRequestId: record.providerRequestId,
        providerMetadataJson: toHostedAiUsageJson(record.providerMetadataJson),
        rawUsageJson: toHostedAiUsageJson(record.rawUsageJson),
      },
      update: {},
    });
    recordedIds.push(record.usageId);
  }

  return {
    recordedIds,
    records,
  };
}

function requireHostedAiUsageMemberId(record: AssistantUsageRecord): string {
  if (!record.memberId) {
    throw new TypeError(
      `Hosted AI usage ${record.usageId} is missing memberId and cannot be imported into the hosted control plane.`,
    );
  }

  return record.memberId;
}

function toHostedAiUsageJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null || value === undefined
    ? Prisma.JsonNull
    : (value as Prisma.InputJsonValue);
}

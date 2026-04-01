import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  parseAssistantUsageRecord,
  type AssistantUsageCredentialSource,
  type AssistantUsageRecord,
} from "@murph/runtime-state/node";

import { getPrisma } from "../prisma";

export interface ImportHostedAiUsageResult {
  recordedIds: string[];
  records: AssistantUsageRecord[];
}

type HostedAiUsageClient = PrismaClient | Prisma.TransactionClient;

export interface HostedAiUsageStripeCandidate {
  apiKeyEnv: string | null;
  credentialSource: AssistantUsageCredentialSource;
  id: string;
  inputTokens: number | null;
  memberId: string;
  occurredAt: Date;
  outputTokens: number | null;
  provider: string;
  requestedModel: string | null;
  stripeMeterStatus: string;
  totalTokens: number | null;
  member: {
    stripeCustomerId: string;
  };
}

export async function listHostedAiUsagePendingStripeMetering(input: {
  limit?: number;
  prisma?: PrismaClient;
} = {}): Promise<HostedAiUsageStripeCandidate[]> {
  const prisma = input.prisma ?? getPrisma();

  const records = await prisma.hostedAiUsage.findMany({
    where: {
      credentialSource: {
        not: null,
      },
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
      occurredAt: true,
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

  return records.flatMap((record) =>
    record.member.stripeCustomerId && isAssistantUsageCredentialSource(record.credentialSource)
      ? [{
          ...record,
          credentialSource: record.credentialSource,
          member: {
            stripeCustomerId: record.member.stripeCustomerId,
          },
        }]
      : [],
  );
}

function isAssistantUsageCredentialSource(
  value: string | null,
): value is AssistantUsageCredentialSource {
  return value === "member" || value === "platform" || value === "unknown";
}

export async function markHostedAiUsageStripeMetered(input: {
  id: string;
  identifier: string;
  now?: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  await updateHostedAiUsageStripeMeterState({
    id: input.id,
    prisma: input.prisma,
    stripeMeterError: null,
    stripeMeterIdentifier: input.identifier,
    stripeMeterStatus: "metered",
    stripeMeteredAt: new Date(input.now ?? new Date().toISOString()),
  });
}

export async function markHostedAiUsageStripeSkipped(input: {
  id: string;
  message: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  await updateHostedAiUsageStripeMeterState({
    id: input.id,
    prisma: input.prisma,
    stripeMeterError: input.message,
    stripeMeterIdentifier: null,
    stripeMeterStatus: "skipped",
    stripeMeteredAt: null,
  });
}

export async function markHostedAiUsageStripeRetryableFailure(input: {
  id: string;
  message: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  await updateHostedAiUsageStripeMeterState({
    id: input.id,
    prisma: input.prisma,
    stripeMeterError: input.message,
    stripeMeterIdentifier: null,
    stripeMeterStatus: "pending",
    stripeMeteredAt: null,
  });
}

export async function markHostedAiUsageStripeFailed(input: {
  id: string;
  message: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  await updateHostedAiUsageStripeMeterState({
    id: input.id,
    prisma: input.prisma,
    stripeMeterError: input.message,
    stripeMeterIdentifier: null,
    stripeMeterStatus: "failed",
    stripeMeteredAt: null,
  });
}

async function updateHostedAiUsageStripeMeterState(input: {
  id: string;
  prisma?: HostedAiUsageClient;
  stripeMeterError: string | null;
  stripeMeterIdentifier: string | null;
  stripeMeterStatus: "failed" | "metered" | "pending" | "skipped";
  stripeMeteredAt: Date | null;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();

  await prisma.hostedAiUsage.update({
    where: {
      id: input.id,
    },
    data: {
      stripeMeterError: input.stripeMeterError,
      stripeMeterIdentifier: input.stripeMeterIdentifier,
      stripeMeterStatus: input.stripeMeterStatus,
      stripeMeteredAt: input.stripeMeteredAt,
    },
  });
}

export async function importHostedAiUsageRecords(input: {
  prisma?: PrismaClient;
  trustedUserId?: string | null;
  usage: readonly unknown[];
}): Promise<ImportHostedAiUsageResult> {
  const prisma = input.prisma ?? getPrisma();
  const records = input.usage.map((entry) => parseAssistantUsageRecord(entry));
  const recordedIds: string[] = [];

  for (const record of records) {
    const memberId = requireHostedAiUsageMemberId(record, input.trustedUserId ?? null);

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

function requireHostedAiUsageMemberId(
  record: AssistantUsageRecord,
  trustedUserId: string | null,
): string {
  if (!record.memberId) {
    throw new TypeError(
      `Hosted AI usage ${record.usageId} is missing memberId and cannot be imported into the hosted control plane.`,
    );
  }

  if (trustedUserId && record.memberId !== trustedUserId) {
    throw new TypeError(
      `Hosted AI usage ${record.usageId} memberId ${record.memberId} does not match the authenticated hosted execution user ${trustedUserId}.`,
    );
  }

  return record.memberId;
}

function toHostedAiUsageJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }

  try {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      return Prisma.JsonNull;
    }

    return JSON.parse(serialized) as Prisma.InputJsonValue;
  } catch (error) {
    throw new TypeError(
      `Hosted AI usage JSON payload must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

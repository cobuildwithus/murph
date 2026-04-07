import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  parseAssistantUsageRecord,
  type AssistantUsageCredentialSource,
  type AssistantUsageRecord,
} from "@murphai/runtime-state/node";

import { readHostedMemberBillingPrivateState } from "../hosted-onboarding/member-private-codecs";
import { getPrisma } from "../prisma";
import { requireHostedPendingUsageClient } from "./pending-usage-client";

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
  stripeCustomerId: string;
  stripeMeterStatus: string;
  totalTokens: number | null;
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
        billingRef: {
          is: {
            stripeCustomerLookupKey: {
              not: null,
            },
          },
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
      member: {
        select: {
          billingRef: {
            select: {
              memberId: true,
              stripeCustomerIdEncrypted: true,
              stripeLatestBillingEventIdEncrypted: true,
              stripeLatestCheckoutSessionIdEncrypted: true,
              stripeSubscriptionIdEncrypted: true,
            },
          },
        },
      },
      memberId: true,
      occurredAt: true,
      outputTokens: true,
      provider: true,
      requestedModel: true,
      stripeMeterStatus: true,
      totalTokens: true,
    },
  });

  const candidates = await Promise.all(records.map(async (record) => {
    const stripeCustomerId = record.member.billingRef
      ? readHostedMemberBillingPrivateState(record.member.billingRef).stripeCustomerId
      : null;

    if (!stripeCustomerId || !isAssistantUsageCredentialSource(record.credentialSource)) {
      return null;
    }

    return {
      apiKeyEnv: record.apiKeyEnv,
      credentialSource: record.credentialSource,
      id: record.id,
      inputTokens: record.inputTokens,
      memberId: record.memberId,
      occurredAt: record.occurredAt,
      outputTokens: record.outputTokens,
      provider: record.provider,
      requestedModel: record.requestedModel,
      stripeCustomerId,
      stripeMeterStatus: record.stripeMeterStatus,
      totalTokens: record.totalTokens,
    } satisfies HostedAiUsageStripeCandidate;
  }));

  return candidates.flatMap((candidate) => candidate ? [candidate] : []);
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

export interface HostedPendingAiUsageImportDrainResult {
  imported: number;
  failedUsers: number;
  scannedUsers: number;
}

export async function drainHostedPendingAiUsageImports(input: {
  limitPerUser?: number;
  prisma?: PrismaClient;
} = {}): Promise<HostedPendingAiUsageImportDrainResult> {
  const prisma = input.prisma ?? getPrisma();
  const client = requireHostedPendingUsageClient();
  const dirtyUserIds = await client.getPendingUsageDirtyUsers();

  let imported = 0;
  let failedUsers = 0;

  for (const userId of dirtyUserIds) {
    try {
      const usage = await client.getPendingUsage(userId, input.limitPerUser ?? 200);

      if (usage.length === 0) {
        await client.deletePendingUsage(userId, []);
        continue;
      }

      const result = await importHostedAiUsageRecords({
        prisma,
        trustedUserId: userId,
        usage,
      });

      if (result.recordedIds.length > 0) {
        await client.deletePendingUsage(userId, result.recordedIds);
      }

      imported += result.recordedIds.length;
    } catch (error) {
      failedUsers += 1;
      console.error(
        `Failed to import hosted pending AI usage for ${userId}.`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return {
    failedUsers,
    imported,
    scannedUsers: dirtyUserIds.length,
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

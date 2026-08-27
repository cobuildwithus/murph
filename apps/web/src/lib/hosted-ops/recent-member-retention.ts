import "server-only";

import type { HostedBillingStatus, Prisma, PrismaClient } from "@prisma/client";

import {
  getHostedBillingPlanDefinition,
  parseHostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { getPrisma } from "@/src/lib/prisma";

export const HOSTED_RECENT_MEMBER_RETENTION_LIMIT = 20;

const HOSTED_CONVERSATION_MESSAGE_KIND = "conversation.message";
const MS_PER_DAY = 24 * 60 * 60 * 1_000;

const realHostedMemberWhere = {
  hostedGroupRuntime: null,
  threadContainer: null,
} satisfies Prisma.HostedMemberWhereInput;

export type HostedRecentMemberLifecycle =
  | "activated"
  | "no_message"
  | "returned";

export interface HostedRecentMemberRetentionRow {
  billingPhase: string | null;
  billingPlanName: string | null;
  billingStatus: HostedBillingStatus;
  createdAt: string;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  lifecycle: HostedRecentMemberLifecycle;
  maskedPhoneNumberHint: string | null;
  memberId: string;
  messagesAllTime: number;
  messagesLast7Days: number;
  messagesToday: number;
  onboardingCompleted: boolean;
  suspended: boolean;
}

export interface HostedRecentMemberRetention {
  capturedAt: string;
  members: HostedRecentMemberRetentionRow[];
}

/**
 * Bounded operator projection for the newest real members. The first query
 * selects at most 20 members; the remaining three set-based aggregates run in
 * parallel and can each return at most one row per selected member. Message
 * timing uses durable mailbox receipt time rather than provider event time.
 */
export async function readHostedRecentMemberRetention(
  now: Date,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedRecentMemberRetention> {
  const members = await prisma.hostedMember.findMany({
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: {
      billingRef: {
        select: {
          currentBillingPhase: true,
          currentBillingPlanCode: true,
        },
      },
      billingStatus: true,
      createdAt: true,
      id: true,
      identity: {
        select: {
          maskedPhoneNumberHint: true,
        },
      },
      initialOnboardingCompletedAt: true,
      suspendedAt: true,
    },
    take: HOSTED_RECENT_MEMBER_RETENTION_LIMIT,
    where: {
      ...realHostedMemberWhere,
      createdAt: {
        lte: now,
      },
    },
  });

  if (members.length === 0) {
    return {
      capturedAt: now.toISOString(),
      members: [],
    };
  }

  const memberIds = members.map((member) => member.id);
  const todayStart = startOfUtcDay(now);
  const last7DaysStart = new Date(now.getTime() - (7 * MS_PER_DAY));

  const [lifetimeRows, last7DayRows, todayRows] = await Promise.all([
    prisma.hostedMailboxItem.groupBy({
      _count: { _all: true },
      _max: { createdAt: true },
      _min: { createdAt: true },
      by: ["userId"],
      where: {
        createdAt: { lt: now },
        kind: HOSTED_CONVERSATION_MESSAGE_KIND,
        userId: { in: memberIds },
      },
    }),
    prisma.hostedMailboxItem.groupBy({
      _count: { _all: true },
      by: ["userId"],
      where: {
        createdAt: { gte: last7DaysStart, lt: now },
        kind: HOSTED_CONVERSATION_MESSAGE_KIND,
        userId: { in: memberIds },
      },
    }),
    prisma.hostedMailboxItem.groupBy({
      _count: { _all: true },
      by: ["userId"],
      where: {
        createdAt: { gte: todayStart, lt: now },
        kind: HOSTED_CONVERSATION_MESSAGE_KIND,
        userId: { in: memberIds },
      },
    }),
  ]);

  const lifetimeByMemberId = new Map(
    lifetimeRows.map((row) => [row.userId, row] as const),
  );
  const last7DaysByMemberId = new Map(
    last7DayRows.map((row) => [row.userId, row._count._all] as const),
  );
  const todayByMemberId = new Map(
    todayRows.map((row) => [row.userId, row._count._all] as const),
  );

  return {
    capturedAt: now.toISOString(),
    members: members.map((member) => {
      const lifetime = lifetimeByMemberId.get(member.id);
      const firstMessageAt = lifetime?._min.createdAt ?? null;
      const lastMessageAt = lifetime?._max.createdAt ?? null;
      const parsedPlanCode = parseHostedBillingPlanCode(
        member.billingRef?.currentBillingPlanCode,
      );

      return {
        billingPhase: member.billingRef?.currentBillingPhase ?? null,
        billingPlanName: parsedPlanCode === null
          ? null
          : getHostedBillingPlanDefinition(parsedPlanCode).displayName,
        billingStatus: member.billingStatus,
        createdAt: member.createdAt.toISOString(),
        firstMessageAt: firstMessageAt?.toISOString() ?? null,
        lastMessageAt: lastMessageAt?.toISOString() ?? null,
        lifecycle: resolveLifecycle({
          createdAt: member.createdAt,
          firstMessageAt,
          lastMessageAt,
        }),
        maskedPhoneNumberHint:
          member.identity?.maskedPhoneNumberHint ?? null,
        memberId: member.id,
        messagesAllTime: lifetime?._count._all ?? 0,
        messagesLast7Days: last7DaysByMemberId.get(member.id) ?? 0,
        messagesToday: todayByMemberId.get(member.id) ?? 0,
        onboardingCompleted: member.initialOnboardingCompletedAt !== null,
        suspended: member.suspendedAt !== null,
      };
    }),
  };
}

function resolveLifecycle(input: {
  createdAt: Date;
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
}): HostedRecentMemberLifecycle {
  if (input.firstMessageAt === null || input.lastMessageAt === null) {
    return "no_message";
  }

  return startOfUtcDay(input.lastMessageAt).getTime() >
      startOfUtcDay(input.createdAt).getTime()
    ? "returned"
    : "activated";
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}

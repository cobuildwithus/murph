import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { getPrisma } from "@/src/lib/prisma";

export const HOSTED_RECENT_MEMBER_RETENTION_LIMIT = 20;

const HOSTED_CONVERSATION_MESSAGE_KIND = "conversation.message";
const MS_PER_DAY = 24 * 60 * 60 * 1_000;

const realHostedMemberWhere = {
  hostedGroupRuntime: null,
  threadContainer: null,
} satisfies Prisma.HostedMemberWhereInput;

export interface HostedRecentMemberRetentionRow {
  createdAt: string;
  lastMessageAt: string | null;
  maskedPhoneNumberHint: string | null;
  memberId: string;
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
 * selects at most 20 members; the remaining two set-based aggregates run in
 * parallel and can each return at most one row per selected member. Message
 * timing uses mailbox receipt time rather than provider event time, and every
 * displayed activity fact stays inside the rolling seven-day retention window.
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

  const [last7DayRows, todayRows] = await Promise.all([
    prisma.hostedMailboxItem.groupBy({
      _count: { _all: true },
      _max: { createdAt: true },
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

  const last7DaysByMemberId = new Map(
    last7DayRows.map((row) => [row.userId, row] as const),
  );
  const todayByMemberId = new Map(
    todayRows.map((row) => [row.userId, row._count._all] as const),
  );

  return {
    capturedAt: now.toISOString(),
    members: members.map((member) => {
      const last7Days = last7DaysByMemberId.get(member.id);

      return {
        createdAt: member.createdAt.toISOString(),
        lastMessageAt: last7Days?._max.createdAt?.toISOString() ?? null,
        maskedPhoneNumberHint:
          member.identity?.maskedPhoneNumberHint ?? null,
        memberId: member.id,
        messagesLast7Days: last7Days?._count._all ?? 0,
        messagesToday: todayByMemberId.get(member.id) ?? 0,
        onboardingCompleted: member.initialOnboardingCompletedAt !== null,
        suspended: member.suspendedAt !== null,
      };
    }),
  };
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}

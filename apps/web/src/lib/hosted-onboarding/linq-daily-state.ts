import type { HostedLinqDailyState, PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

type HostedLinqDailyStateClient = PrismaClient | Prisma.TransactionClient;

export const HOSTED_LINQ_DAILY_TEXT_LIMIT = 100;
export const HOSTED_AUTOMATION_ENGAGEMENT_WINDOW_DAYS = 28;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function resolveHostedLinqDayUtc(value: Date | string): Date {
  const occurredAt = value instanceof Date ? value : new Date(value);

  return new Date(Date.UTC(
    occurredAt.getUTCFullYear(),
    occurredAt.getUTCMonth(),
    occurredAt.getUTCDate(),
  ));
}

export async function incrementHostedLinqInboundDailyState(input: {
  memberId: string;
  occurredAt: Date | string;
  prisma: HostedLinqDailyStateClient;
}): Promise<HostedLinqDailyState> {
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt);
  const dayUtc = resolveHostedLinqDayUtc(occurredAt);

  return input.prisma.hostedLinqDailyState.upsert({
    where: {
      memberId_dayUtc: {
        dayUtc,
        memberId: input.memberId,
      },
    },
    create: {
      dayUtc,
      firstSeenAt: occurredAt,
      inboundCount: 1,
      lastSeenAt: occurredAt,
      memberId: input.memberId,
    },
    update: {
      inboundCount: {
        increment: 1,
      },
      lastSeenAt: occurredAt,
    },
  });
}

export async function incrementHostedLinqOutboundDailyState(input: {
  memberId: string;
  occurredAt: Date | string;
  prisma: HostedLinqDailyStateClient;
}): Promise<HostedLinqDailyState> {
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt);
  const dayUtc = resolveHostedLinqDayUtc(occurredAt);

  return input.prisma.hostedLinqDailyState.upsert({
    where: {
      memberId_dayUtc: {
        dayUtc,
        memberId: input.memberId,
      },
    },
    create: {
      dayUtc,
      firstSeenAt: occurredAt,
      lastSeenAt: occurredAt,
      memberId: input.memberId,
      outboundCount: 1,
    },
    update: {
      lastSeenAt: occurredAt,
      outboundCount: {
        increment: 1,
      },
    },
  });
}

export async function readHostedLinqDailyState(input: {
  memberId: string;
  occurredAt: Date | string;
  prisma: HostedLinqDailyStateClient;
}): Promise<HostedLinqDailyState | null> {
  return input.prisma.hostedLinqDailyState.findUnique({
    where: {
      memberId_dayUtc: {
        dayUtc: resolveHostedLinqDayUtc(input.occurredAt),
        memberId: input.memberId,
      },
    },
  });
}

export async function hasHostedLinqInboundWithinDays(input: {
  memberId: string;
  now: Date | string;
  prisma: HostedLinqDailyStateClient;
  windowDays?: number;
}): Promise<boolean> {
  const now = input.now instanceof Date ? input.now : new Date(input.now);
  const thresholdDayUtc = resolveHostedLinqDayUtc(
    new Date(now.getTime() - (input.windowDays ?? HOSTED_AUTOMATION_ENGAGEMENT_WINDOW_DAYS) * MS_PER_DAY),
  );

  const row = await input.prisma.hostedLinqDailyState.findFirst({
    where: {
      dayUtc: {
        gte: thresholdDayUtc,
      },
      inboundCount: {
        gt: 0,
      },
      memberId: input.memberId,
    },
    select: {
      memberId: true,
    },
  });

  return row !== null;
}

export async function claimHostedLinqOnboardingLinkNotice(input: {
  memberId: string;
  occurredAt: Date | string;
  prisma: HostedLinqDailyStateClient;
  sentAt?: Date;
}): Promise<boolean> {
  return markHostedLinqOnboardingLinkNoticeSent(input);
}

export async function markHostedLinqOnboardingLinkNoticeSent(input: {
  memberId: string;
  occurredAt: Date | string;
  prisma: HostedLinqDailyStateClient;
  sentAt?: Date;
}): Promise<boolean> {
  const sentAt = input.sentAt ?? new Date();

  const marked = await input.prisma.hostedLinqDailyState.updateMany({
    where: {
      dayUtc: resolveHostedLinqDayUtc(input.occurredAt),
      memberId: input.memberId,
      onboardingLinkSentAt: null,
    },
    data: {
      onboardingLinkSentAt: sentAt,
    },
  });

  return marked.count === 1;
}

export async function releaseHostedLinqOnboardingLinkNoticeClaim(input: {
  memberId: string;
  occurredAt: Date | string;
  prisma: HostedLinqDailyStateClient;
}): Promise<void> {
  await input.prisma.hostedLinqDailyState.updateMany({
    where: {
      dayUtc: resolveHostedLinqDayUtc(input.occurredAt),
      memberId: input.memberId,
      onboardingLinkSentAt: {
        not: null,
      },
    },
    data: {
      onboardingLinkSentAt: null,
    },
  });
}

export async function claimHostedLinqQuotaReplyNotice(input: {
  memberId: string;
  occurredAt: Date | string;
  prisma: HostedLinqDailyStateClient;
  sentAt?: Date;
}): Promise<boolean> {
  const sentAt = input.sentAt ?? new Date();

  const claimed = await input.prisma.hostedLinqDailyState.updateMany({
    where: {
      dayUtc: resolveHostedLinqDayUtc(input.occurredAt),
      memberId: input.memberId,
      quotaReplySentAt: null,
    },
    data: {
      quotaReplySentAt: sentAt,
    },
  });

  return claimed.count === 1;
}

export async function releaseHostedLinqQuotaReplyNoticeClaim(input: {
  memberId: string;
  occurredAt: Date | string;
  prisma: HostedLinqDailyStateClient;
}): Promise<void> {
  await input.prisma.hostedLinqDailyState.updateMany({
    where: {
      dayUtc: resolveHostedLinqDayUtc(input.occurredAt),
      memberId: input.memberId,
      quotaReplySentAt: {
        not: null,
      },
    },
    data: {
      quotaReplySentAt: null,
    },
  });
}

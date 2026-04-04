import type { HostedLinqDailyState, PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

type HostedLinqDailyStateClient = PrismaClient | Prisma.TransactionClient;

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

export async function claimHostedLinqOnboardingLinkNotice(input: {
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
      onboardingLinkSentAt: null,
    },
    data: {
      onboardingLinkSentAt: sentAt,
    },
  });

  return claimed.count === 1;
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

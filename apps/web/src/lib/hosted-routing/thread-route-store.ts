import "server-only";

import { Prisma } from "@prisma/client";
import type {
  HostedExecutionConversationMessageChannel,
} from "@murphai/hosted-execution";

import {
  createHostedExternalThreadLookupKey,
  createHostedExternalThreadLookupKeyReadCandidates,
  isHostedExternalThreadChannel,
} from "../hosted-onboarding/contact-privacy";
import {
  hostedOnboardingError,
} from "../hosted-onboarding/errors";
import type {
  HostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import type {
  HostedOnboardingReadClient,
} from "../hosted-onboarding/shared";

export const HOSTED_THREAD_CONTAINER_DEFAULT_MONTHLY_USAGE_LIMIT_USD_MICROS =
  4_500_000n;

export type HostedThreadRouteChannel = Extract<
  HostedExecutionConversationMessageChannel,
  "email" | "linq" | "telegram"
>;

export interface HostedThreadRouteSnapshot {
  channel: HostedThreadRouteChannel;
  container: HostedMemberCoreState;
  containerMemberId: string;
  source: string;
}

export async function readHostedThreadRouteByExternalThread(input: {
  channel: HostedThreadRouteChannel;
  prisma: HostedOnboardingReadClient;
  threadId: string | number | null | undefined;
}): Promise<HostedThreadRouteSnapshot | null> {
  const threadLookupKeys = createHostedExternalThreadLookupKeyReadCandidates({
    channel: input.channel,
    threadId: input.threadId,
  });

  if (threadLookupKeys.length === 0) {
    return null;
  }

  const rows = await input.prisma.hostedThreadRoute.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      channel: true,
      container: {
        select: {
          member: {
            select: {
              billingStatus: true,
              createdAt: true,
              id: true,
              suspendedAt: true,
              updatedAt: true,
            },
          },
        },
      },
      containerMemberId: true,
      source: true,
    },
    where: {
      channel: input.channel,
      threadLookupKey: {
        in: threadLookupKeys,
      },
    },
  });

  if (rows.length === 0) {
    return null;
  }

  const distinctContainerIds = new Set(rows.map((row) => row.containerMemberId));
  if (distinctContainerIds.size > 1) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_LOOKUP_AMBIGUOUS",
      details: {
        channel: input.channel,
        matchCount: rows.length,
      },
      httpStatus: 500,
      message: "External thread route lookup matched multiple containers.",
      retryable: true,
    });
  }

  const row = rows[0]!;
  if (!isHostedExternalThreadChannel(row.channel)) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_CHANNEL_INVALID",
      httpStatus: 500,
      message: "External thread route has an unsupported channel.",
      retryable: false,
    });
  }

  return {
    channel: row.channel,
    container: row.container.member,
    containerMemberId: row.containerMemberId,
    source: row.source,
  };
}

export async function createHostedThreadContainerTx(input: {
  memberId: string;
  monthlyUsageLimitUsdMicros?: bigint | null;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const monthlyUsageLimitUsdMicros = normalizeHostedThreadContainerUsageLimit(
    input.monthlyUsageLimitUsdMicros,
  );

  await input.prisma.hostedThreadContainer.create({
    data: {
      memberId: input.memberId,
      monthlyUsageLimitUsdMicros,
    },
  });
}

export async function ensureHostedThreadRouteTx(input: {
  channel: HostedThreadRouteChannel;
  containerMemberId: string;
  prisma: Prisma.TransactionClient;
  source: string;
  threadId: string | number;
}): Promise<void> {
  const threadLookupKey = createHostedExternalThreadLookupKey({
    channel: input.channel,
    threadId: input.threadId,
  });

  if (!threadLookupKey) {
    throw new TypeError(
      "Hosted thread route requires a supported channel and non-empty thread id.",
    );
  }

  const existing = await input.prisma.hostedThreadRoute.findUnique({
    select: {
      containerMemberId: true,
    },
    where: {
      channel_threadLookupKey: {
        channel: input.channel,
        threadLookupKey,
      },
    },
  });

  if (existing) {
    if (existing.containerMemberId !== input.containerMemberId) {
      throw hostedOnboardingError({
        code: "HOSTED_THREAD_ROUTE_ALREADY_BOUND",
        httpStatus: 409,
        message: "This external thread is already routed to another container.",
      });
    }

    await input.prisma.hostedThreadRoute.update({
      data: {
        source: input.source,
      },
      where: {
        channel_threadLookupKey: {
          channel: input.channel,
          threadLookupKey,
        },
      },
    });
    return;
  }

  await input.prisma.hostedThreadRoute.create({
    data: {
      channel: input.channel,
      containerMemberId: input.containerMemberId,
      source: input.source,
      threadLookupKey,
    },
  });
}

function normalizeHostedThreadContainerUsageLimit(value: bigint | null | undefined): bigint {
  const limit = value ?? HOSTED_THREAD_CONTAINER_DEFAULT_MONTHLY_USAGE_LIMIT_USD_MICROS;
  if (limit <= 0n) {
    throw new TypeError("Hosted thread container monthly usage limit must be positive.");
  }
  return limit;
}

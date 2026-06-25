import "server-only";

import type {
  HostedExecutionConversationMessageChannel,
} from "@murphai/hosted-execution";

import {
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

export type HostedThreadRouteChannel = Extract<
  HostedExecutionConversationMessageChannel,
  "email" | "linq" | "telegram"
>;

export interface HostedThreadRouteSnapshot {
  channel: HostedThreadRouteChannel;
  container: HostedMemberCoreState;
  containerMemberId: string;
  owner: HostedMemberCoreState;
}

export async function readHostedThreadRouteByExternalThread(input: {
  accountLookupKey: string | null | undefined;
  channel: HostedThreadRouteChannel;
  prisma: HostedOnboardingReadClient;
  threadId: string | number | null | undefined;
}): Promise<HostedThreadRouteSnapshot | null> {
  const threadLookupKeys = createHostedExternalThreadLookupKeyReadCandidates({
    accountLookupKey: input.accountLookupKey,
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
          owner: {
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
    owner: row.container.owner,
  };
}

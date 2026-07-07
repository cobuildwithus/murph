import "server-only";

import type {
  HostedExecutionConversationMessageChannel,
  HostedExecutionExternalThreadRouteAuthority,
  HostedExecutionLinqExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";

import {
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  isHostedExternalThreadChannel,
} from "../hosted-onboarding/contact-privacy";
import {
  type HostedMemberPersonAccessState,
  hostedMemberPersonAccessSelect,
  readActiveHostedMemberAccess,
} from "../hosted-onboarding/member-access";
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

export type HostedThreadRouteOwnerState = HostedMemberCoreState & HostedMemberPersonAccessState;

export interface HostedThreadRouteSnapshot {
  channel: HostedThreadRouteChannel;
  container: HostedMemberCoreState;
  containerMemberId: string;
  owner: HostedThreadRouteOwnerState;
}

export type HostedThreadRouteEgressAuthority = HostedExecutionExternalThreadRouteAuthority;
export type HostedLinqThreadRouteEgressAuthority =
  HostedExecutionLinqExternalThreadRouteAuthority;

export async function readHostedThreadRouteByThreadIdentity(input: {
  channel: HostedThreadRouteChannel;
  prisma: HostedOnboardingReadClient;
  threadId: string | number | null | undefined;
}): Promise<HostedThreadRouteSnapshot | null> {
  const threadIdentityLookupKeys =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: input.channel,
      threadId: input.threadId,
    });

  if (threadIdentityLookupKeys.length === 0) {
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
              ...hostedMemberPersonAccessSelect,
              createdAt: true,
              id: true,
              updatedAt: true,
            },
          },
        },
      },
      containerMemberId: true,
    },
    where: {
      channel: input.channel,
      threadIdentityLookupKey: {
        in: threadIdentityLookupKeys,
      },
    },
  });

  if (rows.length === 0) {
    return null;
  }

  const distinctContainerIds = new Set(rows.map((row) => row.containerMemberId));
  if (distinctContainerIds.size > 1) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_IDENTITY_LOOKUP_AMBIGUOUS",
      details: {
        channel: input.channel,
        matchCount: rows.length,
      },
      httpStatus: 500,
      message: "External thread identity lookup matched multiple containers.",
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

export async function hasHostedMemberEstablishedLinqThreadRoute(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  const route = await input.prisma.hostedThreadRoute.findFirst({
    select: {
      containerMemberId: true,
    },
    where: {
      channel: "linq",
      containerMemberId: input.memberId,
    },
  });

  return Boolean(route);
}

export async function assertHostedThreadRouteEgressAuthority(input: {
  authority: HostedThreadRouteEgressAuthority;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedThreadRouteSnapshot> {
  const route = await readHostedThreadRouteByThreadIdentity({
    channel: input.authority.channel,
    prisma: input.prisma,
    threadId: input.authority.threadId,
  });

  if (route && route.containerMemberId === input.authority.containerMemberId) {
    if (await readActiveHostedMemberAccess({
      memberId: route.containerMemberId,
      prisma: input.prisma,
    })) {
      return route;
    }
  }

  throw buildHostedThreadRouteEgressUnauthorizedError();
}

export async function assertHostedLinqRouteEgressAuthority(input: {
  authority: HostedLinqThreadRouteEgressAuthority;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedThreadRouteSnapshot> {
  return await assertHostedThreadRouteEgressAuthority({
    authority: input.authority,
    prisma: input.prisma,
  });
}

function buildHostedThreadRouteEgressUnauthorizedError() {
  return hostedOnboardingError({
    code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    httpStatus: 403,
    message: "External thread route egress is no longer authorized.",
    retryable: false,
  });
}

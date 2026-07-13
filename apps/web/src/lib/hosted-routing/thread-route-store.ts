import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
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
  hasActiveHostedThreadContainerAccess,
  type HostedMemberPersonAccessState,
  hostedMemberPersonAccessSelect,
  readActiveHostedMemberAccess,
} from "../hosted-onboarding/member-access";
import {
  hostedOnboardingError,
} from "../hosted-onboarding/errors";
import {
  isHostedMemberSuspended,
} from "../hosted-onboarding/entitlement";
import type {
  HostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import type {
  HostedOnboardingReadClient,
} from "../hosted-onboarding/shared";
import {
  applyHostedLinqThreadRosterSnapshotStrict,
  readHostedLinqThreadRosterStrict,
  type HostedLinqThreadRosterSnapshot,
} from "./linq-thread-roster";

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

export type HostedLinqRouteEgressAuthorityResolution = {
  rosterSnapshot: HostedLinqThreadRosterSnapshot | null;
  route: HostedThreadRouteSnapshot;
};

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

export async function lockHostedThreadRouteByThreadIdentityTx(input: {
  authority: HostedThreadRouteEgressAuthority;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const threadIdentityLookupKeys =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: input.authority.channel,
      threadId: input.authority.threadId,
    });
  if (threadIdentityLookupKeys.length === 0) {
    return;
  }

  await input.prisma.$queryRaw`
    SELECT 1
    FROM "hosted_thread_route"
    WHERE "channel" = ${input.authority.channel}
      AND "thread_identity_lookup_key" IN (${Prisma.join(threadIdentityLookupKeys)})
    FOR UPDATE
  `;
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

export async function markHostedLinqThreadRouteParticipantAdditionPendingTx(input: {
  containerMemberId: string;
  prisma: Prisma.TransactionClient;
  threadId: string | number | null | undefined;
}): Promise<void> {
  const threadIdentityLookupKeys =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: "linq",
      threadId: input.threadId,
    });
  if (threadIdentityLookupKeys.length === 0) {
    return;
  }

  await input.prisma.hostedThreadRoute.updateMany({
    where: {
      channel: "linq",
      containerMemberId: input.containerMemberId,
      threadIdentityLookupKey: { in: threadIdentityLookupKeys },
    },
    data: { pendingParticipantAddition: true },
  });
}

export async function consumeHostedLinqThreadRouteParticipantAdditionPendingTx(input: {
  containerMemberId: string;
  prisma: Prisma.TransactionClient;
  threadId: string | number | null | undefined;
}): Promise<boolean> {
  const threadIdentityLookupKeys =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: "linq",
      threadId: input.threadId,
    });
  if (threadIdentityLookupKeys.length === 0) {
    return false;
  }

  await input.prisma.$queryRaw`
    SELECT 1
    FROM "hosted_thread_route"
    WHERE "channel" = 'linq'
      AND "container_member_id" = ${input.containerMemberId}
      AND "thread_identity_lookup_key" IN (${Prisma.join(threadIdentityLookupKeys)})
    FOR UPDATE
  `;

  const updated = await input.prisma.hostedThreadRoute.updateMany({
    where: {
      channel: "linq",
      containerMemberId: input.containerMemberId,
      pendingParticipantAddition: true,
      threadIdentityLookupKey: { in: threadIdentityLookupKeys },
    },
    data: { pendingParticipantAddition: false },
  });
  return updated.count > 0;
}

export async function assertHostedThreadRouteEgressAuthority(input: {
  authority: HostedThreadRouteEgressAuthority;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedThreadRouteSnapshot> {
  if (input.authority.channel === "linq") {
    const resolution = await assertHostedLinqRouteEgressAuthority({
      authority: {
        ...input.authority,
        channel: "linq",
      },
      prisma: input.prisma,
    });
    return resolution.route;
  }

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
  includeRosterSnapshot?: boolean;
  prisma: HostedOnboardingReadClient;
  rosterSnapshot?: HostedLinqThreadRosterSnapshot | null;
}): Promise<HostedLinqRouteEgressAuthorityResolution> {
  const route = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.prisma,
    threadId: input.authority.threadId,
  });

  if (!route || route.containerMemberId !== input.authority.containerMemberId) {
    throw buildHostedThreadRouteEgressUnauthorizedError();
  }

  const ownerActive = hasActiveHostedThreadContainerAccess({
    container: route.container,
    owner: route.owner,
  });
  if (ownerActive && !input.includeRosterSnapshot) {
    return { rosterSnapshot: null, route };
  }
  if (isHostedMemberSuspended(route.container.suspendedAt)) {
    throw buildHostedThreadRouteEgressUnauthorizedError();
  }
  const rosterSnapshot = input.rosterSnapshot
    ?? (isHostedStandalonePrismaClient(input.prisma)
      ? await readHostedLinqThreadRosterStrict({
          chatId: input.authority.threadId,
          prisma: input.prisma,
        })
      : null);
  if (!rosterSnapshot) {
    throw hostedOnboardingError({
      code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
      httpStatus: 503,
      message: "Hosted Linq group roster is unavailable. Retry later.",
      retryable: true,
    });
  }

  if (ownerActive) {
    return { rosterSnapshot, route };
  }

  const roster = await applyHostedLinqThreadRosterSnapshotStrict({
    chatId: input.authority.threadId,
    containerMemberId: route.containerMemberId,
    handles: rosterSnapshot.handles,
    observationOrdinal: rosterSnapshot.observationOrdinal,
    observedAt: rosterSnapshot.observedAt,
    prisma: input.prisma,
  });
  if (roster.hasActiveParticipantAccess) {
    return { rosterSnapshot, route };
  }

  throw buildHostedThreadRouteEgressUnauthorizedError();
}

export async function prepareHostedLinqRouteEgressRosterSnapshot(input: {
  authority: HostedLinqThreadRouteEgressAuthority;
  prisma: PrismaClient;
}): Promise<HostedLinqThreadRosterSnapshot | null> {
  const route = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.prisma,
    threadId: input.authority.threadId,
  });
  if (!route || route.containerMemberId !== input.authority.containerMemberId) {
    throw buildHostedThreadRouteEgressUnauthorizedError();
  }
  if (hasActiveHostedThreadContainerAccess({
    container: route.container,
    owner: route.owner,
  })) {
    return null;
  }
  if (isHostedMemberSuspended(route.container.suspendedAt)) {
    throw buildHostedThreadRouteEgressUnauthorizedError();
  }

  return await readHostedLinqThreadRosterStrict({
    chatId: input.authority.threadId,
    prisma: input.prisma,
  });
}

function isHostedStandalonePrismaClient(
  prisma: HostedOnboardingReadClient,
): prisma is PrismaClient {
  return "$transaction" in prisma && typeof prisma.$transaction === "function";
}

function buildHostedThreadRouteEgressUnauthorizedError() {
  return hostedOnboardingError({
    code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    httpStatus: 403,
    message: "External thread route egress is no longer authorized.",
    retryable: false,
  });
}

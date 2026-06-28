import "server-only";

import type {
  HostedExecutionConversationMessageChannel,
  HostedExecutionLinqExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";

import {
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedExternalThreadLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
  isHostedExternalThreadChannel,
} from "../hosted-onboarding/contact-privacy";
import {
  hasHostedMemberActiveAccess,
} from "../hosted-onboarding/entitlement";
import {
  hostedOnboardingError,
} from "../hosted-onboarding/errors";
import type {
  HostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import {
  readHostedMemberHomeLinqRoutePrivateState,
} from "../hosted-onboarding/member-private-codecs";
import type {
  HostedOnboardingReadClient,
} from "../hosted-onboarding/shared";

export type HostedThreadRouteChannel = Extract<
  HostedExecutionConversationMessageChannel,
  "email" | "linq" | "telegram"
>;

export interface HostedThreadRouteSnapshot {
  accountLookupKey: string;
  channel: HostedThreadRouteChannel;
  container: HostedMemberCoreState;
  containerMemberId: string;
  owner: HostedMemberCoreState;
}

export interface HostedThreadRouteIdentitySnapshot {
  channel: HostedThreadRouteChannel;
  container: HostedMemberCoreState;
  containerMemberId: string;
  owner: HostedMemberCoreState;
}

interface HostedThreadRouteAuthorityIdentitySnapshot
  extends HostedThreadRouteIdentitySnapshot {
  threadLookupKey: string;
}

export type HostedLinqThreadRouteEgressAuthority =
  HostedExecutionLinqExternalThreadRouteAuthority;

export async function readHostedThreadRouteByExternalThread(input: {
  accountLookupKey?: string | null | undefined;
  accountLookupKeys?: readonly (string | null | undefined)[];
  channel: HostedThreadRouteChannel;
  prisma: HostedOnboardingReadClient;
  threadId: string | number | null | undefined;
}): Promise<HostedThreadRouteSnapshot | null> {
  const {
    accountLookupKeyByThreadLookupKey,
    threadLookupKeys,
  } = createHostedThreadRouteLookupKeyReadCandidates({
    accountLookupKey: input.accountLookupKey,
    accountLookupKeys: input.accountLookupKeys,
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
      threadLookupKey: true,
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
  const accountLookupKey = accountLookupKeyByThreadLookupKey.get(row.threadLookupKey);
  if (!accountLookupKey) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_LOOKUP_KEY_INVALID",
      httpStatus: 500,
      message: "External thread route matched an untracked lookup key.",
      retryable: false,
    });
  }

  if (!isHostedExternalThreadChannel(row.channel)) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_CHANNEL_INVALID",
      httpStatus: 500,
      message: "External thread route has an unsupported channel.",
      retryable: false,
    });
  }

  return {
    accountLookupKey,
    channel: row.channel,
    container: row.container.member,
    containerMemberId: row.containerMemberId,
    owner: row.container.owner,
  };
}

export async function readHostedThreadRouteByThreadIdentity(input: {
  channel: HostedThreadRouteChannel;
  prisma: HostedOnboardingReadClient;
  threadId: string | number | null | undefined;
}): Promise<HostedThreadRouteIdentitySnapshot | null> {
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

export async function assertHostedLinqRouteEgressAuthority(input: {
  authority: HostedLinqThreadRouteEgressAuthority;
  prisma: HostedOnboardingReadClient;
}): Promise<void> {
  const explicitRoutes = await readHostedLinqThreadRoutesByIdentity({
    prisma: input.prisma,
    threadId: input.authority.threadId,
  });

  if (explicitRoutes.length > 0) {
    const authorizedThreadLookupKeys = new Set(
      createHostedThreadRouteLookupKeyReadCandidates({
        accountLookupKey: input.authority.accountLookupKey,
        channel: "linq",
        threadId: input.authority.threadId,
      }).threadLookupKeys,
    );
    const explicitRoute = explicitRoutes.find((route) =>
      authorizedThreadLookupKeys.has(route.threadLookupKey)
    );

    if (
      explicitRoute
      && explicitRoute.containerMemberId === input.authority.containerMemberId
      && hasHostedMemberActiveAccess(explicitRoute.container)
      && hasHostedMemberActiveAccess(explicitRoute.owner)
    ) {
      return;
    }

    throw buildHostedThreadRouteEgressUnauthorizedError();
  }

  const homeRoute = await readHostedMemberHomeLinqRouteAuthority({
    memberId: input.authority.containerMemberId,
    prisma: input.prisma,
  });
  if (
    homeRoute
    && hasHostedMemberActiveAccess(homeRoute.member)
    && homeRoute?.linqChatId === input.authority.threadId
    && createHostedPhoneLookupKeyReadCandidates(homeRoute.linqRecipientPhone)
      .includes(input.authority.accountLookupKey)
  ) {
    return;
  }

  throw buildHostedThreadRouteEgressUnauthorizedError();
}

async function readHostedLinqThreadRoutesByIdentity(input: {
  prisma: HostedOnboardingReadClient;
  threadId: string | number | null | undefined;
}): Promise<HostedThreadRouteAuthorityIdentitySnapshot[]> {
  const threadIdentityLookupKeys =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: "linq",
      threadId: input.threadId,
    });

  if (threadIdentityLookupKeys.length === 0) {
    return [];
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
      threadLookupKey: true,
    },
    where: {
      channel: "linq",
      threadIdentityLookupKey: {
        in: threadIdentityLookupKeys,
      },
    },
  });

  if (rows.length === 0) {
    return [];
  }

  const distinctContainerIds = new Set(rows.map((row) => row.containerMemberId));
  if (distinctContainerIds.size > 1) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_IDENTITY_LOOKUP_AMBIGUOUS",
      details: {
        channel: "linq",
        matchCount: rows.length,
      },
      httpStatus: 500,
      message: "External thread identity lookup matched multiple containers.",
      retryable: true,
    });
  }

  return rows.map((row) => {
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
      threadLookupKey: row.threadLookupKey,
    };
  });
}

async function readHostedMemberHomeLinqRouteAuthority(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<{
  linqChatId: string | null;
  linqRecipientPhone: string | null;
  member: HostedMemberCoreState;
  memberId: string;
} | null> {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: {
      linqChatIdEncrypted: true,
      linqRecipientPhoneEncrypted: true,
      member: {
        select: {
          billingStatus: true,
          createdAt: true,
          id: true,
          suspendedAt: true,
          updatedAt: true,
        },
      },
      memberId: true,
    },
  });

  if (!routingRecord) {
    return null;
  }

  const privateState = await readHostedMemberHomeLinqRoutePrivateState(
    routingRecord,
    input.prisma,
  );

  return {
    linqChatId: privateState.linqChatId,
    linqRecipientPhone: privateState.linqRecipientPhone,
    member: routingRecord.member,
    memberId: routingRecord.memberId,
  };
}

function buildHostedThreadRouteEgressUnauthorizedError() {
  return hostedOnboardingError({
    code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    httpStatus: 403,
    message: "External thread route egress is no longer authorized.",
    retryable: false,
  });
}

function createHostedThreadRouteLookupKeyReadCandidates(input: {
  accountLookupKey?: string | null | undefined;
  accountLookupKeys?: readonly (string | null | undefined)[];
  channel: HostedThreadRouteChannel;
  threadId: string | number | null | undefined;
}): {
  accountLookupKeyByThreadLookupKey: Map<string, string>;
  threadLookupKeys: string[];
} {
  const accountLookupKeys = normalizeHostedThreadRouteAccountLookupKeys([
    ...(input.accountLookupKeys ?? []),
    input.accountLookupKey,
  ]);
  const accountLookupKeyByThreadLookupKey = new Map<string, string>();

  for (const accountLookupKey of accountLookupKeys) {
    const threadLookupKeys = createHostedExternalThreadLookupKeyReadCandidates({
      accountLookupKey,
      channel: input.channel,
      threadId: input.threadId,
    });

    for (const threadLookupKey of threadLookupKeys) {
      accountLookupKeyByThreadLookupKey.set(threadLookupKey, accountLookupKey);
    }
  }

  return {
    accountLookupKeyByThreadLookupKey,
    threadLookupKeys: [...accountLookupKeyByThreadLookupKey.keys()],
  };
}

function normalizeHostedThreadRouteAccountLookupKeys(
  values: readonly (string | null | undefined)[],
): string[] {
  const normalized = values
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0);

  return [...new Set(normalized)];
}

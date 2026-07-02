import "server-only";

import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";
import {
  buildHostedExecutionMemberActivatedWake,
  type HostedExecutionMemberChannels,
} from "@murphai/hosted-execution";

import {
  provisionHostedCryptoDomainRootsForUserTx,
} from "../hosted-crypto/domain-root-store";
import {
  appendHostedMailboxEnvelopeTx,
} from "../hosted-mailbox/store";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedExternalThreadLookupKey,
  createHostedExternalThreadLookupKeyReadCandidates,
  normalizeHostedOpaqueInput,
} from "../hosted-onboarding/contact-privacy";
import {
  hasHostedMemberActiveAccess,
} from "../hosted-onboarding/entitlement";
import {
  hostedOnboardingError,
} from "../hosted-onboarding/errors";
import {
  createHostedMember,
  readHostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import {
  generateHostedMemberId,
} from "../hosted-onboarding/shared";
import type {
  HostedThreadRouteChannel,
} from "./thread-route-store";

export const HOSTED_THREAD_CONTAINER_DEFAULT_MONTHLY_USAGE_LIMIT_USD_MICROS =
  4_500_000n;

export interface HostedThreadContainerRouteEnsureResult {
  activationEventId: string | null;
  activationMailboxItemId: string | null;
  containerMemberId: string;
  created: boolean;
}

export async function ensureHostedThreadContainerRouteTx(input: {
  accountLookupKey: string | null | undefined;
  accountLookupKeys?: readonly (string | null | undefined)[];
  channel: HostedThreadRouteChannel;
  containerMemberId?: string | null;
  monthlyUsageLimitUsdMicros?: bigint | null;
  occurredAt: Date;
  ownerMemberId: string;
  prisma: Prisma.TransactionClient;
  threadId: string | number;
}): Promise<HostedThreadContainerRouteEnsureResult> {
  const owner = await readHostedMemberCoreState({
    memberId: input.ownerMemberId,
    prisma: input.prisma,
  });

  if (!owner || !hasHostedMemberActiveAccess(owner)) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_CONTAINER_OWNER_ACTIVE_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "An active hosted member is required to own a thread container.",
      retryable: false,
    });
  }
  const ownerThreadContainer = await input.prisma.hostedThreadContainer.findUnique({
    select: {
      memberId: true,
    },
    where: {
      memberId: input.ownerMemberId,
    },
  });

  if (ownerThreadContainer) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_CONTAINER_OWNER_MUST_NOT_BE_CONTAINER",
      httpStatus: 403,
      message: "Thread-container members cannot own thread containers.",
      retryable: false,
    });
  }

  const threadLookupKey = createHostedExternalThreadLookupKey({
    accountLookupKey: input.accountLookupKey,
    channel: input.channel,
    threadId: input.threadId,
  });
  if (!threadLookupKey) {
    throw new TypeError(
      "Hosted thread route requires an account lookup key, supported channel, and non-empty thread id.",
    );
  }
  const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
    channel: input.channel,
    threadId: input.threadId,
  });
  if (!threadIdentityLookupKey) {
    throw new TypeError(
      "Hosted thread route requires a supported channel and non-empty thread id.",
    );
  }
  await acquireHostedThreadContainerRouteWriteLockTx({
    channel: input.channel,
    prisma: input.prisma,
    threadId: input.threadId,
  });

  const requestedContainerMemberId =
    normalizeHostedThreadContainerMemberId(input.containerMemberId);
  const accountLookupKeys = normalizeHostedThreadAccountLookupKeys([
    ...(input.accountLookupKeys ?? []),
    input.accountLookupKey,
  ]);
  const threadLookupKeys = normalizeHostedThreadLookupKeys([
    threadLookupKey,
    ...accountLookupKeys.flatMap((accountLookupKey) =>
      createHostedExternalThreadLookupKeyReadCandidates({
        accountLookupKey,
        channel: input.channel,
        threadId: input.threadId,
      })
    ),
  ]);
  const threadIdentityLookupKeys = normalizeHostedThreadLookupKeys([
    threadIdentityLookupKey,
    ...createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: input.channel,
      threadId: input.threadId,
    }),
  ]);
  const existingRows = await input.prisma.hostedThreadRoute.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      container: {
        select: {
          ownerMemberId: true,
        },
      },
      containerMemberId: true,
      threadIdentityLookupKey: true,
      threadLookupKey: true,
    },
    where: {
      channel: input.channel,
      threadIdentityLookupKey: {
        in: threadIdentityLookupKeys,
      },
    },
  });

  if (existingRows.length > 0) {
    const distinctContainerIds = new Set(existingRows.map((row) => row.containerMemberId));
    const authorityMatched = existingRows.some((row) =>
      threadLookupKeys.includes(row.threadLookupKey)
    );
    const existing = existingRows[0]!;
    if (
      distinctContainerIds.size > 1
      ||
      !authorityMatched
      ||
      existing.container.ownerMemberId !== input.ownerMemberId
      || (
        requestedContainerMemberId !== null
        && existing.containerMemberId !== requestedContainerMemberId
      )
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_THREAD_ROUTE_ALREADY_BOUND",
        httpStatus: 409,
        message: "This external thread is already routed to another container.",
        retryable: false,
      });
    }

    const currentIdentityRow = existingRows.find((row) =>
      row.threadIdentityLookupKey === threadIdentityLookupKey
    ) ?? existing;
    if (
      currentIdentityRow.threadIdentityLookupKey !== threadIdentityLookupKey
      || currentIdentityRow.threadLookupKey !== threadLookupKey
    ) {
      await updateHostedThreadRouteAuthorityRowTx({
        channel: input.channel,
        prisma: input.prisma,
        previousThreadIdentityLookupKey: currentIdentityRow.threadIdentityLookupKey,
        threadIdentityLookupKey,
        threadLookupKey,
      });
    }

    return {
      activationEventId: null,
      activationMailboxItemId: null,
      containerMemberId: existing.containerMemberId,
      created: false,
    };
  }

  const containerMemberId = requestedContainerMemberId ?? generateHostedMemberId();
  const monthlyUsageLimitUsdMicros = normalizeHostedThreadContainerUsageLimit(
    input.monthlyUsageLimitUsdMicros,
  );

  await createHostedMember({
    billingStatus: HostedBillingStatus.active,
    memberId: containerMemberId,
    prisma: input.prisma,
  });

  await provisionHostedCryptoDomainRootsForUserTx({
    reason: "hosted-thread-container.ensure-route",
    tx: input.prisma,
    userId: containerMemberId,
  });

  await input.prisma.hostedThreadContainer.create({
    data: {
      memberId: containerMemberId,
      monthlyUsageLimitUsdMicros,
      ownerMemberId: input.ownerMemberId,
    },
  });

  await createHostedThreadRouteRowTx({
    channel: input.channel,
    containerMemberId,
    prisma: input.prisma,
    threadIdentityLookupKey,
    threadLookupKey,
  });

  const activationWake = buildHostedExecutionMemberActivatedWake({
    eventId: buildHostedThreadContainerActivationEventId({
      channel: input.channel,
      threadLookupKey,
    }),
    memberChannels: resolveHostedThreadContainerMemberChannels(input.channel),
    memberId: containerMemberId,
    occurredAt: input.occurredAt.toISOString(),
    signupWelcome: null,
  });
  const appended = await appendHostedMailboxEnvelopeTx({
    envelope: activationWake,
    tx: input.prisma,
  });

  return {
    activationEventId: appended.item.dedupeKey,
    activationMailboxItemId: appended.item.id,
    containerMemberId,
    created: true,
  };
}

async function createHostedThreadRouteRowTx(input: {
  channel: HostedThreadRouteChannel;
  containerMemberId: string;
  prisma: Prisma.TransactionClient;
  threadIdentityLookupKey: string;
  threadLookupKey: string;
}): Promise<void> {
  try {
    await input.prisma.hostedThreadRoute.create({
      data: {
        channel: input.channel,
        containerMemberId: input.containerMemberId,
        threadIdentityLookupKey: input.threadIdentityLookupKey,
        threadLookupKey: input.threadLookupKey,
      },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw hostedOnboardingError({
        code: "HOSTED_THREAD_ROUTE_WRITE_CONFLICT",
        httpStatus: 409,
        message: "This external thread route was created concurrently.",
        retryable: true,
      });
    }

    throw error;
  }
}

async function updateHostedThreadRouteAuthorityRowTx(input: {
  channel: HostedThreadRouteChannel;
  previousThreadIdentityLookupKey: string;
  prisma: Prisma.TransactionClient;
  threadIdentityLookupKey: string;
  threadLookupKey: string;
}): Promise<void> {
  try {
    await input.prisma.hostedThreadRoute.update({
      data: {
        threadIdentityLookupKey: input.threadIdentityLookupKey,
        threadLookupKey: input.threadLookupKey,
      },
      where: {
        channel_threadIdentityLookupKey: {
          channel: input.channel,
          threadIdentityLookupKey: input.previousThreadIdentityLookupKey,
        },
      },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw hostedOnboardingError({
        code: "HOSTED_THREAD_ROUTE_WRITE_CONFLICT",
        httpStatus: 409,
        message: "This external thread route was updated concurrently.",
        retryable: true,
      });
    }

    throw error;
  }
}

async function acquireHostedThreadContainerRouteWriteLockTx(input: {
  channel: HostedThreadRouteChannel;
  prisma: Prisma.TransactionClient;
  threadId: string | number;
}): Promise<void> {
  const threadId = normalizeHostedOpaqueInput(input.threadId);
  if (!threadId) {
    throw new TypeError("Hosted thread route lock requires a non-empty thread id.");
  }

  await input.prisma.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${"hosted-thread-container-route"}),
      hashtext(${`${input.channel}:${threadId}`})
    )
  `;
}

function resolveHostedThreadContainerMemberChannels(
  channel: HostedThreadRouteChannel,
): HostedExecutionMemberChannels {
  return {
    email: channel === "email",
    linq: channel === "linq",
    telegram: channel === "telegram",
  };
}

function buildHostedThreadContainerActivationEventId(input: {
  channel: HostedThreadRouteChannel;
  threadLookupKey: string;
}): string {
  return `member.activated:thread-container:${input.channel}:${input.threadLookupKey}`;
}

function normalizeHostedThreadContainerMemberId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeHostedThreadContainerUsageLimit(value: bigint | null | undefined): bigint {
  const limit = value ?? HOSTED_THREAD_CONTAINER_DEFAULT_MONTHLY_USAGE_LIMIT_USD_MICROS;
  if (limit <= 0n) {
    throw new TypeError("Hosted thread container monthly usage limit must be positive.");
  }
  return limit;
}

function normalizeHostedThreadAccountLookupKeys(
  values: readonly (string | null | undefined)[],
): string[] {
  const normalized = values
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0);

  return [...new Set(normalized)];
}

function normalizeHostedThreadLookupKeys(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

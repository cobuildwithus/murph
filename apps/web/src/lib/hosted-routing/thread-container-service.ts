import "server-only";

import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
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
  createHostedExternalThreadLookupKey,
} from "../hosted-onboarding/contact-privacy";
import {
  hasHostedMemberActiveAccess,
} from "../hosted-onboarding/entitlement";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
import {
  createHostedMember,
  readHostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import {
  signalHostedMemberActivationRuntimeWakeBestEffortResult,
} from "../hosted-onboarding/member-activation-runtime-wake";
import {
  generateHostedMemberId,
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "../hosted-onboarding/shared";
import {
  getPrisma,
} from "../prisma";
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

export async function ensureHostedThreadContainerRoute(input: {
  accountLookupKey: string | null | undefined;
  channel: HostedThreadRouteChannel;
  containerMemberId?: string | null;
  monthlyUsageLimitUsdMicros?: bigint | null;
  occurredAt?: Date;
  ownerMemberId: string;
  prisma?: PrismaClient;
  threadId: string | number;
}): Promise<HostedThreadContainerRouteEnsureResult> {
  const prisma = input.prisma ?? getPrisma();
  const result = await ensureHostedThreadContainerRouteWithRetry({
    ...input,
    occurredAt: input.occurredAt ?? new Date(),
    prisma,
    retryRouteConflict: true,
  });

  if (result.created && result.activationEventId && result.activationMailboxItemId) {
    await signalHostedMemberActivationRuntimeWakeBestEffortResult({
      hostedExecutionEventId: result.activationEventId,
      mailboxItemId: result.activationMailboxItemId,
      memberId: result.containerMemberId,
      prisma,
      source: "hosted-thread-container.ensure-route",
    });
  }

  return result;
}

export async function ensureHostedThreadContainerRouteTx(input: {
  accountLookupKey: string | null | undefined;
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

  const requestedContainerMemberId =
    normalizeHostedThreadContainerMemberId(input.containerMemberId);
  const existing = await input.prisma.hostedThreadRoute.findUnique({
    select: {
      container: {
        select: {
          ownerMemberId: true,
        },
      },
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
    if (
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

  try {
    await input.prisma.hostedThreadRoute.create({
      data: {
        channel: input.channel,
        containerMemberId,
        threadLookupKey,
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

async function ensureHostedThreadContainerRouteWithRetry(input: {
  accountLookupKey: string | null | undefined;
  channel: HostedThreadRouteChannel;
  containerMemberId?: string | null;
  monthlyUsageLimitUsdMicros?: bigint | null;
  occurredAt: Date;
  ownerMemberId: string;
  prisma: PrismaClient;
  retryRouteConflict: boolean;
  threadId: string | number;
}): Promise<HostedThreadContainerRouteEnsureResult> {
  try {
    return await input.prisma.$transaction(async (tx) =>
      ensureHostedThreadContainerRouteTx({
        accountLookupKey: input.accountLookupKey,
        channel: input.channel,
        containerMemberId: input.containerMemberId,
        monthlyUsageLimitUsdMicros: input.monthlyUsageLimitUsdMicros,
        occurredAt: input.occurredAt,
        ownerMemberId: input.ownerMemberId,
        prisma: tx,
        threadId: input.threadId,
      }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  } catch (error) {
    if (
      input.retryRouteConflict
      && isHostedOnboardingError(error)
      && error.code === "HOSTED_THREAD_ROUTE_WRITE_CONFLICT"
    ) {
      return ensureHostedThreadContainerRouteWithRetry({
        ...input,
        retryRouteConflict: false,
      });
    }

    throw error;
  }
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

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

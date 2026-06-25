import "server-only";

import {
  createHash,
} from "node:crypto";
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
  createHostedExternalThreadLookupKey,
} from "../hosted-onboarding/contact-privacy";
import {
  provisionHostedCryptoDomainRootsForUserTx,
} from "../hosted-crypto/domain-root-store";
import {
  appendHostedMailboxEnvelopeTx,
} from "../hosted-mailbox/store";
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
  signalHostedMemberActivationRuntimeWakeBestEffortResult,
} from "../hosted-onboarding/member-activation-runtime-wake";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "../hosted-onboarding/shared";
import {
  getPrisma,
} from "../prisma";
import {
  createHostedThreadContainerTx,
  ensureHostedThreadRouteTx,
  type HostedThreadRouteChannel,
} from "./thread-route-store";

export interface HostedThreadContainerRuntimeCreationResult {
  activationEventId: string | null;
  activationMailboxItemId: string | null;
  containerMemberId: string;
  created: boolean;
}

export async function createHostedThreadContainerRuntime(input: {
  channel: HostedThreadRouteChannel;
  createdByMemberId: string;
  memberId?: string | null;
  monthlyUsageLimitUsdMicros?: bigint | null;
  occurredAt?: Date;
  prisma?: PrismaClient;
  sourceEventId: string;
  threadId: string | number;
}): Promise<HostedThreadContainerRuntimeCreationResult> {
  const prisma = input.prisma ?? getPrisma();
  const result = await prisma.$transaction(
    async (tx) =>
      createHostedThreadContainerRuntimeTx({
        channel: input.channel,
        createdByMemberId: input.createdByMemberId,
        memberId: input.memberId,
        monthlyUsageLimitUsdMicros: input.monthlyUsageLimitUsdMicros ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        prisma: tx,
        sourceEventId: input.sourceEventId,
        threadId: input.threadId,
      }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );

  if (result.created && result.activationEventId && result.activationMailboxItemId) {
    await signalHostedMemberActivationRuntimeWakeBestEffortResult({
      hostedExecutionEventId: result.activationEventId,
      mailboxItemId: result.activationMailboxItemId,
      memberId: result.containerMemberId,
      prisma,
      source: "hosted-thread-container.create",
    });
  }

  return result;
}

export async function createHostedThreadContainerRuntimeTx(input: {
  channel: HostedThreadRouteChannel;
  createdByMemberId: string;
  memberId?: string | null;
  monthlyUsageLimitUsdMicros?: bigint | null;
  occurredAt: Date;
  prisma: Prisma.TransactionClient;
  sourceEventId: string;
  threadId: string | number;
}): Promise<HostedThreadContainerRuntimeCreationResult> {
  const creator = await readHostedMemberCoreState({
    memberId: input.createdByMemberId,
    prisma: input.prisma,
  });

  if (!creator || !hasHostedMemberActiveAccess(creator)) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_CONTAINER_SPONSOR_ACTIVE_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "An active hosted member is required to create a thread container.",
    });
  }

  const threadLookupKey = createHostedExternalThreadLookupKey({
    channel: input.channel,
    threadId: input.threadId,
  });
  if (!threadLookupKey) {
    throw new TypeError(
      "Hosted thread container route requires a supported channel and non-empty thread id.",
    );
  }

  const existingRoute = await input.prisma.hostedThreadRoute.findUnique({
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

  if (existingRoute) {
    if (existingRoute.container.ownerMemberId !== input.createdByMemberId) {
      throw hostedOnboardingError({
        code: "HOSTED_THREAD_ROUTE_ALREADY_BOUND",
        httpStatus: 409,
        message: "This external thread is already routed to another container.",
      });
    }

    return {
      activationEventId: null,
      activationMailboxItemId: null,
      containerMemberId: existingRoute.containerMemberId,
      created: false,
    };
  }

  const containerMemberId = normalizeHostedThreadContainerMemberId(input.memberId)
    ?? buildHostedThreadContainerMemberId({
      channel: input.channel,
      ownerMemberId: input.createdByMemberId,
      threadLookupKey,
    });

  await createHostedMember({
    billingStatus: HostedBillingStatus.active,
    memberId: containerMemberId,
    prisma: input.prisma,
  });

  await provisionHostedCryptoDomainRootsForUserTx({
    reason: "hosted-thread-container.create",
    tx: input.prisma,
    userId: containerMemberId,
  });

  await createHostedThreadContainerTx({
    memberId: containerMemberId,
    monthlyUsageLimitUsdMicros: input.monthlyUsageLimitUsdMicros ?? null,
    ownerMemberId: input.createdByMemberId,
    prisma: input.prisma,
  });

  await ensureHostedThreadRouteTx({
    channel: input.channel,
    containerMemberId,
    prisma: input.prisma,
    threadId: input.threadId,
  });

  const activationWake = buildHostedExecutionMemberActivatedWake({
    eventId: buildHostedThreadContainerActivationEventId({
      channel: input.channel,
      sourceEventId: input.sourceEventId,
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
  sourceEventId: string;
  threadLookupKey: string;
}): string {
  return `member.activated:thread-container:${input.channel}:${input.threadLookupKey}:${input.sourceEventId}`;
}

function buildHostedThreadContainerMemberId(input: {
  channel: HostedThreadRouteChannel;
  ownerMemberId: string;
  threadLookupKey: string;
}): string {
  const digest = createHash("sha256")
    .update("hosted-thread-container:v1")
    .update("\0")
    .update(input.ownerMemberId)
    .update("\0")
    .update(input.channel)
    .update("\0")
    .update(input.threadLookupKey)
    .digest("base64url")
    .slice(0, 32);

  return `hbtc_${digest}`;
}

function normalizeHostedThreadContainerMemberId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

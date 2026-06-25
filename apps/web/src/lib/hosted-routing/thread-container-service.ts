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
  generateHostedMemberId,
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
  activationEventId: string;
  activationMailboxItemId: string;
  containerMemberId: string;
}

export async function createHostedThreadContainerRuntime(input: {
  channel: HostedThreadRouteChannel;
  createdByMemberId: string;
  memberId?: string | null;
  monthlyUsageLimitUsdMicros?: bigint | null;
  occurredAt?: Date;
  prisma?: PrismaClient;
  sourceEventId: string;
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
      }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );

  await signalHostedMemberActivationRuntimeWakeBestEffortResult({
    hostedExecutionEventId: result.activationEventId,
    mailboxItemId: result.activationMailboxItemId,
    memberId: result.containerMemberId,
    prisma,
    source: "hosted-thread-container.create",
  });

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

  const containerMemberId = normalizeHostedThreadContainerMemberId(input.memberId)
    ?? generateHostedMemberId();

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
    prisma: input.prisma,
  });

  const activationWake = buildHostedExecutionMemberActivatedWake({
    eventId: buildHostedThreadContainerActivationEventId({
      memberId: containerMemberId,
      sourceEventId: input.sourceEventId,
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
  };
}

export async function createHostedThreadContainerRouteTx(input: {
  channel: HostedThreadRouteChannel;
  containerMemberId: string;
  prisma: Prisma.TransactionClient;
  source: string;
  threadId: string | number;
}): Promise<void> {
  await ensureHostedThreadRouteTx(input);
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
  memberId: string;
  sourceEventId: string;
}): string {
  return `member.activated:thread-container:${input.memberId}:${input.sourceEventId}`;
}

function normalizeHostedThreadContainerMemberId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

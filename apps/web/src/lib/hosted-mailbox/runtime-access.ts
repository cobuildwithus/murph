import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";

import {
  hasHostedMemberEffectiveActiveAccessForMember,
} from "../hosted-onboarding/family-plan";
import {
  hasHostedMemberActiveAccess,
} from "../hosted-onboarding/entitlement";
import {
  hostedOnboardingError,
} from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";

type HostedRuntimeActiveAccessClient = PrismaClient | Prisma.TransactionClient;

interface HostedRuntimeActiveAccessOptions {
  code?: string;
  message?: string;
  prisma?: HostedRuntimeActiveAccessClient;
}

// Shared fail-closed gate for runtime surfaces: only members with active hosted
// access and, for thread containers, active owner authority may wake or touch
// runtime state.
export async function requireHostedRuntimeActiveAccess(
  userId: string,
  options: HostedRuntimeActiveAccessOptions = {},
): Promise<void> {
  const prisma = options.prisma ?? getPrisma();
  const member = await prisma.hostedMember.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      billingStatus: true,
      suspendedAt: true,
      threadContainer: {
        select: {
          owner: {
            select: {
              billingStatus: true,
              suspendedAt: true,
            },
          },
        },
      },
    },
  });

  if (
    member
    && await hasHostedMemberEffectiveActiveAccessForMember({
      member,
      prisma,
    })
    && (
      !member.threadContainer
      || hasHostedMemberActiveAccess(member.threadContainer.owner)
    )
  ) {
    return;
  }

  throw hostedOnboardingError({
    code: options.code ?? "HOSTED_RUNTIME_MAILBOX_USER_INACTIVE",
    httpStatus: 403,
    message: options.message ?? "Hosted runtime mailbox access is not active.",
  });
}

export async function requireHostedRuntimeActiveAccessForUpdateTx(
  userId: string,
  options: Omit<HostedRuntimeActiveAccessOptions, "prisma"> & {
    prisma: Prisma.TransactionClient;
  },
): Promise<void> {
  await options.prisma.$queryRaw`
    SELECT id
    FROM hosted_member
    WHERE id = ${userId}
    FOR UPDATE
  `;
  const containers = await options.prisma.$queryRaw<Array<{ ownerMemberId: string }>>`
    SELECT owner_member_id AS "ownerMemberId"
    FROM hosted_thread_container
    WHERE member_id = ${userId}
    FOR UPDATE
  `;
  const ownerMemberId = containers[0]?.ownerMemberId;
  if (ownerMemberId) {
    await options.prisma.$queryRaw`
      SELECT id
      FROM hosted_member
      WHERE id = ${ownerMemberId}
      FOR UPDATE
    `;
  }

  await requireHostedRuntimeActiveAccess(userId, options);
}

export async function hasHostedRuntimeActiveAccessForUpdateTx(
  userId: string,
  options: Omit<HostedRuntimeActiveAccessOptions, "prisma"> & {
    prisma: Prisma.TransactionClient;
  },
): Promise<boolean> {
  try {
    await requireHostedRuntimeActiveAccessForUpdateTx(userId, options);
    return true;
  } catch {
    return false;
  }
}

export async function requireHostedRuntimeMailboxActiveAccess(
  userId: string,
  options: HostedRuntimeActiveAccessOptions = {},
): Promise<void> {
  await requireHostedRuntimeActiveAccess(userId, options);
}

export async function hasHostedRuntimeActiveAccess(
  userId: string,
  options: HostedRuntimeActiveAccessOptions = {},
): Promise<boolean> {
  try {
    await requireHostedRuntimeActiveAccess(userId, options);
    return true;
  } catch {
    return false;
  }
}

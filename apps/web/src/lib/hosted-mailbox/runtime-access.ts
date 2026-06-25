import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";

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
    && hasHostedMemberActiveAccess(member)
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

export async function requireHostedRuntimeMailboxActiveAccess(
  userId: string,
  options: HostedRuntimeActiveAccessOptions = {},
): Promise<void> {
  await requireHostedRuntimeActiveAccess(userId, options);
}

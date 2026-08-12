import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";

type HostedRuntimeActiveAccessClient = PrismaClient | Prisma.TransactionClient;

interface HostedRuntimeActiveAccessOptions {
  code?: string;
  message?: string;
  prisma?: HostedRuntimeActiveAccessClient;
}

// Shared fail-closed gate for runtime surfaces: only members with active hosted
// access and, for thread containers, active owner or participant authority may
// wake or touch runtime state.
export async function requireHostedRuntimeActiveAccess(
  userId: string,
  options: HostedRuntimeActiveAccessOptions = {},
): Promise<void> {
  const prisma = options.prisma ?? getPrisma();
  if (await readActiveHostedMemberAccess({
    memberId: userId,
    prisma,
  })) {
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
  await requireHostedRuntimeMembersActiveAccessForUpdateTx([userId], options);
}

/**
 * Locks every requested runtime and discovered owner in one global member-id order before
 * role-specific access revalidation. A role-partitioned owner-first order can invert when
 * reciprocal requests target group runtimes owned by one another's grantors. One total
 * order avoids that cycle before sorted container-row locking.
 */
export async function requireHostedRuntimeMembersActiveAccessForUpdateTx(
  userIds: readonly string[],
  options: Omit<HostedRuntimeActiveAccessOptions, "prisma"> & {
    prisma: Prisma.TransactionClient;
  },
): Promise<void> {
  const sortedUserIds = [...new Set(userIds)].sort();
  const ownerMemberIdsByUserId = new Map<string, string | null>();

  for (const userId of sortedUserIds) {
    ownerMemberIdsByUserId.set(
      userId,
      await readHostedThreadContainerOwnerMemberIdTx({
        prisma: options.prisma,
        userId,
      }),
    );
  }

  const sortedMemberIds = [...new Set([
    ...sortedUserIds,
    ...[...ownerMemberIdsByUserId.values()].filter(
      (memberId): memberId is string => memberId !== null,
    ),
  ])].sort();
  for (const memberId of sortedMemberIds) {
    await lockHostedRuntimeMemberForUpdateTx({
      memberId,
      prisma: options.prisma,
    });
  }

  for (const userId of sortedUserIds) {
    const lockedOwnerMemberId = await lockHostedThreadContainerOwnerMemberIdTx({
      prisma: options.prisma,
      userId,
    });
    if (lockedOwnerMemberId !== ownerMemberIdsByUserId.get(userId)) {
      throw hostedOnboardingError({
        code: "HOSTED_RUNTIME_ACCESS_AUTHORITY_CHANGED",
        httpStatus: 409,
        message: "Hosted runtime access changed while validating authority. Retry the request.",
        retryable: true,
      });
    }
  }

  for (const userId of sortedUserIds) {
    await requireHostedRuntimeActiveAccess(userId, options);
  }
}

async function lockHostedRuntimeMemberForUpdateTx(input: {
  prisma: Prisma.TransactionClient;
  memberId: string;
}): Promise<void> {
  await input.prisma.$queryRaw`
    SELECT id
    FROM hosted_member
    WHERE id = ${input.memberId}
    FOR UPDATE
  `;
}

async function readHostedThreadContainerOwnerMemberIdTx(input: {
  prisma: Prisma.TransactionClient;
  userId: string;
}): Promise<string | null> {
  const containers = await input.prisma.$queryRaw<Array<{ ownerMemberId: string }>>`
    SELECT owner_member_id AS "ownerMemberId"
    FROM hosted_thread_container
    WHERE member_id = ${input.userId}
  `;

  return containers[0]?.ownerMemberId ?? null;
}

async function lockHostedThreadContainerOwnerMemberIdTx(input: {
  prisma: Prisma.TransactionClient;
  userId: string;
}): Promise<string | null> {
  const containers = await input.prisma.$queryRaw<Array<{ ownerMemberId: string }>>`
    SELECT owner_member_id AS "ownerMemberId"
    FROM hosted_thread_container
    WHERE member_id = ${input.userId}
    FOR UPDATE
  `;

  return containers[0]?.ownerMemberId ?? null;
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

export function isHostedRuntimeInactiveAccessError(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && error.code === "HOSTED_RUNTIME_MAILBOX_USER_INACTIVE"
    && !error.retryable;
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

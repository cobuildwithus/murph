import "server-only";

import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  assertHostedMemberNotSuspended,
  describeHostedMemberActiveAccessRequirement,
  hasHostedMemberOwnActiveBilling,
  isHostedMemberSuspended,
} from "./entitlement";
import { hostedOnboardingError } from "./errors";
import type { HostedOnboardingReadClient } from "./shared";

/**
 * The one place hosted access is derived.
 *
 * `hosted_member.billing_status` records the member's OWN Stripe relationship
 * and nothing else. Access can additionally be sponsored through the edges
 * that already exist in the data model:
 *
 * - an active membership in an active, unsuspended account group (family), or
 * - for synthetic thread-container members, the container owner's access, or
 *   an active current participant through the async thread-container resolver.
 *
 * Owners cannot themselves be containers, so the derivation depth is at most
 * two and a single query loads everything `hasActiveHostedMemberAccess` needs.
 * Every runtime, webhook, page, and egress gate must use this module; the
 * own-billing predicates in `entitlement.ts` are for billing surfaces that
 * genuinely mean "this member's own subscription".
 */

const hostedSponsorAccessMembershipSelect =
  Prisma.validator<Prisma.HostedAccountGroupMembershipSelect>()({
    group: {
      select: {
        billingStatus: true,
        suspendedAt: true,
      },
    },
    status: true,
  });

export const hostedMemberPersonAccessSelect = Prisma.validator<Prisma.HostedMemberSelect>()({
  accountGroupMemberships: {
    select: hostedSponsorAccessMembershipSelect,
    where: {
      status: "active",
    },
  },
  billingStatus: true,
  suspendedAt: true,
});

export const hostedMemberAccessSelect = Prisma.validator<Prisma.HostedMemberSelect>()({
  ...hostedMemberPersonAccessSelect,
  threadContainer: {
    select: {
      owner: {
        select: hostedMemberPersonAccessSelect,
      },
    },
  },
});

export type HostedMemberPersonAccessState = Prisma.HostedMemberGetPayload<{
  select: typeof hostedMemberPersonAccessSelect;
}>;

export type HostedMemberAccessState = HostedMemberPersonAccessState & {
  threadContainer?: {
    owner: HostedMemberPersonAccessState;
  } | null;
};

function hasActiveHostedPersonAccess(person: HostedMemberPersonAccessState): boolean {
  if (isHostedMemberSuspended(person.suspendedAt)) {
    return false;
  }

  if (hasHostedMemberOwnActiveBilling(person)) {
    return true;
  }

  return person.accountGroupMemberships.some((membership) =>
    membership.status === "active"
    && membership.group.billingStatus === HostedBillingStatus.active
    && !isHostedMemberSuspended(membership.group.suspendedAt)
  );
}

export function hasActiveHostedMemberAccess(member: HostedMemberAccessState): boolean {
  if (isHostedMemberSuspended(member.suspendedAt)) {
    return false;
  }

  // A thread-container member is synthetic: its own billing status is not an
  // access source. Participant-aware container gates use the async resolver
  // below; this pure member resolver stays owner-only for legacy callers.
  if (member.threadContainer) {
    return hasActiveHostedPersonAccess(member.threadContainer.owner);
  }

  return hasActiveHostedPersonAccess(member);
}

export function hasActiveHostedThreadContainerAccess(input: {
  container: Pick<HostedMemberPersonAccessState, "suspendedAt">;
  owner: HostedMemberPersonAccessState;
}): boolean {
  return !isHostedMemberSuspended(input.container.suspendedAt)
    && hasActiveHostedPersonAccess(input.owner);
}

export async function hasActiveHostedThreadContainerAccessWithParticipants(input: {
  container: Pick<HostedMemberPersonAccessState, "suspendedAt">;
  containerMemberId: string;
  owner: HostedMemberPersonAccessState;
  prisma?: HostedOnboardingReadClient;
}): Promise<boolean> {
  if (hasActiveHostedThreadContainerAccess({
    container: input.container,
    owner: input.owner,
  })) {
    return true;
  }

  if (isHostedMemberSuspended(input.container.suspendedAt)) {
    return false;
  }

  return await hasAnyActiveHostedThreadContainerParticipant({
    containerMemberId: input.containerMemberId,
    prisma: input.prisma,
  });
}

/**
 * Set-based projection of `hasActiveHostedMemberAccess` for queries that must
 * select access-holding members in the database (pagination, counts, sweeps).
 * Keep it semantically identical to the pure derivation above; the raw-SQL
 * due-reconcile sweep in device-sync mirrors the person branch of this shape.
 */
export function activeHostedMemberAccessWhere(): Prisma.HostedMemberWhereInput {
  const personAccess: Prisma.HostedMemberWhereInput["OR"] = [
    { billingStatus: HostedBillingStatus.active },
    {
      accountGroupMemberships: {
        some: {
          group: {
            billingStatus: HostedBillingStatus.active,
            suspendedAt: null,
          },
          status: "active",
        },
      },
    },
  ];

  return {
    OR: [
      {
        OR: personAccess,
        threadContainer: null,
      },
      {
        threadContainer: {
          is: {
            owner: {
              OR: personAccess,
              suspendedAt: null,
            },
          },
        },
      },
    ],
    suspendedAt: null,
  };
}

export async function readActiveHostedMemberAccess(input: {
  memberId: string;
  prisma?: HostedOnboardingReadClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const member = await prisma.hostedMember.findUnique({
    select: hostedMemberAccessSelect,
    where: {
      id: input.memberId,
    },
  });

  return member !== null && hasActiveHostedMemberAccess(member);
}

export async function hasAnyActiveHostedThreadContainerParticipant(input: {
  containerMemberId: string;
  prisma?: HostedOnboardingReadClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const participant = await prisma.hostedThreadContainerParticipant.findFirst({
    select: {
      participantMemberId: true,
    },
    where: {
      containerMemberId: input.containerMemberId,
      participant: activeHostedMemberAccessWhere(),
      removedAt: null,
    },
  });

  return participant !== null;
}

export async function assertActiveHostedMemberAccessAllowed(input: {
  memberId: string;
  prisma?: HostedOnboardingReadClient;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();
  const member = await prisma.hostedMember.findUnique({
    select: hostedMemberAccessSelect,
    where: {
      id: input.memberId,
    },
  });

  if (member) {
    assertHostedMemberNotSuspended(member);
    if (hasActiveHostedMemberAccess(member)) {
      return;
    }
  }

  throw hostedOnboardingError({
    code: "HOSTED_ACCESS_REQUIRED",
    httpStatus: 403,
    message: describeHostedMemberActiveAccessRequirement(
      member?.billingStatus ?? HostedBillingStatus.not_started,
    ),
  });
}

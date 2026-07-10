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
import {
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "./shared";

/**
 * The one place hosted access is derived.
 *
 * `hosted_member.billing_status` records the member's OWN Stripe relationship
 * and nothing else. Access can additionally be sponsored through the edges
 * that already exist in the data model:
 *
 * - an active membership in an active, unsuspended account group (family), or
 * - for synthetic thread-container members, the container owner's access, or
 *   an active current participant through `readActiveHostedMemberAccess`.
 *
 * Owners cannot themselves be containers, so the derivation depth is at most
 * two and a single query loads everything the owner branch needs.
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

  return person.accountGroupMemberships.some(hasActiveHostedSponsorAccess);
}

function hasActiveHostedSponsorAccess(input: {
  group: {
    billingStatus: HostedBillingStatus;
    suspendedAt: Date | null;
  };
  status: string;
}): boolean {
  return input.status === "active"
    && input.group.billingStatus === HostedBillingStatus.active
    && !isHostedMemberSuspended(input.group.suspendedAt);
}

export function hasActiveHostedMemberAccess(member: HostedMemberAccessState): boolean {
  if (isHostedMemberSuspended(member.suspendedAt)) {
    return false;
  }

  // A thread-container member is synthetic: its own billing status is not an
  // access source. Async gates must use `readActiveHostedMemberAccess`, which
  // adds participant-aware access after this owner-only pure shortcut.
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
 * Set-based projection of the pure access branch for queries that must select
 * access-holding members in the database (pagination, counts, sweeps). It
 * intentionally cannot recurse into thread-container participant rosters; use
 * `readActiveHostedMemberAccess` for user-visible async gates.
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

/**
 * Set-based projection for atomic gates that must be expressed in one SQL
 * mutation. Unlike `activeHostedMemberAccessWhere`, this includes the
 * participant-backed thread-container branch used by `readActiveHostedMemberAccess`.
 */
export function activeHostedMemberAccessWithParticipantsWhere(): Prisma.HostedMemberWhereInput {
  return {
    OR: [
      activeHostedMemberAccessWhere(),
      {
        suspendedAt: null,
        threadContainer: {
          is: {
            participants: {
              some: {
                participant: activeHostedMemberAccessWhere(),
                removedAt: null,
              },
            },
          },
        },
      },
    ],
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

  if (!member) {
    return false;
  }

  if (member.threadContainer) {
    return await hasActiveHostedThreadContainerAccessWithParticipants({
      container: member,
      containerMemberId: input.memberId,
      owner: member.threadContainer.owner,
      prisma,
    });
  }

  return hasActiveHostedMemberAccess(member);
}

export async function hasAnyActiveHostedThreadContainerParticipant(input: {
  containerMemberId: string;
  prisma?: HostedOnboardingReadClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  // Participant rows are a provider-roster projection. A departed member can
  // remain active until the next successful complete roster reconcile; that
  // stale-open window is accepted because false removal would drop live groups.
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

  throwHostedMemberAccessRequired(member?.billingStatus);
}

/**
 * Transactional access gate for concrete hosted people.
 *
 * Lock the person first, then at most one qualifying sponsorship edge and its
 * account group. Concurrent sponsorship removal or billing changes must wait
 * for those locks, while historical removed edges stay off this user path.
 */
export async function assertActiveHostedPersonAccessAllowedTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await lockHostedMemberRow(input.tx, input.memberId);
  const member = await input.tx.hostedMember.findUnique({
    select: {
      billingStatus: true,
      suspendedAt: true,
      threadContainer: { select: { memberId: true } },
    },
    where: { id: input.memberId },
  });
  if (!member || member.threadContainer) {
    throwHostedMemberAccessRequired();
  }
  assertHostedMemberNotSuspended(member);
  if (hasHostedMemberOwnActiveBilling(member)) {
    return;
  }

  const sponsorships = await input.tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT membership."id"
    FROM "hosted_account_group_membership" AS membership
    INNER JOIN "hosted_account_group" AS account_group
      ON account_group."id" = membership."group_id"
    WHERE membership."member_id" = ${input.memberId}
      AND membership."status" = 'active'
      AND account_group."billing_status" = 'active'
      AND account_group."suspended_at" IS NULL
    ORDER BY membership."id", account_group."id"
    LIMIT 1
    FOR UPDATE OF membership, account_group
  `);
  if (sponsorships.length > 0) {
    return;
  }

  throwHostedMemberAccessRequired(member.billingStatus);
}

function throwHostedMemberAccessRequired(
  billingStatus: HostedBillingStatus = HostedBillingStatus.not_started,
): never {
  throw hostedOnboardingError({
    code: "HOSTED_ACCESS_REQUIRED",
    httpStatus: 403,
    message: describeHostedMemberActiveAccessRequirement(billingStatus),
  });
}

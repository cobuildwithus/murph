import "server-only";

import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { renderUserFacingMessage } from "../hosted-messages/user-facing-messages";
import {
  HOSTED_PULSE_TRIAL_OFFER,
  parseHostedBillingCheckoutOffer,
  parseHostedBillingPhase,
  parseHostedBillingPlanCode,
  requireHostedPulseTrialPolicy,
} from "./billing-plans";
import {
  assertHostedMemberNotSuspended,
  describeHostedMemberActiveAccessRequirement,
  hasHostedMemberOwnActiveBilling,
  isHostedMemberSuspended,
} from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  lockHostedAccountGroupRow,
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

const hostedRuntimeAiAccessBillingRefSelect =
  Prisma.validator<Prisma.HostedMemberBillingRefSelect>()({
    currentBillingPhase: true,
    currentBillingPlanCode: true,
    currentCheckoutOffer: true,
    currentTrialEndsAt: true,
    currentTrialStartedAt: true,
    pulseTrialPolicyVersion: true,
    pulseTrialRedeemedAt: true,
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

const hostedRuntimeAiMemberAccessSelect = Prisma.validator<Prisma.HostedMemberSelect>()({
  ...hostedMemberPersonAccessSelect,
  billingRef: {
    select: hostedRuntimeAiAccessBillingRefSelect,
  },
  threadContainer: {
    select: {
      owner: {
        select: {
          ...hostedMemberPersonAccessSelect,
          billingRef: {
            select: hostedRuntimeAiAccessBillingRefSelect,
          },
        },
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

type HostedRuntimeAiPersonAccessState = Prisma.HostedMemberGetPayload<{
  select: {
    accountGroupMemberships: {
      select: typeof hostedSponsorAccessMembershipSelect;
      where: { status: "active" };
    };
    billingRef: { select: typeof hostedRuntimeAiAccessBillingRefSelect };
    billingStatus: true;
    suspendedAt: true;
  };
}>;

export type HostedRuntimeAiAccessDecision =
  | { allowed: true }
  | {
    allowed: false;
    reason: "hosted_access_inactive" | "trial_expired_pending_billing";
    retryAfter: Date;
    userNotice: {
      code: "trial_conversion_pending";
      message: string;
    } | null;
  };

const HOSTED_RUNTIME_AI_ACCESS_RETRY_MS = 15 * 60_000;
const HOSTED_AI_USAGE_HOME_URL = "https://withmurph.ai/home";

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

/**
 * Runtime model-work admission owned by hosted access, not usage accounting.
 * Monthly and in-window trial allowances are advisory; only inactive access
 * and invalid or expired trial entitlement deny model-capable work.
 */
export async function readHostedRuntimeAiAccessDecision(input: {
  memberId: string;
  now?: Date;
  prisma?: HostedOnboardingReadClient;
}): Promise<HostedRuntimeAiAccessDecision> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const member = await prisma.hostedMember.findUnique({
    select: hostedRuntimeAiMemberAccessSelect,
    where: {
      id: input.memberId,
    },
  });

  if (!member || isHostedMemberSuspended(member.suspendedAt)) {
    return buildHostedRuntimeInactiveAccessDecision(now);
  }

  if (member.threadContainer) {
    const ownerDecision = resolveHostedRuntimeAiPersonAccessDecision({
      memberId: input.memberId,
      now,
      person: member.threadContainer.owner,
    });
    if (ownerDecision.allowed) {
      return ownerDecision;
    }

    return await hasAnyHostedRuntimeAiAccessThreadContainerParticipant({
      containerMemberId: input.memberId,
      now,
      prisma,
    })
      ? { allowed: true }
      : buildHostedRuntimeInactiveAccessDecision(now);
  }

  return resolveHostedRuntimeAiPersonAccessDecision({
    memberId: input.memberId,
    now,
    person: member,
  });
}

function resolveHostedRuntimeAiPersonAccessDecision(input: {
  memberId: string;
  now: Date;
  person: HostedRuntimeAiPersonAccessState;
}): HostedRuntimeAiAccessDecision {
  if (isHostedMemberSuspended(input.person.suspendedAt)) {
    return buildHostedRuntimeInactiveAccessDecision(input.now);
  }

  const sponsored = input.person.accountGroupMemberships.some((membership) =>
    membership.status === "active"
    && membership.group.billingStatus === HostedBillingStatus.active
    && !isHostedMemberSuspended(membership.group.suspendedAt)
  );
  if (sponsored) {
    return { allowed: true };
  }
  if (!hasHostedMemberOwnActiveBilling(input.person)) {
    return buildHostedRuntimeInactiveAccessDecision(input.now);
  }

  const billingRef = input.person.billingRef;
  const billingPhase = parseHostedBillingPhase(billingRef?.currentBillingPhase);
  if (billingPhase === "paid") {
    return { allowed: true };
  }

  const checkoutOffer = parseHostedBillingCheckoutOffer(
    billingRef?.currentCheckoutOffer,
  );
  const trialShaped = billingPhase === "trial"
    || checkoutOffer === HOSTED_PULSE_TRIAL_OFFER
    || Boolean(billingRef?.pulseTrialRedeemedAt);
  if (!trialShaped) {
    // Legacy active paid members may predate phase and trial fields.
    return { allowed: true };
  }

  const trialPolicy = requireHostedPulseTrialPolicy(
    billingRef?.pulseTrialPolicyVersion,
  );
  const trialStart = billingRef?.currentTrialStartedAt ?? null;
  const trialEnd = billingRef?.currentTrialEndsAt ?? null;
  if (
    billingPhase === "trial"
    && checkoutOffer === HOSTED_PULSE_TRIAL_OFFER
    && parseHostedBillingPlanCode(billingRef?.currentBillingPlanCode)
      === "launch_monthly"
    && trialPolicy
    && trialStart
    && trialEnd
    && trialStart.getTime() < trialEnd.getTime()
    && input.now.getTime() >= trialStart.getTime()
    && input.now.getTime() < trialEnd.getTime()
  ) {
    return { allowed: true };
  }

  const retryAfter = new Date(input.now.getTime() + HOSTED_RUNTIME_AI_ACCESS_RETRY_MS);
  return {
    allowed: false,
    reason: "trial_expired_pending_billing",
    retryAfter,
    userNotice: {
      code: "trial_conversion_pending",
      message: renderUserFacingMessage({
        context: {
          homeUrl: HOSTED_AI_USAGE_HOME_URL,
        },
        key: "linq.ai_usage.trial_conversion_pending",
        seed: `linq.ai_usage:${input.memberId}:trial_conversion_pending:${
          trialStart?.toISOString() ?? "pending-billing"
        }`,
      }).text,
    },
  };
}

function buildHostedRuntimeInactiveAccessDecision(
  now: Date,
): Extract<HostedRuntimeAiAccessDecision, { allowed: false }> {
  return {
    allowed: false,
    reason: "hosted_access_inactive",
    retryAfter: new Date(now.getTime() + HOSTED_RUNTIME_AI_ACCESS_RETRY_MS),
    userNotice: null,
  };
}

async function hasAnyHostedRuntimeAiAccessThreadContainerParticipant(input: {
  containerMemberId: string;
  now: Date;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  const participants = await input.prisma.hostedThreadContainerParticipant.findMany({
    select: {
      participant: {
        select: {
          ...hostedMemberPersonAccessSelect,
          billingRef: {
            select: hostedRuntimeAiAccessBillingRefSelect,
          },
        },
      },
    },
    where: {
      containerMemberId: input.containerMemberId,
      removedAt: null,
    },
  });

  return participants.some(({ participant }) =>
    resolveHostedRuntimeAiPersonAccessDecision({
      memberId: input.containerMemberId,
      now: input.now,
      person: participant,
    }).allowed
  );
}

export async function isHostedThreadContainerMember(input: {
  memberId: string;
  prisma?: HostedOnboardingReadClient;
}): Promise<boolean> {
  const member = await (input.prisma ?? getPrisma()).hostedMember.findUnique({
    select: {
      threadContainer: {
        select: {
          memberId: true,
        },
      },
    },
    where: {
      id: input.memberId,
    },
  });

  return member?.threadContainer != null;
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
 * Own billing is member-owned. Sponsored access follows the Family owner order:
 * account group first, then member. The unlocked reads only choose which owner
 * to serialize on; every authority value is re-read after the required locks.
 */
export async function assertActiveHostedPersonAccessAllowedTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const candidateMember = await input.tx.hostedMember.findUnique({
    select: {
      billingStatus: true,
      suspendedAt: true,
      threadContainer: { select: { memberId: true } },
    },
    where: { id: input.memberId },
  });
  if (!candidateMember || candidateMember.threadContainer) {
    throwHostedMemberAccessRequired();
  }
  assertHostedMemberNotSuspended(candidateMember);

  const candidateSponsorship = hasHostedMemberOwnActiveBilling(candidateMember)
    ? null
    : await input.tx.hostedAccountGroupMembership.findFirst({
        orderBy: { id: "asc" },
        select: { groupId: true },
        where: {
          group: {
            billingStatus: HostedBillingStatus.active,
            suspendedAt: null,
          },
          memberId: input.memberId,
          status: "active",
        },
      });

  if (candidateSponsorship) {
    await lockHostedAccountGroupRow(input.tx, candidateSponsorship.groupId);
  }
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

  if (candidateSponsorship) {
    const sponsorship = await input.tx.hostedAccountGroupMembership.findFirst({
      select: { id: true },
      where: {
        group: {
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        },
        groupId: candidateSponsorship.groupId,
        memberId: input.memberId,
        status: "active",
      },
    });
    if (sponsorship) {
      return;
    }
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

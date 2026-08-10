import "server-only";

import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";

import {
  activeHostedThreadContainerParticipantWhere,
} from "../hosted-groups/thread-container-participant-access";
import {
  HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  resolveHostedHealthDataConsentState,
} from "../legal/consent";
import { getPrisma } from "../prisma";
import { renderUserFacingMessage } from "../hosted-messages/user-facing-messages";
import {
  assertHostedMemberNotSuspended,
  describeHostedMemberActiveAccessRequirement,
  hasHostedMemberOwnActiveAccess,
  isHostedMemberSuspended,
} from "./entitlement";
import { hostedOnboardingError } from "./errors";
import { hasHostedRecoverableBilling } from "./lifecycle";
import type { HostedOnboardingReadClient } from "./shared";

/**
 * The one place hosted access is derived.
 *
 * `hosted_member.billing_status=active` records direct product access, backed
 * by either starter usage or a paid subscription. Access can additionally be
 * sponsored through the edges
 * that already exist in the data model:
 *
 * - an active membership in an active, unsuspended account group (family), or
 * - for synthetic thread-container members, the container owner's access, or
 *   an active current participant through `readActiveHostedMemberAccess`.
 *
 * Owners cannot themselves be containers, so the derivation depth is at most
 * two and a single query loads everything the owner branch needs.
 * Every runtime, webhook, page, and egress gate must use this module; the
 * paid-billing predicate in `entitlement.ts` is for surfaces that genuinely
 * mean "this member's own subscription".
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
    stripeSubscriptionLookupKey: true,
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

const hostedRuntimeAiPersonAccessSelect = Prisma.validator<Prisma.HostedMemberSelect>()({
  ...hostedMemberPersonAccessSelect,
  billingRef: {
    select: hostedRuntimeAiAccessBillingRefSelect,
  },
  consentGrants: {
    select: {
      scope: true,
      status: true,
    },
    where: {
      scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE,
    },
  },
});

const hostedRuntimeAiMemberAccessSelect = Prisma.validator<Prisma.HostedMemberSelect>()({
  ...hostedRuntimeAiPersonAccessSelect,
  threadContainer: {
    select: {
      owner: {
        select: hostedRuntimeAiPersonAccessSelect,
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
  select: typeof hostedRuntimeAiPersonAccessSelect;
}>;

export type HostedRuntimeAiAccessDecision =
  | { allowed: true }
  | {
    allowed: false;
    reason:
      | "health_data_consent_withdrawn"
      | "hosted_access_inactive";
    retryAfter: Date;
    userNotice: {
      code: HostedRuntimeAiAccessNoticeCode;
      message: string;
    } | null;
  };

/**
 * Runtime access notices are claim-free: usage exhaustion is owned by the
 * usage allowance gate and carries its own period claim.
 */
export type HostedRuntimeAiAccessNoticeCode =
  | "billing_inactive"
  | "health_data_consent_withdrawn";

const HOSTED_RUNTIME_AI_ACCESS_NOTICE_CODES = new Set<string>([
  "billing_inactive",
  "health_data_consent_withdrawn",
]);

/** Access notices are claim-free: they carry no AI usage-period claim token. */
export function isHostedRuntimeAiAccessNoticeCode(
  code: string,
): code is HostedRuntimeAiAccessNoticeCode {
  return HOSTED_RUNTIME_AI_ACCESS_NOTICE_CODES.has(code);
}

const HOSTED_RUNTIME_AI_ACCESS_RETRY_MS = 15 * 60_000;
const HOSTED_HEALTH_DATA_CONSENT_SETTINGS_URL =
  "https://withmurph.ai/settings#data-privacy";
// Lapsed paid billing recovers from the Subscription controls.
const HOSTED_BILLING_RECOVERY_URL = "https://withmurph.ai/settings#subscription";

function hasActiveHostedPersonAccess(person: HostedMemberPersonAccessState): boolean {
  if (isHostedMemberSuspended(person.suspendedAt)) {
    return false;
  }

  if (hasHostedMemberOwnActiveAccess(person)) {
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
  now?: Date;
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
    now: input.now,
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

export async function readActiveHostedMemberAccess(input: {
  memberId: string;
  now?: Date;
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
      now: input.now,
      owner: member.threadContainer.owner,
      prisma,
    });
  }

  return hasActiveHostedMemberAccess(member);
}

/**
 * Billing-only guard for flows that must distinguish Family sponsorship from
 * a member's own Stripe access. Keep this query here with the canonical access
 * derivation instead of teaching direct billing about Family table details.
 */
export async function readActiveHostedFamilySponsorship(input: {
  memberId: string;
  prisma?: HostedOnboardingReadClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const membership = await prisma.hostedAccountGroupMembership.findFirst({
    select: { id: true },
    where: {
      group: {
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
      },
      memberId: input.memberId,
      status: "active",
    },
  });
  return membership !== null;
}

/**
 * Runtime entitlement guard. Usage accounting is a separate mandatory gate,
 * so model-capable work proceeds only when both access and usage allow it.
 * This function denies inactive access; starter usage exhaustion is enforced
 * by the usage gate.
 */
export async function readHostedRuntimeAiAccessDecision(input: {
  memberId: string;
  /**
   * Per-delivery discriminator so repeated notices to the same member rotate
   * copy variants instead of repeating one sentence verbatim. Omit to keep the
   * member-stable seed used by once-per-conversation callers.
   */
  noticeSeed?: string;
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

    const participantAllowed =
      await hasAnyHostedRuntimeAiAccessThreadContainerParticipant({
        containerMemberId: input.memberId,
        now,
        prisma,
      });
    if (participantAllowed) {
      return { allowed: true };
    }

    return ownerDecision.reason === "health_data_consent_withdrawn"
      ? ownerDecision
      : buildHostedRuntimeInactiveAccessDecision(now);
  }

  return resolveHostedRuntimeAiPersonAccessDecision({
    memberId: input.memberId,
    ...(input.noticeSeed === undefined ? {} : { noticeSeed: input.noticeSeed }),
    now,
    person: member,
  });
}

function resolveHostedRuntimeAiPersonAccessDecision(input: {
  memberId: string;
  noticeSeed?: string;
  now: Date;
  person: HostedRuntimeAiPersonAccessState;
}): HostedRuntimeAiAccessDecision {
  if (isHostedMemberSuspended(input.person.suspendedAt)) {
    return buildHostedRuntimeInactiveAccessDecision(input.now);
  }

  if (resolveHostedHealthDataConsentState(input.person.consentGrants) === "revoked") {
    return buildHostedRuntimeHealthDataConsentWithdrawnDecision(input.now);
  }

  const sponsored = input.person.accountGroupMemberships.some((membership) =>
    membership.status === "active"
    && membership.group.billingStatus === HostedBillingStatus.active
    && !isHostedMemberSuspended(membership.group.suspendedAt)
  );
  if (sponsored || hasHostedMemberOwnActiveAccess(input.person)) {
    return { allowed: true };
  }

  // Only a member with an existing provider subscription can recover billing.
  // A genuine first-time member remains on the starter-usage signup journey.
  const recoverable = hasHostedRecoverableBilling({
    billingStatus: input.person.billingStatus,
    hasExistingSubscription: Boolean(
      input.person.billingRef?.stripeSubscriptionLookupKey,
    ),
  });
  if (!recoverable) {
    return buildHostedRuntimeInactiveAccessDecision(input.now);
  }

  return buildHostedRuntimeInactiveAccessDecision(input.now, {
    code: "billing_inactive",
    message: renderUserFacingMessage({
      context: {
        homeUrl: HOSTED_BILLING_RECOVERY_URL,
      },
      key: "linq.ai_usage.billing_inactive",
      seed: buildHostedRuntimeAiAccessNoticeSeed({
        code: "billing_inactive",
        discriminator: input.person.billingStatus,
        memberId: input.memberId,
        ...(input.noticeSeed === undefined
          ? {}
          : { noticeSeed: input.noticeSeed }),
      }),
    }).text,
  });
}

function buildHostedRuntimeHealthDataConsentWithdrawnDecision(
  now: Date,
): Extract<HostedRuntimeAiAccessDecision, { allowed: false }> {
  return {
    allowed: false,
    reason: "health_data_consent_withdrawn",
    retryAfter: new Date(now.getTime() + HOSTED_RUNTIME_AI_ACCESS_RETRY_MS),
    userNotice: {
      code: "health_data_consent_withdrawn",
      message:
        "Murph is paused because you withdrew health data consent. "
        + `Use Murph again in Settings: ${HOSTED_HEALTH_DATA_CONSENT_SETTINGS_URL}`,
    },
  };
}

function buildHostedRuntimeInactiveAccessDecision(
  now: Date,
  userNotice: Extract<
    HostedRuntimeAiAccessDecision,
    { allowed: false }
  >["userNotice"] = null,
): Extract<HostedRuntimeAiAccessDecision, { allowed: false }> {
  return {
    allowed: false,
    reason: "hosted_access_inactive",
    retryAfter: new Date(now.getTime() + HOSTED_RUNTIME_AI_ACCESS_RETRY_MS),
    userNotice,
  };
}

/**
 * Keeps the historical member-stable seed when no per-delivery discriminator is
 * supplied, so once-per-conversation callers render the same variant they always
 * have, while repeated notices on a texting surface rotate.
 */
function buildHostedRuntimeAiAccessNoticeSeed(input: {
  code: HostedRuntimeAiAccessNoticeCode;
  discriminator: string;
  memberId: string;
  noticeSeed?: string;
}): string {
  const base = `linq.ai_usage:${input.memberId}:${input.code}:${input.discriminator}`;
  return input.noticeSeed === undefined ? base : `${base}:${input.noticeSeed}`;
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
          ...hostedRuntimeAiPersonAccessSelect,
        },
      },
    },
    where: {
      ...activeHostedThreadContainerParticipantWhere({ now: input.now }),
      containerMemberId: input.containerMemberId,
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
  now?: Date;
  prisma?: HostedOnboardingReadClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const participant = await prisma.hostedThreadContainerParticipant.findFirst({
    select: {
      participantMemberId: true,
    },
    where: {
      ...activeHostedThreadContainerParticipantWhere({
        now: input.now ?? new Date(),
      }),
      containerMemberId: input.containerMemberId,
      participant: activeHostedMemberAccessWhere(),
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

import "server-only";

import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";
import {
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
} from "@murphai/hosted-execution/runtime-control";

import {
  activeHostedThreadContainerParticipantWhere,
} from "../hosted-groups/thread-container-participant-access";
import {
  HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  hostedHealthDataConsentNotRevokedWhere,
  resolveHostedHealthDataConsentState,
} from "../legal/consent";
import { getPrisma } from "../prisma";
import { gameOnWhere, isGameEnabled } from "../game/access";
import { GAME_CHAT_SETTLED_ACCESS_MS, readGameChatFundingRooms } from "../game/chat-access";
import { renderUserFacingMessage } from "../hosted-messages/user-facing-messages";
import {
  assertHostedMemberNotSuspended,
  describeHostedMemberActiveAccessRequirement,
  hasHostedMemberOwnActiveAccess,
  isHostedMemberSuspended,
} from "./entitlement";
import { hostedOnboardingError } from "./errors";
import { hasHostedRecoverableBilling, isHostedLapsedBillingStatus } from "./lifecycle";
import { activeHostedPersonAccessWhere, strictHostedPersonAccessWhere, hostedMemberActivationProofWhere } from "./member-access-projections";
export { activeHostedPersonAccessWhere, strictHostedPersonAccessWhere, activeHostedPersonAccessSql, strictHostedPersonAccessSql } from "./member-access-projections";
import type { HostedOnboardingReadClient } from "./shared";

/**
 * Product admission retains its historical "Active" names. Real people keep
 * access after billing lapses; returning incomplete members need activation
 * proof. This never grants AI usage, welcome eligibility or referral credit.
 * Synthetic rooms still require strict own-active/Family owner or participant
 * sponsorship, or exact-pair game funding. AI usage is a separate mandatory gate.
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

export const hostedRuntimeAiMemberAccessSelect = Prisma.validator<Prisma.HostedMemberSelect>()({
  ...hostedRuntimeAiPersonAccessSelect,
  usageCreditBalanceUsdMicros: true,
  threadContainer: {
    select: {
      owner: {
        select: hostedRuntimeAiPersonAccessSelect,
      },
    },
  },
});

const hostedRuntimeAiBatchMemberAccessSelect =
  Prisma.validator<Prisma.HostedMemberSelect>()({
    ...hostedRuntimeAiMemberAccessSelect,
    id: true,
  });

const hostedRuntimeAiBatchParticipantSelect =
  Prisma.validator<Prisma.HostedThreadContainerParticipantSelect>()({
    containerMemberId: true,
    participant: {
      select: {
        ...hostedRuntimeAiPersonAccessSelect,
        id: true,
      },
    },
  });

const hostedBatchMemberAccessSelect =
  Prisma.validator<Prisma.HostedMemberSelect>()({
    ...hostedMemberAccessSelect,
    id: true,
  });

const hostedBatchParticipantAccessSelect =
  Prisma.validator<Prisma.HostedThreadContainerParticipantSelect>()({
    containerMemberId: true,
  });

export type HostedMemberPersonAccessState = Prisma.HostedMemberGetPayload<{
  select: typeof hostedMemberPersonAccessSelect;
}>;

export type HostedMemberAccessState = HostedMemberPersonAccessState & {
  /** Existing activation evidence, needed only for incomplete own product access. */
  activationProof?: boolean;
  threadContainer?: {
    owner: HostedMemberPersonAccessState;
  } | null;
};

type HostedRuntimeAiPersonAccessState = Prisma.HostedMemberGetPayload<{
  select: typeof hostedRuntimeAiPersonAccessSelect;
}>;

export type HostedRuntimeAiMemberAccessState = Prisma.HostedMemberGetPayload<{
  select: typeof hostedRuntimeAiMemberAccessSelect;
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

export function hasStrictHostedPersonAccess(person: HostedMemberPersonAccessState): boolean {
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
    return hasStrictHostedPersonAccess(member.threadContainer.owner);
  }

  return hasStrictHostedPersonAccess(member)
    || isHostedLapsedBillingStatus(member.billingStatus)
    || (member.billingStatus === HostedBillingStatus.incomplete && member.activationProof === true);
}

export function hasActiveHostedThreadContainerAccess(input: {
  container: Pick<HostedMemberPersonAccessState, "suspendedAt">;
  owner: HostedMemberPersonAccessState;
}): boolean {
  return !isHostedMemberSuspended(input.container.suspendedAt)
    && hasStrictHostedPersonAccess(input.owner);
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

  if (await hasAnyActiveHostedThreadContainerParticipant({
    containerMemberId: input.containerMemberId,
    now: input.now,
    prisma: input.prisma,
  })) return true;

  return (await readGameChatAccessIds({
    memberIds: [input.containerMemberId],
    now: input.now,
    prisma: input.prisma ?? getPrisma(),
  })).has(input.containerMemberId);
}

/** The bound room keeps its existing allowance through negotiation and a
 * seven-day results window. Duplicate rooms use the async funding projection. */
function activeGameChatAccessWhere(now = new Date()): Prisma.HostedMemberWhereInput {
  return {
    suspendedAt: null,
    threadContainer: { isNot: null },
    chatHostedGames: {
      some: {
        OR: [
          { status: { in: ["negotiating", "live"] } },
          { status: "settled", settledAt: { gt: new Date(now.getTime() - GAME_CHAT_SETTLED_ACCESS_MS), lte: now } },
        ],
        AND: [
          { players: { some: { seat: 0 } } },
          { players: { some: { seat: 1 } } },
          gameOnWhere(),
        ],
        players: {
          every: {
            seat: { in: [0, 1] },
            profile: {
              member: {
                suspendedAt: null,
                consentGrants: {
                  none: { scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE, status: "revoked" },
                },
              },
            },
          },
        },
      },
    },
  };
}

async function readGameChatAccessIds(input: {
  memberIds: readonly string[];
  now?: Date;
  prisma: Pick<Prisma.TransactionClient, "$queryRaw">;
}): Promise<Set<string>> {
  return new Set((await readGameChatFundingRooms({ ...input, now: input.now ?? new Date() })).keys());
}

/** Claim's floor for every runtime mode; normal processing also needs active access, retention does not. */
export function hostedRuntimeMemberEligibleWhere(): Prisma.HostedMemberWhereInput {
  return { suspendedAt: null, AND: [hostedHealthDataConsentNotRevokedWhere()] };
}

/** The same floor for raw selections, against a table aliased "member". */
export function hostedRuntimeMemberEligibleSql(): Prisma.Sql {
  return Prisma.sql`
    "member"."suspended_at" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "hosted_consent_grant" AS "consent"
      WHERE "consent"."member_id" = "member"."id"
        AND "consent"."scope" = ${HOSTED_HEALTH_DATA_CONSENT_SCOPE}
        AND "consent"."status" = 'revoked'
    )
  `;
}

/** Strict effective eligibility for lifecycle and monetary decisions about people. */
export async function readStrictHostedPersonAccess(input: {
  memberId: string;
  prisma?: HostedOnboardingReadClient;
}): Promise<boolean> {
  return await (input.prisma ?? getPrisma()).hostedMember.findUnique({
    select: { id: true }, where: { ...strictHostedPersonAccessWhere(), id: input.memberId },
  }) !== null;
}

/**
 * Set-based projection of the pure access branch for queries that must select
 * access-holding members in the database (pagination, counts, sweeps). It
 * intentionally cannot correlate a game pair with a room roster. Its bound-game
 * branch is a candidate projection only; use `readActiveHostedMemberAccess`
 * for authoritative single-member gates.
 */
export function activeHostedMemberAccessWhere(now = new Date(), includeGames = true): Prisma.HostedMemberWhereInput {
  return {
    OR: [
      ...(includeGames && isGameEnabled() ? [activeGameChatAccessWhere(now)] : []),
      activeHostedPersonAccessWhere(),
      {
        threadContainer: {
          is: {
            owner: strictHostedPersonAccessWhere(),
          },
        },
      },
    ],
    suspendedAt: null,
  };
}

/** Candidate predicate including participant sponsorship. Authoritative game
 * access additionally requires the exact-pair async projection. */
export function activeHostedMemberAccessWithParticipantsWhere(now = new Date(), includeGames = true): Prisma.HostedMemberWhereInput {
  return {
    suspendedAt: null,
    OR: [
      activeHostedMemberAccessWhere(now, includeGames),
      {
        threadContainer: {
          is: {
            participants: {
              some: {
                ...activeHostedThreadContainerParticipantWhere({ now }),
                participant: strictHostedPersonAccessWhere(),
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
  now?: Date;
  prisma?: HostedOnboardingReadClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  // Ordinary access is one statement. Game-only rooms additionally require
  // the exact observed pair, including the bound announcement room itself.
  const member = await prisma.hostedMember.findUnique({
    select: { id: true },
    where: { ...activeHostedMemberAccessWithParticipantsWhere(input.now, false), id: input.memberId },
  });
  return member !== null || (await readGameChatAccessIds({ memberIds: [input.memberId], now: input.now, prisma })).has(input.memberId);
}

/** Strict personal or existing room sponsorship for spending subsidies. This
 * preserves room/game eligibility without treating lapsed product access as funding. */
export async function readStrictHostedMemberAccess(input: {
  memberId: string;
  now?: Date;
  prisma?: HostedOnboardingReadClient;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const member = await prisma.hostedMember.findUnique({
    select: { id: true },
    where: { id: input.memberId, OR: [
      strictHostedPersonAccessWhere(),
      { threadContainer: { isNot: null }, AND: [activeHostedMemberAccessWithParticipantsWhere(input.now, false)] },
    ] },
  });
  return member !== null || (await readGameChatAccessIds({ memberIds: [input.memberId], now: input.now, prisma })).has(input.memberId);
}

/** Ordinary paid/participant-funded rooms retain their own balance. Only a
 * game-sponsored room borrows its game's canonical announcement-room balance. */
export async function readGameChatAllowanceBeneficiary(input: {
  memberId: string;
  now?: Date;
  prisma: Pick<Prisma.TransactionClient, "hostedMember" | "$queryRaw">;
}): Promise<string | null> {
  if (!isGameEnabled()) return null;
  const now = input.now ?? new Date();
  const ownAccess = await input.prisma.hostedMember.findUnique({
    select: { id: true },
    where: { ...activeHostedMemberAccessWithParticipantsWhere(now, false), id: input.memberId, threadContainer: { isNot: null } },
  });
  if (ownAccess) return null;
  return (await readGameChatFundingRooms({ memberIds: [input.memberId], now, prisma: input.prisma })).get(input.memberId) ?? null;
}

/** Sponsored members already have access, so this read stays off the mailbox fetch path. */
function needsHostedActivationProof(member: HostedMemberAccessState): boolean {
  return !member.threadContainer
    && member.billingStatus === HostedBillingStatus.incomplete
    && !hasStrictHostedPersonAccess(member);
}

async function hasHostedMemberActivationProof(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  return await input.prisma.hostedMember.findUnique({
    select: { id: true },
    where: { ...hostedMemberActivationProofWhere(), id: input.memberId },
  }) !== null;
}

export async function readActiveHostedMemberAccessState(input: {
  memberId: string;
  memberState?: HostedMemberAccessState | null;
  now?: Date;
  prisma?: HostedOnboardingReadClient;
}): Promise<HostedMemberAccessState | null> {
  const prisma = input.prisma ?? getPrisma();
  const member: HostedMemberAccessState | null = input.memberState !== undefined ? input.memberState : await prisma.hostedMember.findUnique({
    select: hostedMemberAccessSelect,
    where: {
      id: input.memberId,
    },
  });

  if (!member) {
    return null;
  }

  if (needsHostedActivationProof(member)) {
    member.activationProof = await hasHostedMemberActivationProof({ memberId: input.memberId, prisma });
  }
  const active = member.threadContainer
    ? await hasActiveHostedThreadContainerAccessWithParticipants({
      container: member,
      containerMemberId: input.memberId,
      now: input.now,
      owner: member.threadContainer.owner,
      prisma,
    })
    : hasActiveHostedMemberAccess(member);
  return active ? member : null;
}

/**
 * Set-based form of the canonical active-access read for bounded candidate
 * lists. It keeps owner and current-participant authority aligned with
 * `readActiveHostedMemberAccess` without issuing one query per member.
 */
export async function readActiveHostedMemberAccessIds(input: {
  memberIds: readonly string[];
  now?: Date;
  prisma?: Pick<
    Prisma.TransactionClient,
    "hostedMember" | "hostedThreadContainerParticipant" | "$queryRaw"
  >;
}): Promise<Set<string>> {
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) {
    return new Set();
  }

  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const members = await prisma.hostedMember.findMany({
    select: hostedBatchMemberAccessSelect,
    where: {
      id: { in: memberIds },
    },
  });
  const containerMemberIds = members
    .filter((member) =>
      member.threadContainer !== null
      && !isHostedMemberSuspended(member.suspendedAt)
    )
    .map((member) => member.id);
  const participantRows = containerMemberIds.length === 0
    ? []
    : await prisma.hostedThreadContainerParticipant.findMany({
        select: hostedBatchParticipantAccessSelect,
        take:
          containerMemberIds.length
          * HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX
          + 1,
        where: {
          ...activeHostedThreadContainerParticipantWhere({ now }),
          containerMemberId: { in: containerMemberIds },
          participant: strictHostedPersonAccessWhere(),
        },
      });
  if (
    participantRows.length
      > containerMemberIds.length * HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX
  ) {
    throw new Error("Hosted member access participant read exceeded its admitted bound.");
  }
  const participantBackedContainerIds = new Set(
    participantRows.map((row) => row.containerMemberId),
  );

  const incompleteIds = members.filter(member => !member.threadContainer && member.billingStatus === HostedBillingStatus.incomplete).map(member => member.id);
  const activatedMemberIds = new Set(incompleteIds.length === 0 ? [] : (await prisma.hostedMember.findMany({
    select: { id: true }, where: { ...hostedMemberActivationProofWhere(), id: { in: incompleteIds } },
  })).map(member => member.id));
  const activeMemberIds = new Set<string>();
  for (const member of members) {
    if (isHostedMemberSuspended(member.suspendedAt)) {
      continue;
    }
    if (!member.threadContainer) {
      if (hasActiveHostedMemberAccess({ ...member, activationProof: activatedMemberIds.has(member.id) })) {
        activeMemberIds.add(member.id);
      }
      continue;
    }

    const ownerActive = hasActiveHostedThreadContainerAccess({
      container: member,
      owner: member.threadContainer.owner,
    });
    if (ownerActive || participantBackedContainerIds.has(member.id)) {
      activeMemberIds.add(member.id);
    }
  }

  const gameContainers = await readGameChatAccessIds({
    memberIds: containerMemberIds.filter((id) => !activeMemberIds.has(id)),
    now,
    prisma,
  });
  for (const id of gameContainers) activeMemberIds.add(id);
  return activeMemberIds;
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
 * Lapsed people may spend their own existing credit. Sponsorship never uses
 * that credit; starter usage exhaustion is enforced by the usage gate.
 */
export async function readHostedRuntimeAiAccessDecision(input: {
  /** Room funding/creation must retain strict eligibility, never personal credit. */
  sponsorshipOnly?: boolean;
  memberId: string;
  memberState?: HostedRuntimeAiMemberAccessState;
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
  const member = input.memberState !== undefined ? input.memberState : await prisma.hostedMember.findUnique({
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
    if (participantAllowed || (await readGameChatAccessIds({
      memberIds: [input.memberId],
      now,
      prisma,
    })).has(input.memberId)) {
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
    personalCreditBalanceUsdMicros: input.sponsorshipOnly ? 0n : member.usageCreditBalanceUsdMicros,
  });
}

/**
 * Batch form of the runtime AI-access owner used by bounded operational reads.
 * It preserves the exact owner-or-current-participant authority of
 * `readHostedRuntimeAiAccessDecision` in two set-based queries rather than
 * falling back to the owner-only sweep approximation.
 */
export async function readHostedRuntimeAiAllowedMemberIds(input: {
  sponsorshipOnly?: boolean;
  memberIds: readonly string[];
  now?: Date;
  prisma?: Pick<
    Prisma.TransactionClient,
    "hostedMember" | "hostedThreadContainerParticipant" | "$queryRaw"
  >;
}): Promise<Set<string>> {
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) {
    return new Set();
  }

  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const members = await prisma.hostedMember.findMany({
    select: hostedRuntimeAiBatchMemberAccessSelect,
    where: {
      id: { in: memberIds },
    },
  });
  const containerMemberIds = members
    .filter((member) => member.threadContainer !== null)
    .map((member) => member.id);
  const participantRows = containerMemberIds.length === 0
    ? []
    : await prisma.hostedThreadContainerParticipant.findMany({
        select: hostedRuntimeAiBatchParticipantSelect,
        where: {
          ...activeHostedThreadContainerParticipantWhere({ now }),
          containerMemberId: { in: containerMemberIds },
        },
      });
  const participantsByContainer = new Map<
    string,
    typeof participantRows
  >();
  for (const row of participantRows) {
    const rows = participantsByContainer.get(row.containerMemberId) ?? [];
    rows.push(row);
    participantsByContainer.set(row.containerMemberId, rows);
  }

  const allowedMemberIds = new Set<string>();
  for (const member of members) {
    if (isHostedMemberSuspended(member.suspendedAt)) {
      continue;
    }
    if (!member.threadContainer) {
      if (resolveHostedRuntimeAiPersonAccessDecision({
        memberId: member.id,
        now,
        person: member,
        personalCreditBalanceUsdMicros: input.sponsorshipOnly ? 0n : member.usageCreditBalanceUsdMicros,
      }).allowed) {
        allowedMemberIds.add(member.id);
      }
      continue;
    }

    const ownerAllowed = resolveHostedRuntimeAiPersonAccessDecision({
      memberId: member.id,
      now,
      person: member.threadContainer.owner,
    }).allowed;
    const participantAllowed = (
      participantsByContainer.get(member.id) ?? []
    ).some(({ participant }) =>
      resolveHostedRuntimeAiPersonAccessDecision({
        memberId: participant.id,
        now,
        person: participant,
      }).allowed
    );
    if (ownerAllowed || participantAllowed) {
      allowedMemberIds.add(member.id);
    }
  }

  const gameContainers = await readGameChatAccessIds({
    memberIds: containerMemberIds.filter((id) => !allowedMemberIds.has(id)),
    now,
    prisma,
  });
  for (const id of gameContainers) allowedMemberIds.add(id);
  return allowedMemberIds;
}

function resolveHostedRuntimeAiPersonAccessDecision(input: {
  memberId: string;
  noticeSeed?: string;
  now: Date;
  person: HostedRuntimeAiPersonAccessState;
  personalCreditBalanceUsdMicros?: bigint | null;
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
  if (sponsored || hasHostedMemberOwnActiveAccess(input.person)
    || (isHostedLapsedBillingStatus(input.person.billingStatus)
      && (input.personalCreditBalanceUsdMicros ?? 0n) > 0n)) {
    return { allowed: true };
  }

  // Lapsed people remain product members even when no provider reference is
  // retained. Only unfinished signup stays on the first-contact journey.
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
      participant: strictHostedPersonAccessWhere(),
    },
  });

  return participant !== null;
}

/**
 * Product admission, despite the historical "Active" name. Signed-up human
 * members retain app access after billing lapses, without changing billing or
 * granting usage. Suspension and unfinished activation still block access;
 * synthetic containers retain their existing owner-based behavior. This is
 * not a spending gate: model-capable work must also check AI usage.
 */
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
    const activationProof = needsHostedActivationProof(member)
      ? await hasHostedMemberActivationProof({ memberId: input.memberId, prisma })
      : false;
    if (hasActiveHostedMemberAccess({ ...member, activationProof })) {
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

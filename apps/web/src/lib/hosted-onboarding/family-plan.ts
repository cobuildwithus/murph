import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  type HostedExecutionAssistantNotificationRoute,
} from "@murphai/hosted-execution";

import { buildMurphSmsHref, normalizeMurphTelegramUsername } from "../murph-contact-routing";
import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { getPrisma } from "../prisma";
import {
  encryptHostedWebNullableString,
  decryptHostedWebNullableString,
} from "../hosted-web/encryption";
import {
  createHostedEmailLookupKey,
  createHostedEmailLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
  createHostedStripeCheckoutSessionLookupKey,
  createHostedTelegramUsernameLookupKey,
  createHostedTelegramUsernameLookupKeyReadCandidates,
  createHostedStripeCustomerLookupKey,
  createHostedStripeCustomerLookupKeyReadCandidates,
  createHostedStripeSubscriptionItemLookupKey,
  createHostedStripeSubscriptionItemLookupKeyReadCandidates,
  createHostedStripeSubscriptionLookupKey,
  createHostedStripeSubscriptionLookupKeyReadCandidates,
  hostedEmailLookupKeyMatchesValue,
  hostedLookupKeyMatchesValue,
  hostedPhoneLookupKeyMatchesValue,
  normalizeHostedEmailAddress,
  normalizeHostedTelegramUsernameForLookup,
  readHostedPhoneHint,
} from "./contact-privacy";
import {
  isHostedMemberSuspended,
} from "./entitlement";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  generateHostedAccountGroupId,
  generateHostedAccountGroupInviteId,
  generateHostedAccountGroupMembershipId,
  generateHostedFamilyCheckoutAttemptId,
  generateHostedMemberId,
  generateHostedInviteCode,
  inviteExpiresAt,
  lockHostedMemberRow,
  normalizePhoneNumber,
  normalizeNullableString,
  type HostedOnboardingReadClient,
} from "./shared";
import {
  coerceStripeObjectId,
  coerceStripeSubscriptionId,
  mapStripeSubscriptionStatusToHostedBillingStatus,
} from "./billing";
import {
  HOSTED_FAMILY_MAX_SEATS,
  HOSTED_FAMILY_MIN_SEATS,
  parseHostedBillingPlanCode,
  parseHostedBillingPhase,
  type HostedBillingPlanCode,
} from "./billing-plans";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeApi,
  requireHostedStripeBillingPlanConfig,
} from "./runtime";
import {
  readHostedOnboardingEnvironment,
} from "./env";
import {
  MURPH_ASSISTANT_FAMILY_WELCOME_MESSAGE,
  activateHostedMemberForFamilySponsorshipTx,
  type HostedMemberActivationResult,
} from "./member-activation";
import { createHostedMember } from "./hosted-member-store";
import { readHostedMemberStripeBillingRef } from "./hosted-member-billing-store";
import {
  lookupHostedMemberIdentityByPhoneNumber,
  readHostedMemberIdentity,
} from "./hosted-member-identity-store";
import {
  readHostedMemberRoutingState,
  resolveHostedMemberRoutingByTelegramUserId,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "./hosted-member-routing-store";
import { isHostedStripeLegacyAiUsageMeteredItem } from "./legacy-usage-price";
import {
  provisionActiveHostedDomainRootEnvelopeForUserOnly,
} from "../hosted-crypto/domain-root-store";
import { ensureHostedMemberForPhoneTx } from "./member-identity-service";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "./messaging-state";

export { HOSTED_FAMILY_MAX_SEATS, HOSTED_FAMILY_MIN_SEATS } from "./billing-plans";

export const HOSTED_FAMILY_BILLING_PLAN_CODE = "launch_family_monthly" as const;
export const HOSTED_FAMILY_STRIPE_PRICE_ID_ENV_KEY =
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY";
export const HOSTED_FAMILY_STRIPE_METADATA_KIND = "hosted_family_plan";
const HOSTED_FAMILY_STRIPE_CHECKOUT_SESSION_ID_PATTERN = /^cs_(?:test|live)_[A-Za-z0-9]+$/u;

export const HOSTED_ACCOUNT_GROUP_MEMBERSHIP_ROLES = ["owner", "member"] as const;
export type HostedAccountGroupMembershipRole =
  (typeof HOSTED_ACCOUNT_GROUP_MEMBERSHIP_ROLES)[number];

export const HOSTED_ACCOUNT_GROUP_MEMBERSHIP_STATUSES = [
  "active",
  "removed",
] as const;
export type HostedAccountGroupMembershipStatus =
  (typeof HOSTED_ACCOUNT_GROUP_MEMBERSHIP_STATUSES)[number];

export const HOSTED_ACCOUNT_GROUP_INVITE_STATUSES = [
  "accepted",
  "expired",
  "pending",
  "revoked",
] as const;
export type HostedAccountGroupInviteStatus =
  (typeof HOSTED_ACCOUNT_GROUP_INVITE_STATUSES)[number];

function parseHostedAccountGroupInviteStatus(
  value: string,
): HostedAccountGroupInviteStatus {
  return (HOSTED_ACCOUNT_GROUP_INVITE_STATUSES as readonly string[]).includes(value)
    ? (value as HostedAccountGroupInviteStatus)
    : "expired";
}

const HOSTED_ACCOUNT_GROUP_INVITE_TARGET_PHONE_FIELD =
  "hosted-account-group-invite.target-phone";
const HOSTED_ACCOUNT_GROUP_INVITE_TARGET_TELEGRAM_USERNAME_FIELD =
  "hosted-account-group-invite.target-telegram-username";
const HOSTED_ACCOUNT_GROUP_INVITE_TARGET_EMAIL_FIELD =
  "hosted-account-group-invite.target-email";
const HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CUSTOMER_FIELD =
  "hosted-account-group-billing-ref.stripe-customer-id";
const HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_SUBSCRIPTION_FIELD =
  "hosted-account-group-billing-ref.stripe-subscription-id";
const HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_SUBSCRIPTION_ITEM_FIELD =
  "hosted-account-group-billing-ref.stripe-subscription-item-id";
const HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CHECKOUT_SESSION_FIELD =
  "hosted-account-group-billing-ref.stripe-checkout-session-id";

const hostedAccountGroupAccessSelect =
  Prisma.validator<Prisma.HostedAccountGroupSelect>()({
    billingStatus: true,
    id: true,
    ownerMemberId: true,
    suspendedAt: true,
  });

const hostedAccountGroupMembershipAccessSelect =
  Prisma.validator<Prisma.HostedAccountGroupMembershipSelect>()({
    group: {
      select: hostedAccountGroupAccessSelect,
    },
    groupId: true,
    memberId: true,
    role: true,
    status: true,
  });

const hostedAccountGroupInviteSelect =
  Prisma.validator<Prisma.HostedAccountGroupInviteSelect>()({
    acceptedAt: true,
    acceptedByMemberId: true,
    channel: true,
    createdAt: true,
    expiresAt: true,
    group: {
      select: hostedAccountGroupAccessSelect,
    },
    groupId: true,
    id: true,
    inviteCode: true,
    invitedByMemberId: true,
    status: true,
    targetEmailEncrypted: true,
    targetEmailLookupKey: true,
    targetLabel: true,
    targetPhoneLookupKey: true,
    targetPhoneNumberEncrypted: true,
    targetTelegramUsernameEncrypted: true,
    targetTelegramUsernameLookupKey: true,
    updatedAt: true,
  });

const hostedAccountGroupBillingRefSelect =
  Prisma.validator<Prisma.HostedAccountGroupBillingRefSelect>()({
    billedSeatCount: true,
    checkoutAttemptId: true,
    checkoutCreatedAt: true,
    checkoutSeatCount: true,
    currentBillingPhase: true,
    currentBillingPlanCode: true,
    currentPeriodEnd: true,
    currentPeriodStart: true,
    group: {
      select: hostedAccountGroupAccessSelect,
    },
    groupId: true,
    lastStripeEventCreatedAt: true,
    stripeCheckoutSessionIdEncrypted: true,
    stripeCustomerIdEncrypted: true,
    stripeSubscriptionItemIdEncrypted: true,
    stripeSubscriptionIdEncrypted: true,
  });

export type HostedAccountGroupAccessSnapshot =
  Prisma.HostedAccountGroupGetPayload<{
    select: typeof hostedAccountGroupAccessSelect;
  }>;

export type HostedAccountGroupMembershipAccessSnapshot =
  Prisma.HostedAccountGroupMembershipGetPayload<{
    select: typeof hostedAccountGroupMembershipAccessSelect;
  }>;

export type HostedAccountGroupInviteSnapshot =
  Prisma.HostedAccountGroupInviteGetPayload<{
    select: typeof hostedAccountGroupInviteSelect;
  }>;

export type HostedAccountGroupBillingRefRecord =
  Prisma.HostedAccountGroupBillingRefGetPayload<{
    select: typeof hostedAccountGroupBillingRefSelect;
  }>;

export interface HostedAccountGroupBillingRefSnapshot
  extends Omit<HostedAccountGroupBillingRefRecord,
    | "stripeCheckoutSessionIdEncrypted"
    | "stripeCustomerIdEncrypted"
    | "stripeSubscriptionItemIdEncrypted"
    | "stripeSubscriptionIdEncrypted"
  > {
  stripeCheckoutSessionId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionItemId: string | null;
  stripeSubscriptionId: string | null;
}

export interface HostedAccountGroupBillingLookup {
  billingRef: HostedAccountGroupBillingRefSnapshot;
  group: HostedAccountGroupAccessSnapshot;
  matchedBy: "stripeCustomerId" | "stripeSubscriptionId" | "stripeSubscriptionItemId";
}

interface HostedAccountGroupStripeObjectMatch {
  billingRef: HostedAccountGroupBillingRefSnapshot | null;
  group: HostedAccountGroupAccessSnapshot;
}

export type HostedFamilyStripeSubscriptionResult = {
  activations: HostedMemberActivationResult[];
  groupId: string | null;
};

export interface HostedAccountGroupInvitePrivateSnapshot
  extends Omit<HostedAccountGroupInviteSnapshot,
    "targetEmailEncrypted" | "targetPhoneNumberEncrypted" | "targetTelegramUsernameEncrypted"
  > {
  targetEmail: string | null;
  targetPhoneHint: string | null;
  targetPhoneNumber: string | null;
  targetTelegramUsername: string | null;
}


export interface HostedFamilyChatInviteResult {
  group: HostedAccountGroupAccessSnapshot;
  invite: HostedAccountGroupInvitePrivateSnapshot;
  replyText: string;
}

export interface HostedFamilyOwnerSeatStatus {
  active: number;
  billed: number;
  invited: number;
  max: number;
  min: number;
  remaining: number;
  used: number;
}

export interface HostedFamilyOwnerMemberRow {
  isOwner: boolean;
  joinedAt: Date | null;
  label: string | null;
  memberId: string;
  role: string;
  status: string;
}

export interface HostedFamilyOwnerInviteRow {
  acceptUrl: string | null;
  channel: string;
  expiresAt: Date;
  id: string;
  status: string;
  targetEmail: string | null;
  targetLabel: string | null;
  targetPhoneHint: string | null;
  telegramInviteUrl: string | null;
  targetTelegramUsername: string | null;
}

export interface HostedFamilyOwnerSnapshot {
  billingActive: boolean;
  billingStatus: HostedBillingStatus;
  displayName: string | null;
  groupId: string;
  invites: HostedFamilyOwnerInviteRow[];
  members: HostedFamilyOwnerMemberRow[];
  ownerMemberId: string;
  seats: HostedFamilyOwnerSeatStatus;
  suspendedAt: Date | null;
}

export interface HostedFamilyInviteAcceptanceView {
  groupActive: boolean;
  groupDisplayName: string | null;
  inviteCode: string;
  isEmailBound: boolean;
  isPhoneBound: boolean;
  isTelegramBound: boolean;
  /**
   * The Murph line a phone-bound invitee already messages Murph on, when they
   * are an existing member. The accept page prefers this so accepting by text
   * lands in their existing thread instead of being redirected to their home
   * line. Null for brand-new invitees (the page falls back to a configured line).
   */
  messagesRecipientPhone: string | null;
  seatAvailable: boolean;
  status: HostedAccountGroupInviteStatus;
  targetLabel: string | null;
  telegramInviteUrl: string | null;
  webAcceptable: boolean;
}

function hostedFamilyInviteIsFullyUnbound(input: {
  targetEmailLookupKey: string | null;
  targetPhoneLookupKey: string | null;
  targetTelegramUsernameLookupKey: string | null;
}): boolean {
  return !input.targetEmailLookupKey &&
    !input.targetPhoneLookupKey &&
    !input.targetTelegramUsernameLookupKey;
}

type HostedFamilyBillingCheckoutInput =
  | {
      alreadyActive: true;
    }
  | HostedFamilyDirectPaidUpgradeInput
  | {
      alreadyActive: false;
      checkoutAttemptId: string;
      group: HostedAccountGroupAccessSnapshot;
      priceId: string;
      publicBaseUrl: string;
      seatCount: number;
      stripeCustomerId: string | null;
    };

type HostedFamilyDirectPaidUpgradeInput = {
  alreadyActive: false;
  currentPlanCode: HostedBillingPlanCode;
  currentPriceId: string;
  group: HostedAccountGroupAccessSnapshot;
  mode: "directPaidUpgrade";
  seatCount: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  targetPriceId: string;
};

export function hasHostedAccountGroupAccess(input: {
  billingStatus: HostedBillingStatus;
  suspendedAt?: Date | null;
}): boolean {
  return !isHostedMemberSuspended(input.suspendedAt) &&
    input.billingStatus === HostedBillingStatus.active;
}

export function hasHostedAccountGroupMembershipAccess(input: {
  group: Pick<HostedAccountGroupAccessSnapshot, "billingStatus" | "suspendedAt">;
  membershipStatus: string;
}): boolean {
  return input.membershipStatus === "active" &&
    hasHostedAccountGroupAccess(input.group);
}

/**
 * Sponsorship lookup for surfaces that need the sponsoring group itself
 * (usage metering, settings, family tooling). The seat invariant is enforced
 * at write time — invite issuance/acceptance assert seat fit and the
 * subscription webhook fails the whole group to `unpaid` when active members
 * exceed billed seats — so membership in an active, unsuspended group IS
 * sponsored access. Pure access gates should use `member-access.ts` instead.
 */
export async function readHostedFamilyAccessForMember(input: {
  memberId: string;
  prisma?: HostedOnboardingReadClient;
}): Promise<HostedAccountGroupMembershipAccessSnapshot | null> {
  const prisma = input.prisma ?? getPrisma();
  return prisma.hostedAccountGroupMembership.findFirst({
    orderBy: {
      createdAt: "asc",
    },
    select: hostedAccountGroupMembershipAccessSelect,
    where: {
      group: {
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
      },
      memberId: input.memberId,
      status: "active",
    },
  });
}

export async function readHostedFamilyOwnerSnapshotForMember(input: {
  memberId: string;
  now?: Date;
  prisma?: HostedOnboardingReadClient;
}): Promise<HostedFamilyOwnerSnapshot | null> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const group = await prisma.hostedAccountGroup.findUnique({
    select: {
      billingStatus: true,
      displayName: true,
      id: true,
      ownerMemberId: true,
      suspendedAt: true,
    },
    where: {
      ownerMemberId: input.memberId,
    },
  });

  if (!group) {
    return null;
  }

  const [memberships, invites, acceptedInvites, paidSeatCount] = await Promise.all([
    prisma.hostedAccountGroupMembership.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: {
        joinedAt: true,
        memberId: true,
        role: true,
        status: true,
      },
      where: {
        groupId: group.id,
        status: "active",
      },
    }),
    prisma.hostedAccountGroupInvite.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: hostedAccountGroupInviteSelect,
      where: {
        expiresAt: {
          gt: now,
        },
        groupId: group.id,
        status: "pending",
      },
    }),
    prisma.hostedAccountGroupInvite.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: hostedAccountGroupInviteSelect,
      where: {
        acceptedByMemberId: {
          not: null,
        },
        groupId: group.id,
        status: "accepted",
      },
    }),
    readHostedFamilyBilledSeatCountTx({
      groupId: group.id,
      tx: prisma,
    }),
  ]);

  const firstAcceptedInviteByMember = new Map<string, (typeof acceptedInvites)[number]>();
  for (const invite of acceptedInvites) {
    if (invite.acceptedByMemberId && !firstAcceptedInviteByMember.has(invite.acceptedByMemberId)) {
      firstAcceptedInviteByMember.set(invite.acceptedByMemberId, invite);
    }
  }
  const labelByMemberId = new Map<string, string | null>(
    await Promise.all(
      [...firstAcceptedInviteByMember].map(async ([memberId, invite]) => {
        if (invite.targetLabel) {
          return [memberId, invite.targetLabel] as const;
        }
        const projected = await projectHostedFamilyInvitePrivateSnapshot(invite, prisma);
        return [
          memberId,
          projected.targetEmail
            ?? (projected.targetTelegramUsername ? `@${projected.targetTelegramUsername}` : null)
            ?? projected.targetPhoneHint,
        ] as const;
      }),
    ),
  );

  const { publicBaseUrl, telegramBotUsername } = readHostedOnboardingEnvironment();
  const members: HostedFamilyOwnerMemberRow[] = memberships.map((membership) => ({
    isOwner: membership.memberId === group.ownerMemberId,
    joinedAt: membership.joinedAt,
    label:
      membership.memberId === group.ownerMemberId
        ? null
        : labelByMemberId.get(membership.memberId) ?? null,
    memberId: membership.memberId,
    role: membership.role,
    status: membership.status,
  }));

  const inviteRows: HostedFamilyOwnerInviteRow[] = await Promise.all(
    invites.map(async (invite) => {
      const projected = await projectHostedFamilyInvitePrivateSnapshot(invite, prisma);

      return {
        acceptUrl: buildHostedFamilyInviteAcceptUrl({
          inviteCode: invite.inviteCode,
          publicBaseUrl,
        }),
        channel: invite.channel,
        expiresAt: invite.expiresAt,
        id: invite.id,
        status: invite.status,
        targetEmail: projected.targetEmail,
        targetLabel: invite.targetLabel,
        targetPhoneHint: projected.targetPhoneHint,
        targetTelegramUsername: projected.targetTelegramUsername,
        telegramInviteUrl: resolveHostedFamilyTelegramInviteUrl({
          inviteCode: invite.inviteCode,
          isTelegramBound: projected.targetTelegramUsername !== null,
          telegramBotUsername,
        }),
      };
    }),
  );

  const active = members.length;
  const invited = inviteRows.length;
  const used = active + invited;
  const billedSeatCount = paidSeatCount ?? 0;

  return {
    billingActive: hasHostedAccountGroupAccess({
      billingStatus: group.billingStatus,
      suspendedAt: group.suspendedAt,
    }),
    billingStatus: group.billingStatus,
    displayName: group.displayName,
    groupId: group.id,
    invites: inviteRows,
    members,
    ownerMemberId: group.ownerMemberId,
    seats: {
      active,
      billed: billedSeatCount,
      invited,
      max: HOSTED_FAMILY_MAX_SEATS,
      min: HOSTED_FAMILY_MIN_SEATS,
      remaining: Math.max(0, billedSeatCount - used),
      used,
    },
    suspendedAt: group.suspendedAt,
  };
}

export async function readHostedFamilyInviteAcceptanceView(input: {
  inviteCode: string;
  now?: Date;
  prisma?: HostedOnboardingReadClient;
}): Promise<HostedFamilyInviteAcceptanceView | null> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const invite = await prisma.hostedAccountGroupInvite.findUnique({
    select: {
      expiresAt: true,
      group: {
        select: {
          billingStatus: true,
          displayName: true,
          id: true,
          ownerMemberId: true,
          suspendedAt: true,
        },
      },
      inviteCode: true,
      status: true,
      targetEmailLookupKey: true,
      targetLabel: true,
      targetPhoneLookupKey: true,
      targetPhoneNumberEncrypted: true,
      targetTelegramUsernameLookupKey: true,
    },
    where: {
      inviteCode: input.inviteCode,
    },
  });

  if (!invite) {
    return null;
  }

  const expired = invite.status === "pending" && invite.expiresAt <= now;
  const status: HostedAccountGroupInviteStatus = expired
    ? "expired"
    : parseHostedAccountGroupInviteStatus(invite.status);
  const isPending = status === "pending";

  let seatAvailable = false;
  if (isPending) {
    const [activeMemberships, pendingInvites, billedSeatCount] = await Promise.all([
      prisma.hostedAccountGroupMembership.count({
        where: {
          groupId: invite.group.id,
          status: "active",
        },
      }),
      prisma.hostedAccountGroupInvite.count({
        where: {
          expiresAt: {
            gt: now,
          },
          groupId: invite.group.id,
          status: "pending",
        },
      }),
      readHostedFamilyBilledSeatCountTx({
        groupId: invite.group.id,
        tx: prisma,
      }),
    ]);
    seatAvailable = billedSeatCount !== null &&
      activeMemberships + pendingInvites <= billedSeatCount;
  }

  const groupActive = hasHostedAccountGroupAccess({
    billingStatus: invite.group.billingStatus,
    suspendedAt: invite.group.suspendedAt,
  });
  const isPhoneBound = invite.targetPhoneLookupKey !== null;
  const isEmailBound = invite.targetEmailLookupKey !== null;
  const isTelegramBound = invite.targetTelegramUsernameLookupKey !== null;
  const isFullyUnbound = hostedFamilyInviteIsFullyUnbound(invite);
  const telegramBotUsername = readHostedOnboardingEnvironment().telegramBotUsername;

  // A phone-bound invitee accepts by texting the family token to Murph; the
  // LinQ webhook matches it against their phone. Resolve the line they already
  // message Murph on (when they are an existing member) so acceptance lands in
  // their existing thread rather than being redirected to their home line.
  const messagesRecipientPhone = isPhoneBound && isPending
    ? await resolveHostedFamilyInviteExistingHomeLinePhone({
        ownerMemberId: invite.group.ownerMemberId,
        prisma,
        targetPhoneNumberEncrypted: invite.targetPhoneNumberEncrypted,
      })
    : null;

  return {
    groupActive,
    groupDisplayName: invite.group.displayName,
    inviteCode: invite.inviteCode,
    isEmailBound,
    isPhoneBound,
    isTelegramBound,
    messagesRecipientPhone,
    seatAvailable,
    status,
    targetLabel: invite.targetLabel,
    telegramInviteUrl: isPending
      ? resolveHostedFamilyTelegramInviteUrl({
          inviteCode: invite.inviteCode,
          isTelegramBound: isTelegramBound || isFullyUnbound,
          telegramBotUsername,
        })
      : null,
    webAcceptable: isPending &&
      seatAvailable &&
      groupActive &&
      (isPhoneBound || isEmailBound || isFullyUnbound),
  };
}

/**
 * Resolves the Murph LinQ line a phone-bound invitee already messages on, when
 * they are an existing member, so accepting by text lands in their existing
 * thread instead of being redirected to their home line. Returns null for
 * brand-new invitees (the accept page falls back to a configured line and the
 * webhook assigns a home line on first contact).
 *
 * It resolves the member by the decrypted phone via version-tolerant read
 * candidates, the same authority `acceptHostedFamilyInviteFromPhoneTx` uses.
 * Matching on the invite's single stored lookup key would miss an existing
 * member after a contact key-version rotation and silently point them at the
 * wrong line. Best-effort: any failure falls back to null so a resolution error
 * degrades to a configured line rather than failing the accept page.
 */
async function resolveHostedFamilyInviteExistingHomeLinePhone(input: {
  ownerMemberId: string;
  prisma: HostedOnboardingReadClient;
  targetPhoneNumberEncrypted: string | null;
}): Promise<string | null> {
  try {
    const phoneNumber = await decryptHostedWebNullableString({
      field: HOSTED_ACCOUNT_GROUP_INVITE_TARGET_PHONE_FIELD,
      memberId: input.ownerMemberId,
      prisma: input.prisma,
      value: input.targetPhoneNumberEncrypted,
    });
    if (!phoneNumber) {
      return null;
    }
    const identity = await lookupHostedMemberIdentityByPhoneNumber({
      phoneNumber,
      prisma: input.prisma,
    });
    if (!identity) {
      return null;
    }
    const routing = await readHostedMemberRoutingState({
      memberId: identity.core.id,
      prisma: input.prisma,
    });
    return normalizePhoneNumber(routing?.linqRecipientPhone ?? null);
  } catch {
    return null;
  }
}

export async function readHostedAccountGroupStripeBillingRef(input: {
  groupId: string;
  prisma?: HostedOnboardingReadClient;
}): Promise<HostedAccountGroupBillingRefSnapshot | null> {
  const prisma = input.prisma ?? getPrisma();
  const billingRef = await prisma.hostedAccountGroupBillingRef.findUnique({
    select: hostedAccountGroupBillingRefSelect,
    where: {
      groupId: input.groupId,
    },
  });

  return billingRef ? projectHostedAccountGroupBillingRefSnapshot(billingRef, prisma) : null;
}

export async function lookupHostedAccountGroupStripeBillingRefByStripeCustomerId(input: {
  prisma: HostedOnboardingReadClient;
  stripeCustomerId: string;
}): Promise<HostedAccountGroupBillingLookup | null> {
  const lookupKeys = createHostedStripeCustomerLookupKeyReadCandidates(input.stripeCustomerId);

  if (lookupKeys.length === 0) {
    return null;
  }

  const billingRefs = await input.prisma.hostedAccountGroupBillingRef.findMany({
    select: hostedAccountGroupBillingRefSelect,
    where: {
      stripeCustomerLookupKey: {
        in: lookupKeys,
      },
    },
  });

  return resolveHostedAccountGroupBillingLookup(billingRefs, "stripeCustomerId", input.prisma);
}

export async function lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId(input: {
  prisma: HostedOnboardingReadClient;
  stripeSubscriptionId: string;
}): Promise<HostedAccountGroupBillingLookup | null> {
  const lookupKeys = createHostedStripeSubscriptionLookupKeyReadCandidates(
    input.stripeSubscriptionId,
  );

  if (lookupKeys.length === 0) {
    return null;
  }

  const billingRefs = await input.prisma.hostedAccountGroupBillingRef.findMany({
    select: hostedAccountGroupBillingRefSelect,
    where: {
      stripeSubscriptionLookupKey: {
        in: lookupKeys,
      },
    },
  });

  return resolveHostedAccountGroupBillingLookup(billingRefs, "stripeSubscriptionId", input.prisma);
}

export async function lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionItemId(input: {
  prisma: HostedOnboardingReadClient;
  stripeSubscriptionItemId: string;
}): Promise<HostedAccountGroupBillingLookup | null> {
  const lookupKeys = createHostedStripeSubscriptionItemLookupKeyReadCandidates(
    input.stripeSubscriptionItemId,
  );

  if (lookupKeys.length === 0) {
    return null;
  }

  const billingRefs = await input.prisma.hostedAccountGroupBillingRef.findMany({
    select: hostedAccountGroupBillingRefSelect,
    where: {
      stripeSubscriptionItemLookupKey: {
        in: lookupKeys,
      },
    },
  });

  return resolveHostedAccountGroupBillingLookup(
    billingRefs,
    "stripeSubscriptionItemId",
    input.prisma,
  );
}

export async function writeHostedAccountGroupStripeBillingTx(input: {
  billedSeatCount?: number | null;
  billingStatus: HostedBillingStatus;
  currentBillingPhase?: string | null;
  currentBillingPlanCode?: string | null;
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  groupId: string;
  preserveLastStripeEventCreatedAt?: boolean;
  stripeCustomerId?: string | null;
  stripeEventCreatedAt?: Date | null;
  stripeSubscriptionItemId?: string | null;
  stripeSubscriptionId?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedAccountGroupBillingRefSnapshot | null> {
  const group = await input.tx.hostedAccountGroup.findUnique({
    select: hostedAccountGroupAccessSelect,
    where: {
      id: input.groupId,
    },
  });

  if (!group) {
    return null;
  }

  await lockHostedMemberRow(input.tx, group.ownerMemberId);

  const currentBillingRef = await input.tx.hostedAccountGroupBillingRef.findUnique({
    select: hostedAccountGroupBillingRefSelect,
    where: {
      groupId: input.groupId,
    },
  });
  if (
    !input.preserveLastStripeEventCreatedAt &&
    input.stripeEventCreatedAt &&
    currentBillingRef?.lastStripeEventCreatedAt &&
    currentBillingRef.lastStripeEventCreatedAt.getTime() > input.stripeEventCreatedAt.getTime()
  ) {
    return projectHostedAccountGroupBillingRefSnapshot(currentBillingRef, input.tx);
  }

  const stripeCustomerId = normalizeNullableString(input.stripeCustomerId);
  const stripeSubscriptionId = normalizeNullableString(input.stripeSubscriptionId);
  const stripeSubscriptionItemId = normalizeNullableString(input.stripeSubscriptionItemId);
  const billedSeatCount = normalizeHostedFamilyOptionalBilledSeatCount(input.billedSeatCount);
  await assertHostedAccountGroupStripeBillingIdentifiersAvailableTx({
    groupId: input.groupId,
    stripeCustomerId,
    stripeSubscriptionItemId,
    stripeSubscriptionId,
    tx: input.tx,
  });

  const privateColumns = await buildHostedAccountGroupBillingPrivateColumns({
    ownerMemberId: group.ownerMemberId,
    prisma: input.tx,
    stripeCustomerId,
    stripeSubscriptionItemId,
    stripeSubscriptionId,
  });
  const stripeCustomerLookupKey = createHostedStripeCustomerLookupKey(stripeCustomerId);
  const stripeSubscriptionItemLookupKey =
    createHostedStripeSubscriptionItemLookupKey(stripeSubscriptionItemId);
  const stripeSubscriptionLookupKey = createHostedStripeSubscriptionLookupKey(stripeSubscriptionId);
  const preserveBillingFields = input.preserveLastStripeEventCreatedAt && currentBillingRef;

  const billingRef = await input.tx.hostedAccountGroupBillingRef.upsert({
    create: {
      ...privateColumns,
      billedSeatCount,
      checkoutAttemptId: null,
      checkoutCreatedAt: null,
      checkoutSeatCount: null,
      currentBillingPhase: input.currentBillingPhase ?? null,
      currentBillingPlanCode: input.currentBillingPlanCode ?? HOSTED_FAMILY_BILLING_PLAN_CODE,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      currentPeriodStart: input.currentPeriodStart ?? null,
      groupId: input.groupId,
      lastStripeEventCreatedAt: input.preserveLastStripeEventCreatedAt
        ? null
        : input.stripeEventCreatedAt ?? null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripeCustomerLookupKey,
      stripeSubscriptionItemLookupKey,
      stripeSubscriptionLookupKey,
    },
    select: hostedAccountGroupBillingRefSelect,
    update: preserveBillingFields
      ? {
          stripeCustomerIdEncrypted: privateColumns.stripeCustomerIdEncrypted,
          stripeCustomerLookupKey,
          checkoutAttemptId: null,
          checkoutCreatedAt: null,
          checkoutSeatCount: null,
          stripeCheckoutSessionIdEncrypted: null,
          stripeCheckoutSessionLookupKey: null,
          stripeSubscriptionIdEncrypted: privateColumns.stripeSubscriptionIdEncrypted,
          stripeSubscriptionLookupKey,
        }
      : {
          ...privateColumns,
          checkoutAttemptId: null,
          checkoutCreatedAt: null,
          checkoutSeatCount: null,
          currentBillingPhase: input.currentBillingPhase ?? null,
          currentBillingPlanCode: input.currentBillingPlanCode ?? HOSTED_FAMILY_BILLING_PLAN_CODE,
          currentPeriodEnd: input.currentPeriodEnd ?? null,
          currentPeriodStart: input.currentPeriodStart ?? null,
          billedSeatCount,
          stripeCheckoutSessionIdEncrypted: null,
          stripeCheckoutSessionLookupKey: null,
          ...(input.preserveLastStripeEventCreatedAt
            ? {}
            : {
                lastStripeEventCreatedAt: input.stripeEventCreatedAt ?? null,
              }),
          stripeCustomerLookupKey,
          stripeSubscriptionItemLookupKey,
          stripeSubscriptionLookupKey,
        },
    where: {
      groupId: input.groupId,
    },
  });

  await input.tx.hostedAccountGroup.update({
    data: {
      billingStatus: input.billingStatus,
    },
    where: {
      id: input.groupId,
    },
  });

  return projectHostedAccountGroupBillingRefSnapshot(billingRef, input.tx);
}

export async function findHostedAccountGroupForStripeCheckoutSession(input: {
  prisma: HostedOnboardingReadClient;
  session: Stripe.Checkout.Session;
}): Promise<HostedAccountGroupAccessSnapshot | null> {
  const match = await findHostedAccountGroupForStripeObject({
    accountGroupId: normalizeNullableString(input.session.metadata?.accountGroupId),
    checkoutAttemptId: normalizeNullableString(input.session.metadata?.checkoutAttemptId),
    checkoutSessionId: input.session.id,
    customerId: coerceStripeObjectId(input.session.customer),
    customerLookupAllowed: true,
    prisma: input.prisma,
    subscriptionId: coerceStripeSubscriptionId(input.session.subscription),
  });
  return match?.group ?? null;
}

export async function findHostedAccountGroupForStripeSubscription(input: {
  prisma: HostedOnboardingReadClient;
  subscription: Stripe.Subscription;
}): Promise<HostedAccountGroupAccessSnapshot | null> {
  const match = await findHostedAccountGroupForStripeObject({
    accountGroupId: normalizeNullableString(input.subscription.metadata?.accountGroupId),
    checkoutAttemptId: normalizeNullableString(input.subscription.metadata?.checkoutAttemptId),
    customerId: coerceStripeObjectId(input.subscription.customer),
    customerLookupAllowed: false,
    prisma: input.prisma,
    subscriptionId: input.subscription.id,
  });
  return match?.group ?? null;
}

export async function applyHostedFamilyStripeCheckoutCompletedTx(input: {
  dispatchContext: { eventCreatedAt?: Date | null };
  session: Stripe.Checkout.Session;
  tx: Prisma.TransactionClient;
}): Promise<{ groupId: string | null }> {
  if (input.session.metadata?.kind !== HOSTED_FAMILY_STRIPE_METADATA_KIND) {
    return { groupId: null };
  }

  const group = await findHostedAccountGroupForStripeCheckoutSession({
    prisma: input.tx,
    session: input.session,
  });
  if (!group) {
    return { groupId: null };
  }

  await writeHostedAccountGroupStripeBillingTx({
    billingStatus: group.billingStatus,
    currentBillingPhase: null,
    currentBillingPlanCode: HOSTED_FAMILY_BILLING_PLAN_CODE,
    groupId: group.id,
    preserveLastStripeEventCreatedAt: true,
    stripeCustomerId: coerceStripeObjectId(input.session.customer),
    stripeEventCreatedAt: input.dispatchContext.eventCreatedAt ?? null,
    stripeSubscriptionId: coerceStripeSubscriptionId(input.session.subscription),
    tx: input.tx,
  });

  return { groupId: group.id };
}

export async function applyHostedFamilyStripeSubscriptionUpdatedTx(input: {
  dispatchContext: { eventCreatedAt?: Date | null };
  subscription: Stripe.Subscription;
  tx: Prisma.TransactionClient;
}): Promise<HostedFamilyStripeSubscriptionResult> {
  if (!isHostedFamilyStripeSubscriptionMetadata(input.subscription)) {
    return buildEmptyHostedFamilyStripeSubscriptionResult();
  }

  const match = await findHostedAccountGroupForStripeObject({
    accountGroupId: normalizeNullableString(input.subscription.metadata?.accountGroupId),
    checkoutAttemptId: normalizeNullableString(input.subscription.metadata?.checkoutAttemptId),
    customerId: coerceStripeObjectId(input.subscription.customer),
    customerLookupAllowed: false,
    prisma: input.tx,
    subscriptionId: input.subscription.id,
  });
  if (!match) {
    return buildEmptyHostedFamilyStripeSubscriptionResult();
  }
  const { billingRef: matchedBillingRef, group } = match;
  const eventCreatedAt = input.dispatchContext.eventCreatedAt ?? null;
  if (isHostedFamilyStripeEventStale({
    billingRef: matchedBillingRef,
    eventCreatedAt,
  })) {
    return {
      activations: [],
      groupId: group.id,
    };
  }

  const familySeatItem = readHostedFamilyStripeSeatSubscriptionItem(input.subscription);
  const stripeBillingStatus = mapStripeSubscriptionStatusToHostedBillingStatus(
    input.subscription.status,
  );
  if (!familySeatItem) {
    const failClosedBillingStatus = stripeBillingStatus === HostedBillingStatus.active
      ? HostedBillingStatus.unpaid
      : stripeBillingStatus;
    await writeHostedAccountGroupStripeBillingTx({
      billingStatus: failClosedBillingStatus,
      currentBillingPhase: null,
      currentBillingPlanCode: HOSTED_FAMILY_BILLING_PLAN_CODE,
      ...buildHostedFamilyStripeSubscriptionPeriodSnapshot(input.subscription),
      billedSeatCount: null,
      groupId: group.id,
      stripeCustomerId: coerceStripeObjectId(input.subscription.customer),
      stripeEventCreatedAt: eventCreatedAt,
      stripeSubscriptionItemId: null,
      stripeSubscriptionId: input.subscription.id,
      tx: input.tx,
    });

    return {
      activations: [],
      groupId: group.id,
    };
  }

  const eventFreshUnderOwnerLock = await lockHostedFamilyBillingReconciliationTx({
    eventCreatedAt,
    group,
    tx: input.tx,
  });
  if (!eventFreshUnderOwnerLock) {
    return {
      activations: [],
      groupId: group.id,
    };
  }

  const activeMembershipCount = await input.tx.hostedAccountGroupMembership.count({
    where: {
      groupId: group.id,
      status: "active",
    },
  });
  const activeMembersFitPaidSeats = activeMembershipCount <= familySeatItem.billedSeatCount;
  const billingStatus = stripeBillingStatus === HostedBillingStatus.active &&
      !activeMembersFitPaidSeats
    ? HostedBillingStatus.unpaid
    : stripeBillingStatus;
  const billingRef = await writeHostedAccountGroupStripeBillingTx({
    billingStatus,
    currentBillingPhase:
      input.subscription.status === "active" && activeMembersFitPaidSeats ? "paid" : null,
    currentBillingPlanCode: HOSTED_FAMILY_BILLING_PLAN_CODE,
    ...buildHostedFamilyStripeSubscriptionPeriodSnapshot(
      input.subscription,
      familySeatItem.stripeSubscriptionItem,
    ),
    billedSeatCount: familySeatItem.billedSeatCount,
    groupId: group.id,
    stripeCustomerId: coerceStripeObjectId(input.subscription.customer),
    stripeEventCreatedAt: eventCreatedAt,
    stripeSubscriptionItemId: familySeatItem.stripeSubscriptionItemId,
    stripeSubscriptionId: input.subscription.id,
    tx: input.tx,
  });
  if (
    eventCreatedAt &&
    billingRef?.lastStripeEventCreatedAt &&
    billingRef.lastStripeEventCreatedAt.getTime() > eventCreatedAt.getTime()
  ) {
    return {
      activations: [],
      groupId: group.id,
    };
  }

  if (billingStatus === HostedBillingStatus.active) {
    await revokeNewestHostedFamilyPendingInvitesToFitBilledSeatsTx({
      billedSeatCount: familySeatItem.billedSeatCount,
      groupId: group.id,
      now: input.dispatchContext.eventCreatedAt ?? new Date(),
      tx: input.tx,
    });
    const activations = await activateHostedFamilyGroupMembersForActiveBillingTx({
      groupId: group.id,
      occurredAt: input.dispatchContext.eventCreatedAt ?? new Date(),
      sourceEventId: `family-subscription:${input.subscription.id}`,
      tx: input.tx,
    });

    return {
      activations,
      groupId: group.id,
    };
  }

  return {
    activations: [],
    groupId: group.id,
  };
}

export async function createHostedFamilyBillingCheckout(input: {
  groupId: string;
  now?: Date;
  ownerMemberId: string;
  prisma?: PrismaClient;
  seatCount?: unknown;
}): Promise<{ alreadyActive: boolean; url: string | null }> {
  const prisma = input.prisma ?? getPrisma();
  const seatCount = normalizeHostedFamilySeatCount(input.seatCount ?? HOSTED_FAMILY_MIN_SEATS);
  let stripeApi: ReturnType<typeof requireHostedStripeApi> | null = null;

  const checkoutInput: HostedFamilyBillingCheckoutInput = await prisma.$transaction(async (tx) => {
    const group = await tx.hostedAccountGroup.findUnique({
      select: hostedAccountGroupAccessSelect,
      where: {
        id: input.groupId,
      },
    });
    if (!group || group.ownerMemberId !== input.ownerMemberId) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_OWNER_REQUIRED",
        httpStatus: 403,
        message: "Only the family plan owner can start family billing.",
      });
    }

    await lockHostedMemberRow(tx, group.ownerMemberId);
    if (hasHostedAccountGroupAccess(group)) {
      return {
        alreadyActive: true,
        url: null,
      };
    }
    await assertHostedFamilyOwnerCanStartBillingTx({
      allowDirectPaidOwner: true,
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      tx,
    });

    const currentBillingRef = await readHostedAccountGroupStripeBillingRef({
      groupId: group.id,
      prisma: tx,
    });
    if (currentBillingRef?.stripeSubscriptionId) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_BILLING_SYNCING",
        httpStatus: 409,
        message: "Family billing is still syncing. Try again after payment is confirmed.",
      });
    }
    const directPaidUpgrade = await readHostedFamilyDirectPaidUpgradeInputTx({
      group,
      seatCount,
      tx,
    });
    if (directPaidUpgrade) {
      return directPaidUpgrade;
    }
    const checkoutAttemptId =
      currentBillingRef?.checkoutAttemptId
        ? currentBillingRef.checkoutAttemptId
        : generateHostedFamilyCheckoutAttemptId();
    if (
      currentBillingRef?.checkoutAttemptId &&
      currentBillingRef.checkoutSeatCount !== seatCount
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_CHECKOUT_IN_PROGRESS",
        httpStatus: 409,
        message: "Family checkout is already in progress. Finish or restart checkout before changing seats.",
      });
    }
    const priceId = requireHostedFamilyStripePriceId();
    const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
    stripeApi = requireHostedStripeApi();
    await writeHostedFamilyCheckoutAttemptTx({
      attemptId: checkoutAttemptId,
      group,
      seatCount,
      tx,
    });

    return {
      alreadyActive: false,
      checkoutAttemptId,
      group,
      priceId,
      publicBaseUrl,
      seatCount,
      stripeCustomerId: currentBillingRef?.stripeCustomerId ?? null,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (checkoutInput.alreadyActive) {
    return {
      alreadyActive: true,
      url: null,
    };
  }
  if (isHostedFamilyDirectPaidUpgradeInput(checkoutInput)) {
    return upgradeHostedFamilyDirectPaidSubscription({
      ...checkoutInput,
      prisma,
    });
  }

  const stripe = stripeApi ?? requireHostedStripeApi();
  const metadata = {
    ...buildHostedFamilyStripeMetadata(checkoutInput.group),
    checkoutAttemptId: checkoutInput.checkoutAttemptId,
  };
  const checkoutSession = await stripe.checkout.sessions.create({
    cancel_url: `${checkoutInput.publicBaseUrl}/settings`,
    client_reference_id: checkoutInput.group.id,
    ...(checkoutInput.stripeCustomerId
      ? { customer: checkoutInput.stripeCustomerId }
      : {}),
    line_items: [{
      price: checkoutInput.priceId,
      quantity: checkoutInput.seatCount,
    }],
    metadata,
    mode: "subscription",
    payment_method_types: ["card"],
    subscription_data: {
      metadata,
    },
    success_url: `${checkoutInput.publicBaseUrl}/settings?family_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
  }, {
    idempotencyKey: buildHostedFamilyCheckoutIdempotencyKey({
      attemptId: checkoutInput.checkoutAttemptId,
      groupId: checkoutInput.group.id,
      priceId: checkoutInput.priceId,
      seatCount: checkoutInput.seatCount,
      stripeCustomerId: checkoutInput.stripeCustomerId,
    }),
  });

  if (!checkoutSession.url) {
    throw hostedOnboardingError({
      code: "CHECKOUT_URL_MISSING",
      httpStatus: 502,
      message: "Stripe Checkout did not return a redirect URL.",
    });
  }
  await prisma.$transaction(async (tx) => {
    await bindHostedFamilyCheckoutSessionTx({
      attemptId: checkoutInput.checkoutAttemptId,
      group: checkoutInput.group,
      sessionId: checkoutSession.id,
      tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return {
    alreadyActive: false,
    url: buildHostedFamilyCheckoutRedirectUrl({ checkoutUrl: checkoutSession.url }) ??
      checkoutSession.url,
  };
}

function isHostedFamilyDirectPaidUpgradeInput(
  input: HostedFamilyBillingCheckoutInput,
): input is HostedFamilyDirectPaidUpgradeInput {
  return "mode" in input && input.mode === "directPaidUpgrade";
}

async function readHostedFamilyDirectPaidUpgradeInputTx(input: {
  group: HostedAccountGroupAccessSnapshot;
  seatCount: number;
  tx: Prisma.TransactionClient;
}): Promise<HostedFamilyDirectPaidUpgradeInput | null> {
  const member = await input.tx.hostedMember.findUnique({
    select: {
      billingStatus: true,
      suspendedAt: true,
    },
    where: {
      id: input.group.ownerMemberId,
    },
  });
  const billingRef = await readHostedMemberStripeBillingRef({
    memberId: input.group.ownerMemberId,
    prisma: input.tx,
  });

  if (
    member?.billingStatus !== HostedBillingStatus.active ||
    member.suspendedAt ||
    parseHostedBillingPhase(billingRef?.currentBillingPhase) !== "paid"
  ) {
    return null;
  }

  const currentPlanCode = parseHostedBillingPlanCode(billingRef?.currentBillingPlanCode);
  if (!currentPlanCode || !billingRef?.stripeCustomerId || !billingRef.stripeSubscriptionId) {
    return null;
  }

  const currentConfig = requireHostedStripeBillingPlanConfig({
    billingPlanCode: currentPlanCode,
  });

  return {
    alreadyActive: false,
    currentPlanCode,
    currentPriceId: currentConfig.priceId,
    group: input.group,
    mode: "directPaidUpgrade",
    seatCount: input.seatCount,
    stripeCustomerId: billingRef.stripeCustomerId,
    stripeSubscriptionId: billingRef.stripeSubscriptionId,
    targetPriceId: requireHostedFamilyStripePriceId(),
  };
}

async function upgradeHostedFamilyDirectPaidSubscription(
  input: HostedFamilyDirectPaidUpgradeInput & { prisma: PrismaClient },
): Promise<{ alreadyActive: boolean; url: string | null }> {
  const stripe = requireHostedStripeApi();
  const subscription = await callHostedFamilyDirectPaidStripeOperation(
    "subscription.retrieve",
    () => stripe.subscriptions.retrieve(input.stripeSubscriptionId, {
      expand: ["items.data.price"],
    }),
  );

  assertHostedFamilyDirectPaidSubscriptionMatchesCustomer({
    stripeCustomerId: input.stripeCustomerId,
    subscription,
  });

  const familyMetadata = buildHostedFamilyDirectPaidSubscriptionMetadata(input.group);
  const appliedSubscription = isHostedFamilyDirectPaidSubscriptionApplied({
    seatCount: input.seatCount,
    subscription,
    targetPriceId: input.targetPriceId,
  })
    ? await normalizeHostedFamilyDirectPaidSubscriptionMetadata({
        group: input.group,
        stripe,
        stripeSubscriptionId: input.stripeSubscriptionId,
        subscription,
      })
    : await callHostedFamilyDirectPaidStripeOperation(
        "subscription.update.family-items",
        () =>
          stripe.subscriptions.update(input.stripeSubscriptionId, {
            expand: ["items.data.price"],
            items: buildHostedFamilyDirectPaidSubscriptionItems({
              ...input,
              subscription,
            }),
            metadata: familyMetadata,
            payment_behavior: "pending_if_incomplete",
            proration_behavior: "always_invoice",
          }, {
            idempotencyKey: buildHostedFamilyDirectPaidUpgradeIdempotencyKey(input),
          }),
      );

  if (!isHostedFamilyDirectPaidSubscriptionApplied({
    seatCount: input.seatCount,
    subscription: appliedSubscription,
    targetPriceId: input.targetPriceId,
  })) {
    return {
      alreadyActive: false,
      url: await createHostedFamilyDirectPaidUpgradePortalUrl({
        stripe,
        stripeCustomerId: input.stripeCustomerId,
      }),
    };
  }

  await reconcileHostedFamilyDirectPaidUpgrade({
    group: input.group,
    prisma: input.prisma,
    subscription: appliedSubscription,
  });

  return {
    alreadyActive: true,
    url: null,
  };
}

function buildHostedFamilyDirectPaidSubscriptionItems(
  input: HostedFamilyDirectPaidUpgradeInput & { subscription: Stripe.Subscription },
): Stripe.SubscriptionUpdateParams.Item[] {
  const recurringItem = findHostedFamilyStripeSubscriptionItemByPriceId(
    input.subscription,
    input.currentPriceId,
  );

  if (!recurringItem) {
    throw buildHostedFamilyDirectPaidSubscriptionItemsUnsupportedError();
  }

  const items: Stripe.SubscriptionUpdateParams.Item[] = [{
    id: recurringItem.id,
    price: input.targetPriceId,
    quantity: input.seatCount,
  }];

  for (const item of input.subscription.items.data) {
    if (item.id === recurringItem.id) {
      continue;
    }
    if (isHostedStripeLegacyAiUsageMeteredItem(item)) {
      items.push({
        deleted: true,
        id: item.id,
      });
      continue;
    }
    throw buildHostedFamilyDirectPaidSubscriptionItemsUnsupportedError();
  }

  return items;
}

async function normalizeHostedFamilyDirectPaidSubscriptionMetadata(input: {
  group: HostedAccountGroupAccessSnapshot;
  stripe: Stripe;
  stripeSubscriptionId: string;
  subscription: Stripe.Subscription;
}): Promise<Stripe.Subscription> {
  if (isHostedFamilyDirectPaidSubscriptionMetadataNormalized(input)) {
    return input.subscription;
  }

  return callHostedFamilyDirectPaidStripeOperation(
    "subscription.update.family-metadata",
    () =>
      input.stripe.subscriptions.update(input.stripeSubscriptionId, {
        expand: ["items.data.price"],
        metadata: buildHostedFamilyDirectPaidSubscriptionMetadata(input.group),
      }, {
        idempotencyKey: buildHostedFamilyDirectPaidMetadataIdempotencyKey({
          groupId: input.group.id,
          stripeSubscriptionId: input.stripeSubscriptionId,
        }),
      }),
  );
}

function buildHostedFamilyDirectPaidSubscriptionMetadata(
  group: Pick<HostedAccountGroupAccessSnapshot, "id" | "ownerMemberId">,
): Stripe.MetadataParam {
  return {
    ...buildHostedFamilyStripeMetadata(group),
    ...buildHostedFamilyStripeMetadataUnsetFields([
      "checkoutOffer",
      "memberId",
      "trialDurationDays",
      "trialPolicyVersion",
      "trialUsageLimitUsdMicros",
    ]),
  };
}

function buildHostedFamilyStripeMetadataUnsetFields(keys: readonly string[]): Stripe.MetadataParam {
  return Object.fromEntries(keys.map((key) => [key, ""]));
}

function isHostedFamilyDirectPaidSubscriptionMetadataNormalized(input: {
  group: Pick<HostedAccountGroupAccessSnapshot, "id" | "ownerMemberId">;
  subscription: Stripe.Subscription;
}): boolean {
  const metadata = input.subscription.metadata ?? {};

  return metadata.accountGroupId === input.group.id &&
    metadata.billingPlanCode === HOSTED_FAMILY_BILLING_PLAN_CODE &&
    metadata.kind === HOSTED_FAMILY_STRIPE_METADATA_KIND &&
    metadata.ownerMemberId === input.group.ownerMemberId &&
    !hasOwnStripeMetadataKey(metadata, "checkoutOffer") &&
    !hasOwnStripeMetadataKey(metadata, "memberId") &&
    !hasOwnStripeMetadataKey(metadata, "trialDurationDays") &&
    !hasOwnStripeMetadataKey(metadata, "trialPolicyVersion") &&
    !hasOwnStripeMetadataKey(metadata, "trialUsageLimitUsdMicros");
}

function hasOwnStripeMetadataKey(metadata: Stripe.Metadata, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(metadata, key);
}

function isHostedFamilyDirectPaidSubscriptionApplied(input: {
  seatCount: number;
  subscription: Stripe.Subscription;
  targetPriceId: string;
}): boolean {
  if (input.subscription.pending_update) {
    return false;
  }
  if (input.subscription.status !== "active") {
    return false;
  }

  const item = findHostedFamilyStripeSubscriptionItemByPriceId(
    input.subscription,
    input.targetPriceId,
  );
  return item?.quantity === input.seatCount;
}

function findHostedFamilyStripeSubscriptionItemByPriceId(
  subscription: Stripe.Subscription,
  priceId: string,
): Stripe.SubscriptionItem | null {
  return subscription.items.data.find((item) => item.price?.id === priceId) ?? null;
}

function assertHostedFamilyDirectPaidSubscriptionMatchesCustomer(input: {
  stripeCustomerId: string;
  subscription: Stripe.Subscription;
}): void {
  const subscriptionCustomerId = coerceStripeObjectId(input.subscription.customer);
  if (subscriptionCustomerId === input.stripeCustomerId) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_FAMILY_DIRECT_PAID_STRIPE_CUSTOMER_MISMATCH",
    httpStatus: 409,
    message: "Your subscription could not be matched to this hosted account.",
  });
}

function buildHostedFamilyDirectPaidSubscriptionItemsUnsupportedError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_FAMILY_DIRECT_PAID_SUBSCRIPTION_ITEMS_UNSUPPORTED",
    httpStatus: 409,
    message: "Your subscription items are not ready for this Family plan change.",
  });
}

async function createHostedFamilyDirectPaidUpgradePortalUrl(input: {
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<string> {
  const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
  const session = await callHostedFamilyDirectPaidStripeOperation(
    "billingPortal.sessions.create",
    () =>
      input.stripe.billingPortal.sessions.create({
        customer: input.stripeCustomerId,
        return_url: new URL("/settings", publicBaseUrl).toString(),
      }),
  );

  if (!session.url) {
    throw hostedOnboardingError({
      code: "STRIPE_PORTAL_SESSION_MISSING_URL",
      httpStatus: 502,
      message: "Stripe did not return a billing portal URL.",
    });
  }

  return session.url;
}

async function reconcileHostedFamilyDirectPaidUpgrade(input: {
  group: HostedAccountGroupAccessSnapshot;
  prisma: PrismaClient;
  subscription: Stripe.Subscription;
}): Promise<void> {
  const occurredAt = new Date();
  await input.prisma.$transaction(async (tx) => {
    const familySeatItem = readHostedFamilyStripeSeatSubscriptionItem(input.subscription);
    if (!familySeatItem) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_DIRECT_PAID_RECONCILIATION_PENDING",
        httpStatus: 409,
        message: "Your Family plan change is still syncing. Try again shortly.",
        retryable: true,
      });
    }

    const activeMembershipCount = await tx.hostedAccountGroupMembership.count({
      where: {
        groupId: input.group.id,
        status: "active",
      },
    });
    const stripeBillingStatus = mapStripeSubscriptionStatusToHostedBillingStatus(
      input.subscription.status,
    );
    const activeMembersFitPaidSeats = activeMembershipCount <= familySeatItem.billedSeatCount;
    const billingStatus = stripeBillingStatus === HostedBillingStatus.active &&
        !activeMembersFitPaidSeats
      ? HostedBillingStatus.unpaid
      : stripeBillingStatus;

    await writeHostedAccountGroupStripeBillingTx({
      billingStatus,
      currentBillingPhase:
        input.subscription.status === "active" && activeMembersFitPaidSeats ? "paid" : null,
      currentBillingPlanCode: HOSTED_FAMILY_BILLING_PLAN_CODE,
      ...buildHostedFamilyStripeSubscriptionPeriodSnapshot(
        input.subscription,
        familySeatItem.stripeSubscriptionItem,
      ),
      billedSeatCount: familySeatItem.billedSeatCount,
      groupId: input.group.id,
      stripeCustomerId: coerceStripeObjectId(input.subscription.customer),
      stripeEventCreatedAt: occurredAt,
      stripeSubscriptionItemId: familySeatItem.stripeSubscriptionItemId,
      stripeSubscriptionId: input.subscription.id,
      tx,
    });

    if (billingStatus === HostedBillingStatus.active) {
      await revokeNewestHostedFamilyPendingInvitesToFitBilledSeatsTx({
        billedSeatCount: familySeatItem.billedSeatCount,
        groupId: input.group.id,
        now: occurredAt,
        tx,
      });
      await activateHostedFamilyGroupMembersForActiveBillingTx({
        groupId: input.group.id,
        occurredAt,
        sourceEventId: `family-subscription:${input.subscription.id}`,
        tx,
      });
    }

    await clearHostedFamilyOwnerDirectPaidBillingTx({
      ownerMemberId: input.group.ownerMemberId,
      tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function clearHostedFamilyOwnerDirectPaidBillingTx(input: {
  ownerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.hostedMember.update({
    data: {
      billingStatus: HostedBillingStatus.not_started,
    },
    where: {
      id: input.ownerMemberId,
    },
  });
  await input.tx.hostedMemberBillingRef.updateMany({
    data: {
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      currentCheckoutOffer: null,
      currentPeriodEnd: null,
      currentPeriodStart: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
      stripeCustomerIdEncrypted: null,
      stripeCustomerLookupKey: null,
      stripeSubscriptionIdEncrypted: null,
      stripeSubscriptionLookupKey: null,
      stripeSubscriptionScheduleIdEncrypted: null,
      stripeSubscriptionScheduleLookupKey: null,
    },
    where: {
      memberId: input.ownerMemberId,
    },
  });
}

function buildHostedFamilyDirectPaidUpgradeIdempotencyKey(
  input: HostedFamilyDirectPaidUpgradeInput,
): string {
  return [
    "hosted-family-direct-paid-upgrade",
    input.group.id,
    input.stripeSubscriptionId,
    input.currentPlanCode,
    input.currentPriceId,
    input.targetPriceId,
    `seats-${input.seatCount}`,
  ].join(":");
}

function buildHostedFamilyDirectPaidMetadataIdempotencyKey(input: {
  groupId: string;
  stripeSubscriptionId: string;
}): string {
  return [
    "hosted-family-direct-paid-metadata",
    input.groupId,
    input.stripeSubscriptionId,
  ].join(":");
}

async function callHostedFamilyDirectPaidStripeOperation<T>(
  operationName: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isHostedOnboardingError(error)) {
      throw error;
    }
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_DIRECT_PAID_STRIPE_UNAVAILABLE",
      details: {
        operationName,
        ...describeSafeHostedFamilyDirectPaidStripeError(error),
      },
      httpStatus: 502,
      message: "Stripe billing is unavailable for Family plan changes right now. Try again shortly.",
      retryable: true,
    });
  }
}

function describeSafeHostedFamilyDirectPaidStripeError(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) {
    return {
      type: typeof error,
    };
  }

  const code = Reflect.get(error, "code");
  const statusCode = Reflect.get(error, "statusCode");
  const type = Reflect.get(error, "type");
  const requestId = Reflect.get(error, "requestId");

  return {
    ...(typeof type === "string" && type.length > 0 ? { type } : {}),
    ...(typeof code === "string" && code.length > 0 ? { code } : {}),
    ...(typeof statusCode === "number" ? { statusCode } : {}),
    requestIdPresent: typeof requestId === "string" && requestId.length > 0,
  };
}

export async function updateHostedFamilySeatCount(input: {
  groupId: string;
  now?: Date;
  ownerMemberId: string;
  prisma?: PrismaClient;
  targetSeatCount: unknown;
}): Promise<HostedFamilyOwnerSnapshot> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const targetSeatCount = normalizeHostedFamilySeatCount(input.targetSeatCount);
  const seatChange = await prisma.$transaction(async (tx) => {
    const group = await tx.hostedAccountGroup.findUnique({
      select: hostedAccountGroupAccessSelect,
      where: {
        id: input.groupId,
      },
    });
    if (!group || group.ownerMemberId !== input.ownerMemberId) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_OWNER_REQUIRED",
        httpStatus: 403,
        message: "Only the family plan owner can change family seats.",
      });
    }
    if (!hasHostedAccountGroupAccess(group)) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_BILLING_INACTIVE",
        httpStatus: 409,
        message: "Family billing must be active before changing seats.",
      });
    }

    await lockHostedMemberRow(tx, group.ownerMemberId);
    await assertHostedFamilyOwnerCanStartBillingTx({
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      tx,
    });

    const [billingRef, activeMemberships, pendingInvites] = await Promise.all([
      readHostedAccountGroupStripeBillingRef({
        groupId: group.id,
        prisma: tx,
      }),
      tx.hostedAccountGroupMembership.count({
        where: {
          groupId: group.id,
          status: "active",
        },
      }),
      tx.hostedAccountGroupInvite.count({
        where: {
          expiresAt: {
            gt: now,
          },
          groupId: group.id,
          status: "pending",
        },
      }),
    ]);

    const usedSeats = activeMemberships + pendingInvites;
    if (targetSeatCount < usedSeats) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_SEAT_COUNT_BELOW_USAGE",
        httpStatus: 409,
        message: "Family seats cannot be reduced below active members and pending invites.",
      });
    }
    if (!billingRef?.stripeSubscriptionItemId || billingRef.billedSeatCount === null) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_SUBSCRIPTION_ITEM_REQUIRED",
        httpStatus: 409,
        message: "Family seat billing is still syncing. Try again after payment is confirmed.",
      });
    }

    return {
      currentSeatCount: billingRef.billedSeatCount,
      group,
      stripeSubscriptionItemId: billingRef.stripeSubscriptionItemId,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (seatChange.currentSeatCount !== targetSeatCount) {
    const increase = targetSeatCount > seatChange.currentSeatCount;
    const updateParams: Stripe.SubscriptionItemUpdateParams = {
      quantity: targetSeatCount,
      proration_behavior: increase ? "always_invoice" : "none",
      ...(increase ? { payment_behavior: "error_if_incomplete" } : {}),
    };
    const stripeItem = await requireHostedStripeApi().subscriptionItems.update(
      seatChange.stripeSubscriptionItemId,
      updateParams,
    );

    if (stripeItem.quantity !== targetSeatCount) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_SEAT_COUNT_UPDATE_UNCONFIRMED",
        httpStatus: 502,
        message: "Stripe did not confirm the requested Family seat count.",
      });
    }

    // Stripe owns the durable seat quantity. The subscription webhook reconciler
    // is the only local writer of billedSeatCount so event freshness has one fence.
    // Callers that need the new count reflected (invite-and-add, UI) wait for the
    // webhook via waitForHostedFamilyBilledSeatCount instead of writing it here.
  }

  const snapshot = await readHostedFamilyOwnerSnapshotForMember({
    memberId: input.ownerMemberId,
    now,
    prisma,
  });
  if (!snapshot || snapshot.groupId !== input.groupId) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_GROUP_NOT_FOUND",
      httpStatus: 404,
      message: "Family plan not found.",
    });
  }

  return snapshot;
}

/**
 * Poll until the subscription webhook reconciles billedSeatCount to the target,
 * so callers can chain on a confirmed seat (invite-and-add) or show the real
 * count after an add or remove. Returns false if the deadline passes first.
 */
export async function waitForHostedFamilyBilledSeatCount(input: {
  groupId: string;
  intervalMs?: number;
  prisma?: HostedOnboardingReadClient;
  targetSeatCount: number;
  timeoutMs?: number;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const intervalMs = input.intervalMs ?? 400;
  // Keep the wait short so it stays well inside the request budget and reads as a
  // brief spinner; a slow webhook falls back to the syncing response and refresh.
  const deadline = Date.now() + (input.timeoutMs ?? 6_000);
  for (;;) {
    const billedSeatCount = await readHostedFamilyBilledSeatCountTx({
      groupId: input.groupId,
      tx: prisma,
    });
    if (billedSeatCount === input.targetSeatCount) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function writeHostedFamilyCheckoutAttemptTx(input: {
  attemptId: string;
  group: Pick<HostedAccountGroupAccessSnapshot, "id">;
  seatCount: number;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const now = new Date();
  await input.tx.hostedAccountGroupBillingRef.upsert({
    create: {
      checkoutAttemptId: input.attemptId,
      checkoutCreatedAt: now,
      checkoutSeatCount: input.seatCount,
      currentBillingPlanCode: HOSTED_FAMILY_BILLING_PLAN_CODE,
      groupId: input.group.id,
    },
    update: {
      checkoutAttemptId: input.attemptId,
      checkoutCreatedAt: now,
      checkoutSeatCount: input.seatCount,
      currentBillingPlanCode: HOSTED_FAMILY_BILLING_PLAN_CODE,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
    },
    where: {
      groupId: input.group.id,
    },
  });
}

async function bindHostedFamilyCheckoutSessionTx(input: {
  attemptId: string;
  group: Pick<HostedAccountGroupAccessSnapshot, "id" | "ownerMemberId">;
  sessionId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const stripeCheckoutSessionLookupKey = createHostedStripeCheckoutSessionLookupKey(
    input.sessionId,
  );
  const stripeCheckoutSessionIdEncrypted = await encryptHostedWebNullableString({
    field: HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CHECKOUT_SESSION_FIELD,
    memberId: input.group.ownerMemberId,
    prisma: input.tx,
    value: input.sessionId,
  });
  const updated = await input.tx.hostedAccountGroupBillingRef.updateMany({
    data: {
      stripeCheckoutSessionIdEncrypted,
      stripeCheckoutSessionLookupKey,
    },
    where: {
      checkoutAttemptId: input.attemptId,
      groupId: input.group.id,
    },
  });
  if (updated.count !== 1) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_CHECKOUT_ATTEMPT_STALE",
      httpStatus: 409,
      message: "Family checkout changed before Stripe returned a session. Start Family checkout again.",
    });
  }
}

export function readHostedFamilyCheckoutSessionIdFromUrl(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }

  return url.pathname
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .find(isHostedFamilyCheckoutSessionId) ?? null;
}

export function buildHostedFamilyCheckoutRedirectUrl(input: {
  checkoutUrl: string | null | undefined;
  publicBaseUrl?: string | null;
}): string | null {
  const sessionId = readHostedFamilyCheckoutSessionIdFromUrl(input.checkoutUrl);
  if (!sessionId) {
    return null;
  }

  const publicBaseUrl = normalizeNullableString(input.publicBaseUrl) ??
    requireHostedOnboardingPublicBaseUrl();
  const url = new URL(publicBaseUrl);
  url.pathname = `/checkout/family/${encodeURIComponent(sessionId)}`;
  url.search = "";
  url.hash = "";

  return url.toString();
}

export async function resolveHostedFamilyCheckoutRedirectUrl(input: {
  prisma?: HostedOnboardingReadClient;
  sessionId: string;
}): Promise<string> {
  const sessionId = normalizeNullableString(input.sessionId);
  if (!sessionId || !isHostedFamilyCheckoutSessionId(sessionId)) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_CHECKOUT_SESSION_INVALID",
      httpStatus: 404,
      message: "Family checkout session was not found.",
    });
  }

  const session = await requireHostedStripeApi().checkout.sessions.retrieve(sessionId);
  if (!isHostedFamilyCheckoutSession(session)) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_CHECKOUT_SESSION_INVALID",
      httpStatus: 404,
      message: "Family checkout session was not found.",
    });
  }

  const prisma = input.prisma ?? getPrisma();
  const group = await findHostedAccountGroupForStripeCheckoutSession({
    prisma,
    session,
  });
  if (!group || session.metadata?.ownerMemberId !== group.ownerMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_CHECKOUT_SESSION_INVALID",
      httpStatus: 404,
      message: "Family checkout session was not found.",
    });
  }

  const checkoutUrl = normalizeNullableString(session.url);
  if (!checkoutUrl) {
    await clearHostedFamilyCheckoutAttemptForSession({
      groupId: group.id,
      prisma,
      sessionId,
    });
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_CHECKOUT_SESSION_UNAVAILABLE",
      httpStatus: 410,
      message: "Family checkout session is no longer available. Start Family checkout again.",
    });
  }

  return checkoutUrl;
}

async function clearHostedFamilyCheckoutAttemptForSession(input: {
  groupId: string;
  prisma: HostedOnboardingReadClient;
  sessionId: string;
}): Promise<void> {
  const stripeCheckoutSessionLookupKey = createHostedStripeCheckoutSessionLookupKey(
    input.sessionId,
  );
  if (!stripeCheckoutSessionLookupKey) {
    return;
  }

  await input.prisma.hostedAccountGroupBillingRef.updateMany({
    data: {
      checkoutAttemptId: null,
      checkoutCreatedAt: null,
      checkoutSeatCount: null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
    },
    where: {
      groupId: input.groupId,
      stripeCheckoutSessionLookupKey,
    },
  });
}

export async function createHostedAccountGroupForOwner(input: {
  displayName?: string | null;
  groupId?: string;
  now?: Date;
  ownerMemberId: string;
  prisma?: PrismaClient;
}): Promise<HostedAccountGroupAccessSnapshot> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => createHostedAccountGroupForOwnerTx({
    ...input,
    tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function createHostedAccountGroupForOwnerTx(input: {
  displayName?: string | null;
  groupId?: string;
  now?: Date;
  ownerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedAccountGroupAccessSnapshot> {
  const now = input.now ?? new Date();
  const groupId = input.groupId ?? generateHostedAccountGroupId();

  await lockHostedMemberRow(input.tx, input.ownerMemberId);
  await assertHostedFamilyOwnerCanStartBillingTx({
    allowDirectPaidOwner: true,
    groupId,
    ownerMemberId: input.ownerMemberId,
    tx: input.tx,
  });

  const group = await input.tx.hostedAccountGroup.create({
    data: {
      billingStatus: HostedBillingStatus.not_started,
      displayName: normalizeFamilyLabel(input.displayName),
      id: groupId,
      ownerMemberId: input.ownerMemberId,
      memberships: {
        create: {
          id: generateHostedAccountGroupMembershipId(),
          joinedAt: now,
          memberId: input.ownerMemberId,
          role: "owner",
          status: "active",
        },
      },
    },
    select: hostedAccountGroupAccessSelect,
  });

  return group;
}

export async function ensureHostedAccountGroupForOwnerTx(input: {
  displayName?: string | null;
  now?: Date;
  ownerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedAccountGroupAccessSnapshot> {
  await lockHostedMemberRow(input.tx, input.ownerMemberId);

  const existingGroup = await input.tx.hostedAccountGroup.findFirst({
    select: hostedAccountGroupAccessSelect,
    where: {
      ownerMemberId: input.ownerMemberId,
    },
  });
  if (existingGroup) {
    await assertHostedFamilyMemberNotSponsoredElsewhereTx({
      groupId: existingGroup.id,
      memberId: input.ownerMemberId,
      tx: input.tx,
    });
    if (!hasHostedAccountGroupAccess(existingGroup)) {
      await assertHostedFamilyMemberNotDirectPaidTx({
        allowDirectPaidOwner: true,
        memberId: input.ownerMemberId,
        tx: input.tx,
      });
    }
    return existingGroup;
  }

  return createHostedAccountGroupForOwnerTx({
    displayName: input.displayName,
    now: input.now,
    ownerMemberId: input.ownerMemberId,
    tx: input.tx,
  });
}

export async function issueHostedFamilyInvite(input: {
  groupId: string;
  invitedByMemberId: string;
  now?: Date;
  prisma?: PrismaClient;
  targetEmail?: string | null;
  targetLabel?: string | null;
  targetPhoneNumber?: string | null;
  targetTelegramUsername?: string | null;
  ttlHours?: number;
}): Promise<HostedAccountGroupInvitePrivateSnapshot> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => issueHostedFamilyInviteTx({
    ...input,
    tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

/**
 * Whether an invite target has a contact the issuer can dedup on (phone, email,
 * or Telegram) after normalization. Mirrors the reuse-key logic in
 * issueHostedFamilyInviteTx so callers can gate retry-unsafe side effects (paid
 * seat auto-add) on the same validity, not on raw non-empty strings.
 */
export function hostedFamilyInviteHasReusableTarget(input: {
  targetEmail?: string | null;
  targetPhoneNumber?: string | null;
  targetTelegramUsername?: string | null;
}): boolean {
  const phone = createHostedPhoneLookupKeyReadCandidates(
    normalizePhoneNumber(input.targetPhoneNumber),
  );
  const telegram = createHostedTelegramUsernameLookupKeyReadCandidates(
    normalizeHostedTelegramUsernameForLookup(input.targetTelegramUsername),
  );
  const email = createHostedEmailLookupKeyReadCandidates(
    normalizeHostedEmailAddress(input.targetEmail),
  );
  return phone.length > 0 || telegram.length > 0 || email.length > 0;
}

export async function issueHostedFamilyInviteTx(input: {
  groupId: string;
  invitedByMemberId: string;
  now?: Date;
  targetEmail?: string | null;
  targetLabel?: string | null;
  targetPhoneNumber?: string | null;
  targetTelegramUsername?: string | null;
  ttlHours?: number;
  tx: Prisma.TransactionClient;
}): Promise<HostedAccountGroupInvitePrivateSnapshot> {
  const now = input.now ?? new Date();
  const ttlHours = input.ttlHours ?? 24 * 7;
  const group = await input.tx.hostedAccountGroup.findUnique({
    select: hostedAccountGroupAccessSelect,
    where: {
      id: input.groupId,
    },
  });

  if (!group) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_GROUP_NOT_FOUND",
      httpStatus: 404,
      message: "Family plan not found.",
    });
  }

  if (group.ownerMemberId !== input.invitedByMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_OWNER_REQUIRED",
      httpStatus: 403,
      message: "Only the family plan owner can invite family members.",
    });
  }

  await lockHostedMemberRow(input.tx, input.invitedByMemberId);
  const billedSeatCount = await readConfirmedHostedFamilyBilledSeatCountTx({
    group,
    tx: input.tx,
  });

  const targetPhoneNumber = normalizePhoneNumber(input.targetPhoneNumber);
  const targetPhoneLookupKey = createHostedPhoneLookupKey(targetPhoneNumber);
  const targetTelegramUsername = normalizeHostedTelegramUsernameForLookup(
    input.targetTelegramUsername,
  );
  const targetTelegramUsernameLookupKey = createHostedTelegramUsernameLookupKey(
    targetTelegramUsername,
  );
  const targetEmail = normalizeHostedEmailAddress(input.targetEmail);
  const targetEmailLookupKey = createHostedEmailLookupKey(targetEmail);
  const phoneLookupCandidates = createHostedPhoneLookupKeyReadCandidates(targetPhoneNumber);
  const telegramLookupCandidates =
    createHostedTelegramUsernameLookupKeyReadCandidates(targetTelegramUsername);
  const emailLookupCandidates = createHostedEmailLookupKeyReadCandidates(targetEmail);
  const reuseConditions: Prisma.HostedAccountGroupInviteWhereInput[] = [
    ...(phoneLookupCandidates.length > 0
      ? [{ targetPhoneLookupKey: { in: phoneLookupCandidates } }]
      : []),
    ...(telegramLookupCandidates.length > 0
      ? [{ targetTelegramUsernameLookupKey: { in: telegramLookupCandidates } }]
      : []),
    ...(emailLookupCandidates.length > 0
      ? [{ targetEmailLookupKey: { in: emailLookupCandidates } }]
      : []),
  ];
  const existingTargetInvite = reuseConditions.length > 0
    ? await input.tx.hostedAccountGroupInvite.findFirst({
        orderBy: {
          createdAt: "asc",
        },
        select: hostedAccountGroupInviteSelect,
        where: {
          OR: reuseConditions,
          expiresAt: {
            gt: now,
          },
          groupId: group.id,
          status: "pending",
        },
      })
    : null;
  if (existingTargetInvite) {
    return projectHostedFamilyInvitePrivateSnapshot(existingTargetInvite, input.tx);
  }

  await assertHostedFamilySeatAvailableTx({
    billedSeatCount,
    group,
    now,
    tx: input.tx,
  });

  const targetPhoneNumberEncrypted = await encryptHostedWebNullableString({
    field: HOSTED_ACCOUNT_GROUP_INVITE_TARGET_PHONE_FIELD,
    memberId: group.ownerMemberId,
    prisma: input.tx,
    value: targetPhoneNumber,
  });
  const targetTelegramUsernameEncrypted = await encryptHostedWebNullableString({
    field: HOSTED_ACCOUNT_GROUP_INVITE_TARGET_TELEGRAM_USERNAME_FIELD,
    memberId: group.ownerMemberId,
    prisma: input.tx,
    value: targetTelegramUsername,
  });
  const targetEmailEncrypted = await encryptHostedWebNullableString({
    field: HOSTED_ACCOUNT_GROUP_INVITE_TARGET_EMAIL_FIELD,
    memberId: group.ownerMemberId,
    prisma: input.tx,
    value: targetEmail,
  });

  const invite = await input.tx.hostedAccountGroupInvite.create({
    data: {
      channel: "family",
      expiresAt: inviteExpiresAt(now, ttlHours),
      groupId: group.id,
      id: generateHostedAccountGroupInviteId(),
      invitedByMemberId: input.invitedByMemberId,
      inviteCode: generateHostedInviteCode(),
      status: "pending",
      targetEmailEncrypted,
      targetEmailLookupKey,
      targetLabel: normalizeFamilyLabel(input.targetLabel),
      targetPhoneLookupKey,
      targetPhoneNumberEncrypted,
      targetTelegramUsernameEncrypted,
      targetTelegramUsernameLookupKey,
    },
    select: hostedAccountGroupInviteSelect,
  });

  return projectHostedFamilyInvitePrivateSnapshot(invite, input.tx);
}

export async function issueHostedFamilyInviteFromOwnerTx(input: {
  now?: Date;
  ownerMemberId: string;
  targetEmail?: string | null;
  targetLabel?: string | null;
  targetPhoneNumber?: string | null;
  targetTelegramUsername?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedFamilyChatInviteResult> {
  const now = input.now ?? new Date();
  const group = await ensureHostedAccountGroupForOwnerTx({
    now,
    ownerMemberId: input.ownerMemberId,
    tx: input.tx,
  });
  const invite = await issueHostedFamilyInviteTx({
    groupId: group.id,
    invitedByMemberId: input.ownerMemberId,
    now,
    targetEmail: input.targetEmail ?? null,
    targetLabel: input.targetLabel ?? null,
    targetPhoneNumber: input.targetPhoneNumber ?? null,
    targetTelegramUsername: input.targetTelegramUsername ?? null,
    tx: input.tx,
  });
  const { publicBaseUrl, telegramBotUsername } = readHostedOnboardingEnvironment();

  return {
    group,
    invite,
    replyText: buildHostedFamilyInviteReplyText({
      invite,
      publicBaseUrl,
      telegramBotUsername,
    }),
  };
}

export async function appendHostedFamilyChatNotificationTx(input: {
  occurredAt: string;
  memberId: string;
  message: string;
  route: HostedExecutionAssistantNotificationRoute | null;
  sourceEventId: string;
  tx: Prisma.TransactionClient;
}): Promise<{ mailboxItemId: string | null }> {
  if (!input.route) {
    return {
      mailboxItemId: null,
    };
  }

  const eventId = `assistant.notification.requested:family-chat:${input.memberId}:${input.sourceEventId}`;
  const append = await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionAssistantNotificationRequestedWake({
      eventId,
      memberId: input.memberId,
      notification: {
        deliveryDedupeToken: eventId,
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: eventId,
        instructions: "Send the exact Murph Family reply in responsePolicy.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: input.message,
        },
        route: input.route,
      },
      occurredAt: input.occurredAt,
    }),
    tx: input.tx,
  });

  return {
    mailboxItemId: append.item.id,
  };
}

export async function resolveHostedFamilyChatNotificationRouteTx(input: {
  fallbackTelegramThreadId?: string | null;
  fallbackTelegramUserId?: string | null;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedExecutionAssistantNotificationRoute | null> {
  const [identity, routing] = await Promise.all([
    readHostedMemberIdentity({
      memberId: input.memberId,
      prisma: input.tx,
    }),
    readHostedMemberRoutingState({
      memberId: input.memberId,
      prisma: input.tx,
    }),
  ]);

  return resolveHostedMemberAssistantNotificationRoute({
    linqChatId: routing?.linqChatId ?? routing?.pendingLinqChatId ?? null,
    linqContactLookupKey:
      routing?.pendingLinqParticipantContact?.lookupKey
      ?? identity?.phoneLookupKey
      ?? null,
    linqRecipientPhone: routing?.linqRecipientPhone ?? null,
    memberId: input.memberId,
    memberPhoneNumber: identity?.phoneNumber ?? null,
    messaging: resolveHostedMemberMessagingState({
      identity: {
        phoneLookupKey: identity?.phoneLookupKey ?? null,
      },
      routing: {
        linqChatId: routing?.linqChatId ?? null,
        pendingLinqChatId: routing?.pendingLinqChatId ?? null,
        pendingLinqParticipantContact: routing?.pendingLinqParticipantContact ?? null,
        telegramThreadId:
          routing?.telegramThreadId
          ?? input.fallbackTelegramThreadId
          ?? null,
        telegramUserId:
          routing?.telegramUserId
          ?? input.fallbackTelegramUserId
          ?? null,
      },
    }),
  });
}

export async function acceptHostedFamilyInvite(input: {
  acceptedMemberId: string;
  email?: string | null;
  inviteCode: string;
  now?: Date;
  phoneNumber?: string | null;
  prisma?: PrismaClient;
  requireWebBinding?: boolean;
}): Promise<HostedAccountGroupMembershipAccessSnapshot> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => acceptHostedFamilyInviteTx({
    ...input,
    tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export function parseHostedFamilyInviteStartToken(text: string | null | undefined): string | null {
  const normalized = normalizeNullableString(text);
  if (!normalized) {
    return null;
  }

  const token = normalized.match(/^\/?start\s+(family_[A-Za-z0-9_-]+)$/u)?.[1]
    ?? normalized.match(/^(family_[A-Za-z0-9_-]+)$/u)?.[1]
    ?? normalized.match(/(?:^|[^A-Za-z0-9_-])(family_[A-Za-z0-9_-]+)(?=$|[^A-Za-z0-9_-])/u)?.[1]
    ?? null;

  return token ? token.slice("family_".length) : null;
}

export async function resolveHostedFamilyInviteTokenForInbound(input: {
  prisma: HostedOnboardingReadClient;
  text: string | null | undefined;
}): Promise<string | null> {
  const inviteCode = parseHostedFamilyInviteStartToken(input.text);
  if (!inviteCode) {
    return null;
  }

  const invite = await input.prisma.hostedAccountGroupInvite.findUnique({
    select: {
      id: true,
    },
    where: {
      inviteCode,
    },
  });

  return invite ? inviteCode : null;
}

export async function acceptHostedFamilyInviteFromTelegramTx(input: {
  now?: Date;
  telegramThreadId?: string | null;
  telegramUsername?: string | null;
  telegramUserId: string;
  text: string | null | undefined;
  tx: Prisma.TransactionClient;
}): Promise<HostedAccountGroupMembershipAccessSnapshot | null> {
  const now = input.now ?? new Date();
  const startInviteCode = parseHostedFamilyInviteStartToken(input.text);
  let inviteCode = startInviteCode;
  if (inviteCode) {
    const activeInvite = await readHostedFamilyInviteCodePendingActiveTx({
      inviteCode,
      now,
      tx: input.tx,
    });
    if (!activeInvite) {
      inviteCode = await resolveHostedFamilyInviteCodeFromTelegramUsernameTx({
        now,
        telegramUsername: input.telegramUsername ?? null,
        tx: input.tx,
      });
    } else if (
      activeInvite.targetTelegramUsernameLookupKey &&
      !hostedTelegramUsernameLookupKeyMatchesValue(
        input.telegramUsername,
        activeInvite.targetTelegramUsernameLookupKey,
      )
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_INVITE_TELEGRAM_MISMATCH",
        httpStatus: 403,
        message: "This family invite was sent to a different Telegram username.",
      });
    }
  } else {
    inviteCode = await resolveHostedFamilyInviteCodeFromTelegramStartFallbackTx({
      now,
      telegramUsername: input.telegramUsername ?? null,
      text: input.text,
      tx: input.tx,
    });
  }
  if (!inviteCode) {
    return null;
  }

  const lookup = await resolveHostedMemberRoutingByTelegramUserId({
    prisma: input.tx,
    telegramUserId: input.telegramUserId,
  });
  if (lookup.status === "ambiguous") {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_TELEGRAM_IDENTITY_AMBIGUOUS",
      httpStatus: 409,
      message: "That Telegram account is linked to multiple hosted members. Contact support before accepting this family invite.",
    });
  }

  const member = lookup.status === "found"
    ? lookup.lookup.core
    : await createHostedMember({
        billingStatus: HostedBillingStatus.not_started,
        memberId: generateHostedMemberId(),
        prisma: input.tx,
      });
  await provisionActiveHostedDomainRootEnvelopeForUserOnly({
    domain: "control",
    prisma: input.tx,
    reason: "hosted-family.telegram-routing",
    userId: member.id,
  });
  await upsertHostedMemberTelegramRoutingBindingTx({
    memberId: member.id,
    prisma: input.tx,
    telegramThreadId: input.telegramThreadId,
    telegramUserId: input.telegramUserId,
  });

  return acceptHostedFamilyInviteTx({
    acceptedMemberId: member.id,
    inviteCode,
    now,
    telegramUsername: input.telegramUsername ?? null,
    tx: input.tx,
  });
}

async function readHostedFamilyInviteCodePendingActiveTx(input: {
  inviteCode: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<{
  targetTelegramUsernameLookupKey: string | null;
} | null> {
  const invite = await input.tx.hostedAccountGroupInvite.findUnique({
    select: {
      expiresAt: true,
      status: true,
      targetTelegramUsernameLookupKey: true,
    },
    where: {
      inviteCode: input.inviteCode,
    },
  });

  return invite?.status === "pending" && invite.expiresAt > input.now
    ? {
        targetTelegramUsernameLookupKey: invite.targetTelegramUsernameLookupKey,
      }
    : null;
}

async function resolveHostedFamilyInviteCodeFromTelegramStartFallbackTx(input: {
  now: Date;
  telegramUsername: string | null;
  text: string | null | undefined;
  tx: Prisma.TransactionClient;
}): Promise<string | null> {
  const normalizedText = normalizeNullableString(input.text);

  if (normalizedText !== "/start") {
    return null;
  }

  return resolveHostedFamilyInviteCodeFromTelegramUsernameTx({
    now: input.now,
    telegramUsername: input.telegramUsername,
    tx: input.tx,
  });
}

async function resolveHostedFamilyInviteCodeFromTelegramUsernameTx(input: {
  now: Date;
  telegramUsername: string | null;
  tx: Prisma.TransactionClient;
}): Promise<string | null> {
  const lookupKeys = createHostedTelegramUsernameLookupKeyReadCandidates(
    input.telegramUsername,
  );
  if (lookupKeys.length === 0) {
    return null;
  }

  const invites = await input.tx.hostedAccountGroupInvite.findMany({
    orderBy: {
      createdAt: "asc",
    },
    select: {
      inviteCode: true,
    },
    take: 2,
    where: {
      expiresAt: {
        gt: input.now,
      },
      status: "pending",
      targetTelegramUsernameLookupKey: {
        in: lookupKeys,
      },
    },
  });

  return invites.length === 1 ? invites[0]?.inviteCode ?? null : null;
}

export async function acceptHostedFamilyInviteFromPhoneTx(input: {
  now?: Date;
  onAcceptedMemberValidated?: (input: {
    acceptedMemberId: string;
    invite: HostedAccountGroupInviteSnapshot;
  }) => Promise<void>;
  phoneNumber: string;
  text: string | null | undefined;
  tx: Prisma.TransactionClient;
}): Promise<HostedAccountGroupMembershipAccessSnapshot | null> {
  const inviteCode = parseHostedFamilyInviteStartToken(input.text);
  if (!inviteCode) {
    return null;
  }
  const now = input.now ?? new Date();
  const invite = await input.tx.hostedAccountGroupInvite.findUnique({
    select: {
      expiresAt: true,
      status: true,
      targetEmailLookupKey: true,
      targetPhoneLookupKey: true,
      targetTelegramUsernameLookupKey: true,
    },
    where: {
      inviteCode,
    },
  });
  if (!invite) {
    return null;
  }
  const isFullyUnbound = hostedFamilyInviteIsFullyUnbound(invite);
  if (!invite.targetPhoneLookupKey && !isFullyUnbound) {
    return null;
  }
  if (
    invite.status !== "accepted" &&
    (invite.status !== "pending" || invite.expiresAt <= now)
  ) {
    return null;
  }
  if (
    invite.targetPhoneLookupKey &&
    !hostedPhoneLookupKeyMatchesValue(input.phoneNumber, invite.targetPhoneLookupKey)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_PHONE_MISMATCH",
      httpStatus: 403,
      message: "This family invite was sent to a different phone number.",
    });
  }

  const member = await ensureHostedMemberForPhoneTx({
    phoneNumber: input.phoneNumber,
    phoneNumberVerifiedAt: now,
    prisma: input.tx,
  });

  return acceptHostedFamilyInviteTx({
    acceptedMemberId: member.id,
    inviteCode,
    now,
    onAcceptedMemberValidated: input.onAcceptedMemberValidated,
    phoneNumber: input.phoneNumber,
    requirePhoneBinding: !isFullyUnbound,
    tx: input.tx,
  });
}

export async function acceptHostedFamilyInviteTx(input: {
  acceptedMemberId: string;
  email?: string | null;
  inviteCode: string;
  now?: Date;
  onAcceptedMemberValidated?: (input: {
    acceptedMemberId: string;
    invite: HostedAccountGroupInviteSnapshot;
  }) => Promise<void>;
  phoneNumber?: string | null;
  requirePhoneBinding?: boolean;
  requireWebBinding?: boolean;
  telegramUsername?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedAccountGroupMembershipAccessSnapshot> {
  const now = input.now ?? new Date();
  const invite = await input.tx.hostedAccountGroupInvite.findUnique({
    select: hostedAccountGroupInviteSelect,
    where: {
      inviteCode: input.inviteCode,
    },
  });

  if (!invite) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_NOT_FOUND",
      httpStatus: 404,
      message: "That family invite is no longer valid.",
    });
  }

  const isFullyUnbound = hostedFamilyInviteIsFullyUnbound(invite);

  if (
    input.requireWebBinding &&
    invite.targetTelegramUsernameLookupKey &&
    !invite.targetPhoneLookupKey &&
    !invite.targetEmailLookupKey
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_WEB_ACCEPT_REQUIRES_CONTACT",
      httpStatus: 409,
      message: "Open this invite from Telegram or WhatsApp to join.",
    });
  }

  if (
    input.requireWebBinding &&
    isFullyUnbound &&
    !normalizePhoneNumber(input.phoneNumber) &&
    !normalizeHostedEmailAddress(input.email)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_WEB_ACCEPT_REQUIRES_CONTACT",
      httpStatus: 409,
      message: "Sign in with a verified phone number or email address to join.",
    });
  }

  if (input.requirePhoneBinding && !invite.targetPhoneLookupKey) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_PHONE_REQUIRED",
      httpStatus: 403,
      message: "Open this invite from the invited phone number to join.",
    });
  }

  const phoneBindingMatches = Boolean(
    invite.targetPhoneLookupKey &&
    hostedPhoneLookupKeyMatchesValue(input.phoneNumber, invite.targetPhoneLookupKey),
  );
  const emailBindingMatches = Boolean(
    invite.targetEmailLookupKey &&
    hostedEmailLookupKeyMatchesValue(input.email, invite.targetEmailLookupKey),
  );
  const telegramUsernameWasPresented =
    Object.prototype.hasOwnProperty.call(input, "telegramUsername");
  const telegramBindingMatches = Boolean(
    telegramUsernameWasPresented &&
    invite.targetTelegramUsernameLookupKey &&
    hostedTelegramUsernameLookupKeyMatchesValue(
      input.telegramUsername,
      invite.targetTelegramUsernameLookupKey,
    ),
  );

  if (
    normalizeNullableString(input.phoneNumber) &&
    invite.targetPhoneLookupKey &&
    !phoneBindingMatches
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_PHONE_MISMATCH",
      httpStatus: 403,
      message: "This family invite was sent to a different phone number.",
    });
  }

  if (
    normalizeNullableString(input.email) &&
    invite.targetEmailLookupKey &&
    !emailBindingMatches
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_EMAIL_MISMATCH",
      httpStatus: 403,
      message: "This family invite was sent to a different email address.",
    });
  }

  if (
    telegramUsernameWasPresented &&
    invite.targetTelegramUsernameLookupKey &&
    !telegramBindingMatches
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_TELEGRAM_MISMATCH",
      httpStatus: 403,
      message: "This family invite was sent to a different Telegram username.",
    });
  }

  if (
    !isFullyUnbound &&
    !phoneBindingMatches &&
    !emailBindingMatches &&
    !telegramBindingMatches
  ) {
    if (invite.targetPhoneLookupKey) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_INVITE_PHONE_MISMATCH",
        httpStatus: 403,
        message: "This family invite was sent to a different phone number.",
      });
    }
    if (invite.targetEmailLookupKey) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_INVITE_EMAIL_MISMATCH",
        httpStatus: 403,
        message: "This family invite was sent to a different email address.",
      });
    }
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_TELEGRAM_MISMATCH",
      httpStatus: 403,
      message: "This family invite was sent to a different Telegram username.",
    });
  }

  if (invite.status === "accepted" && invite.acceptedByMemberId === input.acceptedMemberId) {
    const existingMembership = await input.tx.hostedAccountGroupMembership.findFirst({
      select: hostedAccountGroupMembershipAccessSelect,
      where: {
        groupId: invite.groupId,
        memberId: input.acceptedMemberId,
        status: "active",
      },
    });
    if (existingMembership) {
      return existingMembership;
    }
  }

  if (invite.status !== "pending" || invite.expiresAt <= now) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_NOT_ACTIVE",
      httpStatus: 410,
      message: "That family invite has expired or was already used.",
    });
  }

  if (input.acceptedMemberId === invite.group.ownerMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_OWNER_ALREADY_IN_GROUP",
      httpStatus: 409,
      message: "The family plan owner is already in this family plan.",
    });
  }

  await lockHostedMemberRow(input.tx, invite.group.ownerMemberId);
  await lockHostedMemberRow(input.tx, input.acceptedMemberId);
  await assertHostedFamilyMemberNotSponsoredElsewhereTx({
    groupId: invite.groupId,
    memberId: input.acceptedMemberId,
    tx: input.tx,
  });
  await assertHostedFamilyMemberNotDirectPaidTx({
    memberId: input.acceptedMemberId,
    tx: input.tx,
  });
  await assertHostedFamilySeatAvailableForInviteAcceptanceTx({
    acceptedMemberId: input.acceptedMemberId,
    group: invite.group,
    inviteId: invite.id,
    now,
    tx: input.tx,
  });

  const claim = await input.tx.hostedAccountGroupInvite.updateMany({
    data: {
      acceptedAt: now,
      acceptedByMemberId: input.acceptedMemberId,
      status: "accepted",
    },
    where: {
      expiresAt: {
        gt: now,
      },
      id: invite.id,
      status: "pending",
    },
  });
  if (claim.count !== 1) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_NOT_ACTIVE",
      httpStatus: 410,
      message: "That family invite has expired or was already used.",
    });
  }

  if (input.onAcceptedMemberValidated) {
    await input.onAcceptedMemberValidated({
      acceptedMemberId: input.acceptedMemberId,
      invite,
    });
  }

  const membership = await input.tx.hostedAccountGroupMembership.upsert({
    create: {
      groupId: invite.groupId,
      id: generateHostedAccountGroupMembershipId(),
      joinedAt: now,
      memberId: input.acceptedMemberId,
      role: "member",
      status: "active",
    },
    select: hostedAccountGroupMembershipAccessSelect,
    update: {
      joinedAt: now,
      removedAt: null,
      role: "member",
      status: "active",
    },
    where: {
      groupId_memberId: {
        groupId: invite.groupId,
        memberId: input.acceptedMemberId,
      },
    },
  });

  if (hasHostedAccountGroupAccess(invite.group)) {
    await activateHostedMemberForFamilySponsorshipTx({
      memberId: input.acceptedMemberId,
      occurredAt: now,
      prisma: input.tx,
      sourceEventId: `family-invite:${invite.id}`,
    });
  }

  if (isFullyUnbound) {
    await notifyHostedFamilyOwnerOfUnboundInviteClaimTx({
      acceptedMemberId: input.acceptedMemberId,
      invite,
      now,
      tx: input.tx,
    });
  }

  return membership;
}

async function notifyHostedFamilyOwnerOfUnboundInviteClaimTx(input: {
  acceptedMemberId: string;
  invite: HostedAccountGroupInviteSnapshot;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const route = await resolveHostedFamilyChatNotificationRouteTx({
    memberId: input.invite.group.ownerMemberId,
    tx: input.tx,
  });
  await appendHostedFamilyChatNotificationTx({
    memberId: input.invite.group.ownerMemberId,
    message: `${input.invite.targetLabel ?? "Someone"} just joined your family plan.`,
    occurredAt: input.now.toISOString(),
    route,
    sourceEventId: `family-invite-claim:${input.invite.id}:${input.acceptedMemberId}`,
    tx: input.tx,
  });
}

export async function removeHostedFamilyMemberTx(input: {
  groupId: string;
  memberId: string;
  now?: Date;
  ownerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const group = await input.tx.hostedAccountGroup.findUnique({
    select: hostedAccountGroupAccessSelect,
    where: {
      id: input.groupId,
    },
  });

  if (!group || group.ownerMemberId !== input.ownerMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_OWNER_REQUIRED",
      httpStatus: 403,
      message: "Only the family plan owner can remove family members.",
    });
  }

  if (input.memberId === group.ownerMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_OWNER_REMOVAL_UNSUPPORTED",
      httpStatus: 409,
      message: "The family plan owner cannot be removed from the family plan.",
    });
  }

  const result = await input.tx.hostedAccountGroupMembership.updateMany({
    data: {
      removedAt: now,
      status: "removed",
    },
    where: {
      groupId: input.groupId,
      memberId: input.memberId,
      status: "active",
    },
  });

  return result.count > 0;
}

export async function revokeHostedFamilyInviteTx(input: {
  groupId: string;
  inviteId: string;
  ownerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const group = await input.tx.hostedAccountGroup.findUnique({
    select: hostedAccountGroupAccessSelect,
    where: {
      id: input.groupId,
    },
  });

  if (!group || group.ownerMemberId !== input.ownerMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_OWNER_REQUIRED",
      httpStatus: 403,
      message: "Only the family plan owner can cancel family invites.",
    });
  }

  const result = await input.tx.hostedAccountGroupInvite.updateMany({
    data: {
      status: "revoked",
    },
    where: {
      groupId: input.groupId,
      id: input.inviteId,
      status: "pending",
    },
  });

  return result.count > 0;
}

export function buildHostedFamilyTelegramInviteUrl(input: {
  botUsername: string;
  inviteCode: string;
}): string {
  const botUsername = normalizeMurphTelegramUsername(input.botUsername);

  if (!botUsername) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_TELEGRAM_BOT_REQUIRED",
      httpStatus: 500,
      message: "Telegram bot username must be configured before Telegram family invites can be created.",
    });
  }

  return `https://t.me/${botUsername}?start=${encodeURIComponent(`family_${input.inviteCode}`)}`;
}

/**
 * Resolves a Telegram claim URL for surfaces that are allowed to offer
 * Telegram. Owner snapshot/API projections pass true only for Telegram-bound
 * invites; the public accept view may also pass true for fully unbound invites.
 */
export function resolveHostedFamilyTelegramInviteUrl(input: {
  inviteCode: string;
  isTelegramBound: boolean;
  telegramBotUsername: string | null | undefined;
}): string | null {
  if (!input.telegramBotUsername || !input.isTelegramBound) {
    return null;
  }
  return buildHostedFamilyTelegramInviteUrl({
    botUsername: input.telegramBotUsername,
    inviteCode: input.inviteCode,
  });
}

/**
 * Builds the `sms:` deep link a phone-bound or unbound invitee taps to accept
 * by text. The prefilled body contains the `family_<code>` token the LinQ
 * webhook parses via {@link parseHostedFamilyInviteStartToken}.
 */
export function buildHostedFamilyInviteMessagesHref(input: {
  inviteCode: string;
  murphPhoneNumber: string;
}): string {
  return buildMurphSmsHref({
    body: `Hi Murph, joining the family plan (code family_${input.inviteCode})`,
    murphPhoneNumber: input.murphPhoneNumber,
  });
}

export function buildHostedFamilyInviteAcceptUrl(input: {
  inviteCode: string;
  publicBaseUrl: string | null;
}): string | null {
  if (!input.publicBaseUrl) {
    return null;
  }

  return `${input.publicBaseUrl.replace(/\/+$/u, "")}/family/accept/${encodeURIComponent(input.inviteCode)}`;
}

export function buildHostedFamilyInviteReplyText(input: {
  invite: Pick<HostedAccountGroupInvitePrivateSnapshot,
    | "inviteCode"
    | "targetEmail"
    | "targetLabel"
    | "targetPhoneHint"
    | "targetPhoneNumber"
    | "targetTelegramUsername"
  >;
  publicBaseUrl?: string | null;
  telegramBotUsername?: string | null;
}): string {
  const targetLabel = input.invite.targetLabel ?? "your family member";
  const inviteToken = `family_${input.invite.inviteCode}`;
  const lines = [
    `Done. I prepared a Murph Family invite for ${targetLabel}.`,
  ];
  const telegramBotUsername = normalizeMurphTelegramUsername(input.telegramBotUsername);

  if (input.invite.targetPhoneNumber) {
    const acceptUrl = buildHostedFamilyInviteAcceptUrl({
      inviteCode: input.invite.inviteCode,
      publicBaseUrl: input.publicBaseUrl ?? null,
    });
    if (acceptUrl) {
      lines.push(`Forward this Family invite link to ${targetLabel}: ${acceptUrl}`);
      lines.push("When they open it they can join by text right from their phone.");
    } else {
      lines.push(
        `Invite token for ${input.invite.targetPhoneHint ?? "their phone"}: ${inviteToken}`,
      );
      lines.push(
        "They need to send this token to Murph from that phone number, for example on WhatsApp.",
      );
    }
  } else if (input.invite.targetEmail) {
    const acceptUrl = buildHostedFamilyInviteAcceptUrl({
      inviteCode: input.invite.inviteCode,
      publicBaseUrl: input.publicBaseUrl ?? null,
    });
    if (acceptUrl) {
      lines.push(`Forward this Family invite link to ${targetLabel}: ${acceptUrl}`);
      lines.push("They need to open it and sign in with that email address.");
    } else {
      lines.push(`Family invite code for ${input.invite.targetEmail}: ${inviteToken}`);
    }
  } else if (telegramBotUsername && input.invite.targetTelegramUsername !== null) {
    lines.push(
      `Forward this Telegram invite link to ${targetLabel}: ${buildHostedFamilyTelegramInviteUrl({
        botUsername: telegramBotUsername,
        inviteCode: input.invite.inviteCode,
      })}`,
    );
  } else if (input.invite.targetLabel) {
    const acceptUrl = buildHostedFamilyInviteAcceptUrl({
      inviteCode: input.invite.inviteCode,
      publicBaseUrl: input.publicBaseUrl ?? null,
    });
    if (acceptUrl) {
      lines.push(`Forward this Family invite link to ${targetLabel}: ${acceptUrl}`);
      lines.push("Whoever opens it can join, so it is best sent directly to them.");
    } else {
      lines.push(`Family invite token: ${inviteToken}`);
    }
  }

  lines.push(
    "You pay for their Murph access, but you cannot see their private Murph conversations, health data, vault data, exports, or deletion data.",
  );

  return lines.join("\n\n");
}

export function buildHostedFamilyInviteAcceptedReplyText(): string {
  return MURPH_ASSISTANT_FAMILY_WELCOME_MESSAGE;
}

async function readHostedFamilyBilledSeatCountTx(input: {
  groupId: string;
  tx: HostedOnboardingReadClient;
}): Promise<number | null> {
  const billingRef = await input.tx.hostedAccountGroupBillingRef.findUnique({
    select: {
      billedSeatCount: true,
    },
    where: {
      groupId: input.groupId,
    },
  });

  return billingRef?.billedSeatCount ?? null;
}

async function readConfirmedHostedFamilyBilledSeatCountTx(input: {
  group: Pick<HostedAccountGroupAccessSnapshot, "billingStatus" | "id" | "suspendedAt">;
  tx: HostedOnboardingReadClient;
}): Promise<number> {
  if (!hasHostedAccountGroupAccess(input.group)) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
      httpStatus: 409,
      message: "This Family plan has no open paid seats. Add a Family seat before inviting another person.",
    });
  }

  const billedSeatCount = await readHostedFamilyBilledSeatCountTx({
    groupId: input.group.id,
    tx: input.tx,
  });
  if (billedSeatCount === null) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
      httpStatus: 409,
      message: "This Family plan has no open paid seats. Add a Family seat before inviting another person.",
    });
  }

  return billedSeatCount;
}

async function revokeNewestHostedFamilyPendingInvitesToFitBilledSeatsTx(input: {
  billedSeatCount: number;
  groupId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const [activeMemberships, pendingInvites] = await Promise.all([
    input.tx.hostedAccountGroupMembership.count({
      where: {
        groupId: input.groupId,
        status: "active",
      },
    }),
    input.tx.hostedAccountGroupInvite.findMany({
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      select: {
        id: true,
      },
      where: {
        expiresAt: {
          gt: input.now,
        },
        groupId: input.groupId,
        status: "pending",
      },
    }),
  ]);
  const excessPendingInvites = activeMemberships + pendingInvites.length - input.billedSeatCount;
  if (excessPendingInvites <= 0) {
    return;
  }

  const revokedInviteIds = pendingInvites
    .slice(0, excessPendingInvites)
    .map((invite) => invite.id);
  if (revokedInviteIds.length === 0) {
    return;
  }

  await input.tx.hostedAccountGroupInvite.updateMany({
    data: {
      status: "revoked",
    },
    where: {
      groupId: input.groupId,
      id: {
        in: revokedInviteIds,
      },
      status: "pending",
    },
  });
}

async function assertHostedFamilySeatAvailableTx(input: {
  billedSeatCount?: number;
  group: Pick<HostedAccountGroupAccessSnapshot, "id">;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const billedSeatCountPromise = input.billedSeatCount === undefined
    ? readHostedFamilyBilledSeatCountTx({
        groupId: input.group.id,
        tx: input.tx,
      })
    : Promise.resolve(input.billedSeatCount);
  const [activeMemberships, pendingInvites, billedSeatCount] = await Promise.all([
    input.tx.hostedAccountGroupMembership.count({
      where: {
        groupId: input.group.id,
        status: "active",
      },
    }),
    input.tx.hostedAccountGroupInvite.count({
      where: {
        expiresAt: {
          gt: input.now,
        },
        groupId: input.group.id,
        status: "pending",
      },
    }),
    billedSeatCountPromise,
  ]);

  if (billedSeatCount === null || activeMemberships + pendingInvites >= billedSeatCount) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
      httpStatus: 409,
      message: "This Family plan has no open paid seats. Add a Family seat before inviting another person.",
    });
  }
}

async function assertHostedFamilySeatAvailableForInviteAcceptanceTx(input: {
  acceptedMemberId: string;
  group: Pick<HostedAccountGroupAccessSnapshot, "id">;
  inviteId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const [activeMemberships, existingAcceptedMembership, pendingInvites, billedSeatCount] =
    await Promise.all([
      input.tx.hostedAccountGroupMembership.count({
        where: {
          groupId: input.group.id,
          status: "active",
        },
      }),
      input.tx.hostedAccountGroupMembership.findFirst({
        select: {
          id: true,
        },
        where: {
          groupId: input.group.id,
          memberId: input.acceptedMemberId,
          status: "active",
        },
      }),
      input.tx.hostedAccountGroupInvite.count({
        where: {
          NOT: {
            id: input.inviteId,
          },
          expiresAt: {
            gt: input.now,
          },
          groupId: input.group.id,
          status: "pending",
        },
      }),
      readHostedFamilyBilledSeatCountTx({
        groupId: input.group.id,
        tx: input.tx,
      }),
    ]);

  const acceptedMemberSeatDelta = existingAcceptedMembership ? 0 : 1;
  if (
    billedSeatCount === null ||
    activeMemberships + pendingInvites + acceptedMemberSeatDelta > billedSeatCount
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
      httpStatus: 409,
      message: "This Family plan has no open paid seats. Add a Family seat before inviting another person.",
    });
  }
}

async function assertHostedFamilyMemberNotSponsoredElsewhereTx(input: {
  groupId: string;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const existingActiveMembership = await input.tx.hostedAccountGroupMembership.findFirst({
    select: hostedAccountGroupMembershipAccessSelect,
    where: {
      groupId: {
        not: input.groupId,
      },
      memberId: input.memberId,
      status: "active",
    },
  });

  if (existingActiveMembership) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
      httpStatus: 409,
      message: "This member is already in another active family plan.",
    });
  }
}

async function assertHostedFamilyOwnerCanStartBillingTx(input: {
  allowDirectPaidOwner?: boolean;
  groupId: string;
  ownerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await assertHostedFamilyMemberNotSponsoredElsewhereTx({
    groupId: input.groupId,
    memberId: input.ownerMemberId,
    tx: input.tx,
  });
  await assertHostedFamilyMemberNotDirectPaidTx({
    allowDirectPaidOwner: input.allowDirectPaidOwner,
    memberId: input.ownerMemberId,
    tx: input.tx,
  });
}

async function assertHostedFamilyMemberNotDirectPaidTx(input: {
  allowDirectPaidOwner?: boolean;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  if (input.allowDirectPaidOwner) {
    return;
  }
  if (await hasHostedFamilyMemberDirectPaidTx(input)) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_DIRECT_PAID_TRANSFER_REQUIRED",
      httpStatus: 409,
      message: "You're currently paying for Murph yourself. Switching paid accounts into Family billing is not supported in this release.",
    });
  }
}

async function hasHostedFamilyMemberDirectPaidTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const member = await input.tx.hostedMember.findUnique({
    select: {
      billingRef: {
        select: {
          currentBillingPhase: true,
        },
      },
      billingStatus: true,
    },
    where: {
      id: input.memberId,
    },
  });

  return (
    member?.billingStatus === HostedBillingStatus.active &&
    parseHostedBillingPhase(member.billingRef?.currentBillingPhase) === "paid"
  );
}

async function activateHostedFamilyGroupMembersForActiveBillingTx(input: {
  groupId: string;
  occurredAt: Date;
  sourceEventId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedMemberActivationResult[]> {
  const memberships = await input.tx.hostedAccountGroupMembership.findMany({
    select: {
      memberId: true,
    },
    where: {
      groupId: input.groupId,
      status: "active",
    },
  });

  const eligibleMemberships: typeof memberships = [];
  for (const membership of memberships) {
    await assertHostedFamilyMemberNotSponsoredElsewhereTx({
      groupId: input.groupId,
      memberId: membership.memberId,
      tx: input.tx,
    });
    if (await hasHostedFamilyMemberDirectPaidTx({
      memberId: membership.memberId,
      tx: input.tx,
    })) {
      continue;
    }
    eligibleMemberships.push(membership);
  }

  const activations: HostedMemberActivationResult[] = [];
  for (const membership of eligibleMemberships) {
    activations.push(await activateHostedMemberForFamilySponsorshipTx({
      memberId: membership.memberId,
      occurredAt: input.occurredAt,
      prisma: input.tx,
      sourceEventId: input.sourceEventId,
    }));
  }

  return activations;
}

async function projectHostedFamilyInvitePrivateSnapshot(
  invite: HostedAccountGroupInviteSnapshot,
  prisma: HostedOnboardingReadClient,
): Promise<HostedAccountGroupInvitePrivateSnapshot> {
  const targetPhoneNumber = await decryptHostedWebNullableString({
    field: HOSTED_ACCOUNT_GROUP_INVITE_TARGET_PHONE_FIELD,
    memberId: invite.group.ownerMemberId,
    prisma,
    value: invite.targetPhoneNumberEncrypted,
  });
  const targetTelegramUsername = await decryptHostedWebNullableString({
    field: HOSTED_ACCOUNT_GROUP_INVITE_TARGET_TELEGRAM_USERNAME_FIELD,
    memberId: invite.group.ownerMemberId,
    prisma,
    value: invite.targetTelegramUsernameEncrypted,
  });
  const targetEmail = await decryptHostedWebNullableString({
    field: HOSTED_ACCOUNT_GROUP_INVITE_TARGET_EMAIL_FIELD,
    memberId: invite.group.ownerMemberId,
    prisma,
    value: invite.targetEmailEncrypted,
  });

  return {
    ...invite,
    targetEmail,
    targetPhoneHint: targetPhoneNumber ? readHostedPhoneHint(targetPhoneNumber) : null,
    targetPhoneNumber,
    targetTelegramUsername,
  };
}

function normalizeFamilyLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length > 0 ? normalized.slice(0, 80) : null;
}

async function projectHostedAccountGroupBillingRefSnapshot(
  billingRef: HostedAccountGroupBillingRefRecord,
  prisma: HostedOnboardingReadClient,
): Promise<HostedAccountGroupBillingRefSnapshot> {
  const [
    stripeCheckoutSessionId,
    stripeCustomerId,
    stripeSubscriptionItemId,
    stripeSubscriptionId,
  ] = await Promise.all([
    decryptHostedWebNullableString({
      field: HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CHECKOUT_SESSION_FIELD,
      memberId: billingRef.group.ownerMemberId,
      prisma,
      value: billingRef.stripeCheckoutSessionIdEncrypted,
    }),
    decryptHostedWebNullableString({
      field: HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CUSTOMER_FIELD,
      memberId: billingRef.group.ownerMemberId,
      prisma,
      value: billingRef.stripeCustomerIdEncrypted,
    }),
    decryptHostedWebNullableString({
      field: HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_SUBSCRIPTION_ITEM_FIELD,
      memberId: billingRef.group.ownerMemberId,
      prisma,
      value: billingRef.stripeSubscriptionItemIdEncrypted,
    }),
    decryptHostedWebNullableString({
      field: HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_SUBSCRIPTION_FIELD,
      memberId: billingRef.group.ownerMemberId,
      prisma,
      value: billingRef.stripeSubscriptionIdEncrypted,
    }),
  ]);

  return {
    billedSeatCount: billingRef.billedSeatCount,
    checkoutAttemptId: billingRef.checkoutAttemptId,
    checkoutCreatedAt: billingRef.checkoutCreatedAt,
    checkoutSeatCount: billingRef.checkoutSeatCount,
    currentBillingPhase: billingRef.currentBillingPhase,
    currentBillingPlanCode: billingRef.currentBillingPlanCode,
    currentPeriodEnd: billingRef.currentPeriodEnd,
    currentPeriodStart: billingRef.currentPeriodStart,
    group: billingRef.group,
    groupId: billingRef.groupId,
    lastStripeEventCreatedAt: billingRef.lastStripeEventCreatedAt,
    stripeCheckoutSessionId,
    stripeCustomerId,
    stripeSubscriptionItemId,
    stripeSubscriptionId,
  };
}

async function resolveHostedAccountGroupBillingLookup(
  billingRefs: HostedAccountGroupBillingRefRecord[],
  matchedBy: HostedAccountGroupBillingLookup["matchedBy"],
  prisma: HostedOnboardingReadClient,
): Promise<HostedAccountGroupBillingLookup | null> {
  if (billingRefs.length === 0) {
    return null;
  }

  const groupIds = new Set(billingRefs.map((billingRef) => billingRef.groupId));
  if (groupIds.size !== 1 || billingRefs.length !== 1) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_STRIPE_BILLING_AMBIGUOUS",
      httpStatus: 409,
      message: "Stripe billing identity matches multiple family plans.",
    });
  }

  const billingRef = await projectHostedAccountGroupBillingRefSnapshot(billingRefs[0]!, prisma);
  return {
    billingRef,
    group: billingRef.group,
    matchedBy,
  };
}

async function assertHostedAccountGroupStripeBillingIdentifiersAvailableTx(input: {
  groupId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionItemId?: string | null;
  stripeSubscriptionId?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const [customerLookup, subscriptionLookup, subscriptionItemLookup] = await Promise.all([
    input.stripeCustomerId
      ? lookupHostedAccountGroupStripeBillingRefByStripeCustomerId({
          prisma: input.tx,
          stripeCustomerId: input.stripeCustomerId,
        })
      : Promise.resolve(null),
    input.stripeSubscriptionId
      ? lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId({
          prisma: input.tx,
          stripeSubscriptionId: input.stripeSubscriptionId,
        })
      : Promise.resolve(null),
    input.stripeSubscriptionItemId
      ? lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionItemId({
          prisma: input.tx,
          stripeSubscriptionItemId: input.stripeSubscriptionItemId,
        })
      : Promise.resolve(null),
  ]);

  const conflictingLookup = [customerLookup, subscriptionLookup, subscriptionItemLookup].find((lookup) =>
    lookup && lookup.group.id !== input.groupId
  );
  if (conflictingLookup) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_STRIPE_BILLING_IDENTITY_CONFLICT",
      httpStatus: 409,
      message: "That Stripe billing identity is already bound to another family plan.",
    });
  }
}

async function buildHostedAccountGroupBillingPrivateColumns(input: {
  ownerMemberId: string;
  prisma: HostedOnboardingReadClient;
  stripeCustomerId: string | null;
  stripeSubscriptionItemId: string | null;
  stripeSubscriptionId: string | null;
}) {
  const encryptPrivateField = (field: string, value: string | null) =>
    encryptHostedWebNullableString({
      field,
      memberId: input.ownerMemberId,
      prisma: input.prisma,
      value,
    });

  const [
    stripeCustomerIdEncrypted,
    stripeSubscriptionItemIdEncrypted,
    stripeSubscriptionIdEncrypted,
  ] = await Promise.all([
    encryptPrivateField(
      HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CUSTOMER_FIELD,
      input.stripeCustomerId,
    ),
    encryptPrivateField(
      HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_SUBSCRIPTION_ITEM_FIELD,
      input.stripeSubscriptionItemId,
    ),
    encryptPrivateField(
      HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_SUBSCRIPTION_FIELD,
      input.stripeSubscriptionId,
    ),
  ]);

  return {
    stripeCustomerIdEncrypted,
    stripeSubscriptionItemIdEncrypted,
    stripeSubscriptionIdEncrypted,
  } as const;
}

async function findHostedAccountGroupForStripeObject(input: {
  accountGroupId: string | null;
  checkoutAttemptId?: string | null;
  checkoutSessionId?: string | null;
  customerId: string | null;
  customerLookupAllowed: boolean;
  prisma: HostedOnboardingReadClient;
  subscriptionId: string | null;
}): Promise<HostedAccountGroupStripeObjectMatch | null> {
  if (input.subscriptionId) {
    const lookup = await lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId({
      prisma: input.prisma,
      stripeSubscriptionId: input.subscriptionId,
    });
    if (lookup) {
      if (input.accountGroupId && lookup.group.id !== input.accountGroupId) {
        return null;
      }
      return {
        billingRef: lookup.billingRef,
        group: lookup.group,
      };
    }
  }

  if (input.accountGroupId) {
    const group = await input.prisma.hostedAccountGroup.findUnique({
      select: hostedAccountGroupAccessSelect,
      where: {
        id: input.accountGroupId,
      },
    });
    if (group) {
      const billingRef = await readHostedAccountGroupStripeBillingRef({
        groupId: group.id,
        prisma: input.prisma,
      });
      if (billingRef?.stripeSubscriptionId) {
        return billingRef.stripeSubscriptionId === input.subscriptionId
          ? { billingRef, group }
          : null;
      }
      if (
        billingRef?.stripeCustomerId &&
        input.customerId &&
        billingRef.stripeCustomerId !== input.customerId
      ) {
        return null;
      }
      if (
        billingRef?.checkoutAttemptId &&
        input.checkoutAttemptId &&
        billingRef.checkoutAttemptId !== input.checkoutAttemptId
      ) {
        return null;
      }
      if (
        billingRef?.checkoutAttemptId &&
        !input.checkoutAttemptId &&
        (input.subscriptionId || input.checkoutSessionId)
      ) {
        return null;
      }
      if (
        billingRef?.stripeCheckoutSessionId &&
        input.checkoutSessionId &&
        billingRef.stripeCheckoutSessionId !== input.checkoutSessionId
      ) {
        return null;
      }
      return {
        billingRef,
        group,
      };
    }
  }

  if (input.customerLookupAllowed && input.customerId) {
    const lookup = await lookupHostedAccountGroupStripeBillingRefByStripeCustomerId({
      prisma: input.prisma,
      stripeCustomerId: input.customerId,
    });
    if (lookup) {
      return {
        billingRef: lookup.billingRef,
        group: lookup.group,
      };
    }
  }

  return null;
}

async function lockHostedFamilyBillingReconciliationTx(input: {
  eventCreatedAt: Date | null;
  group: Pick<HostedAccountGroupAccessSnapshot, "id" | "ownerMemberId">;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  await lockHostedMemberRow(input.tx, input.group.ownerMemberId);
  const billingRef = await input.tx.hostedAccountGroupBillingRef.findUnique({
    select: {
      lastStripeEventCreatedAt: true,
    },
    where: {
      groupId: input.group.id,
    },
  });

  return !isHostedFamilyStripeEventStale({
    billingRef,
    eventCreatedAt: input.eventCreatedAt,
  });
}

function isHostedFamilyStripeEventStale(input: {
  billingRef: Pick<HostedAccountGroupBillingRefSnapshot, "lastStripeEventCreatedAt"> | null;
  eventCreatedAt: Date | null;
}): boolean {
  return Boolean(
    input.eventCreatedAt &&
      input.billingRef?.lastStripeEventCreatedAt &&
      input.billingRef.lastStripeEventCreatedAt.getTime() > input.eventCreatedAt.getTime(),
  );
}

function buildHostedFamilyStripeSubscriptionPeriodSnapshot(
  subscription: Stripe.Subscription,
  subscriptionItem?: Stripe.SubscriptionItem | null,
): {
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
} {
  const subscriptionPeriod = readHostedFamilyStripePeriod(subscription);
  const period = subscriptionPeriod ?? (
    subscriptionItem ? readHostedFamilyStripePeriod(subscriptionItem) : null
  );

  if (!period) {
    return {};
  }

  return {
    currentPeriodEnd: period.end,
    currentPeriodStart: period.start,
  };
}

function isHostedFamilyStripeSubscriptionMetadata(subscription: Stripe.Subscription): boolean {
  return subscription.metadata?.kind === HOSTED_FAMILY_STRIPE_METADATA_KIND &&
    subscription.metadata?.billingPlanCode === HOSTED_FAMILY_BILLING_PLAN_CODE;
}

function isHostedFamilyCheckoutSessionId(value: string): boolean {
  return HOSTED_FAMILY_STRIPE_CHECKOUT_SESSION_ID_PATTERN.test(value);
}

function isHostedFamilyCheckoutSession(session: Stripe.Checkout.Session): boolean {
  return session.mode === "subscription" &&
    session.metadata?.kind === HOSTED_FAMILY_STRIPE_METADATA_KIND &&
    session.metadata.billingPlanCode === HOSTED_FAMILY_BILLING_PLAN_CODE &&
    normalizeNullableString(session.metadata.accountGroupId) !== null &&
    normalizeNullableString(session.metadata.ownerMemberId) !== null;
}

function readHostedFamilyStripeSeatSubscriptionItem(
  subscription: Stripe.Subscription,
): {
  billedSeatCount: number;
  stripeSubscriptionItem: Stripe.SubscriptionItem;
  stripeSubscriptionItemId: string;
} | null {
  const familySeatPriceId = requireHostedFamilyStripePriceId();
  const matchingItems = (subscription.items?.data ?? []).filter(
    (item) => item.price?.id === familySeatPriceId,
  );

  if (matchingItems.length !== 1) {
    return null;
  }

  const item = matchingItems[0];
  if (!item) {
    return null;
  }

  const billedSeatCount = parseHostedFamilySeatCount(item.quantity);
  if (billedSeatCount === null) {
    return null;
  }

  return {
    billedSeatCount,
    stripeSubscriptionItem: item,
    stripeSubscriptionItemId: item.id,
  };
}

function buildEmptyHostedFamilyStripeSubscriptionResult(): HostedFamilyStripeSubscriptionResult {
  return {
    activations: [],
    groupId: null,
  };
}

function readHostedFamilyStripePeriod(
  object: Stripe.Subscription | Stripe.SubscriptionItem,
): { end: Date; start: Date } | null {
  const periodStart = readHostedFamilyStripeTimestamp(object, "current_period_start");
  const periodEnd = readHostedFamilyStripeTimestamp(object, "current_period_end");

  if (!periodStart || !periodEnd || periodStart.getTime() >= periodEnd.getTime()) {
    return null;
  }

  return {
    end: periodEnd,
    start: periodStart,
  };
}

function readHostedFamilyStripeTimestamp(
  object: Stripe.Subscription | Stripe.SubscriptionItem,
  key: "current_period_end" | "current_period_start",
): Date | null {
  const periodSource = object as (Stripe.Subscription | Stripe.SubscriptionItem) & {
    current_period_end?: unknown;
    current_period_start?: unknown;
  };
  const value = periodSource[key];
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000)
    : null;
}

function requireHostedFamilyStripePriceId(): string {
  const priceId = normalizeNullableString(process.env[HOSTED_FAMILY_STRIPE_PRICE_ID_ENV_KEY]);
  if (!priceId) {
    throw hostedOnboardingError({
      code: "STRIPE_PRICE_ID_REQUIRED",
      httpStatus: 500,
      message: `${HOSTED_FAMILY_STRIPE_PRICE_ID_ENV_KEY} must be configured for hosted family billing.`,
    });
  }

  return priceId;
}

function hostedTelegramUsernameLookupKeyMatchesValue(
  username: string | null | undefined,
  expectedLookupKey: string | null | undefined,
): boolean {
  return hostedLookupKeyMatchesValue({
    expectedLookupKey,
    kind: "telegram-username",
    normalizedValue: normalizeHostedTelegramUsernameForLookup(username),
  });
}

function parseHostedFamilySeatCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= HOSTED_FAMILY_MIN_SEATS &&
    value <= HOSTED_FAMILY_MAX_SEATS
    ? value
    : null;
}

function normalizeHostedFamilySeatCount(value: unknown): number {
  const seatCount = parseHostedFamilySeatCount(value);
  if (seatCount !== null) {
    return seatCount;
  }

  throw hostedOnboardingError({
    code: "HOSTED_FAMILY_SEAT_COUNT_INVALID",
    httpStatus: 400,
    message: "Family supports 2 to 6 people.",
  });
}

function normalizeHostedFamilyOptionalBilledSeatCount(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : normalizeHostedFamilySeatCount(value);
}

function buildHostedFamilyStripeMetadata(
  group: Pick<HostedAccountGroupAccessSnapshot, "id" | "ownerMemberId">,
): Record<string, string> {
  return {
    accountGroupId: group.id,
    billingPlanCode: HOSTED_FAMILY_BILLING_PLAN_CODE,
    kind: HOSTED_FAMILY_STRIPE_METADATA_KIND,
    ownerMemberId: group.ownerMemberId,
  };
}

function buildHostedFamilyCheckoutIdempotencyKey(input: {
  attemptId: string;
  groupId: string;
  priceId: string;
  seatCount: number;
  stripeCustomerId: string | null;
}): string {
  return [
    "hosted-family-checkout",
    input.groupId,
    input.attemptId,
    input.priceId,
    `seats-${input.seatCount}`,
    input.stripeCustomerId ?? "new-customer",
  ].join(":");
}

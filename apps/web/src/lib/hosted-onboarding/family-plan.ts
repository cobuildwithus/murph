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

import { normalizeMurphTelegramUsername } from "../murph-contact-routing";
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
  assertHostedMemberActiveAccessAllowed,
  hasHostedMemberActiveAccess,
  assertHostedMemberNotSuspended,
  isHostedMemberSuspended,
  isHostedAccessBlockedBillingStatus,
} from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  generateHostedAccountGroupId,
  generateHostedAccountGroupInviteId,
  generateHostedAccountGroupMembershipId,
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
  parseHostedBillingPhase,
} from "./billing-plans";
import {
  requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeApi,
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
import { readHostedMemberIdentity } from "./hosted-member-identity-store";
import {
  readHostedMemberRoutingState,
  resolveHostedMemberRoutingByTelegramUserId,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "./hosted-member-routing-store";
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
    currentBillingPhase: true,
    currentBillingPlanCode: true,
    currentPeriodEnd: true,
    currentPeriodStart: true,
    group: {
      select: hostedAccountGroupAccessSelect,
    },
    groupId: true,
    lastStripeEventCreatedAt: true,
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
    | "stripeCustomerIdEncrypted"
    | "stripeSubscriptionItemIdEncrypted"
    | "stripeSubscriptionIdEncrypted"
  > {
  stripeCustomerId: string | null;
  stripeSubscriptionItemId: string | null;
  stripeSubscriptionId: string | null;
}

export interface HostedAccountGroupBillingLookup {
  billingRef: HostedAccountGroupBillingRefSnapshot;
  group: HostedAccountGroupAccessSnapshot;
  matchedBy: "stripeCustomerId" | "stripeSubscriptionId" | "stripeSubscriptionItemId";
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

export interface HostedFamilyEntitlementInput {
  familyAccessActive?: boolean;
  memberBillingStatus: HostedBillingStatus;
  memberSuspendedAt?: Date | null;
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
  seatAvailable: boolean;
  status: HostedAccountGroupInviteStatus;
  targetLabel: string | null;
  telegramInviteUrl: string | null;
  webAcceptable: boolean;
}

type HostedFamilyBillingCheckoutInput =
  | {
      alreadyActive: true;
    }
  | {
      alreadyActive: false;
      group: HostedAccountGroupAccessSnapshot;
      seatCount: number;
      stripeCustomerId: string | null;
    };

export function hasHostedMemberEffectiveActiveAccess(
  input: HostedFamilyEntitlementInput,
): boolean {
  return !isHostedMemberSuspended(input.memberSuspendedAt) &&
    (
      hasHostedMemberActiveAccess({
        billingStatus: input.memberBillingStatus,
        suspendedAt: input.memberSuspendedAt,
      }) ||
      input.familyAccessActive === true
    );
}

export function hasHostedAccountGroupAccess(input: {
  billingStatus: HostedBillingStatus;
  suspendedAt?: Date | null;
}): boolean {
  return !isHostedMemberSuspended(input.suspendedAt) &&
    !isHostedAccessBlockedBillingStatus(input.billingStatus) &&
    input.billingStatus === HostedBillingStatus.active;
}

export function hasHostedAccountGroupMembershipAccess(input: {
  group: Pick<HostedAccountGroupAccessSnapshot, "billingStatus" | "suspendedAt">;
  membershipStatus: string;
}): boolean {
  return input.membershipStatus === "active" &&
    hasHostedAccountGroupAccess(input.group);
}

export async function readHostedFamilyAccessForMember(input: {
  memberId: string;
  now?: Date;
  prisma?: HostedOnboardingReadClient;
}): Promise<HostedAccountGroupMembershipAccessSnapshot | null> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const membership = await prisma.hostedAccountGroupMembership.findFirst({
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

  if (!membership || !hasHostedAccountGroupMembershipAccess({
    group: membership.group,
    membershipStatus: membership.status,
  })) {
    return null;
  }

  const [activeMembershipCount, pendingInviteCount, billedSeatCount] = await Promise.all([
    prisma.hostedAccountGroupMembership.count({
      where: {
        groupId: membership.groupId,
        status: "active",
      },
    }),
    prisma.hostedAccountGroupInvite.count({
      where: {
        expiresAt: {
          gt: now,
        },
        groupId: membership.groupId,
        status: "pending",
      },
    }),
    readHostedFamilyBilledSeatCountTx({
      groupId: membership.groupId,
      tx: prisma,
    }),
  ]);
  if (billedSeatCount === null) {
    return null;
  }
  if (activeMembershipCount + pendingInviteCount > billedSeatCount) {
    return null;
  }

  return membership;
}

export async function hasActiveHostedFamilyAccess(input: {
  memberId: string;
  prisma?: HostedOnboardingReadClient;
}): Promise<boolean> {
  return (await readHostedFamilyAccessForMember(input)) !== null;
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
        telegramInviteUrl: telegramBotUsername
          ? buildHostedFamilyTelegramInviteUrl({
              botUsername: telegramBotUsername,
              inviteCode: invite.inviteCode,
            })
          : null,
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
  const telegramBotUsername = readHostedOnboardingEnvironment().telegramBotUsername;

  return {
    groupActive,
    groupDisplayName: invite.group.displayName,
    inviteCode: invite.inviteCode,
    isEmailBound,
    isPhoneBound,
    seatAvailable,
    status,
    targetLabel: invite.targetLabel,
    telegramInviteUrl:
      telegramBotUsername && isPending
        ? buildHostedFamilyTelegramInviteUrl({
            botUsername: telegramBotUsername,
            inviteCode: invite.inviteCode,
          })
        : null,
    webAcceptable: isPending && seatAvailable && groupActive && (isPhoneBound || isEmailBound),
  };
}

export async function hasHostedMemberEffectiveActiveAccessForMember(input: {
  member: {
    billingStatus: HostedBillingStatus;
    id: string;
    suspendedAt?: Date | null;
  };
  prisma?: HostedOnboardingReadClient;
}): Promise<boolean> {
  if (hasHostedMemberActiveAccess(input.member)) {
    return true;
  }

  return hasHostedMemberEffectiveActiveAccess({
    familyAccessActive: await hasActiveHostedFamilyAccess({
      memberId: input.member.id,
      prisma: input.prisma,
    }),
    memberBillingStatus: input.member.billingStatus,
    memberSuspendedAt: input.member.suspendedAt,
  });
}

export async function assertHostedMemberEffectiveActiveAccessAllowed(input: {
  member: {
    billingStatus: HostedBillingStatus;
    id: string;
    suspendedAt?: Date | null;
  };
  prisma?: HostedOnboardingReadClient;
}): Promise<void> {
  assertHostedMemberNotSuspended(input.member);

  if (hasHostedMemberActiveAccess(input.member)) {
    return;
  }

  if (await hasActiveHostedFamilyAccess({
    memberId: input.member.id,
    prisma: input.prisma,
  })) {
    return;
  }

  assertHostedMemberActiveAccessAllowed(input.member);
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
      currentBillingPhase: input.currentBillingPhase ?? null,
      currentBillingPlanCode: input.currentBillingPlanCode ?? HOSTED_FAMILY_BILLING_PLAN_CODE,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      currentPeriodStart: input.currentPeriodStart ?? null,
      groupId: input.groupId,
      lastStripeEventCreatedAt: input.preserveLastStripeEventCreatedAt
        ? null
        : input.stripeEventCreatedAt ?? null,
      stripeCustomerLookupKey,
      stripeSubscriptionItemLookupKey,
      stripeSubscriptionLookupKey,
    },
    select: hostedAccountGroupBillingRefSelect,
    update: preserveBillingFields
      ? {
          stripeCustomerIdEncrypted: privateColumns.stripeCustomerIdEncrypted,
          stripeCustomerLookupKey,
          stripeSubscriptionIdEncrypted: privateColumns.stripeSubscriptionIdEncrypted,
          stripeSubscriptionLookupKey,
        }
      : {
          ...privateColumns,
          currentBillingPhase: input.currentBillingPhase ?? null,
          currentBillingPlanCode: input.currentBillingPlanCode ?? HOSTED_FAMILY_BILLING_PLAN_CODE,
          currentPeriodEnd: input.currentPeriodEnd ?? null,
          currentPeriodStart: input.currentPeriodStart ?? null,
          billedSeatCount,
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
  return findHostedAccountGroupForStripeObject({
    accountGroupId: normalizeNullableString(input.session.metadata?.accountGroupId),
    customerId: coerceStripeObjectId(input.session.customer),
    customerLookupAllowed: true,
    prisma: input.prisma,
    subscriptionId: coerceStripeSubscriptionId(input.session.subscription),
  });
}

export async function findHostedAccountGroupForStripeSubscription(input: {
  prisma: HostedOnboardingReadClient;
  subscription: Stripe.Subscription;
}): Promise<HostedAccountGroupAccessSnapshot | null> {
  return findHostedAccountGroupForStripeObject({
    accountGroupId: normalizeNullableString(input.subscription.metadata?.accountGroupId),
    customerId: coerceStripeObjectId(input.subscription.customer),
    customerLookupAllowed: false,
    prisma: input.prisma,
    subscriptionId: input.subscription.id,
  });
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

  const group = await findHostedAccountGroupForStripeSubscription({
    prisma: input.tx,
    subscription: input.subscription,
  });
  if (!group) {
    return buildEmptyHostedFamilyStripeSubscriptionResult();
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
      stripeEventCreatedAt: input.dispatchContext.eventCreatedAt ?? null,
      stripeSubscriptionItemId: null,
      stripeSubscriptionId: input.subscription.id,
      tx: input.tx,
    });

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
    ...buildHostedFamilyStripeSubscriptionPeriodSnapshot(input.subscription),
    billedSeatCount: familySeatItem.billedSeatCount,
    groupId: group.id,
    stripeCustomerId: coerceStripeObjectId(input.subscription.customer),
    stripeEventCreatedAt: input.dispatchContext.eventCreatedAt ?? null,
    stripeSubscriptionItemId: familySeatItem.stripeSubscriptionItemId,
    stripeSubscriptionId: input.subscription.id,
    tx: input.tx,
  });
  const eventCreatedAt = input.dispatchContext.eventCreatedAt ?? null;
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
      groupId: group.id,
      ownerMemberId: group.ownerMemberId,
      tx,
    });

    const currentBillingRef = await readHostedAccountGroupStripeBillingRef({
      groupId: group.id,
      prisma: tx,
    });

    return {
      alreadyActive: false,
      group,
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

  const priceId = requireHostedFamilyStripePriceId();
  const stripe = requireHostedStripeApi();
  const publicBaseUrl = requireHostedOnboardingPublicBaseUrl();
  const metadata = buildHostedFamilyStripeMetadata(checkoutInput.group);
  const checkoutSession = await stripe.checkout.sessions.create({
    cancel_url: `${publicBaseUrl}/settings`,
    client_reference_id: checkoutInput.group.id,
    ...(checkoutInput.stripeCustomerId
      ? { customer: checkoutInput.stripeCustomerId }
      : {}),
    line_items: [{
      price: priceId,
      quantity: checkoutInput.seatCount,
    }],
    metadata,
    mode: "subscription",
    payment_method_types: ["card"],
    subscription_data: {
      metadata,
    },
    success_url: `${publicBaseUrl}/settings?family_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
  });

  if (!checkoutSession.url) {
    throw hostedOnboardingError({
      code: "CHECKOUT_URL_MISSING",
      httpStatus: 502,
      message: "Stripe Checkout did not return a redirect URL.",
    });
  }

  return {
    alreadyActive: false,
    url: buildHostedFamilyCheckoutRedirectUrl({ checkoutUrl: checkoutSession.url }) ??
      checkoutSession.url,
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
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_CHECKOUT_SESSION_UNAVAILABLE",
      httpStatus: 410,
      message: "Family checkout session is no longer available. Start Family checkout again.",
    });
  }

  return checkoutUrl;
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
    targetLabel: input.targetLabel ?? null,
    targetPhoneNumber: input.targetPhoneNumber ?? null,
    targetTelegramUsername: input.targetTelegramUsername ?? null,
    tx: input.tx,
  });

  return {
    group,
    invite,
    replyText: buildHostedFamilyInviteReplyText({
      invite,
      telegramBotUsername: readHostedOnboardingEnvironment().telegramBotUsername,
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
    ?? null;

  return token ? token.slice("family_".length) : null;
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
    const active = await isHostedFamilyInviteCodePendingActiveTx({
      inviteCode,
      now,
      tx: input.tx,
    });
    if (!active) {
      inviteCode = await resolveHostedFamilyInviteCodeFromTelegramUsernameTx({
        now,
        telegramUsername: input.telegramUsername ?? null,
        tx: input.tx,
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

async function isHostedFamilyInviteCodePendingActiveTx(input: {
  inviteCode: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const invite = await input.tx.hostedAccountGroupInvite.findUnique({
    select: {
      expiresAt: true,
      status: true,
    },
    where: {
      inviteCode: input.inviteCode,
    },
  });

  return invite?.status === "pending" && invite.expiresAt > input.now;
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

  if (
    input.requireWebBinding &&
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
    invite.targetPhoneLookupKey &&
    !hostedPhoneLookupKeyMatchesValue(input.phoneNumber, invite.targetPhoneLookupKey)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_PHONE_MISMATCH",
      httpStatus: 403,
      message: "This family invite was sent to a different phone number.",
    });
  }

  if (
    invite.targetEmailLookupKey &&
    !hostedEmailLookupKeyMatchesValue(input.email, invite.targetEmailLookupKey)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_EMAIL_MISMATCH",
      httpStatus: 403,
      message: "This family invite was sent to a different email address.",
    });
  }

  if (
    Object.prototype.hasOwnProperty.call(input, "telegramUsername") &&
    invite.targetTelegramUsernameLookupKey &&
    !hostedTelegramUsernameLookupKeyMatchesValue(
      input.telegramUsername,
      invite.targetTelegramUsernameLookupKey,
    )
  ) {
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

  return membership;
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
    "inviteCode" | "targetLabel" | "targetPhoneHint" | "targetPhoneNumber"
  >;
  telegramBotUsername?: string | null;
}): string {
  const targetLabel = input.invite.targetLabel ?? "your family member";
  const inviteToken = `family_${input.invite.inviteCode}`;
  const lines = [
    `Done. I prepared a Murph Family invite for ${targetLabel}.`,
  ];
  const telegramBotUsername = normalizeMurphTelegramUsername(input.telegramBotUsername);

  if (input.invite.targetPhoneNumber) {
    lines.push(
      `Invite token for ${input.invite.targetPhoneHint ?? "their phone"}: ${inviteToken}`,
    );
    lines.push(
      "They need to send this token to Murph from that phone number, for example on WhatsApp.",
    );
  } else if (telegramBotUsername) {
    lines.push(
      `Forward this Telegram invite link to ${targetLabel}: ${buildHostedFamilyTelegramInviteUrl({
        botUsername: telegramBotUsername,
        inviteCode: input.invite.inviteCode,
      })}`,
    );
  } else if (input.invite.targetLabel) {
    lines.push(`Telegram invite token: ${inviteToken}`);
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
    memberId: input.ownerMemberId,
    tx: input.tx,
  });
}

async function assertHostedFamilyMemberNotDirectPaidTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
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
  const [stripeCustomerId, stripeSubscriptionItemId, stripeSubscriptionId] = await Promise.all([
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
    currentBillingPhase: billingRef.currentBillingPhase,
    currentBillingPlanCode: billingRef.currentBillingPlanCode,
    currentPeriodEnd: billingRef.currentPeriodEnd,
    currentPeriodStart: billingRef.currentPeriodStart,
    group: billingRef.group,
    groupId: billingRef.groupId,
    lastStripeEventCreatedAt: billingRef.lastStripeEventCreatedAt,
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
  customerId: string | null;
  customerLookupAllowed: boolean;
  prisma: HostedOnboardingReadClient;
  subscriptionId: string | null;
}): Promise<HostedAccountGroupAccessSnapshot | null> {
  if (input.accountGroupId) {
    const group = await input.prisma.hostedAccountGroup.findUnique({
      select: hostedAccountGroupAccessSelect,
      where: {
        id: input.accountGroupId,
      },
    });
    if (group) {
      return group;
    }
  }

  if (input.subscriptionId) {
    const lookup = await lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId({
      prisma: input.prisma,
      stripeSubscriptionId: input.subscriptionId,
    });
    if (lookup) {
      return lookup.group;
    }
  }

  if (input.customerLookupAllowed && input.customerId) {
    const lookup = await lookupHostedAccountGroupStripeBillingRefByStripeCustomerId({
      prisma: input.prisma,
      stripeCustomerId: input.customerId,
    });
    if (lookup) {
      return lookup.group;
    }
  }

  return null;
}

function buildHostedFamilyStripeSubscriptionPeriodSnapshot(
  subscription: Stripe.Subscription,
): {
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
} {
  const periodStart = readHostedFamilyStripeTimestamp(subscription, "current_period_start");
  const periodEnd = readHostedFamilyStripeTimestamp(subscription, "current_period_end");

  if (!periodStart || !periodEnd || periodStart.getTime() >= periodEnd.getTime()) {
    return {};
  }

  return {
    currentPeriodEnd: periodEnd,
    currentPeriodStart: periodStart,
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
): { billedSeatCount: number; stripeSubscriptionItemId: string } | null {
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
    stripeSubscriptionItemId: item.id,
  };
}

function buildEmptyHostedFamilyStripeSubscriptionResult(): HostedFamilyStripeSubscriptionResult {
  return {
    activations: [],
    groupId: null,
  };
}

function readHostedFamilyStripeTimestamp(
  object: Stripe.Subscription,
  key: "current_period_end" | "current_period_start",
): Date | null {
  const periodSource = object as Stripe.Subscription & {
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

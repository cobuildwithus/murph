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
  createHostedPhoneLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripeCustomerLookupKeyReadCandidates,
  createHostedStripeSubscriptionLookupKey,
  createHostedStripeSubscriptionLookupKeyReadCandidates,
  hostedPhoneLookupKeyMatchesValue,
  readHostedPhoneHint,
} from "./contact-privacy";
import {
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
import { ensureHostedMemberForPhoneTx } from "./member-identity-service";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "./messaging-state";

export const HOSTED_FAMILY_BILLING_PLAN_CODE = "launch_family_monthly" as const;
export const HOSTED_FAMILY_MAX_SEATS = 4;
export const HOSTED_FAMILY_STRIPE_PRICE_ID_ENV_KEY =
  "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MONTHLY";
export const HOSTED_FAMILY_STRIPE_METADATA_KIND = "hosted_family_plan";

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

const HOSTED_ACCOUNT_GROUP_INVITE_TARGET_PHONE_FIELD =
  "hosted-account-group-invite.target-phone";
const HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CUSTOMER_FIELD =
  "hosted-account-group-billing-ref.stripe-customer-id";
const HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_SUBSCRIPTION_FIELD =
  "hosted-account-group-billing-ref.stripe-subscription-id";

const hostedAccountGroupAccessSelect =
  Prisma.validator<Prisma.HostedAccountGroupSelect>()({
    billingStatus: true,
    id: true,
    maxSeats: true,
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
    targetLabel: true,
    targetPhoneLookupKey: true,
    targetPhoneNumberEncrypted: true,
    targetTelegramUsernameHint: true,
    updatedAt: true,
  });

const hostedAccountGroupBillingRefSelect =
  Prisma.validator<Prisma.HostedAccountGroupBillingRefSelect>()({
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
    "stripeCustomerIdEncrypted" | "stripeSubscriptionIdEncrypted"
  > {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface HostedAccountGroupBillingLookup {
  billingRef: HostedAccountGroupBillingRefSnapshot;
  group: HostedAccountGroupAccessSnapshot;
  matchedBy: "stripeCustomerId" | "stripeSubscriptionId";
}

export type HostedFamilyStripeSubscriptionResult = {
  activations: HostedMemberActivationResult[];
  groupId: string | null;
};

export interface HostedAccountGroupInvitePrivateSnapshot
  extends Omit<HostedAccountGroupInviteSnapshot, "targetPhoneNumberEncrypted"> {
  targetPhoneHint: string | null;
  targetPhoneNumber: string | null;
}

export interface HostedFamilyEntitlementInput {
  familyAccessActive?: boolean;
  memberBillingStatus: HostedBillingStatus;
  memberSuspendedAt?: Date | null;
}

export interface HostedFamilyInviteCommand {
  targetLabel: string | null;
  targetPhoneNumber: string | null;
  targetTelegramUsername: string | null;
}

export interface HostedFamilyChatInviteResult {
  group: HostedAccountGroupAccessSnapshot;
  invite: HostedAccountGroupInvitePrivateSnapshot;
  replyText: string;
}

type HostedFamilyBillingCheckoutInput =
  | {
      alreadyActive: true;
    }
  | {
      alreadyActive: false;
      group: HostedAccountGroupAccessSnapshot;
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
  prisma?: HostedOnboardingReadClient;
}): Promise<HostedAccountGroupMembershipAccessSnapshot | null> {
  const prisma = input.prisma ?? getPrisma();
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

  const activeMembershipCount = await prisma.hostedAccountGroupMembership.count({
    where: {
      groupId: membership.groupId,
      status: "active",
    },
  });
  if (
    membership.group.maxSeats !== HOSTED_FAMILY_MAX_SEATS ||
    activeMembershipCount > membership.group.maxSeats
  ) {
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

  if (!(await hasHostedMemberEffectiveActiveAccessForMember(input))) {
    throw hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Active hosted access is required to continue.",
    });
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

export async function writeHostedAccountGroupStripeBillingTx(input: {
  billingStatus: HostedBillingStatus;
  currentBillingPhase?: string | null;
  currentBillingPlanCode?: string | null;
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  groupId: string;
  preserveLastStripeEventCreatedAt?: boolean;
  stripeCustomerId?: string | null;
  stripeEventCreatedAt?: Date | null;
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
  await assertHostedAccountGroupStripeBillingIdentifiersAvailableTx({
    groupId: input.groupId,
    stripeCustomerId,
    stripeSubscriptionId,
    tx: input.tx,
  });

  const privateColumns = await buildHostedAccountGroupBillingPrivateColumns({
    ownerMemberId: group.ownerMemberId,
    prisma: input.tx,
    stripeCustomerId,
    stripeSubscriptionId,
  });
  const stripeCustomerLookupKey = createHostedStripeCustomerLookupKey(stripeCustomerId);
  const stripeSubscriptionLookupKey = createHostedStripeSubscriptionLookupKey(stripeSubscriptionId);
  const preserveBillingFields = input.preserveLastStripeEventCreatedAt && currentBillingRef;

  const billingRef = await input.tx.hostedAccountGroupBillingRef.upsert({
    create: {
      ...privateColumns,
      currentBillingPhase: input.currentBillingPhase ?? null,
      currentBillingPlanCode: input.currentBillingPlanCode ?? HOSTED_FAMILY_BILLING_PLAN_CODE,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      currentPeriodStart: input.currentPeriodStart ?? null,
      groupId: input.groupId,
      lastStripeEventCreatedAt: input.preserveLastStripeEventCreatedAt
        ? null
        : input.stripeEventCreatedAt ?? null,
      stripeCustomerLookupKey,
      stripeSubscriptionLookupKey,
    },
    select: hostedAccountGroupBillingRefSelect,
    update: preserveBillingFields
      ? {
          ...privateColumns,
          stripeCustomerLookupKey,
          stripeSubscriptionLookupKey,
        }
      : {
          ...privateColumns,
          currentBillingPhase: input.currentBillingPhase ?? null,
          currentBillingPlanCode: input.currentBillingPlanCode ?? HOSTED_FAMILY_BILLING_PLAN_CODE,
          currentPeriodEnd: input.currentPeriodEnd ?? null,
          currentPeriodStart: input.currentPeriodStart ?? null,
          ...(input.preserveLastStripeEventCreatedAt
            ? {}
            : {
                lastStripeEventCreatedAt: input.stripeEventCreatedAt ?? null,
              }),
          stripeCustomerLookupKey,
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
  if (!isHostedFamilyStripeSubscription(input.subscription)) {
    return buildEmptyHostedFamilyStripeSubscriptionResult();
  }

  const group = await findHostedAccountGroupForStripeSubscription({
    prisma: input.tx,
    subscription: input.subscription,
  });
  if (!group) {
    return buildEmptyHostedFamilyStripeSubscriptionResult();
  }

  const billingStatus = mapStripeSubscriptionStatusToHostedBillingStatus(input.subscription.status);
  await writeHostedAccountGroupStripeBillingTx({
    billingStatus,
    currentBillingPhase: input.subscription.status === "active" ? "paid" : null,
    currentBillingPlanCode: HOSTED_FAMILY_BILLING_PLAN_CODE,
    ...buildHostedFamilyStripeSubscriptionPeriodSnapshot(input.subscription),
    groupId: group.id,
    stripeCustomerId: coerceStripeObjectId(input.subscription.customer),
    stripeEventCreatedAt: input.dispatchContext.eventCreatedAt ?? null,
    stripeSubscriptionId: input.subscription.id,
    tx: input.tx,
  });

  if (billingStatus === HostedBillingStatus.active) {
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
}): Promise<{ alreadyActive: boolean; url: string | null }> {
  const prisma = input.prisma ?? getPrisma();

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
    if (hasHostedAccountGroupAccess(group)) {
      return {
        alreadyActive: true,
        url: null,
      };
    }

    const currentBillingRef = await readHostedAccountGroupStripeBillingRef({
      groupId: group.id,
      prisma: tx,
    });

    return {
      alreadyActive: false,
      group,
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
      quantity: 1,
    }],
    metadata,
    mode: "subscription",
    payment_method_types: ["card"],
    subscription_data: {
      metadata,
    },
    success_url: `${publicBaseUrl}/settings?family_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
  }, {
    idempotencyKey: buildHostedFamilyBillingCheckoutIdempotencyKey({
      groupId: checkoutInput.group.id,
      priceId,
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

  return {
    alreadyActive: false,
    url: checkoutSession.url,
  };
}

export async function createHostedAccountGroupForOwner(input: {
  displayName?: string | null;
  groupId?: string;
  maxSeats?: number;
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
  maxSeats?: number;
  now?: Date;
  ownerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedAccountGroupAccessSnapshot> {
  const now = input.now ?? new Date();
  const groupId = input.groupId ?? generateHostedAccountGroupId();
  const maxSeats = input.maxSeats ?? HOSTED_FAMILY_MAX_SEATS;

  if (maxSeats !== HOSTED_FAMILY_MAX_SEATS) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_FIXED_SEAT_LIMIT_REQUIRED",
      httpStatus: 400,
      message: "Family plan supports exactly four seats in the MVP.",
    });
  }

  await lockHostedMemberRow(input.tx, input.ownerMemberId);

  const group = await input.tx.hostedAccountGroup.create({
    data: {
      billingStatus: HostedBillingStatus.not_started,
      displayName: normalizeFamilyLabel(input.displayName),
      id: groupId,
      maxSeats,
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

  const targetPhoneNumber = normalizePhoneNumber(input.targetPhoneNumber);
  const targetPhoneLookupKey = createHostedPhoneLookupKey(targetPhoneNumber);
  const targetTelegramUsernameHint = normalizeMurphTelegramUsername(
    input.targetTelegramUsername,
  );

  const existingTargetInvite = targetPhoneLookupKey || targetTelegramUsernameHint
    ? await input.tx.hostedAccountGroupInvite.findFirst({
        orderBy: {
          createdAt: "asc",
        },
        select: hostedAccountGroupInviteSelect,
        where: {
          OR: [
            ...(targetPhoneLookupKey ? [{ targetPhoneLookupKey }] : []),
            ...(targetTelegramUsernameHint ? [{ targetTelegramUsernameHint }] : []),
          ],
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

  const invite = await input.tx.hostedAccountGroupInvite.create({
    data: {
      channel: "family",
      expiresAt: inviteExpiresAt(now, ttlHours),
      groupId: group.id,
      id: generateHostedAccountGroupInviteId(),
      invitedByMemberId: input.invitedByMemberId,
      inviteCode: generateHostedInviteCode(),
      status: "pending",
      targetLabel: normalizeFamilyLabel(input.targetLabel),
      targetPhoneLookupKey,
      targetPhoneNumberEncrypted,
      targetTelegramUsernameHint,
    },
    select: hostedAccountGroupInviteSelect,
  });

  return projectHostedFamilyInvitePrivateSnapshot(invite, input.tx);
}

export function parseHostedFamilyInviteCommand(
  text: string | null | undefined,
): HostedFamilyInviteCommand | null {
  const normalized = normalizeNullableString(text);
  if (!normalized || !/\binvite\b/iu.test(normalized)) {
    return null;
  }

  const targetPhoneNumber = extractFamilyInviteCommandPhoneNumber(normalized);
  const targetTelegramUsername = extractFamilyInviteCommandTelegramUsername(normalized);
  if (!targetPhoneNumber && !targetTelegramUsername) {
    return null;
  }

  return {
    targetLabel: extractFamilyInviteCommandTargetLabel(normalized),
    targetPhoneNumber,
    targetTelegramUsername,
  };
}

export async function issueHostedFamilyInviteFromOwnerChatTx(input: {
  now?: Date;
  ownerMemberId: string;
  text: string | null | undefined;
  tx: Prisma.TransactionClient;
}): Promise<HostedFamilyChatInviteResult | null> {
  const command = parseHostedFamilyInviteCommand(input.text);
  if (!command) {
    return null;
  }

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
    targetLabel: command.targetLabel,
    targetPhoneNumber: command.targetPhoneNumber,
    targetTelegramUsername: command.targetTelegramUsername,
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
  inviteCode: string;
  now?: Date;
  phoneNumber?: string | null;
  prisma?: PrismaClient;
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
  telegramUserId: string;
  text: string | null | undefined;
  tx: Prisma.TransactionClient;
}): Promise<HostedAccountGroupMembershipAccessSnapshot | null> {
  const inviteCode = parseHostedFamilyInviteStartToken(input.text);
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
  await upsertHostedMemberTelegramRoutingBindingTx({
    memberId: member.id,
    prisma: input.tx,
    telegramThreadId: input.telegramThreadId,
    telegramUserId: input.telegramUserId,
  });

  return acceptHostedFamilyInviteTx({
    acceptedMemberId: member.id,
    inviteCode,
    now: input.now,
    tx: input.tx,
  });
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

  const member = await ensureHostedMemberForPhoneTx({
    phoneNumber: input.phoneNumber,
    prisma: input.tx,
  });

  return acceptHostedFamilyInviteTx({
    acceptedMemberId: member.id,
    inviteCode,
    now: input.now,
    onAcceptedMemberValidated: input.onAcceptedMemberValidated,
    phoneNumber: input.phoneNumber,
    tx: input.tx,
  });
}

export async function acceptHostedFamilyInviteTx(input: {
  acceptedMemberId: string;
  inviteCode: string;
  now?: Date;
  onAcceptedMemberValidated?: (input: {
    acceptedMemberId: string;
    invite: HostedAccountGroupInviteSnapshot;
  }) => Promise<void>;
  phoneNumber?: string | null;
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

  if (invite.status !== "pending" || invite.expiresAt <= now) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_NOT_ACTIVE",
      httpStatus: 410,
      message: "That family invite has expired or was already used.",
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

export function buildHostedFamilyInviteReplyText(input: {
  invite: Pick<HostedAccountGroupInvitePrivateSnapshot,
    "inviteCode" | "targetLabel" | "targetPhoneHint" | "targetPhoneNumber" | "targetTelegramUsernameHint"
  >;
  telegramBotUsername?: string | null;
}): string {
  const targetLabel = input.invite.targetLabel ?? "your family member";
  const inviteToken = `family_${input.invite.inviteCode}`;
  const lines = [
    `Done. I created a Murph Family invite for ${targetLabel}.`,
  ];
  const telegramBotUsername = normalizeMurphTelegramUsername(input.telegramBotUsername);

  if (telegramBotUsername) {
    lines.push(
      `Telegram link: ${buildHostedFamilyTelegramInviteUrl({
        botUsername: telegramBotUsername,
        inviteCode: input.invite.inviteCode,
      })}`,
    );
  } else if (input.invite.targetTelegramUsernameHint) {
    lines.push(`Telegram invite token: ${inviteToken}`);
  }

  if (input.invite.targetPhoneNumber) {
    lines.push(
      `WhatsApp/SMS token for ${input.invite.targetPhoneHint ?? "their phone"}: ${inviteToken}`,
    );
  }

  lines.push(
    "You pay for their Murph access, but you cannot see their private Murph conversations, health data, vault data, exports, or deletion data.",
  );

  return lines.join("\n\n");
}

export function buildHostedFamilyInviteAcceptedReplyText(): string {
  return MURPH_ASSISTANT_FAMILY_WELCOME_MESSAGE;
}

async function assertHostedFamilySeatAvailableTx(input: {
  group: Pick<HostedAccountGroupAccessSnapshot, "id" | "maxSeats">;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const [activeMemberships, pendingInvites] = await Promise.all([
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
  ]);

  if (activeMemberships + pendingInvites >= input.group.maxSeats) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
      httpStatus: 409,
      message: "This family plan already has four active or invited people.",
    });
  }
}

async function assertHostedFamilySeatAvailableForInviteAcceptanceTx(input: {
  acceptedMemberId: string;
  group: Pick<HostedAccountGroupAccessSnapshot, "id" | "maxSeats">;
  inviteId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const [activeMemberships, existingAcceptedMembership, pendingInvites] =
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
    ]);

  const acceptedMemberSeatDelta = existingAcceptedMembership ? 0 : 1;
  if (activeMemberships + pendingInvites + acceptedMemberSeatDelta > input.group.maxSeats) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
      httpStatus: 409,
      message: "This family plan already has four active or invited people.",
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
      group: {
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
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

  const activations: HostedMemberActivationResult[] = [];
  for (const membership of memberships) {
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

  return {
    ...invite,
    targetPhoneHint: targetPhoneNumber ? readHostedPhoneHint(targetPhoneNumber) : null,
    targetPhoneNumber,
  };
}

function normalizeFamilyLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length > 0 ? normalized.slice(0, 80) : null;
}

function extractFamilyInviteCommandPhoneNumber(text: string): string | null {
  const phoneMatch = text.match(
    /\b(?:phone(?:\s+number)?|number|whatsapp)\s*(?:is|=|:)?\s*(\+[0-9][0-9\s().-]{6,}[0-9])/iu,
  ) ?? text.match(/\B(\+[0-9][0-9\s().-]{6,}[0-9])\b/u);

  return normalizePhoneNumber(phoneMatch?.[1] ?? null);
}

function extractFamilyInviteCommandTelegramUsername(text: string): string | null {
  const telegramMatch = text.match(
    /\btelegram\s*(?:is|=|:|handle is|username is)?\s*@?([A-Za-z0-9_]{5,32})\b/iu,
  ) ?? text.match(/(^|\s)@([A-Za-z0-9_]{5,32})\b/u);

  return normalizeMurphTelegramUsername(telegramMatch?.[2] ?? telegramMatch?.[1] ?? null);
}

function extractFamilyInviteCommandTargetLabel(text: string): string | null {
  const labelMatch = text.match(
    /\binvite\s+(?:my\s+)?([a-z][a-z\s'-]{0,40}?)(?=,|\s+(?:her|his|their|phone|number|telegram|whatsapp)\b|$)/iu,
  );
  const rawLabel = normalizeFamilyLabel(labelMatch?.[1] ?? null);
  if (!rawLabel) {
    return null;
  }

  return rawLabel
    .replace(/\b(?:please|to|on)\b/giu, "")
    .trim()
    .replace(/\s+/gu, " ")
    .slice(0, 80)
    || null;
}

async function projectHostedAccountGroupBillingRefSnapshot(
  billingRef: HostedAccountGroupBillingRefRecord,
  prisma: HostedOnboardingReadClient,
): Promise<HostedAccountGroupBillingRefSnapshot> {
  const [stripeCustomerId, stripeSubscriptionId] = await Promise.all([
    decryptHostedWebNullableString({
      field: HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CUSTOMER_FIELD,
      memberId: billingRef.group.ownerMemberId,
      prisma,
      value: billingRef.stripeCustomerIdEncrypted,
    }),
    decryptHostedWebNullableString({
      field: HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_SUBSCRIPTION_FIELD,
      memberId: billingRef.group.ownerMemberId,
      prisma,
      value: billingRef.stripeSubscriptionIdEncrypted,
    }),
  ]);

  return {
    currentBillingPhase: billingRef.currentBillingPhase,
    currentBillingPlanCode: billingRef.currentBillingPlanCode,
    currentPeriodEnd: billingRef.currentPeriodEnd,
    currentPeriodStart: billingRef.currentPeriodStart,
    group: billingRef.group,
    groupId: billingRef.groupId,
    lastStripeEventCreatedAt: billingRef.lastStripeEventCreatedAt,
    stripeCustomerId,
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
  stripeSubscriptionId?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const [customerLookup, subscriptionLookup] = await Promise.all([
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
  ]);

  const conflictingLookup = [customerLookup, subscriptionLookup].find((lookup) =>
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
    stripeSubscriptionIdEncrypted,
  ] = await Promise.all([
    encryptPrivateField(
      HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CUSTOMER_FIELD,
      input.stripeCustomerId,
    ),
    encryptPrivateField(
      HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_SUBSCRIPTION_FIELD,
      input.stripeSubscriptionId,
    ),
  ]);

  return {
    stripeCustomerIdEncrypted,
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

function isHostedFamilyStripeSubscription(subscription: Stripe.Subscription): boolean {
  return subscription.metadata?.kind === HOSTED_FAMILY_STRIPE_METADATA_KIND &&
    subscription.metadata?.billingPlanCode === HOSTED_FAMILY_BILLING_PLAN_CODE &&
    readHostedFamilyStripeSubscriptionPriceIds(subscription).includes(
      requireHostedFamilyStripePriceId(),
    );
}

function readHostedFamilyStripeSubscriptionPriceIds(subscription: Stripe.Subscription): string[] {
  const items = subscription.items?.data ?? [];
  const priceIds: string[] = [];
  for (const item of items) {
    const priceId = typeof item.price?.id === "string" ? item.price.id : null;
    if (priceId) {
      priceIds.push(priceId);
    }
  }

  return priceIds;
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

function buildHostedFamilyBillingCheckoutIdempotencyKey(input: {
  groupId: string;
  priceId: string;
  stripeCustomerId?: string | null;
}): string {
  return [
    "hosted-family-billing-checkout",
    input.groupId,
    input.priceId,
    input.stripeCustomerId ?? "new-customer",
  ].join(":");
}

import { HostedBillingStatus, type Prisma, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { HOSTED_APP_INITIAL_VISIT_HOME_PATH } from "./app-routes";
import { buildHostedBillingOfferMetadata } from "./billing-offer-metadata";
import {
  HOSTED_PULSE_TRIAL_DAYS,
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
  HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
  isHostedAutoPulseTrialEnabled,
} from "./billing-plans";
import { isHostedMemberSuspended } from "./entitlement";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  readHostedMemberBillingSnapshot,
  type HostedMemberBillingSnapshot,
} from "./hosted-member-store";
import { bindHostedMemberStripeCustomerIdIfMissingTx } from "./hosted-member-billing-store";
import { assertHostedMemberBillingStartMessagingReady } from "./billing-start-preconditions";
import { requireHostedInviteForBillingCheckout } from "./invite-service";
import { requiresHostedBillingCheckout } from "./lifecycle";
import {
  activateHostedMemberForPositiveSourceTx,
} from "./member-activation";
import {
  signalHostedMemberActivationRuntimeWakeBestEffortResult,
} from "./member-activation-runtime-wake";
import { requireHostedStripeBillingPlanConfig } from "./runtime";
import {
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY,
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
} from "./legacy-usage-price";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "./shared";
import {
  sendHostedSignupWelcomeEmailForMemberBestEffort,
} from "./signup-welcome-email";
import {
  buildHostedPulseTrialCustomerIdempotencyKey,
  createHostedPulseTrialStripeCustomer,
} from "./pulse-trial-customer";
import {
  writeHostedMemberStripeBillingTx,
} from "./stripe-billing-policy";
import type { HostedStripeDispatchContext } from "./stripe-dispatch";

export type HostedAutoPulseTrialEnrollmentStatus =
  | "already_active"
  | "already_enrolled"
  | "enrolled";

export interface HostedAutoPulseTrialEnrollmentInput {
  inviteCode: string;
  member: HostedAutoPulseTrialAuthenticatedMember;
  now?: Date;
  prisma?: PrismaClient;
}

export interface HostedAutoPulseTrialAuthenticatedMember {
  id: string;
  suspendedAt: Date | null;
}

export interface HostedAutoPulseTrialEnrollmentResult {
  redirectPath: string;
  status: HostedAutoPulseTrialEnrollmentStatus;
}

export type HostedAutoPulseTrialCampaignSubscription = Pick<
  Stripe.Subscription,
  | "cancel_at"
  | "cancel_at_period_end"
  | "customer"
  | "id"
  | "metadata"
  | "status"
  | "trial_end"
  | "trial_start"
> & {
  created?: number;
  items?: {
    data: ReadonlyArray<{
      id: string;
      price?: {
        id?: string;
        metadata?: Record<string, string> | null;
        recurring?: {
          interval?: string;
          interval_count?: number;
          usage_type?: string;
        } | null;
      } | null;
      quantity?: number | null;
    }>;
  };
};

export type HostedAutoPulseTrialCampaignDisposition =
  | {
      kind: "cleanup-obsolete";
      subscription: HostedAutoPulseTrialCampaignSubscription;
    }
  | {
      kind: "not-applicable";
      reason: "provider-trial-ended" | "provider-trial-not-found";
      subscription: HostedAutoPulseTrialCampaignSubscription | null;
    }
  | {
      kind: "recoverable";
      subscription: HostedAutoPulseTrialCampaignSubscription;
    };

export type HostedAutoPulseTrialCampaignApplyTxResult =
  | {
      kind: "cleaned-up";
      postCommitEffects: HostedAutoPulseTrialPostCommitEffects;
    }
  | {
      kind: "recovered";
      postCommitEffects: HostedAutoPulseTrialPostCommitEffects;
    };

export interface HostedAutoPulseTrialCampaignCandidateState {
  billingStatus: HostedBillingStatus;
  currentStripeSubscriptionId: string | null;
  memberId: string;
}

type HostedAutoPulseTrialPostCommitEffects = {
  activatedMemberId: string | null;
  hostedExecutionEventId: string | null;
  welcomeEmailMemberId: string | null;
};

type HostedAutoPulseTrialReservationOutcome =
  | {
      kind: "existing";
      result: HostedAutoPulseTrialEnrollmentResult;
    }
  | {
      kind: "reserved";
      stripeCustomerId: string;
    };

type HostedAutoPulseTrialFinalizationOutcome =
  | {
      kind: "completed";
      cleanupStripeSubscriptionId: string | null;
      postCommitEffects: HostedAutoPulseTrialPostCommitEffects;
      result: HostedAutoPulseTrialEnrollmentResult;
    }
  | {
      kind: "failed";
      cleanupStripeSubscriptionId: string;
      error: Error;
    };

const EMPTY_AUTO_TRIAL_POST_COMMIT_EFFECTS: HostedAutoPulseTrialPostCommitEffects = {
  activatedMemberId: null,
  hostedExecutionEventId: null,
  welcomeEmailMemberId: null,
};

export async function ensureHostedAutoPulseTrialEnrollment(
  input: HostedAutoPulseTrialEnrollmentInput,
): Promise<HostedAutoPulseTrialEnrollmentResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();

  if (!isHostedAutoPulseTrialEnabled()) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_DISABLED",
      message: "Auto Pulse Trial enrollment is not available yet.",
      httpStatus: 404,
    });
  }

  const invite = await requireHostedInviteForBillingCheckout(
    input.inviteCode,
    prisma,
    now,
  );

  if (invite.member.id !== input.member.id) {
    throw hostedOnboardingError({
      code: "AUTH_INVITE_MISMATCH",
      message: "That invite belongs to a different hosted member.",
      httpStatus: 403,
    });
  }

  if (
    isHostedMemberSuspended(input.member.suspendedAt) ||
    isHostedMemberSuspended(invite.member.suspendedAt)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  await assertHostedLaunchRequiredConsentGranted({
    memberId: invite.member.id,
    prisma,
  });

  await assertHostedMemberBillingStartMessagingReady({
    identity: invite.member.identity,
    prisma,
    routing: invite.member.routing,
  });

  const initialMember = await readHostedAutoPulseTrialEnrollmentMember({
    memberId: invite.member.id,
    prisma,
  });
  const initialStatus = resolveHostedAutoPulseTrialExistingStatus(initialMember);
  if (initialStatus) {
    return buildHostedAutoPulseTrialEnrollmentResult(initialStatus);
  }

  assertHostedAutoPulseTrialEligible(initialMember);

  const { priceId, stripe } = requireHostedStripeBillingPlanConfig({
    billingPlanCode: "launch_monthly",
  });
  const metadata = buildHostedAutoPulseTrialMetadata(invite.member.id);
  const candidateStripeCustomerId = initialMember.billingRef?.stripeCustomerId ??
    await createHostedPulseTrialStripeCustomer({
      memberId: invite.member.id,
      stripe,
    });

  const reservation = await prisma.$transaction(async (tx): Promise<HostedAutoPulseTrialReservationOutcome> => {
    await lockHostedMemberRow(tx, invite.member.id);
    const currentMember = await readHostedAutoPulseTrialEnrollmentMember({
      memberId: invite.member.id,
      prisma: tx,
    });
    const currentStatus = resolveHostedAutoPulseTrialExistingStatus(currentMember);
    if (currentStatus) {
      return {
        kind: "existing",
        result: buildHostedAutoPulseTrialEnrollmentResult(currentStatus),
      };
    }

    assertHostedAutoPulseTrialEligible(currentMember);
    const reservedBillingRef = currentMember.billingRef?.stripeCustomerId
      ? currentMember.billingRef
      : await bindHostedMemberStripeCustomerIdIfMissingTx({
          memberId: invite.member.id,
          stripeCustomerId: candidateStripeCustomerId,
          tx,
        });
    const stripeCustomerId = reservedBillingRef?.stripeCustomerId;
    if (!stripeCustomerId) {
      throw hostedOnboardingError({
        code: "HOSTED_AUTO_PULSE_TRIAL_CUSTOMER_BIND_FAILED",
        httpStatus: 409,
        message: "Murph could not reserve Stripe billing for trial activation. Try again.",
        retryable: true,
      });
    }

    return {
      kind: "reserved",
      stripeCustomerId,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (reservation.kind === "existing") {
    return reservation.result;
  }

  const subscription = await resolveHostedAutoPulseTrialStripeSubscription({
    memberId: invite.member.id,
    metadata,
    priceId,
    stripe,
    stripeCustomerId: reservation.stripeCustomerId,
  });
  return finalizeHostedAutoPulseTrialEnrollment({
    memberId: invite.member.id,
    now,
    prisma,
    stripe,
    stripeCustomerId: reservation.stripeCustomerId,
    subscription,
  });
}

export async function inspectHostedAutoPulseTrialCampaignDisposition(input: {
  candidate: HostedAutoPulseTrialCampaignCandidateState;
  priceId: string;
  requestOptions: Stripe.RequestOptions;
  stripe: Stripe;
  stripeCustomerId: string;
  targetStripeSubscriptionId?: string;
  trialStartedBefore: Date;
}): Promise<HostedAutoPulseTrialCampaignDisposition> {
  const hasCurrentActiveBilling =
    input.candidate.billingStatus === HostedBillingStatus.active;
  const subscriptions = await listHostedAutoPulseTrialStripeSubscriptionsForRecovery({
    pageLimit: 1,
    requestOptions: input.requestOptions,
    stripe: input.stripe,
    stripeCustomerId: input.stripeCustomerId,
  });
  const matchingSubscriptions = subscriptions.data
    .filter((subscription) => isHostedAutoPulseTrialStripeSubscriptionForMember({
      memberId: input.candidate.memberId,
      priceId: input.priceId,
      subscription,
      trialStartedBefore: input.trialStartedBefore,
    }))
    .filter((subscription) =>
      !isTerminalHostedAutoPulseTrialStripeSubscription(subscription)
    )
    .sort(compareHostedStripeSubscriptionsNewestFirst);
  if (!input.targetStripeSubscriptionId && matchingSubscriptions.length > 1) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
      message: "Murph found an unfinished trial setup. Contact support to restore access.",
    });
  }
  const subscription = input.targetStripeSubscriptionId
    ? matchingSubscriptions.find(
        (candidate) => candidate.id === input.targetStripeSubscriptionId,
      ) ?? null
    : matchingSubscriptions[0] ?? null;
  if (!subscription) {
    return {
      kind: "not-applicable",
      reason: "provider-trial-not-found",
      subscription: null,
    };
  }

  if (
    hasCurrentActiveBilling &&
    input.candidate.currentStripeSubscriptionId !== subscription.id
  ) {
    return {
      kind: "cleanup-obsolete",
      subscription,
    };
  }

  if (subscription.status === "active" || subscription.status === "paused") {
    return {
      kind: "not-applicable",
      reason: "provider-trial-ended",
      subscription,
    };
  }

  if (subscription.status !== "trialing") {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
      message: "Murph found an unfinished trial setup. Contact support to restore access.",
    });
  }

  return {
    kind: "recoverable",
    subscription,
  };
}

export async function applyHostedAutoPulseTrialCampaignDispositionTx(input: {
  campaignPolicy: {
    minimumTrialRunwaySeconds: number;
    priceId: string;
    trialStartedBefore: Date;
  };
  currentMember: HostedMemberBillingSnapshot;
  disposition: Exclude<HostedAutoPulseTrialCampaignDisposition, { kind: "not-applicable" }>;
  now: Date;
  requestOptions: Stripe.RequestOptions;
  stripe: Stripe;
  stripeCustomerId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedAutoPulseTrialCampaignApplyTxResult> {
  if (input.disposition.kind === "cleanup-obsolete") {
    const cleanupSubscriptionId = readHostedAutoPulseTrialCleanupSubscriptionId({
      currentMember: input.currentMember,
      subscription: input.disposition.subscription,
    });
    if (!cleanupSubscriptionId) {
      throw hostedOnboardingError({
        code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
        httpStatus: 409,
        message: "Murph found an unfinished trial setup. Contact support to restore access.",
      });
    }
    await cancelHostedAutoPulseTrialStripeSubscriptionIfNeeded({
      requestOptions: input.requestOptions,
      stripe: input.stripe,
      subscriptionId: cleanupSubscriptionId,
    });
    return {
      kind: "cleaned-up",
      postCommitEffects: EMPTY_AUTO_TRIAL_POST_COMMIT_EFFECTS,
    };
  }

  assertHostedAutoPulseTrialCampaignSubscriptionEligible({
    minimumTrialRunwaySeconds: input.campaignPolicy.minimumTrialRunwaySeconds,
    now: input.now,
    priceId: input.campaignPolicy.priceId,
    stripeCustomerId: input.stripeCustomerId,
    subscription: input.disposition.subscription,
    trialStartedBefore: input.campaignPolicy.trialStartedBefore,
  });

  const outcome = await finalizeHostedAutoPulseTrialEnrollmentTx({
    currentMember: input.currentMember,
    memberId: input.currentMember.core.id,
    now: input.now,
    stripeCustomerId: input.stripeCustomerId,
    subscription: input.disposition.subscription,
    trialSnapshot: readHostedAutoPulseTrialSubscriptionSnapshot(
      input.disposition.subscription,
    ),
    tx: input.tx,
  });
  if (outcome.kind === "failed") {
    throw outcome.error;
  }
  await cancelHostedAutoPulseTrialStripeSubscriptionIfNeeded({
    requestOptions: input.requestOptions,
    stripe: input.stripe,
    subscriptionId: outcome.cleanupStripeSubscriptionId,
  });
  return {
    kind: outcome.result.status === "enrolled" ? "recovered" : "cleaned-up",
    postCommitEffects: outcome.postCommitEffects,
  };
}

function assertHostedAutoPulseTrialCampaignSubscriptionEligible(input: {
  minimumTrialRunwaySeconds: number;
  now: Date;
  priceId: string;
  stripeCustomerId: string;
  subscription: HostedAutoPulseTrialCampaignSubscription;
  trialStartedBefore: Date;
}): void {
  const subscription = input.subscription;
  const trialStart = readHostedStripeObjectDate(subscription, "trial_start");
  const trialEnd = readHostedStripeObjectDate(subscription, "trial_end");
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer && typeof subscription.customer === "object"
      ? Reflect.get(subscription.customer, "id")
      : null;
  const items = subscription.items?.data ?? [];
  const baseItems = items.filter((item) => item.price?.id === input.priceId);
  const baseItem = baseItems[0];
  const exactItems = baseItems.length === 1 &&
    baseItem?.price?.recurring?.interval === "month" &&
    baseItem.price.recurring.usage_type !== "metered" &&
    baseItem.quantity === 1 &&
    items.every((item) =>
      item.id === baseItem.id ||
      (
        item.price?.recurring?.interval === "month" &&
        (item.price.recurring.interval_count ?? 1) === 1 &&
        item.price.recurring.usage_type === "metered" &&
        item.price.metadata?.[HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY] ===
          HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE &&
        !(typeof item.quantity === "number" && Number.isFinite(item.quantity))
      )
    );
  if (
    subscription.status !== "trialing" ||
    subscription.cancel_at_period_end ||
    subscription.cancel_at !== null ||
    customerId !== input.stripeCustomerId ||
    subscription.metadata.billingPlanCode !== "launch_monthly" ||
    subscription.metadata.checkoutOffer !== HOSTED_PULSE_TRIAL_OFFER ||
    subscription.metadata.trialDurationDays !== HOSTED_PULSE_TRIAL_DAYS.toString() ||
    subscription.metadata.trialPolicyVersion !== HOSTED_PULSE_TRIAL_POLICY_VERSION ||
    subscription.metadata.trialUsageLimitUsdMicros !==
      HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS.toString() ||
    !trialStart ||
    !trialEnd ||
    trialStart >= input.trialStartedBefore ||
    trialStart >= trialEnd ||
    trialEnd.getTime() <= input.now.getTime() +
      input.minimumTrialRunwaySeconds * 1000 ||
    !exactItems
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
      message: "Murph found an unfinished trial setup. Contact support to restore access.",
    });
  }
}

export async function runHostedAutoPulseTrialCampaignPostCommitEffects(input: {
  effects: HostedAutoPulseTrialPostCommitEffects;
  prisma: PrismaClient;
  timeoutMs: number;
}): Promise<void> {
  try {
    if (input.effects.activatedMemberId && input.effects.hostedExecutionEventId) {
      await signalHostedMemberActivationRuntimeWakeBestEffortResult({
        hostedExecutionEventId: input.effects.hostedExecutionEventId,
        memberId: input.effects.activatedMemberId,
        prisma: input.prisma,
        source: "auto-pulse-trial.campaign-activation",
        timeoutMs: input.timeoutMs,
      });
    }

    if (input.effects.welcomeEmailMemberId && input.timeoutMs >= 31_000) {
      await sendHostedSignupWelcomeEmailForMemberBestEffort({
        memberId: input.effects.welcomeEmailMemberId,
        prisma: input.prisma,
      });
    }
  } catch {
    // The durable member.activated mailbox item is the continuation. These
    // immediate effects are bounded latency hints and cannot change a commit.
  }
}

async function finalizeHostedAutoPulseTrialEnrollment(input: {
  memberId: string;
  now: Date;
  prisma: PrismaClient;
  stripe: Stripe;
  stripeCustomerId: string;
  subscription: HostedAutoPulseTrialCampaignSubscription;
}): Promise<HostedAutoPulseTrialEnrollmentResult> {
  const trialSnapshot = readHostedAutoPulseTrialSubscriptionSnapshot(input.subscription);
  const outcome = await input.prisma.$transaction(
    async (tx): Promise<HostedAutoPulseTrialFinalizationOutcome> => {
      await lockHostedMemberRow(tx, input.memberId);
      const currentMember = await readHostedAutoPulseTrialEnrollmentMember({
        memberId: input.memberId,
        prisma: tx,
      });
      return finalizeHostedAutoPulseTrialEnrollmentTx({
        currentMember,
        memberId: input.memberId,
        now: input.now,
        stripeCustomerId: input.stripeCustomerId,
        subscription: input.subscription,
        trialSnapshot,
        tx,
      });
    },
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );

  await cancelHostedAutoPulseTrialStripeSubscriptionIfNeeded({
    stripe: input.stripe,
    subscriptionId: outcome.cleanupStripeSubscriptionId,
  });

  if (outcome.kind === "failed") {
    throw outcome.error;
  }

  await runHostedAutoPulseTrialPostCommitEffects({
    ...outcome.postCommitEffects,
    prisma: input.prisma,
  });

  return outcome.result;
}

async function finalizeHostedAutoPulseTrialEnrollmentTx(input: {
  currentMember: HostedMemberBillingSnapshot;
  memberId: string;
  now: Date;
  stripeCustomerId: string;
  subscription: HostedAutoPulseTrialCampaignSubscription;
  trialSnapshot: ReturnType<typeof readHostedAutoPulseTrialSubscriptionSnapshot>;
  tx: Prisma.TransactionClient;
}): Promise<HostedAutoPulseTrialFinalizationOutcome> {
  const currentStatus = resolveHostedAutoPulseTrialExistingStatus(input.currentMember);
  const isIncompleteSameTrial = currentStatus === "already_enrolled" &&
    input.currentMember.billingRef?.pulseTrialRedeemedAt === null &&
    input.currentMember.billingRef.stripeSubscriptionId === input.subscription.id;
  if (currentStatus && !isIncompleteSameTrial) {
    return {
      kind: "completed",
      cleanupStripeSubscriptionId: readHostedAutoPulseTrialCleanupSubscriptionId({
        currentMember: input.currentMember,
        subscription: input.subscription,
      }),
      postCommitEffects: EMPTY_AUTO_TRIAL_POST_COMMIT_EFFECTS,
      result: buildHostedAutoPulseTrialEnrollmentResult(currentStatus),
    };
  }

  const eligibilityError = isIncompleteSameTrial
    ? null
    : readHostedAutoPulseTrialEligibilityError(input.currentMember);
  if (eligibilityError) {
    return {
      kind: "failed",
      cleanupStripeSubscriptionId: input.subscription.id,
      error: eligibilityError,
    };
  }

  const finalBillingRef = input.currentMember.billingRef?.stripeCustomerId
    ? input.currentMember.billingRef
    : await bindHostedMemberStripeCustomerIdIfMissingTx({
        memberId: input.memberId,
        stripeCustomerId: input.stripeCustomerId,
        tx: input.tx,
      });
  if (finalBillingRef?.stripeCustomerId !== input.stripeCustomerId) {
    return {
      kind: "failed",
      cleanupStripeSubscriptionId: input.subscription.id,
      error: hostedOnboardingError({
        code: "HOSTED_AUTO_PULSE_TRIAL_CUSTOMER_BIND_FAILED",
        httpStatus: 409,
        message: "Murph could not reserve Stripe billing for trial activation. Try again.",
        retryable: true,
      }),
    };
  }

  const dispatchContext = buildHostedAutoPulseTrialDispatchContext({
    billingRefLastStripeEventCreatedAt:
      input.currentMember.billingRef?.lastStripeEventCreatedAt ?? null,
    now: input.now,
    subscription: input.subscription,
  });
  const updatedMember = await writeHostedMemberStripeBillingTx({
    billingStatus: HostedBillingStatus.active,
    canonicalBillingStatus: HostedBillingStatus.active,
    currentBillingPhase: "trial",
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
    currentPeriodEnd: input.trialSnapshot.currentPeriodEnd,
    currentPeriodStart: input.trialSnapshot.currentPeriodStart,
    currentTrialEndsAt: input.trialSnapshot.trialEndsAt,
    currentTrialStartedAt: input.trialSnapshot.trialStartedAt,
    dispatchContext,
    freshnessPolicy: "auto-pulse-trial-entitlement",
    member: input.currentMember,
    pulseTrialPolicyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
    pulseTrialRedeemedAt: input.trialSnapshot.trialStartedAt,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.subscription.id,
    tx: input.tx,
  });
  if (!updatedMember) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_WRITE_SKIPPED",
      httpStatus: 409,
      message: "Murph could not finish trial activation. Try again.",
      retryable: true,
    });
  }

  const activation = await activateHostedMemberForPositiveSourceTx({
    dispatchContext,
    memberId: updatedMember.core.id,
    prisma: input.tx,
    skipIfBillingAlreadyActive: false,
    skipIfPreviouslyActivated: true,
  });
  return {
    kind: "completed",
    cleanupStripeSubscriptionId: null,
    postCommitEffects: {
      activatedMemberId: activation.activated ? updatedMember.core.id : null,
      hostedExecutionEventId: activation.hostedExecutionEventId,
      welcomeEmailMemberId:
        activation.activated || activation.hostedExecutionEventId
          ? updatedMember.core.id
          : null,
    },
    result: buildHostedAutoPulseTrialEnrollmentResult("enrolled"),
  };
}

async function readHostedAutoPulseTrialEnrollmentMember(input: {
  memberId: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<HostedMemberBillingSnapshot> {
  const member = await readHostedMemberBillingSnapshot({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    });
  }

  return member;
}

function resolveHostedAutoPulseTrialExistingStatus(
  member: HostedMemberBillingSnapshot,
): HostedAutoPulseTrialEnrollmentStatus | null {
  if (
    isHostedMemberSuspended(member.core.suspendedAt) ||
    member.core.billingStatus !== HostedBillingStatus.active
  ) {
    return null;
  }

  return member.billingRef?.currentBillingPhase === "trial" &&
    member.billingRef.currentCheckoutOffer === HOSTED_PULSE_TRIAL_OFFER
    ? "already_enrolled"
    : "already_active";
}

function assertHostedAutoPulseTrialEligible(
  member: HostedMemberBillingSnapshot,
): void {
  const error = readHostedAutoPulseTrialEligibilityError(member);
  if (error) {
    throw error;
  }
}

function readHostedAutoPulseTrialEligibilityError(
  member: HostedMemberBillingSnapshot,
): Error | null {
  if (isHostedMemberSuspended(member.core.suspendedAt)) {
    return hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  if (member.billingRef?.pulseTrialRedeemedAt) {
    return hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_ALREADY_REDEEMED",
      message: "This hosted account has already used its Pulse Trial.",
      httpStatus: 409,
    });
  }

  if (!requiresHostedBillingCheckout(member.core.billingStatus)) {
    return hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_BLOCKED",
      message: "This hosted account cannot start a trial right now. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  return null;
}

function buildHostedAutoPulseTrialMetadata(memberId: string): Record<string, string> {
  return buildHostedBillingOfferMetadata({
    billingPlanCode: "launch_monthly",
    checkoutOffer: HOSTED_PULSE_TRIAL_OFFER,
    memberId,
  });
}

async function createHostedAutoPulseTrialStripeSubscription(input: {
  idempotencyKeyScope: string;
  metadata: Record<string, string>;
  memberId: string;
  priceId: string;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<Stripe.Subscription> {
  return input.stripe.subscriptions.create({
    customer: input.stripeCustomerId,
    items: [
      {
        price: input.priceId,
        quantity: 1,
      },
    ],
    metadata: input.metadata,
    trial_period_days: HOSTED_PULSE_TRIAL_DAYS,
    trial_settings: {
      end_behavior: {
        missing_payment_method: "pause",
      },
    },
  }, {
    idempotencyKey: buildHostedAutoPulseTrialSubscriptionIdempotencyKey({
      memberId: input.memberId,
      policyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
      priceId: input.priceId,
      recoveryScope: input.idempotencyKeyScope,
      stripeCustomerId: input.stripeCustomerId,
    }),
  });
}

type HostedAutoPulseTrialStripeSubscriptionRecovery = {
  idempotencyKeyScope: string;
  otherLiveSubscription: Stripe.Subscription | null;
  reusableSubscription: Stripe.Subscription | null;
};

async function resolveHostedAutoPulseTrialStripeSubscription(input: {
  metadata: Record<string, string>;
  memberId: string;
  priceId: string;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<Stripe.Subscription> {
  const recovery =
    await findReusableHostedAutoPulseTrialStripeSubscription(input);

  if (recovery.reusableSubscription) {
    return recovery.reusableSubscription;
  }

  return createHostedAutoPulseTrialStripeSubscription({
    ...input,
    idempotencyKeyScope: recovery.idempotencyKeyScope,
  });
}

async function findReusableHostedAutoPulseTrialStripeSubscription(input: {
  acceptOtherLiveSubscription?: boolean;
  acceptPausedAsEnded?: boolean;
  memberId: string;
  pageLimit?: number;
  priceId: string;
  requestOptions?: Stripe.RequestOptions;
  stripe: Stripe;
  stripeCustomerId: string;
  trialStartedBefore?: Date;
}): Promise<HostedAutoPulseTrialStripeSubscriptionRecovery> {
  const subscriptions = await listHostedAutoPulseTrialStripeSubscriptionsForRecovery(input);

  const matchingSubscriptions = subscriptions.data
    .filter((subscription) => isHostedAutoPulseTrialStripeSubscriptionForMember({
      memberId: input.memberId,
      priceId: input.priceId,
      subscription,
      trialStartedBefore: input.trialStartedBefore,
    }))
    .sort(compareHostedStripeSubscriptionsNewestFirst);
  const liveMatchingSubscriptions = matchingSubscriptions.filter(
    (subscription) => !isTerminalHostedAutoPulseTrialStripeSubscription(subscription),
  );
  const terminalMatchingSubscriptions = matchingSubscriptions.filter(
    isTerminalHostedAutoPulseTrialStripeSubscription,
  );
  if (liveMatchingSubscriptions.length > 1) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
      message: "Murph found an unfinished trial setup. Contact support to restore access.",
    });
  }

  const reusableSubscription = liveMatchingSubscriptions.find(
    (subscription) => isReusableHostedAutoPulseTrialStripeSubscription({
      priceId: input.priceId,
      subscription,
    }),
  );

  if (reusableSubscription) {
    return {
      idempotencyKeyScope: buildHostedAutoPulseTrialSubscriptionIdempotencyKeyScope(
        terminalMatchingSubscriptions,
      ),
      otherLiveSubscription: null,
      reusableSubscription,
    };
  }

  const otherLiveSubscription = input.acceptOtherLiveSubscription
    ? liveMatchingSubscriptions[0] ?? null
    : input.acceptPausedAsEnded
      ? liveMatchingSubscriptions.find((subscription) => subscription.status === "paused") ?? null
      : null;
  if (otherLiveSubscription) {
    return {
      idempotencyKeyScope: buildHostedAutoPulseTrialSubscriptionIdempotencyKeyScope(
        terminalMatchingSubscriptions,
      ),
      otherLiveSubscription,
      reusableSubscription: null,
    };
  }

  if (liveMatchingSubscriptions.length > 0) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
      message: "Murph found an unfinished trial setup. Contact support to restore access.",
    });
  }

  return {
    idempotencyKeyScope: buildHostedAutoPulseTrialSubscriptionIdempotencyKeyScope(
      terminalMatchingSubscriptions,
    ),
    otherLiveSubscription: null,
    reusableSubscription: null,
  };
}

async function listHostedAutoPulseTrialStripeSubscriptionsForRecovery(input: {
  pageLimit?: number;
  requestOptions?: Stripe.RequestOptions;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<Stripe.ApiList<Stripe.Subscription>> {
  const data: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  let pagesRead = 0;

  try {
    for (;;) {
      const params = {
        customer: input.stripeCustomerId,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
        status: "all" as const,
      };
      const page = input.requestOptions
        ? await input.stripe.subscriptions.list(params, input.requestOptions)
        : await input.stripe.subscriptions.list(params);
      pagesRead += 1;
      data.push(...page.data);

      if (!page.has_more) {
        return {
          data,
          has_more: false,
          object: "list",
          url: page.url,
        };
      }

      if (input.pageLimit !== undefined && pagesRead >= input.pageLimit) {
        throw hostedOnboardingError({
          code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_LOOKUP_INCOMPLETE",
          httpStatus: 409,
          message: "Murph found too many Stripe subscriptions to verify safely.",
          retryable: false,
        });
      }

      const lastSubscription = page.data.at(-1);
      if (!lastSubscription) {
        return {
          data,
          has_more: true,
          object: "list",
          url: page.url,
        };
      }

      startingAfter = lastSubscription.id;
    }
  } catch (error) {
    if (isHostedOnboardingError(error)) {
      throw error;
    }
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_LOOKUP_FAILED",
      httpStatus: 502,
      message: "Murph could not check for an unfinished trial setup. Try again.",
      retryable: true,
    });
  }
}

function isHostedAutoPulseTrialStripeSubscriptionForMember(input: {
  memberId: string;
  priceId: string;
  subscription: HostedAutoPulseTrialCampaignSubscription;
  trialStartedBefore?: Date;
}): boolean {
  const trialStart = readHostedStripeObjectDate(input.subscription, "trial_start");
  return input.subscription.metadata?.memberId === input.memberId &&
    input.subscription.metadata.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER &&
    (
      !input.trialStartedBefore ||
      (
        input.subscription.metadata.billingPlanCode === "launch_monthly" &&
        input.subscription.metadata.trialDurationDays === HOSTED_PULSE_TRIAL_DAYS.toString() &&
        input.subscription.metadata.trialPolicyVersion === HOSTED_PULSE_TRIAL_POLICY_VERSION &&
        input.subscription.metadata.trialUsageLimitUsdMicros ===
          HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS.toString() &&
        input.subscription.items?.data.some((item) => item.price?.id === input.priceId) === true &&
        trialStart !== null &&
        trialStart < input.trialStartedBefore
      )
    );
}

function isReusableHostedAutoPulseTrialStripeSubscription(input: {
  priceId: string;
  subscription: HostedAutoPulseTrialCampaignSubscription;
}): boolean {
  return input.subscription.status === "trialing" &&
    input.subscription.metadata?.billingPlanCode === "launch_monthly" &&
    input.subscription.metadata.trialDurationDays === HOSTED_PULSE_TRIAL_DAYS.toString() &&
    input.subscription.metadata.trialPolicyVersion === HOSTED_PULSE_TRIAL_POLICY_VERSION &&
    input.subscription.metadata.trialUsageLimitUsdMicros ===
      HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS.toString() &&
    input.subscription.items?.data.some(
      (item) => item.price?.id === input.priceId,
    ) === true;
}

function isTerminalHostedAutoPulseTrialStripeSubscription(
  subscription: HostedAutoPulseTrialCampaignSubscription,
): boolean {
  return subscription.status === "canceled" ||
    subscription.status === "incomplete_expired";
}

function compareHostedStripeSubscriptionsNewestFirst(
  left: Stripe.Subscription,
  right: Stripe.Subscription,
): number {
  return (right.created ?? 0) - (left.created ?? 0);
}

function readHostedAutoPulseTrialSubscriptionSnapshot(
  subscription: HostedAutoPulseTrialCampaignSubscription,
): {
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  trialEndsAt: Date;
  trialStartedAt: Date;
} {
  if (subscription.status !== "trialing") {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_SUBSCRIPTION_NOT_TRIALING",
      httpStatus: 502,
      message: "Stripe did not create a trialing subscription for Murph trial activation.",
      retryable: true,
    });
  }

  const trialStartedAt = readHostedStripeObjectDate(subscription, "trial_start");
  const trialEndsAt = readHostedStripeObjectDate(subscription, "trial_end");
  if (!trialStartedAt || !trialEndsAt || trialStartedAt.getTime() >= trialEndsAt.getTime()) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_DATES_MISSING",
      httpStatus: 502,
      message: "Stripe did not return valid trial dates for Murph trial activation.",
      retryable: true,
    });
  }

  return {
    ...readHostedAutoPulseTrialCurrentPeriod(subscription),
    trialEndsAt,
    trialStartedAt,
  };
}

function readHostedAutoPulseTrialCurrentPeriod(
  subscription: HostedAutoPulseTrialCampaignSubscription,
): {
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
} {
  const currentPeriodStart = readHostedStripeObjectDate(subscription, "current_period_start") ??
    readHostedStripeSubscriptionItemDate(subscription, "current_period_start");
  const currentPeriodEnd = readHostedStripeObjectDate(subscription, "current_period_end") ??
    readHostedStripeSubscriptionItemDate(subscription, "current_period_end");

  if (!currentPeriodStart || !currentPeriodEnd || currentPeriodStart.getTime() >= currentPeriodEnd.getTime()) {
    return {};
  }

  return {
    currentPeriodEnd,
    currentPeriodStart,
  };
}

function readHostedStripeSubscriptionItemDate(
  subscription: HostedAutoPulseTrialCampaignSubscription,
  field: string,
): Date | null {
  for (const item of subscription.items?.data ?? []) {
    const value = readHostedStripeObjectDate(item, field);
    if (value) {
      return value;
    }
  }

  return null;
}

function buildHostedAutoPulseTrialDispatchContext(input: {
  billingRefLastStripeEventCreatedAt: Date | null;
  now: Date;
  subscription: HostedAutoPulseTrialCampaignSubscription;
}): HostedStripeDispatchContext {
  const eventCreatedAt = maxHostedAutoPulseTrialDate([
    input.now,
    input.billingRefLastStripeEventCreatedAt,
    readHostedStripeObjectDate(input.subscription, "created"),
  ]);
  return {
    eventCreatedAt,
    occurredAt: eventCreatedAt.toISOString(),
    sourceEventId: buildHostedAutoPulseTrialSourceEventId(input.subscription.id),
    sourceType: "hosted.auto_pulse_trial.enrolled",
  };
}

function readHostedAutoPulseTrialCleanupSubscriptionId(input: {
  currentMember: HostedMemberBillingSnapshot;
  subscription: HostedAutoPulseTrialCampaignSubscription;
}): string | null {
  return input.currentMember.billingRef?.stripeSubscriptionId === input.subscription.id
    ? null
    : input.subscription.id;
}

async function cancelHostedAutoPulseTrialStripeSubscriptionIfNeeded(input: {
  requestOptions?: Stripe.RequestOptions;
  stripe: Stripe;
  subscriptionId: string | null;
}): Promise<void> {
  if (!input.subscriptionId) {
    return;
  }

  try {
    if (input.requestOptions) {
      await input.stripe.subscriptions.cancel(
        input.subscriptionId,
        {},
        input.requestOptions,
      );
    } else {
      await input.stripe.subscriptions.cancel(input.subscriptionId);
    }
  } catch {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_CLEANUP_FAILED",
      httpStatus: 502,
      message: "Murph could not cancel an unused Stripe trial. Contact support to restore billing.",
    });
  }
}

function readHostedStripeObjectDate(value: object, field: string): Date | null {
  const raw = Reflect.get(value, field);
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }

  return new Date(raw * 1000);
}

function maxHostedAutoPulseTrialDate(values: Array<Date | null>): Date {
  return values.reduce<Date>((max, value) => {
    if (!value) {
      return max;
    }

    return value.getTime() > max.getTime() ? value : max;
  }, new Date(0));
}

async function runHostedAutoPulseTrialPostCommitEffects(
  input: HostedAutoPulseTrialPostCommitEffects & { prisma: PrismaClient },
): Promise<void> {
  if (input.activatedMemberId && input.hostedExecutionEventId) {
    await signalHostedMemberActivationRuntimeWakeBestEffortResult({
      hostedExecutionEventId: input.hostedExecutionEventId,
      memberId: input.activatedMemberId,
      prisma: input.prisma,
      source: "auto-pulse-trial.activation",
    });
  }

  if (input.welcomeEmailMemberId) {
    await sendHostedSignupWelcomeEmailForMemberBestEffort({
      memberId: input.welcomeEmailMemberId,
      prisma: input.prisma,
    });
  }
}

function buildHostedAutoPulseTrialEnrollmentResult(
  status: HostedAutoPulseTrialEnrollmentStatus,
): HostedAutoPulseTrialEnrollmentResult {
  return {
    redirectPath: HOSTED_APP_INITIAL_VISIT_HOME_PATH,
    status,
  };
}

export function buildHostedAutoPulseTrialCustomerIdempotencyKey(memberId: string): string {
  return buildHostedPulseTrialCustomerIdempotencyKey(memberId);
}

export function buildHostedAutoPulseTrialSubscriptionIdempotencyKey(input: {
  memberId: string;
  policyVersion: string;
  priceId: string;
  recoveryScope: string;
  stripeCustomerId: string;
}): string {
  return [
    "hosted-auto-pulse-trial-subscription",
    input.memberId,
    input.stripeCustomerId,
    input.priceId,
    input.policyVersion,
    input.recoveryScope,
  ].join(":");
}

function buildHostedAutoPulseTrialSubscriptionIdempotencyKeyScope(
  terminalSubscriptions: readonly Stripe.Subscription[],
): string {
  const newestTerminalSubscription = [...terminalSubscriptions]
    .sort(compareHostedStripeSubscriptionsNewestFirst)
    .at(0);

  if (!newestTerminalSubscription) {
    return "initial";
  }

  return [
    "after-terminal",
    newestTerminalSubscription.id,
    newestTerminalSubscription.status,
    String(newestTerminalSubscription.created ?? 0),
  ].join(":");
}

function buildHostedAutoPulseTrialSourceEventId(subscriptionId: string): string {
  return `auto-pulse-trial:${subscriptionId}`;
}

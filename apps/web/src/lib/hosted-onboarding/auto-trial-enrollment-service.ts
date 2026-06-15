import { HostedBillingStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { HOSTED_APP_HOME_PATH } from "./app-routes";
import { buildHostedBillingOfferMetadata } from "./billing-offer-metadata";
import {
  HOSTED_PULSE_TRIAL_DAYS,
  HOSTED_PULSE_TRIAL_OFFER,
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
  HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
  isHostedAutoPulseTrialEnabled,
} from "./billing-plans";
import { isHostedMemberSuspended } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import {
  readHostedMemberBillingSnapshot,
  type HostedMemberBillingSnapshot,
} from "./hosted-member-store";
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
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "./shared";
import {
  sendHostedSignupWelcomeEmailForMemberBestEffort,
} from "./signup-welcome-email";
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

type HostedAutoPulseTrialPostCommitEffects = {
  activatedMemberId: string | null;
  hostedExecutionEventId: string | null;
  welcomeEmailMemberId: string | null;
};

type HostedAutoPulseTrialTransactionOutcome = {
  createdSubscriptionCommitted: boolean;
  postCommitEffects: HostedAutoPulseTrialPostCommitEffects;
  result: HostedAutoPulseTrialEnrollmentResult;
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
  const enrollmentAttemptId = randomUUID();
  const metadata = buildHostedAutoPulseTrialMetadata(invite.member.id);
  const stripeCustomerId = initialMember.billingRef?.stripeCustomerId ??
    await createHostedAutoPulseTrialStripeCustomer({
      memberId: invite.member.id,
      stripe,
    });
  const subscription = await resolveHostedAutoPulseTrialStripeSubscription({
    enrollmentAttemptId,
    memberId: invite.member.id,
    metadata,
    priceId,
    stripe,
    stripeCustomerId,
  });

  let outcome: HostedAutoPulseTrialTransactionOutcome;
  try {
    const trialSnapshot = readHostedAutoPulseTrialSubscriptionSnapshot(subscription);

    outcome = await prisma.$transaction(async (tx) => {
      const currentMember = await readHostedAutoPulseTrialEnrollmentMember({
        memberId: invite.member.id,
        prisma: tx,
      });
      const currentStatus = resolveHostedAutoPulseTrialExistingStatus(currentMember);
      if (currentStatus) {
        return {
          createdSubscriptionCommitted:
            currentMember.billingRef?.stripeSubscriptionId === subscription.id,
          postCommitEffects: EMPTY_AUTO_TRIAL_POST_COMMIT_EFFECTS,
          result: buildHostedAutoPulseTrialEnrollmentResult(currentStatus),
        };
      }

      assertHostedAutoPulseTrialEligible(currentMember);

      const dispatchContext = buildHostedAutoPulseTrialDispatchContext({
        billingRefLastStripeEventCreatedAt:
          currentMember.billingRef?.lastStripeEventCreatedAt ?? null,
        now,
        subscription,
      });
      const updatedMember = await writeHostedMemberStripeBillingTx({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: HOSTED_PULSE_TRIAL_OFFER,
        currentPeriodEnd: trialSnapshot.currentPeriodEnd,
        currentPeriodStart: trialSnapshot.currentPeriodStart,
        currentTrialEndsAt: trialSnapshot.trialEndsAt,
        currentTrialStartedAt: trialSnapshot.trialStartedAt,
        dispatchContext,
        freshnessPolicy: "auto-pulse-trial-entitlement",
        member: currentMember,
        pulseTrialPolicyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
        pulseTrialRedeemedAt: trialSnapshot.trialStartedAt,
        stripeCustomerId,
        stripeSubscriptionId: subscription.id,
        tx,
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
        prisma: tx,
        skipIfBillingAlreadyActive: false,
        skipIfPreviouslyActivated: true,
      });

      return {
        createdSubscriptionCommitted: true,
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
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  } catch (error) {
    await cancelHostedAutoPulseTrialStripeSubscription({
      stripe,
      subscriptionId: subscription.id,
    });
    throw error;
  }

  if (!outcome.createdSubscriptionCommitted) {
    await cancelHostedAutoPulseTrialStripeSubscription({
      stripe,
      subscriptionId: subscription.id,
    });
  }

  await runHostedAutoPulseTrialPostCommitEffects({
    ...outcome.postCommitEffects,
    prisma,
  });

  return outcome.result;
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
  if (isHostedMemberSuspended(member.core.suspendedAt)) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  if (member.billingRef?.pulseTrialRedeemedAt) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_ALREADY_REDEEMED",
      message: "This hosted account has already used its Pulse Trial.",
      httpStatus: 409,
    });
  }

  if (!requiresHostedBillingCheckout(member.core.billingStatus)) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_BLOCKED",
      message: "This hosted account cannot start a trial right now. Contact support to restore access.",
      httpStatus: 403,
    });
  }
}

function buildHostedAutoPulseTrialMetadata(memberId: string): Record<string, string> {
  return buildHostedBillingOfferMetadata({
    billingPlanCode: "launch_monthly",
    checkoutOffer: HOSTED_PULSE_TRIAL_OFFER,
    memberId,
  });
}

async function createHostedAutoPulseTrialStripeCustomer(input: {
  memberId: string;
  stripe: Stripe;
}): Promise<string> {
  const customer = await input.stripe.customers.create({
    metadata: {
      memberId: input.memberId,
      source: "hosted.auto_pulse_trial",
    },
  }, {
    idempotencyKey: buildHostedAutoPulseTrialCustomerIdempotencyKey(input.memberId),
  });

  return customer.id;
}

async function createHostedAutoPulseTrialStripeSubscription(input: {
  enrollmentAttemptId: string;
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
      attemptId: input.enrollmentAttemptId,
      memberId: input.memberId,
      policyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
    }),
  });
}

async function resolveHostedAutoPulseTrialStripeSubscription(input: {
  enrollmentAttemptId: string;
  metadata: Record<string, string>;
  memberId: string;
  priceId: string;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<Stripe.Subscription> {
  const existingSubscription =
    await findReusableHostedAutoPulseTrialStripeSubscription(input);

  if (existingSubscription) {
    return existingSubscription;
  }

  return createHostedAutoPulseTrialStripeSubscription(input);
}

async function findReusableHostedAutoPulseTrialStripeSubscription(input: {
  memberId: string;
  priceId: string;
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<Stripe.Subscription | null> {
  const subscriptions = await listHostedAutoPulseTrialStripeSubscriptionsForRecovery(input);

  const matchingSubscriptions = subscriptions.data
    .filter((subscription) => isHostedAutoPulseTrialStripeSubscriptionForMember({
      memberId: input.memberId,
      subscription,
    }))
    .sort(compareHostedStripeSubscriptionsNewestFirst);
  const liveMatchingSubscriptions = matchingSubscriptions.filter(
    (subscription) => !isTerminalHostedAutoPulseTrialStripeSubscription(subscription),
  );
  const reusableSubscription = liveMatchingSubscriptions.find(
    (subscription) => isReusableHostedAutoPulseTrialStripeSubscription({
      priceId: input.priceId,
      subscription,
    }),
  );

  if (reusableSubscription) {
    return reusableSubscription;
  }

  if (liveMatchingSubscriptions.length > 0) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
      message: "Murph found an unfinished trial setup. Contact support to restore access.",
    });
  }

  return null;
}

async function listHostedAutoPulseTrialStripeSubscriptionsForRecovery(input: {
  stripe: Stripe;
  stripeCustomerId: string;
}): Promise<Stripe.ApiList<Stripe.Subscription>> {
  const data: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;

  try {
    for (;;) {
      const page = await input.stripe.subscriptions.list({
        customer: input.stripeCustomerId,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
        status: "all",
      });
      data.push(...page.data);

      if (!page.has_more) {
        return {
          data,
          has_more: false,
          object: "list",
          url: page.url,
        };
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
  } catch {
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
  subscription: Stripe.Subscription;
}): boolean {
  return input.subscription.metadata?.memberId === input.memberId &&
    input.subscription.metadata.checkoutOffer === HOSTED_PULSE_TRIAL_OFFER;
}

function isReusableHostedAutoPulseTrialStripeSubscription(input: {
  priceId: string;
  subscription: Stripe.Subscription;
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
  subscription: Stripe.Subscription,
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

async function cancelHostedAutoPulseTrialStripeSubscription(input: {
  stripe: Stripe;
  subscriptionId: string;
}): Promise<void> {
  try {
    await input.stripe.subscriptions.cancel(input.subscriptionId);
  } catch {
    throw hostedOnboardingError({
      code: "HOSTED_AUTO_PULSE_TRIAL_CLEANUP_FAILED",
      httpStatus: 502,
      message: "Murph could not finish trial activation. Contact support to restore access.",
    });
  }
}

function readHostedAutoPulseTrialSubscriptionSnapshot(
  subscription: Stripe.Subscription,
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
  subscription: Stripe.Subscription,
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
  subscription: Stripe.Subscription,
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
  subscription: Stripe.Subscription;
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
    redirectPath: HOSTED_APP_HOME_PATH,
    status,
  };
}

export function buildHostedAutoPulseTrialCustomerIdempotencyKey(memberId: string): string {
  return `hosted-auto-pulse-trial-customer:${memberId}`;
}

export function buildHostedAutoPulseTrialSubscriptionIdempotencyKey(input: {
  attemptId: string;
  memberId: string;
  policyVersion: string;
}): string {
  return `hosted-auto-pulse-trial-subscription:${input.memberId}:${input.policyVersion}:${input.attemptId}`;
}

function buildHostedAutoPulseTrialSourceEventId(subscriptionId: string): string {
  return `auto-pulse-trial:${subscriptionId}`;
}

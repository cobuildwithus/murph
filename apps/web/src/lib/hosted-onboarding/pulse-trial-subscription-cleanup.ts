import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";

import {
  HOSTED_PULSE_TRIAL_OFFER,
  requireHostedPulseTrialPolicy,
} from "./billing-plans";
import {
  createHostedStripeSubscriptionLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import {
  clearHostedMemberLegacyTrialBillingUnderLockTx,
  withHostedMemberStripeMutationLock,
  withHostedMemberStripeMutationLockForOps,
} from "./hosted-member-billing-store";
import {
  readHostedMemberBillingSnapshot,
} from "./hosted-member-store";
import {
  canGrantHostedStarterUsageForLegacyTrial,
} from "./starter-usage";
import {
  ensureHostedStarterUsageGrantTx,
  readHostedLegacyTrialConsumedUsageUsdMicrosTx,
} from "./starter-usage-grant";
import { logHostedStripeFailure } from "./stripe-error-log";

const HOSTED_LEGACY_TRIAL_RETIRABLE_STATUSES = new Set<Stripe.Subscription.Status>([
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
  "trialing",
]);

export function isHostedLegacyPulseTrialRetirableStatus(
  status: Stripe.Subscription.Status,
): boolean {
  return HOSTED_LEGACY_TRIAL_RETIRABLE_STATUSES.has(status);
}

/**
 * Bounded rollout owner for trial rows created by an older deployment after
 * the one-time Starter migration. It revalidates the exact provider object,
 * preserves already-consumed trial usage in the canonical Starter ledger, and
 * clears the obsolete billing identity under the existing member lock.
 */
export function retireHostedLegacyPulseTrialToStarter(input: {
  memberId: string;
  prisma: PrismaClient;
  priceId: string;
  stripe: Pick<Stripe, "subscriptions">;
}): Promise<boolean> {
  return withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: async (tx) => {
      const member = await readHostedMemberBillingSnapshot({
        memberId: input.memberId,
        prisma: tx,
      });
      const billingRef = member?.billingRef ?? null;
      const subscriptionId = billingRef?.stripeSubscriptionId ?? null;
      if (!member || !billingRef || !subscriptionId) {
        return false;
      }
      if (billingRef.currentBillingPhase === "paid") {
        throw buildHostedLegacyTrialRetirementBlockedError();
      }

      const subscription = await retrieveHostedPulseTrialCleanupTarget({
        expectedCustomerId: billingRef.stripeCustomerId ?? undefined,
        memberId: input.memberId,
        priceId: input.priceId,
        stripe: input.stripe,
        subscriptionId,
      });
      if (
        subscription
        && !isHostedLegacyPulseTrialRetirableStatus(subscription.status)
      ) {
        throw buildHostedLegacyTrialRetirementBlockedError();
      }

      const canGrantStarter = canGrantHostedStarterUsageForLegacyTrial(
        member.core,
      );
      if (canGrantStarter) {
        const initialConsumedUsdMicros =
          await readHostedLegacyTrialConsumedUsageUsdMicrosTx({
            memberId: input.memberId,
            trialStartedAt:
              billingRef.currentTrialStartedAt
              ?? billingRef.pulseTrialRedeemedAt
              ?? null,
            tx,
          });
        await ensureHostedStarterUsageGrantTx({
          effectiveAt:
            billingRef.pulseTrialRedeemedAt
            ?? billingRef.currentTrialStartedAt
            ?? member.core.createdAt,
          initialConsumedUsdMicros,
          memberId: input.memberId,
          source: "legacy_trial_migration",
          tx,
        });
      }
      const billingStatusAfterClear = canGrantStarter
        ? HostedBillingStatus.active
        : member.core.billingStatus;

      if (
        subscription
        && subscription.status !== "canceled"
        && subscription.status !== "incomplete_expired"
      ) {
        await cancelHostedPulseTrialLoserSubscription({
          stripe: input.stripe,
          subscriptionId,
        });
      }

      await clearHostedMemberLegacyTrialBillingUnderLockTx({
        billingStatusAfterClear,
        memberId: input.memberId,
        tx,
      });
      return true;
    },
  });
}

export function buildHostedLegacyTrialRetirementBlockedError() {
  return hostedOnboardingError({
    code: "HOSTED_BILLING_SUBSCRIPTION_ALREADY_EXISTS",
    httpStatus: 409,
    message:
      "This hosted account already has a subscription. Manage it from Settings instead of starting a new one.",
  });
}

export type HostedPulseTrialCandidateDisposition =
  | "current"
  | "eligible"
  | "loser";

export function classifyHostedPulseTrialCandidateDisposition(input: {
  billingStatus: HostedBillingStatus;
  currentBillingPhase: string | null;
  currentStripeSubscriptionId: string | null;
  pulseTrialRedeemedAt: Date | null;
  subscriptionId: string;
}): HostedPulseTrialCandidateDisposition {
  return classifyHostedPulseTrialCandidateDispositionForIdentity({
    billingStatus: input.billingStatus,
    currentBillingPhase: input.currentBillingPhase,
    currentSubscriptionIdentity:
      input.currentStripeSubscriptionId === input.subscriptionId
        ? "candidate"
        : input.currentStripeSubscriptionId
          ? "different"
          : "none",
    pulseTrialRedeemedAt: input.pulseTrialRedeemedAt,
  });
}

export function classifyHostedPulseTrialCandidateDispositionByLookupKey(input: {
  billingStatus: HostedBillingStatus;
  currentBillingPhase: string | null;
  currentStripeSubscriptionLookupKey: string | null;
  pulseTrialRedeemedAt: Date | null;
  subscriptionId: string;
}): HostedPulseTrialCandidateDisposition {
  const candidateLookupKeys =
    createHostedStripeSubscriptionLookupKeyReadCandidates(
      input.subscriptionId,
    );
  return classifyHostedPulseTrialCandidateDispositionForIdentity({
    billingStatus: input.billingStatus,
    currentBillingPhase: input.currentBillingPhase,
    currentSubscriptionIdentity:
      input.currentStripeSubscriptionLookupKey === null
        ? "none"
        : candidateLookupKeys.includes(
            input.currentStripeSubscriptionLookupKey,
          )
          ? "candidate"
          : "different",
    pulseTrialRedeemedAt: input.pulseTrialRedeemedAt,
  });
}

function classifyHostedPulseTrialCandidateDispositionForIdentity(input: {
  billingStatus: HostedBillingStatus;
  currentBillingPhase: string | null;
  currentSubscriptionIdentity: "candidate" | "different" | "none";
  pulseTrialRedeemedAt: Date | null;
}): HostedPulseTrialCandidateDisposition {
  if (input.currentSubscriptionIdentity === "candidate") {
    return "current";
  }
  // A second legacy trial may never replace an already-bound provider
  // identity. Retire the delayed candidate and leave the current identity for
  // its own exact reconciliation or the bounded operator drain.
  if (input.currentSubscriptionIdentity === "different") {
    return "loser";
  }
  if (
    input.pulseTrialRedeemedAt
    || input.currentBillingPhase === "paid"
    || input.billingStatus === HostedBillingStatus.active
  ) {
    return "loser";
  }
  return "eligible";
}

export function isHostedPulseTrialSubscriptionForKnownPolicy(input: {
  memberId: string;
  priceId: string;
  subscription: {
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
      has_more?: boolean;
    };
    metadata?: Record<string, string> | null;
  };
}): boolean {
  const policy = requireHostedPulseTrialPolicy(
    input.subscription.metadata?.trialPolicyVersion,
  );
  if (
    !policy ||
    input.subscription.metadata?.memberId !== input.memberId ||
    input.subscription.metadata.checkoutOffer !== HOSTED_PULSE_TRIAL_OFFER ||
    input.subscription.metadata.billingPlanCode !== "launch_monthly" ||
    input.subscription.metadata.trialDurationDays !== policy.durationDays.toString() ||
    input.subscription.metadata.trialUsageLimitUsdMicros !==
      policy.usageLimitUsdMicros.toString()
  ) {
    return false;
  }

  if (input.subscription.items?.has_more !== false) {
    return false;
  }
  const items = input.subscription.items.data;
  if (items.length !== 1) {
    return false;
  }
  const baseItems = items.filter((item) => item.price?.id === input.priceId);
  const baseItem = baseItems[0];
  if (
    baseItems.length !== 1 ||
    !baseItem ||
    baseItem.price?.recurring?.interval !== "month" ||
    (baseItem.price.recurring.interval_count ?? 1) !== 1 ||
    baseItem.price.recurring.usage_type === "metered" ||
    baseItem.quantity !== 1
  ) {
    return false;
  }

  return baseItem.id === items[0]?.id;
}

export async function cancelHostedPulseTrialLoserSubscriptionsForMember(input: {
  lockBudget?: {
    acquisitionTimeoutMs: number;
    transactionTimeoutMs: number;
  };
  memberId: string;
  prisma: PrismaClient;
  priceId: string;
  requestOptions?: Stripe.RequestOptions;
  stripe: Pick<Stripe, "subscriptions">;
  subscriptionIds: readonly string[];
}): Promise<void> {
  const subscriptionIds = [...new Set(input.subscriptionIds)];
  if (subscriptionIds.length === 0) {
    return;
  }

  const cleanupSubscriptionIds: string[] = [];
  for (const subscriptionId of subscriptionIds) {
    const subscription = await retrieveHostedPulseTrialCleanupTarget({
      memberId: input.memberId,
      priceId: input.priceId,
      ...(input.requestOptions ? { requestOptions: input.requestOptions } : {}),
      stripe: input.stripe,
      subscriptionId,
    });
    if (subscription) {
      cleanupSubscriptionIds.push(subscriptionId);
    }
  }
  if (cleanupSubscriptionIds.length === 0) {
    return;
  }

  const revalidate = async (tx: Prisma.TransactionClient): Promise<void> => {
    const currentMember = await readHostedMemberBillingSnapshot({
      memberId: input.memberId,
      prisma: tx,
    });
    if (
      !currentMember ||
      cleanupSubscriptionIds.some((subscriptionId) =>
        classifyHostedPulseTrialCandidateDisposition({
          billingStatus: currentMember.core.billingStatus,
          currentBillingPhase: currentMember.billingRef?.currentBillingPhase ?? null,
          currentStripeSubscriptionId:
            currentMember.billingRef?.stripeSubscriptionId ?? null,
          pulseTrialRedeemedAt:
            currentMember.billingRef?.pulseTrialRedeemedAt ?? null,
          subscriptionId,
        }) !== "loser"
      )
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_PULSE_TRIAL_CLEANUP_OWNER_CHANGED",
        httpStatus: 409,
        message: "Murph could not confirm the unused Stripe trial. Try again.",
        retryable: true,
      });
    }
  };

  if (input.lockBudget) {
    await withHostedMemberStripeMutationLockForOps({
      acquisitionTimeoutMs: input.lockBudget.acquisitionTimeoutMs,
      memberId: input.memberId,
      prisma: input.prisma,
      run: revalidate,
      transactionTimeoutMs: input.lockBudget.transactionTimeoutMs,
    });
  } else {
    await withHostedMemberStripeMutationLock({
      memberId: input.memberId,
      prisma: input.prisma,
      run: revalidate,
    });
  }

  for (const subscriptionId of cleanupSubscriptionIds) {
    await cancelHostedPulseTrialLoserSubscription({
      ...(input.requestOptions ? { requestOptions: input.requestOptions } : {}),
      stripe: input.stripe,
      subscriptionId,
    });
  }
}

export async function retrieveHostedPulseTrialCleanupTarget(input: {
  expandCustomer?: boolean;
  expectedCustomerId?: string;
  memberId: string;
  priceId: string;
  requestOptions?: Stripe.RequestOptions;
  stripe: {
    subscriptions: {
      retrieve(
        subscriptionId: string,
        params?: Stripe.SubscriptionRetrieveParams,
        options?: Stripe.RequestOptions,
      ): Promise<Stripe.Subscription>;
    };
  };
  subscriptionId: string;
}): Promise<Stripe.Subscription | null> {
  try {
    const retrieveParams: Stripe.SubscriptionRetrieveParams | null = input.expandCustomer
      ? { expand: ["customer"] }
      : null;
    const subscription = input.requestOptions
      ? await input.stripe.subscriptions.retrieve(
          input.subscriptionId,
          retrieveParams ?? {},
          input.requestOptions,
        )
      : retrieveParams
        ? await input.stripe.subscriptions.retrieve(
            input.subscriptionId,
            retrieveParams,
          )
        : await input.stripe.subscriptions.retrieve(input.subscriptionId);
    const customerId = typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;
    if (
      subscription.id !== input.subscriptionId ||
      (
        input.expectedCustomerId !== undefined &&
        customerId !== input.expectedCustomerId
      ) ||
      !isHostedPulseTrialSubscriptionForKnownPolicy({
        memberId: input.memberId,
        priceId: input.priceId,
        subscription,
      })
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_PULSE_TRIAL_CLEANUP_TARGET_CHANGED",
        httpStatus: 409,
        message: "Murph could not confirm the unused Stripe trial. Try again.",
        retryable: true,
      });
    }
    return subscription;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      Reflect.get(error, "code") === "HOSTED_PULSE_TRIAL_CLEANUP_TARGET_CHANGED"
    ) {
      throw error;
    }
    if (
      error &&
      typeof error === "object" &&
      Reflect.get(error, "code") === "resource_missing"
    ) {
      return null;
    }
    logHostedStripeFailure({
      error,
      operationName: "subscription.retrieve.trial-cleanup-target",
    });
    throw hostedOnboardingError({
      cause: error,
      code: "HOSTED_PULSE_TRIAL_CLEANUP_FAILED",
      httpStatus: 502,
      message: "Murph could not confirm an unused Stripe trial. Try again.",
      retryable: true,
    });
  }
}

export async function cancelHostedPulseTrialLoserSubscription(input: {
  requestOptions?: Stripe.RequestOptions;
  stripe: Pick<Stripe, "subscriptions">;
  subscriptionId: string;
}): Promise<void> {
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
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      Reflect.get(error, "code") === "resource_missing"
    ) {
      return;
    }
    logHostedStripeFailure({
      error,
      operationName: "subscription.cancel.trial-loser",
    });
    throw hostedOnboardingError({
      cause: error,
      code: "HOSTED_PULSE_TRIAL_CLEANUP_FAILED",
      httpStatus: 502,
      message: "Murph could not cancel an unused Stripe trial. Try again.",
      retryable: true,
    });
  }
}

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
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY,
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
} from "./legacy-usage-price";
import { hostedOnboardingError } from "./errors";
import {
  withHostedMemberStripeMutationLock,
  withHostedMemberStripeMutationLockForOps,
} from "./hosted-member-billing-store";
import {
  readHostedMemberBillingSnapshot,
} from "./hosted-member-store";

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
  if (input.currentStripeSubscriptionId === input.subscriptionId) {
    return "current";
  }
  if (
    input.pulseTrialRedeemedAt ||
    input.currentBillingPhase === "paid" ||
    (
      input.billingStatus === HostedBillingStatus.active &&
      (
        input.currentBillingPhase !== "trial" ||
        Boolean(input.currentStripeSubscriptionId)
      )
    )
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

  return items.every((item) =>
    item.id === baseItem.id || isHostedPulseTrialLegacyMeteredItem(item)
  );
}

function isHostedPulseTrialLegacyMeteredItem(item: {
  price?: {
    metadata?: Record<string, string> | null;
    recurring?: {
      interval?: string;
      interval_count?: number;
      usage_type?: string;
    } | null;
  } | null;
  quantity?: number | null;
}): boolean {
  const recurring = item.price?.recurring;
  return recurring?.interval === "month" &&
    (recurring.interval_count ?? 1) === 1 &&
    recurring.usage_type === "metered" &&
    item.price?.metadata?.[HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY] ===
      HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE &&
    !(typeof item.quantity === "number" && Number.isFinite(item.quantity));
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

  const run = async (tx: Prisma.TransactionClient): Promise<void> => {
    const currentMember = await readHostedMemberBillingSnapshot({
      memberId: input.memberId,
      prisma: tx,
    });
    if (
      !currentMember ||
      subscriptionIds.some((subscriptionId) =>
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

    for (const subscriptionId of subscriptionIds) {
      const subscription = await retrieveHostedPulseTrialCleanupTarget({
        memberId: input.memberId,
        priceId: input.priceId,
        ...(input.requestOptions ? { requestOptions: input.requestOptions } : {}),
        stripe: input.stripe,
        subscriptionId,
      });
      if (!subscription) {
        continue;
      }
      await cancelHostedPulseTrialLoserSubscription({
        ...(input.requestOptions ? { requestOptions: input.requestOptions } : {}),
        stripe: input.stripe,
        subscriptionId,
      });
    }
  };

  if (input.lockBudget) {
    await withHostedMemberStripeMutationLockForOps({
      acquisitionTimeoutMs: input.lockBudget.acquisitionTimeoutMs,
      memberId: input.memberId,
      prisma: input.prisma,
      run,
      transactionTimeoutMs: input.lockBudget.transactionTimeoutMs,
    });
    return;
  }

  await withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run,
  });
}

export async function retrieveHostedPulseTrialCleanupTarget(input: {
  expectedCustomerId?: string;
  memberId: string;
  priceId: string;
  requestOptions?: Stripe.RequestOptions;
  stripe: Pick<Stripe, "subscriptions">;
  subscriptionId: string;
}): Promise<Stripe.Subscription | null> {
  try {
    const subscription = input.requestOptions
      ? await input.stripe.subscriptions.retrieve(
          input.subscriptionId,
          {},
          input.requestOptions,
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
    throw hostedOnboardingError({
      cause: error,
      code: "HOSTED_PULSE_TRIAL_CLEANUP_FAILED",
      httpStatus: 502,
      message: "Murph could not cancel an unused Stripe trial. Try again.",
      retryable: true,
    });
  }
}

import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { hostedOnboardingError } from "./errors";
import {
  withHostedMemberStripeMutationLock,
} from "./hosted-member-billing-store";
import { readHostedMemberBillingSnapshot } from "./hosted-member-store";

export async function cancelHostedPulseTrialLoserSubscriptionsForMember(input: {
  memberId: string;
  prisma: PrismaClient;
  requestOptions?: Stripe.RequestOptions;
  stripe: Pick<Stripe, "subscriptions">;
  subscriptionIds: readonly string[];
}): Promise<void> {
  const subscriptionIds = [...new Set(input.subscriptionIds)];
  if (subscriptionIds.length === 0) {
    return;
  }

  await withHostedMemberStripeMutationLock({
    memberId: input.memberId,
    prisma: input.prisma,
    run: async (tx) => {
      const currentMember = await readHostedMemberBillingSnapshot({
        memberId: input.memberId,
        prisma: tx,
      });
      const currentSubscriptionId = currentMember?.billingRef?.stripeSubscriptionId;
      if (
        !currentSubscriptionId ||
        subscriptionIds.includes(currentSubscriptionId)
      ) {
        throw hostedOnboardingError({
          code: "HOSTED_PULSE_TRIAL_CLEANUP_OWNER_CHANGED",
          httpStatus: 409,
          message: "Murph could not confirm the unused Stripe trial. Try again.",
          retryable: true,
        });
      }

      for (const subscriptionId of subscriptionIds) {
        await cancelHostedPulseTrialLoserSubscription({
          ...(input.requestOptions ? { requestOptions: input.requestOptions } : {}),
          stripe: input.stripe,
          subscriptionId,
        });
      }
    },
  });
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

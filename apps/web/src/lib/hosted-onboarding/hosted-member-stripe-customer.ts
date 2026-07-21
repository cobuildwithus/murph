import "server-only";

import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import {
  bindHostedMemberStripeCustomerIdIfMissingTx,
  readHostedMemberStripeBillingRef,
} from "./hosted-member-billing-store";
import { createHostedPulseTrialStripeCustomer } from "./pulse-trial-customer";
import { requireHostedStripeApiMode } from "./runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "./shared";

/**
 * Reuses the member-scoped Stripe Customer identity and its existing provider
 * idempotency key, including for a member who does not have a paid plan.
 */
export async function ensureHostedMemberStripeCustomer(input: {
  memberId: string;
  prisma?: PrismaClient;
}): Promise<string> {
  const prisma = input.prisma ?? getPrisma();
  const existing = await readHostedMemberStripeBillingRef({
    memberId: input.memberId,
    prisma,
  });
  if (existing?.stripeCustomerId) {
    return existing.stripeCustomerId;
  }

  const { stripe } = requireHostedStripeApiMode();
  const candidateStripeCustomerId = await createHostedPulseTrialStripeCustomer({
    memberId: input.memberId,
    stripe,
  });

  return prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const member = await tx.hostedMember.findUnique({
      select: {
        suspendedAt: true,
        threadContainer: { select: { memberId: true } },
      },
      where: { id: input.memberId },
    });
    if (!member || member.suspendedAt || member.threadContainer) {
      throw buildHostedUsageCreditPayerNotEligibleError();
    }

    const current = await readHostedMemberStripeBillingRef({
      memberId: input.memberId,
      prisma: tx,
    });
    const billingRef = current?.stripeCustomerId
      ? current
      : await bindHostedMemberStripeCustomerIdIfMissingTx({
          memberId: input.memberId,
          stripeCustomerId: candidateStripeCustomerId,
          tx,
        });
    if (!billingRef?.stripeCustomerId) {
      throw hostedOnboardingError({
        code: "HOSTED_USAGE_CREDIT_CUSTOMER_BIND_FAILED",
        httpStatus: 409,
        message: "Murph could not prepare Stripe checkout. Try again.",
        retryable: true,
      });
    }
    return billingRef.stripeCustomerId;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

function buildHostedUsageCreditPayerNotEligibleError() {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_PAYER_NOT_ELIGIBLE",
    httpStatus: 403,
    message: "This Murph account cannot start a usage-credit checkout.",
  });
}

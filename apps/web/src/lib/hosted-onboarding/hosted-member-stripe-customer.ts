import "server-only";

import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import {
  assertNoHostedMemberStripeEffectTx,
  bindHostedMemberStripeCustomerIdIfMissingTx,
  readHostedMemberStripeBillingRef,
} from "./hosted-member-billing-store";
import { requireHostedStripeApiMode } from "./runtime";
import { withHostedStripeFailureLog } from "./stripe-error-log";
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
    await assertNoHostedMemberStripeEffectTx({
      memberId: input.memberId,
      tx,
    });

    const current = await readHostedMemberStripeBillingRef({
      memberId: input.memberId,
      prisma: tx,
    });
    const candidateStripeCustomerId = current?.stripeCustomerId
      ?? await createHostedMemberStripeCustomer({
        memberId: input.memberId,
        requestOptions: {
          maxNetworkRetries: 0,
          timeout: 5_000,
        },
        stripe,
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


type HostedMemberStripeCustomerRequestOptions = Pick<
  Stripe.RequestOptions,
  "maxNetworkRetries" | "timeout"
>;

/**
 * Creates the reusable member-scoped Stripe Customer. The legacy idempotency
 * key and request metadata are intentionally preserved so a rolling-deploy
 * retry cannot create a second Customer after an earlier provider success.
 * They no longer imply or create a trial.
 */
async function createHostedMemberStripeCustomer(input: {
  memberId: string;
  requestOptions?: HostedMemberStripeCustomerRequestOptions;
  stripe: Stripe;
}): Promise<string> {
  const requestOptions: Stripe.RequestOptions = {
    idempotencyKey: `hosted-auto-pulse-trial-customer:${input.memberId}`,
  };
  if (input.requestOptions?.maxNetworkRetries !== undefined) {
    requestOptions.maxNetworkRetries = input.requestOptions.maxNetworkRetries;
  }
  if (input.requestOptions?.timeout !== undefined) {
    requestOptions.timeout = input.requestOptions.timeout;
  }

  const customer = await withHostedStripeFailureLog(
    "customers.create.member",
    () => input.stripe.customers.create({
      metadata: {
        memberId: input.memberId,
        source: "hosted.auto_pulse_trial",
      },
    }, requestOptions),
  );

  return customer.id;
}

function buildHostedUsageCreditPayerNotEligibleError() {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_PAYER_NOT_ELIGIBLE",
    httpStatus: 403,
    message: "This Murph account cannot start a usage-credit checkout.",
  });
}

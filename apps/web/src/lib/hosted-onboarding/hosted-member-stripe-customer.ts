import "server-only";

import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import {
  clearHostedMemberStripeCustomerReservationAfterDefinitiveFailureTx,
  finalizeHostedMemberStripeCustomerReservationTx,
  readHostedMemberStripeBillingRef,
  reserveHostedMemberStripeCustomerReservationTx,
} from "./hosted-member-billing-store";
import { createHostedPulseTrialStripeCustomer } from "./pulse-trial-customer";
import { requireHostedStripeApiMode } from "./runtime";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "./shared";
import { isHostedStripeDefinitiveRequestRejection } from "./stripe-billing-state";

const HOSTED_MEMBER_STRIPE_CUSTOMER_REQUEST_OPTIONS = {
  maxNetworkRetries: 0,
  timeout: 5_000,
} as const;

const HOSTED_MEMBER_STRIPE_CUSTOMER_TRANSACTION_OPTIONS = {
  ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  timeout: 15_000,
} as const;

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
  const reservationStartedAt = new Date();
  const reservation = await prisma.$transaction(async (tx) => {
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

    return reserveHostedMemberStripeCustomerReservationTx({
      memberId: input.memberId,
      now: reservationStartedAt,
      tx,
    });
  }, HOSTED_MEMBER_STRIPE_CUSTOMER_TRANSACTION_OPTIONS);

  if (reservation.kind === "bound") {
    return reservation.stripeCustomerId;
  }

  let candidateStripeCustomerId: string;
  try {
    candidateStripeCustomerId = await createHostedPulseTrialStripeCustomer({
      memberId: input.memberId,
      requestOptions: HOSTED_MEMBER_STRIPE_CUSTOMER_REQUEST_OPTIONS,
      reservationId: reservation.reservationId,
      stripe,
    });
  } catch (error) {
    if (isHostedStripeDefinitiveRequestRejection(error)) {
      await prisma.$transaction(async (tx) => {
        await lockHostedMemberRow(tx, input.memberId);
        await clearHostedMemberStripeCustomerReservationAfterDefinitiveFailureTx({
          memberId: input.memberId,
          reservationId: reservation.reservationId,
          tx,
        });
      }, HOSTED_MEMBER_STRIPE_CUSTOMER_TRANSACTION_OPTIONS);
    }
    throw error;
  }

  const finalization = await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const member = await tx.hostedMember.findUnique({
      select: {
        suspendedAt: true,
        threadContainer: { select: { memberId: true } },
      },
      where: { id: input.memberId },
    });
    return finalizeHostedMemberStripeCustomerReservationTx({
      bindAllowed: Boolean(
        member && !member.suspendedAt && !member.threadContainer
      ),
      candidateStripeCustomerId,
      memberId: input.memberId,
      now: new Date(),
      reservationId: reservation.reservationId,
      tx,
    });
  }, HOSTED_MEMBER_STRIPE_CUSTOMER_TRANSACTION_OPTIONS);
  if (finalization.kind === "bound") {
    return finalization.stripeCustomerId;
  }
  throw buildHostedUsageCreditPayerNotEligibleError();
}

function buildHostedUsageCreditPayerNotEligibleError() {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_PAYER_NOT_ELIGIBLE",
    httpStatus: 403,
    message: "This Murph account cannot start a usage-credit checkout.",
  });
}

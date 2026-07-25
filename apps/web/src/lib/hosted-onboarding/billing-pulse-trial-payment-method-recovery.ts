import "server-only";

import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { coerceStripeObjectId } from "./billing";
import {
  clearHostedPulseTrialPaymentIntent,
  continueHostedPulseTrialPaidPlan,
  readHostedPulseTrialPaymentIntent,
  startHostedPulseTrialPaidPlan,
} from "./billing-start-paid-pulse-service";
import { hostedOnboardingError } from "./errors";
import { lookupHostedMemberStripeBillingRefByStripeCustomerId } from "./hosted-member-billing-store";

/**
 * Finishes a Pulse plan change when the member added their card but never made
 * it back to the site signed in.
 *
 * The payment link Murph sends over text routinely opens in a browser with no
 * Murph session, so the browser round trip that normally completes the switch
 * cannot be relied on. A trialing subscription heals itself because Stripe
 * bills at trial end once a card exists, but a paused one never does: it stays
 * paused, and the member stays locked out after paying.
 */
export async function applyStripePulseTrialPaymentMethodAttached(input: {
  now?: Date;
  occurredAt: Date;
  paymentMethod: Stripe.PaymentMethod;
  prisma: PrismaClient;
}): Promise<{ memberId: string } | null> {
  const now = input.now ?? new Date();
  const stripeCustomerId = coerceStripeObjectId(input.paymentMethod.customer);

  if (!stripeCustomerId) {
    return null;
  }

  const lookup = await lookupHostedMemberStripeBillingRefByStripeCustomerId({
    prisma: input.prisma,
    stripeCustomerId,
  });

  if (!lookup) {
    return null;
  }

  const observedExpiresAt = lookup.billingRef.pulseTrialPaymentIntentExpiresAt ?? null;
  // Judge authority against when the card was actually attached, not when this
  // receipt happens to run. The retry ladder reaches past the intent's own
  // lifetime, so using the processing clock would silently revoke work the
  // member had already authorised and complete the receipt anyway.
  const action = readHostedPulseTrialPaymentIntent({
    action: lookup.billingRef.pulseTrialPaymentIntentAction ?? null,
    expiresAt: observedExpiresAt,
    now: input.occurredAt,
  });

  if (action === null || observedExpiresAt === null) {
    return null;
  }

  const memberId = lookup.core.id;

  // Let a throw propagate with the intent still recorded. The webhook receipt
  // retries, and the retry needs the intent to still exist or the paused member
  // this path exists for stays locked out for good. Re-running a transition
  // that already landed cannot bill twice: the plan services reuse a
  // deterministic Stripe idempotency key and return the existing invoice
  // result instead of charging again.
  const result = action === "start_pulse_now"
    ? await startHostedPulseTrialPaidPlan({
      memberId,
      now,
      prisma: input.prisma,
    })
    : await continueHostedPulseTrialPaidPlan({
      memberId,
      now,
      prisma: input.prisma,
    });

  // Stripe has not exposed a usable card yet, so nothing moved. Keep the
  // receipt's obligation rather than returning normally and letting the
  // reconciler mark an unfinished recovery complete.
  if (result.status === "payment_required") {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_PAYMENT_METHOD_RECOVERY_PENDING",
      httpStatus: 409,
      message: "The saved card is not usable for billing yet.",
      retryable: true,
    });
  }

  await clearHostedPulseTrialPaymentIntent({
    memberId,
    observedAction: action,
    observedExpiresAt,
    prisma: input.prisma,
  });

  return { memberId };
}

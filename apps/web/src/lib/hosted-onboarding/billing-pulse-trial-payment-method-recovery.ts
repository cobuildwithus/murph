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

  const action = readHostedPulseTrialPaymentIntent({
    action: lookup.billingRef.pulseTrialPaymentIntentAction ?? null,
    expiresAt: lookup.billingRef.pulseTrialPaymentIntentExpiresAt ?? null,
    now,
  });

  if (action === null) {
    return null;
  }

  const memberId = lookup.core.id;

  // Clear before acting. A cleared intent that fails to apply leaves the member
  // exactly where today's code already leaves them, and they still have the
  // signed link and the settings button; an uncleared one that half-applied
  // could bill them twice on the webhook's next delivery.
  await clearHostedPulseTrialPaymentIntent({
    memberId,
    prisma: input.prisma,
  });

  if (action === "start_pulse_now") {
    await startHostedPulseTrialPaidPlan({
      memberId,
      now,
      prisma: input.prisma,
    });
  } else {
    await continueHostedPulseTrialPaidPlan({
      memberId,
      now,
      prisma: input.prisma,
    });
  }

  return { memberId };
}

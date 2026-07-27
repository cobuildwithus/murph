import type Stripe from "stripe";

import { logHostedStripeFailure } from "./stripe-error-log";

export async function expireHostedStripeCheckoutSessionBestEffort(input: {
  operationName: string;
  sessionId: string;
  stripe: Stripe;
}): Promise<void> {
  try {
    await input.stripe.checkout.sessions.expire(input.sessionId);
  } catch (error) {
    logHostedStripeFailure({
      error,
      operationName: input.operationName,
    });
  }
}

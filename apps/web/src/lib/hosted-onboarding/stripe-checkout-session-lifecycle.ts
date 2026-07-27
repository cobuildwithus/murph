import type Stripe from "stripe";

import { logHostedStripeFailure } from "./stripe-error-log";

const HOSTED_STRIPE_CHECKOUT_FOREGROUND_TIMEOUT_MS = 5_000;

export async function expireHostedStripeCheckoutSessionBestEffort(input: {
  operationName: string;
  sessionId: string;
  stripe: Stripe;
}): Promise<void> {
  try {
    await input.stripe.checkout.sessions.expire(
      input.sessionId,
      {},
      {
        maxNetworkRetries: 0,
        timeout: HOSTED_STRIPE_CHECKOUT_FOREGROUND_TIMEOUT_MS,
      },
    );
  } catch (error) {
    logHostedStripeFailure({
      error,
      operationName: input.operationName,
    });
  }
}

export function isHostedStripeResourceMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const type = Reflect.get(error, "type");
  return Reflect.get(error, "code") === "resource_missing"
    && typeof type === "string"
    && type.startsWith("Stripe");
}

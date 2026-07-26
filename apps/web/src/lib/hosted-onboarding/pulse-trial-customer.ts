import type Stripe from "stripe";

import { withHostedStripeFailureLog } from "./stripe-error-log";

export function buildHostedPulseTrialCustomerIdempotencyKey(memberId: string): string {
  return `hosted-auto-pulse-trial-customer:${memberId}`;
}

export async function createHostedPulseTrialStripeCustomer(input: {
  memberId: string;
  requestOptions?: Stripe.RequestOptions;
  stripe: Stripe;
}): Promise<string> {
  const customer = await withHostedStripeFailureLog(
    "customers.create.pulse-trial",
    () => input.stripe.customers.create({
      metadata: {
        memberId: input.memberId,
        source: "hosted.auto_pulse_trial",
      },
    }, {
      ...input.requestOptions,
      idempotencyKey: buildHostedPulseTrialCustomerIdempotencyKey(input.memberId),
    }),
  );

  return customer.id;
}

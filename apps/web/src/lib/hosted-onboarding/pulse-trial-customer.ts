import type Stripe from "stripe";

export function buildHostedPulseTrialCustomerIdempotencyKey(memberId: string): string {
  return `hosted-auto-pulse-trial-customer:${memberId}`;
}

export async function createHostedPulseTrialStripeCustomer(input: {
  memberId: string;
  stripe: Stripe;
}): Promise<string> {
  const customer = await input.stripe.customers.create({
    metadata: {
      source: "hosted.auto_pulse_trial",
    },
  }, {
    idempotencyKey: buildHostedPulseTrialCustomerIdempotencyKey(input.memberId),
  });

  return customer.id;
}

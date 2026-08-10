import type Stripe from "stripe";

import { withHostedStripeFailureLog } from "./stripe-error-log";

type HostedPulseTrialCustomerRequestOptions = Pick<
  Stripe.RequestOptions,
  "maxNetworkRetries" | "timeout"
>;

export function buildHostedPulseTrialCustomerIdempotencyKey(memberId: string): string {
  return `hosted-auto-pulse-trial-customer:${memberId}`;
}

export async function createHostedPulseTrialStripeCustomer(input: {
  memberId: string;
  requestOptions?: HostedPulseTrialCustomerRequestOptions;
  stripe: Stripe;
}): Promise<string> {
  const requestOptions: Stripe.RequestOptions = {
    idempotencyKey: buildHostedPulseTrialCustomerIdempotencyKey(input.memberId),
  };
  if (input.requestOptions?.maxNetworkRetries !== undefined) {
    requestOptions.maxNetworkRetries = input.requestOptions.maxNetworkRetries;
  }
  if (input.requestOptions?.timeout !== undefined) {
    requestOptions.timeout = input.requestOptions.timeout;
  }
  const customer = await withHostedStripeFailureLog(
    "customers.create.pulse-trial",
    () => input.stripe.customers.create({
      metadata: {
        memberId: input.memberId,
        source: "hosted.auto_pulse_trial",
      },
    }, requestOptions),
  );

  return customer.id;
}

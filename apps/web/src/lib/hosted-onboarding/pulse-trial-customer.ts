import type Stripe from "stripe";

import { withHostedStripeFailureLog } from "./stripe-error-log";

export const HOSTED_PULSE_TRIAL_CUSTOMER_SOURCE = "hosted.auto_pulse_trial";

export function hasHostedPulseTrialStripeCustomerReservationMetadata(input: {
  memberId: string;
  metadata: Readonly<Record<string, string>> | null;
  reservationId: string;
}): boolean {
  return input.metadata?.memberId === input.memberId
    && input.metadata.customerReservationId === input.reservationId
    && input.metadata.source === HOSTED_PULSE_TRIAL_CUSTOMER_SOURCE;
}

export function buildHostedPulseTrialCustomerIdempotencyKey(
  reservationId: string,
): string {
  return `hosted-auto-pulse-trial-customer:${reservationId}`;
}

export async function createHostedPulseTrialStripeCustomer(input: {
  memberId: string;
  reservationId: string;
  requestOptions?: Stripe.RequestOptions;
  stripe: Stripe;
}): Promise<string> {
  const customer = await withHostedStripeFailureLog(
    "customers.create.pulse-trial",
    () => input.stripe.customers.create({
      metadata: {
        customerReservationId: input.reservationId,
        memberId: input.memberId,
        source: HOSTED_PULSE_TRIAL_CUSTOMER_SOURCE,
      },
    }, {
      ...input.requestOptions,
      idempotencyKey: buildHostedPulseTrialCustomerIdempotencyKey(
        input.reservationId,
      ),
    }),
  );

  return customer.id;
}

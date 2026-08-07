import type Stripe from "stripe";

import { coerceStripeObjectId } from "./billing";

export function hasHostedStripeSubscriptionPaymentMethod(
  subscription: Stripe.Subscription,
): boolean {
  return readHostedStripeSubscriptionPaymentMethodId(subscription) !== null;
}

export type HostedStripeSubscriptionPaymentMethodUpdate =
  | { default_payment_method: string }
  | { default_source: string };

/**
 * Resolve the payment method Stripe will use for this subscription's next
 * automatic invoice. A customer-level default counts only when the expanded
 * customer proves that inheritance.
 */
export function readHostedStripeSubscriptionPaymentMethodId(
  subscription: Stripe.Subscription,
): string | null {
  const update = readHostedStripeSubscriptionPaymentMethodUpdate(subscription);
  return update
    ? "default_payment_method" in update
      ? update.default_payment_method
      : update.default_source
    : null;
}

/**
 * Return the supported Subscription Update field for the effective payment
 * instrument, preserving whether Stripe represents it as a PaymentMethod or a
 * legacy Source. This also makes customer-level inheritance explicit when an
 * operation needs the instrument to live on the Subscription itself.
 */
export function readHostedStripeSubscriptionPaymentMethodUpdate(
  subscription: Stripe.Subscription,
): HostedStripeSubscriptionPaymentMethodUpdate | null {
  const subscriptionPaymentMethodId = coerceStripeObjectId(
    subscription.default_payment_method,
  );
  if (subscriptionPaymentMethodId) {
    return { default_payment_method: subscriptionPaymentMethodId };
  }

  const subscriptionSourceId = coerceStripeObjectId(subscription.default_source);
  if (subscriptionSourceId) {
    return { default_source: subscriptionSourceId };
  }

  const customer = readExpandedStripeCustomer(subscription.customer);
  if (!customer) {
    return null;
  }

  const customerPaymentMethodId = coerceStripeObjectId(
    customer.invoice_settings.default_payment_method,
  );
  if (customerPaymentMethodId) {
    return { default_payment_method: customerPaymentMethodId };
  }

  const customerSourceId = coerceStripeObjectId(customer.default_source);
  return customerSourceId ? { default_source: customerSourceId } : null;
}

function readExpandedStripeCustomer(
  customer: Stripe.Subscription["customer"],
): Stripe.Customer | null {
  return customer
    && typeof customer === "object"
    && customer.object === "customer"
    && !customer.deleted
    ? customer
    : null;
}

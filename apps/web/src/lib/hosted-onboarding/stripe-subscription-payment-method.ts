import type Stripe from "stripe";

import { coerceStripeObjectId } from "./billing";

export function hasHostedStripeSubscriptionPaymentMethod(
  subscription: Stripe.Subscription,
): boolean {
  return readHostedStripeSubscriptionPaymentMethodId(subscription) !== null;
}

/**
 * Resolve the payment method Stripe will use for this subscription's next
 * automatic invoice. A customer-level default counts only when the expanded
 * customer proves that inheritance.
 */
export function readHostedStripeSubscriptionPaymentMethodId(
  subscription: Stripe.Subscription,
): string | null {
  const subscriptionPaymentMethodId =
    coerceStripeObjectId(subscription.default_payment_method)
    || coerceStripeObjectId(subscription.default_source);

  if (subscriptionPaymentMethodId) {
    return subscriptionPaymentMethodId;
  }

  const customer = readExpandedStripeCustomer(subscription.customer);
  if (!customer) {
    return null;
  }

  return coerceStripeObjectId(customer.invoice_settings.default_payment_method)
    || coerceStripeObjectId(customer.default_source)
    || null;
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

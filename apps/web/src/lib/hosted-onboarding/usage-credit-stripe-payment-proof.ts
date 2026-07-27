import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";

import { coerceStripeObjectId } from "./billing";
import { hostedLookupKeyMatchesValue } from "./contact-privacy";
import { normalizeNullableString } from "./shared";
import {
  HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
  HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE,
  parseHostedUsageCreditCheckoutRequestPolicyVersion,
} from "./usage-credit-offers";
import type {
  HostedUsageCreditPurchaseForReconciliation,
} from "./usage-credit-stripe-reconciliation-context";

export type HostedUsageCreditChargeContext = {
  charge: Stripe.Charge;
  paymentIntent: Stripe.PaymentIntent;
};

export type HostedUsageCreditPaymentAuthorization = {
  paymentIntentId: string;
  purchaseId: string;
  sessionId: string | null;
};

export type HostedUsageCreditPaidCheckoutAuthorization =
  HostedUsageCreditPaymentAuthorization & {
    sessionId: string;
  };

export type HostedUsageCreditPreparedPaidCheckout = {
  lineItems: Stripe.ApiList<Stripe.LineItem>;
  paymentIntent: Stripe.PaymentIntent;
  session: Stripe.Checkout.Session;
};

export function validateHostedUsageCreditPreparedPaidCheckout(input: {
  eventLiveMode: boolean;
  paidCheckout: HostedUsageCreditPreparedPaidCheckout;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): HostedUsageCreditPaidCheckoutAuthorization {
  const { lineItems, paymentIntent, session } = input.paidCheckout;
  if (input.purchase.stripeCheckoutSessionLookupKey) {
    assertHostedStripeLookupMatches({
      expectedLookupKey: input.purchase.stripeCheckoutSessionLookupKey,
      kind: "stripe-checkout-session",
      value: normalizeNullableString(session.id),
    });
  }
  assertHostedUsageCreditSession({
    allowExpiredSession: false,
    eventLiveMode: input.eventLiveMode,
    lineItems,
    purchase: input.purchase,
    session,
  });
  const paymentIntentId = coerceStripeObjectId(session.payment_intent);
  assertHostedUsageCreditPaymentIdentity({
    paymentIntent,
    paymentIntentId,
    purchase: input.purchase,
    session,
  });
  return buildHostedUsageCreditPaidCheckoutAuthorization({
    paymentIntent,
    purchase: input.purchase,
    session,
  });
}

export function buildHostedUsageCreditPaidCheckoutAuthorization(input: {
  paymentIntent: Stripe.PaymentIntent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  session: Stripe.Checkout.Session;
}): HostedUsageCreditPaidCheckoutAuthorization {
  if (
    input.session.payment_status !== "paid" ||
    input.session.status !== "complete" ||
    input.paymentIntent.status !== "succeeded" ||
    coerceStripeObjectId(input.session.payment_intent) !== input.paymentIntent.id
  ) {
    throw new Error(
      "Usage-credit financial payment lacked a completed paid Checkout Session.",
    );
  }
  return {
    paymentIntentId: input.paymentIntent.id,
    purchaseId: input.purchase.id,
    sessionId: input.session.id,
  };
}

export function assertHostedUsageCreditPaymentIntentMatchesPurchase(input: {
  paymentIntent: Stripe.PaymentIntent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): void {
  const { paymentIntent, purchase } = input;
  if (paymentIntent.livemode !== purchase.stripeLiveMode) {
    throw new Error("Usage-credit PaymentIntent environment did not match.");
  }
  assertHostedUsageCreditMetadataForPurpose({
    metadata: paymentIntent.metadata,
    purchase,
    purpose: HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE,
  });
  assertHostedStripeLookupMatches({
    expectedLookupKey: purchase.stripeCustomerLookupKey,
    kind: "stripe-customer",
    value: coerceStripeObjectId(paymentIntent.customer),
  });
  if (
    !Number.isSafeInteger(paymentIntent.amount) ||
    !Number.isSafeInteger(paymentIntent.amount_received) ||
    paymentIntent.amount !== purchase.cashAmountMinor ||
    paymentIntent.amount_received < 0 ||
    paymentIntent.amount_received > purchase.cashAmountMinor ||
    normalizeNullableString(paymentIntent.currency)?.toLowerCase() !==
      purchase.cashCurrency.toLowerCase() ||
    (
      paymentIntent.status === "succeeded" &&
      paymentIntent.amount_received !== purchase.cashAmountMinor
    )
  ) {
    throw new Error("Usage-credit PaymentIntent amount or currency did not match.");
  }
  assertHostedStripeBillingEventLookupMatches({
    expectedLookupKey: purchase.stripePaymentIntentLookupKey,
    value: paymentIntent.id,
  });
  const chargeId = coerceStripeObjectId(paymentIntent.latest_charge);
  if (purchase.stripeChargeLookupKey) {
    assertHostedStripeBillingEventLookupMatches({
      expectedLookupKey: purchase.stripeChargeLookupKey,
      value: chargeId ?? "",
    });
  }
  if (paymentIntent.status === "succeeded" && !chargeId) {
    throw new Error("Succeeded usage-credit PaymentIntent did not include a Charge.");
  }
}

export function assertHostedUsageCreditBoundPaymentIntentMatchesPurchase(input: {
  paymentIntent: Stripe.PaymentIntent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): void {
  if (!input.purchase.stripePaymentIntentLookupKey) {
    throw new Error(
      "Usage-credit PaymentIntent was not durably bound to its purchase.",
    );
  }
  assertHostedUsageCreditPaymentIntentMatchesPurchase(input);
}

export function buildHostedUsageCreditDirectPaymentAuthorization(input: {
  paymentIntent: Stripe.PaymentIntent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): HostedUsageCreditPaymentAuthorization {
  assertHostedUsageCreditBoundPaymentIntentMatchesPurchase(input);
  if (input.paymentIntent.status !== "succeeded") {
    throw new Error("Usage-credit direct payment was not succeeded.");
  }
  return {
    paymentIntentId: input.paymentIntent.id,
    purchaseId: input.purchase.id,
    sessionId: null,
  };
}

export function readHostedUsageCreditSavedCardPurchaseId(
  metadata: Prisma.JsonValue | Stripe.Metadata | null,
): string | null {
  const value = readStringRecord(metadata);
  if (value?.purpose !== HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE) {
    return null;
  }
  const expectedKeys = ["policyVersion", "purchaseId", "purpose"];
  if (
    Object.keys(value).length !== expectedKeys.length ||
    expectedKeys.some((key) => !(key in value)) ||
    value.policyVersion !== HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION ||
    !normalizeNullableString(value.purchaseId)
  ) {
    throw new Error("Saved-card usage-credit metadata did not match.");
  }
  return value.purchaseId;
}

export function assertHostedUsageCreditChargeContext(input: {
  charge: Stripe.Charge;
  paymentIntent: Stripe.PaymentIntent;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): void {
  if (
    input.charge.livemode !== input.purchase.stripeLiveMode ||
    input.paymentIntent.livemode !== input.purchase.stripeLiveMode ||
    !input.charge.paid ||
    input.paymentIntent.status !== "succeeded"
  ) {
    throw new Error("Usage-credit Charge payment state did not match.");
  }
  if (
    !Number.isSafeInteger(input.charge.amount) ||
    !Number.isSafeInteger(input.charge.amount_refunded) ||
    !Number.isSafeInteger(input.paymentIntent.amount) ||
    !Number.isSafeInteger(input.paymentIntent.amount_received) ||
    input.charge.amount !== input.purchase.cashAmountMinor ||
    input.charge.amount_refunded < 0 ||
    input.charge.amount_refunded > input.charge.amount ||
    input.paymentIntent.amount !== input.charge.amount ||
    input.paymentIntent.amount_received !== input.charge.amount ||
    normalizeNullableString(input.charge.currency)?.toLowerCase() !==
      input.purchase.cashCurrency.toLowerCase() ||
    normalizeNullableString(input.paymentIntent.currency)?.toLowerCase() !==
      input.purchase.cashCurrency.toLowerCase()
  ) {
    throw new Error("Usage-credit Charge amount or currency did not match.");
  }
  assertHostedUsageCreditFinancialMetadata({
    metadata: input.paymentIntent.metadata,
    purchase: input.purchase,
  });
  assertHostedStripeLookupMatches({
    expectedLookupKey: input.purchase.stripeCustomerLookupKey,
    kind: "stripe-customer",
    value: coerceStripeObjectId(input.charge.customer),
  });
  assertHostedStripeLookupMatches({
    expectedLookupKey: input.purchase.stripeCustomerLookupKey,
    kind: "stripe-customer",
    value: coerceStripeObjectId(input.paymentIntent.customer),
  });
  assertHostedStripeBillingEventLookupMatches({
    expectedLookupKey: input.purchase.stripePaymentIntentLookupKey,
    value: input.paymentIntent.id,
  });
  assertHostedStripeBillingEventLookupMatches({
    expectedLookupKey: input.purchase.stripeChargeLookupKey,
    value: input.charge.id,
  });
  if (coerceStripeObjectId(input.charge.payment_intent) !== input.paymentIntent.id) {
    throw new Error("Usage-credit Charge PaymentIntent did not match.");
  }
}

export function assertHostedUsageCreditFinancialEventLinks(input: {
  eventChargeId: string | null;
  eventPaymentIntentId: string | null;
  financialChargeId: string | null;
  financialPaymentIntentId: string | null;
  paymentIntentId: string;
}): void {
  if (
    input.eventChargeId !== input.financialChargeId ||
    (
      input.eventPaymentIntentId !== null &&
      input.eventPaymentIntentId !== input.paymentIntentId
    ) ||
    (
      input.financialPaymentIntentId !== null &&
      input.financialPaymentIntentId !== input.paymentIntentId
    )
  ) {
    throw new Error("Usage-credit financial event payment identity did not match.");
  }
}

export function assertHostedUsageCreditSession(input: {
  allowExpiredSession: boolean;
  eventLiveMode: boolean;
  lineItems: Stripe.ApiList<Stripe.LineItem>;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  session: Stripe.Checkout.Session;
}): void {
  if (
    input.eventLiveMode !== input.purchase.stripeLiveMode ||
    input.session.livemode !== input.purchase.stripeLiveMode
  ) {
    throw new Error("Usage-credit Checkout environment did not match its purchase.");
  }
  if (input.session.mode !== "payment") {
    throw new Error("Usage-credit Checkout Session was not a one-time payment.");
  }
  if (
    input.session.payment_status !== "paid" &&
    input.session.payment_status !== "unpaid"
  ) {
    throw new Error("Usage-credit Checkout payment state was invalid.");
  }
  if (
    !input.allowExpiredSession &&
    input.session.status !== "complete"
  ) {
    throw new Error("Usage-credit Checkout Session was not complete.");
  }
  if (
    normalizeNullableString(input.session.client_reference_id) !==
      input.purchase.id
  ) {
    throw new Error("Usage-credit Checkout client reference did not match.");
  }
  assertHostedUsageCreditCheckoutMetadata({
    metadata: input.session.metadata,
    purchase: input.purchase,
  });
  if (
    normalizeNullableString(input.session.success_url) !==
      input.purchase.checkoutSuccessUrl ||
    normalizeNullableString(input.session.cancel_url) !==
      input.purchase.checkoutCancelUrl
  ) {
    throw new Error("Usage-credit Checkout return policy did not match.");
  }
  if (
    !Number.isFinite(input.session.expires_at) ||
    input.session.expires_at !== Math.floor(
      input.purchase.checkoutExpiresAt.getTime() / 1000,
    )
  ) {
    throw new Error("Usage-credit Checkout expiry did not match.");
  }
  if (
    input.session.amount_subtotal !== input.purchase.cashAmountMinor ||
    input.session.amount_total !== input.purchase.cashAmountMinor ||
    normalizeNullableString(input.session.currency)?.toLowerCase() !==
      input.purchase.cashCurrency.toLowerCase()
  ) {
    throw new Error("Usage-credit Checkout amount or currency did not match.");
  }

  const customerId = coerceStripeObjectId(input.session.customer);
  assertHostedStripeLookupMatches({
    expectedLookupKey: input.purchase.stripeCustomerLookupKey,
    kind: "stripe-customer",
    value: customerId,
  });
  if (input.lineItems.has_more || input.lineItems.data.length !== 1) {
    throw new Error("Usage-credit Checkout must contain exactly one line item.");
  }
  const [lineItem] = input.lineItems.data;
  if (!lineItem || lineItem.quantity !== 1) {
    throw new Error("Usage-credit Checkout line-item quantity did not match.");
  }
  assertHostedStripeLookupMatches({
    expectedLookupKey: input.purchase.stripePriceLookupKey,
    kind: "stripe-price",
    value: normalizeNullableString(lineItem.price?.id),
  });
}

export function assertHostedUsageCreditPaymentIdentity(input: {
  paymentIntent: Stripe.PaymentIntent | null;
  paymentIntentId: string | null;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  session: Stripe.Checkout.Session;
}): void {
  if (!input.paymentIntent || !input.paymentIntentId) {
    if (input.session.payment_status === "paid") {
      throw new Error(
        "Paid usage-credit Checkout Session did not include a PaymentIntent.",
      );
    }
    return;
  }

  if (input.paymentIntent.livemode !== input.purchase.stripeLiveMode) {
    throw new Error("Usage-credit PaymentIntent environment did not match.");
  }
  assertHostedUsageCreditCheckoutMetadata({
    metadata: input.paymentIntent.metadata,
    purchase: input.purchase,
  });
  assertHostedStripeLookupMatches({
    expectedLookupKey: input.purchase.stripeCustomerLookupKey,
    kind: "stripe-customer",
    value: coerceStripeObjectId(input.paymentIntent.customer),
  });
  if (
    input.paymentIntent.id !== input.paymentIntentId ||
    !Number.isSafeInteger(input.paymentIntent.amount) ||
    !Number.isSafeInteger(input.paymentIntent.amount_received) ||
    normalizeNullableString(input.paymentIntent.currency)?.toLowerCase() !==
      input.purchase.cashCurrency.toLowerCase() ||
    input.paymentIntent.amount !== input.purchase.cashAmountMinor ||
    input.paymentIntent.amount_received < 0 ||
    input.paymentIntent.amount_received > input.purchase.cashAmountMinor ||
    (
      input.session.payment_status === "paid" &&
      input.paymentIntent.amount_received !== input.purchase.cashAmountMinor
    )
  ) {
    throw new Error("Usage-credit PaymentIntent amount or currency did not match.");
  }
  if (
    input.purchase.stripePaymentIntentLookupKey &&
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: input.purchase.stripePaymentIntentLookupKey,
      kind: "stripe-billing-event",
      normalizedValue: input.paymentIntentId,
    })
  ) {
    throw new Error("Usage-credit PaymentIntent identity did not match.");
  }

  const chargeId = coerceStripeObjectId(input.paymentIntent.latest_charge);
  if (
    input.purchase.stripeChargeLookupKey &&
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: input.purchase.stripeChargeLookupKey,
      kind: "stripe-billing-event",
      normalizedValue: chargeId,
    })
  ) {
    throw new Error("Usage-credit Charge identity did not match.");
  }
}

function assertHostedUsageCreditCheckoutMetadata(input: {
  metadata: Prisma.JsonValue | Stripe.Metadata | null;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): void {
  assertHostedUsageCreditMetadataForPurpose({
    ...input,
    purpose: HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  });
}

function assertHostedUsageCreditFinancialMetadata(input: {
  metadata: Prisma.JsonValue | Stripe.Metadata | null;
  purchase: HostedUsageCreditPurchaseForReconciliation;
}): void {
  const metadata = readStringRecord(input.metadata);
  const purpose = metadata?.purpose;
  if (
    purpose !== HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE &&
    purpose !== HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE
  ) {
    throw new Error("Usage-credit payment metadata purpose did not match.");
  }
  assertHostedUsageCreditMetadataForPurpose({
    ...input,
    purpose,
  });
}

function assertHostedUsageCreditMetadataForPurpose(input: {
  metadata: Prisma.JsonValue | Stripe.Metadata | null;
  purchase: HostedUsageCreditPurchaseForReconciliation;
  purpose:
    | typeof HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE
    | typeof HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE;
}): void {
  const metadata = readStringRecord(input.metadata);
  const policyVersion = parseHostedUsageCreditCheckoutRequestPolicyVersion(
    input.purchase.checkoutRequestPolicyVersion,
  );
  if (
    !policyVersion ||
    (
      input.purpose === HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE &&
      policyVersion !== HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION
    )
  ) {
    throw new Error("Usage-credit payment policy did not match.");
  }
  const expected = {
    policyVersion,
    purchaseId: input.purchase.id,
    purpose: input.purpose,
  };
  if (
    !metadata ||
    Object.keys(metadata).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([key, value]) => metadata[key] !== value)
  ) {
    throw new Error("Usage-credit payment metadata did not match.");
  }
}

export function assertHostedStripeLookupMatches(input: {
  expectedLookupKey: string;
  kind: "stripe-checkout-session" | "stripe-customer" | "stripe-price";
  value: string | null;
}): void {
  if (
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: input.expectedLookupKey,
      kind: input.kind,
      normalizedValue: input.value,
    })
  ) {
    throw new Error("Usage-credit Stripe identity did not match its purchase.");
  }
}

export function assertHostedStripeBillingEventLookupMatches(input: {
  expectedLookupKey: string | null;
  value: string;
}): void {
  if (
    input.expectedLookupKey &&
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: input.expectedLookupKey,
      kind: "stripe-billing-event",
      normalizedValue: input.value,
    })
  ) {
    throw new Error("Usage-credit Stripe payment identity did not match.");
  }
}

export function readStringRecord(
  value: Prisma.JsonValue | Stripe.Metadata | null,
): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => typeof entry !== "string")) {
    return null;
  }
  return Object.fromEntries(
    entries.map(([key, entry]) => [key, String(entry)]),
  );
}

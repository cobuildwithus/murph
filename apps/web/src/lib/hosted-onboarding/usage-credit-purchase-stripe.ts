import type Stripe from "stripe";

import type { HostedUsageCreditPurchase } from "@prisma/client";

import { coerceStripeObjectId } from "./billing";
import {
  createHostedStripeCustomerLookupKeyReadCandidates,
  hostedLookupKeyMatchesValue,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import type { HostedOnboardingReadClient } from "./shared";
import {
  HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
} from "./usage-credit-offers";
import {
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
} from "../hosted-web/encryption";

export const HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS = {
  chargeId: "hosted_usage_credit_purchase.stripe_charge_id",
  checkoutSessionId: "hosted_usage_credit_purchase.stripe_checkout_session_id",
  checkoutUrl: "hosted_usage_credit_purchase.stripe_checkout_url",
  customerId: "hosted_usage_credit_purchase.stripe_customer_id",
  paymentIntentId: "hosted_usage_credit_purchase.stripe_payment_intent_id",
  priceId: "hosted_usage_credit_purchase.stripe_price_id",
} as const;

export type HostedUsageCreditPurchaseStripePrivateField =
  (typeof HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS)[
    keyof typeof HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS
  ];

export function buildHostedUsageCreditCheckoutMetadata(
  purchaseId: string,
): Record<string, string> {
  return {
    policyVersion: HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
    purchaseId,
    purpose: HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  };
}

export async function encryptHostedUsageCreditPurchaseStripeField(input: {
  field: HostedUsageCreditPurchaseStripePrivateField;
  payerMemberId: string;
  prisma: HostedOnboardingReadClient;
  signal?: AbortSignal;
  value: string | null | undefined;
}): Promise<string | null> {
  return encryptHostedWebNullableString({
    field: input.field,
    memberId: input.payerMemberId,
    prisma: input.prisma,
    signal: input.signal,
    value: input.value,
  });
}

export async function decryptHostedUsageCreditPurchaseStripeField(input: {
  field: HostedUsageCreditPurchaseStripePrivateField;
  payerMemberId: string;
  prisma: HostedOnboardingReadClient;
  signal?: AbortSignal;
  value: string | null | undefined;
}): Promise<string | null> {
  return decryptHostedWebNullableString({
    field: input.field,
    memberId: input.payerMemberId,
    prisma: input.prisma,
    signal: input.signal,
    value: input.value,
  });
}

export async function retrieveAndExpireHostedUsageCreditStripeSession(input: {
  purchase: HostedUsageCreditPurchase;
  sessionId: string;
  stripe: Stripe;
}): Promise<Stripe.Checkout.Session> {
  let session = await retrieveHostedUsageCreditStripeSession(input);
  const state = projectHostedUsageCreditStripeSessionState(session);
  if (state !== "checkout_open") {
    return session;
  }

  try {
    session = await input.stripe.checkout.sessions.expire(input.sessionId);
  } catch (error) {
    session = await retrieveHostedUsageCreditStripeSession(input);
    if (projectHostedUsageCreditStripeSessionState(session) === "checkout_open") {
      throw buildHostedUsageCreditStripeUnavailableError(error);
    }
    return session;
  }

  assertHostedUsageCreditStripeSessionMatchesPurchase({
    purchase: input.purchase,
    session,
  });
  return session;
}

async function retrieveHostedUsageCreditStripeSession(input: {
  purchase: HostedUsageCreditPurchase;
  sessionId: string;
  stripe: Stripe;
}): Promise<Stripe.Checkout.Session> {
  let session: Stripe.Checkout.Session;
  try {
    session = await input.stripe.checkout.sessions.retrieve(input.sessionId);
  } catch (error) {
    throw buildHostedUsageCreditStripeUnavailableError(error);
  }
  assertHostedUsageCreditStripeSessionMatchesPurchase({
    purchase: input.purchase,
    session,
  });
  return session;
}

export function projectHostedUsageCreditStripeSessionState(
  session: Stripe.Checkout.Session,
): "checkout_open" | "expired" | "payment_pending" {
  if (session.payment_status === "paid" || session.status === "complete") {
    return "payment_pending";
  }
  if (session.status === "expired" && session.payment_status === "unpaid") {
    return "expired";
  }
  if (session.status === "open" && session.payment_status === "unpaid") {
    return "checkout_open";
  }
  throw buildHostedUsageCreditInvariantError("stripe_session_state_invalid");
}

export async function reconstructHostedUsageCreditStripeCheckoutRequest(input: {
  prisma: HostedOnboardingReadClient;
  purchase: HostedUsageCreditPurchase;
}): Promise<Stripe.Checkout.SessionCreateParams> {
  if (
    input.purchase.checkoutRequestPolicyVersion !==
      HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION
  ) {
    throw buildHostedUsageCreditInvariantError("checkout_policy_mismatch");
  }

  const [priceId, stripeCustomerId] = await Promise.all([
    decryptHostedUsageCreditPurchaseStripeField({
      field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.priceId,
      payerMemberId: input.purchase.payerMemberId,
      prisma: input.prisma,
      value: input.purchase.stripePriceIdEncrypted,
    }),
    decryptHostedUsageCreditPurchaseStripeField({
      field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.customerId,
      payerMemberId: input.purchase.payerMemberId,
      prisma: input.prisma,
      value: input.purchase.stripeCustomerIdEncrypted,
    }),
  ]);
  if (!priceId || !stripeCustomerId) {
    throw buildHostedUsageCreditInvariantError("checkout_private_fields_missing");
  }
  if (
    !createHostedStripeCustomerLookupKeyReadCandidates(stripeCustomerId)
      .includes(input.purchase.stripeCustomerLookupKey)
  ) {
    throw buildHostedUsageCreditInvariantError("checkout_customer_lookup_mismatch");
  }

  return buildHostedUsageCreditStripeCheckoutRequest({
    checkoutCancelUrl: input.purchase.checkoutCancelUrl,
    checkoutExpiresAt: input.purchase.checkoutExpiresAt,
    checkoutMetadata: buildHostedUsageCreditCheckoutMetadata(input.purchase.id),
    checkoutSuccessUrl: input.purchase.checkoutSuccessUrl,
    priceId,
    purchaseId: input.purchase.id,
    stripeCustomerId,
  });
}

function buildHostedUsageCreditStripeCheckoutRequest(input: {
  checkoutCancelUrl: string;
  checkoutExpiresAt: Date;
  checkoutMetadata: Record<string, string>;
  checkoutSuccessUrl: string;
  priceId: string;
  purchaseId: string;
  stripeCustomerId: string;
}): Stripe.Checkout.SessionCreateParams {
  return {
    adaptive_pricing: { enabled: false },
    cancel_url: input.checkoutCancelUrl,
    client_reference_id: input.purchaseId,
    customer: input.stripeCustomerId,
    expires_at: Math.floor(input.checkoutExpiresAt.getTime() / 1_000),
    line_items: [{ price: input.priceId, quantity: 1 }],
    metadata: input.checkoutMetadata,
    mode: "payment",
    payment_intent_data: {
      metadata: input.checkoutMetadata,
    },
    success_url: input.checkoutSuccessUrl,
  };
}

export async function assertHostedUsageCreditStripePriceMatchesPurchase(input: {
  checkoutRequest: Stripe.Checkout.SessionCreateParams;
  purchase: HostedUsageCreditPurchase;
  stripe: Stripe;
}): Promise<void> {
  const [lineItem] = input.checkoutRequest.line_items ?? [];
  const priceId = typeof lineItem?.price === "string" ? lineItem.price : null;
  if (
    !priceId ||
    !hostedLookupKeyMatchesValue({
      expectedLookupKey: input.purchase.stripePriceLookupKey,
      kind: "stripe-price",
      normalizedValue: priceId,
    })
  ) {
    throw buildHostedUsageCreditInvariantError("checkout_price_identity_invalid");
  }

  let price: Stripe.Price;
  try {
    price = await input.stripe.prices.retrieve(priceId, {
      expand: ["currency_options"],
    });
  } catch (error) {
    throw buildHostedUsageCreditStripeUnavailableError(error);
  }

  if (price.id !== priceId || price.object !== "price") {
    throw buildHostedUsageCreditPriceConfigurationError("price_identity_mismatch");
  }
  if (price.livemode !== input.purchase.stripeLiveMode) {
    throw buildHostedUsageCreditPriceConfigurationError("price_mode_mismatch");
  }
  if (!price.active) {
    throw buildHostedUsageCreditPriceConfigurationError("price_inactive");
  }
  if (price.type !== "one_time" || price.recurring !== null) {
    throw buildHostedUsageCreditPriceConfigurationError("price_not_one_time");
  }
  if (price.billing_scheme !== "per_unit") {
    throw buildHostedUsageCreditPriceConfigurationError("price_billing_scheme_invalid");
  }
  if (price.currency.toLowerCase() !== input.purchase.cashCurrency.toLowerCase()) {
    throw buildHostedUsageCreditPriceConfigurationError("price_currency_mismatch");
  }
  if (price.unit_amount !== input.purchase.cashAmountMinor) {
    throw buildHostedUsageCreditPriceConfigurationError("price_amount_mismatch");
  }
  if (price.custom_unit_amount !== null) {
    throw buildHostedUsageCreditPriceConfigurationError("price_custom_amount_unsupported");
  }
  if (price.transform_quantity !== null) {
    throw buildHostedUsageCreditPriceConfigurationError("price_transform_unsupported");
  }
  if (
    price.currency_options &&
    Object.keys(price.currency_options).some(
      (currency) => currency.toLowerCase() !== price.currency.toLowerCase(),
    )
  ) {
    throw buildHostedUsageCreditPriceConfigurationError(
      "price_currency_options_unsupported",
    );
  }
}

export function buildHostedUsageCreditCheckoutIdempotencyKey(
  purchaseId: string,
): string {
  return `hosted-usage-credit-checkout:${purchaseId}`;
}

export function assertHostedUsageCreditStripeSessionMatchesPurchase(input: {
  purchase: HostedUsageCreditPurchase;
  session: Stripe.Checkout.Session;
}): void {
  const expectedMetadata = buildHostedUsageCreditCheckoutMetadata(input.purchase.id);
  const sessionCustomerId = coerceStripeObjectId(input.session.customer);
  if (
    input.session.adaptive_pricing?.enabled !== false ||
    input.session.livemode !== input.purchase.stripeLiveMode ||
    input.session.mode !== "payment" ||
    input.session.client_reference_id !== input.purchase.id ||
    !sessionCustomerId ||
    !createHostedStripeCustomerLookupKeyReadCandidates(sessionCustomerId)
      .includes(input.purchase.stripeCustomerLookupKey) ||
    input.session.expires_at !== Math.floor(input.purchase.checkoutExpiresAt.getTime() / 1_000) ||
    !hostedUsageCreditMetadataEqual(input.session.metadata, expectedMetadata)
  ) {
    throw buildHostedUsageCreditInvariantError("stripe_session_mismatch");
  }
}

function hostedUsageCreditMetadataEqual(
  actual: Record<string, unknown> | null,
  expected: Record<string, string>,
): boolean {
  if (!actual) {
    return false;
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) =>
      key === expectedKeys[index] && actual[key] === expected[key]
    );
}

export function requireHostedUsageCreditLookupKey(
  value: string | null,
  field: string,
): string {
  if (!value) {
    throw buildHostedUsageCreditInvariantError(`${field}_lookup_missing`);
  }
  return value;
}

export function requireHostedUsageCreditEncryptedValue(
  value: string | null,
  field: string,
): string {
  if (!value) {
    throw buildHostedUsageCreditInvariantError(`${field}_encryption_failed`);
  }
  return value;
}

export function buildHostedUsageCreditInvariantError(reason: string) {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_CHECKOUT_INVARIANT_FAILED",
    details: { code: reason },
    httpStatus: 500,
    message: "Usage-credit checkout could not be verified.",
  });
}

function buildHostedUsageCreditPriceConfigurationError(reason: string) {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_STRIPE_PRICE_INVALID",
    details: { code: reason },
    httpStatus: 500,
    message: "Usage-credit checkout is temporarily unavailable.",
  });
}

export function buildHostedUsageCreditStripeUnavailableError(error: unknown) {
  return hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
    details: describeSafeHostedUsageCreditStripeError(error),
    httpStatus: 502,
    message: "Stripe checkout is temporarily unavailable. Try again.",
    retryable: true,
  });
}

export function isDefinitiveHostedUsageCreditStripeRequestRejection(
  error: unknown,
): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    rawType?: unknown;
    statusCode?: unknown;
    type?: unknown;
  };
  return (
    candidate.type === "StripeInvalidRequestError" ||
    candidate.rawType === "invalid_request_error"
  ) &&
    typeof candidate.statusCode === "number" &&
    candidate.statusCode >= 400 &&
    candidate.statusCode < 500 &&
    candidate.statusCode !== 409 &&
    candidate.statusCode !== 429;
}

export function describeSafeHostedUsageCreditStripeError(
  error: unknown,
): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return {};
  }
  const candidate = error as {
    code?: unknown;
    rawType?: unknown;
    requestId?: unknown;
    statusCode?: unknown;
    type?: unknown;
  };
  return {
    ...(typeof candidate.code === "string" ? { providerErrorCode: candidate.code } : {}),
    ...(typeof candidate.rawType === "string" ? { providerErrorType: candidate.rawType } : {}),
    ...(typeof candidate.type === "string" ? { providerErrorType: candidate.type } : {}),
    ...(typeof candidate.statusCode === "number" ? { statusCode: candidate.statusCode } : {}),
    ...(typeof candidate.requestId === "string" ? { providerRequestIdPresent: true } : {}),
  };
}

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
  buildHostedStripeAlertCorrelationCause,
  describeHostedStripeError,
  logHostedStripeFailure,
} from "./stripe-error-log";
import {
  HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V2,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V3,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V4,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
  HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE,
  parseHostedUsageCreditCheckoutRequestPolicyVersion,
  type HostedUsageCreditCheckoutRequestPolicyVersion,
} from "./usage-credit-offers";
import { normalizeHostedGroupUsageFundingLocator } from
  "../hosted-groups/group-usage-funding";
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
  policyVersion: HostedUsageCreditCheckoutRequestPolicyVersion,
): Record<string, string> {
  return {
    policyVersion,
    purchaseId,
    purpose: HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE,
  };
}

export function buildHostedUsageCreditSavedCardMetadata(
  purchaseId: string,
  policyVersion: HostedUsageCreditCheckoutRequestPolicyVersion,
): Record<string, string> {
  return {
    policyVersion,
    purchaseId,
    purpose: HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE,
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
      throw buildHostedUsageCreditStripeUnavailableError(
        error,
        "checkout.sessions.expire",
      );
    }
    // The re-read already closed the session, so this rejection is absorbed.
    logHostedStripeFailure({ error, operationName: "checkout.sessions.expire" });
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
    throw buildHostedUsageCreditStripeUnavailableError(
      error,
      "checkout.sessions.retrieve",
    );
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
  const policyVersion = parseHostedUsageCreditCheckoutRequestPolicyVersion(
    input.purchase.checkoutRequestPolicyVersion,
  );
  if (!policyVersion) {
    throw buildHostedUsageCreditInvariantError("checkout_policy_mismatch");
  }

  const payerMemberId = requireHostedUsageCreditPurchasePayerMemberId(
    input.purchase,
  );
  const [priceId, stripeCustomerId] = await Promise.all([
    decryptHostedUsageCreditPurchaseStripeField({
      field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.priceId,
      payerMemberId,
      prisma: input.prisma,
      value: input.purchase.stripePriceIdEncrypted,
    }),
    decryptHostedUsageCreditPurchaseStripeField({
      field: HOSTED_USAGE_CREDIT_PURCHASE_STRIPE_PRIVATE_FIELDS.customerId,
      payerMemberId,
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
    checkoutMetadata: buildHostedUsageCreditCheckoutMetadata(
      input.purchase.id,
      policyVersion,
    ),
    checkoutSuccessUrl: input.purchase.checkoutSuccessUrl,
    savePaymentMethod:
      policyVersion === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V3 ||
      policyVersion === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V4 ||
      (
        policyVersion === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION &&
        input.purchase.groupSponsorshipAuthorizationId !== null
      ) ||
      (
        policyVersion === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V2 &&
        isHostedUsageCreditGroupReturnUrl(input.purchase.checkoutCancelUrl) &&
        isHostedUsageCreditGroupReturnUrl(input.purchase.checkoutSuccessUrl)
      ),
    showPaymentMethodSaveControl:
      policyVersion === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V4 ||
      policyVersion === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
    sponsorshipCardOnly:
      policyVersion === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION &&
      input.purchase.groupSponsorshipAuthorizationId !== null,
    priceId,
    purchaseId: input.purchase.id,
    stripeCustomerId,
  });
}

export function requireHostedUsageCreditPurchasePayerMemberId(
  purchase: Pick<HostedUsageCreditPurchase, "payerMemberId">,
): string {
  if (!purchase.payerMemberId) {
    throw buildHostedUsageCreditInvariantError("purchase_payer_missing");
  }
  return purchase.payerMemberId;
}

function buildHostedUsageCreditStripeCheckoutRequest(input: {
  checkoutCancelUrl: string;
  checkoutExpiresAt: Date;
  checkoutMetadata: Record<string, string>;
  checkoutSuccessUrl: string;
  priceId: string;
  purchaseId: string;
  savePaymentMethod: boolean;
  showPaymentMethodSaveControl: boolean;
  sponsorshipCardOnly: boolean;
  stripeCustomerId: string;
}): Stripe.Checkout.SessionCreateParams {
  const paymentIntentData: NonNullable<
    Stripe.Checkout.SessionCreateParams["payment_intent_data"]
  > = {
    metadata: input.checkoutMetadata,
  };
  if (input.savePaymentMethod) {
    paymentIntentData.setup_future_usage = "off_session";
  }
  const checkoutParams: Stripe.Checkout.SessionCreateParams = {
    adaptive_pricing: { enabled: false },
    cancel_url: input.checkoutCancelUrl,
    client_reference_id: input.purchaseId,
    customer: input.stripeCustomerId,
    expires_at: Math.floor(input.checkoutExpiresAt.getTime() / 1_000),
    line_items: [{ price: input.priceId, quantity: 1 }],
    metadata: input.checkoutMetadata,
    mode: "payment",
    payment_intent_data: paymentIntentData,
    success_url: input.checkoutSuccessUrl,
  };
  if (input.showPaymentMethodSaveControl) {
    checkoutParams.saved_payment_method_options = {
      allow_redisplay_filters: ["always"],
      payment_method_save: "enabled",
    };
  }
  if (input.sponsorshipCardOnly) {
    checkoutParams.payment_method_types = ["card"];
  }
  return checkoutParams;
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
    throw buildHostedUsageCreditStripeUnavailableError(error, "prices.retrieve");
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
  const policyVersion = parseHostedUsageCreditCheckoutRequestPolicyVersion(
    input.purchase.checkoutRequestPolicyVersion,
  );
  if (!policyVersion) {
    throw buildHostedUsageCreditInvariantError("checkout_policy_mismatch");
  }
  const expectedMetadata = buildHostedUsageCreditCheckoutMetadata(
    input.purchase.id,
    policyVersion,
  );
  const sponsorshipCardOnly =
    policyVersion === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION &&
    input.purchase.groupSponsorshipAuthorizationId !== null;
  const sessionPaymentMethodTypes = input.session.payment_method_types ?? [];
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
    (
      sponsorshipCardOnly &&
      (
        sessionPaymentMethodTypes.length !== 1 ||
        sessionPaymentMethodTypes[0] !== "card"
      )
    ) ||
    !hostedUsageCreditMetadataEqual(input.session.metadata, expectedMetadata)
  ) {
    throw buildHostedUsageCreditInvariantError("stripe_session_mismatch");
  }
}

export function isHostedUsageCreditGroupReturnUrl(value: string): boolean {
  try {
    const pathSegments = new URL(value).pathname.split("/").filter(Boolean);
    return pathSegments.length === 3 &&
      pathSegments[0] === "groups" &&
      pathSegments[1] === "fund" &&
      normalizeHostedGroupUsageFundingLocator(pathSegments[2] ?? "") !== null;
  } catch {
    return false;
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

export function buildHostedUsageCreditStripeUnavailableError(
  error: unknown,
  operationName: string,
) {
  logHostedStripeFailure({ error, operationName });
  return hostedOnboardingError({
    cause: buildHostedStripeAlertCorrelationCause(error),
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
  const fields = describeHostedStripeError(error);
  const providerErrorType = fields.type ?? fields.rawType;

  return {
    ...(fields.code ? { providerErrorCode: fields.code } : {}),
    ...(providerErrorType ? { providerErrorType } : {}),
    ...(fields.statusCode === null ? {} : { statusCode: fields.statusCode }),
    ...(fields.requestId ? { providerRequestIdPresent: true } : {}),
  };
}

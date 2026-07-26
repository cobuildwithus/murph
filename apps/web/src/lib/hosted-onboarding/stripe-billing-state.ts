import { createHash } from "node:crypto";

import type Stripe from "stripe";

import {
  coerceStripeObjectId,
  readStripeShouldRetryDirective,
} from "./billing";
import { hostedOnboardingError } from "./errors";

// Stripe retains v1 idempotency results for at least 24 hours. Keep a full
// hour of provider-clock and request-latency margin before any same-key replay.
export const HOSTED_STRIPE_IDEMPOTENCY_SAFE_REPLAY_WINDOW_MS =
  23 * 60 * 60 * 1_000;

const HOSTED_STRIPE_CHECKOUT_SESSION_MAX_LIFETIME_MS =
  24 * 60 * 60 * 1_000;

const HOSTED_STRIPE_LIVE_WEBHOOK_RETRY_HORIZON_MS =
  3 * 24 * 60 * 60 * 1_000;

export const HOSTED_STRIPE_BILLING_SUBSCRIPTION_EXPANSIONS = [
  "customer",
  "items.data.price",
  "latest_invoice",
] as const;

const HOSTED_STRIPE_INVOICE_PAYMENT_EXPANSIONS = [
  "data.payment.payment_intent",
] as const;

export type HostedStripeTender =
  | {
      id: string;
      kind: "legacy_source";
    }
  | {
      id: string;
      kind: "payment_method";
    };

export function assertHostedStripeSubscriptionMatchesCustomer(input: {
  stripeCustomerId: string;
  subscription: Stripe.Subscription;
}): void {
  if (coerceStripeObjectId(input.subscription.customer) === input.stripeCustomerId) {
    return;
  }
  throw hostedOnboardingError({
    code: "HOSTED_BILLING_STRIPE_CUSTOMER_MISMATCH",
    httpStatus: 409,
    message: "Your subscription could not be matched to this hosted account.",
  });
}

export type HostedStripeInvoiceCollectionState =
  | { kind: "none" }
  | ({
      kind: "paid";
    } & HostedStripeInvoiceCollectionFacts)
  | {
      advancingEvent: "invoice.paid";
      deadlineUnixSeconds: number;
      kind: "payment_required";
      paymentUrl: string | null;
    } & HostedStripeInvoiceCollectionFacts
  | ({
      advancingEvent: "invoice.finalized" | "invoice.paid";
      deadlineUnixSeconds: number;
      kind: "processing";
    } & HostedStripeInvoiceCollectionFacts)
  | ({
      kind: "uncollectible";
    } & HostedStripeInvoiceCollectionFacts)
  | ({
      kind: "voided";
    } & HostedStripeInvoiceCollectionFacts)
  | ({
      kind: "failed";
      reason: string | null;
    } & HostedStripeInvoiceCollectionFacts);

export interface HostedStripeInvoiceCollectionSnapshot {
  invoice: Stripe.Invoice;
  invoicePayments: readonly Stripe.InvoicePayment[];
}

type HostedStripeFailureDisposition =
  | {
      httpStatus: 500;
      kind: "provider_rejected";
      retryable: false;
    }
  | {
      httpStatus: 502;
      kind: "provider_ambiguous";
      retryable: true;
    };

interface HostedStripeInvoiceCollectionClient {
  invoicePayments: Pick<Stripe["invoicePayments"], "list">;
  invoices: Pick<Stripe["invoices"], "retrieve">;
}

interface HostedStripeInvoiceCollectionFacts {
  invoiceId: string;
  invoicePaymentId: string | null;
  paymentIntentId: string | null;
}

const HOSTED_STRIPE_COLLECTION_RECHECK_MAX_SECONDS = 24 * 60 * 60;

const HOSTED_STRIPE_RETRYABLE_ERROR_TYPES = new Set([
  "api_connection_error",
  "StripeAPIError",
  "StripeAPIConnectionError",
  "StripeConnectionError",
  "StripeRateLimitError",
]);

const HOSTED_STRIPE_RETRYABLE_ERROR_CODES = new Set([
  "api_connection_error",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ESOCKETTIMEDOUT",
  "ETIMEDOUT",
  "rate_limit",
]);

/**
 * Temporary legacy-facing compatibility for standard Checkout Sessions
 * created before durable attempt metadata shipped. Stripe limits Checkout
 * Sessions to 24 hours and automatically retries live webhooks for three days,
 * so anything observed after that delivery horizon is a superseded loser.
 */
export function isHostedStripeLegacyCheckoutCompletionAllowed(input: {
  observedAt: Date;
  sessionCreated: number;
  sessionExpiresAt: number;
}): boolean {
  if (
    !Number.isSafeInteger(input.sessionCreated)
    || input.sessionCreated <= 0
    || !Number.isSafeInteger(input.sessionExpiresAt)
    || input.sessionExpiresAt <= input.sessionCreated
  ) {
    return false;
  }

  const observedAtMs = input.observedAt.getTime();
  const sessionCreatedAtMs = input.sessionCreated * 1_000;
  const sessionExpiresAtMs = input.sessionExpiresAt * 1_000;
  if (
    !Number.isFinite(observedAtMs)
    || !Number.isSafeInteger(sessionCreatedAtMs)
    || !Number.isSafeInteger(sessionExpiresAtMs)
    || sessionExpiresAtMs - sessionCreatedAtMs >
      HOSTED_STRIPE_CHECKOUT_SESSION_MAX_LIFETIME_MS
  ) {
    return false;
  }

  const finalDeliveryAtMs =
    sessionExpiresAtMs + HOSTED_STRIPE_LIVE_WEBHOOK_RETRY_HORIZON_MS;
  return Number.isSafeInteger(finalDeliveryAtMs)
    && observedAtMs >= sessionCreatedAtMs
    && observedAtMs <= finalDeliveryAtMs;
}

export function readHostedStripeSubscriptionTender(
  subscription: Stripe.Subscription,
): HostedStripeTender | null {
  const subscriptionPaymentMethodId = coerceStripeObjectId(
    subscription.default_payment_method,
  );
  if (subscriptionPaymentMethodId) {
    return buildHostedStripeTenderFromId({
      id: subscriptionPaymentMethodId,
      kind: "payment_method",
    });
  }

  const subscriptionSourceId = coerceStripeObjectId(
    subscription.default_source,
  );
  if (subscriptionSourceId) {
    return buildHostedStripeTenderFromId({
      id: subscriptionSourceId,
      kind: "legacy_source",
    });
  }

  const customer = readExpandedStripeCustomer(subscription.customer);
  if (!customer) {
    return null;
  }

  const customerPaymentMethodId = coerceStripeObjectId(
    customer.invoice_settings.default_payment_method,
  );
  if (customerPaymentMethodId) {
    return buildHostedStripeTenderFromId({
      id: customerPaymentMethodId,
      kind: "payment_method",
    });
  }

  const customerSourceId = coerceStripeObjectId(customer.default_source);
  return customerSourceId
    ? buildHostedStripeTenderFromId({
        id: customerSourceId,
        kind: "legacy_source",
      })
    : null;
}

export function readHostedStripeBillingAttemptTender(
  subscription: Stripe.Subscription,
  input: {
    customerDefaultConfirmed: boolean;
  },
): HostedStripeTender | null {
  if (!input.customerDefaultConfirmed) {
    return readHostedStripeSubscriptionTender(subscription);
  }

  const customer = readExpandedStripeCustomer(subscription.customer);
  if (customer) {
    const customerPaymentMethodId = coerceStripeObjectId(
      customer.invoice_settings.default_payment_method,
    );
    if (customerPaymentMethodId) {
      return buildHostedStripeTenderFromId({
        id: customerPaymentMethodId,
        kind: "payment_method",
      });
    }

    const customerSourceId = coerceStripeObjectId(customer.default_source);
    if (customerSourceId) {
      return buildHostedStripeTenderFromId({
        id: customerSourceId,
        kind: "legacy_source",
      });
    }
  }

  return readHostedStripeSubscriptionTender(subscription);
}

export function buildHostedStripeTenderSubscriptionUpdate(
  tender: HostedStripeTender,
): Partial<
  Pick<
    Stripe.SubscriptionUpdateParams,
    "default_payment_method" | "default_source"
  >
> {
  assertHostedStripeTenderId(tender);
  return tender.kind === "payment_method"
    ? {
        default_payment_method: tender.id,
      }
    : {
        default_source: tender.id,
      };
}

export function isHostedStripeTenderAppliedToSubscription(input: {
  subscription: Stripe.Subscription;
  tender: HostedStripeTender;
}): boolean {
  assertHostedStripeTenderId(input.tender);
  const appliedId = input.tender.kind === "payment_method"
    ? coerceStripeObjectId(input.subscription.default_payment_method)
    : coerceStripeObjectId(input.subscription.default_source);
  return appliedId === input.tender.id;
}

export function readHostedStripeExpandedLatestInvoice(
  subscription: Stripe.Subscription,
): Stripe.Invoice | null {
  const invoice = subscription.latest_invoice;
  return invoice && typeof invoice === "object" ? invoice : null;
}

export async function retrieveHostedStripeInvoiceCollectionSnapshot(input: {
  invoiceId: string;
  requestOptions?: Stripe.RequestOptions;
  stripe: HostedStripeInvoiceCollectionClient;
}): Promise<HostedStripeInvoiceCollectionSnapshot> {
  const [invoice, invoicePayments] = await Promise.all([
    input.requestOptions
      ? input.stripe.invoices.retrieve(
          input.invoiceId,
          {},
          input.requestOptions,
        )
      : input.stripe.invoices.retrieve(input.invoiceId),
    input.requestOptions
      ? input.stripe.invoicePayments.list({
          expand: [...HOSTED_STRIPE_INVOICE_PAYMENT_EXPANSIONS],
          invoice: input.invoiceId,
          limit: 100,
        }, input.requestOptions)
      : input.stripe.invoicePayments.list({
          expand: [...HOSTED_STRIPE_INVOICE_PAYMENT_EXPANSIONS],
          invoice: input.invoiceId,
          limit: 100,
        }),
  ]);

  if (invoice.id !== input.invoiceId) {
    throw new TypeError(
      "Stripe returned the wrong invoice for a collection-state read.",
    );
  }
  if (invoicePayments.has_more) {
    throw new TypeError(
      "Stripe returned more payments than collection-state reconciliation supports.",
    );
  }

  for (const invoicePayment of invoicePayments.data) {
    if (coerceStripeObjectId(invoicePayment.invoice) !== input.invoiceId) {
      throw new TypeError(
        "Stripe returned a payment for the wrong collection-state invoice.",
      );
    }
  }

  return {
    invoice,
    invoicePayments: invoicePayments.data,
  };
}

function readHostedStripeInvoicePaymentIntent(
  invoicePayments: readonly Stripe.InvoicePayment[],
): Stripe.PaymentIntent | null {
  const payment = readHostedStripeInvoicePayment(invoicePayments);
  const paymentIntent = payment?.payment.payment_intent;

  return paymentIntent &&
      typeof paymentIntent === "object" &&
      paymentIntent.object === "payment_intent"
    ? paymentIntent
    : null;
}

function readHostedStripeInvoicePayment(
  invoicePayments: readonly Stripe.InvoicePayment[],
): Stripe.InvoicePayment | null {
  const defaultPayments = invoicePayments.filter((invoicePayment) =>
    invoicePayment.is_default
  );
  if (defaultPayments.length === 1) {
    return defaultPayments[0] ?? null;
  }
  if (defaultPayments.length > 1 || invoicePayments.length > 1) {
    return null;
  }
  return invoicePayments[0] ?? null;
}

function hasAmbiguousHostedStripeInvoicePayments(
  invoicePayments: readonly Stripe.InvoicePayment[],
): boolean {
  const defaultPaymentCount = invoicePayments.filter((invoicePayment) =>
    invoicePayment.is_default
  ).length;
  return defaultPaymentCount > 1 ||
    (invoicePayments.length > 1 && defaultPaymentCount !== 1);
}

export function readHostedStripeInvoicePaymentUrl(
  invoice: Stripe.Invoice | null,
): string | null {
  return invoice &&
      typeof invoice.hosted_invoice_url === "string" &&
      invoice.hosted_invoice_url.startsWith("https://")
    ? invoice.hosted_invoice_url
    : null;
}

export function classifyHostedStripeInvoiceCollectionState(
  invoice: Stripe.Invoice | null,
  invoicePayments: readonly Stripe.InvoicePayment[] = [],
): HostedStripeInvoiceCollectionState {
  if (!invoice) {
    return { kind: "none" };
  }
  const invoicePayment = readHostedStripeInvoicePayment(invoicePayments);
  const paymentIntent = readHostedStripeInvoicePaymentIntent(invoicePayments);
  const facts: HostedStripeInvoiceCollectionFacts = {
    invoiceId: invoice.id,
    invoicePaymentId: invoicePayment?.id ?? null,
    paymentIntentId: paymentIntent?.id ??
      coerceStripeObjectId(invoicePayment?.payment.payment_intent),
  };
  if (invoice.status === "draft" && invoice.last_finalization_error) {
    return {
      ...facts,
      kind: "failed",
      reason: invoice.last_finalization_error.code ??
        "invoice_finalization_failed",
    };
  }

  if (invoice.status === "paid") {
    return { ...facts, kind: "paid" };
  }
  if (invoice.status === "void") {
    return { ...facts, kind: "voided" };
  }
  if (invoice.status === "uncollectible") {
    return { ...facts, kind: "uncollectible" };
  }
  if (hasAmbiguousHostedStripeInvoicePayments(invoicePayments)) {
    return {
      ...facts,
      kind: "failed",
      reason: "ambiguous_invoice_payments",
    };
  }

  if (paymentIntent) {
    if (
      paymentIntent.status === "requires_action" ||
      paymentIntent.status === "requires_confirmation" ||
      paymentIntent.status === "requires_payment_method"
    ) {
      return {
        ...facts,
        advancingEvent: "invoice.paid",
        deadlineUnixSeconds: readHostedStripeCollectionDeadline(invoice),
        kind: "payment_required",
        paymentUrl: readHostedStripeInvoicePaymentUrl(invoice),
      };
    }
    if (
      paymentIntent.status === "processing" ||
      paymentIntent.status === "succeeded"
    ) {
      return {
        ...facts,
        advancingEvent: "invoice.paid",
        deadlineUnixSeconds: readHostedStripeCollectionDeadline(invoice),
        kind: "processing",
      };
    }
    if (paymentIntent.status === "requires_capture") {
      return {
        ...facts,
        kind: "failed",
        reason: "payment_intent_requires_capture",
      };
    }
    if (paymentIntent.status === "canceled") {
      return {
        ...facts,
        kind: "failed",
        reason: "payment_intent_canceled",
      };
    }
  }

  if (invoicePayments.some((invoicePayment) => invoicePayment.status === "paid")) {
    return {
      ...facts,
      advancingEvent: "invoice.paid",
      deadlineUnixSeconds: readHostedStripeCollectionDeadline(invoice),
      kind: "processing",
    };
  }

  if (invoice.status === "draft") {
    return {
      ...facts,
      advancingEvent: "invoice.finalized",
      deadlineUnixSeconds: readHostedStripeCollectionDeadline(invoice),
      kind: "processing",
    };
  }
  if (invoice.status === "open") {
    const paymentRequired = invoice.attempted === true &&
      typeof invoice.amount_remaining === "number" &&
      invoice.amount_remaining > 0;
    return paymentRequired
      ? {
          ...facts,
          advancingEvent: "invoice.paid",
          deadlineUnixSeconds: readHostedStripeCollectionDeadline(invoice),
          kind: "payment_required",
          paymentUrl: readHostedStripeInvoicePaymentUrl(invoice),
        }
      : {
          ...facts,
          advancingEvent: "invoice.paid",
          deadlineUnixSeconds: readHostedStripeCollectionDeadline(invoice),
          kind: "processing",
        };
  }

  return {
    ...facts,
    kind: "failed",
    reason: invoice.status,
  };
}

function readHostedStripeCollectionDeadline(
  invoice: Stripe.Invoice,
): number {
  const providerDeadlines = [
    invoice.automatically_finalizes_at,
    invoice.due_date,
    invoice.next_payment_attempt,
  ].filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0
  );
  if (providerDeadlines.length > 0) {
    return Math.min(...providerDeadlines);
  }

  const created = typeof invoice.created === "number" &&
      Number.isFinite(invoice.created)
    ? invoice.created
    : 0;
  return created + HOSTED_STRIPE_COLLECTION_RECHECK_MAX_SECONDS;
}

export function buildHostedStripeSubscriptionMutationScope(
  subscription: Stripe.Subscription,
  invoiceSnapshot?: HostedStripeInvoiceCollectionSnapshot | null,
): string {
  const invoice = invoiceSnapshot === undefined
    ? readHostedStripeExpandedLatestInvoice(subscription)
    : invoiceSnapshot?.invoice ?? null;
  const invoicePayments = invoiceSnapshot?.invoicePayments ?? [];
  const paymentIntent = readHostedStripeInvoicePaymentIntent(invoicePayments);
  const collectionState = classifyHostedStripeInvoiceCollectionState(
    invoice,
    invoicePayments,
  );
  const pendingUpdate = subscription.pending_update;
  const pendingItems = Array.isArray(pendingUpdate?.subscription_items)
    ? pendingUpdate.subscription_items.map((item) => ({
        id: item.id,
        price: coerceStripeObjectId(item.price),
        quantity: item.quantity ?? null,
      }))
    : [];

  const state = {
    cancelAt: subscription.cancel_at,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    defaultPaymentMethod: coerceStripeObjectId(
      subscription.default_payment_method,
    ),
    defaultSource: coerceStripeObjectId(subscription.default_source),
    invoice: invoice
      ? {
          amountRemaining: invoice.amount_remaining,
          attempted: invoice.attempted,
          collection: {
            kind: collectionState.kind,
            reason: collectionState.kind === "failed"
              ? collectionState.reason
              : null,
          },
          id: invoice.id,
          lastFinalizationError: invoice.last_finalization_error
            ? {
                code: invoice.last_finalization_error.code,
                type: invoice.last_finalization_error.type,
              }
            : null,
          payments: invoicePayments
            .map((invoicePayment) => ({
              id: invoicePayment.id,
              isDefault: invoicePayment.is_default,
              paymentIntent: invoicePayment.payment.type === "payment_intent"
                ? coerceStripeObjectId(invoicePayment.payment.payment_intent)
                : null,
              status: invoicePayment.status,
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
          paymentIntent: paymentIntent
            ? {
                id: paymentIntent.id,
                status: paymentIntent.status,
              }
            : null,
          status: invoice.status,
        }
      : null,
    latestInvoiceId: coerceStripeObjectId(subscription.latest_invoice),
    items: subscription.items.data
      .map((item) => ({
        id: item.id,
        price: item.price?.id ?? null,
        quantity: item.quantity ?? null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    pendingUpdate: pendingUpdate
      ? {
          expiresAt: pendingUpdate.expires_at,
          items: pendingItems.sort((left, right) =>
            String(left.id).localeCompare(String(right.id))
          ),
        }
      : null,
    status: subscription.status,
    trialEnd: subscription.trial_end,
  };

  return createHash("sha256")
    .update(JSON.stringify(state))
    .digest("hex")
    .slice(0, 32);
}

export function isHostedStripeRetryableFailure(error: unknown): boolean {
  const shouldRetry = readStripeShouldRetryDirective(error);
  if (shouldRetry !== null) {
    return shouldRetry;
  }
  if (!error || typeof error !== "object") {
    return false;
  }

  const type = Reflect.get(error, "type");
  const rawType = Reflect.get(error, "rawType");
  const code = Reflect.get(error, "code");
  if (type === "StripeIdempotencyError" || rawType === "idempotency_error") {
    return code === "idempotency_key_in_use";
  }

  const statusCode = Reflect.get(error, "statusCode");
  if (typeof statusCode === "number") {
    return statusCode === 429 || statusCode >= 500;
  }

  if (
    typeof type === "string" &&
    HOSTED_STRIPE_RETRYABLE_ERROR_TYPES.has(type)
  ) {
    return true;
  }
  if (
    typeof rawType === "string" &&
    HOSTED_STRIPE_RETRYABLE_ERROR_TYPES.has(rawType)
  ) {
    return true;
  }

  return typeof code === "string" &&
    HOSTED_STRIPE_RETRYABLE_ERROR_CODES.has(code);
}

export function isHostedStripeDefinitiveRequestRejection(
  error: unknown,
): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const shouldRetry = readStripeShouldRetryDirective(error);
  if (shouldRetry !== null) {
    return !shouldRetry;
  }
  const statusCode = Reflect.get(error, "statusCode");
  if (typeof statusCode === "number") {
    return statusCode >= 400 &&
      statusCode < 500 &&
      statusCode !== 409 &&
      statusCode !== 429;
  }
  const type = Reflect.get(error, "type");
  const rawType = Reflect.get(error, "rawType");
  return type === "StripeInvalidRequestError" ||
    type === "StripeAuthenticationError" ||
    type === "StripePermissionError" ||
    rawType === "invalid_request_error" ||
    rawType === "authentication_error" ||
    rawType === "permission_error";
}

export function classifyHostedStripeFailure(
  error: unknown,
): HostedStripeFailureDisposition {
  return isHostedStripeRetryableFailure(error)
    ? {
        httpStatus: 502,
        kind: "provider_ambiguous",
        retryable: true,
      }
    : {
        httpStatus: 500,
        kind: "provider_rejected",
        retryable: false,
      };
}

export function isHostedStripeIdempotencyConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const type = Reflect.get(error, "type");
  const rawType = Reflect.get(error, "rawType");
  const code = Reflect.get(error, "code");
  if (code === "idempotency_key_in_use") {
    return false;
  }
  return type === "StripeIdempotencyError" ||
    rawType === "idempotency_error" ||
    code === "idempotency_error";
}

function readExpandedStripeCustomer(
  customer: Stripe.Subscription["customer"],
): Stripe.Customer | null {
  return customer &&
      typeof customer === "object" &&
      customer.object === "customer" &&
      Reflect.get(customer, "deleted") !== true
    ? customer as Stripe.Customer
    : null;
}

function buildHostedStripeTenderFromId(
  tender: HostedStripeTender,
): HostedStripeTender | null {
  return isHostedStripeTenderIdValid(tender) ? tender : null;
}

function assertHostedStripeTenderId(tender: HostedStripeTender): void {
  if (!isHostedStripeTenderIdValid(tender)) {
    throw new TypeError(
      `Stripe ${tender.kind} tender has an unsupported object identifier.`,
    );
  }
}

function isHostedStripeTenderIdValid(tender: HostedStripeTender): boolean {
  return tender.kind === "payment_method"
    ? tender.id.startsWith("pm_")
    : tender.id.startsWith("card_") || tender.id.startsWith("src_");
}

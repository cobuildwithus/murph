import { describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

import {
  buildHostedStripeSubscriptionMutationScope,
  buildHostedStripeTenderSubscriptionUpdate,
  classifyHostedStripeFailure,
  classifyHostedStripeInvoiceCollectionState,
  isHostedStripeDefinitiveRequestRejection,
  isHostedStripeIdempotencyConflict,
  isHostedStripeLegacyCheckoutCompletionAllowed,
  isHostedStripeRetryableFailure,
  isHostedStripeTenderAppliedToSubscription,
  readHostedStripeBillingAttemptTender,
  readHostedStripeSubscriptionTender,
  retrieveHostedStripeInvoiceCollectionSnapshot,
} from "@/src/lib/hosted-onboarding/stripe-billing-state";

describe("Stripe billing state", () => {
  test("bounds legacy Checkout completion to safe Session and webhook timestamps", () => {
    const sessionCreated = 1_800_000_000;
    const sessionExpiresAt = sessionCreated + 24 * 60 * 60;
    const finalWebhookDeliveryAt =
      sessionExpiresAt + 3 * 24 * 60 * 60;

    expect(isHostedStripeLegacyCheckoutCompletionAllowed({
      observedAt: new Date(finalWebhookDeliveryAt * 1_000),
      sessionCreated,
      sessionExpiresAt,
    })).toBe(true);
    expect(isHostedStripeLegacyCheckoutCompletionAllowed({
      observedAt: new Date(finalWebhookDeliveryAt * 1_000 + 1),
      sessionCreated,
      sessionExpiresAt,
    })).toBe(false);
    expect(isHostedStripeLegacyCheckoutCompletionAllowed({
      observedAt: new Date(sessionCreated * 1_000),
      sessionCreated,
      sessionExpiresAt: sessionExpiresAt + 1,
    })).toBe(false);
    expect(isHostedStripeLegacyCheckoutCompletionAllowed({
      observedAt: new Date((sessionCreated - 1) * 1_000),
      sessionCreated,
      sessionExpiresAt,
    })).toBe(false);
    expect(isHostedStripeLegacyCheckoutCompletionAllowed({
      observedAt: new Date(Number.NaN),
      sessionCreated,
      sessionExpiresAt,
    })).toBe(false);
  });

  test("keeps PaymentMethods and legacy Sources typed separately", () => {
    expect(readHostedStripeSubscriptionTender(makeSubscription({
      customerDefaultPaymentMethod: "pm_customer",
    }))).toEqual({ id: "pm_customer", kind: "payment_method" });
    expect(buildHostedStripeTenderSubscriptionUpdate({
      id: "pm_customer",
      kind: "payment_method",
    })).toEqual({ default_payment_method: "pm_customer" });
    expect(readHostedStripeSubscriptionTender(makeSubscription({
      customerDefaultSource: "card_customer",
    }))).toEqual({ id: "card_customer", kind: "legacy_source" });
    expect(buildHostedStripeTenderSubscriptionUpdate({
      id: "card_customer",
      kind: "legacy_source",
    })).toEqual({ default_source: "card_customer" });
    expect(isHostedStripeTenderAppliedToSubscription({
      subscription: makeSubscription({
        defaultPaymentMethod: "pm_customer",
      }),
      tender: {
        id: "pm_customer",
        kind: "payment_method",
      },
    })).toBe(true);
  });

  test("fails closed on malformed tender fields and preserves Stripe precedence", () => {
    expect(readHostedStripeSubscriptionTender(makeSubscription({
      customerDefaultPaymentMethod: "pm_customer",
      defaultPaymentMethod: "card_wrong_field",
      defaultSource: "card_subscription",
    }))).toBeNull();
    expect(readHostedStripeSubscriptionTender(makeSubscription({
      customerDefaultPaymentMethod: "pm_customer",
      defaultPaymentMethod: "pm_subscription",
      defaultSource: "card_subscription",
    }))).toEqual({
      id: "pm_subscription",
      kind: "payment_method",
    });
    expect(readHostedStripeSubscriptionTender(makeSubscription({
      customerDefaultPaymentMethod: "pm_customer",
      defaultSource: "card_subscription",
    }))).toEqual({
      id: "card_subscription",
      kind: "legacy_source",
    });
    expect(readHostedStripeSubscriptionTender(makeSubscription({
      customerDefaultPaymentMethod: "card_wrong_field",
      customerDefaultSource: "card_customer",
    }))).toBeNull();

    expect(() => buildHostedStripeTenderSubscriptionUpdate({
      id: "src_wrong_field",
      kind: "payment_method",
    })).toThrow(TypeError);
    expect(() => buildHostedStripeTenderSubscriptionUpdate({
      id: "pm_wrong_field",
      kind: "legacy_source",
    })).toThrow(TypeError);
  });

  test("preserves a subscription override unless payment recovery confirmed the customer default", () => {
    const subscription = makeSubscription({
      customerDefaultPaymentMethod: "pm_customer_current",
      defaultPaymentMethod: "pm_subscription_old",
    });
    expect(readHostedStripeBillingAttemptTender(subscription, {
      customerDefaultConfirmed: false,
    })).toEqual({
      id: "pm_subscription_old",
      kind: "payment_method",
    });
    expect(readHostedStripeBillingAttemptTender(subscription, {
      customerDefaultConfirmed: true,
    })).toEqual({
      id: "pm_customer_current",
      kind: "payment_method",
    });
    expect(readHostedStripeBillingAttemptTender(makeSubscription({
      customerDefaultPaymentMethod: null,
      customerDefaultSource: "card_customer_current",
      defaultPaymentMethod: "pm_subscription_old",
    }), {
      customerDefaultConfirmed: true,
    })).toEqual({
      id: "card_customer_current",
      kind: "legacy_source",
    });
    expect(readHostedStripeBillingAttemptTender(makeSubscription({
      customerDefaultPaymentMethod: "card_wrong_field",
      customerDefaultSource: "card_customer_current",
      defaultPaymentMethod: "pm_subscription_old",
    }), {
      customerDefaultConfirmed: true,
    })).toBeNull();
  });

  test("classifies action-required and terminal invoices explicitly", () => {
    expect(classifyHostedStripeInvoiceCollectionState(makeInvoice({
      status: "open",
    }), [
      makeInvoicePayment({ paymentIntentStatus: "requires_action" }),
    ])).toMatchObject({
      advancingEvent: "invoice.paid",
      deadlineUnixSeconds: 1_800_086_400,
      invoiceId: "in_123",
      invoicePaymentId: "inpay_123",
      kind: "payment_required",
      paymentIntentId: "pi_123",
      paymentUrl: "https://billing.stripe.test/invoice",
    });
    expect(classifyHostedStripeInvoiceCollectionState(makeInvoice({
      status: "void",
    }))).toMatchObject({
      invoiceId: "in_123",
      kind: "voided",
    });
    expect(classifyHostedStripeInvoiceCollectionState(makeInvoice({
      status: "uncollectible",
    }))).toMatchObject({
      invoiceId: "in_123",
      kind: "uncollectible",
    });
  });

  test("fails closed on capture-only, finalization, and ambiguous payment states", () => {
    expect(classifyHostedStripeInvoiceCollectionState(makeInvoice({
      status: "open",
    }), [
      makeInvoicePayment({ paymentIntentStatus: "requires_capture" }),
    ])).toMatchObject({
      invoiceId: "in_123",
      kind: "failed",
      paymentIntentId: "pi_123",
      reason: "payment_intent_requires_capture",
    });

    expect(classifyHostedStripeInvoiceCollectionState(makeInvoice({
      finalizationErrorCode: "invoice_no_payment_method_types",
      status: "draft",
    }))).toMatchObject({
      invoiceId: "in_123",
      kind: "failed",
      reason: "invoice_no_payment_method_types",
    });

    expect(classifyHostedStripeInvoiceCollectionState(makeInvoice({
      status: "open",
    }), [
      makeInvoicePayment({
        id: "inpay_first",
        isDefault: false,
        paymentIntentStatus: "requires_action",
      }),
      makeInvoicePayment({
        id: "inpay_second",
        isDefault: false,
        paymentIntentStatus: "processing",
      }),
    ])).toMatchObject({
      invoiceId: "in_123",
      invoicePaymentId: null,
      kind: "failed",
      paymentIntentId: null,
      reason: "ambiguous_invoice_payments",
    });

    expect(classifyHostedStripeInvoiceCollectionState(makeInvoice({
      status: "open",
    }), [
      makeInvoicePayment({
        id: "inpay_old",
        isDefault: false,
        paymentIntentStatus: "requires_payment_method",
      }),
      makeInvoicePayment({
        id: "inpay_current",
        isDefault: true,
        paymentIntentStatus: "requires_action",
      }),
    ])).toMatchObject({
      invoicePaymentId: "inpay_current",
      kind: "payment_required",
      paymentIntentId: "pi_inpay_current",
    });

    const defaultPaymentRecord: Stripe.InvoicePayment = {
      ...makeInvoicePayment({
        id: "inpay_record",
        isDefault: true,
        paymentIntentStatus: "processing",
      }),
      payment: {
        payment_record: "pr_123",
        type: "payment_record",
      },
    };
    expect(classifyHostedStripeInvoiceCollectionState(makeInvoice({
      status: "open",
    }), [
      makeInvoicePayment({
        id: "inpay_nondefault_intent",
        isDefault: false,
        paymentIntentStatus: "processing",
      }),
      defaultPaymentRecord,
    ])).toMatchObject({
      invoicePaymentId: "inpay_record",
      kind: "payment_required",
      paymentIntentId: null,
    });
  });

  test("honors terminal paid state even when split payments have no unique default", () => {
    expect(classifyHostedStripeInvoiceCollectionState(makeInvoice({
      status: "paid",
    }), [
      makeInvoicePayment({
        id: "inpay_first",
        isDefault: false,
        paymentIntentStatus: "succeeded",
      }),
      makeInvoicePayment({
        id: "inpay_second",
        isDefault: false,
        paymentIntentStatus: "succeeded",
      }),
    ])).toEqual({
      invoiceId: "in_123",
      invoicePaymentId: null,
      kind: "paid",
      paymentIntentId: null,
    });
  });

  test("retrieves canonical InvoicePayments instead of relying on obsolete invoice fields", async () => {
    const invoice = makeInvoice({ status: "open" });
    const invoicePayment = makeInvoicePayment({
      paymentIntentStatus: "requires_payment_method",
    });
    const stripe = {
      invoicePayments: {
        list: vi.fn().mockResolvedValue({
          data: [invoicePayment],
          has_more: false,
        }),
      },
      invoices: {
        retrieve: vi.fn().mockResolvedValue(invoice),
      },
    } satisfies Parameters<
      typeof retrieveHostedStripeInvoiceCollectionSnapshot
    >[0]["stripe"];

    await expect(retrieveHostedStripeInvoiceCollectionSnapshot({
      invoiceId: "in_123",
      stripe,
    })).resolves.toEqual({
      invoice,
      invoicePayments: [invoicePayment],
    });
    expect(stripe.invoicePayments.list).toHaveBeenCalledWith({
      expand: ["data.payment.payment_intent"],
      invoice: "in_123",
      limit: 100,
    });
  });

  test("fails closed when Stripe returns a different invoice than requested", async () => {
    const stripe = {
      invoicePayments: {
        list: vi.fn().mockResolvedValue({
          data: [],
          has_more: false,
        }),
      },
      invoices: {
        retrieve: vi.fn().mockResolvedValue({
          ...makeInvoice({ status: "paid" }),
          id: "in_other",
        }),
      },
    } satisfies Parameters<
      typeof retrieveHostedStripeInvoiceCollectionSnapshot
    >[0]["stripe"];

    const error = await retrieveHostedStripeInvoiceCollectionSnapshot({
      invoiceId: "in_123",
      stripe,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TypeError);
    if (!(error instanceof Error)) {
      throw new Error("Expected a collection-state TypeError.");
    }
    expect(error.message).toBe(
      "Stripe returned the wrong invoice for a collection-state read.",
    );
    expect(error.message).not.toContain("in_123");
    expect(error.message).not.toContain("in_other");
  });

  test("mutation scope changes when a pending attempt expires", () => {
    const pendingInvoice = makeInvoice({ status: "open" });
    const pending = makeSubscription({
      latestInvoice: pendingInvoice,
      pendingUpdate: {
        billing_cycle_anchor: null,
        expires_at: 1_800_000_000,
        subscription_items: [makeSubscriptionItem("price_edge")],
        trial_end: null,
        trial_from_plan: false,
      },
    });
    const expired = makeSubscription({
      latestInvoice: makeInvoice({ status: "void" }),
      pendingUpdate: null,
    });

    const firstScope = buildHostedStripeSubscriptionMutationScope(pending, {
      invoice: pendingInvoice,
      invoicePayments: [
        makeInvoicePayment({ paymentIntentStatus: "requires_action" }),
      ],
    });
    expect(firstScope).toBe(buildHostedStripeSubscriptionMutationScope(pending, {
      invoice: pendingInvoice,
      invoicePayments: [
        makeInvoicePayment({ paymentIntentStatus: "requires_action" }),
      ],
    }));
    expect(firstScope).not.toBe(
      buildHostedStripeSubscriptionMutationScope(expired, {
        invoice: makeInvoice({ status: "void" }),
        invoicePayments: [],
      }),
    );
  });

  test("mutation scope rotates when invoice finalization becomes terminal", () => {
    const pendingInvoice = makeInvoice({ status: "draft" });
    const failedInvoice = makeInvoice({
      finalizationErrorCode: "invoice_no_payment_method_types",
      status: "draft",
    });
    const subscription = makeSubscription({
      latestInvoice: pendingInvoice,
    });

    const pendingScope = buildHostedStripeSubscriptionMutationScope(
      subscription,
      {
        invoice: pendingInvoice,
        invoicePayments: [],
      },
    );
    const failedScope = buildHostedStripeSubscriptionMutationScope(
      subscription,
      {
        invoice: failedInvoice,
        invoicePayments: [],
      },
    );

    expect(failedScope).not.toBe(pendingScope);
    expect(failedScope).toBe(buildHostedStripeSubscriptionMutationScope(
      subscription,
      {
        invoice: failedInvoice,
        invoicePayments: [],
      },
    ));
  });

  test("only ambiguous provider failures are retryable", () => {
    expect(isHostedStripeRetryableFailure({ statusCode: 500 })).toBe(true);
    expect(isHostedStripeRetryableFailure({
      code: "idempotency_key_in_use",
      type: "StripeIdempotencyError",
    })).toBe(true);
    expect(isHostedStripeIdempotencyConflict({
      code: "idempotency_key_in_use",
      type: "StripeIdempotencyError",
    })).toBe(false);
    expect(isHostedStripeRetryableFailure({
      code: "idempotency_error",
      statusCode: 400,
      type: "StripeIdempotencyError",
    })).toBe(false);
    expect(isHostedStripeIdempotencyConflict({
      code: "idempotency_error",
      statusCode: 400,
      type: "StripeIdempotencyError",
    })).toBe(true);
    expect(isHostedStripeDefinitiveRequestRejection({
      code: "idempotency_key_in_use",
      headers: { "stripe-should-retry": "false" },
      statusCode: 409,
      type: "StripeIdempotencyError",
    })).toBe(false);
    expect(isHostedStripeDefinitiveRequestRejection({
      headers: { "stripe-should-retry": "false" },
      statusCode: 503,
      type: "StripeAPIError",
    })).toBe(false);
    expect(isHostedStripeDefinitiveRequestRejection({
      headers: { "stripe-should-retry": "false" },
      statusCode: 400,
      type: "StripeInvalidRequestError",
    })).toBe(true);
    expect(isHostedStripeRetryableFailure({
      statusCode: 400,
      type: "StripeInvalidRequestError",
    })).toBe(false);
    expect(classifyHostedStripeFailure({
      statusCode: 500,
      type: "StripeAPIError",
    })).toEqual({
      httpStatus: 502,
      kind: "provider_ambiguous",
      retryable: true,
    });
    expect(classifyHostedStripeFailure({
      statusCode: 400,
      type: "StripeInvalidRequestError",
    })).toEqual({
      httpStatus: 500,
      kind: "provider_rejected",
      retryable: false,
    });
  });
});

function makeSubscription(input: {
  customerDefaultPaymentMethod?: string | null;
  customerDefaultSource?: string | null;
  defaultPaymentMethod?: string | null;
  defaultSource?: string | null;
  latestInvoice?: Stripe.Invoice | null;
  pendingUpdate?: Stripe.Subscription["pending_update"];
} = {}): Stripe.Subscription {
  return {
    cancel_at: null,
    cancel_at_period_end: false,
    customer: {
      default_source: input.customerDefaultSource ?? null,
      id: "cus_123",
      invoice_settings: {
        custom_fields: null,
        default_payment_method: input.customerDefaultPaymentMethod ?? null,
        footer: null,
        rendering_options: null,
      },
      livemode: false,
      metadata: {},
      object: "customer",
    } as Stripe.Customer,
    default_payment_method: input.defaultPaymentMethod ?? null,
    default_source: input.defaultSource ?? null,
    id: "sub_123",
    items: {
      data: [makeSubscriptionItem("price_pulse")],
      has_more: false,
      object: "list",
      url: "/v1/subscription_items?subscription=sub_123",
    },
    latest_invoice: input.latestInvoice ?? null,
    metadata: {},
    object: "subscription",
    pending_update: input.pendingUpdate ?? null,
    status: "paused",
    trial_end: null,
  } as Stripe.Subscription;
}

function makeInvoice(input: {
  finalizationErrorCode?: Stripe.Invoice.LastFinalizationError.Code;
  status: Stripe.Invoice["status"];
}): Stripe.Invoice {
  const invoice: Partial<Stripe.Invoice> = {
    amount_remaining: input.status === "paid" ? 0 : 800,
    attempted: input.status === "open",
    created: 1_800_000_000,
    hosted_invoice_url: "https://billing.stripe.test/invoice",
    id: "in_123",
    last_finalization_error: input.finalizationErrorCode
      ? {
          code: input.finalizationErrorCode,
          type: "invalid_request_error",
        }
      : null,
    object: "invoice",
    status: input.status,
  };
  return invoice as Stripe.Invoice;
}

function makeInvoicePayment(input: {
  id?: string;
  isDefault?: boolean;
  paymentIntentStatus: Stripe.PaymentIntent.Status;
}): Stripe.InvoicePayment {
  const invoicePaymentId = input.id ?? "inpay_123";
  const paymentIntent: Partial<Stripe.PaymentIntent> = {
    id: `pi_${invoicePaymentId === "inpay_123" ? "123" : invoicePaymentId}`,
    object: "payment_intent",
    status: input.paymentIntentStatus,
  };
  const invoicePayment: Partial<Stripe.InvoicePayment> = {
    id: invoicePaymentId,
    invoice: "in_123",
    is_default: input.isDefault ?? true,
    object: "invoice_payment",
    payment: {
      payment_intent: paymentIntent as Stripe.PaymentIntent,
      type: "payment_intent",
    },
    status: input.paymentIntentStatus === "succeeded" ? "paid" : "open",
  };
  return invoicePayment as Stripe.InvoicePayment;
}

function makeSubscriptionItem(priceId: string): Stripe.SubscriptionItem {
  const plan: Partial<Stripe.Plan> = {
    id: priceId,
    object: "plan",
  };
  const price: Partial<Stripe.Price> = {
    id: priceId,
    object: "price",
  };
  return {
    billing_thresholds: null,
    created: 1_800_000_000,
    current_period_end: 1_802_678_400,
    current_period_start: 1_800_000_000,
    discounts: [],
    id: "si_123",
    metadata: {},
    object: "subscription_item",
    plan: plan as Stripe.Plan,
    price: price as Stripe.Price,
    quantity: 1,
    subscription: "sub_123",
    tax_rates: null,
  };
}

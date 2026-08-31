import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import {
  resolveHostedStripePaymentNotificationCandidate,
  sendHostedStripePaymentNotificationEmail,
} from "@/src/lib/hosted-onboarding/stripe-payment-notification-email";

const PAYMENT_EMAIL_ENV = {
  HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.com>",
  HOSTED_LINQ_ALERT_EMAILS: "operator@example.com",
  RESEND_API_KEY: "re_test",
};
type PaymentEmailSend = NonNullable<
  Parameters<typeof sendHostedStripePaymentNotificationEmail>[0]["sendEmail"]
>;

describe("hosted Stripe payment notification email", () => {
  it.each([
    ["subscription_create", "subscription_create"],
    ["subscription_threshold", "subscription_threshold"],
    ["subscription_update", "subscription_update"],
    [null, "invoice"],
  ] as const)(
    "classifies a positive invoice.paid with billing reason %s",
    (billingReason, expectedCategory) => {
      expect(resolveHostedStripePaymentNotificationCandidate({
        event: makeInvoicePaidEvent({ billingReason }),
        usageCreditEventHandled: false,
      })).toMatchObject({
        amountMinor: 800,
        category: expectedCategory,
        currency: "usd",
        eventId: "evt_invoice_paid_123",
        eventType: "invoice.paid",
        livemode: true,
        occurredAt: new Date("2026-04-27T20:00:00.000Z"),
      });
    },
  );

  it("ignores a paid subscription renewal", () => {
    expect(resolveHostedStripePaymentNotificationCandidate({
      event: makeInvoicePaidEvent({ billingReason: "subscription_cycle" }),
      usageCreditEventHandled: false,
    })).toBeNull();
  });

  it.each([0, -1, null])(
    "ignores a non-positive invoice amount %s",
    (amountPaid) => {
      expect(resolveHostedStripePaymentNotificationCandidate({
        event: makeInvoicePaidEvent({ amountPaid }),
        usageCreditEventHandled: false,
      })).toBeNull();
    },
  );

  it.each([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
  ] as const)("accepts a fulfilled usage-credit %s payment", (eventType) => {
    const event = makeStripeEvent({
      amount_total: 1000,
      currency: "usd",
      id: "cs_usage_123",
      mode: "payment",
      payment_status: "paid",
    }, eventType, "evt_checkout_paid_123");

    expect(resolveHostedStripePaymentNotificationCandidate({
      event,
      usageCreditEventHandled: true,
    })).toMatchObject({
      amountMinor: 1000,
      category: "usage_credit",
      eventId: "evt_checkout_paid_123",
    });
    expect(resolveHostedStripePaymentNotificationCandidate({
      event,
      usageCreditEventHandled: false,
    })).toBeNull();
    expect(resolveHostedStripePaymentNotificationCandidate({
      event: makeStripeEvent({
        amount_total: 1000,
        currency: "usd",
        id: "cs_usage_unpaid_123",
        mode: "payment",
        payment_status: "unpaid",
      }, "checkout.session.completed", "evt_checkout_unpaid_123"),
      usageCreditEventHandled: true,
    })).toBeNull();
  });

  it("accepts only a fulfilled usage-credit saved-card payment", () => {
    const event = makeStripeEvent({
      amount_received: 2500,
      currency: "usd",
      id: "pi_usage_123",
      status: "succeeded",
    }, "payment_intent.succeeded", "evt_payment_intent_paid_123");

    expect(resolveHostedStripePaymentNotificationCandidate({
      event,
      usageCreditEventHandled: true,
    })).toMatchObject({
      amountMinor: 2500,
      category: "usage_credit",
      eventId: "evt_payment_intent_paid_123",
    });
    expect(resolveHostedStripePaymentNotificationCandidate({
      event,
      usageCreditEventHandled: false,
    })).toBeNull();
  });

  it("sends a stable metadata-only operator email", async () => {
    const sendEmail = vi.fn<PaymentEmailSend>(async () => ({
      providerMessageId: "email_123",
    }));
    const candidate = resolveHostedStripePaymentNotificationCandidate({
      event: makeInvoicePaidEvent({
        customer: "cus_private_customer",
        customerEmail: "private-member@example.com",
      }),
      usageCreditEventHandled: false,
    });
    expect(candidate).not.toBeNull();

    await expect(sendHostedStripePaymentNotificationEmail({
      candidate: candidate!,
      env: PAYMENT_EMAIL_ENV,
      sendEmail,
    })).resolves.toBe("sent");
    await sendHostedStripePaymentNotificationEmail({
      candidate: candidate!,
      env: PAYMENT_EMAIL_ENV,
      sendEmail,
    });

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const first = sendEmail.mock.calls[0]?.[0];
    expect(sendEmail.mock.calls[1]?.[0]).toEqual(first);
    expect(first).toMatchObject({
      idempotencyKey: expect.stringMatching(
        /^hosted-stripe-payment\/[a-f0-9]{64}$/u,
      ),
      subject: "Murph payment received — USD 8.00",
      to: ["operator@example.com"],
    });
    expect(first?.text).toContain("category: new subscription");
    expect(first?.text).toContain("Stripe event id: evt_invoice_paid_123");
    expect(first?.text).toContain("mode: live");
    expect(first?.text).not.toContain("cus_private_customer");
    expect(first?.text).not.toContain("private-member@example.com");
  });

  it("keeps delivery pending when operational email is unconfigured", async () => {
    await expect(sendHostedStripePaymentNotificationEmail({
      candidate: resolveHostedStripePaymentNotificationCandidate({
        event: makeInvoicePaidEvent(),
        usageCreditEventHandled: false,
      })!,
      env: {},
      sendEmail: vi.fn(),
    })).rejects.toThrow(
      "Hosted Stripe payment notification email is not configured.",
    );
  });
});

function makeInvoicePaidEvent(overrides?: {
  amountPaid?: number | null;
  billingReason?:
    | "subscription_create"
    | "subscription_cycle"
    | "subscription_threshold"
    | "subscription_update"
    | null;
  customer?: string;
  customerEmail?: string;
}): Stripe.Event {
  return makeStripeEvent({
    amount_paid: overrides?.amountPaid === undefined ? 800 : overrides.amountPaid,
    billing_reason: overrides?.billingReason === undefined
      ? "subscription_create"
      : overrides.billingReason,
    currency: "usd",
    customer: overrides?.customer ?? "cus_123",
    customer_email: overrides?.customerEmail ?? "member@example.com",
    id: "in_123",
  }, "invoice.paid", "evt_invoice_paid_123");
}

function makeStripeEvent(
  object: Record<string, unknown>,
  type: Stripe.Event.Type,
  id: string,
): Stripe.Event {
  return {
    api_version: "2025-03-31.basil",
    created: 1_777_320_000,
    data: { object },
    id,
    livemode: true,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type,
  } as unknown as Stripe.Event;
}

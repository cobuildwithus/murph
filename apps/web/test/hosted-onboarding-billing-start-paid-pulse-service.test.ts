import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

import {
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY,
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
} from "@/src/lib/hosted-onboarding/legacy-usage-price";

const mocks = vi.hoisted(() => ({
  applyStripeInvoicePaid: vi.fn(),
  getPrisma: vi.fn(),
  signalHostedRuntimeManualWakeBestEffort: vi.fn(),
  prismaClient: {
    $transaction: vi.fn(),
  },
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedOnboardingPublicBaseUrl: vi.fn(),
  requireHostedStripeBillingPlanConfig: vi.fn(),
  stripe: {
    billingPortal: {
      sessions: {
        create: vi.fn(),
      },
    },
    subscriptions: {
      retrieve: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-orchestration/manual-wake", () => ({
  signalHostedRuntimeManualWakeBestEffort: mocks.signalHostedRuntimeManualWakeBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingPublicBaseUrl: mocks.requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeBillingPlanConfig: mocks.requireHostedStripeBillingPlanConfig,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", () => ({
  applyStripeInvoicePaid: mocks.applyStripeInvoicePaid,
}));

import {
  startHostedPulseTrialPaidPlan,
} from "@/src/lib/hosted-onboarding/billing-start-paid-pulse-service";

describe("startHostedPulseTrialPaidPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.prismaClient.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(mocks.prismaClient)
    );
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(makeBillingRef());
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.requireHostedStripeBillingPlanConfig.mockReturnValue({
      billingPlanCode: "launch_monthly",
      priceId: "price_pulse_recurring",
      stripe: mocks.stripe,
    });
    mocks.stripe.billingPortal.sessions.create.mockResolvedValue({
      url: "https://billing.stripe.test/session_123",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeSubscription());
    mocks.stripe.subscriptions.update.mockResolvedValue(makeSubscription({
      latestInvoice: makeInvoice({
        status: "draft",
      }),
      status: "active",
      trialEnd: null,
    }));
  });

  test("ends an active Pulse trial with allow_incomplete and returns billing_pending while Stripe is settling", async () => {
    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123", {
      expand: ["customer", "items.data.price", "latest_invoice", "latest_invoice.payment_intent"],
    });
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      {
        expand: ["customer", "items.data.price", "latest_invoice", "latest_invoice.payment_intent"],
        payment_behavior: "allow_incomplete",
        trial_end: "now",
      },
      {
        idempotencyKey: expect.stringMatching(/^hosted-billing-start-paid-pulse:[a-f0-9]{64}$/u),
      },
    );
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
  });

  test("routes no-card trials through Stripe payment-method setup before ending the trial", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: null,
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://billing.stripe.test/session_123",
      status: "payment_required",
    });

    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_123",
      flow_data: {
        after_completion: {
          redirect: {
            return_url: "https://join.example.test/home",
          },
          type: "redirect",
        },
        type: "payment_method_update",
      },
      return_url: "https://join.example.test/home",
    });
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("uses the expanded customer default payment method before requiring payment setup", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: makeCustomer({
        defaultPaymentMethod: "pm_customer_123",
        defaultSource: null,
      }),
      defaultPaymentMethod: null,
      defaultSource: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        payment_behavior: "allow_incomplete",
        trial_end: "now",
      }),
      expect.any(Object),
    );
  });

  test("rejects manual invoice collection before starting paid billing", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      collectionMethod: "send_invoice",
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_COLLECTION_METHOD_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test.each([
    "keep_as_draft",
    "mark_uncollectible",
    "void",
  ] as const)("rejects paused collection with %s before starting paid billing", async (behavior) => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      pauseCollection: {
        behavior,
        resumes_at: null,
      },
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_COLLECTION_PAUSED",
      httpStatus: 409,
    });

    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("returns payment_required for a retry after failed payment without requiring active access", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.past_due,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      latestInvoice: makeInvoice({
        hostedInvoiceUrl: "https://invoice.stripe.test/in_123",
        paymentIntentStatus: "requires_action",
        status: "open",
      }),
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.test/in_123",
      status: "payment_required",
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
  });

  test("rejects payment recovery when the latest invoice customer mismatches", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.past_due,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      latestInvoice: makeInvoice({
        customer: "cus_other",
        hostedInvoiceUrl: "https://invoice.stripe.test/in_123",
        paymentIntentStatus: "requires_action",
        status: "open",
      }),
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_CUSTOMER_MISMATCH",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("rejects payment recovery before returning invoice URLs for unsupported item shapes", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: HostedBillingStatus.past_due,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: null,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
        makeSubscriptionItem({
          priceId: "price_unknown_addon",
          quantity: 1,
          usageType: "licensed",
        }),
      ],
      latestInvoice: makeInvoice({
        hostedInvoiceUrl: "https://invoice.stripe.test/in_123",
        paymentIntentStatus: "requires_action",
        status: "open",
      }),
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("reconciles a paid trial-conversion invoice with the webhook source type before returning started", async () => {
    const invoice = makeInvoice({
      status: "paid",
    });
    const subscription = makeSubscription({
      latestInvoice: invoice,
      status: "active",
      trialEnd: null,
    });
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(subscription);
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(makeBillingRef())
      .mockResolvedValueOnce(makeBillingRef({
        currentBillingPhase: "paid",
      }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "started",
    });

    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledWith(
      invoice,
      expect.objectContaining({
        sourceEventId: "stripe.invoice.paid:in_123",
        sourceType: "stripe.invoice.paid",
      }),
      mocks.prismaClient,
      HostedBillingStatus.active,
      subscription,
    );
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).toHaveBeenCalledWith({
      userId: "member_123",
    });
  });

  test("rejects payment-required invoices without a hosted payment URL", async () => {
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      latestInvoice: makeInvoice({
        hostedInvoiceUrl: null,
        paymentIntentStatus: "requires_payment_method",
        status: "open",
      }),
      status: "active",
      trialEnd: null,
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_PAYMENT_URL_MISSING",
      httpStatus: 409,
    });
  });

  test("drops legacy metered usage items when ending the trial", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
        makeSubscriptionItem({
          priceId: "price_pulse_usage",
          quantity: null,
          usageType: "metered",
        }),
      ],
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        items: [
          {
            deleted: true,
            id: "si_price_pulse_usage",
          },
        ],
      }),
      expect.any(Object),
    );
  });

  test("rejects metered usage items with unsupported quantities", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
        makeSubscriptionItem({
          priceId: "price_pulse_usage",
          quantity: 1,
          usageType: "metered",
        }),
      ],
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("rejects unmarked no-quantity metered items", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
        makeSubscriptionItem({
          priceId: "price_unknown_usage",
          quantity: null,
          usageType: "metered",
        }),
      ],
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_START_PAID_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("accepts a single recurring Pulse item", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
      ],
    }));

    await expect(startHostedPulseTrialPaidPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalled();
  });
});

function makeBillingRef(input: {
  currentBillingPhase?: string | null;
} = {}) {
  return {
    currentBillingPhase: input.currentBillingPhase === undefined ? "trial" : input.currentBillingPhase,
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: "pulse_trial_7d",
    currentTrialEndsAt: new Date("2026-05-13T00:00:00.000Z"),
    memberId: "member_123",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
  };
}

function makeSubscription(input: {
  collectionMethod?: Stripe.Subscription["collection_method"];
  customer?: Stripe.Subscription["customer"];
  defaultPaymentMethod?: string | null;
  defaultSource?: string | null;
  items?: Stripe.SubscriptionItem[];
  latestInvoice?: Stripe.Invoice | null;
  pauseCollection?: Stripe.Subscription["pause_collection"];
  status?: Stripe.Subscription.Status;
  trialEnd?: number | null;
} = {}): Stripe.Subscription {
  return {
    cancel_at_period_end: false,
    collection_method: input.collectionMethod ?? "charge_automatically",
    customer: input.customer ?? "cus_123",
    default_payment_method: input.defaultPaymentMethod === undefined
      ? "pm_123"
      : input.defaultPaymentMethod,
    default_source: input.defaultSource ?? null,
    id: "sub_123",
    items: {
      data: input.items ?? [
        makeSubscriptionItem({
          priceId: "price_pulse_recurring",
          quantity: 1,
          usageType: "licensed",
        }),
      ],
    },
    latest_invoice: input.latestInvoice ?? null,
    object: "subscription",
    pause_collection: input.pauseCollection ?? null,
    pending_update: null,
    schedule: null,
    status: input.status ?? "trialing",
    trial_end: input.trialEnd === undefined ? 1_778_428_800 : input.trialEnd,
  } as unknown as Stripe.Subscription;
}

function makeCustomer(input: {
  defaultPaymentMethod?: string | null;
  defaultSource?: string | null;
} = {}): Stripe.Customer {
  return {
    default_source: input.defaultSource ?? null,
    id: "cus_123",
    invoice_settings: {
      default_payment_method: input.defaultPaymentMethod === undefined
        ? "pm_123"
        : input.defaultPaymentMethod,
    },
    object: "customer",
  } as unknown as Stripe.Customer;
}

function makeSubscriptionItem(input: {
  priceId: string;
  quantity: number | null;
  usageType: Stripe.Price.Recurring.UsageType;
}): Stripe.SubscriptionItem {
  return {
    id: `si_${input.priceId}`,
    object: "subscription_item",
    price: {
      id: input.priceId,
      metadata: input.priceId === "price_pulse_usage"
        ? {
            [HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY]:
              HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
          }
        : {},
      object: "price",
      recurring: {
        interval: "month",
        usage_type: input.usageType,
      },
    },
    quantity: input.quantity,
  } as unknown as Stripe.SubscriptionItem;
}

function makeInvoice(input: {
  customer?: string;
  hostedInvoiceUrl?: string | null;
  paymentIntentStatus?: Stripe.PaymentIntent.Status | null;
  status: Stripe.Invoice.Status;
}): Stripe.Invoice {
  return {
    amount_remaining: input.status === "open" ? 800 : 0,
    attempted: input.status === "open",
    billing_reason: "subscription_cycle",
    customer: input.customer ?? "cus_123",
    hosted_invoice_url: input.hostedInvoiceUrl === undefined
      ? "https://invoice.stripe.test/in_123"
      : input.hostedInvoiceUrl,
    id: "in_123",
    object: "invoice",
    payment_intent: input.paymentIntentStatus
      ? {
          id: "pi_123",
          object: "payment_intent",
          status: input.paymentIntentStatus,
        }
      : null,
    status: input.status,
    subscription: "sub_123",
  } as unknown as Stripe.Invoice;
}

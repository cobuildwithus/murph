import { HostedBillingStatus, HostedStripeEventStatus, Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";

const mocks = vi.hoisted(() => ({
  applyStripeCheckoutCompleted: vi.fn(),
  applyStripeCheckoutExpired: vi.fn(),
  applyStripeDisputeUpdated: vi.fn(),
  applyStripeInvoicePaid: vi.fn(),
  applyStripeInvoicePaymentFailed: vi.fn(),
  applyStripeRefundCreated: vi.fn(),
  applyStripeSubscriptionUpdated: vi.fn(),
  clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx: vi.fn(),
  refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx: vi.fn(),
  resolveStripeCustomerContext: vi.fn(),
  sendHostedSignupWelcomeEmailForMember: vi.fn(),
  stripe: {
    events: {
      retrieve: vi.fn(),
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
  },
}));

vi.mock("@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service", () => ({
  clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx:
    mocks.clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx,
  refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx:
    mocks.refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", () => ({
  applyStripeCheckoutCompleted: mocks.applyStripeCheckoutCompleted,
  applyStripeCheckoutExpired: mocks.applyStripeCheckoutExpired,
  applyStripeDisputeUpdated: mocks.applyStripeDisputeUpdated,
  applyStripeInvoicePaid: mocks.applyStripeInvoicePaid,
  applyStripeInvoicePaymentFailed: mocks.applyStripeInvoicePaymentFailed,
  applyStripeRefundCreated: mocks.applyStripeRefundCreated,
  applyStripeSubscriptionUpdated: mocks.applyStripeSubscriptionUpdated,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-lookup")
  >("@/src/lib/hosted-onboarding/stripe-billing-lookup");

  return {
    ...actual,
    resolveStripeCustomerContext: mocks.resolveStripeCustomerContext,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/runtime")
  >("@/src/lib/hosted-onboarding/runtime");

  return {
    ...actual,
    requireHostedStripeApi: () => mocks.stripe,
  };
});

vi.mock("@/src/lib/hosted-onboarding/signup-welcome-email", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/signup-welcome-email")
  >("@/src/lib/hosted-onboarding/signup-welcome-email");

  return {
    ...actual,
    sendHostedSignupWelcomeEmailForMember: mocks.sendHostedSignupWelcomeEmailForMember,
    sendHostedSignupWelcomeEmailForMemberBestEffort:
      mocks.sendHostedSignupWelcomeEmailForMember,
  };
});

import {
  reconcileHostedStripeEventById as reconcileHostedStripeEventByIdImpl,
  recordHostedStripeEvent as recordHostedStripeEventImpl,
} from "@/src/lib/hosted-onboarding/stripe-event-reconciliation";

type HostedStripeEventRecordInput = Parameters<typeof recordHostedStripeEventImpl>[0];
type HostedStripeEventReconcileInput = Parameters<typeof reconcileHostedStripeEventByIdImpl>[0];

type StripeEventPrismaHarnessClient = {
  $transaction: <T>(callback: (tx: StripeEventPrismaHarnessClient) => Promise<T>) => Promise<T>;
  hostedStripeEvent: {
    create: ({ data }: { data: Record<string, unknown> }) => Promise<MutableStripeEventRow>;
    findMany: () => Promise<MutableStripeEventRow[]>;
    findUnique: ({ where }: { where: { eventId: string } }) => Promise<MutableStripeEventRow | null>;
    update: ({ data, where }: { data: Record<string, unknown>; where: { eventId: string } }) => Promise<MutableStripeEventRow>;
    updateMany: ({ data, where }: { data: Record<string, unknown>; where: StripeEventWhere }) => Promise<{ count: number }>;
  };
};

type StripeTestEvent<TType extends Stripe.Event.Type, TObject extends Record<string, unknown>> = {
  api_version: string;
  created: number;
  data: {
    object: TObject;
  };
  id: string;
  livemode: boolean;
  object: "event";
  pending_webhooks: number;
  request: {
    id: string | null;
    idempotency_key: string | null;
  };
  type: TType;
};

async function recordHostedStripeEvent(
  input: Omit<HostedStripeEventRecordInput, "prisma"> & { prisma: StripeEventPrismaHarnessClient },
) {
  // @ts-expect-error - the Prisma harness only implements the delegate methods this test exercises.
  return recordHostedStripeEventImpl(input);
}

async function reconcileHostedStripeEventById(
  input: Omit<HostedStripeEventReconcileInput, "prisma"> & { prisma: StripeEventPrismaHarnessClient },
) {
  // @ts-expect-error - the Prisma harness only implements the delegate methods this test exercises.
  return reconcileHostedStripeEventByIdImpl(input);
}

describe("hosted Stripe event reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.applyStripeCheckoutCompleted.mockResolvedValue({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.applyStripeCheckoutExpired.mockResolvedValue(undefined);
    mocks.applyStripeDisputeUpdated.mockResolvedValue(undefined);
    mocks.applyStripeInvoicePaid.mockResolvedValue({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "dispatch_123",
      welcomeEmailMemberId: "member_123",
    });
    mocks.applyStripeInvoicePaymentFailed.mockResolvedValue(undefined);
    mocks.applyStripeRefundCreated.mockResolvedValue(undefined);
    mocks.applyStripeSubscriptionUpdated.mockResolvedValue(undefined);
    mocks.clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx.mockResolvedValue(undefined);
    mocks.refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx.mockResolvedValue(undefined);
    mocks.resolveStripeCustomerContext.mockResolvedValue({
      customerId: null,
    });
    mocks.sendHostedSignupWelcomeEmailForMember.mockResolvedValue({
      providerMessageId: "resend_email_123",
      status: "sent",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription());
  });

  it("stores only minimal Stripe receipt state when recording an event", async () => {
    const prisma = createStripeEventPrismaHarness();

    await expect(
      recordHostedStripeEvent({
        event: makeInvoicePaidEvent(),
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      duplicate: false,
      type: "invoice.paid",
    });

    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 0,
      eventId: "evt_invoice_paid_123",
      status: HostedStripeEventStatus.pending,
      type: "invoice.paid",
    }));
    expect(prisma.rows[0]).not.toHaveProperty("payloadJson");
    expect(prisma.rows[0]).not.toHaveProperty("customerId");
    expect(prisma.rows[0]).not.toHaveProperty("subscriptionId");
  });

  it("retrieves the live Stripe event during reconciliation and marks the receipt completed", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      eventId: "evt_invoice_paid_123",
      hostedExecutionEventId: "dispatch_123",
      status: "completed",
    });

    expect(mocks.stripe.events.retrieve).toHaveBeenCalledWith("evt_invoice_paid_123");
    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledWith(
      event.data.object,
      {
        eventCreatedAt: new Date("2026-03-28T14:40:00.000Z"),
        occurredAt: "2026-03-28T14:40:00.000Z",
        sourceEventId: "evt_invoice_paid_123",
        sourceType: "stripe.invoice.paid",
      },
      prisma.client,
      "active",
      makeCanonicalSubscription(),
    );
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123");
    expect(prisma.client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    );
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: "evt_invoice_paid_123",
      lastErrorCode: null,
      lastErrorMessage: null,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    expect(mocks.sendHostedSignupWelcomeEmailForMember).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
    });
    expect(
      mocks.sendHostedSignupWelcomeEmailForMember.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(prisma.client.hostedStripeEvent.update).mock.invocationCallOrder[0],
    );
  });

  it("routes checkout completion through the live Stripe event without activating access", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
      event.data.object,
      expect.anything(),
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.checkout.session.completed",
      }),
      null,
    );
    expect(mocks.sendHostedSignupWelcomeEmailForMember).not.toHaveBeenCalled();
  });

  it("does not send the Resend welcome when a later paid invoice has no new activation", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent({
      id: "evt_invoice_paid_renewal",
      invoiceId: "in_renewal_123",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeInvoicePaid.mockResolvedValueOnce({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.sendHostedSignupWelcomeEmailForMember).not.toHaveBeenCalled();
  });

  it("uses checkout completion as a welcome candidate so invoice-before-checkout email ordering can recover", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeCheckoutCompleted.mockResolvedValueOnce({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: "member_123",
    });

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.sendHostedSignupWelcomeEmailForMember).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
    });
  });

  it("retrieves Pulse Trial checkout subscription before opening the reconciliation transaction", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makePulseTrialCheckoutCompletedEvent();
    const subscription = makeCanonicalSubscription({
      customer: "cus_checkout",
      id: "sub_checkout_123",
      metadata: {
        checkoutOffer: "pulse_trial_7d",
      },
      status: "trialing",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(subscription);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_checkout_123");
    const transactionMock = vi.mocked(prisma.client.$transaction);
    expect(mocks.stripe.subscriptions.retrieve.mock.invocationCallOrder[0])
      .toBeLessThan(transactionMock.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
      event.data.object,
      expect.anything(),
      expect.objectContaining({
        sourceType: "stripe.checkout.session.completed",
      }),
      subscription,
    );
  });

  it("leaves welcome provider failure handling inside the centralized best-effort helper", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.sendHostedSignupWelcomeEmailForMember.mockResolvedValueOnce(undefined);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      eventId: "evt_invoice_paid_123",
      hostedExecutionEventId: "dispatch_123",
      status: "completed",
    });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      status: HostedStripeEventStatus.completed,
    }));
    expect(mocks.sendHostedSignupWelcomeEmailForMember).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
    });
  });

  it("uses the live Stripe subscription state instead of a stale subscription event payload", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "active",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      canonicalSubscription,
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.customer.subscription.updated",
      }),
      expect.anything(),
    );
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123");
  });

  it("routes subscription schedule updates to pending switch refresh only", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionScheduleEvent("subscription_schedule.updated");
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx).toHaveBeenCalledWith({
      schedule: event.data.object,
      tx: prisma.client,
    });
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });

  it.each([
    "subscription_schedule.released",
    "subscription_schedule.completed",
    "subscription_schedule.canceled",
    "subscription_schedule.aborted",
  ] as const)("routes %s to pending switch cleanup only", async (type) => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionScheduleEvent(type);
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx).toHaveBeenCalledWith({
      stripeSubscriptionScheduleId: "sched_123",
      tx: prisma.client,
    });
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });

  it.each([
    "subscription_schedule.created",
    "subscription_schedule.expiring",
  ] as const)("ignores %s for local pending switch state", async (type) => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionScheduleEvent(type);
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx).not.toHaveBeenCalled();
    expect(mocks.clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx).not.toHaveBeenCalled();
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });

  it("routes invoice.payment_failed through the live Stripe subscription instead of the stale event payload", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaymentFailedEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "past_due",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.applyStripeInvoicePaymentFailed).toHaveBeenCalledWith(
      event.data.object,
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.invoice.payment_failed",
      }),
      expect.anything(),
      HostedBillingStatus.past_due,
      canonicalSubscription,
    );
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123");
  });

  it.each([
    ["customer.subscription.paused", "paused"],
    ["customer.subscription.resumed", "active"],
  ] as const)("routes %s through the live Stripe subscription", async (type, status) => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionEvent(type);
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status,
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      canonicalSubscription,
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: `stripe.${type}`,
      }),
      expect.anything(),
    );
  });

  it("accepts subscription trial_will_end without mutating entitlement state", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionEvent("customer.subscription.trial_will_end");
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(reconcileHostedStripeEventById({ eventId: event.id, prisma: prisma.client }))
      .resolves.toMatchObject({ eventId: event.id, status: "completed" });
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });

  it("resolves refund customer context from the live Stripe event", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeRefundCreatedEvent();
    mocks.resolveStripeCustomerContext.mockResolvedValue({
      customerId: "cus_refund",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.resolveStripeCustomerContext).toHaveBeenCalledWith({
      chargeId: "ch_refund",
      paymentIntentId: "pi_refund",
    });
    expect(mocks.applyStripeRefundCreated).toHaveBeenCalledWith(
      event.data.object,
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.refund.created",
      }),
      expect.anything(),
      "cus_refund",
    );
  });

  it("marks the receipt failed when Stripe event retrieval fails", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockRejectedValue(new Error("Stripe unavailable"));

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: "evt_invoice_paid_123",
      hostedExecutionEventId: null,
      status: "failed",
    });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: "evt_invoice_paid_123",
      lastErrorCode: "Error",
      lastErrorMessage: "[redacted]",
      status: HostedStripeEventStatus.failed,
    }));
    expect(errorSpy).toHaveBeenCalledWith("Hosted Stripe event reconciliation failed.", {
      attemptCount: 1,
      errorMessage: "Stripe unavailable",
      errorName: "Error",
      eventIdSuffix: "id_123",
      eventType: "invoice.paid",
      poisoned: false,
    });
  });

  it("logs bounded Prisma diagnostics when Stripe reconciliation fails after retrieval", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeInvoicePaid.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        "Raw query failed. Code: `42P01`. Message: `relation \"missing_table\" does not exist while reading /tmp/app with token=secret`",
        {
          clientVersion: "7.5.0",
          code: "P2010",
          meta: {
            code: "42P01",
            modelName: "HostedMailboxItem",
            secretValue: "do-not-log",
            table: "missing_table",
          },
        },
      ),
    );

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toEqual({
      activatedMemberId: null,
      eventId: "evt_invoice_paid_123",
      hostedExecutionEventId: null,
      status: "failed",
    });

    expect(errorSpy).toHaveBeenCalledWith("Hosted Stripe event reconciliation failed.", {
      attemptCount: 1,
      errorCode: "P2010",
      errorName: "PrismaClientKnownRequestError",
      eventIdSuffix: "id_123",
      eventType: "invoice.paid",
      poisoned: false,
      prismaClientVersion: "7.5.0",
      prismaCode: "P2010",
      prismaMessage:
        "Raw query failed. Code: `42P01`. Message: `relation \"missing_table\" does not exist while reading <redacted-path> with token=<redacted-secret>",
      prismaMeta: {
        modelName: "HostedMailboxItem",
        table: "missing_table",
      },
    });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      lastErrorCode: "P2010",
      lastErrorMessage: "[redacted]",
      status: HostedStripeEventStatus.failed,
    }));
  });

});

function makeInvoicePaidEvent(overrides?: {
  id?: string;
  invoiceId?: string;
}): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708800,
    data: {
      object: {
        amount_paid: 2000,
        charge: "ch_123",
        currency: "usd",
        customer: "cus_123",
        id: overrides?.invoiceId ?? "in_123",
        payment_intent: "pi_123",
        subscription: "sub_123",
      },
    },
    id: overrides?.id ?? "evt_invoice_paid_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "invoice.paid",
  });
}

function makeInvoicePaymentFailedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708804,
    data: {
      object: {
        amount_due: 2000,
        charge: "ch_123",
        currency: "usd",
        customer: "cus_123",
        id: "in_123",
        payment_intent: "pi_123",
        subscription: "sub_123",
      },
    },
    id: "evt_invoice_payment_failed_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "invoice.payment_failed",
  });
}

function makeCheckoutCompletedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708801,
    data: {
      object: {
        client_reference_id: "member_123",
        customer: "cus_checkout",
        id: "cs_checkout_123",
        metadata: {
          memberId: "member_123",
        },
        subscription: "sub_checkout_123",
      },
    },
    id: "evt_checkout_completed_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "checkout.session.completed",
  });
}

function makePulseTrialCheckoutCompletedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708801,
    data: {
      object: {
        client_reference_id: "member_123",
        customer: "cus_checkout",
        id: "cs_trial_123",
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "pulse_trial_7d",
          memberId: "member_123",
          trialPolicyVersion: "pulse-trial-2026-05-05-v1",
        },
        mode: "subscription",
        status: "complete",
        subscription: "sub_checkout_123",
      },
    },
    id: "evt_trial_checkout_completed_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "checkout.session.completed",
  });
}

function makeSubscriptionUpdatedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708802,
    data: {
      object: {
        customer: "cus_subscription",
        id: "sub_123",
        metadata: {
          memberId: "member_123",
        },
        status: "past_due",
      },
    },
    id: "evt_subscription_updated_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "customer.subscription.updated",
  });
}

function makeSubscriptionEvent(
  type:
    | "customer.subscription.paused"
    | "customer.subscription.resumed"
    | "customer.subscription.trial_will_end",
): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708805,
    data: {
      object: {
        customer: "cus_subscription",
        id: "sub_123",
        metadata: {
          memberId: "member_123",
        },
        status: type === "customer.subscription.paused"
          ? "paused"
          : type === "customer.subscription.trial_will_end"
            ? "trialing"
            : "active",
      },
    },
    id: `evt_${type.replace(/\./gu, "_")}_123`,
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type,
  });
}

function makeRefundCreatedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708803,
    data: {
      object: {
        charge: "ch_refund",
        id: "re_123",
        payment_intent: "pi_refund",
      },
    },
    id: "evt_refund_created_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "refund.created",
  });
}

function makeSubscriptionScheduleEvent(
  type:
    | "subscription_schedule.created"
    | "subscription_schedule.updated"
    | "subscription_schedule.released"
    | "subscription_schedule.completed"
    | "subscription_schedule.canceled"
    | "subscription_schedule.aborted"
    | "subscription_schedule.expiring",
): Stripe.Event {
  const scheduleStatusByType: Record<typeof type, Stripe.SubscriptionSchedule.Status> = {
    "subscription_schedule.aborted": "canceled",
    "subscription_schedule.canceled": "canceled",
    "subscription_schedule.completed": "completed",
    "subscription_schedule.created": "active",
    "subscription_schedule.expiring": "active",
    "subscription_schedule.released": "released",
    "subscription_schedule.updated": "active",
  };

  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708804,
    data: {
      object: {
        id: "sched_123",
        object: "subscription_schedule",
        status: scheduleStatusByType[type],
      },
    },
    id: `evt_${type.replace(/\./gu, "_")}_123`,
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type,
  });
}

function makeCanonicalSubscription(overrides?: Partial<{
  customer: string;
  id: string;
  metadata: Record<string, string>;
  status: Stripe.Subscription.Status;
}>): Stripe.Subscription {
  return {
    customer: overrides?.customer ?? "cus_123",
    id: overrides?.id ?? "sub_123",
    metadata: overrides?.metadata ?? {},
    status: overrides?.status ?? "active",
  } as Stripe.Subscription;
}

function makeStripeEvent<
  TType extends Stripe.Event.Type,
  TObject extends Record<string, unknown>,
>(event: StripeTestEvent<TType, TObject>): Stripe.Event {
  // The synthetic fixtures are intentionally narrower than Stripe's generated event union.
  // Keep the boundary explicit instead of widening the test data shape.
  // @ts-expect-error - synthetic Stripe event fixtures are narrower than Stripe.Event.
  return event as Stripe.Event;
}

function createStripeEventPrismaHarness() {
  const rows: MutableStripeEventRow[] = [];
  const transaction = vi.fn(
    async <T>(callback: (tx: StripeEventPrismaHarnessClient) => Promise<T>) => callback(client),
  ) as StripeEventPrismaHarnessClient["$transaction"];

  const client: StripeEventPrismaHarnessClient = {
    $transaction: transaction,
    hostedStripeEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: MutableStripeEventRow = {
          attemptCount: data.attemptCount as number,
          claimExpiresAt: null,
          createdAt: new Date(),
          eventId: data.eventId as string,
          lastErrorCode: null,
          lastErrorMessage: null,
          nextAttemptAt: data.nextAttemptAt as Date,
          processedAt: null,
          receivedAt: data.receivedAt as Date,
          status: data.status as HostedStripeEventStatus,
          stripeCreatedAt: data.stripeCreatedAt as Date,
          type: data.type as string,
          updatedAt: new Date(),
        };
        rows.push(row);
        return row;
      }),
      findMany: vi.fn(async () => rows),
      findUnique: vi.fn(async ({ where }: { where: { eventId: string } }) =>
        rows.find((row) => row.eventId === where.eventId) ?? null,
      ),
      update: vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: { eventId: string } }) => {
        const row = rows.find((candidate) => candidate.eventId === where.eventId);

        if (!row) {
          throw new Error(`Missing stripe event ${where.eventId}`);
        }

        Object.assign(row, data, {
          updatedAt: new Date(),
        });
        return row;
      }),
      updateMany: vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: StripeEventWhere }) => {
        const row = rows.find((candidate) => matchesStripeEventWhere(candidate, where));

        if (!row) {
          return { count: 0 };
        }

        row.attemptCount += (data.attemptCount as { increment: number }).increment;
        row.claimExpiresAt = data.claimExpiresAt as Date;
        row.lastErrorCode = data.lastErrorCode as string | null;
        row.lastErrorMessage = data.lastErrorMessage as string | null;
        row.nextAttemptAt = data.nextAttemptAt as Date;
        row.status = data.status as HostedStripeEventStatus;
        row.updatedAt = new Date();
        return { count: 1 };
      }),
    },
  };

  return {
    client,
    rows,
  };
}

function matchesStripeEventWhere(row: MutableStripeEventRow, where: StripeEventWhere): boolean {
  if (where.eventId && row.eventId !== where.eventId) {
    return false;
  }

  if (where.updatedAt && row.updatedAt.getTime() !== where.updatedAt.getTime()) {
    return false;
  }

  if (!where.OR) {
    return true;
  }

  return where.OR.some((condition) => {
    if ("claimExpiresAt" in condition) {
      return row.status === HostedStripeEventStatus.processing
        && row.claimExpiresAt !== null
        && condition.claimExpiresAt?.lte instanceof Date
        && row.claimExpiresAt.getTime() <= condition.claimExpiresAt.lte.getTime();
    }

    const retryCondition = condition as {
      nextAttemptAt?: {
        lte: Date;
      };
      status: "failed" | "pending";
    };

    return row.status === retryCondition.status
      && retryCondition.nextAttemptAt?.lte instanceof Date
      && row.nextAttemptAt.getTime() <= retryCondition.nextAttemptAt.lte.getTime();
  });
}

type MutableStripeEventRow = {
  attemptCount: number;
  claimExpiresAt: Date | null;
  createdAt: Date;
  eventId: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextAttemptAt: Date;
  processedAt: Date | null;
  receivedAt: Date;
  status: HostedStripeEventStatus;
  stripeCreatedAt: Date;
  type: string;
  updatedAt: Date;
};

type StripeEventWhere = {
  eventId?: string;
  updatedAt?: Date;
  OR?: Array<
    | {
        claimExpiresAt?: {
          lte: Date;
        };
        status: "processing";
      }
    | {
        nextAttemptAt?: {
          lte: Date;
        };
        status:
          | "pending"
          | "failed";
      }
  >;
};

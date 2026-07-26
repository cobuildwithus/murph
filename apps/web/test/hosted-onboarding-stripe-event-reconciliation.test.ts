import { HostedBillingStatus, HostedStripeEventStatus, Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";

const mocks = vi.hoisted(() => ({
  applyStripeCheckoutCompleted: vi.fn(),
  applyStripeCheckoutExpired: vi.fn(),
  applyStripeInvoiceCollectionStateChanged: vi.fn(),
  applyStripeInvoicePaid: vi.fn(),
  applyStripeRecurringFinancialState: vi.fn(),
  applyStripeSubscriptionUpdated: vi.fn(),
  cancelHostedPulseTrialCheckoutLoserSubscription: vi.fn(),
  clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx: vi.fn(),
  convergeHostedFamilyDirectPaidOwnershipTx: vi.fn(),
  findMemberForStripeCheckoutSession: vi.fn(),
  findMemberForStripeInvoice: vi.fn(),
  findMemberForStripeSubscription: vi.fn(),
  listHostedStripeCheckoutSessionMemberIds: vi.fn(),
  prepareHostedLegacySyntheticFamilyCleanupTx: vi.fn(),
  readHostedFamilyDirectPaidTransitionContext: vi.fn(),
  readHostedMemberFamilyBillingClaim: vi.fn(),
  readActiveHostedFamilySponsorship: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  reconcileHostedUsageCreditStripeEvent: vi.fn(),
  refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx: vi.fn(),
  reconcileHostedFamilyDirectPaidTransitionSubscription: vi.fn(),
  resolveHostedStripeBillingOwner: vi.fn(),
  resolveStripeFinancialContext: vi.fn(),
  sendHostedSignupNotificationEmailForMemberBestEffort: vi.fn(),
  sendHostedSignupWelcomeEmailForMember: vi.fn(),
  sendHostedSubscriptionCancellationEmailForMember: vi.fn(),
  signalHostedRuntimeRecheckRuntime: vi.fn(),
  executeHostedCheckoutSubscriptionCleanup: vi.fn(),
  stripe: {
    events: {
      retrieve: vi.fn(),
    },
    invoicePayments: {
      list: vi.fn(),
    },
    refunds: {
      create: vi.fn(),
      list: vi.fn(),
    },
    subscriptions: {
      cancel: vi.fn(),
      retrieve: vi.fn(),
    },
  },
  writeHostedMemberStripeBillingTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/family-plan")
  >("@/src/lib/hosted-onboarding/family-plan");

  return {
    ...actual,
    applyHostedFamilyStripeCheckoutCompletedTx: vi.fn(async () => ({
      activations: [],
      groupId: null,
    })),
    applyHostedFamilyStripeSubscriptionUpdatedTx: vi.fn(async () => ({
      activations: [],
      groupId: null,
    })),
    convergeHostedFamilyDirectPaidOwnershipTx:
      mocks.convergeHostedFamilyDirectPaidOwnershipTx,
    lookupHostedAccountGroupStripeBillingRefByStripeSubscriptionId:
      vi.fn(async () => null),
    prepareHostedLegacySyntheticFamilyCleanupTx:
      mocks.prepareHostedLegacySyntheticFamilyCleanupTx,
    readHostedFamilyDirectPaidTransitionContext:
      mocks.readHostedFamilyDirectPaidTransitionContext,
    readHostedMemberFamilyBillingClaim:
      mocks.readHostedMemberFamilyBillingClaim,
    reconcileHostedFamilyDirectPaidTransitionSubscription:
      mocks.reconcileHostedFamilyDirectPaidTransitionSubscription,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    readHostedMemberBillingSnapshot: mocks.readHostedMemberBillingSnapshot,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-policy", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-policy")
  >("@/src/lib/hosted-onboarding/stripe-billing-policy");

  return {
    ...actual,
    writeHostedMemberStripeBillingTx: mocks.writeHostedMemberStripeBillingTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service", () => ({
  clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx:
    mocks.clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx,
  refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx:
    mocks.refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", () => ({
  applyStripeCheckoutCompleted: mocks.applyStripeCheckoutCompleted,
  applyStripeCheckoutExpired: mocks.applyStripeCheckoutExpired,
  applyStripeInvoiceCollectionStateChanged:
    mocks.applyStripeInvoiceCollectionStateChanged,
  applyStripeInvoicePaid: mocks.applyStripeInvoicePaid,
  applyStripeRecurringFinancialState: mocks.applyStripeRecurringFinancialState,
  applyStripeSubscriptionUpdated: mocks.applyStripeSubscriptionUpdated,
  cancelHostedPulseTrialCheckoutLoserSubscription:
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-lookup")
  >("@/src/lib/hosted-onboarding/stripe-billing-lookup");

  return {
    ...actual,
    findMemberForStripeCheckoutSession: mocks.findMemberForStripeCheckoutSession,
    findMemberForStripeInvoice: mocks.findMemberForStripeInvoice,
    findMemberForStripeSubscription: mocks.findMemberForStripeSubscription,
    listHostedStripeCheckoutSessionMemberIds:
      mocks.listHostedStripeCheckoutSessionMemberIds,
    resolveStripeFinancialContext: mocks.resolveStripeFinancialContext,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-owner", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-owner")
  >("@/src/lib/hosted-onboarding/stripe-billing-owner");

  return {
    ...actual,
    resolveHostedStripeBillingOwner: mocks.resolveHostedStripeBillingOwner,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-checkout-subscription-cleanup", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-checkout-subscription-cleanup")
  >("@/src/lib/hosted-onboarding/stripe-checkout-subscription-cleanup");

  return {
    ...actual,
    executeHostedCheckoutSubscriptionCleanup:
      mocks.executeHostedCheckoutSubscriptionCleanup,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-access", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/member-access")
  >("@/src/lib/hosted-onboarding/member-access");

  return {
    ...actual,
    readActiveHostedFamilySponsorship: mocks.readActiveHostedFamilySponsorship,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/runtime")
  >("@/src/lib/hosted-onboarding/runtime");

  return {
    ...actual,
    requireHostedStripeBillingPlanConfig: () => ({
      billingPlanCode: "launch_monthly",
      priceId: "price_pulse_monthly_123",
      stripe: mocks.stripe,
    }),
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

vi.mock("@/src/lib/hosted-onboarding/signup-notification-email", () => ({
  sendHostedSignupNotificationEmailForMemberBestEffort:
    mocks.sendHostedSignupNotificationEmailForMemberBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/subscription-cancellation-email", () => ({
  sendHostedSubscriptionCancellationEmailForMember:
    mocks.sendHostedSubscriptionCancellationEmailForMember,
}));

vi.mock(
  "@/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation",
  async () => {
    const actual = await vi.importActual<
      typeof import("@/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation")
    >("@/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation");
    return {
      ...actual,
      reconcileHostedUsageCreditStripeEvent:
        mocks.reconcileHostedUsageCreditStripeEvent,
    };
  },
);

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedRuntimeRecheckRuntime: mocks.signalHostedRuntimeRecheckRuntime,
}));

import {
  HOSTED_STRIPE_EVENT_LEASE_BUDGET,
  HOSTED_USAGE_CREDIT_RUNTIME_RECHECK_TIMEOUT_MS,
  reconcileHostedStripeEventById as reconcileHostedStripeEventByIdImpl,
  recordHostedStripeEvent as recordHostedStripeEventImpl,
} from "@/src/lib/hosted-onboarding/stripe-event-reconciliation";
import { HostedUsageCreditStripeRetryableError } from
  "@/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation";

type HostedStripeEventRecordInput = Parameters<typeof recordHostedStripeEventImpl>[0];
type HostedStripeEventReconcileInput = Parameters<typeof reconcileHostedStripeEventByIdImpl>[0];

type StripeEventPrismaHarnessClient = {
  $queryRaw: (...args: unknown[]) => Promise<unknown>;
  $transaction: <T>(callback: (tx: StripeEventPrismaHarnessClient) => Promise<T>) => Promise<T>;
  hostedMember: {
    findMany: (input: {
      where: { id: { in: string[] } };
    }) => Promise<Array<{ id: string }>>;
  };
  hostedStripeEvent: {
    create: ({ data }: { data: Record<string, unknown> }) => Promise<MutableStripeEventRow>;
    findMany: () => Promise<MutableStripeEventRow[]>;
    findUnique: ({ where }: { where: { eventId: string } }) => Promise<MutableStripeEventRow | null>;
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
    mocks.applyStripeInvoiceCollectionStateChanged.mockResolvedValue(undefined);
    mocks.applyStripeInvoicePaid.mockResolvedValue({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "dispatch_123",
      welcomeEmailMemberId: "member_123",
    });
    mocks.applyStripeRecurringFinancialState.mockResolvedValue({
      blockActiveProjection: false,
      state: "healthy",
    });
    mocks.applyStripeSubscriptionUpdated.mockResolvedValue({
      activatedMemberId: null,
      activatedMembers: [],
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription.mockResolvedValue(undefined);
    mocks.clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx.mockResolvedValue(undefined);
    mocks.convergeHostedFamilyDirectPaidOwnershipTx.mockResolvedValue(null);
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.findMemberForStripeInvoice.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.findMemberForStripeSubscription.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.listHostedStripeCheckoutSessionMemberIds.mockResolvedValue(["member_123"]);
    mocks.prepareHostedLegacySyntheticFamilyCleanupTx.mockResolvedValue(null);
    mocks.readHostedFamilyDirectPaidTransitionContext.mockReturnValue(null);
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(null);
    mocks.readActiveHostedFamilySponsorship.mockResolvedValue(false);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(null);
    mocks.reconcileHostedUsageCreditStripeEvent.mockResolvedValue({ handled: false });
    mocks.refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx.mockResolvedValue(undefined);
    mocks.reconcileHostedFamilyDirectPaidTransitionSubscription
      .mockImplementation(async ({ subscription }) => subscription);
    mocks.resolveHostedStripeBillingOwner.mockResolvedValue({
      kind: "member",
      lockMemberId: "member_123",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mocks.resolveStripeFinancialContext.mockResolvedValue({
      customerId: "cus_123",
      invoiceId: "in_123",
      paymentIntentId: "pi_123",
      subscriptionId: "sub_123",
    });
    mocks.executeHostedCheckoutSubscriptionCleanup.mockResolvedValue(undefined);
    mocks.sendHostedSignupWelcomeEmailForMember.mockResolvedValue({
      providerMessageId: "resend_email_123",
      status: "sent",
    });
    mocks.sendHostedSignupNotificationEmailForMemberBestEffort.mockResolvedValue(undefined);
    mocks.sendHostedSubscriptionCancellationEmailForMember.mockResolvedValue({
      status: "sent",
    });
    mocks.signalHostedRuntimeRecheckRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription());
    mocks.stripe.invoicePayments.list.mockResolvedValue({ data: [] });
    mocks.stripe.refunds.create.mockResolvedValue({ status: "succeeded" });
    mocks.stripe.refunds.list.mockResolvedValue({ data: [] });
    mocks.stripe.subscriptions.cancel.mockResolvedValue(makeCanonicalSubscription({
      status: "canceled",
    }));
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValue(null);
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

  it("derives the receipt lease from every bounded top-up processing phase", () => {
    expect(HOSTED_STRIPE_EVENT_LEASE_BUDGET.totalMs).toBe(
      HOSTED_STRIPE_EVENT_LEASE_BUDGET.eventRetrieveMs +
        HOSTED_STRIPE_EVENT_LEASE_BUDGET.usageCreditPreparationMs +
        HOSTED_STRIPE_EVENT_LEASE_BUDGET.memberMutationMs +
        HOSTED_STRIPE_EVENT_LEASE_BUDGET.postCommitMs +
        HOSTED_STRIPE_EVENT_LEASE_BUDGET.marginMs,
    );
    expect(HOSTED_STRIPE_EVENT_LEASE_BUDGET.totalMs).toBe(27 * 60_000);
    expect(HOSTED_USAGE_CREDIT_RUNTIME_RECHECK_TIMEOUT_MS).toBeLessThan(
      HOSTED_STRIPE_EVENT_LEASE_BUDGET.postCommitMs,
    );
    expect(HOSTED_USAGE_CREDIT_RUNTIME_RECHECK_TIMEOUT_MS).toBe(90_000);
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
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        expand: expect.arrayContaining(["latest_invoice"]),
      }),
    );
    expect(prisma.client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining(HOSTED_ONBOARDING_TRANSACTION_OPTIONS),
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
    expect(mocks.sendHostedSignupNotificationEmailForMemberBestEffort).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
      sourceEventId: "evt_invoice_paid_123",
      sourceEventType: "invoice.paid",
    });
    expect(
      mocks.sendHostedSignupWelcomeEmailForMember.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.sendHostedSignupNotificationEmailForMemberBestEffort.mock.invocationCallOrder[0],
    );
    expect(
      mocks.sendHostedSignupNotificationEmailForMemberBestEffort.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(prisma.client.hostedStripeEvent.updateMany).mock.invocationCallOrder.at(-1) ?? 0,
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
      expect.any(Date),
    );
    expect(mocks.sendHostedSignupWelcomeEmailForMember).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupNotificationEmailForMemberBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedSubscriptionCancellationEmailForMember).not.toHaveBeenCalled();
  });

  it("keeps the first webhook receipt time stable when processing crosses the legacy horizon", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const sessionCreated = 1_800_000_000;
    const sessionExpiresAt = sessionCreated + 24 * 60 * 60;
    const receivedAt = new Date(
      (sessionExpiresAt + 3 * 24 * 60 * 60) * 1_000,
    );
    const retryObservedAt = new Date(receivedAt.getTime() + 1);
    Object.assign(event, {
      created: sessionCreated,
    });
    Object.assign(event.data.object, {
      created: sessionCreated,
      expires_at: sessionExpiresAt,
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(receivedAt);
      await recordHostedStripeEvent({
        event,
        prisma: prisma.client,
      });

      vi.setSystemTime(retryObservedAt);
      await expect(reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      })).resolves.toMatchObject({
        status: "completed",
      });

      expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
        event.data.object,
        expect.anything(),
        expect.objectContaining({
          sourceEventId: event.id,
        }),
        receivedAt,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes checkout expiration through exact attempt cleanup", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutExpiredEvent();
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

    expect(mocks.applyStripeCheckoutExpired).toHaveBeenCalledWith(
      event.data.object,
      prisma.client,
    );
  });

  it("reconciles usage-credit Checkout before subscription-shaped handling", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent.mockResolvedValue({
      beneficiaryMemberId: "member_123",
      granted: true,
      handled: true,
      purchaseId: "hucp_purchase_123",
      wakeRequired: true,
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
      usageCreditGrantedMemberId: "member_123",
    });

    expect(mocks.reconcileHostedUsageCreditStripeEvent).toHaveBeenCalledWith({
      event,
      prisma: prisma.client,
    });
    expect(mocks.findMemberForStripeCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.prepareHostedLegacySyntheticFamilyCleanupTx).not.toHaveBeenCalled();
    expect(mocks.applyStripeCheckoutCompleted).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      prisma: prisma.client,
      userId: "member_123",
    });
  });

  it("keeps a paid usage-credit grant claimable after Stripe directs a sixth-attempt retry", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let grantCount = 0;
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent
      .mockRejectedValueOnce(new HostedUsageCreditStripeRetryableError(
        Object.assign(new Error("Stripe requested a retry"), {
          headers: {
            "StRiPe-ShOuLd-ReTrY": "TRUE",
          },
          statusCode: 400,
          type: "StripeInvalidRequestError",
        }),
      ))
      .mockImplementationOnce(async () => {
        grantCount += 1;
        return {
          beneficiaryMemberId: "member_123",
          granted: true,
          handled: true,
          purchaseId: "hucp_purchase_123",
          wakeRequired: true,
        };
      });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
      usageCreditGrantedMemberId: "member_123",
    });

    expect(grantCount).toBe(1);
    expect(mocks.reconcileHostedUsageCreditStripeEvent).toHaveBeenCalledTimes(2);
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledOnce();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 7,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("keeps a top-up receipt claimable when Stripe directs live retrieval retry on attempt six", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const session = event.data.object as Stripe.Checkout.Session;
    session.client_reference_id = "hucp_purchase_123";
    session.metadata = {
      policyVersion: "hosted-usage-credit-checkout-v1",
      purchaseId: "hucp_purchase_123",
      purpose: "hosted_usage_credit",
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let grantCount = 0;
    mocks.stripe.events.retrieve
      .mockRejectedValueOnce(Object.assign(
        new Error("Stripe requested a retry"),
        {
          headers: {
            "StRiPe-ShOuLd-ReTrY": " TRUE ",
          },
          statusCode: 400,
          type: "StripeInvalidRequestError",
        },
      ))
      .mockResolvedValueOnce(event);
    mocks.reconcileHostedUsageCreditStripeEvent.mockImplementation(async () => {
      grantCount += 1;
      return {
        beneficiaryMemberId: "member_123",
        granted: true,
        handled: true,
        purchaseId: "hucp_purchase_123",
        wakeRequired: true,
      };
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      lastErrorCode: "HOSTED_STRIPE_EVENT_RETRIEVE_RETRYABLE",
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));
    expect(mocks.reconcileHostedUsageCreditStripeEvent).not.toHaveBeenCalled();

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
      usageCreditGrantedMemberId: "member_123",
    });

    expect(grantCount).toBe(1);
    expect(mocks.stripe.events.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.reconcileHostedUsageCreditStripeEvent).toHaveBeenCalledOnce();
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledOnce();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 7,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("poisons a top-up receipt when Stripe directs no retry on attempt six", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockRejectedValue(Object.assign(
      new Error("Stripe rejected the event read"),
      {
        headers: {
          "STRIPE-SHOULD-RETRY": "false",
        },
        statusCode: 500,
        type: "StripeAPIError",
      },
    ));

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.poisoned,
    }));
    expect(mocks.reconcileHostedUsageCreditStripeEvent).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("still poisons a definitive live event lookup rejection at the shared cap", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockRejectedValue(Object.assign(
      new Error("No such Stripe event"),
      {
        headers: {
          "Stripe-Should-Retry": "not-a-directive",
        },
        statusCode: 404,
        type: "StripeInvalidRequestError",
      },
    ));

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.poisoned,
    }));
    expect(mocks.reconcileHostedUsageCreditStripeEvent).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("poisons a usage-credit receipt when Stripe directs no retry on attempt six", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stripeError = Object.assign(new Error("Stripe rejected the read"), {
      headers: {
        "StRiPe-ShOuLd-ReTrY": "FALSE",
      },
      statusCode: 500,
      type: "StripeAPIError",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent.mockRejectedValue(stripeError);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.poisoned,
    }));
    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toBeNull();
    expect(mocks.reconcileHostedUsageCreditStripeEvent).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("keeps a usage-credit reversal claimable after a transient sixth attempt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeRefundCreatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let reversalCount = 0;
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent
      .mockRejectedValueOnce(new HostedUsageCreditStripeRetryableError(
        new Error("database unavailable"),
      ))
      .mockImplementationOnce(async () => {
        reversalCount += 1;
        return {
          beneficiaryMemberId: "member_123",
          granted: false,
          handled: true,
          purchaseId: "hucp_purchase_123",
          wakeRequired: true,
        };
      });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(reversalCount).toBe(1);
    expect(mocks.reconcileHostedUsageCreditStripeEvent).toHaveBeenCalledTimes(2);
    expect(mocks.applyStripeRecurringFinancialState).not.toHaveBeenCalled();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 7,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("keeps recurring financial reconciliation claimable after a transient sixth attempt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeRefundCreatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeRecurringFinancialState
      .mockRejectedValueOnce(Object.assign(
        new Error("Stripe recurring financial read unavailable"),
        {
          statusCode: 503,
          type: "StripeAPIError",
        },
      ))
      .mockResolvedValueOnce({
        blockActiveProjection: false,
        state: "healthy",
      });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeRecurringFinancialState).toHaveBeenCalledTimes(2);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 7,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("still poisons a proven permanent usage-credit invariant at the shared cap", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent.mockRejectedValue(
      new Error("Usage-credit Checkout metadata did not match."),
    );

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.poisoned,
    }));
    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toBeNull();
    expect(mocks.reconcileHostedUsageCreditStripeEvent).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("retries a fulfilled usage-credit runtime recheck before completing its receipt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.reconcileHostedUsageCreditStripeEvent
      .mockResolvedValueOnce({
        beneficiaryMemberId: "member_123",
        granted: true,
        handled: true,
        purchaseId: "hucp_purchase_123",
        wakeRequired: true,
      })
      .mockResolvedValueOnce({
        beneficiaryMemberId: "member_123",
        granted: false,
        handled: true,
        purchaseId: "hucp_purchase_123",
        wakeRequired: true,
      });
    mocks.signalHostedRuntimeRecheckRuntime
      .mockRejectedValueOnce(new Error("Temporal unavailable"))
      .mockResolvedValueOnce({
        signalAccepted: true,
        workflowId: "hosted-user-runtime:member_123",
      });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toEqual({
      activatedMemberId: null,
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "completed",
    });

    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledTimes(2);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("keeps the receipt retryable when a usage-credit runtime recheck times out", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const prisma = createStripeEventPrismaHarness();
      const event = makeCheckoutCompletedEvent();
      mocks.stripe.events.retrieve.mockResolvedValue(event);
      mocks.reconcileHostedUsageCreditStripeEvent.mockResolvedValue({
        beneficiaryMemberId: "member_123",
        granted: true,
        handled: true,
        purchaseId: "hucp_purchase_123",
        wakeRequired: true,
      });
      mocks.signalHostedRuntimeRecheckRuntime.mockImplementation(
        async () => await new Promise<never>(() => {}),
      );

      await recordHostedStripeEvent({ event, prisma: prisma.client });
      const reconciliation = reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      });
      const result = expect(reconciliation).resolves.toMatchObject({
        status: "failed",
      });

      await vi.advanceTimersByTimeAsync(
        HOSTED_USAGE_CREDIT_RUNTIME_RECHECK_TIMEOUT_MS,
      );
      await result;

      expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
        abortSignal: expect.objectContaining({ aborted: true }),
        prisma: prisma.client,
        userId: "member_123",
      });
      expect(prisma.rows[0]).toEqual(expect.objectContaining({
        attemptCount: 1,
        processedAt: null,
        status: HostedStripeEventStatus.failed,
      }));
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("fails before standard Checkout handling when ownership changes under the member lock", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const ordering: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    vi.mocked(prisma.client.hostedMember.findMany)
      .mockImplementationOnce(async () => {
        ordering.push("owner-resolved");
        return [{ id: "member_123" }];
      })
      .mockResolvedValueOnce([]);
    mocks.findMemberForStripeCheckoutSession.mockImplementationOnce(async () => {
        ordering.push("owner-revalidated");
        return { core: { id: "member_456" } };
      });
    vi.mocked(prisma.client.$queryRaw).mockImplementation(async () => {
      ordering.push("member-locked");
      return [];
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(ordering).toEqual([
      "owner-resolved",
      "member-locked",
      "owner-revalidated",
    ]);
    expect(mocks.applyStripeCheckoutCompleted).not.toHaveBeenCalled();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));
    errorSpy.mockRestore();
  });

  it("processes a no-owner family Checkout without the ordinary billing-owner gate", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const session = event.data.object as Stripe.Checkout.Session;
    session.metadata = {
      ...session.metadata,
      kind: "hosted_family_plan",
    };
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(null);

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledOnce();
  });

  it("processes a no-owner family subscription without the ordinary billing-owner gate", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      metadata: {
        kind: "hosted_family_plan",
      },
      status: "active",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.findMemberForStripeSubscription.mockResolvedValue(null);

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      canonicalSubscription,
      expect.anything(),
      expect.anything(),
    );
  });

  it("processes a no-owner family invoice without the ordinary billing-owner gate", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      metadata: {
        kind: "hosted_family_plan",
      },
      status: "active",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.findMemberForStripeInvoice.mockResolvedValue(null);
    mocks.findMemberForStripeSubscription.mockResolvedValue(null);
    mocks.applyStripeInvoicePaid.mockResolvedValue({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledWith(
      event.data.object,
      expect.anything(),
      expect.anything(),
      HostedBillingStatus.active,
      canonicalSubscription,
    );
  });

  it("keeps a transient legacy Family cleanup failure within the ordinary poison bound", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeSubscription.mockResolvedValue(null);
    mocks.prepareHostedLegacySyntheticFamilyCleanupTx.mockResolvedValue("sub_123");
    mocks.stripe.subscriptions.cancel
      .mockRejectedValueOnce(new Error("Stripe unavailable"))
      .mockResolvedValueOnce(makeCanonicalSubscription({ status: "canceled" }));

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 1,
      lastErrorCode: "Error",
      lastErrorMessage: "[redacted]",
      status: HostedStripeEventStatus.failed,
    }));
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted Stripe event reconciliation failed.",
      expect.objectContaining({
        errorMessage: "Stripe unavailable",
        poisoned: false,
      }),
    );

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_123",
      {},
      { idempotencyKey: "hosted-family-legacy-cancel:sub_123" },
    );
    errorSpy.mockRestore();
  });

  it("retries the exact legacy Family invoice refund without duplicating it", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const invoice = event.data.object as Stripe.Invoice & {
      charge?: string | null;
      payment_intent?: string | null;
    };
    invoice.charge = null;
    invoice.payment_intent = null;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeInvoice.mockResolvedValue(null);
    mocks.prepareHostedLegacySyntheticFamilyCleanupTx.mockResolvedValue("sub_123");
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription({
      status: "canceled",
    }));
    mocks.stripe.invoicePayments.list.mockResolvedValue({
      data: [{
        payment: { charge: null, payment_intent: "pi_exact" },
        status: "paid",
      }],
    });
    mocks.stripe.refunds.list
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [{
          id: "re_legacy",
          metadata: { hosted_family_legacy_invoice_id: "in_123" },
          status: "succeeded",
        }],
      });
    mocks.stripe.refunds.create.mockResolvedValue({ status: "pending" });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      lastErrorCode: "HOSTED_LEGACY_FAMILY_CLEANUP_PENDING",
      lastErrorMessage: "[redacted]",
      status: HostedStripeEventStatus.failed,
    }));
    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.stripe.invoicePayments.list).toHaveBeenCalledWith(expect.objectContaining({
      invoice: "in_123",
      status: "paid",
    }));
    expect(mocks.stripe.refunds.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.refunds.create).toHaveBeenCalledWith({
      metadata: { hosted_family_legacy_invoice_id: "in_123" },
      payment_intent: "pi_exact",
    }, {
      idempotencyKey: "hosted-family-legacy-refund:in_123",
    });
    errorSpy.mockRestore();
  });

  it("poisons a terminal legacy Family refund without issuing another refund", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeInvoice.mockResolvedValue(null);
    mocks.prepareHostedLegacySyntheticFamilyCleanupTx.mockResolvedValue("sub_123");
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription({
      status: "canceled",
    }));
    mocks.stripe.refunds.list.mockResolvedValue({
      data: [{
        id: "re_failed",
        metadata: { hosted_family_legacy_invoice_id: "in_123" },
        status: "failed",
      }],
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      lastErrorCode: "Error",
      lastErrorMessage: "[redacted]",
      status: HostedStripeEventStatus.poisoned,
    }));
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted Stripe event reconciliation failed.",
      expect.objectContaining({
        errorMessage: "Legacy Family refund previously failed.",
        poisoned: true,
      }),
    );
    expect(mocks.stripe.refunds.create).not.toHaveBeenCalled();
    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toBeNull();
    expect(mocks.stripe.refunds.list).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
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
    expect(mocks.sendHostedSignupNotificationEmailForMemberBestEffort).not.toHaveBeenCalled();
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
    expect(mocks.sendHostedSignupNotificationEmailForMemberBestEffort).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
      sourceEventId: event.id,
      sourceEventType: event.type,
    });
  });

  it("defers Pulse Trial provider authority to the locked checkout owner", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makePulseTrialCheckoutCompletedEvent();
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

    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    const transactionMock = vi.mocked(prisma.client.$transaction);
    expect(transactionMock.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.applyStripeCheckoutCompleted.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
      event.data.object,
      expect.anything(),
      expect.objectContaining({
        sourceType: "stripe.checkout.session.completed",
      }),
      expect.any(Date),
    );
  });

  it("retries delayed Pulse Trial loser cleanup before completing the receipt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makePulseTrialCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
    mocks.applyStripeCheckoutCompleted.mockResolvedValue({
      activatedMemberId: null,
      cleanupPulseTrialStripeSubscriptionId: "sub_checkout_123",
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription
      .mockRejectedValueOnce(new Error("Stripe unavailable"))
      .mockResolvedValueOnce(undefined);

    await recordHostedStripeEvent({
      event,
      prisma: prisma.client,
    });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));

    prisma.rows[0].nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.cancelHostedPulseTrialCheckoutLoserSubscription).toHaveBeenCalledTimes(2);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("retries Family-sponsored direct checkout cleanup before completing the receipt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makePulseTrialCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeCheckoutCompleted.mockResolvedValue({
      activatedMemberId: null,
      cleanupCheckoutSubscription: {
        checkoutAttemptId: "attempt_123",
        checkoutIntentHash: "intent_123",
        checkoutSessionId: "cs_trial_123",
        memberId: "member_123",
        reason: "family_sponsored",
        stripeSubscriptionId: "sub_checkout_123",
      },
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.executeHostedCheckoutSubscriptionCleanup
      .mockRejectedValueOnce(new Error("Stripe unavailable"))
      .mockResolvedValueOnce(undefined);

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    prisma.rows[0].nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.executeHostedCheckoutSubscriptionCleanup).toHaveBeenCalledTimes(2);
    expect(mocks.executeHostedCheckoutSubscriptionCleanup).toHaveBeenCalledWith({
      candidate: expect.objectContaining({
        memberId: "member_123",
        reason: "family_sponsored",
        stripeSubscriptionId: "sub_checkout_123",
      }),
      prisma: prisma.client,
    });
    errorSpy.mockRestore();
  });

  it("executes loser cleanup for a completed legacy standard Checkout after member deletion", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const cleanupCandidate = {
      checkoutAttemptId: null,
      checkoutIntentHash: null,
      checkoutSessionId: "cs_checkout_123",
      familyBillingClaim: null,
      memberId: "member_123",
      reason: "superseded" as const,
      stripeSubscriptionId: "sub_checkout_123",
    };
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(null);
    vi.mocked(prisma.client.hostedMember.findMany).mockResolvedValue([]);
    mocks.applyStripeCheckoutCompleted.mockResolvedValue({
      activatedMemberId: null,
      cleanupCheckoutSubscription: cleanupCandidate,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledOnce();
    expect(mocks.executeHostedCheckoutSubscriptionCleanup).toHaveBeenCalledWith({
      candidate: cleanupCandidate,
      prisma: prisma.client,
    });
  });

  it("locks the exact member and cleans a second standard Checkout with a different customer", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const winnerBase = makeActiveNonTrialMemberWithoutSubscription();
    const winner = {
      ...winnerBase,
      billingRef: {
        ...winnerBase.billingRef,
        stripeCustomerId: "cus_winner",
        stripeSubscriptionId: "sub_winner",
      },
    };
    const cleanupCandidate = {
      checkoutAttemptId: null,
      checkoutIntentHash: null,
      checkoutSessionId: "cs_checkout_123",
      familyBillingClaim: null,
      memberId: "member_123",
      reason: "superseded" as const,
      stripeSubscriptionId: "sub_checkout_123",
    };
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(null);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(winner);
    mocks.applyStripeCheckoutCompleted.mockResolvedValue({
      activatedMemberId: null,
      cleanupCheckoutSubscription: cleanupCandidate,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(prisma.client.$queryRaw).toHaveBeenCalled();
    expect(mocks.executeHostedCheckoutSubscriptionCleanup).toHaveBeenCalledWith({
      candidate: cleanupCandidate,
      prisma: prisma.client,
    });
  });

  it("cleans up a Family-sponsored direct subscription without a stored billing reference", async () => {
    const prisma = createStripeEventPrismaHarness();
    const metadata = {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "standard",
      memberId: "member_123",
    };
    const event = makeSubscriptionEvent("customer.subscription.created", { metadata });
    const canonicalSubscription = makeCanonicalSubscription({ metadata });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.findMemberForStripeSubscription.mockResolvedValue(null);
    mocks.readActiveHostedFamilySponsorship.mockResolvedValue(true);
    mocks.applyStripeSubscriptionUpdated.mockResolvedValue({
      activatedMemberId: null,
      activatedMembers: [],
      cleanupFamilySponsoredStripeSubscriptionId: "sub_123",
      hostedExecutionEventId: null,
      subscriptionCancellationEmail: null,
      welcomeEmailMemberId: null,
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.readActiveHostedFamilySponsorship).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
    });
    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      canonicalSubscription,
      expect.anything(),
      prisma.client,
    );
    expect(mocks.executeHostedCheckoutSubscriptionCleanup).not.toHaveBeenCalled();
  });

  it("cleans up a Family-sponsored paid invoice without a stored billing reference", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.findMemberForStripeInvoice.mockResolvedValue(null);
    mocks.findMemberForStripeSubscription.mockResolvedValue(null);
    mocks.readActiveHostedFamilySponsorship.mockResolvedValue(true);
    mocks.applyStripeInvoicePaid.mockResolvedValue({
      activatedMemberId: null,
      cleanupFamilySponsoredStripeSubscriptionId: "sub_123",
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeInvoicePaid).toHaveBeenCalledWith(
      event.data.object,
      expect.anything(),
      prisma.client,
      "active",
      canonicalSubscription,
    );
    expect(mocks.executeHostedCheckoutSubscriptionCleanup).not.toHaveBeenCalled();
  });

  it("retries a subscription-created Pulse Trial loser cleanup before completing the receipt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionEvent("customer.subscription.created");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription({
      id: "sub_123",
      status: "trialing",
    }));
    mocks.findMemberForStripeSubscription.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.applyStripeSubscriptionUpdated.mockResolvedValue({
      activatedMemberId: null,
      cleanupPulseTrialStripeSubscriptionId: "sub_123",
      hostedExecutionEventId: null,
      subscriptionCancellationEmail: null,
      welcomeEmailMemberId: null,
    });
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription
      .mockRejectedValueOnce(new Error("temporary cleanup failure"))
      .mockResolvedValueOnce(undefined);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    prisma.rows[0].nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.cancelHostedPulseTrialCheckoutLoserSubscription).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it.each([
    ["customer.subscription.created", "checkout.session.completed"],
    ["checkout.session.completed", "customer.subscription.created"],
  ] as const)("keeps active non-trial access authoritative when %s precedes %s", async (
    firstType,
    secondType,
  ) => {
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
      "price_pulse_monthly_123",
    );
    const actualBillingEvents = await vi.importActual<
      typeof import("@/src/lib/hosted-onboarding/stripe-billing-events")
    >("@/src/lib/hosted-onboarding/stripe-billing-events");
    const member = makeActiveNonTrialMemberWithoutSubscription();
    const checkoutEvent = makeExactPulseTrialCheckoutCompletedEvent();
    const subscriptionEvent = makeExactPulseTrialSubscriptionCreatedEvent();
    const eventsById = new Map([
      [checkoutEvent.id, checkoutEvent],
      [subscriptionEvent.id, subscriptionEvent],
    ]);
    let providerStatus: Stripe.Subscription.Status = "trialing";
    mocks.applyStripeCheckoutCompleted.mockImplementation(
      actualBillingEvents.applyStripeCheckoutCompleted,
    );
    mocks.applyStripeSubscriptionUpdated.mockImplementation(
      actualBillingEvents.applyStripeSubscriptionUpdated,
    );
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription.mockImplementation(
      actualBillingEvents.cancelHostedPulseTrialCheckoutLoserSubscription,
    );
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(member);
    mocks.findMemberForStripeSubscription.mockResolvedValue(member);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(member);
    mocks.stripe.events.retrieve.mockImplementation(async (eventId: string) => {
      const event = eventsById.get(eventId);
      if (!event) {
        throw new Error("Unexpected Stripe event.");
      }
      return event;
    });
    mocks.stripe.subscriptions.retrieve.mockImplementation(async () =>
      makeExactPulseTrialSubscription(providerStatus)
    );
    mocks.stripe.subscriptions.cancel.mockImplementation(async () => {
      providerStatus = "canceled";
      return makeExactPulseTrialSubscription("canceled");
    });
    const eventByType = {
      "checkout.session.completed": checkoutEvent,
      "customer.subscription.created": subscriptionEvent,
    };
    const prisma = createStripeEventPrismaHarness();

    for (const type of [firstType, secondType]) {
      const event = eventByType[type];
      await recordHostedStripeEvent({ event, prisma: prisma.client });
      await expect(reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      })).resolves.toMatchObject({ status: "completed" });
    }

    expect(member.core.billingStatus).toBe(HostedBillingStatus.active);
    expect(member.billingRef?.stripeSubscriptionId).toBeNull();
    expect(member.billingRef?.pulseTrialRedeemedAt).toBeNull();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledOnce();
    expect(prisma.rows).toEqual([
      expect.objectContaining({ status: HostedStripeEventStatus.completed }),
      expect.objectContaining({ status: HostedStripeEventStatus.completed }),
    ]);
    vi.unstubAllEnvs();
  });

  it("keeps the real loser receipt retryable until resource_missing proves cleanup terminal", async () => {
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
      "price_pulse_monthly_123",
    );
    const actualBillingEvents = await vi.importActual<
      typeof import("@/src/lib/hosted-onboarding/stripe-billing-events")
    >("@/src/lib/hosted-onboarding/stripe-billing-events");
    const member = makeActiveNonTrialMemberWithoutSubscription();
    const event = makeExactPulseTrialSubscriptionCreatedEvent();
    const prisma = createStripeEventPrismaHarness();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.applyStripeSubscriptionUpdated.mockImplementation(
      actualBillingEvents.applyStripeSubscriptionUpdated,
    );
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription.mockImplementation(
      actualBillingEvents.cancelHostedPulseTrialCheckoutLoserSubscription,
    );
    mocks.findMemberForStripeSubscription.mockResolvedValue(member);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(member);
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(
      makeExactPulseTrialSubscription("trialing"),
    );
    mocks.stripe.subscriptions.cancel
      .mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockRejectedValueOnce({ code: "resource_missing" });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]?.status).toBe(HostedStripeEventStatus.failed);

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
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
    expect(mocks.sendHostedSignupNotificationEmailForMemberBestEffort).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prisma.client,
      sourceEventId: "evt_invoice_paid_123",
      sourceEventType: "invoice.paid",
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
    mocks.applyStripeSubscriptionUpdated.mockResolvedValueOnce({
      activatedMemberId: "member_family_owner",
      activatedMembers: [
        {
          activatedMemberId: "member_family_owner",
          hostedExecutionEventId: "member.activated:family:owner",
        },
        {
          activatedMemberId: "member_family_child",
          hostedExecutionEventId: "member.activated:family:child",
        },
      ],
      hostedExecutionEventId: "member.activated:family:owner",
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
      activatedMemberId: "member_family_owner",
      activatedMembers: [
        {
          activatedMemberId: "member_family_owner",
          hostedExecutionEventId: "member.activated:family:owner",
        },
        {
          activatedMemberId: "member_family_child",
          hostedExecutionEventId: "member.activated:family:child",
        },
      ],
      eventId: event.id,
      hostedExecutionEventId: "member.activated:family:owner",
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
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        expand: expect.arrayContaining(["latest_invoice"]),
      }),
    );
  });

  it("locks the direct member before retrieving canonical subscription state", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "trialing",
    });
    const retrieveStarted = makeDeferred<void>();
    const releaseRetrieve = makeDeferred<Stripe.Subscription>();
    const ordering: string[] = [];
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeSubscription.mockImplementation(async (input: {
      subscription: Stripe.Subscription;
    }) => {
      ordering.push("member-resolved");
      return input.subscription.metadata.memberId === "member_123"
        ? { core: { id: "member_123" } }
        : null;
    });
    vi.mocked(prisma.client.$queryRaw).mockImplementation(async () => {
      ordering.push("member-locked");
      return [];
    });
    mocks.stripe.subscriptions.retrieve.mockImplementation(async () => {
      ordering.push("subscription-retrieved");
      retrieveStarted.resolve(undefined);
      return releaseRetrieve.promise;
    });
    mocks.applyStripeSubscriptionUpdated.mockImplementationOnce(async () => {
      ordering.push("billing-written");
      return {
        activatedMemberId: null,
        activatedMembers: [],
        hostedExecutionEventId: null,
        welcomeEmailMemberId: null,
      };
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    const reconciliation = reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    });

    await retrieveStarted.promise;
    expect(ordering).toEqual([
      "member-resolved",
      "member-locked",
      "subscription-retrieved",
    ]);

    releaseRetrieve.resolve(canonicalSubscription);
    await expect(reconciliation).resolves.toMatchObject({ status: "completed" });

    expect(ordering).toEqual([
      "member-resolved",
      "member-locked",
      "subscription-retrieved",
      "billing-written",
    ]);
    expect(mocks.findMemberForStripeSubscription).toHaveBeenCalledWith({
      prisma: prisma.client,
      subscription: event.data.object,
    });
    expect(prisma.client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        maxWait: 5_000,
        timeout: 780_000,
      },
    );
  });

  it("fails closed when canonical subscription ownership changes after the member lock", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription({
      metadata: { memberId: "member_456" },
    }));
    mocks.findMemberForStripeSubscription.mockImplementation(async (input: {
      subscription: Stripe.Subscription;
    }) => ({
      core: { id: input.subscription.metadata.memberId },
    }));
    mocks.resolveHostedStripeBillingOwner.mockResolvedValue({
      kind: "member",
      lockMemberId: "member_456",
      memberId: "member_456",
      stripeCustomerId: "cus_456",
      stripeSubscriptionId: "sub_123",
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(prisma.rows[0]?.status).toBe(HostedStripeEventStatus.failed);
    errorSpy.mockRestore();
  });

  it("rereads a discovered subscription owner after locking it", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeCanonicalSubscription({
        metadata: { memberId: "member_123" },
      }))
      .mockResolvedValueOnce(makeCanonicalSubscription({
        metadata: { memberId: "member_456" },
      }));
    mocks.findMemberForStripeSubscription.mockImplementation(async (input: {
      subscription: Stripe.Subscription;
    }) => input.subscription.status === "past_due"
      ? null
      : { core: { id: input.subscription.metadata.memberId } });
    mocks.resolveHostedStripeBillingOwner
      .mockResolvedValueOnce({
        kind: "member",
        lockMemberId: "member_123",
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      })
      .mockResolvedValueOnce({
        kind: "member",
        lockMemberId: "member_456",
        memberId: "member_456",
        stripeCustomerId: "cus_456",
        stripeSubscriptionId: "sub_123",
      });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(prisma.rows[0]?.status).toBe(HostedStripeEventStatus.failed);
    errorSpy.mockRestore();
  });

  it("does not let an unowned subscription handler rediscover a member without its lock", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeSubscription
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ core: { id: "member_123" } });
    mocks.resolveHostedStripeBillingOwner.mockResolvedValue(null);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(mocks.findMemberForStripeSubscription).toHaveBeenCalledTimes(2);
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(prisma.rows[0]?.status).toBe(HostedStripeEventStatus.failed);
    errorSpy.mockRestore();
  });

  it("keeps an ambiguous Pulse Checkout as an explicit no-op", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makePulseTrialCheckoutCompletedEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.listHostedStripeCheckoutSessionMemberIds
      .mockResolvedValueOnce(["member_123", "member_456"])
      .mockResolvedValueOnce(["member_123", "member_456"])
      .mockResolvedValue(["member_123"]);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.listHostedStripeCheckoutSessionMemberIds).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.applyStripeCheckoutCompleted).not.toHaveBeenCalled();
  });

  it("does not let an expired first attempt finalize a reclaimed second attempt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionUpdatedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const firstApplyStarted = makeDeferred<void>();
    const releaseFirstApply = makeDeferred<void>();
    const secondApplyStarted = makeDeferred<void>();
    const releaseSecondApply = makeDeferred<void>();
    let applyCount = 0;
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeSubscription.mockResolvedValue({ core: { id: "member_123" } });
    mocks.applyStripeSubscriptionUpdated.mockImplementation(async () => {
      applyCount += 1;
      if (applyCount === 1) {
        firstApplyStarted.resolve(undefined);
        await releaseFirstApply.promise;
      } else {
        secondApplyStarted.resolve(undefined);
        await releaseSecondApply.promise;
      }

      return {
        activatedMemberId: null,
        activatedMembers: [],
        hostedExecutionEventId: null,
        welcomeEmailMemberId: null,
      };
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    const claimStartedAt = Date.now();
    const firstAttempt = reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    });

    await firstApplyStarted.promise;
    const claimExpiresAtMs = prisma.rows[0]?.claimExpiresAt?.getTime() ?? 0;
    expect(claimExpiresAtMs).toBeGreaterThanOrEqual(
      claimStartedAt + HOSTED_STRIPE_EVENT_LEASE_BUDGET.totalMs,
    );
    expect(claimExpiresAtMs).toBeLessThanOrEqual(
      Date.now() + HOSTED_STRIPE_EVENT_LEASE_BUDGET.totalMs,
    );

    const row = prisma.rows[0];
    if (!row) {
      throw new Error("Expected the Stripe event receipt to exist.");
    }
    row.claimExpiresAt = new Date(0);

    const secondAttempt = reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    });
    await secondApplyStarted.promise;
    expect(row).toEqual(expect.objectContaining({
      attemptCount: 2,
      status: HostedStripeEventStatus.processing,
    }));

    releaseFirstApply.resolve(undefined);
    await expect(firstAttempt).resolves.toMatchObject({ status: "failed" });
    expect(row).toEqual(expect.objectContaining({
      attemptCount: 2,
      processedAt: null,
      status: HostedStripeEventStatus.processing,
    }));

    releaseSecondApply.resolve(undefined);
    await expect(secondAttempt).resolves.toMatchObject({ status: "completed" });
    expect(row).toEqual(expect.objectContaining({
      attemptCount: 2,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
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

    expect(mocks.applyStripeInvoiceCollectionStateChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.invoice.payment_failed",
      }),
      expect.anything(),
      canonicalSubscription,
      expect.objectContaining({
        kind: "member",
        memberId: "member_123",
      }),
    );
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        expand: expect.arrayContaining(["latest_invoice"]),
      }),
    );
  });

  it("locks the direct member before retrieving invoice canonical subscription state", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaymentFailedEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      status: "past_due",
    });
    const retrieveStarted = makeDeferred<void>();
    const releaseRetrieve = makeDeferred<Stripe.Subscription>();
    const ordering: string[] = [];
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeInvoice.mockImplementation(async () => {
      ordering.push("member-resolved");
      return { core: { id: "member_123" } };
    });
    vi.mocked(prisma.client.$queryRaw).mockImplementation(async () => {
      ordering.push("member-locked");
      return [];
    });
    mocks.stripe.subscriptions.retrieve.mockImplementation(async () => {
      ordering.push("subscription-retrieved");
      retrieveStarted.resolve(undefined);
      return releaseRetrieve.promise;
    });
    mocks.applyStripeInvoiceCollectionStateChanged.mockImplementationOnce(async () => {
      ordering.push("billing-written");
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    const reconciliation = reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    });

    await retrieveStarted.promise;
    expect(ordering).toEqual([
      "member-resolved",
      "member-locked",
      "subscription-retrieved",
    ]);

    releaseRetrieve.resolve(canonicalSubscription);
    await expect(reconciliation).resolves.toMatchObject({ status: "completed" });

    expect(ordering).toEqual([
      "member-resolved",
      "member-locked",
      "subscription-retrieved",
      "billing-written",
    ]);
  });

  it("fails closed when an invoice owner disagrees with its canonical subscription", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaymentFailedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription({
      metadata: { memberId: "member_456" },
      status: "past_due",
    }));
    mocks.findMemberForStripeInvoice.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.findMemberForStripeSubscription.mockResolvedValue({
      core: { id: "member_456" },
    });
    mocks.resolveHostedStripeBillingOwner.mockResolvedValue({
      kind: "member",
      lockMemberId: "member_456",
      memberId: "member_456",
      stripeCustomerId: "cus_456",
      stripeSubscriptionId: "sub_123",
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(mocks.applyStripeInvoiceCollectionStateChanged).not.toHaveBeenCalled();
    expect(prisma.rows[0]?.status).toBe(HostedStripeEventStatus.failed);
    errorSpy.mockRestore();
  });

  it("discards invoice identity discovery state and re-retrieves after the member lock", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaymentFailedEvent();
    const identitySubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "trialing",
    });
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "past_due",
    });
    const ordering: string[] = [];
    let retrieveCount = 0;
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeInvoice.mockImplementation(async (input: {
      subscription?: Stripe.Subscription | null;
    }) => {
      if (!input.subscription) {
        await mocks.stripe.subscriptions.retrieve("sub_123");
      }
      ordering.push("identity-resolved");
      return { core: { id: "member_123" } };
    });
    vi.mocked(prisma.client.$queryRaw).mockImplementation(async () => {
      ordering.push("member-locked");
      return [];
    });
    mocks.stripe.subscriptions.retrieve.mockImplementation(async () => {
      retrieveCount += 1;
      ordering.push(retrieveCount === 1 ? "identity-retrieved" : "canonical-retrieved");
      return retrieveCount === 1 ? identitySubscription : canonicalSubscription;
    });
    mocks.applyStripeInvoiceCollectionStateChanged.mockImplementationOnce(async () => {
      ordering.push("billing-written");
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(ordering).toEqual([
      "identity-retrieved",
      "identity-resolved",
      "member-locked",
      "canonical-retrieved",
      "billing-written",
    ]);
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.applyStripeInvoiceCollectionStateChanged).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      canonicalSubscription,
      expect.objectContaining({
        kind: "member",
        memberId: "member_123",
      }),
    );
  });

  it.each([
    ["customer.subscription.deleted", "canceled"],
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

  it("sends the cancellation feedback email after a cancellation billing write", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionEvent("customer.subscription.deleted");
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "canceled",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.applyStripeSubscriptionUpdated.mockResolvedValueOnce({
      subscriptionCancellationEmail: {
        memberId: "member_123",
        stripeSubscriptionId: "sub_123",
      },
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
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.sendHostedSubscriptionCancellationEmailForMember)
      .toHaveBeenCalledWith({
        memberId: "member_123",
        prisma: prisma.client,
        stripeSubscriptionId: "sub_123",
      });
    expect(
      mocks.sendHostedSubscriptionCancellationEmailForMember.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(prisma.client.hostedStripeEvent.updateMany).mock.invocationCallOrder.at(-1) ?? 0,
    );
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      subscriptionCancellationEmailSentAt: expect.any(Date),
    }));
    expect(mocks.sendHostedSignupWelcomeEmailForMember).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupNotificationEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("retries cancellation feedback email provider failures before completing the receipt", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionEvent("customer.subscription.deleted");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "canceled",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.applyStripeSubscriptionUpdated.mockResolvedValue({
      subscriptionCancellationEmail: {
        memberId: "member_123",
        stripeSubscriptionId: "sub_123",
      },
    });
    mocks.sendHostedSubscriptionCancellationEmailForMember
      .mockRejectedValueOnce(new Error("resend down"))
      .mockResolvedValueOnce({
        status: "sent",
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
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "failed",
    });

    expect(mocks.sendHostedSubscriptionCancellationEmailForMember).toHaveBeenCalledTimes(1);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: event.id,
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));

    prisma.rows[0].nextAttemptAt = new Date(0);

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.sendHostedSubscriptionCancellationEmailForMember).toHaveBeenCalledTimes(2);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: event.id,
      lastErrorCode: null,
      lastErrorMessage: null,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));

    errorSpy.mockRestore();
  });

  it("does not resend cancellation feedback when provider success was marked before receipt completion failed", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionEvent("customer.subscription.deleted");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "canceled",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.applyStripeSubscriptionUpdated.mockResolvedValue({
      subscriptionCancellationEmail: {
        memberId: "member_123",
        stripeSubscriptionId: "sub_123",
      },
    });
    mocks.sendHostedSubscriptionCancellationEmailForMember.mockResolvedValue({
      status: "sent",
    });

    let failedCompletion = false;
    const defaultUpdateMany = vi.mocked(prisma.client.hostedStripeEvent.updateMany)
      .getMockImplementation();
    vi.mocked(prisma.client.hostedStripeEvent.updateMany).mockImplementation(async (input) => {
      if (
        !failedCompletion &&
        input.data.status === HostedStripeEventStatus.completed
      ) {
        failedCompletion = true;
        throw new Error("receipt completion failed");
      }

      if (!defaultUpdateMany) {
        throw new Error("missing default hostedStripeEvent.updateMany mock");
      }

      return defaultUpdateMany(input);
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
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "failed",
    });

    expect(mocks.sendHostedSubscriptionCancellationEmailForMember).toHaveBeenCalledTimes(1);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: null,
      status: HostedStripeEventStatus.failed,
      subscriptionCancellationEmailSentAt: expect.any(Date),
    }));

    prisma.rows[0].nextAttemptAt = new Date(0);

    await expect(
      reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      }),
    ).resolves.toMatchObject({
      eventId: event.id,
      status: "completed",
    });

    expect(mocks.sendHostedSubscriptionCancellationEmailForMember).toHaveBeenCalledTimes(1);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      lastErrorCode: null,
      lastErrorMessage: null,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
      subscriptionCancellationEmailSentAt: expect.any(Date),
    }));

    errorSpy.mockRestore();
  });

  it("does not send the cancellation feedback email when the cancellation billing write fails", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeSubscriptionEvent("customer.subscription.deleted");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "canceled",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.applyStripeSubscriptionUpdated.mockRejectedValueOnce(
      new Error("billing write failed"),
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
      eventId: event.id,
      hostedExecutionEventId: null,
      status: "failed",
    });

    expect(mocks.sendHostedSubscriptionCancellationEmailForMember)
      .not.toHaveBeenCalled();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: event.id,
      lastErrorCode: "Error",
      lastErrorMessage: "[redacted]",
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));
    expect(errorSpy).toHaveBeenCalledWith("Hosted Stripe event reconciliation failed.", {
      attemptCount: 1,
      errorMessage: "billing write failed",
      errorName: "Error",
      eventIdSuffix: "ed_123",
      eventType: "customer.subscription.deleted",
      poisoned: false,
    });
    errorSpy.mockRestore();
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
    mocks.resolveStripeFinancialContext.mockResolvedValue({
      customerId: "cus_refund",
      invoiceId: "in_refund",
      paymentIntentId: "pi_refund",
      subscriptionId: "sub_123",
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

    expect(mocks.resolveStripeFinancialContext).toHaveBeenCalledWith({
      chargeId: "ch_refund",
      paymentIntentId: "pi_refund",
    });
    expect(mocks.applyStripeRecurringFinancialState).toHaveBeenCalledWith({
      dispatchContext: expect.objectContaining({
        sourceEventId: event.id,
        sourceType: "stripe.refund.created",
      }),
      owner: expect.objectContaining({
        kind: "member",
        memberId: "member_123",
      }),
      restoreWhenHealthy: true,
      subscription: expect.objectContaining({ id: "sub_123" }),
      tx: expect.anything(),
    });
  });

  it.each([
    ["invoice.paid", "member"],
    ["customer.subscription.updated", "family"],
  ] as const)(
    "does not apply delayed %s active projection for a canonically unsettled %s owner",
    async (type, ownerKind) => {
      const prisma = createStripeEventPrismaHarness();
      const event = type === "invoice.paid"
        ? makeInvoicePaidEvent()
        : makeSubscriptionUpdatedEvent();
      mocks.stripe.events.retrieve.mockResolvedValue(event);
      mocks.stripe.subscriptions.retrieve.mockResolvedValue(
        makeCanonicalSubscription({ status: "active" }),
      );
      mocks.applyStripeRecurringFinancialState.mockResolvedValueOnce({
        blockActiveProjection: true,
        state: "unsettled",
      });
      if (ownerKind === "family") {
        mocks.findMemberForStripeSubscription.mockResolvedValue(null);
        mocks.resolveHostedStripeBillingOwner.mockResolvedValue({
          groupId: "group_123",
          kind: "family",
          lockMemberId: "owner_123",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        });
      }

      await recordHostedStripeEvent({ event, prisma: prisma.client });

      await expect(reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      })).resolves.toMatchObject({ status: "completed" });

      expect(mocks.applyStripeRecurringFinancialState).toHaveBeenCalledOnce();
      expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
      expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    },
  );

  it.each([
    "refund.updated",
    "charge.dispute.updated",
  ] as const)(
    "routes legacy Source Charge-only %s without inventing a PaymentIntent",
    async (type) => {
      const prisma = createStripeEventPrismaHarness();
      const event = makeFinancialReversalEvent(type, {
        paymentIntentId: null,
      });
      mocks.resolveStripeFinancialContext.mockResolvedValueOnce({
        customerId: "cus_123",
        invoiceId: "in_legacy",
        paymentIntentId: null,
        subscriptionId: "sub_123",
      });
      mocks.stripe.events.retrieve.mockResolvedValue(event);

      await recordHostedStripeEvent({ event, prisma: prisma.client });

      await expect(reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      })).resolves.toMatchObject({ status: "completed" });
      expect(mocks.resolveStripeFinancialContext).toHaveBeenCalledWith({
        chargeId: "ch_financial_123",
        paymentIntentId: null,
      });
      expect(mocks.applyStripeRecurringFinancialState).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "refund.created",
    "refund.updated",
    "refund.failed",
    "charge.refund.updated",
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
    "charge.dispute.funds_reinstated",
    "charge.dispute.funds_withdrawn",
  ] as const)(
    "routes %s through canonical recurring financial reconciliation",
    async (type) => {
      const prisma = createStripeEventPrismaHarness();
      const event = makeFinancialReversalEvent(type);
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

      expect(mocks.resolveStripeFinancialContext).toHaveBeenCalledWith({
        chargeId: "ch_financial_123",
        paymentIntentId: "pi_financial_123",
      });
      expect(mocks.applyStripeRecurringFinancialState).toHaveBeenCalledOnce();
      expect(mocks.applyStripeRecurringFinancialState).toHaveBeenCalledWith({
        dispatchContext: expect.objectContaining({
          sourceEventId: event.id,
          sourceType: `stripe.${type}`,
        }),
        owner: expect.objectContaining({
          kind: "member",
          memberId: "member_123",
        }),
        restoreWhenHealthy: true,
        subscription: expect.objectContaining({ id: "sub_123" }),
        tx: expect.anything(),
      });
      expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
      expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    },
  );

  it.each([
    "invoice.payment_action_required",
    "invoice.payment_attempt_required",
    "invoice.finalization_failed",
    "invoice.marked_uncollectible",
    "invoice.voided",
  ] as const)(
    "routes %s through the shared terminal collection projector",
    async (type) => {
      const prisma = createStripeEventPrismaHarness();
      const event = makeInvoiceCollectionStateEvent(type);
      const canonicalSubscription = makeCanonicalSubscription();
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

      expect(mocks.applyStripeInvoiceCollectionStateChanged).toHaveBeenCalledOnce();
      expect(mocks.applyStripeInvoiceCollectionStateChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceEventId: event.id,
          sourceType: `stripe.${type}`,
        }),
        expect.anything(),
        canonicalSubscription,
        expect.objectContaining({
          kind: "member",
          memberId: "member_123",
        }),
      );
      expect(mocks.applyStripeRecurringFinancialState).not.toHaveBeenCalled();
    },
  );

  it("holds the exact Family owner lock while projecting a recurring financial reversal", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeFinancialReversalEvent("charge.dispute.updated");
    const ordering: string[] = [];
    const familyOwner = {
      groupId: "group_123",
      kind: "family" as const,
      lockMemberId: "owner_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    };
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.resolveHostedStripeBillingOwner.mockResolvedValue(familyOwner);
    vi.mocked(prisma.client.$queryRaw).mockImplementation(async () => {
      ordering.push("owner-locked");
      return [];
    });
    mocks.applyStripeRecurringFinancialState.mockImplementationOnce(async () => {
      ordering.push("financial-projected");
      return {
        blockActiveProjection: true,
        state: "blocked",
      };
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(ordering).toEqual(["owner-locked", "financial-projected"]);
    expect(mocks.applyStripeRecurringFinancialState).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: familyOwner,
      }),
    );
  });

  it.each([
    ["refund.updated", "blocked"],
    ["charge.dispute.funds_reinstated", "healthy"],
  ] as const)(
    "converges direct-paid Family ownership before projecting %s as %s",
    async (type, financialState) => {
      const prisma = createStripeEventPrismaHarness();
      const event = makeFinancialReversalEvent(type);
      const canonicalSubscription = makeCanonicalSubscription({
        metadata: {
          kind: "hosted_family_plan",
        },
      });
      const ordering: string[] = [];
      const memberOwner = {
        kind: "member" as const,
        lockMemberId: "member_123",
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      };
      const familyOwner = {
        groupId: "group_123",
        kind: "family" as const,
        lockMemberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      };
      mocks.stripe.events.retrieve.mockResolvedValue(event);
      mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
      mocks.resolveHostedStripeBillingOwner
        .mockResolvedValueOnce(memberOwner)
        .mockResolvedValueOnce(memberOwner)
        .mockResolvedValue(familyOwner);
      vi.mocked(prisma.client.$queryRaw).mockImplementation(async () => {
        ordering.push("owner-locked");
        return [];
      });
      mocks.convergeHostedFamilyDirectPaidOwnershipTx
        .mockImplementationOnce(async () => {
          ordering.push("ownership-converged");
          return { groupId: "group_123" };
        });
      mocks.applyStripeRecurringFinancialState.mockImplementationOnce(async () => {
        ordering.push("financial-projected");
        return {
          blockActiveProjection: financialState === "blocked",
          state: financialState,
        };
      });

      await recordHostedStripeEvent({ event, prisma: prisma.client });

      await expect(reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      })).resolves.toMatchObject({ status: "completed" });

      expect(ordering).toEqual([
        "owner-locked",
        "ownership-converged",
        "financial-projected",
      ]);
      expect(mocks.convergeHostedFamilyDirectPaidOwnershipTx).toHaveBeenCalledWith({
        eventCreatedAt: new Date(event.created * 1000),
        subscription: canonicalSubscription,
        tx: expect.anything(),
        verifiedOwnerMemberId: "member_123",
      });
      expect(mocks.applyStripeRecurringFinancialState).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: familyOwner,
          restoreWhenHealthy: true,
          subscription: canonicalSubscription,
        }),
      );
    },
  );

  it("fails closed when exact Family ownership changes after the owner lock", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeFinancialReversalEvent("refund.updated");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.resolveHostedStripeBillingOwner
      .mockResolvedValueOnce({
        groupId: "group_123",
        kind: "family",
        lockMemberId: "owner_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      })
      .mockResolvedValue({
        groupId: "group_456",
        kind: "family",
        lockMemberId: "owner_456",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.client.$queryRaw).toHaveBeenCalledOnce();
    expect(mocks.applyStripeRecurringFinancialState).not.toHaveBeenCalled();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: null,
      status: HostedStripeEventStatus.failed,
    }));
    errorSpy.mockRestore();
  });

  it.each([
    ["customer.subscription.pending_update_applied", false],
    ["customer.subscription.pending_update_expired", true],
  ] as const)(
    "reconciles %s Family transition metadata only after the owner lock",
    async (type, isTerminal) => {
      const prisma = createStripeEventPrismaHarness();
      const event = makePendingUpdateEvent(type);
      const canonicalSubscription = makeCanonicalSubscription();
      const ordering: string[] = [];
      mocks.stripe.events.retrieve.mockResolvedValue(event);
      mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
      mocks.readHostedFamilyDirectPaidTransitionContext.mockReturnValue({
        ownerMemberId: "member_123",
      });
      vi.mocked(prisma.client.$queryRaw).mockImplementation(async () => {
        ordering.push("owner-locked");
        return [];
      });
      mocks.reconcileHostedFamilyDirectPaidTransitionSubscription
        .mockImplementationOnce(async () => {
          ordering.push("transition-reconciled");
          return canonicalSubscription;
        });

      await recordHostedStripeEvent({ event, prisma: prisma.client });

      await expect(reconcileHostedStripeEventById({
        eventId: event.id,
        prisma: prisma.client,
      })).resolves.toMatchObject({ status: "completed" });

      expect(ordering).toEqual(["owner-locked", "transition-reconciled"]);
      const transitionInput =
        mocks.reconcileHostedFamilyDirectPaidTransitionSubscription.mock.calls[0]?.[0];
      expect(transitionInput).toEqual(expect.objectContaining({
        subscription: canonicalSubscription,
        verifiedOwnerMemberId: "member_123",
      }));
      if (isTerminal) {
        expect(transitionInput).toEqual(expect.objectContaining({
          terminalProviderProof: "pending_update_expired",
        }));
      } else {
        expect(transitionInput).not.toHaveProperty("terminalProviderProof");
      }
    },
  );

  it("uses an exact voided latest update invoice as terminal Family transition proof", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeStripeEvent({
      api_version: "2025-03-31.basil",
      created: 1_774_708_807,
      data: {
        object: {
          billing_reason: "subscription_update",
          customer: "cus_123",
          id: "in_family_update",
          lines: {
            data: [{
              amount: 1_000,
              parent: {
                subscription_item_details: {
                  proration: true,
                  subscription: "sub_123",
                  subscription_item: "si_current",
                },
              },
              pricing: {
                price_details: {
                  price: "price_family",
                },
              },
              quantity: 2,
            }],
            has_more: false,
          },
          status: "void",
          subscription: "sub_123",
        },
      },
      id: "evt_invoice_voided_family_update",
      livemode: false,
      object: "event",
      pending_webhooks: 0,
      request: {
        id: null,
        idempotency_key: null,
      },
      type: "invoice.voided",
    });
    const canonicalSubscription = {
      ...makeCanonicalSubscription(),
      items: {
        data: [{
          id: "si_current",
          price: {
            id: "price_pulse",
          },
          quantity: 1,
        }],
      },
      latest_invoice: "in_family_update",
      pending_update: null,
    } as Stripe.Subscription;
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.readHostedFamilyDirectPaidTransitionContext.mockReturnValue({
      ownerMemberId: "member_123",
    });
    mocks.reconcileHostedFamilyDirectPaidTransitionSubscription
      .mockResolvedValueOnce(canonicalSubscription);

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(
      mocks.reconcileHostedFamilyDirectPaidTransitionSubscription,
    ).toHaveBeenCalledWith(expect.objectContaining({
      subscription: canonicalSubscription,
      terminalProviderProof: "invoice_voided",
      verifiedOwnerMemberId: "member_123",
    }));
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
      lastErrorCode: "HOSTED_STRIPE_EVENT_RETRIEVE_RETRYABLE",
      lastErrorMessage: "[redacted]",
      status: HostedStripeEventStatus.failed,
    }));
    expect(errorSpy).toHaveBeenCalledWith("Hosted Stripe event reconciliation failed.", {
      attemptCount: 1,
      errorMessage: "Stripe unavailable",
      errorName: "HostedStripeEventRetrieveRetryableError",
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
          checkoutOffer: "standard",
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

function makeCheckoutExpiredEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708802,
    data: {
      object: {
        client_reference_id: "member_123",
        customer: "cus_checkout",
        id: "cs_checkout_expired_123",
        metadata: {
          checkoutOffer: "standard",
          memberId: "member_123",
        },
        status: "expired",
        subscription: null,
      },
    },
    id: "evt_checkout_expired_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "checkout.session.expired",
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
          trialPolicyVersion: "pulse-trial-2026-06-30-v2",
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

function makeExactPulseTrialCheckoutCompletedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1_774_708_801,
    data: {
      object: {
        client_reference_id: "member_123",
        customer: "cus_checkout",
        id: "cs_exact_trial_123",
        metadata: makeExactPulseTrialMetadata(),
        mode: "subscription",
        status: "complete",
        subscription: "sub_checkout_123",
      },
    },
    id: "evt_exact_trial_checkout_completed_123",
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

function makeExactPulseTrialSubscriptionCreatedEvent(): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1_774_708_800,
    data: {
      object: {
        customer: "cus_checkout",
        id: "sub_checkout_123",
        metadata: makeExactPulseTrialMetadata(),
        status: "trialing",
      },
    },
    id: "evt_exact_trial_subscription_created_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "customer.subscription.created",
  });
}

function makeExactPulseTrialSubscription(
  status: Stripe.Subscription.Status,
): Stripe.Subscription {
  return {
    customer: "cus_checkout",
    id: "sub_checkout_123",
    items: {
      data: [{
        id: "si_pulse_123",
        price: {
          id: "price_pulse_monthly_123",
          recurring: {
            interval: "month",
            usage_type: "licensed",
          },
        },
        quantity: 1,
      }],
      has_more: false,
    },
    metadata: makeExactPulseTrialMetadata(),
    status,
    trial_end: 1_775_313_600,
    trial_start: 1_774_708_000,
  } as Stripe.Subscription;
}

function makeExactPulseTrialMetadata(): Record<string, string> {
  return {
    billingPlanCode: "launch_monthly",
    checkoutOffer: "pulse_trial_7d",
    memberId: "member_123",
    trialDurationDays: "10",
    trialPolicyVersion: "pulse-trial-2026-06-30-v2",
    trialUsageLimitUsdMicros: "4500000",
  };
}

function makeActiveNonTrialMemberWithoutSubscription() {
  return {
    billingRef: {
      currentBillingPhase: null,
      memberId: "member_123",
      pulseTrialRedeemedAt: null,
      stripeCustomerId: "cus_checkout",
      stripeSubscriptionId: null,
    },
    core: {
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-03-28T12:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-03-28T12:00:00.000Z"),
    },
  };
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
    | "customer.subscription.created"
    | "customer.subscription.deleted"
    | "customer.subscription.pending_update_applied"
    | "customer.subscription.pending_update_expired"
    | "customer.subscription.paused"
    | "customer.subscription.resumed"
    | "customer.subscription.trial_will_end",
  overrides?: {
    metadata?: Record<string, string>;
  },
): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708805,
    data: {
      object: {
        customer: "cus_subscription",
        id: "sub_123",
        metadata: overrides?.metadata ?? {
          memberId: "member_123",
        },
        status: type === "customer.subscription.deleted"
          ? "canceled"
          : type === "customer.subscription.paused"
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

type FinancialReversalEventType =
  | "refund.created"
  | "refund.updated"
  | "refund.failed"
  | "charge.refund.updated"
  | "charge.refunded"
  | "charge.dispute.created"
  | "charge.dispute.updated"
  | "charge.dispute.closed"
  | "charge.dispute.funds_reinstated"
  | "charge.dispute.funds_withdrawn";

function makeFinancialReversalEvent(
  type: FinancialReversalEventType,
  input?: {
    paymentIntentId?: string | null;
  },
): Stripe.Event {
  const paymentIntentId =
    input && "paymentIntentId" in input
      ? input.paymentIntentId
      : "pi_financial_123";
  const object = type === "charge.refunded"
    ? {
        id: "ch_financial_123",
        payment_intent: paymentIntentId,
      }
    : type.startsWith("charge.dispute.")
    ? {
        charge: "ch_financial_123",
        id: "dp_financial_123",
        payment_intent: paymentIntentId,
      }
    : {
        charge: "ch_financial_123",
        id: "re_financial_123",
        payment_intent: paymentIntentId,
      };

  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708806,
    data: {
      object,
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

type InvoiceCollectionStateEventType =
  | "invoice.payment_action_required"
  | "invoice.payment_attempt_required"
  | "invoice.finalization_failed"
  | "invoice.marked_uncollectible"
  | "invoice.voided";

function makeInvoiceCollectionStateEvent(
  type: InvoiceCollectionStateEventType,
): Stripe.Event {
  return makeStripeEvent({
    api_version: "2025-03-31.basil",
    created: 1774708807,
    data: {
      object: {
        customer: "cus_123",
        id: "in_collection_123",
        subscription: "sub_123",
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

function makePendingUpdateEvent(
  type:
    | "customer.subscription.pending_update_applied"
    | "customer.subscription.pending_update_expired",
): Stripe.Event {
  return makeSubscriptionEvent(type);
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
    $queryRaw: vi.fn(async () => []),
    $transaction: transaction,
    hostedMember: {
      findMany: vi.fn(async (input: {
        where: { id: { in: string[] } };
      }) => input.where.id.in.map((id) => ({ id }))),
    },
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
          subscriptionCancellationEmailSentAt: null,
          type: data.type as string,
          updatedAt: new Date(),
        };
        rows.push(row);
        return row;
      }),
      findMany: vi.fn(async () => rows),
      findUnique: vi.fn(async ({ where }: { where: { eventId: string } }) => {
        const row = rows.find((candidate) => candidate.eventId === where.eventId);
        return row ? { ...row } : null;
      }),
      updateMany: vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: StripeEventWhere }) => {
        const row = rows.find((candidate) => matchesStripeEventWhere(candidate, where));

        if (!row) {
          return { count: 0 };
        }

        if ("subscriptionCancellationEmailSentAt" in data) {
          row.subscriptionCancellationEmailSentAt =
            data.subscriptionCancellationEmailSentAt as Date;
          row.updatedAt = new Date();
          return { count: 1 };
        }

        if (data.attemptCount && typeof data.attemptCount === "object") {
          row.attemptCount += (data.attemptCount as { increment: number }).increment;
          row.claimExpiresAt = data.claimExpiresAt as Date;
          row.lastErrorCode = data.lastErrorCode as string | null;
          row.lastErrorMessage = data.lastErrorMessage as string | null;
          row.nextAttemptAt = data.nextAttemptAt as Date;
          row.status = data.status as HostedStripeEventStatus;
        } else {
          Object.assign(row, data);
        }
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

function makeDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

function matchesStripeEventWhere(row: MutableStripeEventRow, where: StripeEventWhere): boolean {
  if (where.eventId && row.eventId !== where.eventId) {
    return false;
  }

  if (where.updatedAt && row.updatedAt.getTime() !== where.updatedAt.getTime()) {
    return false;
  }

  if (where.attemptCount !== undefined && row.attemptCount !== where.attemptCount) {
    return false;
  }

  if (where.status !== undefined && row.status !== where.status) {
    return false;
  }

  if (
    where.subscriptionCancellationEmailSentAt === null
    && row.subscriptionCancellationEmailSentAt !== null
  ) {
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
  subscriptionCancellationEmailSentAt: Date | null;
  type: string;
  updatedAt: Date;
};

type StripeEventWhere = {
  attemptCount?: number;
  eventId?: string;
  status?: HostedStripeEventStatus;
  subscriptionCancellationEmailSentAt?: null;
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

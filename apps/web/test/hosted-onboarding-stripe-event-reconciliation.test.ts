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
  cancelHostedPulseTrialCheckoutLoserSubscription: vi.fn(),
  clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx: vi.fn(),
  findMemberForStripeCheckoutSession: vi.fn(),
  findMemberForStripeInvoice: vi.fn(),
  findMemberForStripeSubscription: vi.fn(),
  executeHostedFamilyPaymentConflictCompensation: vi.fn(),
  listHostedStripeCheckoutSessionMemberIds: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx: vi.fn(),
  resolveStripeCustomerContext: vi.fn(),
  sendHostedSignupNotificationEmailForMemberBestEffort: vi.fn(),
  sendHostedSignupWelcomeEmailForMember: vi.fn(),
  sendHostedSubscriptionCancellationEmailForMember: vi.fn(),
  stripe: {
    events: {
      retrieve: vi.fn(),
    },
    invoices: {
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
  applyStripeDisputeUpdated: mocks.applyStripeDisputeUpdated,
  applyStripeInvoicePaid: mocks.applyStripeInvoicePaid,
  applyStripeInvoicePaymentFailed: mocks.applyStripeInvoicePaymentFailed,
  applyStripeRefundCreated: mocks.applyStripeRefundCreated,
  applyStripeSubscriptionUpdated: mocks.applyStripeSubscriptionUpdated,
  cancelHostedPulseTrialCheckoutLoserSubscription:
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription,
  executeHostedFamilyPaymentConflictCompensation:
    mocks.executeHostedFamilyPaymentConflictCompensation,
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
    resolveStripeCustomerContext: mocks.resolveStripeCustomerContext,
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

import {
  reconcileHostedStripeEventById as reconcileHostedStripeEventByIdImpl,
  recordHostedStripeEvent as recordHostedStripeEventImpl,
} from "@/src/lib/hosted-onboarding/stripe-event-reconciliation";
import {
  acceptHostedFamilyPaymentConflictCompensationTx,
  type HostedFamilyPaymentConflictCompensation,
} from "@/src/lib/hosted-onboarding/stripe-family-compensation";

type HostedStripeEventRecordInput = Parameters<typeof recordHostedStripeEventImpl>[0];
type HostedStripeEventReconcileInput = Parameters<typeof reconcileHostedStripeEventByIdImpl>[0];

type StripeEventPrismaHarnessClient = {
  $queryRaw: (...args: unknown[]) => Promise<unknown>;
  $transaction: <T>(callback: (tx: StripeEventPrismaHarnessClient) => Promise<T>) => Promise<T>;
  hostedAccountGroupMembership: {
    findFirst: () => Promise<{ id: string } | null>;
  };
  hostedMemberBillingRef: {
    updateMany: () => Promise<{ count: number }>;
  };
  hostedStripeEvent: {
    create: ({ data }: { data: Record<string, unknown> }) => Promise<MutableStripeEventRow>;
    findMany: (input?: {
      where?: {
        familyPaymentConflictCompensationAcceptedAt?: { not: null };
        familyPaymentConflictCompensationSubscriptionLookupKey?: string | { in: string[] };
      };
    }) => Promise<MutableStripeEventRow[]>;
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

async function acceptTestFamilyPaymentConflictCompensation(input: {
  compensation: HostedFamilyPaymentConflictCompensation;
  prisma: StripeEventPrismaHarnessClient;
}): Promise<HostedFamilyPaymentConflictCompensation> {
  return acceptHostedFamilyPaymentConflictCompensationTx({
    compensation: input.compensation,
    encryptionMemberId: "member_family_owner",
    // @ts-expect-error - the Prisma harness implements the receipt methods used here.
    tx: input.prisma,
  });
}

describe("hosted Stripe event reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription.mockReset();
    mocks.executeHostedFamilyPaymentConflictCompensation.mockReset();
    mocks.stripe.events.retrieve.mockReset();
    mocks.stripe.subscriptions.cancel.mockReset();
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
    mocks.applyStripeInvoicePaymentFailed.mockResolvedValue({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.applyStripeRefundCreated.mockResolvedValue(undefined);
    mocks.applyStripeSubscriptionUpdated.mockResolvedValue({
      activatedMemberId: null,
      activatedMembers: [],
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription.mockResolvedValue(undefined);
    mocks.executeHostedFamilyPaymentConflictCompensation.mockResolvedValue(undefined);
    mocks.clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx.mockResolvedValue(undefined);
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
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(null);
    mocks.refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx.mockResolvedValue(undefined);
    mocks.resolveStripeCustomerContext.mockResolvedValue({
      customerId: null,
    });
    mocks.sendHostedSignupWelcomeEmailForMember.mockResolvedValue({
      providerMessageId: "resend_email_123",
      status: "sent",
    });
    mocks.sendHostedSignupNotificationEmailForMemberBestEffort.mockResolvedValue(undefined);
    mocks.sendHostedSubscriptionCancellationEmailForMember.mockResolvedValue({
      status: "sent",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription());
    mocks.stripe.invoices.list.mockResolvedValue({ data: [] });
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
    expect(prisma.rows[0]?.familyPaymentConflictCompensationCandidateSubscriptionLookupKey)
      .toEqual(expect.any(String));
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
    );
    expect(mocks.sendHostedSignupWelcomeEmailForMember).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupNotificationEmailForMemberBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedSubscriptionCancellationEmailForMember).not.toHaveBeenCalled();
  });

  it("fails before standard Checkout handling when ownership changes under the member lock", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const ordering: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.findMemberForStripeCheckoutSession
      .mockImplementationOnce(async () => {
        ordering.push("owner-resolved");
        return { core: { id: "member_123" } };
      })
      .mockImplementationOnce(async () => {
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
      attemptCount: 1,
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

  it("binds a newly accepted Family conflict to the exact paid invoice before compensation", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaidEvent({
      id: "evt_family_invoice_conflict",
      invoiceId: "in_family_conflict_exact",
    });
    const compensation = {
      effectId: event.id,
      invoiceId: null,
      subscriptionId: "sub_123",
    };
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.applyStripeInvoicePaid.mockImplementationOnce(async (
      _invoice,
      _dispatchContext,
      tx,
    ) => {
      await acceptHostedFamilyPaymentConflictCompensationTx({
        compensation,
        encryptionMemberId: "member_family_owner",
        tx,
      });
      return {
        activatedMemberId: null,
        familyPaymentConflictCompensation: compensation,
        hostedExecutionEventId: null,
        welcomeEmailMemberId: null,
      };
    });

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.executeHostedFamilyPaymentConflictCompensation).toHaveBeenCalledWith({
      effectId: event.id,
      invoiceId: "in_family_conflict_exact",
      subscriptionId: "sub_123",
    });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      familyPaymentConflictCompensationInvoiceIdEncrypted: expect.any(String),
      familyPaymentConflictCompensationInvoiceLookupKey: expect.any(String),
    }));
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
      attemptCount: 0,
      processedAt: null,
      status: HostedStripeEventStatus.pending,
    }));
    expect(prisma.client.hostedMemberBillingRef.updateMany).toHaveBeenCalledOnce();

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

  it("retries an accepted legacy Family checkout effect without reloading mutable event state", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const session = event.data.object as Stripe.Checkout.Session;
    session.invoice = null;
    session.metadata = {
      ...session.metadata,
      kind: "hosted_family_plan",
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.executeHostedFamilyPaymentConflictCompensation
      .mockRejectedValueOnce(new Error("temporary Stripe refund failure"))
      .mockResolvedValueOnce(undefined);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: event.id,
        invoiceId: "in_checkout_123",
        subscriptionId: "sub_checkout_123",
      },
      prisma: prisma.client,
    });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      familyPaymentConflictCompensationAcceptedAt: expect.any(Date),
      familyPaymentConflictCompensationEncryptionMemberId: "member_family_owner",
      familyPaymentConflictCompensationInvoiceIdEncrypted: expect.any(String),
      familyPaymentConflictCompensationInvoiceLookupKey: expect.any(String),
      familyPaymentConflictCompensationSubscriptionIdEncrypted: expect.any(String),
      familyPaymentConflictCompensationSubscriptionLookupKey: expect.any(String),
      processedAt: null,
      status: HostedStripeEventStatus.pending,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(
      mocks.executeHostedFamilyPaymentConflictCompensation,
    ).toHaveBeenCalledTimes(2);
    expect(mocks.applyStripeCheckoutCompleted).not.toHaveBeenCalled();
    expect(mocks.stripe.events.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.invoices.list).not.toHaveBeenCalled();
    expect(
      mocks.executeHostedFamilyPaymentConflictCompensation,
    ).toHaveBeenCalledWith({
      effectId: event.id,
      invoiceId: "in_checkout_123",
      subscriptionId: "sub_checkout_123",
    });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("keeps an attempt-six legacy Family provider failure pending without poisoning", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.executeHostedFamilyPaymentConflictCompensation
      .mockRejectedValueOnce(new Error("temporary Stripe provider failure"))
      .mockResolvedValueOnce(undefined);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: event.id,
        invoiceId: "in_checkout_123",
        subscriptionId: "sub_checkout_123",
      },
      prisma: prisma.client,
    });
    prisma.rows[0]!.attemptCount = 5;
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 5,
      processedAt: null,
      status: HostedStripeEventStatus.pending,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(
      mocks.executeHostedFamilyPaymentConflictCompensation,
    ).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.events.retrieve).not.toHaveBeenCalled();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("keeps every accepted legacy Family provider failure pending before success", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.executeHostedFamilyPaymentConflictCompensation
      .mockRejectedValueOnce(Object.assign(new Error("refund pending"), {
        code: "HOSTED_FAMILY_PAYMENT_CONFLICT_REFUND_PENDING",
      }))
      .mockRejectedValueOnce(new Error("refund failed"))
      .mockResolvedValueOnce(undefined);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: event.id,
        invoiceId: "in_checkout_123",
        subscriptionId: "sub_checkout_123",
      },
      prisma: prisma.client,
    });
    await reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 0,
      status: HostedStripeEventStatus.pending,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 0,
      processedAt: null,
      status: HostedStripeEventStatus.pending,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });
    expect(
      mocks.executeHostedFamilyPaymentConflictCompensation,
    ).toHaveBeenCalledTimes(3);
    expect(mocks.stripe.events.retrieve).not.toHaveBeenCalled();
    errorSpy.mockRestore();
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
    prisma.rows[0]!.attemptCount = 5;
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 5,
      pulseTrialCleanupAcceptedAt: expect.any(Date),
      pulseTrialCleanupEncryptionMemberId: "member_123",
      pulseTrialCleanupSubscriptionIdEncrypted: expect.any(String),
      status: HostedStripeEventStatus.pending,
    }));
    mocks.stripe.events.retrieve.mockRejectedValueOnce(
      new Error("Stripe event retrieval unavailable"),
    );
    prisma.rows[0].nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.cancelHostedPulseTrialCheckoutLoserSubscription).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.events.retrieve).toHaveBeenCalledOnce();
    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledOnce();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: expect.any(Date),
      pulseTrialCleanupAcceptedAt: null,
      pulseTrialCleanupEncryptionMemberId: null,
      pulseTrialCleanupSubscriptionIdEncrypted: null,
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("keeps an accepted attempt-six Pulse cleanup pending when final receipt completion fails", async () => {
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
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription.mockResolvedValue(undefined);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;
    const updateMany = vi.mocked(prisma.client.hostedStripeEvent.updateMany);
    const applyUpdate = updateMany.getMockImplementation();
    if (!applyUpdate) {
      throw new Error("expected hosted Stripe event update implementation");
    }
    let failReceiptCompletion = true;
    updateMany.mockImplementation(async (input) => {
      if (
        failReceiptCompletion &&
        input.data.status === HostedStripeEventStatus.completed
      ) {
        failReceiptCompletion = false;
        throw new Error("final receipt completion unavailable");
      }
      return applyUpdate(input);
    });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 5,
      pulseTrialCleanupAcceptedAt: expect.any(Date),
      status: HostedStripeEventStatus.pending,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });
    expect(mocks.stripe.events.retrieve).toHaveBeenCalledOnce();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: expect.any(Date),
      pulseTrialCleanupAcceptedAt: null,
      status: HostedStripeEventStatus.completed,
    }));
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
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 0,
      status: HostedStripeEventStatus.pending,
    }));

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
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123");
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
      "member-resolved",
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
    const firstAttempt = reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    });

    await firstApplyStarted.promise;
    expect(prisma.rows[0]?.claimExpiresAt?.getTime() ?? 0)
      .toBeGreaterThan(Date.now() + 20 * 60_000);

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
    await expect(firstAttempt).resolves.toMatchObject({ status: "completed" });
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

  it("retries accepted legacy Family cancellation without recomputing owner eligibility", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeInvoicePaymentFailedEvent();
    const canonicalSubscription = makeCanonicalSubscription({
      id: "sub_123",
      metadata: {
        accountGroupId: "hbag_family",
        kind: "hosted_family_plan",
      },
      status: "past_due",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.executeHostedFamilyPaymentConflictCompensation
      .mockRejectedValueOnce(new Error("temporary Stripe cancellation failure"))
      .mockResolvedValueOnce(undefined);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: event.id,
        invoiceId: null,
        subscriptionId: canonicalSubscription.id,
      },
      prisma: prisma.client,
    });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: null,
      status: HostedStripeEventStatus.pending,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.executeHostedFamilyPaymentConflictCompensation).toHaveBeenCalledTimes(2);
    expect(mocks.executeHostedFamilyPaymentConflictCompensation).toHaveBeenCalledWith({
      effectId: event.id,
      invoiceId: null,
      subscriptionId: "sub_123",
    });
    expect(mocks.applyStripeInvoicePaymentFailed).not.toHaveBeenCalled();
    expect(mocks.stripe.events.retrieve).not.toHaveBeenCalled();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
  });

  it("routes sibling subscription events through the existing Family compensation owner", async () => {
    const prisma = createStripeEventPrismaHarness();
    const ownerEvent = makeInvoicePaymentFailedEvent();
    await recordHostedStripeEvent({ event: ownerEvent, prisma: prisma.client });
    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: ownerEvent.id,
        invoiceId: null,
        subscriptionId: "sub_123",
      },
      prisma: prisma.client,
    });
    prisma.rows[0]!.processedAt = new Date();
    prisma.rows[0]!.status = HostedStripeEventStatus.completed;

    const siblingEvent = makeSubscriptionEvent("customer.subscription.created");
    siblingEvent.id = "evt_family_sibling";
    mocks.stripe.events.retrieve.mockResolvedValue(siblingEvent);
    await recordHostedStripeEvent({ event: siblingEvent, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: siblingEvent.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.executeHostedFamilyPaymentConflictCompensation).toHaveBeenCalledWith({
      effectId: ownerEvent.id,
      invoiceId: null,
      subscriptionId: "sub_123",
    });
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("routes a pre-backfill sibling event through the existing Family compensation owner", async () => {
    const prisma = createStripeEventPrismaHarness();
    const ownerEvent = makeInvoicePaymentFailedEvent();
    await recordHostedStripeEvent({ event: ownerEvent, prisma: prisma.client });
    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: ownerEvent.id,
        invoiceId: null,
        subscriptionId: "sub_123",
      },
      prisma: prisma.client,
    });
    prisma.rows[0]!.processedAt = new Date();
    prisma.rows[0]!.status = HostedStripeEventStatus.completed;

    const siblingEvent = makeSubscriptionEvent("customer.subscription.created");
    siblingEvent.id = "evt_family_legacy_sibling";
    mocks.stripe.events.retrieve.mockResolvedValue(siblingEvent);
    await recordHostedStripeEvent({ event: siblingEvent, prisma: prisma.client });
    prisma.rows[1]!.familyPaymentConflictCompensationCandidateSubscriptionLookupKey = null;

    await expect(reconcileHostedStripeEventById({
      eventId: siblingEvent.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.stripe.events.retrieve).toHaveBeenCalledWith(siblingEvent.id);
    expect(mocks.executeHostedFamilyPaymentConflictCompensation).toHaveBeenCalledWith({
      effectId: ownerEvent.id,
      invoiceId: null,
      subscriptionId: "sub_123",
    });
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("promotes a cancel-only owner when the sibling checkout supplies the exact invoice", async () => {
    const prisma = createStripeEventPrismaHarness();
    const ownerEvent = makeSubscriptionEvent("customer.subscription.created");
    ownerEvent.id = "evt_family_compensation_owner";
    await recordHostedStripeEvent({ event: ownerEvent, prisma: prisma.client });
    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: ownerEvent.id,
        invoiceId: null,
        subscriptionId: "sub_checkout_123",
      },
      prisma: prisma.client,
    });
    prisma.rows[0]!.processedAt = new Date();
    prisma.rows[0]!.status = HostedStripeEventStatus.completed;

    const checkoutEvent = makeCheckoutCompletedEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(checkoutEvent);
    await recordHostedStripeEvent({ event: checkoutEvent, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: checkoutEvent.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.executeHostedFamilyPaymentConflictCompensation).toHaveBeenCalledWith({
      effectId: ownerEvent.id,
      invoiceId: "in_checkout_123",
      subscriptionId: "sub_checkout_123",
    });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      familyPaymentConflictCompensationInvoiceIdEncrypted: expect.any(String),
      familyPaymentConflictCompensationInvoiceLookupKey: expect.any(String),
    }));
    expect(mocks.applyStripeCheckoutCompleted).not.toHaveBeenCalled();
  });

  it("promotes a pre-existing cancel-only owner from the sibling paid invoice", async () => {
    const prisma = createStripeEventPrismaHarness();
    const ownerEvent = makeSubscriptionEvent("customer.subscription.created");
    ownerEvent.id = "evt_family_invoice_compensation_owner";
    await recordHostedStripeEvent({ event: ownerEvent, prisma: prisma.client });
    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: ownerEvent.id,
        invoiceId: null,
        subscriptionId: "sub_123",
      },
      prisma: prisma.client,
    });
    prisma.rows[0]!.processedAt = new Date();
    prisma.rows[0]!.status = HostedStripeEventStatus.completed;

    const invoiceEvent = makeInvoicePaidEvent({
      id: "evt_family_sibling_invoice_paid",
      invoiceId: "in_family_sibling_exact",
    });
    mocks.stripe.events.retrieve.mockResolvedValue(invoiceEvent);
    await recordHostedStripeEvent({ event: invoiceEvent, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: invoiceEvent.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.executeHostedFamilyPaymentConflictCompensation).toHaveBeenCalledWith({
      effectId: ownerEvent.id,
      invoiceId: "in_family_sibling_exact",
      subscriptionId: "sub_123",
    });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      familyPaymentConflictCompensationInvoiceIdEncrypted: expect.any(String),
      familyPaymentConflictCompensationInvoiceLookupKey: expect.any(String),
    }));
    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
  });

  it("keeps attempt-six invoice discovery failures pending after matching an accepted owner", async () => {
    const prisma = createStripeEventPrismaHarness();
    const ownerEvent = makeSubscriptionEvent("customer.subscription.created");
    ownerEvent.id = "evt_family_compensation_owner";
    await recordHostedStripeEvent({ event: ownerEvent, prisma: prisma.client });
    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: ownerEvent.id,
        invoiceId: null,
        subscriptionId: "sub_checkout_123",
      },
      prisma: prisma.client,
    });
    prisma.rows[0]!.processedAt = new Date();
    prisma.rows[0]!.status = HostedStripeEventStatus.completed;

    const checkoutEvent = makeCheckoutCompletedEvent();
    (checkoutEvent.data.object as Stripe.Checkout.Session).invoice = null;
    await recordHostedStripeEvent({ event: checkoutEvent, prisma: prisma.client });
    prisma.rows[1]!.attemptCount = 5;
    mocks.stripe.events.retrieve.mockResolvedValue(checkoutEvent);
    mocks.stripe.invoices.list.mockRejectedValueOnce(new Error("Stripe unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(reconcileHostedStripeEventById({
      eventId: checkoutEvent.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[1]).toEqual(expect.objectContaining({
      attemptCount: 5,
      processedAt: null,
      status: HostedStripeEventStatus.pending,
    }));
    expect(mocks.executeHostedFamilyPaymentConflictCompensation).not.toHaveBeenCalled();

    prisma.rows[1]!.nextAttemptAt = new Date(0);
    mocks.stripe.invoices.list.mockResolvedValueOnce({
      data: [{
        billing_reason: "subscription_create",
        id: "in_checkout_123",
      }],
      has_more: false,
    });
    await expect(reconcileHostedStripeEventById({
      eventId: checkoutEvent.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });
    expect(mocks.executeHostedFamilyPaymentConflictCompensation).toHaveBeenCalledWith({
      effectId: ownerEvent.id,
      invoiceId: "in_checkout_123",
      subscriptionId: "sub_checkout_123",
    });
    errorSpy.mockRestore();
  });

  it("keeps attempt-six event retrieval failures pending for a candidate-linked owner", async () => {
    const prisma = createStripeEventPrismaHarness();
    const ownerEvent = makeSubscriptionEvent("customer.subscription.created");
    ownerEvent.id = "evt_family_compensation_owner";
    await recordHostedStripeEvent({ event: ownerEvent, prisma: prisma.client });
    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: ownerEvent.id,
        invoiceId: null,
        subscriptionId: "sub_checkout_123",
      },
      prisma: prisma.client,
    });
    prisma.rows[0]!.processedAt = new Date();
    prisma.rows[0]!.status = HostedStripeEventStatus.completed;

    const checkoutEvent = makeCheckoutCompletedEvent();
    await recordHostedStripeEvent({ event: checkoutEvent, prisma: prisma.client });
    prisma.rows[1]!.attemptCount = 5;
    mocks.stripe.events.retrieve.mockRejectedValueOnce(new Error("Stripe unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(reconcileHostedStripeEventById({
      eventId: checkoutEvent.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[1]).toEqual(expect.objectContaining({
      attemptCount: 5,
      processedAt: null,
      status: HostedStripeEventStatus.pending,
    }));
    errorSpy.mockRestore();
  });

  it("uses the ordinary poison budget when no compensation receipt was accepted", async () => {
    const prisma = createStripeEventPrismaHarness();
    const checkoutEvent = makeCheckoutCompletedEvent();
    await recordHostedStripeEvent({ event: checkoutEvent, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;
    prisma.rows[0]!.familyPaymentConflictCompensationCandidateSubscriptionLookupKey = null;
    mocks.stripe.events.retrieve.mockRejectedValueOnce(new Error("Stripe unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(reconcileHostedStripeEventById({
      eventId: checkoutEvent.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.poisoned,
    }));
    errorSpy.mockRestore();
  });

  it("poisons an attempt-six Pulse checkout failure after Family classification", async () => {
    const prisma = createStripeEventPrismaHarness();
    const checkoutEvent = makePulseTrialCheckoutCompletedEvent();
    await recordHostedStripeEvent({ event: checkoutEvent, prisma: prisma.client });
    prisma.rows[0]!.attemptCount = 5;
    mocks.stripe.events.retrieve.mockResolvedValueOnce(checkoutEvent);
    mocks.applyStripeCheckoutCompleted.mockRejectedValueOnce(
      new Error("deterministic Pulse checkout failure"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(reconcileHostedStripeEventById({
      eventId: checkoutEvent.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 6,
      processedAt: null,
      status: HostedStripeEventStatus.poisoned,
    }));
    errorSpy.mockRestore();
  });

  it("rechecks candidate ownership when acceptance commits during failed event retrieval", async () => {
    const prisma = createStripeEventPrismaHarness();
    const ownerEvent = makeSubscriptionEvent("customer.subscription.created");
    ownerEvent.id = "evt_family_compensation_owner";
    await recordHostedStripeEvent({ event: ownerEvent, prisma: prisma.client });

    const siblingEvent = makeSubscriptionUpdatedEvent();
    siblingEvent.id = "evt_family_compensation_racing_sibling";
    await recordHostedStripeEvent({ event: siblingEvent, prisma: prisma.client });
    prisma.rows[1]!.attemptCount = 5;
    const retrieval = makeDeferred<Stripe.Event>();
    mocks.stripe.events.retrieve.mockReturnValueOnce(retrieval.promise);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const reconciliation = reconcileHostedStripeEventById({
      eventId: siblingEvent.id,
      prisma: prisma.client,
    });
    await vi.waitFor(() => {
      expect(mocks.stripe.events.retrieve).toHaveBeenCalledWith(siblingEvent.id);
    });
    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: ownerEvent.id,
        invoiceId: null,
        subscriptionId: "sub_123",
      },
      prisma: prisma.client,
    });
    retrieval.reject(new Error("Stripe unavailable"));

    await expect(reconciliation).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[1]).toEqual(expect.objectContaining({
      attemptCount: 5,
      processedAt: null,
      status: HostedStripeEventStatus.pending,
    }));
    errorSpy.mockRestore();
  });

  it("keeps invoice discovery pending when acceptance commits during the provider read", async () => {
    const prisma = createStripeEventPrismaHarness();
    const ownerEvent = makeExactPulseTrialSubscriptionCreatedEvent();
    ownerEvent.id = "evt_family_compensation_owner";
    await recordHostedStripeEvent({ event: ownerEvent, prisma: prisma.client });

    const checkoutEvent = makeCheckoutCompletedEvent();
    const checkoutSession = checkoutEvent.data.object as Stripe.Checkout.Session;
    checkoutSession.invoice = null;
    checkoutSession.metadata = {
      accountGroupId: "hbag_family",
      kind: "hosted_family_plan",
    };
    await recordHostedStripeEvent({ event: checkoutEvent, prisma: prisma.client });
    prisma.rows[1]!.attemptCount = 5;
    mocks.stripe.events.retrieve.mockResolvedValueOnce(checkoutEvent);
    const invoiceDiscovery = makeDeferred<{ data: Stripe.Invoice[]; has_more: boolean }>();
    mocks.stripe.invoices.list.mockReturnValueOnce(invoiceDiscovery.promise);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const reconciliation = reconcileHostedStripeEventById({
      eventId: checkoutEvent.id,
      prisma: prisma.client,
    });
    await vi.waitFor(() => {
      expect(mocks.stripe.invoices.list).toHaveBeenCalled();
    });
    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: ownerEvent.id,
        invoiceId: null,
        subscriptionId: "sub_checkout_123",
      },
      prisma: prisma.client,
    });
    invoiceDiscovery.reject(new Error("Stripe unavailable"));

    await expect(reconciliation).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[1]).toEqual(expect.objectContaining({
      attemptCount: 5,
      processedAt: null,
      status: HostedStripeEventStatus.pending,
    }));
    errorSpy.mockRestore();
  });

  it("keeps the first accepted receipt as sole owner when a later event promotes its invoice", async () => {
    const prisma = createStripeEventPrismaHarness();
    const ownerEvent = makeSubscriptionEvent("customer.subscription.created");
    ownerEvent.id = "evt_family_compensation_owner";
    const laterEvent = makeCheckoutCompletedEvent();
    await recordHostedStripeEvent({ event: ownerEvent, prisma: prisma.client });
    await recordHostedStripeEvent({ event: laterEvent, prisma: prisma.client });

    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: ownerEvent.id,
        invoiceId: null,
        subscriptionId: "sub_checkout_123",
      },
      prisma: prisma.client,
    });
    await expect(acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: laterEvent.id,
        invoiceId: "in_checkout_123",
        subscriptionId: "sub_checkout_123",
      },
      prisma: prisma.client,
    })).resolves.toEqual({
      effectId: ownerEvent.id,
      invoiceId: "in_checkout_123",
      subscriptionId: "sub_checkout_123",
    });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      familyPaymentConflictCompensationAcceptedAt: expect.any(Date),
      familyPaymentConflictCompensationInvoiceIdEncrypted: expect.any(String),
      familyPaymentConflictCompensationInvoiceLookupKey: expect.any(String),
    }));
    expect(prisma.rows[1]).toEqual(expect.objectContaining({
      familyPaymentConflictCompensationAcceptedAt: null,
      familyPaymentConflictCompensationEncryptionMemberId: null,
      familyPaymentConflictCompensationInvoiceIdEncrypted: null,
      familyPaymentConflictCompensationInvoiceLookupKey: null,
      familyPaymentConflictCompensationSubscriptionIdEncrypted: null,
      familyPaymentConflictCompensationSubscriptionLookupKey: null,
    }));
  });

  it("keeps an accepted receipt pending when ciphertext cannot be opened", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeCheckoutCompletedEvent();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await acceptTestFamilyPaymentConflictCompensation({
      compensation: {
        effectId: event.id,
        invoiceId: "in_checkout_123",
        subscriptionId: "sub_checkout_123",
      },
      prisma: prisma.client,
    });
    prisma.rows[0]!.attemptCount = 5;
    prisma.rows[0]!.familyPaymentConflictCompensationSubscriptionIdEncrypted =
      prisma.rows[0]!.familyPaymentConflictCompensationInvoiceIdEncrypted;

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 5,
      processedAt: null,
      status: HostedStripeEventStatus.pending,
    }));
    expect(mocks.executeHostedFamilyPaymentConflictCompensation).not.toHaveBeenCalled();
    expect(mocks.stripe.events.retrieve).not.toHaveBeenCalled();
    errorSpy.mockRestore();
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
    mocks.applyStripeInvoicePaymentFailed.mockImplementationOnce(async () => {
      ordering.push("billing-written");
      return {
        activatedMemberId: null,
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
      "member-resolved",
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

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });

    expect(mocks.applyStripeInvoicePaymentFailed).not.toHaveBeenCalled();
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
    mocks.applyStripeInvoicePaymentFailed.mockImplementationOnce(async () => {
      ordering.push("billing-written");
      return {
        activatedMemberId: null,
        hostedExecutionEventId: null,
        welcomeEmailMemberId: null,
      };
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
      "identity-resolved",
      "billing-written",
    ]);
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.applyStripeInvoicePaymentFailed).toHaveBeenCalledWith(
      event.data.object,
      expect.anything(),
      expect.anything(),
      HostedBillingStatus.past_due,
      canonicalSubscription,
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

  it("compensates a direct subscription event when Family billing already owns access", async () => {
    const prisma = createStripeEventPrismaHarness({ familyAuthorityActive: true });
    const event = makeSubscriptionEvent("customer.subscription.created");
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

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(mocks.executeHostedFamilyPaymentConflictCompensation).toHaveBeenCalledWith({
      effectId: event.id,
      invoiceId: null,
      subscriptionId: "sub_123",
    });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      familyPaymentConflictCompensationAcceptedAt: expect.any(Date),
      familyPaymentConflictCompensationSubscriptionIdEncrypted: expect.any(String),
      familyPaymentConflictCompensationSubscriptionLookupKey: expect.any(String),
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
  });

  it("refunds a paid direct invoice when Family billing already owns access", async () => {
    const prisma = createStripeEventPrismaHarness({ familyAuthorityActive: true });
    const event = makeInvoicePaidEvent();
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

    await recordHostedStripeEvent({ event, prisma: prisma.client });

    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeInvoicePaid).not.toHaveBeenCalled();
    expect(mocks.executeHostedFamilyPaymentConflictCompensation).toHaveBeenCalledWith({
      effectId: event.id,
      invoiceId: "in_123",
      subscriptionId: "sub_123",
    });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      familyPaymentConflictCompensationAcceptedAt: expect.any(Date),
      familyPaymentConflictCompensationInvoiceIdEncrypted: expect.any(String),
      familyPaymentConflictCompensationInvoiceLookupKey: expect.any(String),
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
  });

  it("clears the exact direct Checkout session after Family compensation is durable", async () => {
    const prisma = createStripeEventPrismaHarness({ familyAuthorityActive: true });
    const event = makeCheckoutCompletedEvent();
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeCanonicalSubscription({
      customer: "cus_checkout_123",
      id: "sub_checkout_123",
      metadata: { memberId: "member_123" },
      status: "active",
    }));

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.applyStripeCheckoutCompleted).not.toHaveBeenCalled();
    expect(mocks.executeHostedFamilyPaymentConflictCompensation).toHaveBeenCalledWith({
      effectId: event.id,
      invoiceId: "in_checkout_123",
      subscriptionId: "sub_checkout_123",
    });
    expect(prisma.client.hostedMemberBillingRef.updateMany).toHaveBeenCalledWith({
      data: {
        checkoutAttemptId: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
      },
      where: {
        memberId: "member_123",
        stripeCheckoutSessionLookupKey: expect.any(String),
      },
    });
  });

  it("retries a newly accepted Family-authority compensation from its stored receipt", async () => {
    const prisma = createStripeEventPrismaHarness({ familyAuthorityActive: true });
    const event = makeSubscriptionEvent("customer.subscription.created");
    const canonicalSubscription = makeCanonicalSubscription({
      customer: "cus_subscription",
      id: "sub_123",
      metadata: {
        memberId: "member_123",
      },
      status: "active",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.stripe.events.retrieve.mockResolvedValue(event);
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(canonicalSubscription);
    mocks.executeHostedFamilyPaymentConflictCompensation
      .mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockResolvedValueOnce(undefined);

    await recordHostedStripeEvent({ event, prisma: prisma.client });
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "failed" });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      attemptCount: 0,
      familyPaymentConflictCompensationAcceptedAt: expect.any(Date),
      processedAt: null,
      status: HostedStripeEventStatus.pending,
    }));

    prisma.rows[0]!.nextAttemptAt = new Date(0);
    await expect(reconcileHostedStripeEventById({
      eventId: event.id,
      prisma: prisma.client,
    })).resolves.toMatchObject({ status: "completed" });

    expect(mocks.executeHostedFamilyPaymentConflictCompensation).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.events.retrieve).toHaveBeenCalledOnce();
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    }));
    errorSpy.mockRestore();
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

  it("marks an unrelated receipt failed when Stripe event retrieval fails", async () => {
    const prisma = createStripeEventPrismaHarness();
    const event = makeRefundCreatedEvent();
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
      eventId: "evt_refund_created_123",
      hostedExecutionEventId: null,
      status: "failed",
    });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      eventId: "evt_refund_created_123",
      lastErrorCode: "Error",
      lastErrorMessage: "[redacted]",
      status: HostedStripeEventStatus.failed,
    }));
    expect(errorSpy).toHaveBeenCalledWith("Hosted Stripe event reconciliation failed.", {
      attemptCount: 1,
      errorMessage: "Stripe unavailable",
      errorName: "Error",
      eventIdSuffix: "ed_123",
      eventType: "refund.created",
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
        invoice: "in_checkout_123",
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

function createStripeEventPrismaHarness(input: {
  familyAuthorityActive?: boolean;
} = {}) {
  const rows: MutableStripeEventRow[] = [];
  const transaction = vi.fn(
    async <T>(callback: (tx: StripeEventPrismaHarnessClient) => Promise<T>) => callback(client),
  ) as StripeEventPrismaHarnessClient["$transaction"];

  const client: StripeEventPrismaHarnessClient = {
    $queryRaw: vi.fn(async () => []),
    $transaction: transaction,
    hostedAccountGroupMembership: {
      findFirst: vi.fn(async () =>
        input.familyAuthorityActive ? { id: "membership_family" } : null
      ),
    },
    hostedMemberBillingRef: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    hostedStripeEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: MutableStripeEventRow = {
          attemptCount: data.attemptCount as number,
          claimExpiresAt: null,
          createdAt: new Date(),
          eventId: data.eventId as string,
          familyPaymentConflictCompensationAcceptedAt: null,
          familyPaymentConflictCompensationCandidateSubscriptionLookupKey:
            data.familyPaymentConflictCompensationCandidateSubscriptionLookupKey as string | null,
          familyPaymentConflictCompensationEncryptionMemberId: null,
          familyPaymentConflictCompensationInvoiceIdEncrypted: null,
          familyPaymentConflictCompensationInvoiceLookupKey: null,
          familyPaymentConflictCompensationSubscriptionIdEncrypted: null,
          familyPaymentConflictCompensationSubscriptionLookupKey: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          nextAttemptAt: data.nextAttemptAt as Date,
          processedAt: null,
          pulseTrialCleanupAcceptedAt: null,
          pulseTrialCleanupEncryptionMemberId: null,
          pulseTrialCleanupSubscriptionIdEncrypted: null,
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
      findMany: vi.fn(async (input?: {
        where?: {
          familyPaymentConflictCompensationAcceptedAt?: { not: null };
          familyPaymentConflictCompensationSubscriptionLookupKey?: string | { in: string[] };
        };
      }) => {
        const lookup =
          input?.where?.familyPaymentConflictCompensationSubscriptionLookupKey;
        if (!lookup) {
          return rows;
        }
        const lookupKeys = typeof lookup === "string" ? [lookup] : lookup.in;
        return rows.filter((row) =>
          row.familyPaymentConflictCompensationAcceptedAt !== null &&
          row.familyPaymentConflictCompensationSubscriptionLookupKey !== null &&
          lookupKeys.includes(row.familyPaymentConflictCompensationSubscriptionLookupKey)
        );
      }),
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

  if (
    where.familyPaymentConflictCompensationAcceptedAt === null &&
    row.familyPaymentConflictCompensationAcceptedAt !== null
  ) {
    return false;
  }

  if (
    where.pulseTrialCleanupAcceptedAt === null &&
    row.pulseTrialCleanupAcceptedAt !== null
  ) {
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
  familyPaymentConflictCompensationAcceptedAt: Date | null;
  familyPaymentConflictCompensationCandidateSubscriptionLookupKey: string | null;
  familyPaymentConflictCompensationEncryptionMemberId: string | null;
  familyPaymentConflictCompensationInvoiceIdEncrypted: string | null;
  familyPaymentConflictCompensationInvoiceLookupKey: string | null;
  familyPaymentConflictCompensationSubscriptionIdEncrypted: string | null;
  familyPaymentConflictCompensationSubscriptionLookupKey: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextAttemptAt: Date;
  processedAt: Date | null;
  pulseTrialCleanupAcceptedAt: Date | null;
  pulseTrialCleanupEncryptionMemberId: string | null;
  pulseTrialCleanupSubscriptionIdEncrypted: string | null;
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
  familyPaymentConflictCompensationAcceptedAt?: null;
  pulseTrialCleanupAcceptedAt?: null;
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

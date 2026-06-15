import { HostedBillingStatus } from "@prisma/client";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberBillingSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  activateHostedMemberForPositiveSourceTx: vi.fn(),
  findMemberForStripeCheckoutSession: vi.fn(),
  findMemberForStripeInvoice: vi.fn(),
  findMemberForStripeReversal: vi.fn(),
  findMemberForStripeSubscription: vi.fn(),
  prepareHostedMemberStripeBillingWrite: vi.fn(),
  requireHostedStripeApi: vi.fn(),
  suspendHostedMemberForBillingReversalTx: vi.fn(),
  upsertHostedMemberStripeCheckoutEmailIfFreshTx: vi.fn(),
  writeHostedMemberStripeBillingRefIfFreshTx: vi.fn(),
  writeHostedMemberStripeBillingTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForPositiveSourceTx: mocks.activateHostedMemberForPositiveSourceTx,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-lookup")
  >("@/src/lib/hosted-onboarding/stripe-billing-lookup");

  return {
    ...actual,
    findMemberForStripeCheckoutSession: mocks.findMemberForStripeCheckoutSession,
    findMemberForStripeInvoice: mocks.findMemberForStripeInvoice,
    findMemberForStripeReversal: mocks.findMemberForStripeReversal,
    findMemberForStripeSubscription: mocks.findMemberForStripeSubscription,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-policy", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-policy")
  >("@/src/lib/hosted-onboarding/stripe-billing-policy");

  return {
    ...actual,
    prepareHostedMemberStripeBillingWrite: mocks.prepareHostedMemberStripeBillingWrite,
    suspendHostedMemberForBillingReversalTx: mocks.suspendHostedMemberForBillingReversalTx,
    writeHostedMemberStripeBillingRefIfFreshTx:
      mocks.writeHostedMemberStripeBillingRefIfFreshTx,
    writeHostedMemberStripeBillingTx: mocks.writeHostedMemberStripeBillingTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    upsertHostedMemberStripeCheckoutEmailIfFreshTx:
      mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/runtime")
  >("@/src/lib/hosted-onboarding/runtime");

  return {
    ...actual,
    requireHostedStripeApi: mocks.requireHostedStripeApi,
  };
});

import {
  applyStripeCheckoutCompleted,
  applyStripeDisputeUpdated,
  applyStripeInvoicePaid,
  applyStripeInvoicePaymentFailed,
  applyStripeRefundCreated,
  applyStripeSubscriptionUpdated,
} from "@/src/lib/hosted-onboarding/stripe-billing-events";

describe("hosted onboarding stripe billing events", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const member = makeMemberSnapshot();
    mocks.findMemberForStripeCheckoutSession.mockResolvedValue(member);
    mocks.findMemberForStripeInvoice.mockResolvedValue(member);
    mocks.findMemberForStripeReversal.mockResolvedValue(member);
    mocks.findMemberForStripeSubscription.mockResolvedValue(member);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValue({
      canonicalBillingStatus: HostedBillingStatus.active,
      member,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValue(member);
    mocks.suspendHostedMemberForBillingReversalTx.mockResolvedValue(undefined);
    mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: {
        address: "payer@example.com",
        collectedAt: new Date("2026-04-23T00:00:00.000Z"),
      },
      verifiedEmail: null,
    });
    mocks.writeHostedMemberStripeBillingRefIfFreshTx.mockResolvedValue(member);
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValue({
      activated: true,
      hostedExecutionEventId: "wake_123",
      memberId: member.core.id,
    });
    mocks.requireHostedStripeApi.mockReturnValue({
      invoicePayments: {
        list: vi.fn(async () => ({ data: [] })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription()),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports standard checkout completion as a welcome candidate after storing the checkout email", async () => {
    const session = {
      created: 1_714_700_800,
      customer: "cus_123",
      customer_details: {
        email: " payer@example.com ",
      },
      id: "cs_standard_123",
      metadata: {
        checkoutOffer: "standard",
      },
      subscription: "sub_123",
    } as unknown as Stripe.Checkout.Session;

    await expect(
      applyStripeCheckoutCompleted(session, {} as never),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.writeHostedMemberStripeBillingRefIfFreshTx).toHaveBeenCalledWith(expect.objectContaining({
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    }));
    expect(mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx).toHaveBeenCalledWith({
      address: "payer@example.com",
      collectedAt: new Date("2024-05-03T01:46:40.000Z"),
      memberId: "member_123",
      prisma: {},
    });
  });

  it("normalizes duplicate invoice.paid Stripe events onto the same activation source id", async () => {
    const invoice = makeStripeInvoice({
      id: "in_paid_123",
      subscription: "sub_123",
    });

    await expect(
      applyStripeInvoicePaid(
        invoice,
        {
          eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
          occurredAt: "2026-04-23T00:00:00.000Z",
          sourceEventId: "evt_paid_123",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      welcomeEmailMemberId: "member_123",
    });

    await expect(
      applyStripeInvoicePaid(
        invoice,
        {
          eventCreatedAt: new Date("2026-04-23T00:00:05.000Z"),
          occurredAt: "2026-04-23T00:00:05.000Z",
          sourceEventId: "evt_paid_456",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenNthCalledWith(1, {
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "invoice:in_paid_123",
        sourceType: "stripe.invoice.paid",
      },
      memberId: "member_123",
      prisma: {},
      skipIfBillingAlreadyActive: false,
      skipIfPreviouslyActivated: true,
    });
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenNthCalledWith(2, {
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-23T00:00:05.000Z"),
        occurredAt: "2026-04-23T00:00:05.000Z",
        sourceEventId: "invoice:in_paid_123",
        sourceType: "stripe.invoice.paid",
      },
      memberId: "member_123",
      prisma: {},
      skipIfBillingAlreadyActive: false,
      skipIfPreviouslyActivated: true,
    });
  });

  it("marks invoice.paid billing writes as positive entitlement freshness", async () => {
    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          id: "in_paid_freshness",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-25T05:13:09.000Z"),
          occurredAt: "2026-04-25T05:13:09.000Z",
          sourceEventId: "evt_paid_freshness",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      freshnessPolicy: "positive-invoice-entitlement",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    }));
  });

  it("does not report activation for later paid invoices when the member is already active", async () => {
    const activeMember = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
    });
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(activeMember);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValueOnce({
      canonicalBillingStatus: HostedBillingStatus.active,
      member: activeMember,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(activeMember);
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValueOnce({
      activated: false,
      hostedExecutionEventId: null,
      memberId: activeMember.core.id,
    });

    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          id: "in_paid_renewal",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-25T05:13:09.000Z"),
          occurredAt: "2026-04-25T05:13:09.000Z",
          sourceEventId: "evt_paid_renewal",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledWith({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-25T05:13:09.000Z"),
        occurredAt: "2026-04-25T05:13:09.000Z",
        sourceEventId: "invoice:in_paid_renewal",
        sourceType: "stripe.invoice.paid",
      },
      memberId: "member_123",
      prisma: {},
      skipIfBillingAlreadyActive: true,
      skipIfPreviouslyActivated: true,
    });
  });

  it("does not report activation for payment recovery after prior activation", async () => {
    const recoveringMember = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.past_due,
    });
    const updatedMember = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
    });
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(recoveringMember);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValueOnce({
      canonicalBillingStatus: HostedBillingStatus.active,
      member: recoveringMember,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(updatedMember);
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValueOnce({
      activated: false,
      hostedExecutionEventId: null,
      memberId: updatedMember.core.id,
    });

    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          id: "in_paid_recovery",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-26T05:13:09.000Z"),
          occurredAt: "2026-04-26T05:13:09.000Z",
          sourceEventId: "evt_paid_recovery",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledWith({
      dispatchContext: {
        eventCreatedAt: new Date("2026-04-26T05:13:09.000Z"),
        occurredAt: "2026-04-26T05:13:09.000Z",
        sourceEventId: "invoice:in_paid_recovery",
        sourceType: "stripe.invoice.paid",
      },
      memberId: "member_123",
      prisma: {},
      skipIfBillingAlreadyActive: false,
      skipIfPreviouslyActivated: true,
    });
  });

  it("keeps a welcome candidate when invoice activation already has a durable wake", async () => {
    const updatedMember = makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(updatedMember);
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValueOnce({
      activated: false,
      hostedExecutionEventId: "wake_existing",
      memberId: updatedMember.core.id,
    });

    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          id: "in_paid_retry",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-26T05:13:09.000Z"),
          occurredAt: "2026-04-26T05:13:09.000Z",
          sourceEventId: "evt_paid_retry",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: "wake_existing",
      welcomeEmailMemberId: "member_123",
    });
  });

  it("stores the Stripe invoice customer email as an unverified checkout email hint", async () => {
    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          customerEmail: " payer@example.com ",
          id: "in_paid_email",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-25T05:13:09.000Z"),
          occurredAt: "2026-04-25T05:13:09.000Z",
          sourceEventId: "evt_paid_email",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: "member_123",
      hostedExecutionEventId: "wake_123",
      welcomeEmailMemberId: "member_123",
    });

    expect(mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx).toHaveBeenCalledWith({
      address: "payer@example.com",
      collectedAt: new Date("2026-04-25T05:13:09.000Z"),
      memberId: "member_123",
      prisma: {},
    });
  });

  it("skips invoice.paid activation side effects when the billing write is not applied", async () => {
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(null);

    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          customerEmail: "stale-payer@example.com",
          id: "in_paid_stale",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
          occurredAt: "2026-04-23T00:00:00.000Z",
          sourceEventId: "evt_paid_stale",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx).not.toHaveBeenCalled();
  });

  it("infers subscription plan code from the configured base price", async () => {
    vi.stubEnv("HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY", "price_pulse_base");
    vi.stubEnv("HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY", "price_edge_base");

    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        items: ["price_edge_base"],
      }),
      {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "evt_sub_updated",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBillingPlanCode: "launch_edge_monthly",
      }),
    );
  });

  it("prefers configured Pulse prices over stale Edge subscription metadata", async () => {
    vi.stubEnv("HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY", "price_pulse_base");
    vi.stubEnv("HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY", "price_edge_base");

    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        items: ["price_pulse_base"],
        metadata: {
          billingPlanCode: "launch_edge_monthly",
        },
      }),
      {
        eventCreatedAt: new Date("2026-05-06T12:00:00.000Z"),
        occurredAt: "2026-05-06T12:00:00.000Z",
        sourceEventId: "evt_sub_updated_pulse_prices",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBillingPlanCode: "launch_monthly",
      }),
    );
  });

  it("stores subscription periods from subscription items when Stripe omits root period fields", async () => {
    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        currentPeriodEnd: null,
        currentPeriodStart: null,
        itemCurrentPeriodEnd: 1_747_612_800,
        itemCurrentPeriodStart: 1_745_020_800,
        items: ["price_pulse_base"],
      }),
      {
        eventCreatedAt: new Date("2026-04-23T00:00:00.000Z"),
        occurredAt: "2026-04-23T00:00:00.000Z",
        sourceEventId: "evt_sub_updated_item_period",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPeriodEnd: new Date("2025-05-19T00:00:00.000Z"),
        currentPeriodStart: new Date("2025-04-19T00:00:00.000Z"),
      }),
    );
  });

  it("keeps subscription.active trial updates in trial phase until the paid conversion invoice arrives", async () => {
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        currentPeriodEnd: 1_745_020_800,
        currentPeriodStart: 1_744_416_000,
        metadata: {
          checkoutOffer: "pulse_trial_7d",
        },
        status: "active",
        trialEnd: 1_745_020_800,
        trialStart: 1_744_416_000,
      }),
      {
        eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
        occurredAt: "2026-04-19T00:00:00.000Z",
        sourceEventId: "evt_trial_sub_active",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBillingPhase: "trial",
        currentCheckoutOffer: "pulse_trial_7d",
      }),
    );
  });

  it("writes resumed active Pulse Trial subscriptions as paid recovery", async () => {
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(makeMemberSnapshot({
      billingStatus: HostedBillingStatus.paused,
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        currentPeriodEnd: 1_745_020_800,
        currentPeriodStart: 1_744_416_000,
        metadata: {
          checkoutOffer: "pulse_trial_7d",
        },
        status: "active",
        trialEnd: 1_745_020_800,
        trialStart: 1_744_416_000,
      }),
      {
        eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
        occurredAt: "2026-04-19T00:00:00.000Z",
        sourceEventId: "evt_trial_sub_resumed",
        sourceType: "stripe.customer.subscription.resumed",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBillingPhase: "paid",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: new Date("2025-04-19T00:00:00.000Z"),
        currentTrialStartedAt: new Date("2025-04-12T00:00:00.000Z"),
      }),
    );
  });

  it("does not promote a redeemed Pulse Trial with missing phase on subscription.active before paid invoice", async () => {
    mocks.findMemberForStripeSubscription.mockResolvedValueOnce(makeMemberSnapshot({
      billingStatus: HostedBillingStatus.active,
      billingRef: {
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        currentPeriodEnd: 1_745_020_800,
        currentPeriodStart: 1_744_416_000,
        metadata: {
          checkoutOffer: "pulse_trial_7d",
        },
        status: "active",
        trialEnd: 1_745_020_800,
        trialStart: 1_744_416_000,
      }),
      {
        eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
        occurredAt: "2026-04-19T00:00:00.000Z",
        sourceEventId: "evt_trial_sub_active_missing_phase",
        sourceType: "stripe.customer.subscription.updated",
      },
      {} as never,
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBillingPhase: "trial",
        currentCheckoutOffer: "pulse_trial_7d",
      }),
    );
  });

  it("ignores the initial zero-dollar Pulse Trial invoice", async () => {
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          billingReason: "subscription_create",
          id: "in_trial_initial",
          subscription: "sub_123",
        }),
        {
          eventCreatedAt: new Date("2026-04-12T00:00:00.000Z"),
          occurredAt: "2026-04-12T00:00:00.000Z",
          sourceEventId: "evt_trial_initial",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
        makeStripeSubscription({
          metadata: {
            checkoutOffer: "pulse_trial_7d",
          },
          status: "trialing",
        }),
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("promotes a Pulse Trial to paid only on the accepted conversion invoice", async () => {
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await applyStripeInvoicePaid(
      makeStripeInvoice({
        billingReason: "subscription_cycle",
        id: "in_trial_conversion",
        subscription: "sub_123",
      }),
      {
        eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
        occurredAt: "2026-04-19T00:00:00.000Z",
        sourceEventId: "evt_trial_conversion",
        sourceType: "stripe.invoice.paid",
      },
      {} as never,
      HostedBillingStatus.active,
      makeStripeSubscription({
        currentPeriodEnd: 1_747_612_800,
        currentPeriodStart: 1_745_020_800,
        metadata: {
          checkoutOffer: "pulse_trial_7d",
        },
        status: "active",
        trialEnd: 1_745_020_800,
        trialStart: 1_744_416_000,
      }),
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      currentBillingPhase: "paid",
      currentCheckoutOffer: "pulse_trial_7d",
      freshnessPolicy: "positive-invoice-entitlement",
    }));
  });

  it("does not promote a Pulse Trial when the paid invoice subscription does not match the canonical subscription", async () => {
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await expect(
      applyStripeInvoicePaid(
        makeStripeInvoice({
          billingReason: "subscription_cycle",
          id: "in_trial_mismatch",
          subscription: "sub_other",
        }),
        {
          eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
          occurredAt: "2026-04-19T00:00:00.000Z",
          sourceEventId: "evt_trial_mismatch",
          sourceType: "stripe.invoice.paid",
        },
        {} as never,
        HostedBillingStatus.active,
        makeStripeSubscription({
          id: "sub_123",
          metadata: {
            checkoutOffer: "pulse_trial_7d",
          },
          status: "active",
        }),
      ),
    ).resolves.toEqual({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("clears paid allowance phase on trial conversion payment failure", async () => {
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      },
    }));

    await applyStripeInvoicePaymentFailed(
      makeStripeInvoice({
        billingReason: "subscription_cycle",
        id: "in_trial_failed",
        subscription: "sub_123",
      }),
      {
        eventCreatedAt: new Date("2026-04-19T00:00:00.000Z"),
        occurredAt: "2026-04-19T00:00:00.000Z",
        sourceEventId: "evt_trial_failed",
        sourceType: "stripe.invoice.payment_failed",
      },
      {} as never,
      HostedBillingStatus.past_due,
      makeStripeSubscription({
        id: "sub_123",
        metadata: {
          checkoutOffer: "pulse_trial_7d",
        },
        status: "past_due",
        trialEnd: 1_745_020_800,
        trialStart: 1_744_416_000,
      }),
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      billingStatus: HostedBillingStatus.past_due,
      currentBillingPhase: null,
      currentCheckoutOffer: "pulse_trial_7d",
    }));
  });

  it("does not treat a later standard Pulse invoice as a trial invoice just because a trial was redeemed before", async () => {
    mocks.findMemberForStripeInvoice.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: {
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "standard",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-04-12T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_standard_123",
      },
    }));

    await applyStripeInvoicePaid(
      makeStripeInvoice({
        billingReason: "subscription_create",
        id: "in_standard_after_trial",
        subscription: "sub_standard_123",
      }),
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        occurredAt: "2026-04-25T00:00:00.000Z",
        sourceEventId: "evt_standard_after_trial",
        sourceType: "stripe.invoice.paid",
      },
      {} as never,
      HostedBillingStatus.active,
      makeStripeSubscription({
        id: "sub_standard_123",
        metadata: {
          checkoutOffer: "standard",
        },
        status: "active",
      }),
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      currentBillingPhase: "paid",
      currentCheckoutOffer: "standard",
      stripeSubscriptionId: "sub_standard_123",
    }));
  });

  it("ignores pending refunds before looking up a member", async () => {
    await applyStripeRefundCreated(
      makeStripeRefund({ status: "pending" }),
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_refund_pending",
        sourceType: "stripe.refund.created",
      },
      {} as never,
      "cus_123",
    );

    expect(mocks.findMemberForStripeReversal).not.toHaveBeenCalled();
    expect(mocks.suspendHostedMemberForBillingReversalTx).not.toHaveBeenCalled();
  });

  it("ignores partial refunds for the current entitlement invoice", async () => {
    mocks.requireHostedStripeApi.mockReturnValueOnce({
      invoicePayments: {
        list: vi.fn(async () => ({ data: [] })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({
          latestInvoice: makeStripeInvoice({
            amountPaid: 5_000,
            charge: null,
            invoicePayments: [makeStripeInvoicePayment({
              amountPaid: 5_000,
              paymentIntent: "pi_123",
            })],
            paymentIntent: null,
          }),
        })),
      },
    });

    await applyStripeRefundCreated(
      makeStripeRefund({
        amount: 2_500,
        charge: "ch_123",
        paymentIntent: "pi_123",
        status: "succeeded",
      }),
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_refund_partial",
        sourceType: "stripe.refund.created",
      },
      {} as never,
      "cus_123",
    );

    expect(mocks.findMemberForStripeReversal).toHaveBeenCalled();
    expect(mocks.suspendHostedMemberForBillingReversalTx).not.toHaveBeenCalled();
  });

  it("suspends members for full succeeded refunds of the current entitlement invoice", async () => {
    mocks.requireHostedStripeApi.mockReturnValueOnce({
      invoicePayments: {
        list: vi.fn(async () => ({ data: [] })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({
          latestInvoice: makeStripeInvoice({
            amountPaid: 5_000,
            charge: null,
            invoicePayments: [makeStripeInvoicePayment({
              amountPaid: 5_000,
              paymentIntent: "pi_123",
            })],
            paymentIntent: null,
          }),
        })),
      },
    });

    await applyStripeRefundCreated(
      makeStripeRefund({
        amount: 5_000,
        charge: "ch_123",
        paymentIntent: "pi_123",
        status: "succeeded",
      }),
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_refund_full",
        sourceType: "stripe.refund.created",
      },
      {} as never,
      "cus_123",
    );

    expect(mocks.suspendHostedMemberForBillingReversalTx).toHaveBeenCalledWith(expect.objectContaining({
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: expect.objectContaining({
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceType: "stripe.refund.created",
      }),
      stripeCustomerId: "cus_123",
    }));
  });

  it("ignores full refunds that do not match the current entitlement invoice", async () => {
    mocks.requireHostedStripeApi.mockReturnValueOnce({
      invoicePayments: {
        list: vi.fn(async () => ({ data: [] })),
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({
          latestInvoice: makeStripeInvoice({
            amountPaid: 5_000,
            charge: null,
            invoicePayments: [makeStripeInvoicePayment({
              amountPaid: 5_000,
              paymentIntent: "pi_current",
            })],
            paymentIntent: null,
          }),
        })),
      },
    });

    await applyStripeRefundCreated(
      makeStripeRefund({
        amount: 5_000,
        charge: "ch_old",
        paymentIntent: "pi_old",
        status: "succeeded",
      }),
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_refund_old_invoice",
        sourceType: "stripe.refund.created",
      },
      {} as never,
      "cus_123",
    );

    expect(mocks.findMemberForStripeReversal).toHaveBeenCalled();
    expect(mocks.suspendHostedMemberForBillingReversalTx).not.toHaveBeenCalled();
  });

  it("matches full refunds against current invoice payment records", async () => {
    const retrieveInvoice = vi.fn(async () => makeStripeInvoice({
      amountPaid: 5_000,
      charge: null,
      paymentIntent: null,
    }));
    const listInvoicePayments = vi.fn(async () => ({
      data: [makeStripeInvoicePayment({
        amountPaid: 5_000,
        paymentIntent: "pi_123",
      })],
    }));
    mocks.requireHostedStripeApi.mockReturnValue({
      invoicePayments: {
        list: listInvoicePayments,
      },
      invoices: {
        retrieve: retrieveInvoice,
      },
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({
          latestInvoice: "in_123",
        })),
      },
    });

    await applyStripeRefundCreated(
      makeStripeRefund({
        amount: 5_000,
        paymentIntent: "pi_123",
        status: "succeeded",
      }),
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_refund_invoice_payment",
        sourceType: "stripe.refund.created",
      },
      {} as never,
      "cus_123",
    );

    expect(retrieveInvoice).toHaveBeenCalledWith("in_123", {
      expand: [
        "payments.data.payment.charge",
        "payments.data.payment.payment_intent",
      ],
    });
    expect(listInvoicePayments).toHaveBeenCalledWith({
      invoice: "in_123",
      limit: 100,
      status: "paid",
      expand: [
        "data.payment.charge",
        "data.payment.payment_intent",
      ],
    });
    expect(mocks.suspendHostedMemberForBillingReversalTx).toHaveBeenCalled();
  });

  it("ignores non-adverse dispute updates", async () => {
    await applyStripeDisputeUpdated(
      makeStripeDispute({ status: "under_review" }),
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_dispute_created",
        sourceType: "stripe.charge.dispute.created",
      },
      {} as never,
      "cus_123",
    );

    expect(mocks.findMemberForStripeReversal).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("suspends members for adverse dispute outcomes", async () => {
    await applyStripeDisputeUpdated(
      makeStripeDispute({ status: "under_review" }),
      {
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceEventId: "evt_dispute_funds_withdrawn",
        sourceType: "stripe.charge.dispute.funds_withdrawn",
      },
      {} as never,
      "cus_123",
    );

    expect(mocks.suspendHostedMemberForBillingReversalTx).toHaveBeenCalledWith(expect.objectContaining({
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: expect.objectContaining({
        eventCreatedAt: new Date("2026-04-25T00:00:00.000Z"),
        sourceType: "stripe.charge.dispute.funds_withdrawn",
      }),
    }));
  });

  it("clears dispute suspension when reinstated funds match an active subscription", async () => {
    mocks.findMemberForStripeReversal.mockResolvedValueOnce(makeMemberSnapshot({
      billingStatus: HostedBillingStatus.unpaid,
    }));

    await applyStripeDisputeUpdated(
      makeStripeDispute({ status: "won" }),
      {
        eventCreatedAt: new Date("2026-04-26T00:00:00.000Z"),
        sourceEventId: "evt_dispute_funds_reinstated",
        sourceType: "stripe.charge.dispute.funds_reinstated",
      },
      {} as never,
      "cus_123",
    );

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      suspendedAtOverride: null,
    }));
  });

  it("does not clear dispute suspension when the canonical subscription is not active", async () => {
    mocks.findMemberForStripeReversal.mockResolvedValueOnce(makeMemberSnapshot({
      billingStatus: HostedBillingStatus.unpaid,
    }));
    mocks.requireHostedStripeApi.mockReturnValueOnce({
      subscriptions: {
        retrieve: vi.fn(async () => makeStripeSubscription({ status: "past_due" })),
      },
    });

    await applyStripeDisputeUpdated(
      makeStripeDispute({ status: "won" }),
      {
        eventCreatedAt: new Date("2026-04-26T00:00:00.000Z"),
        sourceEventId: "evt_dispute_won_past_due",
        sourceType: "stripe.charge.dispute.closed",
      },
      {} as never,
      "cus_123",
    );

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });
});

function makeMemberSnapshot(input?: {
  billingStatus?: HostedBillingStatus;
  billingRef?: HostedMemberBillingSnapshot["billingRef"];
}): HostedMemberBillingSnapshot {
  return {
    billingRef: input?.billingRef ?? {
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    },
    core: {
      billingStatus: input?.billingStatus ?? HostedBillingStatus.incomplete,
      createdAt: new Date("2026-04-23T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-04-23T00:00:00.000Z"),
    },
  };
}

function makeStripeInvoice(
  overrides?: Partial<{
    amountPaid: number;
    billingReason: string | null;
    charge: string | null;
    customer: string | null;
    customerEmail: string | null;
    id: string;
    invoicePayments: Stripe.InvoicePayment[];
    paymentIntent: string | null;
    subscription: string | null;
  }>,
): Stripe.Invoice {
  // @ts-expect-error - the synthetic fixture is intentionally narrower than Stripe.Invoice.
  return {
    amount_paid: overrides?.amountPaid ?? 5_000,
    billing_reason: overrides?.billingReason ?? null,
    charge: overrides?.charge ?? "ch_123",
    customer: overrides?.customer ?? "cus_123",
    customer_email: overrides?.customerEmail ?? null,
    id: overrides?.id ?? "in_123",
    payment_intent: overrides?.paymentIntent ?? "pi_123",
    payments: {
      data: overrides?.invoicePayments ?? [],
    },
    subscription: overrides?.subscription ?? "sub_123",
  } as Stripe.Invoice;
}

function makeStripeInvoicePayment(overrides?: Partial<{
  amountPaid: number;
  charge: string | null;
  paymentIntent: string | null;
  status: string;
}>): Stripe.InvoicePayment {
  return {
    amount_paid: overrides?.amountPaid ?? 5_000,
    id: "inpay_123",
    object: "invoice_payment",
    payment: {
      ...(overrides?.charge === undefined ? {} : { charge: overrides.charge ?? undefined }),
      ...(overrides?.paymentIntent === undefined ? { payment_intent: "pi_123" } : { payment_intent: overrides.paymentIntent ?? undefined }),
      type: "payment_intent",
    },
    status: overrides?.status ?? "paid",
  } as Stripe.InvoicePayment;
}

function makeStripeRefund(overrides?: Partial<{
  amount: number;
  charge: string | null;
  paymentIntent: string | null;
  status: Stripe.Refund["status"];
}>): Stripe.Refund {
  return {
    amount: overrides?.amount ?? 5_000,
    charge: overrides?.charge ?? "ch_123",
    payment_intent: overrides?.paymentIntent ?? "pi_123",
    status: overrides?.status ?? "succeeded",
  } as Stripe.Refund;
}

function makeStripeDispute(overrides?: Partial<{
  charge: string | null;
  paymentIntent: string | null;
  status: Stripe.Dispute.Status;
}>): Stripe.Dispute {
  return {
    charge: overrides?.charge ?? "ch_123",
    payment_intent: overrides?.paymentIntent ?? "pi_123",
    status: overrides?.status ?? "under_review",
  } as Stripe.Dispute;
}

function makeStripeSubscription(
  overrides?: Partial<{
    customer: string | null;
    currentPeriodEnd: number | null;
    currentPeriodStart: number | null;
    id: string;
    itemCurrentPeriodEnd: number | null;
    itemCurrentPeriodStart: number | null;
    items: string[];
    latestInvoice: Stripe.Invoice | string | null;
    metadata: Record<string, string>;
    status: Stripe.Subscription.Status;
    trialEnd: number | null;
    trialStart: number | null;
}>,
): Stripe.Subscription {
  const currentPeriodEnd = overrides?.currentPeriodEnd === null
    ? undefined
    : overrides?.currentPeriodEnd ?? 1_747_612_800;
  const currentPeriodStart = overrides?.currentPeriodStart === null
    ? undefined
    : overrides?.currentPeriodStart ?? 1_745_020_800;
  const itemCurrentPeriodEnd = overrides?.itemCurrentPeriodEnd === null
    ? undefined
    : overrides?.itemCurrentPeriodEnd;
  const itemCurrentPeriodStart = overrides?.itemCurrentPeriodStart === null
    ? undefined
    : overrides?.itemCurrentPeriodStart;

  return {
    customer: overrides?.customer ?? "cus_123",
    id: overrides?.id ?? "sub_123",
    ...(overrides?.latestInvoice === undefined ? {} : { latest_invoice: overrides.latestInvoice }),
    ...(currentPeriodEnd === undefined ? {} : { current_period_end: currentPeriodEnd }),
    ...(currentPeriodStart === undefined ? {} : { current_period_start: currentPeriodStart }),
    items: {
      data: (overrides?.items ?? []).map((priceId) => ({
        ...(itemCurrentPeriodEnd === undefined ? {} : { current_period_end: itemCurrentPeriodEnd }),
        ...(itemCurrentPeriodStart === undefined ? {} : { current_period_start: itemCurrentPeriodStart }),
        price: {
          id: priceId,
        },
      })),
    },
    metadata: overrides?.metadata ?? {},
    status: overrides?.status ?? "active",
    trial_end: overrides?.trialEnd ?? null,
    trial_start: overrides?.trialStart ?? null,
  } as Stripe.Subscription;
}

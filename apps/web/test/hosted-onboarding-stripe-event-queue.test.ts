import {
  HostedBillingCheckoutStatus,
  HostedBillingMode,
  HostedBillingStatus,
  HostedInviteStatus,
  HostedMemberStatus,
  HostedRevnetIssuanceStatus,
  HostedStripeEventStatus,
} from "@prisma/client";
import { REVNET_NATIVE_TOKEN } from "@cobuild/wire";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueHostedExecutionOutbox: vi.fn(),
  isHostedOnboardingRevnetEnabled: vi.fn(),
  isHostedRevnetBroadcastStatusUnknownError: vi.fn(),
  readHostedRevnetPaymentReceipt: vi.fn(),
  requireHostedRevnetConfig: vi.fn(),
  stripeChargesRetrieve: vi.fn(),
  stripePaymentIntentsRetrieve: vi.fn(),
  stripeSubscriptionsRetrieve: vi.fn(),
  submitHostedRevnetPayment: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  enqueueHostedExecutionOutbox: mocks.enqueueHostedExecutionOutbox,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApi: () => ({
    charges: {
      retrieve: mocks.stripeChargesRetrieve,
    },
    paymentIntents: {
      retrieve: mocks.stripePaymentIntentsRetrieve,
    },
    subscriptions: {
      retrieve: mocks.stripeSubscriptionsRetrieve,
    },
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/revnet", () => ({
  coerceHostedWalletAddress: (value: string | null | undefined) => value ?? null,
  convertStripeMinorAmountToRevnetPaymentAmount: (amountMinor: number, weiPerStripeMinorUnit: bigint) =>
    BigInt(amountMinor) * weiPerStripeMinorUnit,
  isHostedOnboardingRevnetEnabled: mocks.isHostedOnboardingRevnetEnabled,
  isHostedRevnetBroadcastStatusUnknownError: mocks.isHostedRevnetBroadcastStatusUnknownError,
  readHostedRevnetPaymentReceipt: mocks.readHostedRevnetPaymentReceipt,
  requireHostedRevnetConfig: mocks.requireHostedRevnetConfig,
  submitHostedRevnetPayment: mocks.submitHostedRevnetPayment,
}));

import {
  drainHostedStripeEventQueue,
  recordHostedStripeEvent,
  reconcileSubmittedHostedRevnetIssuances,
} from "@/src/lib/hosted-onboarding/stripe-event-queue";
import { drainHostedRevnetIssuanceSubmissionQueue } from "@/src/lib/hosted-onboarding/stripe-revnet-issuance";

describe("hosted Stripe event queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(false);
    mocks.isHostedRevnetBroadcastStatusUnknownError.mockImplementation((error: unknown) =>
      String(error instanceof Error ? error.message : error).toLowerCase().includes("already known"),
    );
    mocks.readHostedRevnetPaymentReceipt.mockResolvedValue(null);
    mocks.requireHostedRevnetConfig.mockReturnValue({
      chainId: 8453,
      projectId: 1n,
      rpcUrl: "https://rpc.example.test",
      stripeCurrency: "usd",
      terminalAddress: "0x0000000000000000000000000000000000000001",
      treasuryPrivateKey: `0x${"11".repeat(32)}`,
      weiPerStripeMinorUnit: 2_000_000_000_000n,
    });
    mocks.stripeChargesRetrieve.mockResolvedValue({
      customer: "cus_123",
      payment_intent: "pi_123",
    });
    mocks.stripePaymentIntentsRetrieve.mockResolvedValue({
      customer: "cus_123",
    });
    mocks.stripeSubscriptionsRetrieve.mockResolvedValue({
      id: "sub_123",
      status: "active",
    });
    mocks.submitHostedRevnetPayment.mockResolvedValue({
      payTxHash: "0xabc123",
      paymentAmount: 1_000_000_000_000_000n,
    });
  });

  it("treats subscription checkout completion as local attempt completion instead of activation", async () => {
    const harness = createStripeQueueHarness({
      checkouts: [
        {
          checkoutUrl: "https://billing.example.test/cs_123",
          id: "checkout_123",
          inviteId: "invite_123",
          memberId: "member_123",
          mode: HostedBillingMode.subscription,
          priceId: "price_123",
          status: HostedBillingCheckoutStatus.open,
          stripeCheckoutSessionId: "cs_123",
        },
      ],
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.checkout_open,
          status: HostedMemberStatus.registered,
        }),
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:00:00.000Z",
        id: "evt_checkout_completed_123",
        object: {
          amount_total: 500,
          client_reference_id: "member_123",
          currency: "usd",
          customer: "cus_123",
          id: "cs_123",
          metadata: {
            inviteId: "invite_123",
            memberId: "member_123",
          },
          mode: "subscription",
          payment_status: "paid",
          subscription: "sub_123",
        },
        type: "checkout.session.completed",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingMode: HostedBillingMode.subscription,
      billingStatus: HostedBillingStatus.incomplete,
      status: HostedMemberStatus.registered,
      stripeCustomerId: "cus_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
    });
    expect(harness.invites[0]).toMatchObject({
      paidAt: null,
      status: HostedInviteStatus.pending,
    });
    expect(harness.checkouts[0]).toMatchObject({
      amountTotal: 500,
      completedAt: expect.any(Date),
      currency: "usd",
      status: HostedBillingCheckoutStatus.completed,
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("blocks access and revokes sessions when a subscription becomes unpaid", async () => {
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite({
          status: HostedInviteStatus.paid,
        }),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          status: HostedMemberStatus.active,
        }),
      ],
      sessions: [
        {
          expiresAt: new Date("2026-03-30T00:00:00.000Z"),
          id: "session_123",
          memberId: "member_123",
          revokedAt: null,
          revokeReason: null,
        },
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:05:00.000Z",
        id: "evt_subscription_unpaid_123",
        object: {
          customer: "cus_123",
          id: "sub_123",
          metadata: {
            memberId: "member_123",
          },
          status: "unpaid",
        },
        type: "customer.subscription.updated",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.unpaid,
      status: HostedMemberStatus.active,
    });
    expect(harness.sessions[0]).toMatchObject({
      revokedAt: expect.any(Date),
      revokeReason: "billing_status:unpaid",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("blocks access and revokes sessions when a subscription becomes canceled", async () => {
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite({
          status: HostedInviteStatus.paid,
        }),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          status: HostedMemberStatus.active,
        }),
      ],
      sessions: [
        {
          expiresAt: new Date("2026-03-30T00:00:00.000Z"),
          id: "session_123",
          memberId: "member_123",
          revokedAt: null,
          revokeReason: null,
        },
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:05:30.000Z",
        id: "evt_subscription_canceled_123",
        object: {
          customer: "cus_123",
          id: "sub_123",
          metadata: {
            memberId: "member_123",
          },
          status: "canceled",
        },
        type: "customer.subscription.updated",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.canceled,
      status: HostedMemberStatus.active,
    });
    expect(harness.sessions[0]).toMatchObject({
      revokedAt: expect.any(Date),
      revokeReason: "billing_status:canceled",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("blocks access and revokes sessions when a subscription becomes paused", async () => {
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite({
          status: HostedInviteStatus.paid,
        }),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          status: HostedMemberStatus.active,
        }),
      ],
      sessions: [
        {
          expiresAt: new Date("2026-03-30T00:00:00.000Z"),
          id: "session_123",
          memberId: "member_123",
          revokedAt: null,
          revokeReason: null,
        },
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:05:45.000Z",
        id: "evt_subscription_paused_123",
        object: {
          customer: "cus_123",
          id: "sub_123",
          metadata: {
            memberId: "member_123",
          },
          pause_collection: {
            behavior: "mark_uncollectible",
          },
          status: "paused",
        },
        type: "customer.subscription.updated",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.paused,
      status: HostedMemberStatus.active,
    });
    expect(harness.sessions[0]).toMatchObject({
      revokedAt: expect.any(Date),
      revokeReason: "billing_status:paused",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("suspends members and revokes sessions when customer.subscription.deleted arrives", async () => {
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite({
          status: HostedInviteStatus.paid,
        }),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          status: HostedMemberStatus.active,
        }),
      ],
      sessions: [
        {
          expiresAt: new Date("2026-03-30T00:00:00.000Z"),
          id: "session_123",
          memberId: "member_123",
          revokedAt: null,
          revokeReason: null,
        },
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:05:50.000Z",
        id: "evt_subscription_deleted_123",
        object: {
          customer: "cus_123",
          id: "sub_123",
          metadata: {
            memberId: "member_123",
          },
          status: "canceled",
        },
        type: "customer.subscription.deleted",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.canceled,
      status: HostedMemberStatus.active,
    });
    expect(harness.sessions[0]).toMatchObject({
      revokedAt: expect.any(Date),
      revokeReason: "billing_status:canceled",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("does not activate on customer.subscription.updated(active); keeps subscription billing incomplete until invoice.paid", async () => {
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          status: HostedMemberStatus.registered,
        }),
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:07:00.000Z",
        id: "evt_subscription_active_123",
        object: {
          customer: "cus_123",
          id: "sub_123",
          metadata: {
            memberId: "member_123",
          },
          status: "active",
        },
        type: "customer.subscription.updated",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.incomplete,
      status: HostedMemberStatus.registered,
    });
    expect(harness.invites[0]).toMatchObject({
      paidAt: null,
      status: HostedInviteStatus.pending,
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("activates from invoice.paid when RevNet is disabled", async () => {
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          status: HostedMemberStatus.registered,
        }),
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:10:00.000Z",
        id: "evt_invoice_paid_123",
        object: {
          amount_paid: 500,
          currency: "usd",
          customer: "cus_123",
          id: "in_123",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
          payment_intent: "pi_123",
        },
        type: "invoice.paid",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.active,
      status: HostedMemberStatus.active,
      stripeLatestBillingEventId: "evt_invoice_paid_123",
    });
    expect(harness.invites[0]).toMatchObject({
      paidAt: expect.any(Date),
      status: HostedInviteStatus.paid,
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "stripe:evt_invoice_paid_123",
        sourceType: "hosted_stripe_event",
      }),
    );
  });

  it.each([
    HostedBillingStatus.unpaid,
    HostedBillingStatus.canceled,
    HostedBillingStatus.paused,
  ])("reactivates a blocked subscription from invoice.paid after %s", async (startingStatus) => {
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite({
          status: HostedInviteStatus.pending,
        }),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: startingStatus,
          status: HostedMemberStatus.active,
        }),
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:09:00.000Z",
        id: `evt_invoice_paid_resume_${startingStatus}`,
        object: {
          amount_paid: 500,
          currency: "usd",
          customer: "cus_123",
          id: `in_resume_${startingStatus}`,
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
          payment_intent: `pi_resume_${startingStatus}`,
        },
        type: "invoice.paid",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.active,
      status: HostedMemberStatus.active,
      stripeLatestBillingEventId: `evt_invoice_paid_resume_${startingStatus}`,
    });
    expect(harness.invites[0]).toMatchObject({
      paidAt: expect.any(Date),
      status: HostedInviteStatus.paid,
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: `stripe:evt_invoice_paid_resume_${startingStatus}`,
        sourceType: "hosted_stripe_event",
      }),
    );
  });

  it("matches subscription invoices via invoice.subscription and keeps them on the subscription path", async () => {
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          status: HostedMemberStatus.registered,
          stripeCustomerId: null,
        }),
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:11:00.000Z",
        id: "evt_invoice_paid_direct_subscription_123",
        object: {
          amount_paid: 500,
          currency: "usd",
          customer: null,
          id: "in_123",
          payment_intent: "pi_123",
          subscription: "sub_123",
        },
        type: "invoice.paid",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.active,
      status: HostedMemberStatus.active,
      stripeLatestBillingEventId: "evt_invoice_paid_direct_subscription_123",
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "stripe:evt_invoice_paid_direct_subscription_123",
      }),
    );
  });

  it("ignores stale positive events after a newer delinquency already won freshness", async () => {
    const newerEventCreatedAt = new Date("2026-03-28T10:20:00.000Z");
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite({
          status: HostedInviteStatus.paid,
        }),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.unpaid,
          status: HostedMemberStatus.active,
          stripeLatestBillingEventCreatedAt: newerEventCreatedAt,
          stripeLatestBillingEventId: "evt_subscription_unpaid_123",
        }),
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:10:00.000Z",
        id: "evt_invoice_paid_stale_123",
        object: {
          amount_paid: 500,
          currency: "usd",
          customer: "cus_123",
          id: "in_123",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
          payment_intent: "pi_123",
        },
        type: "invoice.paid",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.unpaid,
      status: HostedMemberStatus.active,
      stripeLatestBillingEventCreatedAt: newerEventCreatedAt,
      stripeLatestBillingEventId: "evt_subscription_unpaid_123",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("uses current Stripe subscription state to resolve same-second billing collisions", async () => {
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          status: HostedMemberStatus.active,
        }),
      ],
      sessions: [
        {
          expiresAt: new Date("2026-03-30T00:00:00.000Z"),
          id: "session_123",
          memberId: "member_123",
          revokedAt: null,
          revokeReason: null,
        },
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:20:00.000Z",
        id: "evt_same_second_z_unpaid",
        object: {
          customer: "cus_123",
          id: "sub_123",
          metadata: {
            memberId: "member_123",
          },
          status: "active",
        },
        type: "customer.subscription.updated",
      }),
      prisma: harness.prisma,
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:20:00.000Z",
        id: "evt_same_second_a_paid",
        object: {
          amount_paid: 500,
          currency: "usd",
          customer: "cus_123",
          id: "in_123",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
          payment_intent: "pi_123",
        },
        type: "invoice.paid",
      }),
      prisma: harness.prisma,
    });

    expect(mocks.stripeSubscriptionsRetrieve).toHaveBeenCalledWith("sub_123");
    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.active,
      status: HostedMemberStatus.active,
      stripeLatestBillingEventId: "evt_same_second_a_paid",
    });
    expect(harness.invites[0]).toMatchObject({
      paidAt: expect.any(Date),
      status: HostedInviteStatus.paid,
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(1);
  });

  it("fails closed on same-second positive collisions when canonical subscription state is unavailable", async () => {
    mocks.stripeSubscriptionsRetrieve.mockRejectedValueOnce(new Error("stripe unavailable"));
    const sameSecond = new Date("2026-03-28T10:20:00.000Z");
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.unpaid,
          status: HostedMemberStatus.active,
          stripeLatestBillingEventCreatedAt: sameSecond,
          stripeLatestBillingEventId: "evt_same_second_unpaid",
        }),
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: sameSecond.toISOString(),
        id: "evt_same_second_paid_without_canonical",
        object: {
          amount_paid: 500,
          currency: "usd",
          customer: "cus_123",
          id: "in_123",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
          payment_intent: "pi_123",
        },
        type: "invoice.paid",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.unpaid,
      status: HostedMemberStatus.active,
      stripeLatestBillingEventId: "evt_same_second_unpaid",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("still records same-second RevNet recovery invoices when canonical subscription state is active", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    const sameSecond = new Date("2026-03-28T10:20:00.000Z");
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.unpaid,
          status: HostedMemberStatus.active,
          stripeLatestBillingEventCreatedAt: sameSecond,
          stripeLatestBillingEventId: "evt_same_second_unpaid",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: sameSecond.toISOString(),
        id: "evt_same_second_paid_revnet",
        object: {
          amount_paid: 500,
          currency: "usd",
          customer: "cus_123",
          id: "in_same_second_revnet",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
          payment_intent: "pi_same_second_revnet",
        },
        type: "invoice.paid",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.incomplete,
      status: HostedMemberStatus.active,
      stripeLatestBillingEventId: "evt_same_second_paid_revnet",
    });
    expect(harness.revnetIssuances[0]).toMatchObject({
      payTxHash: "0xabc123",
      status: HostedRevnetIssuanceStatus.submitted,
      stripeInvoiceId: "in_same_second_revnet",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("still lets same-second billing reversals win without subscription lookups", async () => {
    const sameSecond = new Date("2026-03-28T10:20:00.000Z");
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite({
          status: HostedInviteStatus.paid,
        }),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.payment,
          billingStatus: HostedBillingStatus.active,
          status: HostedMemberStatus.active,
          stripeLatestBillingEventCreatedAt: sameSecond,
          stripeLatestBillingEventId: "evt_same_second_paid",
          stripeSubscriptionId: null,
        }),
      ],
      sessions: [
        {
          expiresAt: new Date("2026-03-30T00:00:00.000Z"),
          id: "session_same_second_refund",
          memberId: "member_123",
          revokedAt: null,
          revokeReason: null,
        },
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: sameSecond.toISOString(),
        id: "evt_same_second_refund",
        object: {
          charge: "ch_123",
          id: "re_same_second",
          payment_intent: "pi_123",
        },
        type: "refund.created",
      }),
      prisma: harness.prisma,
    });

    expect(mocks.stripeSubscriptionsRetrieve).not.toHaveBeenCalled();
    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.unpaid,
      status: HostedMemberStatus.suspended,
      stripeLatestBillingEventId: "evt_same_second_refund",
    });
    expect(harness.sessions[0]).toMatchObject({
      revokeReason: "billing_reversal:stripe.refund.created",
      revokedAt: expect.any(Date),
    });
  });

  it("does not let an older expired checkout clear a newer open attempt", async () => {
    const harness = createStripeQueueHarness({
      checkouts: [
        {
          checkoutUrl: "https://billing.example.test/cs_old",
          id: "checkout_old",
          inviteId: "invite_123",
          memberId: "member_123",
          mode: HostedBillingMode.subscription,
          priceId: "price_123",
          status: HostedBillingCheckoutStatus.open,
          stripeCheckoutSessionId: "cs_old",
        },
        {
          checkoutUrl: "https://billing.example.test/cs_new",
          id: "checkout_new",
          inviteId: "invite_123",
          memberId: "member_123",
          mode: HostedBillingMode.subscription,
          priceId: "price_123",
          status: HostedBillingCheckoutStatus.open,
          stripeCheckoutSessionId: "cs_new",
        },
      ],
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.checkout_open,
          status: HostedMemberStatus.registered,
          stripeLatestCheckoutSessionId: "cs_new",
        }),
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:15:00.000Z",
        id: "evt_checkout_expired_123",
        object: {
          client_reference_id: "member_123",
          customer: "cus_123",
          id: "cs_old",
          metadata: {
            memberId: "member_123",
          },
          mode: "subscription",
          payment_status: "unpaid",
          subscription: "sub_123",
        },
        type: "checkout.session.expired",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.checkout_open,
      stripeLatestCheckoutSessionId: "cs_new",
    });
    expect(harness.checkouts.find((checkout) => checkout.id === "checkout_old")).toMatchObject({
      expiredAt: expect.any(Date),
      status: HostedBillingCheckoutStatus.expired,
    });
    expect(harness.checkouts.find((checkout) => checkout.id === "checkout_new")).toMatchObject({
      status: HostedBillingCheckoutStatus.open,
    });
  });

  it("activates and dispatches on payment checkout.session.completed when payment is settled", async () => {
    const harness = createStripeQueueHarness({
      checkouts: [
        {
          checkoutUrl: "https://billing.example.test/cs_123",
          id: "checkout_123",
          inviteId: "invite_123",
          memberId: "member_123",
          mode: HostedBillingMode.payment,
          priceId: "price_123",
          status: HostedBillingCheckoutStatus.open,
          stripeCheckoutSessionId: "cs_123",
        },
      ],
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.payment,
          billingStatus: HostedBillingStatus.checkout_open,
          status: HostedMemberStatus.registered,
          stripeSubscriptionId: null,
        }),
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:25:00.000Z",
        id: "evt_payment_checkout_completed_123",
        object: {
          amount_total: 500,
          client_reference_id: "member_123",
          currency: "usd",
          customer: "cus_123",
          id: "cs_123",
          metadata: {
            inviteId: "invite_123",
            memberId: "member_123",
          },
          mode: "payment",
          payment_status: "paid",
          subscription: null,
        },
        type: "checkout.session.completed",
      }),
      prisma: harness.prisma,
    });

    expect(harness.checkouts[0]).toMatchObject({
      amountTotal: 500,
      completedAt: expect.any(Date),
      currency: "usd",
      status: HostedBillingCheckoutStatus.completed,
    });
    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.active,
      status: HostedMemberStatus.active,
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: null,
    });
    expect(harness.invites[0]).toMatchObject({
      paidAt: expect.any(Date),
      status: HostedInviteStatus.paid,
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "stripe:evt_payment_checkout_completed_123",
        sourceType: "hosted_stripe_event",
      }),
    );
  });

  it("does not activate on payment checkout.session.completed when payment remains unpaid", async () => {
    const harness = createStripeQueueHarness({
      checkouts: [
        {
          checkoutUrl: "https://billing.example.test/cs_123",
          id: "checkout_123",
          inviteId: "invite_123",
          memberId: "member_123",
          mode: HostedBillingMode.payment,
          priceId: "price_123",
          status: HostedBillingCheckoutStatus.open,
          stripeCheckoutSessionId: "cs_123",
        },
      ],
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.payment,
          billingStatus: HostedBillingStatus.checkout_open,
          status: HostedMemberStatus.registered,
          stripeSubscriptionId: null,
        }),
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:26:00.000Z",
        id: "evt_payment_checkout_unpaid_123",
        object: {
          amount_total: 500,
          client_reference_id: "member_123",
          currency: "usd",
          customer: "cus_123",
          id: "cs_123",
          metadata: {
            inviteId: "invite_123",
            memberId: "member_123",
          },
          mode: "payment",
          payment_status: "unpaid",
          subscription: null,
        },
        type: "checkout.session.completed",
      }),
      prisma: harness.prisma,
    });

    expect(harness.checkouts[0]).toMatchObject({
      amountTotal: 500,
      completedAt: expect.any(Date),
      currency: "usd",
      status: HostedBillingCheckoutStatus.completed,
    });
    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.incomplete,
      status: HostedMemberStatus.registered,
    });
    expect(harness.invites[0]).toMatchObject({
      paidAt: null,
      status: HostedInviteStatus.pending,
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("submits RevNet issuance on invoice.paid but waits for confirmation before activation", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          status: HostedMemberStatus.registered,
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:30:00.000Z",
        id: "evt_invoice_paid_revnet_123",
        object: {
          amount_paid: 500,
          currency: "usd",
          customer: "cus_123",
          id: "in_123",
          payment_intent: "pi_123",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
        },
        type: "invoice.paid",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.incomplete,
      status: HostedMemberStatus.registered,
    });
    expect(harness.invites[0]).toMatchObject({
      paidAt: null,
      status: HostedInviteStatus.pending,
    });
    expect(harness.revnetIssuances[0]).toMatchObject({
      beneficiaryAddress: "0x00000000000000000000000000000000000000aa",
      payTxHash: "0xabc123",
      paymentAssetAddress: REVNET_NATIVE_TOKEN,
      status: HostedRevnetIssuanceStatus.submitted,
      stripeInvoiceId: "in_123",
      stripePaymentIntentId: "pi_123",
    });
    expect(mocks.submitHostedRevnetPayment).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("activates a submitted RevNet issuance only after onchain confirmation", async () => {
    mocks.readHostedRevnetPaymentReceipt.mockResolvedValue({
      status: "success",
    });
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          status: HostedMemberStatus.registered,
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
      ],
      revnetIssuances: [
        makeRevnetIssuance({
          payTxHash: "0xabc123",
          status: HostedRevnetIssuanceStatus.submitted,
        }),
      ],
    });

    await reconcileSubmittedHostedRevnetIssuances({
      prisma: harness.prisma,
    });

    expect(harness.revnetIssuances[0]).toMatchObject({
      confirmedAt: expect.any(Date),
      status: HostedRevnetIssuanceStatus.confirmed,
    });
    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.active,
      status: HostedMemberStatus.active,
    });
    expect(harness.invites[0]).toMatchObject({
      paidAt: expect.any(Date),
      status: HostedInviteStatus.paid,
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "issuance_123",
        sourceType: "hosted_revnet_issuance",
      }),
    );
  });

  it("marks submitted RevNet issuance failed when receipt is reverted and does not activate", async () => {
    mocks.readHostedRevnetPaymentReceipt.mockResolvedValue({
      status: "reverted",
    });
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          status: HostedMemberStatus.registered,
        }),
      ],
      revnetIssuances: [
        makeRevnetIssuance({
          payTxHash: "0xabc123",
          status: HostedRevnetIssuanceStatus.submitted,
        }),
      ],
    });

    await reconcileSubmittedHostedRevnetIssuances({
      prisma: harness.prisma,
    });

    expect(harness.revnetIssuances[0]).toMatchObject({
      failureCode: "REVNET_PAYMENT_REVERTED",
      status: HostedRevnetIssuanceStatus.failed,
    });
    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.active,
      status: HostedMemberStatus.registered,
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("fails closed after a broadcast when tx-hash persistence fails and retries do not rebroadcast", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          status: HostedMemberStatus.registered,
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
      ],
    });
    const baseUpdateImpl = harness.prisma.hostedRevnetIssuance.update.getMockImplementation();
    harness.prisma.hostedRevnetIssuance.update.mockImplementation(async (args: { data: Record<string, unknown> }) => {
      if ("payTxHash" in args.data || args.data.status === HostedRevnetIssuanceStatus.submitted) {
        throw new Error("db write failed");
      }

      return baseUpdateImpl?.(args);
    });
    harness.prisma.hostedRevnetIssuance.updateMany.mockImplementation(async ({ data, where }: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      if ("payTxHash" in data || data.status === HostedRevnetIssuanceStatus.submitted) {
        return { count: 0 };
      }

      const issuance = harness.revnetIssuances.find((candidate) => {
        if ("id" in where && candidate.id !== where.id) {
          return false;
        }

        if ("payTxHash" in where && candidate.payTxHash !== where.payTxHash) {
          return false;
        }

        if ("status" in where && candidate.status !== where.status) {
          return false;
        }

        if ("updatedAt" in where) {
          const updatedAt = where.updatedAt as Date;
          if (candidate.updatedAt.getTime() !== updatedAt.getTime()) {
            return false;
          }
        }

        return true;
      });

      if (!issuance) {
        return { count: 0 };
      }

      Object.assign(issuance, data, {
        updatedAt: new Date(issuance.updatedAt.getTime() + 1),
      });
      return { count: 1 };
    });

    await recordHostedStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:35:00.000Z",
        id: "evt_invoice_paid_recording_failed_123",
        object: {
          amount_paid: 500,
          currency: "usd",
          customer: "cus_123",
          id: "in_123",
          payment_intent: "pi_123",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
        },
        type: "invoice.paid",
      }),
      prisma: harness.prisma,
    });

    await drainHostedStripeEventQueue({
      prisma: harness.prisma,
    });

    expect(harness.revnetIssuances[0]).toMatchObject({
      failureCode: null,
      payTxHash: null,
      status: HostedRevnetIssuanceStatus.submitting,
    });
    expect(harness.stripeEvents[0]).toMatchObject({
      lastErrorCode: null,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    });

    await drainHostedStripeEventQueue({
      prisma: harness.prisma,
    });

    expect(mocks.submitHostedRevnetPayment).toHaveBeenCalledTimes(1);
    expect(harness.stripeEvents[0]).toMatchObject({
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    });
  });

  it("backs off failed Stripe events and poisons them after repeated failures", async () => {
    mocks.stripeChargesRetrieve.mockRejectedValue(new Error("stripe temporarily unavailable"));
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite({
          status: HostedInviteStatus.paid,
        }),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.payment,
          billingStatus: HostedBillingStatus.active,
          status: HostedMemberStatus.active,
          stripeSubscriptionId: null,
        }),
      ],
    });

    await recordHostedStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:39:00.000Z",
        id: "evt_refund_retry_123",
        object: {
          charge: "ch_123",
          id: "re_retry_123",
          payment_intent: "pi_123",
        },
        type: "refund.created",
      }),
      prisma: harness.prisma,
    });

    await drainHostedStripeEventQueue({
      prisma: harness.prisma,
    });

    expect(harness.stripeEvents[0]).toMatchObject({
      attemptCount: 1,
      lastErrorCode: "Error",
      status: HostedStripeEventStatus.failed,
    });
    expect(harness.stripeEvents[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    await drainHostedStripeEventQueue({
      prisma: harness.prisma,
    });

    expect(harness.stripeEvents[0]).toMatchObject({
      attemptCount: 1,
      status: HostedStripeEventStatus.failed,
    });

    harness.stripeEvents[0].attemptCount = 5;
    harness.stripeEvents[0].nextAttemptAt = new Date(Date.now() - 1);

    await drainHostedStripeEventQueue({
      prisma: harness.prisma,
    });

    expect(harness.stripeEvents[0]).toMatchObject({
      attemptCount: 6,
      status: HostedStripeEventStatus.poisoned,
    });
  });

  it("suppresses Stripe activation side effects when the activation CAS loses after billing becomes active", async () => {
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          status: HostedMemberStatus.registered,
        }),
      ],
    });
    const baseMemberUpdateMany = harness.prisma.hostedMember.updateMany.getMockImplementation();
    let hostedMemberUpdateManyCalls = 0;
    harness.prisma.hostedMember.updateMany.mockImplementation(async (args: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      hostedMemberUpdateManyCalls += 1;

      if (hostedMemberUpdateManyCalls === 2) {
        Object.assign(harness.members[0], {
          billingStatus: HostedBillingStatus.unpaid,
          stripeLatestBillingEventCreatedAt: new Date("2026-03-28T10:41:00.000Z"),
          stripeLatestBillingEventId: "evt_later_negative",
        });
        return { count: 0 };
      }

      return baseMemberUpdateMany?.(args) ?? { count: 0 };
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:40:00.000Z",
        id: "evt_invoice_paid_cas_lost",
        object: {
          amount_paid: 500,
          currency: "usd",
          customer: "cus_123",
          id: "in_cas_lost",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
          payment_intent: "pi_cas_lost",
        },
        type: "invoice.paid",
      }),
      prisma: harness.prisma,
    });

    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.unpaid,
      stripeLatestBillingEventId: "evt_later_negative",
    });
    expect(harness.invites[0]).toMatchObject({
      paidAt: null,
      status: HostedInviteStatus.pending,
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("suspends refund reversals using Stripe API lookups without checkout config", async () => {
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite({
          status: HostedInviteStatus.paid,
        }),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.payment,
          billingStatus: HostedBillingStatus.active,
          status: HostedMemberStatus.active,
          stripeSubscriptionId: null,
        }),
      ],
      sessions: [
        {
          expiresAt: new Date("2026-03-30T00:00:00.000Z"),
          id: "session_123",
          memberId: "member_123",
          revokedAt: null,
          revokeReason: null,
        },
      ],
    });

    await recordAndDrainStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:40:00.000Z",
        id: "evt_refund_created_123",
        object: {
          charge: "ch_123",
          id: "re_123",
          payment_intent: "pi_123",
        },
        type: "refund.created",
      }),
      prisma: harness.prisma,
    });

    expect(mocks.stripeChargesRetrieve).toHaveBeenCalledWith("ch_123");
    expect(mocks.stripePaymentIntentsRetrieve).not.toHaveBeenCalled();
    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.unpaid,
      status: HostedMemberStatus.suspended,
    });
    expect(harness.sessions[0]).toMatchObject({
      revokeReason: "billing_reversal:stripe.refund.created",
      revokedAt: expect.any(Date),
    });
  });

  it("reclaims a processing HostedStripeEvent after claimExpiresAt expires and completes it", async () => {
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          status: HostedMemberStatus.registered,
        }),
      ],
    });

    await recordHostedStripeEvent({
      event: buildStripeEvent({
        createdAt: "2026-03-28T10:45:00.000Z",
        id: "evt_processing_reclaim_123",
        object: {
          amount_paid: 500,
          currency: "usd",
          customer: "cus_123",
          id: "in_processing_123",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
          payment_intent: "pi_123",
        },
        type: "invoice.paid",
      }),
      prisma: harness.prisma,
    });

    harness.stripeEvents[0].claimExpiresAt = new Date(Date.now() - 1);
    harness.stripeEvents[0].processedAt = null;
    harness.stripeEvents[0].status = HostedStripeEventStatus.processing;

    await drainHostedStripeEventQueue({
      prisma: harness.prisma,
    });

    expect(harness.stripeEvents[0]).toMatchObject({
      claimExpiresAt: null,
      processedAt: expect.any(Date),
      status: HostedStripeEventStatus.completed,
    });
  });

  it("does not let recent claimed RevNet rows crowd out due retries from the submission queue", async () => {
    const recentSubmitting = makeRevnetIssuance({
      attemptCount: 1,
      id: "issuance_recent",
      idempotencyKey: "stripe:invoice:in_recent",
      nextAttemptAt: new Date("2026-03-28T10:30:00.000Z"),
      status: HostedRevnetIssuanceStatus.submitting,
      stripeInvoiceId: "in_recent",
      updatedAt: new Date(),
    });
    const dueFailed = makeRevnetIssuance({
      attemptCount: 1,
      id: "issuance_due",
      idempotencyKey: "stripe:invoice:in_due",
      nextAttemptAt: new Date(Date.now() - 1),
      status: HostedRevnetIssuanceStatus.failed,
      stripeInvoiceId: "in_due",
      updatedAt: new Date("2026-03-28T10:00:00.000Z"),
    });
    const harness = createStripeQueueHarness({
      revnetIssuances: [
        recentSubmitting,
        dueFailed,
      ],
    });

    const drained = await drainHostedRevnetIssuanceSubmissionQueue({
      limit: 1,
      prisma: harness.prisma as never,
    });

    expect(drained).toEqual(["issuance_due"]);
    expect(mocks.submitHostedRevnetPayment).toHaveBeenCalledTimes(1);
    expect(harness.revnetIssuances.find((issuance) => issuance.id === "issuance_recent")).toMatchObject({
      payTxHash: null,
      status: HostedRevnetIssuanceStatus.submitting,
    });
    expect(harness.revnetIssuances.find((issuance) => issuance.id === "issuance_due")).toMatchObject({
      payTxHash: "0xabc123",
      status: HostedRevnetIssuanceStatus.submitted,
    });
  });

  it("records definite RevNet submission failures with backoff and skips them until due", async () => {
    mocks.submitHostedRevnetPayment.mockRejectedValueOnce(new Error("rpc unavailable"));
    const harness = createStripeQueueHarness({
      revnetIssuances: [
        makeRevnetIssuance(),
      ],
    });

    await drainHostedRevnetIssuanceSubmissionQueue({
      prisma: harness.prisma as never,
    });
    expect(harness.revnetIssuances[0]).toMatchObject({
      attemptCount: 1,
      failureCode: "REVNET_PAYMENT_FAILED",
      status: HostedRevnetIssuanceStatus.failed,
    });
    expect(harness.revnetIssuances[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    await drainHostedRevnetIssuanceSubmissionQueue({
      prisma: harness.prisma as never,
    });

    expect(mocks.submitHostedRevnetPayment).toHaveBeenCalledTimes(1);
    expect(harness.revnetIssuances[0]).toMatchObject({
      attemptCount: 1,
      status: HostedRevnetIssuanceStatus.failed,
    });
  });

  it("auto-retries a stale claimed RevNet issuance that never reached submission", async () => {
    const harness = createStripeQueueHarness({
      revnetIssuances: [
        makeRevnetIssuance({
          attemptCount: 1,
          nextAttemptAt: new Date("2026-03-28T10:30:00.000Z"),
          status: HostedRevnetIssuanceStatus.submitting,
          updatedAt: new Date(Date.now() - 10 * 60 * 1000),
        }),
      ],
    });

    const drained = await drainHostedRevnetIssuanceSubmissionQueue({
      prisma: harness.prisma as never,
    });

    expect(drained).toEqual(["issuance_123"]);
    expect(mocks.submitHostedRevnetPayment).toHaveBeenCalledTimes(1);
    expect(harness.revnetIssuances[0]).toMatchObject({
      attemptCount: 2,
      payTxHash: "0xabc123",
      status: HostedRevnetIssuanceStatus.submitted,
    });
  });

  it("keeps broadcast-unknown RevNet submissions stuck even after they become stale", async () => {
    const harness = createStripeQueueHarness({
      revnetIssuances: [
        makeRevnetIssuance({
          attemptCount: 1,
          failureCode: "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN",
          nextAttemptAt: new Date(Date.now() - 1),
          status: HostedRevnetIssuanceStatus.submitting,
          updatedAt: new Date(Date.now() - 10 * 60 * 1000),
        }),
      ],
    });

    const drained = await drainHostedRevnetIssuanceSubmissionQueue({
      prisma: harness.prisma as never,
    });

    expect(drained).toEqual([]);
    expect(mocks.submitHostedRevnetPayment).not.toHaveBeenCalled();
    expect(harness.revnetIssuances[0]).toMatchObject({
      failureCode: "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN",
      status: HostedRevnetIssuanceStatus.submitting,
    });
  });

  it("does not enqueue activation when RevNet confirmation loses a CAS race to a newer blocked billing state", async () => {
    mocks.readHostedRevnetPaymentReceipt.mockResolvedValue({
      status: "success",
    });
    const harness = createStripeQueueHarness({
      invites: [
        makeInvite(),
      ],
      members: [
        makeMember({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          status: HostedMemberStatus.registered,
          stripeLatestBillingEventCreatedAt: new Date("2026-03-28T10:20:00.000Z"),
          stripeLatestBillingEventId: "evt_prior_positive",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
      ],
      revnetIssuances: [
        makeRevnetIssuance({
          payTxHash: "0xabc123",
          status: HostedRevnetIssuanceStatus.submitted,
        }),
      ],
    });
    const baseMemberUpdateMany = harness.prisma.hostedMember.updateMany.getMockImplementation();
    harness.prisma.hostedMember.updateMany.mockImplementationOnce(async () => {
      Object.assign(harness.members[0], {
        billingStatus: HostedBillingStatus.unpaid,
        stripeLatestBillingEventCreatedAt: new Date("2026-03-28T10:31:00.000Z"),
        stripeLatestBillingEventId: "evt_later_negative",
      });
      return { count: 0 };
    });

    await reconcileSubmittedHostedRevnetIssuances({
      prisma: harness.prisma,
    });

    harness.prisma.hostedMember.updateMany.mockImplementation(baseMemberUpdateMany);

    expect(harness.revnetIssuances[0]).toMatchObject({
      confirmedAt: expect.any(Date),
      status: HostedRevnetIssuanceStatus.confirmed,
    });
    expect(harness.members[0]).toMatchObject({
      billingStatus: HostedBillingStatus.unpaid,
      stripeLatestBillingEventId: "evt_later_negative",
    });
    expect(harness.invites[0]).toMatchObject({
      paidAt: null,
      status: HostedInviteStatus.pending,
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });
});

async function recordAndDrainStripeEvent(input: {
  event: Parameters<typeof recordHostedStripeEvent>[0]["event"];
  prisma: Parameters<typeof recordHostedStripeEvent>[0]["prisma"];
}) {
  await recordHostedStripeEvent(input);
  await drainHostedStripeEventQueue({
    prisma: input.prisma,
  });
  await drainHostedRevnetIssuanceSubmissionQueue({
    prisma: input.prisma as never,
  });
}

function buildStripeEvent(input: {
  createdAt: string;
  id: string;
  object: Record<string, unknown>;
  type: string;
}): Stripe.Event {
  return {
    api_version: "2025-02-24.acacia",
    created: Math.floor(new Date(input.createdAt).getTime() / 1000),
    data: {
      object: input.object,
    },
    id: input.id,
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: input.type,
  } as unknown as Stripe.Event;
}

function makeInvite(overrides: Partial<MutableInvite> = {}): MutableInvite {
  return {
    id: "invite_123",
    memberId: "member_123",
    paidAt: null,
    status: HostedInviteStatus.pending,
    ...overrides,
  };
}

function makeMember(overrides: Partial<MutableMember> = {}): MutableMember {
  return {
    billingMode: HostedBillingMode.subscription,
    billingStatus: HostedBillingStatus.not_started,
    id: "member_123",
    normalizedPhoneNumber: "+15551234567",
    status: HostedMemberStatus.registered,
    stripeCustomerId: "cus_123",
    stripeLatestBillingEventCreatedAt: null,
    stripeLatestBillingEventId: null,
    stripeLatestCheckoutSessionId: null,
    stripeSubscriptionId: "sub_123",
    walletAddress: null,
    ...overrides,
  };
}

function makeRevnetIssuance(
  overrides: Partial<MutableRevnetIssuance> = {},
): MutableRevnetIssuance {
  return {
    attemptCount: 0,
    beneficiaryAddress: "0x00000000000000000000000000000000000000aa",
    chainId: 8453,
    confirmedAt: null,
    createdAt: new Date("2026-03-28T10:30:00.000Z"),
    failureCode: null,
    failureMessage: null,
    id: "issuance_123",
    idempotencyKey: "stripe:invoice:in_123",
    memberId: "member_123",
    nextAttemptAt: new Date("2026-03-28T10:30:00.000Z"),
    payTxHash: null,
    paymentAmount: "1000000000000000",
    paymentAssetAddress: REVNET_NATIVE_TOKEN,
    projectId: "1",
    status: HostedRevnetIssuanceStatus.pending,
    stripeChargeId: null,
    stripeInvoiceId: "in_123",
    stripePaymentAmountMinor: 500,
    stripePaymentCurrency: "usd",
    stripePaymentIntentId: "pi_123",
    submittedAt: null,
    terminalAddress: "0x0000000000000000000000000000000000000001",
    updatedAt: new Date("2026-03-28T10:30:00.000Z"),
    ...overrides,
  };
}

function createStripeQueueHarness(input: {
  checkouts?: MutableCheckout[];
  invites?: MutableInvite[];
  members?: MutableMember[];
  revnetIssuances?: MutableRevnetIssuance[];
  sessions?: MutableSession[];
}) {
  const checkouts = input.checkouts ?? [];
  const invites = input.invites ?? [];
  const members = input.members ?? [];
  const revnetIssuances = input.revnetIssuances ?? [];
  const sessions = input.sessions ?? [];
  const stripeEvents: MutableStripeEvent[] = [];
  let clock = 0;

  const touch = () => new Date(Date.UTC(2026, 2, 28, 12, 0, clock++));
  const sameDate = (left: Date | null | undefined, right: Date | null | undefined) =>
    (left?.getTime() ?? null) === (right?.getTime() ?? null);
  const findMember = (where: Record<string, unknown>) => members.find((member) =>
    ("id" in where && where.id === member.id) ||
    ("stripeCustomerId" in where && where.stripeCustomerId === member.stripeCustomerId) ||
    ("stripeSubscriptionId" in where && where.stripeSubscriptionId === member.stripeSubscriptionId));

  const hostedStripeEventCreate = vi.fn(async ({ data }: { data: MutableStripeEventCreate }) => {
    if (stripeEvents.some((event) => event.eventId === data.eventId)) {
      throw new Error(`duplicate stripe event ${data.eventId}`);
    }

    stripeEvents.push({
      attemptCount: data.attemptCount,
      chargeId: data.chargeId,
      checkoutSessionId: data.checkoutSessionId,
      claimExpiresAt: null,
      createdAt: touch(),
      customerId: data.customerId,
      eventId: data.eventId,
      invoiceId: data.invoiceId,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextAttemptAt: data.nextAttemptAt,
      payloadJson: data.payloadJson,
      paymentIntentId: data.paymentIntentId,
      processedAt: null,
      receivedAt: data.receivedAt,
      status: data.status,
      stripeCreatedAt: data.stripeCreatedAt,
      subscriptionId: data.subscriptionId,
      type: data.type,
      updatedAt: touch(),
    });
  });
  const hostedStripeEventFindMany = vi.fn(async () => stripeEvents
    .filter((event) =>
      ((event.status === HostedStripeEventStatus.pending ||
        event.status === HostedStripeEventStatus.failed) &&
        event.nextAttemptAt.getTime() <= Date.now()) ||
      (event.status === HostedStripeEventStatus.processing &&
        event.claimExpiresAt !== null &&
        event.claimExpiresAt.getTime() <= Date.now()))
    .sort((left, right) =>
      left.stripeCreatedAt.getTime() - right.stripeCreatedAt.getTime() ||
      left.createdAt.getTime() - right.createdAt.getTime()));
  const hostedStripeEventUpdateMany = vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
    const event = stripeEvents.find((candidate) =>
      candidate.eventId === where.eventId &&
      sameDate(candidate.updatedAt, where.updatedAt as Date));

    if (!event) {
      return { count: 0 };
    }

    if (typeof data.attemptCount === "object" && data.attemptCount && "increment" in data.attemptCount) {
      event.attemptCount += Number((data.attemptCount as { increment: number }).increment);
    }

    for (const [key, value] of Object.entries(data)) {
      if (key === "attemptCount") {
        continue;
      }

      (event as unknown as Record<string, unknown>)[key] = value;
    }

    event.updatedAt = touch();
    return { count: 1 };
  });
  const hostedStripeEventFindUnique = vi.fn(async ({ where }: { where: { eventId: string } }) =>
    stripeEvents.find((event) => event.eventId === where.eventId) ?? null);
  const hostedStripeEventUpdate = vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: { eventId: string } }) => {
    const event = stripeEvents.find((candidate) => candidate.eventId === where.eventId);

    if (!event) {
      throw new Error(`missing stripe event ${where.eventId}`);
    }

    Object.assign(event, data, {
      updatedAt: touch(),
    });
    return event;
  });

  const hostedMemberFindUnique = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    findMember(where) ?? null);
  const hostedMemberUpdateMany = vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
    const member = members.find((candidate) => candidate.id === where.id);

    if (!member) {
      return { count: 0 };
    }

    const billingStatusFilter = where.billingStatus as { notIn?: HostedBillingStatus[] } | undefined;
    if (billingStatusFilter?.notIn?.includes(member.billingStatus)) {
      return { count: 0 };
    }

    const statusFilter = where.status as { not?: HostedMemberStatus } | undefined;
    if (statusFilter?.not && member.status === statusFilter.not) {
      return { count: 0 };
    }

    if (
      "stripeLatestBillingEventCreatedAt" in where &&
      !Array.isArray(where.OR) &&
      !sameDate(
        member.stripeLatestBillingEventCreatedAt,
        where.stripeLatestBillingEventCreatedAt as Date | null,
      )
    ) {
      return { count: 0 };
    }

    if (
      "stripeLatestBillingEventId" in where &&
      !Array.isArray(where.OR) &&
      member.stripeLatestBillingEventId !== (where.stripeLatestBillingEventId as string | null)
    ) {
      return { count: 0 };
    }

    const freshnessConditions = Array.isArray(where.OR) ? where.OR : [];
    const freshnessMatch = freshnessConditions.length === 0 || freshnessConditions.some((condition) => {
      if (condition.stripeLatestBillingEventCreatedAt === null) {
        return member.stripeLatestBillingEventCreatedAt === null;
      }

      if (condition.stripeLatestBillingEventCreatedAt?.lt instanceof Date) {
        return (
          member.stripeLatestBillingEventCreatedAt === null ||
          member.stripeLatestBillingEventCreatedAt.getTime() <
            condition.stripeLatestBillingEventCreatedAt.lt.getTime()
        );
      }

      if (Array.isArray(condition.AND)) {
        return condition.AND.every((andCondition: Record<string, unknown>) => {
          if (andCondition.stripeLatestBillingEventCreatedAt instanceof Date) {
            return (
              member.stripeLatestBillingEventCreatedAt?.getTime() ===
              andCondition.stripeLatestBillingEventCreatedAt.getTime()
            );
          }

          if (Array.isArray(andCondition.OR)) {
            return andCondition.OR.some((orCondition: Record<string, unknown>) => {
              if (orCondition.stripeLatestBillingEventId === null) {
                return member.stripeLatestBillingEventId === null;
              }

              if (typeof orCondition.stripeLatestBillingEventId === "string") {
                return member.stripeLatestBillingEventId === orCondition.stripeLatestBillingEventId;
              }

              const stripeLatestBillingEventIdFilter = orCondition.stripeLatestBillingEventId as
                | { lt?: string }
                | null
                | undefined;

              if (typeof stripeLatestBillingEventIdFilter?.lt === "string") {
                return (
                  member.stripeLatestBillingEventId === null ||
                  member.stripeLatestBillingEventId < stripeLatestBillingEventIdFilter.lt
                );
              }

              return false;
            });
          }

          return false;
        });
      }

      if (condition.stripeLatestBillingEventCreatedAt instanceof Date) {
        return (
          member.stripeLatestBillingEventCreatedAt?.getTime() ===
            condition.stripeLatestBillingEventCreatedAt.getTime() &&
          member.stripeLatestBillingEventId === condition.stripeLatestBillingEventId
        );
      }

      return false;
    });

    if (!freshnessMatch) {
      return { count: 0 };
    }

    Object.assign(member, data);
    return { count: 1 };
  });
  const hostedMemberUpdate = vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: { id: string } }) => {
    const member = members.find((candidate) => candidate.id === where.id);

    if (!member) {
      throw new Error(`missing hosted member ${where.id}`);
    }

    Object.assign(member, data);
    return member;
  });

  const hostedInviteUpdateMany = vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
    let count = 0;

    for (const invite of invites) {
      if (invite.memberId !== where.memberId) {
        continue;
      }

      if (where.paidAt === null && invite.paidAt !== null) {
        continue;
      }

      Object.assign(invite, data);
      count += 1;
    }

    return { count };
  });

  const hostedBillingCheckoutUpdateMany = vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
    let count = 0;

    for (const checkout of checkouts) {
      if (checkout.stripeCheckoutSessionId !== where.stripeCheckoutSessionId) {
        continue;
      }

      if (where.status && checkout.status !== where.status) {
        continue;
      }

      Object.assign(checkout, data);
      count += 1;
    }

    return { count };
  });

  const hostedRevnetIssuanceFindUnique = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    revnetIssuances.find((issuance) =>
      ("id" in where && issuance.id === where.id) ||
      ("idempotencyKey" in where && issuance.idempotencyKey === where.idempotencyKey)) ?? null);
  const hostedRevnetIssuanceCreate = vi.fn(async ({ data }: { data: MutableRevnetIssuanceCreate }) => {
    const issuance: MutableRevnetIssuance = {
      confirmedAt: null,
      createdAt: touch(),
      failureCode: null,
      failureMessage: null,
      payTxHash: null,
      status: HostedRevnetIssuanceStatus.pending,
      submittedAt: null,
      updatedAt: touch(),
      ...data,
    };
    revnetIssuances.push(issuance);
    return issuance;
  });
  const hostedRevnetIssuanceUpdate = vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
    const issuance = revnetIssuances.find((candidate) => candidate.id === where.id);

    if (!issuance) {
      throw new Error(`missing revnet issuance ${where.id}`);
    }

    Object.assign(issuance, data, {
      updatedAt: touch(),
    });
    return issuance;
  });
  const hostedRevnetIssuanceUpdateMany = vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
    const issuance = revnetIssuances.find((candidate) => {
      if ("id" in where && candidate.id !== where.id) {
        return false;
      }

      if ("payTxHash" in where && candidate.payTxHash !== where.payTxHash) {
        return false;
      }

      if ("status" in where && candidate.status !== where.status) {
        return false;
      }

      if ("updatedAt" in where && !sameDate(candidate.updatedAt, where.updatedAt as Date)) {
        return false;
      }

      return true;
    });

    if (!issuance) {
      return { count: 0 };
    }

    if (typeof data.attemptCount === "object" && data.attemptCount && "increment" in data.attemptCount) {
      issuance.attemptCount += Number((data.attemptCount as { increment: number }).increment);
    }

    const nextData = { ...data };
    delete (nextData as { attemptCount?: unknown }).attemptCount;

    Object.assign(issuance, nextData, {
      updatedAt: touch(),
    });
    return { count: 1 };
  });
  const hostedRevnetIssuanceFindMany = vi.fn(async ({
    take,
    where,
  }: {
    take?: number;
    where?: Record<string, unknown>;
  } = {}) =>
    revnetIssuances.filter((issuance) => {
      if (where?.payTxHash === null && issuance.payTxHash !== null) {
        return false;
      }

      if (
        where?.payTxHash &&
        typeof where.payTxHash === "object" &&
        "not" in where.payTxHash &&
        where.payTxHash.not === null &&
        issuance.payTxHash === null
      ) {
        return false;
      }

      if (Array.isArray(where?.OR)) {
        const matchesAnyStatus = where.OR.some((condition: Record<string, unknown>) => {
          if ("status" in condition && condition.status !== issuance.status) {
            return false;
          }

          if ("failureCode" in condition && condition.failureCode !== issuance.failureCode) {
            return false;
          }

          if (
            "updatedAt" in condition &&
            condition.updatedAt &&
            typeof condition.updatedAt === "object" &&
            "lte" in condition.updatedAt &&
            issuance.updatedAt.getTime() > (condition.updatedAt as { lte: Date }).lte.getTime()
          ) {
            return false;
          }

          if (
            "nextAttemptAt" in condition &&
            condition.nextAttemptAt &&
            typeof condition.nextAttemptAt === "object" &&
            "lte" in condition.nextAttemptAt &&
            issuance.nextAttemptAt.getTime() > (condition.nextAttemptAt as { lte: Date }).lte.getTime()
          ) {
            return false;
          }

          return true;
        });

        if (!matchesAnyStatus) {
          return false;
        }
      }

      if (where?.status && issuance.status !== where.status) {
        return false;
      }

      return true;
    })
      .slice(0, take ?? revnetIssuances.length));
  const hostedRevnetIssuanceFindFirst = vi.fn(async ({ where }: { where: { OR?: Array<Record<string, unknown>> } }) => {
    const issuance = revnetIssuances.find((candidate) =>
      (where.OR ?? []).some((condition) =>
        ("stripeChargeId" in condition && candidate.stripeChargeId === condition.stripeChargeId) ||
        ("stripePaymentIntentId" in condition && candidate.stripePaymentIntentId === condition.stripePaymentIntentId)));

    if (!issuance) {
      return null;
    }

    return {
      ...issuance,
      member: members.find((member) => member.id === issuance.memberId) ?? null,
    };
  });

  const hostedSessionUpdateMany = vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
    let count = 0;

    for (const session of sessions) {
      if (session.memberId !== where.memberId) {
        continue;
      }

      if (where.revokedAt === null && session.revokedAt !== null) {
        continue;
      }

      const expiresAtFilter = where.expiresAt as { gt?: Date } | undefined;
      if (expiresAtFilter?.gt instanceof Date && session.expiresAt.getTime() <= expiresAtFilter.gt.getTime()) {
        continue;
      }

      Object.assign(session, data);
      count += 1;
    }

    return { count };
  });

  const prisma: any = {
    $transaction: async <T>(callback: (tx: typeof prisma) => Promise<T>) => callback(prisma),
    hostedBillingCheckout: {
      updateMany: hostedBillingCheckoutUpdateMany,
    },
    hostedInvite: {
      updateMany: hostedInviteUpdateMany,
    },
    hostedMember: {
      findUnique: hostedMemberFindUnique,
      update: hostedMemberUpdate,
      updateMany: hostedMemberUpdateMany,
    },
    hostedRevnetIssuance: {
      create: hostedRevnetIssuanceCreate,
      findFirst: hostedRevnetIssuanceFindFirst,
      findMany: hostedRevnetIssuanceFindMany,
      findUnique: hostedRevnetIssuanceFindUnique,
      update: hostedRevnetIssuanceUpdate,
      updateMany: hostedRevnetIssuanceUpdateMany,
    },
    hostedSession: {
      updateMany: hostedSessionUpdateMany,
    },
    hostedStripeEvent: {
      create: hostedStripeEventCreate,
      findMany: hostedStripeEventFindMany,
      findUnique: hostedStripeEventFindUnique,
      update: hostedStripeEventUpdate,
      updateMany: hostedStripeEventUpdateMany,
    },
  };

  return {
    checkouts,
    invites,
    members,
    prisma,
    revnetIssuances,
    sessions,
    stripeEvents,
  };
}

type MutableCheckout = {
  amountTotal?: number | null;
  checkoutUrl: string;
  completedAt?: Date | null;
  currency?: string | null;
  expiredAt?: Date | null;
  id: string;
  inviteId: string;
  memberId: string;
  mode: HostedBillingMode;
  priceId: string;
  status: HostedBillingCheckoutStatus;
  stripeCheckoutSessionId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  supersededAt?: Date | null;
};

type MutableInvite = {
  id: string;
  memberId: string;
  paidAt: Date | null;
  status: HostedInviteStatus;
};

type MutableMember = {
  billingMode: HostedBillingMode | null;
  billingStatus: HostedBillingStatus;
  id: string;
  normalizedPhoneNumber: string;
  status: HostedMemberStatus;
  stripeCustomerId: string | null;
  stripeLatestBillingEventCreatedAt: Date | null;
  stripeLatestBillingEventId: string | null;
  stripeLatestCheckoutSessionId: string | null;
  stripeSubscriptionId: string | null;
  walletAddress: string | null;
};

type MutableRevnetIssuance = {
  attemptCount: number;
  beneficiaryAddress: string;
  chainId: number;
  confirmedAt: Date | null;
  createdAt: Date;
  failureCode: string | null;
  failureMessage: string | null;
  id: string;
  idempotencyKey: string;
  memberId: string;
  nextAttemptAt: Date;
  payTxHash: string | null;
  paymentAmount: string;
  paymentAssetAddress: string;
  projectId: string;
  status: HostedRevnetIssuanceStatus;
  stripeChargeId: string | null;
  stripeInvoiceId: string;
  stripePaymentAmountMinor: number;
  stripePaymentCurrency: string;
  stripePaymentIntentId: string | null;
  submittedAt: Date | null;
  terminalAddress: string;
  updatedAt: Date;
};

type MutableSession = {
  expiresAt: Date;
  id: string;
  memberId: string;
  revokedAt: Date | null;
  revokeReason: string | null;
};

type MutableStripeEvent = {
  attemptCount: number;
  chargeId: string | null;
  checkoutSessionId: string | null;
  claimExpiresAt: Date | null;
  createdAt: Date;
  customerId: string | null;
  eventId: string;
  invoiceId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextAttemptAt: Date;
  payloadJson: Record<string, unknown>;
  paymentIntentId: string | null;
  processedAt: Date | null;
  receivedAt: Date;
  status: HostedStripeEventStatus;
  stripeCreatedAt: Date;
  subscriptionId: string | null;
  type: string;
  updatedAt: Date;
};

type MutableStripeEventCreate = Omit<MutableStripeEvent, "claimExpiresAt" | "createdAt" | "lastErrorCode" | "lastErrorMessage" | "processedAt" | "updatedAt">;
type MutableRevnetIssuanceCreate = Omit<
  MutableRevnetIssuance,
  "confirmedAt" | "createdAt" | "failureCode" | "failureMessage" | "payTxHash" | "status" | "submittedAt" | "updatedAt"
>;

import { HostedBillingStatus } from "@prisma/client";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberBillingSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  activateHostedMemberForPositiveSourceTx: vi.fn(),
  findMemberForStripeInvoice: vi.fn(),
  findMemberForStripeSubscription: vi.fn(),
  prepareHostedMemberStripeBillingWrite: vi.fn(),
  upsertHostedMemberStripeCheckoutEmailIfFreshTx: vi.fn(),
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
    findMemberForStripeInvoice: mocks.findMemberForStripeInvoice,
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

import {
  applyStripeInvoicePaid,
  applyStripeSubscriptionUpdated,
} from "@/src/lib/hosted-onboarding/stripe-billing-events";

describe("hosted onboarding stripe billing events", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const member = makeMemberSnapshot();
    mocks.findMemberForStripeInvoice.mockResolvedValue(member);
    mocks.findMemberForStripeSubscription.mockResolvedValue(member);
    mocks.prepareHostedMemberStripeBillingWrite.mockResolvedValue({
      canonicalBillingStatus: HostedBillingStatus.active,
      member,
    });
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValue(member);
    mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: {
        address: "payer@example.com",
        collectedAt: new Date("2026-04-23T00:00:00.000Z"),
      },
      verifiedEmail: null,
    });
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValue({
      activated: true,
      hostedExecutionEventId: "wake_123",
      memberId: member.core.id,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
    });

    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(expect.objectContaining({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      freshnessPolicy: "positive-invoice-entitlement",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    }));
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
    });

    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberStripeCheckoutEmailIfFreshTx).not.toHaveBeenCalled();
  });

  it("infers subscription plan code from any base price before usage prices", async () => {
    vi.stubEnv("HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY", "price_pulse_base");
    vi.stubEnv("HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_LAUNCH_MONTHLY", "price_pulse_usage");
    vi.stubEnv("HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY", "price_edge_base");
    vi.stubEnv("HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_LAUNCH_EDGE_MONTHLY", "price_edge_usage");

    await applyStripeSubscriptionUpdated(
      makeStripeSubscription({
        items: ["price_edge_usage", "price_edge_base"],
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
});

function makeMemberSnapshot(): HostedMemberBillingSnapshot {
  return {
    billingRef: {
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    },
    core: {
      billingStatus: HostedBillingStatus.incomplete,
      createdAt: new Date("2026-04-23T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-04-23T00:00:00.000Z"),
    },
  };
}

function makeStripeInvoice(
  overrides?: Partial<{
    customer: string | null;
    customerEmail: string | null;
    id: string;
    subscription: string | null;
  }>,
): Stripe.Invoice {
  // @ts-expect-error - the synthetic fixture is intentionally narrower than Stripe.Invoice.
  return {
    customer: overrides?.customer ?? "cus_123",
    customer_email: overrides?.customerEmail ?? null,
    id: overrides?.id ?? "in_123",
    subscription: overrides?.subscription ?? "sub_123",
  } as Stripe.Invoice;
}

function makeStripeSubscription(
  overrides?: Partial<{
    customer: string | null;
    id: string;
    items: string[];
    status: Stripe.Subscription.Status;
  }>,
): Stripe.Subscription {
  return {
    customer: overrides?.customer ?? "cus_123",
    id: overrides?.id ?? "sub_123",
    items: {
      data: (overrides?.items ?? []).map((priceId) => ({
        price: {
          id: priceId,
        },
      })),
    },
    status: overrides?.status ?? "active",
  } as Stripe.Subscription;
}

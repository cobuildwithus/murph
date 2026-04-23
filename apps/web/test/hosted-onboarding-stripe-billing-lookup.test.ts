import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  lookupHostedMemberStripeBillingRefByStripeCustomerId: vi.fn(),
  lookupHostedMemberStripeBillingRefByStripeSubscriptionId: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  stripeSubscriptionsRetrieve: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-billing-store")
  >("@/src/lib/hosted-onboarding/hosted-member-billing-store");

  return {
    ...actual,
    lookupHostedMemberStripeBillingRefByStripeCustomerId:
      mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId,
    lookupHostedMemberStripeBillingRefByStripeSubscriptionId:
      mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    readHostedMemberCoreState: mocks.readHostedMemberCoreState,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/runtime")
  >("@/src/lib/hosted-onboarding/runtime");

  return {
    ...actual,
    requireHostedStripeApi: () => ({
      subscriptions: {
        retrieve: mocks.stripeSubscriptionsRetrieve,
      },
    }),
  };
});

import { findMemberForStripeInvoice } from "@/src/lib/hosted-onboarding/stripe-billing-lookup";

describe("hosted onboarding stripe billing lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId.mockResolvedValue(null);
    mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId.mockResolvedValue(null);
    mocks.readHostedMemberCoreState.mockResolvedValue(makeHostedMemberCoreState());
    mocks.stripeSubscriptionsRetrieve.mockResolvedValue(
      makeStripeSubscription({
        customer: "cus_live",
        id: "sub_live",
        metadata: {
          memberId: "member_123",
        },
      }),
    );
  });

  it("resolves invoice.paid members from the live Stripe subscription when local billing refs have not been written yet", async () => {
    await expect(
      findMemberForStripeInvoice({
        invoice: makeStripeInvoice({
          customer: "cus_invoice",
          id: "in_123",
          subscription: "sub_live",
        }),
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      billingRef: null,
      core: makeHostedMemberCoreState(),
    });

    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_live",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).toHaveBeenCalledWith({
      prisma: {},
      stripeCustomerId: "cus_invoice",
    });
    expect(mocks.stripeSubscriptionsRetrieve).toHaveBeenCalledWith("sub_live");
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
  });

  it("surfaces ambiguous local Stripe billing refs instead of falling through to another member candidate", async () => {
    mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "STRIPE_BILLING_LOOKUP_AMBIGUOUS",
        httpStatus: 500,
        message: "ambiguous",
        retryable: true,
      }),
    );

    await expect(
      findMemberForStripeInvoice({
        invoice: makeStripeInvoice({
          customer: "cus_invoice",
          id: "in_ambiguous",
          subscription: "sub_live",
        }),
        prisma: {} as never,
      }),
    ).rejects.toMatchObject({
      code: "STRIPE_BILLING_LOOKUP_AMBIGUOUS",
      httpStatus: 500,
      name: "HostedOnboardingError",
      retryable: true,
    });

    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_live",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).not.toHaveBeenCalled();
    expect(mocks.stripeSubscriptionsRetrieve).not.toHaveBeenCalled();
  });
});

function makeHostedMemberCoreState() {
  return {
    billingStatus: "incomplete" as const,
    createdAt: new Date("2026-04-23T00:00:00.000Z"),
    id: "member_123",
    suspendedAt: null,
    updatedAt: new Date("2026-04-23T00:00:00.000Z"),
  };
}

function makeStripeInvoice(
  overrides?: Partial<{
    customer: string | null;
    id: string;
    subscription: string | null;
  }>,
): Stripe.Invoice {
  // @ts-expect-error - the synthetic fixture is intentionally narrower than Stripe.Invoice.
  return {
    customer: overrides?.customer ?? "cus_123",
    id: overrides?.id ?? "in_123",
    subscription: overrides?.subscription ?? "sub_123",
  } as Stripe.Invoice;
}

function makeStripeSubscription(
  overrides?: Partial<{
    customer: string;
    id: string;
    metadata: Record<string, string>;
  }>,
): Stripe.Subscription {
  return {
    customer: overrides?.customer ?? "cus_123",
    id: overrides?.id ?? "sub_123",
    metadata: overrides?.metadata ?? {},
    status: "active",
  } as Stripe.Subscription;
}

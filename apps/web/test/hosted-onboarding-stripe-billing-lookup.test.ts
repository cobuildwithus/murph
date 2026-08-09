import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedMemberPulseTrialBillingDecisionSnapshot,
} from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  lookupHostedMemberStripeBillingRefByStripeCustomerId: vi.fn(),
  lookupHostedMemberStripeBillingRefByStripeSubscriptionId: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
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
    readHostedMemberBillingSnapshot: mocks.readHostedMemberBillingSnapshot,
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

import {
  findMemberForStripeCheckoutSession,
  findMemberForStripeInvoice,
  findMemberForStripeSubscription,
  listHostedStripeCheckoutSessionMemberIds,
} from "@/src/lib/hosted-onboarding/stripe-billing-lookup";

describe("hosted onboarding stripe billing lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId.mockResolvedValue(null);
    mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId.mockResolvedValue(null);
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeMemberSnapshot());
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
    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
  });

  it("resolves a Family Checkout Session to its owner before webhook binding", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "member_owner" }]);

    await expect(listHostedStripeCheckoutSessionMemberIds({
      prisma: {
        hostedMember: { findMany },
      } as never,
      session: makeStripeCheckoutSession(),
    })).resolves.toEqual(["member_owner"]);

    expect(findMany).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        id: {
          in: ["member_owner", "hbag_family"],
        },
      },
    });
  });

  it("uses direct Checkout metadata only to resolve a core-only member", async () => {
    await expect(findMemberForStripeCheckoutSession({
      prisma: {} as never,
      session: {
        client_reference_id: "member_123",
        customer: "cus_checkout",
        metadata: {
          memberId: "member_123",
        },
        subscription: "sub_checkout",
      } as never,
    })).resolves.toEqual({
      billingRef: null,
      core: makeHostedMemberCoreState(),
    });

    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
    expect(mocks.readHostedMemberBillingSnapshot).not.toHaveBeenCalled();
  });

  it("reads Pulse decision authority without encrypted billing fields", async () => {
    const core = makeHostedMemberCoreState({
      billingStatus: "incomplete",
    });
    const findUnique = vi.fn().mockResolvedValue({
      ...core,
      billingRef: {
        currentBillingPhase: null,
        currentTrialStartedAt: new Date("2025-04-10T00:00:00.000Z"),
        pulseTrialRedeemedAt: new Date("2025-04-11T00:00:00.000Z"),
        stripeSubscriptionLookupKey: "subscription-lookup",
      },
    });

    await expect(
      readHostedMemberPulseTrialBillingDecisionSnapshot({
        memberId: "member_123",
        prisma: {
          hostedMember: { findUnique },
        } as never,
      }),
    ).resolves.toEqual({
      core,
      currentBillingPhase: null,
      currentTrialStartedAt: new Date("2025-04-10T00:00:00.000Z"),
      pulseTrialRedeemedAt: new Date("2025-04-11T00:00:00.000Z"),
      stripeSubscriptionLookupKey: "subscription-lookup",
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        id: "member_123",
      },
      select: {
        billingStatus: true,
        createdAt: true,
        id: true,
        suspendedAt: true,
        updatedAt: true,
        billingRef: {
          select: {
            currentBillingPhase: true,
            currentTrialStartedAt: true,
            pulseTrialRedeemedAt: true,
            stripeSubscriptionLookupKey: true,
          },
        },
      },
    });
  });

  it("does not let subscription metadata rebind a member that already has a different subscription", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(makeMemberSnapshot({
      billingRef: makeBillingRef({
        currentBillingPhase: "paid",
        stripeCustomerId: "cus_live",
        stripeSubscriptionId: "sub_paid",
      }),
      core: makeHostedMemberCoreState({
        billingStatus: "active",
      }),
    }));

    await expect(
      findMemberForStripeSubscription({
        prisma: {} as never,
        subscription: makeStripeSubscription({
          customer: "cus_live",
          id: "sub_orphan",
          metadata: {
            memberId: "member_123",
          },
        }),
      }),
    ).resolves.toBeNull();

    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_orphan",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).toHaveBeenCalledWith({
      prisma: {},
      stripeCustomerId: "cus_live",
    });
  });

  it("does not let subscription customer lookup rebind a member that already has a different subscription", async () => {
    const core = makeHostedMemberCoreState({
      billingStatus: "active",
    });
    const billingRef = makeBillingRef({
      currentBillingPhase: "paid",
      stripeCustomerId: "cus_live",
      stripeSubscriptionId: "sub_paid",
    });
    mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId.mockResolvedValueOnce({
      billingRef,
      core,
      matchedBy: "stripeCustomerId",
    });

    await expect(
      findMemberForStripeSubscription({
        prisma: {} as never,
        subscription: makeStripeSubscription({
          customer: "cus_live",
          id: "sub_orphan",
          metadata: {},
        }),
      }),
    ).resolves.toBeNull();

    expect(mocks.readHostedMemberBillingSnapshot).not.toHaveBeenCalled();
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_orphan",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).toHaveBeenCalledWith({
      prisma: {},
      stripeCustomerId: "cus_live",
    });
  });

  it("does not let subscription metadata rebind a member with a different existing customer", async () => {
    const core = makeHostedMemberCoreState({
      billingStatus: "incomplete",
    });
    const billingRef = makeBillingRef({
      currentBillingPhase: null,
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: null,
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce({
      billingRef,
      core,
    });

    await expect(
      findMemberForStripeSubscription({
        prisma: {} as never,
        subscription: makeStripeSubscription({
          customer: "cus_orphan",
          id: "sub_orphan",
          metadata: {
            memberId: "member_123",
          },
        }),
      }),
    ).resolves.toBeNull();

    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_orphan",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).toHaveBeenCalledWith({
      prisma: {},
      stripeCustomerId: "cus_orphan",
    });
  });

  it("allows subscription metadata to bind a new subscription when the existing customer matches", async () => {
    const core = makeHostedMemberCoreState({
      billingStatus: "incomplete",
    });
    const billingRef = makeBillingRef({
      currentBillingPhase: null,
      stripeCustomerId: "cus_live",
      stripeSubscriptionId: null,
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce({
      billingRef,
      core,
    });

    await expect(
      findMemberForStripeSubscription({
        prisma: {} as never,
        subscription: makeStripeSubscription({
          customer: "cus_live",
          id: "sub_new",
          metadata: {
            memberId: "member_123",
          },
        }),
      }),
    ).resolves.toEqual({
      billingRef,
      core,
    });

    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).not.toHaveBeenCalled();
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).not.toHaveBeenCalled();
  });

  it("does not let invoice customer lookup rebind a member that already has a different subscription", async () => {
    const core = makeHostedMemberCoreState({
      billingStatus: "active",
    });
    const billingRef = makeBillingRef({
      currentBillingPhase: "paid",
      stripeCustomerId: "cus_live",
      stripeSubscriptionId: "sub_paid",
    });
    mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId.mockResolvedValueOnce({
      billingRef,
      core,
      matchedBy: "stripeCustomerId",
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce({
      billingRef,
      core,
    });
    mocks.stripeSubscriptionsRetrieve.mockResolvedValueOnce(
      makeStripeSubscription({
        customer: "cus_live",
        id: "sub_orphan",
        metadata: {
          memberId: "member_123",
        },
      }),
    );

    await expect(
      findMemberForStripeInvoice({
        invoice: makeStripeInvoice({
          customer: "cus_live",
          id: "in_orphan",
          subscription: "sub_orphan",
        }),
        prisma: {} as never,
      }),
    ).resolves.toBeNull();

    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_orphan",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).toHaveBeenCalledWith({
      prisma: {},
      stripeCustomerId: "cus_live",
    });
    expect(mocks.stripeSubscriptionsRetrieve).toHaveBeenCalledWith("sub_orphan");
    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
  });

  it("does not let invoice live subscription metadata rebind a member with a different existing customer", async () => {
    const core = makeHostedMemberCoreState({
      billingStatus: "incomplete",
    });
    const billingRef = makeBillingRef({
      currentBillingPhase: null,
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: null,
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce({
      billingRef,
      core,
    });
    mocks.stripeSubscriptionsRetrieve.mockResolvedValueOnce(
      makeStripeSubscription({
        customer: "cus_orphan",
        id: "sub_orphan",
        metadata: {
          memberId: "member_123",
        },
      }),
    );

    await expect(
      findMemberForStripeInvoice({
        invoice: makeStripeInvoice({
          customer: "cus_orphan",
          id: "in_orphan",
          subscription: "sub_orphan",
        }),
        prisma: {} as never,
      }),
    ).resolves.toBeNull();

    expect(mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionId).toHaveBeenCalledWith({
      prisma: {},
      stripeSubscriptionId: "sub_orphan",
    });
    expect(mocks.lookupHostedMemberStripeBillingRefByStripeCustomerId).toHaveBeenCalledWith({
      prisma: {},
      stripeCustomerId: "cus_orphan",
    });
    expect(mocks.stripeSubscriptionsRetrieve).toHaveBeenCalledWith("sub_orphan");
    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledWith({
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

function makeMemberSnapshot(overrides?: {
  billingRef?: ReturnType<typeof makeBillingRef> | null;
  core?: ReturnType<typeof makeHostedMemberCoreState>;
}) {
  return {
    billingRef: overrides?.billingRef ?? null,
    core: overrides?.core ?? makeHostedMemberCoreState(),
  };
}

function makeBillingRef(
  overrides?: Partial<{
    currentBillingPhase: string | null;
    memberId: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  }>,
) {
  return {
    currentBillingPhase: overrides && "currentBillingPhase" in overrides
      ? overrides.currentBillingPhase
      : undefined,
    memberId: overrides?.memberId ?? "member_123",
    stripeCustomerId: overrides && "stripeCustomerId" in overrides
      ? overrides.stripeCustomerId
      : "cus_123",
    stripeSubscriptionId: overrides && "stripeSubscriptionId" in overrides
      ? overrides.stripeSubscriptionId
      : "sub_123",
  };
}

function makeHostedMemberCoreState(overrides?: Partial<{
  billingStatus: "active" | "incomplete";
  id: string;
}>) {
  return {
    billingStatus: overrides?.billingStatus ?? "incomplete" as const,
    createdAt: new Date("2026-04-23T00:00:00.000Z"),
    id: overrides?.id ?? "member_123",
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

function makeStripeCheckoutSession(): Stripe.Checkout.Session {
  // @ts-expect-error - the synthetic fixture is intentionally narrower than Stripe.Checkout.Session.
  return {
    client_reference_id: "hbag_family",
    customer: null,
    metadata: {
      accountGroupId: "hbag_family",
      kind: "hosted_family_plan",
      ownerMemberId: "member_owner",
    },
    subscription: null,
  } as Stripe.Checkout.Session;
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

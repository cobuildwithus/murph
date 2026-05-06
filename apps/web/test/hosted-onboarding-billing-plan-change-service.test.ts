import { beforeEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  applyStripeSubscriptionUpdated: vi.fn(),
  getPrisma: vi.fn(),
  nudgeHostedRunnerUserBestEffortResult: vi.fn(),
  prismaClient: {
    $transaction: vi.fn(),
    hostedMember: {
      findUnique: vi.fn(),
    },
  },
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedOnboardingPublicBaseUrl: vi.fn(),
  requireHostedStripeCheckoutConfig: vi.fn(),
  resolveHostedAiUsageGate: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingPublicBaseUrl: mocks.requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeCheckoutConfig: mocks.requireHostedStripeCheckoutConfig,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", () => ({
  applyStripeSubscriptionUpdated: mocks.applyStripeSubscriptionUpdated,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

import {
  upgradeHostedBillingPlan,
} from "@/src/lib/hosted-onboarding/billing-plan-change-service";

describe("upgradeHostedBillingPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.prismaClient.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(mocks.prismaClient)
    );
    mocks.prismaClient.hostedMember.findUnique.mockResolvedValue({
      billingStatus: "active",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
      currentBillingPlanCode: "launch_monthly",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mocks.requireHostedStripeCheckoutConfig.mockImplementation((input: {
      billingPlanCode: "launch_monthly" | "launch_edge_monthly";
    }) => ({
      billingPlanCode: input.billingPlanCode,
      priceId: input.billingPlanCode === "launch_monthly"
        ? "price_pulse_recurring"
        : "price_edge_recurring",
      stripe: mocks.stripe,
      usagePriceId: input.billingPlanCode === "launch_monthly"
        ? "price_pulse_usage"
        : "price_edge_usage",
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
        ["si_addon", "price_unknown_addon"],
      ],
      metadata: {
        billingPlanCode: "launch_monthly",
        memberId: "member_123",
      },
      status: "active",
    }));
    mocks.stripe.subscriptions.update.mockResolvedValue(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_edge_recurring"],
        ["si_usage", "price_edge_usage"],
        ["si_addon", "price_unknown_addon"],
      ],
      metadata: {
        billingPlanCode: "launch_edge_monthly",
        memberId: "member_123",
      },
      status: "active",
    }));
    mocks.stripe.billingPortal.sessions.create.mockResolvedValue({
      url: "https://stripe.example.test/portal/session_123",
    });
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.resolveHostedAiUsageGate.mockResolvedValue({
      allowed: true,
    });
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      status: "sent",
    });
  });

  test("updates the existing Pulse subscription items to Edge and leaves unknown items untouched", async () => {
    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith("sub_123", {
      expand: ["items.data.price", "latest_invoice.payment_intent"],
      items: [
        {
          id: "si_recurring",
          price: "price_edge_recurring",
          quantity: 1,
        },
        {
          id: "si_usage",
          price: "price_edge_usage",
        },
      ],
      metadata: {
        billingPlanCode: "launch_edge_monthly",
        memberId: "member_123",
      },
      payment_behavior: "pending_if_incomplete",
      proration_behavior: "always_invoice",
    }, {
      idempotencyKey: expect.stringMatching(/^hosted-billing-plan-upgrade:[a-f0-9]{64}$/u),
    });
    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sub_123",
        metadata: expect.objectContaining({
          billingPlanCode: "launch_edge_monthly",
        }),
      }),
      expect.objectContaining({
        sourceEventId: "subscription:sub_123:plan-upgrade",
        sourceType: "stripe.customer.subscription.updated.inline-plan-upgrade",
      }),
      mocks.prismaClient,
    );
    expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledWith({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      prisma: mocks.prismaClient,
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "billing.plan-upgrade",
      userId: "member_123",
    });
  });

  test("returns already_on_plan without calling Stripe when the billing ref is already Edge", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPlanCode: "launch_edge_monthly",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_edge_monthly",
      status: "already_on_plan",
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("rejects suspended members", async () => {
    mocks.prismaClient.hostedMember.findUnique.mockResolvedValueOnce({
      billingStatus: "active",
      id: "member_123",
      suspendedAt: new Date("2026-05-06T00:00:00.000Z"),
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });
  });

  test("rejects inactive billing status", async () => {
    mocks.prismaClient.hostedMember.findUnique.mockResolvedValueOnce({
      billingStatus: "past_due",
      id: "member_123",
      suspendedAt: null,
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
    });
  });

  test("rejects missing Stripe subscription identifiers", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPlanCode: "launch_monthly",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: null,
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_NOT_READY",
      httpStatus: 409,
    });
  });

  test("rejects unsupported transitions", async () => {
    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_UNSUPPORTED",
      httpStatus: 400,
    });
  });

  test("rejects Stripe customer mismatches", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_other",
      items: [
        ["si_recurring", "price_pulse_recurring"],
      ],
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_CUSTOMER_MISMATCH",
      httpStatus: 409,
    });
  });

  test("maps Stripe provider failures to safe retryable route errors", async () => {
    mocks.stripe.subscriptions.retrieve.mockRejectedValueOnce(
      new Error("No such subscription: sub_sensitive_123"),
    );

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE",
      httpStatus: 502,
      message: "Stripe billing is unavailable for plan changes right now. Try again shortly.",
      retryable: true,
    });
  });

  test("adds the Edge usage item when the Pulse subscription has only the recurring item", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
      ],
      metadata: {
        billingPlanCode: "launch_monthly",
        memberId: "member_123",
      },
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith("sub_123", expect.objectContaining({
      items: [
        {
          id: "si_recurring",
          price: "price_edge_recurring",
          quantity: 1,
        },
        {
          price: "price_edge_usage",
        },
      ],
    }), expect.any(Object));
  });

  test("returns a Billing Portal fallback when the Stripe update stays pending", async () => {
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
      ],
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      pendingUpdate: true,
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      billingPortalUrl: "https://stripe.example.test/portal/session_123",
      status: "pending_payment",
    });

    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://join.example.test/home",
    });
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });
});

function makeSubscription(input: {
  customer: string;
  items: Array<[id: string, priceId: string]>;
  metadata: Record<string, string>;
  pendingUpdate?: boolean;
  status: Stripe.Subscription.Status;
}): Stripe.Subscription {
  return {
    customer: input.customer,
    id: "sub_123",
    items: {
      data: input.items.map(([id, priceId]) => ({
        id,
        price: {
          id: priceId,
        },
      })),
    },
    metadata: input.metadata,
    object: "subscription",
    pending_update: input.pendingUpdate ? {} : null,
    status: input.status,
  } as Stripe.Subscription;
}

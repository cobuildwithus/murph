import { beforeEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

import {
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY,
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
} from "@/src/lib/hosted-onboarding/legacy-usage-price";

const mocks = vi.hoisted(() => ({
  applyStripeSubscriptionUpdated: vi.fn(),
  getPrisma: vi.fn(),
  signalHostedRuntimeManualWakeBestEffort: vi.fn(),
  prismaClient: {
    $transaction: vi.fn(),
    hostedMember: {
      findUnique: vi.fn(),
    },
  },
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedOnboardingPublicBaseUrl: vi.fn(),
  requireHostedStripeBillingPlanConfig: vi.fn(),
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
  requireHostedStripeBillingPlanConfig: mocks.requireHostedStripeBillingPlanConfig,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", () => ({
  applyStripeSubscriptionUpdated: mocks.applyStripeSubscriptionUpdated,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-orchestration/manual-wake", () => ({
  signalHostedRuntimeManualWakeBestEffort: mocks.signalHostedRuntimeManualWakeBestEffort,
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
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mocks.requireHostedStripeBillingPlanConfig.mockImplementation((input: {
      billingPlanCode: "launch_monthly" | "launch_edge_monthly";
    }) => ({
      billingPlanCode: input.billingPlanCode,
      priceId: input.billingPlanCode === "launch_monthly"
        ? "price_pulse_recurring"
        : "price_edge_recurring",
      stripe: mocks.stripe,
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
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
      ],
      metadata: {
        billingPlanCode: "launch_edge_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
        trialDurationDays: "",
        trialPolicyVersion: "",
        trialUsageLimitUsdMicros: "",
      },
      status: "active",
    }));
    mocks.stripe.billingPortal.sessions.create.mockResolvedValue({
      url: "https://stripe.example.test/portal/session_123",
    });
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.resolveHostedAiUsageGate.mockResolvedValue({
      allowed: true,
      billingPlanCode: "launch_edge_monthly",
    });
    mocks.signalHostedRuntimeManualWakeBestEffort.mockResolvedValue({
      status: "sent",
    });
  });

  test("updates the existing Pulse subscription item to Edge and removes old metered items", async () => {
    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith("sub_123", {
      expand: ["items.data.price"],
      items: [
        {
          id: "si_recurring",
          price: "price_edge_recurring",
          quantity: 1,
        },
        {
          deleted: true,
          id: "si_usage",
        },
      ],
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
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).toHaveBeenCalledWith({
      userId: "member_123",
    });
  });

  test("rejects quantity-bearing metered subscription items during Edge upgrade", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage", 1],
      ],
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("rejects unmarked no-quantity metered subscription items during Edge upgrade", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_unknown_metered", "price_unknown_usage"],
      ],
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("rejects unsupported licensed subscription items during Edge upgrade", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_addon", "price_unknown_addon"],
      ],
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("rejects unsupported items returned by the Stripe Edge update before local reconciliation", async () => {
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_edge_recurring"],
        ["si_addon", "price_unknown_addon"],
      ],
      metadata: {
        billingPlanCode: "launch_edge_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
  });

  test("recovers when Stripe is already Edge and drops legacy metered items", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_edge_recurring"],
        ["si_usage", "price_edge_usage"],
      ],
      metadata: {
        billingPlanCode: "launch_edge_monthly",
        checkoutOffer: "standard",
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

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      {
        expand: ["items.data.price"],
        items: [
          {
            deleted: true,
            id: "si_usage",
          },
        ],
      },
      {
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-plan-upgrade-applied-items:[a-f0-9]{64}$/u,
        ),
      },
    );
    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sub_123",
      }),
      expect.objectContaining({
        sourceType: "stripe.customer.subscription.updated.inline-plan-upgrade",
      }),
      mocks.prismaClient,
    );
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).toHaveBeenCalledWith({
      userId: "member_123",
    });
  });

  test("rejects unsafe subscription items returned by Stripe cleanup before metadata repair", async () => {
    const staleMetadata: Record<string, string> = {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "pulse_trial_7d",
      memberId: "member_123",
      trialDurationDays: "10",
      trialPolicyVersion: "pulse-trial-2026-06-30-v2",
      trialUsageLimitUsdMicros: "4500000",
    };
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_edge_recurring"],
        ["si_usage", "price_edge_usage"],
      ],
      metadata: staleMetadata,
      status: "active",
    }));
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_edge_recurring"],
        ["si_usage", "price_edge_usage"],
      ],
      metadata: staleMetadata,
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
  });

  test("rejects quantity-bearing metered items when Stripe already has Edge applied", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_edge_recurring"],
        ["si_usage", "price_edge_usage", 1],
      ],
      metadata: {
        billingPlanCode: "launch_edge_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });

  test("rejects unmarked no-quantity metered items when Stripe already has Edge applied", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_edge_recurring"],
        ["si_unknown_metered", "price_unknown_usage"],
      ],
      metadata: {
        billingPlanCode: "launch_edge_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });

  test("rejects unsupported licensed items when Stripe already has Edge applied", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_edge_recurring"],
        ["si_addon", "price_unknown_addon"],
      ],
      metadata: {
        billingPlanCode: "launch_edge_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });

  test("normalizes stale Stripe metadata before recovering an already-applied Edge upgrade", async () => {
    const staleMetadata: Record<string, string> = {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "pulse_trial_7d",
      memberId: "member_123",
      trialDurationDays: "10",
      trialPolicyVersion: "pulse-trial-2026-06-30-v2",
      trialUsageLimitUsdMicros: "4500000",
    };
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_edge_recurring"],
      ],
      metadata: staleMetadata,
      status: "active",
    }));
    mocks.stripe.subscriptions.update.mockImplementationOnce(async (_id, params) =>
      makeSubscription({
        customer: "cus_123",
        items: [
          ["si_recurring", "price_edge_recurring"],
        ],
        metadata: applyStripeMetadataUpdate(staleMetadata, params.metadata ?? {}),
        status: "active",
      })
    );

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      {
        expand: ["items.data.price"],
        metadata: {
          billingPlanCode: "launch_edge_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
          trialDurationDays: "",
          trialPolicyVersion: "",
          trialUsageLimitUsdMicros: "",
        },
      },
      {
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-plan-upgrade-metadata:[a-f0-9]{64}$/u,
        ),
      },
    );
    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          billingPlanCode: "launch_edge_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
        }),
      }),
      expect.any(Object),
      mocks.prismaClient,
    );
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).toHaveBeenCalledWith({
      userId: "member_123",
    });
  });

  test("treats Stripe empty-string metadata updates as unset trial metadata fields", async () => {
    const staleMetadata: Record<string, string> = {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "pulse_trial_7d",
      memberId: "member_123",
      trialDurationDays: "10",
      trialPolicyVersion: "pulse-trial-2026-06-30-v2",
      trialUsageLimitUsdMicros: "4500000",
    };
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_edge_recurring"],
      ],
      metadata: staleMetadata,
      status: "active",
    }));
    mocks.stripe.subscriptions.update.mockImplementationOnce(async (_id, params) =>
      makeSubscription({
        customer: "cus_123",
        items: [
          ["si_recurring", "price_edge_recurring"],
        ],
        metadata: applyStripeMetadataUpdate(staleMetadata, params.metadata ?? {}),
        status: "active",
      })
    );

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });

    const [appliedSubscription] = mocks.applyStripeSubscriptionUpdated.mock.calls[0] as [
      Stripe.Subscription,
      unknown,
      unknown,
    ];
    expect(appliedSubscription.metadata).toEqual({
      billingPlanCode: "launch_edge_monthly",
      checkoutOffer: "standard",
      memberId: "member_123",
    });
    expect(Object.hasOwn(appliedSubscription.metadata, "trialDurationDays")).toBe(false);
    expect(Object.hasOwn(appliedSubscription.metadata, "trialPolicyVersion")).toBe(false);
    expect(Object.hasOwn(appliedSubscription.metadata, "trialUsageLimitUsdMicros")).toBe(false);
  });

  test("rejects Pulse Trial upgrades before mutating Stripe", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_TRIAL_UNSUPPORTED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("does not preserve Pulse Trial metadata when upgrading to Edge", async () => {
    const oldMetadata: Record<string, string> = {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "pulse_trial_7d",
      memberId: "member_123",
      trialDurationDays: "10",
      trialPolicyVersion: "pulse-trial-2026-06-30-v2",
      trialUsageLimitUsdMicros: "4500000",
    };
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
      ],
      metadata: oldMetadata,
      status: "active",
    }));
    mocks.stripe.subscriptions.update.mockImplementationOnce(async (_id, params) => {
      return makeSubscription({
        customer: "cus_123",
        items: [
          ["si_recurring", "price_edge_recurring"],
        ],
        metadata: applyStripeMetadataUpdate(oldMetadata, params.metadata ?? {}),
        status: "active",
      });
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenNthCalledWith(
      1,
      "sub_123",
      expect.objectContaining({
        expand: ["items.data.price"],
        items: [
          {
            id: "si_recurring",
            price: "price_edge_recurring",
            quantity: 1,
          },
          {
            deleted: true,
            id: "si_usage",
          },
        ],
        payment_behavior: "pending_if_incomplete",
        proration_behavior: "always_invoice",
      }),
      expect.any(Object),
    );
    expect(mocks.stripe.subscriptions.update).toHaveBeenNthCalledWith(
      2,
      "sub_123",
      expect.objectContaining({
        metadata: {
          billingPlanCode: "launch_edge_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
          trialDurationDays: "",
          trialPolicyVersion: "",
          trialUsageLimitUsdMicros: "",
        },
      }),
      expect.any(Object),
    );
    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          billingPlanCode: "launch_edge_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
        }),
      }),
      expect.any(Object),
      mocks.prismaClient,
    );
  });

  test("returns already_on_plan without calling Stripe when the billing ref is already Edge", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
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
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
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
    const error = new Error("No such subscription");
    Object.assign(error, {
      code: "resource_missing",
      param: "items[0][price]",
      requestId: "req_123",
      statusCode: 404,
      type: "StripeInvalidRequestError",
    });
    mocks.stripe.subscriptions.retrieve.mockRejectedValueOnce(error);

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE",
      details: {
        code: "resource_missing",
        operationName: "subscription.retrieve",
        requestIdPresent: true,
        stripeParam: "items[0][price]",
        statusCode: 404,
        type: "StripeInvalidRequestError",
      },
      httpStatus: 502,
      message: "Stripe billing is unavailable for plan changes right now. Try again shortly.",
      retryable: true,
    });
  });

  test("updates the recurring item when the Pulse subscription has only the recurring item", async () => {
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
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
  });

  test("does not report upgraded when local reconciliation has not reached Edge", async () => {
    mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
      allowed: true,
      billingPlanCode: "launch_monthly",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_RECONCILIATION_PENDING",
      httpStatus: 409,
      retryable: true,
    });

    expect(mocks.applyStripeSubscriptionUpdated).toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
  });
});

function makeSubscription(input: {
  customer: string;
  items: Array<[id: string, priceId: string, quantity?: number | null]>;
  metadata: Record<string, string>;
  pendingUpdate?: boolean;
  status: Stripe.Subscription.Status;
}): Stripe.Subscription {
  return {
    customer: input.customer,
    id: "sub_123",
    items: {
      data: input.items.map(([id, priceId, quantity]) => ({
        id,
        price: {
          id: priceId,
          metadata: isLegacyUsagePriceId(priceId)
            ? {
                [HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY]:
                  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
              }
            : {},
          recurring: {
            interval: "month",
            usage_type: priceId.endsWith("_usage") ? "metered" : "licensed",
          },
        },
        ...(quantity === undefined ? {} : { quantity }),
      })),
    },
    metadata: input.metadata,
    object: "subscription",
    pending_update: input.pendingUpdate ? {} : null,
    status: input.status,
  } as Stripe.Subscription;
}

function isLegacyUsagePriceId(priceId: string): boolean {
  return priceId === "price_pulse_usage" || priceId === "price_edge_usage";
}

function applyStripeMetadataUpdate(
  existing: Record<string, string>,
  update: Stripe.MetadataParam,
): Record<string, string> {
  const metadata = {
    ...existing,
  };
  for (const [key, value] of Object.entries(update)) {
    if (value === "") {
      delete metadata[key];
    } else if (typeof value === "string") {
      metadata[key] = value;
    }
  }

  return metadata;
}

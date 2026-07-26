import { beforeEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

import {
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY,
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
} from "@/src/lib/hosted-onboarding/legacy-usage-price";
import { makeSafeStripePortalConfiguration } from "./support/stripe-portal";

const mocks = vi.hoisted(() => ({
  applyStripeRecurringFinancialState: vi.fn(),
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
  readHostedStripeRecurringFinancialState: vi.fn(),
  classifyHostedStripeRecurringFinancialHealth: vi.fn(),
  requireHostedOnboardingPublicBaseUrl: vi.fn(),
  requireHostedStripeBillingPlanConfig: vi.fn(),
  resolveHostedStripePortalConfigurationId: vi.fn(),
  resolveHostedAiUsageGate: vi.fn(),
  withHostedMemberStripeMutationLock: vi.fn(),
  stripe: {
    billingPortal: {
      configurations: {
        retrieve: vi.fn(),
      },
      sessions: {
        create: vi.fn(),
      },
    },
    invoicePayments: {
      list: vi.fn(),
    },
    invoices: {
      retrieve: vi.fn(),
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
  withHostedMemberStripeMutationLock: mocks.withHostedMemberStripeMutationLock,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingPublicBaseUrl: mocks.requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeBillingPlanConfig: mocks.requireHostedStripeBillingPlanConfig,
  resolveHostedStripePortalConfigurationId:
    mocks.resolveHostedStripePortalConfigurationId,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", () => ({
  applyStripeRecurringFinancialState:
    mocks.applyStripeRecurringFinancialState,
  applyStripeSubscriptionUpdated: mocks.applyStripeSubscriptionUpdated,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-lookup", () => ({
  classifyHostedStripeRecurringFinancialHealth:
    mocks.classifyHostedStripeRecurringFinancialHealth,
  readHostedStripeRecurringFinancialState:
    mocks.readHostedStripeRecurringFinancialState,
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
    mocks.applyStripeRecurringFinancialState.mockResolvedValue({
      blockActiveProjection: false,
      state: "healthy",
    });
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValue({
      collectionState: { kind: "paid" },
      fullyRefunded: false,
      invoiceId: "in_current_period",
      outstandingDispute: false,
    });
    mocks.classifyHostedStripeRecurringFinancialHealth.mockReturnValue({
      kind: "healthy",
    });
    mocks.withHostedMemberStripeMutationLock.mockImplementation(
      async (input: { run: (tx: unknown) => Promise<unknown> }) =>
        input.run(mocks.prismaClient),
    );
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
    const defaultAppliedInvoice = makeInvoice({
      id: "in_applied_fixture",
      status: "paid",
    });
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
      latestInvoice: defaultAppliedInvoice,
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
    mocks.stripe.invoices.retrieve.mockResolvedValue(defaultAppliedInvoice);
    mocks.stripe.billingPortal.sessions.create.mockResolvedValue({
      url: "https://billing.stripe.com/p/session_123",
    });
    mocks.stripe.billingPortal.configurations.retrieve.mockImplementation(
      async (configurationId: string) =>
        makeSafeStripePortalConfiguration({
          configurationId,
          kind: "payment_recovery",
        }),
    );
    mocks.stripe.invoicePayments.list.mockResolvedValue({
      data: [],
      has_more: false,
      object: "list",
      url: "/v1/invoice_payments",
    });
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.resolveHostedStripePortalConfigurationId.mockReturnValue(undefined);
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
      expand: ["customer", "items.data.price", "latest_invoice"],
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

  test("does not project Edge access when post-update financial reconciliation blocks it", async () => {
    const paidInvoice = makeInvoice({
      id: "in_financially_blocked_upgrade",
      status: "paid",
    });
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_edge_recurring"],
      ],
      latestInvoice: paidInvoice,
      metadata: {
        billingPlanCode: "launch_edge_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      status: "active",
    }));
    mocks.stripe.invoices.retrieve.mockResolvedValueOnce(paidInvoice);
    mocks.applyStripeRecurringFinancialState.mockResolvedValueOnce({
      blockActiveProjection: true,
      state: "blocked",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_FINANCIAL_STATE_BLOCKED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeRecurringFinancialState).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
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
        expand: ["customer", "items.data.price", "latest_invoice"],
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
        expand: ["customer", "items.data.price", "latest_invoice"],
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
        expand: ["customer", "items.data.price", "latest_invoice"],
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
    const edgeBillingRef = {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    };
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(edgeBillingRef)
      .mockResolvedValueOnce(edgeBillingRef);

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_edge_monthly",
      status: "already_on_plan",
    });

    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMemberStripeBillingRef).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("does not return stale already_on_plan after the locked owner snapshot changes", async () => {
    const edgeBillingRef = {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    };
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(edgeBillingRef)
      .mockResolvedValueOnce({
        ...edgeBillingRef,
        stripeCustomerId: "cus_rebound",
        stripeSubscriptionId: "sub_rebound",
      });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_SOURCE_CHANGED",
      httpStatus: 409,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("keeps the canonical Stripe read and every Stripe mutation inside the member lock", async () => {
    let lockActive = false;
    const appliedInvoice = makeInvoice({
      id: "in_applied_under_lock",
      status: "paid",
    });
    const appliedInvoicePayment = makeInvoicePayment({
      id: "inpay_applied_under_lock",
      invoiceId: appliedInvoice.id,
      paymentIntentStatus: "succeeded",
    });
    mocks.withHostedMemberStripeMutationLock.mockImplementationOnce(
      async (input: { run: (tx: unknown) => Promise<unknown> }) => {
        lockActive = true;
        try {
          return await input.run(mocks.prismaClient);
        } finally {
          lockActive = false;
        }
      },
    );
    mocks.stripe.subscriptions.retrieve.mockImplementationOnce(async () => {
      expect(lockActive).toBe(true);
      return makeSubscription({
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
      });
    });
    mocks.stripe.subscriptions.update.mockImplementationOnce(async () => {
      expect(lockActive).toBe(true);
      return makeSubscription({
        customer: "cus_123",
        items: [
          ["si_recurring", "price_edge_recurring"],
        ],
        latestInvoice: appliedInvoice,
        metadata: {
          billingPlanCode: "launch_edge_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
        },
        status: "active",
      });
    });
    mocks.stripe.invoices.retrieve.mockImplementationOnce(async () => {
      expect(lockActive).toBe(true);
      return appliedInvoice;
    });
    mocks.stripe.invoicePayments.list.mockImplementationOnce(async () => {
      expect(lockActive).toBe(true);
      return {
        data: [appliedInvoicePayment],
        has_more: false,
        object: "list",
        url: "/v1/invoice_payments",
      };
    });
    mocks.applyStripeSubscriptionUpdated.mockImplementationOnce(async () => {
      expect(lockActive).toBe(true);
    });
    mocks.resolveHostedAiUsageGate.mockImplementationOnce(async () => {
      expect(lockActive).toBe(true);
      return {
        allowed: true,
        billingPlanCode: "launch_edge_monthly",
      };
    });
    mocks.signalHostedRuntimeManualWakeBestEffort.mockImplementationOnce(async () => {
      expect(lockActive).toBe(false);
      return {
        status: "sent",
      };
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });

    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      run: expect.any(Function),
    });
    expect(mocks.prismaClient.hostedMember.findUnique).toHaveBeenCalledTimes(2);
    expect(mocks.readHostedMemberStripeBillingRef).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.invoices.retrieve).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.invoicePayments.list).toHaveBeenCalledTimes(1);
    expect(lockActive).toBe(false);
  });

  test("rejects a billing-owner rebind that happens while waiting for the member lock", async () => {
    const originalBillingRef = {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    };
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(originalBillingRef)
      .mockResolvedValueOnce({
        ...originalBillingRef,
        stripeCustomerId: "cus_rebound",
        stripeSubscriptionId: "sub_rebound",
      });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_SOURCE_CHANGED",
      httpStatus: 409,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("rejects a billing-phase change that happens while waiting for the member lock", async () => {
    const originalBillingRef = {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    };
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(originalBillingRef)
      .mockResolvedValueOnce({
        ...originalBillingRef,
        currentBillingPhase: "trial",
        currentCheckoutOffer: "pulse_trial_7d",
      });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_SOURCE_CHANGED",
      httpStatus: 409,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
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
      code: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_PROVIDER_REJECTED",
      details: {
        code: "resource_missing",
        operationName: "subscription.retrieve",
        requestIdPresent: true,
        stripeParam: "items[0][price]",
        statusCode: 404,
        type: "StripeInvalidRequestError",
      },
      httpStatus: 500,
      message: "Stripe rejected this plan change. Contact support before retrying.",
      retryable: false,
    });
  });

  test("reconciles applied Edge state after an ambiguous Stripe update failure", async () => {
    const currentSubscription = makeSubscription({
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
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(currentSubscription)
      .mockResolvedValueOnce(makeSubscription({
        customer: "cus_123",
        items: [
          ["si_recurring", "price_edge_recurring"],
        ],
        metadata: {
          billingPlanCode: "launch_edge_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
        },
        status: "active",
      }));
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_ambiguous",
      statusCode: 500,
      type: "StripeAPIError",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("reconciles intended pending Edge state after an ambiguous Stripe update failure", async () => {
    const pendingInvoice = makeInvoice({
      hostedInvoiceUrl: null,
      id: "in_pending_ambiguous",
      status: "open",
    });
    const pendingInvoicePayment = makeInvoicePayment({
      id: "inpay_pending_ambiguous",
      invoiceId: pendingInvoice.id,
      paymentIntentStatus: "requires_payment_method",
    });
    const currentSubscription = makeSubscription({
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
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(currentSubscription)
      .mockResolvedValueOnce(makeSubscription({
        customer: "cus_123",
        items: [
          ["si_recurring", "price_pulse_recurring"],
          ["si_usage", "price_pulse_usage"],
        ],
        latestInvoice: pendingInvoice,
        metadata: {
          billingPlanCode: "launch_monthly",
          memberId: "member_123",
        },
        pendingUpdate: {
          subscriptionItems: [
            ["si_recurring", "price_edge_recurring", 1],
          ],
        },
        status: "active",
      }));
    mocks.stripe.invoices.retrieve.mockResolvedValueOnce(pendingInvoice);
    mocks.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: [pendingInvoicePayment],
      has_more: false,
      object: "list",
      url: "/v1/invoice_payments",
    });
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      requestId: "req_ambiguous",
      statusCode: 500,
      type: "StripeAPIError",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://billing.stripe.com/p/session_123",
      status: "payment_required",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledTimes(1);
  });

  test("surfaces the Stripe update failure when reconciliation proves no effect", async () => {
    const currentSubscription = makeSubscription({
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
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(currentSubscription)
      .mockResolvedValueOnce(currentSubscription);
    mocks.stripe.subscriptions.update.mockRejectedValueOnce({
      code: "resource_missing",
      requestId: "req_failed",
      statusCode: 400,
      type: "StripeInvalidRequestError",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_PROVIDER_REJECTED",
      details: {
        code: "resource_missing",
        operationName: "subscription.update.plan-items",
        requestIdPresent: true,
        statusCode: 400,
        type: "StripeInvalidRequestError",
      },
      httpStatus: 500,
      retryable: false,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
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

  test("uses the Billing Portal when Stripe supplies an unsafe hosted invoice URL", async () => {
    const pendingInvoice = makeInvoice({
      hostedInvoiceUrl:
        "https://invoice.stripe.com.attacker.example/i/in_pending_portal",
      id: "in_pending_portal",
      status: "open",
    });
    const pendingInvoicePayment = makeInvoicePayment({
      id: "inpay_pending_portal",
      invoiceId: pendingInvoice.id,
      paymentIntentStatus: "requires_payment_method",
    });
    mocks.resolveHostedStripePortalConfigurationId.mockReturnValueOnce(
      "bpc_payment_recovery",
    );
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
      ],
      latestInvoice: pendingInvoice,
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      pendingUpdate: {
        subscriptionItems: [
          ["si_recurring", "price_edge_recurring", 1],
        ],
      },
      status: "active",
    }));
    mocks.stripe.invoices.retrieve.mockResolvedValueOnce(pendingInvoice);
    mocks.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: [pendingInvoicePayment],
      has_more: false,
      object: "list",
      url: "/v1/invoice_payments",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://billing.stripe.com/p/session_123",
      status: "payment_required",
    });

    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      configuration: "bpc_payment_recovery",
      customer: "cus_123",
      return_url: "https://join.example.test/home",
    });
    expect(mocks.resolveHostedStripePortalConfigurationId).toHaveBeenCalledWith(
      "payment_recovery",
    );
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeManualWakeBestEffort).not.toHaveBeenCalled();
  });

  test("reconciles an outstanding renewal invoice without treating it as the plan-change attempt", async () => {
    const invoice = makeInvoice({
      billingReason: "subscription_cycle",
      id: "in_existing_action",
      status: "open",
    });
    const invoicePayment = makeInvoicePayment({
      id: "inpay_existing_action",
      invoiceId: invoice.id,
      paymentIntentStatus: "requires_action",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
      ],
      latestInvoice: invoice,
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      status: "active",
    }));
    mocks.stripe.invoices.retrieve.mockResolvedValueOnce(invoice);
    mocks.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: [invoicePayment],
      has_more: false,
      object: "list",
      url: "/v1/invoice_payments",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.com/i/in_existing_action",
      status: "payment_required",
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.invoicePayments.list).toHaveBeenCalledWith({
      expand: ["data.payment.payment_intent"],
      invoice: "in_existing_action",
      limit: 100,
    });
  });

  test("returns recovery for a hidden current-period invoice before starting another charge", async () => {
    const laterPaidInvoice = makeInvoice({
      id: "in_later_paid_delta",
      status: "paid",
    });
    const unresolvedBaseInvoice = makeInvoice({
      billingReason: "subscription_cycle",
      id: "in_hidden_base_action",
      status: "open",
    });
    const unresolvedPayment = makeInvoicePayment({
      id: "inpay_hidden_base_action",
      invoiceId: unresolvedBaseInvoice.id,
      paymentIntentStatus: "requires_action",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
      ],
      latestInvoice: laterPaidInvoice,
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      status: "active",
    }));
    mocks.stripe.invoices.retrieve
      .mockResolvedValueOnce(laterPaidInvoice)
      .mockResolvedValueOnce(unresolvedBaseInvoice);
    mocks.stripe.invoicePayments.list
      .mockResolvedValueOnce({
        data: [],
        has_more: false,
        object: "list",
        url: "/v1/invoice_payments",
      })
      .mockResolvedValueOnce({
        data: [unresolvedPayment],
        has_more: false,
        object: "list",
        url: "/v1/invoice_payments",
      });
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce({
      collectionState: {
        deadlineUnixSeconds: 1_800_100_000,
        kind: "payment_required",
      },
      fullyRefunded: false,
      invoiceId: unresolvedBaseInvoice.id,
      outstandingDispute: false,
    });
    mocks.classifyHostedStripeRecurringFinancialHealth.mockReturnValueOnce({
      collectionState: {
        deadlineUnixSeconds: 1_800_100_000,
        kind: "payment_required",
      },
      kind: "blocked",
      reason: "collection_unsettled",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.com/i/in_hidden_base_action",
      status: "payment_required",
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.readHostedStripeRecurringFinancialState).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sub_123",
        latest_invoice: laterPaidInvoice,
      }),
    );
  });

  test("returns bounded recovery for hidden current-period processing", async () => {
    const laterPaidInvoice = makeInvoice({
      id: "in_later_paid_processing",
      status: "paid",
    });
    const processingBaseInvoice = makeInvoice({
      billingReason: "subscription_cycle",
      id: "in_hidden_base_processing",
      status: "draft",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
      ],
      latestInvoice: laterPaidInvoice,
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      status: "active",
    }));
    mocks.stripe.invoices.retrieve
      .mockResolvedValueOnce(laterPaidInvoice)
      .mockResolvedValueOnce(processingBaseInvoice);
    mocks.stripe.invoicePayments.list
      .mockResolvedValueOnce({
        data: [],
        has_more: false,
        object: "list",
        url: "/v1/invoice_payments",
      })
      .mockResolvedValueOnce({
        data: [],
        has_more: false,
        object: "list",
        url: "/v1/invoice_payments",
      });
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce({
      collectionState: {
        deadlineUnixSeconds: 1_800_100_000,
        kind: "processing",
      },
      fullyRefunded: false,
      invoiceId: processingBaseInvoice.id,
      outstandingDispute: false,
    });
    mocks.classifyHostedStripeRecurringFinancialHealth.mockReturnValueOnce({
      collectionState: {
        deadlineUnixSeconds: 1_800_100_000,
        kind: "processing",
      },
      kind: "blocked",
      reason: "collection_unsettled",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      status: "processing",
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.readHostedStripeRecurringFinancialState).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("blocks a new charge when current-period funding was fully refunded", async () => {
    mocks.readHostedStripeRecurringFinancialState.mockResolvedValueOnce({
      collectionState: { kind: "paid" },
      fullyRefunded: true,
      invoiceId: "in_current_period",
      outstandingDispute: false,
    });
    mocks.classifyHostedStripeRecurringFinancialHealth.mockReturnValueOnce({
      collectionState: { kind: "paid" },
      kind: "blocked",
      reason: "fully_refunded",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_FINANCIAL_STATE_BLOCKED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });

  test("does not leave an outstanding renewal invoice processing past its deadline", async () => {
    const invoice = makeInvoice({
      billingReason: "subscription_cycle",
      created: 1_777_000_000,
      id: "in_stale_processing",
      status: "draft",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
      ],
      latestInvoice: invoice,
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      status: "active",
    }));
    mocks.stripe.invoices.retrieve.mockResolvedValueOnce(invoice);

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_COLLECTION_TIMED_OUT",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("uses the exact pending-update invoice action instead of opening a generic portal", async () => {
    const invoice = makeInvoice({
      id: "in_pending_edge",
      status: "open",
    });
    const invoicePayment = makeInvoicePayment({
      id: "inpay_pending_edge",
      invoiceId: invoice.id,
      paymentIntentStatus: "requires_action",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
      ],
      latestInvoice: invoice,
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      pendingUpdate: {
        subscriptionItems: [
          ["si_recurring", "price_edge_recurring", 1],
        ],
      },
      status: "active",
    }));
    mocks.stripe.invoices.retrieve.mockResolvedValueOnce(invoice);
    mocks.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: [invoicePayment],
      has_more: false,
      object: "list",
      url: "/v1/invoice_payments",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.com/i/in_pending_edge",
      status: "payment_required",
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.readHostedStripeRecurringFinancialState).not.toHaveBeenCalled();
  });

  test("closes a canonically expired pending update instead of returning a payment action", async () => {
    const invoice = makeInvoice({
      id: "in_expired_pending_edge",
      status: "open",
    });
    const invoicePayment = makeInvoicePayment({
      id: "inpay_expired_pending_edge",
      invoiceId: invoice.id,
      paymentIntentStatus: "requires_action",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
      ],
      latestInvoice: invoice,
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      pendingUpdate: {
        expiresAt: 1_777_000_000,
        subscriptionItems: [
          ["si_recurring", "price_edge_recurring", 1],
        ],
      },
      status: "active",
    }));
    mocks.stripe.invoices.retrieve.mockResolvedValueOnce(invoice);
    mocks.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: [invoicePayment],
      has_more: false,
      object: "list",
      url: "/v1/invoice_payments",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_ATTEMPT_EXPIRED",
      httpStatus: 409,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  test("fails closed when a matching pending update has no latest invoice", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
      ],
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      pendingUpdate: {
        subscriptionItems: [
          ["si_recurring", "price_edge_recurring", 1],
        ],
      },
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_PENDING_INVOICE_MISMATCH",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("fails closed when a matching pending update points at an unrelated renewal invoice", async () => {
    const renewalInvoice = makeInvoice({
      billingReason: "subscription_cycle",
      id: "in_unrelated_renewal",
      status: "open",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
      ],
      latestInvoice: renewalInvoice,
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      pendingUpdate: {
        subscriptionItems: [
          ["si_recurring", "price_edge_recurring", 1],
        ],
      },
      status: "active",
    }));
    mocks.stripe.invoices.retrieve.mockResolvedValueOnce(renewalInvoice);

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_PENDING_INVOICE_MISMATCH",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("does not turn an unrelated renewal invoice discovered after a failed update into a plan-change result", async () => {
    const invalidRequest = new Error("Invalid plan update");
    Object.assign(invalidRequest, {
      code: "parameter_invalid_integer",
      requestId: "req_failed_plan_update",
      statusCode: 400,
      type: "StripeInvalidRequestError",
    });
    const renewalInvoice = makeInvoice({
      billingReason: "subscription_cycle",
      id: "in_after_failed_update",
      status: "open",
    });
    const renewalPayment = makeInvoicePayment({
      id: "inpay_after_failed_update",
      invoiceId: renewalInvoice.id,
      paymentIntentStatus: "requires_action",
    });
    mocks.stripe.subscriptions.update.mockRejectedValueOnce(invalidRequest);
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription({
        customer: "cus_123",
        items: [
          ["si_recurring", "price_pulse_recurring"],
          ["si_usage", "price_pulse_usage"],
        ],
        metadata: {
          billingPlanCode: "launch_monthly",
        },
        status: "active",
      }))
      .mockResolvedValueOnce(makeSubscription({
        customer: "cus_123",
        items: [
          ["si_recurring", "price_pulse_recurring"],
          ["si_usage", "price_pulse_usage"],
        ],
        latestInvoice: renewalInvoice,
        metadata: {
          billingPlanCode: "launch_monthly",
        },
        status: "active",
      }));
    mocks.stripe.invoices.retrieve.mockResolvedValueOnce(renewalInvoice);
    mocks.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: [renewalPayment],
      has_more: false,
      object: "list",
      url: "/v1/invoice_payments",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_PROVIDER_REJECTED",
      details: expect.objectContaining({
        operationName: "subscription.update.plan-items",
      }),
      httpStatus: 500,
      retryable: false,
    });

    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("closes an expired pending update before allowing a fresh scoped attempt", async () => {
    const expiredInvoice = makeInvoice({
      id: "in_expired_edge",
      status: "void",
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription({
        customer: "cus_123",
        items: [
          ["si_recurring", "price_pulse_recurring"],
          ["si_usage", "price_pulse_usage"],
        ],
        latestInvoice: expiredInvoice,
        metadata: {
          billingPlanCode: "launch_monthly",
        },
        pendingUpdate: {
          subscriptionItems: [
            ["si_recurring", "price_edge_recurring", 1],
          ],
        },
        status: "active",
      }))
      .mockResolvedValueOnce(makeSubscription({
        customer: "cus_123",
        items: [
          ["si_recurring", "price_pulse_recurring"],
          ["si_usage", "price_pulse_usage"],
        ],
        latestInvoice: expiredInvoice,
        metadata: {
          billingPlanCode: "launch_monthly",
        },
        status: "active",
      }));
    mocks.stripe.invoices.retrieve
      .mockResolvedValueOnce(expiredInvoice)
      .mockResolvedValueOnce(expiredInvoice);

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_ATTEMPT_EXPIRED",
      httpStatus: 409,
      retryable: true,
    });
    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_edge_monthly",
      status: "upgraded",
    });
    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        payment_behavior: "pending_if_incomplete",
      }),
      {
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-plan-upgrade:[a-f0-9]{64}$/u,
        ),
      },
    );
  });

  test("reuses an existing intended Edge pending update without another Stripe update", async () => {
    const pendingInvoice = makeInvoice({
      hostedInvoiceUrl: null,
      id: "in_existing_pending_edge",
      status: "open",
    });
    const pendingInvoicePayment = makeInvoicePayment({
      id: "inpay_existing_pending_edge",
      invoiceId: pendingInvoice.id,
      paymentIntentStatus: "requires_payment_method",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
      ],
      latestInvoice: pendingInvoice,
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      pendingUpdate: {
        priceShape: "id",
        subscriptionItems: [
          ["si_recurring", "price_edge_recurring", 1],
        ],
      },
      status: "active",
    }));
    mocks.stripe.invoices.retrieve.mockResolvedValueOnce(pendingInvoice);
    mocks.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: [pendingInvoicePayment],
      has_more: false,
      object: "list",
      url: "/v1/invoice_payments",
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://billing.stripe.com/p/session_123",
      status: "payment_required",
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
  });

  test("rejects an unrelated pending update without replacing it", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
      ],
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      pendingUpdate: {
        subscriptionItems: [
          ["si_recurring", "price_other_recurring", 1],
        ],
      },
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_PENDING_UPDATE_CONFLICT",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("rejects a malformed pending update without replacing it", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
      ],
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      pendingUpdate: {
        subscriptionItems: null,
      },
      status: "active",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_PENDING_UPDATE_CONFLICT",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test.each([
    null,
    "https://billing.stripe.com.attacker.example/p/session_123",
  ])("fails safely when Stripe returns an unsafe Billing Portal URL: %s", async (portalUrl) => {
    const pendingInvoice = makeInvoice({
      hostedInvoiceUrl: null,
      id: "in_pending_missing_portal_url",
      status: "open",
    });
    const pendingInvoicePayment = makeInvoicePayment({
      id: "inpay_pending_missing_portal_url",
      invoiceId: pendingInvoice.id,
      paymentIntentStatus: "requires_payment_method",
    });
    mocks.stripe.subscriptions.update.mockResolvedValueOnce(makeSubscription({
      customer: "cus_123",
      items: [
        ["si_recurring", "price_pulse_recurring"],
        ["si_usage", "price_pulse_usage"],
      ],
      latestInvoice: pendingInvoice,
      metadata: {
        billingPlanCode: "launch_monthly",
      },
      pendingUpdate: {
        subscriptionItems: [
          ["si_recurring", "price_edge_recurring", 1],
        ],
      },
      status: "active",
    }));
    mocks.stripe.invoices.retrieve.mockResolvedValueOnce(pendingInvoice);
    mocks.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: [pendingInvoicePayment],
      has_more: false,
      object: "list",
      url: "/v1/invoice_payments",
    });
    mocks.stripe.billingPortal.sessions.create.mockResolvedValueOnce({
      url: portalUrl,
    });

    await expect(upgradeHostedBillingPlan({
      memberId: "member_123",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "STRIPE_PORTAL_SESSION_MISSING_URL",
      httpStatus: 502,
    });

    expect(mocks.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(mocks.applyStripeSubscriptionUpdated).not.toHaveBeenCalled();
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
  latestInvoice?: Stripe.Invoice | string | null;
  metadata: Record<string, string>;
  pendingUpdate?: {
    billingCycleAnchor?: number | null;
    expiresAt?: number;
    priceShape?: "expanded" | "id";
    subscriptionItems: Array<[
      id: string,
      priceId: string,
      quantity?: number | null,
    ]> | null;
    trialEnd?: number | null;
    trialFromPlan?: boolean | null;
  };
  status: Stripe.Subscription.Status;
}): Stripe.Subscription {
  const defaultAppliedInvoice = input.items.some(([, priceId]) =>
    priceId === "price_edge_recurring"
  )
    ? makeInvoice({
      id: "in_applied_fixture",
      status: "paid",
    })
    : null;
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
    latest_invoice: input.latestInvoice === undefined
      ? defaultAppliedInvoice
      : input.latestInvoice,
    metadata: input.metadata,
    object: "subscription",
    pending_update: input.pendingUpdate === undefined
      ? null
      : {
          billing_cycle_anchor: input.pendingUpdate.billingCycleAnchor ?? null,
          expires_at: input.pendingUpdate.expiresAt ?? 1_800_000_000,
          subscription_items: input.pendingUpdate.subscriptionItems?.map(
            ([id, priceId, quantity]) => ({
              id,
              price: input.pendingUpdate?.priceShape === "id"
                ? priceId
                : {
                    id: priceId,
                  },
              ...(quantity === undefined ? {} : { quantity }),
            }),
          ) ?? null,
          trial_end: input.pendingUpdate.trialEnd ?? null,
          trial_from_plan: input.pendingUpdate.trialFromPlan ?? null,
        },
    status: input.status,
  } as Stripe.Subscription;
}

function makeInvoice(input: {
  billingReason?: Stripe.Invoice.BillingReason | null;
  created?: number;
  hostedInvoiceUrl?: string | null;
  id: string;
  status: Stripe.Invoice.Status;
}): Stripe.Invoice {
  const invoice: Partial<Stripe.Invoice> = {
    amount_remaining: input.status === "paid" ? 0 : 800,
    attempted: input.status === "open",
    billing_reason: input.billingReason === undefined
      ? "subscription_update"
      : input.billingReason,
    created: input.created ?? 1_800_000_000,
    customer: "cus_123",
    hosted_invoice_url: input.hostedInvoiceUrl === undefined
      ? `https://invoice.stripe.com/i/${input.id}`
      : input.hostedInvoiceUrl,
    id: input.id,
    object: "invoice",
    parent: {
      quote_details: null,
      subscription_details: {
        metadata: null,
        subscription: "sub_123",
      },
      type: "subscription_details",
    },
    status: input.status,
  };
  return invoice as Stripe.Invoice;
}

function makeInvoicePayment(input: {
  id: string;
  invoiceId: string;
  paymentIntentStatus: Stripe.PaymentIntent.Status;
}): Stripe.InvoicePayment {
  const paymentIntent: Partial<Stripe.PaymentIntent> = {
    id: `pi_${input.id}`,
    object: "payment_intent",
    status: input.paymentIntentStatus,
  };
  const invoicePayment: Partial<Stripe.InvoicePayment> = {
    id: input.id,
    invoice: input.invoiceId,
    is_default: true,
    object: "invoice_payment",
    payment: {
      payment_intent: paymentIntent as Stripe.PaymentIntent,
      type: "payment_intent",
    },
    status: input.paymentIntentStatus === "succeeded" ? "paid" : "open",
  };
  return invoicePayment as Stripe.InvoicePayment;
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

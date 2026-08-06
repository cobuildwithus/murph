import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  prismaClient: {
    hostedMember: {
      findUnique: vi.fn(),
    },
  },
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedOnboardingPublicBaseUrl: vi.fn(),
  requireHostedStripeBillingPlanConfig: vi.fn(),
  requireValidatedHostedStripeBillingPlanConfig: vi.fn(),
  withHostedMemberStripeMutationLock: vi.fn(),
  stripe: {
    billingPortal: {
      sessions: {
        create: vi.fn(),
      },
    },
    subscriptions: {
      retrieve: vi.fn(),
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
  requireValidatedHostedStripeBillingPlanConfig:
    mocks.requireValidatedHostedStripeBillingPlanConfig,
}));

import { upgradeHostedBillingPlan } from "@/src/lib/hosted-onboarding/billing-plan-change-service";

describe("upgradeHostedBillingPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_EDGE_MONTHLY",
      "bpc_edge_plan_change",
    );
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_MONTHLY",
      "bpc_pulse_plan_change",
    );
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.withHostedMemberStripeMutationLock.mockImplementation(
      async (input: { run: (tx: unknown) => Promise<unknown> }) =>
        input.run(mocks.prismaClient),
    );
    mocks.prismaClient.hostedMember.findUnique.mockResolvedValue({
      billingStatus: "active",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      id: "member_fixture",
      suspendedAt: null,
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(makeBillingRef());
    mocks.requireHostedStripeBillingPlanConfig.mockImplementation(
      makePlanConfig,
    );
    mocks.requireValidatedHostedStripeBillingPlanConfig.mockImplementation(
      makePlanConfig,
    );
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue(
      "https://join.example.test",
    );
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeSubscription());
    mocks.stripe.billingPortal.sessions.create.mockResolvedValue({
      url: "https://billing.stripe.test/session_fixture",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("creates an exact Stripe plan confirmation after two short owner checks", async () => {
    await expect(upgradeHostedBillingPlan({
      expectedCurrentPlanCode: "launch_monthly",
      memberId: "member_fixture",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://billing.stripe.test/session_fixture",
      status: "pending_payment",
    });

    expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith(
      "sub_fixture",
      { expand: ["items.data.price"] },
    );
    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      configuration: "bpc_edge_plan_change",
      customer: "cus_fixture",
      flow_data: {
        after_completion: {
          redirect: {
            return_url:
              "https://join.example.test/settings?planUpdate=launch_edge_monthly#subscription",
          },
          type: "redirect",
        },
        subscription_update_confirm: {
          items: [{
            id: "si_plan",
            price: "price_edge",
            quantity: 1,
          }],
          subscription: "sub_fixture",
        },
        type: "subscription_update_confirm",
      },
      return_url:
        "https://join.example.test/settings?planUpdate=canceled#subscription",
    });
  });

  test("selects the exact target plan Portal configuration", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(
      makeBillingRef({ currentBillingPlanCode: "launch_group_monthly" }),
    );
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(
      makeSubscription({ priceId: "price_group" }),
    );

    await expect(upgradeHostedBillingPlan({
      expectedCurrentPlanCode: "launch_group_monthly",
      memberId: "member_fixture",
      targetPlanCode: "launch_monthly",
    })).resolves.toMatchObject({
      billingPlanCode: "launch_group_monthly",
      status: "pending_payment",
    });

    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: "bpc_pulse_plan_change",
        flow_data: expect.objectContaining({
          subscription_update_confirm: expect.objectContaining({
            items: [{
              id: "si_plan",
              price: "price_pulse",
              quantity: 1,
            }],
          }),
        }),
      }),
    );
  });

  test("proves local plan equality against a live exact Stripe subscription", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue(
      makeBillingRef({ currentBillingPlanCode: "launch_edge_monthly" }),
    );
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(
      makeSubscription({ priceId: "price_edge" }),
    );

    await expect(upgradeHostedBillingPlan({
      expectedCurrentPlanCode: "launch_edge_monthly",
      memberId: "member_fixture",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_edge_monthly",
      status: "already_on_plan",
    });
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("returns no-action when Stripe applied the target before local reconciliation", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(
      makeSubscription({ priceId: "price_edge" }),
    );

    await expect(upgradeHostedBillingPlan({
      expectedCurrentPlanCode: "launch_monthly",
      memberId: "member_fixture",
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      billingPlanCode: "launch_edge_monthly",
      status: "already_on_plan",
    });
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });


  test.each([
    ["a schedule", { schedule: "sub_sched_fixture" }],
    ["a pending update", { pendingUpdate: true }],
  ])(
    "rejects an exact target item when Stripe also has %s",
    async (_label, subscriptionState) => {
      mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(
        makeSubscription({
          priceId: "price_edge",
          ...subscriptionState,
        }),
      );

      await expect(upgradeHostedBillingPlan({
        memberId: "member_fixture",
        targetPlanCode: "launch_edge_monthly",
      })).rejects.toMatchObject({
        code: "schedule" in subscriptionState
          ? "HOSTED_BILLING_PLAN_CHANGE_ALREADY_SCHEDULED"
          : "HOSTED_BILLING_PLAN_CHANGE_PENDING",
        httpStatus: 409,
      });
      expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["trialing status", { status: "trialing" as const }],
    ["past-due status", { status: "past_due" as const }],
    ["scheduled cancellation", { cancelAt: 1_800_000_000 }],
    ["period-end cancellation", { cancelAtPeriodEnd: true }],
    ["collection pause", { pauseCollection: true }],
    ["manual invoices", { collectionMethod: "send_invoice" as const }],
  ])(
    "does not treat an exact target item with %s as already active",
    async (_label, subscriptionState) => {
      mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(
        makeSubscription({
          priceId: "price_edge",
          ...subscriptionState,
        }),
      );

      await expect(upgradeHostedBillingPlan({
        memberId: "member_fixture",
        targetPlanCode: "launch_edge_monthly",
      })).rejects.toMatchObject({
        code: "HOSTED_BILLING_PLAN_UPGRADE_SOURCE_INVALID",
        httpStatus: 409,
      });
      expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    },
  );

  test("fails closed while a previous Stripe pending update exists", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(
      makeSubscription({ pendingUpdate: true }),
    );

    await expect(upgradeHostedBillingPlan({
      memberId: "member_fixture",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_CHANGE_PENDING",
      httpStatus: 409,
    });
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("fails closed when a legacy or unknown second item remains", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(
      makeSubscription({ secondItem: true }),
    );

    await expect(upgradeHostedBillingPlan({
      memberId: "member_fixture",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("does not treat a target item with an unknown companion as applied", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      priceId: "price_edge",
      secondItem: true,
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_fixture",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ITEMS_UNSUPPORTED",
      httpStatus: 409,
    });
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("requires the dedicated plan-change Portal configuration", async () => {
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_EDGE_MONTHLY",
      "",
    );

    await expect(upgradeHostedBillingPlan({
      memberId: "member_fixture",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_CHANGE_PORTAL_CONFIGURATION_REQUIRED",
      httpStatus: 503,
    });
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  test("does not return a session created for an owner that changed meanwhile", async () => {
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(makeBillingRef())
      .mockResolvedValueOnce(makeBillingRef({ stripeSubscriptionId: "sub_changed" }));

    await expect(upgradeHostedBillingPlan({
      expectedCurrentPlanCode: "launch_monthly",
      memberId: "member_fixture",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_SOURCE_CHANGED",
      httpStatus: 409,
    });
    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledTimes(1);
  });

  test("rejects a Stripe subscription owned by another Customer", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(
      makeSubscription({ customer: "cus_other" }),
    );

    await expect(upgradeHostedBillingPlan({
      memberId: "member_fixture",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_CUSTOMER_MISMATCH",
      httpStatus: 409,
    });
  });

  test("rejects paid plan changes from a trial", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce(makeBillingRef({
      currentBillingPhase: "trial",
      currentCheckoutOffer: "pulse_trial_7d",
    }));

    await expect(upgradeHostedBillingPlan({
      memberId: "member_fixture",
      targetPlanCode: "launch_edge_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_UPGRADE_TRIAL_UNSUPPORTED",
      httpStatus: 409,
    });
  });
});

function makePlanConfig(input: {
  billingPlanCode:
    | "launch_edge_monthly"
    | "launch_group_monthly"
    | "launch_monthly";
}) {
  return {
    billingPlanCode: input.billingPlanCode,
    priceId: {
      launch_edge_monthly: "price_edge",
      launch_group_monthly: "price_group",
      launch_monthly: "price_pulse",
    }[input.billingPlanCode],
    stripe: mocks.stripe,
  };
}

function makeBillingRef(input: {
  currentBillingPhase?: "paid" | "trial";
  currentBillingPlanCode?:
    | "launch_edge_monthly"
    | "launch_group_monthly"
    | "launch_monthly";
  currentCheckoutOffer?: "pulse_trial_7d" | "standard";
  stripeSubscriptionId?: string;
} = {}) {
  return {
    currentBillingPhase: input.currentBillingPhase ?? "paid",
    currentBillingPlanCode: input.currentBillingPlanCode ?? "launch_monthly",
    currentCheckoutOffer: input.currentCheckoutOffer ?? "standard",
    memberId: "member_fixture",
    scheduledBillingPlanCode: null,
    stripeCustomerId: "cus_fixture",
    stripeSubscriptionId: input.stripeSubscriptionId ?? "sub_fixture",
  };
}

function makeSubscription(input: {
  cancelAt?: number;
  cancelAtPeriodEnd?: boolean;
  collectionMethod?: Stripe.Subscription.CollectionMethod;
  customer?: string;
  pauseCollection?: boolean;
  pendingUpdate?: boolean;
  priceId?: string;
  schedule?: string;
  secondItem?: boolean;
  status?: Stripe.Subscription.Status;
} = {}): Stripe.Subscription {
  const items: Array<{
    id: string;
    price: {
      id: string;
      metadata: Record<string, string>;
      recurring: {
        interval: "month";
        interval_count: number;
        usage_type: Stripe.Price.Recurring.UsageType;
      };
    };
    quantity: number;
  }> = [{
    id: "si_plan",
    price: {
      id: input.priceId ?? "price_pulse",
      metadata: {},
      recurring: {
        interval: "month" as const,
        interval_count: 1,
        usage_type: "licensed" as const,
      },
    },
    quantity: 1,
  }];
  if (input.secondItem) {
    items.push({
      id: "si_extra",
      price: {
        id: "price_extra",
        metadata: {},
        recurring: {
          interval: "month",
          interval_count: 1,
          usage_type: "metered",
        },
      },
      quantity: 1,
    });
  }
  return {
    cancel_at: input.cancelAt ?? null,
    cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    collection_method: input.collectionMethod ?? "charge_automatically",
    customer: input.customer ?? "cus_fixture",
    id: "sub_fixture",
    items: { data: items },
    object: "subscription",
    pending_update: input.pendingUpdate
      ? {
          billing_cycle_anchor: null,
          expires_at: 1_800_000_000,
          subscription_items: null,
          trial_end: null,
          trial_from_plan: null,
        }
      : null,
    pause_collection: input.pauseCollection
      ? { behavior: "void", resumes_at: null }
      : null,
    schedule: input.schedule ?? null,
    status: input.status ?? "active",
  } as Stripe.Subscription;
}

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId: vi.fn(),
  prismaClient: {
    $transaction: vi.fn(),
    hostedGroupMember: {
      findFirst: vi.fn(),
    },
  },
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  requireHostedStripeBillingPlanConfig: vi.fn(),
  requireValidatedHostedStripeBillingPlanConfig: vi.fn(),
  withHostedMemberStripeMutationLock: vi.fn(),
  stripe: {
    subscriptionSchedules: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
  },
  writeHostedMemberStripeBillingRefTx: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: mocks.after,
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest:
    mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin:
    mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId:
    mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId,
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
  withHostedMemberStripeMutationLock:
    mocks.withHostedMemberStripeMutationLock,
  writeHostedMemberStripeBillingRefTx: mocks.writeHostedMemberStripeBillingRefTx,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeBillingPlanConfig: mocks.requireHostedStripeBillingPlanConfig,
  requireValidatedHostedStripeBillingPlanConfig:
    mocks.requireValidatedHostedStripeBillingPlanConfig,
}));

import {
  clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx,
  refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx,
  scheduleHostedBillingPlanSwitch,
  scheduleHostedBillingPlanSwitchToPulse,
} from "@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service";
import {
  createResendFetch,
  makeStripeProviderError,
  readResendRequest,
  stubAlertEnvironment,
} from "./support/hosted-stripe-alert-fixture";

describe("scheduleHostedBillingPlanSwitchToPulse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        billingStatus: "active",
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.prismaClient.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(mocks.prismaClient)
    );
    mocks.withHostedMemberStripeMutationLock.mockImplementation(
      async (input: { run: (tx: unknown) => Promise<unknown> }) =>
        input.run(mocks.prismaClient),
    );
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "active",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mocks.prismaClient.hostedGroupMember.findFirst.mockResolvedValue(null);
    mocks.requireHostedStripeBillingPlanConfig.mockImplementation((input: {
      billingPlanCode:
        | "launch_group_monthly"
        | "launch_monthly"
        | "launch_edge_monthly"
        | "launch_max_monthly";
    }) => ({
      billingPlanCode: input.billingPlanCode,
      priceId: {
        launch_edge_monthly: "price_edge_recurring",
        launch_group_monthly: "price_group_recurring",
        launch_max_monthly: "price_max_recurring",
        launch_monthly: "price_pulse_recurring",
      }[input.billingPlanCode],
      stripe: mocks.stripe,
      stripeLiveMode: true,
    }));
    mocks.requireValidatedHostedStripeBillingPlanConfig.mockImplementation(
      mocks.requireHostedStripeBillingPlanConfig,
    );
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeSubscription());
    mocks.stripe.subscriptionSchedules.create.mockResolvedValue(makeSchedule({
      metadata: {},
      phases: [
        makeSchedulePhase({
          endDate: 1_778_068_800,
          priceIds: ["price_edge_recurring"],
          startDate: 1_775_606_400,
        }),
      ],
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValue(makeSchedule({
      metadata: {},
      phases: [
        makeSchedulePhase({
          endDate: 1_778_068_800,
          priceIds: ["price_edge_recurring"],
          startDate: 1_775_606_400,
        }),
      ],
    }));
    mocks.stripe.subscriptionSchedules.update.mockResolvedValue(makeCompatibleSchedule());
    mocks.writeHostedMemberStripeBillingRefTx.mockResolvedValue({
      memberId: "member_123",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("creates a Stripe schedule and stores pending Pulse display fields only after update", async () => {
    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      effectiveAt: "2026-05-06T12:00:00.000Z",
      scheduledBillingPlanCode: "launch_monthly",
      status: "scheduled",
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_123", {
      expand: ["customer", "items.data.price"],
    });
    expect(mocks.stripe.subscriptionSchedules.create).toHaveBeenCalledWith({
      from_subscription: "sub_123",
    }, {
      idempotencyKey: expect.stringMatching(/^hosted-billing-switch-to-pulse:create:[a-f0-9]{64}$/u),
    });
    expect(mocks.stripe.subscriptionSchedules.update).toHaveBeenCalledWith(
      "sched_123",
      expect.objectContaining({
        end_behavior: "release",
        metadata: expect.objectContaining({
          billingPlanCode: "launch_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
          murphPlanSwitch: "edge_to_pulse_at_period_end",
        }),
        proration_behavior: "none",
      }),
      {
        idempotencyKey: expect.stringMatching(/^hosted-billing-switch-to-pulse:update:[a-f0-9]{64}$/u),
      },
    );
    const updateParams = mocks.stripe.subscriptionSchedules.update.mock.calls[0]?.[1] as Stripe.SubscriptionScheduleUpdateParams;
    expect(updateParams.phases).toEqual([
      expect.objectContaining({
        end_date: 1_778_068_800,
        items: [
          {
            price: "price_edge_recurring",
            quantity: 1,
          },
        ],
        start_date: 1_775_606_400,
      }),
      expect.objectContaining({
        duration: {
          interval: "month",
          interval_count: 1,
        },
        items: [
          {
            price: "price_pulse_recurring",
            quantity: 1,
          },
        ],
        metadata: expect.objectContaining({
          billingPlanCode: "launch_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
          trialDurationDays: "",
          trialPolicyVersion: "",
          trialUsageLimitUsdMicros: "",
        }),
        proration_behavior: "none",
        start_date: 1_778_068_800,
      }),
    ]);
    expect(mocks.writeHostedMemberStripeBillingRefTx).toHaveBeenCalledWith({
      memberId: "member_123",
      scheduledBillingEffectiveAt: new Date("2026-05-06T12:00:00.000Z"),
      scheduledBillingPlanCode: "launch_monthly",
      stripeSubscriptionScheduleId: "sched_123",
      tx: mocks.prismaClient,
    });
  });

  test("keeps Max current until period end and persists an exact Edge future phase", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_max_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: ["price_max_recurring"],
    }));
    const createdSchedule = makeSchedule({
      metadata: {},
      phases: [
        makeSchedulePhase({
          endDate: 1_778_068_800,
          priceIds: ["price_max_recurring"],
          startDate: 1_775_606_400,
        }),
      ],
    });
    mocks.stripe.subscriptionSchedules.create.mockResolvedValueOnce(createdSchedule);
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(createdSchedule);
    mocks.stripe.subscriptionSchedules.update.mockResolvedValueOnce(
      makeCompatibleMaxToEdgeSchedule(),
    );

    await expect(scheduleHostedBillingPlanSwitch({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_edge_monthly",
    })).resolves.toEqual({
      effectiveAt: "2026-05-06T12:00:00.000Z",
      scheduledBillingPlanCode: "launch_edge_monthly",
      status: "scheduled",
    });

    expect(mocks.stripe.subscriptionSchedules.update).toHaveBeenCalledWith(
      "sched_123",
      expect.objectContaining({
        metadata: expect.objectContaining({
          billingPlanCode: "launch_edge_monthly",
          murphPlanSwitch: "direct_plan_at_period_end_v1",
        }),
        phases: [
          expect.objectContaining({
            end_date: 1_778_068_800,
            items: [{
              price: "price_max_recurring",
              quantity: 1,
            }],
          }),
          expect.objectContaining({
            items: [{
              price: "price_edge_recurring",
              quantity: 1,
            }],
            metadata: expect.objectContaining({
              billingPlanCode: "launch_edge_monthly",
            }),
            start_date: 1_778_068_800,
          }),
        ],
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-switch:update:v1:[a-f0-9]{64}$/u,
        ),
      }),
    );
    expect(mocks.writeHostedMemberStripeBillingRefTx).toHaveBeenCalledWith({
      memberId: "member_123",
      scheduledBillingEffectiveAt: new Date("2026-05-06T12:00:00.000Z"),
      scheduledBillingPlanCode: "launch_edge_monthly",
      stripeSubscriptionScheduleId: "sched_123",
      tx: mocks.prismaClient,
    });
  });

  test("schedules an eligible paid Pulse plan into Group at period end", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mocks.prismaClient.hostedGroupMember.findFirst.mockResolvedValueOnce({
      id: "hosted_group_member_123",
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: ["price_pulse_recurring"],
      status: "active",
    }));
    const pendingGroupSchedule = makeSchedule({
      metadata: {},
      phases: [
        makeSchedulePhase({
          endDate: 1_778_068_800,
          priceIds: ["price_pulse_recurring"],
          startDate: 1_775_606_400,
        }),
      ],
    });
    mocks.stripe.subscriptionSchedules.create.mockResolvedValueOnce(
      pendingGroupSchedule,
    );
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(
      pendingGroupSchedule,
    );
    mocks.stripe.subscriptionSchedules.update.mockResolvedValueOnce(
      makeCompatibleGroupSchedule(),
    );

    await expect(scheduleHostedBillingPlanSwitch({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
      targetPlanCode: "launch_group_monthly",
    })).resolves.toEqual({
      effectiveAt: "2026-05-06T12:00:00.000Z",
      scheduledBillingPlanCode: "launch_group_monthly",
      status: "scheduled",
    });

    expect(mocks.prismaClient.hostedGroupMember.findFirst).toHaveBeenCalledWith({
      select: {
        id: true,
      },
      where: {
        memberId: "member_123",
        OR: [
          {
            role: "owner",
          },
          {
            joinedAt: {
              not: null,
            },
          },
        ],
      },
    });
    expect(mocks.stripe.subscriptionSchedules.update).toHaveBeenCalledWith(
      "sched_123",
      expect.objectContaining({
        metadata: expect.objectContaining({
          billingPlanCode: "launch_group_monthly",
          murphPlanSwitch: "direct_plan_at_period_end_v1",
        }),
        phases: [
          expect.objectContaining({
            items: [{
              price: "price_pulse_recurring",
              quantity: 1,
            }],
          }),
          expect.objectContaining({
            items: [{
              price: "price_group_recurring",
              quantity: 1,
            }],
          }),
        ],
      }),
      {
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-switch:update:v1:[a-f0-9]{64}$/u,
        ),
      },
    );
    expect(mocks.writeHostedMemberStripeBillingRefTx).toHaveBeenCalledWith({
      memberId: "member_123",
      scheduledBillingEffectiveAt: new Date("2026-05-06T12:00:00.000Z"),
      scheduledBillingPlanCode: "launch_group_monthly",
      stripeSubscriptionScheduleId: "sched_123",
      tx: mocks.prismaClient,
    });
  });

  test("delivers request-id-free scheduled-switch failures with stable replay identity", async () => {
    stubAlertEnvironment();
    const fetchMock = createResendFetch();
    vi.stubGlobal("fetch", fetchMock);
    mocks.stripe.subscriptions.retrieve.mockRejectedValue(
      makeStripeProviderError(),
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(scheduleHostedBillingPlanSwitchToPulse({
        memberId: "member_123",
        now: new Date("2026-05-06T00:00:00.000Z"),
      })).rejects.toMatchObject({
        code: "HOSTED_BILLING_STRIPE_PLAN_SWITCH_UNAVAILABLE",
        httpStatus: 502,
      });
    }

    expect(mocks.after).toHaveBeenCalledTimes(2);
    for (const [task] of mocks.after.mock.calls) {
      await task();
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = readResendRequest(fetchMock, 0);
    const secondRequest = readResendRequest(fetchMock, 1);
    expect(secondRequest.idempotencyKey).toBe(firstRequest.idempotencyKey);
    expect(secondRequest.body).toBe(firstRequest.body);
    expect(firstRequest.body).toContain("operation: billing.plan-switch");
    expect(firstRequest.body).not.toContain("member_123");
  });

  test("rejects Group selection when membership is no longer eligible", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });

    await expect(scheduleHostedBillingPlanSwitch({
      memberId: "member_123",
      targetPlanCode: "launch_group_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_PLAN_NOT_ELIGIBLE",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
  });

  test("returns already_scheduled for the same compatible app-authored schedule", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      schedule: "sched_123",
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(makeCompatibleSchedule());

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toEqual({
      effectiveAt: "2026-05-06T12:00:00.000Z",
      scheduledBillingPlanCode: "launch_monthly",
      status: "already_scheduled",
    });

    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).toHaveBeenCalledWith(expect.objectContaining({
      scheduledBillingPlanCode: "launch_monthly",
      stripeSubscriptionScheduleId: "sched_123",
    }));
  });

  test("accepts Stripe-computed monthly phase ends at month boundaries", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      currentPeriodEnd: 1_769_860_800,
      schedule: "sched_123",
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(makeCompatibleSchedule({
      currentEndDate: 1_769_860_800,
      currentStartDate: 1_767_268_800,
      futureEndDate: 1_772_280_000,
    }));

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-01-15T00:00:00.000Z"),
    })).resolves.toEqual({
      effectiveAt: "2026-01-31T12:00:00.000Z",
      scheduledBillingPlanCode: "launch_monthly",
      status: "already_scheduled",
    });

    expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).toHaveBeenCalledWith(expect.objectContaining({
      scheduledBillingEffectiveAt: new Date("2026-01-31T12:00:00.000Z"),
      scheduledBillingPlanCode: "launch_monthly",
    }));
  });


  test("recovers a schedule created by the same idempotent request before phase update", async () => {
    const unconfiguredSchedule = makeSchedule({
      metadata: {},
      phases: [
        makeSchedulePhase({
          endDate: 1_778_068_800,
          priceIds: ["price_edge_recurring"],
          startDate: 1_775_606_400,
        }),
      ],
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      schedule: "sched_123",
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(unconfiguredSchedule);
    mocks.stripe.subscriptionSchedules.create.mockResolvedValueOnce(unconfiguredSchedule);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toMatchObject({
      status: "scheduled",
    });

    expect(mocks.stripe.subscriptionSchedules.create).toHaveBeenCalledWith({
      from_subscription: "sub_123",
    }, expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^hosted-billing-switch-to-pulse:create:/u),
    }));
    expect(mocks.stripe.subscriptionSchedules.update).toHaveBeenCalled();
  });

  test("rejects foreign attached schedules instead of reinterpreting them", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      schedule: "sched_foreign",
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(makeSchedule({
      id: "sched_foreign",
      metadata: {},
      phases: [],
    }));
    mocks.stripe.subscriptionSchedules.create.mockRejectedValueOnce(new Error("already scheduled"));

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SCHEDULE_CONFLICT",
      httpStatus: 409,
    });

    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  test("rejects app-authored schedules that no longer match the canonical switch shape", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      schedule: "sched_123",
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(makeSchedule({
      endBehavior: "cancel",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "standard",
        memberId: "member_123",
        murphPlanSwitch: "edge_to_pulse_at_period_end",
      },
      phases: [
        makeSchedulePhase({
          endDate: 1_778_068_800,
          priceIds: ["price_edge_recurring"],
          startDate: 1_775_606_400,
        }),
        makeSchedulePhase({
          endDate: 1_780_747_200,
          metadata: {
            billingPlanCode: "launch_monthly",
            checkoutOffer: "standard",
            memberId: "member_123",
            murphPlanSwitch: "edge_to_pulse_at_period_end",
            trialDurationDays: "",
            trialPolicyVersion: "",
            trialUsageLimitUsdMicros: "",
          },
          priceIds: ["price_pulse_recurring"],
          startDate: 1_778_068_800,
        }),
      ],
    }));
    mocks.stripe.subscriptionSchedules.create.mockRejectedValueOnce(new Error("already scheduled"));

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SCHEDULE_CONFLICT",
      httpStatus: 409,
    });

    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
  });


  test.each([
    ["customer mismatch", makeSubscription({ customer: "cus_other" }), "HOSTED_BILLING_STRIPE_CUSTOMER_MISMATCH"],
    ["past due", makeSubscription({ status: "past_due" }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_STATE_UNSUPPORTED"],
    ["scheduled cancellation", makeSubscription({ cancelAt: 1_778_025_600 }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_STATE_UNSUPPORTED"],
    ["cancel at period end", makeSubscription({ cancelAtPeriodEnd: true }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_STATE_UNSUPPORTED"],
    ["manual invoice collection", makeSubscription({ collectionMethod: "send_invoice" }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_STATE_UNSUPPORTED"],
    ["paused collection", makeSubscription({
      pauseCollection: { behavior: "void", resumes_at: null },
    }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_STATE_UNSUPPORTED"],
    ["pending update", makeSubscription({ pendingUpdate: true }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_STATE_UNSUPPORTED"],
    ["unknown item", makeSubscription({ items: ["price_edge_recurring", "price_unknown"] }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_ITEMS_UNSUPPORTED"],
    ["metered item", makeSubscription({ items: ["price_edge_recurring", "price_unknown_usage"] }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_ITEMS_UNSUPPORTED"],
    ["duplicate recurring item", makeSubscription({ items: ["price_edge_recurring", "price_edge_recurring"] }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_ITEMS_UNSUPPORTED"],
  ])("rejects %s before schedule mutation", async (_label, subscription, code) => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(subscription);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code,
    });

    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
  });

  test("rejects metered usage items with unsupported quantities", async () => {
    const subscription = makeSubscription({
      items: ["price_edge_recurring", "price_edge_usage"],
    });
    Object.assign(subscription.items.data[1] ?? {}, {
      quantity: 1,
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(subscription);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_ITEMS_UNSUPPORTED",
    });
  });

  test("rejects non-month recurring prices", async () => {
    const subscription = makeSubscription();
    const recurringPrice = subscription.items.data[0]?.price;
    if (recurringPrice?.recurring) {
      recurringPrice.recurring.interval = "year";
    }
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(subscription);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_ITEMS_UNSUPPORTED",
    });
  });

  test("rejects non-paid local states before Stripe reads", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_edge_monthly",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
    })).rejects.toMatchObject({
      code: "HOSTED_PAID_SUBSCRIPTION_REQUIRED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  test("rejects missing Stripe refs before Stripe reads", async () => {
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: null,
    });

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_NOT_READY",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

});

describe("hosted Pulse switch schedule pending-field helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId.mockResolvedValue({
      billingRef: {
        currentBillingPlanCode: "launch_edge_monthly",
        memberId: "member_123",
        scheduledBillingEffectiveAt: new Date("2026-05-06T12:00:00.000Z"),
        scheduledBillingPlanCode: "launch_monthly",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        stripeSubscriptionScheduleId: "sched_123",
      },
      core: {
        id: "member_123",
      },
      matchedBy: "stripeSubscriptionScheduleId",
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
    mocks.writeHostedMemberStripeBillingRefTx.mockResolvedValue({
      memberId: "member_123",
    });
  });

  test("refreshes matching pending fields when the schedule still represents the switch", async () => {
    await refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx({
      schedule: makeCompatibleSchedule(),
      tx: mocks.prismaClient as never,
    });

    expect(mocks.writeHostedMemberStripeBillingRefTx).toHaveBeenCalledWith({
      memberId: "member_123",
      scheduledBillingEffectiveAt: new Date("2026-05-06T12:00:00.000Z"),
      scheduledBillingPlanCode: "launch_monthly",
      stripeSubscriptionScheduleId: "sched_123",
      tx: mocks.prismaClient,
    });
  });

  test("clears pending fields when the matching schedule no longer represents the switch", async () => {
    await refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx({
      schedule: makeSchedule({
        metadata: {
          murphPlanSwitch: "other",
        },
      }),
      tx: mocks.prismaClient as never,
    });

    expect(mocks.writeHostedMemberStripeBillingRefTx).toHaveBeenCalledWith({
      memberId: "member_123",
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
      stripeSubscriptionScheduleId: null,
      tx: mocks.prismaClient,
    });
  });

  test("clears matching pending fields for terminal schedule lifecycle events", async () => {
    await clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx({
      stripeSubscriptionScheduleId: "sched_123",
      tx: mocks.prismaClient as never,
    });

    expect(mocks.writeHostedMemberStripeBillingRefTx).toHaveBeenCalledWith({
      memberId: "member_123",
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
      stripeSubscriptionScheduleId: null,
      tx: mocks.prismaClient,
    });
  });
});

function makeSubscription(input?: {
  cancelAt?: number | null;
  cancelAtPeriodEnd?: boolean;
  collectionMethod?: Stripe.Subscription["collection_method"];
  currentPeriodEnd?: number;
  customer?: string;
  defaultPaymentMethod?: string | null;
  items?: string[];
  pendingUpdate?: boolean;
  pauseCollection?: Stripe.Subscription["pause_collection"];
  schedule?: string | null;
  status?: Stripe.Subscription.Status;
}): Stripe.Subscription {
  const itemPriceIds = input?.items ?? ["price_edge_recurring"];

  // @ts-expect-error - the synthetic fixture only includes the Stripe fields exercised here.
  return {
    cancel_at: input?.cancelAt ?? null,
    cancel_at_period_end: input?.cancelAtPeriodEnd === true,
    collection_method: input?.collectionMethod ?? "charge_automatically",
    current_period_end: input?.currentPeriodEnd ?? 1_778_068_800,
    customer: input?.customer ?? "cus_123",
    default_payment_method:
      input?.defaultPaymentMethod === undefined
        ? "pm_default"
        : input.defaultPaymentMethod,
    id: "sub_123",
    items: {
      data: itemPriceIds.map((priceId, index) => ({
        id: `si_${index}`,
        price: makePrice(priceId),
        ...(priceId.endsWith("_recurring") ? { quantity: 1 } : {}),
      })),
    },
    metadata: {
      billingPlanCode: "launch_edge_monthly",
      memberId: "member_123",
    },
    object: "subscription",
    pending_update: input?.pendingUpdate ? {} : null,
    pause_collection: input?.pauseCollection ?? null,
    schedule: input?.schedule ?? null,
    status: input?.status ?? "active",
  } as Stripe.Subscription;
}

function makePrice(priceId: string): Stripe.Price {
  const usageType = priceId.endsWith("_usage") ? "metered" : "licensed";

  return {
    id: priceId,
    metadata: {},
    object: "price",
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: usageType,
    },
  } as Stripe.Price;
}

function makeCompatibleSchedule(input?: {
  currentEndDate?: number;
  currentStartDate?: number;
  futureEndDate?: number;
}): Stripe.SubscriptionSchedule {
  const currentEndDate = input?.currentEndDate ?? 1_778_068_800;
  const currentStartDate = input?.currentStartDate ?? 1_775_606_400;

  return makeSchedule({
    currentEndDate,
    currentStartDate,
    metadata: {
      billingPlanCode: "launch_monthly",
      checkoutOffer: "standard",
      memberId: "member_123",
      murphPlanSwitch: "edge_to_pulse_at_period_end",
    },
    phases: [
      makeSchedulePhase({
        endDate: currentEndDate,
        priceIds: ["price_edge_recurring"],
        startDate: currentStartDate,
      }),
      makeSchedulePhase({
        endDate: input?.futureEndDate ?? 1_780_790_400,
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
          murphPlanSwitch: "edge_to_pulse_at_period_end",
          trialDurationDays: "",
          trialPolicyVersion: "",
          trialUsageLimitUsdMicros: "",
        },
        priceIds: ["price_pulse_recurring"],
        startDate: currentEndDate,
      }),
    ],
  });
}

function makeCompatibleGroupSchedule(): Stripe.SubscriptionSchedule {
  return makeSchedule({
    metadata: {
      billingPlanCode: "launch_group_monthly",
      checkoutOffer: "standard",
      memberId: "member_123",
      murphPlanSwitch: "direct_plan_at_period_end_v1",
    },
    phases: [
      makeSchedulePhase({
        endDate: 1_778_068_800,
        priceIds: ["price_pulse_recurring"],
        startDate: 1_775_606_400,
      }),
      makeSchedulePhase({
        endDate: 1_780_790_400,
        metadata: {
          billingPlanCode: "launch_group_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
          murphPlanSwitch: "direct_plan_at_period_end_v1",
          trialDurationDays: "",
          trialPolicyVersion: "",
          trialUsageLimitUsdMicros: "",
        },
        priceIds: ["price_group_recurring"],
        startDate: 1_778_068_800,
      }),
    ],
  });
}

function makeCompatibleMaxToEdgeSchedule(): Stripe.SubscriptionSchedule {
  return makeSchedule({
    metadata: {
      billingPlanCode: "launch_edge_monthly",
      checkoutOffer: "standard",
      memberId: "member_123",
      murphPlanSwitch: "direct_plan_at_period_end_v1",
    },
    phases: [
      makeSchedulePhase({
        endDate: 1_778_068_800,
        priceIds: ["price_max_recurring"],
        startDate: 1_775_606_400,
      }),
      makeSchedulePhase({
        endDate: 1_780_790_400,
        metadata: {
          billingPlanCode: "launch_edge_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
          murphPlanSwitch: "direct_plan_at_period_end_v1",
          trialDurationDays: "",
          trialPolicyVersion: "",
          trialUsageLimitUsdMicros: "",
        },
        priceIds: ["price_edge_recurring"],
        startDate: 1_778_068_800,
      }),
    ],
  });
}

function makeSchedule(input?: {
  currentEndDate?: number;
  currentStartDate?: number;
  endBehavior?: Stripe.SubscriptionSchedule.EndBehavior;
  id?: string;
  metadata?: Record<string, string>;
  phases?: Stripe.SubscriptionSchedule.Phase[];
  status?: Stripe.SubscriptionSchedule.Status;
  subscription?: string | null;
}): Stripe.SubscriptionSchedule {
  return {
    created: 1_775_606_400,
    current_phase: {
      end_date: input?.currentEndDate ?? 1_778_068_800,
      start_date: input?.currentStartDate ?? 1_775_606_400,
    },
    end_behavior: input?.endBehavior ?? "release",
    id: input?.id ?? "sched_123",
    metadata: input?.metadata ?? {},
    object: "subscription_schedule",
    phases: input?.phases ?? [],
    status: input?.status ?? "active",
    subscription: input?.subscription === undefined ? "sub_123" : input.subscription,
  } as Stripe.SubscriptionSchedule;
}

function makeSchedulePhase(input: {
  endDate: number;
  metadata?: Record<string, string>;
  priceIds: readonly string[];
  startDate: number;
}): Stripe.SubscriptionSchedule.Phase {
  return {
    end_date: input.endDate,
    items: input.priceIds.map((priceId) => ({
      price: priceId,
      ...(priceId.endsWith("_recurring") ? { quantity: 1 } : {}),
    })),
    metadata: input.metadata ?? {},
    proration_behavior: "none",
    start_date: input.startDate,
  } as Stripe.SubscriptionSchedule.Phase;
}

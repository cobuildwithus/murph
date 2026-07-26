import { beforeEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

import {
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY,
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
} from "@/src/lib/hosted-onboarding/legacy-usage-price";
import { getPrisma } from "@/src/lib/prisma";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId: vi.fn(),
  prismaClient: {
    $transaction: vi.fn(),
  },
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedStripeBillingPlanConfig: vi.fn(),
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

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
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
}));

import {
  clearHostedBillingPlanSwitchToPulsePendingFieldsForScheduleTx,
  refreshHostedBillingPlanSwitchToPulsePendingFieldsFromScheduleTx,
  scheduleHostedBillingPlanSwitchToPulse,
} from "@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service";

describe("scheduleHostedBillingPlanSwitchToPulse", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
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
      currentCheckoutOffer: "pulse_trial_7d",
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
    mocks.stripe.subscriptions.retrieve.mockResolvedValue(makeSubscription());
    mocks.stripe.subscriptionSchedules.create.mockResolvedValue(makeSchedule({
      metadata: {},
      phases: [
        makeSchedulePhase({
          endDate: 1_778_068_800,
          priceIds: ["price_edge_recurring", "price_edge_usage"],
          startDate: 1_775_606_400,
        }),
      ],
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValue(makeSchedule({
      metadata: {},
      phases: [
        makeSchedulePhase({
          endDate: 1_778_068_800,
          priceIds: ["price_edge_recurring", "price_edge_usage"],
          startDate: 1_775_606_400,
        }),
      ],
    }));
    mocks.stripe.subscriptionSchedules.update.mockResolvedValue(makeCompatibleSchedule());
    mocks.writeHostedMemberStripeBillingRefTx.mockResolvedValue({
      memberId: "member_123",
    });
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

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith(
      "sub_123",
      {
        expand: ["items.data.price"],
      },
      {
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      },
    );
    expect(mocks.stripe.subscriptionSchedules.create).toHaveBeenCalledWith({
      from_subscription: "sub_123",
    }, {
      idempotencyKey: expect.stringMatching(/^hosted-billing-switch-to-pulse:create:[a-f0-9]{64}$/u),
      maxNetworkRetries: 0,
      timeout: expect.any(Number),
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
        idempotencyKey: expect.stringMatching(/^hosted-billing-switch-to-pulse:v2:update:[a-f0-9]{64}$/u),
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
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

  test("returns already_scheduled for the same compatible app-authored schedule", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: ["price_edge_recurring"],
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

  test("rejects an app-authored schedule whose current phase drifted from the subscription", async () => {
    const schedule = makeCompatibleSchedule();
    const currentPhase = schedule.phases[0];
    if (!currentPhase) {
      throw new Error("Expected a current schedule phase.");
    }
    currentPhase.default_payment_method = "pm_operator";
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      items: ["price_edge_recurring"],
      schedule: "sched_123",
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(schedule);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SCHEDULE_CONFLICT",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
  });

  test("accepts Stripe-computed monthly phase ends at month boundaries", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      currentPeriodEnd: 1_769_860_800,
      items: ["price_edge_recurring"],
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


  test("adopts a pristine attached schedule without replaying the create request", async () => {
    const unconfiguredSchedule = makeSchedule({
      metadata: {},
      phases: [
        makeSchedulePhase({
          endDate: 1_778_068_800,
          priceIds: ["price_edge_recurring", "price_edge_usage"],
          startDate: 1_775_606_400,
        }),
      ],
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      schedule: "sched_123",
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(unconfiguredSchedule);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toMatchObject({
      status: "scheduled",
    });

    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.update).toHaveBeenCalledWith(
      "sched_123",
      expect.any(Object),
      expect.any(Object),
    );
  });

  test("adopts a pristine attached schedule with the canonical payment method", async () => {
    const subscription = makeSubscription({
      defaultPaymentMethod: "pm_canonical",
      schedule: "sched_123",
    });
    const schedule = makePristineAttachedSchedule();
    schedule.default_settings.default_payment_method = "pm_canonical";
    const currentPhase = schedule.phases[0];
    if (!currentPhase) {
      throw new Error("Expected a current schedule phase.");
    }
    currentPhase.default_payment_method = "pm_canonical";
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(subscription);
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(schedule);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toMatchObject({
      status: "scheduled",
    });

    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.update).toHaveBeenCalledTimes(1);
  });

  test("accepts current-phase metadata inherited exactly from the subscription", async () => {
    const subscription = makeSubscription({
      schedule: "sched_123",
    });
    const schedule = makePristineAttachedSchedule();
    const currentPhase = schedule.phases[0];
    if (!currentPhase) {
      throw new Error("Expected a current schedule phase.");
    }
    currentPhase.metadata = {
      ...subscription.metadata,
    };
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(subscription);
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(schedule);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toMatchObject({
      status: "scheduled",
    });

    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.update).toHaveBeenCalledTimes(1);
  });

  test.each([
    {
      buildLiveSchedule: () => makeSchedule({
        endBehavior: "cancel",
        metadata: {},
        phases: [
          makeSchedulePhase({
            endDate: 1_778_068_800,
            priceIds: ["price_edge_recurring", "price_edge_usage"],
            startDate: 1_775_606_400,
          }),
        ],
      }),
      label: "cancellation",
    },
    {
      buildLiveSchedule: () => makeSchedule({
        metadata: {},
        phases: [
          makeSchedulePhase({
            endDate: 1_778_068_800,
            priceIds: ["price_edge_recurring", "price_edge_usage"],
            startDate: 1_775_606_400,
          }),
          makeSchedulePhase({
            endDate: 1_780_747_200,
            priceIds: ["price_pulse_recurring"],
            startDate: 1_778_068_800,
          }),
        ],
      }),
      label: "additional phase",
    },
    {
      buildLiveSchedule: () => {
        const schedule = makePristineAttachedSchedule();
        schedule.default_settings.default_payment_method = "pm_operator";
        return schedule;
      },
      label: "payment-method change",
    },
    {
      buildLiveSchedule: () => {
        const schedule = makePristineAttachedSchedule();
        const currentPhase = schedule.phases[0];
        if (currentPhase) {
          currentPhase.metadata = {
            operatorChange: "true",
          };
        }
        return schedule;
      },
      label: "phase metadata change",
    },
    {
      buildLiveSchedule: () => {
        const schedule = makePristineAttachedSchedule();
        const currentPhase = schedule.phases[0];
        if (!currentPhase) {
          throw new Error("Expected a current schedule phase.");
        }
        currentPhase.default_payment_method = "pm_operator";
        return schedule;
      },
      label: "phase payment-method change",
    },
    {
      buildLiveSchedule: () => {
        const schedule = makePristineAttachedSchedule();
        const currentItem = schedule.phases[0]?.items[0];
        if (!currentItem) {
          throw new Error("Expected a current schedule item.");
        }
        currentItem.quantity = 2;
        return schedule;
      },
      label: "quantity change",
    },
  ])(
    "does not overwrite a drifted live schedule with a $label",
    async ({ buildLiveSchedule }) => {
      mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
        schedule: "sched_123",
      }));
      mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(
        buildLiveSchedule(),
      );

      await expect(scheduleHostedBillingPlanSwitchToPulse({
        memberId: "member_123",
        now: new Date("2026-05-06T00:00:00.000Z"),
      })).rejects.toMatchObject({
        code: "HOSTED_BILLING_STRIPE_SCHEDULE_CONFLICT",
        httpStatus: 409,
      });

      expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
      expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
      expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
    },
  );

  test("rejects foreign attached schedules instead of reinterpreting them", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      schedule: "sched_foreign",
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(makeSchedule({
      id: "sched_foreign",
      metadata: {},
      phases: [],
    }));
    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SCHEDULE_CONFLICT",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
  });

  test("rejects app-authored schedules with the wrong checkout offer", async () => {
    const schedule = makeCompatibleSchedule();
    if (!schedule.metadata) {
      throw new Error("Expected schedule metadata.");
    }
    schedule.metadata.checkoutOffer = "pulse_trial_7d";
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      schedule: "sched_123",
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(schedule);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SCHEDULE_CONFLICT",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
  });

  test("preserves an ambiguous schedule-create failure for retry during idempotent recovery", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription());
    mocks.stripe.subscriptionSchedules.create.mockRejectedValueOnce(
      makeStripeError({
        message: "connection interrupted",
        statusCode: 500,
        type: "StripeAPIConnectionError",
      }),
    );

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_PLAN_SWITCH_UNAVAILABLE",
      httpStatus: 502,
      retryable: true,
    });

    expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
  });

  test("does not replay a retained create key after Stripe attached a pristine schedule", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      schedule: "sched_123",
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(
      makePristineAttachedSchedule(),
    );
    mocks.stripe.subscriptionSchedules.create.mockRejectedValueOnce(
      makeStripeError({
        headers: {
          "idempotent-replayed": "true",
        },
        message: "cached server failure",
        statusCode: 500,
        type: "StripeAPIError",
      }),
    );

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).resolves.toMatchObject({
      status: "scheduled",
    });

    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.update).toHaveBeenCalledWith(
      "sched_123",
      expect.any(Object),
      expect.any(Object),
    );
    expect(mocks.writeHostedMemberStripeBillingRefTx).toHaveBeenCalled();
  });

  test("does not misclassify deterministic provider configuration failures as schedule conflicts", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription());
    mocks.stripe.subscriptionSchedules.create.mockRejectedValueOnce(
      makeStripeError({
        message: "authentication failed",
        statusCode: 401,
        type: "StripeAuthenticationError",
      }),
    );

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_PLAN_SWITCH_UNAVAILABLE",
      httpStatus: 500,
      message: expect.not.stringContaining("Try again"),
      retryable: false,
    });
  });

  test("preserves an unrelated Stripe invalid request as a provider failure", async () => {
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription());
    mocks.stripe.subscriptionSchedules.create.mockRejectedValueOnce(
      makeStripeError({
        message: "unknown create parameter",
        rawType: "invalid_request_error",
        statusCode: 400,
        type: "StripeInvalidRequestError",
      }),
    );

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_PLAN_SWITCH_UNAVAILABLE",
      httpStatus: 500,
      retryable: false,
    });

    expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
  });

  test("keeps the attached schedule and versioned update key after a deterministic failure", async () => {
    const attachedSchedule = makeSchedule({
      metadata: {},
      phases: [
        makeSchedulePhase({
          endDate: 1_778_068_800,
          priceIds: ["price_edge_recurring", "price_edge_usage"],
          startDate: 1_775_606_400,
        }),
      ],
    });
    mocks.stripe.subscriptions.retrieve
      .mockResolvedValueOnce(makeSubscription())
      .mockResolvedValueOnce(makeSubscription({
        schedule: "sched_123",
      }));
    mocks.stripe.subscriptionSchedules.create.mockResolvedValue(attachedSchedule);
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValue(attachedSchedule);
    mocks.stripe.subscriptionSchedules.update.mockRejectedValue(
      makeStripeError({
        message: "invalid schedule update",
        rawType: "invalid_request_error",
        statusCode: 400,
        type: "StripeInvalidRequestError",
      }),
    );

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_PLAN_SWITCH_UNAVAILABLE",
      httpStatus: 500,
      retryable: false,
    });

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_PLAN_SWITCH_UNAVAILABLE",
      httpStatus: 500,
      retryable: false,
    });

    expect(mocks.stripe.subscriptionSchedules.create).toHaveBeenCalledTimes(1);
    const firstCreateOptions =
      mocks.stripe.subscriptionSchedules.create.mock.calls[0]?.[1];
    expect(firstCreateOptions).toEqual({
      idempotencyKey: expect.stringMatching(
        /^hosted-billing-switch-to-pulse:create:[a-f0-9]{64}$/u,
      ),
      maxNetworkRetries: 0,
      timeout: expect.any(Number),
    });
    expect(mocks.stripe.subscriptionSchedules.update).toHaveBeenCalledTimes(2);
    const firstUpdateOptions =
      mocks.stripe.subscriptionSchedules.update.mock.calls[0]?.[2];
    const recoveryUpdateOptions =
      mocks.stripe.subscriptionSchedules.update.mock.calls[1]?.[2];
    expect(recoveryUpdateOptions).toEqual(firstUpdateOptions);
    expect(recoveryUpdateOptions).toEqual({
      idempotencyKey: expect.stringMatching(
        /^hosted-billing-switch-to-pulse:v2:update:[a-f0-9]{64}$/u,
      ),
      maxNetworkRetries: 0,
      timeout: expect.any(Number),
    });
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.update).toHaveBeenNthCalledWith(
      2,
      "sched_123",
      expect.objectContaining({
        end_behavior: "release",
      }),
      recoveryUpdateOptions,
    );
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
          priceIds: ["price_edge_recurring", "price_edge_usage"],
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
          priceIds: ["price_pulse_recurring", "price_pulse_usage"],
          startDate: 1_778_068_800,
        }),
      ],
    }));
    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SCHEDULE_CONFLICT",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
  });


  test.each([
    ["customer mismatch", makeSubscription({ customer: "cus_other" }), "HOSTED_BILLING_STRIPE_CUSTOMER_MISMATCH"],
    ["past due", makeSubscription({ status: "past_due" }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_STATE_UNSUPPORTED"],
    ["cancel at period end", makeSubscription({ cancelAtPeriodEnd: true }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_STATE_UNSUPPORTED"],
    ["explicit cancel at", makeSubscription({ cancelAt: 1_778_068_700 }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_STATE_UNSUPPORTED"],
    ["pending update", makeSubscription({ pendingUpdate: true }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_STATE_UNSUPPORTED"],
    ["unknown item", makeSubscription({ items: ["price_edge_recurring", "price_edge_usage", "price_unknown"] }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_ITEMS_UNSUPPORTED"],
    ["unmarked metered item", makeSubscription({ items: ["price_edge_recurring", "price_edge_usage", "price_unknown_usage"] }), "HOSTED_BILLING_STRIPE_SUBSCRIPTION_ITEMS_UNSUPPORTED"],
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

  test.each([
    {
      configure: (subscription: Stripe.Subscription) => {
        subscription.discounts = ["di_123"];
      },
      label: "subscription discounts",
      reason: "discounts",
    },
    {
      configure: (subscription: Stripe.Subscription) => {
        subscription.automatic_tax.enabled = true;
      },
      label: "automatic tax",
      reason: "automatic_tax",
    },
    {
      configure: (subscription: Stripe.Subscription) => {
        subscription.billing_thresholds = {
          amount_gte: 1_000,
          reset_billing_cycle_anchor: false,
        };
      },
      label: "billing thresholds",
      reason: "billing_thresholds",
    },
    {
      configure: (subscription: Stripe.Subscription) => {
        subscription.billing_cycle_anchor_config = {
          day_of_month: 25,
          hour: 0,
          minute: 0,
          month: null,
          second: 0,
        };
      },
      label: "fixed billing-cycle anchor configuration",
      reason: "billing_cycle_anchor_config",
    },
    {
      configure: (subscription: Stripe.Subscription) => {
        subscription.default_source = "card_123";
      },
      label: "legacy default source",
      reason: "default_source",
    },
    {
      configure: (subscription: Stripe.Subscription) => {
        subscription.invoice_settings.account_tax_ids = ["txi_123"];
      },
      label: "invoice tax settings",
      reason: "invoice_settings",
    },
    {
      configure: (subscription: Stripe.Subscription) => {
        Reflect.set(subscription.invoice_settings, "footer", "Custom terms");
      },
      label: "invoice presentation settings",
      reason: "invoice_settings",
    },
    {
      configure: (subscription: Stripe.Subscription) => {
        subscription.on_behalf_of = "acct_123";
      },
      label: "Connect on-behalf-of",
      reason: "on_behalf_of",
    },
    {
      configure: (subscription: Stripe.Subscription) => {
        subscription.payment_settings = {
          payment_method_options: null,
          payment_method_types: ["card"],
          save_default_payment_method: "off",
        };
      },
      label: "restricted payment-method settings",
      reason: "payment_settings",
    },
    {
      configure: (subscription: Stripe.Subscription) => {
        subscription.items.data[0]!.metadata = {
          preserved: "required",
        };
      },
      label: "recurring-item metadata",
      reason: "item.metadata",
    },
  ])("rejects unsupported $label before creating a schedule", async ({
    configure,
    reason,
  }) => {
    const subscription = makeSubscription();
    configure(subscription);
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(subscription);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_CONFIGURATION_UNSUPPORTED",
      details: {
        code: reason,
      },
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
  });

  test("rejects unsupported attached schedule settings before reusing the schedule", async () => {
    const schedule = makeCompatibleSchedule();
    schedule.default_settings.billing_thresholds = {
      amount_gte: 1_000,
      reset_billing_cycle_anchor: false,
    };
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      schedule: "sched_123",
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(schedule);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_CONFIGURATION_UNSUPPORTED",
      details: {
        code: "schedule.default_settings.billing_thresholds",
      },
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
  });

  test.each([
    {
      configure: (schedule: Stripe.SubscriptionSchedule) => {
        schedule.billing_mode = {
          flexible: {
            proration_discounts: "included",
          },
          type: "flexible",
        };
      },
      reason: "schedule.billing_mode",
    },
    {
      configure: (schedule: Stripe.SubscriptionSchedule) => {
        Reflect.set(schedule.default_settings, "default_source", "card_123");
      },
      reason: "schedule.default_settings.default_source",
    },
    {
      configure: (schedule: Stripe.SubscriptionSchedule) => {
        Reflect.set(schedule, "renewal_interval", {
          interval: "month",
          interval_count: 1,
        });
      },
      reason: "schedule.renewal_interval",
    },
  ])("rejects attached schedule configuration $reason", async ({
    configure,
    reason,
  }) => {
    const schedule = makeCompatibleSchedule();
    configure(schedule);
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeSubscription({
      schedule: "sched_123",
    }));
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(schedule);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_CONFIGURATION_UNSUPPORTED",
      details: {
        code: reason,
      },
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
  });

  test("revalidates the schedule created from the subscription before updating phases", async () => {
    const schedule = makeSchedule();
    schedule.default_settings.billing_thresholds = {
      amount_gte: 1_000,
      reset_billing_cycle_anchor: false,
    };
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(schedule);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SUBSCRIPTION_CONFIGURATION_UNSUPPORTED",
      details: {
        code: "schedule.default_settings.billing_thresholds",
      },
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptionSchedules.create).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
  });

  test("does not overwrite canonical-field drift detected after schedule creation", async () => {
    const schedule = makePristineAttachedSchedule();
    const currentItem = schedule.phases[0]?.items[0];
    if (!currentItem) {
      throw new Error("Expected a current schedule item.");
    }
    currentItem.quantity = 2;
    mocks.stripe.subscriptionSchedules.retrieve.mockResolvedValueOnce(schedule);

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_STRIPE_SCHEDULE_CONFLICT",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptionSchedules.create).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
  });

  test("rejects metered usage items with unsupported quantities", async () => {
    const subscription = makeSubscription();
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

  test("rejects non-paid or non-Edge local states before Stripe reads", async () => {
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
      code: "HOSTED_BILLING_PLAN_SWITCH_UNSUPPORTED",
      httpStatus: 400,
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

  test.each([
    {
      label: "changed",
      lockedBillingRef: {
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_edge_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        stripeCustomerId: "cus_other",
        stripeSubscriptionId: "sub_other",
      },
    },
    {
      label: "deleted",
      lockedBillingRef: null,
    },
  ])(
    "rejects when billing ownership is $label before the owner lock is acquired",
    async ({ lockedBillingRef }) => {
      const outerBillingRef = {
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_edge_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
      };
      mocks.readHostedMemberStripeBillingRef
        .mockResolvedValueOnce(outerBillingRef)
        .mockResolvedValueOnce(lockedBillingRef);

      await expect(scheduleHostedBillingPlanSwitchToPulse({
        memberId: "member_123",
        now: new Date("2026-05-06T00:00:00.000Z"),
      })).rejects.toMatchObject({
        code: "HOSTED_BILLING_PLAN_SWITCH_STATE_CHANGED",
        httpStatus: 409,
      });

      expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(mocks.stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
      expect(mocks.stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
      expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
    },
  );

  test("does not persist a provider mutation after the exact owner reference changes", async () => {
    const originalBillingRef = {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    };
    mocks.readHostedMemberStripeBillingRef
      .mockResolvedValueOnce(originalBillingRef)
      .mockResolvedValueOnce(originalBillingRef)
      .mockResolvedValueOnce({
        ...originalBillingRef,
        stripeCustomerId: "cus_other",
        stripeSubscriptionId: "sub_other",
      });

    await expect(scheduleHostedBillingPlanSwitchToPulse({
      memberId: "member_123",
      now: new Date("2026-05-06T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PLAN_SWITCH_STATE_CHANGED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptionSchedules.create).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.subscriptionSchedules.update).toHaveBeenCalledTimes(1);
    expect(mocks.writeHostedMemberStripeBillingRefTx).not.toHaveBeenCalled();
  });
});

describe("hosted Pulse switch schedule pending-field helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookupHostedMemberStripeBillingRefByStripeSubscriptionScheduleId.mockResolvedValue({
      billingRef: {
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
      tx: getPrisma(),
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
      tx: getPrisma(),
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
      tx: getPrisma(),
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
  currentPeriodEnd?: number;
  customer?: string;
  defaultPaymentMethod?: string | null;
  items?: string[];
  pendingUpdate?: boolean;
  schedule?: string | null;
  status?: Stripe.Subscription.Status;
}): Stripe.Subscription {
  const itemPriceIds = input?.items ?? ["price_edge_recurring", "price_edge_usage"];
  const currentPeriodStart = 1_775_606_400;
  const currentPeriodEnd = input?.currentPeriodEnd ?? 1_778_068_800;
  const subscription: Stripe.Subscription & {
    current_period_end: number;
    current_period_start: number;
  } = {
    application: null,
    application_fee_percent: null,
    automatic_tax: {
      disabled_reason: null,
      enabled: false,
      liability: null,
    },
    billing_cycle_anchor: currentPeriodStart,
    billing_cycle_anchor_config: null,
    billing_mode: {
      flexible: null,
      type: "classic",
    },
    billing_thresholds: null,
    cancel_at: input?.cancelAt ?? null,
    cancel_at_period_end: input?.cancelAtPeriodEnd === true,
    canceled_at: null,
    cancellation_details: null,
    collection_method: "charge_automatically",
    created: currentPeriodStart,
    currency: "usd",
    current_period_end: currentPeriodEnd,
    current_period_start: currentPeriodStart,
    customer: input?.customer ?? "cus_123",
    customer_account: null,
    days_until_due: null,
    default_payment_method: input?.defaultPaymentMethod ?? null,
    default_source: null,
    default_tax_rates: [],
    description: null,
    discounts: [],
    ended_at: null,
    id: "sub_123",
    invoice_settings: {
      account_tax_ids: null,
      issuer: {
        type: "self",
      },
    },
    items: {
      data: itemPriceIds.map(makeSubscriptionItem),
      has_more: false,
      object: "list",
      url: "/v1/subscription_items",
    },
    latest_invoice: null,
    livemode: false,
    managed_payments: null,
    metadata: {
      billingPlanCode: "launch_edge_monthly",
      memberId: "member_123",
    },
    next_pending_invoice_item_invoice: null,
    object: "subscription",
    on_behalf_of: null,
    payment_settings: {
      payment_method_options: null,
      payment_method_types: null,
      save_default_payment_method: "off",
    },
    pending_invoice_item_interval: null,
    pending_setup_intent: null,
    pending_update: input?.pendingUpdate
      ? {
        billing_cycle_anchor: null,
        expires_at: currentPeriodEnd - 60,
        subscription_items: [],
        trial_end: null,
        trial_from_plan: false,
      }
      : null,
    pause_collection: null,
    schedule: input?.schedule ?? null,
    start_date: currentPeriodStart,
    status: input?.status ?? "active",
    test_clock: null,
    transfer_data: null,
    trial_end: null,
    trial_settings: null,
    trial_start: null,
  };
  return subscription;
}

function makeSubscriptionItem(
  priceId: string,
  index: number,
): Stripe.SubscriptionItem {
  const plan: Partial<Stripe.Plan> = {
    id: priceId,
    object: "plan",
  };
  return {
    billing_thresholds: null,
    created: 1_775_606_400,
    current_period_end: 1_778_068_800,
    current_period_start: 1_775_606_400,
    discounts: [],
    id: `si_${index}`,
    metadata: {},
    object: "subscription_item",
    plan: plan as Stripe.Plan,
    price: makePrice(priceId),
    ...(priceId.endsWith("_recurring") ? { quantity: 1 } : {}),
    subscription: "sub_123",
    tax_rates: [],
  };
}

function makePrice(priceId: string): Stripe.Price {
  const usageType = priceId.endsWith("_usage") ? "metered" : "licensed";

  return {
    id: priceId,
    metadata: isLegacyUsagePriceId(priceId)
      ? {
          [HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY]:
            HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
        }
      : {},
    object: "price",
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: usageType,
    },
  } as Stripe.Price;
}

function isLegacyUsagePriceId(priceId: string): boolean {
  return priceId === "price_pulse_usage" || priceId === "price_edge_usage";
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

function makePristineAttachedSchedule(): Stripe.SubscriptionSchedule {
  return makeSchedule({
    metadata: {},
    phases: [
      makeSchedulePhase({
        endDate: 1_778_068_800,
        priceIds: ["price_edge_recurring", "price_edge_usage"],
        startDate: 1_775_606_400,
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
    application: null,
    billing_mode: {
      flexible: null,
      type: "classic",
    },
    canceled_at: null,
    completed_at: null,
    created: 1_775_606_400,
    current_phase: {
      end_date: input?.currentEndDate ?? 1_778_068_800,
      start_date: input?.currentStartDate ?? 1_775_606_400,
    },
    default_settings: {
      application_fee_percent: null,
      automatic_tax: {
        disabled_reason: null,
        enabled: false,
        liability: null,
      },
      billing_cycle_anchor: "automatic",
      billing_thresholds: null,
      collection_method: "charge_automatically",
      default_payment_method: null,
      default_source: null,
      description: null,
      invoice_settings: {
        account_tax_ids: null,
        days_until_due: null,
        issuer: {
          type: "self",
        },
      },
      on_behalf_of: null,
      transfer_data: null,
    },
    end_behavior: input?.endBehavior ?? "release",
    customer: "cus_123",
    customer_account: null,
    id: input?.id ?? "sched_123",
    livemode: false,
    metadata: input?.metadata ?? {},
    object: "subscription_schedule",
    phases: input?.phases ?? [],
    released_at: null,
    released_subscription: null,
    renewal_interval: null,
    status: input?.status ?? "active",
    subscription: input?.subscription === undefined ? "sub_123" : input.subscription,
    test_clock: null,
  } as Stripe.SubscriptionSchedule;
}

function makeSchedulePhase(input: {
  endDate: number;
  metadata?: Record<string, string>;
  priceIds: readonly string[];
  startDate: number;
}): Stripe.SubscriptionSchedule.Phase {
  const items = input.priceIds.map(
    (priceId): Stripe.SubscriptionSchedule.Phase.Item => ({
      billing_thresholds: null,
      discounts: [],
      metadata: {},
      plan: priceId,
      price: priceId,
      ...(priceId.endsWith("_recurring") ? { quantity: 1 } : {}),
      tax_rates: [],
    }),
  );
  return {
    add_invoice_items: [],
    application_fee_percent: null,
    automatic_tax: {
      disabled_reason: null,
      enabled: false,
      liability: null,
    },
    billing_cycle_anchor: null,
    billing_thresholds: null,
    collection_method: "charge_automatically",
    currency: "usd",
    default_payment_method: null,
    default_tax_rates: [],
    description: null,
    discounts: [],
    end_date: input.endDate,
    items,
    invoice_settings: {
      account_tax_ids: null,
      days_until_due: null,
      issuer: {
        type: "self",
      },
    },
    metadata: input.metadata ?? {},
    on_behalf_of: null,
    proration_behavior: "none",
    start_date: input.startDate,
    transfer_data: null,
    trial_end: null,
  };
}

function makeStripeError(input: {
  headers?: Record<string, string>;
  message: string;
  rawType?: string;
  statusCode?: number;
  type: string;
}): Error {
  return Object.assign(new Error(input.message), {
    headers: input.headers,
    rawType: input.rawType,
    statusCode: input.statusCode,
    type: input.type,
  });
}

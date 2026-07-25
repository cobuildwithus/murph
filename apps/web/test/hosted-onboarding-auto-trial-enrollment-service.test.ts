import { HostedBillingStatus, Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import type { HostedMemberStripeBillingRefSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import type { HostedMemberBillingSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { isHostedPulseTrialSubscriptionForKnownPolicy } from "@/src/lib/hosted-onboarding/pulse-trial-subscription-cleanup";

const mocks = vi.hoisted(() => {
  const stripe = {
    customers: {
      create: vi.fn(),
    },
    subscriptions: {
      cancel: vi.fn(),
      create: vi.fn(),
      list: vi.fn(),
      retrieve: vi.fn(),
    },
  };

  return {
    activateHostedMemberForPositiveSourceTx: vi.fn(),
    assertHostedLaunchRequiredConsentGranted: vi.fn(),
    bindHostedMemberStripeCustomerIdIfMissingTx: vi.fn(),
    lockHostedMemberRow: vi.fn(),
    readHostedMemberBillingSnapshot: vi.fn(),
    requireHostedInviteForBillingCheckout: vi.fn(),
    requireHostedStripeBillingPlanConfig: vi.fn(),
    sendHostedSignupWelcomeEmailForMemberBestEffort: vi.fn(),
    signalHostedMemberActivationRuntimeWakeBestEffortResult: vi.fn(),
    stripe,
    writeHostedMemberStripeBillingTx: vi.fn(),
  };
});

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/shared")
  >("@/src/lib/hosted-onboarding/shared");

  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
  };
});

vi.mock("@/src/lib/hosted-onboarding/invite-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/invite-service")
  >("@/src/lib/hosted-onboarding/invite-service");

  return {
    ...actual,
    requireHostedInviteForBillingCheckout: mocks.requireHostedInviteForBillingCheckout,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/runtime")
  >("@/src/lib/hosted-onboarding/runtime");

  return {
    ...actual,
    requireHostedStripeBillingPlanConfig: mocks.requireHostedStripeBillingPlanConfig,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    readHostedMemberBillingSnapshot: mocks.readHostedMemberBillingSnapshot,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-billing-store")
  >("@/src/lib/hosted-onboarding/hosted-member-billing-store");

  return {
    ...actual,
    bindHostedMemberStripeCustomerIdIfMissingTx:
      mocks.bindHostedMemberStripeCustomerIdIfMissingTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-policy", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/stripe-billing-policy")
  >("@/src/lib/hosted-onboarding/stripe-billing-policy");

  return {
    ...actual,
    writeHostedMemberStripeBillingTx: mocks.writeHostedMemberStripeBillingTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-activation", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/member-activation")
  >("@/src/lib/hosted-onboarding/member-activation");

  return {
    ...actual,
    activateHostedMemberForPositiveSourceTx: mocks.activateHostedMemberForPositiveSourceTx,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-activation-runtime-wake", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/member-activation-runtime-wake")
  >("@/src/lib/hosted-onboarding/member-activation-runtime-wake");

  return {
    ...actual,
    signalHostedMemberActivationRuntimeWakeBestEffortResult:
      mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult,
  };
});

vi.mock("@/src/lib/hosted-onboarding/signup-welcome-email", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/signup-welcome-email")
  >("@/src/lib/hosted-onboarding/signup-welcome-email");

  return {
    ...actual,
    sendHostedSignupWelcomeEmailForMemberBestEffort:
      mocks.sendHostedSignupWelcomeEmailForMemberBestEffort,
  };
});

import {
  applyHostedAutoPulseTrialCampaignDispositionTx,
  buildHostedAutoPulseTrialCustomerIdempotencyKey,
  buildHostedAutoPulseTrialSubscriptionIdempotencyKey,
  ensureHostedAutoPulseTrialEnrollment,
  inspectHostedAutoPulseTrialCampaignDisposition,
  runHostedAutoPulseTrialCampaignPostCommitEffects,
} from "@/src/lib/hosted-onboarding/auto-trial-enrollment-service";

describe("ensureHostedAutoPulseTrialEnrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-06-14T12:00:05.000Z"));
    delete process.env.HOSTED_AUTO_PULSE_TRIAL_ENABLED;
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    mocks.requireHostedStripeBillingPlanConfig.mockReturnValue({
      billingPlanCode: "launch_monthly",
      priceId: "price_pulse_monthly_123",
      stripe: mocks.stripe,
    });
    mocks.stripe.customers.create.mockResolvedValue({
      id: "cus_auto_trial_123",
    });
    mocks.stripe.subscriptions.cancel.mockResolvedValue({
      id: "sub_auto_trial_123",
      object: "subscription",
      status: "canceled",
    });
    mocks.stripe.subscriptions.create.mockResolvedValue(makeTrialSubscription());
    mocks.stripe.subscriptions.list.mockResolvedValue({
      data: [],
    });
    mocks.stripe.subscriptions.retrieve.mockImplementation(async (subscriptionId: string) =>
      makeTrialSubscription({ id: subscriptionId })
    );
    mocks.bindHostedMemberStripeCustomerIdIfMissingTx.mockImplementation(async () => {
      const { getHostedDomainRootUnwrapCache } = await import(
        "@/src/lib/hosted-crypto/domain-root-unwrap-cache"
      );
      expect(getHostedDomainRootUnwrapCache()).toBeDefined();
      return {
        currentBillingPhase: null,
        currentBillingPlanCode: null,
        currentCheckoutOffer: null,
        currentPeriodEnd: null,
        currentPeriodStart: null,
        currentTrialEndsAt: null,
        currentTrialStartedAt: null,
        lastStripeEventCreatedAt: null,
        memberId: "member_123",
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        stripeCustomerId: "cus_auto_trial_123",
        stripeSubscriptionId: null,
      };
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeBillingSnapshot());
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValue(makeBillingSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentPeriodEnd: new Date("2026-06-28T12:00:00.000Z"),
        currentPeriodStart: new Date("2026-06-14T12:00:00.000Z"),
        currentTrialEndsAt: new Date("2026-06-28T12:00:00.000Z"),
        currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
        lastStripeEventCreatedAt: new Date("2026-06-14T12:00:00.000Z"),
        memberId: "member_123",
        pulseTrialPolicyVersion: "pulse-trial-2026-07-15-v3",
        pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
        stripeCustomerId: "cus_auto_trial_123",
        stripeSubscriptionId: "sub_auto_trial_123",
      },
      billingStatus: HostedBillingStatus.active,
    }));
    mocks.activateHostedMemberForPositiveSourceTx.mockResolvedValue({
      activated: true,
      hostedExecutionEventId: "member.activated:auto-trial",
      memberId: "member_123",
    });
    mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult.mockResolvedValue({
      accepted: true,
    });
    mocks.sendHostedSignupWelcomeEmailForMemberBestEffort.mockResolvedValue({
      status: "sent",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recognizes the exact auto-trial provider shape used for cleanup", () => {
    expect(isHostedPulseTrialSubscriptionForKnownPolicy({
      memberId: "member_123",
      priceId: "price_pulse_monthly_123",
      subscription: makeTrialSubscription(),
    })).toBe(true);
  });

  it("rejects enrollment when the auto trial rollout flag is disabled", async () => {
    process.env.HOSTED_AUTO_PULSE_TRIAL_ENABLED = "0";

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_DISABLED",
      httpStatus: 404,
    });
    expect(mocks.requireHostedInviteForBillingCheckout).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
  });

  it("creates a no-card Pulse trial subscription, writes trial billing state, and activates", async () => {
    const prisma = makePrisma();

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "enrolled",
    });

    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
    expect(mocks.stripe.customers.create).toHaveBeenCalledWith({
      metadata: {
        memberId: "member_123",
        source: "hosted.auto_pulse_trial",
      },
    }, {
      idempotencyKey: buildHostedAutoPulseTrialCustomerIdempotencyKey("member_123"),
    });
    expect(mocks.stripe.subscriptions.create).toHaveBeenCalledWith({
      customer: "cus_auto_trial_123",
      items: [
        {
          price: "price_pulse_monthly_123",
          quantity: 1,
        },
      ],
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        memberId: "member_123",
        trialDurationDays: "14",
        trialPolicyVersion: "pulse-trial-2026-07-15-v3",
        trialUsageLimitUsdMicros: "4500000",
      },
      trial_period_days: 14,
      trial_settings: {
        end_behavior: {
          missing_payment_method: "pause",
        },
      },
    }, {
      idempotencyKey: buildHostedAutoPulseTrialSubscriptionIdempotencyKey({
        memberId: "member_123",
        policyVersion: "pulse-trial-2026-07-15-v3",
        priceId: "price_pulse_monthly_123",
        recoveryScope: "initial",
        stripeCustomerId: "cus_auto_trial_123",
      }),
    });
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledTimes(2);
    expect(mocks.lockHostedMemberRow.mock.calls).toEqual([
      [expect.anything(), "member_123", { timeoutMs: 2_000 }],
      [expect.anything(), "member_123", { timeoutMs: 2_000 }],
    ]);
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).toHaveBeenCalledWith({
      memberId: "member_123",
      stripeCustomerId: "cus_auto_trial_123",
      tx: { tx: true },
    });
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).toHaveBeenCalledTimes(2);
    const { getHostedDomainRootUnwrapCache } = await import(
      "@/src/lib/hosted-crypto/domain-root-unwrap-cache"
    );
    expect(getHostedDomainRootUnwrapCache()).toBeUndefined();
    expect(mocks.stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: "cus_auto_trial_123",
      limit: 100,
      status: "all",
    });
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith(
      "sub_auto_trial_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(prisma.$transaction).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      {
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
    expect(prisma.$transaction).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      {
        maxWait: 5_000,
        timeout: 30_000,
      },
    );
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentPeriodEnd: new Date("2026-06-28T12:00:00.000Z"),
        currentPeriodStart: new Date("2026-06-14T12:00:00.000Z"),
        currentTrialEndsAt: new Date("2026-06-28T12:00:00.000Z"),
        currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
        freshnessPolicy: "auto-pulse-trial-entitlement",
        pulseTrialPolicyVersion: "pulse-trial-2026-07-15-v3",
        pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
        stripeCustomerId: "cus_auto_trial_123",
        stripeSubscriptionId: "sub_auto_trial_123",
      }),
    );
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_123",
        skipIfPreviouslyActivated: true,
      }),
    );
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).toHaveBeenCalledWith({
      hostedExecutionEventId: "member.activated:auto-trial",
      memberId: "member_123",
      prisma,
      source: "auto-pulse-trial.activation",
    });
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
  });

  it("keeps Stripe subscription recovery, creation, and the finalization read outside member transactions", async () => {
    const prisma = makePrisma();
    mocks.stripe.subscriptions.list.mockImplementationOnce(async () => {
      expect(prisma.isTransactionActive()).toBe(false);
      return {
        data: [],
      };
    });
    mocks.stripe.subscriptions.create.mockImplementationOnce(async () => {
      expect(prisma.isTransactionActive()).toBe(false);
      return makeTrialSubscription();
    });
    mocks.stripe.subscriptions.retrieve.mockImplementationOnce(async () => {
      expect(prisma.isTransactionActive()).toBe(false);
      return makeTrialSubscription();
    });

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "enrolled",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
  });

  it("reads Stripe before the finalization lock and writes only after the locked member re-read", async () => {
    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "enrolled",
    });

    const [stripeReadOrder] = mocks.stripe.subscriptions.retrieve.mock.invocationCallOrder;
    const finalizationLockOrder =
      mocks.lockHostedMemberRow.mock.invocationCallOrder[1];
    const lockedMemberReadOrder =
      mocks.readHostedMemberBillingSnapshot.mock.invocationCallOrder[2];
    const [billingWriteOrder] =
      mocks.writeHostedMemberStripeBillingTx.mock.invocationCallOrder;

    expect(stripeReadOrder).toBeLessThan(finalizationLockOrder as number);
    expect(finalizationLockOrder).toBeLessThan(lockedMemberReadOrder as number);
    expect(lockedMemberReadOrder).toBeLessThan(billingWriteOrder as number);
  });

  it("never writes trial billing for a provider trial that expired while the finalization lock was contended", async () => {
    const prisma = makePrisma();
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeBillingSnapshot())
      .mockResolvedValueOnce(makeBillingSnapshot())
      // The clock moves from the final locked member re-read, not from the
      // lock, so the test only passes while the freshness clock is read after
      // that re-read resolves. The trial ends at 2026-06-28T12:00:00Z, so this
      // attempt judged it eligible before the lock and only reaches the write
      // after it expired.
      .mockImplementationOnce(async () => {
        vi.setSystemTime(new Date("2026-06-28T12:00:00.500Z"));
        return makeBillingSnapshot();
      });

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_SUBSCRIPTION_CHANGED",
      httpStatus: 409,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledTimes(2);
    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledTimes(3);
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx).toHaveBeenCalledOnce();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("maps reservation lock contention to the retryable setup disposition before subscription work", async () => {
    const prisma = makePrisma();
    mocks.lockHostedMemberRow.mockRejectedValueOnce(
      makeMemberLockTimeoutError(),
    );

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_BUSY",
      httpStatus: 503,
      retryable: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(
      expect.anything(),
      "member_123",
      {
        timeoutMs: 2_000,
      },
    );
    expect(mocks.stripe.customers.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.list).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.bindHostedMemberStripeCustomerIdIfMissingTx)
      .not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("retries member-lock contention in a fresh transaction without repeating the authoritative Stripe read", async () => {
    const prisma = makePrisma();
    const memberLockTimeout = makeMemberLockTimeoutError();
    mocks.lockHostedMemberRow
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(memberLockTimeout)
      .mockResolvedValueOnce(undefined);

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "enrolled",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(mocks.stripe.subscriptions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledOnce();
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledOnce();
  });

  it("fails retryably without writing after bounded member-lock retries", async () => {
    const prisma = makePrisma();
    const memberLockTimeout = makeMemberLockTimeoutError();
    mocks.lockHostedMemberRow
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(memberLockTimeout)
      .mockRejectedValueOnce(memberLockTimeout)
      .mockRejectedValueOnce(memberLockTimeout);

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_BUSY",
      httpStatus: 503,
      retryable: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(4);
    expect(mocks.stripe.subscriptions.create).toHaveBeenCalledOnce();
    // The authoritative read is a side-effect-free provider GET that now runs
    // before the lock, so contention cannot make it repeat per attempt.
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("does not repeat finalization after downstream Linq contention", async () => {
    const code = "HOSTED_LINQ_HOME_ROUTE_CHANGED";
    const prisma = makePrisma();
    mocks.activateHostedMemberForPositiveSourceTx.mockRejectedValueOnce(
      hostedOnboardingError({
        code,
        httpStatus: 503,
        message: "Murph is still finishing your setup. Try again.",
        retryable: true,
      }),
    );

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code,
      retryable: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledOnce();
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledOnce();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("fails retryably without local activation when the bounded authority read times out", async () => {
    const prisma = makePrisma();
    mocks.stripe.subscriptions.retrieve.mockRejectedValueOnce(
      new Error("Stripe authority read timed out"),
    );

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_STRIPE_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledWith(
      "sub_auto_trial_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    // Only the reservation transaction ran: a failed authority read now costs no
    // finalization transaction, because it happens before the lock is taken.
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an invalid request",
      {
        statusCode: 400,
        type: "StripeInvalidRequestError",
      },
    ],
    [
      "an authentication rejection",
      {
        type: "StripeAuthenticationError",
      },
    ],
    [
      "a permission rejection",
      {
        rawType: "permission_error",
      },
    ],
    [
      "an explicit do-not-retry directive",
      {
        headers: {
          "Stripe-Should-Retry": "false",
        },
        statusCode: 500,
      },
    ],
  ])("fails non-retryably for definitive Stripe authority failure: %s", async (
    _label,
    stripeError,
  ) => {
    const prisma = makePrisma();
    mocks.stripe.subscriptions.retrieve.mockRejectedValueOnce(stripeError);

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_STRIPE_REJECTED",
      httpStatus: 502,
      message: "Murph could not confirm this trial. Contact support.",
      retryable: false,
    });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a rate limit",
      {
        statusCode: 429,
        type: "StripeRateLimitError",
      },
    ],
    [
      "a provider failure",
      {
        statusCode: 503,
        type: "StripeAPIError",
      },
    ],
    [
      "an explicit retry directive",
      {
        headers: {
          "Stripe-Should-Retry": "true",
        },
        statusCode: 400,
        type: "StripeInvalidRequestError",
      },
    ],
  ])("keeps transient Stripe authority failure retryable: %s", async (
    _label,
    stripeError,
  ) => {
    const prisma = makePrisma();
    mocks.stripe.subscriptions.retrieve.mockRejectedValueOnce(stripeError);

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_STRIPE_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("uses stable subscription idempotency keys for the reserved customer and current policy", () => {
    expect(
      buildHostedAutoPulseTrialSubscriptionIdempotencyKey({
        memberId: "member_123",
        policyVersion: "pulse-trial-2026-07-15-v3",
        priceId: "price_pulse_monthly_123",
        recoveryScope: "initial",
        stripeCustomerId: "cus_auto_trial_123",
      }),
    ).toBe(
      buildHostedAutoPulseTrialSubscriptionIdempotencyKey({
        memberId: "member_123",
        policyVersion: "pulse-trial-2026-07-15-v3",
        priceId: "price_pulse_monthly_123",
        recoveryScope: "initial",
        stripeCustomerId: "cus_auto_trial_123",
      }),
    );
  });

  it("reuses a matching trialing Stripe subscription before creating another one", async () => {
    const recoveredSubscriptionMetadata = makeTrialSubscriptionMetadata({
      trialDurationDays: "10",
      trialPolicyVersion: "pulse-trial-2026-06-30-v2",
    });
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [
        makeTrialSubscription({
          created: 1_781_438_500,
          id: "sub_recovered_trial_123",
          metadata: recoveredSubscriptionMetadata,
          trialEnd: 1_782_302_400,
        }),
      ],
    });
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(
      makeTrialSubscription({
        id: "sub_recovered_trial_123",
        metadata: recoveredSubscriptionMetadata,
        trialEnd: 1_782_302_400,
      }),
    );

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "enrolled",
    });

    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPeriodEnd: new Date("2026-06-24T12:00:00.000Z"),
        currentTrialEndsAt: new Date("2026-06-24T12:00:00.000Z"),
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        stripeCustomerId: "cus_auto_trial_123",
        stripeSubscriptionId: "sub_recovered_trial_123",
      }),
    );
  });

  it("campaign owner inspects and finalizes a provider-only trial", async () => {
    const providerOnlyBillingRef = {
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      currentCheckoutOffer: null,
      currentPeriodEnd: null,
      currentPeriodStart: null,
      currentTrialEndsAt: null,
      currentTrialStartedAt: null,
      lastStripeEventCreatedAt: null,
      memberId: "member_123",
      pulseTrialPolicyVersion: null,
      pulseTrialRedeemedAt: null,
      stripeCustomerId: "cus_auto_trial_123",
      stripeSubscriptionId: null,
    };
    const currentMember = makeBillingSnapshot({ billingRef: providerOnlyBillingRef });
    const providerSubscription = makeTrialSubscription({
      current_period_end: 1_784_467_200,
      trial_end: 1_784_467_200,
    });
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [providerSubscription],
      has_more: false,
    });
    const disposition = await inspectHostedAutoPulseTrialCampaignDisposition({
      candidate: {
        billingStatus: HostedBillingStatus.not_started,
        currentBillingPhase: null,
        currentStripeSubscriptionId: null,
        memberId: "member_123",
        pulseTrialRedeemedAt: null,
      },
      priceId: "price_pulse_monthly_123",
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_auto_trial_123",
      trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(disposition.kind).toBe("recoverable");
    if (disposition.kind !== "recoverable") {
      throw new Error("Expected a recoverable campaign disposition.");
    }
    await expect(applyHostedAutoPulseTrialCampaignDispositionTx({
      campaignPolicy: {
        minimumTrialRunwaySeconds: 81,
        priceId: "price_pulse_monthly_123",
        trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
      },
      currentMember,
      disposition,
      now: new Date("2026-07-12T12:00:00.000Z"),
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_auto_trial_123",
      tx: { tx: true } as never,
    })).resolves.toMatchObject({ kind: "recovered" });

    expect(mocks.stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: "cus_auto_trial_123",
      limit: 100,
      status: "all",
    }, {
      maxNetworkRetries: 0,
      timeout: 80_000,
    });
    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
        stripeSubscriptionId: "sub_auto_trial_123",
      }),
    );
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalled();
  });

  it("campaign owner rejects an expired payload that still says trialing", async () => {
    await expect(applyHostedAutoPulseTrialCampaignDispositionTx({
      campaignPolicy: {
        minimumTrialRunwaySeconds: 81,
        priceId: "price_pulse_monthly_123",
        trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
      },
      currentMember: makeBillingSnapshot({
        billingRef: {
          ...makePulseTrialBillingRef(),
          currentBillingPhase: null,
          currentBillingPlanCode: null,
          currentCheckoutOffer: null,
          currentPeriodEnd: null,
          currentPeriodStart: null,
          currentTrialEndsAt: null,
          currentTrialStartedAt: null,
          pulseTrialPolicyVersion: null,
          pulseTrialRedeemedAt: null,
          stripeSubscriptionId: null,
        },
        billingStatus: HostedBillingStatus.not_started,
      }),
      disposition: {
        kind: "recoverable",
        subscription: makeTrialSubscription() as never,
      },
      now: new Date("2026-07-12T12:00:00.000Z"),
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_auto_trial_123",
      tx: { tx: true } as never,
    })).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
    });

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("campaign owner never cancels a provider trial when the durable customer owner conflicts", async () => {
    await expect(applyHostedAutoPulseTrialCampaignDispositionTx({
      campaignPolicy: {
        minimumTrialRunwaySeconds: 81,
        priceId: "price_pulse_monthly_123",
        trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
      },
      currentMember: makeBillingSnapshot({
        billingRef: {
          ...makePulseTrialBillingRef(),
          currentBillingPhase: null,
          currentBillingPlanCode: null,
          currentCheckoutOffer: null,
          currentPeriodEnd: null,
          currentPeriodStart: null,
          currentTrialEndsAt: null,
          currentTrialStartedAt: null,
          pulseTrialPolicyVersion: null,
          pulseTrialRedeemedAt: null,
          stripeCustomerId: "cus_durable_owner",
          stripeSubscriptionId: null,
        },
        billingStatus: HostedBillingStatus.not_started,
      }),
      disposition: {
        kind: "recoverable",
        subscription: makeTrialSubscription() as never,
      },
      now: new Date("2026-07-12T12:00:00.000Z"),
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_auto_trial_123",
      tx: { tx: true } as never,
    })).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("campaign post-commit effects cannot escape or start email outside the wake budget", async () => {
    mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult.mockRejectedValueOnce(
      new Error("wake unavailable"),
    );

    await expect(runHostedAutoPulseTrialCampaignPostCommitEffects({
      effects: {
        activatedMemberId: "member_123",
        hostedExecutionEventId: "evt_activation_123",
        welcomeEmailMemberId: "member_123",
      },
      prisma: makePrisma() as never,
      timeoutMs: 5_000,
    })).resolves.toBeUndefined();

    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "auto-pulse-trial.campaign-activation",
        timeoutMs: 5_000,
      }),
    );
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("campaign cleanup uses one final provider read and one cancel without replacing paid billing", async () => {
    const currentMember = makeBillingSnapshot({
      billingRef: {
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "standard",
        currentPeriodEnd: null,
        currentPeriodStart: null,
        currentTrialEndsAt: null,
        currentTrialStartedAt: null,
        lastStripeEventCreatedAt: null,
        memberId: "member_123",
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        stripeCustomerId: "cus_auto_trial_123",
        stripeSubscriptionId: "sub_paid_123",
      },
      billingStatus: HostedBillingStatus.active,
    });
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [makeTrialSubscription()],
      has_more: false,
    });

    const disposition = await inspectHostedAutoPulseTrialCampaignDisposition({
      candidate: {
        billingStatus: HostedBillingStatus.active,
        currentBillingPhase: "paid",
        currentStripeSubscriptionId: "sub_paid_123",
        memberId: "member_123",
        pulseTrialRedeemedAt: null,
      },
      priceId: "price_pulse_monthly_123",
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_auto_trial_123",
      trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(disposition.kind).toBe("cleanup-obsolete");
    if (disposition.kind !== "cleanup-obsolete") {
      throw new Error("Expected an obsolete-provider cleanup disposition.");
    }
    await expect(applyHostedAutoPulseTrialCampaignDispositionTx({
      campaignPolicy: {
        minimumTrialRunwaySeconds: 81,
        priceId: "price_pulse_monthly_123",
        trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
      },
      currentMember,
      disposition,
      now: new Date("2026-07-12T12:00:00.000Z"),
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_auto_trial_123",
      tx: { tx: true } as never,
    })).resolves.toMatchObject({ kind: "cleaned-up" });

    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_auto_trial_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
    );
    expect(mocks.stripe.subscriptions.list).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("campaign cleanup refuses to cancel the current durable subscription", async () => {
    const currentMember = makeBillingSnapshot({
      billingRef: {
        ...makePulseTrialBillingRef(),
        currentBillingPhase: "paid",
        currentCheckoutOffer: "standard",
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        stripeCustomerId: "cus_auto_trial_123",
        stripeSubscriptionId: "sub_auto_trial_123",
      },
      billingStatus: HostedBillingStatus.active,
    });

    await expect(applyHostedAutoPulseTrialCampaignDispositionTx({
      campaignPolicy: {
        minimumTrialRunwaySeconds: 81,
        priceId: "price_pulse_monthly_123",
        trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
      },
      currentMember,
      disposition: {
        kind: "cleanup-obsolete",
        subscription: makeTrialSubscription() as never,
      },
      now: new Date("2026-07-12T12:00:00.000Z"),
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_auto_trial_123",
      tx: { tx: true } as never,
    })).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("campaign inspection rejects provider item drift before cleanup disposition", async () => {
    const changedSubscription = makeTrialSubscription();
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [{
        ...changedSubscription,
        items: {
          data: changedSubscription.items.data.map((item) => ({
            ...item,
            quantity: 2,
          })),
          has_more: false,
        },
      }],
      has_more: false,
    });

    await expect(inspectHostedAutoPulseTrialCampaignDisposition({
      candidate: {
        billingStatus: HostedBillingStatus.active,
        currentBillingPhase: "paid",
        currentStripeSubscriptionId: "sub_paid_123",
        memberId: "member_123",
        pulseTrialRedeemedAt: null,
      },
      priceId: "price_pulse_monthly_123",
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_auto_trial_123",
      trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
    })).resolves.toEqual({
      kind: "not-applicable",
      reason: "provider-trial-not-found",
      subscription: null,
    });

    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("campaign inspection rejects a subscription outside the expected provider customer", async () => {
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [makeTrialSubscription({ customer: "cus_other" })],
      has_more: false,
    });

    await expect(inspectHostedAutoPulseTrialCampaignDisposition({
      candidate: {
        billingStatus: HostedBillingStatus.active,
        currentBillingPhase: "paid",
        currentStripeSubscriptionId: "sub_paid_123",
        memberId: "member_123",
        pulseTrialRedeemedAt: null,
      },
      priceId: "price_pulse_monthly_123",
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_auto_trial_123",
      trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
    })).resolves.toEqual({
      kind: "not-applicable",
      reason: "provider-trial-not-found",
      subscription: null,
    });

    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("classifies a provider trial as cleanup when active non-trial access has no Stripe subscription", async () => {
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [makeTrialSubscription({ customer: "cus_provider_owner" })],
      has_more: false,
    });

    await expect(inspectHostedAutoPulseTrialCampaignDisposition({
      candidate: {
        billingStatus: HostedBillingStatus.active,
        currentBillingPhase: null,
        currentStripeSubscriptionId: null,
        memberId: "member_123",
        pulseTrialRedeemedAt: null,
      },
      priceId: "price_pulse_monthly_123",
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_provider_owner",
      trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
    })).resolves.toMatchObject({
      kind: "cleanup-obsolete",
    });

    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("campaign owner fails closed instead of scanning beyond one provider page", async () => {
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [makeTrialSubscription()],
      has_more: true,
      object: "list",
      url: "/v1/subscriptions",
    });

    await expect(inspectHostedAutoPulseTrialCampaignDisposition({
      candidate: {
        billingStatus: HostedBillingStatus.not_started,
        currentBillingPhase: null,
        currentStripeSubscriptionId: null,
        memberId: "member_123",
        pulseTrialRedeemedAt: null,
      },
      priceId: "price_pulse_monthly_123",
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_auto_trial_123",
      trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_LOOKUP_INCOMPLETE",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.stripe.subscriptions.list).toHaveBeenCalledTimes(1);
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("campaign owner treats a paused pre-cutoff provider trial as ended", async () => {
    const pausedSubscription = makeTrialSubscription({
      id: "sub_paused_trial_123",
      status: "paused",
    });
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [pausedSubscription],
      has_more: false,
    });

    await expect(inspectHostedAutoPulseTrialCampaignDisposition({
      candidate: {
        billingStatus: HostedBillingStatus.not_started,
        currentBillingPhase: null,
        currentStripeSubscriptionId: null,
        memberId: "member_123",
        pulseTrialRedeemedAt: null,
      },
      priceId: "price_pulse_monthly_123",
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_auto_trial_123",
      trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
    })).resolves.toEqual({
      kind: "not-applicable",
      reason: "provider-trial-ended",
      subscription: pausedSubscription,
    });

    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("campaign owner leaves the member's current paid form of the trial subscription alone", async () => {
    const paidSubscription = makeTrialSubscription({
      status: "active",
      trial_end: null,
    });
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [paidSubscription],
      has_more: false,
    });

    await expect(inspectHostedAutoPulseTrialCampaignDisposition({
      candidate: {
        billingStatus: HostedBillingStatus.active,
        currentBillingPhase: "trial",
        currentStripeSubscriptionId: "sub_auto_trial_123",
        memberId: "member_123",
        pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
      },
      priceId: "price_pulse_monthly_123",
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_auto_trial_123",
      trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
    })).resolves.toEqual({
      kind: "not-applicable",
      reason: "provider-trial-ended",
      subscription: paidSubscription,
    });

    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("campaign owner excludes a provider trial that started at the cutoff", async () => {
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [makeTrialSubscription({ trial_start: 1_783_641_600 })],
      has_more: false,
    });

    await expect(inspectHostedAutoPulseTrialCampaignDisposition({
      candidate: {
        billingStatus: HostedBillingStatus.not_started,
        currentBillingPhase: null,
        currentStripeSubscriptionId: null,
        memberId: "member_123",
        pulseTrialRedeemedAt: null,
      },
      priceId: "price_pulse_monthly_123",
      requestOptions: {
        maxNetworkRetries: 0,
        timeout: 80_000,
      },
      stripe: mocks.stripe as never,
      stripeCustomerId: "cus_auto_trial_123",
      trialStartedBefore: new Date("2026-07-10T00:00:00.000Z"),
    })).resolves.toEqual({
      kind: "not-applicable",
      reason: "provider-trial-not-found",
      subscription: null,
    });
  });

  it("blocks retry recovery when an existing matching subscription is no longer trialing", async () => {
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [
        makeTrialSubscription({
          id: "sub_paused_trial_123",
          status: "paused",
        }),
      ],
    });

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
      retryable: false,
    });

    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("blocks retry recovery when a live matching trial has stale policy metadata", async () => {
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [
        makeTrialSubscription({
          metadata: makeTrialSubscriptionMetadata({
            trialPolicyVersion: "pulse-trial-old",
          }),
        }),
      ],
    });

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("blocks retry recovery when a live matching trial has a different Stripe price", async () => {
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [
        makeTrialSubscription({
          itemPriceId: "price_old_pulse_monthly",
        }),
      ],
    });

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("blocks retry recovery when multiple live matching trials exist", async () => {
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [
        makeTrialSubscription({
          id: "sub_live_trial_1",
        }),
        makeTrialSubscription({
          id: "sub_live_trial_2",
        }),
      ],
    });

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_REQUIRED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("creates a fresh trial when retry recovery only finds terminal cleanup artifacts", async () => {
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [
        makeTrialSubscription({
          id: "sub_canceled_trial_123",
          status: "canceled",
        }),
        makeTrialSubscription({
          created: 1_781_438_500,
          id: "sub_expired_trial_123",
          status: "incomplete_expired",
        }),
      ],
    });

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "enrolled",
    });

    expect(mocks.stripe.subscriptions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.create).toHaveBeenCalledWith(
      expect.anything(),
      {
        idempotencyKey: buildHostedAutoPulseTrialSubscriptionIdempotencyKey({
          memberId: "member_123",
          policyVersion: "pulse-trial-2026-07-15-v3",
          priceId: "price_pulse_monthly_123",
          recoveryScope: "after-terminal:sub_expired_trial_123:incomplete_expired:1781438500",
          stripeCustomerId: "cus_auto_trial_123",
        }),
      },
    );
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: "sub_auto_trial_123",
      }),
    );
  });

  it("paginates retry recovery before reusing an existing matching trial", async () => {
    mocks.stripe.subscriptions.list
      .mockResolvedValueOnce({
        data: [
          makeTrialSubscription({
            id: "sub_canceled_trial_123",
            status: "canceled",
          }),
        ],
        has_more: true,
        object: "list",
        url: "/v1/subscriptions",
      })
      .mockResolvedValueOnce({
        data: [
          makeTrialSubscription({
            id: "sub_recovered_second_page_123",
          }),
        ],
        has_more: false,
        object: "list",
        url: "/v1/subscriptions",
      });

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "enrolled",
    });

    expect(mocks.stripe.subscriptions.list).toHaveBeenNthCalledWith(1, {
      customer: "cus_auto_trial_123",
      limit: 100,
      status: "all",
    });
    expect(mocks.stripe.subscriptions.list).toHaveBeenNthCalledWith(2, {
      customer: "cus_auto_trial_123",
      limit: 100,
      starting_after: "sub_canceled_trial_123",
      status: "all",
    });
    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: "sub_recovered_second_page_123",
      }),
    );
  });

  it("fails retryably without creating a subscription when Stripe recovery lookup fails", async () => {
    mocks.stripe.subscriptions.list.mockRejectedValueOnce(new Error("Stripe unavailable"));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_RECOVERY_LOOKUP_FAILED",
      httpStatus: 502,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("does not call Stripe when the hosted member is already active", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(makeBillingSnapshot({
      billingStatus: HostedBillingStatus.active,
    }));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "already_active",
    });

    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("returns already_enrolled after checking for exact provider losers", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(makeBillingSnapshot({
      billingRef: makePulseTrialBillingRef(),
      billingStatus: HostedBillingStatus.active,
    }));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "already_enrolled",
    });

    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: "cus_existing_123",
      limit: 100,
      status: "all",
    }, {
      maxNetworkRetries: 0,
      timeout: 5_000,
    });
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("maps a busy cleanup member lock to the bounded finalization error", async () => {
    const prisma = makePrisma();
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(
      makeBillingSnapshot({
        billingRef: makePulseTrialBillingRef(),
        billingStatus: HostedBillingStatus.active,
      }),
    );
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [
        makeTrialSubscription({ id: "sub_losing_trial_123" }),
        makeTrialSubscription({ id: "sub_existing_trial_123" }),
      ],
      has_more: false,
    });
    mocks.lockHostedMemberRow.mockRejectedValueOnce(
      makeMemberLockTimeoutError(),
    );

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_FINALIZATION_BUSY",
      httpStatus: 503,
      retryable: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        maxWait: 5_000,
        timeout: 120_000,
      },
    );
    expect(mocks.stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: "cus_existing_123",
      limit: 100,
      status: "all",
    }, {
      maxNetworkRetries: 0,
      timeout: 5_000,
    });
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("rediscovers and retries an exact loser for active non-trial access without a subscription", async () => {
    const activeAppReviewMember = makeBillingSnapshot({
      billingRef: {
        ...makePulseTrialBillingRef(),
        currentBillingPhase: null,
        currentCheckoutOffer: null,
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        stripeSubscriptionId: null,
      },
      billingStatus: HostedBillingStatus.active,
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(activeAppReviewMember);
    mocks.stripe.subscriptions.list.mockResolvedValue({
      data: [makeTrialSubscription({ id: "sub_losing_trial_123" })],
      has_more: false,
    });
    mocks.stripe.subscriptions.cancel
      .mockRejectedValueOnce(new Error("transient Stripe failure"))
      .mockResolvedValueOnce({
        id: "sub_losing_trial_123",
        object: "subscription",
        status: "canceled",
      });

    const enroll = () => ensureHostedAutoPulseTrialEnrollment({
      inviteCode: "invite-code",
      member: { id: "member_123", suspendedAt: null },
      prisma: makePrisma() as never,
    });

    await expect(enroll()).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_CLEANUP_FAILED",
      retryable: true,
    });
    await expect(enroll()).resolves.toMatchObject({ status: "already_active" });
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
  });

  it("retries provider-derived loser cleanup without replacing the durable trial", async () => {
    const prisma = makePrisma();
    const durableSubscription = makeTrialSubscription({
      customer: "cus_existing_123",
      id: "sub_existing_trial_123",
    });
    const loserSubscription = makeTrialSubscription({
      customer: "cus_existing_123",
      id: "sub_losing_trial_123",
    });
    const unrelatedSubscription = makeTrialSubscription({
      customer: "cus_existing_123",
      id: "sub_unrelated_123",
      metadata: makeTrialSubscriptionMetadata({ memberId: "member_other" }),
    });
    const currentMember = makeBillingSnapshot({
      billingRef: makePulseTrialBillingRef(),
      billingStatus: HostedBillingStatus.active,
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(currentMember);
    mocks.stripe.subscriptions.list.mockResolvedValue({
      data: [loserSubscription, unrelatedSubscription, durableSubscription],
      has_more: false,
    });
    mocks.stripe.subscriptions.cancel
      .mockRejectedValueOnce(new Error("transient Stripe failure"))
      .mockResolvedValueOnce({
        id: "sub_losing_trial_123",
        object: "subscription",
        status: "canceled",
      });

    const enroll = () => ensureHostedAutoPulseTrialEnrollment({
      inviteCode: "invite-code",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      now: new Date("2026-06-14T12:00:05.000Z"),
      prisma: prisma as never,
    });

    await expect(enroll()).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_CLEANUP_FAILED",
      httpStatus: 502,
      retryable: true,
    });
    await expect(enroll()).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "already_enrolled",
    });

    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      {
        maxWait: 5_000,
        timeout: 120_000,
      },
    );
    expect(prisma.$transaction).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      {
        maxWait: 5_000,
        timeout: 120_000,
      },
    );
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenNthCalledWith(
      1,
      "sub_losing_trial_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenNthCalledWith(
      2,
      "sub_losing_trial_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenNthCalledWith(
      1,
      "sub_losing_trial_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenNthCalledWith(
      2,
      "sub_losing_trial_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
  });

  it("refuses auto-trial loser cleanup when that subscription becomes current", async () => {
    const durableMember = makeBillingSnapshot({
      billingRef: makePulseTrialBillingRef(),
      billingStatus: HostedBillingStatus.active,
    });
    const changedMember = makeBillingSnapshot({
      billingRef: makePulseTrialBillingRef({
        stripeSubscriptionId: "sub_losing_trial_123",
      }),
      billingStatus: HostedBillingStatus.active,
    });
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(durableMember)
      .mockResolvedValueOnce(changedMember);
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [
        makeTrialSubscription({ id: "sub_losing_trial_123" }),
        makeTrialSubscription({ id: "sub_existing_trial_123" }),
      ],
      has_more: false,
    });

    await expect(ensureHostedAutoPulseTrialEnrollment({
      inviteCode: "invite-code",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      now: new Date("2026-06-14T12:00:05.000Z"),
      prisma: makePrisma() as never,
    })).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_CLEANUP_OWNER_CHANGED",
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
  });

  it("rediscovers an auto-trial loser after paid billing wins and immediate cleanup fails", async () => {
    const paidWinner = makeBillingSnapshot({
      billingRef: {
        currentBillingPhase: "paid",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "standard",
        currentPeriodEnd: new Date("2026-07-14T12:00:00.000Z"),
        currentPeriodStart: new Date("2026-06-14T12:00:00.000Z"),
        currentTrialEndsAt: null,
        currentTrialStartedAt: null,
        lastStripeEventCreatedAt: new Date("2026-06-14T12:00:04.000Z"),
        memberId: "member_123",
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        stripeCustomerId: "cus_auto_trial_123",
        stripeSubscriptionId: "sub_paid_123",
      },
      billingStatus: HostedBillingStatus.active,
    });
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeBillingSnapshot())
      .mockResolvedValueOnce(makeBillingSnapshot())
      .mockResolvedValue(paidWinner);
    mocks.stripe.subscriptions.list
      .mockResolvedValueOnce({ data: [], has_more: false })
      .mockResolvedValueOnce({
        data: [
          makeTrialSubscription({ id: "sub_auto_trial_123" }),
          makeTrialSubscription({
            id: "sub_paid_123",
            metadata: makeTrialSubscriptionMetadata({ checkoutOffer: "standard" }),
            status: "active",
            trial_end: null,
          }),
        ],
        has_more: false,
      });
    mocks.stripe.subscriptions.cancel
      .mockRejectedValueOnce(new Error("transient Stripe failure"))
      .mockResolvedValueOnce({
        id: "sub_auto_trial_123",
        object: "subscription",
        status: "canceled",
      });

    const enroll = () => ensureHostedAutoPulseTrialEnrollment({
      inviteCode: "invite-code",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      now: new Date("2026-06-14T12:00:05.000Z"),
      prisma: makePrisma() as never,
    });

    await expect(enroll()).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_CLEANUP_FAILED",
      retryable: true,
    });
    await expect(enroll()).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "already_active",
    });

    expect(mocks.stripe.subscriptions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenNthCalledWith(
      1,
      "sub_auto_trial_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenNthCalledWith(
      2,
      "sub_auto_trial_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("treats an already-absent auto-trial loser as terminal cleanup", async () => {
    const currentMember = makeBillingSnapshot({
      billingRef: makePulseTrialBillingRef(),
      billingStatus: HostedBillingStatus.active,
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(currentMember);
    mocks.stripe.subscriptions.list.mockResolvedValueOnce({
      data: [
        makeTrialSubscription({ id: "sub_losing_trial_123" }),
        makeTrialSubscription({ id: "sub_existing_trial_123" }),
      ],
      has_more: false,
    });
    mocks.stripe.subscriptions.cancel.mockRejectedValueOnce({
      code: "resource_missing",
    });

    await expect(ensureHostedAutoPulseTrialEnrollment({
      inviteCode: "invite-code",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      now: new Date("2026-06-14T12:00:05.000Z"),
      prisma: makePrisma() as never,
    })).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "already_enrolled",
    });

    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_losing_trial_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
  });

  it("accepts an ambiguous cleanup when a fresh provider list no longer has the loser", async () => {
    const currentMember = makeBillingSnapshot({
      billingRef: makePulseTrialBillingRef(),
      billingStatus: HostedBillingStatus.active,
    });
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(currentMember);
    mocks.stripe.subscriptions.list
      .mockResolvedValueOnce({
        data: [
          makeTrialSubscription({ id: "sub_losing_trial_123" }),
          makeTrialSubscription({ id: "sub_existing_trial_123" }),
        ],
        has_more: false,
      })
      .mockResolvedValueOnce({
        data: [makeTrialSubscription({ id: "sub_existing_trial_123" })],
        has_more: false,
      });
    mocks.stripe.subscriptions.cancel.mockRejectedValueOnce(
      new Error("connection closed after Stripe accepted cancellation"),
    );

    const enroll = () => ensureHostedAutoPulseTrialEnrollment({
      inviteCode: "invite-code",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      now: new Date("2026-06-14T12:00:05.000Z"),
      prisma: makePrisma() as never,
    });

    await expect(enroll()).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_CLEANUP_FAILED",
      retryable: true,
    });
    await expect(enroll()).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "already_enrolled",
    });

    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_losing_trial_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
  });

  it("does not create a subscription when the locked transaction re-read sees another existing Pulse Trial", async () => {
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeBillingSnapshot())
      .mockResolvedValueOnce(makeBillingSnapshot({
        billingRef: makePulseTrialBillingRef(),
        billingStatus: HostedBillingStatus.active,
      }))
      .mockResolvedValueOnce(makeBillingSnapshot({
        billingRef: makePulseTrialBillingRef(),
        billingStatus: HostedBillingStatus.active,
      }));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "already_enrolled",
    });

    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.list).toHaveBeenCalledOnce();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("returns already_enrolled when the locked transaction re-read is already bound to the trial", async () => {
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeBillingSnapshot())
      .mockResolvedValueOnce(makeBillingSnapshot({
        billingRef: makePulseTrialBillingRef({
          stripeSubscriptionId: "sub_auto_trial_123",
        }),
        billingStatus: HostedBillingStatus.active,
      }))
      .mockResolvedValueOnce(makeBillingSnapshot({
        billingRef: makePulseTrialBillingRef({
          stripeSubscriptionId: "sub_auto_trial_123",
        }),
        billingStatus: HostedBillingStatus.active,
      }));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "already_enrolled",
    });

    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.list).toHaveBeenCalledOnce();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("leaves the stable created trial available for retry when the billing write is skipped", async () => {
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValueOnce(null);

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_WRITE_SKIPPED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("cancels the created trial after the transaction commits when the locked re-read sees paid billing", async () => {
    const prisma = makePrisma();
    mocks.stripe.subscriptions.cancel.mockImplementationOnce(async () => {
      expect(prisma.isTransactionActive()).toBe(false);
      return {
        id: "sub_auto_trial_123",
        object: "subscription",
        status: "canceled",
      };
    });
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeBillingSnapshot())
      .mockResolvedValueOnce(makeBillingSnapshot())
      .mockResolvedValueOnce(makeBillingSnapshot({
        billingRef: {
          currentBillingPhase: "paid",
          currentBillingPlanCode: "launch_monthly",
          currentCheckoutOffer: "standard_checkout",
          currentPeriodEnd: new Date("2026-07-14T12:00:00.000Z"),
          currentPeriodStart: new Date("2026-06-14T12:00:00.000Z"),
          currentTrialEndsAt: null,
          currentTrialStartedAt: null,
          lastStripeEventCreatedAt: new Date("2026-06-14T12:00:04.000Z"),
          memberId: "member_123",
          pulseTrialPolicyVersion: null,
          pulseTrialRedeemedAt: null,
          stripeCustomerId: "cus_paid_123",
          stripeSubscriptionId: "sub_paid_123",
        },
        billingStatus: HostedBillingStatus.active,
      }));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "already_active",
    });

    expect(mocks.stripe.subscriptions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_auto_trial_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("never cancels the losing trial that became current after the finalization transaction committed", async () => {
    const prisma = makePrisma();
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeBillingSnapshot())
      .mockResolvedValueOnce(makeBillingSnapshot())
      .mockResolvedValueOnce(makeBillingSnapshot({
        billingRef: makePulseTrialBillingRef({
          stripeCustomerId: "cus_auto_trial_123",
          stripeSubscriptionId: "sub_other_trial_123",
        }),
        billingStatus: HostedBillingStatus.active,
      }))
      // Another serialized billing flow bound this attempt's loser as the
      // member's current subscription once the finalization lock was released.
      .mockResolvedValue(makeBillingSnapshot({
        billingRef: makePulseTrialBillingRef({
          stripeCustomerId: "cus_auto_trial_123",
          stripeSubscriptionId: "sub_auto_trial_123",
        }),
        billingStatus: HostedBillingStatus.active,
      }));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_CLEANUP_OWNER_CHANGED",
      httpStatus: 409,
      retryable: true,
    });

    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledTimes(4);
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledTimes(3);
    expect(prisma.$transaction).toHaveBeenNthCalledWith(
      3,
      expect.any(Function),
      {
        maxWait: 5_000,
        timeout: 30_000,
      },
    );
  });

  it("cancels the unreferenced trial and still reports the block when the locked re-read makes the member ineligible", async () => {
    const prisma = makePrisma();
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeBillingSnapshot())
      .mockResolvedValueOnce(makeBillingSnapshot())
      // Billing lapsed between the reservation and the finalization lock, so
      // enrollment fails on the member's own state. Nothing references the
      // trial this attempt created, and no sweep will ever see it, so the
      // ownership recheck must still allow the cancel.
      .mockResolvedValue(makeBillingSnapshot({
        billingStatus: HostedBillingStatus.past_due,
      }));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_AUTO_PULSE_TRIAL_BLOCKED",
      httpStatus: 403,
    });

    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_auto_trial_123",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledTimes(3);
    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledTimes(4);
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("does not cancel the resolved trial when the final locked re-read is already bound to it", async () => {
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeBillingSnapshot())
      .mockResolvedValueOnce(makeBillingSnapshot())
      .mockResolvedValueOnce(makeBillingSnapshot({
        billingRef: makePulseTrialBillingRef({
          stripeCustomerId: "cus_auto_trial_123",
          stripeSubscriptionId: "sub_auto_trial_123",
        }),
        billingStatus: HostedBillingStatus.active,
      }));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).resolves.toEqual({
      redirectPath: "/home?initialVisit=true",
      status: "already_enrolled",
    });

    expect(mocks.stripe.subscriptions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
  });

  it("uses an existing Stripe customer id when one is already bound", async () => {
    mocks.stripe.subscriptions.create.mockResolvedValueOnce(makeTrialSubscription({
      customer: "cus_existing_123",
    }));
    mocks.stripe.subscriptions.retrieve.mockResolvedValueOnce(makeTrialSubscription({
      customer: "cus_existing_123",
    }));
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeBillingSnapshot({
      billingRef: {
        currentBillingPhase: null,
        currentBillingPlanCode: null,
        currentCheckoutOffer: null,
        currentPeriodEnd: null,
        currentPeriodStart: null,
        currentTrialEndsAt: null,
        currentTrialStartedAt: null,
        lastStripeEventCreatedAt: null,
        memberId: "member_123",
        pulseTrialPolicyVersion: null,
        pulseTrialRedeemedAt: null,
        stripeCustomerId: "cus_existing_123",
        stripeSubscriptionId: null,
      },
    }));

    await ensureHostedAutoPulseTrialEnrollment({
      inviteCode: "invite-code",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      now: new Date("2026-06-14T12:00:05.000Z"),
      prisma: makePrisma() as never,
    });

    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_existing_123",
      }),
      expect.anything(),
    );
  });

  it.each([
    ["canceled", { status: "canceled" }],
    ["paused", { status: "paused" }],
    [
      "expired",
      {
        trial_end: Math.floor(
          new Date("2026-06-14T12:00:04.000Z").getTime() / 1000,
        ),
      },
    ],
  ])("rejects a provider trial that becomes %s before the locked activation write", async (
    _label,
    currentOverrides,
  ) => {
    const prisma = makePrisma();
    mocks.stripe.subscriptions.retrieve.mockImplementationOnce(async () => {
      expect(prisma.isTransactionActive()).toBe(false);
      return makeTrialSubscription(currentOverrides);
    });

    await expect(ensureHostedAutoPulseTrialEnrollment({
      inviteCode: "invite-code",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      now: new Date("2026-06-14T12:00:05.000Z"),
      prisma: prisma as never,
    })).rejects.toBeDefined();

    expect(mocks.stripe.subscriptions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("rejects a trial that expires while auto enrollment waits for locked authority", async () => {
    mocks.stripe.subscriptions.retrieve.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date("2026-06-29T00:00:00.000Z"));
      return makeTrialSubscription();
    });

    await expect(ensureHostedAutoPulseTrialEnrollment({
      inviteCode: "invite-code",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      now: new Date("2026-06-14T12:00:05.000Z"),
      prisma: makePrisma() as never,
    })).rejects.toBeDefined();

    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("rejects inactive members that already redeemed a Pulse Trial", async () => {
    mocks.readHostedMemberBillingSnapshot.mockResolvedValueOnce(makeBillingSnapshot({
      billingRef: {
        currentBillingPhase: null,
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentPeriodEnd: null,
        currentPeriodStart: null,
        currentTrialEndsAt: new Date("2026-06-21T12:00:00.000Z"),
        currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
        lastStripeEventCreatedAt: null,
        memberId: "member_123",
        pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
        pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
        stripeCustomerId: "cus_existing_123",
        stripeSubscriptionId: "sub_old_123",
      },
    }));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_ALREADY_REDEEMED",
      httpStatus: 409,
    });

    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
  });

  it("rejects invite/member mismatch before consent, Stripe, or billing writes", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValueOnce(makeInvite({
      member: {
        id: "member_other",
      },
    }));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "AUTH_INVITE_MISMATCH",
      httpStatus: 403,
    });

    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it.each([
    {
      authenticatedSuspendedAt: "2026-06-14T12:00:00.000Z",
      inviteSuspendedAt: null,
      name: "authenticated member",
    },
    {
      authenticatedSuspendedAt: null,
      inviteSuspendedAt: "2026-06-14T12:00:00.000Z",
      name: "invite member",
    },
  ])("rejects suspended $name before consent, Stripe, or billing writes", async ({
    authenticatedSuspendedAt,
    inviteSuspendedAt,
  }) => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValueOnce(makeInvite({
      member: {
        suspendedAt: inviteSuspendedAt ? new Date(inviteSuspendedAt) : null,
      },
    }));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: authenticatedSuspendedAt
            ? new Date(authenticatedSuspendedAt)
            : null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });

    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("rejects missing launch consent before Stripe or billing writes", async () => {
    mocks.assertHostedLaunchRequiredConsentGranted.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_CONSENT_REQUIRED",
        httpStatus: 403,
        message: "Accept the current Murph legal consent before continuing.",
      }),
    );

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
    });

    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberBillingSnapshot).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("rejects members without a messaging channel before Stripe or billing writes", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValueOnce(makeInvite({
      member: {
        identity: {
          phoneLookupKey: null,
        },
        routing: null,
      },
    }));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: null,
        },
        now: new Date("2026-06-14T12:00:05.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
      httpStatus: 409,
    });

    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.list).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberBillingSnapshot).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });
});

function makeInvite(overrides: {
  member?: {
    billingStatus?: HostedBillingStatus;
    id?: string;
    identity?: {
      phoneLookupKey: string | null;
    } | null;
    routing?: null;
    suspendedAt?: Date | null;
  };
  memberId?: string;
} = {}) {
  const member = {
    billingStatus: HostedBillingStatus.not_started,
    id: "member_123",
    identity: {
      phoneLookupKey: "phone_lookup_123",
    },
    routing: null,
    suspendedAt: null,
    ...overrides.member,
  };

  return {
    expiresAt: new Date("2026-06-21T12:00:00.000Z"),
    inviteCode: "invite-code",
    member,
    memberId: overrides.memberId ?? member.id,
  };
}

function makePulseTrialBillingRef(overrides: Record<string, unknown> = {}) {
  return {
    currentBillingPhase: "trial",
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: "pulse_trial_7d",
    currentPeriodEnd: new Date("2026-06-21T12:00:00.000Z"),
    currentPeriodStart: new Date("2026-06-14T12:00:00.000Z"),
    currentTrialEndsAt: new Date("2026-06-21T12:00:00.000Z"),
    currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
    lastStripeEventCreatedAt: null,
    memberId: "member_123",
    pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
    pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
    stripeCustomerId: "cus_existing_123",
    stripeSubscriptionId: "sub_existing_trial_123",
    ...overrides,
  };
}

function makeBillingSnapshot(overrides: {
  billingRef?: HostedMemberStripeBillingRefSnapshot | null;
  billingStatus?: HostedBillingStatus;
} = {}): HostedMemberBillingSnapshot {
  return {
    billingRef: overrides.billingRef ?? null,
    core: {
      billingStatus: overrides.billingStatus ?? HostedBillingStatus.not_started,
      createdAt: new Date("2026-06-14T11:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-06-14T11:00:00.000Z"),
    },
  };
}

function makeTrialSubscription(overrides: Record<string, unknown> & {
  itemPriceId?: string;
  metadata?: Record<string, string>;
  trialEnd?: number;
} = {}) {
  const {
    itemPriceId,
    metadata,
    trialEnd = 1_782_648_000,
    ...rest
  } = overrides;

  return {
    cancel_at: null,
    cancel_at_period_end: false,
    customer: "cus_auto_trial_123",
    created: 1_781_438_400,
    id: "sub_auto_trial_123",
    items: {
      data: [
        {
          current_period_end: trialEnd,
          current_period_start: 1_781_438_400,
          id: "si_auto_trial_123",
          price: {
            id: itemPriceId ?? "price_pulse_monthly_123",
            recurring: {
              interval: "month",
              interval_count: 1,
              usage_type: "licensed",
            },
          },
          quantity: 1,
        },
      ],
      has_more: false,
    },
    metadata: metadata ?? makeTrialSubscriptionMetadata(),
    object: "subscription",
    status: "trialing",
    trial_end: trialEnd,
    trial_start: 1_781_438_400,
    ...rest,
  };
}

function makeTrialSubscriptionMetadata(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    billingPlanCode: "launch_monthly",
    checkoutOffer: "pulse_trial_7d",
    memberId: "member_123",
    trialDurationDays: "14",
    trialPolicyVersion: "pulse-trial-2026-07-15-v3",
    trialUsageLimitUsdMicros: "4500000",
    ...overrides,
  };
}

function makePrisma() {
  let transactionActive = false;
  const tx = { tx: true };
  Object.defineProperty(tx, "$queryRaw", {
    enumerable: false,
    value: vi.fn().mockResolvedValue([]),
  });

  return {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionActive = true;
      try {
        return await callback(tx);
      } finally {
        transactionActive = false;
      }
    }),
    isTransactionActive: () => transactionActive,
  };
}

function makeMemberLockTimeoutError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "member lock timeout",
    {
      clientVersion: "test",
      code: "P2010",
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: "55P03",
          },
        },
      },
    },
  );
}

import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => {
  const stripe = {
    customers: {
      create: vi.fn(),
    },
    subscriptions: {
      create: vi.fn(),
    },
  };

  return {
    activateHostedMemberForPositiveSourceTx: vi.fn(),
    assertHostedLaunchRequiredConsentGranted: vi.fn(),
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
  buildHostedAutoPulseTrialCustomerIdempotencyKey,
  buildHostedAutoPulseTrialSubscriptionIdempotencyKey,
  ensureHostedAutoPulseTrialEnrollment,
} from "@/src/lib/hosted-onboarding/auto-trial-enrollment-service";

describe("ensureHostedAutoPulseTrialEnrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_AUTO_PULSE_TRIAL_ENABLED = "1";
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
    mocks.stripe.subscriptions.create.mockResolvedValue(makeTrialSubscription());
    mocks.readHostedMemberBillingSnapshot.mockResolvedValue(makeBillingSnapshot());
    mocks.writeHostedMemberStripeBillingTx.mockResolvedValue(makeBillingSnapshot({
      billingRef: {
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentPeriodEnd: new Date("2026-06-21T12:00:00.000Z"),
        currentPeriodStart: new Date("2026-06-14T12:00:00.000Z"),
        currentTrialEndsAt: new Date("2026-06-21T12:00:00.000Z"),
        currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
        lastStripeEventCreatedAt: new Date("2026-06-14T12:00:00.000Z"),
        memberId: "member_123",
        pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
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

  it("rejects enrollment when the auto trial rollout flag is disabled", async () => {
    delete process.env.HOSTED_AUTO_PULSE_TRIAL_ENABLED;

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
      redirectPath: "/home",
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
        trialDurationDays: "7",
        trialPolicyVersion: "pulse-trial-2026-05-05-v1",
        trialUsageLimitUsdMicros: "4500000",
      },
      trial_period_days: 7,
      trial_settings: {
        end_behavior: {
          missing_payment_method: "pause",
        },
      },
    }, {
      idempotencyKey: buildHostedAutoPulseTrialSubscriptionIdempotencyKey({
        memberId: "member_123",
        policyVersion: "pulse-trial-2026-05-05-v1",
      }),
    });
    expect(mocks.writeHostedMemberStripeBillingTx).toHaveBeenCalledWith(
      expect.objectContaining({
        billingStatus: HostedBillingStatus.active,
        canonicalBillingStatus: HostedBillingStatus.active,
        currentBillingPhase: "trial",
        currentBillingPlanCode: "launch_monthly",
        currentCheckoutOffer: "pulse_trial_7d",
        currentTrialEndsAt: new Date("2026-06-21T12:00:00.000Z"),
        currentTrialStartedAt: new Date("2026-06-14T12:00:00.000Z"),
        freshnessPolicy: "auto-pulse-trial-entitlement",
        pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
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
      redirectPath: "/home",
      status: "already_active",
    });

    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("returns already_enrolled without Stripe calls for an active Pulse Trial member", async () => {
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
      redirectPath: "/home",
      status: "already_enrolled",
    });

    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
  });

  it("returns already_enrolled when the transaction re-read sees an existing Pulse Trial", async () => {
    mocks.readHostedMemberBillingSnapshot
      .mockResolvedValueOnce(makeBillingSnapshot())
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
      redirectPath: "/home",
      status: "already_enrolled",
    });

    expect(mocks.stripe.subscriptions.create).toHaveBeenCalledOnce();
    expect(mocks.writeHostedMemberStripeBillingTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort).not.toHaveBeenCalled();
  });

  it("uses an existing Stripe customer id when one is already bound", async () => {
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
        pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
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
      authenticatedSuspendedAt: new Date("2026-06-14T12:00:00.000Z"),
      inviteSuspendedAt: null,
      name: "authenticated member",
    },
    {
      authenticatedSuspendedAt: null,
      inviteSuspendedAt: new Date("2026-06-14T12:00:00.000Z"),
      name: "invite member",
    },
  ])("rejects suspended $name before consent, Stripe, or billing writes", async ({
    authenticatedSuspendedAt,
    inviteSuspendedAt,
  }) => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValueOnce(makeInvite({
      member: {
        suspendedAt: inviteSuspendedAt,
      },
    }));

    await expect(
      ensureHostedAutoPulseTrialEnrollment({
        inviteCode: "invite-code",
        member: {
          id: "member_123",
          suspendedAt: authenticatedSuspendedAt,
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
});

function makeInvite(overrides: {
  member?: {
    billingStatus?: HostedBillingStatus;
    id?: string;
    identity?: null;
    routing?: null;
    suspendedAt?: Date | null;
  };
  memberId?: string;
} = {}) {
  const member = {
    billingStatus: HostedBillingStatus.not_started,
    id: "member_123",
    identity: null,
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

function makePulseTrialBillingRef() {
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
    pulseTrialPolicyVersion: "pulse-trial-2026-05-05-v1",
    pulseTrialRedeemedAt: new Date("2026-06-14T12:00:00.000Z"),
    stripeCustomerId: "cus_existing_123",
    stripeSubscriptionId: "sub_existing_trial_123",
  };
}

function makeBillingSnapshot(overrides: {
  billingRef?: Record<string, unknown> | null;
  billingStatus?: HostedBillingStatus;
} = {}) {
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

function makeTrialSubscription(overrides: Record<string, unknown> = {}) {
  return {
    customer: "cus_auto_trial_123",
    created: 1_781_438_400,
    id: "sub_auto_trial_123",
    items: {
      data: [
        {
          current_period_end: 1_782_043_200,
          current_period_start: 1_781_438_400,
        },
      ],
    },
    metadata: {
      checkoutOffer: "pulse_trial_7d",
      memberId: "member_123",
    },
    object: "subscription",
    status: "trialing",
    trial_end: 1_782_043_200,
    trial_start: 1_781_438_400,
    ...overrides,
  };
}

function makePrisma() {
  return {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({ tx: true })),
  };
}

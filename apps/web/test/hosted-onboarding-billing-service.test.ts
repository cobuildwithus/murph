import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const checkoutSessions = new Map<string, Record<string, unknown>>();
  const stripe = {
    checkout: {
      sessions: {
        create: vi.fn(),
        expire: vi.fn(),
        retrieve: vi.fn(),
      },
    },
    customers: {
      create: vi.fn(),
      del: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    readActiveHostedFamilySponsorship: vi.fn(),
    readHostedMemberFamilyBillingClaim: vi.fn(),
    applyStripeCheckoutCompleted: vi.fn(),
    cancelHostedPulseTrialCheckoutLoserSubscription: vi.fn(),
    executeHostedCheckoutSubscriptionCleanup: vi.fn(),
    requireHostedInviteForBillingCheckout: vi.fn(),
    requireHostedOnboardingPublicBaseUrl: vi.fn(),
    requireHostedStripeCheckoutConfig: vi.fn(),
    checkoutSessions,
    stripe,
    signalHostedMemberActivationRuntimeWakeBestEffortResult: vi.fn(),
    sendHostedSignupWelcomeEmailForMemberBestEffort: vi.fn(),
  };
});

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  readHostedMemberFamilyBillingClaim:
    mocks.readHostedMemberFamilyBillingClaim,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/member-access")
  >("@/src/lib/hosted-onboarding/member-access");

  return {
    ...actual,
    readActiveHostedFamilySponsorship: mocks.readActiveHostedFamilySponsorship,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-activation-runtime-wake", () => ({
  signalHostedMemberActivationRuntimeWakeBestEffortResult:
    mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult,
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

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    contactPrivacyKeyring: {
      currentVersion: "v1",
      keysByVersion: {
        v1: Buffer.alloc(32, 7),
      },
      readVersions: ["v1"],
    },
    inviteTtlHours: 24,
    isProduction: false,
    linqApiBaseUrl: "https://linq.example.test",
    linqApiToken: "linq-token",
    linqWebhookSecret: null,
    privyAppId: "cm_app_123",
    privyVerificationKey: "privy-key",
    publicBaseUrl: "https://join.example.test",
    stripePriceIdsByPlan: {
      launch_edge_monthly: "price_edge_monthly_123",
      launch_monthly: "price_monthly_123",
    },
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
    telegramBotUsername: null,
    telegramWebhookSecret: null,
  }),
  requireHostedOnboardingPublicBaseUrl: mocks.requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeCheckoutConfig: mocks.requireHostedStripeCheckoutConfig,
}));

vi.mock("@/src/lib/hosted-onboarding/signup-welcome-email", () => ({
  sendHostedSignupWelcomeEmailForMemberBestEffort:
    mocks.sendHostedSignupWelcomeEmailForMemberBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-events", () => ({
  applyStripeCheckoutCompleted: mocks.applyStripeCheckoutCompleted,
  cancelHostedPulseTrialCheckoutLoserSubscription:
    mocks.cancelHostedPulseTrialCheckoutLoserSubscription,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-checkout-subscription-cleanup", () => ({
  executeHostedCheckoutSubscriptionCleanup:
    mocks.executeHostedCheckoutSubscriptionCleanup,
}));

import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/billing-service";
import { HostedMemberStripeMutationLockBusyError } from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { buildHostedMemberBillingPrivateColumns } from "@/src/lib/hosted-onboarding/member-private-codecs";

type BillingServiceInvite = {
  expiresAt: Date;
  id: string;
  inviteCode: string;
  member: {
    billingStatus: HostedBillingStatus;
    id: string;
    identity: {
      phoneLookupKey: string | null;
    } | null;
    routing: null;
    suspendedAt: Date | null;
  };
  memberId: string;
};

describe("createHostedBillingCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkoutSessions.clear();
    vi.spyOn(console, "info").mockImplementation(() => {});
    delete process.env.HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED;
    mocks.readActiveHostedFamilySponsorship.mockResolvedValue(false);
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(null);
    mocks.applyStripeCheckoutCompleted.mockResolvedValue({
      activatedMemberId: null,
      hostedExecutionEventId: null,
      welcomeEmailMemberId: null,
    });
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.requireHostedStripeCheckoutConfig.mockReturnValue({
      billingPlanCode: "launch_monthly",
      priceId: "price_123",
      stripe: mocks.stripe,
    });
    let checkoutSessionSequence = 0;
    mocks.stripe.checkout.sessions.create.mockImplementation(
      async (params: Record<string, unknown>) => {
        checkoutSessionSequence += 1;
        const session = {
          client_reference_id: params.client_reference_id,
          id: `cs_${checkoutSessionSequence}`,
          metadata: params.metadata,
          mode: params.mode,
          status: "open",
          url: "https://billing.example.test/session_123",
        };
        mocks.checkoutSessions.set(session.id, session);
        return session;
      },
    );
    mocks.stripe.checkout.sessions.retrieve.mockImplementation(
      async (sessionId: string) => mocks.checkoutSessions.get(sessionId),
    );
    mocks.stripe.checkout.sessions.expire.mockImplementation(
      async (sessionId: string) => {
        const session = mocks.checkoutSessions.get(sessionId);
        if (!session) {
          throw new Error("missing Checkout Session");
        }
        const expired = {
          ...session,
          status: "expired",
          url: null,
        };
        mocks.checkoutSessions.set(sessionId, expired);
        return expired;
      },
    );
    mocks.stripe.customers.create.mockResolvedValue({ id: "cus_pulse_trial_123" });
    mocks.stripe.customers.del.mockResolvedValue({ deleted: true });
  });

  it("returns alreadyActive when the invite member already has active billing", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(
      makeInvite({
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          identity: null,
          routing: null,
          suspendedAt: null,
        },
      }),
    );

    await expect(
      createHostedBillingCheckout({
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: makePrisma() as never,
      }),
    ).resolves.toEqual({
      alreadyActive: true,
      url: null,
    });
    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("blocks checkout until the invite member has a phone or Telegram messaging channel", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(
      makeInvite({
        member: {
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          identity: {
            phoneLookupKey: null,
          },
          routing: null,
          suspendedAt: null,
        },
      }),
    );

    await expect(
      createHostedBillingCheckout({
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
      httpStatus: 409,
    });

    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("does not start direct billing for a Family-sponsored member", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    mocks.readActiveHostedFamilySponsorship.mockResolvedValueOnce(true);

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: makePrisma() as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
      httpStatus: 409,
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("returns alreadyActive when billing becomes active before the locked reservation", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma({
      memberBillingStatus: HostedBillingStatus.active,
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    })).resolves.toEqual({
      alreadyActive: true,
      url: null,
    });

    expect(prisma.hostedMemberBillingRef.upsert).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("does not reserve Checkout when a subscription binds after the outer eligibility read", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();
    const privateColumns = await buildHostedMemberBillingPrivateColumns({
      memberId: "member_123",
      stripeCustomerId: "cus_bound_race",
      stripeSubscriptionId: "sub_bound_race",
    });
    mocks.requireHostedStripeCheckoutConfig.mockImplementationOnce(() => {
      prisma.mergeBillingRef(privateColumns);
      return {
        billingPlanCode: "launch_monthly",
        priceId: "price_123",
        stripe: mocks.stripe,
      };
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ALREADY_EXISTS",
      httpStatus: 409,
    });

    expect(prisma.hostedMemberBillingRef.upsert).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("rechecks Family sponsorship after taking the member lock", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    mocks.readActiveHostedFamilySponsorship.mockResolvedValueOnce(false);
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce({
      groupId: "family_123",
      kind: "active_sponsorship",
      ownerMemberId: "family_owner",
    });
    const prisma = makePrisma();

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
    });

    expect(mocks.readHostedMemberFamilyBillingClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_123",
      }),
    );
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(prisma.hostedMemberBillingRef.upsert).not.toHaveBeenCalled();
  });

  it("does not open direct Checkout after a Family Checkout claim is reserved", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValueOnce({
      checkoutAttemptId: "family_attempt_123",
      groupId: "family_123",
      kind: "checkout_attempt",
      ownerMemberId: "member_123",
    });
    const prisma = makePrisma();

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_BILLING_IN_PROGRESS",
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(prisma.hostedMemberBillingRef.upsert).not.toHaveBeenCalled();
  });

  it("creates a first-time Stripe Checkout Session without pre-creating a customer", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();

    await expect(
      createHostedBillingCheckout({
        inviteCode: "invite-code",
        linkedAccounts: [
          {
            address: "member@example.test",
            type: "email",
            verified_at: 1_710_000_000,
          },
        ],
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: prisma as never,
      }),
    ).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });

    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.customers.update).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cancel_url: "https://join.example.test/join/invite-code/cancel",
        client_reference_id: "member_123",
        customer_email: "member@example.test",
        line_items: [
          {
            price: "price_123",
            quantity: 1,
          },
        ],
        metadata: expect.objectContaining({
          billingPlanCode: "launch_monthly",
          checkoutAttemptId: expect.any(String),
          checkoutIntentHash: expect.any(String),
          checkoutOffer: "standard",
          memberId: "member_123",
        }),
        subscription_data: {
          metadata: expect.objectContaining({
            billingPlanCode: "launch_monthly",
            checkoutAttemptId: expect.any(String),
            checkoutIntentHash: expect.any(String),
            checkoutOffer: "standard",
            memberId: "member_123",
          }),
        },
        success_url: "https://join.example.test/join/invite-code/success?session_id={CHECKOUT_SESSION_ID}",
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-checkout:[^:]+:[a-f0-9]{32}$/u,
        ),
        maxNetworkRetries: 0,
        timeout: 5_000,
      }),
    );
    const checkoutSessionRequest = mocks.stripe.checkout.sessions.create.mock.calls[0]?.[0];
    expect(checkoutSessionRequest).not.toHaveProperty("customer");
    expect(checkoutSessionRequest).not.toHaveProperty("automatic_tax");
    expect(checkoutSessionRequest).not.toHaveProperty("customer_update");
    expect(mocks.stripe.checkout.sessions.create.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-checkout:[^:]+:[a-f0-9]{32}$/u,
        ),
      }),
    );
    expect(consoleInfo).toHaveBeenCalledWith(
      "Hosted onboarding timing.",
      expect.objectContaining({
        alreadyActive: false,
        outcome: "completed",
        step: "hosted-onboarding.billing.create-checkout",
      }),
    );
  });

  it("creates checkout for the selected Edge monthly plan", async () => {
    mocks.requireHostedStripeCheckoutConfig.mockReturnValue({
      billingPlanCode: "launch_edge_monthly",
      priceId: "price_edge_monthly_123",
      stripe: mocks.stripe,
    });
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());

    await expect(
      createHostedBillingCheckout({
        billingPlanCode: "launch_edge_monthly",
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: makePrisma() as never,
      }),
    ).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });

    expect(mocks.requireHostedStripeCheckoutConfig).toHaveBeenCalledWith({
      billingPlanCode: "launch_edge_monthly",
    });
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          {
            price: "price_edge_monthly_123",
            quantity: 1,
          },
        ],
        metadata: expect.objectContaining({
          billingPlanCode: "launch_edge_monthly",
          checkoutAttemptId: expect.any(String),
          checkoutIntentHash: expect.any(String),
          checkoutOffer: "standard",
          memberId: "member_123",
        }),
        subscription_data: {
          metadata: expect.objectContaining({
            billingPlanCode: "launch_edge_monthly",
            checkoutAttemptId: expect.any(String),
            checkoutIntentHash: expect.any(String),
            checkoutOffer: "standard",
            memberId: "member_123",
          }),
        },
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-checkout:[^:]+:[a-f0-9]{32}$/u,
        ),
      }),
    );
  });

  it("creates Pulse Trial checkout with trial metadata, trial days, and an offer-bound idempotency key", async () => {
    process.env.HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED = "1";
    mocks.requireHostedStripeCheckoutConfig.mockReturnValue({
      billingPlanCode: "launch_monthly",
      priceId: "price_123",
      stripe: mocks.stripe,
    });
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();

    await expect(
      createHostedBillingCheckout({
        checkoutOffer: "pulse_trial_7d",
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: prisma as never,
      }),
    ).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_pulse_trial_123",
        line_items: [
          {
            price: "price_123",
            quantity: 1,
          },
        ],
        metadata: expect.objectContaining({
          billingPlanCode: "launch_monthly",
          checkoutAttemptId: expect.any(String),
          checkoutIntentHash: expect.any(String),
          checkoutOffer: "pulse_trial_7d",
          memberId: "member_123",
          trialDurationDays: "14",
          trialPolicyVersion: "pulse-trial-2026-07-15-v3",
          trialUsageLimitUsdMicros: "4500000",
        }),
        subscription_data: {
          metadata: expect.objectContaining({
            billingPlanCode: "launch_monthly",
            checkoutAttemptId: expect.any(String),
            checkoutIntentHash: expect.any(String),
            checkoutOffer: "pulse_trial_7d",
            memberId: "member_123",
            trialDurationDays: "14",
            trialPolicyVersion: "pulse-trial-2026-07-15-v3",
            trialUsageLimitUsdMicros: "4500000",
          }),
          trial_period_days: 14,
        },
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-checkout:[^:]+:[a-f0-9]{32}$/u,
        ),
      }),
    );
    expect(mocks.stripe.customers.create).toHaveBeenCalledWith({
      metadata: {
        memberId: "member_123",
        source: "hosted.auto_pulse_trial",
      },
    }, {
      idempotencyKey: "hosted-auto-pulse-trial-customer:member_123",
    });
    expect(prisma.hostedMemberBillingRef.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          memberId: "member_123",
          stripeCustomerLookupKey: expect.any(String),
        }),
        update: expect.objectContaining({
          stripeCustomerLookupKey: expect.any(String),
        }),
        where: {
          memberId: "member_123",
        },
      }),
    );
    expect(
      prisma.hostedMemberBillingRef.upsert.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.stripe.checkout.sessions.create.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("retains a Pulse Trial Customer when its local binding commit acknowledgement is lost", async () => {
    process.env.HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED = "1";
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma({
      failTransactionAfterCommitAt: [1],
    });

    await expect(createHostedBillingCheckout({
      checkoutOffer: "pulse_trial_7d",
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toThrow("Injected transaction acknowledgement failure.");

    expect(mocks.stripe.customers.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.customers.del).not.toHaveBeenCalled();
    expect(prisma.hostedMemberBillingRef.findUnique).toHaveBeenCalled();
  });

  it("retains and reuses the stable Pulse Trial Customer after a rolled-back binding", async () => {
    process.env.HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED = "1";
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma({
      failTransactionAfterCallbackAt: [1],
    });
    const request = () => createHostedBillingCheckout({
      checkoutOffer: "pulse_trial_7d",
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    });

    await expect(request()).rejects.toThrow(
      "Injected transaction commit failure.",
    );
    await expect(request()).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });

    expect(mocks.stripe.customers.create).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.customers.del).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_pulse_trial_123",
      }),
      expect.any(Object),
    );
  });

  it("rejects Pulse Trial checkout when the rollout flag is disabled", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());

    await expect(
      createHostedBillingCheckout({
        checkoutOffer: "pulse_trial_7d",
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_CHECKOUT_DISABLED",
      httpStatus: 404,
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("rejects Pulse Trial checkout for Edge", async () => {
    process.env.HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED = "1";
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());

    await expect(
      createHostedBillingCheckout({
        billingPlanCode: "launch_edge_monthly",
        checkoutOffer: "pulse_trial_7d",
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_OFFER_PLAN_MISMATCH",
      httpStatus: 400,
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("rejects Pulse Trial checkout after the member has already redeemed a trial", async () => {
    process.env.HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED = "1";
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());

    await expect(
      createHostedBillingCheckout({
        checkoutOffer: "pulse_trial_7d",
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: makePrisma({
          billingRef: {
            memberId: "member_123",
            pulseTrialRedeemedAt: new Date("2026-03-20T12:00:00.000Z"),
            stripeCustomerIdEncrypted: null,
            stripeCustomerLookupKey: null,
            stripeSubscriptionIdEncrypted: null,
            stripeSubscriptionLookupKey: null,
          },
        }) as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_PULSE_TRIAL_ALREADY_REDEEMED",
      httpStatus: 409,
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("allows standard Pulse checkout after a prior redeemed trial", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());

    await expect(
      createHostedBillingCheckout({
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: makePrisma({
          billingRef: {
            memberId: "member_123",
            pulseTrialRedeemedAt: new Date("2026-03-20T12:00:00.000Z"),
            stripeCustomerIdEncrypted: null,
            stripeCustomerLookupKey: null,
            stripeSubscriptionIdEncrypted: null,
            stripeSubscriptionLookupKey: null,
          },
        }) as never,
      }),
    ).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          billingPlanCode: "launch_monthly",
          checkoutAttemptId: expect.any(String),
          checkoutIntentHash: expect.any(String),
          checkoutOffer: "standard",
          memberId: "member_123",
        }),
      }),
      expect.any(Object),
    );
  });

  it("rejects checkout when the invite belongs to a different member", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(
      makeInvite({
        memberId: "member_456",
        member: {
          billingStatus: HostedBillingStatus.not_started,
          id: "member_456",
          identity: {
            phoneLookupKey: "hbidx:phone:v1:test",
          },
          routing: null,
          suspendedAt: null,
        },
      }),
    );

    await expect(
      createHostedBillingCheckout({
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: makePrisma() as never,
      }),
    ).rejects.toMatchObject({
      code: "AUTH_INVITE_MISMATCH",
      httpStatus: 403,
    });

    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.customers.update).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("reuses the existing durable Stripe customer binding for metering and checkout", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma({
      billingRef: {
        memberId: "member_123",
        ...(await buildHostedMemberBillingPrivateColumns({
          memberId: "member_123",
          stripeCustomerId: "cus_existing",
          stripeSubscriptionId: null,
        })),
        stripeCustomerLookupKey: "hbidx:stripe-customer:v1:existing",
        stripeSubscriptionLookupKey: null,
      },
    });

    await createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    });

    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.customers.update).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_existing",
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-checkout:[^:]+:[a-f0-9]{32}$/u,
        ),
      }),
    );
    const checkoutSessionRequest = mocks.stripe.checkout.sessions.create.mock.calls[0]?.[0];
    expect(checkoutSessionRequest).not.toHaveProperty("customer_email");
  });

  it("does not reread or synthesize a customer binding when none exists yet", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma({
      billingRef: null,
    });

    await createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    });

    expect(prisma.hostedMemberBillingRef.findUnique).toHaveBeenCalled();
    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.customers.update).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        customer: expect.anything(),
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-checkout:[^:]+:[a-f0-9]{32}$/u,
        ),
      }),
    );
    const checkoutSessionRequest = mocks.stripe.checkout.sessions.create.mock.calls[0]?.[0];
    expect(checkoutSessionRequest).not.toHaveProperty("customer_email");
  });

  it("reuses the same durable Stripe Checkout attempt for duplicate requests", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();

    await expect(Promise.all([
      createHostedBillingCheckout({
        inviteCode: "invite-code",
        linkedAccounts: [
          {
            address: "member@example.test",
            type: "email",
            verified_at: 1_710_000_000,
          },
        ],
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: prisma as never,
      }),
      createHostedBillingCheckout({
        inviteCode: "invite-code",
        linkedAccounts: [
          {
            address: "member@example.test",
            type: "email",
            verified_at: 1_710_000_000,
          },
        ],
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: prisma as never,
      }),
    ])).resolves.toEqual([
      {
        alreadyActive: false,
        url: "https://billing.example.test/session_123",
      },
      {
        alreadyActive: false,
        url: "https://billing.example.test/session_123",
      },
    ]);

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalledOnce();
    const firstCall = mocks.stripe.checkout.sessions.create.mock.calls[0];
    expect(firstCall?.[1]).toEqual(expect.objectContaining({
      idempotencyKey: expect.stringMatching(
        /^hosted-billing-checkout:[^:]+:[a-f0-9]{32}$/u,
      ),
    }));
  });

  it("returns a retryable conflict while another request is creating the Session", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma({
      rejectConcurrentTransaction: true,
    });
    let releaseStripeCreate = () => {};
    let notifyStripeCreateStarted = () => {};
    const stripeCreateStarted = new Promise<void>((resolve) => {
      notifyStripeCreateStarted = resolve;
    });
    const stripeCreateGate = new Promise<void>((resolve) => {
      releaseStripeCreate = resolve;
    });
    mocks.stripe.checkout.sessions.create.mockImplementationOnce(
      async (params: Record<string, unknown>) => {
        notifyStripeCreateStarted();
        await stripeCreateGate;
        return {
          client_reference_id: params.client_reference_id,
          id: "cs_delayed",
          metadata: params.metadata,
          mode: params.mode,
          status: "open",
          url: "https://billing.example.test/session_delayed",
        };
      },
    );
    const request = () => createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    });

    const firstRequest = request();
    await stripeCreateStarted;
    await expect(request()).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_BUSY",
      httpStatus: 409,
      retryable: true,
    });
    releaseStripeCreate();
    await expect(firstRequest).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_delayed",
    });
  });

  it("self-heals an exact completed Session when its webhook never arrived", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();
    const request = () => createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    });
    await request();
    const storedSession = mocks.checkoutSessions.get("cs_1");
    if (!storedSession) {
      throw new Error("Expected the first Checkout Session.");
    }
    Object.assign(storedSession, {
      customer: "cus_completed",
      payment_status: "paid",
      status: "complete",
      subscription: "sub_completed",
      url: null,
    });
    mocks.applyStripeCheckoutCompleted.mockImplementationOnce(async () => {
      prisma.setMemberBillingStatus(HostedBillingStatus.active);
      return {
        activatedMemberId: "member_123",
        hostedExecutionEventId: "activation_123",
        welcomeEmailMemberId: "member_123",
      };
    });

    await expect(request()).resolves.toEqual({
      alreadyActive: true,
      url: null,
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(mocks.applyStripeCheckoutCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cs_1",
        status: "complete",
        subscription: "sub_completed",
      }),
      expect.any(Object),
      undefined,
      expect.any(Date),
    );
    expect(
      mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult,
    ).toHaveBeenCalledWith(expect.objectContaining({
      hostedExecutionEventId: "activation_123",
      memberId: "member_123",
    }));
    expect(prisma.$transaction.mock.calls.at(-1)?.[1]).toMatchObject({
      timeout: 780_000,
    });
  });

  it("reuses the committed attempt after Stripe succeeds but Session binding rolls back", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma({
      failTransactionAfterCallbackAt: [2],
    });
    let committedStripeSession: Record<string, unknown> | null = null;
    mocks.stripe.checkout.sessions.create.mockImplementation(
      async (params: Record<string, unknown>) => {
        committedStripeSession ??= {
          client_reference_id: params.client_reference_id,
          id: "cs_provider_committed",
          metadata: params.metadata,
          mode: params.mode,
          status: "open",
          url: "https://billing.example.test/provider_committed",
        };
        return committedStripeSession;
      },
    );
    const request = () => createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    });

    await expect(request()).rejects.toThrow("Injected transaction commit failure.");
    await expect(request()).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/provider_committed",
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    const firstKey =
      mocks.stripe.checkout.sessions.create.mock.calls[0]?.[1]?.idempotencyKey;
    const secondKey =
      mocks.stripe.checkout.sessions.create.mock.calls[1]?.[1]?.idempotencyKey;
    expect(firstKey).toEqual(expect.any(String));
    expect(secondKey).toBe(firstKey);
    expect(committedStripeSession).toMatchObject({
      id: "cs_provider_committed",
    });
  });

  it("stops unbound Checkout replay at the 23-hour safe idempotency boundary", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    mocks.stripe.checkout.sessions.create.mockRejectedValue(
      Object.assign(new Error("Connection ended after request write"), {
        type: "StripeConnectionError",
      }),
    );
    const prisma = makePrisma();
    const firstAttemptAt = new Date("2026-03-27T12:00:00.000Z");

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: firstAttemptAt,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date(firstAttemptAt.getTime() + 23 * 60 * 60 * 1_000),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_ATTEMPT_RECOVERY_REQUIRED",
      retryable: false,
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
  });

  it("fails terminally and clears the reserved attempt when Stripe rejects Checkout parameters", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    mocks.stripe.checkout.sessions.create.mockRejectedValueOnce(
      Object.assign(new Error("Unknown parameter"), {
        rawType: "invalid_request_error",
        statusCode: 400,
        type: "StripeInvalidRequestError",
      }),
    );
    const prisma = makePrisma();
    const request = () => createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    });

    await expect(request()).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_PROVIDER_REJECTED",
      httpStatus: 500,
      retryable: false,
    });
    await expect(
      prisma.hostedMemberBillingRef.findUnique(),
    ).resolves.toMatchObject({
      checkoutAttemptId: null,
      checkoutCreatedAt: null,
      checkoutIntentHash: null,
      stripeCheckoutSessionLookupKey: null,
    });

    await expect(request()).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect(
      mocks.stripe.checkout.sessions.create.mock.calls[1]?.[1]?.idempotencyKey,
    ).not.toBe(
      mocks.stripe.checkout.sessions.create.mock.calls[0]?.[1]?.idempotencyKey,
    );
  });

  it("expires and clears a newly created open Checkout that has no usable URL", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    mocks.stripe.checkout.sessions.create.mockImplementationOnce(
      async (params: Record<string, unknown>) => {
        const session = {
          client_reference_id: params.client_reference_id,
          id: "cs_missing_url_new",
          metadata: params.metadata,
          mode: params.mode,
          status: "open",
          url: null,
        };
        mocks.checkoutSessions.set(session.id, session);
        return session;
      },
    );
    const prisma = makePrisma();
    const request = () => createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    });

    await expect(request()).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_SESSION_UNAVAILABLE",
      retryable: true,
    });
    await expect(request()).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });

    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_missing_url_new",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect(
      mocks.stripe.checkout.sessions.create.mock.calls[1]?.[1]?.idempotencyKey,
    ).not.toBe(
      mocks.stripe.checkout.sessions.create.mock.calls[0]?.[1]?.idempotencyKey,
    );
  });

  it("expires and clears a stored open Checkout whose URL became unavailable", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();
    const request = () => createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    });
    await request();
    const storedSession = mocks.checkoutSessions.get("cs_1");
    if (!storedSession) {
      throw new Error("Expected the stored Checkout Session.");
    }
    storedSession.url = null;

    await expect(request()).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_SESSION_UNAVAILABLE",
      retryable: true,
    });
    await expect(request()).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });

    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_1",
      {},
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
  });

  it("changes the Stripe idempotency key when the checkout price changes", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    mocks.requireHostedStripeCheckoutConfig
      .mockReturnValueOnce({
        billingPlanCode: "launch_monthly",
        priceId: "price_123",
        stripe: mocks.stripe,
      })
      .mockReturnValueOnce({
        billingPlanCode: "launch_monthly",
        priceId: "price_456",
        stripe: mocks.stripe,
      });
    const prisma = makePrisma();

    await createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    });

    await createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:05.000Z"),
      prisma: prisma as never,
    });

    const firstCall = mocks.stripe.checkout.sessions.create.mock.calls[0];
    const secondCall = mocks.stripe.checkout.sessions.create.mock.calls[1];

    expect(firstCall?.[1]?.idempotencyKey).toEqual(expect.any(String));
    expect(secondCall?.[1]?.idempotencyKey).toEqual(expect.any(String));
    expect(secondCall?.[1]?.idempotencyKey).not.toBe(
      firstCall?.[1]?.idempotencyKey,
    );
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledOnce();
  });

  it("changes the Stripe idempotency key when a retry upgrades from email-bound checkout to a durable customer binding", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();

    await createHostedBillingCheckout({
      inviteCode: "invite-code",
      linkedAccounts: [
        {
          address: "member@example.test",
          type: "email",
          verified_at: 1_710_000_000,
        },
      ],
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    });
    const customerPrivateColumns = await buildHostedMemberBillingPrivateColumns({
      memberId: "member_123",
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: null,
    });
    prisma.mergeBillingRef({
      stripeCustomerIdEncrypted:
        customerPrivateColumns.stripeCustomerIdEncrypted,
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:existing",
    });

    await createHostedBillingCheckout({
      inviteCode: "invite-code",
      linkedAccounts: [
        {
          address: "member@example.test",
          type: "email",
          verified_at: 1_710_000_000,
        },
      ],
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:05.000Z"),
      prisma: prisma as never,
    });

    const firstCall = mocks.stripe.checkout.sessions.create.mock.calls[0];
    const secondCall = mocks.stripe.checkout.sessions.create.mock.calls[1];

    expect(firstCall?.[0]).toMatchObject({
      customer_email: "member@example.test",
    });
    expect(firstCall?.[0]).not.toHaveProperty("customer");
    expect(firstCall?.[1]?.idempotencyKey).toEqual(expect.any(String));
    expect(secondCall?.[0]).toMatchObject({
      customer: "cus_existing",
    });
    expect(secondCall?.[0]).not.toHaveProperty("customer_email");
    expect(secondCall?.[1]?.idempotencyKey).toEqual(expect.any(String));
    expect(secondCall?.[1]?.idempotencyKey).not.toBe(
      firstCall?.[1]?.idempotencyKey,
    );
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledOnce();
  });
});

function makeAuthenticatedMember() {
  return {
    billingStatus: HostedBillingStatus.not_started,
    createdAt: new Date("2026-03-27T12:00:00.000Z"),
    id: "member_123",
    suspendedAt: null,
    updatedAt: new Date("2026-03-27T12:00:00.000Z"),
  };
}

function makeInvite(overrides: Partial<BillingServiceInvite> = {}): BillingServiceInvite {
  return {
    expiresAt: new Date("2026-03-28T12:00:00.000Z"),
    id: "invite_123",
    inviteCode: "invite-code",
    member: {
      billingStatus: HostedBillingStatus.not_started,
      id: "member_123",
      identity: {
        phoneLookupKey: "hbidx:phone:v1:test",
      },
      routing: null,
      suspendedAt: null,
    },
    memberId: "member_123",
    ...overrides,
  };
}

function makePrisma(input: {
  billingRef?: {
    checkoutAttemptId?: string | null;
    checkoutCreatedAt?: Date | null;
    checkoutIntentHash?: string | null;
    currentBillingPhase?: string | null;
    currentBillingPlanCode?: string | null;
    currentCheckoutOffer?: string | null;
    currentPeriodEnd?: Date | null;
    currentPeriodStart?: Date | null;
    currentTrialEndsAt?: Date | null;
    currentTrialStartedAt?: Date | null;
    lastStripeEventCreatedAt?: Date | null;
    memberId: string;
    pulseTrialPolicyVersion?: string | null;
    pulseTrialRedeemedAt?: Date | null;
    stripeCustomerIdEncrypted: string | null;
    stripeCustomerLookupKey: string | null;
    stripeCheckoutSessionIdEncrypted?: string | null;
    stripeCheckoutSessionLookupKey?: string | null;
    stripeSubscriptionIdEncrypted: string | null;
    stripeSubscriptionLookupKey: string | null;
  } | null;
  failTransactionAfterCallbackAt?: readonly number[];
  failTransactionAfterCommitAt?: readonly number[];
  memberBillingStatus?: HostedBillingStatus;
  rejectConcurrentTransaction?: boolean;
} = {}) {
  let memberBillingStatus =
    input.memberBillingStatus ?? HostedBillingStatus.not_started;
  let billingRef = input.billingRef === null
    ? null
    : normalizeBillingRef(input.billingRef);
  const findUnique = vi.fn(async () =>
    billingRef ? { ...billingRef } : null
  );
  const upsert = vi.fn().mockImplementation(async (inputData: {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => {
    billingRef = billingRef
      ? normalizeBillingRef({
          ...billingRef,
          ...inputData.update,
        })
      : normalizeBillingRef(inputData.create);
    return { ...billingRef };
  });
  const updateMany = vi.fn().mockImplementation(async (inputData: {
    data: Record<string, unknown>;
    where: {
      checkoutAttemptId?: string | null;
      checkoutIntentHash?: string | null;
      memberId?: string;
      stripeSubscriptionLookupKey?: string | null;
    };
  }) => {
    if (
      !billingRef
      || (
        inputData.where.checkoutAttemptId !== undefined
        && billingRef.checkoutAttemptId !== inputData.where.checkoutAttemptId
      )
      || (
        inputData.where.checkoutIntentHash !== undefined
        && billingRef.checkoutIntentHash !== inputData.where.checkoutIntentHash
      )
      || (
        inputData.where.stripeSubscriptionLookupKey !== undefined
        && billingRef.stripeSubscriptionLookupKey !==
          inputData.where.stripeSubscriptionLookupKey
      )
    ) {
      return { count: 0 };
    }
    billingRef = normalizeBillingRef({
      ...billingRef,
      ...inputData.data,
    });
    return { count: 1 };
  });
  const hostedMemberBillingRef = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique,
    updateMany,
    upsert,
  };
  const prismaTx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    hostedMember: {
      findUnique: vi.fn().mockImplementation(async () => ({
        billingStatus: memberBillingStatus,
        suspendedAt: null,
      })),
    },
    hostedMemberBillingRef,
  };
  let transactionTail = Promise.resolve();
  let transactionActive = false;
  let transactionOrdinal = 0;
  const transaction = vi.fn(async (
    callback: (tx: typeof prismaTx) => Promise<unknown>,
    transactionOptions?: unknown,
  ) => {
    void transactionOptions;
    if (input.rejectConcurrentTransaction && transactionActive) {
      throw new HostedMemberStripeMutationLockBusyError();
    }
    transactionOrdinal += 1;
    const currentTransactionOrdinal = transactionOrdinal;
    const previous = transactionTail;
    let releaseTransaction = () => {};
    transactionTail = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    await previous;
    transactionActive = true;
    const billingRefBeforeTransaction = billingRef
      ? { ...billingRef }
      : null;
    try {
      const result = await callback(prismaTx);
      if (
        input.failTransactionAfterCallbackAt?.includes(
          currentTransactionOrdinal,
        )
      ) {
        billingRef = billingRefBeforeTransaction;
        throw new Error("Injected transaction commit failure.");
      }
      if (
        input.failTransactionAfterCommitAt?.includes(
          currentTransactionOrdinal,
        )
      ) {
        throw new Error("Injected transaction acknowledgement failure.");
      }
      return result;
    } finally {
      transactionActive = false;
      releaseTransaction();
    }
  });

  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: transaction,
    hostedMember: prismaTx.hostedMember,
    hostedMemberBillingRef,
    mergeBillingRef(nextBillingRef: Record<string, unknown>) {
      billingRef = normalizeBillingRef({
        ...(billingRef ?? {}),
        ...nextBillingRef,
      });
    },
    setBillingRef(nextBillingRef: Record<string, unknown> | null) {
      billingRef = nextBillingRef
        ? normalizeBillingRef(nextBillingRef)
        : null;
    },
    setMemberBillingStatus(nextStatus: HostedBillingStatus) {
      memberBillingStatus = nextStatus;
    },
  } as const;
}

function normalizeBillingRef(
  input: Record<string, unknown> | null | undefined,
) {
  return {
    checkoutAttemptId: null,
    checkoutCreatedAt: null,
    checkoutIntentHash: null,
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
    scheduledBillingEffectiveAt: null,
    scheduledBillingPlanCode: null,
    stripeCheckoutSessionIdEncrypted: null,
    stripeCheckoutSessionLookupKey: null,
    stripeCustomerIdEncrypted: null,
    stripeCustomerLookupKey: null,
    stripeSubscriptionIdEncrypted: null,
    stripeSubscriptionLookupKey: null,
    stripeSubscriptionScheduleIdEncrypted: null,
    stripeSubscriptionScheduleLookupKey: null,
    ...(input ?? {}),
  };
}

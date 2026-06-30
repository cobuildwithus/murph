import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const stripe = {
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
    customers: {
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    requireHostedInviteForBillingCheckout: vi.fn(),
    requireHostedOnboardingPublicBaseUrl: vi.fn(),
    requireHostedStripeCheckoutConfig: vi.fn(),
    stripe,
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

import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/billing-service";
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
    vi.spyOn(console, "info").mockImplementation(() => {});
    delete process.env.HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED;
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.requireHostedStripeCheckoutConfig.mockReturnValue({
      billingPlanCode: "launch_monthly",
      priceId: "price_123",
      stripe: mocks.stripe,
    });
    mocks.stripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_123",
      url: "https://billing.example.test/session_123",
    });
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
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
        },
        subscription_data: {
          metadata: {
            billingPlanCode: "launch_monthly",
            checkoutOffer: "standard",
            memberId: "member_123",
          },
        },
        success_url: "https://join.example.test/join/invite-code/success?session_id={CHECKOUT_SESSION_ID}",
      }),
      {
        idempotencyKey: "hosted-billing-checkout:member_123:invite-code:launch_monthly:offer:782b59f134ce:items:a071a65166f8:email:8ba467122dd5",
      },
    );
    const checkoutSessionRequest = mocks.stripe.checkout.sessions.create.mock.calls[0]?.[0];
    expect(checkoutSessionRequest).not.toHaveProperty("customer");
    expect(checkoutSessionRequest).not.toHaveProperty("automatic_tax");
    expect(checkoutSessionRequest).not.toHaveProperty("customer_update");
    expect(mocks.stripe.checkout.sessions.create.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: "hosted-billing-checkout:member_123:invite-code:launch_monthly:offer:782b59f134ce:items:a071a65166f8:email:8ba467122dd5",
    });
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
        metadata: {
          billingPlanCode: "launch_edge_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
        },
        subscription_data: {
          metadata: {
            billingPlanCode: "launch_edge_monthly",
            checkoutOffer: "standard",
            memberId: "member_123",
          },
        },
      }),
      {
        idempotencyKey: "hosted-billing-checkout:member_123:invite-code:launch_edge_monthly:offer:782b59f134ce:items:2d9334a693f7:customer:none",
      },
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

    await expect(
      createHostedBillingCheckout({
        checkoutOffer: "pulse_trial_7d",
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: makePrisma() as never,
      }),
    ).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          {
            price: "price_123",
            quantity: 1,
          },
        ],
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "pulse_trial_7d",
          memberId: "member_123",
          trialDurationDays: "10",
          trialPolicyVersion: "pulse-trial-2026-06-30-v2",
          trialUsageLimitUsdMicros: "4500000",
        },
        subscription_data: {
          metadata: {
            billingPlanCode: "launch_monthly",
            checkoutOffer: "pulse_trial_7d",
            memberId: "member_123",
            trialDurationDays: "10",
            trialPolicyVersion: "pulse-trial-2026-06-30-v2",
            trialUsageLimitUsdMicros: "4500000",
          },
          trial_period_days: 10,
        },
      }),
      {
        idempotencyKey: "hosted-billing-checkout:member_123:invite-code:launch_monthly:offer:45d2016f2f12:items:a071a65166f8:customer:none",
      },
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
        metadata: {
          billingPlanCode: "launch_monthly",
          checkoutOffer: "standard",
          memberId: "member_123",
        },
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
      {
        idempotencyKey: "hosted-billing-checkout:member_123:invite-code:launch_monthly:offer:782b59f134ce:items:a071a65166f8:customer:cus_existing",
      },
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

    expect(prisma.hostedMemberBillingRef.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.customers.update).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        customer: expect.anything(),
      }),
      {
        idempotencyKey: "hosted-billing-checkout:member_123:invite-code:launch_monthly:offer:782b59f134ce:items:a071a65166f8:customer:none",
      },
    );
    const checkoutSessionRequest = mocks.stripe.checkout.sessions.create.mock.calls[0]?.[0];
    expect(checkoutSessionRequest).not.toHaveProperty("customer_email");
  });

  it("uses the same Stripe idempotency key for duplicate checkout requests", async () => {
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

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    const firstCall = mocks.stripe.checkout.sessions.create.mock.calls[0];
    const secondCall = mocks.stripe.checkout.sessions.create.mock.calls[1];

    expect(firstCall?.[0]).toEqual(secondCall?.[0]);
    expect(firstCall?.[1]).toEqual({
      idempotencyKey: "hosted-billing-checkout:member_123:invite-code:launch_monthly:offer:782b59f134ce:items:a071a65166f8:email:8ba467122dd5",
    });
    expect(secondCall?.[1]).toEqual({
      idempotencyKey: "hosted-billing-checkout:member_123:invite-code:launch_monthly:offer:782b59f134ce:items:a071a65166f8:email:8ba467122dd5",
    });
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

    expect(firstCall?.[1]).toEqual({
      idempotencyKey: "hosted-billing-checkout:member_123:invite-code:launch_monthly:offer:782b59f134ce:items:a071a65166f8:customer:none",
    });
    expect(secondCall?.[1]).toEqual({
      idempotencyKey: "hosted-billing-checkout:member_123:invite-code:launch_monthly:offer:782b59f134ce:items:99e916878619:customer:none",
    });
  });

  it("changes the Stripe idempotency key when a retry upgrades from email-bound checkout to a durable customer binding", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma({
      findUniqueResults: [
        null,
        {
          memberId: "member_123",
          ...(await buildHostedMemberBillingPrivateColumns({
            memberId: "member_123",
            stripeCustomerId: "cus_existing",
            stripeSubscriptionId: null,
          })),
          stripeCustomerLookupKey: "hbidx:stripe-customer:v1:existing",
          stripeSubscriptionLookupKey: null,
        },
      ],
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
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
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
    expect(firstCall?.[1]).toEqual({
      idempotencyKey: "hosted-billing-checkout:member_123:invite-code:launch_monthly:offer:782b59f134ce:items:a071a65166f8:email:8ba467122dd5",
    });
    expect(secondCall?.[0]).toMatchObject({
      customer: "cus_existing",
    });
    expect(secondCall?.[0]).not.toHaveProperty("customer_email");
    expect(secondCall?.[1]).toEqual({
      idempotencyKey: "hosted-billing-checkout:member_123:invite-code:launch_monthly:offer:782b59f134ce:items:a071a65166f8:customer:cus_existing",
    });
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
    stripeSubscriptionIdEncrypted: string | null;
    stripeSubscriptionLookupKey: string | null;
  } | null;
  findUniqueResults?: Array<{
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
    stripeSubscriptionIdEncrypted: string | null;
    stripeSubscriptionLookupKey: string | null;
  } | null>;
} = {}) {
  const findUnique = input.findUniqueResults
    ? vi.fn()
        .mockResolvedValueOnce(input.findUniqueResults[0] ?? null)
        .mockResolvedValueOnce(input.findUniqueResults[1] ?? null)
    : vi.fn().mockResolvedValue(input.billingRef ?? null);
  const upsert = vi.fn().mockImplementation(
    async (inputData: {
      create: {
        memberId: string;
        stripeCustomerIdEncrypted: string | null;
        stripeCustomerLookupKey: string | null;
        stripeSubscriptionIdEncrypted: string | null;
        stripeSubscriptionLookupKey: string | null;
      };
      update: {
        stripeCustomerIdEncrypted?: string | null;
        stripeCustomerLookupKey?: string | null;
        stripeSubscriptionIdEncrypted?: string | null;
        stripeSubscriptionLookupKey?: string | null;
      };
    }) => ({
      memberId: inputData.create.memberId,
      stripeCustomerIdEncrypted:
        inputData.update.stripeCustomerIdEncrypted
        ?? inputData.create.stripeCustomerIdEncrypted,
      stripeCustomerLookupKey:
        inputData.update.stripeCustomerLookupKey
        ?? inputData.create.stripeCustomerLookupKey,
      stripeSubscriptionIdEncrypted:
        inputData.update.stripeSubscriptionIdEncrypted
        ?? inputData.create.stripeSubscriptionIdEncrypted,
      stripeSubscriptionLookupKey:
        inputData.update.stripeSubscriptionLookupKey
        ?? inputData.create.stripeSubscriptionLookupKey,
    }),
  );
  const prismaTx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    hostedMemberBillingRef: {
      findUnique,
      upsert,
    },
  };

  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (callback: (tx: typeof prismaTx) => Promise<unknown>) => callback(prismaTx)),
    hostedMemberBillingRef: {
      findUnique,
      upsert,
    },
  } as const;
}

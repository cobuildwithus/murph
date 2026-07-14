import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
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
      status: "open",
      url: "https://billing.example.test/session_123",
    });
    mocks.stripe.checkout.sessions.expire.mockResolvedValue({
      id: "cs_123",
      status: "expired",
    });
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: "cs_123",
      status: "open",
      url: "https://billing.example.test/session_123",
    });
    mocks.stripe.customers.create.mockResolvedValue({ id: "cus_pulse_trial_123" });
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

  it("rejects direct checkout while Family owns the member's billing authority", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: makePrisma({ familyAuthorityResults: [true] }) as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_FAMILY_AUTHORITY_ACTIVE",
      httpStatus: 409,
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("expires a new checkout when Family wins before its session is bound", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: makePrisma({ familyAuthorityResults: [false, true] }) as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_FAMILY_AUTHORITY_ACTIVE",
      httpStatus: 409,
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_123");
  });

  it("retires a rejected checkout session before a later eligible retry", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    mocks.stripe.checkout.sessions.create
      .mockResolvedValueOnce({
        id: "cs_stale",
        status: "open",
        url: "https://billing.example.test/session_stale",
      })
      .mockResolvedValueOnce({
        id: "cs_retry",
        status: "open",
        url: "https://billing.example.test/session_retry",
      });
    mocks.stripe.checkout.sessions.retrieve
      .mockResolvedValueOnce({
        id: "cs_stale",
        status: "open",
        url: "https://billing.example.test/session_stale",
      })
      .mockResolvedValueOnce({
        id: "cs_stale",
        status: "expired",
        url: null,
      });
    const prisma = makePrisma({
      familyAuthorityResults: [false, true, false, false],
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_FAMILY_AUTHORITY_ACTIVE",
      httpStatus: 409,
    });
    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_retry",
    });

    const firstIdempotencyKey = mocks.stripe.checkout.sessions.create.mock.calls[0]?.[1]
      ?.idempotencyKey;
    const retryIdempotencyKey = mocks.stripe.checkout.sessions.create.mock.calls[1]?.[1]
      ?.idempotencyKey;
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_stale");
    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(2);
    expect(firstIdempotencyKey).toEqual(expect.any(String));
    expect(retryIdempotencyKey).toEqual(expect.any(String));
    expect(retryIdempotencyKey).not.toBe(firstIdempotencyKey);
  });

  it("expires a new checkout when billing becomes active before its session is bound", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: makePrisma({
        billingStatusResults: [
          HostedBillingStatus.not_started,
          HostedBillingStatus.active,
        ],
      }) as never,
    })).resolves.toEqual({
      alreadyActive: true,
      url: null,
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_123");
  });

  it("expires a new checkout when billing becomes ineligible before its session is bound", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: makePrisma({
        billingStatusResults: [
          HostedBillingStatus.not_started,
          HostedBillingStatus.past_due,
        ],
      }) as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_BLOCKED",
      httpStatus: 403,
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_123");
  });

  it("expires a new checkout when its final binding transaction fails unexpectedly", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const transactionError = new Error("final binding transaction failed");

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: makePrisma({ finalizationTransactionError: transactionError }) as never,
    })).rejects.toBe(transactionError);

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_123");
  });

  it("expires an ambiguously committed session before a retry retires it", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const resultError = new Error("final binding transaction result lost");
    mocks.stripe.checkout.sessions.create
      .mockResolvedValueOnce({
        id: "cs_ambiguous",
        status: "open",
        url: "https://billing.example.test/session_ambiguous",
      })
      .mockResolvedValueOnce({
        id: "cs_retry",
        status: "open",
        url: "https://billing.example.test/session_retry",
      });
    mocks.stripe.checkout.sessions.retrieve
      .mockResolvedValueOnce({
        id: "cs_ambiguous",
        status: "open",
        url: "https://billing.example.test/session_ambiguous",
      })
      .mockResolvedValueOnce({
        id: "cs_ambiguous",
        status: "expired",
        url: null,
      });
    const prisma = makePrisma({ finalizationResultError: resultError });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    })).rejects.toBe(resultError);
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_ambiguous",
    );

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_retry",
    });

    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(
      "cs_ambiguous",
    );
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_ambiguous",
    );
    const firstIdempotencyKey = mocks.stripe.checkout.sessions.create.mock.calls[0]?.[1]
      ?.idempotencyKey;
    const retryIdempotencyKey = mocks.stripe.checkout.sessions.create.mock.calls[1]?.[1]
      ?.idempotencyKey;
    expect(retryIdempotencyKey).not.toBe(firstIdempotencyKey);
  });

  it("binds a URL-less checkout before expiry so a retry uses a fresh key", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    mocks.stripe.checkout.sessions.create
      .mockResolvedValueOnce({
        id: "cs_missing_url",
        status: "open",
        url: null,
      })
      .mockResolvedValueOnce({
        id: "cs_retry",
        status: "open",
        url: "https://billing.example.test/session_retry",
      });
    mocks.stripe.checkout.sessions.retrieve
      .mockResolvedValueOnce({
        id: "cs_missing_url",
        status: "open",
        url: null,
      })
      .mockResolvedValueOnce({
        id: "cs_missing_url",
        status: "expired",
        url: null,
      });
    const prisma = makePrisma();

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "CHECKOUT_URL_MISSING",
      httpStatus: 502,
    });
    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_retry",
    });

    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_missing_url",
    );
    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenNthCalledWith(
      1,
      "cs_missing_url",
    );
    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenNthCalledWith(
      2,
      "cs_missing_url",
    );
    const firstIdempotencyKey = mocks.stripe.checkout.sessions.create.mock.calls[0]?.[1]
      ?.idempotencyKey;
    const retryIdempotencyKey = mocks.stripe.checkout.sessions.create.mock.calls[1]?.[1]
      ?.idempotencyKey;
    expect(retryIdempotencyKey).not.toBe(firstIdempotencyKey);
  });

  it("treats an unexpected final Family-authority read error as unknown state", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const authorityError = new Error("family authority read failed");

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: makePrisma({
        familyAuthorityError: authorityError,
        familyAuthorityErrorCall: 2,
      }) as never,
    })).rejects.toBe(authorityError);

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_123");
  });

  it("expires a new checkout when a direct subscription appears before binding", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();
    const billingPrivateColumns = await buildHostedMemberBillingPrivateColumns({
      memberId: "member_123",
      stripeCustomerId: "cus_active_123",
      stripeSubscriptionId: "sub_active_123",
    });
    mocks.stripe.checkout.sessions.create.mockImplementationOnce(async () => {
      prisma.mergeBillingRef({
        ...billingPrivateColumns,
        stripeCustomerLookupKey: "hbidx:stripe-customer:v1:active",
        stripeSubscriptionLookupKey: "hbidx:stripe-subscription:v1:active",
      });
      return {
        id: "cs_123",
        status: "open",
        url: "https://billing.example.test/session_123",
      };
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_BLOCKED",
      httpStatus: 409,
    });

    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_123");
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
        idempotencyKey: expectHostedBillingCheckoutKey("launch_monthly:offer:782b59f134ce:items:a071a65166f8:email:8ba467122dd5"),
      },
    );
    const checkoutSessionRequest = mocks.stripe.checkout.sessions.create.mock.calls[0]?.[0];
    expect(checkoutSessionRequest).not.toHaveProperty("customer");
    expect(checkoutSessionRequest).not.toHaveProperty("automatic_tax");
    expect(checkoutSessionRequest).not.toHaveProperty("customer_update");
    expect(mocks.stripe.checkout.sessions.create.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: expectHostedBillingCheckoutKey("launch_monthly:offer:782b59f134ce:items:a071a65166f8:email:8ba467122dd5"),
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
        idempotencyKey: expectHostedBillingCheckoutKey("launch_edge_monthly:offer:782b59f134ce:items:2d9334a693f7:customer:none"),
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
    const prisma = makePrisma();
    mocks.stripe.customers.create.mockImplementationOnce(async () => {
      expect(prisma.isTransactionActive()).toBe(true);
      return { id: "cus_pulse_trial_123" };
    });

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
        idempotencyKey: expectHostedBillingCheckoutKey("launch_monthly:offer:45d2016f2f12:items:a071a65166f8:customer:cus_pulse_trial_123"),
      },
    );
    expect(mocks.stripe.customers.create).toHaveBeenCalledWith({
      metadata: {
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
        idempotencyKey: expectHostedBillingCheckoutKey("launch_monthly:offer:782b59f134ce:items:a071a65166f8:customer:cus_existing"),
      },
    );
    const checkoutSessionRequest = mocks.stripe.checkout.sessions.create.mock.calls[0]?.[0];
    expect(checkoutSessionRequest).not.toHaveProperty("customer_email");
  });

  it("revalidates without synthesizing a customer binding when none exists yet", async () => {
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

    expect(prisma.hostedMemberBillingRef.findUnique).toHaveBeenCalledTimes(4);
    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.customers.update).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        customer: expect.anything(),
      }),
      {
        idempotencyKey: expectHostedBillingCheckoutKey("launch_monthly:offer:782b59f134ce:items:a071a65166f8:customer:none"),
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
      idempotencyKey: expectHostedBillingCheckoutKey("launch_monthly:offer:782b59f134ce:items:a071a65166f8:email:8ba467122dd5"),
    });
    expect(secondCall?.[1]).toEqual({
      idempotencyKey: expectHostedBillingCheckoutKey("launch_monthly:offer:782b59f134ce:items:a071a65166f8:email:8ba467122dd5"),
    });
  });

  it("lets only one different concurrent checkout session escape", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    mocks.requireHostedStripeCheckoutConfig
      .mockReturnValueOnce({
        billingPlanCode: "launch_monthly",
        priceId: "price_monthly_123",
        stripe: mocks.stripe,
      })
      .mockReturnValueOnce({
        billingPlanCode: "launch_edge_monthly",
        priceId: "price_edge_monthly_123",
        stripe: mocks.stripe,
      });
    mocks.stripe.checkout.sessions.create
      .mockResolvedValueOnce({
        id: "cs_monthly_123",
        status: "open",
        url: "https://billing.example.test/monthly",
      })
      .mockResolvedValueOnce({
        id: "cs_edge_123",
        status: "open",
        url: "https://billing.example.test/edge",
      });
    const prisma = makePrisma();

    const results = await Promise.allSettled([
      createHostedBillingCheckout({
        billingPlanCode: "launch_monthly",
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: prisma as never,
      }),
      createHostedBillingCheckout({
        billingPlanCode: "launch_edge_monthly",
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: prisma as never,
      }),
    ]);

    expect(results).toEqual([
      {
        status: "fulfilled",
        value: {
          alreadyActive: false,
          url: "https://billing.example.test/monthly",
        },
      },
      {
        reason: expect.objectContaining({
          code: "HOSTED_BILLING_CHECKOUT_ATTEMPT_STALE",
        }),
        status: "rejected",
      },
    ]);
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledOnce();
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_edge_123",
    );
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
    mocks.stripe.checkout.sessions.create
      .mockResolvedValueOnce({
        id: "cs_price_123",
        status: "open",
        url: "https://billing.example.test/price-123",
      })
      .mockResolvedValueOnce({
        id: "cs_price_456",
        status: "open",
        url: "https://billing.example.test/price-456",
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
      idempotencyKey: expectHostedBillingCheckoutKey("launch_monthly:offer:782b59f134ce:items:a071a65166f8:customer:none"),
    });
    expect(secondCall?.[1]).toEqual({
      idempotencyKey: expectHostedBillingCheckoutKey("launch_monthly:offer:782b59f134ce:items:99e916878619:customer:none"),
    });
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_price_123",
    );
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

    prisma.setBillingRef({
      memberId: "member_123",
      ...(await buildHostedMemberBillingPrivateColumns({
        memberId: "member_123",
        stripeCustomerId: "cus_existing",
        stripeSubscriptionId: null,
      })),
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:existing",
      stripeSubscriptionLookupKey: null,
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
      idempotencyKey: expectHostedBillingCheckoutKey("launch_monthly:offer:782b59f134ce:items:a071a65166f8:email:8ba467122dd5"),
    });
    expect(secondCall?.[0]).toMatchObject({
      customer: "cus_existing",
    });
    expect(secondCall?.[0]).not.toHaveProperty("customer_email");
    expect(secondCall?.[1]).toEqual({
      idempotencyKey: expectHostedBillingCheckoutKey("launch_monthly:offer:782b59f134ce:items:a071a65166f8:customer:cus_existing"),
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

function expectHostedBillingCheckoutKey(suffix: string) {
  return expect.stringMatching(
    new RegExp(
      `^hosted-billing-checkout:member_123:invite-code:hbmca_[^:]+:${suffix}$`,
    ),
  );
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
  billingStatusResults?: HostedBillingStatus[];
  familyAuthorityError?: Error;
  familyAuthorityErrorCall?: number;
  familyAuthorityResults?: boolean[];
  finalizationResultError?: Error;
  finalizationTransactionError?: Error;
} = {}) {
  const billingStatusResults = [...(input.billingStatusResults ?? [])];
  let familyAuthorityCallCount = 0;
  let billingRef: Record<string, unknown> | null = input.billingRef ?? null;
  const findUnique = vi.fn(async () => billingRef);
  const upsert = vi.fn().mockImplementation(
    async (inputData: {
      create: Record<string, unknown> & { memberId: string };
      update: Record<string, unknown>;
    }) => {
      billingRef = {
        ...(billingRef ?? inputData.create),
        ...inputData.update,
        memberId: inputData.create.memberId,
      };
      return billingRef;
    },
  );
  const updateMany = vi.fn(async (inputData: {
    data: Record<string, unknown>;
    where: {
      checkoutAttemptId?: string;
      memberId?: string;
      stripeCheckoutSessionLookupKey?: string | null;
    };
  }) => {
    if (
      !billingRef ||
      (inputData.where.checkoutAttemptId &&
        billingRef.checkoutAttemptId !== inputData.where.checkoutAttemptId) ||
      (inputData.where.memberId && billingRef.memberId !== inputData.where.memberId) ||
      (inputData.where.stripeCheckoutSessionLookupKey !== undefined &&
        (billingRef.stripeCheckoutSessionLookupKey ?? null) !==
          inputData.where.stripeCheckoutSessionLookupKey)
    ) {
      return { count: 0 };
    }
    billingRef = { ...billingRef, ...inputData.data };
    return { count: 1 };
  });
  const prismaTx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    hostedAccountGroupMembership: {
      findFirst: vi.fn(async () => {
        familyAuthorityCallCount += 1;
        if (
          input.familyAuthorityError
          && familyAuthorityCallCount === input.familyAuthorityErrorCall
        ) {
          throw input.familyAuthorityError;
        }
        return input.familyAuthorityResults?.shift()
          ? { id: "membership_family" }
          : null;
      }),
    },
    hostedMember: {
      findUnique: vi.fn(async () => ({
        billingStatus: billingStatusResults.shift() ?? HostedBillingStatus.not_started,
        suspendedAt: null,
      })),
    },
    hostedMemberBillingRef: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique,
      updateMany,
      upsert,
    },
  };
  let transactionTail = Promise.resolve();
  let transactionActive = false;
  let transactionCallCount = 0;
  const transaction = vi.fn(<T>(
    callback: (tx: typeof prismaTx) => Promise<T>,
  ): Promise<T> => {
    const result = transactionTail.then(async () => {
      transactionCallCount += 1;
      if (
        transactionCallCount === 2
        && input.finalizationTransactionError
      ) {
        throw input.finalizationTransactionError;
      }
      transactionActive = true;
      try {
        const callbackResult = await callback(prismaTx);
        if (
          transactionCallCount === 2
          && input.finalizationResultError
        ) {
          throw input.finalizationResultError;
        }
        return callbackResult;
      } finally {
        transactionActive = false;
      }
    });
    transactionTail = result.then(() => undefined, () => undefined);
    return result;
  });

  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: transaction,
    hostedMemberBillingRef: {
      findUnique,
      updateMany,
      upsert,
    },
    isTransactionActive: () => transactionActive,
    mergeBillingRef(nextBillingRef: Record<string, unknown>) {
      billingRef = billingRef
        ? { ...billingRef, ...nextBillingRef }
        : nextBillingRef;
    },
    setBillingRef(nextBillingRef: Record<string, unknown> | null) {
      billingRef = nextBillingRef;
    },
  } as const;
}

import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextServerMocks = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(),
}));

vi.mock("next/server", () => ({
  after: nextServerMocks.after,
}));

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
      del: vi.fn(),
      update: vi.fn(),
    },
    subscriptions: {
      cancel: vi.fn(),
      retrieve: vi.fn(),
    },
  };

  return {
    readActiveHostedFamilySponsorship: vi.fn(),
    readHostedMemberFamilyBillingClaim: vi.fn(),
    requireHostedInviteForBillingCheckout: vi.fn(),
    requireHostedOnboardingPublicBaseUrl: vi.fn(),
    requireHostedStripeCheckoutConfig: vi.fn(),
    stripe,
  };
});

vi.mock("@/src/lib/hosted-onboarding/family-plan", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/family-plan")
  >("@/src/lib/hosted-onboarding/family-plan");

  return {
    ...actual,
    readHostedMemberFamilyBillingClaim:
      mocks.readHostedMemberFamilyBillingClaim,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-access", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/member-access")
  >("@/src/lib/hosted-onboarding/member-access");

  return {
    ...actual,
    readActiveHostedFamilySponsorship: mocks.readActiveHostedFamilySponsorship,
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
import {
  createHostedStripeCustomerLookupKey,
  createHostedStripeSubscriptionLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { buildHostedMemberBillingPrivateColumns } from "@/src/lib/hosted-onboarding/member-private-codecs";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type BillingServiceInvite = {
  expiresAt: Date;
  id: string;
  inviteCode: string;
  member: {
    billingRef?: {
      currentBillingPhase: string | null;
      currentCheckoutOffer: string | null;
      stripeSubscriptionLookupKey: string | null;
    } | null;
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
    mocks.readActiveHostedFamilySponsorship.mockResolvedValue(false);
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue(null);
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.requireHostedStripeCheckoutConfig.mockReturnValue({
      billingPlanCode: "launch_monthly",
      priceId: "price_123",
      stripe: mocks.stripe,
      stripeLiveMode: false,
    });
    let checkoutSession: {
      client_reference_id: string;
      id: string;
      metadata: Record<string, string>;
      mode: string;
      status: string;
      url: string;
    } | null = null;
    mocks.stripe.checkout.sessions.create.mockImplementation(async (params) => {
      checkoutSession = {
        client_reference_id: params.client_reference_id,
        id: "cs_123",
        metadata: params.metadata,
        mode: params.mode,
        status: "open",
        url: "https://billing.example.test/session_123",
      };
      return checkoutSession;
    });
    mocks.stripe.checkout.sessions.retrieve.mockImplementation(
      async () => checkoutSession,
    );
    mocks.stripe.checkout.sessions.expire.mockResolvedValue({
      customer: null,
      id: "cs_123",
      status: "expired",
      subscription: null,
    });
    mocks.stripe.customers.create.mockResolvedValue({ id: "cus_pulse_trial_123" });
  });

  it("returns alreadyActive when the invite member already has active billing", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(
      makeInvite({
        member: {
          billingRef: {
            currentBillingPhase: "paid",
            currentCheckoutOffer: "standard",
            stripeSubscriptionLookupKey: "subscription_lookup_paid",
          },
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
          checkoutIntentHash: expect.stringMatching(/^[a-f0-9]{32}$/),
          checkoutOffer: "standard",
          memberId: "member_123",
        }),
        subscription_data: {
          metadata: expect.objectContaining({
            billingPlanCode: "launch_monthly",
            checkoutAttemptId: expect.any(String),
            checkoutIntentHash: expect.stringMatching(/^[a-f0-9]{32}$/),
            checkoutOffer: "standard",
            memberId: "member_123",
          }),
        },
        success_url: "https://join.example.test/join/invite-code/success?session_id={CHECKOUT_SESSION_ID}",
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-checkout:[^:]+:[a-f0-9]{32}$/,
        ),
        maxNetworkRetries: 0,
        timeout: 5_000,
      }),
    );
    const standardCheckoutInput =
      mocks.stripe.checkout.sessions.create.mock.calls[0]?.[0];
    expect(standardCheckoutInput?.metadata).not.toHaveProperty(
      "pulseTrialStartSource",
    );
    expect(standardCheckoutInput?.subscription_data?.metadata).not.toHaveProperty(
      "pulseTrialStartSource",
    );
    const checkoutSessionRequest = mocks.stripe.checkout.sessions.create.mock.calls[0]?.[0];
    expect(checkoutSessionRequest).not.toHaveProperty("customer");
    expect(checkoutSessionRequest).not.toHaveProperty("automatic_tax");
    expect(checkoutSessionRequest).not.toHaveProperty("customer_update");
    expect(mocks.stripe.checkout.sessions.create.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-checkout:[^:]+:[a-f0-9]{32}$/,
        ),
      }),
    );
    expect(prisma.hostedMemberSubscriptionCheckout.create).toHaveBeenCalledWith(
      {
        data: {
          memberId: "member_123",
          stripeCheckoutSessionIdEncrypted: expect.stringMatching(/^hsb-test:/u),
          stripeCheckoutSessionLookupKey:
            expect.stringMatching(/^hbidx:stripe-checkout-session:v1:/u),
        },
      },
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

  it("creates a fresh direct Checkout after terminal Family release clears the old handoff", async () => {
    const checkoutStartedAt = new Date("2026-07-27T12:40:00.000Z");
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma({
      billingRef: {
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutIntentHash: null,
        currentBillingPhase: null,
        currentBillingPlanCode: null,
        currentCheckoutOffer: null,
        lastStripeEventCreatedAt: new Date("2026-07-27T12:30:00.000Z"),
        memberId: "member_123",
        ...(await buildHostedMemberBillingPrivateColumns({
          memberId: "member_123",
          stripeCustomerId: null,
          stripeSubscriptionId: null,
        })),
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
        stripeCustomerLookupKey: null,
        stripeSubscriptionLookupKey: null,
      },
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: checkoutStartedAt,
      prisma: prisma as never,
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          checkoutAttemptId: expect.any(String),
          checkoutIntentHash: expect.stringMatching(/^[a-f0-9]{32}$/),
          memberId: "member_123",
        }),
      }),
      expect.any(Object),
    );
    expect(prisma.hostedMemberBillingRef.upsert).toHaveBeenCalledWith({
      create: expect.objectContaining({
        checkoutAttemptId: expect.any(String),
        checkoutCreatedAt: checkoutStartedAt,
        checkoutIntentHash: expect.stringMatching(/^[a-f0-9]{32}$/),
        memberId: "member_123",
      }),
      update: {
        checkoutAttemptId: expect.any(String),
        checkoutCreatedAt: checkoutStartedAt,
        checkoutIntentHash: expect.stringMatching(/^[a-f0-9]{32}$/),
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
      },
      where: {
        memberId: "member_123",
      },
    });
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
          checkoutOffer: "standard",
          memberId: "member_123",
        }),
        subscription_data: {
          metadata: expect.objectContaining({
            billingPlanCode: "launch_edge_monthly",
            checkoutOffer: "standard",
            memberId: "member_123",
          }),
        },
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^hosted-billing-checkout:[^:]+:[a-f0-9]{32}$/,
        ),
      }),
    );
  });

  it("does not create Checkout while a future Stripe effect owns the member", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma({
      billingRef: {
        memberId: "member_123",
        stripeCustomerIdEncrypted: null,
        stripeCustomerLookupKey: null,
        stripeEffectClaimId: "opaque-future-member-claim",
        stripeSubscriptionIdEncrypted: null,
        stripeSubscriptionLookupKey: null,
      },
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_STRIPE_EFFECT_PENDING",
      retryable: true,
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("stops before direct Checkout provider entry when a member claim wins after reservation", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();
    prisma.afterNextTransactionCommitted(() => {
      prisma.setBillingRefState({
        stripeEffectClaimId: "future-member-effect",
      });
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_STRIPE_EFFECT_PENDING",
      retryable: true,
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(prisma.hostedMemberBillingRef.updateMany).toHaveBeenCalledWith({
      data: {
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutIntentHash: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
      },
      where: expect.objectContaining({
        memberId: "member_123",
      }),
    });
  });

  it("expires the unbound direct Session when a member claim wins at bind", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();
    const session = {
      client_reference_id: "member_123",
      id: "cs_test_directClaimAtBind123",
      metadata: {
        billingPlanCode: "launch_monthly",
        checkoutAttemptId: "",
        checkoutIntentHash: "",
        checkoutOffer: "standard",
        memberId: "member_123",
      },
      mode: "subscription",
      status: "open",
      url: "https://billing.example.test/direct-claim-at-bind",
    };
    mocks.stripe.checkout.sessions.create.mockImplementationOnce(
      async (params) => {
        session.metadata.checkoutAttemptId = params.metadata.checkoutAttemptId;
        session.metadata.checkoutIntentHash = params.metadata.checkoutIntentHash;
        prisma.setBillingRefState({
          stripeEffectClaimId: "future-member-effect",
        });
        return session;
      },
    );
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue(session);

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_STRIPE_EFFECT_PENDING",
      retryable: true,
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      session.id,
    );
    expect(
      prisma.hostedMemberSubscriptionCheckout.create,
    ).not.toHaveBeenCalled();
  });

  it("expires an existing open direct Session when a claim wins before URL return", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    })).resolves.toMatchObject({ alreadyActive: false });

    prisma.afterNextTransactionCommitted(() => {
      prisma.setBillingRefState({
        stripeEffectClaimId: "future-member-effect",
      });
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:05.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_STRIPE_EFFECT_PENDING",
      retryable: true,
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_123");
  });

  it("does not create Checkout while a claim-only owner group owns Family billing", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    mocks.readHostedMemberFamilyBillingClaim.mockResolvedValue({
      groupId: "hbag_claim_only",
      kind: "stripe_effect",
      ownerMemberId: "member_123",
    });
    const prisma = makePrisma();

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_STRIPE_EFFECT_PENDING",
      retryable: true,
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it.each([
    ["Pulse", "launch_monthly", "price_monthly_123"],
    ["Edge", "launch_edge_monthly", "price_edge_monthly_123"],
    ["Max", "launch_max_monthly", "price_max_monthly_123"],
    ["Core", "launch_group_monthly", "price_group_monthly_123"],
  ] as const)(
    "creates %s checkout without retrieving or canceling a legacy Pulse subscription",
    async (_label, billingPlanCode, destinationPriceId) => {
      const prices = {
        launch_edge_monthly: "price_edge_monthly_123",
        launch_group_monthly: "price_group_monthly_123",
        launch_max_monthly: "price_max_monthly_123",
        launch_monthly: "price_monthly_123",
      } as const;
      mocks.requireHostedStripeCheckoutConfig.mockImplementation((input: {
        billingPlanCode: keyof typeof prices;
      }) => ({
        billingPlanCode: input.billingPlanCode,
        priceId: prices[input.billingPlanCode],
        stripe: mocks.stripe,
        stripeLiveMode: false,
      }));
      mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite({
        member: {
          billingRef: {
            currentBillingPhase: "trial",
            currentCheckoutOffer: "pulse_trial",
            stripeSubscriptionLookupKey: "subscription_lookup_legacy_trial",
          },
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          identity: { phoneLookupKey: "hbidx:phone:v1:test" },
          routing: null,
          suspendedAt: null,
        },
      }));

      await expect(createHostedBillingCheckout({
        billingPlanCode,
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: makePrisma({ hasConfirmedGroupMembership: true }) as never,
      })).resolves.toEqual({
        alreadyActive: false,
        url: "https://billing.example.test/session_123",
      });

      expect(mocks.requireHostedStripeCheckoutConfig).toHaveBeenCalledOnce();
      expect(mocks.requireHostedStripeCheckoutConfig).toHaveBeenCalledWith({
        billingPlanCode,
      });
      expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
      expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [{ price: destinationPriceId, quantity: 1 }],
        }),
        expect.any(Object),
      );
    },
  );

  it("fails closed on a persisted legacy subscription instead of starting a second checkout", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite({
      member: {
        billingRef: {
          currentBillingPhase: "trial",
          currentCheckoutOffer: "pulse_trial",
          stripeSubscriptionLookupKey: "subscription_lookup_legacy_trial",
        },
        billingStatus: HostedBillingStatus.active,
        id: "member_123",
        identity: { phoneLookupKey: "hbidx:phone:v1:test" },
        routing: null,
        suspendedAt: null,
      },
    }));
    const stripeCustomerId = "cus_legacy_trial";
    const stripeSubscriptionId = "sub_legacy_trial";
    const prisma = makePrisma({
      billingRef: {
        currentBillingPhase: "trial",
        currentCheckoutOffer: "pulse_trial",
        memberId: "member_123",
        ...await buildHostedMemberBillingPrivateColumns({
          memberId: "member_123",
          stripeCustomerId,
          stripeSubscriptionId,
        }),
        stripeCustomerLookupKey:
          createHostedStripeCustomerLookupKey(stripeCustomerId),
        stripeSubscriptionLookupKey:
          createHostedStripeSubscriptionLookupKey(stripeSubscriptionId),
      },
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_SUBSCRIPTION_ALREADY_EXISTS",
      httpStatus: 409,
    });

    expect(mocks.requireHostedStripeCheckoutConfig).toHaveBeenCalledOnce();
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("rechecks Core eligibility after taking the billing lock", async () => {
    mocks.requireHostedStripeCheckoutConfig.mockReturnValue({
      billingPlanCode: "launch_group_monthly",
      priceId: "price_group_monthly_123",
      stripe: mocks.stripe,
      stripeLiveMode: false,
    });
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());

    const prisma = makePrisma({ hasConfirmedGroupMembership: false });
    await expect(createHostedBillingCheckout({
      billingPlanCode: "launch_group_monthly",
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_PLAN_NOT_ELIGIBLE",
      httpStatus: 409,
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(
      prisma.$queryRaw.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    ).toBeLessThan(
      prisma.hostedGroupMember.findFirst.mock.invocationCallOrder[0]
        ?? Number.NEGATIVE_INFINITY,
    );
  });

  it("allows standard Pulse checkout when legacy trial metadata exists", async () => {
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
        stripeCustomerLookupKey:
          createHostedStripeCustomerLookupKey("cus_existing"),
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
          /^hosted-billing-checkout:[^:]+:[a-f0-9]{32}$/,
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
          /^hosted-billing-checkout:[^:]+:[a-f0-9]{32}$/,
        ),
      }),
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

    const createCalls = mocks.stripe.checkout.sessions.create.mock.calls;
    expect(createCalls.length).toBeGreaterThanOrEqual(1);
    expect(createCalls.length).toBeLessThanOrEqual(2);
    const idempotencyKeys = new Set(
      createCalls.map((call) => call[1]?.idempotencyKey),
    );
    expect(idempotencyKeys.size).toBe(1);
    expect([...idempotencyKeys]).toEqual([
      expect.stringMatching(
        /^hosted-billing-checkout:[^:]+:[a-f0-9]{32}$/,
      ),
    ]);
    expect(mocks.stripe.checkout.sessions.retrieve.mock.calls.length)
      .toBeLessThanOrEqual(1);
  });

  it("rejects a different price while an earlier checkout is open", async () => {
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

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:05.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_ALREADY_OPEN",
      httpStatus: 409,
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a different verified email while an earlier checkout is open", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();

    await createHostedBillingCheckout({
      inviteCode: "invite-code",
      linkedAccounts: [{
        address: "first@example.test",
        type: "email",
        verified_at: 1_710_000_000,
      }],
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      linkedAccounts: [{
        address: "second@example.test",
        type: "email",
        verified_at: 1_710_000_000,
      }],
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:05.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_ALREADY_OPEN",
      httpStatus: 409,
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("rejects a newly bound Stripe customer while an earlier checkout is open", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();

    await createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    });

    const { stripeCustomerIdEncrypted } =
      await buildHostedMemberBillingPrivateColumns({
        memberId: "member_123",
        stripeCustomerId: "cus_late",
        stripeSubscriptionId: null,
      });
    prisma.setBillingRefState({
      stripeCustomerIdEncrypted,
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:late",
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:05.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_ALREADY_OPEN",
      httpStatus: 409,
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(mocks.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("clears the direct attempt when Family billing claims the member before Stripe creation", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    mocks.readHostedMemberFamilyBillingClaim
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        checkoutAttemptId: "family_attempt_123",
        groupId: "hbag_family",
        kind: "checkout_attempt",
        ownerMemberId: "member_owner",
      });
    const prisma = makePrisma();

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_FAMILY_BILLING_IN_PROGRESS",
      httpStatus: 409,
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(prisma.hostedMemberBillingRef.updateMany).toHaveBeenCalledWith({
      data: {
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutIntentHash: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
      },
      where: expect.objectContaining({
        checkoutAttemptId: expect.any(String),
        checkoutIntentHash: expect.any(String),
        memberId: "member_123",
        stripeCheckoutSessionLookupKey: null,
      }),
    });
  });

  it("keeps a completed bound session in syncing state instead of creating another checkout", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();

    await createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    });
    const firstRequest = mocks.stripe.checkout.sessions.create.mock.calls[0]?.[0];
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
      client_reference_id: "member_123",
      id: "cs_123",
      metadata: firstRequest?.metadata,
      mode: "subscription",
      status: "complete",
      url: null,
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:05.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_SYNCING",
      httpStatus: 409,
      retryable: true,
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
  });

  it("clears an expired bound session and creates one replacement attempt", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();

    await createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    });
    const firstRequest = mocks.stripe.checkout.sessions.create.mock.calls[0]?.[0];
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
      client_reference_id: "member_123",
      id: "cs_123",
      metadata: firstRequest?.metadata,
      mode: "subscription",
      status: "expired",
      url: null,
    });
    mocks.stripe.checkout.sessions.create.mockImplementationOnce(async (params) => ({
      client_reference_id: params.client_reference_id,
      id: "cs_restarted",
      metadata: params.metadata,
      mode: params.mode,
      status: "open",
      url: "https://billing.example.test/session_restarted",
    }));

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:05.000Z"),
      prisma: prisma as never,
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_restarted",
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(
      "cs_123",
    );
  });

  it("reuses the durable attempt and idempotency key after an ambiguous Stripe failure", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv(
      "HOSTED_LINQ_ALERT_EMAIL_FROM",
      "Murph Alerts <alerts@example.com>",
    );
    vi.stubEnv("HOSTED_LINQ_ALERT_EMAILS", "operator@example.com");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ id: "email_billing_failure" }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const recoveredSession = {
      client_reference_id: "member_123",
      id: "cs_recovered",
      metadata: {},
      mode: "subscription",
      status: "open",
      url: "https://billing.example.test/recovered",
    };
    mocks.stripe.checkout.sessions.create
      .mockRejectedValueOnce(Object.assign(
        new Error("connection closed after request"),
        {
          rawType: "api_connection_error",
          requestId: "req_billing_checkout_failed",
          statusCode: 503,
          type: "StripeConnectionError",
        },
      ))
      .mockImplementationOnce(async (params) => {
        recoveredSession.metadata = params.metadata;
        return recoveredSession;
      });

    await expect(createHostedBillingCheckout({
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
    })).rejects.toThrow("connection closed after request");
    expect(nextServerMocks.after).toHaveBeenCalledTimes(1);
    await nextServerMocks.after.mock.calls[0]?.[0]?.();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)))
      .toMatchObject({
        subject: "Murph Stripe operation failed — billing.checkout",
      });
    nextServerMocks.after.mockClear();

    await expect(createHostedBillingCheckout({
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
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/recovered",
    });
    expect(nextServerMocks.after).not.toHaveBeenCalled();

    const firstCall = mocks.stripe.checkout.sessions.create.mock.calls[0];
    const secondCall = mocks.stripe.checkout.sessions.create.mock.calls[1];
    expect(firstCall?.[1]?.idempotencyKey).toBe(
      secondCall?.[1]?.idempotencyKey,
    );
  });

  it("does not replay an unbound attempt past the Stripe idempotency window", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();
    mocks.stripe.checkout.sessions.create.mockRejectedValueOnce(
      new Error("connection closed after request"),
    );

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toThrow("connection closed after request");

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-28T11:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_RECOVERY_REQUIRED",
      httpStatus: 409,
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
  });

  it("preserves an idempotent Stripe session when binding fails indeterminately", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const prisma = makePrisma();
    const bindError = new Error("binding result unavailable");
    prisma.hostedMemberSubscriptionCheckout.create.mockRejectedValueOnce(
      bindError,
    );

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toBe(bindError);

    expect(mocks.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mocks.stripe.customers.del).not.toHaveBeenCalled();

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:05.000Z"),
      prisma: prisma as never,
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });

    const firstCall = mocks.stripe.checkout.sessions.create.mock.calls[0];
    const secondCall = mocks.stripe.checkout.sessions.create.mock.calls[1];
    expect(firstCall?.[1]).toEqual(secondCall?.[1]);
    expect(mocks.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
  });

  it("does not close the winning Session when a duplicate activates before bind", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const eligibleMember = {
      billingStatus: HostedBillingStatus.not_started,
      suspendedAt: null,
    };
    const prisma = makePrisma({
      memberFindUniqueResults: [
        eligibleMember,
        eligibleMember,
        {
          billingRef: {
            currentBillingPhase: "paid",
            currentCheckoutOffer: "standard",
            stripeSubscriptionLookupKey: "subscription_lookup_paid",
          },
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        },
      ],
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    })).resolves.toEqual({
      alreadyActive: true,
      url: null,
    });

    expect(mocks.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mocks.stripe.customers.del).not.toHaveBeenCalled();
    expect(
      prisma.hostedMemberSubscriptionCheckout.create,
    ).not.toHaveBeenCalled();
  });

  it("expires the Stripe session instead of returning it when account deletion wins", async () => {
    mocks.requireHostedInviteForBillingCheckout.mockResolvedValue(makeInvite());
    const eligibleMember = {
      billingStatus: HostedBillingStatus.not_started,
      suspendedAt: null,
    };
    const prisma = makePrisma({
      memberFindUniqueResults: [
        eligibleMember,
        eligibleMember,
        null,
      ],
    });

    await expect(createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
    });

    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_123");
    expect(prisma.hostedMemberBillingRef.updateMany).not.toHaveBeenCalled();
    expect(
      prisma.hostedMemberSubscriptionCheckout.create,
    ).not.toHaveBeenCalled();
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

type BillingRefFixture = {
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
  stripeEffectClaimId?: string | null;
  stripeCheckoutSessionIdEncrypted?: string | null;
  stripeCheckoutSessionLookupKey?: string | null;
  stripeCustomerIdEncrypted: string | null;
  stripeCustomerLookupKey: string | null;
  stripeSubscriptionIdEncrypted: string | null;
  stripeSubscriptionLookupKey: string | null;
};

function makePrisma(input: {
  billingRef?: BillingRefFixture | null;
  hasConfirmedGroupMembership?: boolean;
  member?: {
    billingStatus: HostedBillingStatus;
    suspendedAt: Date | null;
  } | null;
  memberBillingStatus?: HostedBillingStatus;
  memberFindUniqueResults?: Array<{
    billingRef?: {
      currentBillingPhase: string | null;
      currentCheckoutOffer: string | null;
      stripeSubscriptionLookupKey: string | null;
    } | null;
    billingStatus: HostedBillingStatus;
    suspendedAt: Date | null;
  } | null>;
} = {}) {
  const afterTransactionCallbacks: Array<() => Promise<void> | void> = [];
  let state: BillingRefFixture | null = input.billingRef
    ? {
        checkoutAttemptId: null,
        checkoutCreatedAt: null,
        checkoutIntentHash: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
        ...input.billingRef,
      }
    : null;
  const findUnique = vi.fn().mockImplementation(async () => state);
  const upsert = vi.fn().mockImplementation(async (inputData: {
    create: Partial<BillingRefFixture> & Pick<BillingRefFixture, "memberId">;
    update: Partial<BillingRefFixture>;
  }) => {
    state = state
      ? { ...state, ...inputData.update }
      : {
          ...inputData.create,
          stripeCheckoutSessionIdEncrypted:
            inputData.create.stripeCheckoutSessionIdEncrypted ?? null,
          stripeCheckoutSessionLookupKey:
            inputData.create.stripeCheckoutSessionLookupKey ?? null,
          stripeCustomerIdEncrypted:
            inputData.create.stripeCustomerIdEncrypted ?? null,
          stripeCustomerLookupKey:
            inputData.create.stripeCustomerLookupKey ?? null,
          stripeSubscriptionIdEncrypted:
            inputData.create.stripeSubscriptionIdEncrypted ?? null,
          stripeSubscriptionLookupKey:
            inputData.create.stripeSubscriptionLookupKey ?? null,
        };
    return state;
  });
  const updateMany = vi.fn().mockImplementation(async (inputData: {
    data: Partial<BillingRefFixture>;
    where: {
      checkoutAttemptId?: string;
      checkoutIntentHash?: string;
      memberId?: string;
      stripeCheckoutSessionLookupKey?: null | { in: string[] };
      stripeSubscriptionLookupKey?: null;
    };
  }) => {
    if (!state || !matchesBillingRefWhere(state, inputData.where)) {
      return { count: 0 };
    }
    state = { ...state, ...inputData.data };
    return { count: 1 };
  });
  const defaultMember = input.member === undefined
    ? {
        billingStatus:
          input.memberBillingStatus ?? HostedBillingStatus.not_started,
        suspendedAt: null,
      }
    : input.member;
  const memberFindUnique = vi.fn();
  if (input.memberFindUniqueResults) {
    for (const result of input.memberFindUniqueResults) {
      memberFindUnique.mockResolvedValueOnce(result);
    }
    memberFindUnique.mockResolvedValue(
      input.memberFindUniqueResults.at(-1) ?? null,
    );
  } else {
    memberFindUnique.mockImplementation(async () => defaultMember
      ? {
          ...defaultMember,
          billingRef: state
            ? {
                currentBillingPhase: state.currentBillingPhase ?? null,
                currentCheckoutOffer: state.currentCheckoutOffer ?? null,
                stripeEffectClaimId: state.stripeEffectClaimId ?? null,
                stripeSubscriptionLookupKey:
                  state.stripeSubscriptionLookupKey ?? null,
              }
            : null,
        }
      : null);
  }
  const lockQuery = vi.fn().mockResolvedValue([]);
  const prismaTx = {
    $queryRaw: lockQuery,
    hostedMember: {
      findUnique: memberFindUnique,
    },
    hostedGroupMember: {
      findFirst: vi.fn().mockResolvedValue(
        input.hasConfirmedGroupMembership ? { id: "group_member_123" } : null,
      ),
    },
    hostedMemberBillingRef: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique,
      updateMany,
      upsert,
    },
    hostedMemberSubscriptionCheckout: {
      create: vi.fn().mockResolvedValue({
        memberId: "member_123",
      }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
  let transactionTail = Promise.resolve();
  const transaction = vi.fn(
    (callback: (tx: typeof prismaTx) => Promise<unknown>) => {
      const result = transactionTail.then(async () => {
        const value = await callback(prismaTx);
        await afterTransactionCallbacks.shift()?.();
        return value;
      });
      transactionTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  );

  return {
    $queryRaw: lockQuery,
    $transaction: transaction,
    hostedGroupMember: prismaTx.hostedGroupMember,
    hostedMemberBillingRef: {
      findUnique,
      updateMany,
      upsert,
    },
    hostedMemberSubscriptionCheckout:
      prismaTx.hostedMemberSubscriptionCheckout,
    afterNextTransactionCommitted(
      callback: () => Promise<void> | void,
    ) {
      afterTransactionCallbacks.push(callback);
    },
    setBillingRefState(data: Partial<BillingRefFixture>) {
      if (!state) {
        throw new Error("Expected a hosted member billing ref fixture.");
      }
      state = {
        ...state,
        ...data,
      };
    },
  } as const;
}

function matchesBillingRefWhere(
  state: BillingRefFixture,
  where: {
    checkoutAttemptId?: string;
    checkoutIntentHash?: string;
    memberId?: string;
    stripeCheckoutSessionLookupKey?: null | { in: string[] };
    stripeSubscriptionLookupKey?: null;
  },
): boolean {
  if (
    where.checkoutAttemptId !== undefined
    && state.checkoutAttemptId !== where.checkoutAttemptId
  ) {
    return false;
  }
  if (
    where.checkoutIntentHash !== undefined
    && state.checkoutIntentHash !== where.checkoutIntentHash
  ) {
    return false;
  }
  if (where.memberId !== undefined && state.memberId !== where.memberId) {
    return false;
  }
  if (
    where.stripeSubscriptionLookupKey === null
    && state.stripeSubscriptionLookupKey !== null
  ) {
    return false;
  }
  if (where.stripeCheckoutSessionLookupKey === null) {
    return state.stripeCheckoutSessionLookupKey === null;
  }
  if (where.stripeCheckoutSessionLookupKey) {
    return Boolean(
      state.stripeCheckoutSessionLookupKey
      && where.stripeCheckoutSessionLookupKey.in.includes(
        state.stripeCheckoutSessionLookupKey,
      ),
    );
  }
  return true;
}

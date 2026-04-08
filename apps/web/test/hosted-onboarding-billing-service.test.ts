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
    requireHostedInviteForAuthentication: vi.fn(),
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
    requireHostedInviteForAuthentication: mocks.requireHostedInviteForAuthentication,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    encryptionKeyVersion: "v1",
    inviteTtlHours: 24,
    isProduction: false,
    linqApiBaseUrl: "https://linq.example.test",
    linqApiToken: "linq-token",
    linqWebhookSecret: null,
    privyAppId: "cm_app_123",
    privyVerificationKey: "privy-key",
    publicBaseUrl: "https://join.example.test",
    stripePriceId: "price_123",
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
    suspendedAt: Date | null;
  };
  memberId: string;
};

describe("createHostedBillingCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.requireHostedStripeCheckoutConfig.mockReturnValue({
      priceId: "price_123",
      stripe: mocks.stripe,
    });
    mocks.stripe.customers.create.mockResolvedValue({
      id: "cus_123",
    });
    mocks.stripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_123",
      url: "https://billing.example.test/session_123",
    });
  });

  it("returns alreadyActive when the invite member already has active billing", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
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

  it("creates a fresh Stripe Checkout Session keyed only by member metadata", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(makeInvite());
    const prisma = makePrisma();

    await expect(
      createHostedBillingCheckout({
        inviteCode: "invite-code",
        member: makeAuthenticatedMember(),
        now: new Date("2026-03-27T12:00:00.000Z"),
        prisma: prisma as never,
        shareCode: "share_123",
      }),
    ).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });

    expect(mocks.stripe.customers.create).toHaveBeenCalledWith(
      {
        metadata: {
          memberId: "member_123",
        },
      },
      {
        idempotencyKey: "hosted-onboarding:stripe-customer:member_123",
      },
    );
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cancel_url: "https://join.example.test/join/invite-code/cancel?share=share_123",
        client_reference_id: "member_123",
        customer: "cus_123",
        metadata: {
          memberId: "member_123",
        },
        subscription_data: {
          metadata: {
            memberId: "member_123",
          },
        },
        success_url:
          "https://join.example.test/join/invite-code/success?session_id={CHECKOUT_SESSION_ID}&share=share_123",
      }),
    );
    expect(mocks.stripe.checkout.sessions.create.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("reuses the existing durable Stripe customer binding for metering and checkout", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(makeInvite());
    const prisma = makePrisma({
      billingRef: {
        memberId: "member_123",
        ...buildHostedMemberBillingPrivateColumns({
          memberId: "member_123",
          stripeCustomerId: "cus_existing",
          stripeSubscriptionId: null,
        }),
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
    expect(mocks.stripe.customers.update).toHaveBeenCalledWith("cus_existing", {
      metadata: {
        memberId: "member_123",
      },
    });
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_existing",
      }),
    );
  });

  it("reuses the winning Stripe customer binding without a post-bind reread", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(makeInvite());
    const existingBinding = {
      memberId: "member_123",
      ...buildHostedMemberBillingPrivateColumns({
        memberId: "member_123",
        stripeCustomerId: "cus_raced",
        stripeSubscriptionId: null,
      }),
      stripeCustomerLookupKey: "hbidx:stripe-customer:v1:raced",
      stripeSubscriptionLookupKey: null,
    };
    const prisma = makePrisma({
      findUniqueResults: [
        null,
        existingBinding,
      ],
    });

    await createHostedBillingCheckout({
      inviteCode: "invite-code",
      member: makeAuthenticatedMember(),
      now: new Date("2026-03-27T12:00:00.000Z"),
      prisma: prisma as never,
    });

    expect(prisma.hostedMemberBillingRef.findUnique).toHaveBeenCalledTimes(2);
    expect(mocks.stripe.customers.update).toHaveBeenCalledWith("cus_raced", {
      metadata: {
        memberId: "member_123",
      },
    });
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_raced",
      }),
    );
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
      suspendedAt: null,
    },
    memberId: "member_123",
    ...overrides,
  };
}

function makePrisma(input: {
  billingRef?: {
    memberId: string;
    stripeCustomerIdEncrypted: string | null;
    stripeCustomerLookupKey: string | null;
    stripeSubscriptionIdEncrypted: string | null;
    stripeSubscriptionLookupKey: string | null;
  } | null;
  findUniqueResults?: Array<{
    memberId: string;
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

  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    hostedMemberBillingRef: {
      findUnique,
      upsert: vi.fn().mockImplementation(
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
      ),
    },
  } as const;
}

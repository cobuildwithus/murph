import { HostedBillingStatus, HostedMemberStatus } from "@prisma/client";
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
    getOptionalHostedPrivyIdentityFromCookies: vi.fn(),
    requireHostedInviteForAuthentication: vi.fn(),
    requireHostedOnboardingPublicBaseUrl: vi.fn(),
    requireHostedOnboardingStripeConfig: vi.fn(),
    requireHostedPrivyIdentityFromCookies: vi.fn(),
    stripe,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-service", () => ({
  requireHostedInviteForAuthentication: mocks.requireHostedInviteForAuthentication,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  getOptionalHostedPrivyIdentityFromCookies: mocks.getOptionalHostedPrivyIdentityFromCookies,
  requireHostedPrivyIdentityFromCookies: mocks.requireHostedPrivyIdentityFromCookies,
}));

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
    revnetChainId: 8453,
    revnetProjectId: "1",
    revnetRpcUrl: "https://rpc.example.test",
    revnetStripeCurrency: "usd",
    revnetTerminalAddress: "0x0000000000000000000000000000000000000001",
    revnetTreasuryPrivateKey: `0x${"11".repeat(32)}`,
    revnetWaitConfirmations: 1,
    revnetWeiPerStripeMinorUnit: "2000000000000",
    sessionCookieName: "hb_hosted_session",
    sessionTtlDays: 30,
    stripeBillingMode: "subscription",
    stripePriceId: "price_123",
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
  }),
  requireHostedOnboardingPublicBaseUrl: mocks.requireHostedOnboardingPublicBaseUrl,
  requireHostedOnboardingStripeConfig: mocks.requireHostedOnboardingStripeConfig,
}));

import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/billing-service";

const NOW = new Date("2026-03-27T12:00:00.000Z");

describe("createHostedBillingCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOptionalHostedPrivyIdentityFromCookies.mockResolvedValue(null);
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.requireHostedOnboardingStripeConfig.mockReturnValue({
      billingMode: "subscription",
      priceId: "price_123",
      stripe: mocks.stripe,
    });
    mocks.requireHostedPrivyIdentityFromCookies.mockResolvedValue({
      phone: {
        number: "+15551234567",
        verifiedAt: 1742990400,
      },
      userId: "did:privy:user_123",
      wallet: {
        address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        chainType: "ethereum",
        id: "wallet_123",
        type: "wallet",
      },
    });
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        walletAddress: null,
      }),
    );
    mocks.stripe.customers.create.mockResolvedValue({
      id: "cus_123",
    });
    mocks.stripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_123",
      subscription: "sub_123",
      url: "https://billing.example.test/session_123",
    });
  });

  it("sources a missing checkout wallet from the trusted Privy cookie instead of the request body", async () => {
    const prisma: any = {
      hostedBillingCheckout: {
        create: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        update: vi.fn().mockResolvedValue({}),
      },
    };

    const result = await createHostedBillingCheckout({
      inviteCode: "invite-code",
      now: NOW,
      prisma,
      sessionRecord: {
        member: {
          id: "member_123",
        },
      } as any,
    });

    expect(result).toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
    expect(mocks.requireHostedPrivyIdentityFromCookies).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          inviteId: "invite_123",
          memberId: "member_123",
        },
      }),
    );
    expect(prisma.hostedMember.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          stripeCustomerId: "cus_123",
          walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        }),
      }),
    );
  });

  it("rejects a new trusted wallet when the hosted member already has a different verified wallet", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    mocks.getOptionalHostedPrivyIdentityFromCookies.mockResolvedValue({
      phone: {
        number: "+15551234567",
        verifiedAt: 1742990400,
      },
      userId: "did:privy:user_123",
      wallet: {
        address: "0x00000000000000000000000000000000000000bb",
        chainType: "ethereum",
        id: "wallet_456",
        type: "wallet",
      },
    });

    await expect(
      createHostedBillingCheckout({
        inviteCode: "invite-code",
        now: NOW,
        prisma: {
          hostedBillingCheckout: {
            create: vi.fn(),
          },
          hostedMember: {
            update: vi.fn(),
          },
        } as any,
        sessionRecord: {
          member: {
            id: "member_123",
          },
        } as any,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_WALLET_ADDRESS_CONFLICT",
      httpStatus: 409,
    });
    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

function makeInvite(overrides: { walletAddress: string | null }) {
  return {
    id: "invite_123",
    inviteCode: "invite-code",
    member: {
      billingStatus: HostedBillingStatus.not_started,
      id: "member_123",
      normalizedPhoneNumber: "+15551234567",
      status: HostedMemberStatus.registered,
      stripeCustomerId: null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
      walletAddress: overrides.walletAddress,
    },
    memberId: "member_123",
  };
}

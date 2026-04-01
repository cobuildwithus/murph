import {
  HostedBillingCheckoutStatus,
  HostedBillingStatus,
  HostedMemberStatus,
  Prisma,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const stripe = {
    checkout: {
      sessions: {
        create: vi.fn(),
        retrieve: vi.fn(),
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
    requireHostedPrivyUserForSession: vi.fn(),
    stripe,
  };
});

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  requireHostedInviteForAuthentication: mocks.requireHostedInviteForAuthentication,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  requireHostedPrivyUserForSession: mocks.requireHostedPrivyUserForSession,
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
    revnetWeiPerStripeMinorUnit: "2000000000000",
    sessionCookieName: "hosted_session",
    sessionTtlDays: 30,
    stripeBillingMode: "subscription",
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

const NOW = new Date("2026-03-27T12:00:00.000Z");
type CreateHostedBillingCheckoutInput = Parameters<typeof createHostedBillingCheckout>[0];
type HostedBillingCheckoutPrisma = CreateHostedBillingCheckoutInput["prisma"];
type HostedBillingSessionRecord = NonNullable<CreateHostedBillingCheckoutInput["sessionRecord"]>;

describe("createHostedBillingCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.requireHostedStripeCheckoutConfig.mockReturnValue({
      billingMode: "subscription",
      priceId: "price_123",
      stripe: mocks.stripe,
    });
    mocks.requireHostedPrivyUserForSession.mockResolvedValue({
      linkedAccounts: [
        {
          address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
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
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({
      expires_at: Math.floor(new Date("2026-03-27T13:00:00.000Z").getTime() / 1000),
      id: "cs_123",
      status: "open",
      url: "https://billing.example.test/session_123",
    });
  });

  it("requires a stored hosted wallet before checkout instead of binding one from the current Privy cookie", async () => {
    const prisma = asHostedBillingCheckoutPrisma({
      hostedBillingCheckout: {
        create: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          id: "member_123",
          stripeCustomerId: null,
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await expect(
      createHostedBillingCheckout({
        cookieStore: { get: vi.fn() },
        inviteCode: "invite-code",
        now: NOW,
        prisma,
        sessionRecord: makeHostedSessionRecord("member_123"),
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_WALLET_ADDRESS_REQUIRED",
      httpStatus: 400,
    });

    expect(mocks.requireHostedPrivyUserForSession).toHaveBeenCalledWith(
      { get: expect.any(Function) },
      {
        member: {
          id: "member_123",
        },
      },
    );
    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.customers.update).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(prisma.hostedMember.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
  });

  it("keeps checkout wallet handling read-only and only binds the Stripe customer id", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    mocks.requireHostedPrivyUserForSession.mockResolvedValue({
      linkedAccounts: [
        {
          address: "0x00000000000000000000000000000000000000bb",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 1,
        },
        {
          address: "0x00000000000000000000000000000000000000aa",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_456",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    const prisma = asHostedBillingCheckoutPrisma({
      hostedBillingCheckout: {
        create: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          id: "member_123",
          stripeCustomerId: null,
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    const result = await createHostedBillingCheckout({
      cookieStore: { get: vi.fn() },
      inviteCode: "invite-code",
      now: NOW,
      prisma,
      sessionRecord: makeHostedSessionRecord("member_123"),
    });

    expect(result).toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
    const createdCustomerMetadata = mocks.stripe.customers.create.mock.calls[0]?.[0]?.metadata;
    expect(mocks.requireHostedPrivyUserForSession).toHaveBeenCalledWith(
      { get: expect.any(Function) },
      {
        member: {
          id: "member_123",
        },
      },
    );
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          inviteId: "invite_123",
          memberId: "member_123",
        },
      }),
      expect.objectContaining({
        idempotencyKey: "hosted-onboarding:stripe-checkout:member_123:invite_123:subscription:price_123:1",
      }),
    );
    expect(createdCustomerMetadata).toEqual({
      memberId: "member_123",
    });
    expect(createdCustomerMetadata).not.toHaveProperty("normalizedPhoneNumber");
    expect(createdCustomerMetadata).not.toHaveProperty("walletAddress");
    expect(prisma.hostedMember.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stripeCustomerId: "cus_123",
        }),
      }),
    );
    expect(prisma.hostedMember.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          stripeCustomerId: "cus_123",
        }),
      }),
    );
  });

  it("reuses an existing open checkout attempt instead of minting another Stripe session", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        stripeCustomerId: "cus_existing_123",
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({
      expires_at: Math.floor(new Date("2026-03-27T13:00:00.000Z").getTime() / 1000),
      id: "cs_existing_123",
      status: "open",
      url: "https://billing.example.test/existing-session",
    });
    mocks.requireHostedPrivyUserForSession.mockResolvedValue({
      linkedAccounts: [
        {
          address: "0x00000000000000000000000000000000000000aa",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    const prisma = asHostedBillingCheckoutPrisma({
      hostedBillingCheckout: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          checkoutUrl: "https://billing.example.test/existing-session",
          stripeCheckoutSessionId: "cs_existing_123",
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          id: "member_123",
          stripeCustomerId: "cus_existing_123",
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await expect(
      createHostedBillingCheckout({
        cookieStore: { get: vi.fn() },
        inviteCode: "invite-code",
        now: NOW,
        prisma,
        sessionRecord: makeHostedSessionRecord("member_123"),
      }),
    ).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/existing-session",
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_existing_123");
    expect(prisma.hostedBillingCheckout.create).not.toHaveBeenCalled();
    expect(prisma.hostedMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingStatus: HostedBillingStatus.checkout_open,
          stripeLatestCheckoutSessionId: "cs_existing_123",
        }),
      }),
    );
  });

  it("does not reuse an open checkout attempt when a share context is present", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        stripeCustomerId: "cus_existing_123",
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    mocks.requireHostedPrivyUserForSession.mockResolvedValue({
      linkedAccounts: [
        {
          address: "0x00000000000000000000000000000000000000aa",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    const prisma = asHostedBillingCheckoutPrisma({
      hostedBillingCheckout: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue({
          checkoutUrl: "https://billing.example.test/existing-session",
          stripeCheckoutSessionId: "cs_existing_123",
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          id: "member_123",
          stripeCustomerId: "cus_existing_123",
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    const result = await createHostedBillingCheckout({
      cookieStore: { get: vi.fn() },
      inviteCode: "invite-code",
      now: NOW,
      prisma,
      sessionRecord: makeHostedSessionRecord("member_123"),
      shareCode: "share_123",
    });

    expect(result).toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
    expect(prisma.hostedBillingCheckout.findFirst).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a share-created checkout for a later plain invite request", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        stripeCustomerId: "cus_existing_123",
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    mocks.requireHostedPrivyUserForSession.mockResolvedValue({
      linkedAccounts: [
        {
          address: "0x00000000000000000000000000000000000000aa",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    const prisma = asHostedBillingCheckoutPrisma({
      hostedBillingCheckout: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn(async ({ where }: { where: { hasShareContext: boolean } }) =>
          where.hasShareContext
            ? {
              checkoutUrl: "https://billing.example.test/share-session",
              stripeCheckoutSessionId: "cs_share_123",
            }
            : null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          id: "member_123",
          stripeCustomerId: "cus_existing_123",
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    const result = await createHostedBillingCheckout({
      cookieStore: { get: vi.fn() },
      inviteCode: "invite-code",
      now: NOW,
      prisma,
      sessionRecord: makeHostedSessionRecord("member_123"),
    });

    expect(result).toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
    expect(prisma.hostedBillingCheckout.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          hasShareContext: false,
        }),
      }),
    );
    expect(mocks.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("expires a locally-open checkout attempt when Stripe reports the session is no longer open", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        stripeCustomerId: "cus_existing_123",
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    mocks.requireHostedPrivyUserForSession.mockResolvedValue({
      linkedAccounts: [
        {
          address: "0x00000000000000000000000000000000000000aa",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({
      expires_at: Math.floor(new Date("2026-03-27T11:00:00.000Z").getTime() / 1000),
      id: "cs_existing_123",
      status: "expired",
      url: null,
    });

    const prisma = asHostedBillingCheckoutPrisma({
      hostedBillingCheckout: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue({
          checkoutUrl: "https://billing.example.test/existing-session",
          stripeCheckoutSessionId: "cs_existing_123",
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          id: "member_123",
          stripeCustomerId: "cus_existing_123",
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    const result = await createHostedBillingCheckout({
      cookieStore: { get: vi.fn() },
      inviteCode: "invite-code",
      now: NOW,
      prisma,
      sessionRecord: makeHostedSessionRecord("member_123"),
    });

    expect(result).toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
    expect(prisma.hostedBillingCheckout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: HostedBillingCheckoutStatus.expired,
        }),
      }),
    );
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("reuses a checked Stripe session after a concurrent P2002 during checkout creation", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        stripeCustomerId: "cus_existing_123",
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    mocks.requireHostedPrivyUserForSession.mockResolvedValue({
      linkedAccounts: [
        {
          address: "0x00000000000000000000000000000000000000aa",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({
      expires_at: Math.floor(new Date("2026-03-27T13:00:00.000Z").getTime() / 1000),
      id: "cs_existing_123",
      status: "open",
      url: "https://billing.example.test/existing-session",
    });

    const prisma = withHostedBillingTransaction({
      hostedBillingCheckout: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError("conflict", {
            clientVersion: "test",
            code: "P2002",
          }),
        ),
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            checkoutUrl: "https://billing.example.test/existing-session",
            stripeCheckoutSessionId: "cs_existing_123",
          }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          id: "member_123",
          stripeCustomerId: "cus_existing_123",
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    const result = await createHostedBillingCheckout({
      cookieStore: { get: vi.fn() },
      inviteCode: "invite-code",
      now: NOW,
      prisma,
      sessionRecord: makeHostedSessionRecord("member_123"),
    });

    expect(result).toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/existing-session",
    });
    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_existing_123");
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("updates an existing Stripe customer without writing phone or wallet values into metadata", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        stripeCustomerId: "cus_existing_123",
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    mocks.requireHostedPrivyUserForSession.mockResolvedValue({
      linkedAccounts: [
        {
          address: "0x00000000000000000000000000000000000000aa",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    const prisma = asHostedBillingCheckoutPrisma({
      hostedBillingCheckout: {
        create: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          id: "member_123",
          stripeCustomerId: "cus_existing_123",
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await createHostedBillingCheckout({
      cookieStore: { get: vi.fn() },
      inviteCode: "invite-code",
      now: NOW,
      prisma,
      sessionRecord: makeHostedSessionRecord("member_123"),
    });

    const updatedCustomerMetadata = mocks.stripe.customers.update.mock.calls[0]?.[1]?.metadata;

    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.customers.update).toHaveBeenCalledWith(
      "cus_existing_123",
      expect.objectContaining({
        metadata: {
          memberId: "member_123",
        },
      }),
    );
    expect(updatedCustomerMetadata).toEqual({
      memberId: "member_123",
    });
    expect(updatedCustomerMetadata).not.toHaveProperty("normalizedPhoneNumber");
    expect(updatedCustomerMetadata).not.toHaveProperty("walletAddress");
  });

  it("rejects a new trusted wallet when the hosted member already has a different verified wallet", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    mocks.requireHostedPrivyUserForSession.mockResolvedValue({
      linkedAccounts: [
        {
          address: "0x00000000000000000000000000000000000000bb",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_456",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    await expect(
      createHostedBillingCheckout({
        cookieStore: { get: vi.fn() },
        inviteCode: "invite-code",
        now: NOW,
        prisma: asHostedBillingCheckoutPrisma({
          hostedBillingCheckout: {
            create: vi.fn(),
            findFirst: vi.fn(),
          },
          hostedMember: {
            update: vi.fn(),
          },
        }),
        sessionRecord: makeHostedSessionRecord("member_123"),
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_WALLET_ADDRESS_CONFLICT",
      httpStatus: 409,
    });
    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("fails closed before any Stripe calls when the shared Privy session check fails", async () => {
    mocks.requireHostedPrivyUserForSession.mockRejectedValue({
      code: "PRIVY_SESSION_MISMATCH",
      httpStatus: 403,
      message: "This Privy session does not match the current hosted account. Reopen the latest invite and try again.",
    });

    await expect(
      createHostedBillingCheckout({
        cookieStore: { get: vi.fn() },
        inviteCode: "invite-code",
        now: NOW,
        prisma: asHostedBillingCheckoutPrisma({
          hostedBillingCheckout: {
            create: vi.fn(),
            findFirst: vi.fn(),
          },
          hostedMember: {
            findUnique: vi.fn(),
            update: vi.fn(),
            updateMany: vi.fn(),
          },
        }),
        sessionRecord: makeHostedSessionRecord("member_123"),
      }),
    ).rejects.toMatchObject({
      code: "PRIVY_SESSION_MISMATCH",
      httpStatus: 403,
    });
    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.customers.update).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

function makeInvite(overrides: {
  stripeCustomerId?: string | null;
  walletAddress: string | null;
}) {
  return {
    id: "invite_123",
    inviteCode: "invite-code",
    member: {
      billingStatus: HostedBillingStatus.not_started,
      id: "member_123",
      normalizedPhoneNumber: "+15551234567",
      status: HostedMemberStatus.registered,
      stripeCustomerId: overrides.stripeCustomerId ?? null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
      walletAddress: overrides.walletAddress,
    },
    memberId: "member_123",
  };
}

function asHostedBillingCheckoutPrisma<T extends Record<string, unknown>>(prisma: T): T & HostedBillingCheckoutPrisma {
  return prisma as T & HostedBillingCheckoutPrisma;
}

function makeHostedSessionRecord(memberId: string): HostedBillingSessionRecord {
  return {
    member: {
      id: memberId,
    },
  } as unknown as HostedBillingSessionRecord;
}

function withHostedBillingTransaction<T extends Record<string, unknown>>(prisma: T): T & HostedBillingCheckoutPrisma {
  const prismaWithTransaction = asHostedBillingCheckoutPrisma(prisma) as T & HostedBillingCheckoutPrisma;
  const transaction = vi.fn(
    async (callback: (tx: T & HostedBillingCheckoutPrisma) => Promise<unknown>) => callback(prismaWithTransaction),
  );
  (prismaWithTransaction as { $transaction?: unknown }).$transaction = transaction;
  return prismaWithTransaction;
}

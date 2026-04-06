import {
  HostedBillingMode,
  HostedBillingCheckoutStatus,
  HostedBillingStatus,
  HostedMemberStatus,
} from "@prisma/client";
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
    revnetChainId: 8453,
    revnetProjectId: "1",
    revnetRpcUrl: "https://rpc.example.test",
    revnetStripeCurrency: "usd",
    revnetTerminalAddress: "0x0000000000000000000000000000000000000001",
    revnetTreasuryPrivateKey: `0x${"11".repeat(32)}`,
    revnetWeiPerStripeMinorUnit: "2000000000000",
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
type MockHostedWalletAccount = {
  address: string;
  chain_type: "ethereum";
  connector_type: "embedded";
  delegated: boolean;
  id: string;
  imported: boolean;
  type: "wallet";
  wallet_client: "privy";
  wallet_client_type: "privy";
  wallet_index: number;
};

const DEFAULT_LINKED_ACCOUNTS: readonly MockHostedWalletAccount[] = [
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
] as const;

describe("createHostedBillingCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue("https://join.example.test");
    mocks.requireHostedStripeCheckoutConfig.mockReturnValue({
      billingMode: "subscription",
      priceId: "price_123",
      stripe: mocks.stripe,
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
        findUnique: vi.fn().mockResolvedValue({
          id: "checkout_123",
          mode: "subscription",
          status: HostedBillingCheckoutStatus.pending,
        }),
        update: vi.fn().mockResolvedValue({}),
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
        inviteCode: "invite-code",
        ...makeCheckoutAuth(),
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_WALLET_ADDRESS_REQUIRED",
      httpStatus: 400,
    });
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
    const linkedAccounts = [
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
    ] as const;

    const createPendingCheckout = vi.fn(async ({ data }) => data);
    const hostedMemberBillingRefUpsert = vi.fn().mockResolvedValue({});
    const prisma = asHostedBillingCheckoutPrisma({
      hostedBillingCheckout: {
        create: createPendingCheckout,
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(makePendingCheckout()),
        update: vi.fn().mockResolvedValue({}),
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
      hostedMemberBillingRef: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: hostedMemberBillingRefUpsert,
      },
    });

    const result = await createHostedBillingCheckout({
      inviteCode: "invite-code",
      ...makeCheckoutAuth(linkedAccounts),
      now: NOW,
      prisma,
    });

    expect(result).toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
    const createdCustomerMetadata = mocks.stripe.customers.create.mock.calls[0]?.[0]?.metadata;
    const createdCheckoutId = createPendingCheckout.mock.calls[0]?.[0]?.data?.id;
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          checkoutId: createdCheckoutId,
          inviteId: "invite_123",
          memberId: "member_123",
        },
      }),
      expect.objectContaining({
        idempotencyKey: `hosted-onboarding:stripe-checkout:${createdCheckoutId}`,
      }),
    );
    expect(createdCustomerMetadata).toEqual({
      memberId: "member_123",
    });
    expect(createdCustomerMetadata).not.toHaveProperty("phoneLookupKey");
    expect(createdCustomerMetadata).not.toHaveProperty("walletAddress");
    expect(hostedMemberBillingRefUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          stripeCustomerId: "cus_123",
        }),
      }),
    );
    expect(prisma.hostedMember.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.checkout_open,
        }),
      }),
    );
  });

  it("reuses an existing open checkout attempt instead of minting another Stripe session", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        stripeCustomerId: null,
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({
      expires_at: Math.floor(new Date("2026-03-27T13:00:00.000Z").getTime() / 1000),
      id: "cs_existing_123",
      status: "open",
      url: "https://billing.example.test/existing-session",
    });
    const linkedAccounts = [
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
    ] as const;

    const prisma = asHostedBillingCheckoutPrisma({
      hostedBillingCheckout: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          hasShareContext: false,
          id: "checkout_existing",
          inviteId: "invite_123",
          checkoutUrl: "https://billing.example.test/existing-session",
          memberId: "member_123",
          mode: "subscription",
          priceId: "price_123",
          stripeCheckoutSessionId: "cs_existing_123",
          status: HostedBillingCheckoutStatus.open,
        }),
        findUnique: vi.fn(),
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
      hostedMemberBillingRef: {
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          stripeCustomerId: "cus_existing_123",
          stripeLatestBillingEventCreatedAt: null,
          stripeLatestBillingEventId: null,
          stripeLatestCheckoutSessionId: null,
          stripeSubscriptionId: null,
        }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });

    await expect(
      createHostedBillingCheckout({
        inviteCode: "invite-code",
        ...makeCheckoutAuth(linkedAccounts),
        now: NOW,
        prisma,
      }),
    ).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/existing-session",
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_existing_123");
    expect(prisma.hostedBillingCheckout.create).not.toHaveBeenCalled();
    expect(prisma.hostedMember.update).toHaveBeenCalledTimes(1);
    expect(prisma.hostedMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingStatus: HostedBillingStatus.checkout_open,
        }),
      }),
    );
    expect(prisma.hostedMemberBillingRef.upsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: {
        memberId: "member_123",
        stripeCustomerId: "cus_existing_123",
        stripeLatestBillingEventCreatedAt: null,
        stripeLatestBillingEventId: null,
        stripeLatestCheckoutSessionId: "cs_existing_123",
        stripeSubscriptionId: null,
      },
      update: {
        stripeCustomerId: "cus_existing_123",
        stripeLatestCheckoutSessionId: "cs_existing_123",
      },
    });
  });

  it("does not reuse an open checkout attempt when a share context is present", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        stripeCustomerId: "cus_existing_123",
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    const linkedAccounts = [
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
    ] as const;

    const prisma = asHostedBillingCheckoutPrisma({
      hostedBillingCheckout: {
        create: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue({
          hasShareContext: false,
          id: "checkout_existing",
          inviteId: "invite_123",
          checkoutUrl: "https://billing.example.test/existing-session",
          memberId: "member_123",
          mode: "subscription",
          priceId: "price_123",
          stripeCheckoutSessionId: "cs_existing_123",
          status: HostedBillingCheckoutStatus.open,
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
        inviteCode: "invite-code",
        ...makeCheckoutAuth(linkedAccounts),
        now: NOW,
        prisma,
        shareCode: "share_123",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_ALREADY_OPEN",
      httpStatus: 409,
    });
    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_existing_123");
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("does not reuse a share-created checkout for a later plain invite request", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        stripeCustomerId: "cus_existing_123",
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    const linkedAccounts = [
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
    ] as const;

    const prisma = asHostedBillingCheckoutPrisma({
      hostedBillingCheckout: {
        create: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue({
          hasShareContext: true,
          id: "checkout_share",
          inviteId: "invite_123",
          checkoutUrl: "https://billing.example.test/share-session",
          memberId: "member_123",
          mode: "subscription",
          priceId: "price_123",
          stripeCheckoutSessionId: "cs_share_123",
          status: HostedBillingCheckoutStatus.open,
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
        inviteCode: "invite-code",
        ...makeCheckoutAuth(linkedAccounts),
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_BILLING_CHECKOUT_ALREADY_OPEN",
      httpStatus: 409,
    });
    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_share_123");
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("expires a locally-open checkout attempt when Stripe reports the session is no longer open", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        stripeCustomerId: "cus_existing_123",
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    const linkedAccounts = [
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
    ] as const;
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue({
      expires_at: Math.floor(new Date("2026-03-27T11:00:00.000Z").getTime() / 1000),
      id: "cs_existing_123",
      status: "expired",
      url: null,
    });

    const prisma = asHostedBillingCheckoutPrisma({
      hostedBillingCheckout: {
        create: vi.fn(async ({ data }) => data),
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            hasShareContext: false,
            id: "checkout_existing",
            inviteId: "invite_123",
            checkoutUrl: "https://billing.example.test/existing-session",
            memberId: "member_123",
            mode: "subscription",
            priceId: "price_123",
            stripeCheckoutSessionId: "cs_existing_123",
            status: HostedBillingCheckoutStatus.open,
          })
          .mockResolvedValueOnce(null),
        findUnique: vi.fn().mockResolvedValue(makePendingCheckout()),
        update: vi.fn().mockResolvedValue({}),
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
      inviteCode: "invite-code",
      ...makeCheckoutAuth(linkedAccounts),
      now: NOW,
      prisma,
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

  it("retries Stripe creation from the same pending reservation using the reservation idempotency key", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        stripeCustomerId: "cus_existing_123",
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    const linkedAccounts = [
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
    ] as const;
    const prisma = withHostedBillingTransaction({
      hostedBillingCheckout: {
        findFirst: vi.fn()
          .mockResolvedValue({
            hasShareContext: false,
            id: "checkout_pending",
            inviteId: "invite_123",
            checkoutUrl: null,
            memberId: "member_123",
            mode: "subscription",
            priceId: "price_123",
            stripeCheckoutSessionId: null,
            status: HostedBillingCheckoutStatus.pending,
          }),
        findUnique: vi.fn().mockResolvedValue({
          id: "checkout_pending",
          mode: "subscription",
          status: HostedBillingCheckoutStatus.pending,
        }),
        update: vi.fn().mockResolvedValue({}),
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
      inviteCode: "invite-code",
      ...makeCheckoutAuth(linkedAccounts),
      now: NOW,
      prisma,
    });

    expect(result).toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        idempotencyKey: "hosted-onboarding:stripe-checkout:checkout_pending",
      }),
    );
  });

  it("marks the pending reservation failed if Stripe returns a session without a redirect url", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        stripeCustomerId: "cus_existing_123",
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    const linkedAccounts = [
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
    ] as const;
    mocks.stripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_missing_url",
      subscription: null,
      url: null,
    });

    const prisma = withHostedBillingTransaction({
      hostedBillingCheckout: {
        create: vi.fn().mockResolvedValue({
          id: "checkout_pending",
          mode: "subscription",
          status: HostedBillingCheckoutStatus.pending,
        }),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue({
          id: "checkout_pending",
          mode: "subscription",
          status: HostedBillingCheckoutStatus.pending,
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          stripeCustomerId: "cus_existing_123",
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await expect(
      createHostedBillingCheckout({
        inviteCode: "invite-code",
        ...makeCheckoutAuth(linkedAccounts),
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "CHECKOUT_URL_MISSING",
      httpStatus: 502,
    });
    expect(prisma.hostedBillingCheckout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: HostedBillingCheckoutStatus.failed,
          stripeCheckoutSessionId: "cs_missing_url",
        }),
        where: expect.objectContaining({
          id: "checkout_pending",
          status: {
            in: [HostedBillingCheckoutStatus.pending],
          },
        }),
      }),
    );
  });

  it("updates an existing Stripe customer without writing phone or wallet values into metadata", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        stripeCustomerId: null,
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    const linkedAccounts = [
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
    ] as const;

    const prisma = asHostedBillingCheckoutPrisma({
      hostedBillingCheckout: {
        create: vi.fn(async ({ data }) => data),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(makePendingCheckout()),
        update: vi.fn().mockResolvedValue({}),
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
      hostedMemberBillingRef: {
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          stripeCustomerId: "cus_existing_123",
          stripeLatestBillingEventCreatedAt: null,
          stripeLatestBillingEventId: null,
          stripeLatestCheckoutSessionId: null,
          stripeSubscriptionId: null,
        }),
      },
    });

    await createHostedBillingCheckout({
      inviteCode: "invite-code",
      ...makeCheckoutAuth(linkedAccounts),
      now: NOW,
      prisma,
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
    expect(updatedCustomerMetadata).not.toHaveProperty("phoneLookupKey");
    expect(updatedCustomerMetadata).not.toHaveProperty("walletAddress");
  });

  it("rejects a new trusted wallet when the hosted member already has a different verified wallet", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue(
      makeInvite({
        walletAddress: "0x00000000000000000000000000000000000000aa",
      }),
    );
    const linkedAccounts = [
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
    ] as const;

    await expect(
      createHostedBillingCheckout({
        inviteCode: "invite-code",
        ...makeCheckoutAuth(linkedAccounts),
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
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_WALLET_ADDRESS_CONFLICT",
      httpStatus: 409,
    });
    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("fails closed before any Stripe calls when request auth is missing", async () => {
    await expect(
      createHostedBillingCheckout({
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
      }),
    ).rejects.toThrow("Hosted billing checkout requires member and linkedAccounts from Privy request auth.");
    expect(mocks.stripe.customers.create).not.toHaveBeenCalled();
    expect(mocks.stripe.customers.update).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("fails closed when the invite is missing split identity state", async () => {
    mocks.requireHostedInviteForAuthentication.mockResolvedValue({
      id: "invite_123",
      inviteCode: "invite-code",
      member: {
        billingStatus: HostedBillingStatus.not_started,
        identity: null,
        id: "member_123",
        status: HostedMemberStatus.registered,
      },
      memberId: "member_123",
    });

    await expect(
      createHostedBillingCheckout({
        inviteCode: "invite-code",
        ...makeCheckoutAuth(),
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
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_MEMBER_IDENTITY_MISSING",
      httpStatus: 500,
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
      identity: {
        walletAddress: overrides.walletAddress,
      },
      id: "member_123",
      status: HostedMemberStatus.registered,
    },
    memberId: "member_123",
  };
}

function asHostedBillingCheckoutPrisma<T extends Record<string, unknown>>(prisma: T): T & HostedBillingCheckoutPrisma {
  const prismaWithQueryRaw = prisma as T & HostedBillingCheckoutPrisma;
  if ("hostedBillingCheckout" in prismaWithQueryRaw && prismaWithQueryRaw.hostedBillingCheckout) {
    const hostedBillingCheckout = prismaWithQueryRaw.hostedBillingCheckout as unknown as Record<string, unknown>;
    hostedBillingCheckout.create ??= vi.fn(async ({ data }) => data);
    hostedBillingCheckout.findFirst ??= vi.fn().mockResolvedValue(null);
    hostedBillingCheckout.findUnique ??= vi.fn().mockResolvedValue(null);
    hostedBillingCheckout.update ??= vi.fn().mockResolvedValue({});
    hostedBillingCheckout.updateMany ??= vi.fn().mockResolvedValue({ count: 0 });
  }
  if ("hostedMember" in prismaWithQueryRaw && prismaWithQueryRaw.hostedMember) {
    const hostedMember = prismaWithQueryRaw.hostedMember as unknown as Record<string, unknown>;
    hostedMember.findUnique ??= vi.fn().mockResolvedValue(null);
    hostedMember.update ??= vi.fn().mockResolvedValue({});
    hostedMember.updateMany ??= vi.fn().mockResolvedValue({ count: 0 });
  }
  if (!("hostedMemberBillingRef" in prismaWithQueryRaw) || !prismaWithQueryRaw.hostedMemberBillingRef) {
    Object.defineProperty(prismaWithQueryRaw, "hostedMemberBillingRef", {
      configurable: true,
      value: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
  } else {
    const hostedMemberBillingRef =
      prismaWithQueryRaw.hostedMemberBillingRef as unknown as Record<string, unknown>;
    hostedMemberBillingRef.findUnique ??= vi.fn().mockResolvedValue(null);
    hostedMemberBillingRef.upsert ??= vi.fn().mockResolvedValue({});
  }
  if (!("$queryRaw" in prismaWithQueryRaw)) {
    Object.defineProperty(prismaWithQueryRaw, "$queryRaw", {
      configurable: true,
      value: vi.fn(async () => []),
    });
  }
  return prismaWithQueryRaw;
}

function makeCheckoutAuth(
  linkedAccounts: readonly MockHostedWalletAccount[] = DEFAULT_LINKED_ACCOUNTS,
  memberId = "member_123",
) {
  return {
    linkedAccounts,
    member: {
      id: memberId,
    } as never,
  };
}

function makePendingCheckout(overrides: Record<string, unknown> = {}) {
  return {
    checkoutUrl: null,
    hasShareContext: false,
    id: "checkout_pending",
    inviteId: "invite_123",
    memberId: "member_123",
    mode: "subscription",
    priceId: "price_123",
    status: HostedBillingCheckoutStatus.pending,
    stripeCheckoutSessionId: null,
    stripeCustomerId: "cus_existing_123",
    stripeSubscriptionId: null,
    ...overrides,
  };
}

function withHostedBillingTransaction<T extends Record<string, unknown>>(prisma: T): T & HostedBillingCheckoutPrisma {
  const prismaWithTransaction = asHostedBillingCheckoutPrisma(prisma) as T & HostedBillingCheckoutPrisma;
  const transaction = vi.fn(
    async (callback: (tx: T & HostedBillingCheckoutPrisma) => Promise<unknown>) => callback(prismaWithTransaction),
  );
  (prismaWithTransaction as { $transaction?: unknown }).$transaction = transaction;
  return prismaWithTransaction;
}

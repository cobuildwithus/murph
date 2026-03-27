import { HostedBillingStatus, HostedInviteStatus, HostedMemberStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedPrivyIdentity } from "@/src/lib/hosted-onboarding/privy";

const mocks = vi.hoisted(() => ({
  createHostedSession: vi.fn(),
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
    privyVerificationKey: "privy-verification-key",
    publicBaseUrl: "https://join.example.test",
    sessionCookieName: "hb_hosted_session",
    sessionTtlDays: 30,
    stripeBillingMode: "payment",
    stripePriceId: "price_123",
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
  }),
  getHostedOnboardingSecretCodec: () => ({
    encrypt: (value: string) => `enc:${value}`,
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
}));

vi.mock("@/src/lib/hosted-onboarding/session", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/session")>(
    "@/src/lib/hosted-onboarding/session",
  );

  return {
    ...actual,
    createHostedSession: mocks.createHostedSession,
  };
});

import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/service";

const NOW = new Date("2026-03-26T12:00:00.000Z");

function makeIdentity(overrides: Partial<HostedPrivyIdentity> = {}) {
  return {
    ...baseIdentity(),
    ...overrides,
    phone: {
      ...baseIdentity().phone,
      ...(overrides.phone ?? {}),
    },
    wallet: {
      ...baseIdentity().wallet,
      ...(overrides.wallet ?? {}),
    },
  };
}

function baseIdentity(): HostedPrivyIdentity {
  return {
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
  };
}

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    billingMode: null,
    billingStatus: HostedBillingStatus.not_started,
    createdAt: NOW,
    encryptedBootstrapSecret: null,
    encryptionKeyVersion: null,
    id: "member_123",
    linqChatId: null,
    normalizedPhoneNumber: "+15551234567",
    phoneNumber: "+15551234567",
    phoneNumberVerifiedAt: null,
    privyUserId: null,
    status: HostedMemberStatus.invited,
    stripeCustomerId: null,
    stripeLatestCheckoutSessionId: null,
    stripeSubscriptionId: null,
    updatedAt: NOW,
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
    ...overrides,
  };
}

function makeInvite(member: ReturnType<typeof makeMember>, overrides: Record<string, unknown> = {}) {
  return {
    authenticatedAt: null,
    channel: "linq",
    checkouts: [],
    createdAt: NOW,
    expiresAt: new Date("2026-03-27T12:00:00.000Z"),
    id: "invite_123",
    inviteCode: "invite-code",
    linqChatId: null,
    linqEventId: null,
    member,
    memberId: member.id,
    openedAt: NOW,
    paidAt: null,
    sentAt: NOW,
    status: HostedInviteStatus.opened,
    triggerText: null,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("completeHostedPrivyVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedSession.mockResolvedValue({
      expiresAt: new Date("2026-04-25T12:00:00.000Z"),
      sessionId: "session_123",
      token: "session-token",
    });
  });

  it("binds a verified Privy identity onto an invite-bound member and creates a hosted session", async () => {
    const inviteMember = makeMember();
    const invite = makeInvite(inviteMember);
    const prisma: any = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...inviteMember,
          ...data,
        })),
      },
    };

    const result = await completeHostedPrivyVerification({
      identity: makeIdentity(),
      inviteCode: "invite-code",
      now: NOW,
      prisma,
      userAgent: "test-agent",
    });

    expect(prisma.hostedMember.update).toHaveBeenCalledWith({
      where: {
        id: "member_123",
      },
      data: expect.objectContaining({
        normalizedPhoneNumber: "+15551234567",
        phoneNumberVerifiedAt: NOW,
        privyUserId: "did:privy:user_123",
        status: HostedMemberStatus.registered,
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        walletChainType: "ethereum",
        walletCreatedAt: NOW,
        walletProvider: "privy",
      }),
    });
    expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: "invite_123",
      },
      data: {
        authenticatedAt: NOW,
        status: HostedInviteStatus.authenticated,
      },
    });
    expect(mocks.createHostedSession).toHaveBeenCalledWith({
      inviteId: "invite_123",
      memberId: "member_123",
      now: NOW,
      prisma,
      userAgent: "test-agent",
    });
    expect(result).toEqual({
      expiresAt: new Date("2026-04-25T12:00:00.000Z"),
      inviteCode: "invite-code",
      joinUrl: "https://join.example.test/join/invite-code",
      stage: "checkout",
      token: "session-token",
    });
  });

  it("creates a hosted member and a web invite for a new public phone signup", async () => {
    const createdMember = makeMember({
      id: "member_new",
      normalizedPhoneNumber: "+15551234567",
      phoneNumberVerifiedAt: NOW,
      privyUserId: "did:privy:user_123",
      status: HostedMemberStatus.registered,
      walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      walletChainType: "ethereum",
      walletCreatedAt: NOW,
      walletProvider: "privy",
    });
    const createdInvite = makeInvite(createdMember, {
      channel: "web",
      id: "invite_new",
      inviteCode: "public-invite-code",
      memberId: "member_new",
      status: HostedInviteStatus.pending,
    });
    const prisma: any = {
      hostedInvite: {
        create: vi.fn().mockResolvedValue(createdInvite),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue(createdMember),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const result = await completeHostedPrivyVerification({
      identity: makeIdentity(),
      now: NOW,
      prisma,
      userAgent: "public-agent",
    });

    expect(prisma.hostedMember.findUnique).toHaveBeenCalledTimes(3);
    expect(prisma.hostedMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        billingStatus: HostedBillingStatus.not_started,
        normalizedPhoneNumber: "+15551234567",
        phoneNumber: "+15551234567",
        phoneNumberVerifiedAt: NOW,
        privyUserId: "did:privy:user_123",
        status: HostedMemberStatus.registered,
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        walletChainType: "ethereum",
        walletCreatedAt: NOW,
        walletProvider: "privy",
      }),
    });
    expect(prisma.hostedInvite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: "web",
        linqChatId: null,
        linqEventId: null,
        memberId: "member_new",
        status: HostedInviteStatus.pending,
        triggerText: null,
      }),
    });
    expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: "invite_new",
      },
      data: {
        authenticatedAt: NOW,
        status: HostedInviteStatus.authenticated,
      },
    });
    expect(mocks.createHostedSession).toHaveBeenCalledWith({
      inviteId: "invite_new",
      memberId: "member_new",
      now: NOW,
      prisma,
      userAgent: "public-agent",
    });
    expect(result.joinUrl).toBe("https://join.example.test/join/public-invite-code");
    expect(result.inviteCode).toBe("public-invite-code");
    expect(result.stage).toBe("checkout");
  });

  it("marks an already-active invite flow as paid and preserves the paid timestamp", async () => {
    const activeMember = makeMember({
      billingStatus: HostedBillingStatus.active,
      phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
      privyUserId: "did:privy:user_123",
      status: HostedMemberStatus.active,
      walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      walletChainType: "ethereum",
      walletCreatedAt: new Date("2026-03-20T12:00:00.000Z"),
      walletProvider: "privy",
    });
    const invite = makeInvite(activeMember, {
      paidAt: new Date("2026-03-21T12:00:00.000Z"),
      status: HostedInviteStatus.paid,
    });
    const prisma: any = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedMember: {
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...activeMember,
          ...data,
        })),
      },
    };

    const result = await completeHostedPrivyVerification({
      identity: makeIdentity(),
      inviteCode: "invite-code",
      now: NOW,
      prisma,
      userAgent: "active-agent",
    });

    expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: "invite_123",
      },
      data: {
        authenticatedAt: NOW,
        paidAt: new Date("2026-03-21T12:00:00.000Z"),
        status: HostedInviteStatus.paid,
      },
    });
    expect(result.stage).toBe("active");
  });

  it("rejects a verified phone that conflicts across two existing hosted members", async () => {
    const phoneMember = makeMember({ id: "member_phone" });
    const walletMember = makeMember({
      id: "member_wallet",
      normalizedPhoneNumber: "+15557654321",
      phoneNumber: "+15557654321",
      walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    });
    const prisma: any = {
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.privyUserId) {
            return null;
          }

          if (where.normalizedPhoneNumber) {
            return phoneMember;
          }

          if (where.walletAddress) {
            return walletMember;
          }

          return null;
        }),
      },
    };

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity(),
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "PRIVY_IDENTITY_CONFLICT",
      httpStatus: 409,
    });

    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.createHostedSession).not.toHaveBeenCalled();
  });

  it("rejects invite verification when the Privy phone number does not match the invited number", async () => {
    const inviteMember = makeMember();
    const invite = makeInvite(inviteMember);
    const prisma: any = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
      },
      hostedMember: {
        update: vi.fn(),
      },
    };

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity({
          phone: {
            number: "+15550000000",
            verifiedAt: 1742990400,
          },
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "PRIVY_PHONE_MISMATCH",
      httpStatus: 403,
    });

    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(mocks.createHostedSession).not.toHaveBeenCalled();
  });

  it("rejects invite verification when the existing member wallet conflicts with the verified Privy wallet", async () => {
    const inviteMember = makeMember({
      walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      walletChainType: "ethereum",
      walletCreatedAt: new Date("2026-03-20T12:00:00.000Z"),
      walletProvider: "privy",
    });
    const invite = makeInvite(inviteMember);
    const prisma: any = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
      },
      hostedMember: {
        update: vi.fn(),
      },
    };

    await expect(
      completeHostedPrivyVerification({
        identity: makeIdentity({
          wallet: {
            address: "0x1111111111111111111111111111111111111111",
            chainType: "ethereum",
            id: "wallet_conflict",
            type: "wallet",
          },
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "PRIVY_WALLET_MISMATCH",
      httpStatus: 409,
    });

    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(mocks.createHostedSession).not.toHaveBeenCalled();
  });
});

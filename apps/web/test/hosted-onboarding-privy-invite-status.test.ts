import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    stripePriceId: "price_123",
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
    telegramBotUsername: null,
    telegramWebhookSecret: null,
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
}));

import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/invite-service";

const NOW = new Date("2026-04-06T12:00:00.000Z");

describe("getHostedInviteStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the identity relation when reading invite status", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = {
      hostedInvite: {
        findUnique,
      },
    } as never;

    await getHostedInviteStatus({
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        inviteCode: "invite-code",
      },
      include: {
        member: {
          include: {
            identity: true,
          },
        },
      },
    });
  });

  it("treats identity-side Privy binding as enough to authenticate", async () => {
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            identity: createIdentity({
              privyUserId: "did:privy:user_123",
              walletAddress: null,
            }),
            privyUserId: null,
            walletAddress: null,
          }),
        })),
      },
    } as never;

    await expect(
      getHostedInviteStatus({
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      stage: "verify",
      invite: {
        phoneHint: "*** 4567",
      },
    });
  });
});

function createInvite(overrides: Record<string, unknown> = {}) {
  const member = createMember();

  return {
    channel: "web",
    createdAt: NOW,
    expiresAt: new Date("2026-04-07T12:00:00.000Z"),
    id: "invite_123",
    inviteCode: "invite-code",
    member,
    memberId: member.id,
    sentAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createIdentity(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: NOW,
    maskedPhoneNumberHint: "*** 4567",
    memberId: "member_123",
    phoneLookupKey: "hbidx:phone:v1:member_123",
    phoneNumberVerifiedAt: NOW,
    privyUserId: null,
    updatedAt: NOW,
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
    ...overrides,
  };
}

function createMember(overrides: Record<string, unknown> = {}) {
  return {
    billingStatus: HostedBillingStatus.not_started,
    createdAt: NOW,
    id: "member_123",
    identity: null,
    linqChatId: null,
    maskedPhoneNumberHint: "*** 0000",
    phoneLookupKey: "hbidx:phone:v1:legacy",
    phoneNumberVerifiedAt: null,
    privyUserId: null,
    suspendedAt: null,
    stripeCustomerId: null,
    stripeLatestBillingEventCreatedAt: null,
    stripeLatestBillingEventId: null,
    stripeLatestCheckoutSessionId: null,
    stripeSubscriptionId: null,
    telegramUserLookupKey: null,
    telegramUsername: null,
    updatedAt: NOW,
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
    ...overrides,
  };
}

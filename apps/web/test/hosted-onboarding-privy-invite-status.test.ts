import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedPhoneLookupKey,
  createHostedPrivyUserLookupKey,
  createHostedPrivyUserLookupKeyReadCandidates,
  createHostedWalletAddressLookupKey,
  createHostedWalletAddressLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { buildHostedMemberRoutingPrivateColumns } from "@/src/lib/hosted-onboarding/member-private-codecs";

const mocks = vi.hoisted(() => ({
  isHostedMemberActivationPending: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    contactPrivacyKeyring: {
      currentVersion: "v2",
      keysByVersion: {
        v1: Buffer.alloc(32, 7),
        v2: Buffer.alloc(32, 11),
      },
      readVersions: ["v2", "v1"],
    },
    inviteTtlHours: 24,
    isProduction: false,
    linqApiBaseUrl: "https://linq.example.test",
    linqApiToken: "linq-token",
    linqWebhookSecret: null,
    privyAppId: "cm_app_123",
    privyVerificationKey: "privy-verification-key",
    publicBaseUrl: "https://join.example.test",
    stripePriceIdsByPlan: {
      launch_annual: "price_annual_123",
      launch_monthly: "price_monthly_123",
    },
    stripeSecretKey: "sk_test_123",
    stripeUsageMeterEventName: "murph_ai_tokens",
    stripeUsagePriceIdsByPlan: {
      launch_annual: "price_usage_annual_123",
      launch_monthly: "price_usage_monthly_123",
    },
    stripeWebhookSecret: "whsec_123",
    telegramBotUsername: null,
    telegramWebhookSecret: null,
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
}));

vi.mock("@/src/lib/hosted-onboarding/activation-progress", () => ({
  isHostedMemberActivationPending: mocks.isHostedMemberActivationPending,
}));

import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/invite-service";

const NOW = new Date("2026-04-06T12:00:00.000Z");

describe("getHostedInviteStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isHostedMemberActivationPending.mockResolvedValue(false);
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
            routing: true,
          },
        },
      },
    });
  });

  it("keeps the invite active while exposing queued background activation after transport handoff", async () => {
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: createIdentity(),
          }),
        })),
      },
    } as never;
    mocks.isHostedMemberActivationPending.mockResolvedValue(true);

    await expect(
      getHostedInviteStatus({
        authenticatedMember: createAuthenticatedMember(),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      murphPhoneNumber: null,
      session: {
        authenticated: true,
        matchesInvite: true,
      },
      stage: "activating",
    });
  });

  it("treats a matching verified Privy session as enough to authenticate", async () => {
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            identity: createIdentity({
              privyUserLookupKey: createHostedPrivyUserLookupKey("did:privy:user_123"),
            }),
          }),
        })),
      },
    } as never;

    await expect(
      getHostedInviteStatus({
        authenticatedSessionIdentity: createSessionIdentity({
          userId: "did:privy:user_123",
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      session: {
        authenticated: true,
        matchesInvite: true,
      },
    });
  });

  it("matches invite access by a rotated Privy user lookup key", async () => {
    const rotatedLookupKey =
      createHostedPrivyUserLookupKeyReadCandidates("did:privy:user_123")[1];

    expect(rotatedLookupKey).toBeTruthy();

    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            identity: createIdentity({
              privyUserLookupKey: rotatedLookupKey,
            }),
          }),
        })),
      },
    } as never;

    await expect(
      getHostedInviteStatus({
        authenticatedSessionIdentity: createSessionIdentity({
          userId: "did:privy:user_123",
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      session: {
        authenticated: true,
        matchesInvite: true,
      },
    });
  });

  it("matches invite access by verified phone identity", async () => {
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            identity: createIdentity({
              phoneLookupKey: createHostedPhoneLookupKey("+1 415 555 2671"),
            }),
          }),
        })),
      },
    } as never;

    await expect(
      getHostedInviteStatus({
        authenticatedSessionIdentity: createSessionIdentity({
          phone: {
            number: "+1 415 555 2671",
          },
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      session: {
        authenticated: true,
        matchesInvite: true,
      },
    });
  });

  it("matches invite access by verified wallet identity", async () => {
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            identity: createIdentity({
              walletAddressLookupKey: createHostedWalletAddressLookupKey(
                "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
              ),
            }),
          }),
        })),
      },
    } as never;

    await expect(
      getHostedInviteStatus({
        authenticatedSessionIdentity: createSessionIdentity({
          wallet: {
            address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          },
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      session: {
        authenticated: true,
        matchesInvite: true,
      },
    });
  });

  it("matches invite access by a rotated wallet lookup key", async () => {
    const rotatedLookupKey =
      createHostedWalletAddressLookupKeyReadCandidates(
        "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      )[1];

    expect(rotatedLookupKey).toBeTruthy();

    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            identity: createIdentity({
              walletAddressLookupKey: rotatedLookupKey,
            }),
          }),
        })),
      },
    } as never;

    await expect(
      getHostedInviteStatus({
        authenticatedSessionIdentity: createSessionIdentity({
          wallet: {
            address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          },
        }),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      session: {
        authenticated: true,
        matchesInvite: true,
      },
    });
  });

  it("returns the assigned Murph phone number only for matched active sessions", async () => {
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: createIdentity(),
            routing: createRouting({
              linqChatId: "chat_123",
              linqRecipientPhone: "+1 (555) 010-0001",
            }),
          }),
        })),
      },
    } as never;

    await expect(
      getHostedInviteStatus({
        authenticatedMember: createAuthenticatedMember(),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      murphPhoneNumber: "+15550100001",
      stage: "active",
    });
  });

  it("redacts the assigned Murph phone number for unmatched sessions", async () => {
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: createIdentity(),
            routing: createRouting({
              linqChatId: "chat_123",
              linqRecipientPhone: "+15550100001",
            }),
          }),
        })),
      },
    } as never;

    await expect(
      getHostedInviteStatus({
        authenticatedMember: {
          ...createAuthenticatedMember(),
          id: "member_other",
        },
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      murphPhoneNumber: null,
      session: {
        authenticated: true,
        matchesInvite: false,
      },
    });
  });

  it("stays active once activation is no longer pending", async () => {
    const prisma = {
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: createIdentity(),
          }),
        })),
      },
    } as never;
    mocks.isHostedMemberActivationPending.mockResolvedValue(false);

    await expect(
      getHostedInviteStatus({
        authenticatedMember: createAuthenticatedMember(),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      stage: "active",
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
    privyUserLookupKey: null,
    privyUserId: null,
    updatedAt: NOW,
    walletAddress: null,
    walletAddressLookupKey: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
    ...overrides,
  };
}

function createRouting(input?: {
  linqChatId?: string | null;
  linqRecipientPhone?: string | null;
  pendingLinqChatId?: string | null;
  pendingLinqRecipientPhone?: string | null;
  telegramUserLookupKey?: string | null;
}) {
  return {
    createdAt: NOW,
    memberId: "member_123",
    telegramUserLookupKey: input?.telegramUserLookupKey ?? null,
    updatedAt: NOW,
    ...buildHostedMemberRoutingPrivateColumns({
      linqChatId: input?.linqChatId ?? null,
      linqRecipientPhone: input?.linqRecipientPhone ?? null,
      memberId: "member_123",
      pendingLinqChatId: input?.pendingLinqChatId ?? null,
      pendingLinqRecipientPhone: input?.pendingLinqRecipientPhone ?? null,
      telegramThreadId: null,
      telegramUserId: null,
    }),
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
    routing: null,
    suspendedAt: null,
    stripeCustomerId: null,
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

function createAuthenticatedMember() {
  return {
    billingStatus: HostedBillingStatus.active,
    createdAt: NOW,
    id: "member_123",
    suspendedAt: null,
    updatedAt: NOW,
  };
}

function createSessionIdentity(overrides: Record<string, unknown> = {}) {
  return {
    phone: null,
    telegram: null,
    userId: "did:privy:user_123",
    wallet: null,
    ...overrides,
  };
}

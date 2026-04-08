import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedExecutionControlClientIfConfigured: vi.fn(),
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
    stripePriceId: "price_123",
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
    telegramBotUsername: null,
    telegramWebhookSecret: null,
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: mocks.readHostedExecutionControlClientIfConfigured,
}));

import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/invite-service";

const NOW = new Date("2026-04-06T12:00:00.000Z");

describe("getHostedInviteStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(null);
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

  it("keeps the invite in activating while the shared activation outcome is still queued after transport handoff", async () => {
    const prisma = {
      executionOutbox: {
        findFirst: vi.fn().mockResolvedValue({
          dispatchState: "queued",
          eventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
          status: "dispatched",
        }),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: createIdentity(),
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
      session: {
        authenticated: true,
        matchesInvite: true,
      },
      stage: "activating",
    });
  });

  it("resolves back to active when live Cloudflare status shows the activation event poisoned", async () => {
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      getStatus: vi.fn().mockResolvedValue({
        backpressuredEventIds: [],
        bundleRef: null,
        inFlight: false,
        lastError: "poisoned by runner",
        lastEventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
        lastRunAt: null,
        nextWakeAt: null,
        pendingEventCount: 0,
        poisonedEventIds: ["member.activated:stripe.invoice.paid:member_123:evt_123"],
        retryingEventId: null,
        userId: "member_123",
      }),
    });

    const prisma = {
      executionOutbox: {
        findFirst: vi.fn().mockResolvedValue({
          dispatchState: "queued",
          eventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
          status: "dispatched",
        }),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: createIdentity(),
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
      stage: "active",
    });
  });

  it("treats persisted poisoned activation outcomes as terminal even without a live Cloudflare status read", async () => {
    const prisma = {
      executionOutbox: {
        findFirst: vi.fn().mockResolvedValue({
          dispatchState: "poisoned",
          eventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
          status: "dispatched",
        }),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: createIdentity(),
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

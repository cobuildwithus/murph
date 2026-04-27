import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedInviteStatus: vi.fn(),
  getPrivyMemberAuth: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  getHostedInviteStatus: mocks.getHostedInviteStatus,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  getPrivyMemberAuth: mocks.getPrivyMemberAuth,
}));

type HostedOnboardingInviteStatusRouteModule = typeof import("../app/api/hosted-onboarding/invites/[inviteCode]/status/route");

let hostedOnboardingInviteStatusRoute: HostedOnboardingInviteStatusRouteModule;

describe("hosted onboarding invite-status route", () => {
  beforeAll(async () => {
    hostedOnboardingInviteStatusRoute = await import("../app/api/hosted-onboarding/invites/[inviteCode]/status/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrivyMemberAuth.mockResolvedValue({
      identity: {
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        userId: "did:privy:user_123",
        wallet: {
          address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          chainType: "ethereum",
          id: "wallet_123",
          type: "wallet",
        },
      },
      linkedAccounts: [],
      member: {
        billingStatus: "active",
        createdAt: new Date("2026-04-19T12:00:00.000Z"),
        id: "member_123",
        pendingActivationTimeZone: null,
        suspendedAt: null,
        updatedAt: new Date("2026-04-19T12:00:00.000Z"),
      },
      memberLookup: null,
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.getHostedInviteStatus.mockResolvedValue({
      billing: {
        defaultPlanCode: "launch_monthly",
        plans: [],
      },
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      invite: {
        code: "invite-code",
        expiresAt: "2026-04-19T12:00:00.000Z",
        phoneHint: "*** 2671",
      },
      messagingSetupRequired: false,
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "verify",
    });
  });

  it("uses the resolved Privy member auth snapshot for invite status", async () => {
    const response = await hostedOnboardingInviteStatusRoute.GET(
      new Request("https://join.example.test/api/hosted-onboarding/invites/invite-code/status"),
      {
        params: Promise.resolve({
          inviteCode: "invite-code",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.getPrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.getHostedInviteStatus).toHaveBeenCalledWith({
      authenticatedMember: expect.objectContaining({
        id: "member_123",
      }),
      authenticatedSessionIdentity: expect.objectContaining({
        phone: expect.objectContaining({
          number: "+14155552671",
        }),
        userId: "did:privy:user_123",
      }),
      inviteCode: "invite-code",
    });
    await expect(response.json()).resolves.toEqual({
      billing: {
        defaultPlanCode: "launch_monthly",
        plans: [],
      },
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      invite: {
        code: "invite-code",
        expiresAt: "2026-04-19T12:00:00.000Z",
        phoneHint: "*** 2671",
      },
      messagingSetupRequired: false,
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "verify",
    });
  });
});

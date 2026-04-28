import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  completeHostedPrivyVerification: vi.fn(),
  getHostedInviteStatus: vi.fn(),
  requirePrivyCompletionSession: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/member-service", () => ({
  completeHostedPrivyVerification: mocks.completeHostedPrivyVerification,
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  getHostedInviteStatus: mocks.getHostedInviteStatus,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requirePrivyCompletionSession:
    mocks.requirePrivyCompletionSession,
}));

type PrivyCompleteRouteModule = typeof import("../app/api/hosted-onboarding/privy/complete/route");

let privyCompleteRoute: PrivyCompleteRouteModule;

describe("hosted onboarding Privy completion route", () => {
  beforeAll(async () => {
    privyCompleteRoute = await import("../app/api/hosted-onboarding/privy/complete/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.completeHostedPrivyVerification.mockResolvedValue({
      activationPending: false,
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      memberId: "member_123",
      messagingSetupRequired: false,
      stage: "checkout",
    });
    mocks.getHostedInviteStatus.mockResolvedValue(createInviteStatus("checkout"));
    mocks.requirePrivyCompletionSession.mockResolvedValue({
      identity: {
        phone: {
          number: "+15550000000",
          verifiedAt: 1742990400,
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
  });

  it("returns the public completion payload when checkout is next", async () => {
    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          inviteCode: "invite_123",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      messagingSetupRequired: false,
      ok: true,
      stage: "checkout",
      status: createInviteStatus("checkout"),
    });
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      identity: {
        phone: {
          number: "+15550000000",
          verifiedAt: 1742990400,
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
      inviteCode: "invite_123",
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
  });

  it("returns the active stage when the member is already active", async () => {
    mocks.completeHostedPrivyVerification.mockResolvedValueOnce({
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      memberId: "member_123",
      messagingSetupRequired: false,
      stage: "active",
    });
    mocks.getHostedInviteStatus.mockResolvedValueOnce(createInviteStatus("active"));

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      messagingSetupRequired: false,
      ok: true,
      stage: "active",
      status: createInviteStatus("active"),
    });
  });

  it("ignores legacy auth intent values and uses unified completion", async () => {
    await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          intent: "signin",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith(expect.not.objectContaining({
      intent: expect.any(String),
    }));
  });

  it("passes a validated browser timezone to the completion service", async () => {
    await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          timeZone: "America/Los_Angeles",
        }),
        headers: {
          origin: "https://join.example.test",
          "x-vercel-ip-timezone": "America/New_York",
        },
        method: "POST",
      }),
    );

    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith(expect.objectContaining({
      timeZone: "America/Los_Angeles",
    }));
  });

  it("falls back to the Vercel timezone header when the client value is invalid", async () => {
    await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          timeZone: "Mars/Olympus",
        }),
        headers: {
          origin: "https://join.example.test",
          "x-vercel-ip-timezone": "America/New_York",
        },
        method: "POST",
      }),
    );

    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith(expect.objectContaining({
      timeZone: "America/New_York",
    }));
  });

  it("omits timezone when both client and platform hints are invalid", async () => {
    await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          timeZone: "Mars/Olympus",
        }),
        headers: {
          origin: "https://join.example.test",
          "x-vercel-ip-timezone": "Moon/Base",
        },
        method: "POST",
      }),
    );

    expect(mocks.completeHostedPrivyVerification.mock.calls[0]?.[0]).not.toHaveProperty("timeZone");
  });
});

function createInviteStatus(stage: "active" | "checkout") {
  return {
    billing: {
      defaultPlanCode: "launch_monthly",
      plans: [],
    },
    capabilities: {
      billingReady: true,
      phoneAuthReady: true,
    },
    invite: {
      code: "invite_123",
      expiresAt: "2026-03-27T12:00:00.000Z",
      phoneHint: "*** 0000",
    },
    messagingSetupRequired: false,
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: true,
    },
    stage,
  };
}

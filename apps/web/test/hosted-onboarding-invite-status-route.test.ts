import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedAppSessionFromRequest: vi.fn(),
  getHostedInviteStatus: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  getHostedAppSessionFromRequest: mocks.getHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  getHostedInviteStatus: mocks.getHostedInviteStatus,
}));

type HostedOnboardingInviteStatusRouteModule = typeof import("../app/api/hosted-onboarding/invites/[inviteCode]/status/route");

let hostedOnboardingInviteStatusRoute: HostedOnboardingInviteStatusRouteModule;

describe("hosted onboarding invite-status route", () => {
  beforeAll(async () => {
    hostedOnboardingInviteStatusRoute = await import("../app/api/hosted-onboarding/invites/[inviteCode]/status/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        billingStatus: "active",
        createdAt: new Date("2026-04-19T12:00:00.000Z"),
        id: "member_123",
        pendingActivationTimeZone: null,
        suspendedAt: null,
        updatedAt: new Date("2026-04-19T12:00:00.000Z"),
      },
      sessionId: "hws_123",
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
        phoneAuthTarget: {
          kind: "saved",
          phoneHint: "*** 2671",
        },
        phoneHint: "*** 2671",
        verificationMode: "invite_phone",
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

  it("uses the hosted app-session member for invite status", async () => {
    const response = await hostedOnboardingInviteStatusRoute.GET(
      new Request("https://join.example.test/api/hosted-onboarding/invites/invite-code/status"),
      {
        params: Promise.resolve({
          inviteCode: "invite-code",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.getHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.getHostedInviteStatus).toHaveBeenCalledWith({
      authenticatedMember: expect.objectContaining({
        id: "member_123",
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
        phoneAuthTarget: {
          kind: "saved",
          phoneHint: "*** 2671",
        },
        phoneHint: "*** 2671",
        verificationMode: "invite_phone",
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

  it("treats a missing app session as unauthenticated", async () => {
    mocks.getHostedAppSessionFromRequest.mockResolvedValueOnce(null);

    const response = await hostedOnboardingInviteStatusRoute.GET(
      new Request("https://join.example.test/api/hosted-onboarding/invites/invite-code/status"),
      {
        params: Promise.resolve({
          inviteCode: "invite-code",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.getHostedInviteStatus).toHaveBeenCalledWith({
      authenticatedMember: null,
      inviteCode: "invite-code",
    });
  });
});

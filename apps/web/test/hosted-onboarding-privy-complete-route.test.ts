import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  completeHostedPrivyVerification: vi.fn(),
  getPrisma: vi.fn(),
  getHostedInviteStatus: vi.fn(),
  issueHostedAppSession: vi.fn(),
  requirePrivyCompletionSession: vi.fn(),
  readHostedConsentStatus: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  issueHostedAppSession: mocks.issueHostedAppSession,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  readHostedConsentStatus: mocks.readHostedConsentStatus,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.completeHostedPrivyVerification.mockResolvedValue({
      activationPending: false,
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      member: createHostedMember(),
      memberId: "member_123",
      messagingSetupRequired: false,
      stage: "checkout",
    });
    mocks.getHostedInviteStatus.mockResolvedValue(createInviteStatus("checkout"));
    mocks.getPrisma.mockReturnValue({ prisma: "mock" });
    mocks.issueHostedAppSession.mockResolvedValue({
      cookie: "murph-session=session-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
      sessionId: "hws_123",
    });
    mocks.readHostedConsentStatus.mockResolvedValue({
      launchGranted: false,
    });
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
    expect(response.headers.get("Set-Cookie")).toBe(
      "murph-session=session-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    await expect(response.json()).resolves.toEqual({
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      launchConsentGranted: false,
      messagingSetupRequired: false,
      ok: true,
      stage: "checkout",
      status: createInviteStatus("checkout"),
    });
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      authMethod: "phone",
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
    expect(mocks.issueHostedAppSession).toHaveBeenCalledWith({
      memberId: "member_123",
      privyUserId: "did:privy:user_123",
    });
    expect(mocks.getHostedInviteStatus).toHaveBeenCalledWith({
      authenticatedMember: createHostedMember(),
      inviteCode: "invite_123",
    });
  });

  it("returns the active stage when the member is already active", async () => {
    mocks.completeHostedPrivyVerification.mockResolvedValueOnce({
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      member: createHostedMember(),
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
      launchConsentGranted: false,
      messagingSetupRequired: false,
      ok: true,
      stage: "active",
      status: createInviteStatus("active"),
    });
  });

  it("marks completion as launch-consented when the member already granted launch consent", async () => {
    mocks.completeHostedPrivyVerification.mockResolvedValueOnce({
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      member: createHostedMember(),
      memberId: "member_123",
      messagingSetupRequired: false,
      stage: "active",
    });
    mocks.getHostedInviteStatus.mockResolvedValueOnce(createInviteStatus("active"));
    mocks.readHostedConsentStatus.mockResolvedValueOnce({
      launchGranted: true,
    });

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      launchConsentGranted: true,
      stage: "active",
    });
    expect(mocks.readHostedConsentStatus).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { prisma: "mock" },
    });
  });

  it("keeps completion unconsented when launch consent status cannot be read", async () => {
    mocks.readHostedConsentStatus.mockRejectedValueOnce(
      new Error("consent status unavailable"),
    );

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      launchConsentGranted: false,
      ok: true,
      stage: "checkout",
    });
    expect(mocks.issueHostedAppSession).toHaveBeenCalledWith({
      memberId: "member_123",
      privyUserId: "did:privy:user_123",
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

  it("passes the selected Telegram auth method and identity to completion", async () => {
    mocks.requirePrivyCompletionSession.mockResolvedValueOnce({
      identity: {
        phone: null,
        telegram: {
          firstName: "Alice",
          lastName: null,
          photoUrl: null,
          telegramUserId: "456",
          username: "alice",
        },
        userId: "did:privy:user_telegram",
        wallet: null,
      },
      verifiedPrivyUser: {
        id: "did:privy:user_telegram",
      },
    });

    await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          authIntent: {
            method: "telegram",
          },
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith(expect.objectContaining({
      authMethod: "telegram",
      identity: expect.objectContaining({
        telegram: expect.objectContaining({
          telegramUserId: "456",
        }),
        userId: "did:privy:user_telegram",
      }),
    }));
  });

  it("requires an explicit auth intent when legacy clients present multiple verified methods", async () => {
    mocks.requirePrivyCompletionSession.mockResolvedValueOnce({
      identity: {
        email: {
          address: "user@example.test",
          verifiedAt: 1742990400,
        },
        phone: {
          number: "+15550000000",
          verifiedAt: 1742990400,
        },
        userId: "did:privy:user_multi",
        wallet: null,
      },
      verifiedPrivyUser: {
        id: "did:privy:user_multi",
      },
    });

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_AUTH_INTENT_REQUIRED",
        retryable: false,
      },
    });
    expect(mocks.completeHostedPrivyVerification).not.toHaveBeenCalled();
    expect(mocks.issueHostedAppSession).not.toHaveBeenCalled();
  });

  it("maps missing Telegram state from completion to a retryable session-lag response", async () => {
    mocks.completeHostedPrivyVerification.mockRejectedValueOnce(hostedOnboardingError({
      code: "PRIVY_TELEGRAM_REQUIRED",
      message: "Finish Telegram verification before continuing.",
      httpStatus: 400,
    }));

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          authIntent: {
            method: "telegram",
          },
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PRIVY_TELEGRAM_NOT_READY",
        retryable: true,
      },
    });
    expect(mocks.issueHostedAppSession).not.toHaveBeenCalled();
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
      authMethod: "phone",
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
      authMethod: "phone",
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

function createHostedMember() {
  return {
    billingStatus: "active",
    createdAt: new Date("2026-03-27T12:00:00.000Z"),
    id: "member_123",
    suspendedAt: null,
    updatedAt: new Date("2026-03-27T12:00:00.000Z"),
  };
}

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
      phoneAuthTarget: {
        kind: "saved",
        phoneHint: "*** 0000",
      },
      phoneHint: "*** 0000",
      verificationMode: "invite_phone",
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

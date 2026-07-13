import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  completeHostedPrivyVerification: vi.fn(),
  getPrisma: vi.fn(),
  getHostedInviteStatus: vi.fn(),
  issueHostedAppSession: vi.fn(),
  buildHostedPrivyAuthIntentClearCookie: vi.fn(),
  readHostedPrivyAuthIntentFromRequest: vi.fn(),
  readHostedPrivyUserById: vi.fn(),
  remapHostedPrivyCompletionLagError: vi.fn(),
  requirePrivyCompletionSession: vi.fn(),
  readHostedConsentStatus: vi.fn(),
  verifyHostedPrivyAuthIntent: vi.fn(),
  verifyHostedPrivyAuthenticationProof: vi.fn(),
  verifyHostedPrivyLegacyAuthContext: vi.fn(),
  verifyHostedPrivyLegacyAuthenticationProof: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/authentication-service", () => ({
  completeHostedPrivyVerification: mocks.completeHostedPrivyVerification,
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  getHostedInviteStatus: mocks.getHostedInviteStatus,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requirePrivyCompletionSession:
    mocks.requirePrivyCompletionSession,
}));

vi.mock("@/src/lib/hosted-onboarding/privy-auth-intent", () => ({
  buildHostedPrivyAuthIntentClearCookie:
    mocks.buildHostedPrivyAuthIntentClearCookie,
  readHostedPrivyAuthIntentFromRequest:
    mocks.readHostedPrivyAuthIntentFromRequest,
  verifyHostedPrivyAuthIntent:
    mocks.verifyHostedPrivyAuthIntent,
  verifyHostedPrivyAuthenticationProof:
    mocks.verifyHostedPrivyAuthenticationProof,
  verifyHostedPrivyLegacyAuthContext:
    mocks.verifyHostedPrivyLegacyAuthContext,
  verifyHostedPrivyLegacyAuthenticationProof:
    mocks.verifyHostedPrivyLegacyAuthenticationProof,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  readHostedPrivyUserById: mocks.readHostedPrivyUserById,
  remapHostedPrivyCompletionLagError: mocks.remapHostedPrivyCompletionLagError,
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

type PrivyCompleteRouteModule = typeof import("../app/api/hosted-onboarding/privy/complete/v2/route");
type LegacyPrivyCompleteRouteModule = typeof import("../app/api/hosted-onboarding/privy/complete/route");

let privyCompleteRoute: PrivyCompleteRouteModule;
let legacyPrivyCompleteRoute: LegacyPrivyCompleteRouteModule;

describe("hosted onboarding Privy completion route", () => {
  beforeAll(async () => {
    privyCompleteRoute = await import("../app/api/hosted-onboarding/privy/complete/v2/route");
    legacyPrivyCompleteRoute = await import("../app/api/hosted-onboarding/privy/complete/route");
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
    mocks.buildHostedPrivyAuthIntentClearCookie.mockReturnValue(
      "murph-privy-auth-intent=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict",
    );
    mocks.readHostedPrivyAuthIntentFromRequest.mockReturnValue("signed-phone-intent");
    mocks.readHostedPrivyUserById.mockResolvedValue({
      id: "did:privy:user_123",
      linkedAccounts: [],
    });
    mocks.verifyHostedPrivyAuthIntent.mockReturnValue({
      expiresAt: 1742991000,
      issuedAt: 1742990400,
      method: "phone",
    });
    mocks.verifyHostedPrivyLegacyAuthContext.mockReturnValue({
      identityTokenIssuedAt: 1742990400,
      method: "phone",
    });
    mocks.remapHostedPrivyCompletionLagError.mockImplementation((error: unknown) => {
      if (
        error
        && typeof error === "object"
        && Reflect.get(error, "code") === "PRIVY_TELEGRAM_REQUIRED"
      ) {
        return hostedOnboardingError({
          code: "PRIVY_TELEGRAM_NOT_READY",
          message: "Your verified Telegram account is not ready yet.",
          httpStatus: 409,
          retryable: true,
        });
      }
      return error;
    });
    mocks.verifyHostedPrivyAuthenticationProof.mockReturnValue(createAuthenticationProof("phone"));
    mocks.verifyHostedPrivyLegacyAuthenticationProof.mockReturnValue(
      createAuthenticationProof("phone"),
    );
    mocks.requirePrivyCompletionSession.mockResolvedValue({
      identityTokenIssuedAt: 1742990400,
      privyUserId: "did:privy:user_123",
    });
  });

  it("returns the public completion payload when checkout is next", async () => {
    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete/v2", {
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
    expect(response.headers.get("Set-Cookie")).toContain(
      "murph-session=session-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    expect(response.headers.get("Set-Cookie")).toContain(
      "murph-privy-auth-intent=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict",
    );
    await expect(response.json()).resolves.toEqual({
      inviteCode: "invite_123",
      joinUrl: "/join/invite_123",
      launchConsentGranted: false,
      messagingSetupRequired: false,
      ok: true,
      stage: "checkout",
      status: createInviteStatus("checkout"),
    });
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      authProof: createAuthenticationProof("phone"),
      inviteCode: "invite_123",
      verifiedPrivyUser: {
        id: "did:privy:user_123",
        linkedAccounts: [],
      },
    });
    expect(mocks.verifyHostedPrivyAuthIntent).toHaveBeenCalledWith({
      intent: "signed-phone-intent",
      inviteCode: "invite_123",
    });
    expect(mocks.verifyHostedPrivyAuthenticationProof).toHaveBeenCalledWith({
      intent: {
        expiresAt: 1742991000,
        issuedAt: 1742990400,
        method: "phone",
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
        linkedAccounts: [],
      },
    });
    expect(mocks.readHostedPrivyUserById).toHaveBeenCalledWith(
      "did:privy:user_123",
    );
    expect(mocks.verifyHostedPrivyAuthIntent.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.readHostedPrivyUserById.mock.invocationCallOrder[0],
    );
    expect(mocks.readHostedPrivyUserById.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.verifyHostedPrivyAuthenticationProof.mock.invocationCallOrder[0],
    );
    expect(mocks.requirePrivyCompletionSession).toHaveBeenCalled();
    expect(mocks.buildHostedPrivyAuthIntentClearCookie).toHaveBeenCalledTimes(1);
    expect(mocks.issueHostedAppSession).toHaveBeenCalledWith({
      memberId: "member_123",
      privyUserId: "did:privy:user_123",
    });
    expect(mocks.getHostedInviteStatus).toHaveBeenCalledWith({
      authenticatedMember: createHostedMember(),
      inviteCode: "invite_123",
    });
  });

  it("keeps a hardened compatibility floor for an already-loaded legacy bundle", async () => {
    const response = await legacyPrivyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          authIntent: { method: "phone" },
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.verifyHostedPrivyLegacyAuthContext).toHaveBeenCalledWith({
      identityTokenIssuedAt: 1742990400,
      method: "phone",
    });
    expect(mocks.verifyHostedPrivyAuthIntent).not.toHaveBeenCalled();
    expect(mocks.verifyHostedPrivyAuthenticationProof).not.toHaveBeenCalled();
    expect(mocks.verifyHostedPrivyLegacyAuthenticationProof).toHaveBeenCalledWith({
      authContext: {
        identityTokenIssuedAt: 1742990400,
        method: "phone",
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
        linkedAccounts: [],
      },
    });
    expect(mocks.verifyHostedPrivyLegacyAuthContext.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.readHostedPrivyUserById.mock.invocationCallOrder[0],
    );
    expect(mocks.readHostedPrivyUserById.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.verifyHostedPrivyLegacyAuthenticationProof.mock.invocationCallOrder[0],
    );
  });

  it("rejects an ineligible legacy bundle before reading provider state", async () => {
    mocks.verifyHostedPrivyLegacyAuthContext.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "HOSTED_CLIENT_UPDATE_REQUIRED",
        message: "Reload this page and verify again to finish signing in.",
        httpStatus: 409,
      });
    });

    const response = await legacyPrivyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          authIntent: { method: "phone" },
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.readHostedPrivyUserById).not.toHaveBeenCalled();
    expect(mocks.verifyHostedPrivyAuthenticationProof).not.toHaveBeenCalled();
    expect(mocks.verifyHostedPrivyLegacyAuthenticationProof).not.toHaveBeenCalled();
    expect(mocks.completeHostedPrivyVerification).not.toHaveBeenCalled();
  });

  it("rejects post-token legacy email evidence before canonical completion effects", async () => {
    const actualAuthIntent = await vi.importActual<
      typeof import("@/src/lib/hosted-onboarding/privy-auth-intent")
    >("@/src/lib/hosted-onboarding/privy-auth-intent");
    const tokenIssuedAt = 1_743_000_000;

    mocks.verifyHostedPrivyLegacyAuthContext.mockReturnValueOnce({
      identityTokenIssuedAt: tokenIssuedAt,
      method: "email",
    });
    mocks.readHostedPrivyUserById.mockResolvedValueOnce({
      id: "did:privy:user_123",
      linkedAccounts: [{
        address: "member@example.test",
        latest_verified_at: tokenIssuedAt + 6,
        type: "email",
      }],
    });
    mocks.verifyHostedPrivyLegacyAuthenticationProof.mockImplementationOnce((input) => (
      actualAuthIntent.verifyHostedPrivyLegacyAuthenticationProof({
        ...input,
        now: new Date((tokenIssuedAt + 60) * 1000),
      })
    ));

    const response = await legacyPrivyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          authIntent: { method: "email" },
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.completeHostedPrivyVerification).not.toHaveBeenCalled();
    expect(mocks.issueHostedAppSession).not.toHaveBeenCalled();
  });

  it("uses the narrow verified principal to reread the authoritative Privy user", async () => {
    mocks.requirePrivyCompletionSession.mockResolvedValueOnce({
      identityTokenIssuedAt: 1742990400,
      privyUserId: "did:privy:user_123",
    });

    await privyCompleteRoute.POST(createCompletionRequest());

    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        verifiedPrivyUser: {
          id: "did:privy:user_123",
          linkedAccounts: [],
        },
      }),
    );
  });

  it("returns the active stage when the member is already active", async () => {
    mocks.completeHostedPrivyVerification.mockResolvedValueOnce({
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      initialVisitEligible: false,
      member: createHostedMember(),
      memberId: "member_123",
      messagingSetupRequired: false,
      stage: "active",
    });
    mocks.getHostedInviteStatus.mockResolvedValueOnce(createInviteStatus("active"));

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete/v2", {
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      inviteCode: "invite_123",
      joinUrl: "/join/invite_123",
      launchConsentGranted: false,
      messagingSetupRequired: false,
      ok: true,
      stage: "active",
      status: createInviteStatus("active"),
    });
  });

  it("returns initial visit eligibility only when the completion should open first-run handoff", async () => {
    mocks.completeHostedPrivyVerification.mockResolvedValueOnce({
      inviteCode: "invite_123",
      initialVisitEligible: true,
      joinUrl: "https://join.example.test/join/invite_123",
      member: createHostedMember(),
      memberId: "member_123",
      messagingSetupRequired: false,
      stage: "active",
    });
    mocks.getHostedInviteStatus.mockResolvedValueOnce(createInviteStatus("active"));

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete/v2", {
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      initialVisitEligible: true,
      stage: "active",
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
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete/v2", {
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
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete/v2", {
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
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete/v2", {
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

  it.each([
    {
      intent: "signed-email-intent",
      method: "email" as const,
    },
    {
      intent: "signed-phone-intent",
      method: "phone" as const,
    },
    {
      intent: "signed-telegram-intent",
      method: "telegram" as const,
    },
  ])("passes a fresh $method proof to completion", async ({ intent, method }) => {
    mocks.readHostedPrivyAuthIntentFromRequest.mockReturnValueOnce(intent);
    mocks.verifyHostedPrivyAuthIntent.mockReturnValueOnce({
      expiresAt: 1742991000,
      issuedAt: 1742990400,
      method,
    });
    mocks.verifyHostedPrivyAuthenticationProof.mockReturnValueOnce(createAuthenticationProof(method));

    const response = await privyCompleteRoute.POST(createCompletionRequest({
      cookie: `murph-privy-auth-intent=${intent}`,
    }));

    expect(response.status).toBe(200);
    expect(mocks.verifyHostedPrivyAuthIntent).toHaveBeenCalledWith({
      intent,
      inviteCode: null,
    });
    expect(mocks.verifyHostedPrivyAuthenticationProof).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({ method }),
        verifiedPrivyUser: expect.objectContaining({
          id: "did:privy:user_123",
        }),
      }),
    );
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        authProof: createAuthenticationProof(method),
      }),
    );
  });

  it.each([
    {
      code: "HOSTED_AUTH_PROOF_INVALID",
      httpStatus: 401,
      intent: null,
      label: "missing",
    },
    {
      code: "HOSTED_AUTH_PROOF_EXPIRED",
      httpStatus: 401,
      intent: "stale-signed-intent",
      label: "stale",
    },
    {
      code: "HOSTED_AUTH_PROOF_INVALID",
      httpStatus: 401,
      intent: "forged-signed-intent",
      label: "forged",
    },
  ])("rejects a $label method proof before completion", async ({
    code,
    httpStatus,
    intent,
  }) => {
    mocks.readHostedPrivyAuthIntentFromRequest.mockReturnValueOnce(intent);
    mocks.verifyHostedPrivyAuthIntent.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code,
        message: "Request a fresh verification code and try again.",
        httpStatus,
      });
    });

    const response = await privyCompleteRoute.POST(createCompletionRequest({
      ...(intent ? { cookie: `murph-privy-auth-intent=${intent}` } : {}),
    }));

    expect(response.status).toBe(httpStatus);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code,
      },
    });
    expect(mocks.completeHostedPrivyVerification).not.toHaveBeenCalled();
    expect(mocks.readHostedPrivyUserById).not.toHaveBeenCalled();
    expect(mocks.verifyHostedPrivyAuthenticationProof).not.toHaveBeenCalled();
    expect(mocks.issueHostedAppSession).not.toHaveBeenCalled();
    expect(mocks.buildHostedPrivyAuthIntentClearCookie).not.toHaveBeenCalled();
  });

  it("maps missing Telegram state from completion to a retryable session-lag response", async () => {
    mocks.verifyHostedPrivyAuthenticationProof.mockReturnValueOnce(createAuthenticationProof("telegram"));
    mocks.completeHostedPrivyVerification.mockRejectedValueOnce(hostedOnboardingError({
      code: "PRIVY_TELEGRAM_REQUIRED",
      message: "Finish Telegram verification before continuing.",
      httpStatus: 400,
    }));

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete/v2", {
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
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete/v2", {
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
      authProof: createAuthenticationProof("phone"),
      timeZone: "America/Los_Angeles",
    }));
  });

  it("falls back to the Vercel timezone header when the client value is invalid", async () => {
    await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete/v2", {
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
      authProof: createAuthenticationProof("phone"),
      timeZone: "America/New_York",
    }));
  });

  it("omits timezone when both client and platform hints are invalid", async () => {
    await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete/v2", {
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

function createCompletionRequest(input: {
  cookie?: string;
  inviteCode?: string;
} = {}): Request {
  return new Request("https://join.example.test/api/hosted-onboarding/privy/complete/v2", {
    body: JSON.stringify({
      ...(input.inviteCode ? { inviteCode: input.inviteCode } : {}),
    }),
    headers: {
      ...(input.cookie ? { cookie: input.cookie } : {}),
      origin: "https://join.example.test",
    },
    method: "POST",
  });
}

function createHostedMember() {
  return {
    billingStatus: "active",
    createdAt: new Date("2026-03-27T12:00:00.000Z"),
    id: "member_123",
    suspendedAt: null,
    updatedAt: new Date("2026-03-27T12:00:00.000Z"),
  };
}

function createAuthenticationProof(method: "email" | "phone" | "telegram") {
  const credential = method === "email"
    ? { address: "member@example.test", verifiedAt: 1742990400 }
    : method === "phone"
      ? { number: "+15550000000", verifiedAt: 1742990400 }
      : {
          firstName: "Example",
          lastName: null,
          photoUrl: null,
          telegramUserId: "456",
          username: "example",
          verifiedAt: 1742990400,
        };

  return {
    credential,
    method,
    privyUserId: "did:privy:user_123",
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

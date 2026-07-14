import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  buildHostedPrivyEmailLinkIntentCookie: vi.fn(),
  issueHostedPrivyEmailLinkIntent: vi.fn(),
  readHostedPrivyUserById: vi.fn(),
  requireFreshActivePrivyMemberAuthForHostedAppSession: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/privy-auth-intent", () => ({
  buildHostedPrivyEmailLinkIntentCookie: mocks.buildHostedPrivyEmailLinkIntentCookie,
  issueHostedPrivyEmailLinkIntent: mocks.issueHostedPrivyEmailLinkIntent,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireFreshActivePrivyMemberAuthForHostedAppSession:
    mocks.requireFreshActivePrivyMemberAuthForHostedAppSession,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  readHostedPrivyUserById: mocks.readHostedPrivyUserById,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    publicBaseUrl: "https://join.example.test",
  }),
}));

let route: typeof import("../app/api/settings/email/link-intent/route");

describe("settings email link-intent route", () => {
  beforeAll(async () => {
    route = await import("../app/api/settings/email/link-intent/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.issueHostedPrivyEmailLinkIntent.mockReturnValue("signed-email-link-intent");
    mocks.buildHostedPrivyEmailLinkIntentCookie.mockReturnValue(
      "murph-privy-email-link-intent=signed-email-link-intent; Path=/; HttpOnly; SameSite=Strict",
    );
    mocks.readHostedPrivyUserById.mockResolvedValue({
      id: "did:privy:user_123",
      linkedAccounts: [
        {
          address: "pre-existing@example.com",
          latest_verified_at: 1_752_400_000,
          type: "email",
        },
      ],
    });
    mocks.requireFreshActivePrivyMemberAuthForHostedAppSession.mockResolvedValue({
      appSession: {
        member: { id: "member_123" },
        privyUserId: "did:privy:user_123",
      },
      freshPrivy: {
        identity: { userId: "did:privy:user_123" },
        member: { id: "member_123" },
      },
    });
  });

  it("issues an HttpOnly intent bound to the fresh member and Privy principal", async () => {
    const response = await route.POST(new Request(
      "https://join.example.test/api/settings/email/link-intent",
      {
        headers: { origin: "https://join.example.test" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.requireFreshActivePrivyMemberAuthForHostedAppSession).toHaveBeenCalledWith(
      expect.any(Request),
    );
    expect(mocks.issueHostedPrivyEmailLinkIntent).toHaveBeenCalledWith({
      memberId: "member_123",
      privyUserId: "did:privy:user_123",
      verifiedPrivyUser: {
        id: "did:privy:user_123",
        linkedAccounts: [
          {
            address: "pre-existing@example.com",
            latest_verified_at: 1_752_400_000,
            type: "email",
          },
        ],
      },
    });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("fails closed before issuing an intent when fresh member auth is unavailable", async () => {
    mocks.requireFreshActivePrivyMemberAuthForHostedAppSession.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "AUTH_REQUIRED",
        httpStatus: 401,
        message: "Sign in to continue.",
      }),
    );

    const response = await route.POST(new Request(
      "https://join.example.test/api/settings/email/link-intent",
      {
        headers: { origin: "https://join.example.test" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(401);
    expect(mocks.issueHostedPrivyEmailLinkIntent).not.toHaveBeenCalled();
  });

  it("rejects cross-origin issuance", async () => {
    const response = await route.POST(new Request(
      "https://join.example.test/api/settings/email/link-intent",
      {
        headers: { origin: "https://attacker.example" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(403);
    expect(mocks.requireFreshActivePrivyMemberAuthForHostedAppSession).not.toHaveBeenCalled();
    expect(mocks.issueHostedPrivyEmailLinkIntent).not.toHaveBeenCalled();
  });
});

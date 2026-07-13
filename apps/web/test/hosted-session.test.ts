import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildHostedPrivySessionState: vi.fn(),
  cookies: vi.fn(),
  readHostedPrivyIdentityTokenFromCookieStore: vi.fn(),
  readHostedPrivyIdentityTokenFromRequestCookies: vi.fn(),
  verifyHostedPrivyIdentityToken: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/src/lib/hosted-onboarding/privy-token", () => ({
  readHostedPrivyIdentityTokenFromCookieStore: mocks.readHostedPrivyIdentityTokenFromCookieStore,
  readHostedPrivyIdentityTokenFromRequestCookies: mocks.readHostedPrivyIdentityTokenFromRequestCookies,
}));

vi.mock("@/src/lib/hosted-onboarding/privy-user", () => ({
  buildHostedPrivySessionState: mocks.buildHostedPrivySessionState,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  verifyHostedPrivyIdentityToken: mocks.verifyHostedPrivyIdentityToken,
}));

describe("hosted Privy session", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({
      get: vi.fn(),
    });
    mocks.readHostedPrivyIdentityTokenFromCookieStore.mockReturnValue(null);
    mocks.readHostedPrivyIdentityTokenFromRequestCookies.mockReturnValue(null);
    mocks.verifyHostedPrivyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [],
    });
    mocks.buildHostedPrivySessionState.mockReturnValue({
      identity: {
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
      linkedAccounts: [
        {
          latest_verified_at: 1741194420,
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
      ],
      memberId: null,
      verifiedPrivyUser: {
        id: "did:privy:user_123",
        linked_accounts: [],
      },
    });
  });

  it("returns null when the Privy identity cookie is absent", async () => {
    const { getHostedPrivySession } = await import("@/src/lib/hosted-onboarding/hosted-session");

    await expect(getHostedPrivySession()).resolves.toBeNull();
    expect(mocks.verifyHostedPrivyIdentityToken).not.toHaveBeenCalled();
  });

  it("requires the Privy identity cookie for a hosted session", async () => {
    const { requireHostedPrivySession } = await import("@/src/lib/hosted-onboarding/hosted-session");

    await expect(requireHostedPrivySession()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });
  });

  it("builds a hosted session from the Privy identity cookie store", async () => {
    const { getHostedPrivySession } = await import("@/src/lib/hosted-onboarding/hosted-session");
    mocks.readHostedPrivyIdentityTokenFromCookieStore.mockReturnValue("identity-token");

    await expect(getHostedPrivySession()).resolves.toMatchObject({
      identity: {
        phone: {
          number: "+14155552671",
        },
        userId: "did:privy:user_123",
      },
      linkedAccounts: [
        {
          type: "phone",
        },
      ],
      memberId: null,
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    expect(mocks.verifyHostedPrivyIdentityToken).toHaveBeenCalledWith("identity-token");
  });

  it("builds a hosted session directly from the request cookie header", async () => {
    const { resolveHostedPrivySessionFromRequest } = await import("@/src/lib/hosted-onboarding/hosted-session");
    mocks.readHostedPrivyIdentityTokenFromRequestCookies.mockReturnValue("identity-token");
    const request = new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
      headers: {
        cookie: "privy-id-token=identity-token",
      },
    });

    await expect(resolveHostedPrivySessionFromRequest(request)).resolves.toMatchObject({
      identity: {
        userId: "did:privy:user_123",
      },
      memberId: null,
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    expect(mocks.readHostedPrivyIdentityTokenFromRequestCookies).toHaveBeenCalledWith(request);
    expect(mocks.verifyHostedPrivyIdentityToken).toHaveBeenCalledWith("identity-token");
    expect(mocks.buildHostedPrivySessionState).toHaveBeenCalledWith({
      id: "did:privy:user_123",
      linked_accounts: [],
    });
  });

  it("resolves the completion principal without expanding linked credentials", async () => {
    const { resolveHostedPrivyPrincipalFromRequest } = await import(
      "@/src/lib/hosted-onboarding/hosted-session"
    );
    mocks.readHostedPrivyIdentityTokenFromRequestCookies.mockReturnValue("identity-token");
    mocks.verifyHostedPrivyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          id: "456",
          latest_verified_at: 1741194420,
          type: "telegram",
        },
      ],
      telegram: {
        id: "789",
        latest_verified_at: 1741194420,
      },
    });
    const request = new Request("https://join.example.test/api/hosted-onboarding/privy/complete/v2");

    await expect(resolveHostedPrivyPrincipalFromRequest(request)).resolves.toEqual({
      privyUserId: "did:privy:user_123",
    });
    expect(mocks.buildHostedPrivySessionState).not.toHaveBeenCalled();
  });

  it("reads the Murph member id from verified Privy custom metadata", async () => {
    const { resolveHostedPrivySessionFromRequest } = await import("@/src/lib/hosted-onboarding/hosted-session");
    mocks.readHostedPrivyIdentityTokenFromRequestCookies.mockReturnValue("identity-token");
    mocks.buildHostedPrivySessionState.mockReturnValue({
      identity: {
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
      linkedAccounts: [],
      memberId: "member_123",
      verifiedPrivyUser: {
        id: "did:privy:user_123",
        linked_accounts: [],
      },
    });
    const request = new Request("https://join.example.test/api/hosted-onboarding/privy/complete");

    await expect(resolveHostedPrivySessionFromRequest(request)).resolves.toMatchObject({
      memberId: "member_123",
    });
  });
});

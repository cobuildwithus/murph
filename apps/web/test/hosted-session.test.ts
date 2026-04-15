import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  readHostedPrivyIdentityTokenFromCookieStore: vi.fn(),
  readHostedPrivyIdentityTokenFromRequestCookies: vi.fn(),
  resolveHostedPrivyIdentityFromVerifiedUser: vi.fn(),
  resolveHostedPrivyLinkedAccounts: vi.fn(),
  verifyHostedPrivyIdentityToken: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  readHostedPrivyIdentityTokenFromCookieStore: mocks.readHostedPrivyIdentityTokenFromCookieStore,
  readHostedPrivyIdentityTokenFromRequestCookies: mocks.readHostedPrivyIdentityTokenFromRequestCookies,
  resolveHostedPrivyIdentityFromVerifiedUser: mocks.resolveHostedPrivyIdentityFromVerifiedUser,
  verifyHostedPrivyIdentityToken: mocks.verifyHostedPrivyIdentityToken,
}));

vi.mock("@/src/lib/hosted-onboarding/privy-shared", () => ({
  resolveHostedPrivyLinkedAccounts: mocks.resolveHostedPrivyLinkedAccounts,
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
    mocks.resolveHostedPrivyIdentityFromVerifiedUser.mockReturnValue({
      phone: {
        number: "+14155552671",
        verifiedAt: 1741194420,
      },
      userId: "did:privy:user_123",
      wallet: null,
    });
    mocks.resolveHostedPrivyLinkedAccounts.mockReturnValue([
      {
        latest_verified_at: 1741194420,
        phone_number: "+1 415 555 2671",
        type: "phone",
      },
    ]);
    mocks.verifyHostedPrivyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [],
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
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    expect(mocks.readHostedPrivyIdentityTokenFromRequestCookies).toHaveBeenCalledWith(request);
    expect(mocks.verifyHostedPrivyIdentityToken).toHaveBeenCalledWith("identity-token");
  });
});

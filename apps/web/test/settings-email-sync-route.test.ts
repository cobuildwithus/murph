import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  readHostedPrivyIdentityTokenFromCookieStore: vi.fn(),
  resolveHostedSessionFromCookieStore: vi.fn(),
  syncHostedVerifiedEmailToHostedExecution: vi.fn(),
  verifyHostedPrivyIdentityToken: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  syncHostedVerifiedEmailToHostedExecution: mocks.syncHostedVerifiedEmailToHostedExecution,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  readHostedPrivyIdentityTokenFromCookieStore: mocks.readHostedPrivyIdentityTokenFromCookieStore,
  verifyHostedPrivyIdentityToken: mocks.verifyHostedPrivyIdentityToken,
}));

vi.mock("@/src/lib/hosted-onboarding/session", () => ({
  resolveHostedSessionFromCookieStore: mocks.resolveHostedSessionFromCookieStore,
}));

type SettingsEmailSyncRouteModule = typeof import("../app/api/settings/email/sync/route");

let settingsEmailSyncRoute: SettingsEmailSyncRouteModule;

describe("settings email sync route", () => {
  beforeAll(async () => {
    settingsEmailSyncRoute = await import("../app/api/settings/email/sync/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({
      get: vi.fn(),
    });
    mocks.readHostedPrivyIdentityTokenFromCookieStore.mockReturnValue("identity-token");
    mocks.resolveHostedSessionFromCookieStore.mockResolvedValue({
      member: {
        id: "member_123",
        privyUserId: "did:privy:user_123",
      },
    });
    mocks.verifyHostedPrivyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          address: "user@example.com",
          latest_verified_at: 1743064200,
          type: "email",
        },
      ],
    });
    mocks.syncHostedVerifiedEmailToHostedExecution.mockResolvedValue({
      emailAddress: "user@example.com",
      runTriggered: true,
      verifiedAt: "2025-03-27T09:10:00.000Z",
    });
  });

  it("verifies the Privy cookie server-side and syncs the verified email into hosted user env", async () => {
    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        body: JSON.stringify({
          expectedEmailAddress: "user@example.com",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.resolveHostedSessionFromCookieStore).toHaveBeenCalledWith({ get: expect.any(Function) });
    expect(mocks.verifyHostedPrivyIdentityToken).toHaveBeenCalledWith("identity-token");
    expect(mocks.syncHostedVerifiedEmailToHostedExecution).toHaveBeenCalledWith({
      emailAddress: "user@example.com",
      userId: "member_123",
      verifiedAt: "2025-03-27T08:30:00.000Z",
    });
    await expect(response.json()).resolves.toEqual({
      emailAddress: "user@example.com",
      ok: true,
      runTriggered: true,
      verifiedAt: "2025-03-27T09:10:00.000Z",
    });
  });

  it("accepts an empty POST body when the server-side Privy session already has the verified email", async () => {
    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.syncHostedVerifiedEmailToHostedExecution).toHaveBeenCalledWith({
      emailAddress: "user@example.com",
      userId: "member_123",
      verifiedAt: "2025-03-27T08:30:00.000Z",
    });
  });

  it("rejects sync attempts whose Privy session does not match the hosted session", async () => {
    mocks.verifyHostedPrivyIdentityToken.mockResolvedValue({
      id: "did:privy:user_other",
      linked_accounts: [
        {
          address: "user@example.com",
          latest_verified_at: 1743064200,
          type: "email",
        },
      ],
    });

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.syncHostedVerifiedEmailToHostedExecution).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_SESSION_MISMATCH",
        message: "This Privy session does not match the current hosted account. Reopen the latest invite and try again.",
        retryable: false,
      },
    });
  });

  it("returns a retryable conflict while the updated verified email has not reached the server-side cookie yet", async () => {
    mocks.verifyHostedPrivyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          address: "user@example.com",
          type: "email",
        },
      ],
    });

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        body: JSON.stringify({
          expectedEmailAddress: "user@example.com",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.syncHostedVerifiedEmailToHostedExecution).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_EMAIL_NOT_READY",
        message: "Your verified email has not reached the server-side Privy session yet. Wait a moment and try again.",
        retryable: true,
      },
    });
  });

  it("requires an active hosted session before syncing the verified email", async () => {
    mocks.resolveHostedSessionFromCookieStore.mockResolvedValue(null);

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.verifyHostedPrivyIdentityToken).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in again before you sync your verified email.",
        retryable: false,
      },
    });
  });
});

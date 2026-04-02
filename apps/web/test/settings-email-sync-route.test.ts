import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  requireHostedPrivyActiveRequestAuthContext: vi.fn(),
  syncHostedVerifiedEmailToHostedExecution: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  syncHostedVerifiedEmailToHostedExecution: mocks.syncHostedVerifiedEmailToHostedExecution,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireHostedPrivyActiveRequestAuthContext: mocks.requireHostedPrivyActiveRequestAuthContext,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    publicBaseUrl: "https://join.example.test",
  }),
}));

type SettingsEmailSyncRouteModule = typeof import("../app/api/settings/email/sync/route");

let settingsEmailSyncRoute: SettingsEmailSyncRouteModule;
const SAME_ORIGIN_HEADERS = {
  origin: "https://join.example.test",
};

describe("settings email sync route", () => {
  beforeAll(async () => {
    settingsEmailSyncRoute = await import("../app/api/settings/email/sync/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedPrivyActiveRequestAuthContext.mockResolvedValue({
      linkedAccounts: [
        {
          address: "user@example.com",
          latest_verified_at: 1743064200,
          type: "email",
        },
      ],
      member: {
        id: "member_123",
        privyUserId: "did:privy:user_123",
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.syncHostedVerifiedEmailToHostedExecution.mockResolvedValue({
      emailAddress: "user@example.com",
      runTriggered: true,
      verifiedAt: "2025-03-27T09:10:00.000Z",
    });
  });

  it("verifies the server-side Privy tokens and syncs the verified email into hosted user env", async () => {
    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        body: JSON.stringify({
          expectedEmailAddress: "user@example.com",
        }),
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireHostedPrivyActiveRequestAuthContext).toHaveBeenCalledWith(expect.any(Request));
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
        headers: SAME_ORIGIN_HEADERS,
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
    mocks.requireHostedPrivyActiveRequestAuthContext.mockRejectedValue(hostedOnboardingError({
      code: "PRIVY_SESSION_MISMATCH",
      httpStatus: 403,
      message: "This Privy session does not match the current hosted account. Reopen the latest invite and try again.",
    }));

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        headers: SAME_ORIGIN_HEADERS,
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

  it("returns a retryable conflict while the updated verified email has not reached the server-side identity token yet", async () => {
    mocks.requireHostedPrivyActiveRequestAuthContext.mockResolvedValue({
      linkedAccounts: [
        {
          address: "user@example.com",
          type: "email",
        },
      ],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        body: JSON.stringify({
          expectedEmailAddress: "user@example.com",
        }),
        headers: SAME_ORIGIN_HEADERS,
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

  it("requires Privy-authenticated hosted member context before syncing the verified email", async () => {
    mocks.requireHostedPrivyActiveRequestAuthContext.mockRejectedValue(hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Verify your phone to continue.",
    }));

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Verify your phone to continue.",
        retryable: false,
      },
    });
  });

  it("blocks sync when hosted access is suspended", async () => {
    mocks.requireHostedPrivyActiveRequestAuthContext.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
      message: "This hosted account is suspended. Contact support to restore access.",
    }));

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.syncHostedVerifiedEmailToHostedExecution).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_MEMBER_SUSPENDED",
        message: "This hosted account is suspended. Contact support to restore access.",
        retryable: false,
      },
    });
  });

  it("blocks sync when hosted billing access is no longer active", async () => {
    mocks.requireHostedPrivyActiveRequestAuthContext.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Finish hosted activation before continuing.",
    }));

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.syncHostedVerifiedEmailToHostedExecution).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_ACCESS_REQUIRED",
        message: "Finish hosted activation before continuing.",
        retryable: false,
      },
    });
  });
});

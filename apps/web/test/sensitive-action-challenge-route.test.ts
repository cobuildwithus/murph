import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  buildSettingsSensitiveActionBinding: vi.fn(() => "a".repeat(64)),
  createSensitiveActionChallenge: vi.fn(),
  getPrisma: vi.fn(),
  prisma: { label: "prisma" },
  requireHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));
vi.mock("@/src/lib/sensitive-actions/server", () => ({
  buildSettingsSensitiveActionBinding: mocks.buildSettingsSensitiveActionBinding,
  createSensitiveActionChallenge: mocks.createSensitiveActionChallenge,
}));

let route: typeof import("../app/api/settings/sensitive-action-challenge/route");

describe("settings sensitive-action challenge route", () => {
  beforeAll(async () => {
    route = await import("../app/api/settings/sensitive-action-challenge/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_123" },
      privyUserId: "privy-user-123",
      sessionId: "session_123",
    });
    mocks.createSensitiveActionChallenge.mockResolvedValue({
      expiresAt: "2026-06-24T12:15:00.000Z",
      message: "message-to-sign",
      token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
    });
  });

  it("derives the binding from the authenticated member and session", async () => {
    const response = await route.POST(new Request(
      "https://join.example.test/api/settings/sensitive-action-challenge",
      {
        body: JSON.stringify({ kind: "vault.export" }),
        headers: {
          "content-type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.buildSettingsSensitiveActionBinding).toHaveBeenCalledWith({
      kind: "vault.export",
      memberId: "member_123",
      sessionId: "session_123",
    });
    expect(mocks.createSensitiveActionChallenge).toHaveBeenCalledWith({
      bindingHash: "a".repeat(64),
      kind: "vault.export",
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects action kinds outside the closed settings union", async () => {
    const response = await route.POST(new Request(
      "https://join.example.test/api/settings/sensitive-action-challenge",
      {
        body: JSON.stringify({ kind: "file.send" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(400);
    expect(mocks.createSensitiveActionChallenge).not.toHaveBeenCalled();
  });

  describe("bundles migration maintenance window", () => {
    function challengeRequest(kind: string): Request {
      return new Request(
        "https://join.example.test/api/settings/sensitive-action-challenge",
        {
          body: JSON.stringify({ kind }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
    }

    it("declines an account-delete challenge before one is created", async () => {
      vi.stubEnv("HOSTED_ACCOUNT_DELETION_MAINTENANCE", "1");

      const response = await route.POST(challengeRequest("account.delete"));

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error.code).toBe("account_deletion_maintenance");
      expect(body.error.message).toContain("your request was not started");
      // Nothing is issued, so the member is never asked to approve anything.
      expect(mocks.createSensitiveActionChallenge).not.toHaveBeenCalled();

      vi.unstubAllEnvs();
    });

    it("leaves every other sensitive action untouched", async () => {
      vi.stubEnv("HOSTED_ACCOUNT_DELETION_MAINTENANCE", "1");

      const response = await route.POST(challengeRequest("vault.export"));

      expect(response.status).toBe(200);
      expect(mocks.createSensitiveActionChallenge).toHaveBeenCalled();

      vi.unstubAllEnvs();
    });

    it("makes no timing promise that could expire while the window is open", async () => {
      vi.stubEnv("HOSTED_ACCOUNT_DELETION_MAINTENANCE", "1");

      const first = await route.POST(challengeRequest("account.delete"));
      const firstBody = await first.json();

      // Asserted verbatim: recovery guidance is a condition, not a duration or
      // a calendar time, because the window can outlast either.
      expect(first.status).toBe(503);
      expect(firstBody.error.message).toBe(
        "Murph is in scheduled maintenance, so we can't delete your account right now. "
        + "Nothing has changed and your request was not started. Please try again after maintenance.",
      );

      // Still true on a later attempt inside the same window.
      const second = await route.POST(challengeRequest("account.delete"));
      const secondBody = await second.json();
      expect(secondBody.error.message).toBe(firstBody.error.message);
      expect(mocks.createSensitiveActionChallenge).not.toHaveBeenCalled();

      vi.unstubAllEnvs();
    });
  });

  it("rejects oversized bodies before creating a challenge", async () => {
    const response = await route.POST(new Request(
      "https://join.example.test/api/settings/sensitive-action-challenge",
      {
        body: JSON.stringify({ kind: "vault.export", padding: "x".repeat(5_000) }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(413);
    expect(mocks.createSensitiveActionChallenge).not.toHaveBeenCalled();
  });
});

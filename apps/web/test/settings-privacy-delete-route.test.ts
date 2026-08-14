import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { HOSTED_ACCOUNT_DATA_DELETION_SCHEMA } from "@/src/lib/hosted-privacy/account-data-shared";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  buildHostedAppSessionClearCookie: vi.fn(),
  buildSettingsSensitiveActionBinding: vi.fn(() => "a".repeat(64)),
  deleteHostedAccountData: vi.fn(),
  getPrisma: vi.fn(),
  parseHostedAccountDeletionRequest: vi.fn(),
  prismaClient: {
    label: "test-prisma",
  },
  requireHostedAppSessionFromRequest: vi.fn(),
  verifyAndConsumeSensitiveActionChallenge: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  buildHostedAppSessionClearCookie: mocks.buildHostedAppSessionClearCookie,
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-privacy/account-data-service", () => ({
  deleteHostedAccountData: mocks.deleteHostedAccountData,
  parseHostedAccountDeletionRequest: mocks.parseHostedAccountDeletionRequest,
}));

vi.mock("@/src/lib/sensitive-actions/server", () => ({
  buildSettingsSensitiveActionBinding: mocks.buildSettingsSensitiveActionBinding,
  verifyAndConsumeSensitiveActionChallenge: mocks.verifyAndConsumeSensitiveActionChallenge,
}));

type SettingsPrivacyDeleteRouteModule = typeof import("../app/api/settings/privacy/delete/route");

let settingsPrivacyDeleteRoute: SettingsPrivacyDeleteRouteModule;

describe("settings privacy delete route", () => {
  beforeAll(async () => {
    settingsPrivacyDeleteRoute = await import("../app/api/settings/privacy/delete/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    applyRouteDefaults();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function applyRouteDefaults(): void {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.parseHostedAccountDeletionRequest.mockReturnValue({
      confirmationPhrase: "DELETE MY ACCOUNT",
      exitFeedback: null,
      providerAccessRemovalConfirmationToken: null,
    });
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_123",
      },
      privyUserId: "privy-user-123",
      sessionId: "session_123",
    });
    mocks.verifyAndConsumeSensitiveActionChallenge.mockResolvedValue(undefined);
    mocks.buildHostedAppSessionClearCookie.mockReturnValue(
      "murph-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    mocks.deleteHostedAccountData.mockResolvedValue({
      cloudflare: {
        deleted: true,
      },
      deletedAt: "2026-04-29T01:02:03.000Z",
      deletedCounts: {
        "prisma.hosted_member": 1,
      },
      memberId: "member_123",
      schema: HOSTED_ACCOUNT_DATA_DELETION_SCHEMA,
    });
  }

  it("pins the maintenance-bearing route lifetime", () => {
    expect(settingsPrivacyDeleteRoute.maxDuration).toBe(300);
  });

  it("uses member auth, not active-member auth, before deleting account data", async () => {
    const request = new Request("https://join.example.test/api/settings/privacy/delete", {
      body: JSON.stringify({
        authorization: {
          signature: `0x${"11".repeat(65)}`,
          token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
        },
        confirmationPhrase: "DELETE MY ACCOUNT",
      }),
      headers: {
        "Content-Type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    });

    const response = await settingsPrivacyDeleteRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.parseHostedAccountDeletionRequest).toHaveBeenCalledWith({
      authorization: {
        signature: `0x${"11".repeat(65)}`,
        token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
      },
      confirmationPhrase: "DELETE MY ACCOUNT",
    });
    expect(mocks.buildSettingsSensitiveActionBinding).toHaveBeenCalledWith({
      kind: "account.delete",
      memberId: "member_123",
      sessionId: "session_123",
    });
    expect(mocks.verifyAndConsumeSensitiveActionChallenge).toHaveBeenCalledWith({
      authorization: {
        signature: `0x${"11".repeat(65)}`,
        token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
      },
      bindingHash: "a".repeat(64),
      kind: "account.delete",
      memberId: "member_123",
      prisma: mocks.prismaClient,
      privyUserId: "privy-user-123",
    });
    expect(mocks.verifyAndConsumeSensitiveActionChallenge.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteHostedAccountData.mock.invocationCallOrder[0],
    );
    expect(mocks.deleteHostedAccountData).toHaveBeenCalledWith({
      exitFeedback: null,
      memberId: "member_123",
      prisma: mocks.prismaClient,
      providerAccessRemovalConfirmationToken: null,
      request: expect.any(Request),
    });
    expect(mocks.buildHostedAppSessionClearCookie).toHaveBeenCalledTimes(1);
    expect(mocks.deleteHostedAccountData.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.buildHostedAppSessionClearCookie.mock.invocationCallOrder[0],
    );
    expect(response.headers.get("Set-Cookie")).toBe(
      "murph-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: {
        memberId: "member_123",
        schema: HOSTED_ACCOUNT_DATA_DELETION_SCHEMA,
      },
    });
  });

  it("rejects a wrong typed phrase before deleting account data", async () => {
    mocks.parseHostedAccountDeletionRequest.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "ACCOUNT_DELETION_CONFIRMATION_PHRASE_REQUIRED",
        httpStatus: 400,
        message: "Type DELETE MY ACCOUNT exactly to delete your account.",
      });
    });

    const request = new Request("https://join.example.test/api/settings/privacy/delete", {
      body: JSON.stringify({
        confirmationPhrase: "delete my account",
      }),
      headers: {
        "Content-Type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    });

    const response = await settingsPrivacyDeleteRoute.POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "ACCOUNT_DELETION_CONFIRMATION_PHRASE_REQUIRED",
      },
    });
    expect(mocks.verifyAndConsumeSensitiveActionChallenge).not.toHaveBeenCalled();
    expect(mocks.deleteHostedAccountData).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies before parsing or deleting account data", async () => {
    const request = new Request("https://join.example.test/api/settings/privacy/delete", {
      body: JSON.stringify({
        confirmationPhrase: "DELETE MY ACCOUNT",
        padding: "x".repeat(5_000),
      }),
      headers: {
        "Content-Type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    });

    const response = await settingsPrivacyDeleteRoute.POST(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "REQUEST_BODY_TOO_LARGE",
      },
    });
    expect(mocks.parseHostedAccountDeletionRequest).not.toHaveBeenCalled();
    expect(mocks.deleteHostedAccountData).not.toHaveBeenCalled();
  });

  describe("bundles migration maintenance window", () => {
    function maintenanceRequest(): Request {
      return new Request("https://join.example.test/api/settings/privacy/delete", {
        body: JSON.stringify({
          authorization: {
            signature: `0x${"11".repeat(65)}`,
            token: "sac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
          },
          confirmationPhrase: "DELETE MY ACCOUNT",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      });
    }

    it("declines with a truthful message and spends nothing", async () => {
      vi.stubEnv("HOSTED_ACCOUNT_DELETION_MAINTENANCE", "1");

      const response = await settingsPrivacyDeleteRoute.POST(maintenanceRequest());

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error.code).toBe("account_deletion_maintenance");
      expect(body.error.message).toContain("scheduled maintenance");
      expect(body.error.message).toContain("your request was not started");

      // The member keeps an unspent authorization and loses no data.
      expect(mocks.verifyAndConsumeSensitiveActionChallenge).not.toHaveBeenCalled();
      expect(mocks.deleteHostedAccountData).not.toHaveBeenCalled();
      expect(mocks.buildHostedAppSessionClearCookie).not.toHaveBeenCalled();
    });

    it("stays available whenever the window flag is not exactly set", async () => {
      for (const value of ["", "0", "true", "yes"]) {
        vi.clearAllMocks();
        applyRouteDefaults();
        vi.stubEnv("HOSTED_ACCOUNT_DELETION_MAINTENANCE", value);

        const response = await settingsPrivacyDeleteRoute.POST(maintenanceRequest());

        expect(response.status).toBe(200);
        expect(mocks.deleteHostedAccountData).toHaveBeenCalled();
      }
    });
  });
});

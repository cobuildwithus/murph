import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  deleteHostedAccountData: vi.fn(),
  getPrisma: vi.fn(),
  parseHostedAccountDeletionRequest: vi.fn(),
  prismaClient: {
    label: "test-prisma",
  },
  requirePrivyMemberAuth: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requirePrivyMemberAuth: mocks.requirePrivyMemberAuth,
}));

vi.mock("@/src/lib/hosted-privacy/account-data-service", () => ({
  deleteHostedAccountData: mocks.deleteHostedAccountData,
  parseHostedAccountDeletionRequest: mocks.parseHostedAccountDeletionRequest,
}));

type SettingsPrivacyDeleteRouteModule = typeof import("../app/api/settings/privacy/delete/route");

let settingsPrivacyDeleteRoute: SettingsPrivacyDeleteRouteModule;

describe("settings privacy delete route", () => {
  beforeAll(async () => {
    settingsPrivacyDeleteRoute = await import("../app/api/settings/privacy/delete/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.parseHostedAccountDeletionRequest.mockReturnValue({
      acknowledgedIrreversibleDeletion: true,
      acknowledgedProviderAndBackupLimits: true,
      confirmationPhrase: "DELETE MY MURPH DATA",
      secondConfirmationAccepted: true,
    });
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
    mocks.deleteHostedAccountData.mockResolvedValue({
      deletedAt: "2026-04-29T01:02:03.000Z",
      deletedCounts: {
        "prisma.hosted_member": 1,
      },
      memberId: "member_123",
      schema: "murph.hosted-account-data-deletion.v1",
    });
  });

  it("uses member auth, not active-member auth, before deleting account data", async () => {
    const request = new Request("https://join.example.test/api/settings/privacy/delete", {
      body: JSON.stringify({
        acknowledgedIrreversibleDeletion: true,
        acknowledgedProviderAndBackupLimits: true,
        confirmationPhrase: "DELETE MY MURPH DATA",
        secondConfirmationAccepted: true,
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
    expect(mocks.requirePrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request), mocks.prismaClient);
    expect(mocks.parseHostedAccountDeletionRequest).toHaveBeenCalledWith({
      acknowledgedIrreversibleDeletion: true,
      acknowledgedProviderAndBackupLimits: true,
      confirmationPhrase: "DELETE MY MURPH DATA",
      secondConfirmationAccepted: true,
    });
    expect(mocks.deleteHostedAccountData).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      request: expect.any(Request),
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: {
        memberId: "member_123",
        schema: "murph.hosted-account-data-deletion.v1",
      },
    });
  });
});

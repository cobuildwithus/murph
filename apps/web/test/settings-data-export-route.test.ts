import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  buildHostedDataExport: vi.fn(),
  getPrisma: vi.fn(),
  parseHostedDataExportRequest: vi.fn(),
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
  buildHostedDataExport: mocks.buildHostedDataExport,
  parseHostedDataExportRequest: mocks.parseHostedDataExportRequest,
}));

type SettingsDataExportRouteModule = typeof import("../app/api/settings/data-export/route");

let settingsDataExportRoute: SettingsDataExportRouteModule;

describe("settings data export route", () => {
  beforeAll(async () => {
    settingsDataExportRoute = await import("../app/api/settings/data-export/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.parseHostedDataExportRequest.mockReturnValue({
      acknowledgedSensitiveDownload: true,
      confirmationText: "EXPORT MY DATA",
    });
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
    mocks.buildHostedDataExport.mockResolvedValue({
      generatedAt: "2026-04-29T01:02:03.000Z",
      memberId: "member_123",
      schema: "murph.hosted-data-export.v1",
    });
  });

  it("rejects GET export attempts with a no-store method error", async () => {
    const response = settingsDataExportRoute.GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Data export requires a confirmed POST request from Settings.",
      },
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).not.toHaveBeenCalled();
    expect(mocks.requirePrivyMemberAuth).not.toHaveBeenCalled();
  });

  it("requires same-origin member auth and returns a no-store JSON attachment", async () => {
    const response = await settingsDataExportRoute.POST(
      new Request("https://join.example.test/api/settings/data-export", {
        body: JSON.stringify({
          acknowledgedSensitiveDownload: true,
          confirmationText: "EXPORT MY DATA",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, no-cache, max-age=0, must-revalidate");
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="murph-data-export-2026-04-29T01-02-03-000Z.json"',
    );
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.requirePrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request), mocks.prismaClient);
    expect(mocks.parseHostedDataExportRequest).toHaveBeenCalledWith({
      acknowledgedSensitiveDownload: true,
      confirmationText: "EXPORT MY DATA",
    });
    expect(mocks.buildHostedDataExport).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
    await expect(response.json()).resolves.toEqual({
      generatedAt: "2026-04-29T01:02:03.000Z",
      memberId: "member_123",
      schema: "murph.hosted-data-export.v1",
    });
  });
});

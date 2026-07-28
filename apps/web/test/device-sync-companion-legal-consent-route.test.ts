import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  parseHostedConsentAcceptRequest: vi.fn(),
  prisma: { label: "companion-consent-route-prisma" },
  readHostedConsentStatus: vi.fn(),
  readHostedOnboardingJsonObject: vi.fn(),
  recordHostedLaunchRequiredConsent: vi.fn(),
  requirePrivyMemberAuthFromBearerToken: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/http")>()),
  readHostedOnboardingJsonObject: mocks.readHostedOnboardingJsonObject,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requirePrivyMemberAuthFromBearerToken:
    mocks.requirePrivyMemberAuthFromBearerToken,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  parseHostedConsentAcceptRequest: mocks.parseHostedConsentAcceptRequest,
  readHostedConsentStatus: mocks.readHostedConsentStatus,
  recordHostedLaunchRequiredConsent: mocks.recordHostedLaunchRequiredConsent,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type CompanionConsentRoute =
  typeof import("../app/api/device-sync/companion/legal-consent/route");

const MEMBER = { id: "member-route-test" };
const STATUS = {
  documents: [],
  generatedAt: "2026-07-26T20:00:00.000Z",
  launchGranted: false,
  launchScopes: [],
  ok: true as const,
  schema: "murph.hosted-consent-status.v1" as const,
  scopes: [],
};
const RECORDED_STATUS = {
  ...STATUS,
  launchGranted: true,
};

let route: CompanionConsentRoute;

describe("device sync companion legal consent route", () => {
  beforeAll(async () => {
    route = await import("../app/api/device-sync/companion/legal-consent/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.requirePrivyMemberAuthFromBearerToken.mockResolvedValue({
      member: MEMBER,
    });
    mocks.readHostedConsentStatus.mockResolvedValue(STATUS);
    mocks.recordHostedLaunchRequiredConsent.mockResolvedValue(RECORDED_STATUS);
  });

  it("reads the member's canonical consent status with Privy bearer auth", async () => {
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/legal-consent",
    );

    const response = await route.GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(STATUS);
    expect(mocks.requirePrivyMemberAuthFromBearerToken).toHaveBeenCalledWith(
      request,
      mocks.prisma,
    );
    expect(mocks.readHostedConsentStatus).toHaveBeenCalledWith({
      memberId: MEMBER.id,
      prisma: mocks.prisma,
    });
  });

  it.each(["launch.legal", "launch.health-data"] as const)(
    "records %s with server-owned native companion provenance",
    async (scope) => {
      const request = new Request(
        "https://app.example.test/api/device-sync/companion/legal-consent",
        { method: "POST" },
      );
      const rawBody = { raw: "body" };
      const consent = {
        acceptedDocumentVersions: { document: "2026-07-23" },
        scope,
        source: "untrusted-client-label",
      };
      mocks.readHostedOnboardingJsonObject.mockResolvedValue(rawBody);
      mocks.parseHostedConsentAcceptRequest.mockReturnValue(consent);

      const response = await route.POST(request);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(RECORDED_STATUS);
      expect(mocks.readHostedOnboardingJsonObject).toHaveBeenCalledWith(request, {
        limitBytes: 8 * 1024,
        tooLargeErrorCode: "CONSENT_REQUEST_TOO_LARGE",
        tooLargeErrorMessage: "The consent request is too large.",
      });
      expect(mocks.parseHostedConsentAcceptRequest).toHaveBeenCalledWith(rawBody);
      expect(mocks.recordHostedLaunchRequiredConsent).toHaveBeenCalledWith({
        acceptedDocumentVersions: consent.acceptedDocumentVersions,
        memberId: MEMBER.id,
        prisma: mocks.prisma,
        scope,
        source: "native-companion",
      });
    },
  );

  it("rejects unauthenticated writes before reading or recording consent", async () => {
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/legal-consent",
      { method: "POST" },
    );
    mocks.requirePrivyMemberAuthFromBearerToken.mockRejectedValue(
      hostedOnboardingError({
        code: "AUTH_REQUIRED",
        httpStatus: 401,
        message: "Sign in to continue.",
      }),
    );

    const response = await route.POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in to continue.",
        retryable: false,
      },
    });
    expect(mocks.readHostedOnboardingJsonObject).not.toHaveBeenCalled();
    expect(mocks.parseHostedConsentAcceptRequest).not.toHaveBeenCalled();
    expect(mocks.recordHostedLaunchRequiredConsent).not.toHaveBeenCalled();
  });

  it("rejects optional feature scopes without writing a grant", async () => {
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/legal-consent",
      { method: "POST" },
    );
    mocks.readHostedOnboardingJsonObject.mockResolvedValue({});
    mocks.parseHostedConsentAcceptRequest.mockReturnValue({
      acceptedDocumentVersions: {},
      scope: "feature.health-ai",
      source: "ios-companion",
    });

    const response = await route.POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CONSENT_SCOPE_NOT_ALLOWED",
        message: "The companion app can accept launch consent only.",
        retryable: false,
      },
    });
    expect(mocks.recordHostedLaunchRequiredConsent).not.toHaveBeenCalled();
  });
});

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  grantHostedOptionalFeatureConsent: vi.fn(),
  readHostedConsentStatus: vi.fn(),
  recordHostedLaunchRequiredConsent: vi.fn(),
  requirePrivyMemberAuth: vi.fn(),
  revokeHostedOptionalFeatureConsent: vi.fn(),
  prismaClient: {
    label: "test-prisma",
  },
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requirePrivyMemberAuth,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/legal/consent", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/legal/consent")>(
    "@/src/lib/legal/consent",
  );

  return {
    ...actual,
    grantHostedOptionalFeatureConsent: mocks.grantHostedOptionalFeatureConsent,
    readHostedConsentStatus: mocks.readHostedConsentStatus,
    recordHostedLaunchRequiredConsent: mocks.recordHostedLaunchRequiredConsent,
    revokeHostedOptionalFeatureConsent: mocks.revokeHostedOptionalFeatureConsent,
  };
});

type HostedConsentStatusRouteModule = typeof import("../app/api/legal/consent/status/route");
type HostedConsentAcceptRouteModule = typeof import("../app/api/legal/consent/accept/route");
type HostedConsentRevokeRouteModule = typeof import("../app/api/legal/consent/revoke/route");

let consentStatusRoute: HostedConsentStatusRouteModule;
let consentAcceptRoute: HostedConsentAcceptRouteModule;
let consentRevokeRoute: HostedConsentRevokeRouteModule;

const memberAuth = {
  member: {
    id: "member_123",
  },
};

const currentStatus = {
  documents: [],
  generatedAt: "2026-04-29T01:02:03.000Z",
  launchGranted: true,
  launchScopes: [
    { granted: true, missingDocuments: [], scope: "launch.legal" },
    { granted: true, missingDocuments: [], scope: "launch.health-data" },
  ],
  ok: true,
  schema: "murph.hosted-consent-status.v1",
  scopes: [],
};

describe("legal consent routes", () => {
  beforeAll(async () => {
    [consentStatusRoute, consentAcceptRoute, consentRevokeRoute] = await Promise.all([
      import("../app/api/legal/consent/status/route"),
      import("../app/api/legal/consent/accept/route"),
      import("../app/api/legal/consent/revoke/route"),
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.requirePrivyMemberAuth.mockResolvedValue(memberAuth);
    mocks.readHostedConsentStatus.mockResolvedValue(currentStatus);
    mocks.recordHostedLaunchRequiredConsent.mockResolvedValue(currentStatus);
    mocks.grantHostedOptionalFeatureConsent.mockResolvedValue(currentStatus);
    mocks.revokeHostedOptionalFeatureConsent.mockResolvedValue(currentStatus);
  });

  it("returns the current consent status for the authenticated hosted member", async () => {
    const response = await consentStatusRoute.GET(
      new Request("https://join.example.test/api/legal/consent/status", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.requirePrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.readHostedConsentStatus).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
    await expect(response.json()).resolves.toEqual(currentStatus);
  });

  it("records launch.legal consent against the launch scope helper", async () => {
    const response = await consentAcceptRoute.POST(
      new Request("https://join.example.test/api/legal/consent/accept", {
        body: JSON.stringify({
          acceptedDocumentVersions: {
            "health-ai-safety-disclosure": "2026-04-29",
            "privacy-policy": "2026-06-24",
            "terms-of-service": "2026-04-29",
          },
          scope: "launch.legal",
          source: "  hosted   onboarding  ",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.recordHostedLaunchRequiredConsent).toHaveBeenCalledWith({
      acceptedDocumentVersions: {
        "health-ai-safety-disclosure": "2026-04-29",
        "privacy-policy": "2026-06-24",
        "terms-of-service": "2026-04-29",
      },
      memberId: "member_123",
      prisma: mocks.prismaClient,
      scope: "launch.legal",
      source: "hosted onboarding",
    });
    expect(mocks.grantHostedOptionalFeatureConsent).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual(currentStatus);
  });

  it("records launch.health-data consent against the launch scope helper", async () => {
    const response = await consentAcceptRoute.POST(
      new Request("https://join.example.test/api/legal/consent/accept", {
        body: JSON.stringify({
          acceptedDocumentVersions: {
            "consumer-health-data-notice": "2026-04-29",
          },
          scope: "launch.health-data",
          source: "hosted onboarding",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.recordHostedLaunchRequiredConsent).toHaveBeenCalledWith({
      acceptedDocumentVersions: {
        "consumer-health-data-notice": "2026-04-29",
      },
      memberId: "member_123",
      prisma: mocks.prismaClient,
      scope: "launch.health-data",
      source: "hosted onboarding",
    });
    expect(mocks.grantHostedOptionalFeatureConsent).not.toHaveBeenCalled();
  });

  it("rejects consent mutations before auth when the hosted origin guard fails", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_ORIGIN_REQUIRED",
        httpStatus: 403,
        message: "Hosted browser mutation routes require an Origin header.",
      });
    });

    const response = await consentAcceptRoute.POST(
      new Request("https://join.example.test/api/legal/consent/accept", {
        body: JSON.stringify({
          acceptedDocumentVersions: {
            "health-ai-safety-disclosure": "2026-04-29",
            "privacy-policy": "2026-06-24",
            "terms-of-service": "2026-04-29",
          },
          scope: "launch.legal",
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requirePrivyMemberAuth).not.toHaveBeenCalled();
    expect(mocks.recordHostedLaunchRequiredConsent).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_ONBOARDING_ORIGIN_REQUIRED",
        message: "Hosted browser mutation routes require an Origin header.",
        retryable: false,
      },
    });
  });

  it("rejects stale consent documents before writing a grant record", async () => {
    const response = await consentAcceptRoute.POST(
      new Request("https://join.example.test/api/legal/consent/accept", {
        body: JSON.stringify({
          acceptedDocumentVersions: {
            "health-ai-safety-disclosure": "2026-01-01",
            "privacy-policy": "2026-06-24",
            "terms-of-service": "2026-04-29",
          },
          scope: "launch.legal",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.recordHostedLaunchRequiredConsent).not.toHaveBeenCalled();
    expect(mocks.grantHostedOptionalFeatureConsent).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "CONSENT_DOCUMENT_VERSIONS_STALE",
        details: {
          missingOrStaleDocumentIds: ["health-ai-safety-disclosure"],
          scope: "launch.legal",
        },
        message: "Refresh the current Murph legal documents before accepting consent.",
        retryable: false,
      },
    });
  });

  it("routes optional feature consent through the optional helper", async () => {
    const response = await consentAcceptRoute.POST(
      new Request("https://join.example.test/api/legal/consent/accept", {
        body: JSON.stringify({
          acceptedDocumentVersions: {
            "consumer-health-data-notice": "2026-04-29",
            "health-ai-safety-disclosure": "2026-04-29",
            "privacy-policy": "2026-06-24",
          },
          scope: "feature.health-ai",
          source: "settings",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.grantHostedOptionalFeatureConsent).toHaveBeenCalledWith({
      acceptedDocumentVersions: {
        "consumer-health-data-notice": "2026-04-29",
        "health-ai-safety-disclosure": "2026-04-29",
        "privacy-policy": "2026-06-24",
      },
      memberId: "member_123",
      prisma: mocks.prismaClient,
      scope: "feature.health-ai",
      source: "settings",
    });
    expect(mocks.recordHostedLaunchRequiredConsent).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual(currentStatus);
  });

  it("rejects launch scope revocation before reaching the revoke helper", async () => {
    const response = await consentRevokeRoute.POST(
      new Request("https://join.example.test/api/legal/consent/revoke", {
        body: JSON.stringify({
          scope: "launch.legal",
          source: "settings",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.revokeHostedOptionalFeatureConsent).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CONSENT_SCOPE_NOT_REVOCABLE",
        message: "This consent is required to use hosted Murph and cannot be revoked through this endpoint.",
        retryable: false,
      },
    });
  });

  it("revokes optional feature consent with the parsed source", async () => {
    const response = await consentRevokeRoute.POST(
      new Request("https://join.example.test/api/legal/consent/revoke", {
        body: JSON.stringify({
          scope: "feature.connected-health-source",
          source: "settings",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.revokeHostedOptionalFeatureConsent).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      scope: "feature.connected-health-source",
      source: "settings",
    });
    await expect(response.json()).resolves.toEqual(currentStatus);
  });
});

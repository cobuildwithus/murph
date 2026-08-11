import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  cleanupWithdrawnHostedHealthDataConsent: vi.fn(),
  getPrisma: vi.fn(),
  grantHostedOptionalFeatureConsent: vi.fn(),
  readHostedHealthDataConsentState: vi.fn(),
  readHostedRuntimeAiAccessDecision: vi.fn(),
  readHostedConsentStatus: vi.fn(),
  reconcileHostedHealthDataRuntimeConsent: vi.fn(),
  recordHostedLaunchConsentDecline: vi.fn(),
  recordHostedLaunchRequiredConsent: vi.fn(),
  requirePrivyMemberAuth: vi.fn(),
  revokeHostedAppSessionFromRequest: vi.fn(),
  revokeHostedConsentScope: vi.fn(),
  signalHostedRuntimeRecheckRuntime: vi.fn(),
  withdrawHostedHealthDataConsent: vi.fn(),
  prismaClient: {
    label: "test-prisma",
  },
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requirePrivyMemberAuth,
  revokeHostedAppSessionFromRequest: mocks.revokeHostedAppSessionFromRequest,
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
    readHostedHealthDataConsentState: mocks.readHostedHealthDataConsentState,
    readHostedConsentStatus: mocks.readHostedConsentStatus,
    recordHostedLaunchConsentDecline: mocks.recordHostedLaunchConsentDecline,
    recordHostedLaunchRequiredConsent: mocks.recordHostedLaunchRequiredConsent,
    revokeHostedConsentScope: mocks.revokeHostedConsentScope,
  };
});

vi.mock("@/src/lib/hosted-privacy/health-data-consent-withdrawal", () => ({
  cleanupWithdrawnHostedHealthDataConsent:
    mocks.cleanupWithdrawnHostedHealthDataConsent,
  reconcileHostedHealthDataRuntimeConsent:
    mocks.reconcileHostedHealthDataRuntimeConsent,
  withdrawHostedHealthDataConsent: mocks.withdrawHostedHealthDataConsent,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readHostedRuntimeAiAccessDecision: mocks.readHostedRuntimeAiAccessDecision,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedRuntimeRecheckRuntime: mocks.signalHostedRuntimeRecheckRuntime,
}));

type HostedConsentStatusRouteModule = typeof import("../app/api/legal/consent/status/route");
type HostedConsentAcceptRouteModule = typeof import("../app/api/legal/consent/accept/route");
type HostedConsentDeclineRouteModule = typeof import("../app/api/legal/consent/decline/route");
type HostedConsentRevokeRouteModule = typeof import("../app/api/legal/consent/revoke/route");

let consentStatusRoute: HostedConsentStatusRouteModule;
let consentAcceptRoute: HostedConsentAcceptRouteModule;
let consentDeclineRoute: HostedConsentDeclineRouteModule;
let consentRevokeRoute: HostedConsentRevokeRouteModule;

const memberAuth = {
  member: {
    id: "member_123",
  },
  sessionId: "session_123",
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
    [consentStatusRoute, consentAcceptRoute, consentDeclineRoute, consentRevokeRoute] = await Promise.all([
      import("../app/api/legal/consent/status/route"),
      import("../app/api/legal/consent/accept/route"),
      import("../app/api/legal/consent/decline/route"),
      import("../app/api/legal/consent/revoke/route"),
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.requirePrivyMemberAuth.mockResolvedValue(memberAuth);
    mocks.readHostedConsentStatus.mockResolvedValue(currentStatus);
    mocks.readHostedHealthDataConsentState.mockResolvedValue("missing");
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({ allowed: true });
    mocks.reconcileHostedHealthDataRuntimeConsent.mockResolvedValue({
      consentState: "revoked",
      processingAllowed: false,
      stopped: true,
      userId: "member_123",
    });
    mocks.recordHostedLaunchConsentDecline.mockResolvedValue([
      "launch.legal",
      "launch.health-data",
    ]);
    mocks.recordHostedLaunchRequiredConsent.mockResolvedValue(currentStatus);
    mocks.revokeHostedAppSessionFromRequest.mockResolvedValue(
      "murph-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    mocks.grantHostedOptionalFeatureConsent.mockResolvedValue(currentStatus);
    mocks.revokeHostedConsentScope.mockResolvedValue(currentStatus);
    mocks.withdrawHostedHealthDataConsent.mockResolvedValue(currentStatus);
    mocks.signalHostedRuntimeRecheckRuntime.mockResolvedValue(undefined);
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
            "health-ai-safety-disclosure": "2026-07-23",
            "privacy-policy": "2026-08-11",
            "terms-of-service": "2026-08-11",
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
        "health-ai-safety-disclosure": "2026-07-23",
        "privacy-policy": "2026-08-11",
        "terms-of-service": "2026-08-11",
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
            "consumer-health-data-notice": "2026-07-23",
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
        "consumer-health-data-notice": "2026-07-23",
      },
      memberId: "member_123",
      prisma: mocks.prismaClient,
      scope: "launch.health-data",
      source: "hosted onboarding",
    });
    expect(mocks.grantHostedOptionalFeatureConsent).not.toHaveBeenCalled();
    expect(mocks.reconcileHostedHealthDataRuntimeConsent).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  it("serializes renewed health-data consent behind the stop barrier before signaling runtime", async () => {
    mocks.readHostedHealthDataConsentState.mockResolvedValueOnce("revoked");

    const response = await consentAcceptRoute.POST(
      new Request("https://join.example.test/api/legal/consent/accept", {
        body: JSON.stringify({
          acceptedDocumentVersions: {
            "consumer-health-data-notice": "2026-07-23",
          },
          scope: "launch.health-data",
          source: "settings-health-data-resume",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.reconcileHostedHealthDataRuntimeConsent).toHaveBeenCalledWith({
      memberId: "member_123",
    });
    expect(
      mocks.reconcileHostedHealthDataRuntimeConsent.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.recordHostedLaunchRequiredConsent.mock.invocationCallOrder[0] ?? 0);
    expect(
      mocks.recordHostedLaunchRequiredConsent.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.signalHostedRuntimeRecheckRuntime.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      prisma: mocks.prismaClient,
      userId: "member_123",
    });
  });

  it("records server-derived launch declines and revokes the authenticated session", async () => {
    const request = new Request("https://join.example.test/api/legal/consent/decline", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    });

    const response = await consentDeclineRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toBe(
      "murph-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    expect(mocks.recordHostedLaunchConsentDecline).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      sessionId: "session_123",
      source: "homepage-auth-dialog",
    });
    expect(mocks.revokeHostedAppSessionFromRequest).toHaveBeenCalledWith({
      reason: "consent_declined",
      request,
    });
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("still revokes the app session when the scoped decline audit is unavailable", async () => {
    mocks.recordHostedLaunchConsentDecline.mockRejectedValueOnce(
      new Error("audit unavailable"),
    );
    const request = new Request("https://join.example.test/api/legal/consent/decline", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    });

    const response = await consentDeclineRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toBe(
      "murph-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    expect(mocks.revokeHostedAppSessionFromRequest).toHaveBeenCalledWith({
      reason: "consent_declined",
      request,
    });
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("fails the decline request when authoritative session revocation is unavailable", async () => {
    mocks.revokeHostedAppSessionFromRequest.mockRejectedValueOnce(
      new Error("session store unavailable"),
    );
    const request = new Request("https://join.example.test/api/legal/consent/decline", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    });

    const response = await consentDeclineRoute.POST(request);

    expect(response.status).toBe(500);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(mocks.recordHostedLaunchConsentDecline).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      sessionId: "session_123",
      source: "homepage-auth-dialog",
    });
    expect(mocks.revokeHostedAppSessionFromRequest).toHaveBeenCalledWith({
      reason: "consent_declined",
      request,
    });
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    });
  });

  it("rejects launch decline before auth when the hosted origin guard fails", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_ORIGIN_REQUIRED",
        httpStatus: 403,
        message: "Hosted browser mutation routes require an Origin header.",
      });
    });

    const response = await consentDeclineRoute.POST(
      new Request("https://join.example.test/api/legal/consent/decline", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requirePrivyMemberAuth).not.toHaveBeenCalled();
    expect(mocks.recordHostedLaunchConsentDecline).not.toHaveBeenCalled();
    expect(mocks.revokeHostedAppSessionFromRequest).not.toHaveBeenCalled();
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
            "health-ai-safety-disclosure": "2026-07-23",
            "privacy-policy": "2026-07-23",
            "terms-of-service": "2026-07-23",
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
            "privacy-policy": "2026-08-11",
            "terms-of-service": "2026-08-11",
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
            "consumer-health-data-notice": "2026-07-23",
            "health-ai-safety-disclosure": "2026-07-23",
            "privacy-policy": "2026-08-11",
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
        "consumer-health-data-notice": "2026-07-23",
        "health-ai-safety-disclosure": "2026-07-23",
        "privacy-policy": "2026-08-11",
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
    expect(mocks.revokeHostedConsentScope).not.toHaveBeenCalled();
    expect(mocks.withdrawHostedHealthDataConsent).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CONSENT_SCOPE_NOT_REVOCABLE",
        message: "The launch legal agreement cannot be revoked through this endpoint.",
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
    expect(mocks.revokeHostedConsentScope).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      scope: "feature.connected-health-source",
      source: "settings",
    });
    await expect(response.json()).resolves.toEqual(currentStatus);
  });

  it("routes health-data withdrawal through the cleanup orchestrator", async () => {
    const response = await consentRevokeRoute.POST(
      new Request("https://join.example.test/api/legal/consent/revoke", {
        body: JSON.stringify({
          scope: "launch.health-data",
          source: "settings-health-data",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.withdrawHostedHealthDataConsent).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      source: "settings-health-data",
    });
    expect(mocks.reconcileHostedHealthDataRuntimeConsent).toHaveBeenCalledWith({
      memberId: "member_123",
    });
    expect(
      mocks.withdrawHostedHealthDataConsent.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.reconcileHostedHealthDataRuntimeConsent.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.cleanupWithdrawnHostedHealthDataConsent).not.toHaveBeenCalled();
    const cleanup = mocks.after.mock.calls[0]?.[0];
    expect(cleanup).toBeTypeOf("function");
    await cleanup?.();
    expect(mocks.cleanupWithdrawnHostedHealthDataConsent).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      request: expect.any(Request),
    });
    expect(mocks.revokeHostedConsentScope).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual(currentStatus);
  });

  it("does not schedule stale provider cleanup when concurrent renewal wins", async () => {
    mocks.reconcileHostedHealthDataRuntimeConsent.mockResolvedValueOnce({
      consentState: "granted",
      processingAllowed: true,
      stopped: false,
      userId: "member_123",
    });

    const response = await consentRevokeRoute.POST(
      new Request("https://join.example.test/api/legal/consent/revoke", {
        body: JSON.stringify({
          scope: "launch.health-data",
          source: "settings-health-data",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.readHostedConsentStatus).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
  });
});

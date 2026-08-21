import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  assertHostedMemberNotSuspended: vi.fn(),
  completeHostedPrivyVerification: vi.fn(),
  createHostedDeviceSyncPublicIngressService: vi.fn(),
  ensureHostedStarterUsageEnrollment: vi.fn(),
  getPrisma: vi.fn(),
  lookupHostedMemberForPrivyPrincipal: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  retryPendingHostedStarterUsageActivationRuntimeWake: vi.fn(),
  remapHostedPrivyCompletionLagError: vi.fn((error: unknown) => error),
  resolveHostedPrivySessionFromBearerToken: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService:
    mocks.createHostedDeviceSyncPublicIngressService,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedHistoricalLaunchConsentGranted:
    mocks.assertHostedHistoricalLaunchConsentGranted,
}));

vi.mock("@/src/lib/hosted-onboarding/authentication-service", () => ({
  completeHostedPrivyVerification: mocks.completeHostedPrivyVerification,
}));

vi.mock("@/src/lib/hosted-onboarding/starter-usage-enrollment-service", () => ({
  ensureHostedStarterUsageEnrollment: mocks.ensureHostedStarterUsageEnrollment,
  retryPendingHostedStarterUsageActivationRuntimeWake:
    mocks.retryPendingHostedStarterUsageActivationRuntimeWake,
}));

vi.mock("@/src/lib/hosted-onboarding/entitlement", () => ({
  assertHostedMemberNotSuspended: mocks.assertHostedMemberNotSuspended,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed:
    mocks.assertActiveHostedMemberAccessAllowed,
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  lookupHostedMemberForPrivyPrincipal:
    mocks.lookupHostedMemberForPrivyPrincipal,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  remapHostedPrivyCompletionLagError: mocks.remapHostedPrivyCompletionLagError,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-session", () => ({
  resolveHostedPrivySessionFromBearerToken:
    mocks.resolveHostedPrivySessionFromBearerToken,
}));

import {
  ensureHostedCompanionMemberId,
  requireHostedCompanionMemberIdFromRequest,
} from "@/src/lib/hosted-onboarding/companion-member-access";

type AdmissionRouteModule = typeof import(
  "../app/api/device-sync/companion/admission/route"
);

let admissionRoute: AdmissionRouteModule;

const prisma = { label: "test-prisma" } as never;
const identity = {
  phone: {
    number: "+15550000000",
    verifiedAt: 1_785_456_000,
  },
  telegram: null,
  userId: "did:privy:native-member",
  wallet: null,
} as const;
const emailIdentity = {
  email: {
    address: "native-member@example.test",
    verifiedAt: 1_785_456_000,
  },
  phone: null,
  telegram: null,
  userId: "did:privy:native-email-member",
} as const;

function member(
  billingStatus: HostedBillingStatus = HostedBillingStatus.not_started,
) {
  return {
    billingStatus,
    createdAt: new Date("2026-07-31T10:00:00.000Z"),
    id: "member_native",
    suspendedAt: null,
    updatedAt: new Date("2026-07-31T10:00:00.000Z"),
  };
}

function completion(
  billingStatus: HostedBillingStatus = HostedBillingStatus.not_started,
) {
  const completedMember = member(billingStatus);
  return {
    inviteCode: "invite_native",
    joinUrl: "https://withmurph.ai/join/invite_native",
    member: completedMember,
    memberId: completedMember.id,
    messagingSetupRequired: false,
    stage: billingStatus === HostedBillingStatus.active ? "active" : "checkout",
  };
}

function admissionRequest(
  token = "privy-identity-token",
  headers: Record<string, string> = {},
): Request {
  return new Request(
    "https://app.example.test/api/device-sync/companion/admission",
    {
      headers: {
        authorization: `Bearer ${token}`,
        ...headers,
      },
      method: "POST",
    },
  );
}

describe("native companion hosted member admission", () => {
  beforeAll(async () => {
    admissionRoute = await import(
      "../app/api/device-sync/companion/admission/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HOSTED_SIGNUP_NOTIFICATION_EMAILS", "founder@example.com");
    vi.stubEnv("HOSTED_SIGNUP_WELCOME_EMAIL_FROM", "Murph <welcome@example.com>");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.assertHostedHistoricalLaunchConsentGranted.mockResolvedValue(undefined);
    mocks.assertActiveHostedMemberAccessAllowed.mockResolvedValue(undefined);
    mocks.assertHostedMemberNotSuspended.mockReturnValue(undefined);
    mocks.completeHostedPrivyVerification.mockResolvedValue(completion());
    mocks.ensureHostedStarterUsageEnrollment.mockResolvedValue({
      redirectPath: "/home",
      status: "enrolled",
    });
    mocks.retryPendingHostedStarterUsageActivationRuntimeWake
      .mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires bearer identity without falling back to browser authority", async () => {
    mocks.resolveHostedPrivySessionFromBearerToken.mockResolvedValue(null);

    await expect(requireHostedCompanionMemberIdFromRequest({
      prisma,
      request: new Request(
        "https://app.example.test/api/device-sync/companion/sign-in-token",
      ),
    })).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });

    expect(mocks.lookupHostedMemberForPrivyPrincipal).not.toHaveBeenCalled();
  });

  it("maps an invalid non-empty bearer through the real member owner without device ingress", async () => {
    mocks.resolveHostedPrivySessionFromBearerToken.mockResolvedValue(null);

    const incoming = admissionRequest("invalid-token");
    const response = await admissionRoute.POST(incoming);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "AUTH_REQUIRED",
      },
    });
    expect(mocks.resolveHostedPrivySessionFromBearerToken).toHaveBeenCalledWith(
      incoming,
    );
    expect(mocks.lookupHostedMemberForPrivyPrincipal).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("maps blocked starter enrollment to access recovery without device ingress", async () => {
    const pendingMember = member();
    mocks.resolveHostedPrivySessionFromBearerToken.mockResolvedValue({ identity });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(pendingMember);
    mocks.readActiveHostedMemberAccess
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    mocks.completeHostedPrivyVerification.mockResolvedValue(completion());
    mocks.ensureHostedStarterUsageEnrollment.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_STARTER_USAGE_ENROLLMENT_BLOCKED",
        httpStatus: 409,
        message: "Starter usage enrollment is blocked.",
      }),
    );

    const response = await admissionRoute.POST(admissionRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_ACCESS_REQUIRED",
      },
    });
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
      memberId: pendingMember.id,
      prisma,
    });
    expect(mocks.ensureHostedStarterUsageEnrollment).toHaveBeenCalled();
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("returns the fixed admission response for an existing active member without device ingress", async () => {
    const activeMember = member(HostedBillingStatus.active);
    mocks.resolveHostedPrivySessionFromBearerToken.mockResolvedValue({ identity });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(activeMember);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);

    const response = await admissionRoute.POST(admissionRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
      memberId: activeMember.id,
      prisma,
    });
    expect(mocks.completeHostedPrivyVerification).not.toHaveBeenCalled();
    expect(mocks.ensureHostedStarterUsageEnrollment).not.toHaveBeenCalled();
    expect(mocks.retryPendingHostedStarterUsageActivationRuntimeWake)
      .toHaveBeenCalledWith({
        memberId: activeMember.id,
        prisma,
      });
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("uses canonical welcome defaults for a fresh consented phone activation and remains idempotent", async () => {
    const activeMember = member(HostedBillingStatus.active);
    mocks.resolveHostedPrivySessionFromBearerToken.mockResolvedValue({ identity });
    mocks.lookupHostedMemberForPrivyPrincipal
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeMember);
    mocks.readActiveHostedMemberAccess
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mocks.ensureHostedStarterUsageEnrollment.mockResolvedValueOnce({
      redirectPath: "/home",
      status: "enrolled",
    });

    const firstResponse = await admissionRoute.POST(admissionRequest());
    const repeatedResponse = await admissionRoute.POST(admissionRequest());

    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toEqual({ ok: true });
    expect(repeatedResponse.status).toBe(200);
    await expect(repeatedResponse.json()).resolves.toEqual({ ok: true });
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledOnce();
    expect(mocks.ensureHostedStarterUsageEnrollment).toHaveBeenCalledOnce();
    expect(mocks.ensureHostedStarterUsageEnrollment).toHaveBeenCalledWith({
      inviteCode: "invite_native",
      member: {
        id: "member_native",
        suspendedAt: null,
      },
      now: expect.any(Date),
      prisma,
      source: "companion_onboarding",
    });
    expect(
      mocks.ensureHostedStarterUsageEnrollment.mock.calls[0]?.[0],
    ).not.toHaveProperty("suppressSignupWelcome");
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledOnce();
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("uses canonical starter enrollment defaults for a fresh consented verified-email signup", async () => {
    mocks.resolveHostedPrivySessionFromBearerToken.mockResolvedValue({
      identity: emailIdentity,
    });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(null);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);

    const response = await admissionRoute.POST(admissionRequest(
      "privy-identity-token",
      {
        "x-vercel-ip-city": "Denver",
        "x-vercel-ip-country": "US",
        "x-vercel-ip-country-region": "CO",
        "x-vercel-ip-timezone": "America/Denver",
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      identity: emailIdentity,
      now: expect.any(Date),
      prisma,
      signupNotificationContext: {
        schema: "murph.hosted-signup-notification-context.v1",
        occurredAt: expect.any(String),
        surface: "mobile_app",
        timeZone: "America/Denver",
        location: {
          city: "Denver",
          country: "US",
          countryRegion: "CO",
        },
      },
      timeZone: "America/Denver",
    });
    const completionInput = mocks.completeHostedPrivyVerification.mock.calls[0]?.[0];
    expect(completionInput?.signupNotificationContext?.occurredAt).toBe(
      completionInput?.now?.toISOString(),
    );
    expect(mocks.ensureHostedStarterUsageEnrollment).toHaveBeenCalledWith({
      inviteCode: "invite_native",
      member: {
        id: "member_native",
        suspendedAt: null,
      },
      now: expect.any(Date),
      prisma,
      source: "companion_onboarding",
    });
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: "member_native",
      prisma,
    });
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("does not collect signup notification context when notification email is disabled", async () => {
    vi.stubEnv("HOSTED_SIGNUP_NOTIFICATION_EMAILS", "");
    mocks.resolveHostedPrivySessionFromBearerToken.mockResolvedValue({
      identity: emailIdentity,
    });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(null);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);

    const response = await admissionRoute.POST(admissionRequest(
      "privy-identity-token",
      {
        "x-vercel-ip-city": "Denver",
        "x-vercel-ip-country": "US",
        "x-vercel-ip-country-region": "CO",
        "x-vercel-ip-timezone": "America/Denver",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledOnce();
    const completionInput = mocks.completeHostedPrivyVerification.mock.calls[0]?.[0];
    expect(completionInput).toMatchObject({
      identity: emailIdentity,
      timeZone: "America/Denver",
    });
    expect(completionInput).not.toHaveProperty("signupNotificationContext");
  });

  it("does not collect signup notification context when Resend is only partially configured", async () => {
    vi.stubEnv("HOSTED_SIGNUP_WELCOME_EMAIL_FROM", "");
    mocks.resolveHostedPrivySessionFromBearerToken.mockResolvedValue({
      identity: emailIdentity,
    });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(null);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);

    const response = await admissionRoute.POST(admissionRequest(
      "privy-identity-token",
      {
        "x-vercel-ip-city": "Denver",
        "x-vercel-ip-country": "US",
        "x-vercel-ip-timezone": "America/Denver",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledOnce();
    const completionInput = mocks.completeHostedPrivyVerification.mock.calls[0]?.[0];
    expect(completionInput).not.toHaveProperty("signupNotificationContext");
  });

  it("uses a read-only fast path for an existing active member", async () => {
    const activeMember = member(HostedBillingStatus.active);
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(activeMember);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);

    await expect(ensureHostedCompanionMemberId({
      identity,
      prisma,
    })).resolves.toBe(activeMember.id);

    expect(mocks.assertHostedMemberNotSuspended).toHaveBeenCalledWith(activeMember);
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
      memberId: activeMember.id,
      prisma,
    });
    expect(mocks.completeHostedPrivyVerification).not.toHaveBeenCalled();
    expect(mocks.ensureHostedStarterUsageEnrollment).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
  });

  it("returns retryable admission until a pending activation wake is accepted", async () => {
    const activeMember = member(HostedBillingStatus.active);
    mocks.resolveHostedPrivySessionFromBearerToken.mockResolvedValue({ identity });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(activeMember);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.retryPendingHostedStarterUsageActivationRuntimeWake
      .mockResolvedValueOnce({ accepted: false })
      .mockResolvedValueOnce({ accepted: true });

    const firstResponse = await admissionRoute.POST(admissionRequest());
    const retryResponse = await admissionRoute.POST(admissionRequest());

    expect(firstResponse.status).toBe(503);
    await expect(firstResponse.json()).resolves.toMatchObject({
      error: {
        code: "COMPANION_ADMISSION_RETRYABLE",
      },
    });
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toEqual({ ok: true });
    expect(mocks.retryPendingHostedStarterUsageActivationRuntimeWake)
      .toHaveBeenCalledTimes(2);
  });

  it("creates the canonical member but stops at consent before starter access or Junction admission", async () => {
    const consentRequired = hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Accept the Murph legal consent before continuing.",
    });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(null);
    mocks.assertHostedHistoricalLaunchConsentGranted.mockRejectedValueOnce(
      consentRequired,
    );

    await expect(ensureHostedCompanionMemberId({
      identity,
      now: new Date("2026-07-31T11:00:00.000Z"),
      prisma,
      timeZone: "America/Denver",
    })).rejects.toBe(consentRequired);

    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      identity,
      now: new Date("2026-07-31T11:00:00.000Z"),
      prisma,
      timeZone: "America/Denver",
    });
    expect(mocks.ensureHostedStarterUsageEnrollment).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
  });

  it("reuses canonical completion and starter usage after consent", async () => {
    const pendingMember = member();
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(pendingMember);
    mocks.readActiveHostedMemberAccess
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    mocks.completeHostedPrivyVerification.mockResolvedValue(completion());

    await expect(ensureHostedCompanionMemberId({
      identity,
      now: new Date("2026-07-31T11:15:00.000Z"),
      prisma,
    })).resolves.toBe(pendingMember.id);

    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      identity,
      now: new Date("2026-07-31T11:15:00.000Z"),
      prisma,
    });
    expect(mocks.ensureHostedStarterUsageEnrollment).toHaveBeenCalledWith({
      inviteCode: "invite_native",
      member: {
        id: pendingMember.id,
        suspendedAt: null,
      },
      now: new Date("2026-07-31T11:15:00.000Z"),
      prisma,
      source: "companion_onboarding",
    });
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: pendingMember.id,
      prisma,
    });
  });

  it("does not reinterpret incomplete billing as fresh starter access", async () => {
    const incompleteMember = member(HostedBillingStatus.incomplete);
    const accessRequired = hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Hosted access is required.",
    });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(incompleteMember);
    mocks.readActiveHostedMemberAccess
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    mocks.completeHostedPrivyVerification.mockResolvedValue(
      completion(HostedBillingStatus.incomplete),
    );
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValueOnce(
      accessRequired,
    );

    await expect(ensureHostedCompanionMemberId({
      identity,
      prisma,
    })).rejects.toBe(accessRequired);

    expect(mocks.ensureHostedStarterUsageEnrollment).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: incompleteMember.id,
      prisma,
    });
  });

  it("accepts concurrent activation observed after canonical completion", async () => {
    const pendingMember = member();
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(pendingMember);
    mocks.readActiveHostedMemberAccess
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(ensureHostedCompanionMemberId({
      identity,
      prisma,
    })).resolves.toBe(pendingMember.id);

    expect(mocks.ensureHostedStarterUsageEnrollment).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
  });
});

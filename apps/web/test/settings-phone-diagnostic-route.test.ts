import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedMemberNotSuspended: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  logHostedOnboardingDiagnostic: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/entitlement", () => ({
  assertHostedMemberNotSuspended: mocks.assertHostedMemberNotSuspended,
}));

vi.mock("@/src/lib/hosted-onboarding/logging", () => ({
  logHostedOnboardingDiagnostic: mocks.logHostedOnboardingDiagnostic,
}));

type SettingsPhoneDiagnosticRouteModule =
  typeof import("../app/api/settings/phone/diagnostic/route");

let route: SettingsPhoneDiagnosticRouteModule;

describe("settings phone diagnostic route", () => {
  beforeAll(async () => {
    route = await import("../app/api/settings/phone/diagnostic/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_test",
        suspendedAt: null,
      },
      privyUserId: "provider_user_test",
      sessionId: "session_test",
    });
  });

  it("logs only the allowlisted client lifecycle metadata", async () => {
    const diagnostic = validDiagnostic();
    const response = await route.POST(jsonRequest(diagnostic));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.assertHostedMemberNotSuspended).toHaveBeenCalledWith({
      id: "member_test",
      suspendedAt: null,
    });
    expect(mocks.logHostedOnboardingDiagnostic).toHaveBeenCalledWith(
      "privy-phone-link-client",
      diagnostic,
    );
  });

  it("rejects unknown fields so identity data cannot enter the diagnostic log", async () => {
    const response = await route.POST(jsonRequest({
      ...validDiagnostic(),
      phoneNumber: "+15550100002",
      providerUserId: "provider_user_test",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_PHONE_LINK_DIAGNOSTIC_INVALID",
        message: "Invalid phone-link diagnostic event.",
        retryable: false,
      },
    });
    expect(mocks.logHostedOnboardingDiagnostic).not.toHaveBeenCalled();
  });

  it("rejects provider errors outside the explicit non-sensitive allowlist", async () => {
    const response = await route.POST(jsonRequest({
      ...validDiagnostic(),
      detailCode: "raw_provider_error",
      event: "provider_failed",
    }));

    expect(response.status).toBe(400);
    expect(mocks.logHostedOnboardingDiagnostic).not.toHaveBeenCalled();
  });

  it("rejects cross-origin diagnostics before reading app-session state", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_ORIGIN_INVALID",
        httpStatus: 403,
        message: "Invalid request origin.",
      });
    });

    const response = await route.POST(jsonRequest(validDiagnostic()));

    expect(response.status).toBe(403);
    expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
    expect(mocks.assertHostedMemberNotSuspended).not.toHaveBeenCalled();
    expect(mocks.logHostedOnboardingDiagnostic).not.toHaveBeenCalled();
  });

  it("rejects suspended members before logging diagnostics", async () => {
    mocks.assertHostedMemberNotSuspended.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "HOSTED_MEMBER_SUSPENDED",
        httpStatus: 403,
        message: "This hosted account is suspended.",
      });
    });

    const response = await route.POST(jsonRequest(validDiagnostic()));

    expect(response.status).toBe(403);
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.logHostedOnboardingDiagnostic).not.toHaveBeenCalled();
  });

  it("requires a Murph app session before accepting browser diagnostics", async () => {
    mocks.requireHostedAppSessionFromRequest.mockRejectedValueOnce(hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Sign in to continue.",
    }));

    const response = await route.POST(jsonRequest(validDiagnostic()));

    expect(response.status).toBe(401);
    expect(mocks.logHostedOnboardingDiagnostic).not.toHaveBeenCalled();
  });
});

function validDiagnostic() {
  return {
    attemptId: "11111111-1111-4111-8111-111111111111",
    clientState: "eligible",
    event: "provider_started",
    operation: "link",
    surface: "settings",
  };
}

function jsonRequest(payload: Record<string, unknown>): Request {
  return new Request("https://join.example.test/api/settings/phone/diagnostic", {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
      origin: "https://join.example.test",
    },
    method: "POST",
  });
}

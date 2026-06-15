import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  ensureHostedAutoPulseTrialEnrollment: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  requireHostedInviteCodeFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/auto-trial-enrollment-service", () => ({
  ensureHostedAutoPulseTrialEnrollment: mocks.ensureHostedAutoPulseTrialEnrollment,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/route-helpers", () => ({
  requireHostedInviteCodeFromRequest: mocks.requireHostedInviteCodeFromRequest,
}));

type AutoTrialRouteModule = typeof import("../app/api/hosted-onboarding/trial/enroll/route");

let autoTrialRoute: AutoTrialRouteModule;

describe("hosted onboarding auto trial enrollment route", () => {
  beforeAll(async () => {
    autoTrialRoute = await import("../app/api/hosted-onboarding/trial/enroll/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_AUTO_PULSE_TRIAL_ENABLED = "1";
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.ensureHostedAutoPulseTrialEnrollment.mockResolvedValue({
      redirectPath: "/home",
      status: "enrolled",
    });
    mocks.getPrisma.mockReturnValue({ prisma: true });
    mocks.requireHostedInviteCodeFromRequest.mockResolvedValue({
      body: {
        inviteCode: "invite_123",
      },
      inviteCode: "invite_123",
    });
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_123",
        suspendedAt: null,
      },
    });
  });

  it("starts auto trial enrollment for the authenticated invite member", async () => {
    const response = await autoTrialRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/trial/enroll", {
        body: JSON.stringify({
          inviteCode: "invite_123",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      redirectPath: "/home",
      status: "enrolled",
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.requireHostedInviteCodeFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.ensureHostedAutoPulseTrialEnrollment).toHaveBeenCalledWith({
      inviteCode: "invite_123",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      prisma: { prisma: true },
    });
  });

  it.each([
    {
      expectedStatus: 403,
      name: "CSRF/origin",
      setup() {
        mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
          throw hostedOnboardingError({
            code: "HOSTED_ONBOARDING_ORIGIN_REQUIRED",
            httpStatus: 403,
            message: "Hosted browser mutation routes require an Origin header.",
          });
        });
      },
      expectedSkippedMocks: [
        mocks.requireHostedAppSessionFromRequest,
        mocks.requireHostedInviteCodeFromRequest,
        mocks.ensureHostedAutoPulseTrialEnrollment,
      ],
    },
    {
      expectedStatus: 401,
      name: "hosted app session",
      setup() {
        mocks.requireHostedAppSessionFromRequest.mockRejectedValueOnce(
          hostedOnboardingError({
            code: "HOSTED_APP_SESSION_REQUIRED",
            httpStatus: 401,
            message: "Sign in to continue.",
          }),
        );
      },
      expectedSkippedMocks: [
        mocks.requireHostedInviteCodeFromRequest,
        mocks.ensureHostedAutoPulseTrialEnrollment,
      ],
    },
    {
      expectedStatus: 400,
      name: "invite code",
      setup() {
        mocks.requireHostedInviteCodeFromRequest.mockRejectedValueOnce(
          hostedOnboardingError({
            code: "HOSTED_INVITE_CODE_REQUIRED",
            httpStatus: 400,
            message: "Open Murph from your latest invite link.",
          }),
        );
      },
      expectedSkippedMocks: [
        mocks.ensureHostedAutoPulseTrialEnrollment,
      ],
    },
  ])("requires $name before enrolling", async ({ expectedSkippedMocks, expectedStatus, setup }) => {
    setup();

    const response = await autoTrialRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/trial/enroll", {
        body: JSON.stringify({
          inviteCode: "invite_123",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(expectedStatus);
    for (const skippedMock of expectedSkippedMocks) {
      expect(skippedMock).not.toHaveBeenCalled();
    }
  });

  it("propagates typed consent errors from the enrollment service", async () => {
    mocks.ensureHostedAutoPulseTrialEnrollment.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_CONSENT_REQUIRED",
        httpStatus: 403,
        message: "Accept the current Murph legal consent before continuing.",
      }),
    );

    const response = await autoTrialRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/trial/enroll", {
        body: JSON.stringify({
          inviteCode: "invite_123",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CONSENT_REQUIRED",
        message: "Accept the current Murph legal consent before continuing.",
        retryable: false,
      },
    });
  });
});

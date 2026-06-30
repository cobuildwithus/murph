import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  ensureHostedAutoPulseTrialEnrollment: vi.fn(),
  getPrisma: vi.fn(),
  hostedInviteFindUnique: vi.fn(),
  issueHostedInvite: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  issueHostedInvite: mocks.issueHostedInvite,
}));

vi.mock("@/src/lib/hosted-onboarding/auto-trial-enrollment-service", () => ({
  ensureHostedAutoPulseTrialEnrollment: mocks.ensureHostedAutoPulseTrialEnrollment,
}));

type OnboardingActivationServiceModule =
  typeof import("../src/lib/hosted-ops/onboarding-activation");
type OnboardingActivationRouteModule =
  typeof import("../app/api/ops/onboarding-activation/route");

let onboardingActivationService: OnboardingActivationServiceModule;
let onboardingActivationRoute: OnboardingActivationRouteModule;

const originalHostedOpsMemberIds = process.env.HOSTED_OPS_MEMBER_IDS;
const prisma = {
  hostedInvite: {
    findUnique: mocks.hostedInviteFindUnique,
  },
};

describe("hosted ops onboarding activation", () => {
  beforeAll(async () => {
    onboardingActivationService = await import("../src/lib/hosted-ops/onboarding-activation");
    onboardingActivationRoute = await import("../app/api/ops/onboarding-activation/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_OPS_MEMBER_IDS = "member_ops";
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_ops" },
    });
    mocks.hostedInviteFindUnique.mockResolvedValue(makeSourceInvite());
    mocks.issueHostedInvite.mockResolvedValue(makeEnrollmentInvite());
    mocks.ensureHostedAutoPulseTrialEnrollment.mockResolvedValue({
      redirectPath: "/home?initialVisit=true",
      status: "enrolled",
    });
  });

  afterEach(() => {
    if (originalHostedOpsMemberIds === undefined) {
      delete process.env.HOSTED_OPS_MEMBER_IDS;
    } else {
      process.env.HOSTED_OPS_MEMBER_IDS = originalHostedOpsMemberIds;
    }
  });

  it("normalizes hosted join URLs to invite codes", () => {
    expect(onboardingActivationService.normalizeHostedOpsInviteCodeInput(
      "https://www.withmurph.ai/join/source_invite_123?utm=test",
    )).toBe("source_invite_123");
    expect(onboardingActivationService.normalizeHostedOpsInviteCodeInput(
      "/join/source_invite_123/success",
    )).toBe("source_invite_123");
    expect(onboardingActivationService.normalizeHostedOpsInviteCodeInput(
      "source_invite_123",
    )).toBe("source_invite_123");
    expect(onboardingActivationService.normalizeHostedOpsInviteCodeInput("   ")).toBeNull();
  });

  it("issues a fresh web invite and delegates activation to auto trial enrollment", async () => {
    await expect(onboardingActivationService.activateHostedOpsOnboardingFromInvite({
      inviteCodeOrUrl: "https://www.withmurph.ai/join/source_invite_123",
    })).resolves.toMatchObject({
      invite: {
        enrollmentInviteExpiresAt: "2026-07-07T15:46:56.000Z",
        enrollmentInviteRefreshed: true,
        sourceChannel: "linq",
        sourceExpired: true,
        sourceExpiresAt: "2026-06-15T15:46:56.000Z",
      },
      member: {
        billingStatusBefore: HostedBillingStatus.not_started,
        suspended: false,
      },
      redirectPath: "/home?initialVisit=true",
      status: "enrolled",
    });

    expect(mocks.hostedInviteFindUnique).toHaveBeenCalledWith({
      select: {
        channel: true,
        expiresAt: true,
        inviteCode: true,
        member: {
          select: {
            billingStatus: true,
            id: true,
            suspendedAt: true,
          },
        },
      },
      where: {
        inviteCode: "source_invite_123",
      },
    });
    expect(mocks.issueHostedInvite).toHaveBeenCalledWith({
      channel: "web",
      memberId: "member_123",
      prisma,
    });
    expect(mocks.ensureHostedAutoPulseTrialEnrollment).toHaveBeenCalledWith({
      inviteCode: "fresh_invite_456",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      prisma,
    });
  });

  it("rejects missing or unknown invites before activation", async () => {
    await expect(onboardingActivationService.activateHostedOpsOnboardingFromInvite({
      inviteCodeOrUrl: "",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_ACTIVATION_INVITE_REQUIRED",
      httpStatus: 400,
    });
    expect(mocks.hostedInviteFindUnique).not.toHaveBeenCalled();

    mocks.hostedInviteFindUnique.mockResolvedValueOnce(null);

    await expect(onboardingActivationService.activateHostedOpsOnboardingFromInvite({
      inviteCodeOrUrl: "missing_invite",
    })).rejects.toMatchObject({
      code: "HOSTED_OPS_ONBOARDING_ACTIVATION_INVITE_NOT_FOUND",
      httpStatus: 404,
    });
    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
    expect(mocks.ensureHostedAutoPulseTrialEnrollment).not.toHaveBeenCalled();
  });

  it("activates through the authenticated same-origin ops route", async () => {
    const request = new Request("https://join.example.test/api/ops/onboarding-activation", {
      body: JSON.stringify({
        inviteCodeOrUrl: "https://www.withmurph.ai/join/source_invite_123",
      }),
      headers: {
        "Content-Type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    });
    const response = await onboardingActivationRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(request);
    const payload = await response.json();
    expect(payload).toMatchObject({
      redirectPath: "/home?initialVisit=true",
      status: "enrolled",
    });
    expect(JSON.stringify(payload)).not.toContain("fresh_invite_456");
    expect(JSON.stringify(payload)).not.toContain("source_invite_123");
  });

  it("does not activate when the ops route session member is not allowlisted", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: { id: "member_other" },
    });

    const response = await onboardingActivationRoute.POST(
      new Request("https://join.example.test/api/ops/onboarding-activation", {
        body: JSON.stringify({
          inviteCodeOrUrl: "source_invite_123",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.hostedInviteFindUnique).not.toHaveBeenCalled();
    expect(mocks.ensureHostedAutoPulseTrialEnrollment).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_ACCESS_DENIED",
      },
    });
  });

  it("requires an invite code or join URL through the ops route", async () => {
    const response = await onboardingActivationRoute.POST(
      new Request("https://join.example.test/api/ops/onboarding-activation", {
        body: JSON.stringify({
          inviteCodeOrUrl: "",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.hostedInviteFindUnique).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_ONBOARDING_ACTIVATION_INVITE_REQUIRED",
      },
    });
  });

  it("propagates activation precondition errors", async () => {
    mocks.ensureHostedAutoPulseTrialEnrollment.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_CONSENT_REQUIRED",
        httpStatus: 403,
        message: "Accept the current Murph legal consent before continuing.",
      }),
    );

    const response = await onboardingActivationRoute.POST(
      new Request("https://join.example.test/api/ops/onboarding-activation", {
        body: JSON.stringify({
          inviteCodeOrUrl: "source_invite_123",
        }),
        headers: {
          "Content-Type": "application/json",
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

function makeSourceInvite() {
  return {
    channel: "linq",
    expiresAt: new Date("2026-06-15T15:46:56.000Z"),
    inviteCode: "source_invite_123",
    member: {
      billingStatus: HostedBillingStatus.not_started,
      id: "member_123",
      suspendedAt: null,
    },
  };
}

function makeEnrollmentInvite() {
  return {
    channel: "web",
    expiresAt: new Date("2026-07-07T15:46:56.000Z"),
    inviteCode: "fresh_invite_456",
    memberId: "member_123",
  };
}

import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  assertHostedMemberNotSuspended: vi.fn(),
  completeHostedPrivyVerification: vi.fn(),
  ensureHostedAutoPulseTrialEnrollment: vi.fn(),
  getPrisma: vi.fn(),
  lookupHostedMemberForPrivyPrincipal: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  remapHostedPrivyCompletionLagError: vi.fn((error: unknown) => error),
  resolveHostedPrivySessionFromBearerToken: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedHistoricalLaunchConsentGranted:
    mocks.assertHostedHistoricalLaunchConsentGranted,
}));

vi.mock("@/src/lib/hosted-onboarding/authentication-service", () => ({
  completeHostedPrivyVerification: mocks.completeHostedPrivyVerification,
}));

vi.mock("@/src/lib/hosted-onboarding/auto-trial-enrollment-service", () => ({
  ensureHostedAutoPulseTrialEnrollment: mocks.ensureHostedAutoPulseTrialEnrollment,
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
  ensureHostedCompanionMemberAccess,
  requireHostedCompanionMemberAccessFromRequest,
} from "@/src/lib/hosted-onboarding/companion-member-access";

const prisma = { label: "test-prisma" } as never;
const identity = {
  phone: {
    number: "+15550000000",
    verifiedAt: 1_785_456_000,
  },
  userId: "did:privy:native-member",
  wallet: null,
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
    initialVisitEligible: billingStatus === HostedBillingStatus.not_started,
    inviteCode: "invite_native",
    joinUrl: "https://withmurph.ai/join/invite_native",
    member: completedMember,
    memberId: completedMember.id,
    messagingSetupRequired: false,
    stage: billingStatus === HostedBillingStatus.active ? "active" : "checkout",
  };
}

describe("native companion hosted member admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.assertHostedHistoricalLaunchConsentGranted.mockResolvedValue(undefined);
    mocks.assertActiveHostedMemberAccessAllowed.mockResolvedValue(undefined);
    mocks.assertHostedMemberNotSuspended.mockReturnValue(undefined);
    mocks.completeHostedPrivyVerification.mockResolvedValue(completion());
    mocks.ensureHostedAutoPulseTrialEnrollment.mockResolvedValue({
      redirectPath: "/home?initialVisit=true",
      status: "enrolled",
    });
  });

  it("requires bearer identity without falling back to browser authority", async () => {
    mocks.resolveHostedPrivySessionFromBearerToken.mockResolvedValue(null);

    await expect(requireHostedCompanionMemberAccessFromRequest(
      new Request("https://app.example.test/api/device-sync/companion/sign-in-token"),
      prisma,
    )).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });

    expect(mocks.lookupHostedMemberForPrivyPrincipal).not.toHaveBeenCalled();
  });

  it("uses a read-only fast path for an existing active member", async () => {
    const activeMember = member(HostedBillingStatus.active);
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(activeMember);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);

    await expect(ensureHostedCompanionMemberAccess({
      identity,
      prisma,
    })).resolves.toEqual(activeMember);

    expect(mocks.assertHostedMemberNotSuspended).toHaveBeenCalledWith(activeMember);
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
      memberId: activeMember.id,
      prisma,
    });
    expect(mocks.completeHostedPrivyVerification).not.toHaveBeenCalled();
    expect(mocks.ensureHostedAutoPulseTrialEnrollment).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
  });

  it("creates the canonical member but stops at consent before trial or Junction admission", async () => {
    const consentRequired = hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Accept the Murph legal consent before continuing.",
    });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(null);
    mocks.assertHostedHistoricalLaunchConsentGranted.mockRejectedValueOnce(
      consentRequired,
    );

    await expect(ensureHostedCompanionMemberAccess({
      identity,
      now: new Date("2026-07-31T11:00:00.000Z"),
      prisma,
    })).rejects.toBe(consentRequired);

    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      identity,
      now: new Date("2026-07-31T11:00:00.000Z"),
      prisma,
    });
    expect(mocks.ensureHostedAutoPulseTrialEnrollment).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
  });

  it("reuses canonical completion and no-card Pulse trial after consent", async () => {
    const pendingMember = member();
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(pendingMember);
    mocks.readActiveHostedMemberAccess
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    mocks.completeHostedPrivyVerification.mockResolvedValue(completion());

    await expect(ensureHostedCompanionMemberAccess({
      identity,
      now: new Date("2026-07-31T11:15:00.000Z"),
      prisma,
    })).resolves.toEqual(pendingMember);

    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      identity,
      now: new Date("2026-07-31T11:15:00.000Z"),
      prisma,
    });
    expect(mocks.ensureHostedAutoPulseTrialEnrollment).toHaveBeenCalledWith({
      inviteCode: "invite_native",
      member: {
        id: pendingMember.id,
        suspendedAt: null,
      },
      now: new Date("2026-07-31T11:15:00.000Z"),
      prisma,
    });
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: pendingMember.id,
      prisma,
    });
  });

  it("does not reinterpret incomplete billing as a fresh native trial", async () => {
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

    await expect(ensureHostedCompanionMemberAccess({
      identity,
      prisma,
    })).rejects.toBe(accessRequired);

    expect(mocks.ensureHostedAutoPulseTrialEnrollment).not.toHaveBeenCalled();
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

    await expect(ensureHostedCompanionMemberAccess({
      identity,
      prisma,
    })).resolves.toEqual(pendingMember);

    expect(mocks.ensureHostedAutoPulseTrialEnrollment).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedMemberAccessAllowed).not.toHaveBeenCalled();
  });
});

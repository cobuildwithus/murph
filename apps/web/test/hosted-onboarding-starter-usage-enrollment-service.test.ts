import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activateHostedMemberForPositiveSourceTx: vi.fn(),
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  assertHostedMemberBillingStartMessagingReady: vi.fn(),
  ensureHostedStarterUsageGrantTx: vi.fn(),
  lockHostedUsageCreditBeneficiaryTx: vi.fn(),
  prepareHostedCryptoDomainRootCandidates: vi.fn(),
  readHostedStarterUsageGrantTx: vi.fn(),
  requireHostedInviteForBillingCheckout: vi.fn(),
  sendHostedSignupWelcomeEmailForMemberBestEffort: vi.fn(),
  signalHostedMemberActivationRuntimeWakeBestEffortResult: vi.fn(),
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  prepareHostedCryptoDomainRootCandidates:
    mocks.prepareHostedCryptoDomainRootCandidates,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-unwrap-cache", () => ({
  runWithHostedDomainRootUnwrapCache: async (callback: () => Promise<unknown>) =>
    await callback(),
}));

vi.mock("@/src/lib/hosted-execution/usage-credit-ledger", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-execution/usage-credit-ledger")
  >("@/src/lib/hosted-execution/usage-credit-ledger");
  return {
    ...actual,
    lockHostedUsageCreditBeneficiaryTx:
      mocks.lockHostedUsageCreditBeneficiaryTx,
  };
});

vi.mock("@/src/lib/legal/consent", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/legal/consent")
  >("@/src/lib/legal/consent");
  return {
    ...actual,
    assertHostedLaunchRequiredConsentGranted:
      mocks.assertHostedLaunchRequiredConsentGranted,
  };
});

vi.mock("@/src/lib/hosted-onboarding/billing-start-preconditions", () => ({
  assertHostedMemberBillingStartMessagingReady:
    mocks.assertHostedMemberBillingStartMessagingReady,
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  requireHostedInviteForBillingCheckout:
    mocks.requireHostedInviteForBillingCheckout,
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForPositiveSourceTx:
    mocks.activateHostedMemberForPositiveSourceTx,
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation-runtime-wake", () => ({
  signalHostedMemberActivationRuntimeWakeBestEffortResult:
    mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult,
}));

vi.mock("@/src/lib/hosted-onboarding/signup-welcome-email", () => ({
  sendHostedSignupWelcomeEmailForMemberBestEffort:
    mocks.sendHostedSignupWelcomeEmailForMemberBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/starter-usage-grant", () => ({
  ensureHostedStarterUsageGrantTx: mocks.ensureHostedStarterUsageGrantTx,
  readHostedStarterUsageGrantTx: mocks.readHostedStarterUsageGrantTx,
}));

import {
  ensureHostedLinqInstantStartStarterUsageEnrollment,
  ensureHostedStarterUsageEnrollment,
} from "@/src/lib/hosted-onboarding/starter-usage-enrollment-service";

const NOW = new Date("2026-08-09T14:00:00.000Z");

type MemberState = {
  billingRef: {
    currentBillingPhase: string | null;
    currentCheckoutOffer: string | null;
    stripeSubscriptionLookupKey: string | null;
  } | null;
  billingStatus: HostedBillingStatus;
  id: string;
  suspendedAt: Date | null;
};

describe("Starter usage enrollment owner", () => {
  let activationWritten: boolean;
  let createdGrantCount: number;
  let grantState: { effectiveAt: Date } | null;
  let memberState: MemberState;

  beforeEach(() => {
    vi.clearAllMocks();
    activationWritten = false;
    createdGrantCount = 0;
    grantState = null;
    memberState = buildMemberState();

    mocks.requireHostedInviteForBillingCheckout.mockImplementation(
      async () => buildInvite(memberState),
    );
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.assertHostedMemberBillingStartMessagingReady.mockResolvedValue(undefined);
    mocks.prepareHostedCryptoDomainRootCandidates.mockResolvedValue(new Map());
    mocks.lockHostedUsageCreditBeneficiaryTx.mockResolvedValue({
      balanceUsdMicros: 0n,
      beneficiaryMemberId: memberState.id,
      ledgerVersion: 0n,
    });
    mocks.readHostedStarterUsageGrantTx.mockImplementation(async () => grantState);
    mocks.ensureHostedStarterUsageGrantTx.mockImplementation(async () => {
      if (!grantState) {
        grantState = { effectiveAt: NOW };
        createdGrantCount += 1;
      }
      return {
        balanceUsdMicros: 4_500_000n,
        effectiveAt: grantState.effectiveAt,
        entryId: "huce_starter",
        granted: createdGrantCount === 1,
        ledgerVersion: 1n,
      };
    });
    mocks.activateHostedMemberForPositiveSourceTx.mockImplementation(async () => {
      if (activationWritten) {
        return {
          activated: false,
          hostedExecutionEventId: null,
        };
      }
      activationWritten = true;
      return {
        activated: true,
        hostedExecutionEventId: "execution_activation_1",
      };
    });
    mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult
      .mockResolvedValue({ signaled: true });
    mocks.sendHostedSignupWelcomeEmailForMemberBestEffort
      .mockResolvedValue(undefined);
  });

  it("enrolls once across supported channels and emits activation effects once", async () => {
    const prisma = buildPrisma(() => memberState);

    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).resolves.toEqual({
      redirectPath: "/home",
      status: "enrolled",
    });
    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: new Date("2026-08-09T14:05:00.000Z"),
      prisma: prisma as never,
      source: "companion_onboarding",
    })).resolves.toEqual({
      redirectPath: "/home",
      status: "already_enrolled",
    });

    expect(createdGrantCount).toBe(1);
    expect(mocks.activateHostedMemberForPositiveSourceTx).toHaveBeenCalledTimes(2);
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
      .toHaveBeenCalledOnce();
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort)
      .toHaveBeenCalledOnce();
  });

  it("keeps paid billing and conflicting history outside Starter authority", async () => {
    memberState = buildMemberState({
      billingRef: {
        currentBillingPhase: "paid",
        currentCheckoutOffer: "standard",
        stripeSubscriptionLookupKey: "subscription_lookup_paid",
      },
      billingStatus: HostedBillingStatus.active,
    });
    const paidPrisma = buildPrisma(() => memberState);

    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: paidPrisma as never,
      source: "web_onboarding",
    })).resolves.toMatchObject({ status: "already_active" });
    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();

    memberState = buildMemberState({
      billingStatus: HostedBillingStatus.paused,
    });
    const historyPrisma = buildPrisma(() => memberState);
    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: historyPrisma as never,
      source: "web_onboarding",
    })).rejects.toMatchObject({
      code: "HOSTED_STARTER_USAGE_ENROLLMENT_BLOCKED",
      httpStatus: 409,
    });
  });

  it("keeps active Family sponsorship outside Starter grant authority", async () => {
    const prisma = buildPrisma(() => memberState, undefined, true);

    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).resolves.toEqual({
      redirectPath: "/home",
      status: "already_active",
    });

    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
    expect(mocks.activateHostedMemberForPositiveSourceTx).not.toHaveBeenCalled();
    expect(prisma.hostedAccountGroupMembership.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        group: {
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        },
        memberId: memberState.id,
        status: "active",
      },
    });
    expect(
      mocks.lockHostedUsageCreditBeneficiaryTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      prisma.hostedAccountGroupMembership.findFirst.mock.invocationCallOrder[0]
        ?? Number.POSITIVE_INFINITY,
    );
  });

  it("preserves a preexisting Starter grant after Family sponsorship begins", async () => {
    grantState = { effectiveAt: NOW };
    const prisma = buildPrisma(() => memberState, undefined, true);

    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).resolves.toMatchObject({ status: "already_enrolled" });

    expect(createdGrantCount).toBe(0);
    expect(mocks.ensureHostedStarterUsageGrantTx).toHaveBeenCalledOnce();
    expect(prisma.hostedAccountGroupMembership.findFirst).not.toHaveBeenCalled();
  });

  it("fails closed for suspended and invite-mismatched members", async () => {
    const prisma = buildPrisma(() => memberState);
    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: NOW },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).rejects.toMatchObject({ code: "HOSTED_MEMBER_SUSPENDED" });

    mocks.requireHostedInviteForBillingCheckout.mockResolvedValueOnce(
      buildInvite(buildMemberState({ id: "member_other" })),
    );
    await expect(ensureHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
      member: { id: memberState.id, suspendedAt: null },
      now: NOW,
      prisma: prisma as never,
      source: "web_onboarding",
    })).rejects.toMatchObject({ code: "AUTH_INVITE_MISMATCH" });
    expect(mocks.ensureHostedStarterUsageGrantTx).not.toHaveBeenCalled();
  });

  it("clears the exact instant-start token in the grant transaction and defers one wake", async () => {
    const admission = {
      eventId: "event_admission_1",
      inviteCode: "invite_123",
      inviteId: "invite_id_123",
      memberId: memberState.id,
    };
    const prisma = buildPrisma(() => memberState, admission);

    await expect(ensureHostedLinqInstantStartStarterUsageEnrollment({
      admissionEventId: admission.eventId,
      inviteCode: admission.inviteCode,
      memberId: admission.memberId,
      now: NOW,
      prisma: prisma as never,
    })).resolves.toEqual({
      deferredActivationWake: {
        hostedExecutionEventId: "execution_activation_1",
        memberId: memberState.id,
      },
      redirectPath: "/home",
      status: "enrolled",
    });

    expect(prisma.hostedInvite.updateMany).toHaveBeenCalledWith({
      data: { instantStartAdmissionEventId: null },
      where: {
        id: admission.inviteId,
        instantStartAdmissionEventId: admission.eventId,
      },
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).not.toHaveBeenCalled();
    expect(mocks.assertHostedMemberBillingStartMessagingReady).not.toHaveBeenCalled();
    expect(mocks.sendHostedSignupWelcomeEmailForMemberBestEffort)
      .not.toHaveBeenCalled();
    expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
      .not.toHaveBeenCalled();

    await expect(ensureHostedLinqInstantStartStarterUsageEnrollment({
      admissionEventId: admission.eventId,
      inviteCode: admission.inviteCode,
      memberId: admission.memberId,
      now: NOW,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_INSTANT_START_ADMISSION_REVOKED",
    });
    expect(createdGrantCount).toBe(1);
  });
});

function buildMemberState(overrides: Partial<MemberState> = {}): MemberState {
  return {
    billingRef: null,
    billingStatus: HostedBillingStatus.not_started,
    id: "member_123",
    suspendedAt: null,
    ...overrides,
  };
}

function buildInvite(member: MemberState) {
  return {
    expiresAt: new Date("2026-08-10T14:00:00.000Z"),
    id: "invite_id_123",
    inviteCode: "invite_123",
    member: {
      ...member,
      identity: { phoneLookupKey: "phone_lookup_123" },
      routing: null,
    },
    memberId: member.id,
  };
}

function buildPrisma(
  readMember: () => MemberState,
  admissionInput?: {
    eventId: string;
    inviteCode: string;
    inviteId: string;
    memberId: string;
  },
  familySponsored = false,
) {
  let admission = admissionInput ?? null;
  const tx = {
    hostedInvite: {
      findUnique: vi.fn(async (input: {
        where: {
          expiresAt: { gt: Date };
          instantStartAdmissionEventId: string;
          inviteCode: string;
          memberId: string;
          sentAt: null;
        };
      }) => admission
        && input.where.instantStartAdmissionEventId === admission.eventId
        && input.where.inviteCode === admission.inviteCode
        && input.where.memberId === admission.memberId
          ? { id: admission.inviteId }
          : null),
      updateMany: vi.fn(async (input: {
        where: { id: string; instantStartAdmissionEventId: string };
      }) => {
        if (
          admission
          && input.where.id === admission.inviteId
          && input.where.instantStartAdmissionEventId === admission.eventId
        ) {
          admission = null;
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    hostedMember: {
      findUnique: vi.fn(async () => readMember()),
    },
    hostedAccountGroupMembership: {
      findFirst: vi.fn(async () => familySponsored ? { id: "family_123" } : null),
    },
  };
  return {
    ...tx,
    $transaction: vi.fn(async (callback: (prismaTx: typeof tx) => unknown) =>
      await callback(tx)),
  };
}

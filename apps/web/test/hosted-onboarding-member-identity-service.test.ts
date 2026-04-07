import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isHostedOnboardingRevnetEnabled: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/revnet", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/revnet")>(
    "@/src/lib/hosted-onboarding/revnet",
  );

  return {
    ...actual,
    isHostedOnboardingRevnetEnabled: mocks.isHostedOnboardingRevnetEnabled,
  };
});

import { reconcileHostedPrivyIdentityOnMember } from "@/src/lib/hosted-onboarding/member-identity-service";
import type { HostedPrivyIdentity } from "@/src/lib/hosted-onboarding/privy";

const NOW = new Date("2026-04-06T10:00:00.000Z");

describe("hosted-onboarding member-identity-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(false);
  });

  it("locks and re-reads the current member before reconciling a Privy identity", async () => {
    const lockedMember = makeMember({
      suspendedAt: NOW,
    });
    const lockQuery = vi.fn().mockResolvedValue([]);
    const hostedMember = {
      findUnique: vi.fn().mockResolvedValue(lockedMember),
      update: vi.fn(),
    };
    const identityUpsert = vi.fn(async ({
      create,
      update: updateData,
    }: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => ({
      ...create,
      ...updateData,
    }));
    const hostedMemberIdentity = {
      findUnique: vi.fn().mockResolvedValue({
        maskedPhoneNumberHint: "*** 4567",
        memberId: lockedMember.id,
        phoneLookupKey: "hbidx:phone:v1:existing",
        phoneNumberVerifiedAt: null,
        privyUserId: null,
        walletAddress: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      }),
      upsert: identityUpsert,
    };
    const prisma = {
      $queryRaw: lockQuery,
      hostedMember,
      hostedMemberIdentity,
    };

    const result = await reconcileHostedPrivyIdentityOnMember({
      identity: makeIdentity(),
      member: makeMember({
        suspendedAt: null,
      }),
      now: NOW,
      prisma: prisma as never,
    });

    expect(lockQuery).toHaveBeenCalledTimes(1);
    expect(hostedMember.findUnique).toHaveBeenCalledWith({
      select: {
        billingStatus: true,
        createdAt: true,
        id: true,
        suspendedAt: true,
        updatedAt: true,
      },
      where: {
        id: "member_123",
      },
    });
    expect(hostedMember.update).not.toHaveBeenCalled();
    expect(result.suspendedAt).toEqual(NOW);
    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        memberId: "member_123",
      },
      update: expect.objectContaining({
        phoneNumberVerifiedAt: NOW,
        privyUserId: "did:privy:user_123",
      }),
    }));
  });

  it("fails closed when the member disappears before the locked reconciliation write", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
    };

    await expect(reconcileHostedPrivyIdentityOnMember({
      identity: makeIdentity(),
      member: makeMember(),
      now: NOW,
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
    });

    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.upsert).not.toHaveBeenCalled();
  });
});

function makeIdentity(): HostedPrivyIdentity {
  return {
    phone: {
      number: "+15551234567",
      verifiedAt: 1743933600,
    },
    userId: "did:privy:user_123",
    wallet: null,
  };
}

function makeMember(overrides: Partial<{
  billingStatus: HostedBillingStatus;
  id: string;
  suspendedAt: Date | null;
}> = {}) {
  return {
    billingStatus: HostedBillingStatus.not_started,
    createdAt: NOW,
    id: "member_123",
    suspendedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

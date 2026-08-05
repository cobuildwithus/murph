import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedMember: vi.fn(),
  generateHostedInviteCode: vi.fn(),
  generateHostedInviteId: vi.fn(),
  generateHostedMemberId: vi.fn(),
  getHostedOnboardingEnvironment: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  upsertHostedMemberIdentity: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  createHostedMember: mocks.createHostedMember,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  upsertHostedMemberIdentity: mocks.upsertHostedMemberIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: mocks.getHostedOnboardingEnvironment,
  requireHostedOnboardingPublicBaseUrl: () => "https://www.withmurph.ai",
}));

vi.mock("@/src/lib/hosted-onboarding/shared", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/src/lib/hosted-onboarding/shared")>();
  return {
    ...original,
    generateHostedInviteCode: mocks.generateHostedInviteCode,
    generateHostedInviteId: mocks.generateHostedInviteId,
    generateHostedMemberId: mocks.generateHostedMemberId,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
  };
});

import {
  buildHostedSignupReferralUrl,
  issueHostedSignupReferralLink,
} from "@/src/lib/hosted-growth/signup-referral";

type ExistingInvite = {
  expiresAt: Date;
  inviteCode: string;
  memberId: string;
};

function createPrisma(input: {
  currentPrivyLookupKey?: string | null;
  existingInvite?: ExistingInvite | null;
  referrer?: { id: string; suspendedAt: Date | null } | null;
}) {
  const existingInvite = input.existingInvite ?? null;
  const referrer = input.referrer === undefined
    ? { id: "member_referrer", suspendedAt: null }
    : input.referrer;
  const tx = {
    hostedInvite: {
      create: vi.fn().mockResolvedValue({
        expiresAt: new Date("2026-08-06T22:30:00.000Z"),
        inviteCode: "new_invite",
        memberId: "member_target_new",
      }),
      findFirst: vi.fn().mockResolvedValue(existingInvite),
    },
    hostedMember: {
      findUnique: vi.fn().mockResolvedValue(referrer),
    },
    hostedMemberIdentity: {
      findUnique: vi.fn().mockResolvedValue(
        existingInvite
          ? { privyUserLookupKey: input.currentPrivyLookupKey ?? null }
          : null,
      ),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    ),
  };

  return { prisma, tx };
}

describe("hosted signup referral links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedMember.mockResolvedValue({
      billingStatus: "not_started",
      createdAt: new Date("2026-08-04T22:30:00.000Z"),
      id: "member_target_new",
      suspendedAt: null,
      updatedAt: new Date("2026-08-04T22:30:00.000Z"),
    });
    mocks.generateHostedInviteCode.mockReturnValue("new_invite");
    mocks.generateHostedInviteId.mockReturnValue("invite_id");
    mocks.generateHostedMemberId.mockReturnValue("member_target_new");
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      inviteTtlHours: 48,
    });
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.upsertHostedMemberIdentity.mockResolvedValue({});
  });

  it("builds an opaque handoff to the existing join flow", () => {
    expect(
      buildHostedSignupReferralUrl(
        "a b/c",
        "https://www.withmurph.ai/app?ignored=1#fragment",
      ),
    ).toBe("https://www.withmurph.ai/join/a%20b%2Fc");
  });

  it("reuses the current unclaimed attributed invite under both row locks", async () => {
    const now = new Date("2026-08-04T22:30:00.000Z");
    const existingInvite = {
      expiresAt: new Date("2026-08-06T22:30:00.000Z"),
      inviteCode: "existing_invite",
      memberId: "member_target_existing",
    };
    const { prisma, tx } = createPrisma({
      currentPrivyLookupKey: null,
      existingInvite,
    });

    await expect(issueHostedSignupReferralLink({
      now,
      prisma: prisma as never,
      publicBaseUrl: "https://www.withmurph.ai",
      referrerMemberId: "member_referrer",
    })).resolves.toEqual({
      expiresAt: existingInvite.expiresAt,
      signupUrl: "https://www.withmurph.ai/join/existing_invite",
    });

    expect(tx.hostedInvite.findFirst).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      select: {
        expiresAt: true,
        inviteCode: true,
        memberId: true,
      },
      where: {
        expiresAt: { gt: now },
        referrerMemberId: "member_referrer",
      },
    });
    expect(mocks.createHostedMember).not.toHaveBeenCalled();
    expect(tx.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.lockHostedMemberRow).toHaveBeenNthCalledWith(
      1,
      tx,
      "member_referrer",
    );
    expect(mocks.lockHostedMemberRow).toHaveBeenNthCalledWith(
      2,
      tx,
      "member_target_existing",
    );
  });

  it("fails closed when the referring account no longer exists", async () => {
    const { prisma, tx } = createPrisma({ referrer: null });

    await expect(issueHostedSignupReferralLink({
      now: new Date("2026-08-04T22:30:00.000Z"),
      prisma: prisma as never,
      referrerMemberId: "member_referrer",
    })).rejects.toMatchObject({
      code: "HOSTED_SIGNUP_REFERRER_NOT_FOUND",
    });

    expect(tx.hostedInvite.findFirst).not.toHaveBeenCalled();
    expect(mocks.createHostedMember).not.toHaveBeenCalled();
  });

  it("fails closed for a suspended referring account", async () => {
    const { prisma, tx } = createPrisma({
      referrer: {
        id: "member_referrer",
        suspendedAt: new Date("2026-08-04T21:30:00.000Z"),
      },
    });

    await expect(issueHostedSignupReferralLink({
      now: new Date("2026-08-04T22:30:00.000Z"),
      prisma: prisma as never,
      referrerMemberId: "member_referrer",
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
    });

    expect(tx.hostedInvite.findFirst).not.toHaveBeenCalled();
    expect(mocks.createHostedMember).not.toHaveBeenCalled();
  });

  it("rotates to a fresh attributed invite after the prior link is claimed", async () => {
    const { prisma, tx } = createPrisma({
      currentPrivyLookupKey: "hbidx:privy-user:v1:claimed",
      existingInvite: {
        expiresAt: new Date("2026-08-06T22:30:00.000Z"),
        inviteCode: "claimed_invite",
        memberId: "member_target_claimed",
      },
    });

    await expect(issueHostedSignupReferralLink({
      now: new Date("2026-08-04T22:30:00.000Z"),
      prisma: prisma as never,
      publicBaseUrl: "https://www.withmurph.ai",
      referrerMemberId: "member_referrer",
    })).resolves.toEqual({
      expiresAt: new Date("2026-08-06T22:30:00.000Z"),
      signupUrl: "https://www.withmurph.ai/join/new_invite",
    });

    expect(mocks.createHostedMember).toHaveBeenCalledWith({
      billingStatus: "not_started",
      memberId: "member_target_new",
      prisma: tx,
    });
    expect(mocks.upsertHostedMemberIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_target_new",
        phoneLookupKey: null,
        phoneNumber: null,
        prisma: tx,
        privyUserId: null,
      }),
    );
    expect(tx.hostedInvite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: "share",
        memberId: "member_target_new",
        referrerMemberId: "member_referrer",
      }),
      select: {
        expiresAt: true,
        inviteCode: true,
        memberId: true,
      },
    });
  });
});

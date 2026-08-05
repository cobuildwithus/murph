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

function createPrisma(input: {
  currentPrivyLookupKey?: string | null;
  existingInvite?: {
    expiresAt: Date;
    inviteCode: string;
    memberId: string;
  } | null;
}) {
  const tx = {
    hostedInvite: {
      create: vi.fn().mockResolvedValue({
        expiresAt: new Date("2026-08-06T22:30:00.000Z"),
        inviteCode: "new_invite",
        memberId: "member_target_new",
      }),
      findFirst: vi.fn().mockResolvedValue(input.existingInvite ?? null),
    },
    hostedMember: {
      findUnique: vi.fn().mockResolvedValue({
        id: "member_referrer",
        suspendedAt: null,
      }),
    },
    hostedMemberIdentity: {
      findUnique: vi.fn().mockResolvedValue(
        input.existingInvite === null
          ? null
          : { privyUserLookupKey: input.currentPrivyLookupKey ?? null },
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
        "https://www.withmurph.ai/app",
      ),
    ).toBe("https://www.withmurph.ai/join/a%20b%2Fc");
  });

  it("reuses the current unclaimed attributed invite", async () => {
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
      now: new Date("2026-08-04T22:30:00.000Z"),
      prisma: prisma as never,
      publicBaseUrl: "https://www.withmurph.ai",
      referrerMemberId: "member_referrer",
    })).resolves.toEqual({
      expiresAt: existingInvite.expiresAt,
      inviteCode: "existing_invite",
      signupUrl:
        "https://www.withmurph.ai/join/existing_invite",
      targetMemberId: "member_target_existing",
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
    })).resolves.toMatchObject({
      inviteCode: "new_invite",
      signupUrl: "https://www.withmurph.ai/join/new_invite",
      targetMemberId: "member_target_new",
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

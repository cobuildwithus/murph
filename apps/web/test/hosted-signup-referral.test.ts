import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedMember: vi.fn(),
  generateHostedInviteCode: vi.fn(),
  generateHostedInviteId: vi.fn(),
  generateHostedMemberId: vi.fn(),
  getHostedOnboardingEnvironment: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readHostedMemberIdentity: vi.fn(),
  upsertHostedMemberIdentity: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  createHostedMember: mocks.createHostedMember,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  readHostedMemberIdentity: mocks.readHostedMemberIdentity,
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
import type {
  HostedMemberIdentityState,
} from "@/src/lib/hosted-onboarding/hosted-member-identity-store";

type ExistingInvite = {
  expiresAt: Date;
  id: string;
  inviteCode: string;
  memberId: string;
};

function pristineIdentity(memberId: string): HostedMemberIdentityState {
  return {
    maskedPhoneNumberHint: null,
    memberId,
    phoneLookupKey: null,
    phoneNumber: null,
    phoneNumberVerifiedAt: null,
    privyUserId: null,
    signupPhoneCodeSendAttemptId: null,
    signupPhoneCodeSendAttemptStartedAt: null,
    signupPhoneCodeSentAt: null,
    signupPhoneNumber: null,
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
  };
}

function createPrisma(input: {
  existingInvite?: ExistingInvite | null;
  identity?: HostedMemberIdentityState | null;
  referrer?: { id: string; suspendedAt: Date | null } | null;
}) {
  const existingInvite = input.existingInvite ?? null;
  const referrer = input.referrer === undefined
    ? { id: "member_referrer", suspendedAt: null }
    : input.referrer;
  const createdInvite = {
    expiresAt: new Date("2026-08-06T22:30:00.000Z"),
    id: "invite_id",
    inviteCode: "new_invite",
    memberId: "member_target_new",
  };
  const tx = {
    hostedInvite: {
      create: vi.fn().mockResolvedValue(createdInvite),
      findFirst: vi.fn().mockResolvedValue(existingInvite),
      update: vi.fn().mockResolvedValue({
        ...createdInvite,
        id: existingInvite?.id ?? createdInvite.id,
        memberId: existingInvite?.memberId ?? createdInvite.memberId,
      }),
    },
    hostedMember: {
      findUnique: vi.fn().mockResolvedValue(referrer),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    ),
  };
  mocks.readHostedMemberIdentity.mockResolvedValue(
    input.identity === undefined && existingInvite
      ? pristineIdentity(existingInvite.memberId)
      : (input.identity ?? null),
  );

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

  it("reuses a live pristine attributed invite under both member-row locks", async () => {
    const now = new Date("2026-08-04T22:30:00.000Z");
    const existingInvite = {
      expiresAt: new Date("2026-08-06T22:30:00.000Z"),
      id: "invite_existing",
      inviteCode: "existing_invite",
      memberId: "member_target_existing",
    };
    const { prisma, tx } = createPrisma({ existingInvite });

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
        id: true,
        inviteCode: true,
        memberId: true,
      },
      where: {
        referrerMemberId: "member_referrer",
      },
    });
    expect(mocks.readHostedMemberIdentity).toHaveBeenCalledWith({
      memberId: "member_target_existing",
      prisma: tx,
    });
    expect(mocks.createHostedMember).not.toHaveBeenCalled();
    expect(tx.hostedInvite.create).not.toHaveBeenCalled();
    expect(tx.hostedInvite.update).not.toHaveBeenCalled();
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

  it("rotates an expired pristine invite in place without another placeholder member", async () => {
    const existingInvite = {
      expiresAt: new Date("2026-08-04T21:30:00.000Z"),
      id: "invite_existing",
      inviteCode: "expired_invite",
      memberId: "member_target_existing",
    };
    const { prisma, tx } = createPrisma({ existingInvite });

    await expect(issueHostedSignupReferralLink({
      now: new Date("2026-08-04T22:30:00.000Z"),
      prisma: prisma as never,
      publicBaseUrl: "https://www.withmurph.ai",
      referrerMemberId: "member_referrer",
    })).resolves.toEqual({
      expiresAt: new Date("2026-08-06T22:30:00.000Z"),
      signupUrl: "https://www.withmurph.ai/join/new_invite",
    });

    expect(tx.hostedInvite.update).toHaveBeenCalledWith({
      data: {
        channel: "share",
        expiresAt: new Date("2026-08-06T22:30:00.000Z"),
        inviteCode: "new_invite",
      },
      select: {
        expiresAt: true,
        id: true,
        inviteCode: true,
        memberId: true,
      },
      where: {
        id: "invite_existing",
      },
    });
    expect(mocks.createHostedMember).not.toHaveBeenCalled();
    expect(tx.hostedInvite.create).not.toHaveBeenCalled();
  });

  it("does not reuse an invite after any recipient onboarding activity", async () => {
    const memberId = "member_target_started";
    const { prisma, tx } = createPrisma({
      existingInvite: {
        expiresAt: new Date("2026-08-06T22:30:00.000Z"),
        id: "invite_started",
        inviteCode: "started_invite",
        memberId,
      },
      identity: {
        ...pristineIdentity(memberId),
        signupPhoneCodeSendAttemptStartedAt:
          new Date("2026-08-04T22:00:00.000Z"),
        signupPhoneNumber: "+14045550123",
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

    expect(tx.hostedInvite.update).not.toHaveBeenCalled();
    expect(mocks.createHostedMember).toHaveBeenCalledWith({
      billingStatus: "not_started",
      memberId: "member_target_new",
      prisma: tx,
    });
    expect(tx.hostedInvite.create).toHaveBeenCalled();
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
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedMember: vi.fn(),
  generateHostedInviteCode: vi.fn(),
  generateHostedInviteId: vi.fn(),
  generateHostedMemberId: vi.fn(),
  getHostedOnboardingEnvironment: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readHostedAppSessionHmacKey: vi.fn(() => Buffer.alloc(32, 7)),
  requireHostedOnboardingPublicBaseUrl: vi.fn(
    () => "https://www.withmurph.ai",
  ),
  upsertHostedMemberIdentity: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session-config", () => ({
  readHostedAppSessionHmacKey: mocks.readHostedAppSessionHmacKey,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  createHostedMember: mocks.createHostedMember,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  upsertHostedMemberIdentity: mocks.upsertHostedMemberIdentity,
}));
vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: mocks.getHostedOnboardingEnvironment,
  requireHostedOnboardingPublicBaseUrl:
    mocks.requireHostedOnboardingPublicBaseUrl,
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
  claimHostedSignupReferralLink,
  HOSTED_SIGNUP_REFERRAL_MAX_CLAIMS_PER_HOUR,
  issueHostedSignupReferralLink,
  readHostedSignupReferralLink,
} from "@/src/lib/hosted-growth/signup-referral";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

function createPrisma(input: {
  claimLockAcquired?: boolean;
  recentClaimCount?: number;
  referrer?: { id: string; suspendedAt: Date | null } | null;
} = {}) {
  const createdInvites: Array<Record<string, unknown>> = [];
  const hostedMember = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      input.referrer === undefined
        ? { id: where.id, suspendedAt: null }
        : input.referrer
    ),
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([
      { locked: input.claimLockAcquired ?? true },
    ]),
    hostedInvite: {
      count: vi.fn().mockResolvedValue(input.recentClaimCount ?? 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdInvites.push(data);
        return {
          expiresAt: data.expiresAt,
          inviteCode: data.inviteCode,
        };
      }),
    },
    hostedMember,
  };
  const prisma = {
    $transaction: vi.fn(
      (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    ),
    hostedMember,
  };
  return { createdInvites, prisma, tx };
}

function readReferralToken(signupUrl: string): string {
  const token = new URL(signupUrl).pathname.split("/").at(-1);
  if (!token) {
    throw new Error("Expected a referral token in the signup URL.");
  }
  return decodeURIComponent(token);
}

describe("hosted signup referral links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedMember.mockResolvedValue({});
    mocks.generateHostedInviteCode.mockReturnValue("generated_invite");
    mocks.generateHostedInviteId.mockReturnValue("generated_invite_id");
    mocks.generateHostedMemberId.mockReturnValue("member_generated");
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      inviteTtlHours: 48,
    });
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.readHostedAppSessionHmacKey.mockReturnValue(Buffer.alloc(32, 7));
    mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue(
      "https://www.withmurph.ai",
    );
    mocks.upsertHostedMemberIdentity.mockResolvedValue({});
  });

  it("builds a referrer-owned URL", () => {
    expect(buildHostedSignupReferralUrl(
      "a b/c",
      "https://www.withmurph.ai/app?ignored=1#fragment",
    )).toBe("https://www.withmurph.ai/r/a%20b%2Fc");
  });

  it("returns one stable signed URL without placeholder state", async () => {
    const { prisma, tx } = createPrisma();
    const input = {
      now: new Date("2026-08-06T12:00:00.000Z"),
      prisma: prisma as never,
      publicBaseUrl: "https://www.withmurph.ai",
      referrerMemberId: "member_referrer",
    };

    const first = await issueHostedSignupReferralLink(input);
    const second = await issueHostedSignupReferralLink(input);

    expect(first).toEqual(second);
    expect(first).toEqual({
      expiresAt: new Date("2099-12-31T23:59:59.999Z"),
      signupUrl: expect.stringMatching(
        /^https:\/\/www\.withmurph\.ai\/r\/murph_signup_referral_v1\./u,
      ),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.createHostedMember).not.toHaveBeenCalled();
    expect(tx.hostedInvite.create).not.toHaveBeenCalled();
  });

  it("validates the landing link without mutating onboarding state", async () => {
    const { prisma, tx } = createPrisma();
    const issued = await issueHostedSignupReferralLink({
      prisma: prisma as never,
      referrerMemberId: "member_referrer",
    });

    await expect(readHostedSignupReferralLink({
      prisma: prisma as never,
      referralCode: readReferralToken(issued.signupUrl),
    })).resolves.toEqual({
      expiresAt: new Date("2099-12-31T23:59:59.999Z"),
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.createHostedMember).not.toHaveBeenCalled();
    expect(tx.hostedInvite.create).not.toHaveBeenCalled();
  });

  it("mints isolated attributed invites for immediate and later claimants", async () => {
    mocks.generateHostedMemberId
      .mockReturnValueOnce("member_target_one")
      .mockReturnValueOnce("member_target_two");
    mocks.generateHostedInviteId
      .mockReturnValueOnce("invite_id_one")
      .mockReturnValueOnce("invite_id_two");
    mocks.generateHostedInviteCode
      .mockReturnValueOnce("invite_one")
      .mockReturnValueOnce("invite_two");
    const { createdInvites, prisma, tx } = createPrisma();
    const issued = await issueHostedSignupReferralLink({
      now: new Date("2026-08-06T12:00:00.000Z"),
      prisma: prisma as never,
      referrerMemberId: "member_referrer",
    });
    const referralCode = readReferralToken(issued.signupUrl);

    await expect(claimHostedSignupReferralLink({
      now: new Date("2026-08-06T12:05:00.000Z"),
      prisma: prisma as never,
      publicBaseUrl: "https://www.withmurph.ai",
      referralCode,
    })).resolves.toMatchObject({
      signupUrl: "https://www.withmurph.ai/join/invite_one",
    });
    await expect(claimHostedSignupReferralLink({
      now: new Date("2026-09-06T12:05:00.000Z"),
      prisma: prisma as never,
      publicBaseUrl: "https://www.withmurph.ai",
      referralCode,
    })).resolves.toMatchObject({
      signupUrl: "https://www.withmurph.ai/join/invite_two",
    });

    expect(createdInvites).toEqual([
      expect.objectContaining({
        channel: "signup-referral",
        inviteCode: "invite_one",
        memberId: "member_target_one",
        referrerMemberId: "member_referrer",
      }),
      expect.objectContaining({
        channel: "signup-referral",
        inviteCode: "invite_two",
        memberId: "member_target_two",
        referrerMemberId: "member_referrer",
      }),
    ]);
    expect(tx.hostedInvite.count).toHaveBeenNthCalledWith(1, {
      where: {
        createdAt: { gte: new Date("2026-08-06T11:05:00.000Z") },
        referrerMemberId: "member_referrer",
      },
    });
    expect(tx.hostedInvite.count).toHaveBeenNthCalledWith(2, {
      where: {
        createdAt: { gte: new Date("2026-09-06T11:05:00.000Z") },
        referrerMemberId: "member_referrer",
      },
    });
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledTimes(2);
  });

  it("requires the final signup origin before opening the claim transaction", async () => {
    const { prisma } = createPrisma();
    const issued = await issueHostedSignupReferralLink({
      prisma: prisma as never,
      publicBaseUrl: "https://www.withmurph.ai",
      referrerMemberId: "member_referrer",
    });
    mocks.requireHostedOnboardingPublicBaseUrl.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_PUBLIC_BASE_URL_REQUIRED",
        httpStatus: 500,
        message: "The public base URL is unavailable.",
      });
    });

    await expect(claimHostedSignupReferralLink({
      prisma: prisma as never,
      referralCode: readReferralToken(issued.signupUrl),
    })).rejects.toMatchObject({
      code: "HOSTED_ONBOARDING_PUBLIC_BASE_URL_REQUIRED",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.createHostedMember).not.toHaveBeenCalled();
  });

  it("takes the referrer row only after target provisioning and rechecks authority", async () => {
    const { prisma, tx } = createPrisma();
    const issued = await issueHostedSignupReferralLink({
      prisma: prisma as never,
      referrerMemberId: "member_referrer",
    });
    tx.hostedMember.findUnique.mockClear();

    await claimHostedSignupReferralLink({
      prisma: prisma as never,
      referralCode: readReferralToken(issued.signupUrl),
    });

    expect(tx.hostedMember.findUnique).toHaveBeenCalledTimes(2);
    const [initialAuthorityRead, finalAuthorityRead] =
      tx.hostedMember.findUnique.mock.invocationCallOrder;
    const [memberCreate] = mocks.createHostedMember.mock.invocationCallOrder;
    const [identityProvision] =
      mocks.upsertHostedMemberIdentity.mock.invocationCallOrder;
    const [referrerLock] = mocks.lockHostedMemberRow.mock.invocationCallOrder;
    const [inviteCreate] = tx.hostedInvite.create.mock.invocationCallOrder;
    if (
      initialAuthorityRead === undefined
      || memberCreate === undefined
      || identityProvision === undefined
      || referrerLock === undefined
      || finalAuthorityRead === undefined
      || inviteCreate === undefined
    ) {
      throw new TypeError("Expected the complete signup-claim call order.");
    }
    expect(initialAuthorityRead).toBeLessThan(memberCreate);
    expect(memberCreate).toBeLessThan(identityProvision);
    expect(identityProvision).toBeLessThan(referrerLock);
    expect(referrerLock).toBeLessThan(finalAuthorityRead);
    expect(finalAuthorityRead).toBeLessThan(inviteCreate);
  });

  it("fails fast on a concurrent claim before touching shared account state", async () => {
    const { prisma, tx } = createPrisma({ claimLockAcquired: false });
    const issued = await issueHostedSignupReferralLink({
      prisma: prisma as never,
      referrerMemberId: "member_referrer",
    });

    await expect(claimHostedSignupReferralLink({
      prisma: prisma as never,
      referralCode: readReferralToken(issued.signupUrl),
    })).rejects.toMatchObject({
      code: "HOSTED_SIGNUP_REFERRAL_CLAIM_BUSY",
      httpStatus: 429,
      retryable: true,
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.hostedInvite.count).not.toHaveBeenCalled();
    expect(mocks.lockHostedMemberRow).not.toHaveBeenCalled();
    expect(mocks.createHostedMember).not.toHaveBeenCalled();
    expect(tx.hostedInvite.create).not.toHaveBeenCalled();
  });

  it("bounds attributed claims after ordinary onboarding relabels", async () => {
    const now = new Date("2026-08-06T12:00:00.000Z");
    const { prisma, tx } = createPrisma({
      recentClaimCount: HOSTED_SIGNUP_REFERRAL_MAX_CLAIMS_PER_HOUR,
    });
    const issued = await issueHostedSignupReferralLink({
      now,
      prisma: prisma as never,
      referrerMemberId: "member_referrer",
    });

    await expect(claimHostedSignupReferralLink({
      now,
      prisma: prisma as never,
      referralCode: readReferralToken(issued.signupUrl),
    })).rejects.toMatchObject({
      code: "HOSTED_SIGNUP_REFERRAL_CLAIM_LIMIT_REACHED",
      httpStatus: 429,
      retryable: true,
    });

    expect(tx.hostedInvite.count).toHaveBeenCalledWith({
      where: {
        createdAt: {
          gte: new Date("2026-08-06T11:00:00.000Z"),
        },
        referrerMemberId: "member_referrer",
      },
    });
    expect(mocks.createHostedMember).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberIdentity).not.toHaveBeenCalled();
    expect(tx.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.lockHostedMemberRow).not.toHaveBeenCalled();
  });

  it("rejects tampered and ordinary invite tokens before mutation", async () => {
    const { prisma, tx } = createPrisma();
    const issued = await issueHostedSignupReferralLink({
      prisma: prisma as never,
      referrerMemberId: "member_referrer",
    });
    const token = readReferralToken(issued.signupUrl);
    const finalCharacter = token.at(-1);
    const tampered =
      `${token.slice(0, -1)}${finalCharacter === "A" ? "B" : "A"}`;

    for (const referralCode of [tampered, "ordinary_recipient_invite"]) {
      await expect(claimHostedSignupReferralLink({
        prisma: prisma as never,
        referralCode,
      })).rejects.toMatchObject({
        code: "HOSTED_SIGNUP_REFERRAL_LINK_NOT_FOUND",
      });
    }

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.createHostedMember).not.toHaveBeenCalled();
    expect(tx.hostedInvite.create).not.toHaveBeenCalled();
  });

  it("fails closed for missing or suspended referrers", async () => {
    const missing = createPrisma({ referrer: null });
    await expect(issueHostedSignupReferralLink({
      prisma: missing.prisma as never,
      referrerMemberId: "member_referrer",
    })).rejects.toMatchObject({
      code: "HOSTED_SIGNUP_REFERRER_NOT_FOUND",
    });

    const active = createPrisma();
    const issued = await issueHostedSignupReferralLink({
      prisma: active.prisma as never,
      referrerMemberId: "member_referrer",
    });
    const suspended = createPrisma({
      referrer: {
        id: "member_referrer",
        suspendedAt: new Date("2026-08-06T12:00:00.000Z"),
      },
    });
    await expect(claimHostedSignupReferralLink({
      prisma: suspended.prisma as never,
      referralCode: readReferralToken(issued.signupUrl),
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
    });
    expect(suspended.tx.hostedInvite.create).not.toHaveBeenCalled();
  });
});

import { generateKeyPairSync, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  recoverPendingHostedSignupReferralRewards,
  settleHostedSignupReferralReward,
} from "@/src/lib/hosted-growth/signup-referral-reward";
import {
  appendHostedSignupReferralRewardNotice,
} from "@/src/lib/hosted-growth/signup-referral-notification";
import { readHostedAiUsageActivity } from "@/src/lib/hosted-execution/usage-activity";
import {
  claimHostedSignupReferralLink,
  issueHostedSignupReferralLink,
} from "@/src/lib/hosted-growth/signup-referral";
import {
  handleHostedUsageReferralGroupTool,
  HOSTED_USAGE_REFERRAL_POLICY_VERSION,
} from "@/src/lib/hosted-growth/usage-referral";
import {
  getHostedAiUsageMonthlyAllowanceUsdMicros,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The signup-referral PostgreSQL concurrency proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted signup-referral PostgreSQL serialization",
  () => {
    it("discovers delayed resumed attribution while creating one receipt and grant", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for this proof.");
      }

      const fixtureId = randomUUID();
      const referrerMemberId = `member_signup_referrer_${fixtureId}`;
      const introducedMemberId = `member_signup_introduced_${fixtureId}`;
      const inviteId = `invite_signup_referral_${fixtureId}`;
      const activationId = `hmi_signup_referral_${fixtureId}`;
      const now = new Date();
      const introducedAt = new Date(now.getTime() - 25 * 24 * 60 * 60_000);
      const attributedAt = new Date(now.getTime() - 24 * 24 * 60 * 60_000);
      const activatedAt = new Date(now.getTime() - 2 * 60_000);
      const observer = createPrismaClient({ databaseUrl, poolMax: 2 });
      const firstClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const secondClient = createPrismaClient({ databaseUrl, poolMax: 1 });

      try {
        await observer.hostedMember.createMany({
          data: [
            {
              billingStatus: "active",
              createdAt: new Date(introducedAt.getTime() - 60_000),
              id: referrerMemberId,
            },
            {
              billingStatus: "active",
              createdAt: introducedAt,
              id: introducedMemberId,
            },
          ],
        });
        await observer.hostedInvite.create({
          data: {
            // Ordinary authenticated onboarding resume may relabel an invite
            // from signup-referral/share to web. Attribution authority is the
            // durable referrerMemberId and must survive that mutable metadata.
            channel: "web",
            createdAt: attributedAt,
            expiresAt: new Date(
              attributedAt.getTime() + 2 * 24 * 60 * 60_000,
            ),
            id: inviteId,
            inviteCode: `signup-referral-${fixtureId}`,
            memberId: introducedMemberId,
            referrerMemberId,
          },
        });
        await observer.hostedMailboxItem.create({
          data: {
            dedupeKey: `member.activated:${introducedMemberId}`,
            id: activationId,
            kind: "member.activated",
            lane: "system",
            laneSeq: 1n,
            occurredAt: activatedAt,
            payloadSchema: "murph.hosted-execution.member-activated.v1",
            userId: introducedMemberId,
          },
        });

        const settlementStartedAt = new Date();
        const firstPass = await Promise.all([
          recoverPendingHostedSignupReferralRewards({
            enabled: true,
            limit: 50,
            now,
            prisma: firstClient,
          }),
          recoverPendingHostedSignupReferralRewards({
            enabled: true,
            limit: 50,
            now,
            prisma: secondClient,
          }),
        ]);
        const settlementCompletedAt = new Date();
        expect(firstPass.reduce(
          (total, result) => total + result.failed,
          0,
        )).toBe(0);
        expect(firstPass.reduce(
          (total, result) => total + result.rewarded,
          0,
        )).toBe(1);
        expect(firstPass.reduce(
          (total, result) => total + result.scanned,
          0,
        )).toBeGreaterThanOrEqual(1);

        const referral =
          await observer.hostedUsageReferral.findFirstOrThrow({
            select: {
              beneficiaryMemberId: true,
              id: true,
              introducedMemberId: true,
              policyVersion: true,
              qualifiedAt: true,
              rewardedAt: true,
              rewardUsdMicros: true,
              status: true,
              targetBoundAt: true,
            },
            where: { introducedMemberId },
          });
        expect(referral).toEqual({
          beneficiaryMemberId: referrerMemberId,
          id: expect.any(String),
          introducedMemberId,
          policyVersion:
            "hosted-signup-referral-activation-2026-08-v1",
          qualifiedAt: activatedAt,
          rewardedAt: expect.any(Date),
          rewardUsdMicros: 2_000_000n,
          status: "rewarded",
          targetBoundAt: attributedAt,
        });
        if (!referral.rewardedAt) {
          throw new TypeError("Expected a rewarded signup receipt.");
        }
        expect(referral.rewardedAt.getTime()).toBeGreaterThanOrEqual(
          settlementStartedAt.getTime(),
        );
        expect(referral.rewardedAt.getTime()).toBeLessThanOrEqual(
          settlementCompletedAt.getTime(),
        );

        const replay = await Promise.all([
          settleHostedSignupReferralReward({
            activatedAt,
            introducedMemberId,
            prisma: firstClient,
            referrerMemberId,
          }),
          settleHostedSignupReferralReward({
            activatedAt,
            introducedMemberId,
            prisma: secondClient,
            referrerMemberId,
          }),
        ]);
        expect(replay).toEqual([
          {
            outcome: "already_processed",
            referralId: referral.id,
          },
          {
            outcome: "already_processed",
            referralId: referral.id,
          },
        ]);

        await expect(Promise.all([
          observer.hostedUsageReferral.count({
            where: { introducedMemberId },
          }),
          observer.hostedUsageCreditEntry.count({
            where: {
              kind: "referral_grant",
              referralId: referral.id,
            },
          }),
          observer.hostedUsageCreditGrant.count({
            where: {
              entry: { referralId: referral.id },
            },
          }),
          observer.hostedMember.findUniqueOrThrow({
            select: {
              usageCreditBalanceUsdMicros: true,
              usageCreditLedgerVersion: true,
            },
            where: { id: referrerMemberId },
          }),
        ])).resolves.toEqual([
          1,
          1,
          1,
          {
            usageCreditBalanceUsdMicros: 2_000_000n,
            usageCreditLedgerVersion: 1n,
          },
        ]);
      } finally {
        const referralIds = (
          await observer.hostedUsageReferral.findMany({
            select: { id: true },
            where: { introducedMemberId },
          })
        ).map(({ id }) => id);
        await observer.hostedUsageCreditGrant.deleteMany({
          where: {
            entry: { referralId: { in: referralIds } },
          },
        });
        await observer.hostedUsageCreditEntry.deleteMany({
          where: { referralId: { in: referralIds } },
        });
        await observer.hostedUsageReferral.deleteMany({
          where: { id: { in: referralIds } },
        });
        await observer.hostedMailboxItem.deleteMany({
          where: { id: activationId },
        });
        await observer.hostedInvite.deleteMany({
          where: { id: inviteId },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: { in: [referrerMemberId, introducedMemberId] },
          },
        });
        await Promise.all([
          observer.$disconnect(),
          firstClient.$disconnect(),
          secondClient.$disconnect(),
        ]);
      }
    }, 30_000);

    it("settles six delayed activations oldest-first without exceeding the cap", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for this proof.");
      }

      const fixtureId = randomUUID();
      const referrerMemberId = `member_signup_cap_referrer_${fixtureId}`;
      const introducedMemberIds = Array.from(
        { length: 6 },
        (_, index) => `member_signup_cap_${index}_${fixtureId}`,
      );
      const now = new Date();
      const introducedAt = new Date(now.getTime() - 24 * 60 * 60_000);
      const attributedAt = new Date(now.getTime() - 23 * 60 * 60_000);
      const activatedAt = introducedMemberIds.map(
        (_, index) => new Date(now.getTime() - (10 - index) * 60_000),
      );
      const observer = createPrismaClient({ databaseUrl, poolMax: 2 });
      const firstClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const secondClient = createPrismaClient({ databaseUrl, poolMax: 1 });

      try {
        await observer.hostedMember.createMany({
          data: [
            {
              billingStatus: "active",
              createdAt: new Date(introducedAt.getTime() - 60_000),
              id: referrerMemberId,
            },
            ...introducedMemberIds.map((id) => ({
              billingStatus: "active" as const,
              createdAt: introducedAt,
              id,
            })),
          ],
        });
        await observer.hostedInvite.createMany({
          data: introducedMemberIds.map((memberId, index) => ({
            channel: "web",
            createdAt: attributedAt,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
            id: `invite_signup_cap_${index}_${fixtureId}`,
            inviteCode: `signup-cap-${index}-${fixtureId}`,
            memberId,
            referrerMemberId,
          })),
        });
        await observer.hostedMailboxItem.createMany({
          data: introducedMemberIds.map((userId, index) => ({
            dedupeKey: `member.activated:${userId}`,
            id: `hmi_signup_cap_${index}_${fixtureId}`,
            kind: "member.activated",
            lane: "system" as const,
            laneSeq: 1n,
            occurredAt: activatedAt[index]!,
            payloadSchema: "murph.hosted-execution.member-activated.v1",
            userId,
          })),
        });

        const passes = await Promise.all([
          recoverPendingHostedSignupReferralRewards({
            enabled: true,
            now,
            prisma: firstClient,
          }),
          recoverPendingHostedSignupReferralRewards({
            enabled: true,
            now,
            prisma: secondClient,
          }),
        ]);
        expect(passes.reduce((total, pass) => total + pass.failed, 0)).toBe(0);
        expect(passes.reduce((total, pass) => total + pass.rewarded, 0)).toBe(5);

        const receipts = await observer.hostedUsageReferral.findMany({
          orderBy: [{ terminalAt: "asc" }, { id: "asc" }],
          select: {
            introducedMemberId: true,
            qualifiedAt: true,
            rewardedAt: true,
            status: true,
            terminalAt: true,
            terminalReason: true,
          },
          where: { introducedMemberId: { in: introducedMemberIds } },
        });
        expect(receipts).toHaveLength(6);
        expect(receipts.slice(0, 5)).toEqual(
          introducedMemberIds.slice(0, 5).map((introducedMemberId, index) => ({
            introducedMemberId,
            qualifiedAt: activatedAt[index],
            rewardedAt: expect.any(Date),
            status: "rewarded",
            terminalAt: expect.any(Date),
            terminalReason: null,
          })),
        );
        expect(receipts[5]).toEqual({
          introducedMemberId: introducedMemberIds[5],
          qualifiedAt: null,
          rewardedAt: null,
          status: "disqualified",
          terminalAt: expect.any(Date),
          terminalReason: "signup_referral_referrer_reward_cap_reached",
        });
        receipts.forEach((receipt, index) => {
          if (!receipt.terminalAt) {
            throw new TypeError("Expected a terminal signup receipt.");
          }
          expect(receipt.terminalAt.getTime()).toBeGreaterThan(
            activatedAt[index]!.getTime(),
          );
        });

        const disqualifiedReferral =
          await observer.hostedUsageReferral.findFirstOrThrow({
            select: { id: true },
            where: { introducedMemberId: introducedMemberIds[5] },
          });
        await expect(issueHostedSignupReferralLink({
          now,
          prisma: observer,
          publicBaseUrl: "https://www.withmurph.ai",
          referrerMemberId,
        })).resolves.toMatchObject({
          signupUrl: expect.stringMatching(
            /^https:\/\/www\.withmurph\.ai\/r\//u,
          ),
        });
        const settingsActivity = await readHostedAiUsageActivity({
          memberId: referrerMemberId,
          missionsEnabled: true,
          now,
          prisma: observer,
        });
        expect(settingsActivity.missions.map(({ id }) => id)).not.toContain(
          disqualifiedReferral.id,
        );
        await expect(appendHostedSignupReferralRewardNotice({
          prisma: observer,
          referralId: disqualifiedReferral.id,
        })).resolves.toBeNull();

        await expect(Promise.all([
          observer.hostedUsageCreditEntry.count({
            where: {
              beneficiaryMemberId: referrerMemberId,
              kind: "referral_grant",
            },
          }),
          observer.hostedUsageCreditGrant.count({
            where: {
              entry: { beneficiaryMemberId: referrerMemberId },
            },
          }),
          observer.hostedUsageCreditGrant.count({
            where: { entry: { referralId: disqualifiedReferral.id } },
          }),
          observer.hostedMember.findUniqueOrThrow({
            select: {
              usageCreditBalanceUsdMicros: true,
              usageCreditLedgerVersion: true,
            },
            where: { id: referrerMemberId },
          }),
          recoverPendingHostedSignupReferralRewards({
            enabled: true,
            now,
            prisma: firstClient,
          }),
        ])).resolves.toEqual([
          5,
          5,
          0,
          {
            usageCreditBalanceUsdMicros: 10_000_000n,
            usageCreditLedgerVersion: 5n,
          },
          { failed: 0, rewarded: 0, scanned: 0 },
        ]);
      } finally {
        const referralIds = (
          await observer.hostedUsageReferral.findMany({
            select: { id: true },
            where: { introducedMemberId: { in: introducedMemberIds } },
          })
        ).map(({ id }) => id);
        await observer.hostedUsageCreditGrant.deleteMany({
          where: { entry: { referralId: { in: referralIds } } },
        });
        await observer.hostedUsageCreditEntry.deleteMany({
          where: { referralId: { in: referralIds } },
        });
        await observer.hostedUsageReferral.deleteMany({
          where: { id: { in: referralIds } },
        });
        await observer.hostedMailboxItem.deleteMany({
          where: { userId: { in: introducedMemberIds } },
        });
        await observer.hostedInvite.deleteMany({
          where: { memberId: { in: introducedMemberIds } },
        });
        await observer.hostedMember.deleteMany({
          where: { id: { in: [referrerMemberId, ...introducedMemberIds] } },
        });
        await Promise.all([
          observer.$disconnect(),
          firstClient.$disconnect(),
          secondClient.$disconnect(),
        ]);
      }
    }, 60_000);

    it("orders delayed publication and fast-host commitments without overbooking", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for this proof.");
      }

      const fixtureId = randomUUID();
      const referrerMemberId = `member_signup_cross_cap_${fixtureId}`;
      const introducedMemberId = `member_signup_cross_target_${fixtureId}`;
      const now = new Date();
      const introducedAt = new Date(now.getTime() - 5 * 60_000);
      const attributedAt = new Date(now.getTime() - 4 * 60_000);
      const activatedAt = new Date(now.getTime() - 3 * 60_000);
      const periodStart = new Date(now.getTime() - 24 * 60 * 60_000);
      const periodEnd = new Date(now.getTime() + 31 * 24 * 60 * 60_000);
      const priorReferralIds = [
        `hur_signup_cross_prior_0_${fixtureId}`,
        `hur_signup_cross_prior_1_${fixtureId}`,
      ];
      const observer = createPrismaClient({ databaseUrl, poolMax: 2 });
      const publicationClient = createPrismaClient({
        databaseUrl,
        poolMax: 1,
      });
      const armClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const recoveryClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const sourceConversation = {
        channel: "linq" as const,
        linqService: "imessage" as const,
        threadId: `hid_${fixtureId.replaceAll("-", "")}`,
        threadIsDirect: true,
      };
      let markPublicationReady = (): void => {};
      const publicationReady = new Promise<void>((resolve) => {
        markPublicationReady = resolve;
      });
      let releasePublication = (): void => {};
      const publicationRelease = new Promise<void>((resolve) => {
        releasePublication = resolve;
      });
      let publication: Promise<unknown> | null = null;

      try {
        await observer.hostedMember.create({
          data: {
            billingRef: {
              create: {
                currentBillingPhase: "paid",
                currentBillingPlanCode: "launch_monthly",
                currentPeriodEnd: periodEnd,
                currentPeriodStart: periodStart,
              },
            },
            billingStatus: "active",
            hostedAiUsagePeriods: {
              create: {
                billingPlanCode: "launch_monthly",
                limitUsdMicros:
                  getHostedAiUsageMonthlyAllowanceUsdMicros("launch_monthly"),
                periodEnd,
                periodStart,
                spentUsdMicros: 0n,
              },
            },
            id: referrerMemberId,
          },
        });
        await observer.hostedMember.create({
          data: {
            billingStatus: "active",
            createdAt: introducedAt,
            id: introducedMemberId,
          },
        });
        await observer.hostedUsageReferral.createMany({
          data: priorReferralIds.map((id, index) => {
            const rewardedAt = index === 0
              ? new Date(now.getTime() + 2 * 60_000)
              : new Date(activatedAt.getTime() - 2 * 60_000);
            return {
              armedAt: new Date(rewardedAt.getTime() - 60_000),
              beneficiaryMemberId: referrerMemberId,
              expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
              id,
              policyCode: "active_group_v1" as const,
              policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
              qualifiedAt: rewardedAt,
              referrerMemberId,
              rewardedAt,
              rewardUsdMicros: 3_500_000n,
              status: "rewarded" as const,
              terminalAt: rewardedAt,
            };
          }),
        });
        await observer.hostedInvite.create({
          data: {
            channel: "web",
            createdAt: attributedAt,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
            id: `invite_signup_cross_${fixtureId}`,
            inviteCode: `signup-cross-${fixtureId}`,
            memberId: introducedMemberId,
            referrerMemberId,
          },
        });
        publication = publicationClient.$transaction(async (tx) => {
          await tx.hostedMailboxItem.create({
            data: {
              dedupeKey: `member.activated:${introducedMemberId}`,
              id: `hmi_signup_cross_${fixtureId}`,
              kind: "member.activated",
              lane: "system",
              laneSeq: 1n,
              occurredAt: activatedAt,
              payloadSchema: "murph.hosted-execution.member-activated.v1",
              userId: introducedMemberId,
            },
          });
          markPublicationReady();
          await publicationRelease;
        });
        await publicationReady;

        await expect(handleHostedUsageReferralGroupTool({
          enabled: true,
          memberId: referrerMemberId,
          prisma: armClient,
          request: {
            action: "arm_usage_referral",
            policyCodes: ["active_group_v1"],
            sourceConversation,
          },
        })).resolves.toMatchObject({
          result: {
            outcome: "armed",
            status: "ok",
          },
        });
        const committedArm =
          await observer.hostedUsageReferral.findFirstOrThrow({
            select: { id: true },
            where: {
              policyCode: "active_group_v1",
              referrerMemberId,
              status: "armed",
            },
          });
        const fastHostTimestamp = new Date(now.getTime() + 5 * 60_000);
        await observer.hostedUsageReferral.update({
          data: {
            armedAt: fastHostTimestamp,
            createdAt: fastHostTimestamp,
            expiresAt: new Date(fastHostTimestamp.getTime() + 24 * 60 * 60_000),
          },
          where: { id: committedArm.id },
        });

        releasePublication();
        await publication;

        await expect(recoverPendingHostedSignupReferralRewards({
          enabled: false,
          now,
          prisma: recoveryClient,
        })).resolves.toEqual({ failed: 0, rewarded: 0, scanned: 0 });

        const recoveryPasses = await Promise.all([
          recoverPendingHostedSignupReferralRewards({
            enabled: true,
            now,
            prisma: publicationClient,
          }),
          recoverPendingHostedSignupReferralRewards({
            enabled: true,
            now,
            prisma: recoveryClient,
          }),
        ]);
        expect(recoveryPasses.reduce(
          (total, pass) => total + pass.failed,
          0,
        )).toBe(0);
        expect(recoveryPasses.reduce(
          (total, pass) => total + pass.rewarded,
          0,
        )).toBe(0);
        expect(recoveryPasses.reduce(
          (total, pass) => total + pass.scanned,
          0,
        )).toBeGreaterThanOrEqual(1);

        const signupReceipt =
          await observer.hostedUsageReferral.findFirstOrThrow({
            select: {
              id: true,
              qualifiedAt: true,
              rewardedAt: true,
              status: true,
              terminalAt: true,
              terminalReason: true,
            },
            where: { introducedMemberId },
          });
        expect(signupReceipt).toMatchObject({
          qualifiedAt: null,
          rewardedAt: null,
          status: "disqualified",
          terminalReason: "signup_referral_referrer_reward_cap_reached",
        });
        if (!signupReceipt.terminalAt) {
          throw new TypeError("Expected a terminal signup receipt.");
        }
        expect(signupReceipt.terminalAt.getTime()).toBeGreaterThan(
          activatedAt.getTime(),
        );

        const capRows = await observer.hostedUsageReferral.findMany({
          select: {
            armedAt: true,
            introducedMemberId: true,
            policyCode: true,
            rewardedAt: true,
            rewardUsdMicros: true,
            status: true,
          },
          where: {
            referrerMemberId,
          },
        });
        expect(capRows.filter(({ status }) => status === "rewarded"))
          .toHaveLength(2);
        expect(capRows.filter(({ status }) => status === "armed"))
          .toEqual([expect.objectContaining({
            armedAt: fastHostTimestamp,
            introducedMemberId: null,
            policyCode: "active_group_v1",
            rewardUsdMicros: 3_500_000n,
          })]);
        expect(capRows.some(({ rewardedAt }) =>
          rewardedAt !== null && rewardedAt > now
        )).toBe(true);
        expect(capRows
          .filter(({ status }) => status === "rewarded" || status === "armed")
          .reduce((total, row) => total + row.rewardUsdMicros, 0n))
          .toBe(10_500_000n);
        await expect(observer.hostedUsageCreditGrant.count({
          where: { entry: { referralId: signupReceipt.id } },
        })).resolves.toBe(0);
        await expect(recoverPendingHostedSignupReferralRewards({
          enabled: true,
          now,
          prisma: recoveryClient,
        })).resolves.toEqual({ failed: 0, rewarded: 0, scanned: 0 });
      } finally {
        releasePublication();
        await publication?.catch(() => undefined);
        const referralIds = (
          await observer.hostedUsageReferral.findMany({
            select: { id: true },
            where: { referrerMemberId },
          })
        ).map(({ id }) => id);
        await observer.hostedUsageCreditGrant.deleteMany({
          where: { entry: { referralId: { in: referralIds } } },
        });
        await observer.hostedUsageCreditEntry.deleteMany({
          where: { referralId: { in: referralIds } },
        });
        await observer.hostedUsageReferral.deleteMany({
          where: { id: { in: referralIds } },
        });
        await observer.hostedMailboxItem.deleteMany({
          where: { userId: introducedMemberId },
        });
        await observer.hostedInvite.deleteMany({
          where: { memberId: introducedMemberId },
        });
        await observer.hostedMember.deleteMany({
          where: { id: { in: [referrerMemberId, introducedMemberId] } },
        });
        await Promise.all([
          observer.$disconnect(),
          publicationClient.$disconnect(),
          armClient.$disconnect(),
          recoveryClient.$disconnect(),
        ]);
      }
    }, 60_000);

    it.each(["suspended", "deleted"] as const)(
      "keeps the referrer row available during target provisioning and rejects a %s authority race",
      async (authorityOutcome) => {
        if (!databaseUrl) {
          throw new Error("DATABASE_URL is required for this proof.");
        }

        const fixtureId = randomUUID();
        const referrerMemberId = `member_claim_authority_${fixtureId}`;
        const now = new Date();
        const restoreCryptoEnv = configureHostedSignupClaimLocalCryptoForTest();
        const observer = createPrismaClient({ databaseUrl, poolMax: 2 });
        const blockerClient = createPrismaClient({ databaseUrl, poolMax: 1 });
        const claimantClient = createPrismaClient({ databaseUrl, poolMax: 1 });
        const authorityClient = createPrismaClient({ databaseUrl, poolMax: 1 });
        let markBlockerReady = (): void => {};
        const blockerReady = new Promise<void>((resolve) => {
          markBlockerReady = resolve;
        });
        let releaseBlocker = (): void => {};
        const blockerRelease = new Promise<void>((resolve) => {
          releaseBlocker = resolve;
        });
        let blocker: Promise<unknown> | null = null;
        let claim: Promise<unknown> | null = null;
        let authorityMutation: Promise<unknown> | null = null;

        try {
          await observer.hostedMember.create({
            data: {
              billingStatus: "active",
              id: referrerMemberId,
            },
          });
          const baselineOtherMembers = await observer.hostedMember.count({
            where: { id: { not: referrerMemberId } },
          });
          const baselineIdentities =
            await observer.hostedMemberIdentity.count();
          const [baselineEnvelopeCount] = await observer.$queryRaw<
            Array<{ count: number }>
          >`
            SELECT COUNT(*)::int AS count
            FROM "hosted_user_crypto_envelope"
          `;
          const referralUrl = (await issueHostedSignupReferralLink({
            now,
            prisma: observer,
            publicBaseUrl: "https://www.withmurph.ai",
            referrerMemberId,
          })).signupUrl;
          const referralCode = decodeURIComponent(
            new URL(referralUrl).pathname.slice("/r/".length),
          );

          blocker = blockerClient.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              'LOCK TABLE "hosted_user_crypto_envelope" IN ACCESS EXCLUSIVE MODE',
            );
            markBlockerReady();
            await blockerRelease;
          }, { maxWait: 5_000, timeout: 30_000 });
          await blockerReady;

          claim = claimHostedSignupReferralLink({
            now,
            prisma: claimantClient,
            publicBaseUrl: "https://www.withmurph.ai",
            referralCode,
          });
          const claimOutcome = claim.then(
            (value) => ({ status: "fulfilled" as const, value }),
            (reason: unknown) => ({ reason, status: "rejected" as const }),
          );

          let targetProvisioningWaitObserved = false;
          const waitDeadline = Date.now() + 10_000;
          while (Date.now() < waitDeadline) {
            const [state] = await observer.$queryRaw<Array<{ waiting: boolean }>>`
              SELECT EXISTS (
                SELECT 1
                FROM pg_locks
                WHERE relation = 'hosted_user_crypto_envelope'::regclass
                  AND granted = false
              ) AS waiting
            `;
            if (state?.waiting) {
              targetProvisioningWaitObserved = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(targetProvisioningWaitObserved).toBe(true);

          let markAuthorityLocked = (): void => {};
          const authorityLocked = new Promise<void>((resolve) => {
            markAuthorityLocked = resolve;
          });
          authorityMutation = authorityClient.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id
              FROM "hosted_member"
              WHERE id = ${referrerMemberId}
              FOR UPDATE NOWAIT
            `;
            expect(locked).toEqual([{ id: referrerMemberId }]);
            markAuthorityLocked();
            if (authorityOutcome === "suspended") {
              await tx.hostedMember.update({
                data: { suspendedAt: now },
                where: { id: referrerMemberId },
              });
            } else {
              await tx.hostedMember.delete({
                where: { id: referrerMemberId },
              });
            }
          });
          await authorityLocked;
          if (authorityOutcome === "suspended") {
            await authorityMutation;
          }

          releaseBlocker();
          await blocker;
          await authorityMutation;
          const outcome = await claimOutcome;
          expect(outcome.status).toBe("rejected");
          if (
            outcome.status !== "rejected"
            || !isHostedOnboardingError(outcome.reason)
          ) {
            throw new TypeError("Expected a typed claim authority rejection.");
          }
          expect(outcome.reason.code).toBe(
            authorityOutcome === "suspended"
              ? "HOSTED_MEMBER_SUSPENDED"
              : "HOSTED_SIGNUP_REFERRER_NOT_FOUND",
          );

          await expect(Promise.all([
            observer.hostedMember.count({
              where: { id: { not: referrerMemberId } },
            }),
            observer.hostedMemberIdentity.count(),
            observer.hostedInvite.count({ where: { referrerMemberId } }),
            observer.$queryRaw<Array<{ count: number }>>`
              SELECT COUNT(*)::int AS count
              FROM "hosted_user_crypto_envelope"
            `,
          ])).resolves.toEqual([
            baselineOtherMembers,
            baselineIdentities,
            0,
            [{ count: baselineEnvelopeCount?.count ?? 0 }],
          ]);
          await expect(observer.hostedMember.findUnique({
            select: { suspendedAt: true },
            where: { id: referrerMemberId },
          })).resolves.toEqual(
            authorityOutcome === "suspended"
              ? { suspendedAt: now }
              : null,
          );
        } finally {
          releaseBlocker();
          await blocker?.catch(() => undefined);
          await authorityMutation?.catch(() => undefined);
          await claim?.catch(() => undefined);
          const claimedMemberIds = (
            await observer.hostedInvite.findMany({
              select: { memberId: true },
              where: { referrerMemberId },
            })
          ).map(({ memberId }) => memberId);
          await observer.hostedInvite.deleteMany({
            where: { referrerMemberId },
          });
          await observer.hostedMember.deleteMany({
            where: {
              id: { in: [referrerMemberId, ...claimedMemberIds] },
            },
          });
          await Promise.all([
            observer.$disconnect(),
            blockerClient.$disconnect(),
            claimantClient.$disconnect(),
            authorityClient.$disconnect(),
          ]);
          restoreCryptoEnv();
        }
      },
      60_000,
    );

    it("rolls back failed target crypto provisioning and reuses the same link after recovery", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for this proof.");
      }

      const fixtureId = randomUUID();
      const referrerMemberId = `member_claim_retry_${fixtureId}`;
      const now = new Date();
      const restoreCryptoEnv = configureHostedSignupClaimLocalCryptoForTest();
      const validLocalWrapKey = process.env.HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY;
      const observer = createPrismaClient({ databaseUrl, poolMax: 2 });

      try {
        await observer.hostedMember.create({
          data: {
            billingStatus: "active",
            id: referrerMemberId,
          },
        });
        const [baselineMemberCount, baselineIdentityCount, baselineEnvelope] =
          await Promise.all([
            observer.hostedMember.count(),
            observer.hostedMemberIdentity.count(),
            observer.$queryRaw<Array<{ count: number }>>`
              SELECT COUNT(*)::int AS count
              FROM "hosted_user_crypto_envelope"
            `,
          ]);
        const referralUrl = (await issueHostedSignupReferralLink({
          now,
          prisma: observer,
          publicBaseUrl: "https://www.withmurph.ai",
          referrerMemberId,
        })).signupUrl;
        const referralCode = decodeURIComponent(
          new URL(referralUrl).pathname.slice("/r/".length),
        );

        process.env.HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY =
          Buffer.alloc(31, 7).toString("base64");
        await expect(claimHostedSignupReferralLink({
          now,
          prisma: observer,
          publicBaseUrl: "https://www.withmurph.ai",
          referralCode,
        })).rejects.toThrow();
        await expect(Promise.all([
          observer.hostedMember.count(),
          observer.hostedMemberIdentity.count(),
          observer.hostedInvite.count({ where: { referrerMemberId } }),
          observer.$queryRaw<Array<{ count: number }>>`
            SELECT COUNT(*)::int AS count
            FROM "hosted_user_crypto_envelope"
          `,
        ])).resolves.toEqual([
          baselineMemberCount,
          baselineIdentityCount,
          0,
          baselineEnvelope,
        ]);

        if (!validLocalWrapKey) {
          throw new TypeError("Expected the configured local KMS wrap key.");
        }
        process.env.HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY = validLocalWrapKey;
        const claimed = await claimHostedSignupReferralLink({
          now,
          prisma: observer,
          publicBaseUrl: "https://www.withmurph.ai",
          referralCode,
        });
        expect(claimed.signupUrl).toMatch(
          /^https:\/\/www\.withmurph\.ai\/join\//u,
        );
        const retryInvite = await observer.hostedInvite.findFirstOrThrow({
          select: { memberId: true },
          where: { referrerMemberId },
        });
        await expect(Promise.all([
          observer.hostedMember.count(),
          observer.hostedMemberIdentity.count({
            where: { memberId: retryInvite.memberId },
          }),
          observer.hostedInvite.count({ where: { referrerMemberId } }),
        ])).resolves.toEqual([
          baselineMemberCount + 1,
          1,
          1,
        ]);
      } finally {
        const claimedMemberIds = (
          await observer.hostedInvite.findMany({
            select: { memberId: true },
            where: { referrerMemberId },
          })
        ).map(({ memberId }) => memberId);
        await observer.hostedInvite.deleteMany({
          where: { referrerMemberId },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: { in: [referrerMemberId, ...claimedMemberIds] },
          },
        });
        await observer.$disconnect();
        restoreCryptoEnv();
      }
    }, 30_000);

    it("rejects a missing public signup origin before claim state can commit", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for this proof.");
      }

      const fixtureId = randomUUID();
      const referrerMemberId = `member_claim_origin_${fixtureId}`;
      const now = new Date();
      const restoreCryptoEnv = configureHostedSignupClaimLocalCryptoForTest();
      const originEnvironment = configureHostedSignupClaimOriginForTest();
      const observer = createPrismaClient({ databaseUrl, poolMax: 2 });

      try {
        await observer.hostedMember.create({
          data: {
            billingStatus: "active",
            id: referrerMemberId,
          },
        });
        const [baselineMemberCount, baselineIdentityCount, baselineEnvelope] =
          await Promise.all([
            observer.hostedMember.count(),
            observer.hostedMemberIdentity.count(),
            observer.$queryRaw<Array<{ count: number }>>`
              SELECT COUNT(*)::int AS count
              FROM "hosted_user_crypto_envelope"
            `,
          ]);
        const referralUrl = (await issueHostedSignupReferralLink({
          now,
          prisma: observer,
          publicBaseUrl: "https://www.withmurph.ai",
          referrerMemberId,
        })).signupUrl;
        const referralCode = decodeURIComponent(
          new URL(referralUrl).pathname.slice("/r/".length),
        );
        const route = await import("../app/r/[referralCode]/claim/route");
        const request = () => new Request(
          `https://www.withmurph.ai/r/${encodeURIComponent(referralCode)}/claim`,
          {
            headers: { Origin: "https://www.withmurph.ai" },
            method: "POST",
          },
        );

        const retryable = await route.POST(request(), {
          params: Promise.resolve({ referralCode }),
        });
        expect(retryable.status).toBe(303);
        expect(retryable.headers.get("content-type") ?? "").not.toContain(
          "application/json",
        );
        expect(retryable.headers.get("location")).toBe(
          `https://www.withmurph.ai/r/${encodeURIComponent(referralCode)}?status=busy`,
        );
        await expect(Promise.all([
          observer.hostedMember.count(),
          observer.hostedMemberIdentity.count(),
          observer.hostedInvite.count({ where: { referrerMemberId } }),
          observer.$queryRaw<Array<{ count: number }>>`
            SELECT COUNT(*)::int AS count
            FROM "hosted_user_crypto_envelope"
          `,
        ])).resolves.toEqual([
          baselineMemberCount,
          baselineIdentityCount,
          0,
          baselineEnvelope,
        ]);

        originEnvironment.setPublicBaseUrl("https://www.withmurph.ai");
        const claimed = await route.POST(request(), {
          params: Promise.resolve({ referralCode }),
        });
        expect(claimed.status).toBe(303);
        expect(claimed.headers.get("location")).toMatch(
          /^https:\/\/www\.withmurph\.ai\/join\//u,
        );
        const retryInvite = await observer.hostedInvite.findFirstOrThrow({
          select: { memberId: true },
          where: { referrerMemberId },
        });
        await expect(Promise.all([
          observer.hostedMember.count(),
          observer.hostedMemberIdentity.count({
            where: { memberId: retryInvite.memberId },
          }),
          observer.hostedInvite.count({ where: { referrerMemberId } }),
        ])).resolves.toEqual([
          baselineMemberCount + 1,
          1,
          1,
        ]);
      } finally {
        const claimedMemberIds = (
          await observer.hostedInvite.findMany({
            select: { memberId: true },
            where: { referrerMemberId },
          })
        ).map(({ memberId }) => memberId);
        await observer.hostedInvite.deleteMany({
          where: { referrerMemberId },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: { in: [referrerMemberId, ...claimedMemberIds] },
          },
        });
        await observer.$disconnect();
        originEnvironment.restore();
        restoreCryptoEnv();
      }
    }, 30_000);

    it("admits only one concurrent claim at the 49-to-50 boundary", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for this proof.");
      }

      const fixtureId = randomUUID();
      const referrerMemberId = `member_claim_referrer_${fixtureId}`;
      const seededMemberIds = Array.from(
        { length: 49 },
        (_, index) => `member_claim_target_${index}_${fixtureId}`,
      );
      const now = new Date();
      const createdAt = new Date(now.getTime() - 30 * 60_000);
      const restoreCryptoEnv = configureHostedSignupClaimLocalCryptoForTest();
      const observer = createPrismaClient({ databaseUrl, poolMax: 2 });
      const firstClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const secondClient = createPrismaClient({ databaseUrl, poolMax: 1 });

      try {
        await observer.hostedMember.createMany({
          data: [
            {
              billingStatus: "active",
              createdAt,
              id: referrerMemberId,
            },
            ...seededMemberIds.map((id) => ({
              billingStatus: "not_started" as const,
              createdAt,
              id,
            })),
          ],
        });
        await observer.hostedInvite.createMany({
          data: seededMemberIds.map((memberId, index) => ({
            channel: "web",
            createdAt,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
            id: `invite_claim_seed_${index}_${fixtureId}`,
            inviteCode: `claim-seed-${index}-${fixtureId}`,
            memberId,
            referrerMemberId,
          })),
        });
        const referralUrl = (await issueHostedSignupReferralLink({
          now,
          prisma: observer,
          publicBaseUrl: "https://www.withmurph.ai",
          referrerMemberId,
        })).signupUrl;
        const referralCode = decodeURIComponent(
          new URL(referralUrl).pathname.slice("/r/".length),
        );

        const outcomes = await Promise.allSettled([
          claimHostedSignupReferralLink({
            now,
            prisma: firstClient,
            publicBaseUrl: "https://www.withmurph.ai",
            referralCode,
          }),
          claimHostedSignupReferralLink({
            now,
            prisma: secondClient,
            publicBaseUrl: "https://www.withmurph.ai",
            referralCode,
          }),
        ]);
        const fulfilled = outcomes.filter(
          (outcome) => outcome.status === "fulfilled",
        );
        const rejected = outcomes.filter(
          (outcome) => outcome.status === "rejected",
        );
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        const rejection = rejected[0];
        if (!rejection || !isHostedOnboardingError(rejection.reason)) {
          throw new Error("Expected a typed hosted claim rejection.");
        }
        expect([
          "HOSTED_SIGNUP_REFERRAL_CLAIM_BUSY",
          "HOSTED_SIGNUP_REFERRAL_CLAIM_LIMIT_REACHED",
        ]).toContain(rejection.reason.code);

        const claimedInvites = await observer.hostedInvite.findMany({
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { memberId: true },
          where: {
            createdAt: { gte: new Date(now.getTime() - 60 * 60_000) },
            referrerMemberId,
          },
        });
        expect(claimedInvites).toHaveLength(50);
        expect(new Set(claimedInvites.map(({ memberId }) => memberId)).size).toBe(50);
        const newMemberIds = claimedInvites
          .map(({ memberId }) => memberId)
          .filter((memberId) => !seededMemberIds.includes(memberId));
        expect(newMemberIds).toHaveLength(1);
        await expect(observer.hostedMemberIdentity.count({
          where: { memberId: { in: newMemberIds } },
        })).resolves.toBe(1);

        await expect(claimHostedSignupReferralLink({
          now,
          prisma: secondClient,
          publicBaseUrl: "https://www.withmurph.ai",
          referralCode,
        })).rejects.toMatchObject({
          code: "HOSTED_SIGNUP_REFERRAL_CLAIM_LIMIT_REACHED",
        });
      } finally {
        const claimedMemberIds = (
          await observer.hostedInvite.findMany({
            select: { memberId: true },
            where: { referrerMemberId },
          })
        ).map(({ memberId }) => memberId);
        await observer.hostedInvite.deleteMany({
          where: { referrerMemberId },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: {
              in: [referrerMemberId, ...claimedMemberIds],
            },
          },
        });
        await Promise.all([
          observer.$disconnect(),
          firstClient.$disconnect(),
          secondClient.$disconnect(),
        ]);
        restoreCryptoEnv();
      }
    }, 30_000);
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(
    effectiveHost,
  ) || effectiveHost.startsWith("/");
}

const SIGNUP_CLAIM_CRYPTO_ENV_KEYS = [
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK",
  "HOSTED_CRYPTO_ENV",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_GCP_KMS_API_ROOT",
  "HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME",
  "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
  "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY",
] as const;

function configureHostedSignupClaimLocalCryptoForTest(): () => void {
  const previous = new Map(
    SIGNUP_CLAIM_CRYPTO_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  const authorityKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const automationKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "jwk" },
  });
  const authorityKeyVersion =
    "projects/test/locations/global/keyRings/test/cryptoKeys/authority/cryptoKeyVersions/1";
  Object.assign(process.env, {
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "test-automation-key",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK:
      JSON.stringify(automationKey.publicKey),
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: authorityKeyVersion,
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: authorityKey.publicKey,
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
      "projects/test/locations/global/keyRings/test/cryptoKeys/web-wrap",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK:
      JSON.stringify(authorityKey.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

const SIGNUP_CLAIM_ORIGIN_ENV_KEYS = [
  "HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS",
  "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
  "HOSTED_WEB_BASE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

function configureHostedSignupClaimOriginForTest(): {
  restore(): void;
  setPublicBaseUrl(value: string | null): void;
} {
  const previous = new Map(
    SIGNUP_CLAIM_ORIGIN_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  const runtimeGlobals = globalThis as typeof globalThis & {
    __murphHostedOnboardingEnv?: unknown;
  };
  const previousEnvironment = runtimeGlobals.__murphHostedOnboardingEnv;
  process.env.HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS =
    "https://www.withmurph.ai";
  process.env.HOSTED_WEB_BASE_URL = "";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "";

  const setPublicBaseUrl = (value: string | null): void => {
    if (value === null) {
      delete process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
    } else {
      process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = value;
    }
    delete runtimeGlobals.__murphHostedOnboardingEnv;
  };
  setPublicBaseUrl(null);

  return {
    restore() {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      if (previousEnvironment === undefined) {
        delete runtimeGlobals.__murphHostedOnboardingEnv;
      } else {
        runtimeGlobals.__murphHostedOnboardingEnv = previousEnvironment;
      }
    },
    setPublicBaseUrl,
  };
}

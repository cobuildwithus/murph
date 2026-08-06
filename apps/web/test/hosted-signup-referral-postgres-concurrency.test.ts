import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  settleHostedSignupReferralReward,
} from "@/src/lib/hosted-growth/signup-referral-reward";
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
    it("keeps delayed resumed attribution while creating one receipt and grant", async () => {
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
      const activatedAt = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
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

        const firstPass = await Promise.all([
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
        expect(firstPass.map(({ outcome }) => outcome).sort()).toEqual([
          "already_processed",
          "rewarded",
        ]);

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
          rewardedAt: activatedAt,
          rewardUsdMicros: 2_000_000n,
          status: "rewarded",
          targetBoundAt: attributedAt,
        });

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

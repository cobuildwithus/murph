import { generateKeyPairSync, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  recoverPendingHostedSignupReferralRewards,
  settleHostedSignupReferralReward,
} from "@/src/lib/hosted-growth/signup-referral-reward";
import {
  claimHostedSignupReferralLink,
  issueHostedSignupReferralLink,
} from "@/src/lib/hosted-growth/signup-referral";
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

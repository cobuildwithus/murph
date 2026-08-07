import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  appendHostedUsageCreditGrantTx,
} from "../hosted-execution/usage-credit-grant";
import {
  lockHostedUsageCreditBeneficiaryTx,
} from "../hosted-execution/usage-credit-ledger";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "../hosted-onboarding/shared";
import { generateHostedRandomPrefixedId } from "../primitives";
import { getPrisma } from "../prisma";
import {
  HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
  isHostedSignupReferralRewardEnabled,
} from "./signup-referral-policy";
import {
  buildHostedUsageReferralOutstandingWhere,
  HOSTED_USAGE_REFERRAL_BENEFICIARY_30D_CAP_USD_MICROS,
  HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
  HOSTED_USAGE_REFERRAL_REFERRER_30D_CAP_USD_MICROS,
} from "./usage-referral";

export {
  HOSTED_SIGNUP_REFERRAL_REWARDS_ENABLED_ENV,
  isHostedSignupReferralRewardEnabled,
} from "./signup-referral-policy";
export const HOSTED_SIGNUP_REFERRAL_RECOVERY_BATCH_SIZE = 50;
export const HOSTED_SIGNUP_REFERRAL_RECOVERY_LOOKBACK_MS =
  30 * 24 * 60 * 60 * 1_000;

const SIGNUP_REFERRAL_RECEIPT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

type HostedSignupReferralActivationCandidate = {
  occurredAt: Date;
  referrerMemberId: string;
  userId: string;
};

type HostedSignupReferralSettlementClock = {
  settledAt: Date;
};

type HostedSignupReferralRewardOutcome =
  | "already_processed"
  | "ambiguous_attribution"
  | "disqualified"
  | "not_activated"
  | "not_attributed"
  | "rewarded";

export interface HostedSignupReferralRewardResult {
  outcome: HostedSignupReferralRewardOutcome;
  referralId: string | null;
}

export interface HostedSignupReferralRewardRecoveryResult {
  failed: number;
  rewarded: number;
  scanned: number;
}

/**
 * Finds attributed activations and settles them through the existing referral
 * receipt and usage-credit ledger. Unlike a group mission, signup activation is
 * already one durable qualification event, so receipt creation and the grant
 * commit atomically instead of fabricating a target-bound group lifecycle.
 */
export async function recoverPendingHostedSignupReferralRewards(input: {
  enabled?: boolean;
  limit?: number;
  now?: Date;
  prisma?: PrismaClient;
} = {}): Promise<HostedSignupReferralRewardRecoveryResult> {
  if (!(input.enabled ?? isHostedSignupReferralRewardEnabled())) {
    return { failed: 0, rewarded: 0, scanned: 0 };
  }

  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const limit = Math.max(
    1,
    Math.min(
      input.limit ?? HOSTED_SIGNUP_REFERRAL_RECOVERY_BATCH_SIZE,
      HOSTED_SIGNUP_REFERRAL_RECOVERY_BATCH_SIZE,
    ),
  );
  const lookback = new Date(
    now.getTime() - HOSTED_SIGNUP_REFERRAL_RECOVERY_LOOKBACK_MS,
  );
  const candidates = await prisma.$queryRaw<
    HostedSignupReferralActivationCandidate[]
  >`
    SELECT
      candidate."userId",
      candidate."occurredAt",
      candidate."referrerMemberId"
    FROM (
      SELECT DISTINCT ON (mailbox."user_id")
        mailbox."user_id" AS "userId",
        mailbox."occurred_at" AS "occurredAt",
        (
          SELECT MIN(invite."referrer_member_id")
          FROM "hosted_invite" AS invite
          WHERE invite."member_id" = mailbox."user_id"
            AND invite."created_at" <= mailbox."occurred_at"
            AND invite."referrer_member_id" IS NOT NULL
        ) AS "referrerMemberId"
      FROM "hosted_mailbox_item" AS mailbox
      WHERE mailbox."kind" = 'member.activated'
        AND mailbox."occurred_at" >= ${lookback}
        AND 1 = (
          SELECT COUNT(DISTINCT invite."referrer_member_id")
          FROM "hosted_invite" AS invite
          WHERE invite."member_id" = mailbox."user_id"
            AND invite."created_at" <= mailbox."occurred_at"
            AND invite."referrer_member_id" IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "hosted_usage_referral" AS referral
          WHERE referral."introduced_member_id" = mailbox."user_id"
        )
      ORDER BY
        mailbox."user_id",
        mailbox."occurred_at" ASC,
        mailbox."id" ASC
    ) AS candidate
    ORDER BY candidate."occurredAt" ASC, candidate."userId" ASC
    LIMIT ${limit}
  `;

  let failed = 0;
  let rewarded = 0;
  const failedReferrerMemberIds = new Set<string>();
  for (const candidate of candidates) {
    // Do not let a later activation consume capacity while an earlier one for
    // the same referrer is unresolved. The query order is activation-stable.
    if (failedReferrerMemberIds.has(candidate.referrerMemberId)) {
      continue;
    }
    try {
      const result = await settleHostedSignupReferralReward({
        activatedAt: candidate.occurredAt,
        introducedMemberId: candidate.userId,
        prisma,
        referrerMemberId: candidate.referrerMemberId,
      });
      if (result.outcome === "rewarded") {
        rewarded += 1;
      }
    } catch {
      failed += 1;
      failedReferrerMemberIds.add(candidate.referrerMemberId);
    }
  }

  return {
    failed,
    rewarded,
    scanned: candidates.length,
  };
}

export async function settleHostedSignupReferralReward(input: {
  activatedAt: Date;
  introducedMemberId: string;
  prisma?: PrismaClient;
  referrerMemberId: string;
}): Promise<HostedSignupReferralRewardResult> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction(async (tx) => {
    await acquireHostedSignupReferralReferrerLockTx({
      referrerMemberId: input.referrerMemberId,
      tx,
    });

    const lockedReferrerMemberIds =
      await readHostedSignupReferralReferrerMemberIdsTx({
        activatedAt: input.activatedAt,
        introducedMemberId: input.introducedMemberId,
        tx,
      });
    if (lockedReferrerMemberIds.length === 0) {
      return { outcome: "not_attributed", referralId: null };
    }
    if (
      lockedReferrerMemberIds.length !== 1
      || lockedReferrerMemberIds[0] !== input.referrerMemberId
    ) {
      return { outcome: "ambiguous_attribution", referralId: null };
    }

    const lockedBeneficiary = await lockHostedUsageCreditBeneficiaryTx({
      beneficiaryMemberId: input.referrerMemberId,
      tx,
    });
    await acquireHostedSignupReferralIntroducedMemberLockTx({
      introducedMemberId: input.introducedMemberId,
      tx,
    });

    const existing = await tx.hostedUsageReferral.findFirst({
      select: { id: true },
      where: { introducedMemberId: input.introducedMemberId },
    });
    if (existing) {
      return {
        outcome: "already_processed",
        referralId: existing.id,
      };
    }
    const settledAt = await readHostedSignupReferralSettlementTimeTx(tx);

    const attribution = await tx.hostedInvite.findFirst({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { createdAt: true },
      where: {
        createdAt: { lte: input.activatedAt },
        memberId: input.introducedMemberId,
        referrerMemberId: input.referrerMemberId,
      },
    });
    if (!attribution) {
      return { outcome: "not_attributed", referralId: null };
    }

    const activation = await tx.hostedMailboxItem.findFirst({
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { occurredAt: true },
      where: {
        kind: "member.activated",
        occurredAt: {
          gte: attribution.createdAt,
          lte: input.activatedAt,
        },
        userId: input.introducedMemberId,
      },
    });
    if (!activation) {
      return { outcome: "not_activated", referralId: null };
    }

    const introducedMember = await tx.hostedMember.findUnique({
      select: {
        createdAt: true,
        suspendedAt: true,
      },
      where: { id: input.introducedMemberId },
    });
    const referrer = await tx.hostedMember.findUnique({
      select: { suspendedAt: true },
      where: { id: input.referrerMemberId },
    });
    const disqualificationReason =
      input.introducedMemberId === input.referrerMemberId
        ? "signup_referral_self_attribution"
        : !introducedMember || introducedMember.suspendedAt
          ? "signup_referral_introduced_member_unavailable"
          : !referrer || referrer.suspendedAt
            ? "signup_referral_referrer_unavailable"
            : await readHostedSignupReferralCapacityFailureTx({
                capacityAt: settledAt,
                beneficiaryMemberId: input.referrerMemberId,
                referrerMemberId: input.referrerMemberId,
                tx,
              });
    const referralId = generateHostedRandomPrefixedId("hur");
    const armedAt = introducedMember?.createdAt ?? attribution.createdAt;
    const expiresAt = new Date(
      Math.max(
        activation.occurredAt.getTime() + SIGNUP_REFERRAL_RECEIPT_WINDOW_MS,
        armedAt.getTime() + 1,
      ),
    );

    if (disqualificationReason) {
      await tx.hostedUsageReferral.create({
        data: {
          armedAt,
          beneficiaryMemberId: input.referrerMemberId,
          expiresAt,
          id: referralId,
          introducedMemberId: input.introducedMemberId,
          policyCode: "new_person_activation_v1",
          policyVersion: HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
          referrerMemberId: input.referrerMemberId,
          rewardUsdMicros:
            HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
          status: "disqualified",
          terminalAt: settledAt,
          terminalReason: disqualificationReason,
        },
      });
      return { outcome: "disqualified", referralId };
    }

    await tx.hostedUsageReferral.create({
      data: {
        armedAt,
        beneficiaryMemberId: input.referrerMemberId,
        expiresAt,
        id: referralId,
        introducedMemberId: input.introducedMemberId,
        policyCode: "new_person_activation_v1",
        policyVersion: HOSTED_SIGNUP_REFERRAL_POLICY_VERSION,
        qualifiedAt: activation.occurredAt,
        referrerMemberId: input.referrerMemberId,
        rewardedAt: settledAt,
        rewardUsdMicros:
          HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
        status: "rewarded",
        targetBoundAt: attribution.createdAt,
        terminalAt: settledAt,
      },
    });
    await appendHostedUsageCreditGrantTx({
      effectiveAt: settledAt,
      grantUsdMicros:
        HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
      lockedBeneficiary,
      semanticSourceKey:
        `hosted-usage-credit:referral:${referralId}:grant:v1`,
      source: {
        kind: "referral",
        referralId,
      },
      tx,
    });

    return { outcome: "rewarded", referralId };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function readHostedSignupReferralReferrerMemberIdsTx(input: {
  activatedAt: Date;
  introducedMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<string[]> {
  const rows = await input.tx.$queryRaw<Array<{ referrerMemberId: string }>>`
    SELECT DISTINCT
      invite."referrer_member_id" AS "referrerMemberId"
    FROM "hosted_invite" AS invite
    WHERE invite."member_id" = ${input.introducedMemberId}
      AND invite."created_at" <= ${input.activatedAt}
      AND invite."referrer_member_id" IS NOT NULL
    ORDER BY invite."referrer_member_id" ASC
    LIMIT 2
  `;
  return rows.map(({ referrerMemberId }) => referrerMemberId);
}

async function readHostedSignupReferralCapacityFailureTx(input: {
  capacityAt: Date;
  beneficiaryMemberId: string;
  referrerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<string | null> {
  const capacityWhere = buildHostedSignupReferralSettlementCapacityWhere(
    input.capacityAt,
  );
  const referrerCommitments = await input.tx.hostedUsageReferral.aggregate({
    where: {
      referrerMemberId: input.referrerMemberId,
      OR: capacityWhere,
    },
    _sum: { rewardUsdMicros: true },
  });
  const referrerTotal = referrerCommitments._sum.rewardUsdMicros ?? 0n;
  if (
    referrerTotal + HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS
    > HOSTED_USAGE_REFERRAL_REFERRER_30D_CAP_USD_MICROS
  ) {
    return "signup_referral_referrer_reward_cap_reached";
  }

  const beneficiaryCommitments =
    await input.tx.hostedUsageReferral.aggregate({
      where: {
        beneficiaryMemberId: input.beneficiaryMemberId,
        OR: capacityWhere,
      },
      _sum: { rewardUsdMicros: true },
    });
  const beneficiaryTotal =
    beneficiaryCommitments._sum.rewardUsdMicros ?? 0n;
  return beneficiaryTotal
      + HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS
      > HOSTED_USAGE_REFERRAL_BENEFICIARY_30D_CAP_USD_MICROS
    ? "signup_referral_beneficiary_reward_cap_reached"
    : null;
}

function buildHostedSignupReferralSettlementCapacityWhere(
  settledAt: Date,
): Prisma.HostedUsageReferralWhereInput[] {
  const since = new Date(
    settledAt.getTime() - HOSTED_SIGNUP_REFERRAL_RECOVERY_LOOKBACK_MS,
  );
  return [
    { rewardedAt: { gte: since } },
    ...buildHostedUsageReferralOutstandingWhere(settledAt),
  ];
}

async function readHostedSignupReferralSettlementTimeTx(
  tx: Prisma.TransactionClient,
): Promise<Date> {
  const [clock] = await tx.$queryRaw<HostedSignupReferralSettlementClock[]>`
    SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "settledAt"
  `;
  if (!clock) {
    throw new TypeError("Hosted signup referral settlement clock unavailable");
  }
  return clock.settledAt;
}

async function acquireHostedSignupReferralReferrerLockTx(input: {
  referrerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${"hosted-usage-referral-referrer"}),
      hashtext(${input.referrerMemberId})
    )
  `;
}

async function acquireHostedSignupReferralIntroducedMemberLockTx(input: {
  introducedMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${"hosted-usage-referral-introduced-member"}),
      hashtext(${input.introducedMemberId})
    )
  `;
}

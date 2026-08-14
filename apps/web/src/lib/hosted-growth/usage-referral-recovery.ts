import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { isHostedMailboxLane } from "@murphai/hosted-execution/runtime-control";

import {
  HOSTED_MAILBOX_RETENTION_MS,
} from "../hosted-mailbox/store";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";
import {
  appendHostedSignupReferralRewardNotice,
} from "./signup-referral-notification";
import {
  isHostedSignupReferralPolicyVersion,
} from "./signup-referral-policy";
import {
  recoverPendingHostedSignupReferralRewards,
  type HostedSignupReferralRewardRecoveryResult,
} from "./signup-referral-reward";
import {
  reconcileHostedUsageReferralRewardAfterCommit,
} from "./usage-referral";

export const HOSTED_USAGE_REFERRAL_RECOVERY_BATCH_SIZE = 50;
const HOSTED_USAGE_REFERRAL_NOTIFICATION_DEDUPE_PREFIX =
  "assistant.notification.requested:usage-referral-reward:";

export interface HostedUsageReferralRecoveryHead {
  id: string;
  lane: string;
  laneSeq: bigint;
  userId: string;
}

export interface HostedUsageReferralRecoveryResult {
  failed: number;
  pending: number;
  queued: number;
  resignaled: number;
  scanned: number;
}

/**
 * One bounded recovery owner settles signup-link rewards, reconciles ordinary
 * referral missions, queues each path's completion notice through the shared
 * assistant-notification mailbox, and re-signals existing mailbox pointers
 * after a best-effort wake failure. Already-imported legacy payload recovery
 * belongs to the local runtime; Web never rewrites mailbox ciphertext here.
 */
export async function recoverPendingHostedUsageReferrals(input: {
  now?: Date;
  prisma?: PrismaClient;
} = {}): Promise<HostedUsageReferralRecoveryResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const signupRewards = await recoverHostedSignupReferralRewardsSafely(prisma);
  const [referrals, recoveryHeads] = await Promise.all([
    prisma.hostedUsageReferral.findMany({
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        policyVersion: true,
      },
      take: HOSTED_USAGE_REFERRAL_RECOVERY_BATCH_SIZE,
      where: {
        OR: [
          {
            qualifiedAt: { not: null },
            status: "target_bound",
          },
          {
            celebrationQueuedAt: null,
            status: "rewarded",
          },
        ],
      },
    }),
    readHostedUsageReferralRecoveryHeads({ now, prisma }),
  ]);

  let failed = signupRewards.failed;
  let pending = 0;
  let queued = 0;
  for (const referral of referrals) {
    try {
      const wake = isHostedSignupReferralPolicyVersion(
          referral.policyVersion,
        )
        ? await appendHostedSignupReferralRewardNotice({
            prisma,
            referralId: referral.id,
          })
        : await reconcileHostedUsageReferralRewardAfterCommit({
            prisma,
            referralId: referral.id,
          });
      if (!wake) {
        pending += 1;
        continue;
      }
      queued += 1;
      try {
        await signalHostedMailboxAppendRuntime({
          expectedUserId: wake.userId,
          ...(wake.wakeMailboxCheckpoint
            ? {
                knownCheckpoint: {
                  ...wake.wakeMailboxCheckpoint,
                  userId: wake.userId,
                },
              }
            : {}),
          mailboxItemId: wake.mailboxItemId,
          prisma,
        });
      } catch {
        // The mailbox item is durable and the next bounded pass re-signals it.
      }
    } catch {
      failed += 1;
    }
  }

  let resignaled = 0;
  for (const head of recoveryHeads) {
    try {
      resignaled += 1;
      await signalHostedMailboxAppendRuntime({
        expectedUserId: head.userId,
        ...(isHostedMailboxLane(head.lane)
          ? {
              knownCheckpoint: {
                lane: head.lane,
                laneSeq: head.laneSeq.toString(),
                userId: head.userId,
              },
            }
          : {}),
        mailboxItemId: head.id,
        prisma,
      });
    } catch {
      // The next bounded recovery pass re-signals this same pending item.
    }
  }

  return {
    failed,
    pending,
    queued,
    resignaled,
    scanned:
      signupRewards.scanned
      + referrals.length
      + recoveryHeads.length,
  };
}

export async function readHostedUsageReferralRecoveryHeads(input: {
  limit?: number;
  now?: Date;
  prisma: PrismaClient;
}): Promise<HostedUsageReferralRecoveryHead[]> {
  const now = input.now ?? new Date();
  const retainedAt = new Date(now.getTime() - HOSTED_MAILBOX_RETENTION_MS);
  const limit = input.limit ?? HOSTED_USAGE_REFERRAL_RECOVERY_BATCH_SIZE;

  return input.prisma.$queryRaw<HostedUsageReferralRecoveryHead[]>(Prisma.sql`
    WITH candidate_referral_lane AS (
      SELECT
        notification.user_id,
        notification.lane,
        COALESCE(counter.consumed_seq, 0::bigint) AS consumed_seq
      FROM hosted_usage_referral AS referral
      JOIN hosted_mailbox_item AS notification
        ON notification.user_id = referral.beneficiary_member_id
        AND notification.dedupe_key = (
          ${HOSTED_USAGE_REFERRAL_NOTIFICATION_DEDUPE_PREFIX} || referral.id
        )
      LEFT JOIN hosted_mailbox_lane_counter AS counter
        ON counter.user_id = notification.user_id
        AND counter.lane = notification.lane
      WHERE notification.kind = 'assistant.notification.requested'
        AND referral.status = 'rewarded'
        AND referral.celebration_queued_at > ${retainedAt}
        AND notification.consumed_at IS NULL
        AND notification.lane_seq > COALESCE(counter.consumed_seq, 0::bigint)
        AND notification.created_at > ${retainedAt}
        AND (notification.expires_at IS NULL OR notification.expires_at > ${now})
    ), pending_referral_lane AS (
      SELECT DISTINCT ON (user_id, lane)
        user_id,
        lane,
        consumed_seq
      FROM candidate_referral_lane
      ORDER BY user_id, lane
    )
    SELECT
      head.id,
      head.lane,
      head.lane_seq AS "laneSeq",
      head.user_id AS "userId"
    FROM pending_referral_lane
    CROSS JOIN LATERAL (
      SELECT item.id, item.lane, item.lane_seq, item.user_id, item.created_at
      FROM hosted_mailbox_item AS item
      WHERE item.user_id = pending_referral_lane.user_id
        AND item.lane = pending_referral_lane.lane
        AND item.lane_seq > pending_referral_lane.consumed_seq
        AND item.created_at > ${retainedAt}
        AND (item.expires_at IS NULL OR item.expires_at > ${now})
      ORDER BY item.lane_seq ASC
      LIMIT 1
    ) AS head
    ORDER BY head.created_at ASC, head.id ASC
    LIMIT ${limit}
  `);
}

async function recoverHostedSignupReferralRewardsSafely(
  prisma: PrismaClient,
): Promise<HostedSignupReferralRewardRecoveryResult> {
  try {
    return await recoverPendingHostedSignupReferralRewards({ prisma });
  } catch (error) {
    console.error("Hosted signup referral recovery failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return {
      failed: 1,
      rewarded: 0,
      scanned: 0,
    };
  }
}

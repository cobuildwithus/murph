import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { isHostedMailboxLane } from "@murphai/hosted-execution/runtime-control";

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

interface PendingHostedUsageReferralNotification {
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
  prisma?: PrismaClient;
} = {}): Promise<HostedUsageReferralRecoveryResult> {
  const prisma = input.prisma ?? getPrisma();
  const signupRewards = await recoverHostedSignupReferralRewardsSafely(prisma);
  const [referrals, pendingCelebrations] = await Promise.all([
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
    prisma.$queryRaw<PendingHostedUsageReferralNotification[]>(Prisma.sql`
      SELECT
        item.id,
        item.lane,
        item.lane_seq AS "laneSeq",
        item.user_id AS "userId"
      FROM hosted_mailbox_item AS item
      INNER JOIN hosted_mailbox_lane_counter AS counter
        ON counter.user_id = item.user_id
        AND counter.lane = item.lane
      WHERE item.consumed_at IS NULL
        AND item.dedupe_key LIKE
          ${`${HOSTED_USAGE_REFERRAL_NOTIFICATION_DEDUPE_PREFIX}%`}
        AND item.kind = 'assistant.notification.requested'
        AND item.lane_seq = counter.consumed_seq + 1
      ORDER BY item.created_at ASC, item.id ASC
      LIMIT ${HOSTED_USAGE_REFERRAL_RECOVERY_BATCH_SIZE}
    `),
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
  for (const celebration of pendingCelebrations) {
    try {
      resignaled += 1;
      await signalHostedMailboxAppendRuntime({
        expectedUserId: celebration.userId,
        ...(isHostedMailboxLane(celebration.lane)
          ? {
              knownCheckpoint: {
                lane: celebration.lane,
                laneSeq: celebration.laneSeq.toString(),
                userId: celebration.userId,
              },
            }
          : {}),
        mailboxItemId: celebration.id,
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
      + pendingCelebrations.length,
  };
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

import "server-only";

import type { PrismaClient } from "@prisma/client";

import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";
import {
  reconcileHostedUsageReferralRewardAfterCommit,
} from "./usage-referral";

export const HOSTED_USAGE_REFERRAL_RECOVERY_BATCH_SIZE = 50;

export interface HostedUsageReferralRecoveryResult {
  failed: number;
  pending: number;
  queued: number;
  resignaled: number;
  scanned: number;
}

/**
 * Bounded recovery for referrals whose qualifying ingress committed before
 * reward reconciliation, or whose final credit committed before the source
 * celebration reached the durable mailbox.
 */
export async function recoverPendingHostedUsageReferrals(input: {
  prisma?: PrismaClient;
} = {}): Promise<HostedUsageReferralRecoveryResult> {
  const prisma = input.prisma ?? getPrisma();
  const [referrals, unconsumedCelebrations] = await Promise.all([
    prisma.hostedUsageReferral.findMany({
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: { id: true },
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
    prisma.hostedMailboxItem.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        laneSeq: true,
        userId: true,
      },
      take: HOSTED_USAGE_REFERRAL_RECOVERY_BATCH_SIZE,
      where: {
        consumedAt: null,
        dedupeKey: {
          startsWith:
            "assistant.notification.requested:usage-referral-reward:",
        },
        kind: "assistant.notification.requested",
        lane: "system",
      },
    }),
  ]);

  let failed = 0;
  let pending = 0;
  let queued = 0;
  for (const referral of referrals) {
    try {
      const wake = await reconcileHostedUsageReferralRewardAfterCommit({
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

  for (const celebration of unconsumedCelebrations) {
    try {
      await signalHostedMailboxAppendRuntime({
        expectedUserId: celebration.userId,
        knownCheckpoint: {
          lane: "system",
          laneSeq: celebration.laneSeq.toString(),
          userId: celebration.userId,
        },
        mailboxItemId: celebration.id,
        prisma,
      });
    } catch {
      // The next bounded recovery pass re-signals this same unconsumed item.
    }
  }

  return {
    failed,
    pending,
    queued,
    resignaled: unconsumedCelebrations.length,
    scanned: referrals.length + unconsumedCelebrations.length,
  };
}

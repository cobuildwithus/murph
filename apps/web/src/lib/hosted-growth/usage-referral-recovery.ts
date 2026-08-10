import "server-only";

import type { PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  type HostedExecutionAssistantNotificationRequestedWake,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import { isHostedMailboxLane } from "@murphai/hosted-execution/runtime-control";

import {
  readHostedMailboxWakeByItemId,
  replaceUnconsumedHostedMailboxEnvelopePayloadTx,
} from "../hosted-mailbox/store";
import {
  acquireHostedMemberHomeLinqRouteLockTx,
} from "../hosted-onboarding/hosted-member-routing-store";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "../hosted-onboarding/shared";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";
import {
  assertHostedDirectAssistantNotificationRouteAuthority,
} from "../hosted-routing/assistant-notification-destination";
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
 * assistant-notification mailbox, and re-signals durable notices after a
 * best-effort wake failure.
 */
export async function recoverPendingHostedUsageReferrals(input: {
  prisma?: PrismaClient;
} = {}): Promise<HostedUsageReferralRecoveryResult> {
  const prisma = input.prisma ?? getPrisma();
  const signupRewards = await recoverHostedSignupReferralRewardsSafely(prisma);
  const [referrals, unconsumedCelebrations] = await Promise.all([
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
    prisma.hostedMailboxItem.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        dedupeKey: true,
        id: true,
        lane: true,
        laneSeq: true,
        payloadHash: true,
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
      },
    }),
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
  for (const celebration of unconsumedCelebrations) {
    try {
      const prepared = await prepareHostedUsageReferralCelebrationForResignal({
        celebration,
        prisma,
      });
      if (!prepared) {
        continue;
      }
      resignaled += 1;
      await signalHostedMailboxAppendRuntime({
        expectedUserId: prepared.userId,
        ...(isHostedMailboxLane(prepared.lane)
          ? {
              knownCheckpoint: {
                lane: prepared.lane,
                laneSeq: prepared.laneSeq,
                userId: prepared.userId,
              },
            }
          : {}),
        mailboxItemId: prepared.id,
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
    resignaled,
    scanned:
      signupRewards.scanned
      + referrals.length
      + unconsumedCelebrations.length,
  };
}

interface HostedUsageReferralCelebrationRow {
  dedupeKey: string;
  id: string;
  lane: string;
  laneSeq: bigint;
  payloadHash: string | null;
  userId: string;
}

interface HostedUsageReferralCelebrationPointer {
  id: string;
  lane: string;
  laneSeq: string;
  userId: string;
}

async function prepareHostedUsageReferralCelebrationForResignal(input: {
  celebration: HostedUsageReferralCelebrationRow;
  prisma: PrismaClient;
}): Promise<HostedUsageReferralCelebrationPointer | null> {
  const storedWake = await readHostedMailboxWakeByItemId({
    mailboxItemId: input.celebration.id,
    prisma: input.prisma,
  });
  const wake = readHostedUsageReferralCelebrationWake({
    celebration: input.celebration,
    wake: storedWake,
  });
  if (!wake) {
    return null;
  }

  if (wake.notification.externalThreadRouteAuthority) {
    return {
      id: input.celebration.id,
      lane: input.celebration.lane,
      laneSeq: input.celebration.laneSeq.toString(),
      userId: input.celebration.userId,
    };
  }

  const payloadHash = input.celebration.payloadHash;
  const route = wake.notification.route;
  if (
    !payloadHash
    || route.channel !== "linq"
    || route.threadIsDirect !== true
    || route.delivery.kind !== "explicit"
  ) {
    return null;
  }

  const authority = {
    channel: "linq" as const,
    containerMemberId: wake.userId,
    threadId: route.delivery.target,
  };
  const upgradedWake = buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: wake.eventId,
    memberId: wake.userId,
    notification: {
      ...wake.notification,
      externalThreadRouteAuthority: authority,
    },
    occurredAt: wake.occurredAt,
  });

  return await input.prisma.$transaction(async (tx) => {
    await acquireHostedMemberHomeLinqRouteLockTx({
      memberId: wake.userId,
      prisma: tx,
    });
    await assertHostedDirectAssistantNotificationRouteAuthority({
      authority,
      prisma: tx,
      requireThreadDelivery: true,
    });
    return await replaceUnconsumedHostedMailboxEnvelopePayloadTx({
      envelope: upgradedWake,
      expectedPayloadHash: payloadHash,
      mailboxItemId: input.celebration.id,
      tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

function readHostedUsageReferralCelebrationWake(input: {
  celebration: HostedUsageReferralCelebrationRow;
  wake: HostedExecutionWake | null | undefined;
}): HostedExecutionAssistantNotificationRequestedWake | null {
  const { celebration, wake } = input;
  if (
    !wake
    || wake.kind !== "assistant.notification.requested"
    || wake.eventId !== celebration.dedupeKey
    || wake.userId !== celebration.userId
    || !wake.eventId.startsWith(
      "assistant.notification.requested:usage-referral-reward:",
    )
  ) {
    return null;
  }

  const notificationKey = wake.eventId.slice(
    "assistant.notification.requested:".length,
  );
  return (
    wake.notification.deliveryDispatchMode === "queue-only"
    && wake.notification.deliveryDedupeToken === notificationKey
    && wake.notification.deliveryIdempotencyKey === notificationKey
  )
    ? wake
    : null;
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

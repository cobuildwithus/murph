import "server-only";

import { after } from "next/server";
import type { PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";
import {
  isPushPrimarySourceRecoveryNoticeEligible,
  readPushPrimarySourceRecoveryNoticePolicy,
} from "@murphai/device-syncd/source-staleness";

import {
  appendHostedMailboxEnvelopeWithPreparedCryptoTx,
  readHostedMailboxItemByDedupeKey,
  runWithPreparedHostedMailboxItemAppendCrypto,
  type HostedMailboxItemRecord,
} from "../hosted-mailbox/store";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import { renderUserFacingMessage } from "../hosted-messages/user-facing-messages";
import { hasHostedLinqInboundWithinDays } from "../hosted-onboarding/linq-daily-state";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { resolveHostedAssistantNotificationDestination } from "../hosted-routing/assistant-notification-destination";
import { getPrisma } from "../prisma";
import {
  buildHostedSourceDeliveryStallNoticeKey,
  type HostedSourceDeliveryStallNoticeCandidate,
} from "./source-delivery-stall-episode";
import { readHostedSourceNoDataOutreachPolicy } from "./source-no-data-outreach-policy";

export {
  buildHostedSourceDeliveryStallNoticeKey,
  resolveHostedSourceDeliveryStallNoticeCandidate,
  type HostedSourceDeliveryStallNoticeCandidate,
} from "./source-delivery-stall-episode";

export function scheduleHostedSourceDeliveryStallNotices(input: {
  candidates: readonly HostedSourceDeliveryStallNoticeCandidate[];
  now: string;
  userId: string;
}): void {
  if (input.candidates.length === 0) {
    return;
  }
  const task = async () => {
    for (const candidate of input.candidates) {
      try {
        await materializeHostedSourceDeliveryStallNotice({
          candidate,
          now: input.now,
          userId: input.userId,
        });
      } catch {
        // One source must not prevent later candidates or fail runtime apply.
      }
    }
  };
  try {
    after(task);
  } catch {
    void task();
  }
}

export async function materializeHostedSourceDeliveryStallNotice(input: {
  candidate: HostedSourceDeliveryStallNoticeCandidate;
  now: string;
  prisma?: PrismaClient;
  userId: string;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();
  const now = new Date(input.now);
  if (!Number.isFinite(now.getTime())) {
    return;
  }
  const notificationKey = buildHostedSourceDeliveryStallNoticeKey(input.candidate);
  const dedupeKey = `assistant.notification.requested:${notificationKey}`;
  const existing = await readHostedMailboxItemByDedupeKey({
    dedupeKey,
    prisma,
    userId: input.userId,
  });
  if (existing && existing.consumedAt !== null) {
    return;
  }
  const appended = await runWithPreparedHostedMailboxItemAppendCrypto({
    append: (prepared) => prisma.$transaction(async (tx) => {
      const source = await tx.deviceConnectionSource.findUnique({
        select: {
          connection: { select: { status: true, userId: true } },
          lastDataAt: true,
          lifecycleEpoch: true,
          sourceProviderSlug: true,
          status: true,
        },
        where: {
          connectionId_sourceInstanceKey: {
            connectionId: input.candidate.connectionId,
            sourceInstanceKey: input.candidate.sourceInstanceKey,
          },
        },
      });
      const outreachPolicy = source
        ? await readHostedSourceNoDataOutreachPolicy({
            memberId: input.userId,
            prisma: tx,
            sourceProviderSlug: source.sourceProviderSlug,
          })
        : null;
      if (
        !source
        || source.connection.userId !== input.userId
        || source.connection.status !== "active"
        || source.lifecycleEpoch !== input.candidate.lifecycleEpoch
        || source.lastDataAt?.toISOString() !== input.candidate.lastDataAt
        || source.sourceProviderSlug !== input.candidate.sourceProviderSlug
        || !outreachPolicy?.enabled
        || !isPushPrimarySourceRecoveryNoticeEligible({
          lastDataAt: source.lastDataAt?.toISOString() ?? null,
          now: input.now,
          silentHours: outreachPolicy.silentHours,
          sourceProviderSlug: source.sourceProviderSlug,
          status: source.status,
        })
        || !(await hasHostedRuntimeActiveAccess(input.userId, { prisma: tx }))
        || !(await hasHostedLinqInboundWithinDays({
          memberId: input.userId,
          now,
          prisma: tx,
        }))
      ) {
        return null;
      }
      const destination = await resolveHostedAssistantNotificationDestination({
        directChannel: "linq",
        memberId: input.userId,
        prisma: tx,
      });
      if (
        destination?.conversationShape !== "direct-member"
        || destination.externalThreadRouteAuthority !== null
        || destination.route.channel !== "linq"
        || destination.route.threadIsDirect !== true
        || destination.route.delivery.kind !== "thread"
      ) {
        return null;
      }
      const policy = readPushPrimarySourceRecoveryNoticePolicy(source.sourceProviderSlug);
      if (!policy) {
        return null;
      }
      const checkIn = renderUserFacingMessage({
        context: {
          companionAppName: policy.companionAppName,
          deviceDisplayName: policy.deviceDisplayName,
          providerDisplayName: policy.providerDisplayName,
        },
        key: "linq.device_delivery_stalled",
        seed: notificationKey,
      }).text;
      const text = `${checkIn} If this gap is expected, tell me how long you'd like me to wait before checking again.`;
      return appendHostedMailboxEnvelopeWithPreparedCryptoTx({
        envelope: buildHostedExecutionAssistantNotificationRequestedWake({
          eventId: dedupeKey,
          memberId: input.userId,
          notification: {
            deliveryDedupeToken: notificationKey,
            deliveryDispatchMode: "queue-only",
            deliveryIdempotencyKey: notificationKey,
            instructions: "Wearable recovery check; exact user-facing text is in responsePolicy.",
            responsePolicy: { kind: "require_send_exact_text", text },
            route: destination.route,
          },
          occurredAt: now.toISOString(),
        }),
        prepared,
        tx,
      });
    }, {
      ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
      timeout: 10_000,
    }),
    prisma,
    userId: input.userId,
  });
  if (appended) {
    await signalHostedSourceDeliveryStallNoticeBestEffort({
      item: appended.item,
      prisma,
    });
  }
}

async function signalHostedSourceDeliveryStallNoticeBestEffort(input: {
  item: HostedMailboxItemRecord;
  prisma: PrismaClient;
}): Promise<void> {
  if (input.item.consumedAt !== null) {
    return;
  }
  try {
    await signalHostedMailboxAppendRuntime({
      expectedUserId: input.item.userId,
      knownCheckpoint: {
        lane: input.item.lane,
        laneSeq: input.item.laneSeq,
        userId: input.item.userId,
      },
      mailboxItemId: input.item.id,
      prisma: input.prisma,
    });
  } catch {
    // The durable live item will be imported by a later runtime wake.
  }
}

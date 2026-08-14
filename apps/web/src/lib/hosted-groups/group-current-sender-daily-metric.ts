import "server-only";

import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionDailyMetricReportedWake,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionAssistantAskAcceptedInputOrigin,
  HostedExecutionDailyMetricReportedPayload,
  HostedExecutionDailyMetricReportedWake,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRuntimeGroupDailyMetricReportResult,
} from "@murphai/hosted-execution/runtime-control";

import {
  appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey,
  readHostedMailboxWakeByDedupeKey,
} from "../hosted-mailbox/store";
import { getPrisma } from "../prisma";
import {
  readHostedGroupCurrentSenderAuthorityTx,
} from "./group-current-sender-assistant-ask";

const CURRENT_SENDER_DAILY_METRIC_ID_NAMESPACE =
  "murph.hosted-group-current-sender-daily-metric.v1";
const CURRENT_SENDER_DAILY_METRIC_LOCK_NAMESPACE =
  "hosted-group-current-sender-daily-metric";

type HostedCurrentSenderDailyMetricPrismaClient = Pick<PrismaClient, "$transaction">;

export interface HostedGroupCurrentSenderDailyMetricAdmission {
  mailboxWake: {
    expectedUserId: string;
    mailboxItemId: string;
  } | null;
  result: HostedRuntimeGroupDailyMetricReportResult;
}

export function createHostedGroupCurrentSenderDailyMetricReportId(input: {
  date: string;
  groupRuntimeMemberId: string;
  metric: string;
  originAssistantInputId: string;
}): string {
  const digest = createHash("sha256")
    .update(CURRENT_SENDER_DAILY_METRIC_ID_NAMESPACE)
    .update("\0")
    .update(input.groupRuntimeMemberId)
    .update("\0")
    .update(input.originAssistantInputId)
    .update("\0")
    .update(input.date)
    .update("\0")
    .update(input.metric)
    .digest("hex");
  return `daily_metric_report_${digest}`;
}

export async function recordHostedGroupCurrentSenderDailyMetric(input: {
  dailyMetric: HostedExecutionDailyMetricReportedPayload;
  groupRuntimeMemberId: string;
  now?: Date;
  origin: HostedExecutionAssistantAskAcceptedInputOrigin;
  prisma?: HostedCurrentSenderDailyMetricPrismaClient;
}): Promise<HostedGroupCurrentSenderDailyMetricAdmission> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const reportId = createHostedGroupCurrentSenderDailyMetricReportId({
    date: input.dailyMetric.date,
    groupRuntimeMemberId: input.groupRuntimeMemberId,
    metric: input.dailyMetric.metric,
    originAssistantInputId: input.origin.assistantInputId,
  });

  return prisma.$transaction(async (tx) => {
    await acquireCurrentSenderDailyMetricLockTx(tx, reportId);
    const authority = await readHostedGroupCurrentSenderAuthorityTx({
      expectedGroupRuntimeMemberId: input.groupRuntimeMemberId,
      now,
      origin: input.origin,
      tx,
    });
    if (!authority) {
      return unavailableDailyMetricAdmission("current_sender_unavailable");
    }

    const existingItem = await readHostedMailboxItemByDedupeKey({
      dedupeKey: reportId,
      prisma: tx,
      userId: authority.targetMemberId,
    });
    if (existingItem) {
      const existingWake = await readHostedMailboxWakeByDedupeKey({
        dedupeKey: reportId,
        prisma: tx,
        userId: authority.targetMemberId,
      });
      if (
        !existingWake
        || existingWake.kind !== "health.daily-metric.reported"
        || !dailyMetricReportMatches(existingWake, {
          dailyMetric: input.dailyMetric,
          reportId,
          targetMemberId: authority.targetMemberId,
        })
      ) {
        return unavailableDailyMetricAdmission("report_conflict");
      }
      return {
        mailboxWake: {
          expectedUserId: authority.targetMemberId,
          mailboxItemId: existingItem.id,
        },
        result: { status: "accepted" },
      };
    }

    const wake = buildHostedExecutionDailyMetricReportedWake({
      ...input.dailyMetric,
      eventId: reportId,
      memberId: authority.targetMemberId,
      occurredAt: now.toISOString(),
    });
    const append = await appendHostedMailboxEnvelopeTx({ envelope: wake, tx });
    if (append.dedupeConflict) {
      return unavailableDailyMetricAdmission("report_conflict");
    }
    return {
      mailboxWake: {
        expectedUserId: authority.targetMemberId,
        mailboxItemId: append.item.id,
      },
      result: { status: "accepted" },
    };
  });
}

function dailyMetricReportMatches(
  wake: HostedExecutionDailyMetricReportedWake,
  input: {
    dailyMetric: HostedExecutionDailyMetricReportedPayload;
    reportId: string;
    targetMemberId: string;
  },
): boolean {
  return wake.eventId === input.reportId
    && wake.userId === input.targetMemberId
    && wake.dailyMetric.date === input.dailyMetric.date
    && wake.dailyMetric.metric === input.dailyMetric.metric
    && wake.dailyMetric.unit === input.dailyMetric.unit
    && wake.dailyMetric.value === input.dailyMetric.value;
}

function unavailableDailyMetricAdmission(
  unavailableReason: string,
): HostedGroupCurrentSenderDailyMetricAdmission {
  return {
    mailboxWake: null,
    result: { status: "unavailable", unavailableReason },
  };
}

async function acquireCurrentSenderDailyMetricLockTx(
  tx: Prisma.TransactionClient,
  reportId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${CURRENT_SENDER_DAILY_METRIC_LOCK_NAMESPACE}),
      hashtext(${reportId})
    )
  `;
}

import "server-only";

import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionDailyMetricReportedWake,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionAssistantAskAcceptedInputOrigin,
  HostedExecutionDailyMetricReportedPayload,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRuntimeGroupDailyMetricReportResult,
} from "@murphai/hosted-execution/runtime-control";

import {
  appendHostedMailboxEnvelopeTx,
} from "../hosted-mailbox/store";
import { readHostedHealthDataConsentState } from "../legal/consent";
import { getPrisma } from "../prisma";
import {
  readHostedGroupCurrentSenderAuthorityTx,
} from "./group-current-sender-assistant-ask";

const CURRENT_SENDER_DAILY_METRIC_ID_NAMESPACE =
  "murph.hosted-group-current-sender-daily-metric.v1";

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
    const authority = await readHostedGroupCurrentSenderAuthorityTx({
      expectedGroupRuntimeMemberId: input.groupRuntimeMemberId,
      now,
      origin: input.origin,
      tx,
    });
    if (!authority) {
      return unavailableDailyMetricAdmission("current_sender_unavailable");
    }
    if (await readHostedHealthDataConsentState({
      memberId: authority.targetMemberId,
      prisma: tx,
    }) === "revoked") {
      return unavailableDailyMetricAdmission("health_data_consent_revoked");
    }

    const wake = buildHostedExecutionDailyMetricReportedWake({
      ...input.dailyMetric,
      eventId: reportId,
      memberId: authority.targetMemberId,
      occurredAt: authority.occurredAt,
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

function unavailableDailyMetricAdmission(
  unavailableReason: string,
): HostedGroupCurrentSenderDailyMetricAdmission {
  return {
    mailboxWake: null,
    result: { status: "unavailable", unavailableReason },
  };
}

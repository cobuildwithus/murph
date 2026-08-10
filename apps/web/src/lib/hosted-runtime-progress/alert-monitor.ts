import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { HOSTED_HEALTH_DATA_CONSENT_SCOPE } from "../legal/consent";
import { HOSTED_MAILBOX_RETENTION_MS } from "../hosted-mailbox/store";
import { activeHostedMemberAccessWhere } from "../hosted-onboarding/member-access";
import {
  runHostedOperationalEmailIncident,
  type HostedOperationalAlertMonitorOutcome,
  type HostedOperationalAlertMonitorSpec,
  type HostedOperationalAlertPrismaClient,
  type HostedOperationalAlertSend,
} from "../hosted-operational-alert/incident-email-monitor";
import {
  readHostedRuntimeLatencyAlertConfig,
} from "../hosted-runtime-latency/alert-monitor";
import { getPrisma } from "../prisma";

export const HOSTED_RUNTIME_PROGRESS_STALL_THRESHOLD_MS = 15 * 60_000;

const HOSTED_RUNTIME_PROGRESS_MONITOR_ID = "hosted-runtime-progress-monitor:v1";
const HOSTED_RUNTIME_PROGRESS_MONITOR_KIND = "hosted_runtime_progress_monitor";
const HOSTED_RUNTIME_PROGRESS_MONITOR_SCHEMA =
  "murph.hosted-runtime-progress-monitor.v1";
const HOSTED_RUNTIME_PROGRESS_MONITOR_SUBJECT =
  "Hosted runtime progress stalled";
const HOSTED_RUNTIME_PROGRESS_READ_LIMIT = 20_000;

const MONITOR_STATUS = {
  alertFailed: "progress_alert_failed",
  alertSending: "progress_alert_sending",
  alerting: "progress_alerting",
  healthy: "progress_healthy",
} as const;

type HostedRuntimeProgressPrismaClient =
  & Pick<PrismaClient, "$queryRaw" | "hostedMember">
  & HostedOperationalAlertPrismaClient;

export interface HostedRuntimeProgressHealthRow {
  headCreatedAt: Date;
  lane: string;
  pendingCount: bigint;
  runtimeKey: string;
  usageBlocked: boolean;
}

type HostedRuntimeProgressQueryRow = HostedRuntimeProgressHealthRow;

export interface HostedRuntimeProgressHealth {
  anomalous: boolean;
  excludedInactiveLaneCount: number;
  excludedUsageBlockedConversationLaneCount: number;
  invalidRowCount: number;
  oldestStalledAgeMs: number | null;
  pendingItemCount: number;
  scanTruncated: boolean;
  stalledConversationLaneCount: number;
  stalledLaneCount: number;
  stalledRuntimeCount: number;
  stalledSystemLaneCount: number;
  thresholdMs: number;
}

export type HostedRuntimeProgressAlertMonitorOutcome =
  | HostedOperationalAlertMonitorOutcome
  | "disabled";

export interface HostedRuntimeProgressAlertMonitorResult {
  configured: boolean;
  health: HostedRuntimeProgressHealth;
  outcome: HostedRuntimeProgressAlertMonitorOutcome;
}

const HOSTED_RUNTIME_PROGRESS_MONITOR_SPEC: HostedOperationalAlertMonitorSpec<
  HostedRuntimeProgressHealth,
  HostedRuntimeProgressPrismaClient
> = {
  buildDetails: buildHostedRuntimeProgressAlertDetails,
  buildMessage: buildHostedRuntimeProgressAlertMessage,
  error: {
    incidentInvalidCode: "HOSTED_RUNTIME_PROGRESS_ALERT_INCIDENT_INVALID",
    incidentInvalidMessage: "Hosted runtime progress alert incident is invalid.",
    messageInvalidCode: "HOSTED_RUNTIME_PROGRESS_ALERT_MESSAGE_INVALID",
    messageInvalidMessage: "Hosted runtime progress alert message is invalid.",
    sendFailedCode: "HOSTED_RUNTIME_PROGRESS_ALERT_SEND_FAILED",
    sendFailedMessage: "Hosted runtime progress alert send failed.",
    stateInvalidCode: "HOSTED_RUNTIME_PROGRESS_ALERT_STATE_INVALID",
    stateInvalidMessage: "Hosted runtime progress alert state is invalid.",
    unknownSendErrorCode: "UNKNOWN_RUNTIME_PROGRESS_ALERT_ERROR",
  },
  id: HOSTED_RUNTIME_PROGRESS_MONITOR_ID,
  idempotencyScope: "murph/runtime-progress",
  kind: HOSTED_RUNTIME_PROGRESS_MONITOR_KIND,
  readHealth: readHostedRuntimeProgressHealth,
  status: MONITOR_STATUS,
  subject: HOSTED_RUNTIME_PROGRESS_MONITOR_SUBJECT,
};

export async function runHostedRuntimeProgressAlertMonitor(input: {
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  prisma?: HostedRuntimeProgressPrismaClient;
  sendAlert?: HostedOperationalAlertSend;
  signal?: AbortSignal;
} = {}): Promise<HostedRuntimeProgressAlertMonitorResult> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const health = await readHostedRuntimeProgressHealth({ now, prisma });
  const alertConfig = readHostedRuntimeLatencyAlertConfig(
    input.env ?? process.env,
  );

  if (!alertConfig) {
    return {
      configured: false,
      health,
      outcome: "disabled",
    };
  }

  const result = await runHostedOperationalEmailIncident({
    alertConfig,
    initialHealth: health,
    initialNow: now,
    now: input.now,
    prisma,
    sendAlert: input.sendAlert,
    signal: input.signal,
    spec: HOSTED_RUNTIME_PROGRESS_MONITOR_SPEC,
  });

  return {
    configured: true,
    health: result.health,
    outcome: result.outcome,
  };
}

export async function readHostedRuntimeProgressHealth(input: {
  now?: Date;
  prisma?: Pick<PrismaClient, "$queryRaw" | "hostedMember">;
} = {}): Promise<HostedRuntimeProgressHealth> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const stalledBefore = new Date(
    now.getTime() - HOSTED_RUNTIME_PROGRESS_STALL_THRESHOLD_MS,
  );
  const retainedAfter = new Date(now.getTime() - HOSTED_MAILBOX_RETENTION_MS);
  const rows = await prisma.$queryRaw<HostedRuntimeProgressQueryRow[]>(Prisma.sql`
    WITH lane_boundary AS (
      SELECT
        lane_counter.user_id,
        lane_counter.lane,
        GREATEST(
          lane_counter.consumed_seq,
          oldest_live.lane_seq - 1::bigint
        ) AS effective_consumed_seq
      FROM hosted_mailbox_lane_counter AS lane_counter
      JOIN hosted_workspace AS workspace
        ON workspace.user_id = lane_counter.user_id
      JOIN LATERAL (
        SELECT mailbox_item.lane_seq
        FROM hosted_mailbox_item AS mailbox_item
        WHERE mailbox_item.user_id = lane_counter.user_id
          AND mailbox_item.lane = lane_counter.lane
          AND mailbox_item.created_at > ${retainedAfter}
          AND (
            mailbox_item.expires_at IS NULL
            OR mailbox_item.expires_at > ${now}
          )
        ORDER BY mailbox_item.lane_seq ASC
        LIMIT 1
      ) AS oldest_live ON TRUE
      WHERE lane_counter.next_seq - 1::bigint > lane_counter.consumed_seq
    ),
    lagging_lane AS (
      SELECT
        lane_boundary.user_id,
        lane_boundary.lane,
        pending_head.ai_usage_denied_at AS head_usage_denied_at,
        pending_head.created_at AS head_created_at,
        pending_head.id AS head_item_id,
        pending_head.pending_count
      FROM lane_boundary
      JOIN LATERAL (
        SELECT
          mailbox_item.ai_usage_denied_at,
          mailbox_item.created_at,
          mailbox_item.id,
          COUNT(*) OVER () AS pending_count
        FROM hosted_mailbox_item AS mailbox_item
        WHERE mailbox_item.user_id = lane_boundary.user_id
          AND mailbox_item.lane = lane_boundary.lane
          AND mailbox_item.lane_seq > lane_boundary.effective_consumed_seq
          AND mailbox_item.created_at > ${retainedAfter}
          AND (
            mailbox_item.expires_at IS NULL
            OR mailbox_item.expires_at > ${now}
          )
        ORDER BY mailbox_item.lane_seq ASC
        LIMIT 1
      ) AS pending_head ON TRUE
    )
    SELECT
      lagging_lane.user_id AS "runtimeKey",
      lagging_lane.lane,
      lagging_lane.head_created_at AS "headCreatedAt",
      lagging_lane.pending_count AS "pendingCount",
      (
        lagging_lane.lane = 'conversation'
        AND lagging_lane.head_usage_denied_at IS NOT NULL
        AND lagging_lane.head_usage_denied_at >= lagging_lane.head_created_at
        AND lagging_lane.head_usage_denied_at <= ${now}
        AND NOT COALESCE(
          trace.assistant_input_staged_at > lagging_lane.head_usage_denied_at
          OR trace.provider_start_at > lagging_lane.head_usage_denied_at
          OR delivery.accepted_at > lagging_lane.head_usage_denied_at,
          FALSE
        )
      ) AS "usageBlocked"
    FROM lagging_lane
    LEFT JOIN hosted_ingress_latency_trace AS trace
      ON trace.user_id = lagging_lane.user_id
      AND trace.mailbox_item_id = lagging_lane.head_item_id
    LEFT JOIN hosted_linq_delivery AS delivery
      ON delivery.id = trace.linq_delivery_id
    WHERE lagging_lane.head_created_at <= ${stalledBefore}
    ORDER BY lagging_lane.head_created_at ASC
    LIMIT ${HOSTED_RUNTIME_PROGRESS_READ_LIMIT + 1}
  `);
  const scanTruncated = rows.length > HOSTED_RUNTIME_PROGRESS_READ_LIMIT;
  const visibleRows = scanTruncated
    ? rows.slice(0, HOSTED_RUNTIME_PROGRESS_READ_LIMIT)
    : rows;
  const runtimeKeys = [...new Set(visibleRows.map((row) => row.runtimeKey))];
  const activeRows = runtimeKeys.length === 0
    ? []
    : await prisma.hostedMember.findMany({
        select: { id: true },
        where: {
          ...activeHostedMemberAccessWhere(),
          consentGrants: {
            none: {
              scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE,
              status: "revoked",
            },
          },
          id: { in: runtimeKeys },
        },
      });

  return summarizeHostedRuntimeProgressRows({
    activeRuntimeKeys: activeRows.map((row) => row.id),
    now,
    rows: visibleRows,
    scanTruncated,
  });
}

export function summarizeHostedRuntimeProgressRows(input: {
  activeRuntimeKeys: readonly string[];
  now: Date;
  rows: readonly HostedRuntimeProgressHealthRow[];
  scanTruncated?: boolean;
}): HostedRuntimeProgressHealth {
  const activeRuntimeKeys = new Set(input.activeRuntimeKeys);
  const stalledRuntimeKeys = new Set<string>();
  let excludedInactiveLaneCount = 0;
  let excludedUsageBlockedConversationLaneCount = 0;
  let invalidRowCount = 0;
  let oldestStalledAgeMs: number | null = null;
  let pendingItemCount = 0;
  let stalledConversationLaneCount = 0;
  let stalledLaneCount = 0;
  let stalledSystemLaneCount = 0;

  for (const row of input.rows) {
    if (!activeRuntimeKeys.has(row.runtimeKey)) {
      excludedInactiveLaneCount += 1;
      continue;
    }
    if (row.usageBlocked && row.lane === "conversation") {
      excludedUsageBlockedConversationLaneCount += 1;
      continue;
    }
    const headCreatedAtMs = row.headCreatedAt.getTime();
    if (
      !Number.isFinite(headCreatedAtMs)
      || headCreatedAtMs > input.now.getTime()
      || row.pendingCount <= 0n
      || (row.lane !== "conversation" && row.lane !== "system")
    ) {
      invalidRowCount += 1;
      continue;
    }
    if (
      input.now.getTime() - headCreatedAtMs
        < HOSTED_RUNTIME_PROGRESS_STALL_THRESHOLD_MS
    ) {
      continue;
    }

    stalledLaneCount += 1;
    stalledRuntimeKeys.add(row.runtimeKey);
    oldestStalledAgeMs = Math.max(
      oldestStalledAgeMs ?? 0,
      input.now.getTime() - headCreatedAtMs,
    );
    pendingItemCount = addBoundedCount(pendingItemCount, row.pendingCount);
    if (row.lane === "conversation") {
      stalledConversationLaneCount += 1;
    } else {
      stalledSystemLaneCount += 1;
    }
  }

  const scanTruncated = input.scanTruncated === true;
  return {
    anomalous: stalledLaneCount > 0 || invalidRowCount > 0 || scanTruncated,
    excludedInactiveLaneCount,
    excludedUsageBlockedConversationLaneCount,
    invalidRowCount,
    oldestStalledAgeMs,
    pendingItemCount,
    scanTruncated,
    stalledConversationLaneCount,
    stalledLaneCount,
    stalledRuntimeCount: stalledRuntimeKeys.size,
    stalledSystemLaneCount,
    thresholdMs: HOSTED_RUNTIME_PROGRESS_STALL_THRESHOLD_MS,
  };
}

function buildHostedRuntimeProgressAlertDetails(input: {
  health: HostedRuntimeProgressHealth;
  incidentId: string | null;
  message?: string | null;
  now: Date;
  phase: "alert" | "healthy";
}): Prisma.InputJsonObject {
  return {
    health: {
      excludedInactiveLaneCount: input.health.excludedInactiveLaneCount,
      excludedUsageBlockedConversationLaneCount:
        input.health.excludedUsageBlockedConversationLaneCount,
      invalidRowCount: input.health.invalidRowCount,
      oldestStalledAgeMs: input.health.oldestStalledAgeMs,
      pendingItemCount: input.health.pendingItemCount,
      scanTruncated: input.health.scanTruncated,
      stalledConversationLaneCount:
        input.health.stalledConversationLaneCount,
      stalledLaneCount: input.health.stalledLaneCount,
      stalledRuntimeCount: input.health.stalledRuntimeCount,
      stalledSystemLaneCount: input.health.stalledSystemLaneCount,
    },
    incidentId: input.incidentId,
    lastEvaluatedAt: input.now.toISOString(),
    message: input.message ?? null,
    phase: input.phase,
    schema: HOSTED_RUNTIME_PROGRESS_MONITOR_SCHEMA,
    thresholdMs: input.health.thresholdMs,
  };
}

function buildHostedRuntimeProgressAlertMessage(input: {
  health: HostedRuntimeProgressHealth;
  now: Date;
}): string {
  const evidence = [
    input.health.stalledRuntimeCount > 0
      ? `${input.health.stalledRuntimeCount} active ${pluralizeRuntime(input.health.stalledRuntimeCount)} have durable mailbox work that has remained beyond the clean-handling high-water for at least 15 minutes`
      : null,
    input.health.invalidRowCount > 0
      ? `${input.health.invalidRowCount} invalid mailbox progress ${pluralizeRow(input.health.invalidRowCount)}`
      : null,
    input.health.scanTruncated
      ? "the bounded mailbox progress scan was truncated"
      : null,
  ].filter((value): value is string => value !== null);
  const timing = [
    input.health.oldestStalledAgeMs !== null
      ? `Oldest stalled work: ${formatDuration(input.health.oldestStalledAgeMs)}`
      : null,
    input.health.stalledLaneCount > 0
      ? `Affected lanes: ${input.health.stalledSystemLaneCount} system, ${input.health.stalledConversationLaneCount} conversation`
      : null,
    input.health.pendingItemCount > 0
      ? `Pending live items: ${input.health.pendingItemCount}`
      : null,
  ].filter((value): value is string => value !== null);

  return [
    "Murph runtime progress alert.",
    `${evidence.join("; ")}.`,
    timing.length > 0 ? `${timing.join(". ")}.` : null,
    `Checked ${formatAlertTime(input.now)}.`,
  ].filter((value): value is string => value !== null).join(" ");
}

function addBoundedCount(current: number, addition: bigint): number {
  const remaining = BigInt(Number.MAX_SAFE_INTEGER - current);
  return addition >= remaining
    ? Number.MAX_SAFE_INTEGER
    : current + Number(addition);
}

function formatAlertTime(value: Date): string {
  return value.toISOString().replace(".000Z", "Z");
}

function formatDuration(valueMs: number): string {
  if (valueMs < 60_000) {
    return `${(valueMs / 1_000).toFixed(1)}s`;
  }
  if (valueMs < 60 * 60_000) {
    return `${(valueMs / 60_000).toFixed(1)}m`;
  }
  return `${(valueMs / (60 * 60_000)).toFixed(1)}h`;
}

function pluralizeRuntime(count: number): string {
  return count === 1 ? "runtime" : "runtimes";
}

function pluralizeRow(count: number): string {
  return count === 1 ? "row" : "rows";
}

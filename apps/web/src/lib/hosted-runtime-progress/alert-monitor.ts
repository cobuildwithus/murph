import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { HOSTED_MAILBOX_RETENTION_MS } from "../hosted-mailbox/store";
import {
  readHostedRuntimeAiAllowedMemberIds,
} from "../hosted-onboarding/member-access";
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
export const HOSTED_RUNTIME_PROGRESS_REMINDER_INTERVAL_MS = 6 * 60 * 60_000;

const HOSTED_RUNTIME_PROGRESS_MONITOR_ID = "hosted-runtime-progress-monitor:v1";
const HOSTED_RUNTIME_PROGRESS_MONITOR_KIND = "hosted_runtime_progress_monitor";
const HOSTED_RUNTIME_PROGRESS_MONITOR_SCHEMA =
  "murph.hosted-runtime-progress-monitor.v1";
const HOSTED_RUNTIME_PROGRESS_MONITOR_SUBJECT =
  "Hosted runtime progress stalled";
const HOSTED_RUNTIME_PROGRESS_READ_LIMIT = 20_000;
const HOSTED_RUNTIME_PROGRESS_READ_PAGE_SIZE = 500;

const MONITOR_STATUS = {
  alertFailed: "progress_alert_failed",
  alertSending: "progress_alert_sending",
  alerting: "progress_alerting",
  healthy: "progress_healthy",
} as const;

type HostedRuntimeProgressPrismaClient =
  & Pick<
    PrismaClient,
    "$queryRaw" | "hostedMember" | "hostedThreadContainerParticipant"
  >
  & HostedOperationalAlertPrismaClient;

export interface HostedRuntimeProgressHealthRow {
  chronologyInvalid: boolean;
  lane: string;
  pendingCount: bigint;
  progressOriginAt: Date;
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
  reminderIntervalMs: HOSTED_RUNTIME_PROGRESS_REMINDER_INTERVAL_MS,
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
  prisma?: Pick<
    PrismaClient,
    "$queryRaw" | "hostedMember" | "hostedThreadContainerParticipant"
  >;
} = {}): Promise<HostedRuntimeProgressHealth> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const stalledBefore = new Date(
    now.getTime() - HOSTED_RUNTIME_PROGRESS_STALL_THRESHOLD_MS,
  );
  const retainedAfter = new Date(now.getTime() - HOSTED_MAILBOX_RETENTION_MS);
  const alertableRows: HostedRuntimeProgressQueryRow[] = [];
  let cursor: HostedRuntimeProgressReadCursor | null = null;
  let candidateRowCount = 0;
  let excludedInactiveLaneCount = 0;
  let excludedUsageBlockedConversationLaneCount = 0;

  while (candidateRowCount <= HOSTED_RUNTIME_PROGRESS_READ_LIMIT) {
    const pageLimit = Math.min(
      HOSTED_RUNTIME_PROGRESS_READ_PAGE_SIZE,
      HOSTED_RUNTIME_PROGRESS_READ_LIMIT + 1 - candidateRowCount,
    );
    const page = await readHostedRuntimeProgressCandidatePage({
      cursor,
      limit: pageLimit,
      now,
      prisma,
      retainedAfter,
      stalledBefore,
    });
    if (page.length === 0) {
      break;
    }

    const remainingVisibleCandidateCount = Math.max(
      0,
      HOSTED_RUNTIME_PROGRESS_READ_LIMIT - candidateRowCount,
    );
    const visiblePage = page.slice(0, remainingVisibleCandidateCount);
    candidateRowCount += page.length;

    const allowedRuntimeKeys = visiblePage.length === 0
      ? new Set<string>()
      : await readHostedRuntimeAiAllowedMemberIds({
          memberIds: [...new Set(visiblePage.map((row) => row.runtimeKey))],
          now,
          prisma,
        });
    for (const row of visiblePage) {
      if (!allowedRuntimeKeys.has(row.runtimeKey)) {
        excludedInactiveLaneCount += 1;
        continue;
      }
      if (row.usageBlocked && row.lane === "conversation") {
        excludedUsageBlockedConversationLaneCount += 1;
        continue;
      }
      alertableRows.push(row);
    }

    const last = page.at(-1);
    if (!last) {
      break;
    }
    cursor = {
      lane: last.lane,
      progressOriginAt: last.progressOriginAt,
      runtimeKey: last.runtimeKey,
    };
    if (
      candidateRowCount > HOSTED_RUNTIME_PROGRESS_READ_LIMIT
      || page.length < pageLimit
    ) {
      break;
    }
  }

  const scanTruncated =
    candidateRowCount > HOSTED_RUNTIME_PROGRESS_READ_LIMIT;
  return summarizeHostedRuntimeProgressRows({
    activeRuntimeKeys: [...new Set(alertableRows.map((row) => row.runtimeKey))],
    excludedInactiveLaneCount,
    excludedUsageBlockedConversationLaneCount,
    now,
    rows: alertableRows,
    scanTruncated,
  });
}

interface HostedRuntimeProgressReadCursor {
  lane: string;
  progressOriginAt: Date;
  runtimeKey: string;
}

async function readHostedRuntimeProgressCandidatePage(input: {
  cursor: HostedRuntimeProgressReadCursor | null;
  limit: number;
  now: Date;
  prisma: Pick<PrismaClient, "$queryRaw">;
  retainedAfter: Date;
  stalledBefore: Date;
}): Promise<HostedRuntimeProgressQueryRow[]> {
  const cursorWhere = input.cursor === null
    ? Prisma.empty
    : Prisma.sql`
        AND (
          progress_lane.progress_origin_at,
          progress_lane.user_id,
          progress_lane.lane
        ) > (
          ${input.cursor.progressOriginAt},
          ${input.cursor.runtimeKey},
          ${input.cursor.lane}
        )
      `;
  return await input.prisma.$queryRaw<HostedRuntimeProgressQueryRow[]>(Prisma.sql`
    WITH lane_boundary AS (
      SELECT
        lane_counter.user_id,
        lane_counter.lane,
        GREATEST(
          lane_counter.consumed_seq,
          oldest_live.lane_seq - 1::bigint
        ) AS effective_consumed_seq
      FROM hosted_mailbox_lane_counter AS lane_counter
      JOIN LATERAL (
        SELECT mailbox_item.lane_seq
        FROM hosted_mailbox_item AS mailbox_item
        WHERE mailbox_item.user_id = lane_counter.user_id
          AND mailbox_item.lane = lane_counter.lane
          AND mailbox_item.created_at > ${input.retainedAfter}
          AND (
            mailbox_item.expires_at IS NULL
            OR mailbox_item.expires_at > ${input.now}
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
          AND (
            lane_boundary.lane <> 'conversation'
            OR mailbox_item.consumed_at IS NULL
          )
          AND mailbox_item.created_at > ${input.retainedAfter}
          AND (
            mailbox_item.expires_at IS NULL
            OR mailbox_item.expires_at > ${input.now}
          )
        ORDER BY mailbox_item.lane_seq ASC
        LIMIT 1
      ) AS pending_head ON TRUE
    ),
    progress_evidence AS (
      SELECT
        lagging_lane.*,
        evidence.first_post_denial_at,
        COALESCE(evidence.has_future_evidence, FALSE) AS has_future_evidence,
        COALESCE(
          evidence.has_pre_denial_evidence,
          FALSE
        ) AS has_pre_denial_evidence
      FROM lagging_lane
      LEFT JOIN hosted_ingress_latency_trace AS trace
        ON trace.user_id = lagging_lane.user_id
        AND trace.mailbox_item_id = lagging_lane.head_item_id
      LEFT JOIN hosted_linq_delivery AS delivery
        ON delivery.id = trace.linq_delivery_id
      LEFT JOIN LATERAL (
        SELECT
          MIN(execution_evidence.at) FILTER (
            WHERE execution_evidence.at > lagging_lane.head_usage_denied_at
              AND execution_evidence.at <= ${input.now}
          ) AS first_post_denial_at,
          COALESCE(
            BOOL_OR(execution_evidence.at > ${input.now}),
            FALSE
          ) AS has_future_evidence,
          COALESCE(
            BOOL_OR(
              execution_evidence.at <= lagging_lane.head_usage_denied_at
            ),
            FALSE
          ) AS has_pre_denial_evidence
        FROM (
          VALUES
            (trace.assistant_input_staged_at),
            (trace.provider_start_at),
            (delivery.accepted_at)
        ) AS execution_evidence(at)
        WHERE execution_evidence.at IS NOT NULL
      ) AS evidence ON TRUE
    ),
    progress_lane AS (
      SELECT
        progress_evidence.user_id,
        progress_evidence.lane,
        progress_evidence.pending_count,
        CASE
          WHEN progress_evidence.lane = 'conversation'
            AND progress_evidence.head_usage_denied_at IS NOT NULL
            AND progress_evidence.head_usage_denied_at
              >= progress_evidence.head_created_at
            AND progress_evidence.head_usage_denied_at <= ${input.now}
            AND NOT progress_evidence.has_pre_denial_evidence
            AND progress_evidence.first_post_denial_at IS NOT NULL
            THEN progress_evidence.first_post_denial_at
          ELSE progress_evidence.head_created_at
        END AS progress_origin_at,
        (
          progress_evidence.lane = 'conversation'
          AND progress_evidence.head_usage_denied_at IS NOT NULL
          AND (
            progress_evidence.head_usage_denied_at
              < progress_evidence.head_created_at
            OR progress_evidence.head_usage_denied_at > ${input.now}
            OR progress_evidence.has_future_evidence
          )
        ) AS chronology_invalid,
        (
          progress_evidence.lane = 'conversation'
          AND progress_evidence.head_usage_denied_at IS NOT NULL
          AND progress_evidence.head_usage_denied_at
            >= progress_evidence.head_created_at
          AND progress_evidence.head_usage_denied_at <= ${input.now}
          AND NOT progress_evidence.has_pre_denial_evidence
          AND progress_evidence.first_post_denial_at IS NULL
          AND NOT progress_evidence.has_future_evidence
        ) AS usage_blocked
      FROM progress_evidence
    )
    SELECT
      progress_lane.chronology_invalid AS "chronologyInvalid",
      progress_lane.lane,
      progress_lane.pending_count AS "pendingCount",
      progress_lane.progress_origin_at AS "progressOriginAt",
      progress_lane.user_id AS "runtimeKey",
      progress_lane.usage_blocked AS "usageBlocked"
    FROM progress_lane
    WHERE (
      progress_lane.chronology_invalid
      OR progress_lane.usage_blocked
      OR progress_lane.progress_origin_at <= ${input.stalledBefore}
    )
    ${cursorWhere}
    ORDER BY
      progress_lane.progress_origin_at ASC,
      progress_lane.user_id ASC,
      progress_lane.lane ASC
    LIMIT ${input.limit}
  `);
}

export function summarizeHostedRuntimeProgressRows(input: {
  activeRuntimeKeys: readonly string[];
  excludedInactiveLaneCount?: number;
  excludedUsageBlockedConversationLaneCount?: number;
  now: Date;
  rows: readonly HostedRuntimeProgressHealthRow[];
  scanTruncated?: boolean;
}): HostedRuntimeProgressHealth {
  const activeRuntimeKeys = new Set(input.activeRuntimeKeys);
  const stalledRuntimeKeys = new Set<string>();
  let excludedInactiveLaneCount = input.excludedInactiveLaneCount ?? 0;
  let excludedUsageBlockedConversationLaneCount =
    input.excludedUsageBlockedConversationLaneCount ?? 0;
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
    if (row.chronologyInvalid) {
      invalidRowCount += 1;
      continue;
    }
    if (row.usageBlocked && row.lane === "conversation") {
      excludedUsageBlockedConversationLaneCount += 1;
      continue;
    }
    const progressOriginAtMs = row.progressOriginAt.getTime();
    if (
      !Number.isFinite(progressOriginAtMs)
      || progressOriginAtMs > input.now.getTime()
      || row.pendingCount <= 0n
      || (row.lane !== "conversation" && row.lane !== "system")
    ) {
      invalidRowCount += 1;
      continue;
    }
    if (
      input.now.getTime() - progressOriginAtMs
        < HOSTED_RUNTIME_PROGRESS_STALL_THRESHOLD_MS
    ) {
      continue;
    }

    stalledLaneCount += 1;
    stalledRuntimeKeys.add(row.runtimeKey);
    oldestStalledAgeMs = Math.max(
      oldestStalledAgeMs ?? 0,
      input.now.getTime() - progressOriginAtMs,
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
  notificationKind: "alert" | "reminder";
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
    input.notificationKind === "reminder"
      ? "Murph runtime progress reminder."
      : "Murph runtime progress alert.",
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

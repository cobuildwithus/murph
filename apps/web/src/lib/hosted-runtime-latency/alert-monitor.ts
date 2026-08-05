import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  formatTimeZoneDateTimeParts,
  normalizeIanaTimeZone,
} from "@murphai/contracts";
import { Prisma, type HostedLinqAlert, type PrismaClient } from "@prisma/client";

import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import {
  readHostedOperationalAlertEmailConfig,
  type HostedOperationalAlertEmailConfig,
} from "../hosted-onboarding/operational-alert-email-config";
import {
  HostedResendPlainTextEmailError,
  sendHostedResendPlainTextEmail,
} from "../hosted-onboarding/resend-plain-text-email";
import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";

export const HOSTED_RUNTIME_REPLY_LATENCY_ALERT_THRESHOLD_MS = 30_000;
export const HOSTED_RUNTIME_LATENCY_ALERT_MINIMUM_INTERVAL_MS = 10 * 60_000;

const HOSTED_RUNTIME_LATENCY_MONITOR_ID = "hosted-runtime-latency-monitor:v1";
const HOSTED_RUNTIME_LATENCY_MONITOR_KIND = "hosted_runtime_latency_monitor";
const HOSTED_RUNTIME_LATENCY_MONITOR_SUBJECT = "Hosted runtime reply latency";
const HOSTED_RUNTIME_LATENCY_MONITOR_SCHEMA = "murph.hosted-runtime-latency-monitor.v3";
const HOSTED_RUNTIME_LATENCY_COMPLETED_WINDOW_MS = 10 * 60_000;
const HOSTED_RUNTIME_LATENCY_UNRESOLVED_WINDOW_MS = 24 * 60 * 60_000;
const HOSTED_RUNTIME_LATENCY_READ_LIMIT = 20_000;
const HOSTED_RUNTIME_LATENCY_ALERT_JITTER_WINDOW_MS = 10 * 60_000;
const HOSTED_RUNTIME_LATENCY_SEND_LEASE_MS = 4 * 60_000;
const HOSTED_RUNTIME_LATENCY_QUIET_HOURS_END_HOUR = 7;
const HOSTED_RUNTIME_LATENCY_QUIET_HOURS_START_HOUR = 23;

const MONITOR_STATUS = {
  alertFailed: "latency_alert_failed",
  alertSending: "latency_alert_sending",
  alerting: "latency_alerting",
  healthy: "latency_healthy",
} as const;

type HostedRuntimeLatencyMonitorStatus =
  (typeof MONITOR_STATUS)[keyof typeof MONITOR_STATUS];

type HostedRuntimeLatencyPrismaClient = Pick<
  PrismaClient,
  "$queryRaw" | "hostedLinqAlert"
>;

type HostedRuntimeLatencySend = typeof sendHostedResendPlainTextEmail;

export interface HostedRuntimeLatencyHealthRow {
  acceptedAt: Date;
  checkpointPublicationExpectedBy: Date | null;
  consumedAt: Date | null;
  deliveryAcceptedAt: Date | null;
  linqDeliveryId: string | null;
  progressUpdateAcceptedAt: Date | null;
  providerRequestOrdinal: number | null;
  providerStartAt: Date | null;
  runtimeAttemptId: string | null;
  terminalNonReplyCommittedAt: Date | null;
  usageDenialChronologyInvalid: boolean;
}

export interface HostedRuntimeLatencyHealth {
  anomalous: boolean;
  invalidChronologyCount: number;
  maxFirstVisibleResponseLatencyMs: number | null;
  oldestUnresolvedAgeMs: number | null;
  recentCompletedReplyCount: number;
  recentSlowInitialResponseCount: number;
  recentSlowPreProviderDominantCount: number;
  recentSlowProviderExecutionDominantCount: number;
  recentSlowUnknownBoundaryCount: number;
  scanTruncated: boolean;
  thresholdMs: number;
  unresolvedCheckpointAcknowledgementCount: number;
  unresolvedMissingTerminalEvidenceCount: number;
  unresolvedReplyCount: number;
  windowMinutes: number;
}

interface HostedRuntimeLatencyQueryRow {
  acceptedAt: Date;
  consumedAt: Date | null;
  deliveryAcceptedAt: Date | null;
  linqDeliveryId: string | null;
  phaseBreakdownJson: unknown;
  providerRequestOrdinal: number | null;
  providerStartAt: Date | null;
  runtimeAttemptId: string | null;
  usageDenialChronologyInvalid: boolean;
}

export type HostedRuntimeLatencyAlertMonitorOutcome =
  | "alert_sent"
  | "coalesced"
  | "deferred_quiet_hours"
  | "deferred_rate_limit"
  | "disabled"
  | "healthy"
  | "incident_active";

export interface HostedRuntimeLatencyAlertMonitorResult {
  configured: boolean;
  health: HostedRuntimeLatencyHealth;
  outcome: HostedRuntimeLatencyAlertMonitorOutcome;
}

export async function runHostedRuntimeLatencyAlertMonitor(input: {
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  prisma?: HostedRuntimeLatencyPrismaClient;
  sendAlert?: HostedRuntimeLatencySend;
  signal?: AbortSignal;
} = {}): Promise<HostedRuntimeLatencyAlertMonitorResult> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const health = await readHostedRuntimeLatencyHealth({
    now,
    prisma,
  });
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

  const state = await ensureHostedRuntimeLatencyMonitorState({
    health,
    now,
    prisma,
  });
  const transition = await prepareHostedRuntimeLatencyAlertTransition({
    health,
    now,
    prisma,
    state,
    timeZone: alertConfig.timeZone,
  });

  if (!transition.candidateState) {
    return {
      configured: true,
      health,
      outcome: transition.outcome,
    };
  }

  const admission = await claimHostedRuntimeLatencyAlertSend({
    now: input.now,
    prisma,
    state: transition.candidateState,
    timeZone: alertConfig.timeZone,
  });
  if (!admission.action) {
    return {
      configured: true,
      health: admission.health,
      outcome: admission.outcome,
    };
  }

  const sendAlert = input.sendAlert ?? sendHostedResendPlainTextEmail;
  const action = admission.action;
  try {
    const sent = await sendAlert({
      config: alertConfig.email.resend,
      idempotencyKey: buildHostedRuntimeLatencyAlertIdempotencyKey(action),
      signal: input.signal,
      subject: HOSTED_RUNTIME_LATENCY_MONITOR_SUBJECT,
      text: action.message,
      to: alertConfig.email.recipients,
    });
    await completeHostedRuntimeLatencyAlertTransition({
      attemptedAt: action.attemptedAt,
      completedAt: input.now ?? new Date(),
      prisma,
      providerMessageId: sent.providerMessageId,
    });
  } catch (error) {
    const failure = readHostedRuntimeLatencyAlertFailure(error);
    await failHostedRuntimeLatencyAlertTransition({
      attemptedAt: action.attemptedAt,
      errorCode: failure.errorCode,
      prisma,
      providerStatus: failure.providerStatus,
    });
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_LATENCY_ALERT_SEND_FAILED",
      httpStatus: 502,
      message: "Hosted runtime latency alert send failed.",
      retryable: true,
    });
  }

  return {
    configured: true,
    health: admission.health,
    outcome: "alert_sent",
  };
}

export async function readHostedRuntimeLatencyHealth(input: {
  now?: Date;
  prisma?: Pick<PrismaClient, "$queryRaw">;
} = {}): Promise<HostedRuntimeLatencyHealth> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const windowStart = new Date(
    now.getTime() - HOSTED_RUNTIME_LATENCY_UNRESOLVED_WINDOW_MS,
  );
  const rows = await prisma.$queryRaw<HostedRuntimeLatencyQueryRow[]>(Prisma.sql`
    WITH latency_candidates AS (
      SELECT
        CASE
          WHEN mailbox_item.ai_usage_denied_at IS NULL
            OR mailbox_item.ai_usage_denied_at < trace.accepted_at
            OR mailbox_item.ai_usage_denied_at > ${now}
            OR execution.has_future_evidence
            OR execution.has_pre_denial_evidence
            THEN trace.accepted_at
          ELSE execution.first_evidence_at
        END AS latency_origin_at,
        (
          mailbox_item.ai_usage_denied_at IS NOT NULL
          AND (
            mailbox_item.ai_usage_denied_at < trace.accepted_at
            OR mailbox_item.ai_usage_denied_at > ${now}
            OR execution.has_future_evidence
          )
        ) AS usage_denial_chronology_invalid,
        mailbox_item.consumed_at,
        delivery.accepted_at AS delivery_accepted_at,
        trace.linq_delivery_id,
        trace.phase_breakdown_json,
        trace.provider_request_ordinal,
        trace.provider_start_at,
        trace.runtime_attempt_id
      FROM hosted_ingress_latency_trace AS trace
      JOIN hosted_mailbox_item AS mailbox_item
        ON mailbox_item.user_id = trace.user_id
        AND mailbox_item.id = trace.mailbox_item_id
      LEFT JOIN hosted_linq_delivery AS delivery
        ON delivery.id = trace.linq_delivery_id
      LEFT JOIN LATERAL (
        SELECT
          MIN(evidence.at) AS first_evidence_at,
          COALESCE(
            BOOL_OR(evidence.at <= mailbox_item.ai_usage_denied_at),
            FALSE
          ) AS has_pre_denial_evidence,
          COALESCE(BOOL_OR(evidence.at > ${now}), FALSE) AS has_future_evidence
        FROM (
          VALUES
            (trace.assistant_input_staged_at),
            (trace.provider_start_at),
            (delivery.accepted_at),
            (mailbox_item.consumed_at)
        ) AS evidence(at)
        WHERE evidence.at IS NOT NULL
      ) AS execution ON TRUE
      WHERE trace.source = 'linq'
        AND (
          trace.accepted_at >= ${windowStart}
          OR trace.assistant_input_staged_at >= ${windowStart}
          OR trace.provider_start_at >= ${windowStart}
          OR delivery.accepted_at >= ${windowStart}
          OR mailbox_item.consumed_at >= ${windowStart}
        )
    )
    SELECT
      latency_origin_at AS "acceptedAt",
      consumed_at AS "consumedAt",
      delivery_accepted_at AS "deliveryAcceptedAt",
      linq_delivery_id AS "linqDeliveryId",
      phase_breakdown_json AS "phaseBreakdownJson",
      provider_request_ordinal AS "providerRequestOrdinal",
      provider_start_at AS "providerStartAt",
      runtime_attempt_id AS "runtimeAttemptId",
      usage_denial_chronology_invalid AS "usageDenialChronologyInvalid"
    FROM latency_candidates
    WHERE latency_origin_at >= ${windowStart}
      AND latency_origin_at <= ${now}
    ORDER BY latency_origin_at DESC
    LIMIT ${HOSTED_RUNTIME_LATENCY_READ_LIMIT + 1}
  `);
  const scanTruncated = rows.length > HOSTED_RUNTIME_LATENCY_READ_LIMIT;
  const visibleRows = scanTruncated
    ? rows.slice(0, HOSTED_RUNTIME_LATENCY_READ_LIMIT)
    : rows;

  return summarizeHostedRuntimeLatencyRows({
    now,
    rows: visibleRows.map((row) => ({
      acceptedAt: row.acceptedAt,
      checkpointPublicationExpectedBy:
        readHostedRuntimeCheckpointPublicationExpectedBy(row.phaseBreakdownJson),
      consumedAt: row.consumedAt,
      deliveryAcceptedAt: row.deliveryAcceptedAt,
      linqDeliveryId: row.linqDeliveryId,
      progressUpdateAcceptedAt:
        readHostedRuntimeProgressUpdateAcceptedAt(row.phaseBreakdownJson),
      providerRequestOrdinal: row.providerRequestOrdinal,
      providerStartAt: row.providerStartAt,
      runtimeAttemptId: row.runtimeAttemptId,
      terminalNonReplyCommittedAt:
        readHostedRuntimeTerminalNonReplyCommittedAt(row.phaseBreakdownJson),
      usageDenialChronologyInvalid: row.usageDenialChronologyInvalid,
    })),
    scanTruncated,
  });
}

export function summarizeHostedRuntimeLatencyRows(input: {
  now: Date;
  rows: readonly HostedRuntimeLatencyHealthRow[];
  scanTruncated?: boolean;
}): HostedRuntimeLatencyHealth {
  const nowMs = input.now.getTime();
  const completedWindowStartMs = nowMs - HOSTED_RUNTIME_LATENCY_COMPLETED_WINDOW_MS;
  let invalidChronologyCount = input.rows.filter(
    (row) => row.usageDenialChronologyInvalid,
  ).length;
  let maxFirstVisibleResponseLatencyMs: number | null = null;
  let oldestUnresolvedAgeMs: number | null = null;
  let recentCompletedReplyCount = 0;
  let recentSlowInitialResponseCount = 0;
  let recentSlowPreProviderDominantCount = 0;
  let recentSlowProviderExecutionDominantCount = 0;
  let recentSlowUnknownBoundaryCount = 0;
  let unresolvedCheckpointAcknowledgementCount = 0;
  let unresolvedMissingTerminalEvidenceCount = 0;
  let unresolvedReplyCount = 0;

  const groupedRows = new Map<string, HostedRuntimeLatencyHealthRow[]>();
  input.rows.forEach((row, index) => {
    const deliveryId = row.linqDeliveryId?.trim() ?? "";
    const runtimeAttemptId = row.runtimeAttemptId?.trim() ?? "";
    const providerStartAtMs = row.providerStartAt?.getTime() ?? Number.NaN;
    const groupKey = deliveryId
      ? `delivery:${deliveryId}`
      : runtimeAttemptId
        && row.providerRequestOrdinal !== null
        && Number.isFinite(providerStartAtMs)
        ? `provider:${runtimeAttemptId}:${row.providerRequestOrdinal}:${providerStartAtMs}`
        : `row:${index}`;
    const rows = groupedRows.get(groupKey) ?? [];
    rows.push(row);
    groupedRows.set(groupKey, rows);
  });

  for (const rows of groupedRows.values()) {
    const acceptedAtMs = Math.min(...rows.map((row) => row.acceptedAt.getTime()));
    const deliveryAcceptedAtValues = [
      ...new Set(rows
        .map((row) => row.deliveryAcceptedAt?.getTime() ?? null)
        .filter((value): value is number => value !== null)),
    ];
    if (deliveryAcceptedAtValues.length > 1) {
      invalidChronologyCount += 1;
      continue;
    }
    const deliveryAcceptedAtMs = deliveryAcceptedAtValues[0] ?? null;
    const validProgressAcceptedAtValues = [
      ...new Set(rows
        .map((row) => row.progressUpdateAcceptedAt?.getTime() ?? null)
        .filter((value): value is number => {
          if (value === null) {
            return false;
          }
          if (value < acceptedAtMs || value > nowMs) {
            invalidChronologyCount += 1;
            return false;
          }
          return true;
        })),
    ];
    const progressUpdateAcceptedAtMs = validProgressAcceptedAtValues.length > 0
      ? Math.min(...validProgressAcceptedAtValues)
      : null;

    if (deliveryAcceptedAtMs !== null) {
      if (
        rows.some((row) => deliveryAcceptedAtMs < row.acceptedAt.getTime())
        || deliveryAcceptedAtMs > nowMs
      ) {
        invalidChronologyCount += 1;
        continue;
      }
      if (deliveryAcceptedAtMs < completedWindowStartMs) {
        continue;
      }

      const firstVisibleResponseAtMs = Math.min(
        deliveryAcceptedAtMs,
        progressUpdateAcceptedAtMs ?? deliveryAcceptedAtMs,
      );
      const latencyMs = firstVisibleResponseAtMs - acceptedAtMs;
      recentCompletedReplyCount += 1;
      if (latencyMs >= HOSTED_RUNTIME_REPLY_LATENCY_ALERT_THRESHOLD_MS) {
        recentSlowInitialResponseCount += 1;
        maxFirstVisibleResponseLatencyMs = Math.max(
          maxFirstVisibleResponseLatencyMs ?? 0,
          latencyMs,
        );
        const providerStartAtValues = [
          ...new Set(rows
            .map((row) => row.providerStartAt?.getTime() ?? null)
            .filter((value): value is number => value !== null)),
        ];
        const providerStartAtMs = providerStartAtValues[0] ?? null;
        if (providerStartAtValues.length === 0) {
          recentSlowUnknownBoundaryCount += 1;
        } else if (
          providerStartAtValues.length !== 1
          || providerStartAtMs === null
          || providerStartAtMs < acceptedAtMs
          || providerStartAtMs > firstVisibleResponseAtMs
        ) {
          invalidChronologyCount += 1;
          recentSlowUnknownBoundaryCount += 1;
        } else if (
          firstVisibleResponseAtMs - providerStartAtMs
          >= providerStartAtMs - acceptedAtMs
        ) {
          recentSlowProviderExecutionDominantCount += 1;
        } else {
          recentSlowPreProviderDominantCount += 1;
        }
      }
      continue;
    }

    let groupOldestUnresolvedAgeMs: number | null = null;
    let groupHasUnacknowledgedTerminalNonReply = false;
    for (const row of rows) {
      const rowAcceptedAtMs = row.acceptedAt.getTime();
      const checkpointPublicationExpectedByMs =
        row.checkpointPublicationExpectedBy?.getTime() ?? null;
      const terminalNonReplyCommittedAtMs =
        row.terminalNonReplyCommittedAt?.getTime() ?? null;
      let rowHasValidTerminalNonReply = false;

      if (terminalNonReplyCommittedAtMs !== null) {
        if (
          terminalNonReplyCommittedAtMs < rowAcceptedAtMs
          || terminalNonReplyCommittedAtMs > nowMs
        ) {
          invalidChronologyCount += 1;
        } else {
          rowHasValidTerminalNonReply = true;
          if (
            checkpointPublicationExpectedByMs !== null
            && checkpointPublicationExpectedByMs >= terminalNonReplyCommittedAtMs
            && nowMs <= checkpointPublicationExpectedByMs
          ) {
            // The runtime refreshes this expectation whenever later dirty work
            // restarts the idle checkpoint window. A crashed runtime stops
            // refreshing it, so the row becomes unresolved after the last
            // published expectation instead of being hidden indefinitely.
            continue;
          }
          if (
            checkpointPublicationExpectedByMs !== null
            && checkpointPublicationExpectedByMs < terminalNonReplyCommittedAtMs
          ) {
            invalidChronologyCount += 1;
          }
        }
      }

      const ageMs = nowMs - rowAcceptedAtMs;
      if (
        ageMs >= HOSTED_RUNTIME_REPLY_LATENCY_ALERT_THRESHOLD_MS
        && row.consumedAt === null
      ) {
        groupHasUnacknowledgedTerminalNonReply ||= rowHasValidTerminalNonReply;
        groupOldestUnresolvedAgeMs = Math.max(
          groupOldestUnresolvedAgeMs ?? 0,
          ageMs,
        );
      }
    }

    const earlyProgressAccepted =
      progressUpdateAcceptedAtMs !== null
      && progressUpdateAcceptedAtMs - acceptedAtMs
        < HOSTED_RUNTIME_REPLY_LATENCY_ALERT_THRESHOLD_MS;
    if (groupOldestUnresolvedAgeMs !== null && !earlyProgressAccepted) {
      unresolvedReplyCount += 1;
      if (groupHasUnacknowledgedTerminalNonReply) {
        unresolvedCheckpointAcknowledgementCount += 1;
      } else {
        unresolvedMissingTerminalEvidenceCount += 1;
      }
      oldestUnresolvedAgeMs = Math.max(
        oldestUnresolvedAgeMs ?? 0,
        groupOldestUnresolvedAgeMs,
      );
    }
  }

  const scanTruncated = input.scanTruncated === true;
  return {
    anomalous:
      recentSlowInitialResponseCount > 0
      || unresolvedReplyCount > 0
      || scanTruncated,
    invalidChronologyCount,
    maxFirstVisibleResponseLatencyMs,
    oldestUnresolvedAgeMs,
    recentCompletedReplyCount,
    recentSlowInitialResponseCount,
    recentSlowPreProviderDominantCount,
    recentSlowProviderExecutionDominantCount,
    recentSlowUnknownBoundaryCount,
    scanTruncated,
    thresholdMs: HOSTED_RUNTIME_REPLY_LATENCY_ALERT_THRESHOLD_MS,
    unresolvedCheckpointAcknowledgementCount,
    unresolvedMissingTerminalEvidenceCount,
    unresolvedReplyCount,
    windowMinutes: HOSTED_RUNTIME_LATENCY_COMPLETED_WINDOW_MS / 60_000,
  };
}

function readHostedRuntimeTerminalNonReplyCommittedAt(value: unknown): Date | null {
  return readHostedRuntimeAssistantEpochDate(
    value,
    "terminalNonReplyCommittedAtEpochMs",
  );
}

function readHostedRuntimeProgressUpdateAcceptedAt(value: unknown): Date | null {
  return readHostedRuntimeAssistantEpochDate(
    value,
    "progressUpdateAcceptedAtEpochMs",
  );
}

function readHostedRuntimeCheckpointPublicationExpectedBy(
  value: unknown,
): Date | null {
  return readHostedRuntimeAssistantEpochDate(
    value,
    "checkpointPublicationExpectedByEpochMs",
  );
}

function readHostedRuntimeAssistantEpochDate(
  value: unknown,
  leaf:
    | "checkpointPublicationExpectedByEpochMs"
    | "progressUpdateAcceptedAtEpochMs"
    | "terminalNonReplyCommittedAtEpochMs",
): Date | null {
  if (!isHostedRuntimeLatencyPhaseRecord(value)) {
    return null;
  }
  const assistant = value.assistant;
  if (!isHostedRuntimeLatencyPhaseRecord(assistant)) {
    return null;
  }
  const epochMs = assistant[leaf];
  if (
    typeof epochMs !== "number"
    || !Number.isSafeInteger(epochMs)
    || epochMs < 0
  ) {
    return null;
  }
  const recordedAt = new Date(epochMs);
  return Number.isFinite(recordedAt.getTime()) ? recordedAt : null;
}

function isHostedRuntimeLatencyPhaseRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function ensureHostedRuntimeLatencyMonitorState(input: {
  health: HostedRuntimeLatencyHealth;
  now: Date;
  prisma: HostedRuntimeLatencyPrismaClient;
}): Promise<HostedLinqAlert> {
  const state = await input.prisma.hostedLinqAlert.upsert({
    where: {
      id: HOSTED_RUNTIME_LATENCY_MONITOR_ID,
    },
    create: {
      claimedAt: input.now,
      detailsJson: buildHostedRuntimeLatencyAlertDetails({
        health: input.health,
        incidentId: null,
        now: input.now,
        phase: "healthy",
      }),
      id: HOSTED_RUNTIME_LATENCY_MONITOR_ID,
      kind: HOSTED_RUNTIME_LATENCY_MONITOR_KIND,
      status: MONITOR_STATUS.healthy,
      subject: HOSTED_RUNTIME_LATENCY_MONITOR_SUBJECT,
    },
    update: {},
  });

  if (
    state.kind !== HOSTED_RUNTIME_LATENCY_MONITOR_KIND
    || !isHostedRuntimeLatencyMonitorStatus(state.status)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_LATENCY_ALERT_STATE_INVALID",
      httpStatus: 500,
      message: "Hosted runtime latency alert state is invalid.",
    });
  }

  return state;
}

async function prepareHostedRuntimeLatencyAlertTransition(input: {
  health: HostedRuntimeLatencyHealth;
  now: Date;
  prisma: HostedRuntimeLatencyPrismaClient;
  state: HostedLinqAlert;
  timeZone: string;
}): Promise<{
  candidateState: HostedLinqAlert | null;
  outcome: Exclude<
    HostedRuntimeLatencyAlertMonitorOutcome,
    "alert_sent" | "disabled"
  >;
}> {
  if (input.health.anomalous) {
    if (input.state.status === MONITOR_STATUS.alerting) {
      return { candidateState: null, outcome: "incident_active" };
    }
    const deferred = readHostedRuntimeLatencyAlertDeferral({
      now: input.now,
      state: input.state,
      timeZone: input.timeZone,
    });
    if (deferred) {
      return { candidateState: null, outcome: deferred };
    }

    return { candidateState: input.state, outcome: "coalesced" };
  }

  if (input.state.status === MONITOR_STATUS.healthy) {
    return { candidateState: null, outcome: "healthy" };
  }
  if (
    input.state.status === MONITOR_STATUS.alertSending
    && !isHostedRuntimeLatencySendLeaseExpired(input.state, input.now)
  ) {
    return { candidateState: null, outcome: "coalesced" };
  }

  const cleared = await input.prisma.hostedLinqAlert.updateMany({
    where: buildHostedRuntimeLatencyStateCompare(input.state),
    data: {
      detailsJson: buildHostedRuntimeLatencyAlertDetails({
        health: input.health,
        incidentId: null,
        now: input.now,
        phase: "healthy",
      }),
      status: MONITOR_STATUS.healthy,
    },
  });
  return {
    candidateState: null,
    outcome: cleared.count === 1 ? "healthy" : "coalesced",
  };
}

async function claimHostedRuntimeLatencyAlertSend(input: {
  now?: Date;
  prisma: HostedRuntimeLatencyPrismaClient;
  state: HostedLinqAlert;
  timeZone: string;
}): Promise<
  | {
      action: HostedRuntimeLatencyClaimedAction;
      health: HostedRuntimeLatencyHealth;
      outcome: null;
    }
  | {
      action: null;
      health: HostedRuntimeLatencyHealth;
      outcome: "coalesced" | "deferred_quiet_hours" | "healthy";
    }
> {
  const healthCheckedAt = input.now ?? new Date();
  const health = await readHostedRuntimeLatencyHealth({
    now: healthCheckedAt,
    prisma: input.prisma,
  });

  if (!health.anomalous) {
    const recoveryCheckedAt = input.now ?? new Date();
    const cleared = await input.prisma.hostedLinqAlert.updateMany({
      where: buildHostedRuntimeLatencyStateCompare(input.state),
      data: {
        detailsJson: buildHostedRuntimeLatencyAlertDetails({
          health,
          incidentId: null,
          now: recoveryCheckedAt,
          phase: "healthy",
        }),
        status: MONITOR_STATUS.healthy,
      },
    });
    return {
      action: null,
      health,
      outcome: cleared.count === 1 ? "healthy" : "coalesced",
    };
  }

  const admissionCheckedAt = input.now ?? new Date();
  if (
    isHostedRuntimeLatencyQuietTime(admissionCheckedAt, input.timeZone)
  ) {
    return {
      action: null,
      health,
      outcome: "deferred_quiet_hours",
    };
  }

  const incidentId = input.state.status === MONITOR_STATUS.healthy
    ? randomUUID()
    : readHostedRuntimeLatencyIncidentId(input.state);
  if (!incidentId) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_LATENCY_ALERT_INCIDENT_INVALID",
      httpStatus: 500,
      message: "Hosted runtime latency alert incident is invalid.",
    });
  }

  const message = input.state.status === MONITOR_STATUS.alertSending
    || input.state.status === MONITOR_STATUS.alertFailed
    ? readHostedRuntimeLatencyAlertMessage(input.state)
    : buildHostedRuntimeLatencyAlertMessage({
        health,
        now: admissionCheckedAt,
      });
  if (!message) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_LATENCY_ALERT_MESSAGE_INVALID",
      httpStatus: 500,
      message: "Hosted runtime latency alert message is invalid.",
    });
  }

  const claimed = await input.prisma.hostedLinqAlert.updateMany({
    where: buildHostedRuntimeLatencyStateCompare(input.state),
    data: {
      attemptCount: {
        increment: 1,
      },
      claimedAt: admissionCheckedAt,
      detailsJson: buildHostedRuntimeLatencyAlertDetails({
        health,
        incidentId,
        message,
        now: admissionCheckedAt,
        phase: "alert",
      }),
      lastAttemptedAt: admissionCheckedAt,
      lastErrorCode: null,
      lastProviderStatus: null,
      status: MONITOR_STATUS.alertSending,
    },
  });

  if (claimed.count !== 1) {
    return { action: null, health, outcome: "coalesced" };
  }
  return {
    action: {
      attemptedAt: admissionCheckedAt,
      incidentId,
      message,
    },
    health,
    outcome: null,
  };
}

interface HostedRuntimeLatencyClaimedAction {
  attemptedAt: Date;
  incidentId: string;
  message: string;
}

async function completeHostedRuntimeLatencyAlertTransition(input: {
  attemptedAt: Date;
  completedAt: Date;
  prisma: HostedRuntimeLatencyPrismaClient;
  providerMessageId: string | null;
}): Promise<void> {
  await input.prisma.hostedLinqAlert.updateMany({
    where: {
      id: HOSTED_RUNTIME_LATENCY_MONITOR_ID,
      lastAttemptedAt: input.attemptedAt,
      status: MONITOR_STATUS.alertSending,
    },
    data: {
      lastErrorCode: null,
      lastProviderStatus: null,
      providerMessageId: input.providerMessageId,
      sentAt: input.completedAt,
      status: MONITOR_STATUS.alerting,
    },
  });
}

async function failHostedRuntimeLatencyAlertTransition(input: {
  attemptedAt: Date;
  errorCode: string;
  prisma: HostedRuntimeLatencyPrismaClient;
  providerStatus: number | null;
}): Promise<void> {
  await input.prisma.hostedLinqAlert.updateMany({
    where: {
      id: HOSTED_RUNTIME_LATENCY_MONITOR_ID,
      lastAttemptedAt: input.attemptedAt,
      status: MONITOR_STATUS.alertSending,
    },
    data: {
      lastErrorCode: input.errorCode,
      lastProviderStatus: input.providerStatus,
      status: MONITOR_STATUS.alertFailed,
    },
  });
}

function buildHostedRuntimeLatencyStateCompare(state: HostedLinqAlert) {
  return {
    id: HOSTED_RUNTIME_LATENCY_MONITOR_ID,
    status: state.status,
    updatedAt: state.updatedAt,
  };
}

function buildHostedRuntimeLatencyAlertDetails(input: {
  health: HostedRuntimeLatencyHealth;
  incidentId: string | null;
  message?: string | null;
  now: Date;
  phase: "alert" | "healthy";
}): Prisma.InputJsonObject {
  return {
    health: {
      invalidChronologyCount: input.health.invalidChronologyCount,
      maxFirstVisibleResponseLatencyMs:
        input.health.maxFirstVisibleResponseLatencyMs,
      oldestUnresolvedAgeMs: input.health.oldestUnresolvedAgeMs,
      recentCompletedReplyCount: input.health.recentCompletedReplyCount,
      recentSlowInitialResponseCount:
        input.health.recentSlowInitialResponseCount,
      recentSlowPreProviderDominantCount:
        input.health.recentSlowPreProviderDominantCount,
      recentSlowProviderExecutionDominantCount:
        input.health.recentSlowProviderExecutionDominantCount,
      recentSlowUnknownBoundaryCount:
        input.health.recentSlowUnknownBoundaryCount,
      scanTruncated: input.health.scanTruncated,
      unresolvedCheckpointAcknowledgementCount:
        input.health.unresolvedCheckpointAcknowledgementCount,
      unresolvedMissingTerminalEvidenceCount:
        input.health.unresolvedMissingTerminalEvidenceCount,
      unresolvedReplyCount: input.health.unresolvedReplyCount,
    },
    incidentId: input.incidentId,
    lastEvaluatedAt: input.now.toISOString(),
    message: input.message ?? null,
    phase: input.phase,
    schema: HOSTED_RUNTIME_LATENCY_MONITOR_SCHEMA,
    thresholdMs: input.health.thresholdMs,
    windowMinutes: input.health.windowMinutes,
  };
}

function buildHostedRuntimeLatencyAlertMessage(input: {
  health: HostedRuntimeLatencyHealth;
  now: Date;
}): string {
  const evidence = [
    input.health.recentSlowInitialResponseCount > 0
      ? `${input.health.recentSlowInitialResponseCount} completed ${pluralizeReply(input.health.recentSlowInitialResponseCount)} with no progress or final response within 30 seconds`
      : null,
    input.health.unresolvedReplyCount > 0
      ? `${input.health.unresolvedReplyCount} unresolved ${pluralizeTurn(input.health.unresolvedReplyCount)} with no visible response or durable acknowledgement after 30 seconds`
      : null,
    input.health.scanTruncated
      ? "the bounded latency scan was truncated"
      : null,
  ].filter((value): value is string => value !== null);
  const timing = [
    input.health.maxFirstVisibleResponseLatencyMs !== null
      ? `Worst first response: ${formatDuration(input.health.maxFirstVisibleResponseLatencyMs)}`
      : null,
    input.health.oldestUnresolvedAgeMs !== null
      ? `Oldest unresolved: ${formatDuration(input.health.oldestUnresolvedAgeMs)}`
      : null,
    buildHostedRuntimeSlowBoundarySummary(input.health),
    buildHostedRuntimeUnresolvedBoundarySummary(input.health),
  ].filter((value): value is string => value !== null);

  return [
    "Murph reply latency alert.",
    `${evidence.join("; ")}.`,
    timing.length > 0 ? `${timing.join(". ")}.` : null,
    `Checked ${formatHostedRuntimeLatencyAlertTime(input.now)}.`,
  ].filter((value): value is string => value !== null).join(" ");
}

function buildHostedRuntimeSlowBoundarySummary(
  health: HostedRuntimeLatencyHealth,
): string | null {
  const boundaries = [
    health.recentSlowProviderExecutionDominantCount > 0
      ? `${health.recentSlowProviderExecutionDominantCount} provider/assistant execution dominant`
      : null,
    health.recentSlowPreProviderDominantCount > 0
      ? `${health.recentSlowPreProviderDominantCount} pre-provider path dominant`
      : null,
    health.recentSlowUnknownBoundaryCount > 0
      ? `${health.recentSlowUnknownBoundaryCount} unclassified (missing or invalid chronology)`
      : null,
  ].filter((value): value is string => value !== null);
  return boundaries.length > 0 ? `Slow boundary: ${boundaries.join(", ")}` : null;
}

function buildHostedRuntimeUnresolvedBoundarySummary(
  health: HostedRuntimeLatencyHealth,
): string | null {
  const boundaries = [
    health.unresolvedCheckpointAcknowledgementCount > 0
      ? health.unresolvedCheckpointAcknowledgementCount === 1
        ? "1 terminal non-reply lacks durable checkpoint acknowledgement"
        : `${health.unresolvedCheckpointAcknowledgementCount} terminal non-replies lack durable checkpoint acknowledgement`
      : null,
    health.unresolvedMissingTerminalEvidenceCount > 0
      ? health.unresolvedMissingTerminalEvidenceCount === 1
        ? "1 unresolved turn has no valid terminal response evidence"
        : `${health.unresolvedMissingTerminalEvidenceCount} unresolved turns have no valid terminal response evidence`
      : null,
  ].filter((value): value is string => value !== null);
  return boundaries.length > 0
    ? `Unresolved boundary: ${boundaries.join(", ")}`
    : null;
}

function buildHostedRuntimeLatencyAlertIdempotencyKey(
  action: HostedRuntimeLatencyClaimedAction,
): string {
  return `murph/runtime-latency/${action.incidentId}/alert`;
}

function readHostedRuntimeLatencyAlertConfig(
  env: Readonly<Record<string, string | undefined>>,
): { email: HostedOperationalAlertEmailConfig; timeZone: string } | null {
  const configuredTimeZone = normalizeNullableString(
    env.HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE,
  );
  if (!configuredTimeZone) {
    return null;
  }
  const email = readHostedOperationalAlertEmailConfig(env);
  if (!email) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_LATENCY_ALERT_CONFIG_INCOMPLETE",
      httpStatus: 500,
      message: "Hosted runtime latency alert configuration is incomplete.",
    });
  }
  const timeZone = normalizeIanaTimeZone(configuredTimeZone);
  if (!timeZone) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE_INVALID",
      httpStatus: 500,
      message: "Hosted runtime latency alert time zone is invalid.",
    });
  }
  return { email, timeZone };
}

function readHostedRuntimeLatencyIncidentId(state: HostedLinqAlert): string | null {
  const details = readJsonObject(state.detailsJson);
  return details ? normalizeNullableString(readJsonString(details.incidentId)) : null;
}

function readHostedRuntimeLatencyAlertMessage(state: HostedLinqAlert): string | null {
  const details = readJsonObject(state.detailsJson);
  return details ? normalizeNullableString(readJsonString(details.message)) : null;
}

function readHostedRuntimeLatencyAlertFailure(error: unknown): {
  errorCode: string;
  providerStatus: number | null;
} {
  const value = error instanceof HostedResendPlainTextEmailError
    ? error.code
    : isHostedOnboardingError(error)
      ? error.code
      : error instanceof Error
        ? error.name
        : "UNKNOWN_LATENCY_ALERT_ERROR";
  return {
    errorCode: value.slice(0, 128),
    providerStatus: error instanceof HostedResendPlainTextEmailError
      ? error.providerStatus
      : null,
  };
}

function isHostedRuntimeLatencySendLeaseExpired(
  state: HostedLinqAlert,
  now: Date,
): boolean {
  return state.lastAttemptedAt === null
    || state.lastAttemptedAt.getTime()
      <= now.getTime() - HOSTED_RUNTIME_LATENCY_SEND_LEASE_MS;
}

function readHostedRuntimeLatencyAlertDeferral(input: {
  now: Date;
  state: HostedLinqAlert;
  timeZone: string;
}): "coalesced" | "deferred_quiet_hours" | "deferred_rate_limit" | null {
  if (isHostedRuntimeLatencyQuietTime(input.now, input.timeZone)) {
    return "deferred_quiet_hours";
  }

  const lastActivityAt = laterDate(
    input.state.lastAttemptedAt,
    input.state.sentAt,
  );
  if (lastActivityAt === null) {
    return null;
  }
  const jitterMs = stableHostedRuntimeLatencyJitterMs(
    `${HOSTED_RUNTIME_LATENCY_MONITOR_ID}:attempt:${lastActivityAt.toISOString()}`,
  );
  const nextAttemptAtMs = lastActivityAt.getTime()
    + HOSTED_RUNTIME_LATENCY_ALERT_MINIMUM_INTERVAL_MS
    + jitterMs;
  if (input.now.getTime() >= nextAttemptAtMs) {
    return null;
  }
  return input.state.status === MONITOR_STATUS.alertSending
    ? "coalesced"
    : "deferred_rate_limit";
}

function isHostedRuntimeLatencyQuietTime(
  now: Date,
  timeZone: string,
): boolean {
  const local = formatTimeZoneDateTimeParts(now, timeZone);
  if (
    local.hour >= HOSTED_RUNTIME_LATENCY_QUIET_HOURS_START_HOUR
    || local.hour < HOSTED_RUNTIME_LATENCY_QUIET_HOURS_END_HOUR
  ) {
    return true;
  }
  if (local.hour > HOSTED_RUNTIME_LATENCY_QUIET_HOURS_END_HOUR) {
    return false;
  }

  const wakeJitterMs = stableHostedRuntimeLatencyJitterMs(
    `${HOSTED_RUNTIME_LATENCY_MONITOR_ID}:wake:${timeZone}:${local.dayKey}`,
  );
  const elapsedSinceWakeMs = (local.minute * 60 + local.second) * 1_000;
  return elapsedSinceWakeMs < wakeJitterMs;
}

function stableHostedRuntimeLatencyJitterMs(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return 1 + (
    digest.readUInt32BE(0) % HOSTED_RUNTIME_LATENCY_ALERT_JITTER_WINDOW_MS
  );
}

function laterDate(left: Date | null, right: Date | null): Date | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return left.getTime() >= right.getTime() ? left : right;
}

function isHostedRuntimeLatencyMonitorStatus(
  value: string,
): value is HostedRuntimeLatencyMonitorStatus {
  return Object.values(MONITOR_STATUS).some((status) => status === value);
}

function readJsonObject(value: Prisma.JsonValue): Prisma.JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function readJsonString(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function formatHostedRuntimeLatencyAlertTime(value: Date): string {
  return value.toISOString().replace(".000Z", "Z");
}

function formatDuration(valueMs: number): string {
  if (valueMs < 60_000) {
    return `${(valueMs / 1_000).toFixed(1)}s`;
  }
  return `${(valueMs / 60_000).toFixed(1)}m`;
}

function pluralizeReply(count: number): string {
  return count === 1 ? "reply" : "replies";
}

function pluralizeTurn(count: number): string {
  return count === 1 ? "turn" : "turns";
}

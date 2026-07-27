import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  formatTimeZoneDateTimeParts,
  normalizeIanaTimeZone,
} from "@murphai/contracts";
import { Prisma, type HostedLinqAlert, type PrismaClient } from "@prisma/client";

import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import {
  sendHostedLinqChatMessage,
  type HostedLinqSendResult,
} from "../hosted-onboarding/linq-client";
import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";

export const HOSTED_RUNTIME_REPLY_LATENCY_ALERT_THRESHOLD_MS = 30_000;
export const HOSTED_RUNTIME_LATENCY_ALERT_MINIMUM_INTERVAL_MS = 10 * 60_000;

const HOSTED_RUNTIME_LATENCY_MONITOR_ID = "hosted-runtime-latency-monitor:v1";
const HOSTED_RUNTIME_LATENCY_MONITOR_KIND = "hosted_runtime_latency_monitor";
const HOSTED_RUNTIME_LATENCY_MONITOR_SUBJECT = "Hosted runtime reply latency";
const HOSTED_RUNTIME_LATENCY_MONITOR_SCHEMA = "murph.hosted-runtime-latency-monitor.v1";
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
  "hostedIngressLatencyTrace" | "hostedLinqAlert"
>;

type HostedRuntimeLatencySend = (input: {
  chatId: string;
  idempotencyKey?: string | null;
  message: string;
  signal?: AbortSignal;
}) => Promise<HostedLinqSendResult>;

export interface HostedRuntimeLatencyHealthRow {
  acceptedAt: Date;
  consumedAt: Date | null;
  deliveryAcceptedAt: Date | null;
  terminalNonReplyCommittedAt: Date | null;
}

export interface HostedRuntimeLatencyHealth {
  anomalous: boolean;
  invalidChronologyCount: number;
  maxCompletedReplyLatencyMs: number | null;
  oldestUnresolvedAgeMs: number | null;
  recentCompletedReplyCount: number;
  recentSlowReplyCount: number;
  scanTruncated: boolean;
  thresholdMs: number;
  unresolvedReplyCount: number;
  windowMinutes: number;
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
  sendLinqMessage?: HostedRuntimeLatencySend;
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

  const sendLinqMessage = input.sendLinqMessage ?? sendHostedLinqChatMessage;
  const action = admission.action;
  try {
    const sent = await sendLinqMessage({
      chatId: alertConfig.chatId,
      idempotencyKey: buildHostedRuntimeLatencyAlertIdempotencyKey(action),
      message: action.message,
      signal: input.signal,
    });
    await completeHostedRuntimeLatencyAlertTransition({
      action,
      attemptedAt: action.attemptedAt,
      completedAt: input.now ?? new Date(),
      prisma,
      providerMessageId: sent.messageId,
    });
  } catch (error) {
    const errorCode = readHostedRuntimeLatencyAlertErrorCode(error);
    await failHostedRuntimeLatencyAlertTransition({
      action,
      attemptedAt: action.attemptedAt,
      errorCode,
      prisma,
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
  prisma?: Pick<PrismaClient, "hostedIngressLatencyTrace">;
} = {}): Promise<HostedRuntimeLatencyHealth> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const windowStart = new Date(
    now.getTime() - HOSTED_RUNTIME_LATENCY_UNRESOLVED_WINDOW_MS,
  );
  const rows = await prisma.hostedIngressLatencyTrace.findMany({
    orderBy: {
      acceptedAt: "desc",
    },
    select: {
      acceptedAt: true,
      linqDelivery: {
        select: {
          acceptedAt: true,
        },
      },
      mailboxItem: {
        select: {
          consumedAt: true,
        },
      },
      phaseBreakdownJson: true,
    },
    take: HOSTED_RUNTIME_LATENCY_READ_LIMIT + 1,
    where: {
      acceptedAt: {
        gte: windowStart,
        lte: now,
      },
      source: "linq",
    },
  });
  const scanTruncated = rows.length > HOSTED_RUNTIME_LATENCY_READ_LIMIT;
  const visibleRows = scanTruncated
    ? rows.slice(0, HOSTED_RUNTIME_LATENCY_READ_LIMIT)
    : rows;

  return summarizeHostedRuntimeLatencyRows({
    now,
    rows: visibleRows.map((row) => ({
      acceptedAt: row.acceptedAt,
      consumedAt: row.mailboxItem.consumedAt,
      deliveryAcceptedAt: row.linqDelivery?.acceptedAt ?? null,
      terminalNonReplyCommittedAt:
        readHostedRuntimeTerminalNonReplyCommittedAt(row.phaseBreakdownJson),
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
  let invalidChronologyCount = 0;
  let maxCompletedReplyLatencyMs: number | null = null;
  let oldestUnresolvedAgeMs: number | null = null;
  let recentCompletedReplyCount = 0;
  let recentSlowReplyCount = 0;
  let unresolvedReplyCount = 0;

  for (const row of input.rows) {
    const acceptedAtMs = row.acceptedAt.getTime();
    const deliveryAcceptedAtMs = row.deliveryAcceptedAt?.getTime() ?? null;
    const terminalNonReplyCommittedAtMs =
      row.terminalNonReplyCommittedAt?.getTime() ?? null;

    if (deliveryAcceptedAtMs !== null) {
      if (deliveryAcceptedAtMs < acceptedAtMs || deliveryAcceptedAtMs > nowMs) {
        invalidChronologyCount += 1;
        continue;
      }
      if (deliveryAcceptedAtMs < completedWindowStartMs) {
        continue;
      }

      const latencyMs = deliveryAcceptedAtMs - acceptedAtMs;
      recentCompletedReplyCount += 1;
      if (latencyMs >= HOSTED_RUNTIME_REPLY_LATENCY_ALERT_THRESHOLD_MS) {
        recentSlowReplyCount += 1;
        maxCompletedReplyLatencyMs = Math.max(
          maxCompletedReplyLatencyMs ?? 0,
          latencyMs,
        );
      }
      continue;
    }

    if (terminalNonReplyCommittedAtMs !== null) {
      if (
        terminalNonReplyCommittedAtMs < acceptedAtMs
        || terminalNonReplyCommittedAtMs > nowMs
      ) {
        invalidChronologyCount += 1;
      } else {
        continue;
      }
    }

    const ageMs = nowMs - acceptedAtMs;
    if (
      ageMs >= HOSTED_RUNTIME_REPLY_LATENCY_ALERT_THRESHOLD_MS
      && row.consumedAt === null
    ) {
      unresolvedReplyCount += 1;
      oldestUnresolvedAgeMs = Math.max(oldestUnresolvedAgeMs ?? 0, ageMs);
    }
  }

  const scanTruncated = input.scanTruncated === true;
  return {
    anomalous: recentSlowReplyCount > 0 || unresolvedReplyCount > 0 || scanTruncated,
    invalidChronologyCount,
    maxCompletedReplyLatencyMs,
    oldestUnresolvedAgeMs,
    recentCompletedReplyCount,
    recentSlowReplyCount,
    scanTruncated,
    thresholdMs: HOSTED_RUNTIME_REPLY_LATENCY_ALERT_THRESHOLD_MS,
    unresolvedReplyCount,
    windowMinutes: HOSTED_RUNTIME_LATENCY_COMPLETED_WINDOW_MS / 60_000,
  };
}

function readHostedRuntimeTerminalNonReplyCommittedAt(value: unknown): Date | null {
  if (!isHostedRuntimeLatencyPhaseRecord(value)) {
    return null;
  }
  const assistant = value.assistant;
  if (!isHostedRuntimeLatencyPhaseRecord(assistant)) {
    return null;
  }
  const epochMs = assistant.terminalNonReplyCommittedAtEpochMs;
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
  action: HostedRuntimeLatencyClaimedAction;
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
  action: HostedRuntimeLatencyClaimedAction;
  attemptedAt: Date;
  errorCode: string;
  prisma: HostedRuntimeLatencyPrismaClient;
}): Promise<void> {
  await input.prisma.hostedLinqAlert.updateMany({
    where: {
      id: HOSTED_RUNTIME_LATENCY_MONITOR_ID,
      lastAttemptedAt: input.attemptedAt,
      status: MONITOR_STATUS.alertSending,
    },
    data: {
      lastErrorCode: input.errorCode,
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
      maxCompletedReplyLatencyMs: input.health.maxCompletedReplyLatencyMs,
      oldestUnresolvedAgeMs: input.health.oldestUnresolvedAgeMs,
      recentCompletedReplyCount: input.health.recentCompletedReplyCount,
      recentSlowReplyCount: input.health.recentSlowReplyCount,
      scanTruncated: input.health.scanTruncated,
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
    input.health.recentSlowReplyCount > 0
      ? `${input.health.recentSlowReplyCount} completed ${pluralizeReply(input.health.recentSlowReplyCount)} at or above 30 seconds`
      : null,
    input.health.unresolvedReplyCount > 0
      ? `${input.health.unresolvedReplyCount} traced ${pluralizeMessage(input.health.unresolvedReplyCount)} still unresolved after 30 seconds`
      : null,
    input.health.scanTruncated
      ? "the bounded latency scan was truncated"
      : null,
  ].filter((value): value is string => value !== null);
  const timing = [
    input.health.maxCompletedReplyLatencyMs !== null
      ? `Worst completed reply: ${formatDuration(input.health.maxCompletedReplyLatencyMs)}`
      : null,
    input.health.oldestUnresolvedAgeMs !== null
      ? `Oldest unresolved: ${formatDuration(input.health.oldestUnresolvedAgeMs)}`
      : null,
  ].filter((value): value is string => value !== null);

  return [
    "Murph reply latency alert.",
    `${evidence.join("; ")}.`,
    timing.length > 0 ? `${timing.join(". ")}.` : null,
    `Checked ${formatHostedRuntimeLatencyAlertTime(input.now)}.`,
  ].filter((value): value is string => value !== null).join(" ");
}

function buildHostedRuntimeLatencyAlertIdempotencyKey(
  action: HostedRuntimeLatencyClaimedAction,
): string {
  return `murph/runtime-latency/${action.incidentId}/alert`;
}

function readHostedRuntimeLatencyAlertConfig(
  env: Readonly<Record<string, string | undefined>>,
): { chatId: string; timeZone: string } | null {
  const chatId = normalizeNullableString(
    env.HOSTED_RUNTIME_LATENCY_ALERT_LINQ_CHAT_ID,
  );
  const configuredTimeZone = normalizeNullableString(
    env.HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE,
  );
  if (!chatId && !configuredTimeZone) {
    return null;
  }
  if (!chatId || !configuredTimeZone) {
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
  return { chatId, timeZone };
}

function readHostedRuntimeLatencyIncidentId(state: HostedLinqAlert): string | null {
  const details = readJsonObject(state.detailsJson);
  return details ? normalizeNullableString(readJsonString(details.incidentId)) : null;
}

function readHostedRuntimeLatencyAlertMessage(state: HostedLinqAlert): string | null {
  const details = readJsonObject(state.detailsJson);
  return details ? normalizeNullableString(readJsonString(details.message)) : null;
}

function readHostedRuntimeLatencyAlertErrorCode(error: unknown): string {
  const value = isHostedOnboardingError(error)
    ? error.code
    : error instanceof Error
      ? error.name
      : "UNKNOWN_LATENCY_ALERT_ERROR";
  return value.slice(0, 128);
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

function pluralizeMessage(count: number): string {
  return count === 1 ? "message" : "messages";
}

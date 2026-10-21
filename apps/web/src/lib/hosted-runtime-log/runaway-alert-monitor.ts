import "server-only";

import { HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES } from "@murphai/hosted-execution/runtime-control";
import {
  runHostedOperationalEmailIncident,
  type HostedOperationalAlertMonitorSpec,
  type HostedOperationalAlertPrismaClient,
  type HostedOperationalAlertSend,
} from "../hosted-operational-alert/incident-email-monitor";
import { readHostedRuntimeLatencyAlertConfig } from "../hosted-runtime-latency/alert-monitor";
import { getPrisma } from "../prisma";
import { getHostedRuntimeLogPool, isHostedRuntimeLogDatabaseConfigured } from "./database";
import type { HostedRuntimeLogSqlDatabase } from "./store";

export const HOSTED_RUNTIME_RUNAWAY_INVOCATION_THRESHOLD = 25;
// Every Worker ensure-processing call writes one row, accepted or retried.
// Normal members stay under 20 per hour (p999 16 over 7.8k member-hours); one
// per minute is a retry storm that is also hitting Web on every attempt.
export const HOSTED_RUNTIME_RUNAWAY_PROCESSING_ATTEMPT_THRESHOLD = 60;
// Retries are waste, not activity: over 8.1k member-hours (2026-09-23 to
// 2026-10-07) every hour with 20+ retry_later rows was a retry storm, while
// busy healthy members mostly see accepted attempts.
export const HOSTED_RUNTIME_RUNAWAY_PROCESSING_RETRY_THRESHOLD = 20;
export const HOSTED_RUNTIME_RUNAWAY_WINDOW_MS = 60 * 60_000;
export const HOSTED_RUNTIME_RUNAWAY_SUBJECT_LIMIT = 10;
export const HOSTED_RUNTIME_RUNAWAY_REMINDER_INTERVAL_MS = 6 * 60 * 60_000;

// Wake reasons are extensible strings. Only known operational labels may leave
// the diagnostic database in an email; missing/new values remain unknown.
const EMAIL_WAKE_REASONS = [
  "assistant", "assistant_delivery", "device-sync.reconcile", "inbox_media_retention", "mailbox",
];
const EMAIL_PROCESSING_OUTCOMES = ["runtime_processing_accepted", "retry_later", "threw"];
// Worker retry reasons; a reason added later reads as unknown until listed.
const EMAIL_RETRY_REASONS = [
  "active_child_rejected", "admission_blocked", "checkpoint_handoff_pending", "claim_blocked",
  "command_budget_exhausted", "completion_unconfirmed", "container_busy", "container_not_ready",
  "container_rpc_error", "container_rpc_timeout", "cutover_blocked", "missing_container_binding",
  "processing_mode_conflict", "retirement_pending", "starting_fence_preserved", "wake_unconfirmed",
];

type RunawaySubject = {
  subjectPrefix: string;
  invocationCount: number;
  processingAttemptCount: number;
  processingRetryCount: number;
  processingMode: string;
  nextWakeReason: string;
  processingOutcome: string;
};
type RunawayHealth = {
  anomalous: boolean;
  runawaySubjectCount: number;
  subjects: RunawaySubject[];
};
type RunawayRow = Omit<RunawaySubject, "invocationCount" | "processingAttemptCount" | "processingRetryCount"> & {
  invocationCount: string;
  processingAttemptCount: string;
  processingRetryCount: string;
  runawaySubjectCount: string;
};
type LogDatabase = Pick<HostedRuntimeLogSqlDatabase, "query">;

export async function readHostedRuntimeRunawayHealth(input: {
  now: Date;
  database?: LogDatabase;
}): Promise<RunawayHealth> {
  const database = input.database ?? getHostedRuntimeLogPool();
  // One time-indexed aggregate, no member lookup or raw diagnostic payload.
  // Window count runs after HAVING and before LIMIT, retaining the full total.
  // A subject alerts on any count; the worst ratio to its threshold ranks it.
  const result = await database.query<RunawayRow>(`
    SELECT
      CASE WHEN subject_key ~ '^[a-f0-9]{64}$'
        THEN left(subject_key, 8) ELSE 'unknown' END AS "subjectPrefix",
      count(*) FILTER (WHERE event_code = 'runtime.invocation_finished')::text AS "invocationCount",
      count(*) FILTER (WHERE event_code = 'runner.processing_finished')::text AS "processingAttemptCount",
      count(*) FILTER (WHERE event_code = 'runner.processing_finished'
        AND redacted_json->>'runtimeProcessingOutcome' = 'retry_later')::text AS "processingRetryCount",
      count(*) OVER ()::text AS "runawaySubjectCount",
      mode() WITHIN GROUP (ORDER BY CASE
        WHEN coalesce(redacted_json->>'processingMode',
          redacted_json->>'runtimeProcessingRequestedMode') = ANY($6::text[])
        THEN coalesce(redacted_json->>'processingMode',
          redacted_json->>'runtimeProcessingRequestedMode') ELSE 'unknown' END) AS "processingMode",
      coalesce(mode() WITHIN GROUP (ORDER BY CASE
        WHEN redacted_json->>'nextWakeReason' = ANY($7::text[])
        THEN redacted_json->>'nextWakeReason' ELSE 'unknown' END)
        FILTER (WHERE event_code = 'runtime.invocation_finished'), 'none') AS "nextWakeReason",
      coalesce(mode() WITHIN GROUP (ORDER BY CASE
        WHEN redacted_json->>'runtimeProcessingOutcome' = 'retry_later'
          AND redacted_json->>'runtimeProcessingRetryReason' = ANY($8::text[])
        THEN 'retry_later:' || (redacted_json->>'runtimeProcessingRetryReason')
        WHEN redacted_json->>'runtimeProcessingOutcome' = ANY($9::text[])
        THEN redacted_json->>'runtimeProcessingOutcome' ELSE 'unknown' END)
        FILTER (WHERE event_code = 'runner.processing_finished'), 'none') AS "processingOutcome"
    FROM hosted_runtime_log
    WHERE at >= $1 AND at <= $2
      AND event_code IN ('runtime.invocation_finished', 'runner.processing_finished')
    GROUP BY subject_key
    HAVING count(*) FILTER (WHERE event_code = 'runtime.invocation_finished') >= $3
      OR count(*) FILTER (WHERE event_code = 'runner.processing_finished') >= $4
      OR count(*) FILTER (WHERE event_code = 'runner.processing_finished'
        AND redacted_json->>'runtimeProcessingOutcome' = 'retry_later') >= $10
    ORDER BY greatest(
      count(*) FILTER (WHERE event_code = 'runtime.invocation_finished')::float8 / $3,
      count(*) FILTER (WHERE event_code = 'runner.processing_finished')::float8 / $4,
      count(*) FILTER (WHERE event_code = 'runner.processing_finished'
        AND redacted_json->>'runtimeProcessingOutcome' = 'retry_later')::float8 / $10) DESC, subject_key
    LIMIT $5
  `, [new Date(input.now.getTime() - HOSTED_RUNTIME_RUNAWAY_WINDOW_MS), input.now,
    HOSTED_RUNTIME_RUNAWAY_INVOCATION_THRESHOLD, HOSTED_RUNTIME_RUNAWAY_PROCESSING_ATTEMPT_THRESHOLD,
    HOSTED_RUNTIME_RUNAWAY_SUBJECT_LIMIT, HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES,
    EMAIL_WAKE_REASONS, EMAIL_RETRY_REASONS, EMAIL_PROCESSING_OUTCOMES,
    HOSTED_RUNTIME_RUNAWAY_PROCESSING_RETRY_THRESHOLD]);
  return {
    anomalous: result.rows.length > 0,
    runawaySubjectCount: Number(result.rows[0]?.runawaySubjectCount ?? 0),
    subjects: result.rows.map(row => ({
      subjectPrefix: row.subjectPrefix,
      invocationCount: Number(row.invocationCount),
      processingAttemptCount: Number(row.processingAttemptCount),
      processingRetryCount: Number(row.processingRetryCount),
      processingMode: row.processingMode,
      nextWakeReason: row.nextWakeReason,
      processingOutcome: row.processingOutcome,
    })),
  };
}

export async function runHostedRuntimeRunawayAlertMonitor(input: {
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  prisma?: HostedOperationalAlertPrismaClient;
  database?: LogDatabase;
  sendAlert?: HostedOperationalAlertSend;
  signal?: AbortSignal;
} = {}) {
  const alertConfig = readHostedRuntimeLatencyAlertConfig(input.env ?? process.env);
  if (!alertConfig || (!input.database && !isHostedRuntimeLogDatabaseConfigured())) {
    return { configured: false, outcome: "disabled" as const };
  }
  const now = input.now ?? new Date();
  const readHealth = ({ now }: { now: Date }) => readHostedRuntimeRunawayHealth({
    now, database: input.database,
  });
  const health = await readHealth({ now });
  const spec: HostedOperationalAlertMonitorSpec<RunawayHealth, HostedOperationalAlertPrismaClient> = {
    id: "hosted-runtime-runaway-monitor:v1",
    kind: "hosted_runtime_runaway_monitor",
    idempotencyScope: "murph/runtime-runaway",
    subject: "Hosted runtime runaway activity",
    reminderIntervalMs: HOSTED_RUNTIME_RUNAWAY_REMINDER_INTERVAL_MS,
    sendDuringQuietHours: true,
    status: { healthy: "runaway_healthy", alerting: "runaway_alerting",
      alertSending: "runaway_sending", alertFailed: "runaway_failed" },
    error: {
      incidentInvalidCode: "RUNTIME_RUNAWAY_INCIDENT_INVALID", incidentInvalidMessage: "Runtime runaway incident is invalid.",
      messageInvalidCode: "RUNTIME_RUNAWAY_MESSAGE_INVALID", messageInvalidMessage: "Runtime runaway message is invalid.",
      sendFailedCode: "RUNTIME_RUNAWAY_SEND_FAILED", sendFailedMessage: "Runtime runaway alert delivery failed.",
      stateInvalidCode: "RUNTIME_RUNAWAY_STATE_INVALID", stateInvalidMessage: "Runtime runaway alert state is invalid.",
      unknownSendErrorCode: "RUNTIME_RUNAWAY_SEND_FAILED",
    },
    readHealth,
    buildDetails: ({ health, incidentId, now, phase, message }) => ({
      schema: "murph.runtime-runaway-alert.v1", health,
      incidentId, phase, lastEvaluatedAt: now.toISOString(), message: message ?? null,
    }),
    buildMessage: ({ health, now }) => [
      `Runaway subjects: ${health.runawaySubjectCount}.`,
      `Threshold: at least ${HOSTED_RUNTIME_RUNAWAY_INVOCATION_THRESHOLD} runtime.invocation_finished or ${HOSTED_RUNTIME_RUNAWAY_PROCESSING_ATTEMPT_THRESHOLD} runner.processing_finished (or ${HOSTED_RUNTIME_RUNAWAY_PROCESSING_RETRY_THRESHOLD} of them retry_later) events in the trailing ${HOSTED_RUNTIME_RUNAWAY_WINDOW_MS / 60_000} minutes.`,
      `Top ${health.subjects.length} subjects (digest prefixes):`,
      ...health.subjects.map(subject => `${subject.subjectPrefix}: ${subject.invocationCount} invocations; ${subject.processingAttemptCount} processing attempts (${subject.processingRetryCount} retries); dominant processingMode=${subject.processingMode}; dominant nextWakeReason=${subject.nextWakeReason}; dominant processing outcome=${subject.processingOutcome}.`),
      `Checked ${now.toISOString()}.`,
    ].join("\n"),
  };
  const result = await runHostedOperationalEmailIncident({
    alertConfig, initialHealth: health, initialNow: now, now: input.now,
    prisma: input.prisma ?? getPrisma(), sendAlert: input.sendAlert,
    signal: input.signal, spec,
  });
  return { configured: true, ...result };
}

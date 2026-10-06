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
export const HOSTED_RUNTIME_RUNAWAY_WINDOW_MS = 60 * 60_000;
export const HOSTED_RUNTIME_RUNAWAY_SUBJECT_LIMIT = 10;
export const HOSTED_RUNTIME_RUNAWAY_REMINDER_INTERVAL_MS = 6 * 60 * 60_000;

// Wake reasons are extensible strings. Only known operational labels may leave
// the diagnostic database in an email; missing/new values remain unknown.
const EMAIL_WAKE_REASONS = [
  "assistant", "assistant_delivery", "device-sync.reconcile", "inbox_media_retention", "mailbox",
];

type RunawaySubject = {
  subjectPrefix: string;
  invocationCount: number;
  processingMode: string;
  nextWakeReason: string;
};
type RunawayHealth = {
  anomalous: boolean;
  runawaySubjectCount: number;
  subjects: RunawaySubject[];
};
type RunawayRow = Omit<RunawaySubject, "invocationCount"> & {
  invocationCount: string;
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
  const result = await database.query<RunawayRow>(`
    SELECT
      CASE WHEN subject_key ~ '^[a-f0-9]{64}$'
        THEN left(subject_key, 8) ELSE 'unknown' END AS "subjectPrefix",
      count(*)::text AS "invocationCount",
      count(*) OVER ()::text AS "runawaySubjectCount",
      mode() WITHIN GROUP (ORDER BY CASE
        WHEN redacted_json->>'processingMode' = ANY($5::text[])
        THEN redacted_json->>'processingMode' ELSE 'unknown' END) AS "processingMode",
      mode() WITHIN GROUP (ORDER BY CASE
        WHEN redacted_json->>'nextWakeReason' = ANY($6::text[])
        THEN redacted_json->>'nextWakeReason' ELSE 'unknown' END) AS "nextWakeReason"
    FROM hosted_runtime_log
    WHERE at >= $1 AND at <= $2
      AND event_code = 'runtime.invocation_finished'
    GROUP BY subject_key
    HAVING count(*) >= $3
    ORDER BY count(*) DESC, subject_key
    LIMIT $4
  `, [new Date(input.now.getTime() - HOSTED_RUNTIME_RUNAWAY_WINDOW_MS), input.now,
    HOSTED_RUNTIME_RUNAWAY_INVOCATION_THRESHOLD, HOSTED_RUNTIME_RUNAWAY_SUBJECT_LIMIT,
    HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES, EMAIL_WAKE_REASONS]);
  return {
    anomalous: result.rows.length > 0,
    runawaySubjectCount: Number(result.rows[0]?.runawaySubjectCount ?? 0),
    subjects: result.rows.map(row => ({
      subjectPrefix: row.subjectPrefix,
      invocationCount: Number(row.invocationCount),
      processingMode: row.processingMode,
      nextWakeReason: row.nextWakeReason,
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
    subject: "Hosted runtime runaway invocations",
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
      `Threshold: at least ${HOSTED_RUNTIME_RUNAWAY_INVOCATION_THRESHOLD} runtime.invocation_finished events in the trailing ${HOSTED_RUNTIME_RUNAWAY_WINDOW_MS / 60_000} minutes.`,
      `Top ${health.subjects.length} subjects (digest prefixes):`,
      ...health.subjects.map(subject => `${subject.subjectPrefix}: ${subject.invocationCount} invocations; dominant processingMode=${subject.processingMode}; dominant nextWakeReason=${subject.nextWakeReason}.`),
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

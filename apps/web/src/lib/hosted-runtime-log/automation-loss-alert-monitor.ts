import "server-only";

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

// A lost run is a scheduled occurrence that expired after a failed attempt, or
// failed with no retry left. Onboarding-gated research automations expire with
// zero prior failures by design and are excluded. From 2026-09-30 to 2026-10-07
// lost runs reached 3 runtimes in 6 hours only during the 10-05 to 10-07 flex
// capacity rejections; isolated single-runtime losses stay below the threshold.
export const HOSTED_AUTOMATION_LOSS_RUNTIME_THRESHOLD = 3;
export const HOSTED_AUTOMATION_LOSS_WINDOW_MS = 6 * 60 * 60_000;
export const HOSTED_AUTOMATION_LOSS_REMINDER_INTERVAL_MS = 6 * 60 * 60_000;

// Personal Patterns has its own per-occurrence alert.
const PERSONAL_PATTERNS_AUTOMATION_SLUG = "personal-patterns-update";
const USAGE_LIMIT_ERROR_CODE = "ASSISTANT_CODEX_USAGE_LIMIT";
// Member-created automation slugs can contain personal text. Only managed
// slugs and known error codes leave the diagnostic database in an email.
const EMAIL_AUTOMATION_SLUGS = [
  "automatic-meal-daily-closeout", "finish-onboarding-followup", "group-room-model-consolidation",
  "journal-connected-context-morning", "monthly-improvement-coach",
  "onboarding-early-stall-check-in", "onboarding-goal-checkin", "overnight-memory-consolidation",
  "weekly-health-digest", "weekly-health-insight", "weekly-health-research-scout",
  "weekly-improvement-coach", "weekly-usage-optimizer",
];
const EMAIL_ERROR_CODES = [
  "ASSISTANT_CODEX_APP_SERVER_LIVE_TURN_INACTIVE", "ASSISTANT_CODEX_CONNECTION_LOST", "ASSISTANT_CODEX_FAILED",
  "ASSISTANT_CODEX_INTERRUPTED", "ASSISTANT_CODEX_PROVIDER_FAILED", USAGE_LIMIT_ERROR_CODE, "authorization_error",
];

type LostAutomation = { automation: string; lostRunCount: number; runtimeCount: number };
type FailedAttempts = { errorCode: string; failedAttemptCount: number };
type AutomationLossHealth = {
  anomalous: boolean;
  lostRunCount: number;
  runtimeCount: number;
  automations: LostAutomation[];
  failedAttempts: FailedAttempts[];
};
type LogDatabase = Pick<HostedRuntimeLogSqlDatabase, "query">;

export async function readHostedAutomationLossHealth(input: {
  now: Date;
  database?: LogDatabase;
}): Promise<AutomationLossHealth> {
  const database = input.database ?? getHostedRuntimeLogPool();
  const window = [new Date(input.now.getTime() - HOSTED_AUTOMATION_LOSS_WINDOW_MS), input.now];
  // Time-indexed aggregates only; one row per allowlisted label, no member lookup.
  const lost = await database.query<{
    automation: string; lostRunCount: string; runtimeCount: string; totalRuntimeCount: string;
  }>(`
    WITH lost AS (
      SELECT DISTINCT subject_key,
        redacted_json->>'failureAutomationSlug' AS slug,
        redacted_json->>'failureOccurrenceAt' AS occurrence_at
      FROM hosted_runtime_log
      WHERE at >= $1 AND at <= $2
        AND event_code = 'assistant.automation_detail'
        AND redacted_json->>'failureAutomationSlug' IS DISTINCT FROM $4
        AND (
          (redacted_json->>'type' = 'cron.occurrence.expired'
            AND CASE WHEN jsonb_typeof(redacted_json->'failurePriorFailureCount') = 'number'
              THEN (redacted_json->>'failurePriorFailureCount')::numeric > 0 ELSE false END)
          OR (redacted_json->>'type' = 'cron.job.completed'
            AND redacted_json->>'failureRunOutcome' = 'failed'
            AND redacted_json->'failureRetryScheduled' = 'false'::jsonb
            AND coalesce(redacted_json->>'failureErrorCode', error_code, '') <> $5)
        )
    )
    SELECT
      CASE WHEN slug = ANY($3::text[]) THEN slug ELSE 'member_automation' END AS automation,
      count(*)::text AS "lostRunCount",
      count(DISTINCT subject_key)::text AS "runtimeCount",
      (SELECT count(DISTINCT subject_key) FROM lost)::text AS "totalRuntimeCount"
    FROM lost
    GROUP BY 1
    ORDER BY count(*) DESC, 1
  `, [...window, EMAIL_AUTOMATION_SLUGS, PERSONAL_PATTERNS_AUTOMATION_SLUG, USAGE_LIMIT_ERROR_CODE]);
  const runtimeCount = Number(lost.rows[0]?.totalRuntimeCount ?? 0);
  const anomalous = runtimeCount >= HOSTED_AUTOMATION_LOSS_RUNTIME_THRESHOLD;
  const failed = anomalous
    ? await database.query<{ errorCode: string; failedAttemptCount: string }>(`
      SELECT
        CASE WHEN coalesce(redacted_json->>'failureErrorCode', error_code) = ANY($3::text[])
          THEN coalesce(redacted_json->>'failureErrorCode', error_code) ELSE 'other' END AS "errorCode",
        count(*)::text AS "failedAttemptCount"
      FROM hosted_runtime_log
      WHERE at >= $1 AND at <= $2
        AND event_code = 'assistant.automation_detail'
        AND redacted_json->>'type' = 'cron.job.completed'
        AND redacted_json->>'failureRunOutcome' = 'failed'
      GROUP BY 1
      ORDER BY count(*) DESC, 1
    `, [...window, EMAIL_ERROR_CODES])
    : { rows: [] };
  return {
    anomalous,
    lostRunCount: lost.rows.reduce((total, row) => total + Number(row.lostRunCount), 0),
    runtimeCount,
    automations: lost.rows.map(row => ({
      automation: row.automation, lostRunCount: Number(row.lostRunCount), runtimeCount: Number(row.runtimeCount),
    })),
    failedAttempts: failed.rows.map(row => ({
      errorCode: row.errorCode, failedAttemptCount: Number(row.failedAttemptCount),
    })),
  };
}

export async function runHostedAutomationLossAlertMonitor(input: {
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
  const readHealth = ({ now }: { now: Date }) => readHostedAutomationLossHealth({
    now, database: input.database,
  });
  const health = await readHealth({ now });
  const spec: HostedOperationalAlertMonitorSpec<AutomationLossHealth, HostedOperationalAlertPrismaClient> = {
    id: "hosted-automation-loss-monitor:v1",
    kind: "hosted_automation_loss_monitor",
    idempotencyScope: "murph/automation-loss",
    subject: "Scheduled automation runs lost",
    reminderIntervalMs: HOSTED_AUTOMATION_LOSS_REMINDER_INTERVAL_MS,
    status: { healthy: "automation_loss_healthy", alerting: "automation_loss_alerting",
      alertSending: "automation_loss_sending", alertFailed: "automation_loss_failed" },
    error: {
      incidentInvalidCode: "AUTOMATION_LOSS_INCIDENT_INVALID", incidentInvalidMessage: "Automation loss incident is invalid.",
      messageInvalidCode: "AUTOMATION_LOSS_MESSAGE_INVALID", messageInvalidMessage: "Automation loss message is invalid.",
      sendFailedCode: "AUTOMATION_LOSS_SEND_FAILED", sendFailedMessage: "Automation loss alert delivery failed.",
      stateInvalidCode: "AUTOMATION_LOSS_STATE_INVALID", stateInvalidMessage: "Automation loss alert state is invalid.",
      unknownSendErrorCode: "AUTOMATION_LOSS_SEND_FAILED",
    },
    readHealth,
    buildDetails: ({ health, incidentId, now, phase, message }) => ({
      schema: "murph.automation-loss-alert.v1", health,
      incidentId, phase, lastEvaluatedAt: now.toISOString(), message: message ?? null,
    }),
    buildMessage: ({ health, now }) => [
      `Lost scheduled runs: ${health.lostRunCount} across ${health.runtimeCount} runtimes in the trailing ${HOSTED_AUTOMATION_LOSS_WINDOW_MS / 3_600_000} hours.`,
      `Threshold: at least ${HOSTED_AUTOMATION_LOSS_RUNTIME_THRESHOLD} runtimes with a run that expired after a failed attempt or failed with no retry left. Personal Patterns has its own alert.`,
      "By automation:",
      ...health.automations.map(row => `${row.automation}: ${row.lostRunCount} lost runs across ${row.runtimeCount} runtimes.`),
      "Failed scheduled attempts in the window by error code:",
      ...health.failedAttempts.map(row => `${row.errorCode}: ${row.failedAttemptCount}.`),
      "Inspect assistant.automation_detail cron.job.completed failures in the runtime log store for the provider error and service tier.",
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

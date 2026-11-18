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

// A rejected reply is a foreground reply whose turn the model provider refused
// before any provider work: the turn failed, is not retryable and ran zero
// provider actions. The member gets no reply and a retry meets the same
// refusal. Process exits, retryable failures and turns that did provider work
// are other failure classes and are not counted.
export const HOSTED_PROVIDER_REJECTION_REPLY_THRESHOLD = 1;
export const HOSTED_PROVIDER_REJECTION_WINDOW_MS = 30 * 60_000;
export const HOSTED_PROVIDER_REJECTION_REMINDER_INTERVAL_MS = 60 * 60_000;

const REJECTED_ERROR_CODE = "ASSISTANT_CODEX_FAILED";
// Only the runner's finite error kinds leave the diagnostic database in an
// email; any other string reads `other` and a missing value reads `none`.
const EMAIL_CODEX_ERROR_INFOS = [
  "flexUnavailable", "httpConnectionFailed", "internalServerError", "modelNotFound",
  "policyCapacityUnavailable", "responseStreamConnectionFailed", "responseStreamDisconnected",
  "responseTooManyFailedAttempts", "serverOverloaded", "unrecognized", "usageLimitExceeded",
];

type RejectedReplies = { errorInfo: string; httpStatus: string; failedReplyCount: number };
type ProviderRejectionHealth = {
  anomalous: boolean;
  failedReplyCount: number;
  memberCount: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
  failures: RejectedReplies[];
};
type LogDatabase = Pick<HostedRuntimeLogSqlDatabase, "query">;

export async function readHostedProviderRejectionHealth(input: {
  now: Date;
  database?: LogDatabase;
}): Promise<ProviderRejectionHealth> {
  const database = input.database ?? getHostedRuntimeLogPool();
  const window = [new Date(input.now.getTime() - HOSTED_PROVIDER_REJECTION_WINDOW_MS), input.now];
  // Time-indexed aggregate only; one row per allowlisted label pair, no member lookup.
  const rejected = await database.query<{
    errorInfo: string; httpStatus: string; failedReplyCount: string;
    totalMemberCount: string; firstFailureAt: string; lastFailureAt: string;
  }>(`
    WITH rejected AS (
      SELECT subject_key, at,
        CASE WHEN redacted_json->>'failureCodexErrorInfo' IS NULL THEN 'none'
          WHEN redacted_json->>'failureCodexErrorInfo' = ANY($4::text[])
            THEN redacted_json->>'failureCodexErrorInfo'
          ELSE 'other' END AS error_info,
        CASE WHEN redacted_json->>'failureCodexErrorHttpStatusCode' IS NULL THEN 'none'
          WHEN jsonb_typeof(redacted_json->'failureCodexErrorHttpStatusCode') = 'number'
            AND redacted_json->>'failureCodexErrorHttpStatusCode' ~ '^[1-5][0-9][0-9]$'
            THEN redacted_json->>'failureCodexErrorHttpStatusCode'
          ELSE 'other' END AS http_status
      FROM hosted_runtime_log
      WHERE at >= $1 AND at <= $2
        AND event_code = 'assistant.automation_detail'
        AND redacted_json->>'type' = 'input.reply-failed'
        AND coalesce(redacted_json->>'errorCode', error_code, '') = $3
        AND redacted_json->>'failureCodexFailureStage' = 'turn_failed'
        AND redacted_json->'failureRetryable' = 'false'::jsonb
        AND CASE WHEN jsonb_typeof(redacted_json->'failureProviderActionCount') = 'number'
          THEN (redacted_json->>'failureProviderActionCount')::numeric = 0 ELSE false END
    )
    SELECT
      error_info AS "errorInfo",
      http_status AS "httpStatus",
      count(*)::text AS "failedReplyCount",
      (SELECT count(DISTINCT subject_key) FROM rejected)::text AS "totalMemberCount",
      (SELECT to_char(min(at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM rejected) AS "firstFailureAt",
      (SELECT to_char(max(at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM rejected) AS "lastFailureAt"
    FROM rejected
    GROUP BY 1, 2
    ORDER BY count(*) DESC, 1, 2
  `, [...window, REJECTED_ERROR_CODE, EMAIL_CODEX_ERROR_INFOS]);
  const failedReplyCount = rejected.rows.reduce((total, row) => total + Number(row.failedReplyCount), 0);
  return {
    anomalous: failedReplyCount >= HOSTED_PROVIDER_REJECTION_REPLY_THRESHOLD,
    failedReplyCount,
    memberCount: Number(rejected.rows[0]?.totalMemberCount ?? 0),
    firstFailureAt: rejected.rows[0]?.firstFailureAt ?? null,
    lastFailureAt: rejected.rows[0]?.lastFailureAt ?? null,
    failures: rejected.rows.map(row => ({
      errorInfo: row.errorInfo, httpStatus: row.httpStatus, failedReplyCount: Number(row.failedReplyCount),
    })),
  };
}

export async function runHostedProviderRejectionAlertMonitor(input: {
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
  const readHealth = ({ now }: { now: Date }) => readHostedProviderRejectionHealth({
    now, database: input.database,
  });
  const health = await readHealth({ now });
  const spec: HostedOperationalAlertMonitorSpec<ProviderRejectionHealth, HostedOperationalAlertPrismaClient> = {
    id: "hosted-provider-request-rejection-monitor:v1",
    kind: "hosted_provider_request_rejection_monitor",
    idempotencyScope: "murph/provider-request-rejection",
    subject: "Murph replies are failing: the model provider is rejecting requests",
    reminderIntervalMs: HOSTED_PROVIDER_REJECTION_REMINDER_INTERVAL_MS,
    // Members get no reply while this lasts, and quiet hours outlast the 30-minute window.
    sendDuringQuietHours: true,
    status: { healthy: "provider_rejection_healthy", alerting: "provider_rejection_alerting",
      alertSending: "provider_rejection_sending", alertFailed: "provider_rejection_failed" },
    error: {
      incidentInvalidCode: "PROVIDER_REJECTION_INCIDENT_INVALID", incidentInvalidMessage: "Provider rejection incident is invalid.",
      messageInvalidCode: "PROVIDER_REJECTION_MESSAGE_INVALID", messageInvalidMessage: "Provider rejection message is invalid.",
      sendFailedCode: "PROVIDER_REJECTION_SEND_FAILED", sendFailedMessage: "Provider rejection alert delivery failed.",
      stateInvalidCode: "PROVIDER_REJECTION_STATE_INVALID", stateInvalidMessage: "Provider rejection alert state is invalid.",
      unknownSendErrorCode: "PROVIDER_REJECTION_SEND_FAILED",
    },
    readHealth,
    buildDetails: ({ health, incidentId, now, phase, message }) => ({
      schema: "murph.provider-request-rejection-alert.v1", health,
      incidentId, phase, lastEvaluatedAt: now.toISOString(), message: message ?? null,
    }),
    buildMessage: ({ health, now }) => [
      `Replies the model provider rejected in the trailing ${HOSTED_PROVIDER_REJECTION_WINDOW_MS / 60_000} minutes: ${health.failedReplyCount}. Members affected: ${health.memberCount}.`,
      `First failure ${health.firstFailureAt}. Last failure ${health.lastFailureAt}.`,
      "The provider refused each request before doing any work, so retrying will not help. Each affected member got no reply to that message.",
      "By provider error kind and HTTP status:",
      ...health.failures.map(row => `${row.errorInfo}, HTTP status ${row.httpStatus}: ${row.failedReplyCount}.`),
      "First step: check for a recent runner deploy, a Codex or model catalog change, or a provider-side change. The runner's container logs carry the provider's error text.",
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

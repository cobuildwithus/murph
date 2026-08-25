import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

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

export const HOSTED_AI_USAGE_OVERSHOOT_PERCENT = 20;

const MONITOR_ID = "hosted-ai-usage-overshoot-monitor:v1";
const MONITOR_KIND = "hosted_ai_usage_overshoot_monitor";
const MONITOR_SCHEMA = "murph.hosted-ai-usage-overshoot-monitor.v1";
const MONITOR_SUBJECT = "Hosted AI allowance overshoot exceeded";
const MONITOR_STATUS = {
  alertFailed: "usage_overshoot_alert_failed",
  alertSending: "usage_overshoot_alert_sending",
  alerting: "usage_overshoot_alerting",
  healthy: "usage_overshoot_healthy",
} as const;

type HostedAiUsageOvershootPrismaClient =
  & Pick<PrismaClient, "$queryRaw">
  & HostedOperationalAlertPrismaClient;

export interface HostedAiUsageOvershootHealth {
  anomalous: boolean;
  thresholdPercent: number;
}

export interface HostedAiUsageOvershootAlertMonitorResult {
  configured: boolean;
  health: HostedAiUsageOvershootHealth;
  outcome: HostedOperationalAlertMonitorOutcome | "disabled";
}

const MONITOR_SPEC: HostedOperationalAlertMonitorSpec<
  HostedAiUsageOvershootHealth,
  HostedAiUsageOvershootPrismaClient
> = {
  buildDetails: ({ health, incidentId, message, now, phase }) => ({
    health: {
      anomalous: health.anomalous,
      thresholdPercent: health.thresholdPercent,
    },
    incidentId,
    lastEvaluatedAt: now.toISOString(),
    message: message ?? null,
    phase,
    schema: MONITOR_SCHEMA,
  }),
  buildMessage: ({ notificationKind, now }) => [
    notificationKind === "reminder"
      ? "Murph managed AI allowance overshoot reminder."
      : "Murph managed AI allowance overshoot alert.",
    `At least one current allowance exceeded its cap by more than ${HOSTED_AI_USAGE_OVERSHOOT_PERCENT}%.`,
    `Checked ${now.toISOString().replace(".000Z", "Z")}.`,
  ].join(" "),
  error: {
    incidentInvalidCode: "HOSTED_AI_USAGE_OVERSHOOT_ALERT_INCIDENT_INVALID",
    incidentInvalidMessage: "Hosted AI usage overshoot alert incident is invalid.",
    messageInvalidCode: "HOSTED_AI_USAGE_OVERSHOOT_ALERT_MESSAGE_INVALID",
    messageInvalidMessage: "Hosted AI usage overshoot alert message is invalid.",
    sendFailedCode: "HOSTED_AI_USAGE_OVERSHOOT_ALERT_SEND_FAILED",
    sendFailedMessage: "Hosted AI usage overshoot alert send failed.",
    stateInvalidCode: "HOSTED_AI_USAGE_OVERSHOOT_ALERT_STATE_INVALID",
    stateInvalidMessage: "Hosted AI usage overshoot alert state is invalid.",
    unknownSendErrorCode: "UNKNOWN_AI_USAGE_OVERSHOOT_ALERT_ERROR",
  },
  id: MONITOR_ID,
  idempotencyScope: "murph/ai-usage-overshoot",
  kind: MONITOR_KIND,
  readHealth: readHostedAiUsageOvershootHealth,
  subject: MONITOR_SUBJECT,
  status: MONITOR_STATUS,
};

export async function runHostedAiUsageOvershootAlertMonitor(input: {
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  prisma?: HostedAiUsageOvershootPrismaClient;
  sendAlert?: HostedOperationalAlertSend;
  signal?: AbortSignal;
} = {}): Promise<HostedAiUsageOvershootAlertMonitorResult> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const health = await readHostedAiUsageOvershootHealth({ now, prisma });
  const alertConfig = readHostedRuntimeLatencyAlertConfig(
    input.env ?? process.env,
  );
  if (!alertConfig) {
    return { configured: false, health, outcome: "disabled" };
  }

  const result = await runHostedOperationalEmailIncident({
    alertConfig,
    initialHealth: health,
    initialNow: now,
    now: input.now,
    prisma,
    sendAlert: input.sendAlert,
    signal: input.signal,
    spec: MONITOR_SPEC,
  });
  return { configured: true, health: result.health, outcome: result.outcome };
}

export async function readHostedAiUsageOvershootHealth(input: {
  now?: Date;
  prisma?: Pick<PrismaClient, "$queryRaw">;
} = {}): Promise<HostedAiUsageOvershootHealth> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  // The alert needs only existence, not a global count or private member data.
  // Current blocked periods are indexed and EXISTS stops at the first breach.
  const rows = await prisma.$queryRaw<Array<{ exceeded: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM hosted_ai_usage_period AS period
      WHERE period.blocked_at IS NOT NULL
        AND period.period_start <= ${now}
        AND period.period_end > ${now}
        AND period.spent_usd_micros * 5 > period.limit_usd_micros * 6
      LIMIT 1
    ) AS "exceeded"
  `);
  return {
    anomalous: rows[0]?.exceeded === true,
    thresholdPercent: HOSTED_AI_USAGE_OVERSHOOT_PERCENT,
  };
}

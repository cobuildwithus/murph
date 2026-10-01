import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  runHostedOperationalEmailIncident,
  type HostedOperationalAlertMonitorOutcome,
  type HostedOperationalAlertMonitorSpec,
  type HostedOperationalAlertPrismaClient,
  type HostedOperationalAlertSend,
} from "../hosted-operational-alert/incident-email-monitor";
import { readHostedOperationalAlertEmailConfig } from "../hosted-onboarding/operational-alert-email-config";
import { HOSTED_STARTER_USAGE_SEMANTIC_SOURCE_PREFIX } from "../hosted-onboarding/starter-usage";
import { getPrisma } from "../prisma";

export const HOSTED_STARTER_SIGNUP_BURST_THRESHOLD = 10;
export const HOSTED_STARTER_RAPID_USE_THRESHOLD = 3;

const RECENT_MEMBER_LIMIT = 1_000;

const MONITOR_ID = "hosted-starter-abuse-monitor:v1";
const MONITOR_KIND = "hosted_starter_abuse_monitor";
const MONITOR_SCHEMA = "murph.hosted-starter-abuse-monitor.v1";
const MONITOR_SUBJECT = "Hosted Starter abuse signals detected";
const MONITOR_STATUS = {
  alertFailed: "starter_abuse_alert_failed",
  alertSending: "starter_abuse_alert_sending",
  alerting: "starter_abuse_alerting",
  healthy: "starter_abuse_healthy",
} as const;

type HostedStarterAbusePrismaClient =
  & Pick<PrismaClient, "$queryRaw">
  & HostedOperationalAlertPrismaClient;

export interface HostedStarterAbuseHealth {
  anomalous: boolean;
  recentSignups: number;
  rapidUseAccounts: number;
  sampleSaturated: boolean;
}

export interface HostedStarterAbuseAlertMonitorResult {
  configured: boolean;
  health: HostedStarterAbuseHealth;
  outcome: HostedOperationalAlertMonitorOutcome | "disabled";
}

const MONITOR_SPEC: HostedOperationalAlertMonitorSpec<
  HostedStarterAbuseHealth,
  HostedStarterAbusePrismaClient
> = {
  buildDetails: ({ health, incidentId, message, now, phase }) => ({
    health: {
      anomalous: health.anomalous,
      recentSignups: health.recentSignups,
      rapidUseAccounts: health.rapidUseAccounts,
      sampleSaturated: health.sampleSaturated,
    },
    incidentId,
    lastEvaluatedAt: now.toISOString(),
    message: message ?? null,
    phase,
    schema: MONITOR_SCHEMA,
  }),
  buildMessage: ({ health, notificationKind, now }) => [
    notificationKind === "reminder" ? "Murph Starter abuse signal reminder." : "Murph Starter abuse signal alert.",
    `${health.recentSignups} Starter accounts joined in 15 minutes; ${health.rapidUseAccounts} accounts created in the past hour used at least half their Starter grant.`,
    `Alert thresholds: ${HOSTED_STARTER_SIGNUP_BURST_THRESHOLD} signups or ${HOSTED_STARTER_RAPID_USE_THRESHOLD} rapidly used grants.`,
    health.sampleSaturated ? "The bounded recent-account sample is full; counts are lower bounds." : "",
    "These are signals to investigate, not confirmed abuse. Review https://www.withmurph.ai/ops/growth .",
    `Checked ${now.toISOString().replace(".000Z", "Z")}.`,
  ].filter(Boolean).join(" "),
  error: {
    incidentInvalidCode: "HOSTED_STARTER_ABUSE_ALERT_INCIDENT_INVALID",
    incidentInvalidMessage: "Hosted Starter abuse alert incident is invalid.",
    messageInvalidCode: "HOSTED_STARTER_ABUSE_ALERT_MESSAGE_INVALID",
    messageInvalidMessage: "Hosted Starter abuse alert message is invalid.",
    sendFailedCode: "HOSTED_STARTER_ABUSE_ALERT_SEND_FAILED",
    sendFailedMessage: "Hosted Starter abuse alert send failed.",
    stateInvalidCode: "HOSTED_STARTER_ABUSE_ALERT_STATE_INVALID",
    stateInvalidMessage: "Hosted Starter abuse alert state is invalid.",
    unknownSendErrorCode: "UNKNOWN_STARTER_ABUSE_ALERT_ERROR",
  },
  id: MONITOR_ID,
  idempotencyScope: "murph/starter-abuse",
  kind: MONITOR_KIND,
  readHealth: readHostedStarterAbuseHealth,
  subject: MONITOR_SUBJECT,
  sendDuringQuietHours: true,
  status: MONITOR_STATUS,
};

export async function runHostedStarterAbuseAlertMonitor(input: {
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  prisma?: HostedStarterAbusePrismaClient;
  sendAlert?: HostedOperationalAlertSend;
  signal?: AbortSignal;
} = {}): Promise<HostedStarterAbuseAlertMonitorResult> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const health = await readHostedStarterAbuseHealth({ now, prisma });
  const email = readHostedOperationalAlertEmailConfig(input.env ?? process.env);
  if (!email) {
    return { configured: false, health, outcome: "disabled" };
  }

  const result = await runHostedOperationalEmailIncident({
    alertConfig: { email, timeZone: "UTC" },
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

export async function readHostedStarterAbuseHealth(input: {
  now?: Date;
  prisma?: Pick<PrismaClient, "$queryRaw">;
} = {}): Promise<HostedStarterAbuseHealth> {
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const hourStart = new Date(now.getTime() - 60 * 60_000);
  const quarterHourStart = new Date(now.getTime() - 15 * 60_000);
  // The created-at index bounds the outer read; each account uses the existing
  // beneficiary/kind index and grant primary key. Never scan global usage rows.
  const rows = await prisma.$queryRaw<Array<{
    recentSignups: number; rapidUseAccounts: number; sampleSize: number;
  }>>(Prisma.sql`
    WITH recent AS MATERIALIZED (
      SELECT id, created_at FROM hosted_member
      WHERE created_at >= ${hourStart} AND created_at < ${now}
      ORDER BY created_at DESC, id DESC LIMIT ${RECENT_MEMBER_LIMIT}
    ), starters AS (
      SELECT recent.created_at, entry.amount_usd_micros, capacity.remaining_usd_micros
      FROM recent
      JOIN LATERAL (
        SELECT id, amount_usd_micros FROM hosted_usage_credit_entry
        WHERE beneficiary_member_id = recent.id AND kind = 'starter_grant'
          AND semantic_source_key LIKE ${`${HOSTED_STARTER_USAGE_SEMANTIC_SOURCE_PREFIX}:%`}
          AND amount_usd_micros > 0
        ORDER BY beneficiary_sequence LIMIT 1
      ) entry ON true
      JOIN hosted_usage_credit_grant capacity ON capacity.entry_id = entry.id
    )
    SELECT (COUNT(*) FILTER (WHERE created_at >= ${quarterHourStart}))::int AS "recentSignups",
      (COUNT(*) FILTER (WHERE remaining_usd_micros * 2 <= amount_usd_micros))::int AS "rapidUseAccounts",
      (SELECT COUNT(*)::int FROM recent) AS "sampleSize"
    FROM starters
  `);
  const row = rows[0];
  if (!row || !Number.isInteger(row.recentSignups) || !Number.isInteger(row.rapidUseAccounts)
    || !Number.isInteger(row.sampleSize)) throw new TypeError("Invalid Starter abuse signal counts.");
  const sampleSaturated = row.sampleSize >= RECENT_MEMBER_LIMIT;
  return {
    anomalous: row.recentSignups >= HOSTED_STARTER_SIGNUP_BURST_THRESHOLD
      || row.rapidUseAccounts >= HOSTED_STARTER_RAPID_USE_THRESHOLD || sampleSaturated,
    recentSignups: row.recentSignups,
    rapidUseAccounts: row.rapidUseAccounts,
    sampleSaturated,
  };
}

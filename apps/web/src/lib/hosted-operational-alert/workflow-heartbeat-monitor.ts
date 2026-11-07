import "server-only";

import { readHostedRuntimeLatencyAlertConfig } from "../hosted-runtime-latency/alert-monitor";
import { getPrisma } from "../prisma";
import { runHostedOperationalEmailIncident, type HostedOperationalAlertMonitorSpec,
  type HostedOperationalAlertPrismaClient, type HostedOperationalAlertSend } from "./incident-email-monitor";
import { advanceWorkflowHeartbeat, readWorkflowHeartbeatHealth,
  type HeartbeatEngine, type WorkflowHeartbeatHealth } from "./workflow-heartbeat-state";

const spec: HostedOperationalAlertMonitorSpec<WorkflowHeartbeatHealth, HostedOperationalAlertPrismaClient> = {
  id: "hosted-workflow-heartbeat-monitor:v1", kind: "workflow_heartbeat_monitor",
  idempotencyScope: "murph/workflow-heartbeat", subject: "Workflow engine heartbeat overdue",
  reminderIntervalMs: 6 * 60 * 60_000, sendDuringQuietHours: true,
  status: { healthy: "workflow_heartbeat_healthy", alerting: "workflow_heartbeat_alerting",
    alertSending: "workflow_heartbeat_sending", alertFailed: "workflow_heartbeat_failed" },
  error: {
    incidentInvalidCode: "WORKFLOW_HEARTBEAT_INCIDENT_INVALID", incidentInvalidMessage: "Workflow heartbeat incident is invalid.",
    messageInvalidCode: "WORKFLOW_HEARTBEAT_MESSAGE_INVALID", messageInvalidMessage: "Workflow heartbeat message is invalid.",
    sendFailedCode: "WORKFLOW_HEARTBEAT_SEND_FAILED", sendFailedMessage: "Workflow heartbeat alert delivery failed.",
    stateInvalidCode: "WORKFLOW_HEARTBEAT_STATE_INVALID", stateInvalidMessage: "Workflow heartbeat alert state is invalid.",
    unknownSendErrorCode: "WORKFLOW_HEARTBEAT_SEND_FAILED",
  },
  readHealth: readWorkflowHeartbeatHealth,
  buildDetails: ({ health, incidentId, now, phase, message }) => ({
    schema: "murph.workflow-heartbeat-alert.v1", health,
    incidentId, phase, lastEvaluatedAt: now.toISOString(), message: message ?? null,
  }),
  buildMessage: ({ health, now, notificationKind }) => [
    `${notificationKind === "reminder" ? "Reminder: " : ""}No Workflow heartbeat completion within 30 minutes.`,
    `First start intent: ${health.firstStartedAt}. Latest start intent: ${health.lastStartedAt}.`,
    `Last completion: ${health.lastCompletedAt ?? "none"}. Latest observation: ${health.status}.`,
    "The cron observes a one-step Workflow independently of product traffic. Inspect Workflow flow endpoint failures and deployment health.",
    `Checked ${now.toISOString()}.`,
  ].join("\n"),
};

export async function runHostedWorkflowHeartbeatAlertMonitor(input: {
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  prisma?: HostedOperationalAlertPrismaClient;
  engine?: HeartbeatEngine;
  sendAlert?: HostedOperationalAlertSend;
  signal?: AbortSignal;
} = {}) {
  const alertConfig = readHostedRuntimeLatencyAlertConfig(input.env ?? process.env);
  if (!alertConfig) return { configured: false, outcome: "disabled" as const };
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  await advanceWorkflowHeartbeat({ now, prisma, engine: input.engine });
  const health = await readWorkflowHeartbeatHealth({ now, prisma });
  return { configured: true, ...await runHostedOperationalEmailIncident({
    alertConfig, initialHealth: health, initialNow: now, now: input.now,
    prisma, sendAlert: input.sendAlert, signal: input.signal, spec,
  }) };
}

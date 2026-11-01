import "server-only";

import { readHostedRuntimeLatencyAlertConfig } from "../hosted-runtime-latency/alert-monitor";
import { getPrisma } from "../prisma";
import { runHostedOperationalEmailIncident, type HostedOperationalAlertMonitorSpec,
  type HostedOperationalAlertSend } from "./incident-email-monitor";
import { readToolFailureHealth, type ToolFailureCondition, type ToolFailureHealth,
  type ToolFailurePrisma } from "./tool-failure-health";

export async function runHostedToolFailureAlertMonitor(input: {
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  prisma?: ToolFailurePrisma;
  sendAlert?: HostedOperationalAlertSend;
  signal?: AbortSignal;
} = {}) {
  const alertConfig = readHostedRuntimeLatencyAlertConfig(input.env ?? process.env);
  if (!alertConfig) return { configured: false, conditions: [] };
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const health = await readToolFailureHealth({ now, prisma });
  const conditions = [];
  let firstError: unknown;
  // Separate incidents keep a continuing backend problem from hiding a phone failure.
  for (const condition of ["phone", "backend"] as const) {
    try {
      conditions.push({ condition, ...await runHostedOperationalEmailIncident({
        alertConfig, initialHealth: health[condition], initialNow: now, now: input.now,
        prisma, sendAlert: input.sendAlert, signal: input.signal, spec: toolFailureSpec(condition),
      }) });
    } catch (error) { firstError ??= error; }
  }
  if (firstError) throw firstError;
  return { configured: true, conditions };
}

function toolFailureSpec(condition: ToolFailureCondition): HostedOperationalAlertMonitorSpec<ToolFailureHealth, ToolFailurePrisma> {
  const prefix = `tool_failure_${condition}`;
  return {
    id: `hosted-tool-failure-${condition}:v1`, kind: prefix,
    idempotencyScope: `murph/tool-failure-${condition}`,
    subject: condition === "phone" ? "Phone call start failures" : "Dynamic tool backend failures",
    reminderIntervalMs: 6 * 60 * 60_000, sendDuringQuietHours: true,
    status: { healthy: `${prefix}_healthy`, alerting: `${prefix}_alerting`,
      alertSending: `${prefix}_sending`, alertFailed: `${prefix}_failed` },
    error: {
      incidentInvalidCode: "TOOL_FAILURE_INCIDENT_INVALID", incidentInvalidMessage: "Tool failure incident is invalid.",
      messageInvalidCode: "TOOL_FAILURE_MESSAGE_INVALID", messageInvalidMessage: "Tool failure message is invalid.",
      sendFailedCode: "TOOL_FAILURE_SEND_FAILED", sendFailedMessage: "Tool failure alert delivery failed.",
      stateInvalidCode: "TOOL_FAILURE_STATE_INVALID", stateInvalidMessage: "Tool failure alert state is invalid.",
      unknownSendErrorCode: "TOOL_FAILURE_SEND_FAILED",
    },
    readHealth: async input => (await readToolFailureHealth(input))[condition],
    buildDetails: ({ health, incidentId, now, phase, message }) => ({
      schema: "murph.tool-failure-alert.v1", condition, health,
      incidentId, phase, lastEvaluatedAt: now.toISOString(), message: message ?? null,
    }),
    buildMessage: ({ health, now, notificationKind }) => [
      `${notificationKind === "reminder" ? "Reminder: " : ""}${condition === "phone" ? "Phone call start failure" : "Dynamic tool backend failure threshold reached"}.`,
      `Trailing hour: ${health.count} failure observations${health.sampleCapped ? " (sample capped; counts are lower bounds)" : ""}.`,
      "Tool issues and phone rows are separate observations and may describe the same failed attempt.",
      ...health.groups.slice(0, 40).map(row => `${row.operation} (${row.source}): ${row.count}; reason=${row.reason}; category=${row.category}; first=${row.firstAt}; last=${row.lastAt}; release=${row.releaseSha ?? "unavailable"}.`),
      ...(health.groups.length > 40 ? [`Additional category/release groups omitted: ${health.groups.length - 40}.`] : []),
      `Checked ${now.toISOString()}.`,
    ].join("\n"),
  };
}

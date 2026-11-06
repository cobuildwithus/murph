import "server-only";

import { runHostedOperationalEmailIncident, type HostedOperationalAlertMonitorSpec,
  type HostedOperationalAlertSend } from "../hosted-operational-alert/incident-email-monitor";
import { readHostedRuntimeLatencyAlertConfig } from "../hosted-runtime-latency/alert-monitor";
import { getPrisma } from "../prisma";
import { readDeviceImportHealth, type DeviceImportPrisma } from "./device-import-observation";
import type { DeviceImportCondition, DeviceImportHealth } from "./device-import-health";

const DESCRIPTIONS = {
  stalled: "Pending device imports have no checkpointed continuation progress for at least 15 minutes.",
  cycling: "Device imports had at least four runtime starts or outer cancellations in 20 minutes, with fewer than two checkpointed progress passes.",
  backlog: "A device import backlog has remained active for at least one hour. This is an efficiency notice; progress may be healthy.",
} satisfies Record<DeviceImportCondition, string>;
const CONDITIONS = ["stalled", "cycling", "backlog"] as const;

export async function runHostedDeviceImportAlertMonitor(input: {
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  prisma?: DeviceImportPrisma;
  readHealth?: typeof readDeviceImportHealth;
  sendAlert?: HostedOperationalAlertSend;
  signal?: AbortSignal;
} = {}) {
  const alertConfig = readHostedRuntimeLatencyAlertConfig(input.env ?? process.env);
  if (!alertConfig) return { configured: false, conditions: [] };
  const now = input.now ?? new Date();
  const prisma = input.prisma ?? getPrisma();
  const readHealth = input.readHealth ?? readDeviceImportHealth;
  const health = await readHealth({ now, prisma });
  // Independent incident identities: a continuing backlog notice cannot hide
  // a new stall. Run serially to bound primary/log pool and provider fanout.
  const outcomes = [];
  let firstError: unknown;
  for (const condition of CONDITIONS) {
    try {
      outcomes.push({ condition, ...await runHostedOperationalEmailIncident({
        alertConfig, initialHealth: health[condition], initialNow: now,
        now: input.now, prisma, sendAlert: input.sendAlert, signal: input.signal,
        spec: makeSpec(condition, readHealth),
      }) });
    } catch (error) { firstError ??= error; }
  }
  if (firstError) throw firstError;
  return { configured: true, conditions: outcomes };
}

function makeSpec(condition: DeviceImportCondition, readHealth: typeof readDeviceImportHealth):
  HostedOperationalAlertMonitorSpec<DeviceImportHealth, DeviceImportPrisma> {
  const prefix = `device_import_${condition}`;
  return {
    id: `hosted-device-import-${condition}:v1`, kind: prefix,
    idempotencyScope: `murph/device-import-${condition}`,
    subject: condition === "backlog" ? "Device import backlog notice" : `Device imports ${condition}`,
    reminderIntervalMs: 6 * 60 * 60_000,
    ...(condition === "stalled" ? { sendDuringQuietHours: true as const } : {}),
    status: { healthy: `${prefix}_healthy`, alerting: `${prefix}_alerting`,
      alertSending: `${prefix}_sending`, alertFailed: `${prefix}_failed` },
    error: {
      incidentInvalidCode: "DEVICE_IMPORT_ALERT_INCIDENT_INVALID", incidentInvalidMessage: "Device import alert incident is invalid.",
      messageInvalidCode: "DEVICE_IMPORT_ALERT_MESSAGE_INVALID", messageInvalidMessage: "Device import alert message is invalid.",
      sendFailedCode: "DEVICE_IMPORT_ALERT_SEND_FAILED", sendFailedMessage: "Device import alert delivery failed.",
      stateInvalidCode: "DEVICE_IMPORT_ALERT_STATE_INVALID", stateInvalidMessage: "Device import alert state is invalid.",
      unknownSendErrorCode: "DEVICE_IMPORT_ALERT_SEND_FAILED",
    },
    readHealth: async input => (await readHealth(input))[condition],
    buildDetails: ({ health, incidentId, now, phase, message }) => ({
      schema: "murph.device-import-alert.v1", condition, health: { ...health },
      incidentId, phase, lastEvaluatedAt: now.toISOString(), message: message ?? null,
    }),
    buildMessage: ({ health, now }) => [
      DESCRIPTIONS[condition],
      `Affected runtimes: ${health.affectedRuntimeCount}. Oldest observed backlog: ${Math.floor(health.oldestBacklogMs / 60_000)} minutes.`,
      `Last 20 minutes: ${health.restartCount} starts, ${health.cancellationCount} outer cancellations, ${health.savedProgressPassCount} checkpointed progress passes.`,
      "Inspect device-sync.pass_finished and checkpoint.snapshot_finished in hosted runtime diagnostics. No automatic restart was requested.",
      `Checked ${now.toISOString()}.`,
    ].join("\n"),
  };
}

import { parseHostedExecutionDeviceSyncWakeHint } from "@murphai/device-syncd/hosted-runtime";
import {
  type HostedExecutionDeviceSyncWakeEvent,
  buildHostedExecutionDeviceSyncWake as buildCanonicalHostedExecutionDeviceSyncWake,
} from "@murphai/hosted-execution";

import { toJsonRecord } from "./shared";

export type HostedDeviceSyncWakeSource =
  | "connection-established"
  | "disconnect"
  | "scheduled-reconcile"
  | "webhook-dirty-compat";

export function buildHostedDeviceSyncWake(input: {
  connectionId: string;
  eventId?: string | null;
  hint?: HostedExecutionDeviceSyncWakeEvent["hint"] | null;
  occurredAt: string;
  provider: string;
  source: HostedDeviceSyncWakeSource;
  traceId?: string | null;
  userId: string;
}) {
  return buildCanonicalHostedExecutionDeviceSyncWake({
    connectionId: input.connectionId,
    eventId: input.eventId ?? buildHostedDeviceSyncWakeEventId(input),
    hint: input.hint,
    occurredAt: input.occurredAt,
    provider: input.provider,
    reason: mapHostedDeviceSyncWakeReason(input.source),
    userId: input.userId,
  });
}

export function buildHostedDeviceSyncWakeFromSignal(input: {
  connectionId: string | null;
  eventId: string;
  occurredAt: string;
  provider: string | null;
  signalKind: string;
  signalPayload?: Record<string, unknown> | null;
  userId: string;
}) {
  return buildCanonicalHostedExecutionDeviceSyncWake({
    connectionId: input.connectionId,
    eventId: input.eventId,
    hint: input.signalPayload
      ? parseHostedExecutionDeviceSyncWakeHint(toJsonRecord(input.signalPayload))
      : null,
    occurredAt: input.occurredAt,
    provider: input.provider,
    reason: mapHostedDeviceSyncWakeReasonFromSignalKind(input.signalKind),
    userId: input.userId,
  });
}

export function buildHostedDeviceSyncWakeEventId(input: {
  connectionId: string;
  occurredAt: string;
  provider: string;
  source: HostedDeviceSyncWakeSource;
  traceId?: string | null;
  userId: string;
}): string {
  return [
    "device-sync",
    input.source,
    input.userId,
    input.provider,
    input.connectionId,
    input.traceId ?? input.occurredAt,
  ].join(":");
}

export function mapHostedDeviceSyncWakeReason(
  source: HostedDeviceSyncWakeSource,
): HostedExecutionDeviceSyncWakeEvent["reason"] {
  switch (source) {
    case "connection-established":
      return "connected";
    case "disconnect":
      return "disconnected";
    case "scheduled-reconcile":
      return "reconcile_due";
    case "webhook-dirty-compat":
      return "webhook_hint";
    default:
      throw new Error(`Unsupported hosted device-sync wake source: ${String(source)}`);
  }
}

export function mapHostedDeviceSyncWakeReasonFromSignalKind(
  signalKind: string,
): HostedExecutionDeviceSyncWakeEvent["reason"] {
  switch (signalKind) {
    case "connected":
      return "connected";
    case "disconnected":
      return "disconnected";
    case "webhook_hint":
      return "webhook_hint";
    case "reauthorization_required":
      return "reauthorization_required";
    case "reconcile_due":
      return "reconcile_due";
    default:
      throw new Error(`Unsupported device-sync signal kind for hosted execution: ${signalKind}`);
  }
}

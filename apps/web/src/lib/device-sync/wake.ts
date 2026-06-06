import {
  type HostedExecutionDeviceSyncWakeEvent,
  buildHostedExecutionDeviceSyncWake as buildCanonicalHostedExecutionDeviceSyncWake,
} from "@murphai/hosted-execution";

export type HostedDeviceSyncWakeSource =
  | "connection-established"
  | "disconnect"
  | "webhook-hint"
  | "scheduled-reconcile";

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
    case "webhook-hint":
      return "webhook_hint";
    case "scheduled-reconcile":
      return "reconcile_due";
    default:
      throw new Error(`Unsupported hosted device-sync wake source: ${String(source)}`);
  }
}

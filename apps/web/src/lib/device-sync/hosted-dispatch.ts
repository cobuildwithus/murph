import {
  buildHostedExecutionDeviceSyncWakeDispatch,
  type HostedExecutionDispatchRequest,
} from "@healthybob/hosted-execution";

export type HostedDeviceSyncWakeSource = "connection-established" | "disconnect" | "webhook-accepted";

export function buildHostedDeviceSyncWakeDispatch(input: {
  connectionId: string;
  occurredAt: string;
  provider: string;
  source: HostedDeviceSyncWakeSource;
  traceId?: string | null;
  userId: string;
}): HostedExecutionDispatchRequest {
  return buildHostedExecutionDeviceSyncWakeDispatch({
    eventId: buildHostedDeviceSyncWakeEventId(input),
    occurredAt: input.occurredAt,
    reason: mapHostedDeviceSyncWakeReason(input.source),
    userId: input.userId,
  });
}

export function buildHostedDeviceSyncWakeDispatchFromSignal(input: {
  eventId: string;
  occurredAt: string;
  signalKind: string;
  userId: string;
}): HostedExecutionDispatchRequest {
  return buildHostedExecutionDeviceSyncWakeDispatch({
    eventId: input.eventId,
    occurredAt: input.occurredAt,
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
): Extract<HostedExecutionDispatchRequest["event"], { kind: "device-sync.wake" }>["reason"] {
  switch (source) {
    case "connection-established":
      return "connected";
    case "disconnect":
      return "disconnected";
    case "webhook-accepted":
      return "webhook_hint";
    default:
      return source satisfies never;
  }
}

export function mapHostedDeviceSyncWakeReasonFromSignalKind(
  signalKind: string,
): Extract<HostedExecutionDispatchRequest["event"], { kind: "device-sync.wake" }>["reason"] {
  switch (signalKind) {
    case "connected":
      return "connected";
    case "disconnected":
      return "disconnected";
    case "webhook_hint":
      return "webhook_hint";
    case "reauthorization_required":
      return "reauthorization_required";
    default:
      throw new Error(`Unsupported device-sync signal kind for hosted execution: ${signalKind}`);
  }
}

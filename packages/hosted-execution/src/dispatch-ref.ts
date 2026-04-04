import type {
  HostedExecutionDispatchRequest,
  HostedExecutionEventKind,
} from "./contracts.ts";
import { HOSTED_EXECUTION_EVENT_KINDS } from "./contracts.ts";

const HOSTED_EXECUTION_EVENT_KIND_SET = new Set<HostedExecutionEventKind>(HOSTED_EXECUTION_EVENT_KINDS);
const HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION = "murph.execution-outbox.v2";

export interface HostedExecutionDispatchRef {
  eventId: string;
  eventKind: HostedExecutionEventKind;
  occurredAt: string;
  userId: string;
}

export function buildHostedExecutionDispatchRef(
  dispatch: HostedExecutionDispatchRequest,
): HostedExecutionDispatchRef {
  return {
    eventId: dispatch.eventId,
    eventKind: dispatch.event.kind,
    occurredAt: dispatch.occurredAt,
    userId: dispatch.event.userId,
  };
}

export function readHostedExecutionDispatchRef(
  payloadJson: unknown,
): HostedExecutionDispatchRef | null {
  const payloadObject = toHostedExecutionObject(payloadJson);
  const nestedRef = toHostedExecutionObject(payloadObject.dispatchRef);
  const schemaVersion = readHostedExecutionText(payloadObject.schemaVersion);
  const storage = readHostedExecutionText(payloadObject.storage);

  if (schemaVersion !== HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION || storage !== "reference") {
    return null;
  }

  const eventId = readHostedExecutionText(nestedRef.eventId);
  const eventKind = readHostedExecutionEventKind(nestedRef.eventKind);
  const occurredAt = readHostedExecutionText(nestedRef.occurredAt);
  const userId = readHostedExecutionText(nestedRef.userId);

  if (!eventId || !eventKind || !occurredAt || !userId) {
    return null;
  }

  return {
    eventId,
    eventKind,
    occurredAt,
    userId,
  };
}

function readHostedExecutionEventKind(value: unknown): HostedExecutionEventKind | null {
  return typeof value === "string" && HOSTED_EXECUTION_EVENT_KIND_SET.has(value as HostedExecutionEventKind)
    ? value as HostedExecutionEventKind
    : null;
}

function readHostedExecutionText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function toHostedExecutionObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

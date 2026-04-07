import type {
  HostedExecutionDispatchRequest,
  HostedExecutionEventKind,
} from "./contracts.ts";
import {
  HOSTED_EXECUTION_EVENT_KINDS,
  HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KINDS,
} from "./contracts.ts";

const HOSTED_EXECUTION_EVENT_KIND_SET = new Set<HostedExecutionEventKind>(HOSTED_EXECUTION_EVENT_KINDS);
const HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KIND_SET = new Set<HostedExecutionEventKind>(
  HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KINDS,
);
const HOSTED_EXECUTION_DISPATCH_REF_KEYS = new Set([
  "eventId",
  "eventKind",
  "occurredAt",
  "userId",
]);

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
  const storage = readHostedExecutionText(payloadObject.storage);

  if (
    storage !== "reference"
    || !hasOnlyHostedExecutionKeys(nestedRef, HOSTED_EXECUTION_DISPATCH_REF_KEYS)
  ) {
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
  return typeof value === "string"
    && HOSTED_EXECUTION_EVENT_KIND_SET.has(value as HostedExecutionEventKind)
    && HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KIND_SET.has(value as HostedExecutionEventKind)
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

function hasOnlyHostedExecutionKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

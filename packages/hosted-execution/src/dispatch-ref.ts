import type {
  HostedExecutionDispatchRequest,
  HostedExecutionEventKind,
  HostedExecutionShareReference,
} from "./contracts.ts";
import { HOSTED_EXECUTION_EVENT_KINDS } from "./contracts.ts";

const HOSTED_EXECUTION_EVENT_KIND_SET = new Set<HostedExecutionEventKind>(HOSTED_EXECUTION_EVENT_KINDS);

export const HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION = "murph.execution-outbox.ref.v1";

export interface HostedExecutionDispatchRef {
  eventId: string;
  eventKind: HostedExecutionEventKind;
  occurredAt: string;
  share?: HostedExecutionShareReference;
  userId: string;
}

export interface HostedExecutionDispatchRefFallback {
  eventId: string;
  eventKind: string;
  occurredAt: string | null;
  userId: string;
}

export function buildHostedExecutionDispatchRef(
  dispatch: HostedExecutionDispatchRequest,
): HostedExecutionDispatchRef {
  return {
    eventId: dispatch.eventId,
    eventKind: dispatch.event.kind,
    occurredAt: dispatch.occurredAt,
    ...(dispatch.event.kind === "vault.share.accepted"
      ? {
          share: {
            shareCode: dispatch.event.share.shareCode,
            shareId: dispatch.event.share.shareId,
          } satisfies HostedExecutionShareReference,
        }
      : {}),
    userId: dispatch.event.userId,
  };
}

export function readHostedExecutionDispatchRef(
  payloadJson: unknown,
  fallback: HostedExecutionDispatchRefFallback,
): HostedExecutionDispatchRef | null {
  const payloadObject = toHostedExecutionObject(payloadJson);
  const nestedRef = toHostedExecutionObject(payloadObject.dispatchRef);
  const schemaVersion = readHostedExecutionText(payloadObject.schemaVersion);

  if (schemaVersion !== HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION) {
    return null;
  }

  const eventId = readHostedExecutionText(nestedRef.eventId) ?? fallback.eventId;
  const eventKind = readHostedExecutionEventKind(nestedRef.eventKind) ?? readHostedExecutionEventKind(fallback.eventKind);
  const occurredAt = readHostedExecutionText(nestedRef.occurredAt) ?? fallback.occurredAt;
  const share = readHostedExecutionShareReference(nestedRef.share);
  const userId = readHostedExecutionText(nestedRef.userId) ?? fallback.userId;

  if (!eventId || !eventKind || !occurredAt || !userId) {
    return null;
  }

  return {
    eventId,
    eventKind,
    occurredAt,
    ...(share ? { share } : {}),
    userId,
  };
}

function readHostedExecutionEventKind(value: unknown): HostedExecutionEventKind | null {
  return typeof value === "string" && HOSTED_EXECUTION_EVENT_KIND_SET.has(value as HostedExecutionEventKind)
    ? value as HostedExecutionEventKind
    : null;
}

function readHostedExecutionShareReference(value: unknown): HostedExecutionShareReference | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const shareId = readHostedExecutionText(record.shareId);
  const shareCode = readHostedExecutionText(record.shareCode);

  if (!shareId || !shareCode) {
    return undefined;
  }

  return {
    shareCode,
    shareId,
  } satisfies HostedExecutionShareReference;
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

import { Prisma } from "@prisma/client";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionEventKind,
} from "@murph/hosted-execution";

const HOSTED_EXECUTION_EVENT_KINDS = new Set<HostedExecutionEventKind>([
  "assistant.cron.tick",
  "device-sync.wake",
  "linq.message.received",
  "member.activated",
  "vault.share.accepted",
]);

const HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION = "murph.execution-outbox.ref.v1";

export type HostedExecutionDispatchRef = Prisma.InputJsonObject & {
  eventId: string;
  eventKind: HostedExecutionEventKind;
  occurredAt: string;
  userId: string;
};

export function buildHostedExecutionDispatchRef(
  dispatch: HostedExecutionDispatchRequest,
): HostedExecutionDispatchRef {
  return {
    eventId: dispatch.eventId,
    eventKind: dispatch.event.kind,
    occurredAt: dispatch.occurredAt,
    userId: dispatch.event.userId,
  } satisfies HostedExecutionDispatchRef;
}

export function serializeHostedExecutionOutboxPayload(
  dispatch: HostedExecutionDispatchRequest,
): Prisma.InputJsonObject {
  return {
    dispatchRef: buildHostedExecutionDispatchRef(dispatch),
    schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
  } satisfies Prisma.InputJsonObject;
}

export function readHostedExecutionDispatchRef(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
  fallback: {
    eventId: string;
    eventKind: string;
    occurredAt: string | null;
    userId: string;
  },
): HostedExecutionDispatchRef | null {
  const payloadObject = toHostedExecutionObject(payloadJson);
  const schemaVersion = readHostedExecutionText(payloadObject.schemaVersion);

  if (schemaVersion !== HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION) {
    return null;
  }

  const nestedRef = toHostedExecutionObject(payloadObject.dispatchRef);
  const eventId = readHostedExecutionText(nestedRef.eventId) ?? fallback.eventId;
  const eventKind = readHostedExecutionEventKind(nestedRef.eventKind) ?? readHostedExecutionEventKind(fallback.eventKind);
  const occurredAt = readHostedExecutionText(nestedRef.occurredAt) ?? fallback.occurredAt;
  const userId = readHostedExecutionText(nestedRef.userId) ?? fallback.userId;

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

export function readLegacyHostedExecutionDispatch(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): HostedExecutionDispatchRequest | null {
  const payloadObject = toHostedExecutionObject(payloadJson);
  const event = toHostedExecutionObject(payloadObject.event);
  const eventId = readHostedExecutionText(payloadObject.eventId);
  const occurredAt = readHostedExecutionText(payloadObject.occurredAt);
  const eventKind = readHostedExecutionEventKind(event.kind);
  const userId = readHostedExecutionText(event.userId);

  if (!eventId || !occurredAt || !eventKind || !userId) {
    return null;
  }

  return payloadObject as unknown as HostedExecutionDispatchRequest;
}

function readHostedExecutionEventKind(value: unknown): HostedExecutionEventKind | null {
  return typeof value === "string" && HOSTED_EXECUTION_EVENT_KINDS.has(value as HostedExecutionEventKind)
    ? value as HostedExecutionEventKind
    : null;
}

function readHostedExecutionText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function toHostedExecutionObject(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null>
    : {};
}

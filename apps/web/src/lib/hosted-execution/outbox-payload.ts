import { Prisma } from "@prisma/client";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionEventKind,
  HostedExecutionShareReference,
} from "@murph/hosted-execution";
import { HOSTED_EXECUTION_EVENT_KINDS } from "@murph/hosted-execution";

const HOSTED_EXECUTION_EVENT_KIND_SET = new Set<HostedExecutionEventKind>(HOSTED_EXECUTION_EVENT_KINDS);

const HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION = "murph.execution-outbox.ref.v1";

type HostedExecutionShareRefJson = Prisma.InputJsonObject & {
  shareCode: string;
  shareId: string;
};

export type HostedExecutionDispatchRef = Prisma.InputJsonObject & {
  eventId: string;
  eventKind: HostedExecutionEventKind;
  occurredAt: string;
  share?: HostedExecutionShareRefJson;
  userId: string;
};

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
          } satisfies HostedExecutionShareRefJson,
        }
      : {}),
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
  const nestedRef = toHostedExecutionObject(payloadObject.dispatchRef);
  const schemaVersion = readHostedExecutionText(payloadObject.schemaVersion);

  if (
    schemaVersion
    && schemaVersion !== HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION
  ) {
    return null;
  }

  if (!schemaVersion && Object.keys(nestedRef).length === 0) {
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
  };
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

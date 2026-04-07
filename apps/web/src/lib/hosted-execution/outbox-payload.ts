import { Prisma } from "@prisma/client";
import {
  type HostedExecutionDispatchRequest,
  type HostedExecutionDispatchRef as SharedHostedExecutionDispatchRef,
  type HostedExecutionEventKind,
  type HostedExecutionOutboxPayloadStorage,
  buildHostedExecutionDispatchRef as buildSharedHostedExecutionDispatchRef,
  parseHostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";

export const HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION = "murph.execution-outbox.v3";

const HOSTED_EXECUTION_EVENT_KIND_SET = new Set<HostedExecutionEventKind>([
  "member.activated",
  "linq.message.received",
  "telegram.message.received",
  "email.message.received",
  "assistant.cron.tick",
  "device-sync.wake",
  "vault.share.accepted",
  "gateway.message.send",
]);
const HOSTED_EXECUTION_INLINE_OUTBOX_PAYLOAD_KEYS = new Set([
  "dispatch",
  "schemaVersion",
  "storage",
]);
const HOSTED_EXECUTION_REFERENCE_OUTBOX_PAYLOAD_KEYS = new Set([
  "dispatchRef",
  "stagedPayloadId",
  "schemaVersion",
  "storage",
  "payloadRef",
]);

export type HostedExecutionDispatchRef = SharedHostedExecutionDispatchRef;

export interface HostedExecutionInlineOutboxPayload {
  dispatch: HostedExecutionDispatchRequest;
  schemaVersion: typeof HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION;
  storage: "inline";
}

export interface HostedExecutionReferenceOutboxPayload {
  dispatchRef: HostedExecutionDispatchRef;
  stagedPayloadId: string;
  schemaVersion: typeof HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION;
  storage: "reference";
}

export type HostedExecutionOutboxPayload =
  | HostedExecutionInlineOutboxPayload
  | HostedExecutionReferenceOutboxPayload;

export function buildHostedExecutionDispatchRef(
  dispatch: HostedExecutionDispatchRequest,
): HostedExecutionDispatchRef {
  return buildSharedHostedExecutionDispatchRef(dispatch);
}

export function serializeHostedExecutionOutboxPayload(
  dispatch: HostedExecutionDispatchRequest,
  options: {
    stagedPayloadId?: string | null;
    storage?: HostedExecutionOutboxPayloadStorage | "auto";
  } = {},
): Prisma.InputJsonObject {
  const storage = resolveHostedExecutionOutboxPayloadStorage(dispatch, options.storage ?? "auto");

  if (storage === "inline") {
    return {
      dispatch: toPrismaInputJsonValue(parseHostedExecutionDispatchRequest(dispatch)),
      schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
      storage,
    } satisfies Prisma.InputJsonObject;
  }

  const stagedPayloadId = readHostedExecutionStagedPayloadId(options.stagedPayloadId);

  if (!stagedPayloadId) {
    throw new TypeError(
      `Hosted execution ${dispatch.event.kind} reference payloads require a staged payload id.`,
    );
  }

  return {
    dispatchRef: toPrismaInputJsonValue(buildSharedHostedExecutionDispatchRef(dispatch)),
    stagedPayloadId,
    schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
    storage,
  } satisfies Prisma.InputJsonObject;
}

export function readHostedExecutionStagedPayloadId(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  const payload = toObject(value);
  const stagedPayloadId = readText(payload.stagedPayloadId);

  if (stagedPayloadId) {
    return stagedPayloadId;
  }

  const payloadRef = toObject(payload.payloadRef);
  const nestedStagedPayloadId = readText(payloadRef.stagedPayloadId);

  if (nestedStagedPayloadId) {
    return nestedStagedPayloadId;
  }

  const key = readText(payloadRef.key);
  return key ? key : null;
}

export function readHostedExecutionDispatchRef(
  payloadJson: unknown,
): HostedExecutionDispatchRef | null {
  const payloadObject = toObject(payloadJson);
  const nestedRef = toObject("dispatchRef" in payloadObject ? payloadObject.dispatchRef : payloadObject);
  const schemaVersion = readText(payloadObject.schemaVersion);
  const storage = readText(payloadObject.storage);

  if (
    schemaVersion !== HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION
    || storage !== "reference"
    || !hasOnlyHostedExecutionKeys(nestedRef, new Set(["eventId", "eventKind", "occurredAt", "userId"]))
  ) {
    return null;
  }

  const eventId = readText(nestedRef.eventId);
  const eventKind = readHostedExecutionEventKind(nestedRef.eventKind);
  const occurredAt = readText(nestedRef.occurredAt);
  const userId = readText(nestedRef.userId);

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

export function readHostedExecutionOutboxPayload(
  payloadJson: unknown,
): HostedExecutionOutboxPayload | null {
  const payloadObject = toObject(payloadJson);
  const schemaVersion = readText(payloadObject.schemaVersion);

  if (schemaVersion !== HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION) {
    return null;
  }

  const storage = readText(payloadObject.storage);

  if (storage === "inline") {
    if (!hasOnlyHostedExecutionKeys(payloadObject, HOSTED_EXECUTION_INLINE_OUTBOX_PAYLOAD_KEYS)) {
      return null;
    }

    const dispatch = parseHostedExecutionDispatchRequest(payloadObject.dispatch);

    return {
      dispatch,
      schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
      storage,
    };
  }

  if (storage === "reference") {
    if (!hasOnlyHostedExecutionKeys(payloadObject, HOSTED_EXECUTION_REFERENCE_OUTBOX_PAYLOAD_KEYS)) {
      return null;
    }

    const dispatchRef = readHostedExecutionDispatchRef(payloadObject);
    const stagedPayloadId = readHostedExecutionStagedPayloadId(payloadObject);

    if (!dispatchRef || !stagedPayloadId) {
      return null;
    }

    return {
      dispatchRef,
      stagedPayloadId,
      schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
      storage,
    };
  }

  return null;
}

function readHostedExecutionEventKind(value: unknown): HostedExecutionEventKind | null {
  return typeof value === "string" && HOSTED_EXECUTION_EVENT_KIND_SET.has(value as HostedExecutionEventKind)
    ? value as HostedExecutionEventKind
    : null;
}

function resolveHostedExecutionOutboxPayloadStorage(
  dispatch: HostedExecutionDispatchRequest,
  requested: HostedExecutionOutboxPayloadStorage | "auto",
): HostedExecutionOutboxPayloadStorage {
  const canonicalStorage = HOSTED_EXECUTION_EVENT_KIND_SET.has(dispatch.event.kind as HostedExecutionEventKind)
    && (
      dispatch.event.kind === "member.activated"
      || dispatch.event.kind === "linq.message.received"
      || dispatch.event.kind === "telegram.message.received"
      || dispatch.event.kind === "email.message.received"
      || dispatch.event.kind === "device-sync.wake"
      || dispatch.event.kind === "gateway.message.send"
    )
    ? "reference"
    : "inline";

  if (requested !== "auto") {
    if (requested === "inline" && dispatch.event.kind === "member.activated") {
      return requested;
    }

    if (requested !== canonicalStorage) {
      throw new TypeError(
        `Hosted execution ${dispatch.event.kind} outbox payloads must use ${canonicalStorage} storage.`,
      );
    }

    return requested;
  }

  return canonicalStorage;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toObject(value: unknown): Record<string, unknown> {
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

function toPrismaInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}

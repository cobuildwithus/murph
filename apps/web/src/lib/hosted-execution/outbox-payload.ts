import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchRef as SharedHostedExecutionDispatchRef,
  HostedExecutionEventKind,
  HostedExecutionOutboxPayload as SharedHostedExecutionOutboxPayload,
  HostedExecutionOutboxPayloadStorage,
} from "@murphai/hosted-execution";
import {
  buildHostedExecutionDispatchRef as buildSharedHostedExecutionDispatchRef,
  buildHostedExecutionOutboxPayload as buildSharedHostedExecutionOutboxPayload,
  readHostedExecutionDispatchRef as readSharedHostedExecutionDispatchRef,
  readHostedExecutionOutboxPayload as readSharedHostedExecutionOutboxPayload,
  readHostedExecutionStagedPayloadId as readSharedHostedExecutionStagedPayloadId,
} from "@murphai/hosted-execution";

export type HostedExecutionDispatchRef = SharedHostedExecutionDispatchRef;
export type HostedExecutionOutboxPayload = SharedHostedExecutionOutboxPayload;

export interface HostedExecutionOutboxPayloadIdentity {
  dispatchRef: HostedExecutionDispatchRef;
  payloadHash: string;
}

interface HostedExecutionPrunedOutboxPayload {
  eventId: string;
  eventKind: HostedExecutionEventKind;
  occurredAt: string;
  payloadHash: string;
  schema: typeof HOSTED_EXECUTION_PRUNED_OUTBOX_PAYLOAD_SCHEMA;
  storage: "pruned";
  userId: string;
}

const HOSTED_EXECUTION_PRUNED_OUTBOX_PAYLOAD_SCHEMA =
  "murph.hosted-execution-outbox-payload-pruned.v1";
const HOSTED_EXECUTION_PRUNED_OUTBOX_PAYLOAD_KEYS = new Set([
  "eventId",
  "eventKind",
  "occurredAt",
  "payloadHash",
  "schema",
  "storage",
  "userId",
]);

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
  return toPrismaInputJsonObject(buildSharedHostedExecutionOutboxPayload(dispatch, options));
}

export function summarizeHostedExecutionOutboxPayload(
  payload: HostedExecutionOutboxPayload,
): Prisma.InputJsonObject {
  return toPrismaInputJsonObject({
    eventId: resolveHostedExecutionDispatchRefFromPayload(payload).eventId,
    eventKind: resolveHostedExecutionDispatchRefFromPayload(payload).eventKind,
    occurredAt: resolveHostedExecutionDispatchRefFromPayload(payload).occurredAt,
    payloadHash: hashHostedExecutionOutboxPayload(payload),
    schema: HOSTED_EXECUTION_PRUNED_OUTBOX_PAYLOAD_SCHEMA,
    storage: "pruned",
    userId: resolveHostedExecutionDispatchRefFromPayload(payload).userId,
  } satisfies HostedExecutionPrunedOutboxPayload);
}

export function readHostedExecutionOutboxPayloadIdentity(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionOutboxPayloadIdentity | null {
  const payload = readSharedHostedExecutionOutboxPayload(payloadJson);

  if (payload) {
    return {
      dispatchRef: resolveHostedExecutionDispatchRefFromPayload(payload),
      payloadHash: hashHostedExecutionOutboxPayload(payload),
    };
  }

  const pruned = readHostedExecutionPrunedOutboxPayload(payloadJson);

  if (!pruned) {
    return null;
  }

  return {
    dispatchRef: {
      eventId: pruned.eventId,
      eventKind: pruned.eventKind,
      occurredAt: pruned.occurredAt,
      userId: pruned.userId,
    },
    payloadHash: pruned.payloadHash,
  };
}

export function readHostedExecutionStagedPayloadId(value: unknown): string | null {
  return readSharedHostedExecutionStagedPayloadId(value);
}

export function readHostedExecutionDispatchRef(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionDispatchRef | null {
  return readSharedHostedExecutionDispatchRef(payloadJson);
}

export function readHostedExecutionOutboxPayload(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionOutboxPayload | null {
  return readSharedHostedExecutionOutboxPayload(payloadJson);
}

function readHostedExecutionPrunedOutboxPayload(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionPrunedOutboxPayload | null {
  const record = toHostedExecutionObject(payloadJson);

  if (
    readHostedExecutionText(record.storage) !== "pruned"
    || readHostedExecutionText(record.schema) !== HOSTED_EXECUTION_PRUNED_OUTBOX_PAYLOAD_SCHEMA
    || !hasOnlyHostedExecutionKeys(record, HOSTED_EXECUTION_PRUNED_OUTBOX_PAYLOAD_KEYS)
  ) {
    return null;
  }

  const eventId = readHostedExecutionText(record.eventId);
  const eventKind = readHostedExecutionEventKind(record.eventKind);
  const occurredAt = readHostedExecutionText(record.occurredAt);
  const payloadHash = readHostedExecutionText(record.payloadHash);
  const userId = readHostedExecutionText(record.userId);

  if (!eventId || !eventKind || !occurredAt || !payloadHash || !userId) {
    return null;
  }

  return {
    eventId,
    eventKind,
    occurredAt,
    payloadHash,
    schema: HOSTED_EXECUTION_PRUNED_OUTBOX_PAYLOAD_SCHEMA,
    storage: "pruned",
    userId,
  };
}

function resolveHostedExecutionDispatchRefFromPayload(
  payload: HostedExecutionOutboxPayload,
): HostedExecutionDispatchRef {
  return payload.storage === "inline"
    ? buildSharedHostedExecutionDispatchRef(payload.dispatch)
    : payload.dispatchRef;
}

function hashHostedExecutionOutboxPayload(payload: HostedExecutionOutboxPayload): string {
  return createHash("sha256")
    .update(stableStringify(payload))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableSortValue(value));
}

function stableSortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableSortValue(entry)] as const),
    );
  }

  return value;
}

function readHostedExecutionEventKind(value: unknown): HostedExecutionEventKind | null {
  return typeof value === "string" && value.trim().length > 0
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

function toPrismaInputJsonObject(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

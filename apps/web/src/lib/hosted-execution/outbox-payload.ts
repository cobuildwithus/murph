import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { Prisma } from "@prisma/client";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionEventKind,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_EXECUTION_INLINE_ONLY_OUTBOX_EVENT_KINDS,
} from "@murphai/hosted-execution";
import {
  buildHostedExecutionDispatchRef as buildSharedHostedExecutionDispatchRef,
  readHostedExecutionDispatchRef as readSharedHostedExecutionDispatchRef,
  type HostedExecutionDispatchRef as SharedHostedExecutionDispatchRef,
} from "@murphai/hosted-execution/dispatch-ref";
import {
  buildHostedExecutionOutboxPayload as buildSharedHostedExecutionOutboxPayload,
  readHostedExecutionOutboxPayload as readSharedHostedExecutionOutboxPayload,
  readHostedExecutionStagedPayloadId as readSharedHostedExecutionStagedPayloadId,
  type HostedExecutionOutboxPayload as SharedHostedExecutionOutboxPayload,
  type HostedExecutionOutboxPayloadStorage,
} from "@murphai/hosted-execution/outbox-payload";

export type HostedExecutionDispatchRef = SharedHostedExecutionDispatchRef;
export type HostedExecutionOutboxPayload = SharedHostedExecutionOutboxPayload;

interface HostedExecutionPrunedInlineOutboxPayload {
  dispatchRef: HostedExecutionDispatchRef;
  payloadHash: string;
  schema: typeof HOSTED_EXECUTION_PRUNED_INLINE_OUTBOX_PAYLOAD_SCHEMA;
  storage: "pruned";
}

const HOSTED_EXECUTION_PRUNED_INLINE_OUTBOX_PAYLOAD_SCHEMA =
  "murph.hosted-execution-inline-outbox-payload-pruned.v1";
const HOSTED_EXECUTION_INLINE_ONLY_OUTBOX_EVENT_KIND_SET = new Set<HostedExecutionEventKind>(
  HOSTED_EXECUTION_INLINE_ONLY_OUTBOX_EVENT_KINDS,
);
const HOSTED_EXECUTION_DISPATCH_REF_KEYS = new Set([
  "eventId",
  "eventKind",
  "occurredAt",
  "userId",
]);
const HOSTED_EXECUTION_PRUNED_INLINE_OUTBOX_PAYLOAD_KEYS = new Set([
  "dispatchRef",
  "payloadHash",
  "schema",
  "storage",
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
): Prisma.InputJsonObject | null {
  if (payload.storage !== "inline") {
    return null;
  }

  return toPrismaInputJsonObject({
    dispatchRef: buildSharedHostedExecutionDispatchRef(payload.dispatch),
    payloadHash: hashHostedExecutionOutboxPayload(payload),
    schema: HOSTED_EXECUTION_PRUNED_INLINE_OUTBOX_PAYLOAD_SCHEMA,
    storage: "pruned",
  } satisfies HostedExecutionPrunedInlineOutboxPayload);
}

export function areHostedExecutionOutboxPayloadsEquivalent(
  existingPayloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
  expectedPayloadJson: Prisma.InputJsonValue,
): boolean {
  const existingPayload = readSharedHostedExecutionOutboxPayload(existingPayloadJson);
  const expectedPayload = readSharedHostedExecutionOutboxPayload(expectedPayloadJson);

  if (existingPayload && expectedPayload) {
    return areFullHostedExecutionOutboxPayloadsEquivalent(existingPayload, expectedPayload);
  }

  const prunedExistingPayload = readHostedExecutionPrunedInlineOutboxPayload(existingPayloadJson);

  if (!prunedExistingPayload || !expectedPayload || expectedPayload.storage !== "inline") {
    return false;
  }

  return prunedExistingPayload.payloadHash === hashHostedExecutionOutboxPayload(expectedPayload)
    && areHostedExecutionDispatchRefsEquivalent(
      prunedExistingPayload.dispatchRef,
      buildSharedHostedExecutionDispatchRef(expectedPayload.dispatch),
    );
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

function readHostedExecutionPrunedInlineOutboxPayload(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionPrunedInlineOutboxPayload | null {
  const record = toHostedExecutionObject(payloadJson);

  if (
    readHostedExecutionText(record.storage) !== "pruned"
    || readHostedExecutionText(record.schema) !== HOSTED_EXECUTION_PRUNED_INLINE_OUTBOX_PAYLOAD_SCHEMA
    || !hasOnlyHostedExecutionKeys(record, HOSTED_EXECUTION_PRUNED_INLINE_OUTBOX_PAYLOAD_KEYS)
  ) {
    return null;
  }

  const dispatchRef = readHostedExecutionInlineDispatchRef(record.dispatchRef);
  const payloadHash = readHostedExecutionText(record.payloadHash);

  if (!dispatchRef || !payloadHash) {
    return null;
  }

  return {
    dispatchRef,
    payloadHash,
    schema: HOSTED_EXECUTION_PRUNED_INLINE_OUTBOX_PAYLOAD_SCHEMA,
    storage: "pruned",
  };
}

function readHostedExecutionInlineDispatchRef(value: unknown): HostedExecutionDispatchRef | null {
  const record = toHostedExecutionObject(value);

  if (!hasOnlyHostedExecutionKeys(record, HOSTED_EXECUTION_DISPATCH_REF_KEYS)) {
    return null;
  }

  const eventId = readHostedExecutionText(record.eventId);
  const eventKind = readHostedExecutionInlineEventKind(record.eventKind);
  const occurredAt = readHostedExecutionText(record.occurredAt);
  const userId = readHostedExecutionText(record.userId);

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

function readHostedExecutionInlineEventKind(value: unknown): HostedExecutionEventKind | null {
  return typeof value === "string"
    && HOSTED_EXECUTION_INLINE_ONLY_OUTBOX_EVENT_KIND_SET.has(value as HostedExecutionEventKind)
    ? value as HostedExecutionEventKind
    : null;
}

function readHostedExecutionText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function areFullHostedExecutionOutboxPayloadsEquivalent(
  left: HostedExecutionOutboxPayload,
  right: HostedExecutionOutboxPayload,
): boolean {
  if (left.storage !== right.storage) {
    return false;
  }

  if (left.storage === "inline" && right.storage === "inline") {
    return isDeepStrictEqual(left.dispatch, right.dispatch);
  }

  if (left.storage === "reference" && right.storage === "reference") {
    return areHostedExecutionDispatchRefsEquivalent(left.dispatchRef, right.dispatchRef)
      && left.stagedPayloadId === right.stagedPayloadId;
  }

  return false;
}

function areHostedExecutionDispatchRefsEquivalent(
  left: HostedExecutionDispatchRef,
  right: HostedExecutionDispatchRef,
): boolean {
  return left.eventId === right.eventId
    && left.eventKind === right.eventKind
    && left.occurredAt === right.occurredAt
    && left.userId === right.userId;
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

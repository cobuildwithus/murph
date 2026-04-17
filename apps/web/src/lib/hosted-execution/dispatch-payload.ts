import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { Prisma } from "@prisma/client";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionEventKind,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_EXECUTION_EVENT_KINDS,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/parsers";

export interface HostedExecutionDispatchRef {
  eventId: string;
  eventKind: HostedExecutionEventKind;
  occurredAt: string;
  userId: string;
}

export interface HostedExecutionInlineDispatchPayload {
  dispatch: HostedExecutionDispatchRequest;
  storage: "inline";
}

export type HostedExecutionDispatchPayload = HostedExecutionInlineDispatchPayload;

interface HostedExecutionPrunedInlineDispatchPayload {
  dispatchRef: HostedExecutionDispatchRef;
  payloadHash: string;
  schema: typeof HOSTED_EXECUTION_PRUNED_INLINE_DISPATCH_PAYLOAD_SCHEMA;
  storage: "pruned";
}

const HOSTED_EXECUTION_PRUNED_INLINE_DISPATCH_PAYLOAD_SCHEMA =
  "murph.hosted-execution-inline-dispatch-payload-pruned.v1";
const HOSTED_EXECUTION_EVENT_KIND_SET = new Set<HostedExecutionEventKind>(
  HOSTED_EXECUTION_EVENT_KINDS,
);
const HOSTED_EXECUTION_DISPATCH_REF_KEYS = new Set([
  "eventId",
  "eventKind",
  "occurredAt",
  "userId",
]);
const HOSTED_EXECUTION_INLINE_DISPATCH_PAYLOAD_KEYS = new Set([
  "dispatch",
  "storage",
]);
const HOSTED_EXECUTION_PRUNED_INLINE_DISPATCH_PAYLOAD_KEYS = new Set([
  "dispatchRef",
  "payloadHash",
  "schema",
  "storage",
]);

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

export function serializeHostedExecutionDispatchPayload(
  dispatch: HostedExecutionDispatchRequest,
): Prisma.InputJsonObject {
  return toPrismaInputJsonObject({
    dispatch: parseHostedExecutionDispatchRequest(dispatch),
    storage: "inline",
  } satisfies HostedExecutionInlineDispatchPayload);
}

export function summarizeHostedExecutionDispatchPayload(
  payload: HostedExecutionDispatchPayload,
): Prisma.InputJsonObject {
  return toPrismaInputJsonObject({
    dispatchRef: buildHostedExecutionDispatchRef(payload.dispatch),
    payloadHash: hashHostedExecutionDispatchPayload(payload),
    schema: HOSTED_EXECUTION_PRUNED_INLINE_DISPATCH_PAYLOAD_SCHEMA,
    storage: "pruned",
  } satisfies HostedExecutionPrunedInlineDispatchPayload);
}

export function areHostedExecutionDispatchPayloadsEquivalent(
  existingPayloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
  expectedPayloadJson: Prisma.InputJsonValue,
): boolean {
  const existingPayload = readHostedExecutionDispatchPayload(existingPayloadJson);
  const expectedPayload = readHostedExecutionDispatchPayload(expectedPayloadJson);

  if (existingPayload && expectedPayload) {
    return isDeepStrictEqual(existingPayload.dispatch, expectedPayload.dispatch);
  }

  const prunedInlinePayload = readHostedExecutionPrunedInlineDispatchPayload(existingPayloadJson);

  return Boolean(
    prunedInlinePayload
      && expectedPayload
      && prunedInlinePayload.payloadHash === hashHostedExecutionDispatchPayload(expectedPayload)
      && areHostedExecutionDispatchRefsEquivalent(
        prunedInlinePayload.dispatchRef,
        buildHostedExecutionDispatchRef(expectedPayload.dispatch),
      ),
  );
}

export function readHostedExecutionDispatchRef(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionDispatchRef | null {
  const inlinePayload = readHostedExecutionDispatchPayload(payloadJson);

  return readHostedExecutionPrunedInlineDispatchPayload(payloadJson)?.dispatchRef
    ?? (inlinePayload ? buildHostedExecutionDispatchRef(inlinePayload.dispatch) : null);
}

export function readHostedExecutionDispatchPayload(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionDispatchPayload | null {
  const payloadObject = toHostedExecutionObject(payloadJson);

  if (readHostedExecutionText(payloadObject.storage) !== "inline") {
    return null;
  }

  if (!hasOnlyHostedExecutionKeys(payloadObject, HOSTED_EXECUTION_INLINE_DISPATCH_PAYLOAD_KEYS)) {
    return null;
  }

  try {
    return {
      dispatch: parseHostedExecutionDispatchRequest(payloadObject.dispatch),
      storage: "inline",
    };
  } catch {
    return null;
  }
}

function readHostedExecutionPrunedInlineDispatchPayload(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionPrunedInlineDispatchPayload | null {
  const record = toHostedExecutionObject(payloadJson);

  if (
    readHostedExecutionText(record.storage) !== "pruned"
    || readHostedExecutionText(record.schema) !== HOSTED_EXECUTION_PRUNED_INLINE_DISPATCH_PAYLOAD_SCHEMA
    || !hasOnlyHostedExecutionKeys(record, HOSTED_EXECUTION_PRUNED_INLINE_DISPATCH_PAYLOAD_KEYS)
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
    schema: HOSTED_EXECUTION_PRUNED_INLINE_DISPATCH_PAYLOAD_SCHEMA,
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

function hashHostedExecutionDispatchPayload(payload: HostedExecutionDispatchPayload): string {
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
    && HOSTED_EXECUTION_EVENT_KIND_SET.has(value as HostedExecutionEventKind)
    ? value as HostedExecutionEventKind
    : null;
}

function readHostedExecutionText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
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

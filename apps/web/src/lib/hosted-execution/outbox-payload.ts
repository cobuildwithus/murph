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

export type HostedExecutionOutboxPayloadStorage = "inline";

export interface HostedExecutionDispatchRef {
  eventId: string;
  eventKind: HostedExecutionEventKind;
  occurredAt: string;
  userId: string;
}

export interface HostedExecutionInlineOutboxPayload {
  dispatch: HostedExecutionDispatchRequest;
  storage: "inline";
}

export type HostedExecutionOutboxPayload = HostedExecutionInlineOutboxPayload;

interface HostedExecutionPrunedInlineOutboxPayload {
  dispatchRef: HostedExecutionDispatchRef;
  payloadHash: string;
  schema: typeof HOSTED_EXECUTION_PRUNED_INLINE_OUTBOX_PAYLOAD_SCHEMA;
  storage: "pruned";
}

const HOSTED_EXECUTION_PRUNED_INLINE_OUTBOX_PAYLOAD_SCHEMA =
  "murph.hosted-execution-inline-outbox-payload-pruned.v1";
const HOSTED_EXECUTION_EVENT_KIND_SET = new Set<HostedExecutionEventKind>(
  HOSTED_EXECUTION_EVENT_KINDS,
);
const HOSTED_EXECUTION_DISPATCH_REF_KEYS = new Set([
  "eventId",
  "eventKind",
  "occurredAt",
  "userId",
]);
const HOSTED_EXECUTION_INLINE_OUTBOX_PAYLOAD_KEYS = new Set([
  "dispatch",
  "storage",
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
  return {
    eventId: dispatch.eventId,
    eventKind: dispatch.event.kind,
    occurredAt: dispatch.occurredAt,
    userId: dispatch.event.userId,
  };
}

export function serializeHostedExecutionOutboxPayload(
  dispatch: HostedExecutionDispatchRequest,
  options: {
    stagedPayloadId?: string | null;
    storage?: HostedExecutionOutboxPayloadStorage | "auto";
  } = {},
): Prisma.InputJsonObject {
  if (options.stagedPayloadId !== undefined && options.stagedPayloadId !== null) {
    throw new TypeError("Hosted execution outbox payloads no longer support staged payload refs.");
  }

  if (options.storage && options.storage !== "auto" && options.storage !== "inline") {
    throw new TypeError("Hosted execution outbox payloads must use inline storage.");
  }

  return toPrismaInputJsonObject({
    dispatch: parseHostedExecutionDispatchRequest(dispatch),
    storage: "inline",
  } satisfies HostedExecutionInlineOutboxPayload);
}

export function summarizeHostedExecutionOutboxPayload(
  payload: HostedExecutionOutboxPayload,
): Prisma.InputJsonObject {
  return toPrismaInputJsonObject({
    dispatchRef: buildHostedExecutionDispatchRef(payload.dispatch),
    payloadHash: hashHostedExecutionOutboxPayload(payload),
    schema: HOSTED_EXECUTION_PRUNED_INLINE_OUTBOX_PAYLOAD_SCHEMA,
    storage: "pruned",
  } satisfies HostedExecutionPrunedInlineOutboxPayload);
}

export function areHostedExecutionOutboxPayloadsEquivalent(
  existingPayloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
  expectedPayloadJson: Prisma.InputJsonValue,
): boolean {
  const existingPayload = readHostedExecutionOutboxPayload(existingPayloadJson);
  const expectedPayload = readHostedExecutionOutboxPayload(expectedPayloadJson);

  if (existingPayload && expectedPayload) {
    return isDeepStrictEqual(existingPayload.dispatch, expectedPayload.dispatch);
  }

  const prunedInlinePayload = readHostedExecutionPrunedInlineOutboxPayload(existingPayloadJson);

  return Boolean(
    prunedInlinePayload
      && expectedPayload
      && prunedInlinePayload.payloadHash === hashHostedExecutionOutboxPayload(expectedPayload)
      && areHostedExecutionDispatchRefsEquivalent(
        prunedInlinePayload.dispatchRef,
        buildHostedExecutionDispatchRef(expectedPayload.dispatch),
      ),
  );
}

export function readHostedExecutionDispatchRef(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionDispatchRef | null {
  const inlinePayload = readHostedExecutionOutboxPayload(payloadJson);

  return readHostedExecutionPrunedInlineOutboxPayload(payloadJson)?.dispatchRef
    ?? (inlinePayload ? buildHostedExecutionDispatchRef(inlinePayload.dispatch) : null);
}

export function readHostedExecutionOutboxPayload(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): HostedExecutionOutboxPayload | null {
  const payloadObject = toHostedExecutionObject(payloadJson);

  if (readHostedExecutionText(payloadObject.storage) !== "inline") {
    return null;
  }

  if (!hasOnlyHostedExecutionKeys(payloadObject, HOSTED_EXECUTION_INLINE_OUTBOX_PAYLOAD_KEYS)) {
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

export function hasHostedExecutionReferenceOutboxPayloadStorage(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): boolean {
  return readHostedExecutionText(toHostedExecutionObject(payloadJson).storage) === "reference";
}

export function resolveHostedExecutionOutboxPayloadEventId(
  payload: HostedExecutionOutboxPayload,
): string {
  return payload.dispatch.eventId;
}

export function resolveHostedExecutionOutboxPayloadUserId(
  payload: HostedExecutionOutboxPayload,
): string {
  return payload.dispatch.event.userId;
}

export function resolveHostedExecutionOutboxPayloadStorage(
  _dispatch: HostedExecutionDispatchRequest,
  requested: HostedExecutionOutboxPayloadStorage | "auto",
): HostedExecutionOutboxPayloadStorage {
  if (requested !== "auto" && requested !== "inline") {
    throw new TypeError("Hosted execution outbox payloads must use inline storage.");
  }

  return "inline";
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

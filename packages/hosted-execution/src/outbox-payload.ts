import {
  HOSTED_EXECUTION_INLINE_ONLY_OUTBOX_EVENT_KINDS,
  HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KINDS,
  type HostedExecutionDispatchRequest,
  type HostedExecutionEventKind,
} from "./contracts.ts";
import {
  parseHostedExecutionDispatchRequest,
} from "./parsers.ts";
import {
  buildHostedExecutionDispatchRef,
  readHostedExecutionDispatchRef,
  type HostedExecutionDispatchRef,
} from "./dispatch-ref.ts";

export type HostedExecutionOutboxPayloadStorage = "inline" | "reference";

export interface HostedExecutionInlineOutboxPayload {
  dispatch: HostedExecutionDispatchRequest;
  storage: "inline";
}

export interface HostedExecutionReferenceOutboxPayload {
  dispatchRef: HostedExecutionDispatchRef;
  stagedPayloadId: string;
  storage: "reference";
}

export type HostedExecutionOutboxPayload =
  | HostedExecutionInlineOutboxPayload
  | HostedExecutionReferenceOutboxPayload;

const HOSTED_EXECUTION_INLINE_ONLY_OUTBOX_EVENT_KIND_SET = new Set<HostedExecutionEventKind>(
  HOSTED_EXECUTION_INLINE_ONLY_OUTBOX_EVENT_KINDS,
);
const HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KIND_SET = new Set<HostedExecutionEventKind>(
  HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KINDS,
);
const HOSTED_EXECUTION_INLINE_OUTBOX_PAYLOAD_KEYS = new Set([
  "dispatch",
  "storage",
]);
const HOSTED_EXECUTION_REFERENCE_OUTBOX_PAYLOAD_KEYS = new Set([
  "dispatchRef",
  "stagedPayloadId",
  "storage",
]);

export function buildHostedExecutionOutboxPayload(
  dispatch: HostedExecutionDispatchRequest,
  options: {
    stagedPayloadId?: string | null;
    storage?: HostedExecutionOutboxPayloadStorage | "auto";
  } = {},
): HostedExecutionOutboxPayload {
  const normalizedDispatch = parseHostedExecutionDispatchRequest(dispatch);
  const storage = resolveHostedExecutionDispatchPayloadStorage(
    normalizedDispatch,
    options.storage ?? "auto",
  );

  if (storage === "inline") {
    return {
      dispatch: normalizedDispatch,
      storage,
    };
  }

  const stagedPayloadId = requireText(
    options.stagedPayloadId,
    `Hosted execution ${normalizedDispatch.event.kind} reference payloads require a staged payload id.`,
  );

  return {
    dispatchRef: buildHostedExecutionDispatchRef(normalizedDispatch),
    stagedPayloadId,
    storage,
  };
}

export function readHostedExecutionOutboxPayload(
  payloadJson: unknown,
): HostedExecutionOutboxPayload | null {
  const payloadObject = toObject(payloadJson);

  switch (readText(payloadObject.storage)) {
    case "inline":
      return readHostedExecutionInlineOutboxPayload(payloadObject);
    case "reference":
      return readHostedExecutionReferenceOutboxPayload(payloadObject);
    default:
      return null;
  }
}

export function readHostedExecutionStagedPayloadId(
  value: unknown,
): string | null {
  return readText(value);
}

export function resolveHostedExecutionOutboxPayloadEventId(
  payload: HostedExecutionOutboxPayload,
): string {
  return payload.storage === "inline" ? payload.dispatch.eventId : payload.dispatchRef.eventId;
}

export function resolveHostedExecutionOutboxPayloadUserId(
  payload: HostedExecutionOutboxPayload,
): string {
  return payload.storage === "inline" ? payload.dispatch.event.userId : payload.dispatchRef.userId;
}

export function resolveHostedExecutionDispatchPayloadStorage(
  dispatch: HostedExecutionDispatchRequest,
  requested: HostedExecutionOutboxPayloadStorage | "auto",
): HostedExecutionOutboxPayloadStorage {
  const canonicalStorage = resolveHostedExecutionCanonicalOutboxPayloadStorage(dispatch.event.kind);

  if (requested !== "auto") {
    if (!isHostedExecutionOutboxPayloadStorageAllowed(dispatch.event.kind, requested)) {
      throw new TypeError(
        `Hosted execution ${dispatch.event.kind} outbox payloads must use ${canonicalStorage} storage.`,
      );
    }

    return requested;
  }

  return canonicalStorage;
}

export const resolveHostedExecutionOutboxPayloadStorage =
  resolveHostedExecutionDispatchPayloadStorage;

export function resolveHostedExecutionCanonicalOutboxPayloadStorage(
  eventKind: HostedExecutionEventKind,
): HostedExecutionOutboxPayloadStorage {
  if (HOSTED_EXECUTION_REFERENCE_ONLY_OUTBOX_EVENT_KIND_SET.has(eventKind)) {
    return "reference";
  }

  if (HOSTED_EXECUTION_INLINE_ONLY_OUTBOX_EVENT_KIND_SET.has(eventKind)) {
    return "inline";
  }

  throw new TypeError(`Unsupported hosted execution event kind: ${eventKind}`);
}

function readHostedExecutionInlineOutboxPayload(
  payloadObject: Record<string, unknown>,
): HostedExecutionInlineOutboxPayload | null {
  if (!hasOnlyAllowedKeys(payloadObject, HOSTED_EXECUTION_INLINE_OUTBOX_PAYLOAD_KEYS)) {
    return null;
  }

  const dispatch = readHostedExecutionDispatchRequestIfValid(payloadObject.dispatch);
  if (!dispatch) {
    return null;
  }

  return isHostedExecutionOutboxPayloadStorageAllowed(dispatch.event.kind, "inline")
    ? {
        dispatch,
        storage: "inline",
      }
    : null;
}

function readHostedExecutionReferenceOutboxPayload(
  payloadObject: Record<string, unknown>,
): HostedExecutionReferenceOutboxPayload | null {
  if (!hasOnlyAllowedKeys(payloadObject, HOSTED_EXECUTION_REFERENCE_OUTBOX_PAYLOAD_KEYS)) {
    return null;
  }

  const dispatchRef = readHostedExecutionDispatchRef(payloadObject);
  if (!dispatchRef || !isHostedExecutionOutboxPayloadStorageAllowed(dispatchRef.eventKind, "reference")) {
    return null;
  }

  const stagedPayloadId = readHostedExecutionStagedPayloadId(payloadObject.stagedPayloadId);
  if (!stagedPayloadId) {
    return null;
  }

  return {
    dispatchRef,
    stagedPayloadId,
    storage: "reference",
  };
}

function readHostedExecutionDispatchRequestIfValid(
  value: unknown,
): HostedExecutionDispatchRequest | null {
  try {
    return parseHostedExecutionDispatchRequest(value);
  } catch {
    return null;
  }
}

function isHostedExecutionOutboxPayloadStorageAllowed(
  eventKind: HostedExecutionEventKind,
  storage: HostedExecutionOutboxPayloadStorage,
): boolean {
  return resolveHostedExecutionCanonicalOutboxPayloadStorage(eventKind) === storage;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function requireText(value: unknown, errorMessage: string): string {
  const text = readText(value);
  if (text === null) {
    throw new TypeError(errorMessage);
  }

  return text;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasOnlyAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

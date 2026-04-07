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
  const storage = resolveHostedExecutionDispatchPayloadStorage(dispatch, options.storage ?? "auto");

  if (storage === "inline") {
    return {
      dispatch: parseHostedExecutionDispatchRequest(dispatch),
      storage,
    };
  }

  const stagedPayloadId = requireText(
    options.stagedPayloadId,
    `Hosted execution ${dispatch.event.kind} reference payloads require a staged payload id.`,
  );

  return {
    dispatchRef: buildHostedExecutionDispatchRef(dispatch),
    stagedPayloadId,
    storage,
  };
}

export function readHostedExecutionOutboxPayload(
  payloadJson: unknown,
): HostedExecutionOutboxPayload | null {
  const payloadObject = toObject(payloadJson);
  const storage = readText(payloadObject.storage);

  if (storage === "inline") {
    if (!hasOnlyHostedExecutionKeys(payloadObject, HOSTED_EXECUTION_INLINE_OUTBOX_PAYLOAD_KEYS)) {
      return null;
    }

    const dispatch = parseHostedExecutionDispatchRequest(payloadObject.dispatch);

    if (!isHostedExecutionOutboxPayloadStorageAllowed(dispatch.event.kind, storage)) {
      return null;
    }

    return {
      dispatch,
      storage,
    };
  }

  if (storage === "reference") {
    if (!hasOnlyHostedExecutionKeys(payloadObject, HOSTED_EXECUTION_REFERENCE_OUTBOX_PAYLOAD_KEYS)) {
      return null;
    }

    const dispatchRef = readHostedExecutionDispatchRef(payloadObject);
    if (!dispatchRef || !isHostedExecutionOutboxPayloadStorageAllowed(dispatchRef.eventKind, storage)) {
      return null;
    }

    const stagedPayloadId = readHostedExecutionStagedPayloadId(payloadObject.stagedPayloadId);
    if (!stagedPayloadId) {
      return null;
    }

    return {
      dispatchRef,
      stagedPayloadId,
      storage,
    };
  }

  return null;
}

export function readHostedExecutionStagedPayloadId(
  value: unknown,
): string | null {
  return readText(value);
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

function hasOnlyHostedExecutionKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

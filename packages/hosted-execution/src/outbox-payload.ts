import type { HostedExecutionDispatchRequest } from "./contracts.ts";
import {
  parseHostedExecutionDispatchRequest,
} from "./parsers.ts";
import {
  buildHostedExecutionDispatchRef,
  readHostedExecutionDispatchRef,
  type HostedExecutionDispatchRef,
  type HostedExecutionDispatchRefFallback,
} from "./dispatch-ref.ts";

export const HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION = "murph.execution-outbox.v2";

export type HostedExecutionOutboxPayloadStorage = "inline" | "reference";

export interface HostedExecutionInlineOutboxPayload {
  dispatch: HostedExecutionDispatchRequest;
  schemaVersion: typeof HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION;
  storage: "inline";
}

export interface HostedExecutionReferenceOutboxPayload {
  dispatchRef: HostedExecutionDispatchRef;
  schemaVersion: typeof HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION;
  storage: "reference";
}

export type HostedExecutionOutboxPayload =
  | HostedExecutionInlineOutboxPayload
  | HostedExecutionReferenceOutboxPayload;

export function buildHostedExecutionOutboxPayload(
  dispatch: HostedExecutionDispatchRequest,
  options: {
    storage?: HostedExecutionOutboxPayloadStorage | "auto";
  } = {},
): HostedExecutionOutboxPayload {
  const storage = resolveHostedExecutionOutboxPayloadStorage(dispatch, options.storage ?? "auto");

  if (storage === "inline") {
    return {
      dispatch: parseHostedExecutionDispatchRequest(dispatch),
      schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
      storage,
    };
  }

  return {
    dispatchRef: buildHostedExecutionDispatchRef(dispatch),
    schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
    storage,
  };
}

export function readHostedExecutionOutboxPayload(
  payloadJson: unknown,
  fallback: HostedExecutionDispatchRefFallback,
): HostedExecutionOutboxPayload | null {
  const payloadObject = toObject(payloadJson);
  const schemaVersion = readText(payloadObject.schemaVersion);

  if (schemaVersion === HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION) {
    const storage = readText(payloadObject.storage);

    if (storage === "inline") {
      return {
        dispatch: parseHostedExecutionDispatchRequest(payloadObject.dispatch),
        schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
        storage,
      };
    }

    if (storage === "reference") {
      const dispatchRef = readHostedExecutionDispatchRef(payloadObject, fallback);
      return dispatchRef
        ? {
            dispatchRef,
            schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
            storage,
          }
        : null;
    }

    return null;
  }
  return null;
}

export function resolveHostedExecutionOutboxPayloadStorage(
  dispatch: HostedExecutionDispatchRequest,
  requested: HostedExecutionOutboxPayloadStorage | "auto",
): HostedExecutionOutboxPayloadStorage {
  if (requested !== "auto") {
    return requested;
  }

  switch (dispatch.event.kind) {
    case "linq.message.received":
    case "telegram.message.received":
    case "email.message.received":
      return "reference";
    case "member.activated":
    case "assistant.cron.tick":
    case "device-sync.wake":
    case "vault.share.accepted":
    case "gateway.message.send":
      return "inline";
    default:
      throw new TypeError("Unsupported hosted execution event kind.");
  }
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

import type {
  HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedExecutionWake,
} from "@murphai/hosted-execution/parsers";

export const HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH =
  "/internal/hosted-runtime/mailbox-payload/decode";

export interface HostedMailboxPayloadDecodeItemRef {
  dedupeKey: string;
  id: string;
  kind: string;
  lane: string;
  laneSeq: string;
  occurredAt: string;
  userId: string;
}

export interface HostedMailboxPayloadDecodeRequest {
  itemRef: HostedMailboxPayloadDecodeItemRef;
  payloadCiphertext: string;
  payloadRequestId: string | null;
  payloadSchema: string;
  payloadSource: "inline" | "sidecar";
}

export type HostedMailboxPayloadDecodeResponse =
  | {
      status: "decoded";
      wake: HostedExecutionWake;
    }
  | {
      status: "blocked";
      reasonCode: string;
      retryable: boolean;
    };

export type HostedMailboxPayloadDecodeInput = HostedMailboxPayloadDecodeRequest;
export type HostedMailboxPayloadDecodeResult = HostedMailboxPayloadDecodeResponse;

export function parseHostedMailboxPayloadDecodeRequest(
  value: unknown,
): HostedMailboxPayloadDecodeRequest {
  const record = requireRecord(value, "Hosted mailbox payload decode request");
  const itemRef = requireRecord(
    record.itemRef,
    "Hosted mailbox payload decode request.itemRef",
  );

  return {
    itemRef: {
      dedupeKey: readString(itemRef.dedupeKey, "itemRef.dedupeKey"),
      id: readString(itemRef.id, "itemRef.id"),
      kind: readString(itemRef.kind, "itemRef.kind"),
      lane: readString(itemRef.lane, "itemRef.lane"),
      laneSeq: readString(itemRef.laneSeq, "itemRef.laneSeq"),
      occurredAt: readString(itemRef.occurredAt, "itemRef.occurredAt"),
      userId: readString(itemRef.userId, "itemRef.userId"),
    },
    payloadCiphertext: readString(record.payloadCiphertext, "payloadCiphertext"),
    payloadRequestId: readNullableString(record.payloadRequestId, "payloadRequestId"),
    payloadSchema: readString(record.payloadSchema, "payloadSchema"),
    payloadSource: readPayloadSource(record.payloadSource),
  };
}

export function parseHostedMailboxPayloadDecodeResponse(
  value: unknown,
): HostedMailboxPayloadDecodeResponse {
  const record = requireRecord(value, "Hosted mailbox payload decode response");
  const status = readString(record.status, "status");

  if (status === "decoded") {
    return {
      status,
      wake: parseHostedExecutionWake(record.wake),
    };
  }

  if (status === "blocked") {
    return {
      status,
      reasonCode: readString(record.reasonCode, "reasonCode"),
      retryable: readBoolean(record.retryable, "retryable"),
    };
  }

  throw new TypeError("Hosted mailbox payload decode response.status is invalid.");
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Hosted mailbox payload decode ${field} must be a non-empty string.`);
  }

  return value;
}

function readNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }

  return readString(value, field);
}

function readPayloadSource(value: unknown): "inline" | "sidecar" {
  if (value === "inline" || value === "sidecar") {
    return value;
  }

  throw new TypeError(
    "Hosted mailbox payload decode payloadSource must be inline or sidecar.",
  );
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`Hosted mailbox payload decode ${field} must be a boolean.`);
  }

  return value;
}

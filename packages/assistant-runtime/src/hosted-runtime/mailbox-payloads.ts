import { randomUUID } from "node:crypto";

import type {
  HostedMailboxItem,
  HostedMailboxReplayAuthority,
  HostedRuntimeSideInputUnavailableCode,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedRuntimeMailboxPort,
} from "./platform.ts";

export const HOSTED_MAILBOX_PAYLOAD_BLOCKED_CODES = [
  "double_payload",
  "missing_payload",
  "sidecar_unavailable",
  "sidecar_missing",
  "sidecar_mismatch",
] as const;

export type HostedMailboxPayloadBlockedCode =
  (typeof HOSTED_MAILBOX_PAYLOAD_BLOCKED_CODES)[number];

export type HostedMailboxPayloadResolutionResult =
  | {
      payloadCiphertext: string;
      payloadSchema: string;
      requestId: string | null;
      source: "inline" | "sidecar";
      status: "resolved";
    }
  | {
      code: HostedMailboxPayloadBlockedCode;
      requestId: string | null;
      retryable: boolean;
      sideInputUnavailableCode?: HostedRuntimeSideInputUnavailableCode | null;
      status: "blocked";
    };

export async function resolveHostedMailboxItemPayload(input: {
  item: HostedMailboxItem;
  mailboxPort: HostedRuntimeMailboxPort;
  replayAuthority?: HostedMailboxReplayAuthority | null;
  requestId?: string | null;
}): Promise<HostedMailboxPayloadResolutionResult> {
  const payloadInlineCiphertext = normalizeCiphertext(input.item.payloadInlineCiphertext);
  const payloadRef = normalizePayloadRef(input.item.payloadRef);
  const hasInlinePayload = payloadInlineCiphertext !== null;
  const hasSidecarPayload = payloadRef !== null;

  if (hasInlinePayload && hasSidecarPayload) {
    return createBlockedMailboxPayloadResult({
      code: "double_payload",
      requestId: null,
      retryable: false,
    });
  }

  if (hasInlinePayload) {
    return {
      payloadCiphertext: payloadInlineCiphertext,
      payloadSchema: input.item.payloadSchema,
      requestId: null,
      source: "inline",
      status: "resolved",
    };
  }

  if (!hasSidecarPayload) {
    return createBlockedMailboxPayloadResult({
      code: "missing_payload",
      requestId: null,
      retryable: false,
    });
  }

  const requestId = input.requestId ?? createHostedMailboxPayloadRequestId();
  const response = await input.mailboxPort.fetchPayload({
    dedupeKey: input.item.dedupeKey,
    mailboxItemId: input.item.id,
    payloadRef,
    ...(input.replayAuthority
      ? { replayAuthority: input.replayAuthority }
      : {}),
    requestId,
  });

  if (!response.payload) {
    return createBlockedMailboxPayloadResult({
      code: response.unavailable ? "sidecar_unavailable" : "sidecar_missing",
      requestId,
      retryable: response.unavailable?.retryable ?? true,
      sideInputUnavailableCode: response.unavailable?.code,
    });
  }

  if (
    response.payload.mailboxItemId !== input.item.id
      || response.payload.userId !== input.item.userId
      || response.payload.payloadSchema !== HOSTED_MAILBOX_PAYLOAD_SCHEMA
  ) {
    return createBlockedMailboxPayloadResult({
      code: "sidecar_mismatch",
      requestId,
      retryable: false,
    });
  }

  return {
    payloadCiphertext: response.payload.payloadCiphertext,
    payloadSchema: response.payload.payloadSchema,
    requestId,
    source: "sidecar",
    status: "resolved",
  };
}

function createHostedMailboxPayloadRequestId(): string {
  return `hosted-mailbox-payload-fetch:${randomUUID()}`;
}

function normalizeCiphertext(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value;
}

function normalizePayloadRef(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function createBlockedMailboxPayloadResult(input: {
  code: HostedMailboxPayloadBlockedCode;
  requestId: string | null;
  retryable: boolean;
  sideInputUnavailableCode?: HostedRuntimeSideInputUnavailableCode | null;
}): HostedMailboxPayloadResolutionResult {
  return {
    code: input.code,
    requestId: input.requestId,
    retryable: input.retryable,
    ...(input.sideInputUnavailableCode === undefined
      ? {}
      : { sideInputUnavailableCode: input.sideInputUnavailableCode }),
    status: "blocked",
  };
}

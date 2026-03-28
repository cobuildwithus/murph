import { createHmac, timingSafeEqual } from "node:crypto";

import { hostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment, requireHostedOnboardingLinqConfig } from "./runtime";
import { extractLinqTextMessage, normalizeNullableString } from "./shared";

export interface HostedLinqWebhookEvent {
  api_version: string;
  event_id: string;
  created_at: string;
  event_type: string;
  trace_id?: string | null;
  partner_id?: string | null;
  data: unknown;
}

export interface HostedLinqMessageReceivedData {
  chat_id: string;
  from: string;
  recipient_phone?: string | null;
  received_at?: string | null;
  is_from_me: boolean;
  service?: string | null;
  message: {
    id: string;
    parts?: unknown;
  };
}

export interface HostedLinqMessageReceivedEvent extends HostedLinqWebhookEvent {
  event_type: "message.received";
  data: HostedLinqMessageReceivedData;
}

export function parseHostedLinqWebhookEvent(rawBody: string): HostedLinqWebhookEvent {
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch (error) {
    throw new TypeError(
      `Linq webhook payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new TypeError("Linq webhook payload must be a JSON object.");
  }

  const record = payload as Record<string, unknown>;
  const apiVersion = normalizeRequiredString(record.api_version, "Linq webhook api_version");
  const eventId = normalizeRequiredString(record.event_id, "Linq webhook event_id");
  const createdAt = normalizeRequiredString(record.created_at, "Linq webhook created_at");
  const eventType = normalizeRequiredString(record.event_type, "Linq webhook event_type");

  return {
    api_version: apiVersion,
    event_id: eventId,
    created_at: createdAt,
    event_type: eventType,
    trace_id: normalizeNullableString(record.trace_id),
    partner_id: normalizeNullableString(record.partner_id),
    data: record.data,
  };
}

export function requireHostedLinqMessageReceivedEvent(
  event: HostedLinqWebhookEvent,
): HostedLinqMessageReceivedEvent {
  if (event.event_type !== "message.received" || !event.data || typeof event.data !== "object") {
    throw new TypeError("Linq webhook event does not contain a supported message.received payload.");
  }

  const data = event.data as Record<string, unknown>;
  const message = data.message;

  if (!message || typeof message !== "object") {
    throw new TypeError("Linq message.received payload is missing message data.");
  }

  return {
    ...event,
    event_type: "message.received",
    data: {
      chat_id: normalizeRequiredString(data.chat_id, "Linq message.received chat_id"),
      from: normalizeRequiredString(data.from, "Linq message.received from"),
      recipient_phone: normalizeNullableString(data.recipient_phone),
      received_at: normalizeNullableString(data.received_at),
      is_from_me: Boolean(data.is_from_me),
      service: normalizeNullableString(data.service),
      message: {
        id: normalizeRequiredString((message as Record<string, unknown>).id, "Linq message.received message.id"),
        parts: (message as Record<string, unknown>).parts,
      },
    },
  };
}

export function verifyHostedLinqWebhookSignature(
  secret: string,
  payload: string,
  timestamp: string,
  signature: string,
): boolean {
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const normalizedSignature = signature.replace(/^sha256=/iu, "").trim().toLowerCase();

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(normalizedSignature, "hex"));
  } catch {
    return false;
  }
}

export function assertHostedLinqWebhookSignature(input: {
  payload: string;
  signature: string | null;
  timestamp: string | null;
}): void {
  const { linqWebhookSecret: webhookSecret } = getHostedOnboardingEnvironment();

  if (!webhookSecret) {
    throw hostedOnboardingError({
      code: "LINQ_WEBHOOK_SECRET_MISSING",
      message: "LINQ_WEBHOOK_SECRET must be configured for the hosted Linq webhook.",
      httpStatus: 500,
    });
  }

  if (!input.signature || !input.timestamp) {
    throw hostedOnboardingError({
      code: "LINQ_SIGNATURE_REQUIRED",
      message: "Missing Linq webhook signature headers.",
      httpStatus: 401,
    });
  }

  if (!verifyHostedLinqWebhookSignature(webhookSecret, input.payload, input.timestamp, input.signature)) {
    throw hostedOnboardingError({
      code: "LINQ_SIGNATURE_INVALID",
      message: "Invalid Linq webhook signature.",
      httpStatus: 401,
    });
  }
}

export async function sendHostedLinqChatMessage(input: {
  chatId: string;
  message: string;
  replyToMessageId?: string | null;
  signal?: AbortSignal;
}): Promise<{ chatId: string | null; messageId: string | null }> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();
  const replyToMessageId = normalizeNullableString(input.replyToMessageId);
  const response = await fetch(
    new URL(`chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}/messages`, `${apiBaseUrl}/`),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          parts: [
            {
              type: "text",
              value: normalizeRequiredString(input.message, "message"),
            },
          ],
          ...(replyToMessageId
            ? {
                reply_to: {
                  message_id: replyToMessageId,
                },
              }
            : {}),
        },
      }),
      signal: input.signal,
    },
  );

  if (!response.ok) {
    throw hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      message: `Linq outbound reply failed with HTTP ${response.status}.`,
      httpStatus: 502,
      retryable: response.status >= 500,
    });
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return {
    chatId: normalizeNullableString(payload.chat_id),
    messageId:
      payload.message && typeof payload.message === "object"
        ? normalizeNullableString((payload.message as Record<string, unknown>).id)
        : null,
  };
}

export function summarizeHostedLinqMessage(event: HostedLinqMessageReceivedEvent): {
  chatId: string;
  isFromMe: boolean;
  messageId: string;
  phoneNumber: string;
  text: string | null;
} {
  return {
    chatId: event.data.chat_id,
    isFromMe: event.data.is_from_me,
    messageId: event.data.message.id,
    phoneNumber: event.data.from,
    text: extractLinqTextMessage(event.data.message),
  };
}

export function resolveHostedLinqOccurredAt(event: HostedLinqMessageReceivedEvent): string {
  return normalizeRequiredString(event.data.received_at ?? event.created_at, "Linq webhook occurredAt");
}

export function buildHostedInviteReply(input: {
  activeSubscription: boolean;
  joinUrl: string;
}): string {
  return input.activeSubscription
    ? `Murph hosted access is already active for this number.

Sign in with your verified phone here:
${input.joinUrl}`
    : `Murph hosted invite

Verify your phone and finish Apple Pay here:
${input.joinUrl}`;
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }

  return normalized;
}

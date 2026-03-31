import { hostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment, requireHostedOnboardingLinqConfig } from "./runtime";
import { extractLinqTextMessage, normalizeNullableString } from "./shared";
import { fetchLinqApi, LinqApiTimeoutError } from "../linq/api";
import {
  isLinqWebhookPayloadError,
  isLinqWebhookVerificationError,
  parseCanonicalLinqMessageReceivedEvent,
  parseLinqWebhookEvent,
  verifyAndParseLinqWebhookRequest,
  type LinqMessageReceivedEvent,
  type LinqWebhookEvent,
} from "@murph/inboxd";

export type HostedLinqWebhookEvent = LinqWebhookEvent;
export type HostedLinqMessageReceivedEvent = LinqMessageReceivedEvent;

export function parseHostedLinqWebhookEvent(rawBody: string): HostedLinqWebhookEvent {
  try {
    return parseLinqWebhookEvent(rawBody);
  } catch (error) {
    throw mapHostedLinqWebhookError(error, {
      signaturePresent: true,
      timestampPresent: true,
    });
  }
}

export function requireHostedLinqMessageReceivedEvent(
  event: HostedLinqWebhookEvent,
): HostedLinqMessageReceivedEvent {
  try {
    return parseCanonicalLinqMessageReceivedEvent(event);
  } catch (error) {
    if (error instanceof TypeError) {
      throw hostedOnboardingError({
        code: "LINQ_PAYLOAD_INVALID",
        message: error.message,
        httpStatus: 400,
      });
    }

    throw error;
  }
}

export function verifyAndParseHostedLinqWebhookRequest(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
}): HostedLinqWebhookEvent {
  const { linqWebhookSecret: webhookSecret } = getHostedOnboardingEnvironment();

  if (!webhookSecret) {
    throw hostedOnboardingError({
      code: "LINQ_WEBHOOK_SECRET_MISSING",
      message: "LINQ_WEBHOOK_SECRET must be configured for the hosted Linq webhook.",
      httpStatus: 500,
    });
  }

  try {
    return verifyAndParseLinqWebhookRequest({
      headers: {
        "x-webhook-signature": input.signature ?? undefined,
        "x-webhook-timestamp": input.timestamp ?? undefined,
      },
      rawBody: input.rawBody,
      webhookSecret,
    });
  } catch (error) {
    throw mapHostedLinqWebhookError(error, {
      signaturePresent: Boolean(input.signature),
      timestampPresent: Boolean(input.timestamp),
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
  let response: Response;
  try {
    response = await fetchLinqApi({
      apiBaseUrl,
      apiToken,
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
      method: "POST",
      path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}/messages`,
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof LinqApiTimeoutError) {
      throw hostedOnboardingError({
        code: "LINQ_SEND_FAILED",
        message: "Linq outbound reply timed out.",
        httpStatus: 502,
        retryable: true,
      });
    }

    throw error;
  }

  if (!response.ok) {
    throw hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      message: `Linq outbound reply failed with HTTP ${response.status}.`,
      httpStatus: 502,
      retryable: isRetryableHostedLinqStatus(response.status),
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

export function buildHostedGetStartedReply(): string {
  return "Hey, I'm Murph. I'm here to help you live long and prosper. Ready to get started?";
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }

  return normalized;
}

function isRetryableHostedLinqStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function mapHostedLinqWebhookError(
  error: unknown,
  input: {
    signaturePresent: boolean;
    timestampPresent: boolean;
  },
): never {
  if (isLinqWebhookVerificationError(error)) {
    const code = input.signaturePresent && input.timestampPresent
      ? "LINQ_SIGNATURE_INVALID"
      : "LINQ_SIGNATURE_REQUIRED";
    throw hostedOnboardingError({
      code,
      message: error.message,
      httpStatus: 401,
    });
  }

  if (isLinqWebhookPayloadError(error)) {
    throw hostedOnboardingError({
      code: "LINQ_PAYLOAD_INVALID",
      message: error.message,
      httpStatus: 400,
    });
  }

  throw error;
}

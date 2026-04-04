import { hostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment, requireHostedOnboardingLinqConfig } from "./runtime";
import { normalizePhoneNumber } from "./phone";
import { normalizeNullableString } from "./shared";
import { fetchLinqApi, LinqApiTimeoutError } from "../linq/api";
import {
  type LinqCreateChatResponse,
  type LinqCreateWebhookSubscriptionResponse,
  isLinqWebhookPayloadError,
  isLinqWebhookVerificationError,
  parseCanonicalLinqMessageReceivedEvent,
  parseLinqWebhookEvent,
  resolveLinqWebhookOccurredAt,
  summarizeLinqMessageReceivedEvent,
  verifyAndParseLinqWebhookRequest,
  type LinqMessageReceivedEvent,
  type LinqWebhookEvent,
} from "@murphai/messaging-ingress/linq-webhook";

export type HostedLinqWebhookEvent = LinqWebhookEvent;
export type HostedLinqMessageReceivedEvent = LinqMessageReceivedEvent;
export type HostedLinqWebhookSubscription = {
  createdAt: string | null;
  id: string | null;
  isActive: boolean | null;
  phoneNumbers: string[];
  signingSecret: string | null;
  subscribedEvents: string[];
  targetUrl: string | null;
  updatedAt: string | null;
};

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
      if (error.message.startsWith("Invalid ISO timestamp:")) {
        const timestampField = readHostedLinqInvalidTimestampField(event);
        throw hostedOnboardingError({
          code: "LINQ_PAYLOAD_INVALID",
          message: `${timestampField} must be a valid timestamp`,
          httpStatus: 400,
        });
      }

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
  const {
    linqWebhookSecret: webhookSecret,
    linqWebhookTimestampToleranceMs,
  } = getHostedOnboardingEnvironment();

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
      timestampToleranceMs: linqWebhookTimestampToleranceMs,
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
  idempotencyKey?: string | null;
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
      body: JSON.stringify(buildHostedLinqTextMessageBody({
        idempotencyKey: input.idempotencyKey,
        message: input.message,
        replyToMessageId,
      })),
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

export async function createHostedLinqChat(input: {
  from: string;
  idempotencyKey?: string | null;
  message: string;
  signal?: AbortSignal;
  to: string[];
}): Promise<{ chatId: string | null; messageId: string | null }> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();

  let response: Response;
  try {
    response = await fetchLinqApi({
      apiBaseUrl,
      apiToken,
      body: JSON.stringify({
        from: normalizeRequiredString(input.from, "from"),
        message: buildHostedLinqTextMessageBody({
          idempotencyKey: input.idempotencyKey,
          message: input.message,
        }).message,
        to: normalizeHostedLinqRecipients(input.to),
      }),
      method: "POST",
      path: "chats",
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof LinqApiTimeoutError) {
      throw hostedOnboardingError({
        code: "LINQ_SEND_FAILED",
        message: "Linq outbound chat creation timed out.",
        httpStatus: 502,
        retryable: true,
      });
    }

    throw error;
  }

  if (!response.ok) {
    throw hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      message: `Linq outbound chat creation failed with HTTP ${response.status}.`,
      httpStatus: 502,
      retryable: isRetryableHostedLinqStatus(response.status),
    });
  }

  const payload = (await response.json()) as LinqCreateChatResponse;
  return {
    chatId: normalizeNullableString(payload.chat?.id),
    messageId: normalizeNullableString(payload.chat?.message?.id),
  };
}

export async function createHostedLinqWebhookSubscription(input: {
  phoneNumbers?: readonly string[] | null;
  signal?: AbortSignal;
  subscribedEvents: readonly string[];
  targetUrl: string;
}): Promise<HostedLinqWebhookSubscription> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();

  let response: Response;
  try {
    response = await fetchLinqApi({
      apiBaseUrl,
      apiToken,
      body: JSON.stringify({
        ...(input.phoneNumbers && input.phoneNumbers.length > 0
          ? {
              phone_numbers: normalizeHostedLinqRecipients(input.phoneNumbers),
            }
          : {}),
        subscribed_events: normalizeHostedLinqSubscribedEvents(input.subscribedEvents),
        target_url: normalizeRequiredString(input.targetUrl, "target url"),
      }),
      method: "POST",
      path: "webhook-subscriptions",
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof LinqApiTimeoutError) {
      throw hostedOnboardingError({
        code: "LINQ_SEND_FAILED",
        message: "Linq webhook subscription creation timed out.",
        httpStatus: 502,
        retryable: true,
      });
    }

    throw error;
  }

  if (!response.ok) {
    throw hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      message: `Linq webhook subscription creation failed with HTTP ${response.status}.`,
      httpStatus: 502,
      retryable: isRetryableHostedLinqStatus(response.status),
    });
  }

  const payload = (await response.json()) as LinqCreateWebhookSubscriptionResponse;
  return {
    createdAt: normalizeNullableString(payload.created_at),
    id: normalizeNullableString(payload.id),
    isActive: typeof payload.is_active === "boolean" ? payload.is_active : null,
    phoneNumbers: normalizeHostedLinqOptionalTextArray(payload.phone_numbers),
    signingSecret: normalizeNullableString(payload.signing_secret),
    subscribedEvents: normalizeHostedLinqOptionalTextArray(payload.subscribed_events),
    targetUrl: normalizeNullableString(payload.target_url),
    updatedAt: normalizeNullableString(payload.updated_at),
  };
}

export function summarizeHostedLinqMessage(event: HostedLinqMessageReceivedEvent): {
  chatId: string;
  isFromMe: boolean;
  messageId: string;
  phoneNumber: string;
  text: string | null;
} {
  const summary = summarizeLinqMessageReceivedEvent(event);

  return {
    chatId: summary.chatId,
    isFromMe: summary.isFromMe,
    messageId: summary.messageId,
    phoneNumber: summary.phoneNumber,
    text: summary.text,
  };
}

export function resolveHostedLinqParticipantPhoneNumber(
  event: HostedLinqMessageReceivedEvent,
): string | null {
  if (!event.data.is_from_me) {
    return (
      normalizePhoneNumber(event.data.from)
      ?? normalizePhoneNumber(event.data.sender_handle?.handle)
    );
  }

  return (
    // Outbound echoes should attribute usage to the hosted member-side number.
    // Linq may populate recipient_phone with the external recipient, so treat it
    // as the weakest fallback.
    resolveHostedLinqOutboundFallbackPhoneNumber(event)
    ?? normalizePhoneNumber(event.data.recipient_phone)
  );
}

export function resolveHostedLinqOccurredAt(event: HostedLinqMessageReceivedEvent): string {
  return resolveLinqWebhookOccurredAt(event);
}

export function buildHostedInviteReply(input: {
  activeSubscription: boolean;
  joinUrl: string;
}): string {
  return input.activeSubscription
    ? `Murph access is already active for this number.

Sign in here:
${input.joinUrl}`
    : `Murph signup link

Verify your phone and finish signup here:
${input.joinUrl}`;
}

export function buildHostedDailyQuotaReply(): string {
  return "You have reached Murph's daily text limit of 100 messages. Try again tomorrow.";
}

export function buildHostedActivationWelcomeReply(): string {
  return `Hey, I'm Murph. I'm your personal health assistant.

You can send things as they happen - symptoms, sleep, meals, meds, workouts, labs, questions - and I keep compiling the picture over time so I can help you notice patterns, make better decisions, and work toward your goals. It's like having a private health team in your pocket.

What are some of your health goals right now, and what should I call you?`;
}

function resolveHostedLinqOutboundFallbackPhoneNumber(
  event: HostedLinqMessageReceivedEvent,
): string | null {
  const ownerPhone = normalizePhoneNumber(event.data.chat?.owner_handle?.handle);
  const senderHandlePhone = normalizePhoneNumber(event.data.sender_handle?.handle);
  if (senderHandlePhone && senderHandlePhone !== ownerPhone) {
    return senderHandlePhone;
  }

  const fromHandlePhone = normalizePhoneNumber(event.data.from_handle?.handle);
  if (fromHandlePhone && fromHandlePhone !== ownerPhone) {
    return fromHandlePhone;
  }

  const fromPhone = normalizePhoneNumber(event.data.from);
  if (fromPhone && fromPhone !== ownerPhone) {
    return fromPhone;
  }

  return null;
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

function buildHostedLinqTextMessageBody(input: {
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
}): {
  message: {
    idempotency_key?: string;
    parts: Array<{
      type: "text";
      value: string;
    }>;
    reply_to?: {
      message_id: string;
    };
  };
} {
  const idempotencyKey = normalizeNullableString(input.idempotencyKey);
  const replyToMessageId = normalizeNullableString(input.replyToMessageId);

  return {
    message: {
      parts: [
        {
          type: "text",
          value: normalizeRequiredString(input.message, "message"),
        },
      ],
      ...(idempotencyKey
        ? {
            idempotency_key: idempotencyKey,
          }
        : {}),
      ...(replyToMessageId
        ? {
            reply_to: {
              message_id: replyToMessageId,
            },
          }
        : {}),
    },
  };
}

function normalizeHostedLinqRecipients(values: readonly string[]): string[] {
  const recipients = values
    .map((value) => normalizeRequiredString(value, "recipient"))
    .filter((value, index, array) => array.indexOf(value) === index);

  if (recipients.length === 0) {
    throw new TypeError("At least one Linq recipient is required.");
  }

  return recipients;
}

function normalizeHostedLinqSubscribedEvents(values: readonly string[]): string[] {
  const subscribedEvents = values
    .map((value) => normalizeRequiredString(value, "subscribed event"))
    .filter((value, index, array) => array.indexOf(value) === index);

  if (subscribedEvents.length === 0) {
    throw new TypeError("At least one Linq subscribed event is required.");
  }

  return subscribedEvents;
}

function normalizeHostedLinqOptionalTextArray(values: readonly unknown[] | null | undefined): string[] {
  return (values ?? [])
    .map((value) => normalizeNullableString(value))
    .filter((value): value is string => value !== null);
}

function readHostedLinqInvalidTimestampField(event: HostedLinqWebhookEvent): "created_at" | "received_at" | "sent_at" {
  if (!event.data || typeof event.data !== "object" || Array.isArray(event.data)) {
    return "created_at";
  }

  const data = event.data as Record<string, unknown>;

  if ("sent_at" in data) {
    return "sent_at";
  }

  if ("received_at" in data) {
    return "received_at";
  }

  return "created_at";
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

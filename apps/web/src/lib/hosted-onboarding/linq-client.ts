import type {
  ChatCreateParams,
  ChatCreateResponse,
  TextPart,
  WebhookEventType,
  WebhookSubscriptionCreateParams,
  WebhookSubscriptionCreateResponse,
} from "@linqapp/sdk/resources";
import type { MessageSendParams } from "@linqapp/sdk/resources/chats";

import { fetchLinqApi, LinqApiTimeoutError } from "../linq/api";
import { hostedOnboardingError } from "./errors";
import { requireHostedOnboardingLinqConfig } from "./runtime";
import { normalizeNullableString } from "./shared";

const HOSTED_LINQ_WEBHOOK_EVENT_TYPES = [
  "message.sent",
  "message.received",
  "message.read",
  "message.delivered",
  "message.failed",
  "message.edited",
  "reaction.added",
  "reaction.removed",
  "participant.added",
  "participant.removed",
  "chat.created",
  "chat.group_name_updated",
  "chat.group_icon_updated",
  "chat.group_name_update_failed",
  "chat.group_icon_update_failed",
  "chat.typing_indicator.started",
  "chat.typing_indicator.stopped",
  "phone_number.status_updated",
  "call.initiated",
  "call.ringing",
  "call.answered",
  "call.ended",
  "call.failed",
  "call.declined",
  "call.no_answer",
  "location.sharing.started",
  "location.sharing.stopped",
] as const satisfies readonly WebhookEventType[];
const HOSTED_LINQ_WEBHOOK_EVENT_TYPE_SET: ReadonlySet<string> =
  new Set(HOSTED_LINQ_WEBHOOK_EVENT_TYPES);

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

export async function sendHostedLinqChatMessage(input: {
  chatId: string;
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
  signal?: AbortSignal;
}): Promise<void> {
  const replyToMessageId = normalizeNullableString(input.replyToMessageId);

  const response = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify(buildHostedLinqTextMessageBody({
      idempotencyKey: input.idempotencyKey,
      message: input.message,
      replyToMessageId,
    })),
    method: "POST",
    operation: "outbound reply",
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}/messages`,
    signal: input.signal,
    timeoutMessage: "Linq outbound reply timed out.",
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "outbound reply",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }
}

export async function sendHostedLinqReadReceipt(input: {
  chatId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  status: number;
}> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();

  const response = await fetchLinqApi({
    apiBaseUrl,
    apiToken,
    method: "POST",
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}/read`,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });

  return {
    ok: response.ok,
    status: response.status,
  };
}

export async function startHostedLinqTypingIndicator(input: {
  chatId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  status: number;
}> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();

  const response = await fetchLinqApi({
    apiBaseUrl,
    apiToken,
    method: "POST",
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}/typing`,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });

  return {
    ok: response.ok,
    status: response.status,
  };
}

export async function createHostedLinqChat(input: {
  from: string;
  idempotencyKey?: string | null;
  message: string;
  signal?: AbortSignal;
  to: string[];
}): Promise<{ chatId: string | null; messageId: string | null }> {
  const body: ChatCreateParams = {
    from: normalizeRequiredString(input.from, "from"),
    message: buildHostedLinqTextMessageBody({
      idempotencyKey: input.idempotencyKey,
      message: input.message,
    }).message,
    to: normalizeHostedLinqRecipients(input.to),
  };

  const response = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify(body),
    method: "POST",
    operation: "outbound chat creation",
    path: "chats",
    signal: input.signal,
    timeoutMessage: "Linq outbound chat creation timed out.",
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "outbound chat creation",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }

  const payload = (await response.json()) as ChatCreateResponse;
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
  const phoneNumbers = input.phoneNumbers && input.phoneNumbers.length > 0
    ? normalizeHostedLinqRecipients(input.phoneNumbers)
    : null;
  const body: WebhookSubscriptionCreateParams = {
    ...(phoneNumbers
      ? {
          phone_numbers: phoneNumbers,
        }
      : {}),
    subscribed_events: normalizeHostedLinqSubscribedEvents(input.subscribedEvents),
    target_url: normalizeRequiredString(input.targetUrl, "target url"),
  };

  const response = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify(body),
    method: "POST",
    operation: "webhook subscription creation",
    path: "webhook-subscriptions",
    signal: input.signal,
    timeoutMessage: "Linq webhook subscription creation timed out.",
  });

  if (!response.ok) {
    throw buildHostedLinqRequestFailedError({
      operation: "webhook subscription creation",
      retryable: isRetryableHostedLinqStatus(response.status),
      status: response.status,
    });
  }

  const payload = (await response.json()) as WebhookSubscriptionCreateResponse;
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

async function fetchHostedLinqApiOrThrow(input: {
  body: string;
  method: string;
  operation: string;
  path: string;
  signal?: AbortSignal;
  timeoutMessage: string;
}): Promise<Response> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();

  try {
    return await fetchLinqApi({
      apiBaseUrl,
      apiToken,
      body: input.body,
      method: input.method,
      path: input.path,
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof LinqApiTimeoutError) {
      throw hostedOnboardingError({
        code: "LINQ_SEND_FAILED",
        message: input.timeoutMessage,
        httpStatus: 502,
        retryable: true,
      });
    }

    throw error;
  }
}

function buildHostedLinqRequestFailedError(input: {
  operation: string;
  retryable: boolean;
  status: number;
}) {
  return hostedOnboardingError({
    code: "LINQ_SEND_FAILED",
    message: `Linq ${input.operation} failed with HTTP ${input.status}.`,
    httpStatus: 502,
    retryable: input.retryable,
  });
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
}): MessageSendParams {
  const idempotencyKey = normalizeNullableString(input.idempotencyKey);
  const replyToMessageId = normalizeNullableString(input.replyToMessageId);
  const textPart: TextPart = {
    type: "text",
    value: normalizeRequiredString(input.message, "message"),
  };

  return {
    message: {
      parts: [
        textPart,
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

function normalizeHostedLinqSubscribedEvents(values: readonly string[]): WebhookEventType[] {
  const subscribedEvents = values
    .map((value) => normalizeRequiredString(value, "subscribed event"))
    .filter((value, index, array) => array.indexOf(value) === index)
    .map((value) => {
      if (isHostedLinqWebhookEventType(value)) {
        return value;
      }

      throw new TypeError("Linq subscribed event is not supported by the Linq SDK contract.");
    });

  if (subscribedEvents.length === 0) {
    throw new TypeError("At least one Linq subscribed event is required.");
  }

  return subscribedEvents;
}

function isHostedLinqWebhookEventType(value: string): value is WebhookEventType {
  return HOSTED_LINQ_WEBHOOK_EVENT_TYPE_SET.has(value);
}

function normalizeHostedLinqOptionalTextArray(values: readonly unknown[] | null | undefined): string[] {
  return (values ?? [])
    .map((value) => normalizeNullableString(value))
    .filter((value): value is string => value !== null);
}

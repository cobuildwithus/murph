import type {
  LinqCreateChatResponse,
  LinqCreateWebhookSubscriptionResponse,
  LinqSendMessageResponse,
} from "@murphai/messaging-ingress/linq-webhook";

import { fetchLinqApi, LinqApiTimeoutError } from "../linq/api";
import { hostedOnboardingError } from "./errors";
import { requireHostedOnboardingLinqConfig } from "./runtime";
import { normalizeNullableString } from "./shared";

export type HostedLinqReputationStatus = "AT_RISK" | "CRITICAL" | "HEALTHY";

export type HostedLinqPhoneNumber = {
  healthStatusDocUrl: string | null;
  healthStatusStatus: HostedLinqReputationStatus | null;
  id: string | null;
  phoneNumber: string;
  reputationDocUrl: string | null;
  reputationStatus: HostedLinqReputationStatus;
};

export type HostedLinqContactCard = {
  firstName: string;
  imageUrl: string | null;
  isActive: boolean;
  lastName: string | null;
  phoneNumber: string;
};

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

export type HostedLinqSendResult = {
  chatId: string | null;
  messageId: string | null;
};

type LinqPhoneNumbersResponse = {
  phone_numbers?: Array<{
    health_status?: {
      doc_url?: string | null;
      status?: string | null;
    } | null;
    id?: string | null;
    phone_number?: string | null;
    reputation?: {
      doc_url?: string | null;
      status?: string | null;
    } | null;
  }> | null;
};

type LinqContactCardResponse = {
  first_name?: string | null;
  image_url?: string | null;
  is_active?: boolean | null;
  last_name?: string | null;
  phone_number?: string | null;
};

type LinqContactCardsResponse = {
  contact_cards?: LinqContactCardResponse[] | null;
};

export async function listHostedLinqPhoneNumbers(input: {
  signal?: AbortSignal;
} = {}): Promise<HostedLinqPhoneNumber[]> {
  const response = await fetchHostedLinqApiOrThrow({
    method: "GET",
    operation: "phone number list",
    path: "phone_numbers",
    signal: input.signal,
    timeoutMessage: "Linq phone number list timed out.",
  });

  assertHostedLinqResponseOk(response, "phone number list");

  const payload = await readHostedLinqOptionalJsonResponse<LinqPhoneNumbersResponse>(response);
  return (payload?.phone_numbers ?? [])
    .map(normalizeHostedLinqPhoneNumber)
    .filter((value): value is HostedLinqPhoneNumber => value !== null);
}

export async function listHostedLinqContactCards(input: {
  signal?: AbortSignal;
} = {}): Promise<HostedLinqContactCard[]> {
  const response = await fetchHostedLinqApiOrThrow({
    method: "GET",
    operation: "contact card list",
    path: "contact_card",
    signal: input.signal,
    timeoutMessage: "Linq contact card list timed out.",
  });

  assertHostedLinqResponseOk(response, "contact card list");

  const payload = await readHostedLinqOptionalJsonResponse<LinqContactCardsResponse>(response);
  return (payload?.contact_cards ?? [])
    .map(normalizeHostedLinqContactCard)
    .filter((value): value is HostedLinqContactCard => value !== null);
}

export async function setupHostedLinqContactCard(input: {
  firstName: string;
  imageUrl?: string | null;
  lastName?: string | null;
  phoneNumber: string;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCard> {
  const response = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify(buildHostedLinqContactCardBody(input)),
    method: "POST",
    operation: "contact card setup",
    path: "contact_card",
    signal: input.signal,
    timeoutMessage: "Linq contact card setup timed out.",
  });

  assertHostedLinqResponseOk(response, "contact card setup");

  const payload = await readHostedLinqOptionalJsonResponse<LinqContactCardResponse>(response);
  const card = normalizeHostedLinqContactCard(payload);
  if (!card) {
    throw hostedOnboardingError({
      code: "LINQ_CONTACT_CARD_RESPONSE_INVALID",
      message: "Linq contact card setup returned an invalid response.",
      httpStatus: 502,
      retryable: true,
    });
  }

  return card;
}

export async function updateHostedLinqContactCard(input: {
  firstName?: string | null;
  imageUrl?: string | null;
  lastName?: string | null;
  phoneNumber: string;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCard> {
  const phoneNumber = normalizeRequiredString(input.phoneNumber, "phone number");
  const response = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify(buildHostedLinqContactCardBody({
      firstName: input.firstName,
      imageUrl: input.imageUrl,
      lastName: input.lastName,
    })),
    method: "PATCH",
    operation: "contact card update",
    path: `contact_card?phone_number=${encodeURIComponent(phoneNumber)}`,
    signal: input.signal,
    timeoutMessage: "Linq contact card update timed out.",
  });

  assertHostedLinqResponseOk(response, "contact card update");

  const payload = await readHostedLinqOptionalJsonResponse<LinqContactCardResponse>(response);
  const card = normalizeHostedLinqContactCard(payload);
  if (!card) {
    throw hostedOnboardingError({
      code: "LINQ_CONTACT_CARD_RESPONSE_INVALID",
      message: "Linq contact card update returned an invalid response.",
      httpStatus: 502,
      retryable: true,
    });
  }

  return card;
}

export async function shareHostedLinqContactCard(input: {
  chatId: string;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetchHostedLinqApiOrThrow({
    method: "POST",
    operation: "contact card share",
    path: `chats/${encodeURIComponent(normalizeRequiredString(input.chatId, "chat id"))}/share_contact_card`,
    signal: input.signal,
    timeoutMessage: "Linq contact card share timed out.",
  });

  assertHostedLinqResponseOk(response, "contact card share");
}

export async function sendHostedLinqChatMessage(input: {
  chatId: string;
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
  signal?: AbortSignal;
}): Promise<HostedLinqSendResult> {
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

  assertHostedLinqResponseOk(response, "outbound reply");

  const payload = await readHostedLinqOptionalJsonResponse<LinqSendMessageResponse>(response);
  return {
    chatId: normalizeNullableString(payload?.chat_id),
    messageId: normalizeNullableString(payload?.message?.id),
  };
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
  const response = await fetchHostedLinqApiOrThrow({
    body: JSON.stringify({
      from: normalizeRequiredString(input.from, "from"),
      message: buildHostedLinqTextMessageBody({
        idempotencyKey: input.idempotencyKey,
        message: input.message,
      }).message,
      to: normalizeHostedLinqRecipients(input.to),
    }),
    method: "POST",
    operation: "outbound chat creation",
    path: "chats",
    signal: input.signal,
    timeoutMessage: "Linq outbound chat creation timed out.",
  });

  assertHostedLinqResponseOk(response, "outbound chat creation");

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
  const response = await fetchHostedLinqApiOrThrow({
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
    operation: "webhook subscription creation",
    path: "webhook-subscriptions",
    signal: input.signal,
    timeoutMessage: "Linq webhook subscription creation timed out.",
  });

  assertHostedLinqResponseOk(response, "webhook subscription creation");

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

async function fetchHostedLinqApiOrThrow(input: {
  body?: string;
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
      ...(input.body === undefined ? {} : { body: input.body }),
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

function assertHostedLinqResponseOk(response: Response, operation: string): void {
  if (response.ok) {
    return;
  }

  throw buildHostedLinqRequestFailedError({
    operation,
    retryable: isRetryableHostedLinqStatus(response.status),
    status: response.status,
  });
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

async function readHostedLinqOptionalJsonResponse<T>(response: Response): Promise<T | null> {
  try {
    const text = await response.text();
    if (!text.trim()) {
      return null;
    }

    return JSON.parse(text) as T;
  } catch {
    return null;
  }
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

function buildHostedLinqContactCardBody(input: {
  firstName?: string | null;
  imageUrl?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
}): Record<string, string> {
  const firstName = normalizeNullableString(input.firstName);
  const lastName = normalizeNullableString(input.lastName);
  const imageUrl = normalizeNullableString(input.imageUrl);
  const phoneNumber = normalizeNullableString(input.phoneNumber);

  return {
    ...(firstName ? { first_name: firstName } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(lastName ? { last_name: lastName } : {}),
    ...(phoneNumber ? { phone_number: phoneNumber } : {}),
  };
}

function normalizeHostedLinqPhoneNumber(value: unknown): HostedLinqPhoneNumber | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const phoneNumber = normalizeNullableString(record.phone_number);
  if (!phoneNumber) {
    return null;
  }

  const reputation = readHostedLinqStatusObject(record.reputation);
  const healthStatus = readHostedLinqStatusObject(record.health_status);
  return {
    healthStatusDocUrl: healthStatus.docUrl,
    healthStatusStatus: healthStatus.status,
    id: normalizeNullableString(record.id),
    phoneNumber,
    reputationDocUrl: reputation.docUrl,
    reputationStatus: reputation.status ?? healthStatus.status ?? "HEALTHY",
  };
}

function normalizeHostedLinqContactCard(value: unknown): HostedLinqContactCard | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const phoneNumber = normalizeNullableString(record.phone_number);
  const firstName = normalizeNullableString(record.first_name);
  if (!phoneNumber || !firstName) {
    return null;
  }

  return {
    firstName,
    imageUrl: normalizeNullableString(record.image_url),
    isActive: record.is_active === true,
    lastName: normalizeNullableString(record.last_name),
    phoneNumber,
  };
}

function readHostedLinqStatusObject(value: unknown): {
  docUrl: string | null;
  status: HostedLinqReputationStatus | null;
} {
  if (!value || typeof value !== "object") {
    return { docUrl: null, status: null };
  }

  const record = value as Record<string, unknown>;
  return {
    docUrl: normalizeNullableString(record.doc_url),
    status: normalizeHostedLinqReputationStatus(record.status),
  };
}

function normalizeHostedLinqReputationStatus(value: unknown): HostedLinqReputationStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return normalized === "AT_RISK" || normalized === "CRITICAL" || normalized === "HEALTHY"
    ? normalized
    : null;
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

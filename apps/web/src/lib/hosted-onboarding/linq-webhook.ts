import {
  type LinqMessageEditedEvent,
  type LinqMessageReceivedPartsInspection,
  type LinqMessageReceivedEvent,
  type LinqParticipantChangedEvent,
  type LinqTypingIndicatorStartedEvent,
  type LinqWebhookEvent,
  inspectLinqMessageReceivedParts,
  isLinqWebhookPayloadError,
  isLinqWebhookVerificationError,
  parseLinqMessageEditedEvent,
  parseLinqMessageReceivedEvent,
  parseLinqParticipantChangedEvent,
  parseLinqTypingIndicatorStartedEvent,
  parseLinqWebhookEvent,
  resolveLinqWebhookOccurredAt,
  summarizeLinqMessageReceivedEvent,
  verifyAndParseLinqWebhookRequest,
} from "@murphai/messaging-ingress/linq-webhook";

import { hostedOnboardingError } from "./errors";
import { normalizeHostedEmailAddress } from "./contact-privacy";
import {
  createHostedLinqParticipantContact,
  type HostedLinqParticipantContact,
} from "./linq-participant-contact";
import { normalizePhoneNumber } from "./phone";
import { getHostedOnboardingEnvironment } from "./runtime";

export type HostedLinqWebhookEvent = LinqWebhookEvent;
export type HostedLinqMessageEditedEvent = LinqMessageEditedEvent;
export type HostedLinqMessageReceivedEvent = LinqMessageReceivedEvent;
export type HostedLinqMessageReceivedPartsInspection = LinqMessageReceivedPartsInspection;
export type HostedLinqParticipantChangedEvent = LinqParticipantChangedEvent;
export type HostedLinqTypingIndicatorStartedEvent = LinqTypingIndicatorStartedEvent;

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
    return parseLinqMessageReceivedEvent(event);
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

export function inspectHostedLinqMessageReceivedParts(
  event: HostedLinqWebhookEvent,
): HostedLinqMessageReceivedPartsInspection | null {
  return inspectLinqMessageReceivedParts(event);
}

export function requireHostedLinqMessageEditedEvent(
  event: HostedLinqWebhookEvent,
): HostedLinqMessageEditedEvent {
  try {
    return parseLinqMessageEditedEvent(event);
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

export function requireHostedLinqParticipantChangedEvent(
  event: HostedLinqWebhookEvent,
): HostedLinqParticipantChangedEvent {
  try {
    return parseLinqParticipantChangedEvent(event);
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

export function requireHostedLinqTypingIndicatorStartedEvent(
  event: HostedLinqWebhookEvent,
): HostedLinqTypingIndicatorStartedEvent {
  try {
    return parseLinqTypingIndicatorStartedEvent(event);
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

export function resolveHostedLinqParticipantContact(
  event: HostedLinqMessageReceivedEvent,
): HostedLinqParticipantContact | null {
  const phone = resolveHostedLinqParticipantPhoneNumber(event);
  if (phone) {
    return createHostedLinqParticipantContact({
      kind: "phone",
      value: phone,
    });
  }

  const email = resolveHostedLinqParticipantEmailAddress(event);
  if (email) {
    return createHostedLinqParticipantContact({
      kind: "email",
      value: email,
    });
  }

  return null;
}

export function resolveHostedLinqParticipantEmailAddress(
  event: HostedLinqMessageReceivedEvent,
): string | null {
  if (!event.data.is_from_me) {
    return (
      normalizeHostedEmailAddress(event.data.from)
      ?? normalizeHostedEmailAddress(event.data.sender_handle?.handle)
    );
  }

  return (
    resolveHostedLinqOutboundFallbackEmailAddress(event)
    ?? normalizeHostedEmailAddress(event.data.recipient_phone)
  );
}

export function resolveHostedLinqRecipientPhoneNumber(
  event: HostedLinqMessageReceivedEvent,
): string | null {
  return (
    normalizePhoneNumber(event.data.recipient_phone)
    ?? normalizePhoneNumber(event.data.recipient_handle?.handle)
    ?? normalizePhoneNumber(event.data.chat?.owner_handle?.handle)
  );
}

export function resolveHostedLinqOccurredAt(event: HostedLinqMessageReceivedEvent): string {
  return resolveLinqWebhookOccurredAt(event);
}

export function shouldIgnoreHostedLinqForLocalInboundGuard(input: {
  isFromMe: boolean;
  participantContact: HostedLinqParticipantContact | null;
}): boolean {
  if (input.isFromMe) {
    return false;
  }

  const allowedPhoneNumbers =
    getHostedOnboardingEnvironment().linqLocalAllowedInboundPhoneNumbers;

  if (!allowedPhoneNumbers) {
    return false;
  }

  return input.participantContact?.kind !== "phone"
    || !allowedPhoneNumbers.includes(input.participantContact.value);
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

function resolveHostedLinqOutboundFallbackEmailAddress(
  event: HostedLinqMessageReceivedEvent,
): string | null {
  const ownerEmail = normalizeHostedEmailAddress(event.data.chat?.owner_handle?.handle);
  const senderHandleEmail = normalizeHostedEmailAddress(event.data.sender_handle?.handle);
  if (senderHandleEmail && senderHandleEmail !== ownerEmail) {
    return senderHandleEmail;
  }

  const fromHandleEmail = normalizeHostedEmailAddress(event.data.from_handle?.handle);
  if (fromHandleEmail && fromHandleEmail !== ownerEmail) {
    return fromHandleEmail;
  }

  const fromEmail = normalizeHostedEmailAddress(event.data.from);
  if (fromEmail && fromEmail !== ownerEmail) {
    return fromEmail;
  }

  return null;
}

function readHostedLinqInvalidTimestampField(
  event: HostedLinqWebhookEvent,
): "created_at" | "received_at" | "sent_at" {
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

import * as ingress from "@murphai/messaging-ingress/linq-webhook";
import { afterEach, expect, it, vi } from "vitest";

import {
  requireHostedLinqMessageReceivedEvent,
  requireHostedLinqMessageEditedEvent,
  requireHostedLinqParticipantChangedEvent,
  requireHostedLinqTypingIndicatorStartedEvent,
  resolveHostedLinqRecipientPhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-webhook";

afterEach(() => vi.restoreAllMocks());

const parsers = [
  ["parseLinqMessageReceivedEvent", requireHostedLinqMessageReceivedEvent],
  ["parseLinqMessageEditedEvent", requireHostedLinqMessageEditedEvent],
  ["parseLinqParticipantChangedEvent", requireHostedLinqParticipantChangedEvent],
  ["parseLinqTypingIndicatorStartedEvent", requireHostedLinqTypingIndicatorStartedEvent],
] as const;
const invalidEvent = {
  api_version: "v3", event_id: "synthetic-event", created_at: "invalid",
  event_type: "unsupported", data: null,
};

it.each(parsers)("keeps declared payload rejections from %s at 400", (_name, parse) => {
  expect(() => parse(invalidEvent)).toThrow(expect.objectContaining({
    code: "LINQ_PAYLOAD_INVALID", httpStatus: 400,
  }));
});

it.each(parsers)("propagates implementation faults from %s", (name, parse) => {
  const fault = new TypeError("Synthetic parser failure");
  vi.spyOn(ingress, name).mockImplementation(() => { throw fault; });
  expect(() => parse(invalidEvent)).toThrow(fault);
  expect(() => parse(invalidEvent)).not.toThrow(expect.objectContaining({ httpStatus: 400 }));
});

it("maps missing nested required fields to the existing payload rejection", () => {
  expect(() => requireHostedLinqMessageReceivedEvent({
    ...invalidEvent, event_type: "message.received", data: { chat: {} },
  })).toThrow(expect.objectContaining({ code: "LINQ_PAYLOAD_INVALID", httpStatus: 400 }));
});

it("prefers explicit raw recipient fields over chat owner data", () => {
  const event = requireHostedLinqMessageReceivedEvent({
    api_version: "v3",
    created_at: "2026-03-28T12:00:00.000Z",
    data: {
      chat: {
        id: "chat_legacy_recipient",
        owner_handle: {
          handle: "+15550000000",
          id: "handle_owner_legacy",
          is_me: true,
          service: "sms",
        },
      },
      direction: "inbound",
      id: "msg_legacy_recipient",
      parts: [],
      recipient_handle: {
        handle: "+15557654321",
        id: "handle_recipient_legacy",
        is_me: true,
        service: "sms",
      },
      recipient_phone: "+15557654321",
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_legacy",
        service: "sms",
      },
      sent_at: "2026-03-28T12:00:00.000Z",
      service: "sms",
    },
    event_id: "evt_legacy_recipient",
    event_type: "message.received",
    webhook_version: "2026-02-03",
  });

  expect(event.data.recipient_phone).toBe("+15557654321");
  expect(event.data.recipient_handle).toMatchObject({
    handle: "+15557654321",
    id: "handle_recipient_legacy",
  });
  expect(resolveHostedLinqRecipientPhoneNumber(event)).toBe("+15557654321");
});

it("falls back to an explicit raw recipient handle when recipient_phone is absent", () => {
  const event = requireHostedLinqMessageReceivedEvent({
    api_version: "v3",
    created_at: "2026-03-28T12:00:00.000Z",
    data: {
      chat: {
        id: "chat_legacy_recipient_handle_only",
        owner_handle: {
          handle: "+15550000000",
          id: "handle_owner_legacy_only",
          is_me: true,
          service: "sms",
        },
      },
      direction: "inbound",
      id: "msg_legacy_recipient_handle_only",
      parts: [],
      recipient_handle: {
        handle: "+15557654321",
        id: "handle_recipient_legacy_only",
        is_me: true,
        service: "sms",
      },
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_legacy_only",
        service: "sms",
      },
      sent_at: "2026-03-28T12:00:00.000Z",
      service: "sms",
    },
    event_id: "evt_legacy_recipient_handle_only",
    event_type: "message.received",
    webhook_version: "2026-02-03",
  });

  expect(event.data.recipient_phone).toBe("+15557654321");
  expect(resolveHostedLinqRecipientPhoneNumber(event)).toBe("+15557654321");
});

import type { Message } from "@linqapp/sdk/resources/messages";
import { describe, expect, it } from "vitest";

import {
  buildHostedLinqTerminalRetryMessage,
  isHostedLinqTerminalSendFailure,
} from "@/src/lib/hosted-onboarding/linq-terminal-retry";

const original: Message = {
  id: "synthetic-message", chat_id: "synthetic-chat",
  created_at: "2030-02-01T12:00:00Z", updated_at: "2030-02-01T12:00:01Z",
  delivery_status: "failed", is_from_me: true, is_delivered: false, is_read: false,
  service: "iMessage",
  parts: [{ type: "text", value: "The document is ready.", reactions: null }],
};

describe("one terminal Linq retry request", () => {
  it.each([
    ["4001", "Message send failed", true],
    ["4001", "Message delivery failed", false],
    ["4001", "Message delivery failed. Please retry the message.", false],
    ["4006", "Message send failed", false],
    ["4001", null, false],
    [null, "Message send failed", false],
  ])("classifies code %s / reason %s", (failureCode, failureReason, expected) => {
    expect(isHostedLinqTerminalSendFailure({ failureCode, failureReason })).toBe(expected);
  });

  it("preserves text, native reply selection and effects with one retry key", () => {
    const message = {
      ...original,
      reply_to: { message_id: "synthetic-selected-message", part_index: 1 },
      effect: { type: "bubble" as const, name: "gentle" },
    };
    expect(buildHostedLinqTerminalRetryMessage(message, "retry-key")).toEqual({
      idempotency_key: "retry-key", preferred_service: "iMessage",
      parts: [{ type: "text", value: "The document is ready." }],
      reply_to: message.reply_to, effect: message.effect,
    });
  });

  it("preserves a native link without adding text or expanding siblings", () => {
    expect(buildHostedLinqTerminalRetryMessage({
      ...original,
      parts: [{ type: "link", value: "https://example.test/document", reactions: null }],
    }, "retry-key")?.parts).toEqual([
      { type: "link", value: "https://example.test/document" },
    ]);
  });

  it("reuses a non-audio attachment identity without downloading or retaining its URL", () => {
    expect(buildHostedLinqTerminalRetryMessage({
      ...original,
      parts: [{
        type: "media", id: "synthetic-attachment", filename: "document.pdf",
        mime_type: "application/pdf", size_bytes: 100, reactions: null,
        url: "https://example.test/private-attachment",
      }],
    }, "retry-key")?.parts).toEqual([
      { type: "media", attachment_id: "synthetic-attachment" },
    ]);
  });

  it("does not change a voice memo into a file attachment or reconstruct an app action", () => {
    expect(buildHostedLinqTerminalRetryMessage({
      ...original,
      parts: [{
        type: "media", id: "audio", filename: "audio.m4a",
        mime_type: "audio/mp4", size_bytes: 100, reactions: null,
        url: "https://example.test/audio",
      }],
    }, "retry-key")).toBeNull();
    expect(buildHostedLinqTerminalRetryMessage({
      ...original,
      parts: [{
        type: "imessage_app", reactions: null, url: "https://example.test/action",
        app: { bundle_id: "test.app", team_id: "SYNTHETIC1", name: "Example" },
        layout: { caption: "Example" },
      }],
    }, "retry-key")).toBeNull();
  });
});

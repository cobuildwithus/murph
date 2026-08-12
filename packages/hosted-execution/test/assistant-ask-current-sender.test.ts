import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantAskRequestedWake,
} from "../src/builders.ts";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
  readHostedExecutionAssistantAskGroupSenderResponseDestination,
  readHostedExecutionConversationMessageText,
} from "../src/contracts.ts";
import {
  parseHostedExecutionAssistantAskRequestedPayload,
  parseHostedExecutionWake,
  parseHostedRuntimeGroupToolRequest,
  parseHostedRuntimeGroupToolResponse,
} from "../src/parsers.ts";

const ORIGIN_ASSISTANT_INPUT_ID = `ain_${"a".repeat(32)}`;
const REQUESTED_AT = "2026-07-27T20:00:00.000Z";
const EXPIRES_AT = new Date(
  Date.parse(REQUESTED_AT) + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
).toISOString();

const CURRENT_SENDER_ASK = {
  expiresAt: EXPIRES_AT,
  origin: {
    assistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    kind: "accepted_input" as const,
    sessionId: "session_group",
  },
  question: "Murph tell this synthetic room about my sleep",
  target: {
    groupRuntimeMemberId: "member_group_runtime",
    kind: "group_sender" as const,
    permissionDigest: "d".repeat(64),
  },
};

describe("hosted current-sender Assistant Ask contracts", () => {
  it("round-trips one accepted-input target type for both destinations", () => {
    for (const [kind, responseDestination] of [
      ["group_sender", "group"],
      ["group_sender_private", "current_sender"],
    ] as const) {
      const ask = {
        ...CURRENT_SENDER_ASK,
        target: { ...CURRENT_SENDER_ASK.target, kind },
      };
      expect(parseHostedExecutionAssistantAskRequestedPayload(ask)).toEqual(ask);
      expect(
        readHostedExecutionAssistantAskGroupSenderResponseDestination(
          ask.target,
        ),
      ).toBe(responseDestination);

      const wake = buildHostedExecutionAssistantAskRequestedWake({
        ask,
        eventId: `aask_req_${(kind === "group_sender" ? "b" : "c").repeat(64)}`,
        memberId: "member_personal_runtime",
        occurredAt: REQUESTED_AT,
      });
      expect(parseHostedExecutionWake(wake)).toEqual(wake);
    }
  });

  it("rejects scheduled or model-selected current-sender authority", () => {
    expect(() => parseHostedExecutionAssistantAskRequestedPayload({
      ...CURRENT_SENDER_ASK,
      origin: {
        automationId: "automation_1",
        kind: "automation_occurrence",
        occurrenceAt: REQUESTED_AT,
      },
    })).toThrow(/accepted input/u);

    expect(() => parseHostedExecutionAssistantAskRequestedPayload({
      ...CURRENT_SENDER_ASK,
      target: {
        ...CURRENT_SENDER_ASK.target,
        targetMemberId: "model_selected_member",
      },
    })).toThrow(/unsupported field/u);
  });

  it("parses the canonical destination-bearing request", () => {
    for (const responseDestination of ["group", "current_sender"] as const) {
      const request = {
        action: "ask_current_sender",
        origin: CURRENT_SENDER_ASK.origin,
        responseDestination,
      } as const;
      expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request);
    }

    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "ask_current_sender",
      origin: CURRENT_SENDER_ASK.origin,
      question: "model paraphrase",
      responseDestination: "group",
    })).toThrow(/not allowed/u);
    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "ask_current_sender",
      origin: CURRENT_SENDER_ASK.origin,
      responseDestination: "other",
    })).toThrow(/invalid/u);
  });

  it("canonicalizes only the legacy transport request aliases", () => {
    expect(parseHostedRuntimeGroupToolRequest({
      action: "ask_current_sender",
      origin: CURRENT_SENDER_ASK.origin,
    })).toEqual({
      action: "ask_current_sender",
      origin: CURRENT_SENDER_ASK.origin,
      responseDestination: "group",
    });
    expect(parseHostedRuntimeGroupToolRequest({
      action: "message_current_sender",
      origin: CURRENT_SENDER_ASK.origin,
    })).toEqual({
      action: "ask_current_sender",
      origin: CURRENT_SENDER_ASK.origin,
      responseDestination: "current_sender",
    });
  });

  it("parses group and direct terminal results under one action", () => {
    expect(parseHostedRuntimeGroupToolResponse({
      action: "ask_current_sender",
      responseDestination: "group",
      result: { status: "accepted" },
    })).toEqual({
      action: "ask_current_sender",
      responseDestination: "group",
      result: { status: "accepted" },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "ask_current_sender",
      responseDestination: "group",
      result: {
        answer: "Synthetic reviewed group answer.",
        outcome: "answered",
        status: "completed",
      },
    })).toMatchObject({
      action: "ask_current_sender",
      responseDestination: "group",
      result: { outcome: "answered", status: "completed" },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "ask_current_sender",
      responseDestination: "current_sender",
      result: {
        status: "unavailable",
        unavailableReason: "same_channel_direct_route_unavailable",
      },
    })).toEqual({
      action: "ask_current_sender",
      responseDestination: "current_sender",
      result: {
        status: "unavailable",
        unavailableReason: "same_channel_direct_route_unavailable",
      },
    });
    expect(() => parseHostedRuntimeGroupToolResponse({
      action: "ask_current_sender",
      responseDestination: "current_sender",
      result: {
        answer: "not a direct-delivery admission result",
        outcome: "answered",
        status: "completed",
      },
    })).toThrow(/status is invalid/u);
  });

  it("canonicalizes legacy transport responses for rolling deploys", () => {
    expect(parseHostedRuntimeGroupToolResponse({
      action: "ask_current_sender",
      result: { status: "accepted" },
    })).toEqual({
      action: "ask_current_sender",
      responseDestination: "group",
      result: { status: "accepted" },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "message_current_sender",
      result: { status: "accepted" },
    })).toEqual({
      action: "ask_current_sender",
      responseDestination: "current_sender",
      result: { status: "accepted" },
    });
  });

  it("reads exactly the authored Linq or Telegram text and never email text", () => {
    expect(readHostedExecutionConversationMessageText({
      channel: "linq",
      linqMessage: {
        chatId: "chat_1",
        from: "+15550000001",
        isFromMe: false,
        messageId: "message_1",
        parts: [
          { type: "text", value: "  Murph tell them  " },
          { type: "link", value: "https://example.test/ignored" },
          { type: "text", value: "about my sleep  " },
        ],
        threadIsDirect: false,
      },
      phoneLookupKey: "hplk_sender",
    })).toBe("Murph tell them  \nabout my sleep");

    expect(readHostedExecutionConversationMessageText({
      channel: "telegram",
      telegramMessage: {
        messageId: "12",
        schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
        text: "  Tell them about my recovery  ",
        threadId: "123",
        threadIsDirect: false,
      },
    })).toBe("Tell them about my recovery");

    expect(readHostedExecutionConversationMessageText({
      channel: "email",
      identityId: "email_identity",
      rawMessageKey: "raw_email_1",
      textPreview: "Do not use group email as current-sender authority.",
    })).toBeNull();
  });
});

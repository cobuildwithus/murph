import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantAskRequestedWake,
} from "../src/builders.ts";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT,
  HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
  readHostedExecutionConversationMessageText,
} from "../src/contracts.ts";
import {
  parseHostedExecutionAssistantAskRequestedPayload,
  parseHostedExecutionWake,
  parseHostedRuntimeAssistantAskControlRequest,
  parseHostedRuntimeAssistantAskControlResponse,
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
  question: "Murph, ask my Murph how my synthetic activity changed?",
  target: {
    groupRuntimeMemberId: "member_group_runtime",
    kind: "group_sender" as const,
    permissionDigest: "d".repeat(64),
  },
};

describe("hosted current-sender Assistant Ask contracts", () => {
  it("round-trips the fixed group and private target kinds", () => {
    for (const kind of ["group_sender", "group_sender_private"] as const) {
      const ask = {
        ...CURRENT_SENDER_ASK,
        target: { ...CURRENT_SENDER_ASK.target, kind },
      };
      expect(parseHostedExecutionAssistantAskRequestedPayload(ask)).toEqual(ask);
      const wake = buildHostedExecutionAssistantAskRequestedWake({
        ask,
        eventId: `aask_req_${(kind === "group_sender" ? "b" : "c").repeat(64)}`,
        memberId: "member_personal_runtime",
        occurredAt: REQUESTED_AT,
      });
      expect(parseHostedExecutionWake(wake)).toEqual(wake);
    }

    expect(HOSTED_EXECUTION_CURRENT_SENDER_GROUP_PERMISSION_TEXT).toMatch(
      /one answer to that same group/u,
    );
    expect(HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT).toMatch(
      /one direct private message/u,
    );
  });

  it("rejects scheduled or model-selected target authority", () => {
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

  it("parses trusted audience decisions and canonicalizes the legacy private action", () => {
    const canonical = {
      action: "ask_current_sender",
      audience: "group",
      mode: "new",
      origin: CURRENT_SENDER_ASK.origin,
    } as const;
    expect(parseHostedRuntimeGroupToolRequest(canonical)).toEqual(canonical);
    expect(parseHostedRuntimeGroupToolRequest({
      action: "message_current_sender",
      origin: CURRENT_SENDER_ASK.origin,
    })).toEqual({
      action: "ask_current_sender",
      audience: "current_sender",
      mode: "new",
      origin: CURRENT_SENDER_ASK.origin,
    });

    expect(parseHostedRuntimeGroupToolRequest({
      action: "ask_current_sender",
      mode: "clarification",
      origin: CURRENT_SENDER_ASK.origin,
    })).toEqual({
      action: "ask_current_sender",
      mode: "clarification",
      origin: CURRENT_SENDER_ASK.origin,
    });

    expect(() => parseHostedRuntimeGroupToolRequest({
      ...canonical,
      question: "model paraphrase",
    })).toThrow(/not allowed/u);
    expect(() => parseHostedRuntimeGroupToolRequest({
      ...canonical,
      responseDestination: "current_sender",
    })).toThrow(/not allowed/u);
  });

  it("canonicalizes the bounded legacy action response without carrying audience", () => {
    const canonical = {
      action: "ask_current_sender",
      result: { status: "accepted" as const },
    };
    expect(parseHostedRuntimeGroupToolResponse(canonical)).toEqual(canonical);
    expect(parseHostedRuntimeGroupToolResponse({
      action: "message_current_sender",
      result: { status: "accepted" },
    })).toEqual(canonical);
    expect(() => parseHostedRuntimeGroupToolResponse({
      ...canonical,
      responseDestination: "group",
    })).toThrow(/not allowed/u);
  });

  it("rejects removed completion audience metadata and parses persisted completion replay", () => {
    const requestId = `aask_req_${"e".repeat(64)}`;
    const result = {
      answer: "Synthetic reviewed answer.",
      outcome: "answered" as const,
    };
    expect(() => parseHostedRuntimeAssistantAskControlRequest({
      action: "complete",
      requestId,
      responseDestination: "current_sender",
      result,
    })).toThrow(/not allowed/u);
    expect(parseHostedRuntimeAssistantAskControlResponse({
      action: "prepare",
      status: "already_completed",
    })).toEqual({ action: "prepare", status: "already_completed" });
    expect(() => parseHostedRuntimeAssistantAskControlRequest({
      action: "prepare",
      requestId,
      responseDestination: "group",
    })).toThrow(/not allowed/u);
  });

  it("reads exact Linq or Telegram text while preserving reply evidence elsewhere", () => {
    expect(readHostedExecutionConversationMessageText({
      channel: "linq",
      linqMessage: {
        chatId: "chat_1",
        from: "+15550000001",
        isFromMe: false,
        messageId: "message_1",
        parts: [
          { type: "text", value: "  Murph, ask my Murph  " },
          { type: "link", value: "https://example.test/ignored" },
          { type: "text", value: "about my synthetic activity  " },
        ],
        replyToMessageId: "message_0",
        threadIsDirect: false,
      },
      phoneLookupKey: "hplk_sender",
    })).toBe("Murph, ask my Murph  \nabout my synthetic activity");

    expect(readHostedExecutionConversationMessageText({
      channel: "telegram",
      telegramMessage: {
        messageId: "12",
        replyContextPreview: "Synthetic prior message",
        schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
        text: "  Ask my Murph about my synthetic recovery  ",
        threadId: "123",
        threadIsDirect: false,
      },
    })).toBe("Ask my Murph about my synthetic recovery");

    expect(readHostedExecutionConversationMessageText({
      channel: "email",
      identityId: "email_identity",
      rawMessageKey: "raw_email_1",
      textPreview: "Not group authority.",
    })).toBeNull();
  });
});

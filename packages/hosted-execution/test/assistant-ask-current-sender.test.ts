import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantAskRequestedWake,
} from "../src/builders.ts";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  HOSTED_EXECUTION_CURRENT_SENDER_REVIEWED_PERMISSION_TEXT,
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
  readHostedExecutionConversationMessageText,
} from "../src/contracts.ts";
import {
  parseHostedExecutionAssistantAskRequestedPayload,
  parseHostedExecutionWake,
  parseHostedRuntimeAssistantAskControlRequest,
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
  question: "Murph, share this synthetic answer in this group.",
  target: {
    groupRuntimeMemberId: "member_group_runtime",
    kind: "group_sender" as const,
    permissionDigest: "d".repeat(64),
  },
};

describe("hosted current-sender Assistant Ask contracts", () => {
  it("round-trips the neutral target and retained legacy private target", () => {
    for (const kind of [
      "group_sender",
      "group_sender_private",
    ] as const) {
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
    expect(HOSTED_EXECUTION_CURRENT_SENDER_REVIEWED_PERMISSION_TEXT).toMatch(
      /Return to the current group unless the question explicitly asks for a private or direct reply/u,
    );
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

  it("parses one destination-free canonical request and drops legacy metadata", () => {
    const canonical = {
      action: "ask_current_sender",
      origin: CURRENT_SENDER_ASK.origin,
    } as const;
    expect(parseHostedRuntimeGroupToolRequest(canonical)).toEqual(canonical);

    expect(parseHostedRuntimeGroupToolRequest({
      ...canonical,
      responseDestination: "group",
    })).toEqual(canonical);
    expect(parseHostedRuntimeGroupToolRequest({
      action: "message_current_sender",
      origin: CURRENT_SENDER_ASK.origin,
    })).toEqual(canonical);

    expect(() => parseHostedRuntimeGroupToolRequest({
      ...canonical,
      question: "model paraphrase",
    })).toThrow(/not allowed/u);
    expect(() => parseHostedRuntimeGroupToolRequest({
      ...canonical,
      responseDestination: "other",
    })).toThrow(/invalid/u);
  });

  it("parses one destination-free response and canonicalizes legacy aliases", () => {
    const canonical = {
      action: "ask_current_sender",
      result: { status: "accepted" as const },
    };
    expect(parseHostedRuntimeGroupToolResponse(canonical)).toEqual(canonical);
    expect(parseHostedRuntimeGroupToolResponse({
      ...canonical,
      responseDestination: "current_sender",
    })).toEqual(canonical);
    expect(parseHostedRuntimeGroupToolResponse({
      action: "message_current_sender",
      result: { status: "accepted" },
    })).toEqual(canonical);
    expect(() => parseHostedRuntimeGroupToolResponse({
      action: "ask_current_sender",
      result: {
        answer: "not an admission result",
        outcome: "answered",
        status: "completed",
      },
    })).toThrow(/status is invalid/u);
  });

  it("allows only the personal runtime completion to carry the reviewed audience", () => {
    const result = {
      answer: "Synthetic reviewed answer.",
      outcome: "answered" as const,
    };
    expect(parseHostedRuntimeAssistantAskControlRequest({
      action: "complete",
      requestId: `aask_req_${"e".repeat(64)}`,
      responseDestination: "current_sender",
      result,
    })).toEqual({
      action: "complete",
      requestId: `aask_req_${"e".repeat(64)}`,
      responseDestination: "current_sender",
      result,
    });
    expect(() => parseHostedRuntimeAssistantAskControlRequest({
      action: "prepare",
      requestId: `aask_req_${"e".repeat(64)}`,
      responseDestination: "group",
    })).toThrow(/not allowed/u);
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

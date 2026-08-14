import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantAskRequestedWake,
} from "../src/builders.ts";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
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
  question: "Murph tell them about my sleep",
  target: {
    groupRuntimeMemberId: "member_group_runtime",
    kind: "group_sender" as const,
    permissionDigest: "d".repeat(64),
  },
};

describe("hosted current-sender Assistant Ask contracts", () => {
  it("round-trips the accepted-input-only group_sender request", () => {
    expect(parseHostedExecutionAssistantAskRequestedPayload(
      CURRENT_SENDER_ASK,
    )).toEqual(CURRENT_SENDER_ASK);

    const wake = buildHostedExecutionAssistantAskRequestedWake({
      ask: CURRENT_SENDER_ASK,
      eventId: `aask_req_${"b".repeat(64)}`,
      memberId: "member_personal_runtime",
      occurredAt: REQUESTED_AT,
    });
    expect(parseHostedExecutionWake(wake)).toEqual(wake);
  });

  it("rejects scheduled or model-selected authority on group_sender", () => {
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

  it("round-trips the accepted-input-only private group-sender request", () => {
    const privateAsk = {
      ...CURRENT_SENDER_ASK,
      target: {
        ...CURRENT_SENDER_ASK.target,
        kind: "group_sender_private" as const,
      },
    };
    expect(parseHostedExecutionAssistantAskRequestedPayload(
      privateAsk,
    )).toEqual(privateAsk);
    expect(() => parseHostedExecutionAssistantAskRequestedPayload({
      ...privateAsk,
      origin: {
        automationId: "automation_1",
        kind: "automation_occurrence",
        occurrenceAt: REQUESTED_AT,
      },
    })).toThrow(/accepted input/u);
  });

  it("parses the narrow group-tool request and shared member-ask results", () => {
    const request = {
      action: "ask_current_sender",
      origin: CURRENT_SENDER_ASK.origin,
    } as const;
    expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request);
    expect(() => parseHostedRuntimeGroupToolRequest({
      ...request,
      question: "model paraphrase",
    })).toThrow(/not allowed/u);

    expect(parseHostedRuntimeGroupToolResponse({
      action: "ask_current_sender",
      result: { status: "accepted" },
    })).toEqual({
      action: "ask_current_sender",
      result: { status: "accepted" },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "ask_current_sender",
      result: {
        answer: "Your sleep has been rough this week.",
        outcome: "answered",
        status: "completed",
      },
    })).toMatchObject({
      action: "ask_current_sender",
      result: { outcome: "answered", status: "completed" },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "ask_current_sender",
      result: {
        status: "unavailable",
        unavailableReason: "current_sender_unavailable",
      },
    })).toMatchObject({
      action: "ask_current_sender",
      result: { status: "unavailable" },
    });
  });

  it("parses the current sender's private-continuation action", () => {
    const request = {
      action: "message_current_sender",
      origin: CURRENT_SENDER_ASK.origin,
    } as const;
    expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request);
    expect(() => parseHostedRuntimeGroupToolRequest({
      ...request,
      text: "model-authored private message",
    })).toThrow(/not allowed/u);

    expect(parseHostedRuntimeGroupToolResponse({
      action: "message_current_sender",
      result: { status: "accepted" },
    })).toEqual({
      action: "message_current_sender",
      result: { status: "accepted" },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "message_current_sender",
      result: {
        status: "unavailable",
        unavailableReason: "private_route_unavailable",
      },
    })).toEqual({
      action: "message_current_sender",
      result: {
        status: "unavailable",
        unavailableReason: "private_route_unavailable",
      },
    });
    expect(() => parseHostedRuntimeGroupToolResponse({
      action: "message_current_sender",
      result: {
        answer: "not a private delivery result",
        outcome: "answered",
        status: "completed",
      },
    })).toThrow(/status is invalid/u);
  });

  it("parses the current sender's exact daily metric report", () => {
    const request = {
      action: "record_current_sender_daily_metric",
      dailyMetric: {
        date: "2026-07-27",
        metric: "steps",
        unit: "count",
        value: 8_000,
      },
      origin: CURRENT_SENDER_ASK.origin,
    } as const;
    expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request);
    expect(() => parseHostedRuntimeGroupToolRequest({
      ...request,
      targetMemberId: "model_selected_member",
    })).toThrow(/not allowed/u);
    expect(() => parseHostedRuntimeGroupToolRequest({
      ...request,
      dailyMetric: { ...request.dailyMetric, date: "2026-02-30" },
    })).toThrow(/date is invalid/u);

    expect(parseHostedRuntimeGroupToolResponse({
      action: "record_current_sender_daily_metric",
      result: { status: "accepted" },
    })).toEqual({
      action: "record_current_sender_daily_metric",
      result: { status: "accepted" },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "record_current_sender_daily_metric",
      result: {
        status: "unavailable",
        unavailableReason: "report_conflict",
      },
    })).toEqual({
      action: "record_current_sender_daily_metric",
      result: {
        status: "unavailable",
        unavailableReason: "report_conflict",
      },
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

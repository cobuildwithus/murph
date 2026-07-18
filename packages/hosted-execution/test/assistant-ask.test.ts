import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantAskCompletedWake,
  buildHostedExecutionAssistantAskRequestedWake,
} from "../src/builders.ts";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_ANSWER_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
  isHostedExecutionAssistantAskCompletedWake,
  isHostedExecutionAssistantAskRequestedWake,
  type HostedExecutionAssistantAskJoinedGroupCompletedPayload,
  type HostedExecutionAssistantAskJoinedGroupRequestedPayload,
} from "../src/contracts.ts";
import {
  parseHostedExecutionAssistantAskCompletedPayload,
  parseHostedExecutionAssistantAskRequestedPayload,
  parseHostedExecutionEvent,
  parseHostedExecutionWake,
  parseHostedRuntimeAssistantAskControlRequest,
  parseHostedRuntimeAssistantAskControlResponse,
  parseHostedRuntimeGroupToolRequest,
  parseHostedRuntimeGroupToolResponse,
} from "../src/parsers.ts";

const ORIGIN_ASSISTANT_INPUT_ID = "ain_0123456789abcdef0123456789abcdef";
const ORIGIN_SESSION_ID = "session_private";
const REQUESTED_AT = "2026-07-15T12:00:00.000Z";
const EXPIRES_AT = new Date(
  Date.parse(REQUESTED_AT) + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
).toISOString();
const COMPLETED_AT = "2026-07-15T12:05:00.000Z";

function createRequestedAsk(
  overrides: Partial<HostedExecutionAssistantAskJoinedGroupRequestedPayload> = {},
): HostedExecutionAssistantAskJoinedGroupRequestedPayload {
  return {
    expiresAt: EXPIRES_AT,
    originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    originSessionId: ORIGIN_SESSION_ID,
    question: "What exercises are assigned today?",
    target: {
      kind: "joined_group",
      membershipId: "hgrpm_generation_123",
      requestedLabel: "100 Club",
    },
    ...overrides,
  };
}

function createCompletedAsk(
  overrides: Partial<HostedExecutionAssistantAskJoinedGroupCompletedPayload> = {},
): HostedExecutionAssistantAskJoinedGroupCompletedPayload {
  return {
    expiresAt: EXPIRES_AT,
    originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
    originSessionId: ORIGIN_SESSION_ID,
    question: "What exercises are assigned today?",
    requestId: "haask_request_123",
    result: {
      answer: "Squats plus the pelvic sequence.",
      outcome: "answered",
    },
    targetLabel: "100 Club",
    ...overrides,
  };
}

describe("hosted Assistant Ask contracts", () => {
  it("builds and parses strict paired wakes without sharing mutable payload state", () => {
    const requestedAsk = createRequestedAsk();
    const requestedWake = buildHostedExecutionAssistantAskRequestedWake({
      ask: requestedAsk,
      eventId: "haask_request_123",
      memberId: "member_group_runtime",
      occurredAt: REQUESTED_AT,
    });
    if (requestedAsk.target.kind !== "joined_group") {
      throw new Error("Expected the legacy joined-group target.");
    }
    requestedAsk.target.membershipId = "hgrpm_mutated";
    requestedAsk.target.requestedLabel = "Mutated";

    expect(requestedWake.ask.target).toEqual({
      kind: "joined_group",
      membershipId: "hgrpm_generation_123",
      requestedLabel: "100 Club",
    });
    expect(parseHostedExecutionWake(requestedWake)).toEqual(requestedWake);
    expect(isHostedExecutionAssistantAskRequestedWake(requestedWake)).toBe(true);
    expect(isHostedExecutionAssistantAskCompletedWake(requestedWake)).toBe(false);

    const completedAsk = createCompletedAsk();
    const completedWake = buildHostedExecutionAssistantAskCompletedWake({
      ask: completedAsk,
      eventId: "haask_completion_123",
      memberId: "member_private_runtime",
      occurredAt: COMPLETED_AT,
    });
    completedAsk.result.answer = "Mutated answer";

    expect(completedWake.ask.result).toEqual({
      answer: "Squats plus the pelvic sequence.",
      outcome: "answered",
    });
    expect(parseHostedExecutionWake(completedWake)).toEqual(completedWake);
    expect(isHostedExecutionAssistantAskCompletedWake(completedWake)).toBe(true);
    expect(isHostedExecutionAssistantAskRequestedWake(completedWake)).toBe(false);
  });

  it("parses paired events and the canonical cannot-answer result", () => {
    const requestedEvent = {
      ask: createRequestedAsk({
        target: {
          kind: "joined_group" as const,
          membershipId: "hgrpm_generation_123",
          requestedLabel: null,
        },
      }),
      kind: "assistant.ask.requested",
      userId: "member_group_runtime",
    };
    expect(parseHostedExecutionEvent(requestedEvent)).toEqual(requestedEvent);

    const completedEvent = {
      ask: createCompletedAsk({
        result: { answer: null, outcome: "cannot_answer" },
        targetLabel: null,
      }),
      kind: "assistant.ask.completed",
      userId: "member_private_runtime",
    };
    expect(parseHostedExecutionEvent(completedEvent)).toEqual(completedEvent);
  });

  it("counts Unicode code points and rejects blank or oversized content", () => {
    const maxQuestion = "🧠".repeat(
      HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
    );
    expect(parseHostedExecutionAssistantAskRequestedPayload(
      createRequestedAsk({ question: maxQuestion }),
    ).question).toBe(maxQuestion);
    expect(() => parseHostedExecutionAssistantAskRequestedPayload(
      createRequestedAsk({
        question: `${maxQuestion}🧠`,
      }),
    )).toThrow(/1200 Unicode code points/u);
    expect(() => parseHostedExecutionAssistantAskRequestedPayload(
      createRequestedAsk({ question: "   " }),
    )).toThrow(/between 1 and 1200/u);

    const maxAnswer = "✅".repeat(
      HOSTED_EXECUTION_ASSISTANT_ASK_ANSWER_MAX_CODE_POINTS,
    );
    expect(parseHostedExecutionAssistantAskCompletedPayload(
      createCompletedAsk({ result: { answer: maxAnswer, outcome: "answered" } }),
    ).result.answer).toBe(maxAnswer);
    expect(() => parseHostedExecutionAssistantAskCompletedPayload(
      createCompletedAsk({
        result: { answer: `${maxAnswer}✅`, outcome: "answered" },
      }),
    )).toThrow(/4000 Unicode code points/u);
    expect(() => parseHostedExecutionAssistantAskCompletedPayload(
      createCompletedAsk({ result: { answer: "", outcome: "answered" } }),
    )).toThrow(/non-empty|between 1 and 4000/u);
    expect(() => parseHostedExecutionAssistantAskCompletedPayload(
      createCompletedAsk({
        question: "🧠".repeat(
          HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS + 1,
        ),
      }),
    )).toThrow(/1200 Unicode code points/u);

    const maxLabel = "🏋️".repeat(
      HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS / 2,
    );
    expect([...maxLabel]).toHaveLength(
      HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
    );
    expect(parseHostedExecutionAssistantAskCompletedPayload(
      createCompletedAsk({ targetLabel: maxLabel }),
    ).targetLabel).toBe(maxLabel);
    expect(() => parseHostedExecutionAssistantAskCompletedPayload(
      createCompletedAsk({ targetLabel: `${maxLabel}x` }),
    )).toThrow(/120 Unicode code points/u);
  });

  it("rejects malformed correlation, deadlines, outcomes, and authority fields", () => {
    expect(() => parseHostedExecutionAssistantAskRequestedPayload(
      createRequestedAsk({ originAssistantInputId: "ain_model_supplied" }),
    )).toThrow(/originAssistantInputId/u);
    expect(() => parseHostedExecutionAssistantAskRequestedPayload({
      ...createRequestedAsk(),
      target: {
        ...createRequestedAsk().target,
        callbackUrl: "https://example.test/callback",
      },
    })).toThrow(/unsupported field/u);
    expect(() => parseHostedExecutionAssistantAskCompletedPayload({
      ...createCompletedAsk(),
      route: { channel: "linq" },
    })).toThrow(/unsupported field/u);
    expect(() => parseHostedExecutionAssistantAskCompletedPayload({
      ...createCompletedAsk(),
      result: { answer: "No", outcome: "unsupported" },
    })).toThrow(/outcome is invalid/u);
    expect(() => parseHostedExecutionAssistantAskCompletedPayload({
      ...createCompletedAsk(),
      result: { outcome: "cannot_answer" },
    })).toThrow(/answer/u);

    expect(() => buildHostedExecutionAssistantAskRequestedWake({
      ask: createRequestedAsk({ expiresAt: "2026-07-15T12:09:59.999Z" }),
      eventId: "haask_request_123",
      memberId: "member_group_runtime",
      occurredAt: REQUESTED_AT,
    })).toThrow(/request TTL/u);
    expect(() => buildHostedExecutionAssistantAskCompletedWake({
      ask: createCompletedAsk(),
      eventId: "haask_completion_late",
      memberId: "member_private_runtime",
      occurredAt: EXPIRES_AT,
    })).toThrow(/before request expiry/u);
    expect(() => parseHostedExecutionWake({
      ask: createRequestedAsk(),
      callback: "model-controlled",
      eventId: "haask_request_123",
      kind: "assistant.ask.requested",
      occurredAt: REQUESTED_AT,
      userId: "member_group_runtime",
    })).toThrow(/unsupported field/u);
  });
});

describe("hosted Assistant Ask runtime control", () => {
  it("parses the trusted group-tool ask wire arm and bounded outcomes", () => {
    expect(parseHostedRuntimeGroupToolRequest({
      action: "ask",
      groupLabel: "  100 Club  ",
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      question: "  What is today's workout?  ",
    })).toEqual({
      action: "ask",
      groupLabel: "100 Club",
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      question: "What is today's workout?",
    });
    expect(parseHostedRuntimeGroupToolRequest({
      action: "ask",
      groupLabel: null,
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      question: "What is today's workout?",
    })).toMatchObject({ groupLabel: null });
    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "ask",
      membershipId: "model_selected_membership",
      originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      originSessionId: ORIGIN_SESSION_ID,
      question: "What is today's workout?",
    })).toThrow(/not allowed/u);

    expect(parseHostedRuntimeGroupToolResponse({
      action: "ask",
      result: { status: "accepted", targetLabel: "100 Club" },
    })).toEqual({
      action: "ask",
      result: { status: "accepted", targetLabel: "100 Club" },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "ask",
      result: {
        groupLabels: ["100 Club", "Wednesday Training"],
        status: "clarification_required",
      },
    })).toMatchObject({
      result: { status: "clarification_required" },
    });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "ask",
      result: { status: "no_groups" },
    })).toMatchObject({ result: { status: "no_groups" } });
    expect(parseHostedRuntimeGroupToolResponse({
      action: "ask",
      result: { status: "unavailable", unavailableReason: "not_a_direct_turn" },
    })).toMatchObject({ result: { status: "unavailable" } });
  });

  it("parses the narrow prepare/complete callback protocol with exact keys", () => {
    expect(parseHostedRuntimeAssistantAskControlRequest({
      action: "prepare",
      requestId: "haask_request_123",
    })).toEqual({ action: "prepare", requestId: "haask_request_123" });
    expect(parseHostedRuntimeAssistantAskControlRequest({
      action: "complete",
      requestId: "haask_request_123",
      result: { answer: null, outcome: "cannot_answer" },
    })).toEqual({
      action: "complete",
      requestId: "haask_request_123",
      result: { answer: null, outcome: "cannot_answer" },
    });
    expect(() => parseHostedRuntimeAssistantAskControlRequest({
      action: "complete",
      callbackUrl: "https://example.test/callback",
      requestId: "haask_request_123",
      result: { answer: "Done", outcome: "answered" },
    })).toThrow(/not allowed/u);

    expect(parseHostedRuntimeAssistantAskControlResponse({
      action: "prepare",
      question: "What exercises are assigned today?",
      status: "ready",
      targetLabel: "100 Club",
    })).toMatchObject({ action: "prepare", status: "ready" });
    expect(parseHostedRuntimeAssistantAskControlResponse({
      action: "prepare",
      status: "terminal",
      terminalReason: "expired",
    })).toEqual({
      action: "prepare",
      status: "terminal",
      terminalReason: "expired",
    });
    expect(parseHostedRuntimeAssistantAskControlResponse({
      action: "complete",
      status: "already_completed",
    })).toEqual({ action: "complete", status: "already_completed" });
    expect(() => parseHostedRuntimeAssistantAskControlResponse({
      action: "complete",
      status: "completed",
      targetRuntimeId: "model-controlled",
    })).toThrow(/not allowed/u);
  });
});

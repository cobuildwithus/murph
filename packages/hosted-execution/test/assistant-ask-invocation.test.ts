import { describe, expect, it } from "vitest";

import {
  parseHostedExecutionAssistantAskCompletedPayload,
  parseHostedExecutionAssistantAskRequestedPayload,
} from "../src/assistant-ask-payload.ts";
import {
  parseHostedRuntimeGroupToolRequest,
} from "../src/parsers/runtime-control.ts";

const target = {
  grantId: "hdg_availability",
  kind: "consented_member" as const,
  membershipId: "hgm_member",
  permissionDigest: "digest_v1",
};

const acceptedOrigin = {
  assistantInputId: "ain_0123456789abcdef0123456789abcdef",
  kind: "accepted_input" as const,
  sessionId: "session_group",
};

const scheduledOrigin = {
  automationId: "automation_call_circle",
  kind: "automation_occurrence" as const,
  occurrenceAt: "2026-07-20T13:00:00.000Z",
};

describe("Assistant Ask trusted invocation contracts", () => {
  it("parses a scheduled request keyed by its automation origin", () => {
    expect(parseHostedExecutionAssistantAskRequestedPayload({
      expiresAt: "2026-07-20T13:10:00.000Z",
      origin: scheduledOrigin,
      question: "Which coarse call windows work over the next week?",
      target,
    })).toEqual({
      expiresAt: "2026-07-20T13:10:00.000Z",
      origin: scheduledOrigin,
      question: "Which coarse call windows work over the next week?",
      target,
    });
  });

  it("requires the trusted origin object for consented-member requests", () => {
    expect(() => parseHostedExecutionAssistantAskRequestedPayload({
      expiresAt: "2026-07-20T13:10:00.000Z",
      originAssistantInputId: acceptedOrigin.assistantInputId,
      originSessionId: acceptedOrigin.sessionId,
      question: "How much sleep did they get last night?",
      target,
    })).toThrow(/unsupported field|origin/u);

    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "ask_member",
      grantId: "hdg_availability",
      originAssistantInputId: acceptedOrigin.assistantInputId,
      originSessionId: acceptedOrigin.sessionId,
      question: "How much sleep did they get last night?",
    })).toThrow(/not allowed/u);
  });

  it("rejects the removed delivery-mode field on the trusted invocation", () => {
    expect(() => parseHostedExecutionAssistantAskRequestedPayload({
      deliveryMode: "reviewed_exact",
      expiresAt: "2026-07-20T13:10:00.000Z",
      origin: acceptedOrigin,
      question: "Question?",
      target,
    })).toThrow(/unsupported field/u);
    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "ask_member",
      deliveryMode: "internal",
      grantId: "hdg_availability",
      origin: acceptedOrigin,
      question: "Question?",
    })).toThrow(/not allowed/u);
  });

  it("keeps permission context only on an automation-origin completion", () => {
    expect(parseHostedExecutionAssistantAskCompletedPayload({
      expiresAt: "2026-07-20T13:10:00.000Z",
      origin: scheduledOrigin,
      permissionText: "Coarse availability for arranging Call Circle calls.",
      question: "Which coarse call windows work over the next week?",
      requestId: "aask_req_1",
      result: { answer: "Tuesday evening", outcome: "answered" },
      targetLabel: null,
    })).toMatchObject({
      origin: scheduledOrigin,
      permissionText: "Coarse availability for arranging Call Circle calls.",
    });
    // A reviewed (accepted-input) completion must not carry permission text.
    expect(() => parseHostedExecutionAssistantAskCompletedPayload({
      expiresAt: "2026-07-20T13:10:00.000Z",
      origin: acceptedOrigin,
      permissionText: "should not appear here",
      question: "Which coarse call windows work over the next week?",
      requestId: "aask_req_1",
      result: { answer: "Tuesday evening", outcome: "answered" },
      targetLabel: null,
    })).toThrow(/unsupported field/u);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildHostedExecutionPhoneCallResultedWake } from "@murphai/hosted-execution";

const assistantEngineMocks = vi.hoisted(() => ({
  isAssistantConversationContextUnavailableError: vi.fn((_error: unknown) => false),
  recordAssistantConversationContext: vi.fn(async () => ({
    appended: true,
    session: { sessionId: "session-direct" },
  })),
}));

vi.mock("@murphai/assistant-engine", () => ({
  isAssistantConversationContextUnavailableError:
    assistantEngineMocks.isAssistantConversationContextUnavailableError,
  recordAssistantConversationContext:
    assistantEngineMocks.recordAssistantConversationContext,
}));

import {
  executeHostedPhoneCallResultedWake,
} from "../src/hosted-runtime/events/phone-call-result.ts";

describe("hosted phone-call result context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assistantEngineMocks.isAssistantConversationContextUnavailableError.mockReturnValue(false);
    assistantEngineMocks.recordAssistantConversationContext.mockResolvedValue({
      appended: true,
      session: { sessionId: "session-direct" },
    });
  });

  it("records the result on the direct conversation without requesting delivery", async () => {
    const executionContext = { hosted: null };
    const wake = buildHostedExecutionPhoneCallResultedWake({
      eventId: "phone-call.resulted:call-1",
      memberId: "member-1",
      occurredAt: "2026-07-22T16:24:46.000Z",
      phoneCall: {
        context: "Internal context with untrusted call result data.",
        originSessionId: "session-direct",
      },
    });

    const outcome = await executeHostedPhoneCallResultedWake({
      executionContext,
      vaultRoot: "/vault",
      wake,
    });

    expect(outcome).toMatchObject({
      conversationMetrics: null,
      mailboxLane: "phone-call-result-context",
    });
    expect(assistantEngineMocks.recordAssistantConversationContext).toHaveBeenCalledWith({
      context: "Internal context with untrusted call result data.",
      idempotencyKey: "phone-call.resulted:call-1",
      occurredAt: "2026-07-22T16:24:46.000Z",
      sessionId: "session-direct",
      vault: "/vault",
    });
  });

  it("terminally settles an invalid origin so a later valid result can proceed", async () => {
    const invalidOriginError = new Error("origin session is unavailable");
    assistantEngineMocks.isAssistantConversationContextUnavailableError
      .mockImplementation((error) => error === invalidOriginError);
    assistantEngineMocks.recordAssistantConversationContext
      .mockRejectedValueOnce(invalidOriginError)
      .mockResolvedValueOnce({
        appended: true,
        session: { sessionId: "session-valid" },
      });
    const firstWake = buildHostedExecutionPhoneCallResultedWake({
      eventId: "phone-call.resulted:invalid-origin",
      memberId: "member-1",
      occurredAt: "2026-07-22T16:24:46.000Z",
      phoneCall: {
        context: "Internal context for the invalid origin.",
        originSessionId: "session-missing",
      },
    });
    const secondWake = buildHostedExecutionPhoneCallResultedWake({
      eventId: "phone-call.resulted:valid-origin",
      memberId: "member-1",
      occurredAt: "2026-07-22T16:25:46.000Z",
      phoneCall: {
        context: "Internal context for the valid origin.",
        originSessionId: "session-valid",
      },
    });

    await expect(executeHostedPhoneCallResultedWake({
      executionContext: { hosted: null },
      vaultRoot: "/vault",
      wake: firstWake,
    })).resolves.toMatchObject({
      mailboxLane: "phone-call-result-context",
      redactedLogEntries: [{
        redacted: {
          eventCode: "assistant.phone_call_result_origin_unavailable",
        },
      }],
    });
    await expect(executeHostedPhoneCallResultedWake({
      executionContext: { hosted: null },
      vaultRoot: "/vault",
      wake: secondWake,
    })).resolves.toMatchObject({
      mailboxLane: "phone-call-result-context",
    });
    expect(assistantEngineMocks.recordAssistantConversationContext).toHaveBeenCalledTimes(2);
  });

  it("keeps transient context-storage failures retryable", async () => {
    const transientError = new Error("temporary vault write failure");
    assistantEngineMocks.recordAssistantConversationContext.mockRejectedValueOnce(transientError);
    const wake = buildHostedExecutionPhoneCallResultedWake({
      eventId: "phone-call.resulted:transient-failure",
      memberId: "member-1",
      occurredAt: "2026-07-22T16:24:46.000Z",
      phoneCall: {
        context: "Internal context for a transient write failure.",
        originSessionId: "session-direct",
      },
    });

    await expect(executeHostedPhoneCallResultedWake({
      executionContext: { hosted: null },
      vaultRoot: "/vault",
      wake,
    })).rejects.toBe(transientError);
  });
});

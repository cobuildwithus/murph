import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildHostedExecutionPhoneCallResultedWake } from "@murphai/hosted-execution";

const assistantEngineMocks = vi.hoisted(() => ({
  recordAssistantConversationContext: vi.fn(async () => ({
    appended: true,
    session: { sessionId: "session-direct" },
  })),
}));

vi.mock("@murphai/assistant-engine", () => ({
  recordAssistantConversationContext:
    assistantEngineMocks.recordAssistantConversationContext,
}));

import {
  executeHostedPhoneCallResultedWake,
} from "../src/hosted-runtime/events/phone-call-result.ts";

describe("hosted phone-call result context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

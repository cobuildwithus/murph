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
        route: {
          actorId: "actor-blind",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "chat-target",
          },
          identityId: "identity-blind",
          threadId: "thread-blind",
          threadIsDirect: true,
        },
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
      actorId: "actor-blind",
      bindingDeliveryTarget: "chat-target",
      channel: "linq",
      context: "Internal context with untrusted call result data.",
      deliveryKind: "thread",
      executionContext,
      idempotencyKey: "phone-call.resulted:call-1",
      identityId: "identity-blind",
      occurredAt: "2026-07-22T16:24:46.000Z",
      threadId: "thread-blind",
      threadIsDirect: true,
      vault: "/vault",
    });
  });

  it("rejects an unbound explicit delivery route", async () => {
    const wake = buildHostedExecutionPhoneCallResultedWake({
      eventId: "phone-call.resulted:call-2",
      memberId: "member-1",
      occurredAt: "2026-07-22T16:25:00.000Z",
      phoneCall: {
        context: "Internal call result context.",
        route: {
          actorId: null,
          channel: "linq",
          delivery: {
            kind: "explicit",
            target: "recipient",
          },
          identityId: null,
          threadId: null,
          threadIsDirect: true,
        },
      },
    });

    await expect(executeHostedPhoneCallResultedWake({
      executionContext: { hosted: null },
      vaultRoot: "/vault",
      wake,
    })).rejects.toThrow("bound direct conversation route");
    expect(assistantEngineMocks.recordAssistantConversationContext).not.toHaveBeenCalled();
  });
});

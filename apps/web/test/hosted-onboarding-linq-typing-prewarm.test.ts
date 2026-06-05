import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drainHostedLinqSideEffectsDirect: vi.fn(),
  lookupHostedMemberRoutingByHomeLinqChatId: vi.fn(),
  maybeHandoffHostedExecutionWebhookWake: vi.fn(),
  planHostedOnboardingLinqWebhook: vi.fn(),
  sendHostedLinqReadReceipt: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  signalHostedRuntimePrewarm: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/linq", async () => {
  const linqWebhook = await import("@murphai/messaging-ingress/linq-webhook");
  return {
    requireHostedLinqMessageReceivedEvent: vi.fn(() => {
      throw new Error("message parser should not run for typing");
    }),
    requireHostedLinqTypingIndicatorStartedEvent:
      linqWebhook.parseLinqTypingIndicatorStartedEvent,
    resolveHostedLinqTypingOccurredAt:
      linqWebhook.resolveLinqTypingIndicatorOccurredAt,
    sendHostedLinqReadReceipt: mocks.sendHostedLinqReadReceipt,
    verifyAndParseHostedLinqWebhookRequest: vi.fn(
      (input: { rawBody: string }) => linqWebhook.parseLinqWebhookEvent(input.rawBody),
    ),
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  lookupHostedMemberRoutingByHomeLinqChatId:
    mocks.lookupHostedMemberRoutingByHomeLinqChatId,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
  signalHostedRuntimePrewarm: mocks.signalHostedRuntimePrewarm,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-provider-linq", () => ({
  planHostedOnboardingLinqWebhook: mocks.planHostedOnboardingLinqWebhook,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-transport", () => ({
  drainHostedLinqSideEffectsDirect: mocks.drainHostedLinqSideEffectsDirect,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-service-wake", () => ({
  maybeHandoffHostedExecutionWebhookWake:
    mocks.maybeHandoffHostedExecutionWebhookWake,
}));

describe("handleHostedOnboardingLinqWebhook typing prewarm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
    mocks.signalHostedRuntimePrewarm.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_typing",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("signals Temporal prewarm for an active existing Linq route without mailbox work", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const { handleHostedOnboardingLinqWebhook } = await import(
      "@/src/lib/hosted-onboarding/webhook-service"
    );
    mocks.lookupHostedMemberRoutingByHomeLinqChatId.mockResolvedValueOnce({
      core: {
        billingStatus: "active",
        id: "member_typing",
        suspendedAt: null,
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma: {} as never,
      rawBody: buildTypingWebhookBody({ service: " imessage " }),
      signature: null,
      timestamp: null,
    });

    expect(response).toEqual({
      ignored: true,
      ok: true,
      reason: "typing-prewarm-signaled",
    });
    expect(mocks.lookupHostedMemberRoutingByHomeLinqChatId).toHaveBeenCalledWith({
      linqChatId: "chat_typing_123",
      prisma: {},
    });
    expect(mocks.signalHostedRuntimePrewarm).toHaveBeenCalledWith({
      eventId: "evt_typing_123",
      occurredAt: "2026-05-20T12:00:00.000Z",
      source: "linq.imessage.typing",
      userId: "member_typing",
    });
    expect(consoleInfo).toHaveBeenCalledWith(
      "Hosted onboarding diagnostic: linq.typing-prewarm-decision.",
      expect.objectContaining({
        decision: "signaled",
        eventIdSuffix: "ng_123",
        memberActive: true,
        responseReason: "typing-prewarm-signaled",
        routeFound: true,
        temporalSignalAttempted: true,
        userIdSuffix: "typing",
      }),
    );
    expect(mocks.planHostedOnboardingLinqWebhook).not.toHaveBeenCalled();
    expect(mocks.drainHostedLinqSideEffectsDirect).not.toHaveBeenCalled();
    expect(mocks.maybeHandoffHostedExecutionWebhookWake).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("coalesces repeated typing prewarm signals per user", async () => {
    const { handleHostedOnboardingLinqWebhook } = await import(
      "@/src/lib/hosted-onboarding/webhook-service"
    );
    mocks.lookupHostedMemberRoutingByHomeLinqChatId.mockResolvedValue({
      core: {
        billingStatus: "active",
        id: "member_typing_coalesced",
        suspendedAt: null,
      },
    });

    await handleHostedOnboardingLinqWebhook({
      prisma: {} as never,
      rawBody: buildTypingWebhookBody({ eventId: "evt_typing_first" }),
      signature: null,
      timestamp: null,
    });
    const response = await handleHostedOnboardingLinqWebhook({
      prisma: {} as never,
      rawBody: buildTypingWebhookBody({ eventId: "evt_typing_second" }),
      signature: null,
      timestamp: null,
    });

    expect(response.reason).toBe("typing-prewarm-coalesced");
    expect(mocks.signalHostedRuntimePrewarm).toHaveBeenCalledTimes(1);
    expect(mocks.planHostedOnboardingLinqWebhook).not.toHaveBeenCalled();
  });

  it("emits a searchable decision diagnostic when no active route is found", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const { handleHostedOnboardingLinqWebhook } = await import(
      "@/src/lib/hosted-onboarding/webhook-service"
    );
    mocks.lookupHostedMemberRoutingByHomeLinqChatId.mockResolvedValueOnce(null);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma: {} as never,
      rawBody: buildTypingWebhookBody({ eventId: "evt_typing_missing_route_123456" }),
      signature: null,
      timestamp: null,
    });

    expect(response).toEqual({
      ignored: true,
      ok: true,
      reason: "typing-prewarm-ignored-no-active-route",
    });
    expect(mocks.lookupHostedMemberRoutingByHomeLinqChatId).toHaveBeenCalledWith({
      linqChatId: "chat_typing_123",
      prisma: {},
    });
    expect(mocks.signalHostedRuntimePrewarm).not.toHaveBeenCalled();
    expect(consoleInfo).toHaveBeenCalledWith(
      "Hosted onboarding diagnostic: linq.typing-prewarm-decision.",
      expect.objectContaining({
        decision: "ignored-no-active-route",
        eventIdSuffix: "123456",
        responseReason: "typing-prewarm-ignored-no-active-route",
        routeFound: false,
      }),
    );
    const diagnosticCall = consoleInfo.mock.calls.find(
      ([message]) =>
        message === "Hosted onboarding diagnostic: linq.typing-prewarm-decision.",
    );
    expect(diagnosticCall?.[1]).not.toHaveProperty("chatId");
    expect(diagnosticCall?.[1]).not.toHaveProperty("userIdSuffix");
  });

  it("ignores non-iMessage typing services before active route lookup", async () => {
    const { handleHostedOnboardingLinqWebhook } = await import(
      "@/src/lib/hosted-onboarding/webhook-service"
    );

    const response = await handleHostedOnboardingLinqWebhook({
      prisma: {} as never,
      rawBody: buildTypingWebhookBody({
        eventId: "evt_typing_sms",
        service: "SMS",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toEqual({
      ignored: true,
      ok: true,
      reason: "typing-prewarm-ignored-unsupported-service",
    });
    expect(mocks.lookupHostedMemberRoutingByHomeLinqChatId).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimePrewarm).not.toHaveBeenCalled();
    expect(mocks.planHostedOnboardingLinqWebhook).not.toHaveBeenCalled();
  });

  it("ignores typing prewarm when the service is missing", async () => {
    const { handleHostedOnboardingLinqWebhook } = await import(
      "@/src/lib/hosted-onboarding/webhook-service"
    );

    const response = await handleHostedOnboardingLinqWebhook({
      prisma: {} as never,
      rawBody: buildTypingWebhookBody({
        eventId: "evt_typing_unknown_service",
        service: null,
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toEqual({
      ignored: true,
      ok: true,
      reason: "typing-prewarm-ignored-unsupported-service",
    });
    expect(mocks.lookupHostedMemberRoutingByHomeLinqChatId).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimePrewarm).not.toHaveBeenCalled();
  });

  it("does not throttle the next typing signal after a Temporal signal failure", async () => {
    const { handleHostedOnboardingLinqWebhook } = await import(
      "@/src/lib/hosted-onboarding/webhook-service"
    );
    mocks.lookupHostedMemberRoutingByHomeLinqChatId.mockResolvedValue({
      core: {
        billingStatus: "active",
        id: "member_typing_retry",
        suspendedAt: null,
      },
    });
    mocks.signalHostedRuntimePrewarm
      .mockRejectedValueOnce(new Error("Temporal unavailable"))
      .mockResolvedValueOnce({
        signalAccepted: true,
        workflowId: "hosted-user-runtime:member_typing_retry",
      });

    const failedResponse = await handleHostedOnboardingLinqWebhook({
      prisma: {} as never,
      rawBody: buildTypingWebhookBody({ eventId: "evt_typing_failed" }),
      signature: null,
      timestamp: null,
    });
    const retryResponse = await handleHostedOnboardingLinqWebhook({
      prisma: {} as never,
      rawBody: buildTypingWebhookBody({ eventId: "evt_typing_retry" }),
      signature: null,
      timestamp: null,
    });

    expect(failedResponse.reason).toBe("typing-prewarm-temporal-signal-failed");
    expect(retryResponse.reason).toBe("typing-prewarm-signaled");
    expect(mocks.signalHostedRuntimePrewarm).toHaveBeenCalledTimes(2);
  });
});

function buildTypingWebhookBody(input: {
  eventId?: string;
  service?: string | null;
} = {}): string {
  const data: Record<string, unknown> = {
    chat_id: "chat_typing_123",
  };
  if (input.service !== null) {
    data.service = input.service ?? "iMessage";
  }
  return JSON.stringify({
    api_version: "v3",
    created_at: "2026-05-20T12:00:00.000Z",
    data,
    event_id: input.eventId ?? "evt_typing_123",
    event_type: "chat.typing_indicator.started",
  });
}

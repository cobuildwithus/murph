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
    vi.useRealTimers();
  });

  it("signals Temporal prewarm for an active existing Linq route without mailbox work", async () => {
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
      rawBody: buildTypingWebhookBody(),
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
      scopeHash: expect.stringMatching(/^linq-chat:[a-f0-9]{32}$/u),
      source: "linq.imessage.typing",
      userId: "member_typing",
    });
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
});

function buildTypingWebhookBody(input: {
  eventId?: string;
  service?: string;
} = {}): string {
  return JSON.stringify({
    api_version: "v3",
    created_at: "2026-05-20T12:00:00.000Z",
    data: {
      chat_id: "chat_typing_123",
      service: input.service ?? "iMessage",
    },
    event_id: input.eventId ?? "evt_typing_123",
    event_type: "chat.typing_indicator.started",
  });
}

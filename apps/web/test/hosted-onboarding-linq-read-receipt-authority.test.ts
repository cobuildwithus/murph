import { linqRoster } from "./support/linq-roster";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  abandonHostedLinqInstantFirstTurn: vi.fn(),
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  deriveHostedOnboardingTimingErrorName: vi.fn(() => "Error"),
  finishHostedOnboardingTiming: vi.fn(),
  getHostedLinqChatSummary: vi.fn(),
  maybeHandoffHostedExecutionWebhookWake: vi.fn(),
  maybeScheduleHostedLinqAckReaction: vi.fn(),
  planHostedOnboardingLinqWebhook: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
  requireHostedLinqMessageReceivedEvent: vi.fn(),
  resolveHostedLinqRecipientPhoneNumber: vi.fn(() => "+15555550123"),
  resolveHostedLinqThreadContainerCryptoPreparationTarget: vi.fn(() => null),
  sendHostedLinqReadReceipt: vi.fn(),
  startHostedOnboardingTiming: vi.fn((step: string, baseDetails: Record<string, unknown> = {}) => ({
    baseDetails,
    startedAtMs: 0,
    step,
  })),
  verifyAndParseHostedLinqWebhookRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-instant-first-turn", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq-instant-first-turn")
  >();
  return {
    ...actual,
    abandonHostedLinqInstantFirstTurn: mocks.abandonHostedLinqInstantFirstTurn,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq")
  >();
  return {
    ...actual,
    requireHostedLinqMessageReceivedEvent: mocks.requireHostedLinqMessageReceivedEvent,
    resolveHostedLinqRecipientPhoneNumber: mocks.resolveHostedLinqRecipientPhoneNumber,
    sendHostedLinqReadReceipt: mocks.sendHostedLinqReadReceipt,
    verifyAndParseHostedLinqWebhookRequest: mocks.verifyAndParseHostedLinqWebhookRequest,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  getHostedLinqChatSummary: mocks.getHostedLinqChatSummary,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-provider-linq", () => ({
  planHostedOnboardingLinqWebhook: mocks.planHostedOnboardingLinqWebhook,
  resolveHostedLinqThreadContainerCryptoPreparationTarget:
    mocks.resolveHostedLinqThreadContainerCryptoPreparationTarget,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-ack-reaction", () => ({
  maybeScheduleHostedLinqAckReaction: mocks.maybeScheduleHostedLinqAckReaction,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-service-wake", () => ({
  maybeHandoffHostedExecutionWebhookWake: mocks.maybeHandoffHostedExecutionWebhookWake,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedLinqRouteEgressAuthority: mocks.assertHostedLinqRouteEgressAuthority,
  readHostedThreadRouteByThreadIdentity: mocks.readHostedThreadRouteByThreadIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/logging", () => ({
  deriveHostedOnboardingTimingErrorName: mocks.deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming: mocks.finishHostedOnboardingTiming,
  logHostedOnboardingDiagnostic: vi.fn(),
  startHostedOnboardingTiming: mocks.startHostedOnboardingTiming,
  toHostedOnboardingLogIdSuffix: vi.fn((value: string | null | undefined) =>
    value ? value.slice(-6) : null
  ),
}));

vi.mock("@/src/lib/hosted-onboarding/telegram", () => ({
  assertHostedTelegramWebhookSecret: vi.fn(),
  buildHostedTelegramWebhookEventId: vi.fn(),
  parseHostedTelegramWebhookUpdate: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-provider-telegram", () => ({
  planHostedOnboardingTelegramWebhook: vi.fn(),
}));

import {
  handleHostedOnboardingLinqWebhook,
} from "../src/lib/hosted-onboarding/webhook-service";

describe("hosted Linq read receipt route authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHostedLinqChatSummary.mockResolvedValue(linqRoster({
      handles: [],
      isGroup: false,
    }));
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue(null);
    mocks.verifyAndParseHostedLinqWebhookRequest.mockReturnValue({
      api_version: "2026-01-01",
      created_at: "2026-06-28T12:00:00.000Z",
      data: {
        chat_id: "chat_123",
        direction: "inbound",
        is_from_me: false,
        message: {
          id: "linq_message_123",
          parts: [{ type: "text", value: "hello" }],
        },
        recipient: "+15555550123",
        service: "iMessage",
        thread_is_direct: true,
      },
      event_id: "evt_read_receipt_mismatch",
      event_type: "message.received",
      webhook_version: "2026-01-01",
    });
    mocks.requireHostedLinqMessageReceivedEvent.mockReturnValue({
      api_version: "2026-01-01",
      created_at: "2026-06-28T12:00:00.000Z",
      data: {
        chat_id: "chat_123",
        created_at: "2026-06-28T12:00:00.000Z",
        direction: "inbound",
        is_from_me: false,
        message: {
          id: "linq_message_123",
          parts: [
            {
              type: "text",
              value: "hello",
            },
          ],
        },
        recipient: "+15555550123",
        service: "iMessage",
        thread_is_direct: true,
      },
      event_id: "evt_read_receipt_mismatch",
      event_type: "message.received",
      webhook_version: "2026-01-01",
    });
    mocks.maybeHandoffHostedExecutionWebhookWake.mockResolvedValue({
      reason: "temporal-signaled",
      signalAccepted: true,
      started: true,
    });
  });

  it("skips read receipts when route authority targets a different chat", async () => {
    mocks.planHostedOnboardingLinqWebhook.mockResolvedValue({
      desiredSideEffects: [],
      linqReadReceiptRouteAuthority: {
        accountLookupKey: "hbidx:phone:v1:account",
        channel: "linq",
        containerMemberId: "member_123",
        threadId: "chat_other",
      },
      response: {
        ignored: false,
        ok: true,
        reason: "wake-appended-active-member",
      },
      wakeHandoffs: [{
        eventId: "evt_read_receipt_mismatch",
        linqChatId: "chat_123",
        mailboxItemId: "mailbox_123",
        source: "linq",
        userId: "member_123",
      }],
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma: { hostedLinqGroupLeave: { findFirst: vi.fn().mockResolvedValue(null) } } as never,
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.assertHostedLinqRouteEgressAuthority).not.toHaveBeenCalled();
    expect(mocks.readHostedThreadRouteByThreadIdentity).toHaveBeenCalledWith({
      channel: "linq",
      prisma: expect.objectContaining({ hostedLinqGroupLeave: expect.any(Object) }),
      threadId: "chat_123",
    });
    expect(mocks.getHostedLinqChatSummary).toHaveBeenCalledWith({
      chatId: "chat_123",
      timeoutMs: 1_500,
    });
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.ingress-read-receipt",
      }),
      "skipped-route-authority-mismatch",
      expect.objectContaining({
        responseReason: "wake-appended-active-member",
        wakeHandoffStarted: true,
        wakeHandoffSignalAccepted: true,
      }),
    );
  });

  it("schedules the ack tapback after the wake handoff and never waits for it", async () => {
    mocks.planHostedOnboardingLinqWebhook.mockResolvedValue({
      desiredSideEffects: [],
      response: {
        ignored: false,
        ok: true,
        reason: "wake-appended-active-member",
      },
      wakeHandoffs: [{
        conversationIsGroup: false,
        eventId: "evt_read_receipt_mismatch",
        linqChatId: "chat_123",
        mailboxItemId: "mailbox_123",
        source: "linq",
        userId: "member_123",
      }],
    });
    mocks.sendHostedLinqReadReceipt.mockResolvedValue({ ok: true, status: 204 });
    const pendingForever = vi.fn(() => new Promise<void>(() => {}));
    mocks.maybeScheduleHostedLinqAckReaction.mockImplementation((input: {
      scheduleAfterResponse?: (task: () => Promise<void>) => void;
    }) => {
      input.scheduleAfterResponse?.(pendingForever);
      return true;
    });
    const scheduled: Array<() => Promise<void>> = [];
    const webhookReceivedAt = new Date("2026-11-05T12:00:00.000Z");

    await expect(handleHostedOnboardingLinqWebhook({
      prisma: { hostedLinqGroupLeave: { findFirst: vi.fn().mockResolvedValue(null) } } as never,
      rawBody: "{}",
      scheduleAfterResponse: (task) => { scheduled.push(task); },
      signature: null,
      timestamp: null,
      webhookReceivedAt,
    })).resolves.toMatchObject({ ok: true, reason: "wake-appended-active-member" });

    expect(mocks.maybeScheduleHostedLinqAckReaction).toHaveBeenCalledOnce();
    expect(mocks.maybeScheduleHostedLinqAckReaction).toHaveBeenCalledWith(expect.objectContaining({
      currentInboundReply: { chatId: "chat_123", messageId: "linq_message_123" },
      instantFirstTurnOwnsReply: false,
      response: expect.objectContaining({ reason: "wake-appended-active-member" }),
      wakeHandoff: expect.objectContaining({ conversationIsGroup: false, linqChatId: "chat_123" }),
      wakeHandoffResult: expect.objectContaining({ started: true }),
      webhookReceivedAt,
    }));
    expect(mocks.maybeHandoffHostedExecutionWebhookWake.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.maybeScheduleHostedLinqAckReaction.mock.invocationCallOrder[0]!);
    // The tapback task was only handed to the scheduler; the webhook returned
    // without running or awaiting it.
    expect(scheduled).toContain(pendingForever);
    expect(pendingForever).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  claimHostedLinqAckReaction: vi.fn(),
  confirmHostedLinqAckReaction: vi.fn(),
  isHostedLinqAckReactionCoveringCurrentBurst: vi.fn(),
  markHostedLinqAckReactionHeavy: vi.fn(),
  releaseHostedLinqAckReaction: vi.fn(),
}));
const runtime = vi.hoisted(() => ({
  getHostedOnboardingEnvironment: vi.fn((): { linqAckReactionOpenAiApiKey: string | null } => ({
    linqAckReactionOpenAiApiKey: "sk-test",
  })),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-ack-reaction-store", () => store);
vi.mock("@/src/lib/hosted-onboarding/runtime", () => runtime);

import {
  maybeScheduleHostedLinqAckReaction,
  readHostedLinqAckReactionMessage,
  runHostedLinqAckReactionBestEffort,
} from "@/src/lib/hosted-onboarding/linq-ack-reaction";
import type { HostedLinqAckReactionDecision } from "@/src/lib/hosted-onboarding/linq-ack-reaction-classifier";
import type { HostedLinqMessageReceivedEvent } from "@/src/lib/hosted-onboarding/linq-webhook";

const prisma = { $transaction: vi.fn() } as never;
const receivedAt = new Date("2026-11-05T12:00:00.000Z");

function messageEvent(
  parts: HostedLinqMessageReceivedEvent["data"]["message"]["parts"] = [{ type: "text", value: "remind me to stretch at 9" }],
  data: Partial<HostedLinqMessageReceivedEvent["data"]> = {},
): HostedLinqMessageReceivedEvent {
  return {
    api_version: "v3",
    created_at: receivedAt.toISOString(),
    data: {
      chat: { id: "chat-1", is_group: false },
      chat_id: "chat-1",
      from: "+15555550100",
      is_from_me: false,
      message: { id: "msg-1", parts },
      service: "iMessage",
      ...data,
    },
    event_id: "evt-1",
    event_type: "message.received",
  } as HostedLinqMessageReceivedEvent;
}

function gateInput(overrides: Partial<Parameters<typeof maybeScheduleHostedLinqAckReaction>[0]> = {}) {
  const scheduled: Array<() => Promise<void>> = [];
  return {
    input: {
      currentInboundReply: { chatId: "chat-1", messageId: "msg-1" },
      event: messageEvent(),
      instantFirstTurnOwnsReply: false,
      prisma,
      response: { reason: "wake-appended-active-member" },
      scheduleAfterResponse: (task: () => Promise<void>) => { scheduled.push(task); },
      wakeHandoff: { conversationIsGroup: false, linqChatId: "chat-1" },
      wakeHandoffResult: { started: true },
      webhookReceivedAt: receivedAt,
      ...overrides,
    },
    scheduled,
  };
}

function decision(overrides: Partial<HostedLinqAckReactionDecision>): HostedLinqAckReactionDecision {
  return { emoji: "⏰", heavy: 0, kind: "reminder", kindConfidence: 0.9, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.getHostedOnboardingEnvironment.mockReturnValue({ linqAckReactionOpenAiApiKey: "sk-test" });
});

describe("maybeScheduleHostedLinqAckReaction", () => {
  it("schedules one after-response task for an ordinary direct iMessage and never runs it inline", () => {
    const { input, scheduled } = gateInput();
    expect(maybeScheduleHostedLinqAckReaction(input)).toBe(true);
    expect(scheduled).toHaveLength(1);
    expect(store.claimHostedLinqAckReaction).not.toHaveBeenCalled();
  });

  it.each([
    ["no after-response scheduler", { scheduleAfterResponse: undefined }],
    ["no receive time", { webhookReceivedAt: undefined }],
    ["a group chat", { wakeHandoff: { conversationIsGroup: true, linqChatId: "chat-1" } }],
    ["a group route", { response: { reason: "wake-appended-thread-route" } }],
    ["a duplicate webhook", { response: { reason: "duplicate-webhook-event" } }],
    ["a wake that did not start", { wakeHandoffResult: { started: false } }],
    ["a missing wake result", { wakeHandoffResult: null }],
    ["a non-message event", { event: { event_type: "message.edited" } }],
    ["a Web-owned first reply", { instantFirstTurnOwnsReply: true }],
    ["an SMS", { event: messageEvent(undefined, { service: "SMS" }) }],
    ["our own message", { event: messageEvent(undefined, { is_from_me: true }) }],
    ["a different current inbound", { currentInboundReply: { chatId: "chat-1", messageId: "msg-2" } }],
    ["a member reaction", { currentInboundReply: null }],
  ])("skips %s", (_label, overrides) => {
    const { input, scheduled } = gateInput(overrides as never);
    expect(maybeScheduleHostedLinqAckReaction(input)).toBe(false);
    expect(scheduled).toHaveLength(0);
  });

  it("skips when the kill switch or key leaves no API key, and swallows env errors", () => {
    runtime.getHostedOnboardingEnvironment.mockReturnValueOnce({ linqAckReactionOpenAiApiKey: null });
    expect(maybeScheduleHostedLinqAckReaction(gateInput().input)).toBe(false);
    runtime.getHostedOnboardingEnvironment.mockImplementationOnce(() => { throw new Error("bad env"); });
    expect(maybeScheduleHostedLinqAckReaction(gateInput().input)).toBe(false);
  });
});

describe("readHostedLinqAckReactionMessage", () => {
  it("keeps text and https image URLs and drops voice memos and other media", () => {
    expect(readHostedLinqAckReactionMessage(messageEvent([
      { mime_type: "image/jpeg", type: "media", url: "https://cdn.example.test/a.jpg" },
      { mime_type: "audio/m4a", type: "voice_memo", url: "https://cdn.example.test/v.m4a" },
      { mime_type: "image/png", type: "media", url: "http://insecure.example.test/b.png" },
      { type: "text", value: " how many cals " },
    ]))).toEqual({ imageUrls: ["https://cdn.example.test/a.jpg"], text: "how many cals" });
    expect(readHostedLinqAckReactionMessage(messageEvent([
      { mime_type: "audio/m4a", type: "voice_memo", url: "https://cdn.example.test/v.m4a" },
    ]))).toBeNull();
  });
});

describe("runHostedLinqAckReactionBestEffort", () => {
  function run(overrides: Partial<Parameters<typeof runHostedLinqAckReactionBestEffort>[0]> = {}) {
    return runHostedLinqAckReactionBestEffort({
      addReaction: vi.fn(async () => ({ ok: true, status: 204 })),
      apiKey: "sk-test",
      classify: vi.fn(async () => decision({})),
      event: messageEvent(),
      linqChatId: "chat-1",
      messageId: "msg-1",
      messageReceivedAt: receivedAt,
      prisma,
      ...overrides,
    });
  }

  it("reserves the burst, sends the emoji on the inbound message, then confirms it", async () => {
    const claimedAt = new Date();
    store.claimHostedLinqAckReaction.mockResolvedValueOnce(claimedAt);
    const addReaction = vi.fn(async () => ({ ok: true, status: 204 }));
    await run({ addReaction });
    expect(store.claimHostedLinqAckReaction).toHaveBeenCalledWith(expect.objectContaining({
      linqChatId: "chat-1",
      messageId: "msg-1",
      messageReceivedAt: receivedAt,
      reaction: "⏰",
    }));
    expect(addReaction).toHaveBeenCalledWith(expect.objectContaining({ emoji: "⏰", messageId: "msg-1" }));
    expect(store.confirmHostedLinqAckReaction).toHaveBeenCalledWith(expect.objectContaining({ claimedAt }));
    expect(store.releaseHostedLinqAckReaction).not.toHaveBeenCalled();
  });

  it.each([
    ["my_data", true],
    ["calendar", true],
    ["reminder", true],
    ["challenge", true],
    ["do", false],
    ["research", false],
    ["make", false],
    ["look", false],
    ["picture", false],
    ["song", false],
  ] as const)("opts %s into the live-conversation rule: %s", async (kind, skipLiveConversation) => {
    store.claimHostedLinqAckReaction.mockResolvedValueOnce(null);
    await run({ classify: vi.fn(async () => decision({ kind })) });
    expect(store.claimHostedLinqAckReaction).toHaveBeenCalledWith(expect.objectContaining({
      messageReceivedAt: receivedAt,
      skipLiveConversation,
    }));
  });

  it.each(["live_conversation", "answered_or_burst_taken"] as const)("logs %s without sending, confirming, or releasing", async (outcome) => {
    store.claimHostedLinqAckReaction.mockResolvedValueOnce(outcome === "live_conversation" ? outcome : null);
    const addReaction = vi.fn();
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await run({ addReaction });
      expect(addReaction).not.toHaveBeenCalled();
      expect(store.confirmHostedLinqAckReaction).not.toHaveBeenCalled();
      expect(store.releaseHostedLinqAckReaction).not.toHaveBeenCalled();
      expect(store.markHostedLinqAckReactionHeavy).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledExactlyOnceWith(
        "Hosted onboarding diagnostic: hosted-onboarding.webhook.linq.ack-reaction.",
        expect.objectContaining({ kind: "reminder", outcome }),
      );
    } finally {
      log.mockRestore();
    }
  });

  it("stays quiet when the burst is taken or Murph already replied", async () => {
    store.claimHostedLinqAckReaction.mockResolvedValueOnce(null);
    const addReaction = vi.fn();
    await run({ addReaction });
    expect(addReaction).not.toHaveBeenCalled();
  });

  it("marks the message's burst heavy and sends nothing for a heavy message", async () => {
    const addReaction = vi.fn();
    await run({ addReaction, classify: vi.fn(async () => decision({ emoji: null, heavy: 0.92 })) });
    expect(store.markHostedLinqAckReactionHeavy).toHaveBeenCalledWith(expect.objectContaining({
      linqChatId: "chat-1",
      messageReceivedAt: receivedAt,
    }));
    expect(store.claimHostedLinqAckReaction).not.toHaveBeenCalled();
    expect(addReaction).not.toHaveBeenCalled();
  });

  it("does not touch the store for log, none, or an unreadable decision", async () => {
    await run({ classify: vi.fn(async () => decision({ emoji: null, kind: "log" })) });
    await run({ classify: vi.fn(async () => null) });
    expect(store.claimHostedLinqAckReaction).not.toHaveBeenCalled();
    expect(store.markHostedLinqAckReactionHeavy).not.toHaveBeenCalled();
  });

  it("gives the classifier an abort signal and stays quiet when it fails", async () => {
    const classify = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(run({ classify: classify as never })).resolves.toBeUndefined();
    expect(store.claimHostedLinqAckReaction).not.toHaveBeenCalled();
  });

  it("never claims or sends once the whole-task deadline has passed", async () => {
    const addReaction = vi.fn();
    await run({
      addReaction,
      classify: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return decision({});
      }),
      deadlineMs: 20,
    });
    expect(store.claimHostedLinqAckReaction).not.toHaveBeenCalled();
    expect(addReaction).not.toHaveBeenCalled();
  });

  it("frees an unsent reservation when the deadline passes during the claim", async () => {
    const claimedAt = new Date();
    store.claimHostedLinqAckReaction.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return claimedAt;
    });
    const addReaction = vi.fn();
    await run({ addReaction, deadlineMs: 500 });
    expect(addReaction).not.toHaveBeenCalled();
    expect(store.releaseHostedLinqAckReaction).toHaveBeenCalledWith(expect.objectContaining({ claimedAt }));
  });

  it("gives the Linq send only the remaining budget", async () => {
    store.claimHostedLinqAckReaction.mockResolvedValueOnce(new Date());
    const addReaction = vi.fn(async (_input: { timeoutMs?: number }) => ({ ok: true, status: 204 }));
    await run({ addReaction, deadlineMs: 2_000 });
    expect(addReaction.mock.calls[0]?.[0].timeoutMs).toBeLessThanOrEqual(2_000);
    expect(addReaction.mock.calls[0]?.[0].timeoutMs).toBeGreaterThan(1_000);
  });

  it("releases only after a definite refusal and keeps the reservation when the outcome is unknown", async () => {
    const claimedAt = new Date();
    store.claimHostedLinqAckReaction.mockResolvedValue(claimedAt);

    await run({ addReaction: vi.fn(async () => ({ ok: false, status: 409 })) });
    expect(store.releaseHostedLinqAckReaction).toHaveBeenCalledTimes(1);
    expect(store.releaseHostedLinqAckReaction).toHaveBeenCalledWith(expect.objectContaining({ claimedAt }));

    await run({ addReaction: vi.fn(async () => ({ ok: false, status: 502 })) });
    await run({ addReaction: vi.fn(async () => ({ ok: false, status: 408 })) });
    await run({ addReaction: vi.fn(async () => { throw new Error("socket hang up"); }) });
    expect(store.releaseHostedLinqAckReaction).toHaveBeenCalledTimes(1);
    expect(store.confirmHostedLinqAckReaction).not.toHaveBeenCalled();
  });

  it("never rejects when the store throws", async () => {
    store.claimHostedLinqAckReaction.mockRejectedValueOnce(new Error("db down"));
    await expect(run()).resolves.toBeUndefined();

    store.claimHostedLinqAckReaction.mockResolvedValueOnce(new Date());
    store.confirmHostedLinqAckReaction.mockRejectedValueOnce(new Error("db down"));
    await expect(run()).resolves.toBeUndefined();

    store.claimHostedLinqAckReaction.mockResolvedValueOnce(new Date());
    store.releaseHostedLinqAckReaction.mockRejectedValueOnce(new Error("db down"));
    await expect(run({ addReaction: vi.fn(async () => ({ ok: false, status: 400 })) })).resolves.toBeUndefined();
  });
});

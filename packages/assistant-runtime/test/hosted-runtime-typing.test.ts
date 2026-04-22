import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionRuntimeTimerWake,
  buildHostedExecutionTelegramConversationMessageWake,
  type HostedRuntimeDrainEvent,
  type HostedRuntimeEvent,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
  getAssistantChannelAdapter: vi.fn(),
  startLinqTypingIndicator: vi.fn(),
  startTelegramTypingIndicator: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

vi.mock("@murphai/assistant-engine/assistant-channel-adapters", () => ({
  getAssistantChannelAdapter: mocks.getAssistantChannelAdapter,
  startLinqTypingIndicator: mocks.startLinqTypingIndicator,
  startTelegramTypingIndicator: mocks.startTelegramTypingIndicator,
}));

import {
  HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_ENV,
  HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_EXECUTOR,
  selectHostedRunMessagingActivityTarget,
  shouldStartRuntimeHostedRunMessagingActivity,
  startHostedRunMessagingActivity,
  stopHostedRunMessagingActivity,
} from "../src/hosted-runtime/typing.ts";

function createDrainEvent(wake: HostedRuntimeEvent, seq: string): HostedRuntimeDrainEvent {
  return {
    ingressEventId: `ingress_${seq}`,
    seq,
    wake,
  };
}

function createLinqWake() {
  return buildHostedExecutionLinqConversationMessageWake({
    eventId: "evt_linq_typing",
    linqMessage: {
      chatId: "chat_123",
      from: "+15551234567",
      isFromMe: false,
      messageId: "msg_123",
      parts: [],
    },
    occurredAt: "2026-04-08T00:00:00.000Z",
    phoneLookupKey: "15551234567",
    userId: "member_123",
  });
}

function createTelegramWake() {
  return buildHostedExecutionTelegramConversationMessageWake({
    eventId: "evt_telegram_typing",
    occurredAt: "2026-04-08T00:00:00.000Z",
    telegramMessage: {
      messageId: "tg_message_123",
      schema: "murph.hosted-telegram-message.v1",
      threadId: "thread_123",
    },
    userId: "member_123",
  });
}

function createTelegramWakeWithTarget(threadId: string) {
  return buildHostedExecutionTelegramConversationMessageWake({
    eventId: "evt_telegram_typing",
    occurredAt: "2026-04-08T00:00:00.000Z",
    telegramMessage: {
      messageId: "tg_message_123",
      schema: "murph.hosted-telegram-message.v1",
      threadId,
    },
    userId: "member_123",
  });
}

function createEmailWake() {
  return buildHostedExecutionEmailConversationMessageWake({
    eventId: "evt_email_typing",
    identityId: "identity_123",
    occurredAt: "2026-04-08T00:00:00.000Z",
    rawMessageKey: "raw/message.eml",
    userId: "member_123",
  });
}

function requirePendingTypingResolver(
  resolveStart: ((value: { stop: () => Promise<void> }) => void) | null,
): (value: { stop: () => Promise<void> }) => void {
  if (!resolveStart) {
    throw new Error("Expected the Linq typing start promise to be pending.");
  }

  return resolveStart;
}

beforeEach(() => {
  vi.clearAllMocks();

  const createHandle = () => ({
    stop: vi.fn(async () => {}),
  });

  mocks.startLinqTypingIndicator.mockResolvedValue(createHandle());
  mocks.startTelegramTypingIndicator.mockResolvedValue(createHandle());
  mocks.getAssistantChannelAdapter.mockImplementation((channel: string | null | undefined) => {
    if (channel === "linq") {
      return {
        channel: "linq",
        async startTypingIndicator(
          input: { explicitTarget: string | null },
          dependencies: { startLinqTyping?: (input: { target: string }) => Promise<unknown> },
        ) {
          if (!input.explicitTarget) {
            return null;
          }
          return (await dependencies.startLinqTyping?.({
            target: input.explicitTarget,
          })) ?? null;
        },
      };
    }

    if (channel === "telegram") {
      return {
        channel: "telegram",
        async startTypingIndicator(
          input: { explicitTarget: string | null },
          dependencies: { startTelegramTyping?: (input: { target: string }) => Promise<unknown> },
        ) {
          if (!input.explicitTarget) {
            return null;
          }
          return (await dependencies.startTelegramTyping?.({
            target: input.explicitTarget,
          })) ?? null;
        },
      };
    }

    if (channel === "email") {
      return {
        channel: "email",
      };
    }

    return null;
  });
});

describe("hosted runtime messaging activity helpers", () => {
  it("selects the newest supported conversation.message event from the whole run batch", () => {
    const target = selectHostedRunMessagingActivityTarget([
      createDrainEvent(createTelegramWakeWithTarget("thread_old"), "001"),
      createDrainEvent(createEmailWake(), "002"),
      createDrainEvent(
        buildHostedExecutionRuntimeTimerWake({
          eventId: "evt_timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        }),
        "003",
      ),
      createDrainEvent(createLinqWake(), "004"),
    ]);

    expect(target).toEqual(
      expect.objectContaining({
        channel: "linq",
        explicitTarget: "chat_123",
        sourceSeq: "004",
      }),
    );
  });

  it("returns null when no supported messaging activity target exists", () => {
    const target = selectHostedRunMessagingActivityTarget([
      createDrainEvent(createEmailWake(), "001"),
      createDrainEvent(
        buildHostedExecutionRuntimeTimerWake({
          eventId: "evt_timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        }),
        "002",
      ),
    ]);

    assert.equal(target, null);
  });

  it("suppresses runtime-owned messaging activity when the executor claims ownership", () => {
    assert.equal(shouldStartRuntimeHostedRunMessagingActivity({}), true);
    assert.equal(
      shouldStartRuntimeHostedRunMessagingActivity({
        [HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_ENV]:
          HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_EXECUTOR,
      }),
      false,
    );
  });

  it("treats a missing messaging activity handle as a no-op when stopping", async () => {
    await expect(
      stopHostedRunMessagingActivity({
        activity: null,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalled();
  });

  it("fails closed when a Linq payload is missing a stable chat id", async () => {
    const activity = await startHostedRunMessagingActivity({
      events: [
        createDrainEvent(
          buildHostedExecutionLinqConversationMessageWake({
            eventId: "evt_linq_typing_invalid",
            linqMessage: {
              chatId: "   ",
              from: "+15551234567",
              isFromMe: false,
              messageId: "msg_123",
              parts: [],
            },
            occurredAt: "2026-04-08T00:00:00.000Z",
            phoneLookupKey: "15551234567",
            userId: "member_123",
          }),
          "001",
        ),
      ],
      run: null,
      runtimeEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
    });

    assert.equal(activity, null);
    expect(mocks.getAssistantChannelAdapter).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalled();
  });

  it("returns null when the selected adapter for a supported channel does not expose typing activity", async () => {
    mocks.getAssistantChannelAdapter.mockReturnValueOnce({
      channel: "telegram",
    });

    const activity = await startHostedRunMessagingActivity({
      events: [createDrainEvent(createTelegramWake(), "006")],
      run: null,
      runtimeEnv: {},
    });

    assert.equal(activity, null);
    expect(mocks.getAssistantChannelAdapter).toHaveBeenCalledWith("telegram");
    expect(mocks.startLinqTypingIndicator).not.toHaveBeenCalled();
    expect(mocks.startTelegramTypingIndicator).not.toHaveBeenCalled();
  });

  it("starts and stops Linq typing with the parsed chat id and runtime env", async () => {
    const activity = await startHostedRunMessagingActivity({
      events: [createDrainEvent(createLinqWake(), "007")],
      run: {
        attempt: 1,
        runId: "run_123",
        startedAt: "2026-04-08T00:00:00.000Z",
      },
      runtimeEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
    });
    if (!activity) {
      throw new Error("Expected a Linq messaging activity handle.");
    }
    expect(activity.ownsRuntimeActivity).toBe(true);

    expect(mocks.getAssistantChannelAdapter).toHaveBeenCalledWith("linq");
    expect(mocks.startLinqTypingIndicator).toHaveBeenCalledWith(
      {
        target: "chat_123",
      },
      {
        env: {
          LINQ_API_TOKEN: "linq-token",
        },
        refreshMs: undefined,
        signal: expect.any(AbortSignal),
      },
    );
    await vi.waitFor(() => {
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "runtime",
          details: expect.objectContaining({
            chatIdPresent: true,
            provider: "linq",
            runElapsedMs: expect.any(Number),
            sourceSeq: "007",
            startLatencyMs: expect.any(Number),
          }),
          message: "Hosted Linq typing indicator started.",
          phase: "wake.running",
        }),
      );
    });

    await activity.stop();

    const stopHandle = await mocks.startLinqTypingIndicator.mock.results[0]?.value;
    expect(stopHandle.stop).toHaveBeenCalledTimes(1);
  });

  it("logs a null elapsed time when the hosted run startedAt is invalid", async () => {
    const activity = await startHostedRunMessagingActivity({
      events: [createDrainEvent(createLinqWake(), "008")],
      run: {
        attempt: 1,
        runId: "run_invalid_started_at",
        startedAt: "not-a-real-timestamp",
      },
      runtimeEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
    });
    if (!activity) {
      throw new Error("Expected a Linq messaging activity handle.");
    }

    await vi.waitFor(() => {
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "runtime",
          details: expect.objectContaining({
            chatIdPresent: true,
            provider: "linq",
            runElapsedMs: null,
            sourceSeq: "008",
            startLatencyMs: expect.any(Number),
          }),
          message: "Hosted Linq typing indicator started.",
          phase: "wake.running",
        }),
      );
    });

    await activity.stop();
  });

  it("logs fallback target details when the Telegram thread target is not parseable", async () => {
    const activity = await startHostedRunMessagingActivity({
      events: [
        createDrainEvent(
          createTelegramWakeWithTarget("123:business::dm-topic:9"),
          "009",
        ),
      ],
      run: null,
      runtimeEnv: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    });
    if (!activity) {
      throw new Error("Expected a Telegram messaging activity handle.");
    }

    expect(mocks.startTelegramTypingIndicator).toHaveBeenCalledWith(
      {
        target: "123:business::dm-topic:9",
      },
      {
        env: {
          TELEGRAM_BOT_TOKEN: "telegram-token",
        },
        signal: expect.any(AbortSignal),
      },
    );
    await vi.waitFor(() => {
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "runtime",
          details: expect.objectContaining({
            provider: "telegram",
            sourceSeq: "009",
            targetBusinessConnectionPresent: true,
            targetDirectMessagesTopicPresent: true,
            targetMessageThreadPresent: false,
            targetParseable: false,
          }),
          message: "Hosted Telegram typing indicator started.",
          phase: "wake.running",
        }),
      );
    });

    await activity.stop();
  });

  it("carries Telegram target parse diagnostics into start failures without blocking stop", async () => {
    const startError = new Error("telegram typing rejected");
    mocks.startTelegramTypingIndicator.mockRejectedValue(startError);

    const activity = await startHostedRunMessagingActivity({
      events: [
        createDrainEvent(
          createTelegramWakeWithTarget("123:topic:abc"),
          "010",
        ),
      ],
      run: null,
      runtimeEnv: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    });

    expect(activity).toBeNull();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          provider: "telegram",
          sourceSeq: "010",
          targetBusinessConnectionPresent: false,
          targetDirectMessagesTopicPresent: false,
          targetMessageThreadPresent: true,
          targetParseable: false,
        }),
        error: startError,
        level: "warn",
        message: "Hosted Telegram typing indicator could not be started.",
        phase: "wake.running",
      }),
    );
  });

  it("swallows async typing stop failures and logs a warning once", async () => {
    const stopError = new Error("telegram stop failed");
    mocks.startTelegramTypingIndicator.mockResolvedValue({
      stop: vi.fn(async () => {
        throw stopError;
      }),
    });

    const activity = await startHostedRunMessagingActivity({
      component: "runner",
      events: [createDrainEvent(createTelegramWake(), "011")],
      run: null,
      runtimeEnv: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    });
    if (!activity) {
      throw new Error("Expected a Telegram messaging activity handle.");
    }

    await expect(activity.stop()).resolves.toBeUndefined();
    await expect(activity.stop()).resolves.toBeUndefined();

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          provider: "telegram",
          sourceSeq: "011",
        }),
        error: stopError,
        level: "warn",
        message: "Hosted Telegram typing indicator could not be stopped.",
        phase: "side-effects.draining",
      }),
    );
    const stopHandle = await mocks.startTelegramTypingIndicator.mock.results[0]?.value;
    expect(stopHandle.stop).toHaveBeenCalledTimes(1);
  });

  it("waits for Linq typing confirmation before returning executor ownership", async () => {
    let resolveStart: ((value: { stop: ReturnType<typeof vi.fn> }) => void) | null = null;
    const stop = vi.fn(async () => {});
    mocks.startLinqTypingIndicator.mockImplementationOnce(() => new Promise((resolve) => {
      resolveStart = resolve;
    }));

    let settled = false;
    const activityPromise = startHostedRunMessagingActivity({
      component: "runner",
      events: [createDrainEvent(createLinqWake(), "012")],
      run: null,
      runtimeEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      startTimeoutMs: 50,
    }).then((activity) => {
      settled = true;
      return activity;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    requirePendingTypingResolver(resolveStart)({
      stop,
    });

    const activity = await activityPromise;
    expect(activity).not.toBeNull();
    expect(activity?.ownsRuntimeActivity).toBe(true);
    await activity?.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("returns a non-owning cleanup handle when Linq typing confirmation times out and only stops after final cleanup", async () => {
    vi.useFakeTimers();
    let resolveStart: ((value: { stop: ReturnType<typeof vi.fn> }) => void) | null = null;
    const stop = vi.fn(async () => {});
    mocks.startLinqTypingIndicator.mockImplementationOnce(() => new Promise((resolve) => {
      resolveStart = resolve;
    }));

    const activityPromise = startHostedRunMessagingActivity({
      component: "runner",
      events: [createDrainEvent(createLinqWake(), "013")],
      run: null,
      runtimeEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      startTimeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    const activity = await activityPromise;
    expect(activity).not.toBeNull();
    expect(activity?.ownsRuntimeActivity).toBe(false);
    const logCountAfterTimeout = mocks.emitHostedExecutionStructuredLog.mock.calls.length;

    requirePendingTypingResolver(resolveStart)({
      stop,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledTimes(logCountAfterTimeout);
    expect(stop).not.toHaveBeenCalled();
    await activity?.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does not block cleanup forever when a timed-out Linq start never settles", async () => {
    vi.useFakeTimers();
    mocks.startLinqTypingIndicator.mockImplementationOnce(() => new Promise(() => {}));

    const activityPromise = startHostedRunMessagingActivity({
      component: "runner",
      events: [createDrainEvent(createLinqWake(), "014")],
      run: null,
      runtimeEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
      startTimeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    const activity = await activityPromise;
    expect(activity).not.toBeNull();
    expect(activity?.ownsRuntimeActivity).toBe(false);

    const stopPromise = activity?.stop();
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(stopPromise).resolves.toBeUndefined();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          cleanupTimeoutMs: 2_000,
          provider: "linq",
          sourceSeq: "014",
        }),
        level: "warn",
        message: "Hosted Linq typing indicator cleanup stopped waiting for a late start handle after the cleanup timeout.",
        phase: "side-effects.draining",
      }),
    );
    vi.useRealTimers();
  });
});

import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
  parseCanonicalLinqMessageReceivedEvent: vi.fn(),
  parseLinqWebhookEvent: vi.fn(),
  startLinqChatTypingIndicator: vi.fn(),
  startTelegramTypingSession: vi.fn(),
  stopLinqChatTypingIndicator: vi.fn(),
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

vi.mock("@murphai/messaging-ingress/linq-webhook", () => ({
  parseCanonicalLinqMessageReceivedEvent:
    mocks.parseCanonicalLinqMessageReceivedEvent,
  parseLinqWebhookEvent: mocks.parseLinqWebhookEvent,
}));

vi.mock("@murphai/operator-config/linq-runtime", () => ({
  startLinqChatTypingIndicator: mocks.startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator: mocks.stopLinqChatTypingIndicator,
}));

vi.mock("@murphai/operator-config/telegram-runtime", () => ({
  startTelegramTypingSession: mocks.startTelegramTypingSession,
}));

import {
  startHostedDispatchTypingIndicator,
  stopHostedDispatchTypingIndicator,
} from "../src/hosted-runtime/typing.ts";

function createLinqDispatch() {
  return buildHostedExecutionLinqMessageReceivedDispatch({
    eventId: "evt_linq_typing",
    linqEvent: {
      event_type: "message.received",
      id: "linq_123",
    },
    occurredAt: "2026-04-08T00:00:00.000Z",
    phoneLookupKey: "15551234567",
    userId: "member_123",
  });
}

function createTelegramDispatch() {
  return buildHostedExecutionTelegramMessageReceivedDispatch({
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

function createTelegramDispatchWithTarget(threadId: string) {
  return buildHostedExecutionTelegramMessageReceivedDispatch({
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.parseLinqWebhookEvent.mockReturnValue({
    parsed: true,
  });
  mocks.parseCanonicalLinqMessageReceivedEvent.mockReturnValue({
    data: {
      chat_id: "chat_123",
    },
  });
  mocks.startLinqChatTypingIndicator.mockResolvedValue(undefined);
  mocks.stopLinqChatTypingIndicator.mockResolvedValue(undefined);
  mocks.startTelegramTypingSession.mockResolvedValue({
    stop: vi.fn(async () => {}),
  });
});

describe("hosted runtime typing helpers", () => {
  it("returns null for dispatches that do not support typing indicators", () => {
    const indicator = startHostedDispatchTypingIndicator({
      dispatch: buildHostedExecutionAssistantCronTickDispatch({
        eventId: "evt_cron",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      }),
      run: null,
      runtimeEnv: {},
    });

    assert.equal(indicator, null);
    expect(mocks.startLinqChatTypingIndicator).not.toHaveBeenCalled();
    expect(mocks.startTelegramTypingSession).not.toHaveBeenCalled();
  });

  it("treats a missing typing indicator as a no-op when stopping", async () => {
    await expect(
      stopHostedDispatchTypingIndicator({
        dispatch: createTelegramDispatch(),
        run: null,
        typingIndicator: null,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalled();
  });

  it("fails closed when a Linq payload cannot be parsed", () => {
    mocks.parseLinqWebhookEvent.mockImplementation(() => {
      throw new Error("invalid linq payload");
    });

    const indicator = startHostedDispatchTypingIndicator({
      dispatch: createLinqDispatch(),
      run: null,
      runtimeEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
    });

    assert.equal(indicator, null);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          chatIdPresent: false,
          operation: "typing_start",
          provider: "linq",
        },
        level: "warn",
        message: "Hosted Linq typing indicator could not be started.",
        phase: "dispatch.running",
      }),
    );
  });

  it("starts and stops Linq typing with the parsed chat id and runtime env", async () => {
    const indicator = startHostedDispatchTypingIndicator({
      dispatch: createLinqDispatch(),
      run: {
        attempt: 1,
        runId: "run_123",
        startedAt: "2026-04-08T00:00:00.000Z",
      },
      runtimeEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
    });
    if (!indicator) {
      throw new Error("Expected a Linq typing indicator.");
    }

    await vi.waitFor(() => {
      expect(mocks.startLinqChatTypingIndicator).toHaveBeenCalledWith(
        {
          chatId: "chat_123",
        },
        {
          env: {
            LINQ_API_TOKEN: "linq-token",
          },
        },
      );
    });
    await vi.waitFor(() => {
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "runtime",
          details: expect.objectContaining({
            chatIdPresent: true,
            operation: "typing_start",
            provider: "linq",
            runElapsedMs: expect.any(Number),
            startLatencyMs: expect.any(Number),
          }),
          message: "Hosted Linq typing indicator started.",
          phase: "dispatch.running",
        }),
      );
    });

    await indicator.stop();

    expect(mocks.stopLinqChatTypingIndicator).toHaveBeenCalledWith(
      {
        chatId: "chat_123",
      },
      {
        env: {
          LINQ_API_TOKEN: "linq-token",
        },
      },
    );
  });

  it("logs a null elapsed time when the hosted run startedAt is invalid", async () => {
    const indicator = startHostedDispatchTypingIndicator({
      dispatch: createLinqDispatch(),
      run: {
        attempt: 1,
        runId: "run_invalid_started_at",
        startedAt: "not-a-real-timestamp",
      },
      runtimeEnv: {
        LINQ_API_TOKEN: "linq-token",
      },
    });
    if (!indicator) {
      throw new Error("Expected a Linq typing indicator.");
    }

    await vi.waitFor(() => {
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "runtime",
          details: expect.objectContaining({
            chatIdPresent: true,
            operation: "typing_start",
            provider: "linq",
            runElapsedMs: null,
            startLatencyMs: expect.any(Number),
          }),
          message: "Hosted Linq typing indicator started.",
          phase: "dispatch.running",
        }),
      );
    });

    await indicator.stop();
  });

  it("stops an in-flight Telegram typing indicator once even when stop is requested twice", async () => {
    const stopHandle = vi.fn(async () => {});
    let resolveHandle!: (value: { stop(): Promise<void> }) => void;
    mocks.startTelegramTypingSession.mockReturnValue(
      new Promise<{ stop(): Promise<void> }>((resolve) => {
        resolveHandle = resolve;
      }),
    );

    const indicator = startHostedDispatchTypingIndicator({
      dispatch: createTelegramDispatch(),
      run: null,
      runtimeEnv: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    });
    if (!indicator) {
      throw new Error("Expected a Telegram typing indicator.");
    }

    const firstStop = indicator.stop();
    const secondStop = indicator.stop();
    resolveHandle({
      stop: stopHandle,
    });
    await Promise.all([firstStop, secondStop]);

    expect(mocks.startTelegramTypingSession).toHaveBeenCalledWith(
      {
        target: "thread_123",
      },
      {
        env: {
          TELEGRAM_BOT_TOKEN: "telegram-token",
        },
      },
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          provider: "telegram",
          targetBusinessConnectionPresent: false,
          targetDirectMessagesTopicPresent: false,
          targetMessageThreadPresent: false,
          targetParseable: true,
        }),
        message: "Hosted Telegram typing indicator requested.",
        phase: "dispatch.running",
      }),
    );
    expect(stopHandle).toHaveBeenCalledTimes(1);
  });

  it("logs fallback target details when the Telegram thread target is not parseable", async () => {
    const dispatch = createTelegramDispatch();
    if (dispatch.event.kind !== "telegram.message.received") {
      throw new Error("Expected a Telegram message dispatch.");
    }
    dispatch.event.telegramMessage.threadId = "123:business::dm-topic:9";

    const indicator = startHostedDispatchTypingIndicator({
      dispatch,
      run: null,
      runtimeEnv: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    });
    if (!indicator) {
      throw new Error("Expected a Telegram typing indicator.");
    }

    await vi.waitFor(() => {
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "runtime",
          details: {
            provider: "telegram",
            targetBusinessConnectionPresent: true,
            targetDirectMessagesTopicPresent: true,
            targetMessageThreadPresent: false,
            targetParseable: false,
          },
          message: "Hosted Telegram typing indicator requested.",
          phase: "dispatch.running",
        }),
      );
    });

    await vi.waitFor(() => {
      expect(mocks.startTelegramTypingSession).toHaveBeenCalledWith(
        {
          target: "123:business::dm-topic:9",
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: "telegram-token",
          },
        },
      );
    });

    await indicator.stop();
  });

  it("logs canonical Telegram target details for business direct-message topics", async () => {
    const indicator = startHostedDispatchTypingIndicator({
      dispatch: createTelegramDispatchWithTarget("-1001234567890:business:biz-42:dm-topic:9"),
      run: null,
      runtimeEnv: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    });
    if (!indicator) {
      throw new Error("Expected a Telegram typing indicator.");
    }

    await vi.waitFor(() => {
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "runtime",
          details: expect.objectContaining({
            provider: "telegram",
            targetBusinessConnectionPresent: true,
            targetDirectMessagesTopicPresent: true,
            targetMessageThreadPresent: false,
            targetParseable: true,
          }),
          message: "Hosted Telegram typing indicator requested.",
          phase: "dispatch.running",
        }),
      );
    });

    await indicator.stop();
  });

  it("carries Telegram target parse diagnostics into start failures", async () => {
    const startError = new Error("telegram typing rejected");
    mocks.startTelegramTypingSession.mockRejectedValue(startError);

    const indicator = startHostedDispatchTypingIndicator({
      dispatch: createTelegramDispatchWithTarget("123:topic:abc"),
      run: null,
      runtimeEnv: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    });
    if (!indicator) {
      throw new Error("Expected a Telegram typing indicator.");
    }

    await indicator.stop();

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          provider: "telegram",
          targetBusinessConnectionPresent: false,
          targetDirectMessagesTopicPresent: false,
          targetMessageThreadPresent: true,
          targetParseable: false,
        }),
        error: startError,
        level: "warn",
        message: "Hosted Telegram typing indicator could not be started.",
        phase: "dispatch.running",
      }),
    );
  });

  it("swallows async typing stop failures and logs a warning", async () => {
    const stopError = new Error("telegram stop failed");
    mocks.startTelegramTypingSession.mockResolvedValue({
      stop: vi.fn(async () => {
        throw stopError;
      }),
    });

    const indicator = startHostedDispatchTypingIndicator({
      dispatch: createTelegramDispatch(),
      run: null,
      runtimeEnv: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    });
    if (!indicator) {
      throw new Error("Expected a Telegram typing indicator.");
    }

    await expect(indicator.stop()).resolves.toBeUndefined();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        error: stopError,
        level: "warn",
        message: "Hosted Telegram typing indicator could not be stopped.",
        phase: "side-effects.draining",
      }),
    );
  });

  it("logs and swallows stop failures from an externally provided typing indicator", async () => {
    const stopError = new Error("wrapper stop failed");

    await expect(
      stopHostedDispatchTypingIndicator({
        dispatch: createLinqDispatch(),
        run: null,
        typingIndicator: {
          channelLabel: "Linq",
          stop: vi.fn(async () => {
            throw stopError;
          }),
        },
      }),
    ).resolves.toBeUndefined();

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        error: stopError,
        level: "warn",
        message: "Hosted Linq typing indicator could not be stopped.",
        phase: "side-effects.draining",
      }),
    );
  });
});

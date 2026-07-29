import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    telegramBotToken: "telegram-token",
  }),
}));

import {
  answerHostedTelegramCallbackQueryBestEffort,
  getHostedTelegramGroupTitle,
  sendHostedTelegramTextMessage,
} from "@/src/lib/hosted-onboarding/telegram-client";

describe("hosted Telegram client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("preserves the exact Telegram thread and replies to the inbound message", async () => {
    await sendHostedTelegramTextMessage({
      message: "Try setup again.",
      replyToMessageId: 17,
      target: {
        businessConnectionId: "business_1",
        chatId: "42",
        directMessagesTopicId: 9,
      },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottelegram-token/sendMessage");
    expect(request).toMatchObject({
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(JSON.parse(String(request.body))).toEqual({
      business_connection_id: "business_1",
      chat_id: "42",
      direct_messages_topic_id: 9,
      reply_parameters: {
        allow_sending_without_reply: true,
        message_id: 17,
      },
      text: "Try setup again.",
    });
  });

  it("reads the current group title from the base chat", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: {
        id: -42,
        title: "Weekend Warriors",
        type: "supergroup",
      },
    }), { status: 200 }));

    await expect(getHostedTelegramGroupTitle({
      threadId: "-42:topic:7",
    })).resolves.toBe("Weekend Warriors");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottelegram-token/getChat");
    expect(JSON.parse(String(request.body))).toEqual({
      chat_id: "-42",
    });
  });

  it("returns no title when Telegram has none", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: {
        id: -42,
        type: "group",
      },
    }), { status: 200 }));

    await expect(getHostedTelegramGroupTitle({
      threadId: "-42",
    })).resolves.toBeNull();
  });

  it("rejects a direct-chat metadata response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: {
        first_name: "Someone",
        id: 42,
        type: "private",
      },
    }), { status: 200 }));

    await expect(getHostedTelegramGroupTitle({
      threadId: "-42",
    })).rejects.toMatchObject({
      code: "HOSTED_TELEGRAM_API_RESPONSE_INVALID",
      retryable: true,
    });
  });

  it("rejects an oversized metadata response", async () => {
    fetchMock.mockResolvedValue(new Response("{}", {
      headers: { "content-length": String(64 * 1024 + 1) },
      status: 200,
    }));

    await expect(getHostedTelegramGroupTitle({
      threadId: "-42",
    })).rejects.toMatchObject({
      code: "HOSTED_TELEGRAM_API_RESPONSE_INVALID",
      retryable: true,
    });
  });

  it("rejects an oversized streamed response without a content-length header", async () => {
    const response = new Response(new Uint8Array(64 * 1024 + 1), {
      status: 200,
    });
    expect(response.headers.get("content-length")).toBeNull();
    fetchMock.mockResolvedValue(response);

    await expect(getHostedTelegramGroupTitle({
      threadId: "-42",
    })).rejects.toMatchObject({
      code: "HOSTED_TELEGRAM_API_RESPONSE_INVALID",
      retryable: true,
    });
  });

  it("times out when a successful response body stalls", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((
      _url: string,
      request: RequestInit,
    ) => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":'));
        request.signal?.addEventListener("abort", () => {
          controller.error(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      },
    }), { status: 200 })));

    const titlePromise = getHostedTelegramGroupTitle({
      threadId: "-42",
    });
    const rejection = expect(titlePromise).rejects.toMatchObject({
      code: "HOSTED_TELEGRAM_API_RESPONSE_INVALID",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
  });

  it("rejects a provider refusal instead of reporting a reply that was never sent", async () => {
    fetchMock.mockResolvedValue(new Response("{}", {
      headers: { "retry-after": "45" },
      status: 429,
    }));

    await expect(sendHostedTelegramTextMessage({
      message: "Try setup again.",
      target: { chatId: "42" },
    })).rejects.toMatchObject({
      code: "HOSTED_TELEGRAM_API_RESPONSE_REJECTED",
      details: {
        retryAfterSeconds: 45,
        status: 429,
      },
      retryable: true,
    });
  });

  it("keeps a non-rate-limit provider failure terminal after dispatch", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 502 }));

    await expect(sendHostedTelegramTextMessage({
      message: "Try setup again.",
      target: { chatId: "42" },
    })).rejects.toMatchObject({
      code: "HOSTED_TELEGRAM_API_RESPONSE_REJECTED",
      details: {
        status: 502,
      },
      retryable: false,
    });
  });

  it("keeps callback acknowledgement best effort when Telegram refuses it", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 429 }));

    await expect(answerHostedTelegramCallbackQueryBestEffort({
      callbackQueryId: "callback_1",
      text: "Already handled.",
    })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    telegramBotToken: "telegram-token",
  }),
}));

import { sendHostedTelegramTextMessage } from "@/src/lib/hosted-onboarding/telegram-client";

describe("sendHostedTelegramTextMessage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
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

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottelegram-token/sendMessage",
      expect.objectContaining({
        body: JSON.stringify({
          business_connection_id: "business_1",
          chat_id: "42",
          direct_messages_topic_id: 9,
          reply_parameters: {
            allow_sending_without_reply: true,
            message_id: 17,
          },
          text: "Try setup again.",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
  });

  it("rejects a provider refusal instead of reporting a reply that was never sent", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 429 }));

    await expect(sendHostedTelegramTextMessage({
      message: "Try setup again.",
      target: { chatId: "42" },
    })).rejects.toMatchObject({
      code: "HOSTED_TELEGRAM_API_REQUEST_FAILED",
      retryable: true,
    });
  });
});

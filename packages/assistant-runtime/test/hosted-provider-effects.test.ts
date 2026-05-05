import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  sendHostedProviderLinqMessage,
  sendHostedProviderTelegramChatAction,
} from "../src/hosted-provider-effects.ts";

describe("hosted provider effects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends a Telegram chat action before stopping the short effects-backed session", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => new Response(JSON.stringify({
      ok: true,
      result: true,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await sendHostedProviderTelegramChatAction({
      action: "typing",
      target: "12345",
    }, {
      env: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    assert.equal(String(url), "https://api.telegram.org/bottelegram-token/sendChatAction");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      action: "typing",
      chat_id: "12345",
    });
  });

  it("recovers stale Linq thread sends inside the provider effect", async () => {
    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/chats/stale-chat/messages")) {
        return new Response(JSON.stringify({
          message: "Chat not found",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 404,
        });
      }
      if (url.endsWith("/phone_numbers")) {
        return new Response(JSON.stringify({
          phone_numbers: [
            { phone_number: "+15550000" },
          ],
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/chats")) {
        return new Response(JSON.stringify({
          chat: {
            id: "recovered-chat",
            message: {
              id: "recovered-message",
            },
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      return new Response(null, {
        status: 500,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedProviderLinqMessage({
      directRecipientPhoneNumber: "+15550001",
      message: "hello",
      target: "stale-chat",
      targetKind: "thread",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
    })).resolves.toEqual({
      providerMessageId: "recovered-message",
      providerThreadId: "recovered-chat",
      target: "recovered-chat",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    assert.equal(
      String(fetchMock.mock.calls[0]?.[0]),
      "https://api.linqapp.com/api/partner/v3/chats/stale-chat/messages",
    );
    assert.equal(
      String(fetchMock.mock.calls[1]?.[0]),
      "https://api.linqapp.com/api/partner/v3/phone_numbers",
    );
    assert.equal(
      String(fetchMock.mock.calls[2]?.[0]),
      "https://api.linqapp.com/api/partner/v3/chats",
    );
  });
});

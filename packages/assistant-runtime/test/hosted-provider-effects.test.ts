import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteHostedProviderLinqMessages,
  downloadHostedProviderTelegramFile,
  getHostedProviderTelegramFile,
  markHostedProviderLinqRead,
  sendHostedProviderLinqChatAction,
  sendHostedProviderLinqMessage,
  sendHostedProviderTelegramChatAction,
  sendHostedProviderTelegramMessage,
  setHostedProviderLinqMessageReaction,
} from "../src/hosted-provider-effects.ts";
import {
  HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE,
} from "../src/hosted-runtime/provider-fetch.ts";

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
      fetchImplementation: fetchMock as typeof fetch,
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

  it("can surface Telegram retry-after failures without waiting for runtime retries", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      description: "Too Many Requests",
      error_code: 429,
      ok: false,
      parameters: {
        retry_after: 42,
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 429,
    }));

    await expect(sendHostedProviderTelegramMessage({
      message: "quota reached",
      target: "12345",
    }, {
      env: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      fetchImplementation: fetchMock,
      telegramMaxDeliveryAttempts: 1,
    })).rejects.toMatchObject({
      code: "ASSISTANT_TELEGRAM_DELIVERY_FAILED",
      context: {
        retryAfterSeconds: 42,
        status: 429,
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to the default Telegram endpoint for a malformed override", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      new URL(String(input));
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message_id: 123,
        },
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });

    await expect(sendHostedProviderTelegramMessage({
      message: "quota reached",
      target: "12345",
    }, {
      env: {
        TELEGRAM_API_BASE_URL: "not a url",
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      fetchImplementation: fetchMock,
      telegramMaxDeliveryAttempts: 1,
    })).resolves.toMatchObject({
      providerMessageId: "123",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.telegram.org/bottelegram-token/sendMessage",
    );
  });

  it("fails closed instead of using ambient fetch when the hosted provider fetch dependency is missing", async () => {
    const rawGlobalFetch = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => {
      throw new Error("raw global fetch should not be used");
    });
    vi.stubGlobal("fetch", rawGlobalFetch);

    await expect(sendHostedProviderTelegramMessage({
      message: "hello",
      target: "12345",
    }, {
      env: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      fetchImplementation: null,
    })).rejects.toMatchObject({
      code: HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE,
    });
    await expect(sendHostedProviderTelegramChatAction({
      action: "typing",
      target: "12345",
    }, {
      env: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      fetchImplementation: null,
    })).rejects.toMatchObject({
      code: HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE,
    });
    await expect(getHostedProviderTelegramFile({
      fileId: "file_123",
    }, {
      env: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      fetchImplementation: null,
    })).rejects.toMatchObject({
      code: HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE,
    });
    await expect(downloadHostedProviderTelegramFile({
      filePath: "/photos/cat.jpg",
    }, {
      env: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
      fetchImplementation: null,
    })).rejects.toMatchObject({
      code: HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE,
    });
    await expect(sendHostedProviderLinqMessage({
      message: "hello",
      target: "chat_123",
      targetKind: "thread",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation: null,
    })).rejects.toMatchObject({
      code: HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE,
    });
    await expect(sendHostedProviderLinqChatAction({
      action: "typing",
      target: "chat_123",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation: null,
    })).rejects.toMatchObject({
      code: HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE,
    });
    await expect(markHostedProviderLinqRead({
      chatId: "chat_123",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation: null,
    })).rejects.toMatchObject({
      code: HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE,
    });
    await expect(setHostedProviderLinqMessageReaction({
      reaction: "heart",
      targetMessageId: "message_123",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation: null,
    })).rejects.toMatchObject({
      code: HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE,
    });
    await expect(deleteHostedProviderLinqMessages({
      messageIds: ["message_123"],
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation: null,
    })).rejects.toMatchObject({
      code: HOSTED_PROVIDER_FETCH_UNAVAILABLE_CODE,
    });

    expect(rawGlobalFetch).not.toHaveBeenCalled();
  });

  it("uses the hosted provider fetch dependency for Telegram effects", async () => {
    const rawGlobalFetch = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => {
      throw new Error("raw global fetch should not be used");
    });
    vi.stubGlobal("fetch", rawGlobalFetch);

    const fetchImplementation = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/sendChatAction")) {
        return new Response(JSON.stringify({
          ok: true,
          result: true,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/sendMessage")) {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            message_id: 123,
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/getFile?file_id=file_123")) {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            file_id: "file_123",
            file_path: "photos/cat.jpg",
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (url.endsWith("/photos/cat.jpg")) {
        return new Response(Uint8Array.from([1, 2, 3]), {
          status: 200,
        });
      }

      return new Response(null, {
        status: 500,
      });
    });
    const dependencies = {
      env: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
      fetchImplementation: fetchImplementation as typeof fetch,
    };

    await expect(sendHostedProviderTelegramMessage({
      message: "hello",
      target: "12345",
    }, dependencies)).resolves.toEqual({
      cleanupMessages: [{
        messageId: "123",
        target: "12345",
      }],
      providerMessageId: "123",
      target: "12345",
    });
    await sendHostedProviderTelegramChatAction({
      action: "typing",
      target: "12345",
    }, dependencies);
    await expect(getHostedProviderTelegramFile({
      fileId: "file_123",
    }, dependencies)).resolves.toEqual({
      file_id: "file_123",
      file_path: "photos/cat.jpg",
    });
    await expect(downloadHostedProviderTelegramFile({
      filePath: "/photos/cat.jpg",
    }, dependencies)).resolves.toEqual(Uint8Array.from([1, 2, 3]));

    expect(rawGlobalFetch).not.toHaveBeenCalled();
    expect(fetchImplementation.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.telegram.example/bottelegram-token/sendMessage",
      "https://api.telegram.example/bottelegram-token/sendChatAction",
      "https://api.telegram.example/bottelegram-token/getFile?file_id=file_123",
      "https://files.telegram.example/bottelegram-token/photos/cat.jpg",
    ]);
  });

  it("recovers stale Linq thread sends inside the provider effect with an explicit sender", async () => {
    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/chats/stale-chat/messages")) {
        return new Response(JSON.stringify({
          code: "CHAT_NOT_FOUND",
          message: "redacted provider detail",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 404,
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
      fromPhoneNumber: "+15550000",
      homeRouteFallbackAllowed: true,
      media: [
        {
          kind: "image",
          url: "https://cdn.example.test/dead-bug/setup.png",
          alt: "Dead bug setup",
          source: "dead-bug-setup",
        },
      ],
      message: "hello",
      target: "stale-chat",
      targetKind: "thread",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation: fetchMock as typeof fetch,
    })).resolves.toEqual({
      providerMessageEffects: [{
        message: "hello\n\nDead bug setup",
        providerMessageId: "recovered-message",
      }],
      providerMessageId: "recovered-message",
      providerThreadId: "recovered-chat",
      target: "recovered-chat",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    assert.equal(
      String(fetchMock.mock.calls[0]?.[0]),
      "https://api.linqapp.com/api/partner/v3/chats/stale-chat/messages",
    );
    assert.equal(
      String(fetchMock.mock.calls[1]?.[0]),
      "https://api.linqapp.com/api/partner/v3/chats",
    );
  });

  it("persists hosted app-card text fallback before its provider send", async () => {
    const onAppCardFallbackError = vi.fn();
    const persistAppCardTextFallback = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/capability/check_imessage")) {
        return new Response(JSON.stringify({ available: false }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        message: { id: "fallback-message" },
      }), {
        headers: { "content-type": "application/json" },
      });
    });

    await expect(sendHostedProviderLinqMessage({
      card: {
        kind: "daily_nutrition",
        localDate: "2026-07-31",
        mealCount: 1,
        totals: {
          calories: { mealCount: 1, total: 500 },
          carbsGrams: { mealCount: 1, total: 55 },
          fatGrams: { mealCount: 1, total: 18 },
          proteinGrams: { mealCount: 1, total: 35 },
        },
      },
      directRecipientPhoneNumber: "+15550001",
      idempotencyKey: "hosted-card-fallback",
      message: "Nutrition summary",
      target: "direct-chat",
      targetKind: "thread",
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: "linq-token" },
      fetchImplementation: fetchMock,
      onAppCardFallbackError,
      persistAppCardTextFallback,
    })).resolves.toMatchObject({
      idempotencyKey: "hosted-card-fallback",
      providerMessageId: "fallback-message",
    });

    expect(persistAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: "hosted-card-fallback",
    });
    expect(persistAppCardTextFallback.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[1]!,
    );
    expect(onAppCardFallbackError).not.toHaveBeenCalled();
  });

  it("returns the promoted identity after a direct app-card text fallback", async () => {
    const onAppCardFallbackError = vi.fn();
    const persistAppCardTextFallback = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/capability/check_imessage")) {
        return new Response(JSON.stringify({ available: true }), {
          headers: { "content-type": "application/json" },
        });
      }
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as {
            message?: { parts?: Array<{ type?: string }> };
          }
        : {};
      if (body.message?.parts?.[0]?.type === "imessage_app") {
        return new Response(JSON.stringify({ error: "unsupported app card" }), {
          headers: { "content-type": "application/json" },
          status: 400,
        });
      }
      return new Response(JSON.stringify({
        message: { id: "direct-fallback-message" },
      }), {
        headers: { "content-type": "application/json" },
      });
    });

    await expect(sendHostedProviderLinqMessage({
      card: {
        kind: "daily_nutrition",
        localDate: "2026-07-31",
        mealCount: 1,
        totals: {
          calories: { mealCount: 1, total: 500 },
          carbsGrams: { mealCount: 1, total: 55 },
          fatGrams: { mealCount: 1, total: 18 },
          proteinGrams: { mealCount: 1, total: 35 },
        },
      },
      directRecipientPhoneNumber: "+15550001",
      idempotencyKey: "hosted-card-rejected",
      message: "Nutrition summary",
      target: "direct-chat",
      targetKind: "thread",
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: "linq-token" },
      fetchImplementation: fetchMock,
      onAppCardFallbackError,
      persistAppCardTextFallback,
    })).resolves.toEqual({
      idempotencyKey: "hosted-card-rejected:fallback",
      providerMessageEffects: [{
        message: "Nutrition summary",
        providerMessageId: "direct-fallback-message",
      }],
      providerMessageId: "direct-fallback-message",
      providerThreadId: null,
      target: "direct-chat",
    });

    expect(persistAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: "hosted-card-rejected:fallback",
    });
    expect(onAppCardFallbackError).toHaveBeenCalledOnce();
    expect(onAppCardFallbackError).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: "LINQ_API_REQUEST_FAILED",
      }),
      reason: "app_card_rejected",
    });
  });

  it("observes a hosted capability error before selecting text recovery", async () => {
    const onAppCardFallbackError = vi.fn();
    const persistAppCardTextFallback = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/capability/check_imessage")) {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response(JSON.stringify({
        message: { id: "fallback-message" },
      }), {
        headers: { "content-type": "application/json" },
      });
    });

    await expect(sendHostedProviderLinqMessage({
      card: {
        kind: "daily_nutrition",
        localDate: "2026-08-05",
        mealCount: 1,
        totals: {
          calories: { mealCount: 1, total: 500 },
          carbsGrams: { mealCount: 1, total: 55 },
          fatGrams: { mealCount: 1, total: 18 },
          proteinGrams: { mealCount: 1, total: 35 },
        },
      },
      directRecipientPhoneNumber: "+15550001",
      idempotencyKey: "hosted-card-capability-error",
      message: "Nutrition summary",
      target: "direct-chat",
      targetKind: "thread",
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: "linq-token" },
      fetchImplementation: fetchMock,
      onAppCardFallbackError,
      persistAppCardTextFallback,
    })).resolves.toMatchObject({
      providerMessageId: "fallback-message",
    });

    expect(onAppCardFallbackError).toHaveBeenCalledOnce();
    expect(onAppCardFallbackError).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: "LINQ_API_REQUEST_FAILED",
      }),
      reason: "capability_check_failed",
    });
  });

  it("observes a malformed capability response error before selecting text recovery", async () => {
    const onAppCardFallbackError = vi.fn();
    const persistAppCardTextFallback = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/capability/check_imessage")) {
        return new Response("LEAKMARKER private provider prose", {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      return new Response(JSON.stringify({
        message: { id: "fallback-message" },
      }), {
        headers: { "content-type": "application/json" },
      });
    });

    await expect(sendHostedProviderLinqMessage({
      card: {
        kind: "daily_nutrition",
        localDate: "2026-08-05",
        mealCount: 1,
        totals: {
          calories: { mealCount: 1, total: 500 },
          carbsGrams: { mealCount: 1, total: 55 },
          fatGrams: { mealCount: 1, total: 18 },
          proteinGrams: { mealCount: 1, total: 35 },
        },
      },
      directRecipientPhoneNumber: "+15550001",
      idempotencyKey: "hosted-card-malformed-json",
      message: "Nutrition summary",
      target: "direct-chat",
      targetKind: "thread",
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: "linq-token" },
      fetchImplementation: fetchMock,
      onAppCardFallbackError,
      persistAppCardTextFallback,
    })).resolves.toMatchObject({
      providerMessageId: "fallback-message",
    });

    expect(onAppCardFallbackError).toHaveBeenCalledOnce();
    expect(onAppCardFallbackError).toHaveBeenCalledWith({
      error: expect.any(SyntaxError),
      reason: "capability_check_failed",
    });
  });

  it.each([
    {
      capabilityAvailable: false,
      expectedIdempotencyKey: "hosted-stale-card",
      name: "capability fallback",
    },
    {
      capabilityAvailable: true,
      expectedIdempotencyKey: "hosted-stale-card:fallback",
      name: "definitive app-card rejection",
    },
  ])("recovers a stale Linq thread after $name using the persisted text identity", async ({
    capabilityAvailable,
    expectedIdempotencyKey,
  }) => {
    const persistAppCardTextFallback = vi.fn().mockResolvedValue(undefined);
    const providerRequests: Array<{
      body: Record<string, unknown>;
      url: string;
    }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as Record<string, unknown>
        : {};
      providerRequests.push({ body, url });
      if (url.endsWith("/capability/check_imessage")) {
        return new Response(JSON.stringify({ available: capabilityAvailable }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/chats/stale-chat/messages")) {
        const message = body.message as {
          parts?: Array<{ type?: string }>;
        } | undefined;
        if (message?.parts?.[0]?.type === "imessage_app") {
          return new Response(JSON.stringify({ error: "unsupported app card" }), {
            headers: { "content-type": "application/json" },
            status: 400,
          });
        }
        return new Response(JSON.stringify({
          code: "CHAT_NOT_FOUND",
          message: "redacted provider detail",
        }), {
          headers: { "content-type": "application/json" },
          status: 404,
        });
      }
      if (url.endsWith("/chats")) {
        return new Response(JSON.stringify({
          chat: {
            id: "recovered-card-chat",
            message: { id: "recovered-card-message" },
          },
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 500 });
    });

    await expect(sendHostedProviderLinqMessage({
      card: {
        kind: "daily_nutrition",
        localDate: "2026-07-31",
        mealCount: 1,
        totals: {
          calories: { mealCount: 1, total: 500 },
          carbsGrams: { mealCount: 1, total: 55 },
          fatGrams: { mealCount: 1, total: 18 },
          proteinGrams: { mealCount: 1, total: 35 },
        },
      },
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550000",
      homeRouteFallbackAllowed: true,
      idempotencyKey: "hosted-stale-card",
      message: "Nutrition summary",
      target: "stale-chat",
      targetKind: "thread",
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: "linq-token" },
      fetchImplementation: fetchMock,
      persistAppCardTextFallback,
    })).resolves.toEqual({
      idempotencyKey: expectedIdempotencyKey,
      providerMessageEffects: [{
        message: "Nutrition summary",
        providerMessageId: "recovered-card-message",
      }],
      providerMessageId: "recovered-card-message",
      providerThreadId: "recovered-card-chat",
      target: "recovered-card-chat",
    });

    expect(persistAppCardTextFallback).toHaveBeenCalledOnce();
    expect(persistAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: expectedIdempotencyKey,
    });
    const createChatRequest = providerRequests.find(({ url }) =>
      url.endsWith("/chats")
    );
    expect(createChatRequest?.body).toMatchObject({
      message: {
        idempotency_key: expectedIdempotencyKey,
        parts: [{ type: "text", value: "Nutrition summary" }],
      },
      to: ["+15550001"],
    });
    expect(providerRequests.filter(({ url }) =>
      url.endsWith("/chats/stale-chat/messages")
    )).toHaveLength(capabilityAvailable ? 2 : 1);
  });

  it("does not re-home a stale Linq thread without fallback authority", async () => {
    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      if (String(input).endsWith("/chats/stale-chat/messages")) {
        return new Response(JSON.stringify({
          code: "CHAT_NOT_FOUND",
          message: "redacted provider detail",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 404,
        });
      }
      return new Response(null, { status: 500 });
    });

    await expect(sendHostedProviderLinqMessage({
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550000",
      homeRouteFallbackAllowed: false,
      message: "hello",
      target: "stale-chat",
      targetKind: "thread",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation: fetchMock as typeof fetch,
    })).rejects.toMatchObject({
      code: "LINQ_API_REQUEST_FAILED",
      context: expect.objectContaining({ status: 404 }),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses the hosted provider fetch dependency for explicit-sender Linq recovery", async () => {
    const rawGlobalFetch = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => {
      throw new Error("raw global fetch should not be used");
    });
    vi.stubGlobal("fetch", rawGlobalFetch);

    const fetchImplementation = vi.fn(async (
      input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/chats/stale-chat/messages")) {
        return new Response(JSON.stringify({
          code: "CHAT_NOT_FOUND",
          message: "redacted provider detail",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 404,
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

    await expect(sendHostedProviderLinqMessage({
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550000",
      homeRouteFallbackAllowed: true,
      media: [
        {
          kind: "image",
          url: "https://cdn.example.test/dead-bug/setup.png",
          alt: "Dead bug setup",
          source: "dead-bug-setup",
        },
      ],
      message: "hello",
      target: "stale-chat",
      targetKind: "thread",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation,
    })).resolves.toEqual({
      providerMessageEffects: [{
        message: "hello\n\nDead bug setup",
        providerMessageId: "recovered-message",
      }],
      providerMessageId: "recovered-message",
      providerThreadId: "recovered-chat",
      target: "recovered-chat",
    });

    expect(rawGlobalFetch).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    assert.equal(
      String(fetchImplementation.mock.calls[0]?.[0]),
      "https://api.linqapp.com/api/partner/v3/chats/stale-chat/messages",
    );
    assert.equal(
      String(fetchImplementation.mock.calls[1]?.[0]),
      "https://api.linqapp.com/api/partner/v3/chats",
    );
    assert.deepEqual(
      JSON.parse(String(fetchImplementation.mock.calls[1]?.[1]?.body)),
      {
        from: "+15550000",
        message: {
          parts: [
            {
              type: "text",
              value: "hello\n\nDead bug setup",
            },
            {
              type: "media",
              url: "https://cdn.example.test/dead-bug/setup.png",
            },
          ],
        },
        to: ["+15550001"],
      },
    );
  });

  it("does not retry Linq recovery after an ambiguous create-chat response", async () => {
    const fetchImplementation = vi.fn(async (
      input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/chats/stale-chat/messages")) {
        return new Response(JSON.stringify({
          code: "CHAT_NOT_FOUND",
          message: "redacted provider detail",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 404,
        });
      }
      if (url.endsWith("/chats")) {
        return new Response(JSON.stringify({
          message: "request timeout",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 408,
        });
      }

      return new Response(null, {
        status: 500,
      });
    });

    await expect(sendHostedProviderLinqMessage({
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550000",
      homeRouteFallbackAllowed: true,
      message: "hello",
      target: "stale-chat",
      targetKind: "thread",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation,
    })).rejects.toMatchObject({
      code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
    });

    const createChatCalls = fetchImplementation.mock.calls.filter(([input]) =>
      String(input).endsWith("/chats")
    );
    expect(createChatCalls).toHaveLength(1);
  });

  it("preserves provider-skipped provenance through direct-thread materialization", async () => {
    const providerSkippedError = Object.assign(
      new Error("Fresh input preempted the attachment reservation."),
      {
        assistantDeliveryFailureClass: "transient" as const,
        assistantDeliveryResumeTrigger: "fresh_foreground_input" as const,
        deliveryMayHaveSucceeded: false as const,
        retryable: true as const,
      },
    );
    const fetchImplementation = vi.fn<typeof fetch>(async () => {
      throw providerSkippedError;
    });

    await expect(sendHostedProviderLinqMessage({
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550000",
      homeRouteFallbackAllowed: true,
      media: [{
        alt: "Private generated image",
        contentType: "image/png",
        filename: "generated.png",
        kind: "vault_image",
        ref: "raw/captures/generated.png",
        sha256: "a".repeat(64),
        sizeBytes: 12,
        source: "gpt-image-2",
      }],
      message: "hello",
      target: "h1_111111111111111111111111",
      targetKind: "thread",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation,
      loadVaultImage: async () => new Uint8Array(12),
    })).rejects.toBe(providerSkippedError);

    expect(providerSkippedError).toMatchObject({
      assistantDeliveryFailureClass: "transient",
      assistantDeliveryResumeTrigger: "fresh_foreground_input",
      deliveryMayHaveSucceeded: false,
      retryable: true,
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    assert.equal(
      String(fetchImplementation.mock.calls[0]?.[0]),
      "https://api.linqapp.com/api/partner/v3/attachments",
    );
  });

  it("preserves attachment-reservation ambiguity through direct-thread materialization", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => {
      throw Object.assign(new Error("Fresh input preempted the final Linq request."), {
        linqAttachmentReservationMayHaveSucceeded: true as const,
      });
    });

    await expect(sendHostedProviderLinqMessage({
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550000",
      homeRouteFallbackAllowed: true,
      message: "hello",
      target: "h1_111111111111111111111111",
      targetKind: "thread",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation,
    })).rejects.toMatchObject({
      code: "LINQ_API_REQUEST_FAILED",
      context: expect.objectContaining({
        failureStage: "transport",
        operation: "create_chat",
        retryable: false,
      }),
      linqAttachmentReservationMayHaveSucceeded: true,
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    assert.equal(
      String(fetchImplementation.mock.calls[0]?.[0]),
      "https://api.linqapp.com/api/partner/v3/chats",
    );
  });

  it("does not materialize or send redacted Linq direct targets without an explicit sender", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => new Response(null, {
      status: 204,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedProviderLinqMessage({
      directRecipientPhoneNumber: "+15550001",
      homeRouteFallbackAllowed: true,
      message: "hello",
      target: "h1_111111111111111111111111",
      targetKind: "explicit",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation: fetchMock as typeof fetch,
    })).rejects.toMatchObject({
      code: "ASSISTANT_HOSTED_LINQ_RECOVERY_SENDER_REQUIRED",
      context: expect.objectContaining({
        retryable: false,
      }),
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a marked native reply on the original Linq chat and never recreates it", async () => {
    const fetchImplementation = vi.fn(async (
      input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/chats/stale-chat/messages")) {
        return new Response(JSON.stringify({
          code: "CHAT_NOT_FOUND",
          message: "redacted provider detail",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 404,
        });
      }
      if (url.endsWith("/chats")) {
        return new Response(JSON.stringify({
          chat: {
            id: "must-not-create",
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      return new Response(null, { status: 500 });
    });

    await expect(sendHostedProviderLinqMessage({
      directRecipientPhoneNumber: "+15550001",
      fromPhoneNumber: "+15550000",
      homeRouteFallbackAllowed: true,
      message: "selected reply",
      nativeReplyRequested: true,
      replyToMessageId: "selected-message-1",
      target: "stale-chat",
      targetKind: "thread",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation,
    })).rejects.toMatchObject({
      code: "LINQ_API_REQUEST_FAILED",
      context: expect.objectContaining({
        status: 404,
      }),
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      message: {
        reply_to: {
          message_id: "selected-message-1",
        },
      },
    });
  });

  it("does not recover unclassified Linq thread send 404 responses", async () => {
    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/chats/stale-chat/messages")) {
        return new Response(JSON.stringify({
          message: "Reply target not found",
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 404,
        });
      }

      return new Response(null, {
        status: 500,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedProviderLinqMessage({
      directRecipientPhoneNumber: "+15550001",
      homeRouteFallbackAllowed: true,
      message: "hello",
      target: "stale-chat",
      targetKind: "thread",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation: fetchMock as typeof fetch,
    })).rejects.toMatchObject({
      code: "LINQ_API_REQUEST_FAILED",
      context: expect.objectContaining({
        status: 404,
      }),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    assert.equal(
      String(fetchMock.mock.calls[0]?.[0]),
      "https://api.linqapp.com/api/partner/v3/chats/stale-chat/messages",
    );
  });

  it("materializes redacted Linq direct targets with the proved same-wake sender", async () => {
    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/chats")) {
        return new Response(JSON.stringify({
          chat: {
            id: "materialized-chat",
            message: {
              id: "materialized-message",
            },
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      return new Response(JSON.stringify({
        unexpected: {
          bodyPresent: init?.body !== undefined,
          url,
        },
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 500,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedProviderLinqMessage({
      directRecipientPhoneNumber: "+linq-recipient",
      fromPhoneNumber: "+linq-sender",
      homeRouteFallbackAllowed: true,
      idempotencyKey: "assistant-outbox:intent_1",
      message: "hello",
      replyToMessageId: "linq-message-1",
      target: "h1_111111111111111111111111",
      targetKind: "explicit",
    }, {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation: fetchMock as typeof fetch,
    })).resolves.toEqual({
      idempotencyKey: "assistant-outbox:intent_1",
      providerMessageEffects: [{
        message: "hello",
        providerMessageId: "materialized-message",
      }],
      providerMessageId: "materialized-message",
      providerThreadId: "materialized-chat",
      target: "materialized-chat",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    assert.equal(
      String(fetchMock.mock.calls[0]?.[0]),
      "https://api.linqapp.com/api/partner/v3/chats",
    );
    assert.equal(fetchMock.mock.calls[0]?.[1]?.method, "POST");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    assert.equal(body.from, "+linq-sender");
    assert.deepEqual(body.to, ["+linq-recipient"]);
    assert.deepEqual(body.message.parts, [{ type: "text", value: "hello" }]);
    assert.equal(body.message.idempotency_key, "assistant-outbox:intent_1");
  });

  it("starts and stops Linq typing inside the provider effect", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => new Response(null, {
      status: 204,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const dependencies = {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation: fetchMock as typeof fetch,
    };

    await sendHostedProviderLinqChatAction({
      action: "typing",
      target: "chat_123",
    }, dependencies);
    await sendHostedProviderLinqChatAction({
      action: "typing_stop",
      target: "chat_123",
    }, dependencies);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    assert.equal(
      String(fetchMock.mock.calls[0]?.[0]),
      "https://api.linqapp.com/api/partner/v3/chats/chat_123/typing",
    );
    assert.equal(
      String(fetchMock.mock.calls[1]?.[0]),
      "https://api.linqapp.com/api/partner/v3/chats/chat_123/typing",
    );
    assert.equal(fetchMock.mock.calls[0]?.[1]?.method, "POST");
    assert.equal(fetchMock.mock.calls[1]?.[1]?.method, "DELETE");
  });

  it("uses the hosted provider fetch dependency for Linq non-send effects", async () => {
    const rawGlobalFetch = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => {
      throw new Error("raw global fetch should not be used");
    });
    vi.stubGlobal("fetch", rawGlobalFetch);
    const fetchImplementation = vi.fn(async (
      ...args: Parameters<typeof fetch>
    ) => {
      const url = String(args[0]);
      if (url.endsWith("/reactions")) {
        return new Response(JSON.stringify({ status: "accepted" }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      return new Response(null, {
        status: 204,
      });
    });
    const dependencies = {
      env: {
        LINQ_API_TOKEN: "linq-token",
      },
      fetchImplementation,
    };

    await sendHostedProviderLinqChatAction({
      action: "typing",
      target: "chat_123",
    }, dependencies);
    await sendHostedProviderLinqChatAction({
      action: "typing_stop",
      target: "chat_123",
    }, dependencies);
    await markHostedProviderLinqRead({
      chatId: "chat_123",
    }, dependencies);
    await setHostedProviderLinqMessageReaction({
      reaction: "thumbs_up",
      targetMessageId: "message_reaction_123",
    }, dependencies);
    await deleteHostedProviderLinqMessages({
      messageIds: ["message_123"],
    }, dependencies);

    expect(rawGlobalFetch).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
    expect(fetchImplementation.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.linqapp.com/api/partner/v3/chats/chat_123/typing",
      "https://api.linqapp.com/api/partner/v3/chats/chat_123/typing",
      "https://api.linqapp.com/api/partner/v3/chats/chat_123/read",
      "https://api.linqapp.com/api/partner/v3/messages/message_reaction_123/reactions",
      "https://api.linqapp.com/api/partner/v3/messages/message_123",
    ]);
    assert.deepEqual(
      JSON.parse(String(fetchImplementation.mock.calls[3]?.[1]?.body)),
      {
        operation: "add",
        type: "like",
      },
    );
  });

});

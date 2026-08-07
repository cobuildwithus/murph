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
    vi.unstubAllEnvs();
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
  });

  it("replays the exact hosted app card without another capability request", async () => {
    vi.stubEnv("MURPH_HOSTED_EXECUTION_STDIO_LOGS", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        message: { id: "replayed-native-card" },
      }), {
        headers: { "content-type": "application/json" },
      })
    );

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
      directRecipientPhoneNumber: null,
      idempotencyKey: "hosted-card-exact-replay",
      linqAppCardReplay: true,
      message: "Nutrition summary",
      target: "direct-chat-replay",
      targetKind: "thread",
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: "linq-token" },
      fetchImplementation: fetchMock,
    })).resolves.toMatchObject({
      providerMessageId: "replayed-native-card",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [request, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(request)).not.toContain("/capability/check_imessage");
    expect(String(request)).toContain("/chats/direct-chat-replay/messages");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      message: {
        idempotency_key: "hosted-card-exact-replay",
        parts: [{ type: "imessage_app" }],
      },
    });
    expect(info).toHaveBeenCalledOnce();
    const replayLog = JSON.parse(String(info.mock.calls[0]?.[0])) as {
      details?: Record<string, unknown>;
      level?: string;
    };
    expect(replayLog).toMatchObject({
      details: {
        eventType: "assistant.delivery.linq_app_card_exact_replay",
        providerKind: "linq",
        retryMode: "provider_idempotency",
      },
      level: "info",
    });
    const serializedLog = JSON.stringify(replayLog);
    expect(serializedLog).not.toContain("direct-chat-replay");
    expect(serializedLog).not.toContain("hosted-card-exact-replay");
    expect(serializedLog).not.toContain("linq-token");
  });

  it.each([
    { directRecipientPhoneNumber: null, execution: "detached" },
    { directRecipientPhoneNumber: "+15550001", execution: "live" },
  ])("uses an authority-resolved thread for $execution replay fallback after structured stale-chat rejection", async ({
    directRecipientPhoneNumber,
  }) => {
    const persistAppCardTextFallback = vi.fn(async (_input: {
      idempotencyKey: string;
      staleTargetRecoveryRequired?: true;
    }) => ({
      target: "current-direct-chat",
      targetKind: "thread" as const,
    }));
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as {
          message?: { parts?: Array<{ type?: string }> };
        }
        : {};
      if (url.endsWith("/chats/stale-direct-chat/messages")) {
        expect(body.message?.parts?.[0]?.type).toBe("imessage_app");
        return new Response(JSON.stringify({
          code: "CHAT_NOT_FOUND",
          message: "redacted provider detail",
        }), {
          headers: { "content-type": "application/json" },
          status: 404,
        });
      }
      if (url.endsWith("/chats/current-direct-chat/messages")) {
        expect(body.message?.parts?.[0]?.type).toBe("text");
        return new Response(JSON.stringify({
          message: { id: "recovered-fallback-message" },
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
      directRecipientPhoneNumber,
      fromPhoneNumber: "+15550000",
      homeRouteFallbackAllowed: true,
      idempotencyKey: "detached-stale-card",
      linqAppCardReplay: true,
      message: "Nutrition summary",
      target: "stale-direct-chat",
      targetKind: "thread",
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: "linq-token" },
      fetchImplementation: fetchMock,
      persistAppCardTextFallback,
    })).resolves.toMatchObject({
      idempotencyKey: "detached-stale-card:fallback",
      providerMessageId: "recovered-fallback-message",
      target: "current-direct-chat",
    });

    expect(persistAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: "detached-stale-card:fallback",
      staleTargetRecoveryRequired: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("materializes an authority-resolved participant after persisting stale-card fallback", async () => {
    const persistAppCardTextFallback = vi.fn(async (_input: {
      idempotencyKey: string;
      staleTargetRecoveryRequired?: true;
    }) => ({
      fromPhoneNumber: "+15550000",
      target: "+15550001",
      targetKind: "participant" as const,
    }));
    const observedOrder: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/chats/stale-direct-chat/messages")) {
        observedOrder.push("provider:stale-card");
        return new Response(JSON.stringify({
          code: "CHAT_NOT_FOUND",
          message: "redacted provider detail",
        }), {
          headers: { "content-type": "application/json" },
          status: 404,
        });
      }
      if (url.endsWith("/chats")) {
        observedOrder.push("provider:materialize-text");
        const body = JSON.parse(String(init?.body)) as {
          from?: string;
          message?: { idempotency_key?: string };
          to?: string[];
        };
        expect(body).toMatchObject({
          from: "+15550000",
          message: {
            idempotency_key: "same-home-stale-card:fallback",
          },
          to: ["+15550001"],
        });
        return new Response(JSON.stringify({
          chat: {
            id: "materialized-direct-chat",
            message: { id: "materialized-fallback-message" },
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
      homeRouteFallbackAllowed: true,
      idempotencyKey: "same-home-stale-card",
      linqAppCardReplay: true,
      message: "Nutrition summary",
      target: "stale-direct-chat",
      targetKind: "thread",
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: "linq-token" },
      fetchImplementation: fetchMock,
      persistAppCardTextFallback: async (input) => {
        observedOrder.push("persist-fallback");
        return await persistAppCardTextFallback(input);
      },
    })).resolves.toMatchObject({
      idempotencyKey: "same-home-stale-card:fallback",
      providerMessageId: "materialized-fallback-message",
      providerThreadId: "materialized-direct-chat",
      target: "materialized-direct-chat",
    });

    expect(persistAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: "same-home-stale-card:fallback",
      staleTargetRecoveryRequired: true,
    });
    expect(observedOrder).toEqual([
      "provider:stale-card",
      "persist-fallback",
      "provider:materialize-text",
    ]);
  });

  it("does not use transient phone recovery after persisting a stale-card target replacement", async () => {
    const persistAppCardTextFallback = vi.fn(async () => ({
      target: "current-direct-chat",
      targetKind: "thread" as const,
    }));
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (
        url.endsWith("/chats/stale-direct-chat/messages")
        || url.endsWith("/chats/current-direct-chat/messages")
      ) {
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
            id: "process-local-chat",
            message: { id: "process-local-message" },
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
      idempotencyKey: "stale-card-no-ephemeral-recovery",
      linqAppCardReplay: true,
      message: "Nutrition summary",
      target: "stale-direct-chat",
      targetKind: "thread",
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: "linq-token" },
      fetchImplementation: fetchMock,
      persistAppCardTextFallback,
    })).rejects.toMatchObject({
      code: "LINQ_API_REQUEST_FAILED",
    });

    expect(persistAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: "stale-card-no-ephemeral-recovery:fallback",
      staleTargetRecoveryRequired: true,
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/chats")))
      .toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("logs a sanitized warning when a hosted capability error selects text recovery", async () => {
    vi.stubEnv("MURPH_HOSTED_EXECUTION_STDIO_LOGS", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
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
      persistAppCardTextFallback,
    })).resolves.toMatchObject({
      providerMessageId: "fallback-message",
    });

    expect(warn).toHaveBeenCalledOnce();
    const logged = JSON.parse(String(warn.mock.calls[0]?.[0])) as {
      details?: Record<string, unknown>;
      errorCode?: string;
      level?: string;
      message?: string;
    };
    expect(logged).toMatchObject({
      details: {
        eventType: "assistant.delivery.linq_app_card_fallback_error",
        fallbackKind: "text",
        linqAppCardFallbackReason: "capability_check_failed",
        operation: "check_imessage_capability",
        provider: "linq",
        providerKind: "linq",
        status: 403,
      },
      errorCode: "authorization_error",
      level: "warn",
    });
    expect(logged.message).toContain(
      "Hosted Linq iMessage app-card delivery selected text recovery after an error.",
    );
    const serializedLog = JSON.stringify(logged);
    expect(serializedLog).not.toContain("+15550001");
    expect(serializedLog).not.toContain("direct-chat");
    expect(serializedLog).not.toContain("hosted-card-capability-error");
    expect(serializedLog).not.toContain("linq-token");
    expect(serializedLog).not.toContain("Forbidden");
  });

  it("keeps an exhausted capability rate limit on deterministic text fallback", async () => {
    const persistAppCardTextFallback = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/capability/check_imessage")) {
        return new Response(JSON.stringify({ error: "rate limited" }), {
          headers: {
            "content-type": "application/json",
            "retry-after": "0",
          },
          status: 429,
        });
      }
      if (url.endsWith("/chats/current-direct-chat/messages")) {
        return new Response(JSON.stringify({
          message: { id: "capability-fallback-message" },
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
      idempotencyKey: "capability-rate-limit-card",
      message: "Nutrition summary",
      target: "current-direct-chat",
      targetKind: "thread",
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: "linq-token" },
      fetchImplementation: fetchMock,
      persistAppCardTextFallback,
    })).resolves.toMatchObject({
      idempotencyKey: "capability-rate-limit-card",
      providerMessageId: "capability-fallback-message",
      target: "current-direct-chat",
    });

    expect(persistAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: "capability-rate-limit-card",
    });
    expect(fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith("/capability/check_imessage")
    )).toHaveLength(3);
    expect(fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith("/chats/current-direct-chat/messages")
    )).toHaveLength(1);
  });

  it("does not claim completed recovery when the hosted text transition fails", async () => {
    vi.stubEnv("MURPH_HOSTED_EXECUTION_STDIO_LOGS", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const transitionError = new Error("fallback transition failed");
    const persistAppCardTextFallback = vi.fn().mockRejectedValue(transitionError);
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response("Forbidden", { status: 403 })
    );

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
      idempotencyKey: "hosted-card-transition-error",
      message: "Nutrition summary",
      target: "direct-chat",
      targetKind: "thread",
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: "linq-token" },
      fetchImplementation: fetchMock,
      persistAppCardTextFallback,
    })).rejects.toBe(transitionError);

    expect(warn).toHaveBeenCalledOnce();
    const logged = JSON.parse(String(warn.mock.calls[0]?.[0])) as {
      message?: string;
    };
    expect(logged.message).toContain("selected text recovery after an error");
    expect(logged.message).not.toContain("recovered with text");
    expect(persistAppCardTextFallback).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns the promoted identity after a direct app-card text fallback", async () => {
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
      persistAppCardTextFallback,
    })).resolves.toEqual({
      idempotencyKey: "hosted-card-rejected:fallback",
      providerMessageId: "direct-fallback-message",
      providerThreadId: null,
      target: "direct-chat",
    });

    expect(persistAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: "hosted-card-rejected:fallback",
    });
  });

  it.each([
    {
      capabilityAvailable: false,
      exactReplay: false,
      expectedCapabilityRequests: 1,
      expectedIdempotencyKey: "hosted-stale-card",
      name: "capability fallback",
    },
    {
      capabilityAvailable: true,
      exactReplay: false,
      expectedCapabilityRequests: 1,
      expectedIdempotencyKey: "hosted-stale-card:fallback",
      name: "definitive app-card rejection",
    },
    {
      capabilityAvailable: true,
      exactReplay: true,
      expectedCapabilityRequests: 0,
      expectedIdempotencyKey: "hosted-stale-card:fallback",
      name: "definitively rejected exact replay",
    },
  ])("recovers a stale Linq thread after $name using the persisted text identity", async ({
    capabilityAvailable,
    exactReplay,
    expectedCapabilityRequests,
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
      ...(exactReplay ? { linqAppCardReplay: true } : {}),
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
    expect(providerRequests.filter(({ url }) =>
      url.endsWith("/capability/check_imessage")
    )).toHaveLength(expectedCapabilityRequests);
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

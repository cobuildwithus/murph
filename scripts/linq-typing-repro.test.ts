import { describe, expect, it, vi } from "vitest";

import {
  readLinqTypingReproOptions,
  runLinqTypingRepro,
  type LinqTypingReproOptions,
} from "./linq-typing-repro.ts";

describe("linq typing repro", () => {
  it("reads CLI flags and env without requiring raw identifiers in arguments", () => {
    const options = readLinqTypingReproOptions(
      [
        "--send-message",
        "--confirm-live-linq",
        "--interactive-observation",
        "--observation-ms",
        "25",
      ],
      {
        LINQ_REPRO_CHAT_ID: "chat_secret_123",
        LINQ_REPRO_MESSAGE: "probe text secret",
        LINQ_API_TOKEN: "token_secret_123",
      },
    );

    expect(options.chatId).toBe("chat_secret_123");
    expect(options.confirmLiveLinq).toBe(true);
    expect(options.interactiveObservation).toBe(true);
    expect(options.observationMs).toBe(25);
    expect(options.sendMessage).toBe(true);
  });

  it("rejects raw chat id and message CLI arguments to keep live values out of argv", () => {
    expect(() =>
      readLinqTypingReproOptions(["--chat-id", "chat_secret_123"], {
        LINQ_API_TOKEN: "token_secret_123",
      }),
    ).toThrow(/Unknown argument: --chat-id/u);
    expect(() =>
      readLinqTypingReproOptions(["--message", "probe text secret"], {
        LINQ_API_TOKEN: "token_secret_123",
        LINQ_REPRO_CHAT_ID: "chat_secret_123",
      }),
    ).toThrow(/Unknown argument: --message/u);
    expect(() =>
      readLinqTypingReproOptions(["--chat-id=chat_secret_123"], {
        LINQ_API_TOKEN: "token_secret_123",
      }),
    ).toThrow(/^Unknown argument: --chat-id$/u);
    expect(() =>
      readLinqTypingReproOptions(["probe text secret"], {
        LINQ_API_TOKEN: "token_secret_123",
        LINQ_REPRO_CHAT_ID: "chat_secret_123",
      }),
    ).toThrow(/^Unknown argument: <redacted>$/u);
  });

  it("defaults the live observation window to the expected typing timeout cutoff", () => {
    const options = readLinqTypingReproOptions(["--confirm-live-linq"], {
      LINQ_API_TOKEN: "token_secret_123",
      LINQ_REPRO_CHAT_ID: "chat_secret_123",
    });

    expect(options.observationMs).toBe(5 * 60_000);
  });

  it("refuses live Linq calls without explicit confirmation", async () => {
    await expect(
      runLinqTypingRepro({
        ...createOptions(),
        confirmLiveLinq: false,
      }),
    ).rejects.toThrow(/--confirm-live-linq/u);
  });

  it("probes typing only when outbound message sending is not requested", async () => {
    const calls: ObservedFetchCall[] = [];

    const report = await runLinqTypingRepro(createOptions({
      sendMessage: false,
    }), {
      fetchImplementation: createFetchStub(calls),
      now: () => new Date("2026-04-26T00:00:00.000Z"),
      wait: async () => undefined,
    });

    expect(calls.map((call) => call.method)).toEqual(["POST", "DELETE"]);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/api/partner/v3/chats/chat_secret_123/typing",
      "/api/partner/v3/chats/chat_secret_123/typing",
    ]);
    expect(report.messageSend).toEqual({
      attempted: false,
      skippedReason: "send-message-not-requested",
    });
    expect(report.typing).toHaveLength(1);
    expect(report.typing[0]?.start.status).toBe(204);
    expect(JSON.stringify(report)).not.toContain("chat_secret_123");
    expect(JSON.stringify(report)).not.toContain("token_secret_123");
  });

  it("captures before-and-after typing evidence around a direct outbound Linq API message", async () => {
    const calls: ObservedFetchCall[] = [];
    const statuses: string[] = [];
    const observations = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const report = await runLinqTypingRepro(createOptions({
      sendMessage: true,
    }), {
      askObservation: observations,
      fetchImplementation: createFetchStub(calls),
      now: () => new Date("2026-04-26T00:00:00.000Z"),
      onStatus: (status) => {
        statuses.push(JSON.stringify(status));
      },
      wait: async () => undefined,
    });

    expect(calls.map((call) => call.method)).toEqual([
      "POST",
      "DELETE",
      "POST",
      "POST",
      "DELETE",
    ]);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/api/partner/v3/chats/chat_secret_123/typing",
      "/api/partner/v3/chats/chat_secret_123/typing",
      "/api/partner/v3/chats/chat_secret_123/messages",
      "/api/partner/v3/chats/chat_secret_123/typing",
      "/api/partner/v3/chats/chat_secret_123/typing",
    ]);
    expect(calls[2]?.body).toMatchObject({
      message: {
        parts: [
          {
            type: "text",
            value: "probe text secret",
          },
        ],
      },
    });
    expect(report.messageSend).toMatchObject({
      attempted: true,
      result: {
        ok: true,
        status: 200,
      },
    });
    expect(report.typing.map((entry) => entry.phase)).toEqual([
      "before_outbound_message",
      "after_outbound_message",
    ]);
    expect(report.observations.map((entry) => entry.sawTypingIndicator)).toEqual([
      false,
      true,
    ]);
    expect(statuses).toHaveLength(10);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("chat_secret_123");
    expect(serialized).not.toContain("msg_secret_123");
    expect(serialized).not.toContain("probe text secret");
    expect(serialized).not.toContain("token_secret_123");
    expect(JSON.stringify(statuses)).not.toContain("chat_secret_123");
    expect(JSON.stringify(statuses)).not.toContain("msg_secret_123");
    expect(JSON.stringify(statuses)).not.toContain("probe text secret");
    expect(JSON.stringify(statuses)).not.toContain("token_secret_123");
  });

  it("stops typing after a successful start when observation fails", async () => {
    const calls: ObservedFetchCall[] = [];

    await expect(
      runLinqTypingRepro(createOptions(), {
        fetchImplementation: createFetchStub(calls),
        wait: async () => {
          throw new Error("observation failed with chat_secret_123");
        },
      }),
    ).rejects.toThrow(/observation failed/u);

    expect(calls.map((call) => call.method)).toEqual(["POST", "DELETE"]);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/api/partner/v3/chats/chat_secret_123/typing",
      "/api/partner/v3/chats/chat_secret_123/typing",
    ]);
  });
});

interface ObservedFetchCall {
  body: Record<string, unknown> | null;
  method: string;
  url: string;
}

function createOptions(
  overrides: Partial<LinqTypingReproOptions> = {},
): LinqTypingReproOptions {
  return {
    apiBaseUrl: "https://linq.example.test/api/partner/v3",
    chatId: "chat_secret_123",
    confirmLiveLinq: true,
    fingerprintSecret: "fingerprint-secret",
    interactiveObservation: false,
    message: "probe text secret",
    observationMs: 1,
    postMessageDelayMs: 1,
    sendMessage: false,
    timeoutMs: 100,
    token: "token_secret_123",
    ...overrides,
  };
}

function createFetchStub(calls: ObservedFetchCall[]): typeof fetch {
  return async (input, init) => {
    const body = typeof init?.body === "string"
      ? JSON.parse(init.body) as Record<string, unknown>
      : null;
    calls.push({
      body,
      method: init?.method ?? "GET",
      url: String(input),
    });

    if (init?.method === "POST" && String(input).endsWith("/messages")) {
      return new Response(JSON.stringify({
        message: {
          id: "msg_secret_123",
        },
      }), {
        status: 200,
      });
    }

    return new Response(null, { status: 204 });
  };
}

import { afterEach, beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingLinqConfig: () => ({
    apiBaseUrl: "https://linq.example.test/api/partner/v3",
    apiToken: "linq-token",
  }),
}));

import {
  createHostedLinqChat,
  createHostedLinqWebhookSubscription,
  sendHostedLinqChatMessage,
} from "@/src/lib/hosted-onboarding/linq";

const originalFetch = globalThis.fetch;
const describe = baseDescribe.sequential;

describe("sendHostedLinqChatMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("fails with the hosted retryable error when the Linq API request hangs past the timeout", async () => {
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener(
          "abort",
          () => reject(signal.reason ?? new Error("aborted")),
          { once: true },
        );
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = sendHostedLinqChatMessage({
      chatId: "chat_123",
      message: "hello",
    });
    const expectation = expect(result).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      httpStatus: 502,
      message: "Linq outbound reply timed out.",
      retryable: true,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    await expectation;
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("chats/chat_123/messages", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("marks 5xx Linq API failures as retryable", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "",
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqChatMessage({
      chatId: "chat_123",
      message: "hello",
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      httpStatus: 502,
      message: "Linq outbound reply failed with HTTP 503.",
      retryable: true,
    });
  });

  it("treats Linq 429 responses as retryable", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => "",
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqChatMessage({
      chatId: "chat_123",
      message: "hello",
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      httpStatus: 502,
      message: "Linq outbound reply failed with HTTP 429.",
      retryable: true,
    });
  });

  it("sends Linq idempotency keys on existing-chat replies", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        chat_id: "chat_123",
        message: {
          id: "msg_123",
        },
      }),
      text: async () => "",
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await sendHostedLinqChatMessage({
      chatId: "chat_123",
      idempotencyKey: "linq-message:evt_123",
      message: "hello",
    });

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected fetch to be called");
    }
    const [url, init] = firstCall;
    expect(url).toEqual(new URL("chats/chat_123/messages", "https://linq.example.test/api/partner/v3/"));
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      message: {
        idempotency_key: "linq-message:evt_123",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
    });
  });

  it("treats an empty success body as a successful send", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqChatMessage({
      chatId: "chat_123",
      message: "hello",
    })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("createHostedLinqChat", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("posts first-contact chat creation payloads to the v3 chats endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 201,
      json: async () => ({
        chat: {
          id: "chat_123",
          message: {
            id: "msg_123",
          },
        },
      }),
      text: async () => "",
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await createHostedLinqChat({
      from: "+15550000000",
      idempotencyKey: "chat-create:evt_123",
      message: "hello",
      to: ["+15551234567"],
    });

    expect(result).toEqual({
      chatId: "chat_123",
      messageId: "msg_123",
    });
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected fetch to be called");
    }
    const [url, init] = firstCall;
    expect(url).toEqual(new URL("chats", "https://linq.example.test/api/partner/v3/"));
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      from: "+15550000000",
      message: {
        idempotency_key: "chat-create:evt_123",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      to: ["+15551234567"],
    });
  });
});

describe("createHostedLinqWebhookSubscription", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("posts webhook subscriptions to the v3 webhook-subscriptions endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 201,
      json: async () => ({
        created_at: "2026-04-04T00:00:00.000Z",
        id: "whsub_123",
        is_active: true,
        phone_numbers: ["+15550000000"],
        signing_secret: "whsec_123",
        subscribed_events: ["message.received"],
        target_url: "https://www.withmurph.ai/api/hosted-onboarding/linq/webhook?version=2026-02-03",
        updated_at: "2026-04-04T00:00:00.000Z",
      }),
      text: async () => "",
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await createHostedLinqWebhookSubscription({
      phoneNumbers: ["+15550000000"],
      subscribedEvents: ["message.received"],
      targetUrl: "https://www.withmurph.ai/api/hosted-onboarding/linq/webhook?version=2026-02-03",
    });

    expect(result).toEqual({
      createdAt: "2026-04-04T00:00:00.000Z",
      id: "whsub_123",
      isActive: true,
      phoneNumbers: ["+15550000000"],
      signingSecret: "whsec_123",
      subscribedEvents: ["message.received"],
      targetUrl: "https://www.withmurph.ai/api/hosted-onboarding/linq/webhook?version=2026-02-03",
      updatedAt: "2026-04-04T00:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("webhook-subscriptions", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        body: JSON.stringify({
          phone_numbers: ["+15550000000"],
          subscribed_events: ["message.received"],
          target_url: "https://www.withmurph.ai/api/hosted-onboarding/linq/webhook?version=2026-02-03",
        }),
        method: "POST",
      }),
    );
  });
});

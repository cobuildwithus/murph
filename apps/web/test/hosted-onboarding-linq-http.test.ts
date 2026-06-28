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
  sendHostedLinqReadReceipt,
  shareHostedLinqContactCard,
  startHostedLinqTypingIndicator,
} from "@/src/lib/hosted-onboarding/linq";

const originalFetch = globalThis.fetch;
const describe = baseDescribe.sequential;

function createJsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
    status,
  });
}

function expectRequestInit(init: RequestInit | undefined): RequestInit {
  if (!init) {
    throw new Error("Expected fetch init");
  }

  return init;
}

function readRequestSignal(init: RequestInit | undefined): AbortSignal | undefined {
  const signal = init?.signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

function readJsonRequestBody(init: RequestInit | undefined): unknown {
  const body = expectRequestInit(init).body;
  if (typeof body !== "string") {
    throw new Error("Expected string request body");
  }

  return JSON.parse(body);
}

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
        const signal = readRequestSignal(init);
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
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({}, 503);
    });
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
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({}, 429);
    });
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
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({
        chat_id: "chat_123",
        message: {
          id: "msg_123",
        },
      }, 200);
    });
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
    const [url, init] = firstCall as [RequestInfo | URL, RequestInit?];
    expect(url).toEqual(new URL("chats/chat_123/messages", "https://linq.example.test/api/partner/v3/"));
    expect(readJsonRequestBody(init)).toEqual({
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
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqChatMessage({
      chatId: "chat_123",
      message: "hello",
    })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("sendHostedLinqReadReceipt", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("posts read acknowledgements to the v3 chat read endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqReadReceipt({
      chatId: "chat_123",
      timeoutMs: 750,
    })).resolves.toEqual({
      ok: true,
      status: 204,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("chats/chat_123/read", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });
});

describe("shareHostedLinqContactCard", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("posts a no-body contact-card share request", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(shareHostedLinqContactCard({
      chatId: "chat_123",
    })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("chats/chat_123/share_contact_card", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        body: undefined,
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("treats Linq API contact-card share failures as non-retryable", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({}, 429);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(shareHostedLinqContactCard({
      chatId: "chat_123",
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      httpStatus: 502,
      message: "Linq contact-card share failed with HTTP 429.",
      retryable: false,
    });
  });
});

describe("startHostedLinqTypingIndicator", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("posts typing indicators to the v3 chat typing endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(startHostedLinqTypingIndicator({
      chatId: "chat_123",
      timeoutMs: 750,
    })).resolves.toEqual({
      ok: true,
      status: 204,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("chats/chat_123/typing", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
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
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({
        chat: {
          id: "chat_123",
          message: {
            id: "msg_123",
          },
        },
      }, 201);
    });
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
    const [url, init] = firstCall as [RequestInfo | URL, RequestInit?];
    expect(url).toEqual(new URL("chats", "https://linq.example.test/api/partner/v3/"));
    expect(expectRequestInit(init).method).toBe("POST");
    expect(readJsonRequestBody(init)).toEqual({
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
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({
        created_at: "2026-04-04T00:00:00.000Z",
        id: "whsub_123",
        is_active: true,
        phone_numbers: ["+15550000000"],
        signing_secret: "whsec_123",
        subscribed_events: ["message.received"],
        target_url: "https://www.withmurph.ai/api/hosted-onboarding/linq/webhook?version=2026-02-03",
        updated_at: "2026-04-04T00:00:00.000Z",
      }, 201);
    });
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

  it("rejects webhook subscriptions with events outside the pinned Linq SDK contract", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createHostedLinqWebhookSubscription({
      subscribedEvents: ["message.received", "unsupported.event"],
      targetUrl: "https://www.withmurph.ai/api/hosted-onboarding/linq/webhook?version=2026-02-03",
    })).rejects.toThrow("Linq subscribed event is not supported by the Linq SDK contract.");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

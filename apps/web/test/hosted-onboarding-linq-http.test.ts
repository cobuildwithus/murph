import { createServer, type Server } from "node:http";

import type { Chat } from "@linqapp/sdk/resources/chats";
import { afterEach, beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

const DEFAULT_LINQ_API_BASE_URL = "https://linq.example.test/api/partner/v3";
const linqRuntimeConfig = vi.hoisted(() => ({
  apiBaseUrl: "https://linq.example.test/api/partner/v3",
  apiToken: "linq-token",
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingLinqConfig: () => linqRuntimeConfig,
}));

import {
  deleteHostedLinqMessage,
  sendHostedLinqChatMessage,
  sendHostedLinqReadReceipt,
  shareHostedLinqContactCard,
  updateHostedLinqChatAvatar,
  updateHostedLinqChatDisplayName,
} from "@/src/lib/hosted-onboarding/linq";
import {
  getHostedLinqChatSummary,
  getHostedLinqReactionTargetMessage,
} from "@/src/lib/hosted-onboarding/linq-client";
import { createHostedLinqTextPartDigest } from "@/src/lib/hosted-onboarding/linq-message-digest";

const originalFetch = globalThis.fetch;
const describe = baseDescribe.sequential;

beforeEach(() => {
  linqRuntimeConfig.apiBaseUrl = DEFAULT_LINQ_API_BASE_URL;
});

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

function createCanonicalLinqChat(isGroup: boolean): Chat {
  return {
    created_at: "2026-07-10T00:00:00.000Z",
    display_name: null,
    handles: [
      {
        handle: "+15550000000",
        id: "handle_me",
        is_me: true,
        joined_at: "2026-07-10T00:00:00.000Z",
        service: "iMessage",
        status: "active",
      },
    ],
    health_status: {
      doc_url: "https://docs.linqapp.com/guides/chats/chat-health",
      status: "HEALTHY",
      updated_at: "2026-07-10T00:00:00.000Z",
    },
    id: "chat_123",
    is_archived: false,
    is_group: isGroup,
    service: "iMessage",
    updated_at: "2026-07-10T00:00:00.000Z",
  };
}

async function listenOnLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a loopback TCP server address.");
  }
  return `http://127.0.0.1:${address.port}/api/partner/v3`;
}

async function closeTestServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe("getHostedLinqChatSummary", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("reads top-level canonical group directness from the chat endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse(createCanonicalLinqChat(true), 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHostedLinqChatSummary({
      chatId: "chat_123",
      timeoutMs: 1_500,
    })).resolves.toEqual({
      handles: [
        {
          handle: "+15550000000",
          isMe: true,
          status: "active",
        },
      ],
      isGroup: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("chats/chat_123", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        method: "GET",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("reads top-level canonical direct-chat directness from the chat endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      createJsonResponse(createCanonicalLinqChat(false), 200)
    ));

    await expect(getHostedLinqChatSummary({
      chatId: "chat_123",
      timeoutMs: 1_500,
    })).resolves.toMatchObject({
      isGroup: false,
    });
  });

  it.each([401, 403, 422])("retries an unexpected chat-read HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({}, status)));

    await expect(getHostedLinqChatSummary({
      chatId: "chat_123",
      timeoutMs: 1_500,
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      retryable: true,
    });
  });

  it.each([404, 410])("treats a missing chat-read HTTP %s as permanent", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({}, status)));

    await expect(getHostedLinqChatSummary({
      chatId: "missing_chat",
      timeoutMs: 1_500,
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      retryable: false,
    });
  });

  it.each([
    {
      label: "nested webhook-style truth",
      payload: {
        chat: createCanonicalLinqChat(true),
      },
    },
    {
      label: "malformed top-level truth",
      payload: {
        ...createCanonicalLinqChat(true),
        is_group: "true",
      },
    },
  ])("rejects $label as a canonical chat-read response", async ({ payload }) => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse(payload, 200)));

    await expect(getHostedLinqChatSummary({
      chatId: "chat_123",
      timeoutMs: 1_500,
    })).resolves.toEqual({
      handles: [],
      isGroup: null,
    });
  });

  it("keeps the chat-read deadline active through a stalled response body", async () => {
    let connectionClosed = false;
    const server = createServer((_request, response) => {
      response.on("close", () => {
        connectionClosed = true;
      });
      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.flushHeaders();
      response.write('{"is_group":');
    });
    linqRuntimeConfig.apiBaseUrl = await listenOnLoopback(server);

    try {
      const startedAt = performance.now();
      await expect(getHostedLinqChatSummary({
        chatId: "chat_123",
        timeoutMs: 75,
      })).rejects.toMatchObject({
        code: "LINQ_SEND_FAILED",
        httpStatus: 502,
        message: "Linq chat read timed out.",
        retryable: true,
      });
      expect(performance.now() - startedAt).toBeLessThan(1_500);
      await vi.waitFor(() => {
        expect(connectionClosed).toBe(true);
      });
    } finally {
      await closeTestServer(server);
    }
  });

  it("preserves caller cancellation while reading a stalled response body", async () => {
    let headersFlushed: (() => void) | null = null;
    const didFlushHeaders = new Promise<void>((resolve) => {
      headersFlushed = resolve;
    });
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.flushHeaders();
      response.write('{"is_group":');
      headersFlushed?.();
    });
    linqRuntimeConfig.apiBaseUrl = await listenOnLoopback(server);
    const controller = new AbortController();
    const abortReason = new Error("caller cancelled chat read");

    try {
      const result = getHostedLinqChatSummary({
        chatId: "chat_123",
        signal: controller.signal,
        timeoutMs: 5_000,
      });
      await didFlushHeaders;
      controller.abort(abortReason);
      await expect(result).rejects.toBe(abortReason);
    } finally {
      await closeTestServer(server);
    }
  });
});

describe("getHostedLinqReactionTargetMessage", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }
    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("reads canonical message parts without carrying media download URLs", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({
      chat_id: "chat_123",
      id: "message_123",
      is_from_me: false,
      parts: [
        { reactions: null, type: "text", value: "The exact target text" },
        {
          filename: "photo.jpg",
          id: "attachment_123",
          mime_type: "image/jpeg",
          reactions: null,
          size_bytes: 123,
          type: "media",
          url: "https://private.example.test/download-token",
        },
      ],
      service: "iMessage",
    }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHostedLinqReactionTargetMessage({
      messageId: "message_123",
    })).resolves.toEqual({
      chatId: "chat_123",
      id: "message_123",
      isFromMe: false,
      parts: [
        {
          type: "text",
          value: "The exact target text",
          valueDigest: createHostedLinqTextPartDigest("The exact target text"),
        },
        { fileName: "photo.jpg", mimeType: "image/jpeg", type: "media" },
      ],
      service: "iMessage",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("messages/message_123", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("digests the full provider text before bounding reaction context", async () => {
    const fullText = "x".repeat(2_100);
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({
      chat_id: "chat_123",
      id: "message_123",
      is_from_me: true,
      parts: [{ type: "text", value: fullText }],
      service: "iMessage",
    }, 200)));

    await expect(getHostedLinqReactionTargetMessage({
      messageId: "message_123",
    })).resolves.toMatchObject({
      parts: [{
        type: "text",
        value: "x".repeat(2_000),
        valueDigest: createHostedLinqTextPartDigest(fullText),
      }],
    });
  });

  it.each([404, 410])("marks a missing target HTTP %s as a permanent provider read failure", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({}, status)));

    await expect(getHostedLinqReactionTargetMessage({
      messageId: "missing_message",
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      retryable: false,
    });
  });

  it.each([401, 403, 422])("retries an unexpected message-read HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({}, status)));

    await expect(getHostedLinqReactionTargetMessage({
      messageId: "message_123",
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      retryable: true,
    });
  });

  it("retries a malformed successful message read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({
      id: "message_123",
    }, 200)));

    await expect(getHostedLinqReactionTargetMessage({
      messageId: "message_123",
    })).rejects.toMatchObject({
      code: "LINQ_MESSAGE_READ_INVALID",
      retryable: true,
    });
  });

  it("accepts a canonical message with no parts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({
      chat_id: "chat_123",
      id: "message_123",
      is_from_me: false,
      parts: null,
      service: "iMessage",
    }, 200)));

    await expect(getHostedLinqReactionTargetMessage({
      messageId: "message_123",
    })).resolves.toEqual({
      chatId: "chat_123",
      id: "message_123",
      isFromMe: false,
      parts: [],
      service: "iMessage",
    });
  });
});

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

  it("sends existing-chat messages without provider-native reply anchors", async () => {
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
      replyToMessageId: "msg_parent_123",
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
    })).resolves.toEqual({
      chatId: null,
      messageId: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("deleteHostedLinqMessage", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }
    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("deletes the exact provider message", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteHostedLinqMessage({
      messageId: "msg_unbound_offer_1",
    })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("messages/msg_unbound_offer_1", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("treats an already-missing provider message as deleted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({}, 404)));

    await expect(deleteHostedLinqMessage({
      messageId: "msg_missing_offer_1",
    })).resolves.toBeUndefined();
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

describe("updateHostedLinqChatAvatar", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("updates a chat with the SDK-backed group icon field", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({ status: "pending" }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateHostedLinqChatAvatar({
      chatId: "chat_123",
      groupChatIconUrl: "https://imagedelivery.net/account/avatar/public",
    })).resolves.toBeUndefined();

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected fetch to be called");
    }
    const [url, init] = firstCall as [RequestInfo | URL, RequestInit?];
    expect(url).toEqual(new URL("chats/chat_123", "https://linq.example.test/api/partner/v3/"));
    expect(expectRequestInit(init).method).toBe("PUT");
    expect(readJsonRequestBody(init)).toEqual({
      group_chat_icon: "https://imagedelivery.net/account/avatar/public",
    });
  });

  it("rejects non-HTTPS icon URLs before calling Linq", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateHostedLinqChatAvatar({
      chatId: "chat_123",
      groupChatIconUrl: "http://example.com/avatar.png",
    })).rejects.toThrow(/HTTPS URL/u);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-hosted icon URLs before calling Linq", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateHostedLinqChatAvatar({
      chatId: "chat_123",
      groupChatIconUrl: "https://example.com/avatar.png",
    })).rejects.toThrow(/hosted Cloudflare Images URL/u);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("updateHostedLinqChatDisplayName", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("updates a chat with the SDK-backed display name field", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({ status: "pending" }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateHostedLinqChatDisplayName({
      chatId: "chat_123",
      displayName: "  Weekly   Health Crew  ",
    })).resolves.toBeUndefined();

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected fetch to be called");
    }
    const [url, init] = firstCall as [RequestInfo | URL, RequestInit?];
    expect(url).toEqual(new URL("chats/chat_123", "https://linq.example.test/api/partner/v3/"));
    expect(expectRequestInit(init).method).toBe("PUT");
    expect(readJsonRequestBody(init)).toEqual({
      display_name: "Weekly Health Crew",
    });
  });

  it("rejects blank display names before calling Linq", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateHostedLinqChatDisplayName({
      chatId: "chat_123",
      displayName: " ",
    })).rejects.toThrow(/display name is required/u);

    expect(fetchMock).not.toHaveBeenCalled();
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

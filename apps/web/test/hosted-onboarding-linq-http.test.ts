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
  sendHostedLinqChatMessage,
  sendHostedLinqReadReceipt,
  updateHostedLinqChatAvatar,
  updateHostedLinqChatDisplayName,
} from "@/src/lib/hosted-onboarding/linq";
import {
  createHostedLinqChat,
  getHostedLinqChatSummary,
  getHostedLinqReactionTargetMessage,
  sendHostedLinqReactionBoundChatMessage,
  shareHostedLinqContactCard,
  startHostedLinqChatTypingIndicator,
} from "@/src/lib/hosted-onboarding/linq-client";

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

  it("reads top-level canonical group metadata from the chat endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return createJsonResponse({
        ...createCanonicalLinqChat(true),
        display_name: "Weekend Warriors",
      }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHostedLinqChatSummary({
      chatId: "chat_123",
      timeoutMs: 1_500,
    })).resolves.toEqual({
      displayName: "Weekend Warriors",
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
      displayName: null,
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

  it("reads the exact canonical message and keeps only bounded reaction context", async () => {
    const privateUrl = "https://media.example.test/private-attachment";
    const privateTextUrl = "https://example.test/private-token";
    const otherUrlForms = [
      "cid:private-content@example.test",
      "magnet:?xt=urn:btih:private-token",
      "mailto:person@example.test?body=secret",
      "data:text/plain,private",
      "custom+app://private/path",
      "www.example.test/private-token",
      "example.test/private-token",
      "192.0.2.1/private-token",
      "xmpp:person@example.test?message",
    ];
    const fetchMock = vi.fn(async () => createJsonResponse({
      chat_id: "chat_123",
      id: "msg_123",
      parts: [
        {
          type: "text",
          value: `HRV:42 Dose:5mg Status:better See ${privateTextUrl} ${otherUrlForms.join(" ")} ${"x".repeat(600)}`,
        },
        {
          file_name: "private-name.pdf",
          mime_type: "application/pdf",
          type: "media",
          url: privateUrl,
        },
        {
          type: "link",
          url: "https://example.test/private-path",
        },
        {
          app_name: "Private app",
          type: "imessage_app",
        },
        ...Array.from({ length: 36 }, (_, index) => ({
          type: "text",
          value: `part-${index}`,
        })),
      ],
    }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const message = await getHostedLinqReactionTargetMessage({
      messageId: "msg_123",
    });

    expect(message).toMatchObject({
      chatId: "chat_123",
      id: "msg_123",
    });
    expect(message.parts).toHaveLength(32);
    expect(message.parts[0]).toMatch(
      /^HRV:42 Dose:5mg Status:better See \[link\] /u,
    );
    expect(message.parts[0]?.length).toBeLessThanOrEqual(512);
    expect(message.parts.slice(1, 4)).toEqual([
      "[attachment]",
      "[link]",
      "[iMessage app]",
    ]);
    expect(JSON.stringify(message)).not.toContain(privateUrl);
    expect(JSON.stringify(message)).not.toContain(privateTextUrl);
    for (const url of otherUrlForms) {
      expect(JSON.stringify(message)).not.toContain(url);
    }
    expect(JSON.stringify(message)).not.toContain("private-name.pdf");
    expect(JSON.stringify(message)).not.toContain("application/pdf");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("messages/msg_123", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        method: "GET",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects malformed canonical message responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({
      chat_id: "chat_123",
      id: "msg_123",
      parts: { type: "text", value: "not an array" },
    }, 200)));

    await expect(getHostedLinqReactionTargetMessage({
      messageId: "msg_123",
    })).rejects.toMatchObject({
      code: "LINQ_MESSAGE_READ_INVALID",
      httpStatus: 502,
      retryable: false,
    });
  });

  it("bounds URL scrubbing work before scanning adversarial dotted text", async () => {
    const longDottedText = `${"a.".repeat(50_000)}1`;
    const shortDottedText = `${"a.".repeat(1_024)}1`;
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({
      chat_id: "chat_123",
      id: "msg_123",
      parts: [
        { type: "text", value: longDottedText },
        ...Array.from({ length: 31 }, () => ({
          type: "text",
          value: shortDottedText,
        })),
      ],
    }, 200)));

    const startedAt = performance.now();
    const message = await getHostedLinqReactionTargetMessage({
      messageId: "msg_123",
    });
    const elapsedMs = performance.now() - startedAt;

    expect(message.parts).toHaveLength(32);
    expect(message.parts.every((part) => part.length <= 512)).toBe(true);
    expect(elapsedMs).toBeLessThan(1_000);
  });
});

describe("createHostedLinqChat", () => {
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

  it("uses caller-supplied text before a rich-link follow-up", async () => {
    const requests: Array<{ body: unknown; url: RequestInfo | URL }> = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ body: readJsonRequestBody(init), url });
      if (requests.length === 1) {
        return createJsonResponse({
          chat: {
            id: "chat_created",
            message: { id: "msg_text" },
          },
        }, 200);
      }
      return createJsonResponse({
        chat_id: "chat_created",
        message: { id: "msg_link" },
      }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createHostedLinqChat({
      from: "+15550000000",
      idempotencyKey: "create-123",
      message: "Your secure payment link:\nhttps://pay.example.test/checkout/session_123",
      to: ["+15550000001"],
    })).resolves.toEqual({
      chatId: "chat_created",
      messageId: "msg_link",
      providerMessageIds: ["msg_text", "msg_link"],
    });

    expect(requests).toEqual([
      {
        body: {
          from: "+15550000000",
          message: {
            idempotency_key: "create-123",
            parts: [{
              type: "text",
              value: "Your secure payment link:",
            }],
          },
          to: ["+15550000001"],
        },
        url: new URL("chats", "https://linq.example.test/api/partner/v3/"),
      },
      {
        body: {
          message: {
            idempotency_key: "create-123:link",
            parts: [{
              type: "link",
              value: "https://pay.example.test/checkout/session_123",
            }],
          },
        },
        url: new URL(
          "chats/chat_created/messages",
          "https://linq.example.test/api/partner/v3/",
        ),
      },
    ]);
  });

  it.each([
    {
      expectedMessageId: "msg_text",
      expectedMessageIds: ["msg_text"],
      label: "only the primary message id",
      linkMessageId: null,
      primaryMessageId: "msg_text",
    },
    {
      expectedMessageId: "msg_duplicate",
      expectedMessageIds: ["msg_duplicate"],
      label: "the same id for both messages",
      linkMessageId: "msg_duplicate",
      primaryMessageId: "msg_duplicate",
    },
  ])(
    "keeps a two-part new-chat delivery terminal when Linq returns $label",
    async ({
      expectedMessageId,
      expectedMessageIds,
      linkMessageId,
      primaryMessageId,
    }) => {
      const requestBodies: unknown[] = [];
      let requestCount = 0;
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          requestBodies.push(readJsonRequestBody(init));
          requestCount += 1;
          if (requestCount === 1) {
            return createJsonResponse({
              chat: {
                id: "chat_created",
                message: primaryMessageId ? { id: primaryMessageId } : {},
              },
            }, 200);
          }
          return createJsonResponse({
            chat_id: "chat_created",
            message: linkMessageId ? { id: linkMessageId } : {},
          }, 200);
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(createHostedLinqChat({
        from: "+15550000000",
        idempotencyKey: "create-123",
        message:
          "Your secure payment link:\nhttps://pay.example.test/checkout/session_123",
        to: ["+15550000001"],
      })).rejects.toMatchObject({
        code: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        deliveryMayHaveSucceeded: true,
        expectedProviderMessageCount: 2,
        providerMessageId: expectedMessageId,
        providerMessageIds: expectedMessageIds,
        providerThreadId: "chat_created",
        retryable: false,
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(requestBodies[1]).toEqual({
        message: {
          idempotency_key: "create-123:link",
          parts: [{
            type: "link",
            value: "https://pay.example.test/checkout/session_123",
          }],
        },
      });
    },
  );

  it.each([
    ["a link identity", "msg_link"],
    ["no later identity", null],
  ])(
    "does not issue a new-chat rich-link request when the primary response has no identity, even with %s",
    async (_label, linkMessageId) => {
      const requestBodies: unknown[] = [];
      let requestCount = 0;
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          requestBodies.push(readJsonRequestBody(init));
          requestCount += 1;
          if (requestCount === 1) {
            return createJsonResponse({
              chat: {
                id: "chat_created",
                message: {},
              },
            }, 200);
          }
          return createJsonResponse({
            chat_id: "chat_created",
            message: linkMessageId ? { id: linkMessageId } : {},
          }, 200);
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(createHostedLinqChat({
        from: "+15550000000",
        idempotencyKey: "create-123",
        message:
          "Your secure payment link:\nhttps://pay.example.test/checkout/session_123",
        to: ["+15550000001"],
      })).rejects.toMatchObject({
        code: "LINQ_SEND_FAILED",
        deliveryMayHaveSucceeded: true,
        retryable: true,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requestBodies).toHaveLength(1);
    },
  );

  it("never fabricates text for a link-only new chat", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createHostedLinqChat({
      from: "+15550000000",
      message: "https://pay.example.test/checkout/session_123",
      to: ["+15550000001"],
    })).rejects.toThrow(
      "A new Linq chat with a rich link must include caller-supplied text.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses multiple new-chat URLs before provider entry", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createHostedLinqChat({
      from: "+15550000000",
      message:
        "Use https://first.example.test or https://pay.example.test/checkout/session_123",
      to: ["+15550000001"],
    })).rejects.toThrow(
      "A new Linq chat cannot include URL text in its first message.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes a missing created-chat id retryable without a link send", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({
      chat: {
        message: { id: "msg_text" },
      },
    }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createHostedLinqChat({
      from: "+15550000000",
      message: "Your secure payment link:\nhttps://pay.example.test/checkout/session_123",
      to: ["+15550000001"],
    })).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      httpStatus: 502,
      message: expect.stringContaining("missing a chat id"),
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2])(
    "bounds stalled create-chat request %i to five seconds",
    async (stalledRequest) => {
      let requestCount = 0;
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestCount += 1;
        if (requestCount === stalledRequest) {
          return new Promise<Response>((_resolve, reject) => {
            const signal = readRequestSignal(init);
            signal?.addEventListener(
              "abort",
              () => reject(signal.reason ?? new Error("aborted")),
              { once: true },
            );
          });
        }
        return createJsonResponse({
          chat: {
            id: "chat_created",
            message: { id: "msg_text" },
          },
        }, 200);
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = createHostedLinqChat({
        from: "+15550000000",
        message: "Your secure payment link:\nhttps://pay.example.test/checkout/session_123",
        to: ["+15550000001"],
      });
      const expectation = stalledRequest === 1
        ? expect(result).rejects.toMatchObject({
            code: "LINQ_SEND_FAILED",
            message: "Linq chat create timed out.",
            retryable: true,
          })
        : expect(result).rejects.toMatchObject({
            code: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
            deliveryMayHaveSucceeded: true,
            message:
              "Linq rich-link delivery could not confirm both provider messages after the primary request was accepted; deterministic recovery must reuse the same provider keys.",
            providerMessageIds: ["msg_text"],
            retryable: false,
          });

      await vi.advanceTimersByTimeAsync(5_000);

      await expectation;
      expect(fetchMock).toHaveBeenCalledTimes(stalledRequest === 1 ? 1 : 3);
    },
  );
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

  it("keeps the outbound deadline active through a stalled response body", async () => {
    let bodyAborted = false;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const signal = readRequestSignal(init);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => {
            bodyAborted = true;
            controller.error(signal.reason ?? new Error("aborted"));
          }, { once: true });
        },
      });
      return new Response(body, {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });
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
    expect(bodyAborted).toBe(true);
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

  it("sends a terminal payment URL after its caller-supplied text", async () => {
    const requestBodies: unknown[] = [];
    let requestCount = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(readJsonRequestBody(init));
      requestCount += 1;
      return createJsonResponse({
        chat_id: "chat_123",
        message: {
          id: requestCount === 1 ? "msg_text" : "msg_link",
        },
      }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqChatMessage({
      chatId: "chat_123",
      idempotencyKey: "payment-message:evt_123",
      message: "Complete payment here:\nhttps://pay.example.test/checkout/session_123",
      replyToMessageId: "msg_parent_123",
    })).resolves.toEqual({
      chatId: "chat_123",
      messageId: "msg_link",
      providerMessageIds: ["msg_text", "msg_link"],
    });

    expect(requestBodies).toEqual([
      {
        message: {
          idempotency_key: "payment-message:evt_123",
          parts: [{
            type: "text",
            value: "Complete payment here:",
          }],
        },
      },
      {
        message: {
          idempotency_key: "payment-message:evt_123:link",
          parts: [{
            type: "link",
            value: "https://pay.example.test/checkout/session_123",
          }],
        },
      },
    ]);
  });

  it("replays a rich-link partial through the same provider idempotency keys", async () => {
    const requestBodies: unknown[] = [];
    const providerMessageIds = ["msg_text", "msg_link"];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBodies.push(readJsonRequestBody(init));
        return createJsonResponse({
          chat_id: "chat_123",
          message: {
            id: providerMessageIds[(requestBodies.length - 1) % 2],
          },
        }, 200);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const sendInput = {
      chatId: "chat_123",
      idempotencyKey: "payment-message:evt_123",
      message:
        "Complete payment here:\nhttps://pay.example.test/checkout/session_123",
    };
    const expectedResult = {
      chatId: "chat_123",
      messageId: "msg_link",
      providerMessageIds,
    };

    await expect(sendHostedLinqChatMessage(sendInput)).resolves.toEqual(
      expectedResult,
    );
    await expect(sendHostedLinqChatMessage(sendInput)).resolves.toEqual(
      expectedResult,
    );

    const expectedRequests = [
      {
        message: {
          idempotency_key: "payment-message:evt_123",
          parts: [{
            type: "text",
            value: "Complete payment here:",
          }],
        },
      },
      {
        message: {
          idempotency_key: "payment-message:evt_123:link",
          parts: [{
            type: "link",
            value: "https://pay.example.test/checkout/session_123",
          }],
        },
      },
    ];
    expect(requestBodies).toEqual([
      ...expectedRequests,
      ...expectedRequests,
    ]);
  });

  it("keeps a reaction-bound consent prompt and its terminal link in one text message", async () => {
    const requestBodies: unknown[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(readJsonRequestBody(init));
      return createJsonResponse({
        chat_id: "chat_123",
        message: { id: "msg_consent" },
      }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqReactionBoundChatMessage({
      chatId: "chat_123",
      idempotencyKey: "group-offer:evt_123",
      message: "React to share the selected data, or customize at https://app.example.test/join/code.",
    })).resolves.toEqual({
      chatId: "chat_123",
      messageId: "msg_consent",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBodies).toEqual([{
      message: {
        idempotency_key: "group-offer:evt_123",
        parts: [{
          type: "text",
          value: "React to share the selected data, or customize at https://app.example.test/join/code.",
        }],
      },
    }]);
  });

  it.each([
    {
      expectedMessageId: "msg_text",
      expectedMessageIds: ["msg_text"],
      label: "only the primary message id",
      linkMessageId: null,
      primaryMessageId: "msg_text",
    },
    {
      expectedMessageId: "msg_duplicate",
      expectedMessageIds: ["msg_duplicate"],
      label: "the same id for both messages",
      linkMessageId: "msg_duplicate",
      primaryMessageId: "msg_duplicate",
    },
  ])(
    "keeps a two-part existing-chat delivery terminal when Linq returns $label",
    async ({
      expectedMessageId,
      expectedMessageIds,
      linkMessageId,
      primaryMessageId,
    }) => {
      const requestBodies: unknown[] = [];
      let requestCount = 0;
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          requestBodies.push(readJsonRequestBody(init));
          requestCount += 1;
          return createJsonResponse({
            chat_id: "chat_123",
            message: requestCount === 1
              ? primaryMessageId
                ? { id: primaryMessageId }
                : {}
              : linkMessageId
                ? { id: linkMessageId }
                : {},
          }, 200);
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(sendHostedLinqChatMessage({
        chatId: "chat_123",
        idempotencyKey: "payment-message:evt_123",
        message:
          "Complete payment here:\nhttps://pay.example.test/checkout/session_123",
      })).rejects.toMatchObject({
        code: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
        deliveryMayHaveSucceeded: true,
        expectedProviderMessageCount: 2,
        providerMessageId: expectedMessageId,
        providerMessageIds: expectedMessageIds,
        providerThreadId: "chat_123",
        retryable: false,
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(requestBodies[1]).toEqual({
        message: {
          idempotency_key: "payment-message:evt_123:link",
          parts: [{
            type: "link",
            value: "https://pay.example.test/checkout/session_123",
          }],
        },
      });
    },
  );

  it.each([
    ["a link identity", "msg_link"],
    ["no later identity", null],
  ])(
    "does not issue an existing-chat rich-link request when the primary response has no identity, even with %s",
    async (_label, linkMessageId) => {
      const requestBodies: unknown[] = [];
      let requestCount = 0;
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          requestBodies.push(readJsonRequestBody(init));
          requestCount += 1;
          return createJsonResponse({
            chat_id: "chat_123",
            message: requestCount === 1
              ? {}
              : linkMessageId
                ? { id: linkMessageId }
                : {},
          }, 200);
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(sendHostedLinqChatMessage({
        chatId: "chat_123",
        idempotencyKey: "payment-message:evt_123",
        message:
          "Complete payment here:\nhttps://pay.example.test/checkout/session_123",
      })).rejects.toMatchObject({
        code: "LINQ_SEND_FAILED",
        deliveryMayHaveSucceeded: true,
        retryable: true,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requestBodies).toHaveLength(1);
    },
  );

  it("retries an identity-less primary with the same key before issuing the link", async () => {
    const requestBodies: unknown[] = [];
    let primaryAttemptCount = 0;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = readJsonRequestBody(init) as {
          message?: { parts?: Array<{ type?: string }> };
        };
        requestBodies.push(body);
        if (body.message?.parts?.[0]?.type === "link") {
          return createJsonResponse({
            chat_id: "chat_123",
            message: { id: "msg_link" },
          }, 200);
        }
        primaryAttemptCount += 1;
        return createJsonResponse({
          chat_id: "chat_123",
          message: primaryAttemptCount === 1 ? {} : { id: "msg_text" },
        }, 200);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      chatId: "chat_123",
      idempotencyKey: "payment-message:evt_123",
      message:
        "Complete payment here:\nhttps://pay.example.test/checkout/session_123",
    };

    await expect(sendHostedLinqChatMessage(input)).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      deliveryMayHaveSucceeded: true,
    });
    await expect(sendHostedLinqChatMessage(input)).resolves.toMatchObject({
      providerMessageIds: ["msg_text", "msg_link"],
    });

    expect(requestBodies.map((body) => (
      body as { message?: { idempotency_key?: string } }
    ).message?.idempotency_key)).toEqual([
      "payment-message:evt_123",
      "payment-message:evt_123",
      "payment-message:evt_123:link",
    ]);
  });

  it("reconciles a lost rich-link acknowledgment with the same provider key", async () => {
    const requestBodies: unknown[] = [];
    let requestCount = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(readJsonRequestBody(init));
      requestCount += 1;
      if (requestCount === 2) {
        return createJsonResponse({}, 503);
      }
      return createJsonResponse({
        chat_id: "chat_123",
        message: {
          id: requestCount === 1 ? "msg_text" : "msg_link",
        },
      }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqChatMessage({
      chatId: "chat_123",
      idempotencyKey: "payment-message:evt_123",
      message: "Complete payment here:\nhttps://pay.example.test/checkout/session_123",
    })).resolves.toMatchObject({
      messageId: "msg_link",
      providerMessageIds: ["msg_text", "msg_link"],
    });
    expect(requestBodies.slice(1)).toEqual([
      {
        message: {
          idempotency_key: "payment-message:evt_123:link",
          parts: [{
            type: "link",
            value: "https://pay.example.test/checkout/session_123",
          }],
        },
      },
      {
        message: {
          idempotency_key: "payment-message:evt_123:link",
          parts: [{
            type: "link",
            value: "https://pay.example.test/checkout/session_123",
          }],
        },
      },
    ]);
  });

  it("falls back to URL text after a definitive rich-link rejection", async () => {
    const requestBodies: unknown[] = [];
    let requestCount = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(readJsonRequestBody(init));
      requestCount += 1;
      if (requestCount === 2) {
        return createJsonResponse({}, 400);
      }
      return createJsonResponse({
        chat_id: "chat_123",
        message: {
          id: requestCount === 1 ? "msg_text" : "msg_fallback",
        },
      }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      chatId: "chat_123",
      idempotencyKey: "payment-message:evt_123",
      message: "Complete payment here:\nhttps://pay.example.test/checkout/session_123",
    };
    await expect(sendHostedLinqChatMessage(input)).resolves.toMatchObject({
      messageId: "msg_fallback",
      providerMessageIds: ["msg_text", "msg_fallback"],
    });

    expect(requestBodies.map((body) =>
      (body as { message: { idempotency_key: string } }).message.idempotency_key
    )).toEqual([
      "payment-message:evt_123",
      "payment-message:evt_123:link",
      "payment-message:evt_123:link:fallback",
    ]);
    expect(requestBodies[2]).toEqual({
      message: {
        idempotency_key: "payment-message:evt_123:link:fallback",
        parts: [{
          type: "text",
          value: "https://pay.example.test/checkout/session_123",
        }],
      },
    });
  });

  it.each([1, 2])(
    "bounds stalled existing-chat request %i to five seconds",
    async (stalledRequest) => {
      let requestCount = 0;
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestCount += 1;
        if (requestCount === stalledRequest) {
          return new Promise<Response>((_resolve, reject) => {
            const signal = readRequestSignal(init);
            signal?.addEventListener(
              "abort",
              () => reject(signal.reason ?? new Error("aborted")),
              { once: true },
            );
          });
        }
        return createJsonResponse({
          chat_id: "chat_123",
          message: { id: "msg_text" },
        }, 200);
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = sendHostedLinqChatMessage({
        chatId: "chat_123",
        idempotencyKey: "payment-message:evt_123",
        message:
          "Complete payment here:\nhttps://pay.example.test/checkout/session_123",
      });
      const expectation = stalledRequest === 1
        ? expect(result).rejects.toMatchObject({
            code: "LINQ_SEND_FAILED",
            message: "Linq outbound reply timed out.",
            retryable: true,
          })
        : expect(result).rejects.toMatchObject({
            code: "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY",
            deliveryMayHaveSucceeded: true,
            message:
              "Linq rich-link delivery could not confirm both provider messages after the primary request was accepted; deterministic recovery must reuse the same provider keys.",
            providerMessageIds: ["msg_text"],
            retryable: false,
          });

      await vi.advanceTimersByTimeAsync(5_000);

      await expectation;
      expect(fetchMock).toHaveBeenCalledTimes(stalledRequest === 1 ? 1 : 3);
    },
  );

  it("sends a link-only payment URL without adding text", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return createJsonResponse({
        chat_id: "chat_123",
        message: { id: "msg_link" },
      }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendHostedLinqChatMessage({
      chatId: "chat_123",
      idempotencyKey: "payment-message:evt_123",
      message: "https://pay.example.test/checkout/session_123",
    })).resolves.toEqual({
      chatId: "chat_123",
      messageId: "msg_link",
    });

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(readJsonRequestBody(firstCall?.[1])).toEqual({
      message: {
        idempotency_key: "payment-message:evt_123",
        parts: [{
          type: "link",
          value: "https://pay.example.test/checkout/session_123",
        }],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves an uppercase HTTPS token at the hosted provider boundary", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return createJsonResponse({
          chat_id: "chat_123",
          message: { id: "msg_link" },
        }, 200);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendHostedLinqChatMessage({
      chatId: "chat_123",
      message: "HTTPS://PAY.EXAMPLE.TEST/checkout/session_123",
    });

    expect(readJsonRequestBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      message: {
        parts: [{
          type: "link",
          value: "HTTPS://PAY.EXAMPLE.TEST/checkout/session_123",
        }],
      },
    });
  });

  it("keeps a reaction-bound group offer in one text message", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return createJsonResponse({
        chat_id: "chat_123",
        message: {
          created_at: "2026-07-31T12:01:02Z",
          id: "msg_offer",
        },
      }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);
    const message =
      "Sounds good. Like or heart this message to share your Murph profile name with the group, or use https://www.withmurph.ai/groups/join/abc123 to customize what you share.";

    await expect(sendHostedLinqChatMessage({
      chatId: "chat_123",
      idempotencyKey: "group-join-offer:123",
      message,
    })).resolves.toEqual({
      chatId: "chat_123",
      messageCreatedAt: "2026-07-31T12:01:02.000Z",
      messageId: "msg_offer",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readJsonRequestBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      message: {
        idempotency_key: "group-join-offer:123",
        parts: [{
          type: "text",
          value: message,
        }],
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

describe("startHostedLinqChatTypingIndicator", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("posts typing starts to the v3 chat typing endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(startHostedLinqChatTypingIndicator({
      chatId: "chat_123",
      timeoutMs: 2_500,
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

describe("shareHostedLinqContactCard", () => {
  afterEach(() => {
    if (originalFetch) {
      vi.stubGlobal("fetch", originalFetch);
      return;
    }

    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("posts the sending line's configured contact card without a request body", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(shareHostedLinqContactCard({
      chatId: "chat_123",
    })).resolves.toBeUndefined();

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected fetch to be called");
    }
    const [url, init] = firstCall as [RequestInfo | URL, RequestInit?];
    expect(url).toEqual(
      new URL(
        "chats/chat_123/share_contact_card",
        "https://linq.example.test/api/partner/v3/",
      ),
    );
    expect(expectRequestInit(init).method).toBe("POST");
    expect(expectRequestInit(init).body).toBeUndefined();
  });
});

describe("updateHostedLinqChatAvatar", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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
      groupChatIconUrl:
        `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`,
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
      group_chat_icon:
        `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`,
    });
  });

  it("can time out after Linq returns a successful response with a stalled body", async () => {
    vi.useFakeTimers();
    let bodyAborted = false;
    let putStarted = false;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      putStarted = true;
      const signal = readRequestSignal(init);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => {
            bodyAborted = true;
            controller.error(signal.reason ?? new Error("aborted"));
          }, { once: true });
        },
      });
      return new Response(body, {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = updateHostedLinqChatAvatar({
      chatId: "chat_123",
      groupChatIconUrl:
        `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`,
    });
    const expectation = expect(result).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      httpStatus: 502,
      message: "Linq chat avatar update timed out.",
      retryable: true,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    await expectation;
    expect(putStarted).toBe(true);
    expect(bodyAborted).toBe(true);
  });

  it("preserves an allowlisted Linq error code without provider prose", async () => {
    const privateUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`;
    const privatePhone = "15550001111";
    const privateEmail = "member@example.test";
    const privateChatId = "550e8400-e29b-41d4-a716-446655440000";
    const privateGroupChatId = "room-12345";
    const privateParticipantId = "participant-67890";
    const traceId = "0123456789abcdef0123456789abcdef";
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({
      error: {
        code: 5006,
        doc_url: "https://docs.linqapp.com/error/codes/5xxx/5006/",
        message:
          `Participant ${privatePhone} failed for ${privateUrl}; chat_id=${privateChatId}; group_chat_id=${privateGroupChatId}; participant_id=${privateParticipantId}; email=${privateEmail}; trace_id=${traceId}; authorization: Basic dXNlcjpwYXNz`,
        status: 400,
      },
      success: false,
      trace_id: traceId,
    }, 400)));

    const error = await updateHostedLinqChatAvatar({
      chatId: "chat_123",
      groupChatIconUrl: privateUrl,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "LINQ_SEND_FAILED",
      details: {
        failureStage: "http",
        providerErrorCode: 5006,
        status: 400,
      },
      retryable: false,
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(privateUrl);
    expect(serialized).not.toContain(privatePhone);
    expect(serialized).not.toContain(privateEmail);
    expect(serialized).not.toContain(privateChatId);
    expect(serialized).not.toContain(privateGroupChatId);
    expect(serialized).not.toContain(privateParticipantId);
    expect(serialized).not.toContain(traceId);
    expect(serialized).not.toContain("dXNlcjpwYXNz");
    expect(serialized).not.toContain("Participant");
  });

  it("ignores arbitrary provider prose for an allowlisted Linq error code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse({
      error: {
        code: 5007,
        message: "provider detail ".repeat(40),
        status: 400,
      },
      success: false,
    }, 400)));

    const error = await updateHostedLinqChatAvatar({
      chatId: "chat_123",
      groupChatIconUrl:
        `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`,
    }).catch((caught: unknown) => caught) as { details?: Record<string, unknown> };

    expect(error.details?.providerErrorCode).toBe(5007);
    expect(error.details).not.toHaveProperty("providerErrorMessage");
    expect(JSON.stringify(error)).not.toContain("provider detail");
  });

  it.each([
    {
      label: "non-JSON",
      response: () => new Response("not-json", { status: 400 }),
    },
    {
      label: "oversized",
      response: () => createJsonResponse({
        error: {
          code: 5007,
          message: "x".repeat(20 * 1024),
          status: 400,
        },
        success: false,
      }, 400),
    },
  ])("keeps $label Linq error bodies out of diagnostics", async ({ response }) => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));

    await expect(updateHostedLinqChatAvatar({
      chatId: "chat_123",
      groupChatIconUrl:
        `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`,
    })).rejects.toMatchObject({
      details: {
        failureStage: "http",
        status: 400,
      },
    });

    const error = await updateHostedLinqChatAvatar({
      chatId: "chat_123",
      groupChatIconUrl:
        `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`,
    }).catch((caught: unknown) => caught) as { details?: Record<string, unknown> };
    expect(error.details).not.toHaveProperty("providerErrorCode");
    expect(error.details).not.toHaveProperty("providerErrorMessage");
  });

  it.each([
    {
      error: { code: 5007, message: "Failed to download image" },
    },
    {
      error: { code: 50_007, message: "Failed to download image" },
      success: false,
    },
    {
      error: { code: "5007", message: 123 },
      success: false,
    },
    {
      error: { code: 5008, message: "Unknown provider prose" },
      success: false,
    },
  ])("ignores fields outside the documented Linq error envelope", async (body) => {
    vi.stubGlobal("fetch", vi.fn(async () => createJsonResponse(body, 400)));

    const error = await updateHostedLinqChatAvatar({
      chatId: "chat_123",
      groupChatIconUrl:
        `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`,
    }).catch((caught: unknown) => caught) as { details?: Record<string, unknown> };

    expect(error.details).not.toHaveProperty("providerErrorCode");
    expect(error.details).not.toHaveProperty("providerErrorMessage");
  });

  it("accepts only the current preview Worker origin", async () => {
    const previewOrigin = "https://hosted-runner-staging.example.test";
    const previewUrl =
      `${previewOrigin}/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}?exp=2000000000`;
    const productionUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}?exp=2000000000`;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return createJsonResponse({ status: "pending" }, 200);
      },
    );
    vi.stubEnv("HOSTED_EXECUTION_CONTROL_URL", previewOrigin);
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateHostedLinqChatAvatar({
      chatId: "chat_preview",
      groupChatIconUrl: previewUrl,
    })).resolves.toBeUndefined();
    await expect(updateHostedLinqChatAvatar({
      chatId: "chat_preview",
      groupChatIconUrl: productionUrl,
    })).rejects.toThrow(/hosted private media URL/u);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(readJsonRequestBody(
      expectRequestInit(fetchMock.mock.calls[0]?.[1]),
    )).toEqual({
      group_chat_icon: previewUrl,
    });
  });

  it("accepts the prior signed Images shape while old runners drain", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return createJsonResponse({ status: "pending" }, 200);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const legacyUrl =
      `https://imagedelivery.net/account/avatar/private?exp=2000000000&sig=${"a".repeat(64)}`;

    await expect(updateHostedLinqChatAvatar({
      chatId: "chat_123",
      groupChatIconUrl: legacyUrl,
    })).resolves.toBeUndefined();

    expect(readJsonRequestBody(
      expectRequestInit(fetchMock.mock.calls[0]?.[1]),
    )).toEqual({
      group_chat_icon: legacyUrl,
    });
  });

  it("accepts the prior queryless public Images shape while old runners drain", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return createJsonResponse({ status: "pending" }, 200);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const legacyUrl =
      "https://imagedelivery.net/TDuhqfLDl0Fb8RGwGw6mYw/889a5f43-1d35-4eae-a98e-7ae69e96a800/public";

    await expect(updateHostedLinqChatAvatar({
      chatId: "chat_123",
      groupChatIconUrl: legacyUrl,
    })).resolves.toBeUndefined();

    expect(readJsonRequestBody(
      expectRequestInit(fetchMock.mock.calls[0]?.[1]),
    )).toEqual({
      group_chat_icon: legacyUrl,
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
    })).rejects.toThrow(/hosted private media URL/u);

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
